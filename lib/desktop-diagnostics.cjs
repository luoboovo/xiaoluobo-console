const {performance}=require('node:perf_hooks');

function monitorDesktop(app,diagnostics,{intervalMs=2000,stallMs=5000}={}) {
  const watched=new Map();
  let closed=false;
  const local=contents=>{try{return !contents.isDestroyed()&&/^http:\/\/127\.0\.0\.1:\d+\//.test(contents.getURL());}catch{return false;}};
  const watch=(_event,contents)=>{
    const record={contents,pending:false,stalled:false,started:0};watched.set(contents.id,record);
    const detail=()=>({webContentsId:contents.id,url:contents.isDestroyed()?'':contents.getURL()});
    contents.once('destroyed',()=>watched.delete(contents.id));
    contents.on('render-process-gone',(_event,details)=>diagnostics.log('error','renderer.gone',{...detail(),...details}));
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
    for(const record of watched.values()){
      const {contents}=record;if(!local(contents))continue;
      if(record.pending){
        const blockedMs=Math.round(performance.now()-record.started);
        if(blockedMs>=stallMs&&!record.stalled){record.stalled=true;diagnostics.log('error','renderer.probe_timeout',{webContentsId:contents.id,url:contents.getURL(),blockedMs});}
        continue;
      }
      record.pending=true;record.started=performance.now();
      contents.executeJavaScript('0').then(()=>{
        if(record.stalled&&!closed)diagnostics.log('info','renderer.probe_recovered',{webContentsId:contents.id,blockedMs:Math.round(performance.now()-record.started)});
        record.pending=false;record.stalled=false;
      }).catch(error=>{record.pending=false;if(!closed&&!contents.isDestroyed())diagnostics.log('warn','renderer.probe_failed',{webContentsId:contents.id,error});});
    }
  },intervalMs);timer.unref();
  return ()=>{closed=true;clearInterval(timer);app.removeListener('web-contents-created',watch);app.removeListener('child-process-gone',childGone);watched.clear();};
}
module.exports={monitorDesktop};
