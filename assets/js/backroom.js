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
    drink: $('[name="drink"]'), quote: $('[name="quote"]'), cover: $('[name="cover"]'),
  };
  const ui = {
    list: $('[data-post-list]'), status: $('[data-status]'), path: $('[data-path]'), heading: $('[data-editor-title]'),
    deploy: $('[data-deploy]'), del: $('[data-delete]'), preview: $('[data-preview]'), overlay: $('[data-overlay]'), whoami: $('[data-whoami]'),
    closePreview: $('[data-preview-close]'), viewLive: $('[data-view-live]'),
  };
  document.body.append(ui.overlay); // lift the preview above the site header

  let token = null;
  let current = null;          // { path, sha } when editing an existing post
  let dirty = false;
  const pending = new Map();   // '/assets/img/posts/x.jpg' -> File (not uploaded yet)
  const blobs = new Map();     // same key -> object URL shown while editing
  let filling = false;         // true while we load text into the editor (not a user edit)

  /* ---------- the visual editor (Word-like; stores Markdown underneath) ---------- */
  const embedBtn = document.createElement('button');
  embedBtn.type = 'button';
  embedBtn.className = 'toastui-editor-toolbar-icons br-embed-btn';
  embedBtn.textContent = '▶';
  embedBtn.setAttribute('aria-label', 'Embed a YouTube, Vimeo or Spotify link');
  /* The editor measures its toolbar when created, so it is created only once the desk is visible
     (created while hidden, every button would collapse into the "…" menu). */
  let editor = null;
  const createEditor = () => new window.toastui.Editor({
    el: $('[data-editor]'),
    height: '560px',
    initialEditType: 'wysiwyg',
    previewStyle: 'tab',
    hideModeSwitch: false,
    usageStatistics: false,
    autofocus: false,
    placeholder: 'Write your story here… Use the toolbar for headings, bold, lists, quotes and images.',
    toolbarItems: [['heading', 'bold', 'italic'], ['ul', 'ol', 'quote'],
      ['image', { name: 'embed', el: embedBtn, tooltip: 'Embed video / music' }, 'link'],
      ['strike', 'hr', 'table', 'code', 'codeblock']],
    hooks: {
      addImageBlobHook(blob, callback) {
        const staged = stageImage(blob);
        if (staged) callback(blobs.get(staged.key), staged.alt);
      },
    },
  });
  function ensureEditor() {
    if (editor) return;
    editor = createEditor();
    editor.on('change', () => { if (!filling) dirty = true; });
    setupImageSizing();
  }

  /* ---------- image sizes ----------
     Stored as a #w=NN fragment on the image URL (e.g. photo.jpg#w=50 = 50% wide): it survives
     Markdown and Jekyll untouched and is ignored when the image is downloaded. embeds.js applies it
     on the site and in Preview; here we apply it inside the editor and offer S/M/L/Full buttons. */
  const SIZES = [['S', 25], ['M', 50], ['L', 75], ['Full', 100]];
  const widthOf = src => { const m = String(src || '').match(/#w=(\d{1,3})$/); return m ? Math.min(100, Math.max(10, +m[1])) : 100; };
  const withWidth = (src, w) => String(src).replace(/#w=\d{1,3}$/, '') + (w >= 100 ? '' : `#w=${w}`);

  function setupImageSizing() {
    const box = $('[data-editor]');
    box.style.position = 'relative';
    const bar = document.createElement('div');
    bar.className = 'br-imgsize'; bar.hidden = true;
    bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Image size');
    const label = document.createElement('span'); label.textContent = 'Size';
    bar.append(label);
    for (const [name, w] of SIZES) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.dataset.w = w;
      b.title = `${w}% of the page width`;
      bar.append(b);
    }
    box.append(bar);
    let target = null;   // the <img> being sized

    const view = () => editor.isWysiwygMode() && editor.wwEditor && editor.wwEditor.view;
    const paint = () => {   // show each image at its stored width inside the editor
      const pm = box.querySelector('.toastui-editor-ww-container .ProseMirror');
      if (pm) pm.querySelectorAll('img:not(.ProseMirror-separator)').forEach(img => {
        const w = widthOf(img.getAttribute('src'));
        img.style.width = w < 100 ? `${w}%` : '';
      });
    };
    const place = () => {
      if (!target || !target.isConnected) { hide(); return; }
      const r = target.getBoundingClientRect(), base = box.getBoundingClientRect();
      const tools = box.querySelector('.toastui-editor-toolbar');
      // keep the bar on the visible part of the image: below the editor toolbar and the site header
      const visTop = Math.max(r.top, tools ? tools.getBoundingClientRect().bottom : base.top, 90) + 8;
      const top = Math.min(visTop, Math.max(r.top + 8, r.bottom - 48));
      bar.style.left = `${Math.max(8, r.left - base.left + 8)}px`;
      bar.style.top = `${top - base.top}px`;
      const w = widthOf(target.getAttribute('src'));
      bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.w === w)));
    };
    const show = img => { target = img; bar.hidden = false; place(); };
    function hide() { target = null; bar.hidden = true; }

    box.addEventListener('click', e => {
      const img = e.target.closest('.ProseMirror img:not(.ProseMirror-separator)');
      if (img) show(img); else if (!bar.contains(e.target)) hide();
    });
    bar.addEventListener('mousedown', e => e.preventDefault());   // keep the editor's selection
    bar.addEventListener('click', e => {
      const btn = e.target.closest('button[data-w]'); const v = view();
      if (!btn || !target || !v) return;
      let pos; try { pos = v.posAtDOM(target, 0); } catch { return; }
      const doc = v.state.doc;
      const at = [pos, pos - 1].find(p => p >= 0 && doc.nodeAt(p) && doc.nodeAt(p).type.name === 'image');
      if (at === undefined) return;
      const node = doc.nodeAt(at);
      v.dispatch(v.state.tr.setNodeMarkup(at, null, { ...node.attrs, imageUrl: withWidth(node.attrs.imageUrl, +btn.dataset.w) }));
      dirty = true;
      requestAnimationFrame(() => {   // the editor redraws the image; find it again and keep the bar on it
        paint();
        const imgs = [...box.querySelectorAll('.ProseMirror img:not(.ProseMirror-separator)')];
        const again = imgs.find(i => { try { return v.posAtDOM(i, 0) === pos; } catch { return false; } });
        if (again) show(again); else hide();
      });
    });
    const pm = box.querySelector('.toastui-editor-ww-container .ProseMirror');
    if (pm) new MutationObserver(() => { paint(); if (target) place(); })
      .observe(pm, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    box.querySelector('.toastui-editor-ww-container')?.addEventListener('scroll', () => target && place(), true);
    addEventListener('scroll', () => target && place(), { passive: true });
    editor.on('changeMode', hide);
    paint();
  }

  /* Embeds: a supported link alone on its own line becomes a player on the site (see embeds.js). */
  function insertEmbed(url) {
    const view = editor.isWysiwygMode() && editor.wwEditor && editor.wwEditor.view;
    if (view) {
      const { state } = view;
      const para = state.schema.nodes.paragraph.create(null, state.schema.text(url));
      const $from = state.selection.$from;
      const block = $from.node(1);
      const tr = block && block.type.name === 'paragraph' && !block.textContent.trim()
        ? state.tr.replaceWith($from.before(1), $from.after(1), para)    // empty line: use it
        : state.tr.insert($from.depth ? $from.after(1) : state.doc.content.size, para); // else: new line below
      view.dispatch(tr.scrollIntoView());
      view.focus();
    } else {
      editor.replaceSelection(`\n\n${url}\n\n`);
    }
  }
  embedBtn.addEventListener('click', () => {
    const url = prompt('Paste a YouTube, Vimeo or Spotify link.\nIt will show as a player on the site (use Preview to check).');
    if (!url || !url.trim()) return;
    if (!window.cafeEmbeds || !window.cafeEmbeds.toEmbed(url)) {
      say(ui.status, 'That link can’t be embedded — supported: YouTube, Vimeo, Spotify.', 'error');
      return;
    }
    insertEmbed(url.trim());
    say(ui.status, 'Embed added. It shows as a link here and as a player in Preview and on the site.', 'ok');
  });
  const toKeys = md => { for (const [key, url] of blobs) md = md.split(url).join(key); return md; };   // blob: URLs -> real paths
  const toBlobs = md => { for (const [key, url] of blobs) md = md.split(key).join(url); return md; };
  /* The visual editor separates paragraphs with a single newline, which Jekyll (kramdown) would
     glue into one paragraph. Put a blank line between blocks, but keep lists, tables, quotes and code intact. */
  const isFence = l => /^\s*(```|~~~)/.test(l);
  const isList = l => /^\s*([-*+]|\d+[.)])\s/.test(l);
  const isIndented = l => /^\s+\S/.test(l);
  const isTable = l => /^\s*\|/.test(l);
  const isQuote = l => /^\s*>/.test(l);
  const isPlain = l => l.trim() && !isFence(l) && !isList(l) && !isIndented(l) && !isTable(l) && !isQuote(l);
  /* A line that is only an embeddable link is written as <url>, so Jekyll keeps it verbatim
     (no smart dashes/ellipses inside the URL) and the site turns it into a player. */
  function protectEmbed(line) {
    const unescape = s => s.replace(/\\([\\`*_{}[\]()#+.!~|-])/g, '$1');
    let url = unescape(line.trim());
    const asLink = url.match(/^\[(https?:\/\/[^\]\s]+)\]\((https?:\/\/[^)\s]+)\)$/);   // [url](url) from the editor
    if (asLink && asLink[1] === asLink[2]) url = asLink[2];
    if (!/^https?:\/\/\S+$/.test(url) || !window.cafeEmbeds || !window.cafeEmbeds.toEmbed(url)) return line;
    return `<${url}>`;
  }
  function normalizeMd(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i], b = lines[i + 1];
      out.push(fence ? a : protectEmbed(a));
      if (isFence(a)) fence = !fence;
      if (fence || b === undefined || !a.trim() || !b.trim()) continue;
      if (isTable(a) && isTable(b)) continue;
      if ((isList(a) || isIndented(a)) && (isList(b) || isIndented(b))) continue;
      if (isQuote(a) && isQuote(b)) { out.push('>'); continue; }
      out.push('');
    }
    return out.join('\n');
  }
  /* The reverse, used when loading a saved story: the editor shows each blank line as an empty
     paragraph, so drop the single blank line between two plain paragraphs. */
  function denormalizeMd(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i];
      if (isFence(a)) fence = !fence;
      if (!fence && !a.trim() && i > 0 && isPlain(lines[i - 1]) && isPlain(lines[i + 1] || '')) continue;
      out.push(a);
    }
    return out.join('\n');
  }
  const getBody = () => toKeys(normalizeMd(editor.getMarkdown()));
  const setBody = md => { filling = true; editor.setMarkdown(toBlobs(denormalizeMd(md || '')), false); filling = false; };

  /* ---------- storage (token never leaves this browser except to api.github.com) ---------- */
  const store = {
    get() { try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch { return null; } },
    // "Remember on this device" -> localStorage (survives closing the browser); otherwise this tab only.
    set(t, remember) {
      try {
        (remember ? localStorage : sessionStorage).setItem(KEY, t);
        (remember ? sessionStorage : localStorage).removeItem(KEY);
      } catch { /* private mode: storage unavailable */ }
    },
    remembered() { try { return !!localStorage.getItem(KEY); } catch { return false; } },
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
  function show(name) {
    for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
    if (name === 'desk') ensureEditor();
  }

  /* A token that can't write gets 403 "Resource not accessible by personal access token" (or 404). */
  const NO_WRITE_HELP = `This token can’t write to ${REPO}. On GitHub, edit the token: ` +
    `Repository access → Only select repositories → ${REPO}; ` +
    `Permissions → Repository permissions → Contents: Read and write. Save, then unlock again.`;
  const CACHE_NOTE = 'Your browser may keep showing the old page for up to 10 minutes — press Ctrl+F5 (or open a private window) to see it sooner.';
  const isNoWrite = err => err && (err.status === 403 || err.status === 404);

  /* `repo.permissions` describes the *account*, not the token, so probe write access for real:
     an update with an impossible sha is rejected for permission first (403/404), otherwise for the
     sha mismatch (409/422) — nothing is ever written. */
  async function canWrite() {
    try {
      await gh(`/contents/${POSTS_DIR}/.gitkeep`, { method: 'PUT', body: JSON.stringify({ message: 'access check', content: '', sha: '0'.repeat(40), branch: BRANCH }) });
      return true;
    } catch (err) {
      if (isNoWrite(err)) return false;
      return true; // 409/422 etc.: allowed to write, only the (fake) sha was refused
    }
  }

  async function unlock(t, remember) {
    token = t;
    await gh('');                       // 401 here = bad or expired token
    if (!(await canWrite())) { const e = new Error(NO_WRITE_HELP); e.status = 403; throw e; }
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
    catch (err) {
      token = null;
      say(msg, err.status === 401 ? 'That key doesn’t fit — the token is invalid or expired.'
        : err.message === NO_WRITE_HELP ? NO_WRITE_HELP : `Couldn’t unlock: ${err.message}`, 'error');
    }
  });

  $('[data-lock]').addEventListener('click', () => {
    if (dirty && !confirm('You have unsaved changes. Leave anyway?')) return;
    if (store.remembered() && !confirm('Forget the saved key on this device? You will need to paste the token again next time.')) return;
    store.clear(); token = null; dirty = false; ui.whoami.textContent = 'Locked — the key is forgotten on this device.'; show('login');
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
      const label = document.createElement('span'); label.className = 'br-item__title';
      label.textContent = name.slice(11).replace(/-/g, ' ') || name;   // replaced by the real title below
      const small = document.createElement('small');
      const [y, m, d] = name.slice(0, 10).split('-'); small.textContent = d && m && y ? `${d}.${m}.${y}` : name.slice(0, 10);
      const edit = document.createElement('span'); edit.className = 'br-item__edit'; edit.textContent = '✎ Edit'; edit.setAttribute('aria-hidden', 'true');
      btn.append(label, small, edit);
      btn.setAttribute('aria-label', `Edit ${label.textContent}`);
      btn.addEventListener('click', () => openPost(f.path));
      item.append(btn); ui.list.append(item);
    }
    markCurrent();
    loadTitles(files);
  }
  /* Show each story's real title (with Vietnamese accents) instead of its file name. */
  async function loadTitles(files) {
    const queue = files.slice(0, 60);
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        try {
          const { meta } = parseFile(b64ToText((await getFile(f.path)).content));
          const btn = ui.list.querySelector(`button[data-path="${CSS.escape(f.path)}"]`);
          if (btn && meta.title) { btn.querySelector('.br-item__title').textContent = meta.title; btn.setAttribute('aria-label', `Edit ${meta.title}`); }
        } catch { /* keep the file name */ }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  /* Header, buttons and "View on site" follow whether we're writing a new story or editing one. */
  function setMode(title) {
    const editing = !!current;
    ui.heading.textContent = editing ? `Editing: ${title || 'Untitled'}` : 'New story';
    ui.del.hidden = !editing;
    ui.deploy.textContent = editing ? 'Update ☕' : 'Deploy ☕';
    ui.viewLive.hidden = !editing;
    if (editing) ui.viewLive.href = postUrl(current.path);
  }
  const li = text => { const el = document.createElement('li'); el.className = 'br-muted'; el.textContent = text; return el; };
  const markCurrent = () => ui.list.querySelectorAll('button[data-path]').forEach(b => b.setAttribute('aria-current', String(!!current && b.dataset.path === current.path)));

  /* ---------- editor ---------- */
  function fill(meta, body) {
    form.title.value = meta.title || '';
    form.drink.value = meta.drink || '';
    form.quote.value = meta.quote || '';
    form.cover.value = meta.cover || '';
    setBody(body);
    const d = String(meta.date || '').match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
    if (d) { form.date.value = d[1]; form.time.value = d[2] || '12:00'; }
    else { const now = new Date(Date.now() - 2 * 60000); form.date.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; form.time.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`; }
    dirty = false; refreshPath();
  }

  function newPost() {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    current = null; pending.clear();
    setMode();
    fill({}, ''); say(ui.status, ''); markCurrent();
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
      setMode(meta.title);
      fill(meta, body); say(ui.status, 'Opened — make your changes, then press “Update”.'); markCurrent();
      $('[name="title"]').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) { say(ui.status, `Couldn’t open it: ${err.message}`, 'error'); }
  }

  const newPath = () => `${POSTS_DIR}/${form.date.value || 'YYYY-MM-DD'}-${slugify(form.title.value)}.md`;
  function refreshPath() { ui.path.textContent = current ? current.path : newPath(); }

  for (const el of Object.values(form)) el.addEventListener('input', () => { dirty = true; if (!current) refreshPath(); });
  addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- full-page preview ---------- */
  function renderPreview() {
    const body = getBody();
    const html = window.DOMPurify.sanitize(window.marked.parse(body || '*Nothing in the cup yet.*'));
    const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    ui.preview.innerHTML = '';
    const head = el('header', 'paper__head');
    if (form.drink.value.trim()) { const k = el('p', 'kicker'); k.append(el('span', null, `☕ ${form.drink.value.trim()}`)); head.append(k); }
    head.append(el('h1', 'paper__title', form.title.value.trim() || 'Untitled'));
    const words = body.replace(/[#>*_[]()!`-]/g, ' ').split(/s+/).filter(Boolean).length;
    const [y, m, d] = (form.date.value || '').split('-');
    head.append(el('p', 'paper__meta', `Brewed ${d && m && y ? `${d}.${m}.${y}` : '—'} · ${Math.floor(words / 200) + 1} min sip`));
    ui.preview.append(head);
    const cover = form.cover.value.trim();
    if (cover) { const img = el('img', 'paper__cover'); img.alt = ''; img.src = blobs.get(cover) || cover; ui.preview.append(img); }
    if (form.quote.value.trim()) {
      const aside = el('aside', 'dialogue dialogue--inline');
      aside.append(el('span', 'dialogue__name', 'Barista'), el('p', null, form.quote.value.trim()));
      ui.preview.append(aside);
    }
    const prose = el('div', 'prose'); prose.innerHTML = html;
    prose.querySelectorAll('img').forEach(img => {   // not uploaded yet: show the local copy, keep any #w= size
      const [base, frag] = String(img.getAttribute('src')).split(/(?=#)/);
      const b = blobs.get(base); if (b) img.src = b + (frag || '');
    });
    ui.preview.append(prose);
    if (window.cafeEmbeds) window.cafeEmbeds.enhance(prose);
  }
  function openPreview() {
    renderPreview();
    ui.overlay.hidden = false; document.body.classList.add('br-noscroll');
    ui.overlay.scrollTop = 0; ui.closePreview.focus();
  }
  function closePreview() { ui.overlay.hidden = true; document.body.classList.remove('br-noscroll'); $('[data-preview-open]').focus(); }
  $('[data-preview-open]').addEventListener('click', openPreview);
  ui.closePreview.addEventListener('click', closePreview);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !ui.overlay.hidden) closePreview(); });

  /* ---------- images (kept locally until Deploy) ---------- */
  function stageImage(file) {
    if (!file) return null;
    if (!file.type.startsWith('image/')) { say(ui.status, 'That file isn’t an image.', 'error'); return null; }
    if (file.size > MAX_IMG) { say(ui.status, `Image is too large (max ${MAX_IMG / 1048576} MB).`, 'error'); return null; }
    const fname = file.name || `pasted.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
    const ext = (fname.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
    const base = slugify(fname.replace(/\.[^.]+$/, ''));
    const stamp = new Date().toISOString().slice(0, 10);
    const key = `/${IMG_DIR}/${stamp}-${base}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    pending.set(key, file); blobs.set(key, URL.createObjectURL(file)); dirty = true;
    say(ui.status, `Image ready — it will be uploaded when you deploy.`);
    return { key, alt: fname.replace(/\.[^.]+$/, '') };
  }
  $('[data-cover-file]').addEventListener('change', e => {
    const staged = stageImage(e.target.files[0]); e.target.value = '';
    if (staged) { form.cover.value = staged.key; dirty = true; }
  });

  /* ---------- deploy / delete ---------- */
  const busy = on => { ui.deploy.disabled = on; ui.del.disabled = on; };

  ui.deploy.addEventListener('click', async () => {
    const f = Object.fromEntries(Object.entries(form).map(([k, el]) => [k, el.value.trim()]));
    f.body = getBody();
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
      setMode(f.title); refreshPath();
      say(ui.status, `Served! GitHub builds the site in ~1–2 minutes: ${postUrl(path)}. ${CACHE_NOTE}`, 'ok');
      await loadList();
      watchBuild(started, path);
    } catch (err) {
      say(ui.status, err.status === 409 && err.message.includes('already')
        ? err.message
        : err.status === 409 ? 'Someone else changed this story meanwhile. Reopen it and try again.'
        : isNoWrite(err) ? `Couldn’t deploy. ${NO_WRITE_HELP}` : `Couldn’t deploy: ${err.message}`, 'error');
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
      say(ui.status, `Removed “${title}”. GitHub rebuilds the site in ~1–2 minutes. ${CACHE_NOTE}`, 'ok');
      await loadList();
    } catch (err) { say(ui.status, isNoWrite(err) ? `Couldn’t delete. ${NO_WRITE_HELP}` : `Couldn’t delete: ${err.message}`, 'error'); }
    finally { busy(false); }
  });

  /* Optional: follow the GitHub Pages build (needs Pages: read on the token; silently skipped otherwise) */
  async function watchBuild(since, path) {
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 8000));
      let b; try { b = await gh('/pages/builds/latest'); } catch { return; }
      if (!b || new Date(b.created_at).getTime() < since - 5000) continue;
      if (b.status === 'built') return say(ui.status, `Live now ✓ ${postUrl(path)} — if you still see the old page, press Ctrl+F5.`, 'ok');
      if (b.status === 'errored') return say(ui.status, `GitHub Pages build failed: ${(b.error && b.error.message) || 'see the repo’s Actions tab'}`, 'error');
    }
  }

  /* ---------- start ---------- */
  const saved = store.get();
  if (saved) {
    show('login');
    say($('[data-login-msg]'), 'Using your saved key…');
    unlock(saved, store.remembered()).then(() => say($('[data-login-msg]'), '')).catch(err => {
      token = null; show('login');
      // Forget the key only when GitHub says it is invalid/expired; a network hiccup or a missing
      // permission keeps it, so fixing the token on GitHub (same value) or retrying is enough.
      if (err.status === 401) {
        store.clear();
        say($('[data-login-msg]'), 'Your saved key has expired or was revoked — please paste a new one.', 'error');
      } else {
        say($('[data-login-msg]'), `Couldn’t use your saved key: ${err.message} — reload the page to try again.`, 'error');
      }
    });
  } else show('login');
})();
