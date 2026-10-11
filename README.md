# Tessera Tribes

A hand-drawn, isometric turn-based tribe strategy game: six tribes, 25 technologies, a radial tech tree, storms, sieges, and bots that plan every attack.

Play solo against bots, or online against people on other devices: sign in with Google, find friends by name or get matched with random players, and keep a profile with every game you've played and your wins with each tribe.

The game runs in the browser. Online play uses [Supabase](https://supabase.com) for sign-in, the database and realtime updates, plus one small Vercel function that checks each finished game before recording it.

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | Game source: rules engine, bot, art, isometric renderer, online client, UI, page shell |
| `build.js` | Bundles `src/` into `public/index.html` (no dependencies). Online play is switched on when Supabase settings are present |
| `public/` | Build output (not committed; Vercel builds it) |
| `supabase/migrations/` | Database schema: profiles, rooms, move log, invites, matchmaking, game records, row-level security |
| `scripts/supabase-setup.js` | Applies the schema and sets up sign-in on your Supabase project |
| `api/finish.js` | `POST /api/finish`: replays a finished game with the rules engine, then records each player's result |
| `api/health.js` | `GET /api/health` → `{ ok, online, records }` |
| `api/_verify.js`, `api/_sb.js` | Game verifier and server-side Supabase helper (the `_` prefix keeps them from becoming routes) |
| `dev-server.js` | Local preview that mimics Vercel (serves `public/`, runs `api/`) |
| `env.js` | Loads `.env.local` for the build and the dev server |
| `test/` | Rules, determinism, multiplayer, verifier and database checks (see [Tests](#tests)) |

## Run it locally

Requires Node 18 or newer.

```bash
cd ~/tessera-tribes
npm run dev          # builds, then serves http://localhost:3000
npm test             # headless checks
```

Without Supabase settings the game is solo only. To play online locally, add your project's settings to `.env.local` (see below) and run `npm run dev` again. To try two players on one computer, use two different browsers or a private window, each signed in with a different Google account.

## Playing online

Choose **Online** on the title screen and sign in with Google. The first time, pick a player name (3 to 16 letters, digits or `_`). Others find you by it.

- **Quick match.** Choose **1 v 1**, **3 players** or **4 players**, then **Find match**. You're paired with other people searching for the same size; seats are drawn at random, so nobody always moves first. Matches use a 30-turn score victory. In 3- and 4-player searches, **Start now with bots** appears after 20 seconds once at least one other person is waiting.
- **Play with friends.** Type a name under **Play with friends** and tap **Invite**. That creates a room and sends the invite, which pops up on their screen wherever they are. You can also share the room link or its five-letter code. In the room, the host picks the map, size, number of seats, bot strength and victory type, and everyone picks a tribe. Open seats are played by bots.
- **Your games.** Unfinished games are listed on the title screen with **Rejoin**. Reloading the page or opening the link again also brings you back to your seat.
- **Profile.** Tap your name for your record: online wins, wins against bots, best score, wins with each tribe, and recent games. Tap anyone's name in search or the leaderboard to see theirs.
- **When someone drops out.** Leaving from the menu hands your tribe to a bot at once; **Take back my tribe** returns it. If a player stalls, the host can **Give this turn to a bot** after 60 seconds (anyone else after 90). Bot turns are run by a player's browser; if that player has gone quiet, **Run the bots** appears after 25 seconds.

How it works: the database keeps an ordered log of moves. Every device replays that log with the same seeded rules engine, so all copies of the world stay identical; realtime messages tell devices when a new move lands, with polling as a fallback. When a game ends, `/api/finish` replays the whole log on the server. It refuses logs where someone moved a seat they didn't control, moved out of turn, or made an illegal move. Only then does it write everyone's result.

## Publish

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com) (the free plan works).
2. From **Project Settings → API**, copy the **Project URL**, the **anon** (publishable) key and the **service_role** (secret) key. Under **Account → Access Tokens**, create a personal access token.
3. Put them in `~/tessera-tribes/.env.local` (git-ignored):
   ```
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   SUPABASE_ACCESS_TOKEN=sbp_...
   ```

### 2. Google sign-in

1. In [Google Cloud console](https://console.cloud.google.com/apis/credentials), choose **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized redirect URIs**, add `https://<ref>.supabase.co/auth/v1/callback`.
3. Add the client ID and secret to `.env.local`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

### 3. Apply the schema and sign-in settings

```bash
node scripts/supabase-setup.js --site https://<your-project>.vercel.app
```

This applies `supabase/migrations/`, allows sign-in redirects to your site and to `http://localhost:3000`, and turns on Google sign-in. It's safe to run again, for example after you add a custom domain. (Instead, you can paste the SQL into the Supabase SQL editor and set **Authentication → URL Configuration** and **Sign In / Providers → Google** by hand.)

Optional: under **Authentication → Sign In / Providers → Email**, turn off email sign-ups so that Google is the only way in. The automated tests create throwaway users through the admin API, so they still work.

### 4. Vercel

Using the CLI:

```bash
npm i -g vercel      # once
cd ~/tessera-tribes
vercel               # first run: log in, accept the detected settings
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel --prod
```

Or import the GitHub repository in the Vercel dashboard (**Add New → Project**, framework preset **Other**) and add the same three variables under **Settings → Environment Variables**. Settings come from `vercel.json`: build command `node build.js`, output directory `public`.

The service-role key stays on the server; only `/api/finish` uses it. The URL and anon key are baked into the page at build time. They are public by design, and row-level security protects the data. Redeploy after changing any variable.

Check `https://<project>.vercel.app/api/health`. It should return `{"ok":true,"online":true,"records":true}`.

## Tests

```bash
npm test                          # all of the below except balance and pair
node test/inv.js                  # 60 bot games across every map type and size, checking rule invariants
node test/replay.js               # record every move, replay on a fresh copy, require identical state (lockstep)
node test/multi.js                # 2–4 people per game, with seats leaving and returning mid-game
node test/verify.js               # the /api/finish verifier: real games verify; forged, out-of-turn and illegal logs are refused
node test/db.js                   # the database functions and row-level security (needs: npm i --no-save @electric-sql/pglite)
node test/balance.js 8 2          # fairness: every tribe pairing, both seat orders (args: seeds per pair, players)
node test/pair.js hard easy 12    # one bot difficulty against another
```

## Notes and limits

- **Online records are verified; solo records less so.** An online result is written only after the server replays every move and checks who made it. A solo result is checked to be a legal, finished game, but the bots' moves come from the player's browser, so a modified client could hand itself weak opponents. Solo and online records are shown separately.
- **Players in a room can use the seat buttons on each other.** Any seated player may run a bot's turn or hand a stalled seat to a bot. The verifier rejects moves for seats a player doesn't control, but casual misuse of these buttons is possible.
- **Accounts store a player name and game records** (tribe, result, score, opponents, date). Google handles the sign-in; the game never sees the Google password.
- **Usage.** Realtime keeps most traffic event-driven; a device falls back to checking the room every 4 seconds if the realtime connection drops. Compare that with your Supabase plan's limits if you expect heavy use. Finished rooms and their move logs are kept; delete old rows from `rooms` if storage becomes a concern (moves cascade).
- **Saves.** An unfinished solo game is saved in the browser; online games live in the database and can be rejoined from any device.
- **Fonts** load from Google Fonts and supabase-js from jsDelivr (pinned, with an integrity hash). Everything else is in `index.html`.
