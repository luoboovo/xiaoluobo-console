export const $ = selector => document.querySelector(selector);
export const giftById = new Map();
let activePlatform='bilibili';
export const setPlatform=platform=>{activePlatform=platform;};
export const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
export const image = gift => `/api/gifts/${gift.id}/image?platform=${activePlatform}`;
let toastTimer;

export function toast(text, error = false) {
  if(error)window.dispatchEvent(new CustomEvent('luobo-diagnostic',{detail:{event:'operation_error',message:text}}));
  const element = $('#toast');
  element.textContent = text;
  element.hidden = false;
  element.classList.toggle('error', error);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.hidden = true, error ? 7000 : 3500);
}

export async function api(url, body) {
  const response = await fetch(url, body === undefined ? {headers:{'X-Luobo-Platform':activePlatform}} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Luobo-Platform':activePlatform },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}
