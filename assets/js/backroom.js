/* ☕ Aerial's Corner — the back room (publishes posts through the GitHub Contents API) */
(() => {
  const root = document.querySelector('[data-backroom]');
  if (!root) return;

  const REPO = root.dataset.repo;
  const BRANCH = root.dataset.branch || 'main';
  const SITE = (root.dataset.site || '').replace(/\/$/, '');
  const API = `https://api.github.com/repos/${REPO}`;
  const KEY = 'backroom.token';
  const POSTS_DIR = '_posts';
  const IMG_DIR = 'assets/img/posts';
  const MAX_IMG = 8 * 1024 * 1024;

  const $ = s => root.querySelector(s);
  const views = { login: $('[data-view="login"]'), desk: $('[data-view="desk"]') };
  const form = {
    title: $('[name="title"]'), date: $('[name="date"]'), time: $('[name="time"]'),
    drink: $('[name="drink"]'), quote: $('[name="quote"]'), cover: $('[name="cover"]'), body: $('[name="body"]'),
  };
  const ui = {
    list: $('[data-post-list]'), status: $('[data-status]'), path: $('[data-path]'), heading: $('[data-editor-title]'),
    deploy: $('[data-deploy]'), del: $('[data-delete]'), preview: $('[data-panel="preview"]'), whoami: $('[data-whoami]'),
  };

  let token = null;
  let current = null;          // { path, sha } when editing an existing post
  let dirty = false;
  const pending = new Map();   // '/assets/img/posts/x.jpg' -> File (not uploaded yet)
  const blobs = new Map();     // same key -> object URL for previews

  /* ---------- storage (token never leaves this browser except to api.github.com) ---------- */
  const store = {
    get() { try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch { return null; } },
    set(t, remember) { try { (remember ? localStorage : sessionStorage).setItem(KEY, t); } catch { /* private mode */ } },
    clear() { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch { /* ignore */ } },
  };

  /* ---------- helpers ---------- */
  const say = (el, msg, kind) => { el.textContent = msg; el.classList.toggle('is-error', kind === 'error'); el.classList.toggle('is-ok', kind === 'ok'); };
  const pad = n => String(n).padStart(2, '0');
  const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'untitled';
  const bytesToB64 = bytes => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const textToB64 = s => bytesToB64(new TextEncoder().encode(s));
  const b64ToText = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
  const encPath = p => p.split('/').map(encodeURIComponent).join('/');
  const postUrl = path => `${SITE}/p/${path.replace(/^_posts\/\d{4}-\d{2}-\d{2}-/, '').replace(/\.(md|markdown)$/, '')}/`;

  async function gh(path, opts = {}) {
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { ...opts, headers, cache: 'no-store' });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).message || msg; } catch { /* no body */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  const getFile = path => gh(`/contents/${encPath(path)}?ref=${encodeURIComponent(BRANCH)}`);
  const putFile = (path, content64, message, sha) =>
    gh(`/contents/${encPath(path)}`, { method: 'PUT', body: JSON.stringify({ message, content: content64, branch: BRANCH, ...(sha ? { sha } : {}) }) });

  /* ---------- front matter ---------- */
  const q = v => JSON.stringify(String(v)); // JSON strings are valid YAML double-quoted scalars
  function buildFile(f) {
    const lines = ['---', `title: ${q(f.title)}`, `date: ${f.date} ${f.time}:00 +0700`];
    if (f.drink) lines.push(`drink: ${q(f.drink)}`);
    if (f.cover) lines.push(`cover: ${q(f.cover)}`);
    if (f.quote) lines.push(`quote: ${q(f.quote)}`);
    lines.push('---', '', f.body.replace(/\s+$/, ''), '');
    return lines.join('\n');
  }
  function parseFile(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { meta: {}, body: text };
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_]\w*):\s*(.*)$/);
      if (!kv) continue;
      let v = kv[2].trim();
      if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
      else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
      meta[kv[1]] = v;
    }
    return { meta, body: m[2].replace(/^\r?\n/, '') };
  }

  /* ---------- views ---------- */
  function show(name) { for (const [k, el] of Object.entries(views)) el.hidden = k !== name; }

  async function unlock(t, remember) {
    token = t;
    const repo = await gh('');
    if (!repo.permissions || !repo.permissions.push) { const e = new Error(`This token can't write to ${REPO}.`); e.status = 403; throw e; }
    store.set(t, remember);
    try { const me = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${t}` } }).then(r => r.ok ? r.json() : null); if (me) ui.whoami.textContent = `Signed in as ${me.login}. Brewing to ${REPO} (${BRANCH}).`; } catch { /* optional */ }
    show('desk');
    newPost();
    await loadList();
  }

  $('[data-login-form]').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('[data-login-msg]');
    const fd = new FormData(e.target);
    const t = String(fd.get('token') || '').trim();
    if (!t) return;
    say(msg, 'Checking the key…');
    try { await unlock(t, fd.get('remember') === 'on'); e.target.reset(); say(msg, ''); }
    catch (err) { token = null; say(msg, err.status === 401 ? 'That key doesn’t fit — the token is invalid or expired.' : `Couldn’t unlock: ${err.message}`, 'error'); }
  });

  $('[data-lock]').addEventListener('click', () => {
    if (dirty && !confirm('You have unsaved changes. Leave anyway?')) return;
    store.clear(); token = null; dirty = false; ui.whoami.textContent = 'Locked. See you next shift.'; show('login');
  });

  /* ---------- post list ---------- */
  async function loadList() {
    ui.list.innerHTML = '<li class="br-muted">Loading…</li>';
    let files = [];
    try { files = await gh(`/contents/${POSTS_DIR}?ref=${encodeURIComponent(BRANCH)}`); }
    catch (err) { if (err.status !== 404) { ui.list.innerHTML = ''; ui.list.append(li(`Couldn’t load posts: ${err.message}`)); return; } }
    files = files.filter(f => f.type === 'file' && /\.(md|markdown)$/.test(f.name)).sort((a, b) => b.name.localeCompare(a.name));
    ui.list.innerHTML = '';
    if (!files.length) { ui.list.append(li('No stories yet. Brew the first one!')); return; }
    for (const f of files) {
      const item = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button'; btn.dataset.path = f.path;
      const name = f.name.replace(/\.(md|markdown)$/, '');
      btn.append(document.createTextNode(name.slice(11).replace(/-/g, ' ') || name));
      const small = document.createElement('small'); small.textContent = name.slice(0, 10); btn.append(small);
      btn.addEventListener('click', () => openPost(f.path));
      item.append(btn); ui.list.append(item);
    }
    markCurrent();
  }
  const li = text => { const el = document.createElement('li'); el.className = 'br-muted'; el.textContent = text; return el; };
  const markCurrent = () => ui.list.querySelectorAll('button[data-path]').forEach(b => b.setAttribute('aria-current', String(!!current && b.dataset.path === current.path)));

  /* ---------- editor ---------- */
  function fill(meta, body) {
    form.title.value = meta.title || '';
    form.drink.value = meta.drink || '';
    form.quote.value = meta.quote || '';
    form.cover.value = meta.cover || '';
    form.body.value = body || '';
    const d = String(meta.date || '').match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
    if (d) { form.date.value = d[1]; form.time.value = d[2] || '12:00'; }
    else { const now = new Date(Date.now() - 2 * 60000); form.date.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; form.time.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`; }
    dirty = false; refreshPath(); renderPreview();
  }

  function newPost() {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    current = null; pending.clear();
    ui.heading.textContent = 'New story'; ui.del.hidden = true;
    fill({}, ''); say(ui.status, ''); markCurrent(); setTab('write');
  }
  $('[data-new]').addEventListener('click', newPost);

  async function openPost(path) {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    say(ui.status, 'Fetching from the shelf…');
    try {
      const file = await getFile(path);
      const { meta, body } = parseFile(b64ToText(file.content));
      if (!meta.date) meta.date = path.split('/').pop().slice(0, 10);
      current = { path, sha: file.sha }; pending.clear();
      ui.heading.textContent = 'Edit story'; ui.del.hidden = false;
      fill(meta, body); say(ui.status, ''); markCurrent();
    } catch (err) { say(ui.status, `Couldn’t open it: ${err.message}`, 'error'); }
  }

  const newPath = () => `${POSTS_DIR}/${form.date.value || 'YYYY-MM-DD'}-${slugify(form.title.value)}.md`;
  function refreshPath() { ui.path.textContent = current ? current.path : newPath(); }

  for (const el of Object.values(form)) el.addEventListener('input', () => { dirty = true; if (!current) refreshPath(); });
  form.body.addEventListener('input', () => { if (!ui.preview.hidden) renderPreview(); });
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- write / preview ---------- */
  function setTab(name) {
    root.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    root.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
    if (name === 'preview') renderPreview();
  }
  root.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

  function renderPreview() {
    if (!window.marked || !window.DOMPurify) { ui.preview.textContent = 'Preview tools are still loading…'; return; }
    const html = window.DOMPurify.sanitize(window.marked.parse(form.body.value || '*Nothing in the cup yet.*'));
    ui.preview.innerHTML = '';
    const head = document.createElement('header'); head.className = 'paper__head';
    if (form.drink.value) { const k = document.createElement('p'); k.className = 'kicker'; k.textContent = `☕ ${form.drink.value}`; head.append(k); }
    const h = document.createElement('h1'); h.className = 'paper__title'; h.textContent = form.title.value || 'Untitled'; head.append(h);
    ui.preview.append(head);
    if (form.cover.value) { const img = document.createElement('img'); img.className = 'paper__cover'; img.alt = ''; img.src = blobs.get(form.cover.value) || form.cover.value; ui.preview.append(img); }
    if (form.quote.value) {
      const aside = document.createElement('aside'); aside.className = 'dialogue dialogue--inline';
      const name = document.createElement('span'); name.className = 'dialogue__name'; name.textContent = 'Barista';
      const p = document.createElement('p'); p.textContent = form.quote.value; aside.append(name, p); ui.preview.append(aside);
    }
    const prose = document.createElement('div'); prose.className = 'prose'; prose.innerHTML = html;
    prose.querySelectorAll('img').forEach(img => { const b = blobs.get(img.getAttribute('src')); if (b) img.src = b; });
    ui.preview.append(prose);
  }

  /* ---------- images (kept locally until Deploy) ---------- */
  function stageImage(file) {
    if (!file) return null;
    if (!file.type.startsWith('image/')) { say(ui.status, 'That file isn’t an image.', 'error'); return null; }
    if (file.size > MAX_IMG) { say(ui.status, `Image is too large (max ${MAX_IMG / 1048576} MB).`, 'error'); return null; }
    const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
    const base = slugify(file.name.replace(/\.[^.]+$/, ''));
    const stamp = new Date().toISOString().slice(0, 10);
    const key = `/${IMG_DIR}/${stamp}-${base}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    pending.set(key, file); blobs.set(key, URL.createObjectURL(file)); dirty = true;
    say(ui.status, `Image ready — it will be uploaded when you deploy.`);
    return { key, alt: file.name.replace(/\.[^.]+$/, '') };
  }
  $('[data-body-file]').addEventListener('change', e => {
    const staged = stageImage(e.target.files[0]); e.target.value = '';
    if (!staged) return;
    const ta = form.body, md = `\n![${staged.alt}](${staged.key})\n`;
    const at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + md + ta.value.slice(ta.selectionEnd ?? at);
    ta.focus(); ta.selectionStart = ta.selectionEnd = at + md.length;
    renderPreview();
  });
  $('[data-cover-file]').addEventListener('change', e => {
    const staged = stageImage(e.target.files[0]); e.target.value = '';
    if (staged) { form.cover.value = staged.key; renderPreview(); }
  });

  /* ---------- deploy / delete ---------- */
  const busy = on => { ui.deploy.disabled = on; ui.del.disabled = on; };

  ui.deploy.addEventListener('click', async () => {
    const f = Object.fromEntries(Object.entries(form).map(([k, el]) => [k, el.value.trim()]));
    f.body = form.body.value;
    if (!f.title) return say(ui.status, 'Every story needs a title.', 'error');
    if (!f.body.trim()) return say(ui.status, 'The cup is empty — write something first.', 'error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !/^\d{2}:\d{2}$/.test(f.time)) return say(ui.status, 'Please set a date and time.', 'error');
    if (new Date(`${f.date}T${f.time}:00+07:00`) > new Date() &&
        !confirm('This date is in the future (Vietnam time). Jekyll hides future posts, so it won’t appear until a later rebuild after that time. Deploy anyway?')) return;

    busy(true);
    const started = Date.now();
    try {
      const path = current ? current.path : newPath();
      if (!current) {
        try { await getFile(path); throw Object.assign(new Error(`A story already lives at ${path}. Change the title or date.`), { status: 409 }); }
        catch (err) { if (err.status !== 404) throw err; }
      }
      const used = [...pending.keys()].filter(k => f.body.includes(k) || f.cover === k);
      for (const [i, key] of used.entries()) {
        say(ui.status, `Carrying image ${i + 1}/${used.length} to the shelf…`);
        const bytes = new Uint8Array(await pending.get(key).arrayBuffer());
        await putFile(key.slice(1), bytesToB64(bytes), `Add image ${key.split('/').pop()}`);
        pending.delete(key);
      }
      say(ui.status, 'Pouring the story…');
      const res = await putFile(path, textToB64(buildFile(f)), `${current ? 'Update' : 'Publish'}: ${f.title}`, current && current.sha);
      current = { path, sha: res.content.sha }; dirty = false;
      ui.heading.textContent = 'Edit story'; ui.del.hidden = false; refreshPath();
      say(ui.status, `Served! Live in ~1–2 minutes at ${postUrl(path)}`, 'ok');
      await loadList();
      watchBuild(started, path);
    } catch (err) {
      say(ui.status, err.status === 409 && err.message.includes('already')
        ? err.message
        : err.status === 409 ? 'Someone else changed this story meanwhile. Reopen it and try again.' : `Couldn’t deploy: ${err.message}`, 'error');
    } finally { busy(false); }
  });

  ui.del.addEventListener('click', async () => {
    if (!current) return;
    const title = form.title.value || current.path;
    if (!confirm(`Take “${title}” off the menu?\n\nIt disappears from the site after the next build. It stays recoverable in the repository's git history. Images are kept.`)) return;
    busy(true); say(ui.status, 'Clearing the table…');
    try {
      await gh(`/contents/${encPath(current.path)}`, { method: 'DELETE', body: JSON.stringify({ message: `Remove: ${title}`, sha: current.sha, branch: BRANCH }) });
      dirty = false; current = null; newPost();
      say(ui.status, `Removed “${title}”. The site updates in ~1–2 minutes.`, 'ok');
      await loadList();
    } catch (err) { say(ui.status, `Couldn’t delete: ${err.message}`, 'error'); }
    finally { busy(false); }
  });

  /* Optional: follow the GitHub Pages build (needs Pages: read on the token; silently skipped otherwise) */
  async function watchBuild(since, path) {
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 8000));
      let b; try { b = await gh('/pages/builds/latest'); } catch { return; }
      if (!b || new Date(b.created_at).getTime() < since - 5000) continue;
      if (b.status === 'built') return say(ui.status, `Live now ✓ ${postUrl(path)}`, 'ok');
      if (b.status === 'errored') return say(ui.status, `GitHub Pages build failed: ${(b.error && b.error.message) || 'see the repo’s Actions tab'}`, 'error');
    }
  }

  /* ---------- start ---------- */
  const saved = store.get();
  if (saved) unlock(saved, false).catch(() => { store.clear(); token = null; show('login'); });
  else show('login');
})();
