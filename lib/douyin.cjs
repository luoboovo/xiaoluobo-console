const https = require('node:https');
const { gunzipSync } = require('node:zlib');
const { protobufFields } = require('./protocol.cjs');
// 消息字段参考 qinant/dycast-desktop@43bf564 的 model 定义；解析器复用本项目已有的 protobufFields。

const GIFT_URL = 'https://live.douyin.com/webcast/gift/list/?aid=6383&device_platform=webapp&live_id=1';
function parseRoomHtml(html) {
  if(typeof html!=='string'||html.length>12*1024*1024)return null;
  for(const match of html.matchAll(/self\.__pace_f\.push\((\[1,"(?:\\.|[^"\\])*"\])\)/g)){
    let flight;try{flight=JSON.parse(match[1])[1];}catch{continue;}
    const marker=flight.indexOf('"roomInfo":');if(marker<0)continue;
    const start=flight.indexOf('{',marker);if(start<0)continue;
    let depth=0,quoted=false,escaped=false;
    for(let i=start;i<flight.length;i++){
      const ch=flight[i];
      if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
      if(ch==='"')quoted=true;
      else if(ch==='{')depth++;
      else if(ch==='}'&&!--depth){
        try{const info=JSON.parse(flight.slice(start,i+1));if(info.room?.status!==undefined)return {roomId:String(info.roomId||info.room?.id_str||''),status:Number(info.room.status),title:String(info.room?.title||'').slice(0,200)};break;}catch{break;}
      }
    }
  }
  return null;
}
function douyinRoom(input) {
  const text = String(input || '').trim();
  if (/^[1-9]\d{0,24}$/.test(text)) return text;
  try {
    const url = new URL(text.startsWith('live.douyin.com/') ? 'https://' + text : text);
    if (url.protocol === 'https:' && url.hostname === 'live.douyin.com' && !url.port && !url.username && !url.password && /^\/[1-9]\d{0,24}\/?$/.test(url.pathname)) return url.pathname.split('/')[1];
  } catch {}
  throw new Error('请输入抖音网页版直播间的数字房间号或 https://live.douyin.com/ 链接');
}
function douyinImage(input) {
  try {
    const url = new URL(String(input || '').replace(/^http:/, 'https:'));
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && ['douyinpic.com','byteimg.com'].some(host => url.hostname.endsWith('.' + host))) return url.href;
  } catch {}
  return '';
}
function requestDouyin(url, cookie = '') {
  const target = new URL(url);
  if (target.origin !== 'https://live.douyin.com' && !douyinImage(url)) return Promise.reject(new Error('抖音资源地址无效'));
  return new Promise((resolve, reject) => {
    const req = https.get(target, { headers: { 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36', Referer:'https://live.douyin.com/', ...(target.origin === 'https://live.douyin.com' && cookie ? {Cookie:cookie} : {}) } }, res => {
      let size = 0; const chunks = [];
      res.on('data', chunk => { size += chunk.length; if (size > 12 * 1024 * 1024) req.destroy(new Error('抖音响应过大')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => res.statusCode === 200 ? resolve({body:Buffer.concat(chunks),headers:res.headers}) : reject(new Error(`抖音请求失败（${res.statusCode}）`)));
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('抖音请求超时')));
  });
}
function normalizeGifts(list) {
  if (!Array.isArray(list)) throw new Error('抖音礼物列表无效');
  const gifts = new Map();
  for (const g of list) {
    const id = Number(g.id), price = Number(g.diamond_count ?? g.price), icon = douyinImage(g.image?.url_list?.[0] || g.icon);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(price) || price < 1 || typeof g.name !== 'string' || !g.name || g.name.length > 100) continue;
    gifts.set(id, {id,name:g.name,price,coinType:'douyin',icon,platform:'douyin'});
  }
  return [...gifts.values()].sort((a,b) => a.price-b.price || a.id-b.id);
}
const first = (fields, key) => fields.get(key)?.[0];
const text = (fields, key) => Buffer.isBuffer(first(fields,key)) ? first(fields,key).toString('utf8') : '';
const id = (fields, key) => { const value=first(fields,key); return typeof value==='bigint'&&value>0n ? value.toString() : ''; };
const number = (fields,key,fallback=0) => { const value=first(fields,key); if(value===undefined)return fallback; const result=Number(value); if(!Number.isSafeInteger(result)||result<0)throw new Error('抖音消息数值超限'); return result; };
const nested = (fields,key) => protobufFields(Buffer.isBuffer(first(fields,key)) ? first(fields,key) : Buffer.alloc(0));
function user(fields) {
  return {uid:id(fields,1),user:text(fields,3).slice(0,100) || '观众',face:douyinImage(text(nested(fields,9),1))};
}
function varint(input) { let n=BigInt(input), bytes=[]; do { let b=Number(n&127n); n>>=7n; bytes.push(n?b|128:b); } while(n); return Buffer.from(bytes); }
function field(key,value) { const bytes=Buffer.isBuffer(value)?value:Buffer.from(String(value)); return Buffer.concat([varint(key*8+2),varint(bytes.length),bytes]); }
function decodeFrame(input) {
  const bytes=Buffer.from(input); if(bytes.length>4*1024*1024)throw new Error('抖音消息过大');
  const frame=protobufFields(bytes), payload=first(frame,8);
  if(!Buffer.isBuffer(payload))return {messages:[],ack:null};
  if(text(frame,7)==='hb')return {messages:[],ack:null};
  const body=payload[0]===31&&payload[1]===139 ? gunzipSync(payload,{maxOutputLength:8*1024*1024}) : payload;
  const response=protobufFields(body), messages=[];
  for(const raw of response.get(1)||[]) {
    const envelope=protobufFields(raw), method=text(envelope,1), message=nested(envelope,2), common=nested(message,1);
    const messageId=id(envelope,3)||id(common,2);
    if(method==='WebcastChatMessage')messages.push({type:'chat',...user(nested(message,2)),text:text(message,3),messageId});
    else if(method==='WebcastGiftMessage') {
      const gift=nested(message,15), sender=user(nested(message,7));
      const giftId=number(message,2)||number(gift,5), total=number(message,5,1)||1;
      if(!giftId||total>1000000)continue;
      messages.push({type:'gift',...sender,giftId,giftName:text(gift,16).slice(0,100),count:total,combo:number(gift,10)===1,groupId:id(message,11),repeatEnd:number(message,9),price:number(gift,12),icon:douyinImage(text(nested(gift,1),1)),messageId});
    } else if(method==='WebcastLikeMessage')messages.push({type:'like',...user(nested(message,5)),count:number(message,2),total:number(message,3),messageId});
    else if(method==='WebcastMemberMessage')messages.push({type:'member',...user(nested(message,2)),messageId});
    else if(method==='WebcastSocialMessage')messages.push({type:'social',...user(nested(message,2)),text:number(message,4)===1?'关注了主播':'分享了直播间',messageId});
    else if(method==='WebcastRoomUserSeqMessage')messages.push({type:'room',people:number(message,3),total:number(message,7)});
    else if(method==='WebcastControlMessage')messages.push({type:'control',status:number(message,2)});
  }
  const ack=number(response,9) ? Buffer.concat([varint(16),varint(first(frame,2)||0n),field(7,'ack'),field(8,text(response,5))]) : null;
  return {messages,ack};
}

// 连送消息的 repeat_count 是累计值；只发出本次新增数量，末帧不再重复结算。
class GiftCounter {
  constructor() {this.seen=new Map();this.combos=new Map();}
  accept(event, now=Date.now()) {
    for(const map of [this.seen,this.combos])for(const [key,value] of map){if(now-value.at<=300000)break;map.delete(key);}
    if(event.messageId&&this.seen.has(event.messageId))return null;
    if(event.messageId)this.seen.set(event.messageId,{at:now});
    let count=event.count;
    if(event.combo&&event.groupId&&event.groupId!=='0') {
      const key=`${event.uid}:${event.giftId}:${event.groupId}`, previous=this.combos.get(key)?.count||0;
      count=Math.max(0,event.count-previous); this.combos.delete(key);this.combos.set(key,{count:Math.max(previous,event.count),at:now});
    }
    for(const map of [this.seen,this.combos])if(map.size>50000)map.delete(map.keys().next().value);
    return count ? {...event,count,transactionId:event.messageId || (event.groupId ? `${event.groupId}:${event.count}` : '')} : null;
  }
}
module.exports={GIFT_URL,parseRoomHtml,douyinRoom,douyinImage,requestDouyin,normalizeGifts,decodeFrame,GiftCounter,field,varint};
