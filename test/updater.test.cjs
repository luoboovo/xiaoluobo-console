const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Updater,verifyManifest,signManifest,compareVersions,UPDATE_BASE_URL}=require('../lib/updater.cjs');
const {installScript}=require('../lib/update-install.cjs');
const {cosHttpString,cosAuthorization,notesFromReadme}=require('../scripts/publish-update.cjs');
const {UPDATE_PUBLIC_KEY}=require('../lib/update-key.cjs');
const {startServer}=require('../server.cjs');

const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const PUBLIC=publicKey.export({type:'spki',format:'der'}).toString('base64');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const UPDATE=Buffer.from('fake-update-installer'),SETUP=Buffer.alloc(5000,7);
function manifest(over={}){
  return {app:'xiaoluobo-console',version:'3.7.1',date:'2026-11-21T00:00:00Z',notes:'修了一些问题\n- 第二行',
    setup:{key:'releases/3.7.1/setup.exe',sha256:sha(SETUP),size:SETUP.length},
    update:{key:'releases/3.7.1/update.exe',sha256:sha(UPDATE),size:UPDATE.length,from:['3.6.7','3.7.0']},...over};
}
// 假的 COS：按路径返回清单和文件，记下请求过的地址。
function fakeFetch(files){
  const requested=[];
  const impl=async(url)=>{
    requested.push(url);const key=new URL(url).pathname.slice(1);
    if(!(key in files))return new Response('not found',{status:404});
    const body=files[key];if(body instanceof Error)throw body;
    return new Response(body,{status:200});
  };
  impl.requested=requested;return impl;
}
async function fixture(t,{current='3.7.0',files,launch=async()=>{}}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-update-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const fetchImpl=fakeFetch(files);
  const updater=new Updater({currentVersion:current,publicKey:PUBLIC,downloadDir:dir,launch,fetchImpl,baseUrl:UPDATE_BASE_URL});
  return {updater,dir,fetchImpl};
}
const latest=(m=manifest())=>JSON.stringify(signManifest(m,privateKey));

test('版本比较',()=>{
  assert.ok(compareVersions('3.7.1','3.7.0')>0);assert.ok(compareVersions('3.10.0','3.9.9')>0);assert.equal(compareVersions('3.7.0','3.7.0'),0);assert.ok(compareVersions('2.9.9','3.0.0')<0);
});
test('清单验签：篡改、换公钥、外部地址和格式错误都拒绝',()=>{
  const document=signManifest(manifest(),privateKey);
  assert.equal(verifyManifest(document,PUBLIC).version,'3.7.1');
  assert.throws(()=>verifyManifest({...document,payload:document.payload.replace('3.7.1','3.7.2')},PUBLIC),/签名/);
  assert.throws(()=>verifyManifest(document,UPDATE_PUBLIC_KEY),/签名/);
  assert.throws(()=>verifyManifest({payload:document.payload},PUBLIC),/格式/);
  const bad=over=>()=>verifyManifest(signManifest(manifest(over),privateKey),PUBLIC);
  assert.throws(bad({setup:{...manifest().setup,key:'https://evil.example/x.exe'}}),/下载地址/);
  assert.throws(bad({setup:{...manifest().setup,key:'releases/3.7.1/../../x.exe'}}),/下载地址/);
  assert.throws(bad({setup:{...manifest().setup,key:'releases/3.7.0/setup.exe'}}),/下载地址/);
  assert.throws(bad({update:{...manifest().update,key:'releases/3.7.1/setup.exe'}}),/下载地址/);
  assert.throws(bad({setup:{...manifest().setup,sha256:'xyz'}}),/校验码/);
  assert.throws(bad({setup:{...manifest().setup,size:500*1024*1024}}),/大小/);
  assert.throws(bad({app:'other'}),/内容无效/);
  assert.throws(bad({version:'3.7'}),/内容无效/);
  assert.throws(bad({update:{...manifest().update,from:['abc']}}),/可升级版本/);
  assert.equal(verifyManifest(signManifest(manifest({update:null}),privateKey),PUBLIC).update,null);
});
test('有新版本时：能直接升级的用更新包，下载校验后交给安装',async t=>{
  const launched=[];
  const {updater,fetchImpl}=await fixture(t,{files:{'latest.json':latest(),'releases/3.7.1/update.exe':UPDATE,'releases/3.7.1/setup.exe':SETUP},launch:async(file,kind)=>launched.push([file,kind,await fs.readFile(file)])});
  const states=[];updater.on('state',s=>states.push(s.status));
  const state=await updater.check();
  assert.equal(state.status,'available');assert.equal(state.latest.version,'3.7.1');assert.equal(state.latest.kind,'update');assert.equal(state.latest.size,UPDATE.length);assert.match(state.latest.notes,/第二行/);
  assert.match(fetchImpl.requested[0],/^https:\/\/xiaoluobo-update-1300851355\.cos\.ap-shanghai\.myqcloud\.com\/latest\.json\?t=\d+$/);
  const done=await updater.install();
  assert.equal(done.status,'installing');assert.equal(launched.length,1);assert.equal(launched[0][1],'update');assert.deepEqual(launched[0][2],UPDATE);
  assert.match(path.basename(launched[0][0]),/v3\.7\.1-更新包\.exe$/);
  assert.deepEqual(states.filter((s,i)=>s!==states[i-1]),['checking','available','downloading','installing']);
  // 已经下好的同一个文件不再重复下载
  updater.state.status='available';await updater.install();assert.equal(fetchImpl.requested.filter(u=>u.includes('update.exe')).length,1);
});
test('版本太旧不在可升级列表里就下完整安装包；已是最新或没有清单时不提示',async t=>{
  const files={'latest.json':latest(),'releases/3.7.1/setup.exe':SETUP};
  const launched=[];const old=await fixture(t,{current:'3.4.0',files,launch:async(f,kind)=>launched.push(kind)});
  assert.equal((await old.updater.check()).latest.kind,'setup');await old.updater.install();assert.deepEqual(launched,['setup']);
  assert.equal((await (await fixture(t,{current:'3.7.1',files})).updater.check()).status,'latest');
  assert.equal((await (await fixture(t,{current:'3.8.0',files})).updater.check()).status,'latest');
  const none=await fixture(t,{files:{}});const s=await none.updater.check();assert.equal(s.status,'latest');assert.equal(s.latest,null);
  await assert.rejects(none.updater.install(),/没有可以安装/);
});
test('签名不对、网络出错、文件被换都不会安装',async t=>{
  const {privateKey:other}=crypto.generateKeyPairSync('ed25519');
  const forged=await fixture(t,{files:{'latest.json':JSON.stringify(signManifest(manifest(),other))}});
  const s=await forged.updater.check();assert.equal(s.status,'error');assert.match(s.error,/签名/);
  const offline=await fixture(t,{files:{'latest.json':new TypeError('fetch failed')}});
  assert.equal((await offline.updater.check()).error,'fetch failed');
  let launched=0;
  const swapped=await fixture(t,{files:{'latest.json':latest(),'releases/3.7.1/update.exe':Buffer.from('evil-installer-xyz!!!')}, launch:async()=>{launched++;}});
  await swapped.updater.check();await assert.rejects(swapped.updater.install(),/校验不通过/);
  assert.equal(swapped.updater.state.status,'error');assert.equal(launched,0);
  assert.deepEqual((await fs.readdir(swapped.dir)).filter(f=>f.endsWith('.exe')||f.endsWith('.part')),[]);
  const big=await fixture(t,{files:{'latest.json':latest(),'releases/3.7.1/update.exe':Buffer.alloc(UPDATE.length+10)},launch:async()=>{launched++;}});
  await big.updater.check();await assert.rejects(big.updater.install(),/比清单里写的大/);assert.equal(launched,0);
  // 出错后可以重试
  const retry=await fixture(t,{files:{'latest.json':latest(),'releases/3.7.1/update.exe':UPDATE},launch:async()=>{launched++;}});
  await retry.updater.check();retry.updater.state.status='error';await retry.updater.install();assert.equal(launched,1);
});
test('安装脚本：等程序退出、装进当前文件夹、装完重开，路径里的引号会转义',()=>{
  const script=installScript({installer:"C:\\Temp\\小萝卜游戏控制台-v3.7.1-更新包.exe",appExe:"D:\\Tools\\Bob's\\小萝卜游戏控制台.exe",pid:4321});
  assert.match(script,/Wait-Process -Id 4321/);
  assert.ok(script.includes("$exe = 'D:\\Tools\\Bob''s\\小萝卜游戏控制台.exe'"));
  assert.ok(script.includes("'/DIR=\"D:\\Tools\\Bob''s\"'"));
  assert.ok(script.includes("Start-Process -FilePath 'C:\\Temp\\小萝卜游戏控制台-v3.7.1-更新包.exe' -ArgumentList @('/SILENT', '/SP-', '/NOCANCEL', '/NORESTART'"));
  assert.ok(script.trim().endsWith('Start-Process -FilePath $exe'));
});
test('COS 签名：与腾讯云文档示例的中间结果一致',()=>{
  const {text}=cosHttpString('PUT','/exampleobject(腾讯云)',{Date:'Thu, 16 May 2019 06:45:51 GMT',Host:'examplebucket-1250000000.cos.ap-beijing.myqcloud.com','Content-Type':'text/plain','Content-Length':'13','Content-MD5':'mQ/fVh815F3k6TAUm8m0eg==','x-cos-acl':'private','x-cos-grant-read':'uin="100000000011"'});
  assert.equal(crypto.createHash('sha1').update(text).digest('hex'),'8b2751e77f43a0995d6e9eb9477f4b685cca4172');
  const get=cosHttpString('GET','/exampleobject(腾讯云)',{Date:'Thu, 16 May 2019 06:55:53 GMT',Host:'examplebucket-1250000000.cos.ap-beijing.myqcloud.com'},{'response-content-type':'application/octet-stream','response-cache-control':'max-age=600'});
  assert.equal(crypto.createHash('sha1').update(get.text).digest('hex'),'54ecfe22f59d3514fdc764b87a32d8133ea611e6');
  const auth=cosAuthorization({secretId:'AKIDtest',secretKey:'secret',method:'PUT',pathname:'/latest.json',headers:{host:'h','content-length':'5'},now:1000});
  assert.match(auth,/^q-sign-algorithm=sha1&q-ak=AKIDtest&q-sign-time=940;4600&q-key-time=940;4600&q-header-list=content-length;host&q-url-param-list=&q-signature=[0-9a-f]{40}$/);
});
test('更新说明取 README 里这个版本那一段',()=>{
  const readme='# 标题\r\n\r\n## 版本更新\r\n\r\nv3.7.1：修了问题。\r\n\r\n- 第一条\r\n\r\nv3.7.0：旧的\r\n\r\n## 别的\r\n';
  assert.equal(notesFromReadme(readme,'3.7.1'),'v3.7.1：修了问题。\n\n- 第一条');
  assert.equal(notesFromReadme(readme,'3.7.0'),'v3.7.0：旧的');
  assert.throws(()=>notesFromReadme(readme,'9.9.9'),/没找到/);
});
test('本地接口：网页版不支持；桌面版检查和安装走更新器并推送状态',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-update-http-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const plain=await startServer({dataDir:path.join(dir,'a'),seedDir:path.join(__dirname,'../data')});
  t.after(()=>plain.close());
  const post=(rt,body)=>fetch(rt.url+'/api/update/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await (await fetch(plain.url+'/api/update/state')).json()).supported,false);
  assert.match((await (await post(plain,{action:'check'})).json()).error,/不支持/);
  let launched=0;
  const {updater}=await fixture(t,{files:{'latest.json':latest(),'releases/3.7.1/update.exe':UPDATE},launch:async()=>{launched++;}});
  const rt=await startServer({dataDir:path.join(dir,'b'),seedDir:path.join(__dirname,'../data'),updater});
  t.after(()=>rt.close());
  assert.equal((await (await fetch(rt.url+'/api/update/state')).json()).status,'idle');
  const checked=await (await post(rt,{action:'check'})).json();assert.equal(checked.state.status,'available');
  assert.equal((await post(rt,{action:'nope'})).status,400);
  const installed=await (await post(rt,{action:'install'})).json();assert.equal(installed.state.status,'installing');assert.equal(launched,1);
});
