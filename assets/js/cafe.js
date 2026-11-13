/* ☕ Aerial's Corner — little bits of café life */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Rain on the window */
  const canvas = document.querySelector('[data-rain]');
  if (canvas && !reduce) {
    const ctx = canvas.getContext('2d');
    let drops = [], w = 0, h = 0;
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((w * h) / 9000);
      drops = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        l: 8 + Math.random() * 14, v: 6 + Math.random() * 8, a: .15 + Math.random() * .35,
      }));
    };
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1.2;
      for (const d of drops) {
        ctx.strokeStyle = `rgba(174, 194, 224, ${d.a})`;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * .18, d.y + d.l); ctx.stroke();
        d.y += d.v; d.x -= d.v * .18;
        if (d.y > h) { d.y = -d.l; d.x = Math.random() * (w + 60); }
      }
      if (!document.hidden) requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(tick); });
    addEventListener('resize', resize);
    resize(); requestAnimationFrame(tick);
  }

  /* Wall clock + OPEN sign (opening hours: 08:00–20:00, Vietnam time GMT+7) */
  const clock = document.querySelector('[data-clock]');
  const sign = document.querySelector('[data-open-sign]');
  const update = () => {
    const now = new Date();
    if (clock) clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (sign) {
      const hr = new Date(now.getTime() + 7 * 3600e3).getUTCHours();   // hour in GMT+7, whatever the visitor's zone
      const open = hr >= 8 && hr < 20;
      sign.textContent = open ? 'OPEN' : 'CLOSED';
      sign.classList.toggle('is-closed', !open);
      sign.title = open ? 'Open 8:00–20:00 (GMT+7). Come on in.' : 'Closed — opens 8:00 (GMT+7). The door is never locked for readers, though.';
    }
  };
  update(); setInterval(update, 15000);

  /* Staff door: tap the sign 5 times within 2 seconds */
  if (sign && sign.dataset.door) {
    let taps = [];
    sign.addEventListener('click', () => {
      const now = Date.now();
      taps = taps.filter(t => now - t < 2000);
      taps.push(now);
      if (taps.length >= 5) location.href = sign.dataset.door;
    });
  }

  /* Fresh menu: GitHub Pages lets browsers cache pages for 10 minutes, so a list page can be
     stale right after a new story is served. Compare with /freshness.json and reload once if needed. */
  const fresh = document.querySelector('[data-freshness]');
  if (fresh && window.fetch) {
    const url = `${fresh.dataset.src}?t=${Date.now()}`;   // unique URL: skips browser and CDN caches
    fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(async data => {
      if (!data) return;
      const shown = `${fresh.dataset.count}|${fresh.dataset.latest}`;
      const live = `${data.count}|${data.latest}`;
      if (shown === live) return;
      const key = 'cafe.refreshed:' + location.pathname;
      try { if (sessionStorage.getItem(key) === live) return; sessionStorage.setItem(key, live); } catch { /* no storage: still try once */ }
      await fetch(location.href, { cache: 'reload' }).catch(() => {});   // replace the cached copy
      location.reload();
    }).catch(() => {});
  }

  /* Chalkboard pages: show the menu N stories at a time (?page=2). Without JS every story is listed. */
  const list = document.querySelector('[data-paginate]');
  const pager = document.querySelector('[data-chalk-pages]');
  if (list && pager) {
    const per = Math.max(1, +list.dataset.paginate || 10);
    const items = [...list.children];
    const pages = Math.ceil(items.length / per);
    if (pages > 1) {
      const link = (n, text, label) => {
        const a = document.createElement('a');
        a.href = n === 1 ? location.pathname : `?page=${n}`;
        a.textContent = text; a.dataset.page = n;
        if (label) a.setAttribute('aria-label', label);
        return a;
      };
      const off = text => Object.assign(document.createElement('span'), { textContent: text, className: 'is-off' });
      const show = (n, scroll) => {
        n = Math.min(pages, Math.max(1, n || 1));
        items.forEach((li, i) => { li.hidden = Math.floor(i / per) + 1 !== n; });
        pager.replaceChildren(n > 1 ? link(n - 1, '← Prev', 'Previous page') : off('← Prev'));
        for (let p = 1; p <= pages; p++) {
          const a = link(p, String(p), `Page ${p}`);
          if (p === n) a.setAttribute('aria-current', 'page');
          pager.append(a);
        }
        pager.append(n < pages ? link(n + 1, 'Next →', 'Next page') : off('Next →'));
        if (scroll) list.closest('.chalkboard').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        return n;
      };
      const fromUrl = () => +new URLSearchParams(location.search).get('page') || 1;
      pager.hidden = false;
      show(fromUrl(), false);
      pager.addEventListener('click', e => {
        const a = e.target.closest('a[data-page]');
        if (!a) return;
        e.preventDefault();
        const n = show(+a.dataset.page, true);
        history.pushState({ page: n }, '', n === 1 ? location.pathname : `?page=${n}`);
      });
      addEventListener('popstate', () => show(fromUrl(), false));
    }
  }

  /* Barista dialogue: a fresh line on every visit, picked from _data/barista.yml.
     Lines for the current time in Vietnam (morning / afternoon / evening / closed) come up more
     often; the last few lines shown are skipped so returning visitors hear something new.
     Click (or Enter/Space) skips the typing, then asks for another line. */
  const tw = document.querySelector('[data-typewriter]');
  if (tw) {
    const box = tw.closest('.dialogue');
    let data = {};
    try { data = JSON.parse(document.querySelector('[data-barista-lines]').textContent) || {}; } catch { /* keep the line in the HTML */ }
    const vnHour = new Date(Date.now() + 7 * 3600e3).getUTCHours();
    const period = vnHour >= 8 && vnHour < 11 ? 'morning' : vnHour >= 11 && vnHour < 17 ? 'afternoon' : vnHour >= 17 && vnHour < 20 ? 'evening' : 'closed';
    const anytime = data.anytime || [], timely = data[period] || [];
    const all = [...anytime, ...timely];
    const RECENT = 'cafe.barista.recent';
    const recent = (() => { try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch { return []; } })();
    const pick = () => {
      const fresh = list => list.filter(l => !recent.includes(l));
      const pool = timely.length && Math.random() < 0.4 ? fresh(timely) : [];
      const from = pool.length ? pool : fresh(all).length ? fresh(all) : all;
      const line = from[Math.floor(Math.random() * from.length)];
      recent.push(line);
      while (recent.length > Math.min(15, Math.floor(all.length / 2))) recent.shift();
      try { localStorage.setItem(RECENT, JSON.stringify(recent)); } catch { /* private mode */ }
      return line;
    };

    // a hidden copy of the longest line reserves the box height, so it never jumps between lines
    const ghost = document.createElement('span'); ghost.className = 'tw-ghost'; ghost.setAttribute('aria-hidden', 'true');
    const live = document.createElement('span'); live.className = 'tw-live'; live.setAttribute('aria-hidden', 'true');
    const sr = document.createElement('span'); sr.className = 'sr-only'; sr.setAttribute('aria-live', 'polite');
    const fallback = tw.textContent.trim();   // the line written in index.html (used if no data)
    ghost.textContent = all.concat(fallback).reduce((a, b) => (b.length > a.length ? b : a), '');
    tw.replaceChildren(ghost, live, sr);

    let full = '', i = 0, timer = null;
    const typing = () => timer !== null;
    const finish = () => { clearTimeout(timer); timer = null; live.textContent = full; live.classList.remove('is-typing'); };
    const step = () => {
      live.textContent = full.slice(0, ++i);
      if (i >= full.length) return finish();
      timer = setTimeout(step, /[.…,?!]/.test(full[i - 1]) ? 220 : 28);
    };
    const say = (line, delay) => {
      full = line; i = 0; sr.textContent = line;
      if (reduce) { live.textContent = line; return; }
      clearTimeout(timer); live.textContent = ''; live.classList.add('is-typing');
      timer = setTimeout(step, delay);
    };
    say(all.length ? pick() : fallback, 500);

    if (box && all.length > 1) {
      box.classList.add('is-chatty');
      box.tabIndex = 0;
      box.title = 'Click for another word with the barista';
      const next = () => (typing() ? finish() : say(pick(), 120));
      box.addEventListener('click', next);
      box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); } });
    } else if (box) box.addEventListener('click', finish);
  }
})();
