export function queuePosition(index) {
  return globalThis.NoodleLayout.position(index);
}
export function customerAt(queue, x, y) {
  return queue.find((person, index) => {
    const p = queuePosition(index), dx = x - p.x, dy = y - p.y;
    return Math.hypot(dx - 36.5, dy - 29.5) <= 29.5 ||
      (dx >= 15 && dx <= 59 && dy >= 50 && dy <= 91);
  });
}
export const shirts = ['#83b8ae','#d99787','#abb0d0','#e0bb76','#9bb9d4','#b6bf88'];
export function portrait(person, className='customer-avatar') {
  const div = document.createElement('div');
  div.className = className;
  if (person.face) {
    const img = document.createElement('img'); img.src = '/api/avatar?url='+encodeURIComponent(person.face);
    img.alt = `${person.name}的头像`; img.referrerPolicy = 'no-referrer';
    if (className === 'thief-head') { div.hidden = true; img.addEventListener('load',()=>{div.hidden=false;},{once:true}); }
    img.addEventListener('error', () => { img.remove(); fallback(); }, {once:true});
    div.append(img);
  } else fallback();
  function fallback() {
    if (className === 'thief-head') { div.remove(); return; }
    if (className === 'customer-head') {
      const face = document.createElement('div'); face.className = 'fallback-face'; div.append(face);
    } else div.textContent = person.name.slice(0,1);
  }
  return div;
}
export function toast(message) {
  window.dispatchEvent(new CustomEvent('luobo-diagnostic',{detail:{event:'operation_error',message}}));
  if(document.body.classList.contains('cafe'))return;
  if (parent !== window) { parent.postMessage({ type: 'noodle-error', message }, location.origin); return; }
  const el = document.getElementById('toast'); el.textContent = message; el.classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 2600);
}
export async function requestAction(action, extra={}) {
  const res = await fetch('/api/noodle/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,...extra})});
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || '操作失败，请重试');
  return data.state;
}
