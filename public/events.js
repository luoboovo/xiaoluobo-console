// Browser pages use WebSocket so several previews and gift panels do not exhaust HTTP's connection pool.
class LuoboEvents extends EventTarget {
  static OPEN=1;
  constructor(url){super();this.url=url;this.readyState=0;this.closed=false;this.connect();}
  connect(){
    const url=new URL(this.url,location.href);url.protocol='ws:';url.pathname='/api/events/socket';
    const socket=this.socket=new WebSocket(url);
    socket.onopen=()=>{this.readyState=1;const event=new Event('open');this.dispatchEvent(event);this.onopen?.(event);};
    socket.onmessage=event=>{for(const frame of event.data.split('\n\n')){const type=frame.match(/^event: (.+)$/m)?.[1],data=frame.match(/^data: (.+)$/m)?.[1];if(type&&data)this.dispatchEvent(new MessageEvent(type,{data}));}};
    socket.onerror=()=>{};
    socket.onclose=()=>{if(this.closed)return;this.readyState=0;const event=new Event('error');this.dispatchEvent(event);this.onerror?.(event);this.timer=setTimeout(()=>this.connect(),1500);};
  }
  close(){this.closed=true;this.readyState=2;clearTimeout(this.timer);this.socket.close();}
}
