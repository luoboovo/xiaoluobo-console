const fs=require('node:fs/promises'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {Worker,isMainThread,parentPort}=require('node:worker_threads');

function imageEdge(slot) {
  // 常用 1080p 画面的小贴图按显示用途供图，背景和大桌台保留原尺寸。
  const name=slot.replaceAll('-','_');
  if(['background','counter','tray','bowl_area','seal','shop_seal'].includes(name))return Infinity;
  return ['pot','pot_empty','coffee_machine','griddle','oven','cabinet','fridge','water_fridge','fridge_empty','ingredient_sheet'].includes(name)?768:512;
}

if(!isMainThread)parentPort.on('message',async({file,edge})=>{
  try {
    const original=await fs.readFile(file);
    const bytes=require('./png.cjs').resizePng(original,edge);
    const result=Uint8Array.from(bytes);parentPort.postMessage({bytes:result},[result.buffer]);
  }catch(error){parentPort.postMessage({error:error.message});}
});

const cacheKey=(file,edge)=>createHash('sha256').update(file+':'+edge).digest('hex').slice(0,32);

function createImageRenderer(onError=()=>{}) {
  // 串行生成磁盘副本，空闲后结束线程，不常驻保存解码缓冲。
  const pending=new Map(),queue=[];
  let worker,active,idle,closed=false;
  function dispatch(){
    clearTimeout(idle);
    if(closed){for(const job of queue.splice(0))job.reject(new Error('图片处理已关闭'));return;}
    if(active)return;
    if(!queue.length){if(worker){worker.unref();const child=worker;idle=setTimeout(()=>{if(worker===child){worker=null;child.terminate();}},500);idle.unref();}return;}
    if(!worker){
      const child=worker=new Worker(__filename);
      child.on('message',message=>{if(worker!==child||!active)return;const job=active;active=null;if(message.error)job.reject(new Error(message.error));else job.resolve(Buffer.from(message.bytes.buffer,message.bytes.byteOffset,message.bytes.byteLength));dispatch();});
      child.on('error',error=>{if(worker!==child)return;worker=null;active?.reject(error);active=null;dispatch();});
      child.on('exit',code=>{if(worker!==child)return;worker=null;if(active){active.reject(new Error('图片处理线程退出：'+code));active=null;}dispatch();});
    }
    worker.ref();active=queue.shift();worker.postMessage({file:active.file,edge:active.edge});
  }
  async function get(file,edge,cacheDir){
    if(closed||!Number.isFinite(edge))return fs.readFile(file);
    const stat=await fs.stat(file),key=cacheKey(file,edge);
    const stamp=createHash('sha256').update(stat.size+':'+stat.mtimeMs).digest('hex').slice(0,16);
    const target=path.join(cacheDir,key+'_'+stamp+'.png');
    if(pending.has(target))return pending.get(target);
    const task=(async()=>{
      try{return await fs.readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
      const handle=await fs.open(file,'r'),header=Buffer.alloc(24);
      try{await handle.read(header,0,24,0);}finally{await handle.close();}
      if(!header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||Math.max(header.readUInt32BE(16),header.readUInt32BE(20))<=edge)return fs.readFile(file);
      if(header.readUInt32BE(16)>4096||header.readUInt32BE(20)>4096)throw new Error('图片尺寸超出处理范围');
      const bytes=await new Promise((resolve,reject)=>{queue.push({file,edge,resolve,reject});dispatch();});
      await fs.mkdir(cacheDir,{recursive:true});
      const temporary=target+'.tmp-'+randomUUID();
      try{await fs.writeFile(temporary,bytes);await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
      for(const name of await fs.readdir(cacheDir))if(name.startsWith(key+'_')&&name.endsWith('.png')&&name!==path.basename(target))await fs.rm(path.join(cacheDir,name),{force:true});
      return bytes;
    })().catch(async error=>{if(!closed)onError(error);return fs.readFile(file);}).finally(()=>pending.delete(target));
    pending.set(target,task);return task;
  }
  async function close(){closed=true;clearTimeout(idle);for(const job of queue.splice(0))job.reject(new Error('图片处理已关闭'));active?.reject(new Error('图片处理已关闭'));active=null;const child=worker;worker=null;await child?.terminate();}
  return {get,close};
}

module.exports={createImageRenderer,imageEdge,cacheKey};
