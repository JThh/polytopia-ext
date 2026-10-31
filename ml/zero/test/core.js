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

// ---- search positions hold no hidden information: the fog copy a search starts from, and every search child of it,
// is the same whatever hides under the fog. The test hides rival units where they block one of my moves on the true
// board (on a fog tile my unit could reach, or next to its path), and adds or removes ruins in the fog.
{
  const eq = (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
  const sameObs = (a, b) => eq(a.tiles, b.tiles) && eq(a.glob, b.glob);
  let positions = 0, blocking = 0, children = 0, same = 0, fair = 0, meetings = 0;
  for (let g = 0; g < N + 4; g++) {
    const { settings, difficulties } = configs.sample(700 + g, { sizes: { tiny: 1, small: 2 }, players: [2, 4] });
    TT.ML.seedRandom(g);
    const st = TT.newGame(Object.assign({}, settings, { humans: [] }));
    st.players.forEach((P, i) => { P.difficulty = difficulties[i]; });
    while (!st.over && st.turn <= 18) {
      const pid = st.current, W = st.W, view = Uint8Array.from(st.players[pid].explored);
      const land = i => !TT.isWater(st.tiles[i].t) && st.tiles[i].site < 0;
      // fog tiles where a hidden unit would change my legal moves: reachable ones first, then their neighbours
      const spots = [];
      for (const m of st.units) {
        if (m.owner !== pid || !m.canMove) continue;
        for (const i of TT.moveTargets(st, m)) {
          if (!view[i] && land(i)) spots.push(i);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = i % W + dx, y = ((i / W) | 0) + dy, j = y * W + x;
            if (TT.inB(st, x, y) && !view[j] && land(j) && !TT.unitAt(st, x, y)) spots.push(j);
          }
        }
      }
      const hidden = st.units.filter(u => u.owner !== pid && !u.naval && (!view[u.y * W + u.x] || !TT.visibleTo(st, u, pid)));
      if (st.turn > 2 && spots.length && hidden.length) {
        positions++;
        const alt = TT.ML.clone(st), used = new Set();
        for (const h of hidden) {
          const i = spots.find(j => !used.has(j) && !TT.unitAt(alt, j % W, (j / W) | 0));
          if (i == null) break;
          used.add(i);
          const u = TT.getUnit(alt, h.id);
          u.x = i % W; u.y = (i / W) | 0;
          TT.bump(alt);
        }
        for (let i = 0; i < alt.tiles.length; i += 7) if (!view[i] && land(i)) alt.tiles[i].ruin = !alt.tiles[i].ruin;
        const real = C.legal(st, pid, { view });
        if (!eq(real, C.legal(alt, pid, { view }))) blocking++; // the true board's legal moves did change
        const A0 = C.fogCopy(st, pid, view), B0 = C.fogCopy(alt, pid, view), oA = C.encode(A0, pid, { view });
        // tribes the player can see now: the only ones a search may meet (and be paid for, as in the game)
        const seen = new Set();
        for (const u of st.units) if (u.owner !== pid && view[u.y * W + u.x] && TT.visibleTo(st, u, pid)) seen.add(u.owner);
        for (const k of st.cities) if (k.owner >= 0 && k.owner !== pid && view[k.y * W + k.x]) seen.add(k.owner);
        const met0 = A0.players[pid].live ? A0.players[pid].live.met.slice() : [];
        check(sameObs(C.encode(st, pid, { view }), oA), 'a fog copy is observed exactly as the real position');
        check(sameObs(oA, C.encode(B0, pid, { view })) && eq(C.legal(A0, pid, { view }), C.legal(B0, pid, { view })), 'fog copies agree whatever is under the fog');
        for (let i = 0; i < real.length; i += 4) {
          const q = Array.from(real.subarray(i, i + 4));
          if (q[0] === C.V.end_turn) continue;
          const a = TT.ML.clone(A0), b = TT.ML.clone(B0);
          a.rng = b.rng = 12345;
          const ra = C.apply(a, pid, q), rb = C.apply(b, pid, q);
          check(ra.ok && rb.ok, 'a real legal action also plays on the fog copy: ' + JSON.stringify(ra.tuple));
          const ca = C.encode(a, pid, { view });
          children++;
          if (sameObs(ca, C.encode(b, pid, { view })) && eq(C.legal(a, pid, { view }), C.legal(b, pid, { view }))) same++;
          else console.log('FAIL search child depends on the fog:', JSON.stringify(ra.tuple));
          const met = a.players[pid].live ? a.players[pid].live.met.filter(o => met0.indexOf(o) < 0) : [];
          meetings += met.length;
          if (met.every(o => seen.has(o))) fair++;
          else console.log('FAIL a search met a tribe the player cannot see:', met.join(','), JSON.stringify(ra.tuple));
        }
      }
      TT.ML.botTurn(st);
      if (!st.over) TT.endTurn(st);
    }
  }
  check(blocking >= 2, 'hidden units changed the true legal moves in enough positions (' + blocking + ' of ' + positions + ')');
  check(same === children, 'search children are the same whatever hides under the fog (' + same + '/' + children + ')');
  check(fair === children, 'a search only meets tribes the player already sees (' + fair + '/' + children + ')');
  console.log('fog: ' + positions + ' positions with hidden units placed in my way (' + blocking + ' change the true legal moves), ' +
    children + ' search children compared, ' + meetings + ' meetings with tribes in view');
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
