// Polytopia ruleset checks: setup, the rules that differ from Tessera, and engine invariants over many bot games.
'use strict';
process.env.POLY_RULES = 'polytopia';
const TT = require('../sim/tt');
const A = require('../sim/actions');
const T = TT.T;
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };

// ---- setup: start tech, start unit, stars, no events
{
  const st = TT.newGame({ tribes: ['oumaji', 'vengir', 'quetzali', 'hoodrick'], humans: [], opponents: 3, size: 'normal', mapType: 'drylands', seed: 11 });
  const want = { oumaji: ['riding', 'rider'], vengir: ['smithery', 'swordsman'], quetzali: ['shields', 'defender'], hoodrick: ['archery', 'archer'] };
  for (const P of st.players) {
    const u = st.units.find(x => x.owner === P.id);
    check(P.techs[want[P.tribe][0]] && Object.keys(P.techs).length === 1, P.tribe + ' start tech');
    check(u && u.type === want[P.tribe][1] && u.hp === TT.UNITS[u.type].hp, P.tribe + ' start unit');
    check(P.stars === 5, P.tribe + ' starts with 5 stars');
  }
  check(!st.settings.events && st.W === 16, 'no storms, 16x16 normal map');
  check(TT.usePower(st) === null && TT.buildWalls(st, 0) === null, 'no tribe powers or bought walls');
  check(!A.VERBS.power && !A.VERBS.walls && !A.VERBS.embassy && !A.VERBS.infiltrate && A.VERBS.examine, 'verb set matches Polytopia');
}

// ---- ruins wait for examine
{
  const st = TT.newGame({ tribes: ['xinxi', 'bardur'], humans: [], opponents: 1, size: 'small', mapType: 'drylands', seed: 5 });
  const u = st.units.find(x => x.owner === 0);
  const R = TT.reach(st, u), spots = [];
  R.forEach((n, i) => { if (!n.occ && i !== u.y * st.W + u.x) spots.push(i); });
  const i = spots[0], tl = st.tiles[i];
  tl.ruin = true;
  const stars = st.players[0].stars;
  check(TT.move(st, u.id, i % st.W, (i / st.W) | 0) && tl.ruin, 'stepping on ruins does not explore them');
  const ev = TT.examine(st, u.id);
  check(ev && !tl.ruin && !u.canMove && !u.canAttack, 'examine explores the ruins and ends the unit\'s turn');
  check(ev.some(e => e.type === 'ruin'), 'examine reports a reward (' + (st.players[0].stars - stars) + ' stars)');
}

// ---- windmill adjacency and one-per-city
{
  const st = TT.newGame({ tribes: ['zebasi', 'bardur'], humans: [], opponents: 1, size: 'small', mapType: 'drylands', seed: 3 });
  const P = st.players[0], c = st.cities[P.capital], W = st.W;
  P.techs.construction = true; P.stars = 100;
  const around = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) around.push([c.x + dx, c.y + dy]);
  const [fx, fy] = around[0], [wx, wy] = around[1];
  const ft = st.tiles[fy * W + fx], wt = st.tiles[wy * W + wx];
  ft.t = T.FIELD; ft.res = 'crop'; ft.imp = null; wt.t = T.FIELD; wt.res = null; wt.imp = null;
  const pop0 = c.pop + c.level * 10;
  check(TT.build(st, fx, fy, 'farm'), 'farm on crops');
  const pop1 = c.pop + c.level * 10;
  check(TT.buildOptions(st, 0, wx, wy).indexOf('windmill') >= 0, 'windmill offered next to the farm');
  check(TT.build(st, wx, wy, 'windmill'), 'windmill built');
  check(c.pop + c.level * 10 !== pop1 || c.pending.length, 'windmill next to a farm adds population');
  check(pop1 !== pop0, 'farm adds population');
  check(!around.some(([x, y]) => TT.buildOptions(st, 0, x, y).indexOf('windmill') >= 0), 'only one windmill per city');
}

// ---- invariants over bot games, and what bots do under these rules
const types = Object.keys(TT.MAP_TYPES), sizes = ['tiny', 'small', 'normal', 'large', 'huge'], ids = TT.TRIBES.map(t => t.id);
const builds = {}, winners = {};
let games = 0;
function invariants(st, where) {
  const seen = new Set();
  for (const u of st.units) {
    const k = u.y * st.W + u.x, tl = st.tiles[k];
    if (seen.has(k)) throw new Error(where + ': two units on a tile');
    seen.add(k);
    if (u.hp <= 0 || u.hp > TT.stats(st, u).maxHp) throw new Error(where + ': bad hp');
    if (!u.naval && TT.isWater(tl.t)) throw new Error(where + ': land unit on water');
    if (u.naval && !TT.isWater(tl.t)) throw new Error(where + ': boat on land');
    if (!TT.UNITS[u.type]) throw new Error(where + ': unknown unit type ' + u.type);
  }
  for (const P of st.players) if (P.stars < 0) throw new Error(where + ': negative stars');
  for (const c of st.cities) if (c.owner >= 0 && (c.pop >= c.level + 1 || c.pop < 0)) throw new Error(where + ': population out of range');
}
for (let g = 0; g < Number(process.argv[2] || 30); g++) {
  TT.ML.seedRandom(g + 1);
  const n = 2 + (g % 5), size = sizes[Math.min(4, (g % 3) + (n > 3 ? 2 : 0))];
  const st = TT.newGame({ tribes: ids.slice(g % 12).concat(ids).slice(0, n), humans: [], opponents: n - 1, size, mapType: types[g % types.length], seed: 900 + g, difficulty: ['normal', 'hard', 'crazy'][g % 3], mode: 'score', turnLimit: 30 });
  TT.ML.listen(st, { before: (s, name, args) => name === 'build' ? args[2] : null, after: (s, name, args, r, k) => { if (r && k) builds[k] = (builds[k] || 0) + 1; } });
  try {
    invariants(st, 'init');
    while (!st.over) { TT.ML.botTurn(st); invariants(st, 'g' + g + ' t' + st.turn); if (!st.over) TT.endTurn(st); }
  } catch (e) { fails++; console.log('FAIL', e.message); }
  const w = st.players[st.over.winner].tribe;
  winners[w] = (winners[w] || 0) + 1;
  const b = TT.scoreBreakdown(st, st.over.winner);
  check(b.total === TT.SCORE_PARTS.reduce((s, p) => s + b[p.key], 0), 'score parts add up');
  games++;
}
// the bot must use the Polytopia economy, or the SFT data never shows it (a NaN valuation once hid ports entirely)
for (const k of ['farm', 'mine', 'lumber', 'port', 'windmill', 'forge', 'sawmill', 'temple']) check(builds[k] > 0, 'bots build ' + k);
console.log({ games, failures: fails, builds, winners });
process.exit(fails ? 1 : 0);
