const fs=require('node:fs');
const path=require('node:path');
const {parentPort,workerData:options}=require('node:worker_threads');
const {performance}=require('node:perf_hooks');
const {appendRecord,redact}=require('./diagnostics.cjs');
const {logDir,runId,version,pid,heartbeatMs,stallMs}=options;
const marker=path.join(logDir,'run-state.json');
let context={},lastBeat=performance.now(),lastHeartbeat=new Date().toISOString(),stalled=false,lastSample=performance.now(),stopped=false;
let lastError='';
function append(record){
  try{appendRecord(logDir,record,options);if(lastError){lastError='';parentPort.postMessage({type:'healthy'});}}
  catch(error){const message=redact(error.message);if(message!==lastError){lastError=message;parentPort.postMessage({type:'failure',error:message});}}
}
function write(level,event,data={}){
  append({time:new Date().toISOString(),level,event,runId,pid,data:redact(data)});
}
function state(clean=false){
  fs.writeFileSync(marker,JSON.stringify({runId,version,pid,lastHeartbeat,operation:context.operation||context.lastRequest,clean}));
}
try{
  if(fs.existsSync(marker)){
    const old=JSON.parse(fs.readFileSync(marker,'utf8'));
    if(!old.clean)write('warn','run.previous_unclean_exit',old);
  }
}catch(error){write('warn','run.state_unreadable',{error});}
write('info','run.start',{version,node:process.versions.node,electron:process.versions.electron,platform:process.platform,arch:process.arch,stallMs});
try{state();}catch(error){write('error','run.state_write_failed',{error});}
const timer=setInterval(()=>{
  const lag=performance.now()-lastBeat;
  if(lag>=stallMs&&!stalled){stalled=true;write('error','main.unresponsive',{missedHeartbeatMs:Math.round(lag),...context});try{state();}catch{}}
  if(performance.now()-lastSample>=15000){
    lastSample=performance.now();write('info','runtime.sample',context);
    try{state();}catch(error){write('error','run.state_write_failed',{error});}
  }
},Math.min(heartbeatMs,1000));
parentPort.on('message',message=>{
  if(stopped)return;
  if(message.type==='log'){
    append(message.record);
  }else if(message.type==='context')context={...context,...message.context};
  else if(message.type==='beat'){
    if(stalled){write('info','main.responsive',{blockedMs:Math.round(performance.now()-lastBeat),...context});stalled=false;}
    lastBeat=performance.now();lastHeartbeat=new Date().toISOString();context={...context,...message.context};
  }else if(message.type==='flush'||message.type==='stop'){
    let error;
    if(message.type==='stop'){
      clearInterval(timer);write('info','run.stop',{clean:message.clean});
      try{state(message.clean);}catch(cause){error=redact(cause.message);}
      stopped=true;
    }
    parentPort.postMessage({type:'ack',id:message.id,error});
  }
});
parentPort.postMessage({type:'ready'});
