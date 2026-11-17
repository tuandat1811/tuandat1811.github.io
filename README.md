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

## Scheduled stories

A story dated in the future (front matter `date:`, Vietnam time unless it says otherwise) stays hidden
until that time. GitHub Pages only rebuilds on a push, so `.github/workflows/scheduled-stories.yml`
checks every 15 minutes whether a story has come due and, if so, asks Pages to rebuild.

GitHub's built-in schedule is unreliable on a quiet repository (it can skip hours), so the workflow is
started from outside by [cron-job.org](https://cron-job.org) (free):

1. **Token** — GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
   Repository access: only this repository. Permissions → Repository permissions → **Actions: Read and write**
   (nothing else). Set an expiry and note it — the trigger silently stops when the token expires.
2. **Cron job** on cron-job.org → Create cronjob:
   - URL: `https://api.github.com/repos/tuandat1811/tuandat1811.github.io/actions/workflows/scheduled-stories.yml/dispatches`
   - Schedule: every 15 minutes
   - Advanced → Request method: `POST`
   - Advanced → Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
     `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`
   - Advanced → Request body: `{"ref":"main"}`
   - Use "Test run": GitHub answers **204 No Content** when it works.
3. Check the repository's **Actions** tab: "Serve scheduled stories" runs with event `workflow_dispatch`
   every 15 minutes. Runs with nothing due finish in seconds and don't touch the site.

If a story still hasn't appeared, push an empty commit (`git commit --allow-empty -m Rebuild && git push`)
or press "Update" on it in the back room — either one rebuilds the site.

## Run locally

```bash
bundle install
bundle exec jekyll serve --drafts
```
