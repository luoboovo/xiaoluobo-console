const {performance}=require('node:perf_hooks');
const {freemem,totalmem}=require('node:os');

function monitorDesktop(app,diagnostics,{intervalMs=2000,stallMs=5000}={}) {
  const watched=new Map();
  let closed=false,memorySampleAt=performance.now();
  const local=contents=>{try{return !contents.isDestroyed()&&/^http:\/\/127\.0\.0\.1:\d+\//.test(contents.getURL());}catch{return false;}};
  const watch=(_event,contents)=>{
    const record={contents,pending:false,stalled:false,started:0,probe:0,gone:false,recoveries:[],recoveryTimer:null};watched.set(contents.id,record);
    const detail=()=>({webContentsId:contents.id,url:contents.isDestroyed()?'':contents.getURL()});
    contents.once('destroyed',()=>{clearTimeout(record.recoveryTimer);watched.delete(contents.id);});
    contents.on('render-process-gone',(_event,details)=>{
      diagnostics.log('error','renderer.gone',{...detail(),...details});
      record.gone=true;record.pending=false;record.stalled=false;record.probe++;clearTimeout(record.recoveryTimer);
      if(closed||!local(contents)||!['crashed','oom','abnormal-exit','killed'].includes(details.reason))return;
      const now=performance.now();record.recoveries=record.recoveries.filter(time=>now-time<60000);
      if(record.recoveries.length>=2){diagnostics.log('error','renderer.recovery_stopped',detail());return;}
      record.recoveries.push(now);
      // Electron must finish tearing down the old renderer before a new one is loaded.
      record.recoveryTimer=setTimeout(()=>{
        if(closed||!local(contents))return;
        diagnostics.log('warn','renderer.reloading',detail());
        try{contents.reload();}catch(error){diagnostics.log('error','renderer.recovery_failed',{...detail(),error});}
      },500);
    });
    contents.on('did-finish-load',()=>{if(record.gone){record.gone=false;diagnostics.log('info','renderer.recovered',detail());}});
    contents.on('unresponsive',()=>diagnostics.log('error','renderer.unresponsive',detail()));
    contents.on('responsive',()=>diagnostics.log('info','renderer.responsive',detail()));
    contents.on('preload-error',(_event,_file,error)=>diagnostics.log('error','renderer.preload_failed',{...detail(),error}));
    contents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{
      if(code!==-3)diagnostics.log('warn','renderer.load_failed',{code,description,url,isMainFrame,webContentsId:contents.id});
    });
    contents.on('console-message',(event,level,message,line,source)=>{
      if(!local(contents))return;
      const severity=event.level||(['verbose','info','warning','error'][level]);
      if(['warning','error'].includes(severity))diagnostics.log(severity==='error'?'error':'warn','renderer.console',{...detail(),message:event.message||message,line:event.lineNumber||line,source:event.sourceId||source});
    });
  };
  const childGone=(_event,details)=>diagnostics.log('error','process.child_gone',details);
  app.on('web-contents-created',watch);
  app.on('child-process-gone',childGone);
  diagnostics.log('info','desktop.graphics',{features:app.getGPUFeatureStatus()});
  const timer=setInterval(()=>{
    if(performance.now()-memorySampleAt>=15000){
      memorySampleAt=performance.now();
      diagnostics.log('info','desktop.process_memory',{
        freeMiB:Math.round(freemem()/1048576),totalMiB:Math.round(totalmem()/1048576),
        processes:app.getAppMetrics().filter(item=>['Tab','GPU'].includes(item.type)).map(({pid,type,memory})=>({pid,type,memory})),
        pages:[...watched.values()].filter(({contents})=>local(contents)).map(({contents})=>({webContentsId:contents.id,pid:contents.getOSProcessId(),url:contents.getURL()}))
      });
    }
    for(const record of watched.values()){
      const {contents}=record;if(record.gone||!local(contents))continue;
      if(record.pending){
        const blockedMs=Math.round(performance.now()-record.started);
        if(blockedMs>=stallMs&&!record.stalled){record.stalled=true;diagnostics.log('error','renderer.probe_timeout',{webContentsId:contents.id,url:contents.getURL(),blockedMs});}
        continue;
      }
      record.pending=true;record.started=performance.now();const probe=++record.probe;
      contents.executeJavaScript('0').then(()=>{
        if(probe!==record.probe)return;
        if(record.stalled&&!closed)diagnostics.log('info','renderer.probe_recovered',{webContentsId:contents.id,blockedMs:Math.round(performance.now()-record.started)});
        record.pending=false;record.stalled=false;
      }).catch(error=>{if(probe!==record.probe)return;record.pending=false;if(!closed&&!contents.isDestroyed())diagnostics.log('warn','renderer.probe_failed',{webContentsId:contents.id,error});});
    }
  },intervalMs);timer.unref();
  return ()=>{closed=true;clearInterval(timer);for(const record of watched.values())clearTimeout(record.recoveryTimer);app.removeListener('web-contents-created',watch);app.removeListener('child-process-gone',childGone);watched.clear();};
}
// Electron's default uncaught-exception handler opens a synchronous error box, which blocks the main process:
// the local server, live connections and every overlay freeze until someone clicks it. Log and keep running instead.
function guardMainProcess(target,diagnostics,notify=()=>{},{notifyMs=10000}={}) {
  let notifiedAt=-Infinity;
  const report=(event,error)=>{
    try{diagnostics.log('error',event,{error});}catch{}
    const now=performance.now();if(now-notifiedAt<notifyMs)return;notifiedAt=now;
    try{notify(error instanceof Error?error.message:String(error));}catch{}
  };
  const uncaught=error=>report('process.uncaught_exception',error),rejected=reason=>report('process.unhandled_rejection',reason);
  target.on('uncaughtException',uncaught);target.on('unhandledRejection',rejected);
  return ()=>{target.removeListener('uncaughtException',uncaught);target.removeListener('unhandledRejection',rejected);};
}
module.exports={monitorDesktop,guardMainProcess};
