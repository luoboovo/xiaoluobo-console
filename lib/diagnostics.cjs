const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {Worker} = require('node:worker_threads');
const {performance} = require('node:perf_hooks');

function redact(value, key = '', depth = 0) {
  if (/cookie|token|authorization|password|secret|sessdata|sessionid|credential|headers|signature|a_bogus/i.test(key)) return '<REDACTED>';
  if (depth > 5) return '[omitted]';
  if (value instanceof Error) return redact({name:value.name,message:value.message,code:value.code,stack:value.stack},'',depth+1);
  if (typeof value === 'string') return value.slice(0,key==='stack'?6000:2000)
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, text => {try {const url=new URL(text);url.username='';url.password='';url.search='';url.hash='';return url.href;}catch{return '[url]';}})
    .replace(/\b(?:Cookie|Authorization)\s*:\s*[^\r\n]+/gi,'<REDACTED>')
    .replace(/\b(?:SESSDATA|sessionid(?:_ss)?|token|access_token|password|secret|a_bogus|signature)\b["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi,'<REDACTED>')
    .replace(/\bBearer\s+[^\s"']+/gi,'Bearer <REDACTED>');
  if (Array.isArray(value)) return value.slice(0,20).map(item=>redact(item,'',depth+1));
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).slice(0,30).map(([name,item])=>[name,redact(item,name,depth+1)]));
  return typeof value==='bigint'?value.toString():value;
}

function appendRecord(logDir, record, {maxBytes=2*1024*1024,maxFiles=5,name='console'} = {}) {
  let line=JSON.stringify(record)+'\n';
  if (Buffer.byteLength(line)>maxBytes) line=JSON.stringify({...record,data:{truncated:true}})+'\n';
  const file=path.join(logDir,name+'.log');
  const size=fs.existsSync(file)?fs.statSync(file).size:0;
  if (size && size+Buffer.byteLength(line)>maxBytes) {
    for(let i=maxFiles-1;i>=1;i--) {
      const target=path.join(logDir,`${name}.${i}.log`),source=path.join(logDir,i===1?name+'.log':`${name}.${i-1}.log`);
      if(fs.existsSync(target))fs.unlinkSync(target);
      if(fs.existsSync(source))fs.renameSync(source,target);
    }
    if(maxFiles===1)fs.unlinkSync(file);
  }
  fs.appendFileSync(file,line);
}

function createDiagnostics(dataDir, {version=require('../package.json').version,heartbeatMs=1000,stallMs=5000,maxBytes=2*1024*1024,maxFiles=5} = {}) {
  const logDir=path.join(dataDir,'logs'),runId=randomUUID();
  fs.mkdirSync(logDir,{recursive:true});
  let closed=false,closing,failed='',alive=true,fatal=false,sequence=0,windowStart=performance.now(),written=0,suppressed=0;
  let context={},sample=()=>({}),timer;
  const pending=new Map();
  const worker=new Worker(path.join(__dirname,'diagnostics-worker.cjs'),{workerData:{logDir,runId,version,pid:process.pid,heartbeatMs,stallMs,maxBytes,maxFiles}});
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const record=(level,event,data)=>({time:new Date().toISOString(),level,event,runId,pid:process.pid,data:redact(data)});
  const send=message=>{if(!closed&&alive)worker.postMessage(message);};
  const fallback=(event,error)=>{try{appendRecord(logDir,record('error',event,{error}),{maxBytes,maxFiles,name:'fatal'});}catch{}};
  worker.on('message',message=>{
    if(message.type==='ready'){readyResolve();if(!pending.size)worker.unref();}
    if(message.type==='failure')failed=message.error;
    if(message.type==='healthy')failed='';
    if(message.type==='ack'){
      const item=pending.get(message.id);if(!item)return;
      clearTimeout(item.timer);pending.delete(message.id);
      if(message.error)item.reject(new Error(message.error));else item.resolve();
      if(!pending.size)worker.unref();
    }
  });
  worker.on('error',error=>{alive=false;failed=error.message;fallback('logging.worker_failed',error);readyReject(error);for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();});
  worker.on('exit',code=>{alive=false;if(!closed){failed=`日志线程退出 (${code})`;fallback('logging.worker_exited',new Error(failed));for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error(failed));}pending.clear();}});
  const reportSuppressed=()=>{if(suppressed){send({type:'log',record:record('warn','log.throttled',{suppressed})});suppressed=0;}};
  function log(level,event,data={}) {
    if(closed)return;
    const now=performance.now();
    if(now-windowStart>=1000){reportSuppressed();windowStart=now;written=0;}
    // Logging must not amplify a storm of identical gift or network failures.
    if(written++>=50){suppressed++;return;}
    send({type:'log',record:record(level,event,data)});
  }
  function ack(type) {
    if(closed)return Promise.resolve();
    if(!alive)return Promise.reject(new Error(failed||'日志线程已退出'));
    reportSuppressed();worker.ref();
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timeout=setTimeout(()=>{pending.delete(id);if(!pending.size)worker.unref();reject(new Error('日志线程响应超时'));},5000);
      pending.set(id,{resolve,reject,timer:timeout});worker.postMessage({type,id,clean:!fatal});
    });
  }
  const beat=()=>{
    try {const memory=process.memoryUsage();send({type:'beat',context:redact({...context,...sample(),heapMiB:Math.round(memory.heapUsed/1048576),rssMiB:Math.round(memory.rss/1048576),cpu:process.cpuUsage()})});}
    catch(error){log('warn','logging.sample_failed',{error});}
  };
  timer=setInterval(beat,heartbeatMs);timer.unref();
  const onFatal=(error,origin)=>{fatal=true;fallback('process.uncaught_exception',{message:error.message,stack:error.stack,origin});};
  process.on('uncaughtExceptionMonitor',onFatal);
  beat();
  return {
    ready,runId,logDir,log,
    context(data){context={...context,...redact(data)};send({type:'context',context});},
    sample(provider){sample=provider;},
    info(){return {enabled:true,logDir,lastError:failed||null,stallMs};},
    flush:()=>ack('flush'),
    async *export(){
      await ack('flush');
      yield JSON.stringify(record('info','diagnostics.export',{version}))+'\n';
      for(const name of ['console','fatal'])for(let i=maxFiles-1;i>=0;i--){
        const file=path.join(logDir,name+(i?'.'+i:'')+'.log');
        try{yield*fs.createReadStream(file);}catch(error){if(error.code!=='ENOENT')throw error;}
      }
    },
    close(){
      if(closing)return closing;
      closing=(async()=>{clearInterval(timer);process.removeListener('uncaughtExceptionMonitor',onFatal);try{await ack('stop');}finally{closed=true;await worker.terminate();}})();
      return closing;
    }
  };
}
module.exports={createDiagnostics,redact,appendRecord};
