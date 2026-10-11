# Tessera Tribes

A hand-drawn, isometric turn-based tribe strategy game: six tribes, 25 technologies, a radial tech tree, storms, sieges, and bots that plan every attack.

The whole game runs in the browser (one self-contained `index.html`). The `api/` folder adds an **optional** online leaderboard that stays hidden until you connect storage.

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | Game source: rules engine, bot, art, isometric renderer, UI, page shell |
| `build.js` | Bundles `src/` into `public/index.html` (no dependencies) |
| `public/` | Build output that Vercel serves (a built copy is committed, so a deploy works even without the build step) |
| `api/health.js` | `GET /api/health` → `{ ok, leaderboard }` |
| `api/scores.js` | `GET /api/scores` (top 20) and `POST /api/scores` (submit a score) |
| `api/_store.js` | Storage helper (Upstash Redis REST). The `_` prefix keeps it from becoming a route |
| `dev-server.js` | Local preview that mimics Vercel, with an in-memory leaderboard |
| `vercel.json` | Build command, output folder, headers |
| `test/` | Headless rule checks (`npm test`) and bot-vs-bot comparison |

## Run it locally

Requires Node 18 or newer.

```bash
cd ~/tessera-tribes
npm run dev          # builds, then serves http://localhost:3000
npm test             # 60 bot-only games with rule invariants
```

`npm run dev` turns on an in-memory leaderboard so you can try score submission. It resets when the server stops.

## Publish on Vercel

### Option A: Vercel CLI (fastest)

```bash
npm i -g vercel      # once
cd ~/tessera-tribes
vercel               # first run: log in, accept the detected settings
vercel --prod        # promote to your production URL
```

The settings come from `vercel.json`: build command `node build.js`, output directory `public`, no framework. Vercel picks up the functions in `api/` automatically.

### Option B: Git import

1. Push this folder to a GitHub, GitLab or Bitbucket repository:
   ```bash
   cd ~/tessera-tribes
   git init && git add . && git commit -m "Tessera Tribes"
   git remote add origin <your-repo-url> && git push -u origin main
   ```
2. In the Vercel dashboard choose **Add New → Project** and import the repository.
3. Leave **Framework Preset** on **Other**. The build command and output directory are read from `vercel.json`.
4. Click **Deploy**. Every later push redeploys automatically.

After either option the game is live at `https://<project>.vercel.app`. The leaderboard stays hidden until the next step.

### Turn on the leaderboard (optional)

1. In your Vercel project, open **Storage** (or **Integrations → Marketplace**) and add an **Upstash for Redis** database. Connect it to the project.
2. That integration sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` on the project. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work if you create the database directly at upstash.com and add those variables yourself under **Settings → Environment Variables**.
3. Redeploy (`vercel --prod`, or push a commit).
4. Check `https://<project>.vercel.app/api/health`. It should return `{"ok":true,"leaderboard":true}`. From then on, the game-over screen offers **Submit score** and shows the top 20.

## Notes and limits

- **Scores are self-reported.** The server checks ranges, tribe, mode and difficulty, and keeps the best 500. It cannot prove a score was earned, because the game runs on the player's device. Treat the board as casual. For anything competitive you would need server-side game replays or rate limiting (for example Vercel Firewall rules on `/api/scores`).
- **No accounts and no personal data.** Only a display name (20 characters, cleaned) is stored.
- **Saves stay local.** In-progress games live in the browser's `localStorage`. They don't sync between devices.
- **Fonts** load from Google Fonts. Everything else is inlined into `index.html`.
