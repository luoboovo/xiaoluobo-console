const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {Readable} = require('node:stream');
const {uploadMedia,normalizeMedia,MAX_MEDIA_BYTES} = require('../lib/overtime-media.cjs');
const {OvertimeMachine,normalizeConfig} = require('../lib/overtime.cjs');
const {keyPixels} = require('../public/overtime/green-screen.js');
const {startServer} = require('../server.cjs');
const http = require('node:http');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9Z0AAAAASUVORK5CYII=','base64');
const config = {initial_text:'60',time_unit:'分钟',clear_lock_default_unlocked:true,gift_rules:[]};
async function directory(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-media-'));
  t.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-media-'));await fs.rm(dir,{recursive:true,force:true});});
  return dir;
}
test('本地素材上传：字节保存、重复内容去重、类型与路径校验、超限和失败清理',async t=>{
  const dir=await directory(t);
  const media=await uploadMedia(Readable.from([png.subarray(0,3),png.subarray(3)]),dir,'小萝卜.png');
  assert.match(media.asset,/^[a-f0-9]{64}\.png$/);assert.equal(media.kind,'image');assert.deepEqual(await fs.readFile(path.join(dir,'overtime-media',media.asset)),png);
  assert.equal((await uploadMedia(Readable.from([png]),dir,'第二次.png')).asset,media.asset);
  await assert.rejects(uploadMedia(Readable.from([Buffer.from('<svg onload=alert(1)>')]),dir,'wrong.png'),/请选择/);
  const huge=Readable.from([png]);huge.headers={'content-length':String(MAX_MEDIA_BYTES+1)};await assert.rejects(uploadMedia(huge,dir,'large.mp4'),/200MB/);
  const broken=Readable.from((async function*(){yield png;throw new Error('连接中断');})());await assert.rejects(uploadMedia(broken,dir,'broken.png'),/连接中断/);
  assert.deepEqual(await fs.readdir(path.join(dir,'overtime-media')),[media.asset]);
  for(const bad of [{asset:'../../credentials.bin',name:'x'}, {asset:media.asset,name:'',duration:5}, {asset:media.asset,name:'x',duration:Infinity}]) assert.throws(()=>normalizeMedia(bad));
  assert.throws(()=>normalizeConfig({...config,gift_rules:[{gift_name:'花',gift_id:1,operation:'media',value:1}]}),/选择图片或视频/);
});
test('绿幕抠像：绿色透明，红色/肤色/黑色保留，边缘柔化与去绿溢色',()=>{
  const pixels=new Uint8ClampedArray([0,255,0,255, 255,0,0,255, 235,170,120,255, 0,0,0,255, 80,112,80,255]);
  keyPixels(pixels);
  assert.equal(pixels[3],0);assert.deepEqual(Array.from(pixels.slice(4,16)),[255,0,0,255,235,170,120,255,0,0,0,255]);
  assert.ok(pixels[19]>0 && pixels[19]<255);assert.ok(pixels[17]<112);
});
test('礼物触发图片与视频：每件播放、计时共存、去重、先后顺序、重置停止与存档不重播',async t=>{
  const dir=await directory(t), uploaded=await uploadMedia(Readable.from([png]),dir,'测试.png');
  const machine=await new OvertimeMachine(dir,{clock:()=>0}).init();t.after(()=>machine.close());
  const media=normalizeMedia({...uploaded,duration:0.1});
  const rule={gift_name:'触发礼物',gift_id:1,operation:'add',value:30,media};
  await machine.action({action:'configure',config:{...config,gift_rules:[rule,{...rule,gift_name:'第二种礼物',gift_id:2,operation:'media',media:{...media,name:'第二张图片'}}]}});await machine.action({action:'start'});
  const cues=[];machine.on('media',cue=>{if(cue)cues.push(cue);});
  const event={type:'gift',giftId:1,giftName:'触发礼物',user:'观众',uid:1,count:3,transactionId:'same'};
  await machine.receive(event);assert.equal(machine.remaining(),9000n);assert.equal(machine.state.people[0].added,'5400');assert.equal(cues.length,1);
  assert.equal(machine.mediaQueue[0].count,2n);
  await machine.receive(event);assert.equal(cues.length,1);assert.equal(machine.mediaQueue[0].count,2n);
  await machine.receive({...event,giftId:2,transactionId:'second',count:2});assert.equal(machine.mediaQueue.length,2);
  await new Promise(resolve=>setTimeout(resolve,560));assert.equal(cues.length,5);assert.equal(machine.mediaCue,null);
  assert.deepEqual(cues.map(cue=>cue.name),['测试.png','测试.png','测试.png','第二张图片','第二张图片']);assert.equal(new Set(cues.map(cue=>cue.id)).size,5);
  await machine.action({action:'configure',config:{...config,gift_rules:[{...rule,operation:'media'}]}});
  const before=machine.remaining();await machine.receive({...event,transactionId:'only-media'});assert.equal(machine.remaining(),before);assert.equal(machine.state.people.length,1);
  assert.equal(machine.snapshot().media_cue.asset,uploaded.asset);
  await machine.action({action:'reset'});assert.equal(machine.mediaCue,null);assert.equal(machine.mediaQueue.length,0);
  const reload=await new OvertimeMachine(dir).init();t.after(()=>reload.close());assert.equal(reload.mediaCue,null);assert.equal(reload.state.config.gift_rules[0].media.asset,uploaded.asset);
  const old=structuredClone(machine.state.config);await assert.rejects(machine.action({action:'configure',config:{...config,gift_rules:[{...rule,media:{...media,asset:'f'.repeat(64)+'.png'}}]}}),/找不到素材/);assert.deepEqual(machine.state.config,old);
});

test('连送超过20件全部播放，大额数量只累计次数，不分配每件对象',async t=>{
  const dir=await directory(t),uploaded=await uploadMedia(Readable.from([png]),dir,'连送.png');
  const machine=await new OvertimeMachine(dir).init();t.after(()=>machine.close());
  await machine.action({action:'configure',config:{...config,gift_rules:[{gift_name:'连送礼物',gift_id:1,operation:'media',value:1,media:{...uploaded,duration:0.1}}]}});await machine.action({action:'start'});
  const cues=[];machine.on('media',cue=>{if(cue)cues.push(cue);});
  await machine.receive({type:'gift',giftId:1,user:'观众',count:25,transactionId:'twenty-five'});
  assert.equal(machine.mediaQueue.length,1);assert.equal(machine.mediaQueue[0].count,24n);
  for(let i=0;i<400 && (machine.mediaCue || machine.mediaQueue.length);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(cues.length,25);assert.equal(machine.mediaCue,null);assert.equal(machine.mediaQueue.length,0);
  for(const transactionId of ['large-a','large-b'])await machine.receive({type:'gift',giftId:1,user:'观众',count:Number.MAX_SAFE_INTEGER,transactionId});
  assert.equal(machine.mediaQueue.length,1);assert.equal(machine.mediaQueue[0].count,2n*BigInt(Number.MAX_SAFE_INTEGER)-1n);
  await machine.action({action:'stop_media'});assert.equal(machine.mediaQueue.length,0);
});

test('素材音量：旧配置默认100%、范围校验、播放中更新不重播、队列同步与重启保存',async t=>{
  const dir=await directory(t),uploaded=await uploadMedia(Readable.from([png]),dir,'音量.png');
  let now=0;const machine=await new OvertimeMachine(dir,{clock:()=>now}).init();t.after(()=>machine.close());assert.equal(machine.state.config.media_volume,100);
  for(const volume of [-1,101,1.5,'40',false])assert.throws(()=>normalizeConfig({...config,media_volume:volume}),/音量/);
  await machine.action({action:'configure',config:{...config,media_volume:40,gift_rules:[{gift_name:'音量礼物',gift_id:1,operation:'media',value:1,media:{...uploaded,duration:0.1}}]}});await machine.action({action:'start'});
  const cues=[];machine.on('media',cue=>{if(cue)cues.push(cue);});
  await machine.receive({type:'gift',giftId:1,user:'观众',count:3});const id=machine.mediaCue.id;assert.equal(cues[0].volume,40);
  await machine.action({action:'volume',volume:25});assert.equal(machine.mediaCue.id,id);assert.equal(cues.length,1);assert.equal(machine.snapshot().media_cue.volume,25);
  await new Promise(resolve=>setTimeout(resolve,330));assert.equal(cues.length,3);assert.equal(cues[1].volume,25);assert.equal(cues[2].volume,25);
  for(const volume of [-1,101,1.5,'40',false,null,undefined])await assert.rejects(machine.action({action:'volume',volume}),/音量/);
  assert.equal(machine.state.config.media_volume,25);
  const reload=await new OvertimeMachine(dir).init();t.after(()=>reload.close());assert.equal(reload.state.config.media_volume,25);
  now=600;await machine.action({action:'volume',volume:40});now=1200;await machine.action({action:'volume',volume:25});
  assert.equal(machine.remaining(),3599n,'连续调音量不能重置秒内进度并拖慢倒计时');assert.equal(JSON.parse(await fs.readFile(path.join(dir,'overtime.json'),'utf8')).remaining,'3599');
  await machine.action({action:'volume',volume:0});await machine.action({action:'reset'});assert.equal(machine.state.config.media_volume,0);
  await machine.action({action:'volume',volume:100});assert.equal(machine.state.config.media_volume,100);
});
test('素材HTTP：本机上传、视频字节范围、内容类型、无效范围、跨来源保护及礼物推送',async t=>{
  const dir=await directory(t),runtime=await startServer({dataDir:dir});
  try {
    const url=runtime.url,upload=await fetch(url+'/api/overtime/media?name=photo.png',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:png});
    assert.equal(upload.status,200);const media=await upload.json(),asset=url+'/api/overtime/media/'+media.asset;
    const whole=await fetch(asset);assert.equal(whole.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await whole.arrayBuffer()),png);
    const range=await fetch(asset,{headers:{Range:'bytes=4-10'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),`bytes 4-10/${png.length}`);assert.deepEqual(Buffer.from(await range.arrayBuffer()),png.subarray(4,11));
    const tail=await fetch(asset,{headers:{Range:'bytes=-5'}});assert.equal(tail.status,206);assert.deepEqual(Buffer.from(await tail.arrayBuffer()),png.subarray(-5));
    for(const range of ['bytes=1000-','bytes=10-4','bytes=0-2,4-6','bytes=-0']) assert.equal((await fetch(asset,{headers:{Range:range}})).status,416);
    assert.equal((await fetch(url+'/api/overtime/media?name=no.png',{method:'POST',headers:{'Content-Type':'application/octet-stream',Origin:'https://evil.example'},body:png})).status,403);
    const post=async input=>{const response=await fetch(url+'/api/overtime/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
    await post({action:'configure',config:{...config,gift_rules:[{gift_name:'礼物',gift_id:1,operation:'media',value:1,media:{...media,duration:1}}]}});await post({action:'start'});
    const abort=new AbortController(),response=await fetch(url+'/api/events?overtime=1',{signal:abort.signal}),reader=response.body.getReader();await reader.read();
    runtime.services.addGift({giftId:1,giftName:'礼物',uid:1,user:'送礼人',count:10,transactionId:'http-media'});
    const frame=new TextDecoder().decode((await reader.read()).value);assert.match(frame,/event: overtime-media/);assert.match(frame,new RegExp(media.asset));abort.abort();
    assert.equal(runtime.overtime.state.people.length,0);await post({action:'stop_media'});assert.equal(runtime.overtime.mediaCue,null);
    const cues=[];runtime.onOvertimeMedia(cue=>{if(cue)cues.push(cue);});
    await post({action:'pause'});
    runtime.services.addGift({giftId:1,giftName:'礼物',uid:1,user:'送礼人',count:10,transactionId:'http-paused'});
    for(let i=0;i<100&&runtime.overtime.state.history.length<2;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(runtime.overtime.state.history.length,2);assert.equal(runtime.overtime.mediaCue,null);assert.deepEqual(runtime.overtime.mediaQueue,[]);assert.deepEqual(cues,[],'桌面浮窗监听器没有收到播放事件');
    assert.match(runtime.overtime.state.history[0].effect,/未播放素材/);
    await post({action:'start'});assert.equal(runtime.overtime.mediaCue,null,'继续加班不补播暂停期间的礼物');
    for(const file of ['/overtime/green-screen.js','/overtime/media-player.js'])assert.equal((await fetch(url+file)).status,200);
  } finally {await runtime.close();}
});

test('程序退出：保存加班状态后断开未完成的素材连接，不等待播放器释放连接',async t=>{
  const dir=await directory(t),runtime=await startServer({dataDir:dir});
  await runtime.overtime.action({action:'start'});await runtime.overtime.action({action:'pause'});
  const request=http.request(runtime.url+'/api/overtime/media?name=partial.webm',{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':'1000'}});
  request.on('error',()=>{});request.write(Buffer.from([26,69,223,163]));
  let stopped, timer;
  try {
    for(let i=0;i<100;i++){if((await fs.readdir(path.join(dir,'overtime-media')).catch(()=>[])).some(file=>file.endsWith('.tmp')))break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.ok((await fs.readdir(path.join(dir,'overtime-media'))).some(file=>file.endsWith('.tmp')));
    stopped=runtime.close();
    assert.equal(await Promise.race([stopped.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1000);})]),true);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'overtime.json'),'utf8')).mode,'paused');
  } finally {clearTimeout(timer);request.destroy();await (stopped || runtime.close());}
});

test('未开机和暂停时礼物不播放，暂停立即清空特效，恢复只播放新礼物，手动预览仍可使用',async t=>{
  const dir=await directory(t),uploaded=await uploadMedia(Readable.from([png]),dir,'开关.png');
  const machine=await new OvertimeMachine(dir,{clock:()=>0}).init();t.after(()=>machine.close());
  const media={...uploaded,duration:10},rule={gift_name:'开关礼物',gift_id:1,operation:'add',value:1,media};
  await machine.action({action:'configure',config:{...config,gift_rules:[rule]}});
  const cues=[];machine.on('media',cue=>{if(cue)cues.push(cue);});
  const event={type:'gift',giftId:1,user:'观众',uid:1,count:3,transactionId:'idle'};
  await machine.receive(event);assert.equal(machine.mediaCue,null);assert.equal(cues.length,0);assert.equal(machine.remaining(),3600n);
  await machine.action({action:'preview_media',media});assert.equal(machine.mediaCue.preview,true);machine.stopInactiveMedia();assert.ok(machine.mediaCue);
  await machine.action({action:'stop_media'});await machine.action({action:'start'});
  await machine.receive({...event,transactionId:'running'});assert.equal(machine.mediaQueue[0].count,2n);assert.equal(cues.length,2);
  await machine.action({action:'pause'});assert.equal(machine.mediaCue,null);assert.deepEqual(machine.mediaQueue,[]);
  await machine.receive({...event,transactionId:'paused'});await machine.receive({...event,transactionId:'paused'});
  assert.equal(machine.remaining(),3960n,'暂停期间仍结算礼物，交易去重保留');assert.equal(cues.length,2);assert.deepEqual(machine.mediaQueue,[]);
  await machine.action({action:'start'});assert.equal(machine.mediaCue,null);assert.deepEqual(machine.mediaQueue,[]);
  await machine.receive({...event,count:1,transactionId:'new'});assert.equal(cues.length,3);assert.equal(machine.mediaCue.preview,false);
  await machine.action({action:'clear'});assert.equal(machine.mediaCue,null);assert.deepEqual(machine.mediaQueue,[]);
});

test('自然下班停止播放并丢弃队列；礼物清空时间也不播放，暂停保存失败保留原状态',async t=>{
  const dir=await directory(t),uploaded=await uploadMedia(Readable.from([png]),dir,'下班.png');let now=0;
  const machine=await new OvertimeMachine(dir,{clock:()=>now}).init();t.after(()=>machine.close());
  const media={...uploaded,duration:120};
  await machine.action({action:'configure',config:{...config,initial_text:'1',gift_rules:[{gift_name:'播放',gift_id:1,operation:'media',value:1,media},{gift_name:'清空',gift_id:2,operation:'clear',value:1,media}]}});
  await machine.action({action:'reset'});await machine.action({action:'start'});await machine.receive({type:'gift',giftId:1,count:4,user:'观众'});
  const cue=machine.mediaCue,original=machine.file;machine.file=path.join(dir,'blocked');await fs.mkdir(machine.file);
  await assert.rejects(machine.action({action:'pause'}));assert.equal(machine.state.mode,'running');assert.equal(machine.mediaCue,cue);assert.equal(machine.mediaQueue[0].count,3n);
  machine.file=original;now=60001;machine.stopInactiveMedia();assert.equal(machine.snapshot().mode,'finished');assert.equal(machine.mediaCue,null);assert.deepEqual(machine.mediaQueue,[]);
  await machine.action({action:'start'});await machine.receiveBatch([{type:'gift',giftId:1,count:1,user:'观众'},{type:'gift',giftId:2,count:1,user:'观众'}]);
  assert.equal(machine.remaining(),0n);assert.equal(machine.mediaCue,null);assert.deepEqual(machine.mediaQueue,[]);
});
