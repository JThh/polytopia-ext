// The online database (supabase/migrations) checked in an in-process Postgres with a Supabase-like auth stub:
// profiles, rooms, invites, the move log's seat rules, row-level security, matchmaking and records.
// Needs PGlite, which is not a dependency of the game:  npm i --no-save @electric-sql/pglite && node test/db.js
const fs = require('fs');
const path = require('path');
const MIG = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort().map(f => fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', f), 'utf8')).join('\n');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('FAIL', m); } };
(async () => {
  let PGlite;
  try { ({ PGlite } = await import('@electric-sql/pglite')); }
  catch (e) { console.log('skipped: install PGlite to run the database checks (npm i --no-save @electric-sql/pglite)'); return; }
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  await db.exec(MIG);
  await db.exec(MIG); // re-runnable
  const U = {}; const names = ['Ana', 'Ben', 'Cyr', 'Dee', 'Eve', 'Fay'];
  for (const n of names) { U[n] = (await db.query('select gen_random_uuid() as id')).rows[0].id; await db.query('insert into auth.users values ($1)', [U[n]]); }
  // run SQL as a signed-in user (or anon when uid is null); returns rows or the error message
  async function as(who, sql, params) {
    try {
      return await db.transaction(async tx => {
        await tx.query(who ? 'set local role authenticated' : 'set local role anon');
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [who ? U[who] : '']);
        const r = await tx.query(sql, params || []);
        return r.rows;
      });
    } catch (e) { return { error: e.message }; }
  }
  const one = async (who, sql, params) => { const r = await as(who, sql, params); return r.error ? r : r[0] && Object.values(r[0])[0]; };

  // profiles
  for (const n of names) ok(!(await one(n, 'select claim_username($1, $2)', [n, 'verdant'])).error, 'claim ' + n);
  ok(/taken/.test((await one('Fay', 'select claim_username($1)', ['ana'])).error || ''), 'duplicate name refused (case-insensitive)');
  ok(/letters/.test((await one('Fay', 'select claim_username($1)', ['a b'])).error || ''), 'bad name refused');
  const found = await one('Ben', 'select search_players($1)', ['an']);
  ok(Array.isArray(found) && found.length === 1 && found[0].username === 'Ana', 'search finds Ana: ' + JSON.stringify(found));
  ok((await one('Ana', 'select search_players($1)', ['an'])).length === 0, 'search excludes yourself');
  ok(/permission denied/.test((await one(null, 'select search_players($1)', ['a'])).error || ''), 'guests cannot call functions');

  // private room
  const made = await one('Ana', 'select create_room($1, $2)', [{ opponents: 3, size: 'tiny', mapType: 'lakes', mode: 'score', fog: false }, 'emberfolk']);
  ok(made.code && made.code.length === 5 && made.seat === 0, 'create room ' + JSON.stringify(made));
  const room = made.room_id;
  const jb = await one('Ben', 'select join_room($1, $2)', [made.code.toLowerCase(), 'emberfolk']);
  ok(jb.seat === 1, 'Ben joins seat 1 by code');
  let info = await one('Ana', 'select room_info($1)', [room]);
  ok(info.players[1].tribe !== 'emberfolk' && info.players[0].tribe === 'emberfolk', 'taken tribe not duplicated');
  ok(/Another player/.test((await one('Ben', 'select set_tribe($1, $2)', [room, 'emberfolk'])).error || ''), 'cannot take a held tribe');
  ok(!(await one('Ben', 'select set_tribe($1, $2)', [room, 'frostkin'])).error, 'Ben picks Snow');
  ok(info.room.settings.fog === false && info.room.settings.mode === 'score' && info.room.seat_count === 4, 'settings cleaned');
  ok(/Only the host/.test((await one('Ben', 'select update_room($1, $2)', [room, { opponents: 1 }])).error || ''), 'only host updates');
  ok(/removing/.test((await one('Ana', 'select update_room($1, $2)', [room, { opponents: 0 }])).error || '') || (await one('Ana', 'select room_info($1)', [room])).room.seat_count >= 2, 'cannot shrink below seated');
  ok(!(await one('Ana', 'select update_room($1, $2)', [room, { opponents: 4, size: 'tiny', mapType: 'lakes', mode: 'score', fog: false }])).error, 'host sets 5 seats');
  // invite
  ok(!(await one('Ana', 'select invite_player($1, $2)', [room, U.Cyr])).error, 'invite Cy');
  const inv = await one('Cyr', 'select my_invites()');
  ok(inv.length === 1 && inv[0].from === 'Ana' && inv[0].taken === 2, 'Cy sees the invite');
  ok((await one('Cyr', 'select room_info($1)', [room])).players.length === 2, 'invited player can preview the room');
  ok((await as('Dee', 'select count(*)::int as n from rooms where id = $1', [room]))[0].n === 0, 'outsider cannot see the room');
  ok(/not in this room/.test((await one('Dee', 'select room_info($1)', [room])).error || ''), 'outsider cannot read room info');
  const acc = await one('Cyr', 'select respond_invite($1, true, $2)', [inv[0].id, 'tidecallers']);
  ok(acc.seat === 2, 'Cy accepts into seat 2');
  ok((await one('Cyr', 'select my_invites()')).length === 0, 'invite cleared');
  // Ben leaves the lobby, leaving a gap at seat 1
  ok(!(await one('Ben', 'select leave_room($1)', [room])).error, 'Ben leaves');
  ok(/Only the host/.test((await one('Cyr', 'select start_room($1)', [room])).error || ''), 'only host starts');
  ok(!(await one('Ana', 'select start_room($1)', [room])).error, 'host starts');
  info = await one('Cyr', 'select room_info($1)', [room]);
  const fin = info.room.final;
  ok(info.room.status === 'playing' && JSON.stringify(fin.humans) === '[0,2]' && fin.tribes.length === 5 && fin.tribes[1] === null && fin.tribes[2] === 'tidecallers' && fin.seed > 0, 'final settings ' + JSON.stringify(fin));
  ok(JSON.stringify(info.room.bot_seats) === '[1,3,4]', 'bot seats ' + JSON.stringify(info.room.bot_seats));
  ok(/already started/.test((await one('Dee', 'select join_room($1)', [made.code])).error || ''), 'cannot join a running game');
  // moves
  const push = (who, base, entries) => one(who, 'select push_moves($1, $2, $3, $4)', [room, base, 'dev-' + who, JSON.stringify(entries)]);
  let r = await push('Ana', 0, [{ seat: 0, cmds: [['endTurn']], h: 'x' }]);
  ok(r.len === 1 && !r.conflict, 'Ana pushes');
  r = await push('Cyr', 0, [{ seat: 2, cmds: [] }]);
  ok(r.conflict && r.len === 1, 'stale base is a conflict');
  ok(/not yours/.test((await push('Cyr', 1, [{ seat: 0, cmds: [] }])).error || ''), 'cannot move for another person');
  ok((await push('Cyr', 1, [{ seat: 1, cmds: [['endTurn']] }])).len === 2, 'any player may run a bot turn');
  ok(/own seat/.test((await push('Cyr', 2, [{ seat: 0, sys: 'human' }])).error || ''), 'cannot take back someone else');
  ok(/already a bot/.test((await push('Cyr', 2, [{ seat: 3, sys: 'botify' }])).error || ''), 'cannot botify a bot seat');
  ok((await push('Ana', 2, [{ seat: 2, sys: 'botify' }])).len === 3, 'hand Cy to a bot');
  ok((await push('Ana', 3, [{ seat: 2, cmds: [] }])).len === 4, 'now anyone may move Cy\'s seat');
  ok((await push('Cyr', 4, [{ seat: 2, sys: 'human' }])).len === 5, 'Cy takes the seat back');
  ok(/not yours/.test((await push('Ana', 5, [{ seat: 2, cmds: [] }])).error || ''), 'after take-back it is Cy\'s again');
  ok(/not seated/.test((await push('Dee', 5, [{ seat: 3, cmds: [] }])).error || ''), 'outsider cannot push');
  ok((await as('Cyr', 'select count(*)::int as n from moves where room_id = $1', [room]))[0].n === 5, 'seated player reads moves');
  ok((await as('Dee', 'select count(*)::int as n from moves where room_id = $1', [room]))[0].n === 0, 'outsider reads no moves');
  ok(/permission denied/.test((await as('Ana', "insert into moves (room_id, seq, author, seat) values ($1, 99, $2, 0)", [room, U.Ana])).error || ''), 'no direct inserts');
  ok(/permission denied/.test((await as('Ana', "update rooms set status = 'finished' where id = $1", [room])).error || ''), 'no direct updates');
  ok(/permission denied/.test((await as('Ana', "select tt_join($1, 'verdant')", [room])).error || ''), 'internal helpers are closed');
  const mine = await one('Cyr', 'select my_rooms()');
  ok(mine.length === 1 && mine[0].status === 'playing' && mine[0].seat === 2, 'my rooms lists the game');

  // random matching: 3 players
  let m = await one('Dee', 'select find_match(3, $1)', ['sunspire']);
  ok(m.waiting === 1, 'Dee waits ' + JSON.stringify(m));
  m = await one('Eve', 'select find_match(3, $1)', ['sunspire']);
  ok(m.waiting === 2, 'Eve waits');
  m = await one('Fay', 'select find_match(3, $1)', ['sunspire']);
  ok(m.room_id, 'Fay completes a match ' + JSON.stringify(m));
  const mroom = m.room_id;
  ok((await one('Dee', 'select find_match(3, $1)', ['sunspire'])).room_id === mroom, 'Dee learns her match on the next check');
  const mi = await one('Eve', 'select room_info($1)', [mroom]);
  const tribes = mi.players.map(p => p.tribe);
  ok(mi.players.length === 3 && new Set(tribes).size === 3 && mi.room.status === 'playing' && mi.room.kind === 'match', 'match room ' + JSON.stringify(mi.players.map(p => [p.seat, p.username, p.tribe])));
  ok(mi.players.find(p => p.username === 'Dee').tribe === 'sunspire', 'earliest searcher keeps the contested tribe');
  ok(JSON.stringify(mi.room.final.humans) === '[0,1,2]' && mi.room.final.mode === 'score', 'all seats human');
  // seats are shuffled: over several matches the first searcher should not always be seat 0
  const seat0 = new Set();
  for (let k = 0; k < 8; k++) {
    await db.query('delete from match_queue');
    await one('Ana', 'select find_match(2, $1)', ['verdant']);
    const mm = await one('Ben', 'select find_match(2, $1)', ['ironpeak']);
    const pi = await one('Ana', 'select room_info($1)', [mm.room_id]);
    seat0.add(pi.players[0].username);
  }
  ok(seat0.size === 2, 'seat order is random across matches');
  // bots fill when allowed; stale searchers are skipped
  await db.query('delete from match_queue');
  await one('Ana', 'select find_match(4, $1)', ['verdant']);
  await db.query("update match_queue set seen_at = now() - interval '1 minute' where user_id = $1", [U.Ana]);
  m = await one('Ben', 'select find_match(4, $1, true)', ['verdant']);
  ok(m.waiting === 1, 'stale searcher is not matched');
  m = await one('Cyr', 'select find_match(4, $1, true)', ['verdant']);
  ok(m.room_id, 'two searchers + bots start when allowed');
  const bi = await one('Cyr', 'select room_info($1)', [m.room_id]);
  ok(bi.players.length === 2 && bi.room.bot_seats.length === 2 && bi.room.seat_count === 4, 'two humans, two bots');
  ok(new Set(bi.players.map(p => p.tribe)).size === 2, 'two searchers wanting the same tribe get different tribes');
  ok(!(await one('Dee', 'select cancel_match()')).error, 'cancel');

  // records, profile, leaderboard (game_results are written by the server with the service key)
  await db.query(`insert into game_results (game_id, user_id, kind, tribe, won, place, score, turns, seats, humans) values
    (gen_random_uuid(), $1, 'online', 'emberfolk', true, 1, 900, 30, 3, 3), (gen_random_uuid(), $1, 'online', 'emberfolk', false, 2, 500, 30, 3, 3),
    (gen_random_uuid(), $1, 'solo', 'verdant', true, 1, 1500, 40, 4, 1), (gen_random_uuid(), $2, 'online', 'frostkin', true, 1, 800, 30, 2, 2)`, [U.Ana, U.Ben]);
  const pa = await one('Ben', 'select get_profile($1)', ['ANA']);
  ok(pa.totals.online.games === 2 && pa.totals.online.wins === 1 && pa.totals.solo.best === 1500 && !pa.me, 'profile totals ' + JSON.stringify(pa.totals));
  ok(pa.tribes.find(t => t.tribe === 'emberfolk' && t.kind === 'online').wins === 1 && pa.recent.length === 3, 'per-tribe record');
  ok((await one('Ana', 'select get_profile(null)')).me === true, 'own profile');
  const lb = await one('Cyr', 'select leaderboard()');
  ok(lb.online[0].wins === 1 && lb.solo[0].best === 1500, 'leaderboard ' + JSON.stringify(lb));
  ok(/permission denied/.test((await as('Ana', "insert into game_results (game_id, user_id, kind, tribe, won, place, score, turns, seats, humans) values (gen_random_uuid(), $1, 'online', 'verdant', true, 1, 1, 1, 2, 2)", [U.Ana])).error || ''), 'players cannot write records');
  // host leaving a lobby hands it over
  const r2 = await one('Dee', 'select create_room($1)', [{ opponents: 2 }]);
  await one('Eve', 'select join_room($1)', [r2.code]);
  await one('Dee', 'select leave_room($1)', [r2.room_id]);
  ok((await one('Eve', 'select room_info($1)', [r2.room_id])).room.host === U.Eve, 'host passes to the next player');
  await one('Eve', 'select leave_room($1)', [r2.room_id]);
  ok((await db.query('select status from rooms where id = $1', [r2.room_id])).rows[0].status === 'abandoned', 'empty lobby is abandoned');

  console.log({ dbChecks: passes, failures: fails });
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
