import {$,api,toast,escapeHtml} from './console-shared.js';

// 推送更新：发现新版本时在顶部显示横幅；页脚「检查更新」手动查。
const banner=$('#update-banner'),dialog=$('#update-dialog');
let update=null,pending=false,hiddenVersion=null;
try{hiddenVersion=sessionStorage.getItem('update-later');}catch{}
const size=bytes=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`;
const notes=text=>escapeHtml(text).replace(/\n/g,'<br>');
function render(next){
  if(next)update=next;if(!update)return;
  const u=update,latest=u.latest;
  $('#update-check').hidden=!u.supported;
  $('#update-check').disabled=pending||['checking','downloading','installing'].includes(u.status);
  $('#update-check').textContent=u.status==='checking'?'检查中…':'检查更新';
  const show=u.supported&&latest&&(['downloading','installing'].includes(u.status)||u.status==='error'&&latest||u.status==='available'&&hiddenVersion!==latest.version);
  banner.hidden=!show;banner.className='update-banner '+u.status;
  if(!show)return;
  const what=latest.kind==='update'?`更新包 ${size(latest.size)}`:`完整安装包 ${size(latest.size)}`;
  if(u.status==='downloading'){banner.innerHTML=`<div class="update-main"><strong>正在下载 v${escapeHtml(latest.version)}</strong><span>${what} · ${Math.floor(u.progress*100)}%</span></div><div class="update-progress"><i></i></div>`;banner.querySelector('.update-progress i').style.width=`${(u.progress*100).toFixed(1)}%`;return;}
  if(u.status==='installing'){banner.innerHTML=`<div class="update-main"><strong>下载好了，正在安装 v${escapeHtml(latest.version)}</strong><span>控制台马上关闭，装好后会自动重新打开</span></div>`;return;}
  banner.innerHTML=`<div class="update-main"><strong>${u.status==='error'?'更新没成功：'+escapeHtml(u.error):`发现新版本 v${escapeHtml(latest.version)}`}</strong><span>当前 v${escapeHtml(u.current)} · ${what}${latest.kind==='setup'?'（版本差得比较多，这次要装完整版）':''}</span></div>
    <details class="update-notes"><summary>更新内容</summary><div>${notes(latest.notes)||'（没有写更新说明）'}</div></details>
    <div class="update-actions"><button class="text-button" id="update-later" type="button">稍后</button><button class="button dark-button" id="update-install" type="button">${u.status==='error'?'重试':'立即更新'}</button></div>`;
  popup(u);
}
// 打开控制台时发现新版本：直接弹窗（每次打开控制台、每个新版本弹一次；点「稍后」这次就不再弹，顶部横幅还在）。
const popupDialog=$('#update-popup');
function popup(u){
  const latest=u.latest;
  if(u.status!=='available'||!latest||popupDialog.open||dialog.open)return;
  let shown='';try{shown=sessionStorage.getItem('update-popup')||'';}catch{}
  if(shown===latest.version)return;
  try{sessionStorage.setItem('update-popup',latest.version);}catch{}
  const what=latest.kind==='update'?`更新包 ${size(latest.size)}`:`完整安装包 ${size(latest.size)}（版本差得比较多，这次要装完整版）`;
  $('#update-popup-title').textContent=`发现新版本 v${latest.version}`;
  $('#update-popup-sub').textContent=`当前 v${u.current} · ${what}`;
  $('#update-popup-notes').innerHTML=notes(latest.notes)||'（没有写更新说明）';
  popupDialog.showModal();
}
$('#update-popup-later').onclick=()=>popupDialog.close();
$('#update-popup-install').onclick=async()=>{popupDialog.close();try{await action('install');}catch(error){toast(error.message,true);}};
async function action(name){
  pending=true;render();
  try{const result=await api('/api/update/action',{action:name});render(result.state);return result.state;}
  finally{pending=false;render();}
}
banner.addEventListener('click',event=>{
  if(event.target.closest('#update-later')){hiddenVersion=update.latest.version;try{sessionStorage.setItem('update-later',hiddenVersion);}catch{}render();}
  if(event.target.closest('#update-install'))dialog.showModal();
});
$('#update-confirm').onclick=async()=>{dialog.close();try{await action('install');}catch(error){toast(error.message,true);}};
$('#update-check').onclick=async()=>{
  try{
    const state=await action('check');
    if(state.status==='latest')toast(`已经是最新版 v${state.current}`);
    else if(state.status==='available'){hiddenVersion=null;try{sessionStorage.removeItem('update-later');}catch{}render();toast(`发现新版本 v${state.latest.version}`);}
    else if(state.status==='error')toast('检查更新失败：'+state.error,true);
  }catch(error){toast(error.message,true);}
};
addEventListener('update-state',event=>render(event.detail));
api('/api/update/state').then(render).catch(()=>{});
