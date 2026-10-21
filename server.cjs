const http = require('node:http');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const QRCode = require('qrcode');
const { ConsoleServices } = require('./lib/services.cjs');
const { safeFace, createAvatarCache } = require('./lib/avatar.cjs');
const { imageType } = require('./lib/image-type.cjs');
const { servePublic } = require('./lib/static-files.cjs');
const {createImageRenderer,imageEdge}=require('./lib/render-images.cjs');
const { TemplateLibrary, MAX_PACKAGE_BYTES } = require('./lib/templates.cjs');
const { ObsIntegration } = require('./lib/obs.cjs');
const { HimeIntegration } = require('./lib/hime.cjs');
const { uploadMedia, serveMedia } = require('./lib/overtime-media.cjs');
const { createPlatformGames } = require('./lib/platform-games.cjs');
const { uploadAsset,serveAsset } = require('./lib/feeding-assets.cjs');
const { generatePanel } = require('./lib/game-panels.cjs');
const { WebSocketServer } = require('ws');
const {MODES:LOTTERY_MODES}=require('./lib/lottery.cjs');

// Overlay pages subscribe to one channel; everything else is a console page.
const CHANNELS = { bomb:new Set(['number-bomb']), lottery:new Set(['lottery']), feeding:new Set(['feeding','feeding-motion','feeding-physics']), overtime:new Set(['overtime','overtime-clock','overtime-media']), scene:new Set(['noodle','noodle-motion']) };
const MOTION = new Set(['noodle-motion','feeding-motion','feeding-physics']);
// High-frequency frames bypass the 100ms state coalescing.
const REALTIME = new Set([...MOTION,'overtime-clock','overtime-media']);
const accepts = (client, type, data) => client.channel ? CHANNELS[client.channel].has(type)&&(type!=='lottery'||client.lotteryGame===data.game) : !(client.consoleOnly && MOTION.has(type));
const BODY_LIMITS = { '/api/templates/import':MAX_PACKAGE_BYTES, '/api/diagnostics/client':32768, '/api/feeding/motion':300000 };
const CLIENT_EVENTS = ['runtime_error','promise_error','page_stall','resource_error','operation_error'];
const CLIENT_PAGES = ['/','/noodle/','/overtime/','/feeding/','/lottery/','/number-bomb/'];

async function startServer(options = {}) {
  const diagnostics=options.diagnostics;
  const services = await new ConsoleServices({ dataDir: path.join(__dirname, '.local-data'), seedDir: path.join(__dirname, 'data'), ...options }).init();
  services.state.version = require('./package.json').version;
  const templates=await new TemplateLibrary(services.dataDir).init();
  const images=createImageRenderer(error=>diagnostics?.log('warn','images.resize_failed',{error}));
  const games={};
  const common={dataDir:services.dataDir,seedDir:services.seedDir,templates,feedingLegacyFiles:options.feedingLegacyFiles||[]};
  games.bilibili=await createPlatformGames({...common,platform:'bilibili',catalog:services.biliGifts.length>=12?services.biliGifts:require('./data/gifts.json').list,legacyFiles:options.overtimeLegacyFiles||[]});
  games.douyin=await createPlatformGames({...common,platform:'douyin',catalog:services.dyGifts.length>=12?services.dyGifts:require('./data/douyin-gifts.json').list,source:games.bilibili.noodle});
  let {noodle,overtime,feeding,lottery,numberBomb}=games[services.platform];
  const lotteryFor=mode=>{const key=mode??'wheel';if(!LOTTERY_MODES.includes(key))throw new Error('抽奖玩法无效');return lottery[key];};
  const mediaListeners=new Set();
  let actions = Promise.resolve(), giftBatch, pendingGifts=0, liveStamp='';
  // Every state-changing operation runs in order; a failed step never blocks the next one.
  const enqueue = work => { const run = actions.then(work); actions = run.catch(() => {}); return run; };
  const avatars = createAvatarCache(services);
  const clients = new Set();
  const write = (res, frame) => {
    if (res.destroyed) { clients.delete(res); return; }
    // A stalled browser reconnects to the current scene instead of buffering an entire stream.
    if (res.writableLength > 1024 * 1024) { clients.delete(res); res.destroy(); return; }
    res.write(frame);
  };
  const frameOf = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const send = (res, type, data) => write(res, frameOf(type, data));
  const deliver = (type, data) => {
    if (!clients.size) return;
    const frame=frameOf(type, data);
    for (const client of clients) if (accepts(client, type, data)) write(client,frame);
  };
  // Overtime frames carry every viewer (about 1 MB for 5,000 viewers). Overlays never read the viewer list or
  // history, and the console's statistics refresh at most once a second, so a gift burst no longer pushes and
  // re-parses that list ten times a second in every window.
  const OVERTIME_PEOPLE_MS = 1000;
  let peopleSent = null, peopleSentAt = 0, peopleTimer = null;
  const overlayOvertime = state => ({...state, people:undefined, history:undefined});
  const deliverOvertime = state => {
    if (!clients.size) return;
    let overlay, consoleFrame, consoleHasPeople = false;
    for (const client of clients) {
      if (!accepts(client, 'overtime', state)) continue;
      if (client.channel) { write(client, overlay ??= frameOf('overtime', overlayOvertime(state))); continue; }
      if (!consoleFrame) {
        const now = Date.now(), changed = state.people !== peopleSent;
        consoleHasPeople = changed && (state.people.length <= 200 || now - peopleSentAt >= OVERTIME_PEOPLE_MS);
        if (consoleHasPeople) { peopleSent = state.people; peopleSentAt = now; }
        else if (changed && !peopleTimer) peopleTimer = setTimeout(() => { peopleTimer = null; broadcast('overtime'); }, OVERTIME_PEOPLE_MS - (now - peopleSentAt));
        // A frame without `people` keeps the list the console already has.
        consoleFrame = frameOf('overtime', consoleHasPeople ? state : {...state, people:undefined});
      }
      write(client, consoleFrame);
    }
  };
  const pendingStates = new Map(), pendingMessages = [];
  let broadcastTimer;
  const broadcast = (type, data) => {
    if (!clients.size) return;
    if (REALTIME.has(type)) return deliver(type, data);
    if (type === 'message') {
      pendingMessages.push(data);
      if (pendingMessages.length > 200) pendingMessages.shift();
    } else pendingStates.set(type==='lottery'?'lottery:'+data.game:type, data);
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      for (const [key, latest] of pendingStates){const kind=key.split(':')[0];if(kind==='overtime'){deliverOvertime(overtime.snapshot());continue;}deliver(kind, kind === 'noodle' ? noodle.snapshot() : kind === 'feeding' ? feeding.snapshot() : latest);}
      pendingStates.clear();
      if (pendingMessages.length) {
        const frame = pendingMessages.map(event => frameOf('message', event)).join('');
        for (const client of clients) if (!client.channel) write(client, frame);
        pendingMessages.length = 0;
      }
    }, 100);
  };
  services.on('state', state => {
    broadcast('state',state);
    if(diagnostics){
      const live={platform:services.platform,status:state.live.status,liveStatus:state.live.liveStatus,error:state.live.error};
      const stamp=JSON.stringify(live);
      if(stamp!==liveStamp){liveStamp=stamp;diagnostics.log(live.error?'warn':'info','live.state',live);}
    }
  });
  services.on('event', event => {
    if(event.type==='system')diagnostics?.log('warn','system.message',{message:event.text,platform:services.platform});
    if (event.uid && event.face) noodle.rememberFace(event);
    const chat=event.type==='chat';
    if (event.type !== 'gift' && !event.face && !chat) { broadcast('message', event); return; }
    if (event.type === 'gift') pendingGifts++;
    // Gifts, chat and avatar updates share one ordered batch. Queuing avatars and chat as separate steps
    // split a busy room's gifts into one batch (and one full save) per gift. Manual actions still close the batch.
    if (!giftBatch || giftBatch.tail !== actions || giftBatch.events.length >= 128) {
      const batch = {events:[],gifts:0,noodle,overtime,feeding,numberBomb,lotteries:Object.values(lottery)};
      const receive = actions.then(async () => {
        const started=performance.now();
        diagnostics?.context({operation:'gift.batch',batchSize:batch.gifts,pendingGifts});
        try {
        if (giftBatch === batch) giftBatch = null;
        const faceTargets=[...batch.lotteries,batch.numberBomb];
        // Number bomb and lottery never take gifts, so they replay avatars and chat in arrival order.
        for(const {event,face} of batch.events){
          if(event.face)for(const target of faceTargets)await target.rememberFace(event).catch(error=>services.addEvent('system','',`游戏头像：${error.message}`));
          if(event.type!=='chat')continue;
          await Promise.resolve().then(()=>batch.numberBomb.receiveChat({...event,face})).catch(error=>services.addEvent('system','',`数字炸弹：${error.message}`));
          await Promise.resolve().then(async()=>{for(const target of batch.lotteries)await target.receiveChat({...event,face});}).catch(error=>services.addEvent('system','',`抽奖：${error.message}`));
        }
        const events = batch.events.filter(item=>item.event.type==='gift').map(({event:gift}) => ({...gift,face:batch.noodle.faces.get(gift.uid) || gift.face}));
        const overtimeError = error => services.addEvent('system', '', `加班机：${error.message}`);
        if(events.length)await batch.overtime.receiveBatch(events,overtimeError).catch(overtimeError);
        // Feeding counts both gifts and chat, so only a chat that changes feeding splits its gift run.
        const feedingError=error=>services.addEvent('system','',`吃吃吃：${error.message}`);
        let run=[],index=0;
        for(const {event} of batch.events){
          if(event.type==='gift'){run.push(events[index++]);continue;}
          if(event.type!=='chat'||!batch.feeding.chatRules(event).length)continue;
          if(run.length){await batch.feeding.receiveBatch(run).catch(feedingError);run=[];}
          await Promise.resolve().then(()=>batch.feeding.receiveChat(event)).catch(feedingError);
        }
        if(run.length)await batch.feeding.receiveBatch(run).catch(feedingError);
        // Re-read avatars here: newer ones may arrive while the earlier stages save.
        for (const gift of events) await batch.noodle.receive({...gift,face:batch.noodle.faces.get(gift.uid) || gift.face},false).catch(error => services.addEvent('system','',error.message));
        await new Promise(resolve => setImmediate(resolve));
        } finally {
          pendingGifts-=batch.gifts;
          const elapsedMs=Math.round(performance.now()-started);
          if(elapsedMs>=1000)diagnostics?.log('warn','gift.slow_batch',{elapsedMs,count:batch.gifts,pendingGifts});
          diagnostics?.context({operation:null,pendingGifts});
        }
      });
      actions = receive.catch(error => services.emit('event', { type: 'system', text: error.message, time: Date.now() }));
      batch.tail = actions; giftBatch = batch;
    }
    giftBatch.events.push({event,face:chat?safeFace(event.face)||noodle.faces.get(event.uid)||noodle.faces.get(String(event.uid))||'':''});
    if (event.type === 'gift') giftBatch.gifts++;
    broadcast('message', event);
  });
  for(const [platform,game]of Object.entries(games)){
    const current=listener=>(...args)=>{if(services.platform===platform)listener(...args);};
    game.noodle.on('change',current(()=>broadcast('noodle')));
    game.noodle.on('motion',current(motion=>broadcast('noodle-motion',motion)));
    game.feeding.on('state',current(state=>broadcast('feeding',state)));
    game.numberBomb.on('state',current(state=>broadcast('number-bomb',state)));
    for(const target of Object.values(game.lottery))target.on('state',current(state=>broadcast('lottery',state)));
    game.feeding.on('motion',current(motion=>broadcast('feeding-motion',motion)));
    game.feeding.on('physics',current(frame=>broadcast('feeding-physics',frame)));
    game.overtime.on('state',current(state=>broadcast('overtime',state)));
    game.overtime.on('media',current(cue=>{broadcast('overtime-media',cue);for(const listener of mediaListeners)listener(cue);}));
  }
  let origin, obs, hime;
  const subscribe=(client,url)=>{
    client.channel=Object.keys(CHANNELS).find(key=>url.searchParams.has(key));client.consoleOnly=url.searchParams.has('console');clients.add(client);
    if(client.channel==='bomb')return send(client,'number-bomb',numberBomb.snapshot());
    if(client.channel==='feeding')return send(client,'feeding',feeding.snapshot());
    if(client.channel==='lottery'){
      const key=url.searchParams.get('game')||'wheel';
      if(!LOTTERY_MODES.includes(key)){client.destroy();clients.delete(client);return;}
      client.lotteryGame=key;return send(client,'lottery',lottery[key].snapshot());
    }
    if(client.channel==='overtime')return send(client,'overtime',overlayOvertime(overtime.snapshot()));
    const scene=client.channel==='scene';
    if(!scene)send(client,'state',services.state);
    send(client,'noodle',noodle.snapshot());
    if(!scene){send(client,'overtime',overtime.snapshot());send(client,'feeding',feeding.snapshot());send(client,'number-bomb',numberBomb.snapshot());for(const target of Object.values(lottery))send(client,'lottery',target.snapshot());}
    if(!client.consoleOnly)send(client,'noodle-motion',noodle.motionSnapshot());
  };
  const download=(res,filename,data)=>{res.setHeader('Content-Disposition',`attachment; filename=${filename}`);return data;};

  // POST handlers receive the parsed JSON body; `scoped` rejects work queued before a platform switch.
  const postRoutes = {
    '/api/diagnostics/client': input => {
      if(!diagnostics)return {ok:true};
      if(!Array.isArray(input.entries)||input.entries.length>10||input.entries.some(entry=>!entry||!CLIENT_EVENTS.includes(entry.event)||!CLIENT_PAGES.includes(entry.page)||typeof entry.message!=='string'||entry.message.length>2000||entry.stack!==undefined&&(typeof entry.stack!=='string'||entry.stack.length>6000)))throw new Error('诊断记录格式无效');
      for(const entry of input.entries)diagnostics.log(['page_stall','operation_error'].includes(entry.event)?'warn':'error','client.'+entry.event,{page:entry.page,message:entry.message,stack:entry.stack,delayMs:Number.isFinite(entry.delayMs)?entry.delayMs:undefined,action:typeof entry.action==='string'?entry.action.slice(0,100):undefined});
      return {ok:true};
    },
    '/api/diagnostics/open': async () => {
      if(!diagnostics||!options.openLogs)throw new Error('当前运行方式请按日志目录手动打开');
      await options.openLogs(diagnostics.logDir);return {ok:true};
    },
    '/api/platform': async input => {
      if(!['bilibili','douyin'].includes(input.platform))throw new Error('请选择B站或抖音');
      await enqueue(async()=>{
        if(input.platform===services.platform)return;
        services.disconnectLive(false);
        if(overtime.state.mode==='running')await overtime.action({action:'pause'});
        overtime.stopMedia();
        if(noodle.mode==='running'){noodle.mode='paused';noodle.publish();}
        if(feeding.state.mode==='running')await feeding.action({action:'pause'});
        for(const target of Object.values(lottery))await target.deactivate();
        await numberBomb.deactivate();
        await services.selectPlatform(input.platform);
        ({noodle,overtime,feeding,lottery,numberBomb}=games[input.platform]);
        pendingStates.clear();pendingMessages.length=0;avatars.clear();peopleSent=null;
        broadcast('state',services.state);broadcast('noodle',noodle.snapshot());broadcast('overtime',overtime.snapshot());broadcast('overtime-media',null);
        broadcast('feeding',feeding.snapshot());
        broadcast('number-bomb',numberBomb.snapshot());
        for(const target of Object.values(lottery))broadcast('lottery',target.snapshot());
      });
      return {ok:true};
    },
    '/api/login/douyin': async () => { await services.loginDouyin(); return {ok:true}; },
    '/api/login/qr': async () => ({ image: await QRCode.toDataURL(await services.loginQr(), { width: 256, margin: 2, color: { dark: '#243d54', light: '#ffffff' } }) }),
    '/api/login/poll': () => services.loginPoll(),
    '/api/feeding/motion': input => ({ok:true,accepted:feeding.motion(input)}),
    '/api/feeding/action': async (input,scoped) => ({ok:true,state:await enqueue(scoped(()=>feeding.action(input)))}),
    '/api/lottery/action': async (input,scoped) => ({ok:true,state:await enqueue(scoped(()=>lotteryFor(input.game).action(input)))}),
    '/api/number-bomb/action': async (input,scoped) => ({ok:true,state:await enqueue(scoped(()=>numberBomb.action(input)))}),
    '/api/panels/generate': async (input,scoped) => ({ok:true,panel:await enqueue(scoped(()=>generatePanel(input.game,{noodle,overtime,feeding})))}),
    '/api/overtime/action': async (input,scoped) => ({ok:true,state:await enqueue(scoped(()=>overtime.action(input)))}),
    '/api/noodle/motion': input => ({ok:true,accepted:noodle.motion(input)}),
    '/api/noodle/action': async (input,scoped) => ({ok:true,state:await enqueue(scoped(()=>noodle.action(input)))}),
    '/api/templates/import': async (input,scoped) => ({ok:true,...await enqueue(scoped(()=>noodle.installTemplate(input)))}),
    '/api/templates/delete': async (input,scoped) => ({ok:true,state:await enqueue(scoped(async()=>{
      const result=await noodle.deleteTemplate(input.id);
      for(const game of Object.values(games))if(game.noodle!==noodle){
        const other=game.noodle,remaining=other.presets.filter(p=>p.config.template_id!==input.id);
        if(remaining.length!==other.presets.length)await other.savePresets(remaining,remaining.some(p=>p.id===other.activePreset)?other.activePreset:remaining[0]?.id??null);
      }
      return result;
    }))}),
    '/api/hime/import': async input => ({ok:true,...await hime.run(input)}),
    '/api/obs/import': async input => ({ok:true,...await obs.run(input)}),
    '/api/obs/virtual-camera': async input => ({ok:true,...await obs.run(input,true)}),
    '/api/live/connect': async input => { await services.connectLive(input.room); return {ok:true}; },
    '/api/live/disconnect': () => { services.disconnectLive(); return {ok:true}; },
    '/api/gifts/sync': input => services.syncGifts(input.room || ''),
    '/api/config/import': async input => { await services.importConfig(input); return {ok:true}; },
    '/api/events/clear': () => { services.events = []; return {ok:true}; }
  };
  // GET handlers return a JSON body, or write the response themselves and return undefined.
  const getRoutes = {
    '/api/diagnostics/info': () => diagnostics?{...diagnostics.info(),canOpen:!!options.openLogs}:{enabled:false},
    '/api/diagnostics/export': async res => {
      if(!diagnostics){res.statusCode=503;return {error:'诊断日志未启用'};}
      await diagnostics.flush();
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename=xiaoluobo-diagnostics.log','Cache-Control':'no-store'});
      await pipeline(Readable.from(diagnostics.export()),res);
    },
    '/api/state': () => ({ state: services.state, events: services.events }),
    '/api/noodle/state': () => noodle.snapshot(),
    '/api/overtime/state': () => overtime.snapshot(),
    '/api/feeding/state': () => feeding.snapshot(),
    '/api/number-bomb/state': () => numberBomb.snapshot(),
    '/api/lottery/state': (_res,url) => lotteryFor(url.searchParams.get('game')||'wheel').snapshot(),
    '/api/lottery/export': (res,url) => {const target=lotteryFor(url.searchParams.get('game')||'wheel');return download(res,`xiaoluobo-${target.mode}-results.json`,target.state.history);},
    '/api/feeding/export': res => download(res,'xiaoluobo-feeding.json',feeding.state.config),
    '/api/overtime/export': res => download(res,'xiaoluobo-overtime.json',overtime.snapshot()),
    '/api/avatar': async (res,url) => {
      const face = safeFace(url.searchParams.get('url'));
      if (!face) { res.statusCode=400; return { error: '头像地址无效' }; }
      const {body,type} = await avatars.get(face);
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'public, max-age=600'});
      res.end(body);
    },
    '/api/templates': () => templates.list(),
    '/api/obs/status': () => obs.status(),
    '/api/hime/status': () => hime.status(),
    '/api/gifts': () => services.gifts,
    '/api/config/export': res => download(res,'xiaoluobo-config.json',{ app: 'xiaoluobo-console', version: 1, ...services.state.config }),
    '/api/gifts/export': res => download(res,`${services.platform}-gifts.json`,services.gifts.map(g => ({ ...g, imageFile: `images/${services.imageName(g)}` }))),
    '/api/events': (res,url,req) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      subscribe(res,url);
      req.on('close', () => clients.delete(res));
    }
  };
  // Pattern routes for files addressed by id; captures are passed after `res`.
  const getPatterns = [
    [/^\/api\/overtime\/media\/([a-f0-9]{64}\.(?:png|jpg|gif|webp|mp4|webm))$/, (res,req,name) => serveMedia(req,res,games[services.platform].dir,name)],
    [/^\/api\/feeding\/assets\/([a-f0-9]{64}\.(?:png|jpg|gif|webp|bmp|wav|mp3|ogg|m4a))$/, (res,req,name) => serveAsset(res,games[services.platform].dir,name)],
    [/^\/api\/feeding\/thumb\/([a-f0-9]{64}\.png)$/, async(res,req,name)=>{
      const dir=path.join(games[services.platform].dir,'feeding-assets'),body=await images.get(path.join(dir,name),128,path.join(dir,'.render'));
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'});res.end(body);
    }],
    [/^\/api\/templates\/(t-[a-f0-9]{32})\/(assets|render|thumb)\/([a-z_]+)\.png$/, async (res,req,id,kind,name) => {
      const body=kind==='assets'?await templates.asset(id,name):await images.get(templates.assetFile(id,name),kind==='thumb'?128:imageEdge(name),path.join(templates.dir,id,'.render'));
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'});res.end(body);
    }],
    [/^\/api\/templates\/(saozi|t-[a-f0-9]{32})\/export$/, async (res,req,id) => download(res,`xiaoluobo-${id}.luobo`,await templates.export(id))],
    [/^\/api\/gifts\/(\d+)\/image$/, async (res,req,id,url) => {
      const body = await services.giftImage(id,url.searchParams.get('platform')||services.platform);
      const type=imageType(body)||'image/png';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename=${services.platform}-gift-${id}.${type.split('/')[1]}` } : {}) });
      res.end(body);
    }]
  ];

  const server = http.createServer(async (req, res) => {
    const requestStarted=performance.now();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://*.hdslb.com https://hdslb.com https://*.biliimg.com https://biliimg.com https://*.douyinpic.com https://*.byteimg.com; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (data, status = res.statusCode) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    // Host and Origin must both be this console, which blocks DNS rebinding and cross-site requests.
    if (`http://${req.headers.host}` !== origin || (req.headers.origin && req.headers.origin !== origin)) return json({ error: '仅允许本机控制台访问' }, 403);
    try {
      const url = new URL(req.url, origin);
      res.once('finish',()=>{const elapsedMs=Math.round(performance.now()-requestStarted);if(elapsedMs>=1500)diagnostics?.log('warn','http.slow',{method:req.method,path:url.pathname,status:res.statusCode,elapsedMs,pendingGifts});});
      if (req.method === 'POST') {
        if(url.pathname!=='/api/platform'&&req.headers['x-luobo-platform']&&req.headers['x-luobo-platform']!==services.platform)return json({error:'平台已切换，请刷新页面后重试'},409);
        const contentType=req.headers['content-type']?.split(';')[0];
        if(url.pathname==='/api/feeding/assets'){
          if(contentType!=='application/octet-stream')return json({error:'素材上传格式无效'},415);
          return json(await uploadAsset(req,games[services.platform].dir));
        }
        if (url.pathname === '/api/overtime/media') {
          if (contentType !== 'application/octet-stream') return json({error:'素材上传格式无效'},415);
          return json(await uploadMedia(req,games[services.platform].dir,url.searchParams.get('name') || ''));
        }
        if (contentType !== 'application/json') return json({ error: '请求格式无效' }, 415);
        const handler=Object.hasOwn(postRoutes,url.pathname)?postRoutes[url.pathname]:null;
        if (!handler) return json({ error: '接口不存在' }, 404);
        const chunks=[],limit=BODY_LIMITS[url.pathname]||100000;let bytes=0;
        for await (const chunk of req) { bytes+=chunk.length;if(bytes>limit)return json({error:'文件过大'},413);chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if(url.pathname!=='/api/diagnostics/client')diagnostics?.context({lastRequest:{path:url.pathname,action:typeof input.action==='string'?input.action.slice(0,80):undefined,time:new Date().toISOString()}});
        const requestPlatform=services.platform;
        const scoped=work=>async()=>{if(requestPlatform!==services.platform)throw new Error('平台已切换，请刷新页面后重试');return work();};
        return json(await handler(input,scoped));
      }
      if (req.method !== 'GET') return json({ error: '请求方式无效' }, 405);
      if (Object.hasOwn(getRoutes, url.pathname)) {
        const body = await getRoutes[url.pathname](res,url,req);
        if (body !== undefined) json(body);
        return;
      }
      for (const [pattern, handler] of getPatterns) {
        const match = url.pathname.match(pattern);
        if (!match) continue;
        const body = await handler(res,req,...match.slice(1),url);
        if (body !== undefined) json(body);
        return;
      }
      if (!await servePublic(res, path.join(__dirname, 'public'), url.pathname,images,path.join(services.dataDir,'render-cache'))) return json({ error: '页面不存在' }, 404);
    } catch (error) { diagnostics?.log('error','http.error',{method:req.method,path:req.url?.split('?')[0],error});if (!res.headersSent) json({ error: error.message }, error.status || 400); else res.end(); }
  });
  const sockets=new WebSocketServer({noServer:true,maxPayload:1024});
  server.on('upgrade',(req,socket,head)=>{
    if(`http://${req.headers.host}`!==origin||req.headers.origin!==origin||req.url?.split('?')[0]!=='/api/events/socket'){socket.destroy();return;}
    sockets.handleUpgrade(req,socket,head,ws=>{
      const client={get destroyed(){return ws.readyState!==1;},get writableLength(){return ws.bufferedAmount;},write(frame){if(ws.readyState===1)ws.send(frame);},destroy(){ws.terminate();},end(){ws.terminate();}};
      ws.on('close',()=>clients.delete(client));ws.on('error',()=>{clients.delete(client);ws.terminate();});subscribe(client,new URL(req.url,origin));
    });
  });
  try{
    await new Promise((resolve,reject)=>{const failed=error=>reject(error);server.once('error',failed);server.listen(options.port??0,'127.0.0.1',()=>{server.removeListener('error',failed);resolve();});});
  }catch(error){
    diagnostics?.log('error','server.bind_failed',{host:'127.0.0.1',port:options.port??0,error});services.close();
    if(error.code==='EADDRINUSE')error.message=`本地端口 ${options.port} 已被其他程序占用，请退出重复启动的控制台或调整占用该端口的软件。`;
    throw error;
  }
  origin = `http://127.0.0.1:${server.address().port}`;
  obs = new ObsIntegration(origin, options.obsOptions);
  hime = new HimeIntegration(origin, options.himeOptions);
  diagnostics?.log('info','server.listening',{origin});
  diagnostics?.sample(()=>({platform:services.platform,liveStatus:services.state.live.status,douyin:services.platform==='douyin'?services.douyinStats:undefined,pendingGifts,clients:clients.size,customers:noodle.queue.length,objects:noodle.objects.length,people:overtime.state.people.length,mediaBatches:overtime.mediaQueue.length}));
  const keepAlive = setInterval(() => { for (const client of clients) write(client,': heartbeat\n\n'); }, 15000);
  let lotteryPending=false;
  const lotteryTimer=setInterval(()=>{
    if(lotteryPending||!Object.values(lottery).some(target=>['running','tearing'].includes(target.state.round?.status)))return;
    lotteryPending=true;
    const targets=Object.values(lottery);
    enqueue(async()=>{for(const target of targets)await target.tick();}).catch(error=>services.addEvent('system','',`抽奖：${error.message}`)).finally(()=>{lotteryPending=false;});
  },250);
  let physicsPending=false;
  // Physics only waits on feeding's own queue, so slow gift batches no longer freeze falling food.
  const physicsTimer=setInterval(()=>{
    if(physicsPending||!feeding.awake&&!feeding.consumerTrail.length)return;
    physicsPending=true;
    feeding.tick().catch(error=>services.addEvent('system','',`吃吃吃：${error.message}`)).finally(()=>{physicsPending=false;});
  },1000/30);
  const cleanupTimer = setInterval(() => { avatars.prune(); noodle.cleanup(); }, 30000);
  let releasePending = false;
  const sealTimer = setInterval(() => {
    if (releasePending || !Object.values(noodle.shopStatuses).some(s => s.sealed && s.sealed_until <= Date.now())) return;
    releasePending = true;
    enqueue(() => noodle.releaseExpired()).catch(error => services.emit('event', { type: 'system', text: error.message, time: Date.now() })).finally(() => { releasePending = false; });
  }, 1000);
  const overtimeTimer = setInterval(() => {
    overtime.stopInactiveMedia();
    const state = overtime.snapshot();
    broadcast('overtime-clock', { remaining:state.remaining, mode:state.mode, now:state.now });
  }, 1000);
  let checkpointPending = false;
  const checkpointTimer = setInterval(() => {
    if (checkpointPending || overtime.state.mode !== 'running') return;
    checkpointPending = true;
    enqueue(() => overtime.checkpoint()).catch(error => services.addEvent('system', '', `加班机保存失败：${error.message}`)).finally(() => { checkpointPending = false; });
  }, 15000);
  const close = async () => {
    for (const timer of [lotteryTimer, physicsTimer, keepAlive, sealTimer, cleanupTimer, overtimeTimer, checkpointTimer]) clearInterval(timer);
    services.close(); await actions;
    for(const game of Object.values(games)){game.overtime.close();await game.overtime.checkpoint();await game.feeding.close();await game.numberBomb.close();for(const target of Object.values(game.lottery))await target.close();}
    await services.flush();
    mediaListeners.clear();clearTimeout(broadcastTimer);clearTimeout(peopleTimer); pendingStates.clear(); pendingMessages.length = 0; avatars.clear();
    for (const client of clients) client.end();
    const stopped = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await stopped;
    await images.close();
  };
  return { url: origin, services, get noodle(){return noodle;},get overtime(){return overtime;},get feeding(){return feeding;},get lottery(){return lottery;},get numberBomb(){return numberBomb;},onOvertimeMedia(listener){mediaListeners.add(listener);}, close };
}

if (require.main === module) {
  const diagnostics=require('./lib/diagnostics.cjs').createDiagnostics(path.join(__dirname,'.local-data'));
  startServer({port:3180,diagnostics}).then(runtime=>{
    console.log(`小萝卜游戏控制台 ${runtime.url}`);
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;await runtime.close();await diagnostics.close();process.exit(0);};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }).catch(async error=>{diagnostics.log('error','startup.failed',{error});console.error(error.message);await diagnostics.close();process.exitCode=1;});
}
module.exports = { startServer };
