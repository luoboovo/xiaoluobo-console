const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { atomicJson, readJson } = require('./storage.cjs');
const { imageType } = require('./image-type.cjs');
const { roomId, signWbi, packet, unpack, giftV2, danmuReply, mentionOf, interactV2, mergeGifts, paidGifts, imageUrl } = require('./protocol.cjs');
const { GIFT_URL, douyinRoom, douyinImage, requestDouyin, normalizeGifts, decodeFrame, GiftCounter, field } = require('./douyin.cjs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];

function request(url, cookie = '') {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Referer: 'https://live.bilibili.com/', ...(cookie ? { Cookie: cookie } : {}) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 12 * 1024 * 1024) req.destroy(new Error('响应过大')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`B站请求失败（${res.statusCode}）`));
        resolve({ body: Buffer.concat(chunks), headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('网络请求超时，请重试')));
  });
}

function postForm(url, body, cookie = '') {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: { 'User-Agent': UA, Referer: 'https://live.bilibili.com/', Origin: 'https://live.bilibili.com', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...(cookie ? { Cookie: cookie } : {}) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) req.destroy(new Error('响应过大')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => res.statusCode === 200 ? resolve({ body: Buffer.concat(chunks), headers: res.headers }) : reject(new Error(`B站请求失败（${res.statusCode}）`)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('网络请求超时，请重试')));
    req.end(body);
  });
}

class ConsoleServices extends EventEmitter {
  constructor({ dataDir, seedDir, secrets = { load: async () => ({}), save: async () => {} }, WebSocketImpl = WebSocket, requestImpl = request, postImpl = postForm, douyin, DouyinSocket = require('ws'), douyinRequest = requestDouyin, diagnostics }) {
    super();
    this.dataDir = dataDir; this.seedDir = seedDir; this.secretStore = secrets; this.WebSocket = WebSocketImpl; this.request = requestImpl; this.postRequest = postImpl;
    this.douyin = douyin; this.DouyinSocket=DouyinSocket; this.douyinRequest=douyinRequest; this.douyinCounter=new GiftCounter();this.diagnostics=diagnostics;
    this.douyinStats={frames:0,giftMessages:0,acceptedGiftMessages:0,suppressedGiftMessages:0,giftUnits:0};
    this.state = { live: { status: 'disconnected', roomId: null, title: '', liveStatus: 0 }, account: { loggedIn: false, name: '' }, gifts: { count: 0, updatedAt: null, syncing: false, cached: 0 }, stats: { chat: 0, gift: 0, people: 0 }, config: { room: '' } };
    this.events = []; this.gifts = []; this.secretData = {}; this.liveGeneration = 0; this.retryDelay = 3000; this.imageJobs = new Map();
    this.state.config.platform='bilibili'; this.rooms={bilibili:'',douyin:''};
  }
  async init() {
    await fs.mkdir(path.join(this.dataDir, 'images'), { recursive: true });
    this.secretData = await this.secretStore.load();
    const config = await readJson(path.join(this.dataDir, 'config.json'), this.state.config);
    if (typeof config.room === 'string') this.state.config.room = config.room;
    for(const platform of ['bilibili','douyin'])if(typeof config.rooms?.[platform]==='string')this.rooms[platform]=config.rooms[platform];
    if(!config.rooms)this.rooms.bilibili=this.state.config.room;
    else this.state.config.room=this.rooms.bilibili;
    const seed = await readJson(path.join(this.seedDir, 'gifts.json'), { list: [], updatedAt: null });
    const stored = await readJson(path.join(this.dataDir, 'gifts.json'), null);
    this.gifts = paidGifts(mergeGifts([...seed.list, ...(stored?.list || [])], []));
    if (stored && JSON.stringify(stored.list) !== JSON.stringify(this.gifts)) {
      const backup = path.join(this.dataDir, 'gifts.before-paid-v2.0.6.json');
      if (!await fs.access(backup).then(() => true, () => false)) await atomicJson(backup, stored);
    }
    await atomicJson(path.join(this.dataDir, 'gifts.json'), { updatedAt: stored?.updatedAt || seed.updatedAt, list: this.gifts });
    this.state.gifts.count = this.gifts.length;
    this.state.gifts.updatedAt = stored?.updatedAt || seed.updatedAt;
    const cachedNames = new Set((await Promise.all([this.dataDir, this.seedDir].map(dir => fs.readdir(path.join(dir, 'images')).catch(() => [])))).flat());
    this.state.gifts.cached = this.gifts.filter(g => g.icon && cachedNames.has(this.imageName(g))).length;
    if (this.secretData.cookie) await this.refreshAccount().catch(() => {});
    this.biliGifts=this.gifts;this.biliGiftState=this.state.gifts;this.biliAccount=this.state.account;
    const dySeed=await readJson(path.join(this.seedDir,'douyin-gifts.json'),{list:[],updatedAt:null});
    const dyStored=await readJson(path.join(this.dataDir,'douyin-gifts.json'),null);
    this.dyGifts=normalizeGifts([...dySeed.list,...(dyStored?.list||[])]);
    this.dyGiftState={count:this.dyGifts.length,updatedAt:dyStored?.updatedAt||dySeed.updatedAt,cached:this.dyGifts.filter(g=>g.icon&&cachedNames.has(this.imageName(g))).length,syncing:false};
    // Both catalogs must be loaded before cleaning, otherwise the other platform's images look orphaned.
    await this.cleanGiftImages();
    if(config.platform==='douyin')await this.selectPlatform('douyin');
    return this;
  }
  get platform(){return this.state.config.platform||'bilibili';}
  async selectPlatform(platform) {
    if(!['bilibili','douyin'].includes(platform))throw new Error('请选择B站或抖音');
    if(this.syncJob)await this.syncJob.catch(()=>{});
    if(platform===this.platform)return;
    this.rooms[this.platform]=this.state.config.room;
    const next={platform,room:this.rooms[platform]||'',rooms:{...this.rooms}};
    await atomicJson(path.join(this.dataDir,'config.json'),next);
    this.disconnectLive(false);this.events=[];
    if(this.platform==='bilibili'){this.biliGifts=this.gifts;this.biliGiftState=this.state.gifts;this.biliAccount=this.state.account;}
    this.state.config=next;this.gifts=platform==='douyin'?this.dyGifts:this.biliGifts;
    this.state.gifts=platform==='douyin'?this.dyGiftState:this.biliGiftState;
    this.state.account=platform==='douyin'?await this.douyin?.account?.()||{loggedIn:false,name:''}:this.biliAccount;
    this.state.live={status:'disconnected',roomId:null,title:'',liveStatus:0};this.state.stats={chat:0,gift:0,people:0,like:0};this.publish();
  }
  async loginDouyin(){
    if(!this.douyin?.login)throw new Error('请使用桌面客户端登录抖音');
    await this.douyin.login();
    if(this.platform==='douyin'){this.state.account=await this.douyin.account();this.publish();}
  }
  publish() { this.emit('state', this.state); }
  addEvent(type, user, text, extra = {}) {
    const event = { id: randomUUID(), type, user: String(user || '').slice(0, 100), text: String(text || '').slice(0, 2000), time: Date.now(), platform:this.platform, ...extra };
    this.events.unshift(event); this.events.length = Math.min(this.events.length, 200);
    if (type === 'chat') this.state.stats.chat++;
    if (type === 'gift') this.state.stats.gift += extra.count || 1;
    this.emit('event', event); this.publish();
  }
  async api(url, cookie = this.secretData.cookie || '') {
    const response = await this.request(url, cookie);
    let json;
    try { json = JSON.parse(response.body.toString('utf8')); } catch { throw new Error('B站返回异常，请稍后重试'); }
    const guestNav = json.code === -101 && new URL(url).pathname === '/x/web-interface/nav' && json.data?.wbi_img;
    if (json.code !== 0 && !guestNav) throw new Error(`B站：${json.message || json.msg || json.code}`);
    return { data: json.data, headers: response.headers };
  }
  async refreshAccount() {
    const { data } = await this.api('https://api.bilibili.com/x/web-interface/nav');
    this.state.account = { loggedIn: Boolean(data.isLogin), name: data.isLogin ? data.uname : '' };
    this.publish();
  }
  async loginQr() {
    if(this.platform!=='bilibili')throw new Error('请点击登录抖音');
    const { data } = await this.api('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', '');
    this.qrKey = data.qrcode_key;
    this.qrExpires = Date.now() + 180000;
    return data.url;
  }
  async loginPoll() {
    if(this.platform!=='bilibili')throw new Error('当前已切换到抖音');
    if (!this.qrKey || Date.now() > this.qrExpires) return { code: 86038 };
    const { data, headers } = await this.api(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(this.qrKey)}`, '');
    if (data.code === 0) {
      const cookie = (headers['set-cookie'] || []).map(c => c.split(';')[0]).filter(c => /^(SESSDATA|bili_jct|DedeUserID|DedeUserID__ckMd5)=/.test(c)).join('; ');
      if (!cookie.includes('SESSDATA=')) throw new Error('登录凭证未收到，请重新扫码');
      const { data: account } = await this.api('https://api.bilibili.com/x/web-interface/nav', cookie);
      if (!account.isLogin) throw new Error('登录未生效，请重新扫码');
      this.secretData.cookie = cookie; await this.secretStore.save(this.secretData);
      this.qrKey = null; this.state.account = { loggedIn: true, name: account.uname }; this.wbi = null; this.publish();
      if (this.liveTarget) await this.connectLive(this.liveTarget);
    }
    return { code: data.code };
  }
  // B站网页接口要的 buvid 和 WBI 签名密钥（连直播间、搜用户共用，一小时换一次密钥）。
  async ensureWbi() {
    if (!this.buvid) {
      const { data } = await this.api('https://api.bilibili.com/x/frontend/finger/spi', '');
      this.buvid = data.b_3;
      if (!this.buvid) throw new Error('B站连接凭证获取失败');
    }
    if (!this.wbi || Date.now() - this.wbi.time > 3600000) {
      const { data } = await this.api('https://api.bilibili.com/x/web-interface/nav');
      const raw = [data.wbi_img.img_url, data.wbi_img.sub_url].map(s => s.split('/').pop().split('.')[0]).join('');
      this.wbi = { key: MIXIN.map(i => raw[i]).join('').slice(0, 32), time: Date.now() };
      if (this.wbi.key.length !== 32) throw new Error('B站签名凭证无效');
    }
  }
  async danmuInfo(id) {
    await this.ensureWbi();
    const query = signWbi({ id, type: 0, web_location: '444.8' }, this.wbi.key);
    const { data } = await this.api(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${query}`, `${this.secretData.cookie || ''}; buvid3=${this.buvid}`);
    if (!data.token || !data.host_list?.length) throw new Error('B站未返回直播连接地址');
    return data;
  }
  disconnectLive(publish = true) {
    this.liveGeneration++; this.liveTarget = null;
    clearInterval(this.heartbeat); clearTimeout(this.reconnect); clearTimeout(this.liveAuthTimer);
    this.liveSocket?.close(); this.liveSocket = null;
    this.douyin?.cancel?.();
    this.state.live.status = 'disconnected'; this.state.stats.people = 0;
    if (publish) this.publish();
  }
  async connectLive(input, retry = false) {
    if(this.platform==='douyin')return this.connectDouyin(input,retry);
    const id = roomId(input);
    this.disconnectLive(false); this.liveTarget = id;
    const generation = this.liveGeneration;
    this.state.live.status = retry ? 'reconnecting' : 'connecting'; this.state.live.error = ''; this.publish();
    if (!retry) { this.retryDelay = 3000; await this.rememberRoom(input); }
    try {
      const { data: room } = await this.api(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${id}`);
      const { data: info } = await this.api(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${room.room_id}`);
      const auth = await this.danmuInfo(room.room_id);
      if (generation !== this.liveGeneration) return;
      // Each retry moves to the next server so one unhealthy host cannot stall reconnects.
      this.hostIndex = retry ? (this.hostIndex || 0) + 1 : 0;
      const host = auth.host_list[this.hostIndex % auth.host_list.length];
      if (!host.host.endsWith('.chat.bilibili.com') || !Number.isInteger(host.wss_port) || host.wss_port <= 0 || host.wss_port > 65535) throw new Error('B站直播连接地址无效');
      const ws = new this.WebSocket(`wss://${host.host}:${host.wss_port}/sub`); ws.binaryType = 'arraybuffer'; this.liveSocket = ws;
      this.state.live = { status: 'connecting', roomId: room.room_id, anchorUid: Number(room.uid) || 0, title: info.title, liveStatus: room.live_status, error: '' }; this.publish();
      this.liveAuthTimer = setTimeout(() => ws.close(), 15000);
      ws.addEventListener('open', () => {
        if (generation !== this.liveGeneration) return;
        const uid = Number((this.secretData.cookie || '').match(/(?:^|; )DedeUserID=(\d+)/)?.[1] || 0);
        ws.send(packet({ uid, roomid: room.room_id, protover: 3, buvid: this.buvid, support_ack: true, queue_uuid: randomUUID(), scene: 'room', platform: 'web', type: 2, key: auth.token }, 7));
      });
      ws.addEventListener('message', event => {
        if (generation !== this.liveGeneration) return;
        try {
          for (const frame of unpack(event.data)) {
            if (frame.operation === 8) {
              if (JSON.parse(frame.body.toString()).code !== 0) { this.state.live.error = '直播认证失败，请重新扫码'; ws.close(); return; }
              clearTimeout(this.liveAuthTimer); this.retryDelay = 3000; this.state.live.status = 'connected';
              const heartbeat = () => { if (ws.readyState === 1) ws.send(packet('[object Object]', 2)); };
              heartbeat(); this.heartbeat = setInterval(heartbeat, 30000); this.publish();
            } else if (frame.operation === 3 && frame.body.length >= 4) { this.state.stats.people = frame.body.readUInt32BE(0); this.publish(); }
            else if (frame.operation === 5) this.liveMessage(JSON.parse(frame.body.toString()));
          }
        } catch (error) { this.diagnostics?.log('warn','live.decode_failed',{platform:'bilibili',error});this.addEvent('system', '', '一条直播消息解析失败，继续接收'); }
      });
      ws.addEventListener('error', event => { this.diagnostics?.log('warn','live.socket_error',{platform:'bilibili',message:event.message||'WebSocket error'});this.state.live.error = '直播连接中断，正在重试'; });
      ws.addEventListener('close', () => {
        if (generation !== this.liveGeneration) return;
        clearInterval(this.heartbeat); clearTimeout(this.liveAuthTimer); this.scheduleReconnect(id);
      });
    } catch (error) {
      if (generation !== this.liveGeneration) return;
      this.diagnostics?.log('error','live.connect_failed',{platform:'bilibili',retry,error});
      this.state.live.error = error.message;
      if (retry) this.scheduleReconnect(id);
      else { this.state.live.status = 'error'; this.liveTarget = null; this.publish(); throw error; }
    }
  }
  // 按昵称在B站搜用户，拿到 UID（设专属进场视频时用）。最多 10 个，B站给的搜索高亮标签去掉。
  async searchUsers(keyword) {
    const text = String(keyword || '').trim().slice(0, 40);
    if (!text) throw new Error('请填昵称');
    await this.ensureWbi();
    const query = signWbi({ search_type: 'bili_user', keyword: text, page: 1 }, this.wbi.key);
    const { data } = await this.api(`https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`, `${this.secretData.cookie || ''}; buvid3=${this.buvid}`);
    const plain = value => String(value || '').replace(/<[^>]*>/g, '').trim();
    return (Array.isArray(data?.result) ? data.result : []).map(user => ({
      uid: Number(user.mid) || 0, name: plain(user.uname).slice(0, 40), face: imageUrl(String(user.upic || '').replace(/^\/\//, 'https://')),
      fans: Math.max(0, Number(user.fans) || 0), level: Math.max(0, Number(user.level) || 0), sign: plain(user.usign).slice(0, 60),
    })).filter(user => Number.isSafeInteger(user.uid) && user.uid > 0 && user.name).slice(0, 10);
  }
  // 记住控制台连接的直播间（下次打开自动填好）。机器人的其他直播间各自记，不改这里。
  async rememberRoom(input) {
    this.state.config.room = String(input);
    this.rooms.bilibili=String(input);this.state.config.rooms={...this.rooms};
    await atomicJson(path.join(this.dataDir, 'config.json'), this.state.config);
  }
  scheduleReconnect(id) {
    this.state.live.status = 'reconnecting'; this.publish();
    this.reconnect = setTimeout(() => this.connectLive(id, true).catch(() => {}), this.retryDelay);
    this.retryDelay = Math.min(30000, this.retryDelay * 2);
  }
  async connectDouyin(input,retry=false){
    const room=douyinRoom(input);
    if(!this.douyin?.bootstrap)throw new Error('抖音连接需要桌面客户端，请通过小萝卜游戏控制台.exe打开');
    this.disconnectLive(false);this.liveTarget=room;
    const generation=this.liveGeneration;
    this.state.live={status:retry?'reconnecting':'connecting',roomId:room,title:'',liveStatus:0,error:''};this.publish();
    if(!retry){
      this.retryDelay=3000;this.douyinCounter=new GiftCounter();this.state.config.room=String(input);this.rooms.douyin=String(input);this.state.config.rooms={...this.rooms};
      await atomicJson(path.join(this.dataDir,'config.json'),this.state.config);
    }
    try{
      const info=await this.douyin.bootstrap(room);
      if(generation!==this.liveGeneration||this.platform!=='douyin')return;
      const url=new URL(info.url);
      if(url.protocol!=='wss:'||!url.hostname.endsWith('.douyin.com')||url.username||url.password||url.port||!url.pathname.startsWith('/webcast/im/push/'))throw new Error('抖音连接地址无效');
      const ws=this.liveSocket=new this.DouyinSocket(info.url,{headers:info.headers,maxPayload:4*1024*1024,handshakeTimeout:15000,perMessageDeflate:false});
      ws.on('open',()=>{
        if(generation!==this.liveGeneration)return;
        this.state.live={status:'connecting',roomId:info.roomId,title:info.title,liveStatus:info.liveStatus||0,error:'已建立连接，等待抖音数据…'};this.retryDelay=3000;this.publish();
        this.liveAuthTimer=setTimeout(()=>{if(generation===this.liveGeneration&&this.state.live.status==='connecting'){this.state.live.error='抖音未返回数据，请重新登录后连接';ws.close();}},30000);
        this.lastDouyinMessage=Date.now();ws.send(field(7,'hb'));
        this.heartbeat=setInterval(()=>{if(ws.readyState===1){if(Date.now()-this.lastDouyinMessage>60000)ws.close();else ws.send(field(7,'hb'));}},10000);
      });
      ws.on('message',bytes=>{
        if(generation!==this.liveGeneration)return;
        this.douyinStats.frames++;
        this.lastDouyinMessage=Date.now();
        try{
          const {messages,ack}=decodeFrame(bytes);if(ack&&ws.readyState===1)ws.send(ack);
          clearTimeout(this.liveAuthTimer);this.state.live.status='connected';this.state.live.error='';this.publish();
          for(const message of messages)this.douyinMessage(message);
        }catch(error){this.diagnostics?.log('warn','live.decode_failed',{platform:'douyin',error});this.addEvent('system','','一条抖音消息解析失败，继续接收');}
      });
      ws.on('error',error=>{if(generation===this.liveGeneration){this.diagnostics?.log('warn','live.socket_error',{platform:'douyin',error});this.state.live.error='抖音连接中断，请检查登录态；正在重试';}});
      ws.on('close',()=>{if(generation!==this.liveGeneration)return;clearInterval(this.heartbeat);this.scheduleReconnect(room);});
    }catch(error){
      if(generation!==this.liveGeneration)return;
      this.diagnostics?.log('error','live.connect_failed',{platform:'douyin',retry,error});
      this.state.live.error=error.message;
      if(retry)this.scheduleReconnect(room);else{this.state.live.status='error';this.liveTarget=null;this.publish();throw error;}
    }
  }
  douyinMessage(message){
    if(this.platform!=='douyin')return;
    if(message.type==='gift'){
      this.douyinStats.giftMessages++;
      const event=this.douyinCounter.accept(message);if(!event){this.douyinStats.suppressedGiftMessages++;return;}
      this.douyinStats.acceptedGiftMessages++;this.douyinStats.giftUnits+=event.count;
      if(event.giftName&&!this.gifts.some(g=>g.id===event.giftId)&&event.price>0){
        const [gift]=normalizeGifts([{id:event.giftId,name:event.giftName,price:event.price,icon:event.icon}]);
        if(gift){this.gifts.push(gift);this.state.gifts.count=this.gifts.length;this.saveDouyinGifts();}
      }
      this.addGift(event);
    }else if(message.type==='room'){this.state.stats.people=message.people;this.state.stats.totalViewers=message.total;this.publish();}
    else if(message.type==='control'){
      if(message.status===3){this.disconnectLive(false);this.state.live.liveStatus=0;this.state.live.error='抖音直播已结束';this.publish();}
    }else if(message.type==='like'){
      this.state.stats.like=message.total;
      this.addEvent('like',message.user,`点赞 × ${message.count}`,message);
    }else this.addEvent(message.type,message.user,message.text||(message.type==='member'?'进入了直播间':''),message);
  }
  // Gifts first seen in a live room are kept after restart; a burst of new gifts writes once.
  saveDouyinGifts(){
    clearTimeout(this.dyGiftTimer);
    this.dyGiftTimer=setTimeout(()=>{this.dyGiftTimer=null;this.writeDouyinGifts();},2000);this.dyGiftTimer.unref?.();
  }
  writeDouyinGifts(){
    this.dyGiftSave=atomicJson(path.join(this.dataDir,'douyin-gifts.json'),{list:this.dyGifts,updatedAt:this.dyGiftState.updatedAt}).catch(error=>this.diagnostics?.log('warn','gifts.save_failed',{platform:'douyin',error}));
    return this.dyGiftSave;
  }
  async flush(){
    if(this.dyGiftTimer){clearTimeout(this.dyGiftTimer);this.dyGiftTimer=null;this.writeDouyinGifts();}
    await this.dyGiftSave;
  }
  liveMessage(message) {
    const command = (message.cmd || '').split(':')[0], data = message.data || {};
    if (command === 'DANMU_MSG') {
      const text = String(message.info?.[1] || '');
      this.addEvent('chat', message.info?.[2]?.[1] || '观众', text, { uid: Number(message.info?.[2]?.[0]) || 0, admin: Number(message.info?.[2]?.[2]) === 1, face: message.info?.[0]?.[15]?.user?.base?.face || '', ...mentionOf(text, danmuReply(message.info?.[0]?.[15]?.extra)) });
    }
    else if (command === 'SEND_GIFT') this.addGift({ user: data.uname, uid: Number(data.uid) || 0, face: data.face || '', giftId: Number(data.giftId), giftName: data.giftName, count: Number(data.num) || 1, transactionId: String(data.tid || data.rnd || ''), blindGiftName: data.blind_gift?.original_gift_name || '', blindGiftPrice: Number(data.blind_gift?.original_gift_price) || 0, ...(data.coin_type === 'silver' ? { giftFree: true } : { giftPrice: Number(data.price) || Math.round((Number(data.total_coin) || 0) / (Number(data.num) || 1)) || 0 }) });
    else if (command === 'SEND_GIFT_V2' && data.pb) for (const gift of giftV2(data.pb)) this.addGift(gift);
    else if (command === 'SUPER_CHAT_MESSAGE') this.addEvent('chat', data.user_info?.uname, data.message, { superChat: true, uid: Number(data.uid) || 0, price: Number(data.price) || 0 });
    else if (command === 'GUARD_BUY') this.addEvent('gift', data.username, `开通${data.gift_name || '大航海'}`, { count: Number(data.num) || 1, uid: Number(data.uid) || 0, guardName: data.gift_name || '大航海' });
    else if (command === 'INTERACT_WORD') this.interact({ user: data.uname, uid: Number(data.uid) || 0, type: Number(data.msg_type) });
    else if (command === 'INTERACT_WORD_V2' && data.pb) { try { this.interact(interactV2(data.pb)); } catch {} }
    else if (command === 'LIVE' || command === 'PREPARING') { this.state.live.liveStatus = command === 'LIVE' ? 1 : 0; this.publish(); }
  }
  // B站进场/关注/分享：msg_type 1 进入，2 关注，3 分享，4 特别关注，5 互相关注。
  interact({ user, uid, type }) {
    if (!user) return;
    if (type === 1) this.addEvent('member', user, '进入了直播间', { uid });
    else if ([2, 4, 5].includes(type)) this.addEvent('social', user, '关注了主播', { uid, follow: true });
    else if (type === 3) this.addEvent('social', user, '分享了直播间', { uid });
  }
  get selfUid() { return Number((this.secretData.cookie || '').match(/(?:^|; )DedeUserID=(\d+)/)?.[1] || 0); }
  // 以当前登录的 B 站账号在直播间发一条弹幕；replyMid 让弹幕显示为“回复某人”。
  // 当前直播间可用的表情包（含主播房间专属表情）；perm 为 0 的需要粉丝牌等条件才能用。
  async emoticons() {
    if (this.platform !== 'bilibili') throw new Error('抖音暂不支持表情包');
    const roomid = this.state.live.roomId;
    if (!roomid) throw new Error('请先连接直播间，再读取表情');
    const { data } = await this.api(`https://api.live.bilibili.com/xlive/web-ucenter/v2/emoticon/GetEmoticons?platform=pc&room_id=${encodeURIComponent(roomid)}`);
    return (Array.isArray(data?.data) ? data.data : []).map(pkg => ({
      name: String(pkg.pkg_name || '表情').slice(0, 40),
      items: (Array.isArray(pkg.emoticons) ? pkg.emoticons : []).map(e => ({ unique: String(e.emoticon_unique || ''), name: String(e.emoji || e.descript || '表情').slice(0, 40), url: imageUrl(String(e.url || '').replace(/^http:/, 'https:')), usable: Number(e.perm ?? 1) !== 0, lock: String(e.unlock_show_text || '').slice(0, 40) })).filter(e => /^[\w-]{1,100}$/.test(e.unique) && e.url)
    })).filter(pkg => pkg.items.length);
  }
  async sendChat(text, { replyMid = 0, emoticon = false } = {}) {
    if (this.platform !== 'bilibili') { const error = new Error('抖音暂不支持机器人发言，回复只在控制台显示'); error.code = 'UNSUPPORTED'; throw error; }
    const roomid = this.state.live.roomId;
    if (this.state.live.status !== 'connected' || !roomid) throw new Error('直播间未连接');
    const cookie = this.secretData.cookie || '', csrf = cookie.match(/(?:^|; )bili_jct=([^;]+)/)?.[1];
    if (!csrf) throw new Error('请先扫码登录B站账号，机器人用该账号发言');
    if (emoticon && !/^[\w-]{1,100}$/.test(String(text))) throw new Error('表情编号无效');
    // 表情弹幕：msg 填表情编号（如 room_房间号_编号），dm_type=1。
    const form = new URLSearchParams({ bubble: '0', msg: String(text), color: '16777215', mode: '1', ...(emoticon ? { dm_type: '1' } : {}), room_type: '0', jumpfrom: '0', reply_mid: String(replyMid || 0), reply_attr: '0', replay_dmid: '', statistics: '{"appId":100,"platform":5}', fontsize: '25', rnd: String(Math.floor(Date.now() / 1000)), roomid: String(roomid), csrf, csrf_token: csrf });
    // 网页端发弹幕时带 WBI 签名（web_location=444.8）；连接直播间时已取得签名密钥。
    const query = this.wbi?.key ? `?${signWbi({ web_location: '444.8' }, this.wbi.key)}` : '';
    const { body } = await this.postRequest(`https://api.live.bilibili.com/msg/send${query}`, form.toString(), `${cookie}${this.buvid ? `; buvid3=${this.buvid}` : ''}`);
    let json;
    try { json = JSON.parse(body.toString('utf8')); } catch { throw new Error('B站返回异常，请稍后重试'); }
    if (json.code !== 0) { const error = new Error(`B站：${json.message || json.msg || json.code}`); error.code = json.code; throw error; }
    // code 0 但 msg 为 f/k 时弹幕被B站屏蔽，只有自己看得到。
    if (['f', 'k', 'fire'].includes(json.msg || json.message)) { const error = new Error('弹幕被B站屏蔽（含敏感词或重复）'); error.code = 'FILTERED'; throw error; }
    return { ok: true };
  }
  // 用登录的B站账号给当前直播间点赞；count 是这一次点的下数（网页端也是攒一批再报一次）。
  async likeRoom(count) {
    if (this.platform !== 'bilibili') { const error = new Error('抖音暂不支持点赞'); error.code = 'UNSUPPORTED'; throw error; }
    const { roomId, anchorUid } = this.state.live;
    if (this.state.live.status !== 'connected' || !roomId) throw new Error('直播间未连接');
    if (!anchorUid) throw new Error('还没拿到主播信息，请重新连接直播间');
    const cookie = this.secretData.cookie || '', csrf = cookie.match(/(?:^|; )bili_jct=([^;]+)/)?.[1], uid = this.selfUid;
    if (!csrf || !uid) throw new Error('请先扫码登录B站账号，用该账号点赞');
    const clicks = Math.floor(Number(count));
    if (!Number.isSafeInteger(clicks) || clicks < 1 || clicks > 1000) throw new Error('点赞次数要在1～1000之间');
    const form = new URLSearchParams({ click_time: String(clicks), room_id: String(roomId), uid: String(uid), anchor_id: String(anchorUid), csrf, csrf_token: csrf, visit_id: '' });
    const { body } = await this.postRequest('https://api.live.bilibili.com/xlive/app-ucenter/v1/like_info_v3/like/likeReportV3', form.toString(), `${cookie}${this.buvid ? `; buvid3=${this.buvid}` : ''}`);
    let json;
    try { json = JSON.parse(body.toString('utf8')); } catch { throw new Error('B站返回异常，请稍后重试'); }
    if (json.code !== 0) { const error = new Error(`B站：${json.message || json.msg || json.code}`); error.code = json.code; throw error; }
    return { ok: true, count: clicks };
  }
  // 主播后台「礼物流水」：登录账号（主播本人）某一天收到的礼物，B站只保留近 180 天。
  async giftStream(date, lastId = '') {
    if (this.platform !== 'bilibili') throw new Error('礼物流水补录只支持B站');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式无效');
    if (!this.secretData.cookie) throw new Error('请先扫码登录主播本人的B站账号');
    const query = new URLSearchParams({ limit: '1000', coin_type: '0', gift_id: '', begin_time: date, uname: '', ...(lastId ? { last_id: String(lastId) } : {}) });
    const { data } = await this.api(`https://api.live.bilibili.com/xlive/revenue/v1/giftStream/getReceivedGiftStreamNextList?${query}`);
    return { list: Array.isArray(data?.list) ? data.list : [], hasMore: Boolean(data?.has_more) };
  }
  addGift(gift) {
    const stored = this.gifts.find(g => g.id === gift.giftId || g.alias_ids?.includes(gift.giftId)) || (!gift.giftId && this.gifts.find(g => g.name === gift.giftName));
    const giftName = gift.giftName || stored?.name || '礼物', count = Number.isSafeInteger(gift.count) && gift.count > 0 ? gift.count : 1;
    this.addEvent('gift', gift.user || '观众', `${giftName} × ${count}`, { giftId: gift.giftId || stored?.id, giftAliases: stored ? [stored.id, ...(stored.alias_ids || [])] : [], giftName, count, uid: gift.uid || 0, face: gift.face || '', transactionId: gift.transactionId || '', blindGiftName: gift.blindGiftName || '', ...(gift.blindGiftPrice ? { blindGiftPrice: gift.blindGiftPrice } : {}), ...(gift.giftPrice ? { giftPrice: gift.giftPrice } : {}), ...(gift.giftFree ? { giftFree: true } : {}) });
  }
  // 读B站直播间的礼物面板，合并进礼物库并存盘（「刷新礼物库」和机器人查价格共用）。
  // 顺便记下面板里每个礼物的单价（金瓜子，银瓜子礼物算 0），机器人 10 分钟内直接用。
  async refreshBiliGifts(id) {
    const { data } = await this.api(`https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/giftConfig?platform=pc${id ? `&room_id=${id}` : ''}`);
    if (!Array.isArray(data.list) || !data.list.length) throw new Error('B站礼物列表为空，原礼物库已保留');
    const prices = new Map();
    for (const item of data.list) if (Number(item?.id)) prices.set(Number(item.id), item.coin_type === 'silver' ? 0 : Math.max(0, Number(item.price) || 0));
    (this.roomGiftPrices ??= new Map()).set(Number(id) || 0, { at: Date.now(), prices });
    const updatedAt = new Date().toISOString(), merged = mergeGifts(this.biliGifts || this.gifts, data.list, updatedAt);
    if (!merged.length) throw new Error('B站礼物格式异常，原礼物库已保留');
    const list = paidGifts(merged);
    await atomicJson(path.join(this.dataDir, 'gifts.json'), { updatedAt, list });
    this.biliGifts = list;
    if (this.platform === 'bilibili') { this.gifts = list; this.state.gifts.count = list.length; this.state.gifts.updatedAt = updatedAt; this.publish(); }
    return list;
  }
  // 机器人遇到礼物库里没有的礼物（新出的、限定的）：按当前直播间刷新一次礼物库再查单价，10 分钟内不重复刷新。查不到返回 null。
  // room 不填就是控制台连接的直播间；机器人的其他直播间会传自己的房间号。每个直播间分开缓存。
  async giftPriceOf(giftId, room = Number(this.state.live.roomId) || 0, platform = this.platform) {
    const id = Number(giftId);
    if (platform !== 'bilibili' || !id) return null;
    room = Number(room) || 0;
    const cache = this.roomGiftPrices?.get(room);
    if (!cache || Date.now() - cache.at > 600000) {
      this.roomGiftJobs ??= new Map();
      if (!this.roomGiftJobs.has(room)) this.roomGiftJobs.set(room, this.refreshBiliGifts(room).finally(() => this.roomGiftJobs.delete(room)));
      await this.roomGiftJobs.get(room);
    }
    const price = this.roomGiftPrices?.get(room)?.prices.get(id);
    if (price !== undefined) return price;
    return (this.biliGifts || this.gifts).find(g => g.id === id || g.alias_ids?.includes(id))?.price ?? null;
  }
  async syncGifts(input = '') {
    if (this.syncJob) return this.syncJob;
    this.syncJob = this.performGiftSync(input).finally(() => { this.syncJob = null; this.state.gifts.syncing = false; this.publish(); });
    return this.syncJob;
  }
  async performGiftSync(input) {
    if(this.platform==='douyin'){
      this.state.gifts.syncing=true;this.state.gifts.error='';this.publish();
      try{
        const {body}=await this.douyinRequest(GIFT_URL),data=JSON.parse(body);
        const list=normalizeGifts(data.data?.gifts);if(!list.length)throw new Error('抖音礼物列表为空，已保留原礼物库');
        const merged=normalizeGifts([...this.gifts,...list]),updatedAt=new Date().toISOString();
        await atomicJson(path.join(this.dataDir,'douyin-gifts.json'),{list:merged,updatedAt});
        this.gifts=this.dyGifts=merged;Object.assign(this.state.gifts,{count:merged.length,updatedAt});this.publish();return {count:merged.length,failed:0};
      }catch(error){this.state.gifts.error=error.message;throw error;}
    }
    const id = input ? roomId(input) : 0;
    this.state.gifts.syncing = true; this.state.gifts.error = ''; this.publish();
    try {
      const list = await this.refreshBiliGifts(id);
      await this.cleanGiftImages();
      let cursor = 0, failed = 0;
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (cursor < list.length) { const gift = list[cursor++]; if (!gift.icon) continue; try { await this.giftImage(gift.id); } catch { failed++; } }
      }));
      this.state.gifts.cached = list.filter(g => g.icon).length - failed;
      this.state.gifts.error = failed ? `${failed} 张图片暂未下载，打开时会重试` : '';
      return { count: list.length, failed };
    } catch (error) { this.state.gifts.error = error.message; throw error; }
  }
  imageName(gift) { return `${gift.platform==='douyin'?'dy-':''}${gift.id}-${createHash('sha256').update(gift.icon).digest('hex').slice(0, 16)}.png`; }
  async cleanGiftImages() {
    const bili = this.platform === 'douyin' ? this.biliGifts : this.gifts;
    const dir = path.resolve(this.dataDir, 'images'), keep = new Set([...bili, ...(this.dyGifts || [])].map(g => this.imageName(g)));
    for (const name of await fs.readdir(dir)) {
      // Douyin images are only cleaned once their catalog is loaded.
      if (!(/^\d+-[a-f0-9]{16}\.png$/.test(name) || this.dyGifts && /^dy-\d+-[a-f0-9]{16}\.png$/.test(name)) || keep.has(name)) continue;
      const file = path.resolve(dir, name);
      if (!file.startsWith(dir + path.sep)) throw new Error('礼物图片清理路径无效');
      await fs.unlink(file);
    }
  }
  async giftImage(id, platform=this.platform) {
    const list=platform==='douyin'?this.dyGifts:platform==='bilibili'?this.biliGifts||this.gifts:[];
    const gift = list.find(g => g.id === Number(id) || g.alias_ids?.includes(Number(id)));
    if (!gift || !(platform==='douyin'?douyinImage(gift.icon):imageUrl(gift.icon))) throw new Error('该礼物暂时没有图片');
    const name = this.imageName(gift);
    for (const directory of [this.dataDir, this.seedDir]) {
      try { return await fs.readFile(path.join(directory, 'images', name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!this.imageJobs.has(name)) this.imageJobs.set(name, (async () => {
      const { body, headers } = await (gift.platform==='douyin'?this.douyinRequest(gift.icon):this.request(gift.icon));
      const type = imageType(body);
      if (type !== 'image/png' && !(gift.platform === 'douyin' && type)) throw new Error('礼物图片格式无效');
      const file = path.join(this.dataDir, 'images', name), temp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, body); await fs.rename(temp, file); return body;
    })().finally(() => this.imageJobs.delete(name)));
    return this.imageJobs.get(name);
  }
  async importConfig(config) {
    if (config?.app !== 'xiaoluobo-console' || config.version !== 1 || typeof config.room !== 'string') throw new Error('这不是有效的小萝卜控制台配置');
    if(config.platform&&config.platform!==this.platform)throw new Error('请先切换到配置对应的平台，再导入');
    if (config.room) (this.platform==='douyin'?douyinRoom:roomId)(config.room);
    this.rooms[this.platform]=config.room;
    const next = { room: config.room,platform:this.platform,rooms:{...this.rooms} };
    await atomicJson(path.join(this.dataDir, 'config.json'), next); this.state.config = next; this.publish();
  }
  close() { this.disconnectLive(false); }
}

module.exports = { ConsoleServices, atomicJson, readJson, request };
