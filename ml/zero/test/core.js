// PolyZero simulator checks: the atomic action space is exhaustive and every listed action is playable, quads and
// tuples convert both ways, observations respect fog of war (and the frozen view of a search), and the server
// protocol plays a whole game with search handles that are all freed again.
'use strict';
process.env.POLY_RULES = process.env.POLY_RULES || 'polytopia_live';
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const TT = require('../../sim/tt');
const A = require('../../sim/actions');
const configs = require('../../sim/configs');
const C = require('../sim/core');

let fails = 0, checks = 0;
const check = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL', msg); } };
const N = Number(process.argv[2] || 8);

// ---- bot games: every bot action is in the legal list; every legal action plays; quads <-> tuples
{
  let hit = 0, miss = 0, forced = 0, played = 0, sizes = 0, positions = 0;
  const verbs = {};
  let pendingOther = 0;
  for (let g = 0; g < N; g++) {
    const { settings, difficulties } = configs.sample(900 + g, { sizes: { tiny: 1, small: 1, normal: 1 }, players: [2, 4] });
    TT.ML.seedRandom(g);
    const st = TT.newGame(Object.assign({}, settings, { humans: [] }));
    st.players.forEach((P, i) => { P.difficulty = difficulties[i]; });
    let k = 0;
    TT.ML.listen(st, {
      before(s, name, args) {
        const t = A.fromCommand(s, name, args), q = C.fromTuple(s, t), L = C.legal(s, s.current);
        verbs[t[1]] = (verbs[t[1]] || 0) + 1;
        positions++; sizes += L.length / 4;
        if (k++ % 25 === 0) { // every legal action plays on a copy, and survives a tuple round trip
          for (let i = 0; i < L.length; i += 4) {
            const qq = Array.from(L.subarray(i, i + 4)), c = TT.ML.clone(s), r = C.apply(c, s.current, qq);
            check(r.ok || r.end, 'legal action plays: ' + JSON.stringify(r.tuple) + ' ' + r.err);
            const back = C.fromTuple(s, C.toTuple(s, qq));
            check(back && back.join() === qq.join(), 'quad -> tuple -> quad: ' + qq.join());
            played++;
          }
        }
        return { q, L, t };
      },
      after(s, name, args, r, ctx) {
        if (!r) return;
        if (ctx.q && C.indexOf(ctx.L, ctx.q) >= 0) hit++;
        else if (ctx.L[0] === C.V.reward && name === 'endTurn') forced++;
        else if (ctx.L[0] === C.V.reward) pendingOther++;
        else { miss++; console.log('FAIL bot action not in the legal list:', name, JSON.stringify(ctx.t)); }
      },
    });
    while (!st.over && st.turn <= 25) { TT.ML.botTurn(st); if (!st.over) TT.endTurn(st); }
  }
  check(miss === 0, 'every bot action is a legal atomic action (' + hit + ' matched, ' + miss + ' missing)');
  check(hit > 1000 && played > 1000, 'enough coverage (' + hit + ' bot actions, ' + played + ' legal actions played)');
  console.log('bot actions matched ' + hit + ' (+' + forced + ' turn ends with a reward pending), legal actions played ' + played +
    ', mean legal set ' + (sizes / positions).toFixed(1) + ' (' + TT.RULESET.name + '); ' + pendingOther + ' bot actions taken while a reward was pending');
  console.log('bot verbs: ' + Object.keys(verbs).map(v => v + ' ' + verbs[v]).join(', '));
}

// ---- observations: shapes, fog of war, frozen view
{
  const st = TT.newGame({ tribes: ['oumaji', 'bardur'], humans: [0], opponents: 1, size: 'small', mapType: 'drylands', seed: 21 });
  const pid = st.current, W = st.W, o = C.encode(st, pid);
  check(o.tiles.length === C.PAD * C.PAD * C.F && o.glob.length === C.G, 'observation sizes');
  let fogOk = true, padOk = true;
  for (let y = 0; y < C.PAD; y++) for (let x = 0; x < C.PAD; x++) {
    const t = o.tiles[(y * C.PAD + x) * C.F];
    if (x >= W || y >= st.H) { if (t !== 0) padOk = false; continue; }
    if (!st.players[pid].explored[y * W + x] && (t !== 1 || o.tiles[(y * C.PAD + x) * C.F + 11] !== 0)) fogOk = false;
  }
  check(padOk, 'padding is off-map (code 0)');
  check(fogOk, 'unexplored tiles show nothing, units included');
  check(o.glob[C.GLOB.indexOf('ended')] === 0 && C.encode(st, pid, { ended: true }).glob[C.GLOB.indexOf('ended')] === 1, 'ended flag');
  // a move that reveals tiles: with the frozen root view they stay hidden
  const u = st.units.find(x => x.owner === pid), view = Uint8Array.from(st.players[pid].explored);
  let best = null;
  for (const i of TT.moveTargets(st, u)) {
    const c = TT.ML.clone(st), uu = TT.getUnit(c, u.id);
    TT.move(c, uu.id, i % W, (i / W) | 0);
    const gained = c.players[pid].explored.reduce((a, e, j) => a + (e && !view[j] ? 1 : 0), 0);
    if (!best || gained > best.gained) best = { c, gained };
  }
  check(best && best.gained > 0, 'some move reveals new tiles');
  if (best) {
    const live = C.encode(best.c, pid), frozen = C.encode(best.c, pid, { view });
    let seenLive = 0, seenFrozen = 0;
    for (let i = 0; i < C.PAD * C.PAD; i++) { if (live.tiles[i * C.F] > 1) seenLive++; if (frozen.tiles[i * C.F] > 1) seenFrozen++; }
    check(seenFrozen < seenLive && seenFrozen === view.reduce((a, e) => a + (e ? 1 : 0), 0), 'frozen view hides what the move revealed');
  }
}

// ---- server: a whole game through new / step (random legal actions) with every search handle freed
async function serverGame() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'sim', 'server.js')], { env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
  const rl = readline.createInterface({ input: child.stdout });
  const waiting = [];
  rl.on('line', l => waiting.shift()(JSON.parse(l)));
  let id = 1;
  const call = (op, m) => new Promise(res => { waiting.push(res); child.stdin.write(JSON.stringify(Object.assign({ op, id: id++ }, m)) + '\n'); });
  const legalOf = r => new Int16Array(Uint8Array.from(Buffer.from(r.legal, 'base64')).buffer);
  const g = await call('new', { seed: 5, sample: { sizes: { tiny: 1 }, players: [2, 2], modes: { score: 1 }, turnLimits: [6] }, plan: { main: 'net:a', main_seat: 0, others: 'bot:crazy' } });
  check(g.ok && g.root && g.seats[0] === 'net:a' && g.seats[1] === 'bot:crazy', 'new opens a search root for the net seat');
  let root = g.root, R = 7, rounds = 0, result = null, live = -1;
  while (root && rounds++ < 500) {
    const L = legalOf(root), n = L.length / 4;
    R = (R * 1103515245 + 12345) & 0x7fffffff;
    const ex = await call('step', { jobs: [[root.h, 0], [root.h, R % n]] });
    check(ex.ok && ex.nodes.length === 2 && ex.nodes[0].ended && !ex.nodes[1].ended === (L[4 * (R % n)] !== 0), 'expand: end_turn gives an afterstate');
    const a = rounds % 6 === 0 ? 0 : (R >> 4) % n; // end_turn is always listed first
    const st = await call('step', { free: [root.h].concat(ex.nodes.map(x => x.h)), acts: [[g.gid, Array.from(L.subarray(4 * a, 4 * a + 4)), 3]] });
    check(st.ok && st.acts[0].ok, 'step plays the action: ' + (st.error || st.acts[0].err));
    if (!st.ok) break;
    live = st.live;
    root = st.acts[0].root;
    result = st.acts[0].result || null;
  }
  check(result && result.n === 2 && result.ranks.length === 2, 'the game finishes with a result (' + rounds + ' actions)');
  check(live === 0, 'all search handles freed (' + live + ' left)');
  child.stdin.end();
}

serverGame().then(() => {
  console.log(checks + ' checks, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
});
