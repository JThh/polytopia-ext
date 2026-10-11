# Tessera Tribes

A hand-drawn, isometric turn-based tribe strategy game: six tribes, 25 technologies, a radial tech tree, storms, sieges, and bots that plan every attack.

The whole game runs in the browser (one self-contained `index.html`). Play solo against bots, pass one device around (**pass & play**), or invite friends to an **online room**. The `api/` folder adds online rooms and a leaderboard; both stay hidden until you connect storage.

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | Game source: rules engine, bot, art, isometric renderer, UI, page shell |
| `build.js` | Bundles `src/` into `public/index.html` (no dependencies) |
| `public/` | Build output that Vercel serves (a built copy is committed, so a deploy works even without the build step) |
| `api/health.js` | `GET /api/health` → `{ ok, leaderboard, rooms }` |
| `api/room.js` | Online rooms: lobby, seats, and the shared move log (see [Online rooms](#online-rooms)) |
| `api/scores.js` | `GET /api/scores` (top 20) and `POST /api/scores` (submit a score) |
| `api/_store.js` | Storage helper (Upstash Redis REST). The `_` prefix keeps it from becoming a route |
| `dev-server.js` | Local preview that mimics Vercel, with in-memory rooms and leaderboard |
| `vercel.json` | Build command, output folder, headers |
| `test/` | Headless rule, determinism, multiplayer and balance checks (see [Tests](#tests)) |
| `ml/` | Training a language model to play The Battle of Polytopia with this engine as its simulator (see [ml/README.md](ml/README.md)) |

## Run it locally

Requires Node 18 or newer.

```bash
cd ~/tessera-tribes
npm run dev          # builds, then serves http://localhost:3000
npm test             # rule invariants, replay determinism, multi-person games
```

`npm run dev` turns on in-memory rooms and an in-memory leaderboard, so you can try online play and score submission locally. Both reset when the server stops. To try a room on one computer, open the second player in a private window or another browser: a browser remembers its seat in each room, so two tabs of the same browser would be the same player.

## Play together

Pick **Players** on the title screen.

### Pass & play

Works everywhere, including the offline build. Choose how many people (2–6); the other seats are bots. Between turns an opaque screen asks the next person to take the device, so nobody sees another tribe's view through the fog. Bot turns run quickly in between.

### Online rooms

Needs the deployed site with storage turned on (see [Turn on online rooms and the leaderboard](#turn-on-online-rooms-and-the-leaderboard)), or `npm run dev` locally.

1. **Host:** choose **Online**, set the map and the number of seats, enter a name, then tap **Create room**.
2. **Invite:** share the link (**Copy invite link**) or the five-letter room code. Friends open the link, or choose **Online** and enter the code, then tap **Join**.
3. **Lobby:** everyone picks a tribe; a tribe someone already holds can't be picked twice. Open seats will be played by bots.
4. **Start:** the host taps **Start**. Everyone enters the same world. You can watch other players' moves as they happen.

If someone drops out or stalls:

- **Reload or reconnect:** opening the link again returns you to your own seat. The browser remembers it.
- **Leaving** from the menu hands your tribe to a bot at once, so nobody waits. Open the link again and tap **Take back my tribe** to return.
- **A stalled turn:** after 60 seconds the host can tap **Give this turn to a bot**. Other players can do it after 90 seconds, in case the host is the one who left.
- **Bot turns** are run by a player's browser (the nearest person seated before the bot). If that browser has gone quiet, **Run the bots** appears after 25 seconds.

How it works: the server keeps only the lobby and an ordered log of moves. Every browser replays that log with the same seeded rules engine, so all copies of the world stay identical. Each move carries a fingerprint of the resulting state; if a browser ever disagrees, it rebuilds the game from the log automatically. Room data expires after 3 days.

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

After either option the game is live at `https://<project>.vercel.app`. Solo and pass & play work right away. Online rooms and the leaderboard stay hidden until the next step.

### Turn on online rooms and the leaderboard

1. In your Vercel project, open **Storage** (or **Integrations → Marketplace**) and add an **Upstash for Redis** database. Connect it to the project.
2. That integration sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` on the project. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work if you create the database directly at upstash.com and add those variables yourself under **Settings → Environment Variables**.
3. Redeploy (`vercel --prod`, or push a commit).
4. Check `https://<project>.vercel.app/api/health`. It should return `{"ok":true,"leaderboard":true,"rooms":true}`. From then on the title screen offers **Online**, and the game-over screen of a solo game offers **Submit score** and shows the top 20.

Storage use: while a player waits for others, their browser checks the room about once a second, and each check is one Redis command. A four-person game uses roughly 10,000 to 15,000 commands per hour of play. Compare that with your Upstash plan's monthly command allowance.

## Tests

```bash
npm test                          # all three below
node test/inv.js                  # 60 bot games across every map type and size, checking rule invariants
node test/replay.js               # record every move, replay on a fresh copy, require identical state (lockstep)
node test/multi.js                # 2–4 people per game, with seats leaving and returning mid-game
node test/balance.js 8 2          # fairness: every tribe pairing, both seat orders (args: seeds per pair, players)
node test/pair.js hard easy 12    # one bot difficulty against another
```

## Train a model to play Polytopia

`ml/` turns the engine into a training simulator for a language model that reads a Polytopia game state and answers with typed actions: a Polytopia ruleset, bot-vs-bot SFT data, supervised fine-tuning, simulation-based RL against the bots, and a JSON bridge for real Polytopia clients. Start with [ml/README.md](ml/README.md); `npm run test:ml` runs its simulator tests.

## Notes and limits

- **Online rooms trust the players.** Moves are checked by every friend's browser, not by the server, so a modified client could cheat. Play with people you know. Anyone with the room code can join an open seat until the game starts.
- **Scores are self-reported.** The server checks ranges, tribe, mode and difficulty, and keeps the best 500. It cannot prove a score was earned, because the game runs on the player's device. Treat the board as casual. For anything competitive you would need server-side game replays or rate limiting (for example Vercel Firewall rules on `/api/scores`).
- **No accounts and no personal data.** Only a display name (20 characters, cleaned) is stored.
- **Saves stay local.** In-progress games live in the browser's `localStorage`. They don't sync between devices.
- **Fonts** load from Google Fonts. Everything else is inlined into `index.html`.
