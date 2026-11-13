/* ☕ Aerial's Corner — the record player.
   Visitors paste a YouTube Music link (music.youtube.com only) and it plays through YouTube's
   embedded player, shown small inside the panel. Play/pause and the "now playing" title use the
   player's postMessage interface, so no extra YouTube script is loaded. The last record is
   remembered on this device, but never starts by itself: browsers only allow sound after a click. */
(() => {
  const root = document.querySelector('[data-rp]');
  if (!root) return;

  const PLAYER = 'https://www.youtube-nocookie.com';
  const KEY = 'cafe.record';
  const $ = s => root.querySelector(s);
  const ui = {
    panel: $('[data-rp-panel]'), toggle: $('[data-rp-toggle]'), close: $('[data-rp-close]'),
    form: $('[data-rp-form]'), input: $('#rp-url'), screen: $('[data-rp-screen]'),
    controls: $('[data-rp-controls]'), play: $('[data-rp-play]'), eject: $('[data-rp-eject]'),
    now: $('[data-rp-now]'), msg: $('[data-rp-msg]'),
  };

  let frame = null, playing = false, title = '', record = null;

  /* ---------- links: YouTube Music only ---------- */
  function parse(raw) {
    let u;
    try { u = new URL(String(raw).trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol) || u.hostname !== 'music.youtube.com') return null;
    const v = u.searchParams.get('v'), list = u.searchParams.get('list');
    const okId = s => /^[\w-]{6,20}$/.test(s || ''), okList = s => /^[\w-]{10,80}$/.test(s || '');
    // "RD…" lists are YouTube's auto-generated radio mixes, which usually refuse to play in embeds
    const keepList = okList(list) && !/^RD/.test(list);
    if (u.pathname === '/watch' && okId(v)) return { kind: 'track', id: v, list: keepList ? list : null, url: u.href };
    if (u.pathname === '/playlist' && okList(list)) return { kind: 'playlist', list, url: u.href };
    return null;
  }
  function src(r) {
    const q = new URLSearchParams({ autoplay: '1', enablejsapi: '1', playsinline: '1', rel: '0', origin: location.origin });
    if (r.kind === 'playlist') { q.set('list', r.list); return `${PLAYER}/embed/videoseries?${q}`; }
    if (r.list) q.set('list', r.list);
    return `${PLAYER}/embed/${r.id}?${q}`;
  }

  /* ---------- storage (per visitor, optional) ---------- */
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const save = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

  /* ---------- UI state ---------- */
  const say = (text, error) => { ui.msg.textContent = text || ''; ui.msg.classList.toggle('is-error', !!error); };
  function paint() {
    root.classList.toggle('is-loaded', !!frame);
    root.classList.toggle('is-playing', playing);
    ui.screen.hidden = !frame;
    ui.controls.hidden = !frame;
    ui.play.textContent = playing ? 'Pause' : 'Play';
    ui.now.replaceChildren();
    if (frame) {
      ui.now.append(playing ? 'Now spinning: ' : 'Paused on ');
      const b = document.createElement('b'); b.textContent = title || 'your request'; ui.now.append(b);
      ui.now.append(playing ? '. Good pick — this one sounds better with the rain.' : '. Say the word and I’ll drop the needle again.');
    } else {
      const last = load();
      if (last && last.url) {
        ui.now.append('Last time you asked for ');
        const b = document.createElement('b'); b.textContent = last.title || 'a song from YouTube Music'; ui.now.append(b);
        ui.now.append('. Want it again? Just say “Put it on”.');
      } else ui.now.textContent = 'The turntable’s been quiet all evening. Got a song in mind? Hand me a YouTube Music link and I’ll put it on.';
    }
    ui.toggle.title = frame ? `The record player — ${playing ? 'now spinning' : 'paused'}${title ? `: ${title}` : ''}` : 'The record player — ask the barista for a song';
  }
  function open(show) {
    ui.panel.hidden = !show;
    ui.toggle.setAttribute('aria-expanded', String(show));
    if (show && !frame) ui.input.focus();
  }

  /* ---------- player ---------- */
  const send = (func, args = []) => frame && frame.contentWindow &&
    frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), PLAYER);

  function putOn(r) {
    eject(false);
    record = r; title = ''; playing = false;
    frame = document.createElement('iframe');
    frame.src = src(r);
    frame.title = 'YouTube Music player';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';   // YouTube needs a referrer to play
    frame.addEventListener('load', () => {
      // ask the player to report its state and the song title
      frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'rp', channel: 'widget' }), PLAYER);
    });
    ui.screen.replaceChildren(frame);
    save({ url: r.url });
    say('Dropping the needle… give it a second.');
    paint();
  }
  function eject(forget) {
    if (frame) frame.remove();
    frame = null; playing = false; title = ''; record = null;
    if (forget) { save(null); say('Back on the shelf it goes. The turntable’s all yours whenever you want it.'); }
    paint();
  }

  addEventListener('message', e => {
    if (!frame || e.origin !== PLAYER || e.source !== frame.contentWindow) return;
    let data; try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!data || !data.info) {
      if (data && data.event === 'onError') say('Hm, this one won’t play in here — the label must’ve locked it to their own shop. Got another?', true);
      return;
    }
    const info = data.info;
    if (typeof info.playerState === 'number') {
      playing = info.playerState === 1 || info.playerState === 3;   // playing or buffering
      if (info.playerState === 1) say('');
      if (info.playerState === 0 && record && record.kind === 'track' && !record.list) say('That’s the end of the side. Want me to put something else on?');
    }
    const t = info.videoData && info.videoData.title;
    if (t && t !== title) { title = t; if (record) save({ url: record.url, title }); }
    if (typeof info.playerState === 'number' || t) paint();
  });

  /* ---------- controls ---------- */
  ui.toggle.addEventListener('click', () => open(ui.panel.hidden));
  ui.close.addEventListener('click', () => { open(false); ui.toggle.focus(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !ui.panel.hidden) { open(false); ui.toggle.focus(); } });
  ui.form.addEventListener('submit', e => {
    e.preventDefault();
    const r = parse(ui.input.value);
    if (!r) {
      say('Ah, this old turntable only takes YouTube Music — a link that starts with https://music.youtube.com/, a song or a playlist. Got one of those?', true);
      return;
    }
    putOn(r);
    ui.input.value = '';
  });
  ui.play.addEventListener('click', () => {
    send(playing ? 'pauseVideo' : 'playVideo');
    playing = !playing; paint();   // optimistic; the player confirms through its messages
  });
  ui.eject.addEventListener('click', () => eject(true));

  // remembered record: pre-fill the link (playing needs a click, browsers block sound otherwise)
  const last = load();
  if (last && last.url && parse(last.url)) ui.input.value = last.url;
  paint();
})();
