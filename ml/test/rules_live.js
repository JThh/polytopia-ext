// Polytopia live-rules checks (rulesets/polytopia_live.js): setup per tribe, each rule that differs from the classic
// ruleset as a small scenario, and engine invariants over many bot games.
'use strict';
process.env.POLY_RULES = 'polytopia_live';
const TT = require('../sim/tt');
const A = require('../sim/actions');
const T = TT.T;
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const ids = TT.TRIBES.map(t => t.id);
const game = (tribes, extra) => TT.newGame(Object.assign({ tribes, humans: [], opponents: tribes.length - 1, size: 'normal', mapType: 'drylands', seed: 7 }, extra));
const at = (st, x, y) => st.tiles[y * st.W + x];
const capital = (st, pid) => st.cities.find(c => c.owner === pid && c.capital);
// a blank 5x5 field around (x, y) owned by pid's capital, with no units on it except those listed
function clearArea(st, x, y, pid, keep) {
  st.units = st.units.filter(u => (keep || []).indexOf(u) >= 0 || Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) > 2);
  const cap = capital(st, pid);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const t = at(st, x + dx, y + dy);
    if (t.site >= 0) continue;
    t.t = T.FIELD; t.res = null; t.imp = null; t.road = false; t.bridge = false; t.ruin = false; t.owner = pid; t.city = cap.id;
  }
}
// spot (x, y) next to an enemy capital, usable for an attacker
function nextTo(st, c) { return [c.x + 1, c.y]; }

// ---- setup: start tech, unit and stars per tribe; Luxidoor's capital; capital resources; verbs
for (let g = 0; g < ids.length; g += 4) {
  const st = game(ids.slice(g, g + 4), { size: 'large', seed: 21 + g });
  const want = { xinxi: 7, oumaji: 6, hoodrick: 7, luxidoor: 2, aimo: 5, quetzali: 7, yadakk: 7 };
  for (const P of st.players) {
    const D = TT.tribe(P.tribe), u = st.units.find(x => x.owner === P.id), c = capital(st, P.id);
    check(Object.keys(P.techs).length === (D.startTech ? 1 : 0) && (!D.startTech || P.techs[D.startTech]), P.tribe + ' start tech');
    check(u && u.type === D.startUnit && u.hp === TT.UNITS[u.type].hp, P.tribe + ' start unit');
    check(P.stars === (want[P.tribe] || 5), P.tribe + ' starts with ' + (want[P.tribe] || 5) + ' stars (has ' + P.stars + ')');
    check(c.level === (P.tribe === 'luxidoor' ? 4 : 1), P.tribe + ' capital level');
    const res = TT.RULESET.tables.TRIBES.find(t => t[0] === P.tribe)[7], ring = {};
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && TT.inB(st, c.x + dx, c.y + dy)) { const r = at(st, c.x + dx, c.y + dy).res; if (r) ring[r] = (ring[r] || 0) + 1; }
    for (const k of Object.keys(res)) if (k !== 'fish') check((ring[k] || 0) >= res[k], P.tribe + ' capital has ' + res[k] + ' ' + k + ' next to it (has ' + (ring[k] || 0) + ')');
  }
  check(!st.settings.events && !st.tiles.some(t => t.res === 'whale'), 'no storms, starfish instead of whales');
}
check(A.VERBS.embassy && A.VERBS.embassy.actor === 'tribe' && A.VERBS.embassy.args.join() === 'pos', 'embassy verb takes the rival capital position');
check(A.VERBS.infiltrate && A.VERBS.examine && A.VERBS.upgrade && !A.VERBS.power && !A.VERBS.walls, 'verb set');
check(A.VOCAB.naval.join() === 'scout,rammer,bomber', 'rafts upgrade to scout, rammer, bomber');
check(TT.TECHS.shields.name === 'Strategy' && TT.TECH_ORDER.length === 25, '25 techs; Shields shows as Strategy');

// ---- research: cost, literacy, backwards research
{
  const st = game(['vengir', 'bardur']), P = st.players[0];
  check(TT.techCost(st, 0, 'climbing') === 5 && TT.techCost(st, 0, 'mining') === 6 && TT.techCost(st, 0, 'trade') === 7, 'tech cost = tier x cities + 4');
  check(TT.canResearch(st, 0, 'mining', true), 'backwards research: Vengir (Smithery) may research Mining');
  check(!TT.canResearch(st, 0, 'archery', true) && !TT.canResearch(st, 0, 'spiritualism', true), 'no research without a parent or an owned child');
  P.techs.philosophy = true;
  check(TT.techCost(st, 0, 'trade') === Math.ceil(7 * 2 / 3), 'literacy: a third off, rounded up');
}

// ---- units: spawned-only units, cloaks cannot attack units
{
  const st = game(['xinxi', 'bardur']), c = capital(st, 0);
  st.players[0].techs.diplomacy = true; st.players[0].stars = 50;
  check(!TT.canTrain(st, c.id, 'dagger') && !TT.canTrain(st, c.id, 'giant'), 'daggers and giants cannot be trained');
  clearArea(st, c.x, c.y, 0);
  const k = TT.spawnUnit(st, 'cloak', 0, c.x + 1, c.y, c.id, true), e = TT.spawnUnit(st, 'warrior', 1, c.x + 2, c.y, -1, true);
  check(TT.attackTargets(st, k).length === 0 && TT.stats(st, k).atk === 2, 'a cloak (attack 2) cannot attack units');
  check(TT.reach(st, k).size > 1 && e, 'a cloak moves');
}

// ---- navy: rafts from ports only, vessel kinds, upgrades in own territory
{
  const st = game(['kickoo', 'bardur']), c = capital(st, 0), P = st.players[0];
  clearArea(st, c.x, c.y, 0);
  const port = at(st, c.x + 1, c.y), sea = at(st, c.x + 2, c.y);
  port.t = T.SHALLOW; port.imp = 'port'; sea.t = T.SHALLOW;
  const w = TT.spawnUnit(st, 'warrior', 0, c.x, c.y + 1, c.id, true);
  check(!TT.reach(st, w).has((c.y) * st.W + c.x + 2), 'land units cannot walk onto open water');
  check(TT.move(st, w.id, c.x + 1, c.y) && w.naval === 'raft', 'entering a port makes a raft');
  check(TT.attackTargets(st, w).length === 0 && TT.stats(st, w).atk === 0, 'rafts cannot attack');
  P.techs.sailing = P.techs.ramming = P.techs.navigation = true; P.stars = 30;
  check(TT.upgradeOptions(st, w).join() === 'scout,rammer,bomber', 'raft upgrades by tech');
  check(TT.upgrade(st, w.id, 'bomber') && P.stars === 15 && TT.stats(st, w).range === 3, 'bomber costs 15, range 3');
  check(TT.upgradeOptions(st, w).length === 0, 'only rafts upgrade');
  const g = TT.spawnUnit(st, 'giant', 0, c.x + 2, c.y, -1, true), k = TT.spawnUnit(st, 'cloak', 0, c.x + 2, c.y + 1, -1, true);
  at(st, c.x + 2, c.y + 1).t = T.SHALLOW;
  check(TT.HOOKS.embarkKind(st, g) === 'juggernaut' && TT.HOOKS.embarkKind(st, k) === 'dinghy' && TT.HOOKS.embarkKind(st, { type: 'dagger' }) === 'pirate', 'giant/cloak/dagger embark as juggernaut/dinghy/pirate');
  const r = TT.spawnUnit(st, 'warrior', 0, c.x + 2, c.y - 1, -1, true);
  at(st, c.x + 2, c.y - 1).owner = 1;
  r.naval = 'raft';
  check(TT.upgradeOptions(st, r).length === 0, 'no upgrades outside own territory');
}

// ---- combat: stiff, surprise, static, splash, no high ground, no road bonus abroad
{
  const st = game(['xinxi', 'bardur']), c = capital(st, 0);
  clearArea(st, c.x, c.y, 0);
  const a = TT.spawnUnit(st, 'warrior', 0, c.x - 1, c.y + 1, -1, true);
  const cat = TT.spawnUnit(st, 'catapult', 1, c.x, c.y + 1, -1, true), war = TT.spawnUnit(st, 'warrior', 1, c.x - 1, c.y + 2, -1, true);
  check(TT.combat(st, a, cat).counter === 0 && !TT.combat(st, a, cat).killed, 'stiff: a catapult never strikes back');
  check(TT.combat(st, a, war).counter > 0, 'a warrior strikes back');
  a.type = 'dagger'; a.hp = 10;
  check(TT.combat(st, a, war).counter === 0, 'surprise: nothing strikes back at a dagger');
  at(st, a.x, a.y).e = 5; at(st, war.x, war.y).e = 0;
  a.type = 'warrior';
  const flat = TT.combat(st, a, war).dmg;
  at(st, a.x, a.y).e = 0;
  check(TT.combat(st, a, war).dmg === flat, 'no high-ground bonus');
  // static: daggers never become veterans
  const d = TT.spawnUnit(st, 'dagger', 0, c.x + 1, c.y - 1, -1, true);
  d.kills = 2;
  const v = TT.spawnUnit(st, 'warrior', 1, c.x + 2, c.y - 1, -1, true); v.hp = 1;
  check(TT.attack(st, d.id, v.id) && d.kills === 3 && !d.vet, 'static: a dagger with 3 kills is no veteran');
  // splash: half of what the bomber would do to the neighbour, rounded down
  const s2 = game(['kickoo', 'bardur']), c2 = capital(s2, 0);
  clearArea(s2, c2.x, c2.y, 0);
  const b = TT.spawnUnit(s2, 'warrior', 0, c2.x - 2, c2.y + 2, -1, true); b.naval = 'bomber'; at(s2, b.x, b.y).t = T.SHALLOW;
  const t1 = TT.spawnUnit(s2, 'warrior', 1, c2.x + 1, c2.y + 2, -1, true), t2 = TT.spawnUnit(s2, 'defender', 1, c2.x + 2, c2.y + 2, -1, true);
  const want = Math.floor(TT.combat(s2, b, t2).dmg / 2), hp2 = t2.hp;
  check(TT.attack(s2, b.id, t1.id) && hp2 - t2.hp === want && want > 0, 'splash = floor(half the damage it would do to that unit): ' + (hp2 - t2.hp) + ' vs ' + want);
  // roads: no bonus on tiles another tribe owns
  const s3 = game(['yadakk', 'bardur']), c3 = capital(s3, 0);
  clearArea(s3, c3.x, c3.y, 0);
  const w = TT.spawnUnit(s3, 'warrior', 0, c3.x - 2, c3.y - 2, -1, true);
  for (let x = c3.x - 2; x <= c3.x + 2; x++) at(s3, x, c3.y - 2).road = true;
  const far = TT.reach(s3, w).has((c3.y - 2) * s3.W + c3.x);
  for (let x = c3.x - 1; x <= c3.x + 2; x++) at(s3, x, c3.y - 2).owner = 1;
  check(far && !TT.reach(s3, w).has((c3.y - 2) * s3.W + c3.x), 'roads speed units up at home but not in enemy territory');
}

// ---- score: cities, temples
{
  const st = game(['xinxi', 'bardur']), c = capital(st, 0);
  c.level = 3; c.pop = 2; c.parks = 0;
  check(TT.scoreBreakdown(st, 0).cities === 100 + 2 * 50 + 2 * 5, 'city score = 50 x (level + 1) + 5 x population');
  clearArea(st, c.x, c.y, 0);
  st.players[0].techs.free_spirit = true; st.players[0].stars = 30;
  check(TT.build(st, c.x + 1, c.y, 'temple'), 'temple built');
  const t0 = TT.scoreBreakdown(st, 0).temples;
  st.turn += 2; const t2 = TT.scoreBreakdown(st, 0).temples;
  st.turn += 20; const tMax = TT.scoreBreakdown(st, 0).temples;
  check(t0 === 100 && t2 === 200 && tMax === 500, 'temples: 100, +100 every 2 turns, up to 500 (' + [t0, t2, tMax] + ')');
}

// ---- meeting a tribe: 2 x min(ceil(score / 1000), 5) + 1 stars, +2 for the second player of a 1v1 meeting the first
for (const n of [2, 3]) {
  const st = game(['xinxi', 'bardur', 'imperius'].slice(0, n), { size: 'large' });
  const c0 = capital(st, 0);
  st.current = 1;
  const P = st.players[1];
  P.techs = { hunting: true }; P.stars = 50;
  P.explored[c0.y * st.W + c0.x] = 1;
  const score = TT.score(st, 0), cost = TT.techCost(st, 1, 'archery'), before = P.stars;
  P.live.met = P.live.met.filter(q => q !== 0);
  check(TT.research(st, 'archery'), 'research');
  const got = P.stars - before + cost, want = 2 * Math.min(Math.ceil(score / 1000), 5) + 1 + (n === 2 ? 2 : 0);
  check(got === want, n + ' players: meeting a tribe of score ' + score + ' pays ' + want + ' (got ' + got + ')');
}

// ---- embassies: 5 stars, +2 a turn to both sides, closed by an attack
{
  const st = game(['xinxi', 'bardur'], { size: 'small' }), c1 = capital(st, 1), P = st.players[0];
  P.techs.diplomacy = true; P.stars = 20;
  if (P.live.met.indexOf(1) < 0) P.live.met.push(1);
  const i0 = TT.income(st, 0), i1 = TT.income(st, 1);
  const t = ['tribe', 'embassy', [c1.x, c1.y]];
  check(A.execute(st, 0, t).ok && P.stars === 15, 'embassy costs 5');
  check(TT.income(st, 0) === i0 + 2 && TT.income(st, 1) === i1 + 2, '+2 stars a turn to both');
  check(!A.execute(st, 0, t).ok, 'one embassy per rival');
  check(JSON.stringify(A.fromCommand(st, 'buildEmbassy', [c1.id])) === JSON.stringify(t), 'embassy tuple round trip');
  const a = TT.spawnUnit(st, 'warrior', 0, c1.x + 1, c1.y + 1, -1, true), e = TT.spawnUnit(st, 'warrior', 1, c1.x + 1, c1.y, -1, true);
  at(st, a.x, a.y).t = T.FIELD; at(st, e.x, e.y).t = T.FIELD;
  check(TT.attack(st, a.id, e.id) && TT.income(st, 0) === i0, 'attacking the host closes the embassy');
}

// ---- infiltration: takes the city's income, raises min(5, level) daggers, the city makes nothing next turn
{
  const st = game(['xinxi', 'bardur']), c1 = capital(st, 1), P = st.players[0];
  c1.level = 3;
  clearArea(st, c1.x, c1.y, 1);
  P.live.met.push(1); // already met: no meeting stars mixed in
  const k = TT.spawnUnit(st, 'cloak', 0, c1.x + 1, c1.y + 1, -1, true);
  const before = P.stars, inc1 = TT.income(st, 1), own = c1.level + c1.workshop + 1 + c1.parks;
  const ev = TT.infiltrate(st, k.id);
  check(ev && P.stars - before === own && !TT.getUnit(st, k.id), 'infiltrating takes the city\'s income (' + own + ') and uses up the cloak');
  check(st.units.filter(u => u.type === 'dagger' && u.owner === 0).length === 3, 'level-3 city raises 3 daggers');
  st.turn += 1;
  check(TT.income(st, 1) === inc1 - own, 'the city makes nothing next turn');
}

// ---- starfish: +8 stars with Navigation, a unit of yours on the tile, any territory; uses the unit's turn
{
  const st = game(['kickoo', 'bardur'], { size: 'large', mapType: 'archipelago' }), P = st.players[0];
  const i = st.tiles.findIndex(t => t.t === T.OCEAN && t.owner < 0 && t.site < 0), x = i % st.W, y = (i / st.W) | 0;
  st.units = st.units.filter(u => u.x !== x || u.y !== y);
  st.tiles[i].res = 'starfish';
  const u = TT.spawnUnit(st, 'warrior', 0, x, y, -1, true);
  check(u.naval === 'raft' && !TT.canBuild(st, 0, x, y, 'starfish'), 'starfish need Navigation');
  P.techs.navigation = true;
  const s0 = P.stars;
  check(TT.build(st, x, y, 'starfish') && P.stars === s0 + 8 && !u.canMove && !u.canAttack && !st.tiles[i].res, 'starfish: +8 stars, unit done for the turn');
}

// ---- market: the levels of adjacent windmills, forges and sawmills, up to 8
{
  const st = game(['xinxi', 'bardur']), c = capital(st, 0);
  clearArea(st, c.x, c.y, 0);
  const set = (dx, dy, imp) => { at(st, c.x + dx, c.y + dy).imp = imp; };
  set(-2, -2, 'market'); set(-1, -2, 'sawmill'); set(0, -2, 'lumber'); set(0, -1, 'lumber'); set(-2, -1, 'forge'); set(-2, 0, 'mine');
  check(TT.marketYield(st, (c.y - 2) * st.W + c.x - 2) === 3, 'market = sawmill level 2 + forge level 1');
}

// ---- city connections: +1 population in the city and in the capital, road or port
{
  const st = game(['yadakk', 'bardur'], { size: 'large' }), c = capital(st, 0), P = st.players[0];
  clearArea(st, c.x, c.y, 0);
  const v = st.cities.find(k => k.owner < 0 && Math.max(Math.abs(k.x - c.x), Math.abs(k.y - c.y)) >= 4) || st.cities.find(k => k.owner < 0);
  st.units = st.units.filter(u => u.x !== v.x || u.y !== v.y);
  const u = TT.spawnUnit(st, 'warrior', 0, v.x, v.y, -1, true);
  st.current = 0;
  check(TT.capture(st, u.id), 'village captured');
  // a road of tiles between the two, owned by player 0
  const path = [];
  let x = c.x, y = c.y;
  while (Math.max(Math.abs(x - v.x), Math.abs(y - v.y)) > 1) { x += Math.sign(v.x - x); y += Math.sign(v.y - y); path.push([x, y]); }
  for (const [px, py] of path) { const t = at(st, px, py); t.t = T.FIELD; t.res = null; t.imp = null; t.owner = 0; t.city = c.id; }
  for (const [px, py] of path.slice(0, -1)) at(st, px, py).road = true;
  P.techs.roads = true; P.stars = 20;
  const [lx, ly] = path[path.length - 1];
  const cp = c.pop + c.level * 100, vp = v.pop + v.level * 100;
  check(TT.build(st, lx, ly, 'road') && v.linked, 'the last road links the city');
  check(c.pop + c.level * 100 === cp + 1 && v.pop + v.level * 100 === vp + 1, '+1 population in both');
}

// ---- idle units heal at the end of their turn: 4 at home, 2 away; units that moved do not
{
  const st = game(['xinxi', 'bardur']), c = capital(st, 0);
  clearArea(st, c.x, c.y, 0);
  const h = TT.spawnUnit(st, 'warrior', 0, c.x + 1, c.y, -1, true), m = TT.spawnUnit(st, 'warrior', 0, c.x - 1, c.y, -1, true), a = TT.spawnUnit(st, 'warrior', 0, c.x, c.y + 2, -1, true);
  at(st, a.x, a.y).owner = -1;
  h.hp = m.hp = a.hp = 3;
  st.current = 0;
  TT.move(st, m.id, c.x - 2, c.y);
  TT.endTurn(st);
  check(h.hp === 7 && a.hp === 5 && m.hp === 3, 'idle healing: home +4, away +2, moved +0 (' + [h.hp, a.hp, m.hp] + ')');
}

// ---- ruins: no Rammer from water ruins without Sailing; examine uses the unit's turn
{
  let rammers = 0, swords = 0;
  for (let s = 0; s < 40; s++) {
    const st = game(['kickoo', 'bardur'], { size: 'large', mapType: 'archipelago', seed: 100 + s }), P = st.players[0];
    if (s >= 20) P.techs.sailing = true;
    const i = st.tiles.findIndex((t, j) => t.t === T.SHALLOW && t.site < 0 && !st.units.some(u => u.y * st.W + u.x === j));
    st.tiles[i].ruin = true;
    const u = TT.spawnUnit(st, 'warrior', 0, i % st.W, (i / st.W) | 0, -1, true);
    st.current = 0;
    const ev = TT.examine(st, u.id) || [];
    for (const e of ev) if (e.type === 'spawn') { const g = TT.getUnit(st, e.uid); if (g.naval === 'rammer') { rammers++; if (s < 20) fails++, console.log('FAIL rammer without sailing'); } else swords++; }
    check(!u.canMove && !u.canAttack, 'examine ends the turn');
  }
  check(rammers > 0 && swords === 0, 'water ruins give veteran Rammers (' + rammers + ') once you can sail, never Swordsmen');
}

// ---- bots' star bonus: Easy -1, Normal 0, Hard +1, Crazy +3 next to a human's income
{
  const st = game(['xinxi', 'bardur']), P = st.players[1];
  st.players[0].isAI = false;
  const base = TT.income(st, 0);
  for (const [d, n] of [['easy', -1], ['normal', 0], ['hard', 1], ['crazy', 3]]) { P.isAI = true; P.difficulty = d; check(TT.income(st, 1) === base + n, d + ' bot income ' + n); }
}

// ---- monuments: after the task, once per tribe, +3 population, 400 points
{
  const st = game(['xinxi', 'bardur']), c = capital(st, 0), P = st.players[0];
  clearArea(st, c.x, c.y, 0);
  check(TT.monumentsAvailable(st, 0).length === 0, 'no monuments before a task');
  c.level = 5; st.current = 0;
  TT.endTurn(st); st.current = 0;
  check(TT.monumentsAvailable(st, 0).join() === 'park_of_fortune', 'a level-5 city completes Metropolis');
  const pop = c.pop;
  check(TT.build(st, c.x + 1, c.y + 1, 'park_of_fortune') && c.pop === pop + 3 && TT.scoreBreakdown(st, 0).monuments === 400, 'Park of Fortune: +3 pop, 400 points');
  check(TT.monumentsAvailable(st, 0).length === 0, 'each monument once');
}

// ---- disband: Free Spirit; refunds half the full cost, vessel included
{
  const st = game(['kickoo', 'bardur']), c = capital(st, 0), P = st.players[0];
  clearArea(st, c.x, c.y, 0);
  const u = TT.spawnUnit(st, 'swordsman', 0, c.x + 1, c.y, -1, true);
  st.current = 0;
  check(!TT.disband(st, u.id), 'disband needs Free Spirit');
  P.techs.free_spirit = true; u.naval = 'bomber'; at(st, u.x, u.y).t = T.SHALLOW;
  const s0 = P.stars;
  check(TT.disband(st, u.id) && P.stars === s0 + Math.floor((5 + 15) / 2), 'disbanding a swordsman in a bomber refunds 10');
}

// ---- invariants over bot games, and what bots do under these rules
const types = Object.keys(TT.MAP_TYPES), sizes = ['tiny', 'small', 'normal', 'large', 'huge'];
const builds = {}, acts = {}, winners = {};
let games = 0;
function invariants(st, where) {
  const seen = new Set();
  for (const u of st.units) {
    const k = u.y * st.W + u.x, tl = st.tiles[k];
    if (seen.has(k)) throw new Error(where + ': two units on a tile');
    seen.add(k);
    if (u.hp <= 0 || u.hp > TT.stats(st, u).maxHp) throw new Error(where + ': bad hp');
    if (!u.naval && TT.isWater(tl.t) && !tl.bridge) throw new Error(where + ': land unit on water');
    if (u.naval && (!TT.isWater(tl.t) || tl.bridge)) throw new Error(where + ': boat on land');
    if (u.naval && !TT.NAVAL[u.naval]) throw new Error(where + ': unknown vessel ' + u.naval);
    if (!TT.UNITS[u.type]) throw new Error(where + ': unknown unit type ' + u.type);
    if (u.vet && TT.has(TT.UNITS[u.type], 'static')) throw new Error(where + ': static unit promoted');
  }
  for (const P of st.players) if (P.stars < 0) throw new Error(where + ': negative stars');
  for (const c of st.cities) if (c.owner >= 0 && (c.pop >= c.level + 1 || c.pop < 0)) throw new Error(where + ': population out of range');
}
for (let g = 0; g < Number(process.argv[2] || 30); g++) {
  TT.ML.seedRandom(g + 1);
  const n = 2 + (g % 5), size = sizes[Math.min(4, (g % 3) + (n > 3 ? 2 : 0))];
  const st = TT.newGame({ tribes: ids.slice(g % 12).concat(ids).slice(0, n), humans: [], opponents: n - 1, size, mapType: types[g % types.length], seed: 900 + g, difficulty: ['normal', 'hard', 'crazy'][g % 3], mode: 'score', turnLimit: 30 });
  TT.ML.listen(st, { before: (s, name, args) => name === 'build' ? args[2] : name, after: (s, name, args, r, k) => { if (r && k) { if (name === 'build') builds[k] = (builds[k] || 0) + 1; else acts[k] = (acts[k] || 0) + 1; } } });
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
for (const k of ['farm', 'mine', 'lumber', 'port', 'windmill', 'forge', 'sawmill', 'market', 'temple']) check(builds[k] > 0, 'bots build ' + k);
check(Object.keys(builds).some(k => TT.BUILD[k].monument), 'bots build monuments');
for (const k of ['buildEmbassy', 'upgrade', 'examine']) check(acts[k] > 0, 'bots ' + k);
console.log({ games, failures: fails, builds, acts, winners });
process.exit(fails ? 1 : 0);
