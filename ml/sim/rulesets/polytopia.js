// "The Battle of Polytopia" rules for the simulator, so the model trains on the real game's mechanics.
//
// Reference: the open-source research re-implementation of Polytopia, Tribes (github.com/GAIGResearch/Tribes,
// src/core/TribesConfig.java and src/core/Types.java), which encodes the classic game: its 12 tribes and their
// starting tech and unit, the 24-tech tree, units, buildings (with windmill/forge/sawmill/customs adjacency),
// ruins, city rewards and the score formula. Lines marked "verify" are where sources disagree or the live game has
// been re-balanced since; every number sits in the tables below so it can be updated to the patch you play.
//
// What changes compared with Tessera Tribes (the browser game in src/):
//  - 12 Polytopia tribes (start tech + start unit, 5 stars each); no tribe powers or tribe passives
//  - Polytopia tech tree (Free Spirit, Shields, Whaling ...); Polytopia unit roster and skills
//  - buildings: windmill / forge / sawmill / customs house adjacency, four temple kinds, burn forest, destroy
//  - ruins are explored with an explicit "examine" action instead of by stepping on them
//  - no storms or resource blooms, no buying walls, no market or embassy, disband needs Free Spirit
//  - classic score: cities 100 + 5 per population grown, territory 20/tile, tech 100 x tier, units by type,
//    exploration 5/tile, temples 100, parks 250
'use strict';

const START_STARS = 5;

// id, name, starting tech, starting unit (Tribes, Types.TRIBE)
const TRIBES = [
  ['xinxi', 'Xin-xi', 'climbing', 'warrior', 0xd8302b],
  ['imperius', 'Imperius', 'organization', 'warrior', 0x2c5bd8],
  ['bardur', 'Bardur', 'hunting', 'warrior', 0x6d6d6d],
  ['oumaji', 'Oumaji', 'riding', 'rider', 0xf2d72e],
  ['kickoo', 'Kickoo', 'fishing', 'warrior', 0x3ec43e],
  ['hoodrick', 'Hoodrick', 'archery', 'archer', 0x9a6a18],
  ['luxidoor', 'Luxidoor', null, 'warrior', 0xab3bd6],
  ['vengir', 'Vengir', 'smithery', 'swordsman', 0xe8e8e8],
  ['zebasi', 'Zebasi', 'farming', 'warrior', 0xf29a1a],
  ['aimo', 'Ai-Mo', 'meditation', 'warrior', 0x36e2aa],
  ['quetzali', 'Quetzali', 'shields', 'defender', 0x275c4a],
  ['yadakk', 'Yadakk', 'roads', 'warrior', 0x7d261c],
];

// tier, parent, what it unlocks (Tribes, Types.TECHNOLOGY)
const TECHS = {
  climbing: [1, null, 'Move onto mountains. Mountains give x1.5 defence.'],
  fishing: [1, null, 'Catch fish, build ports, embark in boats.'], // ports: Tribes puts them under Sailing (verify)
  hunting: [1, null, 'Hunt wild animals.'],
  organization: [1, null, 'Harvest fruit.'],
  riding: [1, null, 'Train Riders.'],
  archery: [2, 'hunting', 'Train Archers. Forests give x1.5 defence.'],
  farming: [2, 'organization', 'Build farms on crops.'],
  forestry: [2, 'hunting', 'Build lumber huts. Clear forests for stars.'],
  free_spirit: [2, 'riding', 'Build temples. Disband units.'],
  meditation: [2, 'climbing', 'Build mountain temples.'],
  mining: [2, 'climbing', 'Build mines on ore.'],
  roads: [2, 'riding', 'Build roads.'],
  sailing: [2, 'fishing', 'Upgrade boats to ships. Sail deep ocean.'],
  shields: [2, 'organization', 'Train Defenders.'],
  whaling: [2, 'fishing', 'Hunt whales for stars.'],
  aquatism: [3, 'whaling', 'Build water temples. Boats defend x1.5.'],
  chivalry: [3, 'free_spirit', 'Train Knights. Burn forests into crop fields.'],
  construction: [3, 'farming', 'Build windmills. Destroy buildings.'],
  mathematics: [3, 'forestry', 'Train Catapults. Build sawmills.'],
  navigation: [3, 'sailing', 'Upgrade ships to battleships.'],
  smithery: [3, 'mining', 'Train Swordsmen. Build forges.'],
  spiritualism: [3, 'archery', 'Build forest temples. Grow forests.'],
  trade: [3, 'roads', 'Build customs houses.'],
  philosophy: [3, 'meditation', 'Train Mind Benders. Research costs a third less.'],
};
const PHILOSOPHY_DISCOUNT = 0.67; // the game advertises -33%; Tribes uses a different factor (verify)

// cost, attack, defence, movement, range, HP, skills, tech (Tribes, TribesConfig; knight per the live game, verify)
const UNITS = {
  warrior:    [2, 2, 2, 1, 1, 10, ['dash', 'fortify'], null],
  rider:      [3, 2, 1, 2, 1, 10, ['dash', 'escape', 'fortify'], 'riding'],
  archer:     [3, 2, 1, 1, 2, 10, ['dash', 'fortify'], 'archery'],
  defender:   [3, 1, 3, 1, 1, 15, ['fortify'], 'shields'],
  swordsman:  [5, 3, 3, 1, 1, 15, ['dash'], 'smithery'],
  mindbender: [5, 0, 1, 1, 1, 10, ['heal', 'convert'], 'philosophy'],
  knight:     [8, 3.5, 1, 3, 1, 10, ['dash', 'persist', 'fortify'], 'chivalry'], // Tribes: 4 attack, 15 HP
  catapult:   [8, 4, 0, 1, 3, 10, [], 'mathematics'],
  giant:      [10, 5, 4, 1, 1, 40, [], null], // super unit: city level-5 reward or ruins, never trained
};
const NAMES = { warrior: 'Warrior', rider: 'Rider', archer: 'Archer', defender: 'Defender', swordsman: 'Swordsman', mindbender: 'Mind Bender', knight: 'Knight', catapult: 'Catapult', giant: 'Giant' };
// score points per unit (TribesConfig *_POINTS)
const UNIT_POINTS = { warrior: 10, rider: 15, archer: 15, defender: 15, swordsman: 25, mindbender: 25, knight: 40, catapult: 40, giant: 50 };

// cost (negative = stars gained), population, tech (TribesConfig). bonus: per adjacent matching building.
const BUILD = {
  fruit:           { name: 'Gather fruit',    cost: 2,   pop: 1, tech: 'organization' },
  hunt:            { name: 'Hunt animals',    cost: 2,   pop: 1, tech: 'hunting' },
  fish:            { name: 'Catch fish',      cost: 2,   pop: 1, tech: 'fishing' },
  whale:           { name: 'Hunt whales',     cost: -10, pop: 0, tech: 'whaling' },
  farm:            { name: 'Farm',            cost: 5,   pop: 2, tech: 'farming' },
  mine:            { name: 'Mine',            cost: 5,   pop: 2, tech: 'mining' },
  lumber:          { name: 'Lumber hut',      cost: 2,   pop: 1, tech: 'forestry' },
  port:            { name: 'Port',            cost: 10,  pop: 1, tech: 'fishing' }, // Tribes: +2 population (verify)
  windmill:        { name: 'Windmill',        cost: 5,   pop: 0, bonus: 1, feeds: 'farm', tech: 'construction' },
  forge:           { name: 'Forge',           cost: 5,   pop: 0, bonus: 2, feeds: 'mine', tech: 'smithery' },
  sawmill:         { name: 'Sawmill',         cost: 5,   pop: 0, bonus: 1, feeds: 'lumber', tech: 'mathematics' },
  customs:         { name: 'Customs house',   cost: 5,   pop: 0, prod: 2, feeds: 'port', tech: 'trade' },
  temple:          { name: 'Temple',          cost: 20,  pop: 1, tech: 'free_spirit' },
  forest_temple:   { name: 'Forest temple',   cost: 15,  pop: 1, tech: 'spiritualism' },
  mountain_temple: { name: 'Mountain temple', cost: 20,  pop: 1, tech: 'meditation' },
  water_temple:    { name: 'Water temple',    cost: 20,  pop: 1, tech: 'aquatism' },
  road:            { name: 'Road',            cost: 2,   pop: 0, tech: 'roads' },
  clear:           { name: 'Clear forest',    cost: -2,  pop: 0, tech: 'forestry' },
  grow:            { name: 'Grow forest',     cost: 5,   pop: 0, tech: 'spiritualism' },
  burn:            { name: 'Burn forest',     cost: 5,   pop: 0, tech: 'chivalry' },
  destroy:         { name: 'Destroy',         cost: 0,   pop: 0, tech: 'construction' },
};
const ADJ = {}; // base building -> the adjacency building it feeds
for (const k of Object.keys(BUILD)) if (BUILD[k].feeds) ADJ[BUILD[k].feeds] = k;
const ONE_PER_CITY = ['windmill', 'forge', 'sawmill', 'customs'];
const TEMPLES = ['temple', 'forest_temple', 'mountain_temple', 'water_temple'];

// ruins (Tribes, Types.EXAMINE_BONUS): one of five, uniformly
const RUIN_REWARDS = ['giant', 'research', 'growth', 'explorer', 'resources'];
const RUIN_STARS = 10, RUIN_POP = 3, EXPLORER_STEPS = 15;

const SCORE = { city: 100, pop: 5, land: 20, techTier: 100, explore: 5, temple: 100, park: 250 };

module.exports = function apply(TT) {
  const T = TT.T, cheb = TT.dist;
  const R = TT.RULESET = { name: 'polytopia', hasPower: false, startStars: START_STARS,
    verbs: ['move', 'attack', 'convert', 'capture', 'examine', 'recover', 'heal', 'disband', 'upgrade', 'train', 'reward', 'build', 'research', 'end_turn'] };

  // ------------------------------------------------------------ data tables
  TT.TRIBES = TRIBES.map(([id, name, tech, unit, color]) => ({ id, name, color, startTech: tech, startUnit: unit, startStars: START_STARS,
    passive: '', power: null, powerName: '', powerDesc: '', syl: ['ka', 'lo', 'mi', 'ra', 'tu', 'en', 'sa', 'ri', 'po', 'na', 'te', 'vu'] }));
  TT.TECHS = {};
  for (const k of Object.keys(TECHS)) TT.TECHS[k] = { name: k.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()), tier: TECHS[k][0], req: TECHS[k][1], desc: TECHS[k][2] };
  TT.TECH_ORDER = Object.keys(TT.TECHS);
  TT.UNITS = {};
  for (const k of Object.keys(UNITS)) {
    const [cost, atk, def, move, range, hp, skills, tech] = UNITS[k];
    TT.UNITS[k] = { name: NAMES[k], cost, atk, def, move, range, hp, skills, tech, super: k === 'giant' || undefined };
  }
  TT.UNIT_ORDER = Object.keys(UNITS).filter(k => k !== 'giant');
  TT.BUILD = BUILD;
  TT.MAP_SIZES = { tiny: 11, small: 14, normal: 16, large: 18, huge: 20, massive: 30 };
  TT.MAP_TYPES = {
    drylands:    { name: 'Drylands',    land: 0.86, mountains: 0.14, forest: 0.3,  desc: 'Almost all land' },
    lakes:       { name: 'Lakes',       land: 0.72, mountains: 0.13, forest: 0.36, desc: 'Land dotted with lakes' },
    continents:  { name: 'Continents',  land: 0.46, mountains: 0.14, forest: 0.32, desc: 'A few large islands' },
    pangaea:     { name: 'Pangea',      land: 0.56, mountains: 0.14, forest: 0.32, desc: 'One great landmass' },
    archipelago: { name: 'Archipelago', land: 0.34, mountains: 0.12, forest: 0.3,  desc: 'Many small islands' },
    waterworld:  { name: 'Water World', land: 0.2,  mountains: 0.1,  forest: 0.3,  desc: 'Scattered specks of land' },
  };
  TT.POWER_COST = 1e9; // no tribe powers
  const defaults = TT.defaultSettings;
  TT.defaultSettings = () => Object.assign(defaults(), { tribe: 'xinxi', events: false });

  // ------------------------------------------------------------ setup
  const newGame = TT.newGame;
  TT.newGame = function (settings) {
    const st = newGame(Object.assign({}, settings, { events: false }));
    st.settings.rules = 'polytopia';
    for (const P of st.players) {
      P.stars = START_STARS; P.power = 0;
      const unit = TT.tribe(P.tribe).startUnit, u = st.units.find(x => x.owner === P.id);
      if (u && unit && u.type !== unit) { u.type = unit; u.hp = TT.UNITS[unit].hp; }
    }
    TT.bump(st);
    return st;
  };

  // ------------------------------------------------------------ helpers
  const tileAt = (st, x, y) => st.tiles[y * st.W + x];
  const neighbours = (st, x, y) => {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && TT.inB(st, x + dx, y + dy)) out.push([x + dx, y + dy, tileAt(st, x + dx, y + dy)]);
    return out;
  };
  // same growth rule as the engine: level n needs n + 1 population, each level-up queues a reward
  function addPop(st, c, n, evs) {
    c.pop += n;
    while (c.pop >= c.level + 1) {
      c.pop -= c.level + 1; c.level++; c.pending.push(c.level);
      evs.push({ type: 'levelup', cid: c.id, x: c.x, y: c.y, level: c.level });
      TT.logMsg(st, c.name + ' grew to level ' + c.level + '.', c.owner);
    }
    if (c.pop < 0) c.pop = 0;
    TT.bump(st);
  }
  // population an adjacency building gets from (or gives to) its neighbours
  const adjCount = (st, pid, x, y, imp) => neighbours(st, x, y).filter(([, , t]) => t.imp === imp && t.owner === pid).length;

  // ------------------------------------------------------------ buildings
  TT.buildOptions = function (st, pid, x, y) {
    const tl = tileAt(st, x, y), out = [];
    if (tl.owner !== pid || tl.city < 0 || st.cities[tl.city].owner !== pid) return out;
    const occ = TT.unitAt(st, x, y);
    if (occ && occ.owner !== pid) return out;
    const water = TT.isWater(tl.t);
    if (tl.res === 'fruit') out.push('fruit');
    if (tl.res === 'game') out.push('hunt');
    if (tl.res === 'fish') out.push('fish');
    if (tl.res === 'whale') out.push('whale');
    if (tl.res === 'crop' && !tl.imp) out.push('farm');
    if (tl.res === 'ore' && !tl.imp) out.push('mine');
    if (tl.site < 0 && !tl.imp && !tl.res) {
      if (tl.t === T.FOREST) out.push('lumber', 'clear', 'burn', 'forest_temple');
      if (tl.t === T.FIELD) {
        for (const k of ONE_PER_CITY) if (!st.tiles.some(t => t.imp === k && t.city === tl.city)) out.push(k);
        out.push('temple', 'grow');
      }
      if (tl.t === T.MOUNTAIN) out.push('mountain_temple');
      if (water) {
        if (tl.t === T.SHALLOW && neighbours(st, x, y).some(([, , t]) => !TT.isWater(t.t))) out.push('port');
        out.push('water_temple');
      }
    }
    if (tl.imp && tl.site < 0) out.push('destroy');
    if (!water && !tl.road && tl.site < 0) out.push('road');
    return out;
  };

  TT.build = function (st, x, y, k) {
    const pid = st.current;
    if (st.over || !TT.canBuild(st, pid, x, y, k)) return null;
    const tl = tileAt(st, x, y), P = st.players[pid], B = BUILD[k], c = st.cities[tl.city];
    P.stars -= B.cost;
    const evs = [{ type: 'build', x, y, kind: k, cid: c.id }];
    const feedAdjacent = imp => { // a new base building raises any neighbouring windmill/forge/sawmill of ours
      for (const [, , t] of neighbours(st, x, y)) if (t.imp === imp && t.owner === pid && t.city >= 0) addPop(st, st.cities[t.city], BUILD[imp].bonus, evs);
    };
    switch (k) {
      case 'fruit': case 'hunt': case 'fish': tl.res = null; addPop(st, c, B.pop, evs); break;
      case 'whale': tl.res = null; break;
      case 'farm': case 'mine': case 'lumber': tl.imp = k; addPop(st, c, B.pop, evs); feedAdjacent(ADJ[k]); break;
      case 'windmill': case 'forge': case 'sawmill':
        tl.imp = k;
        for (const [, , t] of neighbours(st, x, y)) if (t.imp === B.feeds && t.owner === pid && t.city >= 0) addPop(st, st.cities[t.city], B.bonus, evs);
        break;
      case 'port':
        tl.imp = 'port'; addPop(st, c, B.pop, evs);
        for (const [, , t] of neighbours(st, x, y)) if (t.imp === 'customs' && t.owner === pid) c.prod = (c.prod || 0) + BUILD.customs.prod;
        break;
      case 'customs':
        tl.imp = 'customs';
        for (const [, , t] of neighbours(st, x, y)) if (t.imp === 'port' && t.owner === pid && t.city >= 0) { const pc = st.cities[t.city]; pc.prod = (pc.prod || 0) + B.prod; }
        break;
      case 'temple': case 'forest_temple': case 'mountain_temple': case 'water_temple': tl.imp = k; addPop(st, c, B.pop, evs); break;
      case 'road': tl.road = true; break;
      case 'clear': tl.t = T.FIELD; break;
      case 'grow': tl.t = T.FOREST; break;
      case 'burn': tl.t = T.FIELD; tl.res = 'crop'; break;
      case 'destroy': { // removes the building and the population it gave its own city (adjacency effects stay: simplification)
        const old = tl.imp;
        tl.imp = null;
        if (BUILD[old] && BUILD[old].pop) c.pop = Math.max(0, c.pop - BUILD[old].pop);
        break;
      }
    }
    TT.bump(st);
    return evs;
  };

  // ------------------------------------------------------------ economy and research
  TT.income = function (st, pid) {
    const P = st.players[pid];
    let s = 0;
    for (const c of st.cities) if (c.owner === pid) s += c.level + c.workshop + (c.prod || 0) + (c.capital ? 1 : 0);
    if (P.isAI) s += TT.DIFFICULTY[P.difficulty || 'normal'].bonus;
    return s;
  };
  TT.techCost = function (st, pid, k) {
    const n = Math.max(1, st.cities.filter(c => c.owner === pid).length);
    let cost = TT.TECHS[k].tier * n + 4;
    if (st.players[pid].techs.philosophy) cost = Math.ceil(cost * PHILOSOPHY_DISCOUNT);
    return cost;
  };

  // ------------------------------------------------------------ score
  TT.SCORE_PARTS = [
    { key: 'cities', name: 'Cities', rule: SCORE.city + ' per city + ' + SCORE.pop + ' per population point it has grown' },
    { key: 'land', name: 'Territory', rule: SCORE.land + ' per tile inside your borders' },
    { key: 'tech', name: 'Technology', rule: SCORE.techTier + ' x tier per technology' },
    { key: 'army', name: 'Army', rule: 'points per unit type (warrior 10 ... giant 50)' },
    { key: 'explore', name: 'Exploration', rule: SCORE.explore + ' per tile revealed' },
    { key: 'temples', name: 'Temples', rule: SCORE.temple + ' per temple' },
    { key: 'parks', name: 'Parks', rule: SCORE.park + ' per park' },
  ];
  TT.scoreBreakdown = function (st, pid) {
    const P = st.players[pid];
    const b = { cities: 0, land: 0, tech: 0, army: 0, explore: 0, temples: 0, parks: 0, total: 0 };
    if (!P.alive) return b;
    for (const c of st.cities) if (c.owner === pid) {
      b.cities += SCORE.city + SCORE.pop * Math.max(0, (c.level - 1) * (c.level + 2) / 2 + c.pop);
      b.parks += c.parks * SCORE.park;
    }
    for (const t of st.tiles) if (t.owner === pid) { b.land += SCORE.land; if (TEMPLES.indexOf(t.imp) >= 0) b.temples += SCORE.temple; }
    for (const k of Object.keys(P.techs)) b.tech += SCORE.techTier * TT.TECHS[k].tier;
    for (const u of st.units) if (u.owner === pid) b.army += UNIT_POINTS[u.type] || 0;
    for (const e of P.explored) b.explore += e * SCORE.explore;
    b.total = b.cities + b.land + b.tech + b.army + b.explore + b.temples + b.parks;
    return b;
  };

  // ------------------------------------------------------------ actions that differ
  for (const k of ['usePower', 'buildWalls', 'buildEmbassy', 'infiltrate']) TT[k] = () => null;
  const disband = TT.disband;
  TT.disband = function (st, uid) { return st.players[st.current].techs.free_spirit ? disband(st, uid) : null; };

  // ruins wait for "examine": hide them from the engine's step-on pickup during moves and attacks
  const hideRuin = fn => function (st) {
    const spots = [];
    const args = Array.prototype.slice.call(arguments);
    const mark = (x, y) => { if (TT.inB(st, x, y)) { const t = tileAt(st, x, y); if (t.ruin) { t.ruin = false; spots.push(t); } } };
    if (fn === move) mark(args[2], args[3]);
    else { const d = TT.getUnit(st, args[2]); if (d) mark(d.x, d.y); }
    try { return fn.apply(this, args); } finally { for (const t of spots) t.ruin = true; }
  };
  const move = TT.move, attack = TT.attack;
  TT.move = hideRuin(move);
  TT.attack = hideRuin(attack);

  TT.examine = function (st, uid) {
    const u = TT.getUnit(st, uid);
    if (!u || u.owner !== st.current || st.over || u.naval) return null;
    const tl = tileAt(st, u.x, u.y);
    if (!tl.ruin) return null;
    tl.ruin = false;
    const P = st.players[u.owner], evs = [];
    let kind = RUIN_REWARDS[(TT.rand(st) * RUIN_REWARDS.length) | 0], msg = '';
    if (kind === 'research') {
      const avail = TT.TECH_ORDER.filter(k => TT.canResearch(st, u.owner, k, true));
      if (avail.length) { const k = avail[(TT.rand(st) * avail.length) | 0]; P.techs[k] = true; msg = 'the secret of ' + TT.TECHS[k].name; } else kind = 'resources';
    }
    if (kind === 'giant') {
      const spot = neighbours(st, u.x, u.y).find(([x, y, t]) => !TT.unitAt(st, x, y) && !TT.isWater(t.t) && (t.t !== T.MOUNTAIN || P.techs.climbing));
      if (spot) { const g = TT.spawnUnit(st, 'giant', u.owner, spot[0], spot[1], -1, false); evs.push({ type: 'spawn', uid: g.id, x: g.x, y: g.y, big: true }); msg = 'a Giant'; } else kind = 'resources';
    }
    if (kind === 'growth') {
      let best = null, bd = 1e9;
      for (const c of st.cities) if (c.owner === u.owner) { const d = cheb(c.x, c.y, u.x, u.y); if (d < bd) { bd = d; best = c; } }
      if (best) { addPop(st, best, RUIN_POP, evs); msg = RUIN_POP + ' population for ' + best.name; } else kind = 'resources';
    }
    if (kind === 'explorer') {
      let x = u.x, y = u.y, n = 0;
      for (let s = 0; s < EXPLORER_STEPS; s++) {
        x = Math.max(0, Math.min(st.W - 1, x + Math.round((TT.rand(st) - 0.5) * 4)));
        y = Math.max(0, Math.min(st.H - 1, y + Math.round((TT.rand(st) - 0.5) * 4)));
        n += TT.reveal(st, u.owner, x, y, 1);
      }
      msg = 'an explorer (' + n + ' tiles revealed)';
    }
    if (kind === 'resources') { P.stars += RUIN_STARS; msg = RUIN_STARS + ' stars'; }
    u.canMove = false; u.canAttack = false;
    evs.push({ type: 'ruin', x: u.x, y: u.y, pid: u.owner, msg });
    TT.logMsg(st, P.name + ' examined ruins and found ' + msg + '.', u.owner);
    TT.bump(st);
    return evs;
  };
  TT.ACTIONS.push('examine');

  // ------------------------------------------------------------ bot support (src/ai.js reads TT.AIHOOKS)
  const owned = (st, pid, imp) => st.tiles.filter(t => t.imp === imp && t.owner === pid).length;
  TT.AIHOOKS = {
    noWalls: true,
    skipBuild: { burn: true, destroy: true },
    buildPop(st, pid, x, y, k) {
      const B = BUILD[k];
      if (B.bonus) return B.bonus * adjCount(st, pid, x, y, B.feeds);
      if (k === 'customs') return 1.5 * B.prod * adjCount(st, pid, x, y, 'port');
      if (ADJ[k]) { // a base building also feeds a neighbouring windmill/forge/sawmill (population) or customs house (stars)
        const F = BUILD[ADJ[k]], n = adjCount(st, pid, x, y, ADJ[k]);
        return B.pop + (F.bonus ? F.bonus * n : 1.5 * F.prod * n);
      }
      if (TEMPLES.indexOf(k) >= 0) return 1.5;
      return B.pop;
    },
    techValue(st, pid, k, ctx) {
      const w = ctx.war;
      switch (k) {
        case 'free_spirit': return 0.7 + w * 0.8;
        case 'construction': return owned(st, pid, 'farm') * 0.9 + 0.3;
        case 'smithery': return w * 3 + 0.8 + owned(st, pid, 'mine') * 1.2;
        case 'mathematics': return w * 3 + 0.6 + owned(st, pid, 'lumber') * 0.5;
        case 'trade': return owned(st, pid, 'port') * 1.5 + 0.3;
        case 'whaling': return (ctx.terr.whale || 0) * 3 + 0.3;
      }
      return null;
    },
  };
  // the bot has no notion of ruins needing a look: its units examine any ruin they end the turn on
  R.afterBotTurn = function (st) {
    for (const u of st.units.slice()) if (u.owner === st.current && !u.naval && tileAt(st, u.x, u.y).ruin) TT.examine(st, u.id);
  };
  R.tables = { TRIBES, TECHS, UNITS, BUILD, UNIT_POINTS, SCORE, RUIN_REWARDS };
};
