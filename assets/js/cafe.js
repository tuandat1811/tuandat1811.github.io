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

  /* Wall clock + OPEN sign (the café opens at dusk) */
  const clock = document.querySelector('[data-clock]');
  const sign = document.querySelector('[data-open-sign]');
  const update = () => {
    const now = new Date();
    if (clock) clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (sign) {
      const hr = now.getHours();
      const open = hr >= 17 || hr < 4;
      sign.textContent = open ? 'OPEN' : 'CLOSED';
      sign.classList.toggle('is-closed', !open);
      sign.title = open ? 'Come on in.' : 'Opens at dusk — but the door is never locked for readers.';
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

  /* Typewriter dialogue — a hidden copy of the full line reserves the space */
  const tw = document.querySelector("[data-typewriter]");
  if (tw && !reduce) {
    const full = tw.textContent.trim();
    const ghost = document.createElement("span"); ghost.className = "tw-ghost"; ghost.textContent = full; ghost.setAttribute("aria-hidden", "true");
    const live = document.createElement("span"); live.className = "tw-live is-typing"; live.setAttribute("aria-hidden", "true");
    const sr = document.createElement("span"); sr.className = "sr-only"; sr.textContent = full;
    tw.replaceChildren(ghost, live, sr);
    let i = 0, timer;
    const finish = () => { clearTimeout(timer); live.textContent = full; live.classList.remove("is-typing"); };
    const step = () => {
      live.textContent = full.slice(0, ++i);
      if (i >= full.length) return finish();
      timer = setTimeout(step, /[.…,]/.test(full[i - 1]) ? 220 : 28);
    };
    timer = setTimeout(step, 500);
    const box = tw.closest(".dialogue");
    if (box) box.addEventListener("click", finish);
  }
})();
