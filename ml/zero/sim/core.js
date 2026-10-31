// PolyZero's view of the game: what the network sees, which atomic actions exist, and how to play one.
//
//   encode(st, pid, opts)  -> { tiles: Uint8Array(PAD*PAD*F), glob: Float32Array(G) }   fog of war applied
//   legal(st, pid, opts)   -> Int16Array(4 * n): one quad (verb, src, dst, arg) per legal atomic action
//   apply(st, pid, quad)   -> { ok, err, end, tuple, evs }   runs the action through the shared tuple executor
//   fogCopy(st, pid, view) -> the position as `pid` can know it: where every search starts (see below)
//   searchApply(st, pid, q) -> apply() inside a search, with discoveries that cannot be foreseen held back
//
// A turn is a sequence of atomic actions (one engine call each) closed by end_turn, so the search can branch on
// every single decision. Quads are position based (no unit or city ids), so the same quad means the same action on
// any copy of a state:
//   src, dst  tile index on the padded PAD x PAD grid (y * PAD + x), or GLOBAL for tribe-level actions
//   arg       index into ARGS (unit type, vessel, reward, building, tech), 0 = none
// Every quad is also a tuple of the language-model pipeline (ml/sim/actions.js: "giant#12", "move", (5, 7)), so a
// trained PolyZero agent can drive the same PolyCommand bridge.
//
// Fog of war: encode() and legal() show only what `view` (default: the player's explored tiles) covers. A search
// never runs on the real position. It starts from fogCopy(), which holds only what the player can know: units it
// cannot see are off the board (their score stays on the public scoreboard through a per-player offset), and ruins
// and resources under the fog are gone. The view is frozen at the root, and searchApply() holds back the stars for
// meeting a tribe, which no one can foresee. So a search cannot learn about the fog by trying moves: a simulated move
// is never blocked by a hidden unit or its zone of control, never finds hidden ruins or starfish, and never meets a
// tribe. The real game's legal moves still follow the true board, as the game does.
//
// Rulesets: polytopia (classic) and polytopia_live (2.17.3: cloaks, embassies, rafts, starfish, bridges, monuments).
// Vocabularies are read from the loaded ruleset, so a network belongs to the ruleset it was trained on.
'use strict';
const TT = require('../../sim/tt');
const A = require('../../sim/actions');

const PAD = 20;               // network grid: every Polytopia map size (11 to 20) fits, smaller maps are padded
const GLOBAL = PAD * PAD;     // src/dst of research and end_turn (the network's "tribe" token)

const VERBS = ['end_turn', 'move', 'attack', 'convert', 'capture', 'examine', 'recover', 'heal', 'disband', 'upgrade', 'infiltrate', 'train', 'reward',
  'build', 'research', 'embassy'].filter(v => A.VERBS[v] && (v !== 'embassy' || A.VERBS.embassy.actor === 'tribe'));
const V = {}; VERBS.forEach((v, i) => { V[v] = i; });

const UNIT_TYPES = Object.keys(TT.UNITS);           // trainable units + giant
const NAVAL = Object.keys(TT.NAVAL);                // boat, ship, battleship
const REWARDS = Object.keys(TT.REWARDS);
const BUILDS = Object.keys(TT.BUILD);
const TECHS = TT.TECH_ORDER.slice();
const RES = ['fruit', 'crop', 'game', 'fish', 'ore', 'whale', 'starfish'];
const NOT_IMP = ['fruit', 'hunt', 'fish', 'whale', 'starfish', 'road', 'bridge', 'clear', 'grow', 'burn', 'destroy'];
const IMPS = BUILDS.filter(k => NOT_IMP.indexOf(k) < 0);           // buildings that stand on a tile
const TRIBES = TT.TRIBES.map(t => t.id);
const MAP_TYPES = Object.keys(TT.MAP_TYPES);

// one shared argument vocabulary: [none, units..., vessels..., rewards..., buildings..., techs...]
const ARGS = ['none'].concat(UNIT_TYPES.map(k => 'unit:' + k), NAVAL.map(k => 'naval:' + k), REWARDS.map(k => 'reward:' + k),
  BUILDS.map(k => 'build:' + k), TECHS.map(k => 'tech:' + k));
const ARG = {}; ARGS.forEach((k, i) => { ARG[k] = i; });

// per-tile categorical fields (one byte each) and how many values each can take
const FIELDS = [
  ['terrain', 7],     // 0 off the map, 1 unexplored, 2 + terrain (ocean, shallow, field, forest, mountain)
  ['elevation', 7],   // 0 unknown, 1 + clamp(e + 2, 0, 5)
  ['owner', 7],       // 0 nobody / unknown, 1 me, 2.. rivals in turn order after me
  ['resource', RES.length + 2],
  ['improvement', IMPS.length + 2],
  ['road_ruin', 16],  // bit 1 road, 2 ruins, 4 bridge, 8 lighthouse not yet found by me (live rules)
  ['city', 8],        // 0 none, 1 village, 2 mine, 3.. rival (by relative seat)
  ['city_level', 9],
  ['city_flags', 32], // 1 capital, 2 walls, 4 reward pending (mine), 8 unit cap reached (mine), 16 linked to capital
  ['city_pop', 9],    // mine only
  ['city_extra', 8],  // 1 border radius 2, 2 park, 4 workshop (mine only)
  ['unit', UNIT_TYPES.length + 1],
  ['unit_owner', 7],
  ['unit_hp', 41],
  ['unit_naval', NAVAL.length + 1],
  ['unit_flags', 8],  // 1 can move, 2 can attack, 4 veteran (flags for my units only)
];
const F = FIELDS.length;
const FI = {}; FIELDS.forEach(([k], i) => { FI[k] = i; });

const GLOB = [
  'turn', 'turns_left', 'mode_score', 'mode_domination', 'p2', 'p3', 'p4', 'p5', 'p6', 'width', 'ended',
  'stars', 'income', 'score', 'rank', 'alive_frac', 'explored', 'cities', 'units', 'kills', 'losses', 'tech_cost',
  'riv1', 'riv2', 'riv3', 'riv4', 'riv5', 'riv1_alive', 'riv2_alive', 'riv3_alive', 'riv4_alive', 'riv5_alive',
  'met', 'embassies', 'lighthouses', 'pacifist', // live rules (0 under classic)
].concat(TT.SCORE_PARTS.map(p => 'part_' + p.key), TECHS.map(k => 'tech_' + k), TRIBES.map(k => 'tribe_' + k), MAP_TYPES.map(k => 'map_' + k));
const G = GLOB.length;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rel = (o, pid, n) => o < 0 ? 0 : o === pid ? 1 : 2 + ((o - pid - 1 + n) % n);
const pidx = (st, i) => ((i / st.W) | 0) * PAD + (i % st.W);       // engine tile index -> padded index
const ppos = p => [p % PAD, (p / PAD) | 0];                           // padded index -> (x, y)

function spec() {
  return { rules: TT.RULESET.name, pad: PAD, global: GLOBAL, fields: FIELDS, glob: GLOB, verbs: VERBS, args: ARGS };
}

// ---------------------------------------------------------------- observation
// opts: { view: explored mask (array, length W*H), ended: bool (my turn is over: an afterstate) }
function encode(st, pid, opts) {
  opts = opts || {};
  const W = st.W, H = st.H, n = st.players.length, P = st.players[pid];
  if (W > PAD || H > PAD) throw new Error('map larger than ' + PAD + 'x' + PAD);
  const view = opts.view || P.explored, ended = !!opts.ended;
  const tiles = new Uint8Array(PAD * PAD * F), L = P.live || null;
  const lights = new Set(st.lighthouses || []);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = (y * PAD + x) * F, tl = st.tiles[i];
    if (!view[i]) { tiles[o] = 1; continue; }
    tiles[o] = 2 + tl.t;
    tiles[o + 1] = 1 + clamp((tl.e | 0) + 2, 0, 5);
    tiles[o + 2] = rel(tl.owner, pid, n);
    if (tl.res && !tl.imp) { const r = RES.indexOf(tl.res); tiles[o + 3] = r >= 0 ? r + 1 : RES.length + 1; }
    if (tl.imp) { const m = IMPS.indexOf(tl.imp); tiles[o + 4] = m >= 0 ? m + 1 : IMPS.length + 1; }
    tiles[o + 5] = (tl.road && tl.site < 0 && !tl.bridge ? 1 : 0) | (tl.ruin ? 2 : 0) | (tl.bridge ? 4 : 0) | (lights.has(i) && L && L.lights.indexOf(i) < 0 ? 8 : 0);
    if (tl.site >= 0) {
      const c = st.cities[tl.site], mine = c.owner === pid;
      tiles[o + 6] = c.owner < 0 ? 1 : 1 + rel(c.owner, pid, n);
      tiles[o + 7] = clamp(c.level, 0, 8);
      tiles[o + 8] = (c.capital ? 1 : 0) | (c.walls ? 2 : 0) | (mine && c.pending.length ? 4 : 0) | (mine && TT.cityUnits(st, c) >= TT.cityCap(c) ? 8 : 0) | (c.linked ? 16 : 0);
      if (mine) {
        tiles[o + 9] = clamp(c.pop, 0, 8);
        tiles[o + 10] = (c.radius >= 2 ? 1 : 0) | (c.parks ? 2 : 0) | (c.workshop ? 4 : 0);
      }
    }
  }
  for (const u of st.units) {
    const i = u.y * W + u.x;
    if (u.owner !== pid && (!view[i] || !TT.visibleTo(st, u, pid))) continue;
    const o = (u.y * PAD + u.x) * F;
    tiles[o + 11] = 1 + UNIT_TYPES.indexOf(u.type);
    tiles[o + 12] = rel(u.owner, pid, n);
    tiles[o + 13] = clamp(Math.round(u.hp), 0, 40);
    tiles[o + 14] = u.naval ? 1 + NAVAL.indexOf(u.naval) : 0;
    if (u.owner === pid) tiles[o + 15] = (!ended && u.canMove ? 1 : 0) | (!ended && u.canAttack ? 2 : 0) | (u.vet ? 4 : 0);
    else if (u.vet) tiles[o + 15] = 4;
  }

  const g = new Float32Array(G), S = st.settings;
  let k = 0;
  const put = v => { g[k++] = v; };
  const scores = publicScores(st), me = scores[pid];
  put(st.turn / 30);
  put(S.mode === 'score' ? Math.max(0, S.turnLimit - st.turn + 1) / 30 : 0);
  put(S.mode === 'score' ? 1 : 0); put(S.mode === 'score' ? 0 : 1);
  for (let p = 2; p <= 6; p++) put(n === p ? 1 : 0);
  put(W / PAD); put(ended ? 1 : 0);
  put(P.stars / 20); put(TT.income(st, pid) / 10); put(me / 2000);
  const alive = st.players.filter(Q => Q.alive).length;
  put(scores.filter((s, q) => q !== pid && st.players[q].alive && s > me).length / Math.max(1, n - 1));
  put(alive / n);
  let ex = 0; for (let i = 0; i < W * H; i++) ex += view[i] ? 1 : 0;
  put(ex / (W * H));
  put(st.cities.filter(c => c.owner === pid).length / 10); put(st.units.filter(u => u.owner === pid).length / 20);
  put(P.kills / 10); put(P.losses / 10);
  put(Math.max(1, st.cities.filter(c => c.owner === pid).length) / 10);
  const riv = [];
  for (let d = 1; d < n; d++) { const q = (pid + d) % n; riv.push([(scores[q] - me) / 2000, st.players[q].alive ? 1 : 0]); }
  for (let r = 0; r < 5; r++) put(r < riv.length ? riv[r][0] : 0);
  for (let r = 0; r < 5; r++) put(r < riv.length ? riv[r][1] : 0);
  put(L ? L.met.length / 5 : 0); put(L ? L.embassies.length / 5 : 0); put(L ? L.lights.length / 4 : 0); put(L ? Math.min(5, L.pacifist) / 5 : 0);
  const b = TT.scoreBreakdown(st, pid);
  for (const p of TT.SCORE_PARTS) put((b[p.key] || 0) / 1000);
  for (const t of TECHS) put(P.techs[t] ? 1 : 0);
  for (const t of TRIBES) put(P.tribe === t ? 1 : 0);
  for (const m of MAP_TYPES) put(S.mapType === m ? 1 : 0);
  if (k !== G) throw new Error('glob size ' + k + ' != ' + G);
  return { tiles, glob: g };
}

// ---------------------------------------------------------------- legal actions
// Exhaustive: every engine action the player can take now, except that a pending city reward must be picked first
// (the real game shows it as a pop-up). opts: { view } as in encode (attacks need a target the view shows).
function legal(st, pid, opts) {
  opts = opts || {};
  const out = [];
  if (st.over || st.current !== pid) return new Int16Array(0);
  const W = st.W, P = st.players[pid], view = opts.view || P.explored;
  const push = (v, s, d, a) => out.push(v, s, d, a);
  for (const c of st.cities) {
    if (c.owner !== pid || !c.pending.length) continue;
    const p = c.y * PAD + c.x;
    for (const r of TT.rewardOptions(c.pending[0])) push(V.reward, p, p, ARG['reward:' + r]);
    return Int16Array.from(out);
  }
  push(V.end_turn, GLOBAL, GLOBAL, 0);
  for (const k of TECHS) if (TT.canResearch(st, pid, k)) push(V.research, GLOBAL, GLOBAL, ARG['tech:' + k]);
  const mine = st.units.filter(u => u.owner === pid).sort((a, b) => a.id - b.id);
  for (const u of mine) {
    const p = u.y * PAD + u.x, S = TT.stats(st, u), tl = st.tiles[u.y * W + u.x];
    if (TT.canCapture(st, u)) push(V.capture, p, p, 0);
    if (V.examine != null && tl.ruin && view[u.y * W + u.x] && !!u.naval === TT.isWater(tl.t)) push(V.examine, p, p, 0); // boats: water ruins (live)
    if (u.canMove && u.canAttack && u.hp < S.maxHp) push(V.recover, p, p, 0);
    if (V.heal != null && u.canMove && u.canAttack && TT.has(S, 'heal') && TT.healTargets(st, u).length) push(V.heal, p, p, 0);
    if (P.techs.free_spirit || TT.RULESET.name === 'tessera') push(V.disband, p, p, 0);
    if (V.infiltrate != null && TT.canInfiltrate(st, u)) push(V.infiltrate, p, p, 0);
    for (const k of TT.upgradeOptions(st, u)) if (P.stars >= TT.NAVAL[k].cost) push(V.upgrade, p, p, ARG['naval:' + k]);
    const conv = TT.has(S, 'convert');
    for (const d of TT.attackTargets(st, u)) if (view[d.y * W + d.x]) push(conv ? V.convert : V.attack, p, d.y * PAD + d.x, 0);
    for (const i of TT.moveTargets(st, u)) push(V.move, p, pidx(st, i), 0);
  }
  for (const c of st.cities) {
    if (c.owner !== pid) continue;
    const p = c.y * PAD + c.x;
    for (const k of TT.UNIT_ORDER) if (TT.canTrain(st, c.id, k)) push(V.train, p, p, ARG['unit:' + k]);
  }
  if (V.embassy != null && P.techs.diplomacy && P.live && P.stars >= TT.embassyCost(st, pid)) {
    for (const c of st.cities) {
      if (!c.capital || c.owner < 0 || c.owner === pid || P.live.met.indexOf(c.owner) < 0 || P.live.embassies.indexOf(c.owner) >= 0) continue;
      push(V.embassy, GLOBAL, c.y * PAD + c.x, 0);
    }
  }
  const unitTiles = new Set(mine.map(u => u.y * W + u.x)); // starfish (live) are fished wherever my unit stands
  for (let i = 0; i < st.tiles.length; i++) {
    if ((st.tiles[i].owner !== pid && !unitTiles.has(i)) || !view[i]) continue;
    const x = i % W, y = (i / W) | 0;
    for (const k of TT.buildOptions(st, pid, x, y)) if (TT.canBuild(st, pid, x, y, k)) push(V.build, y * PAD + x, y * PAD + x, ARG['build:' + k]);
  }
  return Int16Array.from(out);
}

// ---------------------------------------------------------------- quads <-> tuples
const argName = a => ARGS[a].slice(ARGS[a].indexOf(':') + 1);
function toTuple(st, q) {
  const verb = VERBS[q[0]];
  if (!verb) return null;
  if (verb === 'end_turn') return A.END.slice();
  if (verb === 'research') return ['tribe', 'research', argName(q[3])];
  const [sx, sy] = ppos(q[1]), [dx, dy] = ppos(q[2]);
  if (verb === 'embassy') return ['tribe', 'embassy', [dx, dy]];
  if (verb === 'build') return ['tribe', 'build', argName(q[3]), [sx, sy]];
  if (verb === 'train' || verb === 'reward') {
    const tl = TT.inB(st, sx, sy) ? st.tiles[sy * st.W + sx] : null;
    if (!tl || tl.site < 0) return null;
    return [A.cityRef(tl.site), verb, argName(q[3])];
  }
  const u = TT.inB(st, sx, sy) ? TT.unitAt(st, sx, sy) : null;
  if (!u) return null;
  const ref = A.unitRef(u);
  if (verb === 'move' || verb === 'attack' || verb === 'convert') return [ref, verb, [dx, dy]];
  if (verb === 'upgrade') return [ref, verb, argName(q[3])];
  return [ref, verb];
}
// the quad of a tuple (the inverse of toTuple), or null if it does not name one of the player's units or cities
function fromTuple(st, t) {
  const verb = t[1], v = V[verb];
  if (v == null) return null;
  if (verb === 'end_turn') return [v, GLOBAL, GLOBAL, 0];
  if (verb === 'research') return [v, GLOBAL, GLOBAL, ARG['tech:' + t[2]] || 0];
  if (verb === 'embassy') return [v, GLOBAL, t[2][1] * PAD + t[2][0], 0];
  if (verb === 'build') return [v, t[3][1] * PAD + t[3][0], t[3][1] * PAD + t[3][0], ARG['build:' + t[2]] || 0];
  if (verb === 'train' || verb === 'reward') {
    const c = st.cities[Number(t[0].split('#')[1])];
    if (!c) return null;
    const p = c.y * PAD + c.x;
    return [v, p, p, ARG[(verb === 'train' ? 'unit:' : 'reward:') + t[2]] || 0];
  }
  const u = TT.getUnit(st, Number(t[0].split('#')[1]));
  if (!u) return null;
  const p = u.y * PAD + u.x;
  if (verb === 'move' || verb === 'attack' || verb === 'convert') return [v, p, t[2][1] * PAD + t[2][0], 0];
  if (verb === 'upgrade') return [v, p, p, ARG['naval:' + t[2]] || 0];
  return [v, p, p, 0];
}

// Play one quad for the player to move. end_turn is reported (end: true) but not executed: the caller ends the turn.
function apply(st, pid, q) {
  const t = toTuple(st, q);
  if (!t) return { ok: false, err: 'bad_quad', end: false, tuple: null };
  const r = A.execute(st, pid, t);
  return { ok: r.ok, err: r.err, end: r.end, tuple: t, evs: r.evs };
}

// ---------------------------------------------------------------- search positions
// Scores as the public scoreboard shows them: on a fog copy, plus the points of the units taken off the board.
function publicScores(st) {
  const off = st.fog ? st.fog.offsets : null;
  return st.players.map(Q => Q.alive ? TT.score(st, Q.id) + (off ? off[Q.id] : 0) : 0);
}

// The position as `pid` can know it, given its explored tiles `view`. Rivals' units it cannot see (under the fog, or
// cloaked) are removed; ruins and resources on unexplored tiles are cleared. Its observation is the same as the real
// position's, and it is the same whatever hides under the fog.
function fogCopy(st, pid, view) {
  const c = TT.ML.clone(st), W = c.W;
  const before = c.players.map(P => P.alive ? TT.score(c, P.id) : 0);
  c.units = c.units.filter(u => u.owner === pid || (view[u.y * W + u.x] && TT.visibleTo(c, u, pid)));
  for (let i = 0; i < c.tiles.length; i++) {
    if (view[i]) continue;
    const t = c.tiles[i];
    t.ruin = false;
    if (!t.imp) t.res = null;
  }
  TT.bump(c);
  c.fog = { pid, offsets: c.players.map((P, q) => P.alive ? before[q] - TT.score(c, q) : 0) };
  return c;
}

// apply() on a search position. Meeting a tribe (live rules pay stars for it) is undone: whether a move uncovers a
// rival cannot be known before the move is played, so the search must not be paid for guessing right.
function searchApply(st, pid, q) {
  const r = apply(st, pid, q), P = st.players[pid];
  for (const e of r.evs || []) {
    if (e.type !== 'meet' || e.pid !== pid) continue;
    P.stars -= e.stars;
    if (P.live) P.live.met = P.live.met.filter(o => o !== e.other);
  }
  return r;
}

// position of quad q in a legal list, or -1
function indexOf(list, q) {
  for (let i = 0; i < list.length; i += 4) if (list[i] === q[0] && list[i + 1] === q[1] && list[i + 2] === q[2] && list[i + 3] === q[3]) return i / 4;
  return -1;
}

// ---------------------------------------------------------------- outcome
// Final standing as in ml/sim/session.js: the winner is 1st (in domination it may not have the top score), everyone
// else ranks by score behind it. Games stopped by a turn cap rank by score.
function result(st) {
  const n = st.players.length;
  const scores = publicScores(st);
  const winner = st.over ? st.over.winner : scores.indexOf(Math.max.apply(null, scores));
  const ranks = scores.map((s, i) => i === winner ? 1 : 2 + scores.filter((o, j) => j !== winner && j !== i && o > s).length);
  return { over: !!st.over, reason: st.over ? st.over.reason : 'turn_cap', turn: st.turn, winner, scores, ranks,
    alive: st.players.map(P => P.alive), tribes: st.players.map(P => P.tribe), n };
}

module.exports = { PAD, GLOBAL, VERBS, V, ARGS, ARG, FIELDS, F, GLOB, G, spec, encode, legal, apply, toTuple, fromTuple, indexOf, result, pidx, ppos,
  fogCopy, searchApply, publicScores };
