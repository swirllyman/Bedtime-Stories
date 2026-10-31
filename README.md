# Bedtime Stories

Three new bedtime stories every day for kids ages 1 to 6, as a plain, text-only site on GitHub Pages.

- **Tonight**: today's 3 stories (ages 1–2, 3–4, 5–6).
- **Archive**: every story so far, newest first.
- **Favorites**: stories you starred, saved in your phone's browser (with a backup code you can copy and restore).
- Dark mode by default, a light mode toggle, and A− / A+ text size. The screen stays awake while a story is open.

## How it works

A GitHub Action (`.github/workflows/daily.yml`) runs every morning (US Pacific). It calls Claude to write 3 stories, saves them in `stories/`, commits them, and redeploys the site. Pushing code to `main` also redeploys the site, without generating stories.

```
stories/index.json        list of every story (what the site reads)
stories/YYYY-MM-DD.json   that day's 3 full stories
scripts/generate.mjs      the generator
```

## Setup

1. **Settings → Pages**: set *Source* to **GitHub Actions**.
2. **Settings → Secrets and variables → Actions**: add a secret named `ANTHROPIC_API_KEY` (create a key at console.anthropic.com; setting a monthly spend limit there is a good idea).
3. **Actions → Daily stories and site deploy → Run workflow** to generate today's stories right away.

The site lives at `https://<your-username>.github.io/<repo-name>/`.

## Changing things

- **Time of day**: edit the `cron` line in `daily.yml` (it's in UTC).
- **Model**: set `STORY_MODEL` in the workflow's `env` (default `claude-sonnet-5-5`).
- **Story style or lengths**: edit `SYSTEM` and `buildPrompt` in `scripts/generate.mjs`.
- **Regenerate a day**: `node scripts/generate.mjs 2026-11-05 --force` locally with `ANTHROPIC_API_KEY` set.
