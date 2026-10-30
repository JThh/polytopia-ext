// "The Battle of Polytopia" rules as of the live game, version 2.17.3 (Sep 2026), regular tribes only.
// Select with POLY_RULES=polytopia_live; the classic ruleset (rulesets/polytopia.js) stays as it was for older runs.
//
// Sources (see ml/sim/rulesets/POLYTOPIA_LIVE.md for the table of values, sources and confidence): the game's own
// rules data (GameLogicData version 28, unchanged from 2.17.2 to 2.17.3) for every unit, tech, building and tribe
// number; a decompile-based re-implementation that replays real games exactly (PolyBot) for formulas the data does
// not hold (score, meetings, healing, city connections, ruins); official patch notes and the Polytopia Wiki for the
// rest. Values marked "verify" have only one weak source. Not simulated: peace treaties and the AI opinion system,
// the four special tribes, starving cities, Perfection's difficulty multiplier (only rescales your displayed score).
//
// Changes from the classic ruleset, in short:
//  - tech tree: Shields -> Strategy, Whaling -> Ramming, new Diplomacy; Burn Forest in Construction, Destroy in
//    Chivalry; backwards research (tier 2 from an owned tier-3 child); Literacy = ceil(2/3 of the cost)
//  - navy: a unit entering a port becomes a Raft (0 attack), upgradable in own territory to Scout / Rammer /
//    Bomber; Giant -> Juggernaut, Cloak -> Dinghy, Dagger -> Pirate; ocean needs Sailing
//  - Cloak (Diplomacy): hidden, infiltrates enemy cities to spawn Daggers; Embassies (+2 stars a turn to both)
//  - economy: Port 7 stars +1 pop, Lumber hut 3, Road 3, Bridge 5, Burn 3, Clear +1; Market replaces the
//    Customs house; Starfish (+8) replace whales; Forge also on forests; parks +1 star a turn; temples level up
//  - monuments with their tasks, lighthouses in the four corners, ruins without Giants
//  - combat: Stiff (no retaliation) and Surprise (no retaliation against it), Static (never veteran),
//    splash = half the splashed unit's own damage, rounded down; no high-ground or mountain-range bonus
//  - starting stars and units per tribe (2.14.0), tribe terrain/resource biases, live bot star bonuses
'use strict';

const VERSION = '2.17.3';

// id, name, start tech, start unit, colour, start stars, terrain/resource multipliers, resources next to the capital
// (game data: tribeData startingStars / terrainModifier / resourceModifier / startingResource; 5 stars when unset).
// The water multipliers (Oumaji 0.5, Kickoo 2) are not applied: the map type alone sets the land/water split here.
const TRIBES = [
  ['xinxi', 'Xin-xi', 'climbing', 'warrior', 0xd8302b, 7, { mountain: 1.5, ore: 1.5 }, { ore: 2 }],
  ['imperius', 'Imperius', 'organization', 'warrior', 0x2c5bd8, 5, { fruit: 2, game: 0.5 }, { fruit: 2 }],
  ['bardur', 'Bardur', 'hunting', 'warrior', 0x6d6d6d, 5, { forest: 0.8, crop: 0 }, { game: 2 }],
  ['oumaji', 'Oumaji', 'riding', 'rider', 0xf2d72e, 6, { forest: 0.2, game: 0.2, mountain: 0.5 }, { fruit: 2 }],
  ['kickoo', 'Kickoo', 'fishing', 'warrior', 0x3ec43e, 5, { mountain: 0.5, fish: 1.5 }, { fish: 2 }],
  ['hoodrick', 'Hoodrick', 'archery', 'archer', 0x9a6a18, 7, { forest: 1.5, mountain: 0.5 }, { game: 2 }],
  ['luxidoor', 'Luxidoor', null, 'warrior', 0xab3bd6, 2, {}, { game: 2, fruit: 2, fish: 2, crop: 1, ore: 1 }],
  ['vengir', 'Vengir', 'smithery', 'swordsman', 0xe8e8e8, 5, { ore: 2, fruit: 0.1, game: 0.1, fish: 0.1 }, { ore: 1 }],
  ['zebasi', 'Zebasi', 'farming', 'warrior', 0xf29a1a, 5, { mountain: 0.5, forest: 0.5, fruit: 0.5 }, { crop: 2 }],
  ['aimo', 'Ai-Mo', 'philosophy', 'mindbender', 0x36e2aa, 5, { mountain: 1.5, crop: 0.1 }, { game: 2 }],
  ['quetzali', 'Quetzali', 'shields', 'defender', 0x275c4a, 7, { fruit: 2, crop: 0.1 }, { fruit: 2 }],
  ['yadakk', 'Yadakk', 'roads', 'warrior', 0x7d261c, 7, { mountain: 0.5, forest: 0.5, fruit: 1.5 }, { fruit: 2 }],
];
// Set by the project owner. The data only says "bonus":1, and the wiki and the starting-score arithmetic point to
// level 3; change it here if that turns out right.
const LUXIDOOR_CAPITAL_LEVEL = 4;

// tier, parent, what it unlocks (2.2 Diplomacy, 2.8 Path of the Ocean, 2.8.5, 2.14 backwards research). Ids are the
// game data's; Shields is shown as Strategy since 2.10.
const TECHS = {
  climbing: [1, null, 'Move onto mountains. Mountains give x1.5 defence.'],
  fishing: [1, null, 'Catch fish. Build ports: units entering one embark as rafts. Move on shallow water.'],
  hunting: [1, null, 'Hunt wild animals.'],
  organization: [1, null, 'Gather fruit.'],
  riding: [1, null, 'Train Riders.'],
  archery: [2, 'hunting', 'Train Archers. Forests give x1.5 defence.'],
  forestry: [2, 'hunting', 'Build lumber huts. Clear forests for 1 star.'],
  farming: [2, 'organization', 'Build farms on crops.'],
  shields: [2, 'organization', 'Train Defenders.'],
  free_spirit: [2, 'riding', 'Build temples. Disband units.'],
  roads: [2, 'riding', 'Build roads and bridges.'],
  meditation: [2, 'climbing', 'Build mountain temples. Pacifist task (Altar of Peace).'],
  mining: [2, 'climbing', 'Build mines on ore.'],
  sailing: [2, 'fishing', 'Upgrade rafts to Scouts. Move on deep ocean.'],
  ramming: [2, 'fishing', 'Upgrade rafts to Rammers.'],
  spiritualism: [3, 'archery', 'Build forest temples. Grow forests.'],
  mathematics: [3, 'forestry', 'Train Catapults. Build sawmills.'],
  construction: [3, 'farming', 'Build windmills. Burn forests into crop fields.'],
  diplomacy: [3, 'shields', 'Train Cloaks. Build embassies. See the capitals of tribes you have met.'],
  chivalry: [3, 'free_spirit', 'Train Knights. Destroy buildings.'],
  trade: [3, 'roads', 'Build markets. Wealth task (Emperor\'s Tomb).'],
  philosophy: [3, 'meditation', 'Train Mind Benders. Literacy: research costs a third less. Genius task.'],
  smithery: [3, 'mining', 'Train Swordsmen. Build forges.'],
  navigation: [3, 'sailing', 'Upgrade rafts to Bombers. Harvest starfish.'],
  aquatism: [3, 'ramming', 'Build water temples. Units on water defend x1.5.'],
};
const TECH_NAMES = { shields: 'Strategy', free_spirit: 'Free Spirit' };
const literacy = cost => Math.ceil(cost * 2 / 3); // wiki table; matches ceil(2c/3) for every listed cost

// cost, attack, defence, movement, range, HP, skills, tech. Skills the engine knows under other names:
// stealth = Hide. New here: stiff (never retaliates), surprise (its attacks draw no retaliation), static (never
// veteran), independent (needs no city support), creep (forests do not stop it). Units with infiltrate have attack
// 2 in the game data but only use it on enemy cities (the infiltrate verb); they cannot attack units.
const UNITS = {
  warrior:    [2, 2, 2, 1, 1, 10, ['dash', 'fortify'], null],
  rider:      [3, 2, 1, 2, 1, 10, ['dash', 'escape', 'fortify'], 'riding'],
  archer:     [3, 2, 1, 1, 2, 10, ['dash', 'fortify'], 'archery'],
  defender:   [3, 1, 3, 1, 1, 15, ['fortify'], 'shields'],
  swordsman:  [5, 3, 3, 1, 1, 15, ['dash'], 'smithery'],
  mindbender: [5, 0, 1, 1, 1, 10, ['heal', 'convert', 'stiff'], 'philosophy'],
  cloak:      [8, 2, 0.5, 2, 1, 5, ['stealth', 'infiltrate', 'dash', 'scout', 'creep', 'stiff', 'static'], 'diplomacy'],
  knight:     [8, 3.5, 1, 3, 1, 10, ['dash', 'persist', 'fortify'], 'chivalry'],
  catapult:   [8, 4, 0, 1, 3, 10, ['stiff'], 'mathematics'],
  dagger:     [2, 2, 2, 1, 1, 10, ['dash', 'surprise', 'independent', 'static'], null], // spawned by infiltration only
  giant:      [10, 5, 4, 1, 1, 40, ['static'], null], // super unit: a level-5+ city reward
};
const NAMES = { warrior: 'Warrior', rider: 'Rider', archer: 'Archer', defender: 'Defender', swordsman: 'Swordsman', mindbender: 'Mind Bender',
  cloak: 'Cloak', knight: 'Knight', catapult: 'Catapult', dagger: 'Dagger', giant: 'Giant' };
const SPAWNED = { dagger: true };
// vessels (game data unitData; HP is the carried unit's; cost = upgrade price)
const NAVAL = {
  raft:       { name: 'Raft',       cost: 0,  atk: 0, def: 1,   move: 2, range: 2, skills: ['carry', 'stiff', 'static'], tech: 'fishing' },
  scout:      { name: 'Scout',      cost: 5,  atk: 2, def: 1,   move: 3, range: 2, skills: ['dash', 'carry', 'scout', 'static'], tech: 'sailing' },
  rammer:     { name: 'Rammer',     cost: 5,  atk: 3, def: 3,   move: 3, range: 1, skills: ['dash', 'carry', 'static'], tech: 'ramming' },
  bomber:     { name: 'Bomber',     cost: 15, atk: 3, def: 2,   move: 2, range: 3, skills: ['splash', 'carry', 'stiff', 'static'], tech: 'navigation' },
  juggernaut: { name: 'Juggernaut', cost: 0,  atk: 4, def: 4,   move: 2, range: 1, skills: ['stomp', 'carry', 'stiff', 'static'], tech: null },
  dinghy:     { name: 'Dinghy',     cost: 0,  atk: 2, def: 0.5, move: 2, range: 1, skills: ['stealth', 'infiltrate', 'dash', 'scout', 'carry', 'stiff', 'static'], tech: null },
  pirate:     { name: 'Pirate',     cost: 0,  atk: 2, def: 2,   move: 2, range: 1, skills: ['dash', 'surprise', 'carry', 'static'], tech: null },
};
const UPGRADES = ['scout', 'rammer', 'bomber'];
const EMBARK = { giant: 'juggernaut', cloak: 'dinghy', dagger: 'pirate' }; // everyone else: raft

// cost (negative = stars gained), population, tech. bonus: pop per adjacent matching building.
const BUILD = {
  fruit:           { name: 'Gather fruit',    cost: 2,  pop: 1, tech: 'organization' },
  hunt:            { name: 'Hunt animals',    cost: 2,  pop: 1, tech: 'hunting' },
  fish:            { name: 'Catch fish',      cost: 2,  pop: 1, tech: 'fishing' },
  starfish:        { name: 'Harvest starfish', cost: -8, pop: 0, tech: 'navigation' }, // a unit of yours on the tile, any territory
  farm:            { name: 'Farm',            cost: 5,  pop: 2, tech: 'farming' },
  mine:            { name: 'Mine',            cost: 5,  pop: 2, tech: 'mining' },
  lumber:          { name: 'Lumber hut',      cost: 3,  pop: 1, tech: 'forestry' },
  port:            { name: 'Port',            cost: 7,  pop: 1, tech: 'fishing' },
  windmill:        { name: 'Windmill',        cost: 5,  pop: 0, bonus: 1, feeds: 'farm', tech: 'construction' },
  forge:           { name: 'Forge',           cost: 5,  pop: 0, bonus: 2, feeds: 'mine', tech: 'smithery' },
  sawmill:         { name: 'Sawmill',         cost: 5,  pop: 0, bonus: 1, feeds: 'lumber', tech: 'mathematics' },
  market:          { name: 'Market',          cost: 5,  pop: 0, tech: 'trade' },
  temple:          { name: 'Temple',          cost: 20, pop: 1, tech: 'free_spirit' },
  forest_temple:   { name: 'Forest temple',   cost: 15, pop: 1, tech: 'spiritualism' },
  mountain_temple: { name: 'Mountain temple', cost: 20, pop: 1, tech: 'meditation' },
  water_temple:    { name: 'Water temple',    cost: 20, pop: 1, tech: 'aquatism' },
  road:            { name: 'Road',            cost: 3,  pop: 0, tech: 'roads' },
  bridge:          { name: 'Bridge',          cost: 5,  pop: 0, tech: 'roads' },
  clear:           { name: 'Clear forest',    cost: -1, pop: 0, tech: 'forestry' },
  grow:            { name: 'Grow forest',     cost: 5,  pop: 0, tech: 'spiritualism' },
  burn:            { name: 'Burn forest',     cost: 3,  pop: 0, tech: 'construction' },
  destroy:         { name: 'Destroy',         cost: 0,  pop: 0, tech: 'chivalry' },
  // monuments: free, +3 population, 400 points, each once per tribe after its task is done
  altar_of_peace:  { name: 'Altar of Peace',  cost: 0,  pop: 3, tech: null, monument: 'pacifist' },
  emperors_tomb:   { name: 'Emperor\'s Tomb', cost: 0,  pop: 3, tech: null, monument: 'wealth' },
  eye_of_god:      { name: 'Eye of God',      cost: 0,  pop: 3, tech: null, monument: 'explorer' },
  gate_of_power:   { name: 'Gate of Power',   cost: 0,  pop: 3, tech: null, monument: 'killer' },
  grand_bazaar:    { name: 'Grand Bazaar',    cost: 0,  pop: 3, tech: null, monument: 'network' },
  park_of_fortune: { name: 'Park of Fortune', cost: 0,  pop: 3, tech: null, monument: 'metropolis' },
  tower_of_wisdom: { name: 'Tower of Wisdom', cost: 0,  pop: 3, tech: null, monument: 'genius' },
};
const ADJ = {}; // base building -> the producer it feeds
for (const k of Object.keys(BUILD)) if (BUILD[k].feeds) ADJ[BUILD[k].feeds] = k;
const ONE_PER_CITY = ['windmill', 'forge', 'sawmill', 'market'];
const PRODUCERS = ['windmill', 'forge', 'sawmill'];
const TEMPLES = ['temple', 'forest_temple', 'mountain_temple', 'water_temple'];
const MONUMENTS = Object.keys(BUILD).filter(k => BUILD[k].monument);
const MARKET_MAX = 8;
const TEMPLE_EVERY = 2, TEMPLE_MAX = 5; // a temple gains a level every 2 turns, up to level 5 (2.8.5)

// tasks: what completes each one (checked after actions and at the end of each turn)
const TASK_TURNS = 5, WEALTH_STARS = 100, KILLER_KILLS = 10, NETWORK_CITIES = 5, METROPOLIS_LEVEL = 5;

// ruins (2.0.58: no Giant; 2.8.5: water ruins give a veteran Rammer); explorer moves 12 (2.16.3)
const RUIN_REWARDS = ['swordsman', 'research', 'nomads', 'explorer', 'resources'];
const RUIN_STARS = 10, RUIN_POP = 3, EXPLORER_STEPS = 12;
const WATER_RUIN_SHARE = 0.25; // water ruins added per land ruin at map generation (verify: rate unknown)

// income: the capital's handicap is Easy 0, Normal 1, Hard 2, Crazy 4 and 1 for a human; here relative to a human
const BOT_BONUS = { easy: -1, normal: 0, hard: 1, crazy: 3 };
const EMBASSY_COST = 5, EMBASSY_INCOME = 2; // diplomacyData: flat cost; +2 a turn to the builder and to the host
// meeting a tribe (MeetAction.GetReward): 2 x min(ceil(its score / 1000), 5) + 1 stars, i.e. 1 to 11; since 2.17.3 the
// second player of a two-player game gets 2 more for meeting the first ("away stars")
const meetStars = (score, away) => 2 * Math.min(Math.ceil(Math.max(0, score) / 1000), 5) + 1 + (away ? 2 : 0);
const CONNECT_POP = 1, PORT_ROUTE = 5;    // connected city: +1 pop there and in the capital; ports link within 5 tiles

// score (Perfection): a city is 50 x (level + 1) + 5 per population in its bar; units 5 per star of cost, super
// units 50; temples 100 per level; monuments 400
const SCORE = { city: 100, cityLevel: 50, pop: 5, land: 20, techTier: 100, explore: 5, templeLevel: 100, park: 250, monument: 400, starPoints: 5, superUnit: 50 };

// map generation (Map Generation page; 2.0.58 generates each tribe's share exactly)
const BASE_TERRAIN = { mountain: 0.14, forest: 0.38 };
const RES_NEAR = { fruit: 18 / 48, crop: 18 / 48, game: 19 / 38, ore: 11 / 14 }; // next to a settlement
const RES_FAR = { fruit: 6 / 48, crop: 6 / 48, game: 6 / 38, ore: 3 / 14 };     // two tiles away
const FISH_RATE = 0.5;

module.exports = function apply(TT) {
  const T = TT.T, cheb = TT.dist;
  const R = TT.RULESET = { name: 'polytopia_live', version: VERSION, hasPower: false, startStars: 5, navalUpgrades: UPGRADES.slice(), embassyAtPos: true,
    verbs: ['move', 'attack', 'convert', 'capture', 'examine', 'recover', 'heal', 'disband', 'upgrade', 'infiltrate', 'train', 'reward', 'build', 'research', 'embassy', 'end_turn'],
    verbDesc: {
      upgrade: 'Upgrade a raft in my territory to a scout, rammer or bomber.',
      infiltrate: 'Cloak: infiltrate an adjacent enemy city: take its income this turn and raise daggers there.',
      disband: 'Remove the unit and refund half its cost (Free Spirit).',
    } };
  const has = (S, k) => S.skills.indexOf(k) >= 0;

  // ------------------------------------------------------------ data tables
  TT.TRIBES = TRIBES.map(([id, name, tech, unit, color, stars]) => ({ id, name, color, startTech: tech, startUnit: unit, startStars: stars,
    passive: '', power: null, powerName: '', powerDesc: '', syl: ['ka', 'lo', 'mi', 'ra', 'tu', 'en', 'sa', 'ri', 'po', 'na', 'te', 'vu'] }));
  const TRIBE = {};
  for (const t of TRIBES) TRIBE[t[0]] = { stars: t[5], mult: t[6], res: t[7] };
  TT.TECHS = {};
  for (const k of Object.keys(TECHS)) TT.TECHS[k] = { name: TECH_NAMES[k] || k.replace(/\b\w/g, c => c.toUpperCase()), tier: TECHS[k][0], req: TECHS[k][1], desc: TECHS[k][2] };
  TT.TECH_ORDER = Object.keys(TT.TECHS);
  TT.UNITS = {};
  for (const k of Object.keys(UNITS)) {
    const [cost, atk, def, move, range, hp, skills, tech] = UNITS[k];
    TT.UNITS[k] = { name: NAMES[k], cost, atk, def, move, range, hp, skills, tech, super: k === 'giant' || undefined, spawned: SPAWNED[k] || undefined };
  }
  TT.UNIT_ORDER = Object.keys(UNITS).filter(k => k !== 'giant' && !SPAWNED[k]);
  TT.NAVAL = NAVAL;
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
  TT.POWER_COST = 1e9;
  const defaults = TT.defaultSettings;
  TT.defaultSettings = () => Object.assign(defaults(), { tribe: 'xinxi', events: false });

  // ------------------------------------------------------------ helpers
  const tileAt = (st, x, y) => st.tiles[y * st.W + x];
  const neighbours = (st, x, y) => {
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && TT.inB(st, x + dx, y + dy)) out.push([x + dx, y + dy, tileAt(st, x + dx, y + dy)]);
    return out;
  };
  const isLand = t => !TT.isWater(t.t);
  const capitalOf = (st, pid) => st.cities.find(c => c.owner === pid && c.capital);
  const info = P => { // per-player bookkeeping for the live rules (serialized with the state)
    if (!P.live) P.live = { met: [], lights: [], tasks: {}, built: {}, pacifist: 0, attacked: false, embassies: [], lastAttack: -1 };
    return P.live;
  };
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
  const adjCount = (st, pid, x, y, imp) => neighbours(st, x, y).filter(([, , t]) => t.imp === imp && t.owner === pid).length;
  const producerLevel = (st, i) => { const t = st.tiles[i], k = t.imp; return PRODUCERS.indexOf(k) >= 0 ? adjCount(st, t.owner, i % st.W, (i / st.W) | 0, BUILD[k].feeds) : 0; };
  TT.marketYield = function (st, i) {
    const t = st.tiles[i], x = i % st.W, y = (i / st.W) | 0;
    let n = 0;
    for (const [nx, ny, nt] of neighbours(st, x, y)) if (PRODUCERS.indexOf(nt.imp) >= 0 && nt.owner === t.owner) n += producerLevel(st, ny * st.W + nx);
    return Math.min(MARKET_MAX, n);
  };
  const templeLevel = (st, t) => Math.min(TEMPLE_MAX, 1 + Math.floor(Math.max(0, st.turn - (t.builtAt == null ? st.turn : t.builtAt)) / TEMPLE_EVERY));

  // ------------------------------------------------------------ setup
  function retuneMap(st) {
    const W = st.W, N = st.tiles.length, caps = st.cities.filter(c => c.capital && c.owner >= 0);
    const region = i => { // nearest capital's tribe
      const x = i % W, y = (i / W) | 0;
      let best = null, bd = 1e9;
      for (const c of caps) { const d = cheb(c.x, c.y, x, y); if (d < bd) { bd = d; best = c; } }
      return best ? TRIBE[st.players[best.owner].tribe] : null;
    };
    const groups = new Map();
    for (let i = 0; i < N; i++) { const t = st.tiles[i]; if (isLand(t) && t.site < 0) { const r = region(i); if (r) (groups.get(r) || groups.set(r, []).get(r)).push(i); } }
    for (const [r, idx] of groups) { // terrain shares per tribe region: mountains first, then forest, rest field
      const m = BASE_TERRAIN.mountain * (r.mult.mountain == null ? 1 : r.mult.mountain);
      const f = (1 - m) * BASE_TERRAIN.forest / (1 - BASE_TERRAIN.mountain) * (r.mult.forest == null ? 1 : r.mult.forest);
      for (let k = idx.length - 1; k > 0; k--) { const j = (TT.rand(st) * (k + 1)) | 0; [idx[k], idx[j]] = [idx[j], idx[k]]; }
      const nm = Math.round(m * idx.length), nf = Math.round(Math.min(1 - m, f) * idx.length);
      idx.forEach((i, k) => { const t = st.tiles[i]; t.t = k < nm ? T.MOUNTAIN : k < nm + nf ? T.FOREST : T.FIELD; t.res = null; t.imp = null; });
    }
    const sites = st.cities.map(c => [c.x, c.y]);
    const near = i => { const x = i % W, y = (i / W) | 0; let d = 9; for (const [sx, sy] of sites) d = Math.min(d, cheb(sx, sy, x, y)); return d; };
    let whales = 0;
    for (let i = 0; i < N; i++) {
      const t = st.tiles[i];
      if (t.res === 'whale') { t.res = null; whales++; }
      if (t.site >= 0) continue;
      const d = near(i), r = region(i), mult = k => (r && r.mult[k] != null ? r.mult[k] : 1);
      if (TT.isWater(t.t)) { if (t.t === T.SHALLOW && t.res !== 'starfish') t.res = d <= 2 && TT.rand(st) < FISH_RATE * mult('fish') ? 'fish' : null; continue; }
      if (d > 2) { t.res = null; continue; }
      const P = d === 1 ? RES_NEAR : RES_FAR, u = TT.rand(st);
      if (t.t === T.FIELD) { const pf = P.fruit * mult('fruit'), pc = P.crop * mult('crop'); t.res = u < pf ? 'fruit' : u < pf + pc ? 'crop' : null; }
      else if (t.t === T.FOREST) t.res = u < P.game * mult('game') ? 'game' : null;
      else if (t.t === T.MOUNTAIN) t.res = u < P.ore * mult('ore') ? 'ore' : null;
    }
    // starfish take the whales' places on deep water, away from land
    const deep = [];
    for (let i = 0; i < N; i++) if (st.tiles[i].t === T.OCEAN && st.tiles[i].site < 0) deep.push(i);
    for (let k = 0; k < whales && deep.length; k++) { const j = (TT.rand(st) * deep.length) | 0; st.tiles[deep[j]].res = 'starfish'; deep.splice(j, 1); }
    // each capital gets its tribe's starting resources next to it (fish only where there is shallow water)
    const terrainFor = { fruit: T.FIELD, crop: T.FIELD, game: T.FOREST, ore: T.MOUNTAIN, fish: T.SHALLOW };
    for (const c of caps) {
      const want = TRIBE[st.players[c.owner].tribe].res, ring = neighbours(st, c.x, c.y);
      const taken = new Set();
      for (const k of Object.keys(want)) {
        let n = 0;
        for (const [, , t] of ring) if (t.res === k && n < want[k] && !taken.has(t)) { taken.add(t); n++; }
        for (const [, , t] of ring) {
          if (n >= want[k]) break;
          if (t.site >= 0 || taken.has(t) || (k === 'fish' ? t.t !== T.SHALLOW : !isLand(t))) continue;
          t.t = terrainFor[k]; t.res = k; taken.add(t); n++;
        }
      }
    }
    // water ruins, and lighthouses in the four corners
    const land = st.tiles.filter(t => t.ruin).length;
    for (let k = 0; k < Math.round(land * WATER_RUIN_SHARE) && deep.length; k++) {
      const j = (TT.rand(st) * deep.length) | 0, t = st.tiles[deep[j]]; deep.splice(j, 1);
      if (!t.res) t.ruin = true;
    }
    st.lighthouses = [0, st.W - 1, (st.H - 1) * W, st.H * W - 1];
  }

  const newGame = TT.newGame;
  TT.newGame = function (settings) {
    const st = newGame(Object.assign({}, settings, { events: false }));
    st.settings.rules = 'polytopia_live';
    for (const P of st.players) {
      P.stars = TRIBE[P.tribe] ? TRIBE[P.tribe].stars : 5; P.power = 0;
      const unit = TT.tribe(P.tribe).startUnit, u = st.units.find(x => x.owner === P.id);
      if (u && unit && u.type !== unit) { u.type = unit; u.hp = TT.UNITS[unit].hp; }
      if (P.tribe === 'luxidoor') { const c = capitalOf(st, P.id); if (c) { c.level = LUXIDOOR_CAPITAL_LEVEL; c.pop = 0; } }
      info(P);
    }
    retuneMap(st);
    for (const P of st.players) discover(st, P.id, []);
    TT.bump(st);
    return st;
  };

  // ------------------------------------------------------------ discoveries: meetings, capital vision, lighthouses
  function discover(st, pid, evs) {
    const P = st.players[pid], L = info(P);
    if (!P.alive) return;
    for (const q of TT.metRivals(st, pid)) {
      if (L.met.indexOf(q) >= 0) continue;
      L.met.push(q);
      const n = meetStars(TT.score(st, q), st.players.length === 2 && q === 0);
      P.stars += n;
      evs.push({ type: 'meet', pid, other: q, stars: n });
      TT.logMsg(st, P.name + ' met ' + st.players[q].name + (n ? ' and gained ' + n + ' stars.' : '.'), pid);
    }
    if (P.techs.diplomacy) for (const q of L.met) { const cap = capitalOf(st, q); if (cap) TT.reveal(st, pid, cap.x, cap.y, 1); }
    for (const i of st.lighthouses || []) {
      if (!P.explored[i] || L.lights.indexOf(i) >= 0) continue;
      L.lights.push(i);
      const cap = capitalOf(st, pid);
      if (cap) addPop(st, cap, 1, evs);
      evs.push({ type: 'lighthouse', pid, x: i % st.W, y: (i / st.W) | 0 });
    }
    checkTasks(st, pid);
  }

  // ------------------------------------------------------------ tasks and monuments
  function checkTasks(st, pid) {
    const P = st.players[pid], L = info(P), done = L.tasks;
    if (P.techs.meditation && L.pacifist >= TASK_TURNS) done.pacifist = true;
    if (P.techs.trade && P.stars >= WEALTH_STARS) done.wealth = true;
    if ((st.lighthouses || []).length && L.lights.length >= st.lighthouses.length) done.explorer = true;
    if (P.kills >= KILLER_KILLS) done.killer = true;
    if (connectedCities(st, pid).size >= NETWORK_CITIES) done.network = true;
    if (st.cities.some(c => c.owner === pid && c.level >= METROPOLIS_LEVEL)) done.metropolis = true;
    if (P.techs.philosophy && TT.TECH_ORDER.every(k => P.techs[k])) done.genius = true;
  }
  TT.monumentsAvailable = function (st, pid) {
    const L = info(st.players[pid]);
    return MONUMENTS.filter(k => L.tasks[BUILD[k].monument] && !L.built[k]);
  };

  // ------------------------------------------------------------ city connections
  // Neighbouring tiles (diagonals too) link when both are connectable: a road, a bridge, a port, or any city or
  // village tile. Two of your ports also link when one is within 5 tiles of the other by water you can sail
  // (ocean needs Sailing). Nothing links through a tile another tribe owns. The search starts at the capital.
  function connectedCities(st, pid) {
    const cap = capitalOf(st, pid), out = new Set();
    if (!cap) return out;
    const W = st.W, P = st.players[pid], seen = new Uint8Array(st.tiles.length), q = [cap.y * W + cap.x];
    const foreign = t => t.owner >= 0 && t.owner !== pid;
    const linkable = t => !foreign(t) && (t.road || t.bridge || t.site >= 0 || (t.imp === 'port' && t.owner === pid));
    const sailable = t => (t.t === T.SHALLOW || (t.t === T.OCEAN && P.techs.sailing)) && !t.bridge && !foreign(t);
    function ports(i) { // own ports reachable by water from the port at i, within PORT_ROUTE tiles of it
      const x0 = i % W, y0 = (i / W) | 0, vis = new Set([i]), qq = [i], found = [];
      for (let k = 0; k < qq.length; k++) {
        const j = qq[k];
        for (const [nx, ny, n] of neighbours(st, j % W, (j / W) | 0)) {
          const ni = ny * W + nx;
          if (vis.has(ni) || cheb(x0, y0, nx, ny) > PORT_ROUTE) continue;
          vis.add(ni);
          if (n.imp === 'port' && n.owner === pid) found.push(ni);
          else if (sailable(n)) qq.push(ni);
        }
      }
      return found;
    }
    seen[q[0]] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], t = st.tiles[i];
      if (t.site >= 0 && t.site !== cap.id && st.cities[t.site].owner === pid) out.add(t.site);
      const next = neighbours(st, i % W, (i / W) | 0).filter(([, , n]) => linkable(n)).map(([nx, ny]) => ny * W + nx);
      if (t.imp === 'port' && t.owner === pid) next.push(...ports(i));
      for (const ni of next) if (!seen[ni]) { seen[ni] = 1; q.push(ni); }
    }
    return out;
  }
  function updateConnections(st, pid, evs) {
    if (!CONNECT_POP) return;
    const cap = capitalOf(st, pid);
    if (!cap) return;
    const now = connectedCities(st, pid);
    for (const c of st.cities) {
      if (c.owner !== pid || c.capital) { if (c.linked && c.owner !== pid) c.linked = false; continue; }
      const on = now.has(c.id);
      if (on && !c.linked) { c.linked = true; addPop(st, c, CONNECT_POP, evs); addPop(st, cap, CONNECT_POP, evs); }
      else if (!on && c.linked) { c.linked = false; c.pop = Math.max(0, c.pop - CONNECT_POP); cap.pop = Math.max(0, cap.pop - CONNECT_POP); }
    }
  }

  // ------------------------------------------------------------ buildings
  TT.buildOptions = function (st, pid, x, y) {
    const tl = tileAt(st, x, y), out = [];
    const occ = TT.unitAt(st, x, y);
    if (tl.res === 'starfish' && occ && occ.owner === pid) out.push('starfish'); // any territory, unit on the tile
    if (tl.owner !== pid || tl.city < 0 || st.cities[tl.city].owner !== pid) return out;
    if (occ && occ.owner !== pid) return out;
    const water = TT.isWater(tl.t);
    if (tl.res === 'fruit') out.push('fruit');
    if (tl.res === 'game') out.push('hunt');
    if (tl.res === 'fish') out.push('fish');
    if (tl.res === 'crop' && !tl.imp) out.push('farm');
    if (tl.res === 'ore' && !tl.imp) out.push('mine');
    if (tl.site < 0 && !tl.imp && !tl.res && !tl.bridge) {
      const free = k => !st.tiles.some(t => t.imp === k && t.city === tl.city);
      if (tl.t === T.FOREST) { out.push('lumber', 'clear', 'burn', 'forest_temple'); if (free('forge')) out.push('forge'); }
      if (tl.t === T.FIELD) {
        for (const k of ONE_PER_CITY) if (free(k)) out.push(k);
        out.push('temple', 'grow');
      }
      if (tl.t === T.MOUNTAIN) out.push('mountain_temple');
      if (water) {
        if (tl.t === T.SHALLOW && neighbours(st, x, y).some(([, , t]) => isLand(t))) out.push('port');
        out.push('water_temple');
        if (tl.t === T.SHALLOW && bridgeSpan(st, x, y)) out.push('bridge');
      }
      if (!water && (tl.t === T.FIELD || tl.t === T.FOREST)) for (const k of TT.monumentsAvailable(st, pid)) out.push(k);
    }
    if (tl.imp && tl.site < 0) out.push('destroy');
    if (!water && !tl.road && tl.site < 0) out.push('road');
    return out;
  };
  // a bridge spans one shallow tile between land tiles straight across (not diagonally)
  function bridgeSpan(st, x, y) {
    const landAt = (a, b) => TT.inB(st, a, b) && isLand(tileAt(st, a, b));
    return (landAt(x - 1, y) && landAt(x + 1, y)) || (landAt(x, y - 1) && landAt(x, y + 1));
  }
  TT.canBuild = function (st, pid, x, y, k) {
    const B = BUILD[k], P = st.players[pid];
    if (!B || TT.buildOptions(st, pid, x, y).indexOf(k) < 0) return false;
    if (B.tech && !P.techs[B.tech]) return false;
    return P.stars >= Math.max(0, B.cost);
  };

  TT.build = function (st, x, y, k) {
    const pid = st.current;
    if (st.over || !TT.canBuild(st, pid, x, y, k)) return null;
    const tl = tileAt(st, x, y), P = st.players[pid], B = BUILD[k], c = tl.city >= 0 ? st.cities[tl.city] : null;
    P.stars -= B.cost;
    const evs = [{ type: 'build', x, y, kind: k, cid: c ? c.id : -1 }];
    const feedAdjacent = imp => { for (const [, , t] of neighbours(st, x, y)) if (t.imp === imp && t.owner === pid && t.city >= 0) addPop(st, st.cities[t.city], BUILD[imp].bonus, evs); };
    switch (k) {
      case 'fruit': case 'hunt': case 'fish': tl.res = null; addPop(st, c, B.pop, evs); break;
      case 'starfish': { tl.res = null; const u = TT.unitAt(st, x, y); u.canMove = false; u.canAttack = false; break; }
      case 'farm': case 'mine': case 'lumber': tl.imp = k; addPop(st, c, B.pop, evs); feedAdjacent(ADJ[k]); break;
      case 'windmill': case 'forge': case 'sawmill':
        tl.imp = k;
        for (const [, , t] of neighbours(st, x, y)) if (t.imp === B.feeds && t.owner === pid && t.city >= 0) addPop(st, st.cities[t.city], B.bonus, evs);
        break;
      case 'market': tl.imp = 'market'; break;
      case 'port': tl.imp = 'port'; addPop(st, c, B.pop, evs); break;
      case 'temple': case 'forest_temple': case 'mountain_temple': case 'water_temple': tl.imp = k; tl.builtAt = st.turn; addPop(st, c, B.pop, evs); break;
      case 'road': tl.road = true; break;
      case 'bridge': tl.bridge = true; tl.road = true; break;
      case 'clear': tl.t = T.FIELD; break;
      case 'grow': tl.t = T.FOREST; break;
      case 'burn': tl.t = T.FIELD; tl.res = 'crop'; break;
      case 'destroy': {
        const old = tl.imp;
        tl.imp = null; delete tl.builtAt;
        if (BUILD[old] && BUILD[old].pop) c.pop = Math.max(0, c.pop - BUILD[old].pop);
        break;
      }
      default:
        if (B.monument) { tl.imp = k; info(P).built[k] = true; addPop(st, c, B.pop, evs); }
    }
    updateConnections(st, pid, evs);
    TT.bump(st);
    return evs;
  };

  // ------------------------------------------------------------ economy and research
  const sieged = (st, c) => { const u = TT.unitAt(st, c.x, c.y); return !!(u && u.owner !== c.owner); };
  TT.income = function (st, pid) {
    const P = st.players[pid];
    let s = 0;
    for (const c of st.cities) {
      if (c.owner !== pid || sieged(st, c) || c.quiet === st.turn) continue;
      s += c.level + c.workshop + (c.capital ? 1 : 0) + c.parks;
    }
    for (let i = 0; i < st.tiles.length; i++) if (st.tiles[i].imp === 'market' && st.tiles[i].owner === pid) s += TT.marketYield(st, i);
    const L = info(P);
    s += EMBASSY_INCOME * L.embassies.length;
    for (const Q of st.players) if (Q.id !== pid && Q.live && Q.live.embassies.indexOf(pid) >= 0) s += EMBASSY_INCOME;
    if (P.isAI) s += BOT_BONUS[P.difficulty || 'normal'] || 0;
    return Math.max(0, s);
  };
  TT.techCost = function (st, pid, k) {
    const n = Math.max(1, st.cities.filter(c => c.owner === pid).length);
    const cost = TT.TECHS[k].tier * n + 4;
    return st.players[pid].techs.philosophy ? literacy(cost) : cost;
  };
  TT.canResearch = function (st, pid, k, ignoreCost) {
    const P = st.players[pid], Tk = TT.TECHS[k];
    if (!Tk || P.techs[k]) return false;
    if (Tk.req && !P.techs[Tk.req]) {
      const child = Tk.tier === 2 && TT.TECH_ORDER.some(q => TT.TECHS[q].req === k && P.techs[q]); // backwards research (2.14.0)
      if (!child) return false;
    }
    return ignoreCost || P.stars >= TT.techCost(st, pid, k);
  };
  const research = TT.research;
  TT.research = function (st, k) {
    const evs = research(st, k);
    if (evs) discover(st, st.current, evs);
    return evs;
  };

  // ------------------------------------------------------------ score
  const unitPoints = u => {
    const B = TT.UNITS[u.type];
    if (B.super) return SCORE.superUnit;
    return SCORE.starPoints * (B.cost + (u.naval && NAVAL[u.naval] ? NAVAL[u.naval].cost : 0));
  };
  TT.SCORE_PARTS = [
    { key: 'cities', name: 'Cities', rule: SCORE.city + ' per city + ' + SCORE.cityLevel + ' per level above 1 + ' + SCORE.pop + ' per population in its bar' },
    { key: 'land', name: 'Territory', rule: SCORE.land + ' per tile inside your borders' },
    { key: 'tech', name: 'Technology', rule: SCORE.techTier + ' x tier per technology' },
    { key: 'army', name: 'Army', rule: SCORE.starPoints + ' per star the unit cost, super units ' + SCORE.superUnit },
    { key: 'explore', name: 'Exploration', rule: SCORE.explore + ' per tile revealed' },
    { key: 'temples', name: 'Temples', rule: SCORE.templeLevel + ' per temple level' },
    { key: 'parks', name: 'Parks', rule: SCORE.park + ' per park' },
    { key: 'monuments', name: 'Monuments', rule: SCORE.monument + ' per monument' },
  ];
  TT.scoreBreakdown = function (st, pid) {
    const P = st.players[pid];
    const b = { cities: 0, land: 0, tech: 0, army: 0, explore: 0, temples: 0, parks: 0, monuments: 0, total: 0 };
    if (!P.alive) return b;
    for (const c of st.cities) if (c.owner === pid) {
      b.cities += SCORE.city + SCORE.cityLevel * (c.level - 1) + SCORE.pop * c.pop;
      b.parks += c.parks * SCORE.park;
    }
    for (const t of st.tiles) if (t.owner === pid) {
      b.land += SCORE.land;
      if (TEMPLES.indexOf(t.imp) >= 0) b.temples += SCORE.templeLevel * templeLevel(st, t);
      if (BUILD[t.imp] && BUILD[t.imp].monument) b.monuments += SCORE.monument;
    }
    for (const k of Object.keys(P.techs)) b.tech += SCORE.techTier * TT.TECHS[k].tier;
    for (const u of st.units) if (u.owner === pid) b.army += unitPoints(u);
    for (const e of P.explored) b.explore += e * SCORE.explore;
    b.total = b.cities + b.land + b.tech + b.army + b.explore + b.temples + b.parks + b.monuments;
    return b;
  };

  // ------------------------------------------------------------ units, navy, combat
  TT.HOOKS.embarkKind = (st, u) => EMBARK[u.type] || 'raft';
  TT.HOOKS.noHighGround = true;
  TT.HOOKS.noMountainRange = true;
  TT.HOOKS.noCounter = (st, a, d, SA, SD) => has(SD, 'stiff') || has(SA, 'surprise');
  TT.HOOKS.noVeteran = (st, u) => has(TT.stats(st, u), 'static');
  TT.HOOKS.splashDamage = (st, a, e) => Math.floor(TT.combat(st, a, e).dmg / 2); // 2.16.4: floored half of its own damage
  TT.HOOKS.stompDamage = (st, u, e) => Math.floor(TT.combat(st, u, e).dmg / 2);    // verify: same rule as splash assumed
  TT.HOOKS.roadBlocked = (st, u, t) => t.owner >= 0 && t.owner !== u.owner;      // no road bonus in enemy territory
  TT.HOOKS.ignoresZoc = (st, u) => has(TT.stats(st, u), 'stealth');               // Hide
  TT.HOOKS.noForestStop = (st, u) => has(TT.stats(st, u), 'creep');
  const canTrain = TT.canTrain;
  TT.canTrain = function (st, cid, type) { return !!TT.UNITS[type] && !TT.UNITS[type].spawned && canTrain(st, cid, type); };
  TT.upgradeOptions = function (st, u) {
    if (!u || u.naval !== 'raft') return [];
    const P = st.players[u.owner];
    if (tileAt(st, u.x, u.y).owner !== u.owner) return [];
    return UPGRADES.filter(k => P.techs[NAVAL[k].tech]);
  };
  const attackTargets = TT.attackTargets;
  TT.attackTargets = (st, u) => (has(TT.stats(st, u), 'infiltrate') ? [] : attackTargets(st, u));
  const disband = TT.disband;
  TT.disband = function (st, uid) { // refunds half the full cost, vessel included
    const u = TT.getUnit(st, uid);
    if (!u || !st.players[st.current].techs.free_spirit) return null;
    const base = TT.UNITS[u.type].cost, full = base + (u.naval && NAVAL[u.naval] ? NAVAL[u.naval].cost : 0), owner = u.owner;
    const evs = disband(st, uid);
    if (evs) st.players[owner].stars += Math.floor(full / 2) - Math.floor(base / 2);
    return evs;
  };
  for (const k of ['usePower', 'buildWalls']) TT[k] = () => null;

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
  TT.move = function (st) { const evs = hideRuin(move).apply(this, arguments); if (evs) discover(st, st.current, evs); return evs; };
  TT.attack = function (st, uid, tid) {
    const a = TT.getUnit(st, uid), d = TT.getUnit(st, tid);
    const ao = a && a.owner, dov = d && d.owner;
    const evs = hideRuin(attack).apply(this, arguments);
    if (evs) {
      info(st.players[ao]).attacked = true;
      breakEmbassies(st, ao, dov);
      discover(st, ao, evs);
      updateConnections(st, ao, evs);
    }
    return evs;
  };
  const capture = TT.capture;
  TT.capture = function (st, uid) {
    const u = TT.getUnit(st, uid), tl = u ? tileAt(st, u.x, u.y) : null, prev = tl && tl.site >= 0 ? st.cities[tl.site].owner : -1;
    const evs = capture(st, uid);
    if (evs) {
      for (const P of st.players) if (P.live) P.live.embassies = P.live.embassies.filter(q => !(q === prev && !capitalOf(st, prev)));
      discover(st, st.current, evs);
      updateConnections(st, st.current, evs);
      if (prev >= 0) updateConnections(st, prev, evs);
    }
    return evs;
  };

  TT.examine = function (st, uid) {
    const u = TT.getUnit(st, uid);
    if (!u || u.owner !== st.current || st.over) return null;
    const tl = tileAt(st, u.x, u.y);
    if (!tl.ruin || (!!u.naval) !== TT.isWater(tl.t)) return null;
    tl.ruin = false;
    const P = st.players[u.owner], evs = [], water = TT.isWater(tl.t);
    // one reward, uniformly among those valid here (the game shuffles the list by seed and position, first valid wins)
    const avail = TT.TECH_ORDER.filter(k => TT.canResearch(st, u.owner, k, true));
    const spot = neighbours(st, u.x, u.y).find(([x, y, t]) => !TT.unitAt(st, x, y) && (water ? TT.isWater(t.t) && (t.t !== T.OCEAN || P.techs.sailing) : isLand(t) && (t.t !== T.MOUNTAIN || P.techs.climbing)));
    const valid = {
      swordsman: !!spot && (!water || !!P.techs.sailing), // the Rammer only for a tribe that can sail the ocean
      research: avail.length > 0,
      nomads: !!capitalOf(st, u.owner),
      explorer: !water && unexploredNear(st, u.owner, u.x, u.y),
      resources: true,
    };
    const pool = RUIN_REWARDS.filter(k => valid[k]);
    const kind = pool[(TT.rand(st) * pool.length) | 0];
    let msg = '';
    if (kind === 'research') { const k = avail[(TT.rand(st) * avail.length) | 0]; P.techs[k] = true; msg = 'the secret of ' + TT.TECHS[k].name; }
    if (kind === 'swordsman') {
      const g = TT.spawnUnit(st, water ? 'warrior' : 'swordsman', u.owner, spot[0], spot[1], -1, false);
      if (water) g.naval = 'rammer';
      g.vet = true; g.hp = TT.stats(st, g).maxHp;
      evs.push({ type: 'spawn', uid: g.id, x: g.x, y: g.y });
      msg = water ? 'a veteran Rammer' : 'a veteran Swordsman';
    }
    if (kind === 'nomads') { const cap = capitalOf(st, u.owner); addPop(st, cap, RUIN_POP, evs); msg = RUIN_POP + ' population for ' + cap.name; }
    if (kind === 'explorer') msg = 'an explorer (' + explorer(st, u.owner, u.x, u.y) + ' tiles revealed)';
    if (kind === 'resources') { P.stars += RUIN_STARS; msg = RUIN_STARS + ' stars'; }
    u.canMove = false; u.canAttack = false;
    evs.push({ type: 'ruin', x: u.x, y: u.y, pid: u.owner, msg });
    TT.logMsg(st, P.name + ' examined ruins and found ' + msg + '.', u.owner);
    discover(st, u.owner, evs);
    TT.bump(st);
    return evs;
  };
  if (TT.ACTIONS.indexOf('examine') < 0) TT.ACTIONS.push('examine');
  function unexploredNear(st, pid, x, y) {
    const P = st.players[pid];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (TT.inB(st, x + dx, y + dy) && !P.explored[(y + dy) * st.W + x + dx]) return true;
    return false;
  }
  function explorer(st, pid, x, y) { // 12 moves of an uncontrolled explorer, revealing as it goes
    let n = 0;
    for (let s = 0; s < EXPLORER_STEPS; s++) {
      const opts = neighbours(st, x, y).filter(([, , t]) => isLand(t));
      if (!opts.length) break;
      const unseen = opts.filter(([nx, ny]) => !st.players[pid].explored[ny * st.W + nx]);
      const pickFrom = unseen.length ? unseen : opts, p = pickFrom[(TT.rand(st) * pickFrom.length) | 0];
      x = p[0]; y = p[1];
      n += TT.reveal(st, pid, x, y, 1);
    }
    return n;
  }
  const chooseReward = TT.chooseReward;
  TT.chooseReward = function (st, cid, key) {
    if (key !== 'explorer') { const evs = chooseReward(st, cid, key); if (evs) discover(st, st.current, evs); return evs; }
    const c = st.cities[cid];
    if (!c || !c.pending.length || c.owner < 0 || TT.rewardOptions(c.pending[0]).indexOf('explorer') < 0) return null;
    c.pending.shift();
    const n = explorer(st, c.owner, c.x, c.y), evs = [{ type: 'reward', cid, key, x: c.x, y: c.y }, { type: 'reveal', pid: c.owner, n }];
    discover(st, c.owner, evs);
    TT.bump(st);
    return evs;
  };
  const train = TT.train;
  TT.train = function (st, cid, type) { const evs = train(st, cid, type); if (evs) discover(st, st.current, evs); return evs; };

  // ------------------------------------------------------------ diplomacy: cloaks and embassies
  TT.canInfiltrate = function (st, u) {
    if (!u || !u.canMove || !u.canAttack || !has(TT.stats(st, u), 'infiltrate')) return null;
    for (const c of st.cities) if (c.owner >= 0 && c.owner !== u.owner && cheb(c.x, c.y, u.x, u.y) <= 1 && !sieged(st, c) && c.infiltrated !== st.turn) return c;
    return null;
  };
  TT.infiltrate = function (st, uid) {
    const u = TT.getUnit(st, uid);
    if (!u || u.owner !== st.current || st.over) return null;
    const c = TT.canInfiltrate(st, u);
    if (!c) return null;
    const P = st.players[u.owner], victim = c.owner;
    const stolen = c.level + c.workshop + (c.capital ? 1 : 0) + c.parks; // the city's own income goes to the infiltrator
    P.stars += stolen;
    c.infiltrated = st.turn; c.quiet = st.turn + 1;                       // and the city makes nothing next turn
    const evs = [{ type: 'infiltrate', uid: u.id, x: c.x, y: c.y, from: [u.x, u.y], cid: c.id, n: stolen }];
    st.units.splice(st.units.indexOf(u), 1);
    evs.push({ type: 'die', uid: u.id, x: u.x, y: u.y, owner: u.owner, utype: u.type, naval: u.naval });
    const occ = TT.unitAt(st, c.x, c.y);
    if (occ && occ.owner === victim) { occ.hp -= 2; evs.push({ type: 'hurt', uid: occ.id, x: occ.x, y: occ.y, n: 2, kind: 'infiltrate' }); if (occ.hp <= 0) { st.units.splice(st.units.indexOf(occ), 1); st.players[victim].losses++; } }
    const spots = [[c.x, c.y]].concat(neighbours(st, c.x, c.y).map(([x, y]) => [x, y]));
    let n = 0;
    for (const [x, y] of spots) {
      if (n >= Math.min(5, c.level)) break;
      const t = tileAt(st, x, y);
      if (TT.unitAt(st, x, y) || (t.t === T.MOUNTAIN && !P.techs.climbing) || (t.t === T.OCEAN && !P.techs.sailing)) continue;
      const d = TT.spawnUnit(st, 'dagger', P.id, x, y, -1, false);
      evs.push({ type: 'spawn', uid: d.id, x, y });
      n++;
    }
    breakEmbassies(st, P.id, victim);
    info(P).attacked = true;
    TT.logMsg(st, P.name + ' infiltrated ' + c.name + ', stole ' + stolen + ' stars and raised ' + n + ' daggers.', P.id);
    discover(st, P.id, evs);
    TT.bump(st);
    return evs;
  };
  function breakEmbassies(st, a, b) {
    if (a == null || b == null || a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) { const L = info(st.players[x]); L.embassies = L.embassies.filter(q => q !== y); }
  }
  TT.embassyCost = () => EMBASSY_COST;
  TT.buildEmbassy = function (st, cid) {
    const c = st.cities[cid], P = st.players[st.current], L = info(P);
    if (st.over || !c || !c.capital || c.owner < 0 || c.owner === P.id || !P.techs.diplomacy) return null;
    if (L.met.indexOf(c.owner) < 0 || L.embassies.indexOf(c.owner) >= 0) return null;
    const cost = TT.embassyCost(st, P.id);
    if (P.stars < cost) return null;
    P.stars -= cost;
    L.embassies.push(c.owner);
    TT.reveal(st, P.id, c.x, c.y, 1);
    TT.logMsg(st, P.name + ' opened an embassy in ' + c.name + '.', P.id);
    TT.bump(st);
    return [{ type: 'build', x: c.x, y: c.y, kind: 'embassy', cid }];
  };

  // ------------------------------------------------------------ turns
  const endTurn = TT.endTurn;
  TT.endTurn = function (st) {
    if (st.over) return endTurn(st);
    const pid = st.current, P = st.players[pid], L = info(P), evs0 = [];
    for (const u of st.units) { // idle units heal on their own: 4 in own territory, 2 elsewhere
      if (u.owner !== pid || !u.canMove || !u.canAttack) continue;
      const S = TT.stats(st, u), amt = tileAt(st, u.x, u.y).owner === pid ? 4 : 2, n = Math.min(amt, S.maxHp - u.hp);
      if (n > 0) { u.hp += n; evs0.push({ type: 'heal', uid: u.id, x: u.x, y: u.y, n }); }
    }
    L.pacifist = P.techs.meditation ? (L.attacked ? 0 : L.pacifist + 1) : 0;
    L.attacked = false;
    checkTasks(st, pid);
    const evs = endTurn(st);
    if (!st.over) discover(st, st.current, evs);
    return evs0.concat(evs);
  };

  // ------------------------------------------------------------ bot support (src/ai.js reads TT.AIHOOKS)
  const owned = (st, pid, imp) => st.tiles.filter(t => t.imp === imp && t.owner === pid).length;
  TT.AIHOOKS = {
    noWalls: true,
    skipBuild: { burn: true, destroy: true, bridge: true },
    buildPop(st, pid, x, y, k) {
      const B = BUILD[k];
      if (B.monument) return 6;
      if (B.bonus) return B.bonus * adjCount(st, pid, x, y, B.feeds);
      if (ADJ[k]) { const F = BUILD[ADJ[k]], n = adjCount(st, pid, x, y, ADJ[k]); return B.pop + F.bonus * n; }
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
        case 'trade': return PRODUCERS.reduce((s, imp) => s + owned(st, pid, imp), 0) * 1.4 + 0.3;
        case 'navigation': return (ctx.terr.starfish || 0) * 1.5 + (ctx.enemyNaval ? 1.2 : 0.3);
        case 'diplomacy': return 0.4 + (ctx.enemyCities.length ? w * 0.8 : 0);
      }
      return null;
    },
    embassyTarget(st, pid) { // the city id of the highest-scoring rival capital we may open an embassy in, or null
      const L = info(st.players[pid]);
      for (const q of L.met.slice().sort((a, b) => TT.score(st, b) - TT.score(st, a))) {
        const cap = capitalOf(st, q);
        if (cap && L.embassies.indexOf(q) < 0) return cap.id;
      }
      return null;
    },
  };
  // the bot does not plan ruins or starfish: its units examine ruins and harvest starfish they end the turn on
  R.afterBotTurn = function (st) {
    for (const u of st.units.slice()) {
      if (u.owner !== st.current) continue;
      const t = tileAt(st, u.x, u.y);
      if (t.ruin && (!!u.naval) === TT.isWater(t.t) && u.canMove && u.canAttack) TT.examine(st, u.id);
      if (t.res === 'starfish' && TT.canBuild(st, st.current, u.x, u.y, 'starfish')) TT.build(st, u.x, u.y, 'starfish');
    }
  };
  R.tables = { VERSION, TRIBES, TECHS, UNITS, NAVAL, BUILD, SCORE, RUIN_REWARDS, BOT_BONUS };
};
