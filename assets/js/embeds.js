/* ☕ Aerial's Corner — turn a lone YouTube / Vimeo / Spotify link into a player.
   In a story, put the link on its own line. The Markdown keeps just the URL, so the post
   still reads fine anywhere; on the site this script swaps the link for an embed. */
(() => {
  const parseStart = t => {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return +t;
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  };

  const providers = [
    {
      name: 'youtube', label: 'YouTube video',
      match(u) {
        const host = u.hostname.replace(/^(www|m|music)\./, '');
        let id = null;
        if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
        else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
          if (u.pathname === '/watch') id = u.searchParams.get('v');
          else { const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/); if (m) id = m[1]; }
        }
        if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
        const start = parseStart(u.searchParams.get('t') || u.searchParams.get('start'));
        return { src: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`, kind: 'video' };
      },
    },
    {
      name: 'vimeo', label: 'Vimeo video',
      match(u) {
        if (!/^(www\.|player\.)?vimeo\.com$/.test(u.hostname)) return null;
        const m = u.pathname.match(/^\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?\/?$/);
        if (!m) return null;
        const hash = m[2] || u.searchParams.get('h');
        return { src: `https://player.vimeo.com/video/${m[1]}${hash ? `?h=${hash}` : ''}`, kind: 'video' };
      },
    },
    {
      name: 'spotify', label: 'Spotify player',
      match(u) {
        if (u.hostname !== 'open.spotify.com') return null;
        const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
        if (!m) return null;
        return { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, kind: /^(track|episode)$/.test(m[1]) ? 'audio-small' : 'audio-large' };
      },
    },
  ];

  /** Returns { provider, label, src, kind } for a supported link, otherwise null. */
  function toEmbed(raw) {
    let u;
    try { u = new URL(String(raw).trim()); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    for (const p of providers) {
      const hit = p.match(u);
      if (hit) return { provider: p.name, label: p.label, ...hit };
    }
    return null;
  }

  function build(embed, href) {
    const fig = document.createElement('figure');
    fig.className = `embed embed--${embed.provider} embed--${embed.kind}`;
    const frame = document.createElement('div');
    frame.className = 'embed__frame';
    const iframe = document.createElement('iframe');
    iframe.src = embed.src;
    iframe.title = embed.label;
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'; // YouTube refuses to play without a referrer
    frame.append(iframe);
    const cap = document.createElement('figcaption');
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = `Open on ${embed.label.split(' ')[0]} ↗`;
    cap.append(a);
    fig.append(frame, cap);
    return fig;
  }

  /** Swap every paragraph that holds nothing but a supported link for a player. */
  function enhance(root) {
    if (!root) return;
    root.querySelectorAll('p').forEach(p => {
      if (p.closest('li, blockquote, table, .embed')) return;
      const nodes = [...p.childNodes].filter(n => !(n.nodeType === 3 && !n.textContent.trim()) && n.nodeName !== 'BR');
      if (nodes.length !== 1) return;
      const n = nodes[0];
      let href = null;
      if (n.nodeType === 3) href = n.textContent.trim();
      else if (n.nodeName === 'A' && /^https?:\/\//.test(n.textContent.trim())) href = n.getAttribute('href');
      if (!href) return;
      const embed = toEmbed(href);
      if (embed) p.replaceWith(build(embed, href));
    });
  }

  window.cafeEmbeds = { toEmbed, enhance };
  const run = () => document.querySelectorAll('.prose').forEach(enhance);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
