import {$,toast} from './console-shared.js';

// 左上角「联系我」：弹窗里显示 QQ 群和微信号，点「复制」直接复制。
$('#contact-open').addEventListener('click',()=>$('#contact-dialog').showModal());
// 其他地方的「联系我」小提示（比如弹幕姬的定制气泡）也打开同一个弹窗。
document.addEventListener('click',event=>{if(event.target.closest('[data-contact-open]'))$('#contact-dialog').showModal();});
$('#contact-dialog').addEventListener('click',async event=>{
  const button=event.target.closest('[data-copy-contact]');
  if(!button)return;
  try{await navigator.clipboard.writeText(button.dataset.copyContact);toast(`${button.dataset.copyName}已复制`);}
  catch{toast(`复制失败，请手动记下：${button.dataset.copyContact}`,true);}
});
