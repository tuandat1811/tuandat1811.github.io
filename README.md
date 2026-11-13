# ☕ Aerial's Corner — tuandat1811.github.io

A late-night café blog built with Jekyll. GitHub Pages builds it automatically on every push to `main`.
The interface is in English; posts can be written in Vietnamese (all fonts include Vietnamese glyphs, and the site's `lang` is `vi`).

## Brewing a new story

Create `_posts/YYYY-MM-DD-your-title.md` (use an ASCII file name — it becomes the URL, e.g. `/p/your-title/`):

```markdown
---
title: "Affogato — đơn giản mà hoàn hảo"
drink: Affogato          # optional: what's in the cup tonight
cover: /assets/img/posts/affogato.jpg   # optional cover image
quote: "One line the barista says when serving it."  # optional
---

Your story here…
```

A full example lives in `_drafts/welcome-to-the-cafe.md` (drafts are not published).

## Run locally

```bash
bundle install
bundle exec jekyll serve --drafts
```
