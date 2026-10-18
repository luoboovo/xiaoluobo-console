import {api,toast} from './console-shared.js';
import {switchView} from './app.js';
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-generate-panel]');if(!button)return;if(!window.dispatchEvent(new CustomEvent('before-generate-panel',{detail:button.dataset.generatePanel,cancelable:true})))return;button.disabled=true;
  try{const {panel}=await api('/api/panels/generate',{game:button.dataset.generatePanel});window.dispatchEvent(new CustomEvent('generated-gift-panel',{detail:panel}));switchView('gift-rules');toast(`已生成「${panel.name}」，可在礼物面板调整样式、打开或复制地址`);}catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
