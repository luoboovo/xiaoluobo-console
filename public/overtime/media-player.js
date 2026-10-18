(() => {
  if (!new URLSearchParams(location.search).has('media')) return;
  const stage = document.querySelector('#media-stage'), video = document.querySelector('#media-video'), picture = document.querySelector('#media-image'), canvas = document.querySelector('#media-canvas'), error = document.querySelector('#media-error');
  let active, lastId, drawing, expiry, hideError, keyer;
  const setVolume = value => {if(Number.isInteger(value) && value >= 0 && value <= 100)video.volume=value/100;};
  const preview = new URLSearchParams(location.search).has('preview');
  let visible = !preview || !window.parent.document.querySelector('#overtime-view')?.hidden, latestCue;
  function stop() {
    active = null; cancelAnimationFrame(drawing); clearTimeout(expiry);
    video.pause(); video.removeAttribute('src'); video.load(); picture.removeAttribute('src'); stage.hidden = true; document.body.classList.remove('media-playing');
  }
  function fail() { stop(); error.textContent = '素材无法播放，请重新选择图片或MP4（H.264）/WebM视频'; window.dispatchEvent(new CustomEvent('luobo-diagnostic',{detail:{event:'resource_error',message:error.textContent}}));error.hidden = false; clearTimeout(hideError); hideError = setTimeout(()=>error.hidden=true,5000); }
  function draw() {
    if(!active || !active.green_screen) return;
    try { if(video.readyState >= 2) keyer(video); } catch { fail(); return; }
    drawing = requestAnimationFrame(draw);
  }
  async function play(cue) {
    latestCue = cue;
    if(!visible) {stop();lastId=null;return;}
    if(!cue) {stop();return;}
    if(lastId === cue.id) return;
    stop(); if(cue.ends_at <= Date.now()) return;
    active = cue; lastId = cue.id; error.hidden = true; clearTimeout(hideError); stage.hidden = false; document.body.classList.add('media-playing');
    picture.hidden = cue.kind !== 'image'; video.hidden = cue.kind !== 'video' || cue.green_screen; canvas.hidden = cue.kind !== 'video' || !cue.green_screen;
    expiry = setTimeout(stop,Math.max(0,cue.ends_at-Date.now()));
    const src = `/api/overtime/media/${cue.asset}`;
    if(cue.kind === 'image') {picture.src=src;return;}
    try {
      if(cue.green_screen && !keyer) keyer = GreenScreen.createKeyer(canvas);
      setVolume(cue.volume ?? 100); video.muted = preview; video.src = src;
      await video.play().catch(async playbackError => { if(playbackError.name !== 'NotAllowedError') throw playbackError; video.muted = true; await video.play(); });
      if(active?.id !== cue.id) return;
      const offset = Math.max(0,(Date.now()-cue.started_at)/1000);
      if(offset > 0.2 && Number.isFinite(video.duration)) video.currentTime = Math.min(offset,video.duration);
      if(cue.green_screen) draw();
    } catch(playbackError) { if(active?.id===cue.id && playbackError.name !== 'AbortError') fail(); }
  }
  video.addEventListener('ended',stop); video.addEventListener('error',()=>{if(active)fail();}); picture.addEventListener('error',()=>{if(active)fail();});
  window.addEventListener('overtime-media',event=>play(event.detail));
  window.addEventListener('overtime-volume',event=>setVolume(event.detail));
  window.addEventListener('message',event=>{
    if(!preview || event.origin!==location.origin || event.source!==window.parent || event.data?.type!=='overtime-preview-visibility') return;
    visible = event.data.visible === true;
    if(visible) play(latestCue); else {stop();lastId=null;}
  });
  window.addEventListener('pagehide',stop);
})();
