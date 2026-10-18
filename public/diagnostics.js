(() => {
  let pending=[],timer,lastTick=performance.now(),wasVisible=!document.hidden,lastAction='';
  const flush=()=>{
    clearTimeout(timer);timer=null;
    if(!pending.length)return;
    const entries=pending;pending=[];
    let body=JSON.stringify({entries});
    while(entries.length>1&&new TextEncoder().encode(body).length>30000){entries.pop();body=JSON.stringify({entries});}
    fetch('/api/diagnostics/client',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
  };
  function report(event,message,extra={}){
    if(pending.length>=10)return;
    pending.push({event,message:String(message||'').slice(0,1000),page:location.pathname,action:lastAction,...extra});
    if(!timer)timer=setTimeout(flush,1000);
  }
  addEventListener('error',event=>{
    if(event.error||event.message)report('runtime_error',event.message,{stack:String(event.error?.stack||'').slice(0,6000)});
    else if(['SCRIPT','LINK','VIDEO'].includes(event.target?.tagName))report('resource_error','资源加载失败：'+event.target.tagName);
  },true);
  addEventListener('unhandledrejection',event=>report('promise_error',event.reason?.message||String(event.reason),{stack:String(event.reason?.stack||'').slice(0,6000)}));
  addEventListener('luobo-diagnostic',event=>{if(['operation_error','resource_error'].includes(event.detail?.event))report(event.detail.event,event.detail.message);});
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('button,a,select');
    if(button)lastAction=String(button.id||button.dataset.view||button.dataset.noodleAction||button.tagName).slice(0,100);
  },true);
  document.addEventListener('visibilitychange',()=>{lastTick=performance.now();wasVisible=!document.hidden;});
  setInterval(()=>{
    const now=performance.now(),delayMs=Math.round(now-lastTick-1000);
    if(wasVisible&&!document.hidden&&delayMs>=2000)report('page_stall','页面事件循环长时间未响应',{delayMs});
    lastTick=now;wasVisible=!document.hidden;
  },1000);
  addEventListener('pagehide',flush);
})();
