/* Tessera Tribes — rules engine. Pure state + rules, no DOM. */
(function (G) {
'use strict';
const TT = G.TT || (G.TT = {});

// ---------------------------------------------------------------- data
const T = TT.T = { OCEAN: 0, SHALLOW: 1, FIELD: 2, FOREST: 3, MOUNTAIN: 4 };
TT.TERRAIN_NAMES = ['Deep ocean', 'Shallows', 'Field', 'Forest', 'Mountain'];
const isWater = TT.isWater = t => t <= 1;

TT.RES = {
  fruit: { name: 'Wild fruit' },
  crop: { name: 'Crop' },
  game: { name: 'Wild game' },
  fish: { name: 'Fish' },
  ore: { name: 'Ore' },
  whale: { name: 'Whales' },
};

TT.SKILLS = {
  dash: 'Can attack after moving.',
  escape: 'Can move again after attacking.',
  persist: 'Can attack again after a kill.',
  fortify: 'x1.5 defense in own cities, x4 behind walls.',
  charge: '+0.5 attack for every tile moved this turn.',
  shove: 'Knocks the target back a tile. If blocked, +2 damage.',
  splash: 'Half damage to enemies next to the target.',
  heal: 'Heals adjacent allies by 4 HP.',
  convert: 'Takes control of an enemy unit instead of attacking.',
  aura: 'Adjacent allies (and itself) get x1.25 defense.',
  fly: 'Ignores terrain, water and zones of control. Cannot capture.',
  scout: 'Sees 2 tiles further.',
  carry: 'Carries a land unit. Landing on shore ends the turn.',
  stomp: 'Moving next to enemies deals 2 damage to each.',
  stealth: 'Hidden from enemies unless they stand next to it.',
  infiltrate: 'Sneaks into an enemy city to steal stars and scatter its people.',
};

TT.UNITS = {
  warrior:    { name: 'Warrior',     cost: 2,  atk: 2,   def: 2, move: 1, range: 1, hp: 10, skills: ['dash', 'fortify'], tech: null },
  rider:      { name: 'Rider',       cost: 3,  atk: 2,   def: 1, move: 2, range: 1, hp: 10, skills: ['dash', 'escape', 'fortify'], tech: 'riding' },
  archer:     { name: 'Archer',      cost: 3,  atk: 2,   def: 1, move: 1, range: 2, hp: 10, skills: ['dash', 'fortify'], tech: 'archery' },
  defender:   { name: 'Defender',    cost: 3,  atk: 1,   def: 3, move: 1, range: 1, hp: 15, skills: ['fortify', 'shove'], tech: 'shields' },
  shaman:     { name: 'Shaman',      cost: 4,  atk: 1,   def: 2, move: 1, range: 1, hp: 10, skills: ['aura', 'heal', 'fortify'], tech: 'meditation' },
  balloon:    { name: 'Balloon',     cost: 5,  atk: 1.5, def: 1, move: 3, range: 2, hp: 10, skills: ['fly', 'scout', 'dash'], tech: 'ballooning' },
  swordsman:  { name: 'Swordsman',   cost: 5,  atk: 3,   def: 3, move: 1, range: 1, hp: 15, skills: ['dash'], tech: 'smithery' },
  mindbender: { name: 'Mind Bender', cost: 5,  atk: 0,   def: 1, move: 1, range: 1, hp: 10, skills: ['heal', 'convert'], tech: 'philosophy' },
  cloak:      { name: 'Cloak',       cost: 6,  atk: 0,   def: 1, move: 2, range: 1, hp: 8,  skills: ['stealth', 'infiltrate'], tech: 'diplomacy' },
  knight:     { name: 'Knight',      cost: 8,  atk: 3,   def: 1, move: 3, range: 1, hp: 10, skills: ['dash', 'persist', 'charge', 'fortify'], tech: 'chivalry' },
  catapult:   { name: 'Catapult',    cost: 8,  atk: 4,   def: 0, move: 1, range: 3, hp: 10, skills: ['splash'], tech: 'mathematics' },
  giant:      { name: 'Giant',       cost: 12, atk: 5,   def: 4, move: 1, range: 1, hp: 40, skills: ['dash', 'shove', 'stomp'], tech: null, super: true },
};
TT.UNIT_ORDER = ['warrior', 'rider', 'archer', 'defender', 'shaman', 'balloon', 'swordsman', 'mindbender', 'cloak', 'knight', 'catapult'];

TT.NAVAL = {
  boat:       { name: 'Boat',       cost: 0,  atk: 1, def: 1, move: 2, range: 2, skills: ['dash', 'carry'], tech: 'fishing' },
  ship:       { name: 'Ship',       cost: 5,  atk: 2, def: 2, move: 3, range: 2, skills: ['dash', 'carry'], tech: 'sailing' },
  battleship: { name: 'Battleship', cost: 15, atk: 4, def: 3, move: 3, range: 2, skills: ['dash', 'carry', 'scout'], tech: 'navigation' },
};

TT.TECHS = {
  riding:       { name: 'Riding',       tier: 1, req: null,           desc: 'Train Riders.' },
  organization: { name: 'Organization', tier: 1, req: null,           desc: 'Gather wild fruit.' },
  climbing:     { name: 'Climbing',     tier: 1, req: null,           desc: 'Cross mountains. Mountains give x1.5 defense.' },
  fishing:      { name: 'Fishing',      tier: 1, req: null,           desc: 'Catch fish, build Ports and sail Boats.' },
  hunting:      { name: 'Hunting',      tier: 1, req: null,           desc: 'Hunt wild game.' },
  roads:        { name: 'Roads',        tier: 2, req: 'riding',       desc: 'Build roads. Road to road costs half a move and ignores forests.' },
  ballooning:   { name: 'Ballooning',   tier: 2, req: 'riding',       desc: 'Train Balloons: flying ranged scouts.' },
  farming:      { name: 'Farming',      tier: 2, req: 'organization', desc: 'Build Farms on crops (+2 pop).' },
  shields:      { name: 'Shields',      tier: 2, req: 'organization', desc: 'Train Defenders.' },
  mining:       { name: 'Mining',       tier: 2, req: 'climbing',     desc: 'Build Mines on ore (+2 pop).' },
  meditation:   { name: 'Meditation',   tier: 2, req: 'climbing',     desc: 'Train Shamans, who heal and shield allies.' },
  sailing:      { name: 'Sailing',      tier: 2, req: 'fishing',      desc: 'Upgrade Boats to Ships. Cross deep ocean.' },
  whaling:      { name: 'Whaling',      tier: 2, req: 'fishing',      desc: 'Hunt whales in deep water for stars and population.' },
  archery:      { name: 'Archery',      tier: 2, req: 'hunting',      desc: 'Train Archers. Forests give x1.5 defense.' },
  forestry:     { name: 'Forestry',     tier: 2, req: 'hunting',      desc: 'Build Lumber Huts. Clear forest for stars.' },
  trade:        { name: 'Trade',        tier: 3, req: 'roads',        desc: 'Build Markets. +1 star per turn for each city linked to your capital by roads.' },
  chivalry:     { name: 'Chivalry',     tier: 3, req: 'ballooning',   desc: 'Train Knights, who charge and chain kills.' },
  construction: { name: 'Construction', tier: 3, req: 'farming',      desc: 'Build City Walls (x4 defense for fortified units).' },
  diplomacy:    { name: 'Diplomacy',    tier: 3, req: 'shields',      desc: 'Train Cloaks. Build an Embassy: +1 star per turn for each tribe you have met.' },
  philosophy:   { name: 'Philosophy',   tier: 3, req: 'meditation',   desc: 'Train Mind Benders. Research costs 25% less.' },
  smithery:     { name: 'Smithery',     tier: 3, req: 'mining',       desc: 'Train Swordsmen.' },
  navigation:   { name: 'Navigation',   tier: 3, req: 'sailing',      desc: 'Upgrade to Battleships.' },
  aquatism:     { name: 'Aquatism',     tier: 3, req: 'whaling',      desc: 'Boats defend x1.5 and take no storm damage.' },
  spiritualism: { name: 'Spiritualism', tier: 3, req: 'archery',      desc: 'Build Temples (+2 pop). Plant forests on fields.' },
  mathematics:  { name: 'Mathematics',  tier: 3, req: 'forestry',     desc: 'Train Catapults with splash damage.' },
};
TT.TECH_ORDER = Object.keys(TT.TECHS);

TT.BUILD = {
  fruit:  { name: 'Gather fruit', cost: 2, pop: 1, tech: 'organization' },
  hunt:   { name: 'Hunt game',    cost: 2, pop: 1, tech: 'hunting' },
  fish:   { name: 'Catch fish',   cost: 2, pop: 1, tech: 'fishing' },
  farm:   { name: 'Build farm',   cost: 5, pop: 2, tech: 'farming' },
  mine:   { name: 'Build mine',   cost: 5, pop: 2, tech: 'mining' },
  lumber: { name: 'Lumber hut',   cost: 3, pop: 1, tech: 'forestry' },
  port:   { name: 'Build port',   cost: 7, pop: 1, tech: 'fishing' },
  clear:  { name: 'Clear forest', cost: -2, pop: 0, tech: 'forestry' },
  road:   { name: 'Build road',   cost: 2, pop: 0, tech: 'roads' },
  whale:  { name: 'Hunt whales',  cost: -3, pop: 1, tech: 'whaling' },
  temple: { name: 'Temple',       cost: 10, pop: 2, tech: 'spiritualism' },
  grow:   { name: 'Plant forest', cost: 5, pop: 0, tech: 'spiritualism' },
  market: { name: 'Market',       cost: 6, pop: 0, tech: 'trade' },
};

TT.REWARDS = {
  workshop:  { name: 'Workshop',      desc: '+1 star per turn' },
  explorer:  { name: 'Explorer',      desc: 'Reveal the land around the city' },
  walls:     { name: 'City Wall',     desc: 'x4 defense for fortified units here' },
  resources: { name: 'Resources',     desc: '+5 stars now' },
  growth:    { name: 'Population',    desc: '+3 population' },
  borders:   { name: 'Border Growth', desc: 'Territory radius grows to 2' },
  park:      { name: 'Park',          desc: '+1 star per turn, +250 score' },
  giant:     { name: 'Giant',         desc: 'A 40 HP super unit' },
};
TT.rewardOptions = lvl => lvl === 2 ? ['workshop', 'explorer'] : lvl === 3 ? ['walls', 'resources'] : lvl === 4 ? ['growth', 'borders'] : ['park', 'giant'];

TT.TRIBES = [
  { id: 'verdant', name: 'Grove', color: 0x4fb84a, startTech: 'hunting', startStars: 6,
    passive: 'Forest-born: forests never stop your movement.',
    power: 'overgrowth', powerName: 'Overgrowth', powerDesc: 'All your units heal 5 HP and your capital gains 1 population.',
    syl: ['ul', 'ma', 'ri', 'sa', 'wen', 'tho', 'li', 'en', 'fa', 'ro', 'ya', 'ki'] },
  { id: 'ironpeak', name: 'Stone', color: 0x9a6be0, startTech: 'climbing', startStars: 5,
    passive: 'Mountain-born: mountains never stop your movement.',
    power: 'forge', powerName: 'Forge Fury', powerDesc: 'All your units get +1 attack this turn.',
    syl: ['kor', 'dun', 'grim', 'ath', 'bar', 'rok', 'hal', 'zum', 'dra', 'ek', 'tor', 'im'] },
  { id: 'tidecallers', name: 'Wave', color: 0x22b3c9, startTech: 'fishing', startStars: 7,
    passive: 'Sea legs: your boats move 1 tile further.',
    power: 'tailwind', powerName: 'Tailwind', powerDesc: 'All your units get +1 movement this turn.',
    syl: ['nau', 'sel', 'ma', 'ri', 'lo', 'qua', 'ae', 'thal', 'ne', 'is', 'mer', 'o'] },
  { id: 'emberfolk', name: 'Flame', color: 0xe2503b, startTech: 'riding', startStars: 5,
    passive: 'Bloodfire: each kill heals the killer 3 HP and earns 1 star.',
    power: 'wildfire', powerName: 'Wildfire', powerDesc: 'Enemies next to your units take 4 damage.',
    syl: ['vor', 'ka', 'ash', 'pyr', 'ul', 'zan', 'ro', 'ix', 'te', 'gar', 'sha', 'ur'] },
  { id: 'frostkin', name: 'Snow', color: 0xdfe9f5, startTech: 'organization', startStars: 5,
    passive: 'Hearthguard: x1.1 defense inside your borders.',
    power: 'blizzard', powerName: 'Blizzard', powerDesc: 'Enemies within 2 tiles of you are frozen next turn.',
    syl: ['fjo', 'ska', 'rn', 'vik', 'ol', 'hel', 'sig', 'ne', 'ya', 'ru', 'bjo', 'is'] },
  { id: 'sunspire', name: 'Sun', color: 0xf2b22e, startTech: null, startStars: 6,
    passive: 'Gilded: your capital makes +1 star per turn.',
    power: 'goldenage', powerName: 'Golden Age', powerDesc: 'Gain 2 stars for every city you own.',
    syl: ['sol', 'am', 'ra', 'ke', 'ti', 'zu', 'ah', 'en', 'pa', 'lu', 'ma', 'ri'] },
];
TT.tribe = id => TT.TRIBES.find(t => t.id === id);
TT.POWER_COST = 8;
TT.POWER_MAX = 12;

TT.MAP_TYPES = {
  pangaea:     { name: 'Pangaea',     land: 0.56, mountains: 0.14, forest: 0.32, desc: 'One great landmass' },
  continents:  { name: 'Continents',  land: 0.46, mountains: 0.14, forest: 0.32, desc: 'A few large islands' },
  archipelago: { name: 'Archipelago', land: 0.34, mountains: 0.12, forest: 0.3,  desc: 'Many small islands' },
  lakes:       { name: 'Lakes',       land: 0.72, mountains: 0.13, forest: 0.36, desc: 'Land dotted with lakes' },
  highlands:   { name: 'Highlands',   land: 0.62, mountains: 0.3,  forest: 0.26, desc: 'Ridges and high ground' },
  waterworld:  { name: 'Waterworld',  land: 0.2,  mountains: 0.1,  forest: 0.3,  desc: 'Scattered specks of land' },
};
TT.MAP_SIZES = { tiny: 11, small: 14, normal: 16, large: 20, huge: 24 };
TT.DIFFICULTY = {
  easy:   { name: 'Easy',   noise: 1.1,  bonus: 0, lookahead: false, risk: 0.25, econSkip: 0.35 },
  normal: { name: 'Normal', noise: 0.3,  bonus: 0, lookahead: true,  risk: 0.75, econSkip: 0.08 },
  hard:   { name: 'Hard',   noise: 0.0,  bonus: 0, lookahead: true,  risk: 1,    econSkip: 0 },
  crazy:  { name: 'Crazy',  noise: 0.0,  bonus: 2, lookahead: true,  risk: 1,    econSkip: 0 },
};

// ---------------------------------------------------------------- helpers
function rand(st) {
  const a = st.rng = (st.rng + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
TT.rand = rand;
const has = (S, k) => S.skills.indexOf(k) >= 0;
TT.has = has;
const cheb = TT.dist = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
TT.inB = (st, x, y) => x >= 0 && y >= 0 && x < st.W && y < st.H;
TT.tile = (st, x, y) => st.tiles[y * st.W + x];
TT.getUnit = (st, id) => { for (const u of st.units) if (u.id === id) return u; return null; };

// cached occupancy (idx -> unit)
const occCache = new WeakMap();
TT.occ = function (st) {
  let c = occCache.get(st);
  if (c && c.ver === st.ver) return c.arr;
  const arr = new Array(st.W * st.H).fill(null);
  for (const u of st.units) arr[u.y * st.W + u.x] = u;
  occCache.set(st, { ver: st.ver, arr });
  return arr;
};
TT.unitAt = (st, x, y) => TT.occ(st)[y * st.W + x];
const bump = st => { st.ver++; };
TT.bump = bump;

function log(st, msg, pid) {
  st.log.push({ turn: st.turn, msg, pid: pid == null ? -1 : pid });
  if (st.log.length > 120) st.log.shift();
}
TT.logMsg = log;

// ---------------------------------------------------------------- map generation
function makeRng(seed) {
  const st = { rng: seed | 0 };
  return () => rand(st);
}
function valueNoise(R, W, H, cell) {
  const gw = Math.ceil(W / cell) + 3, gh = Math.ceil(H / cell) + 3;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = R();
  const ox = R() * 0.99, oy = R() * 0.99;
  return (x, y) => {
    const fx = x / cell + ox, fy = y / cell + oy;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function quantile(arr, q) {
  const s = Array.from(arr).sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.floor(q * s.length)))];
}

function genTerrain(W, H, type, nPlayers, R) {
  const MT = TT.MAP_TYPES[type];
  const n1 = valueNoise(R, W, H, Math.max(3, W / 3.2));
  const n2 = valueNoise(R, W, H, Math.max(2, W / 6.5));
  const n3 = valueNoise(R, W, H, 2.2);
  const nm = valueNoise(R, W, H, Math.max(2, W / 5));
  const nf = valueNoise(R, W, H, 2.6);
  const nf2 = valueNoise(R, W, H, Math.max(3, W / 4));
  const cx = (W - 1) / 2, cy = (H - 1) / 2, Rad = Math.min(W, H) / 2;
  const centers = [];
  if (type === 'continents') {
    const k = Math.max(2, Math.min(4, nPlayers));
    const a0 = R() * Math.PI * 2;
    for (let i = 0; i < k; i++) {
      const a = a0 + i * Math.PI * 2 / k + (R() - 0.5) * 0.5;
      const r = Rad * (0.45 + R() * 0.12);
      centers.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  const N = W * H, h = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fb = n1(x, y) * 0.55 + n2(x, y) * 0.3 + n3(x, y) * 0.15;
    const hi = n2(x, y) * 0.45 + n3(x, y) * 0.55;
    const d = Math.hypot((x - cx) / Rad, (y - cy) / Rad);
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    const ef = Math.min(1, edge / 2.5);
    let v;
    switch (type) {
      case 'continents': {
        let m = 0;
        for (const c of centers) m = Math.max(m, 1 - Math.hypot(x - c[0], y - c[1]) / (Rad * 0.62));
        v = fb * 0.5 + m * 0.8; break;
      }
      case 'archipelago': v = hi * 0.75 + fb * 0.15 + (1 - d) * 0.2; break;
      case 'waterworld': v = hi * 0.85 + (1 - d) * 0.1; break;
      case 'lakes': v = fb * 0.75 + n3(x, y) * 0.25; break;
      default: v = fb * 0.55 + (1 - d) * 0.85;
    }
    v *= type === 'lakes' ? (0.65 + 0.35 * ef) : (0.3 + 0.7 * ef);
    h[y * W + x] = v;
  }
  const thr = quantile(h, 1 - MT.land);
  const tiles = [];
  for (let i = 0; i < N; i++) tiles.push({ t: h[i] >= thr ? T.FIELD : T.OCEAN, e: 0, res: null, imp: null, ruin: false, owner: -1, city: -1, site: -1 });
  // mountains & forests among land
  const land = [];
  for (let i = 0; i < N; i++) if (tiles[i].t === T.FIELD) land.push(i);
  const ms = land.map(i => { const x = i % W, y = (i / W) | 0; const r = 1 - Math.abs(2 * nm(x, y) - 1); return r * 0.65 + (h[i] - thr) * 0.9 + R() * 0.08; });
  const mThr = quantile(ms, 1 - MT.mountains);
  land.forEach((i, k) => { if (ms[k] >= mThr) tiles[i].t = T.MOUNTAIN; });
  const flat = land.filter(i => tiles[i].t === T.FIELD);
  const fs = flat.map(i => { const x = i % W, y = (i / W) | 0; return nf(x, y) * 0.6 + nf2(x, y) * 0.4; });
  const fThr = quantile(fs, 1 - MT.forest);
  flat.forEach((i, k) => { if (fs[k] >= fThr) tiles[i].t = T.FOREST; });
  // elevation
  const lh = land.map(i => h[i]);
  const e1 = quantile(lh, type === 'highlands' ? 0.3 : 0.42), e2 = quantile(lh, type === 'highlands' ? 0.62 : 0.78);
  for (const i of land) {
    const tl = tiles[i];
    tl.e = tl.t === T.MOUNTAIN ? 3 : (h[i] >= e2 ? 2 : h[i] >= e1 ? 1 : 0);
  }
  // shallows
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const tl = tiles[y * W + x];
    if (!isWater(tl.t)) continue;
    let near = 99;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!isWater(tiles[ny * W + nx].t)) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
    }
    if (near === 1 || (near === 2 && R() < 0.3)) { tl.t = T.SHALLOW; tl.e = -1; } else { tl.t = T.OCEAN; tl.e = -2; }
  }
  return tiles;
}

function nameCity(R, tribe, used) {
  const syl = tribe ? tribe.syl : ['ka', 'lo', 'mi', 'ra', 'tu', 'en', 'sa', 'ri', 'po', 'na', 'te', 'vu'];
  for (let k = 0; k < 40; k++) {
    let s = syl[(R() * syl.length) | 0] + syl[(R() * syl.length) | 0];
    if (R() < 0.35) s += syl[(R() * syl.length) | 0];
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (s.length >= 3 && s.length <= 10 && !used.has(s)) { used.add(s); return s; }
  }
  const s = 'Tess' + used.size; used.add(s); return s;
}

TT.defaultSettings = () => ({
  tribe: 'verdant', opponents: 3, difficulty: 'hard', size: 'normal', mapType: 'pangaea',
  mode: 'domination', turnLimit: 30, relief: 'dramatic', events: true, fog: true, spectate: false, seed: 0, speed: 'normal',
});

TT.newGame = function (settings) {
  const S = Object.assign(TT.defaultSettings(), settings || {});
  const seed = S.seed ? (S.seed | 0) : ((Math.random() * 2147483647) | 0) + 1;
  S.seed = seed;
  const R = makeRng(seed);
  const W = TT.MAP_SIZES[S.size] || 16, H = W;
  const nPlayers = Math.max(2, Math.min(6, (S.opponents | 0) + 1));
  // tribes
  // S.tribes fixes the tribe per seat (multiplayer lobbies, balance tests); otherwise seat 0 gets S.tribe
  let tribes = [];
  if (Array.isArray(S.tribes)) tribes = S.tribes.filter((t, i, a) => t && TT.tribe(t) && a.indexOf(t) === i).slice(0, nPlayers);
  else if (!S.spectate) tribes.push(S.tribe);
  const pool = TT.TRIBES.map(t => t.id).filter(id => tribes.indexOf(id) < 0);
  while (tribes.length < nPlayers) tribes.push(pool.splice((R() * pool.length) | 0, 1)[0]);

  let tiles, caps;
  for (let attempt = 0; attempt < 12; attempt++) {
    tiles = genTerrain(W, H, S.mapType, nPlayers, R);
    caps = placeCapitals(tiles, W, H, nPlayers, R, attempt >= 6);
    if (caps) break;
  }
  if (!caps) { // force islands on a ring
    caps = [];
    for (let i = 0; i < nPlayers; i++) {
      const a = i * Math.PI * 2 / nPlayers + 0.3;
      const x = Math.round((W - 1) / 2 + Math.cos(a) * (W / 2 - 3)), y = Math.round((H - 1) / 2 + Math.sin(a) * (H / 2 - 3));
      caps.push(y * W + x);
    }
  }
  const st = {
    v: 1, W, H, tiles, cities: [], units: [], players: [], turn: 1, current: 0, rng: (seed * 7919) | 0,
    settings: S, nextId: 1, log: [], storm: null, over: null, ver: 0, stats: { kills: [] },
  };
  const used = new Set();
  for (let p = 0; p < nPlayers; p++) {
    const tribe = TT.tribe(tribes[p]);
    // S.humans lists the seats people control (pass & play, online); default: seat 0 unless spectating
    const humans = Array.isArray(S.humans) ? S.humans : S.spectate ? [] : [0];
    const isAI = humans.indexOf(p) < 0;
    st.players.push({
      id: p, tribe: tribe.id, name: tribe.name, color: tribe.color, isAI, difficulty: isAI ? S.difficulty : null,
      stars: tribe.startStars + (p > 0 ? 2 : 0), techs: {}, explored: new Array(W * H).fill(S.fog ? 0 : 1), alive: true,
      kills: 0, losses: 0, power: 2, buff: {}, capital: -1, score: 0, scoreHist: [],
    });
    if (tribe.startTech) [].concat(tribe.startTech).forEach(k => { st.players[p].techs[k] = true; });
  }
  // capitals
  caps.forEach((ci, p) => {
    const x = ci % W, y = (ci / W) | 0;
    prepCapitalArea(st, x, y, st.players[p].tribe, R);
  });
  // villages, resources, ruins
  const sites = caps.slice();
  const landIdx = [];
  for (let i = 0; i < W * H; i++) if (!isWater(tiles[i].t)) landIdx.push(i);
  const nVill = Math.max(nPlayers, Math.round(landIdx.length / 13));
  const shuffled = landIdx.slice().sort(() => R() - 0.5);
  const villages = [];
  for (const i of shuffled) {
    if (villages.length >= nVill) break;
    const x = i % W, y = (i / W) | 0;
    if (tiles[i].t === T.MOUNTAIN) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) continue;
    let ok = true;
    for (const s of sites) { const sx = s % W, sy = (s / W) | 0; if (cheb(x, y, sx, sy) < 3) { ok = false; break; } }
    if (ok) { sites.push(i); villages.push(i); }
  }
  // fairness pass: top up capitals whose nearby village wealth lags behind
  const capXY = caps.map(c => [c % W, (c / W) | 0]);
  const owns = (vx, vy, k) => { const d = cheb(vx, vy, capXY[k][0], capXY[k][1]); return capXY.every((o, j) => j === k || cheb(vx, vy, o[0], o[1]) > d); };
  const wealthOf = k => {
    let w = 0;
    for (const v of villages) {
      const vx = v % W, vy = (v / W) | 0;
      if (!owns(vx, vy, k)) continue;
      const d = cheb(vx, vy, capXY[k][0], capXY[k][1]);
      w += d <= 3 ? 3 : d === 4 ? 2.5 : d === 5 ? 2 : d === 6 ? 1.2 : d === 7 ? 0.6 : 0;
    }
    return w;
  };
  for (let pass = 0; pass < 3; pass++) {
    const wealth = caps.map((_, k) => wealthOf(k));
    const target = Math.max.apply(null, wealth);
    caps.forEach((_, k) => {
      for (let tries = 0; tries < 4 && wealthOf(k) < target - 1.5; tries++) {
        let best = -1, bestS = -1;
        for (const i of landIdx) {
          const x = i % W, y = (i / W) | 0, tl = tiles[i];
          if (tl.t === T.MOUNTAIN || x === 0 || y === 0 || x === W - 1 || y === H - 1) continue;
          const d = cheb(x, y, capXY[k][0], capXY[k][1]);
          if (d < 3 || d > 5 || !owns(x, y, k)) continue;
          let md = 99;
          for (const s2 of sites) md = Math.min(md, cheb(x, y, s2 % W, (s2 / W) | 0));
          if (md < 3) continue;
          const sc = R() + (d === 4 ? 0.3 : 0);
          if (sc > bestS) { bestS = sc; best = i; }
        }
        if (best < 0) break;
        sites.push(best); villages.push(best);
      }
    });
  }
  // site tiles become cities
  caps.forEach((ci, p) => {
    const c = makeCity(st, ci % W, (ci / W) | 0, p, nameCity(R, TT.tribe(st.players[p].tribe), used));
    c.capital = true; st.players[p].capital = c.id;
    claim(st, c, 1);
  });
  for (const vi of villages) {
    const tl = tiles[vi]; tl.t = T.FIELD; tl.res = null; tl.e = Math.min(tl.e, 2);
    makeCity(st, vi % W, (vi / W) | 0, -1, nameCity(R, null, used));
  }
  // resources
  const near = new Uint8Array(W * H);
  for (const s of sites) { const sx = s % W, sy = (s / W) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = sx + dx, ny = sy + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) near[ny * W + nx] = 1; } }
  for (let i = 0; i < W * H; i++) {
    const tl = tiles[i];
    if (tl.site >= 0 || tl.res) continue;
    const m = near[i] ? 1 : 0.3, r = R();
    if (tl.t === T.FIELD) { if (r < 0.26 * m) tl.res = 'fruit'; else if (r < 0.48 * m) tl.res = 'crop'; }
    else if (tl.t === T.FOREST) { if (r < 0.36 * m) tl.res = 'game'; }
    else if (tl.t === T.MOUNTAIN) { if (r < 0.38 * m) tl.res = 'ore'; }
    else if (tl.t === T.SHALLOW) { if (r < 0.4 * m) tl.res = 'fish'; }
    else if (tl.t === T.OCEAN) { if (r < 0.1) tl.res = 'whale'; }
  }
  const nRuins = Math.max(2, Math.round(landIdx.length / 45));
  let placed = 0;
  for (const i of shuffled.slice().reverse()) {
    if (placed >= nRuins) break;
    const tl = tiles[i];
    if (tl.site >= 0 || near[i] || tl.res) continue;
    tl.ruin = true; placed++;
  }
  // starting units + vision
  st.players.forEach(P => {
    const c = st.cities[P.capital];
    spawnUnit(st, 'warrior', P.id, c.x, c.y, c.id, true);
    reveal(st, P.id, c.x, c.y, 2);
  });
  startTurn(st);
  return st;
};

function placeCapitals(tiles, W, H, n, R, relaxed) {
  const cand = [];
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const tl = tiles[y * W + x];
    if (tl.t !== T.FIELD && tl.t !== T.FOREST) continue;
    let landN = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWater(tiles[(y + dy) * W + x + dx].t)) landN++;
    if (landN >= (relaxed ? 3 : 6)) cand.push(y * W + x);
  }
  if (cand.length < n) return null;
  const minD = Math.max(3, Math.floor(W / (n <= 2 ? 2.2 : n <= 4 ? 3 : 3.6)));
  for (let attempt = 0; attempt < 30; attempt++) {
    const picks = [cand[(R() * cand.length) | 0]];
    while (picks.length < n) {
      let best = -1, bestD = -1;
      for (const c of cand) {
        const cx = c % W, cy = (c / W) | 0;
        let d = 99;
        for (const p of picks) d = Math.min(d, cheb(cx, cy, p % W, (p / W) | 0));
        const score = d + R() * 1.5;
        if (d >= minD && score > bestD) { bestD = score; best = c; }
      }
      if (best < 0) break;
      picks.push(best);
    }
    if (picks.length === n) return picks;
  }
  return null;
}

function prepCapitalArea(st, x, y, tribeId, R) {
  const W = st.W;
  const tl = st.tiles[y * W + x];
  tl.t = T.FIELD; tl.e = Math.min(Math.max(tl.e, 0), 1); tl.res = null; tl.ruin = false;
  const nb = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= st.W || ny >= st.H) continue;
    const t = st.tiles[ny * W + nx];
    t.ruin = false;
    if (isWater(t.t)) { t.t = T.SHALLOW; t.e = -1; }
    nb.push(t);
  }
  nb.sort(() => R() - 0.5);
  const land = nb.filter(t => !isWater(t.t));
  // ensure at least 2 field fruit, 1 forest game
  let fruit = 0, game = 0;
  for (const t of land) {
    if (fruit < 2 && t.t !== T.FOREST && t.t !== T.MOUNTAIN && t.res !== 'crop') { t.t = T.FIELD; t.res = 'fruit'; fruit++; continue; }
  }
  for (const t of land) {
    if (game < 1 && t.res !== 'fruit') { if (t.t === T.MOUNTAIN && tribeId !== 'ironpeak') { t.t = T.FOREST; t.e = 2; } if (t.t === T.FOREST || t.t === T.FIELD) { t.t = T.FOREST; t.res = 'game'; game++; } }
  }
  if (tribeId === 'ironpeak') {
    const t = land.find(t => !t.res);
    if (t) { t.t = T.MOUNTAIN; t.e = 3; t.res = 'ore'; }
  }
  const water = nb.filter(t => isWater(t.t));
  if (water.length && (tribeId === 'tidecallers' || R() < 0.6)) water[0].res = 'fish';
  // no more than 2 mountains around capital
  let m = 0;
  for (const t of land) if (t.t === T.MOUNTAIN) { m++; if (m > 2) { t.t = T.FIELD; t.e = 2; t.res = null; } }
}

function makeCity(st, x, y, owner, name) {
  const c = { id: st.cities.length, x, y, owner, name, level: 1, pop: 0, capital: false, walls: false, workshop: 0, parks: 0, radius: 1, pending: [], founded: st.turn };
  st.cities.push(c);
  const tl = st.tiles[y * st.W + x];
  tl.site = c.id; tl.res = null; tl.imp = null; tl.ruin = false;
  if (isWater(tl.t)) { tl.t = T.FIELD; tl.e = 0; }
  return c;
}

function claim(st, c, r) {
  const W = st.W;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = c.x + dx, ny = c.y + dy;
    if (!TT.inB(st, nx, ny)) continue;
    const tl = st.tiles[ny * W + nx];
    if (tl.city === -1 || tl.city === c.id) { tl.city = c.id; tl.owner = c.owner; }
  }
}

// ---------------------------------------------------------------- vision
function reveal(st, pid, x, y, r) {
  const P = st.players[pid];
  let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!TT.inB(st, nx, ny)) continue;
    const i = ny * st.W + nx;
    if (!P.explored[i]) { P.explored[i] = 1; n++; }
  }
  return n;
}
TT.reveal = reveal;
TT.visionRange = function (st, u) {
  const S = TT.stats(st, u);
  let r = 1;
  if (has(S, 'scout')) r += 1;
  const tl = st.tiles[u.y * st.W + u.x];
  if (tl.t === T.MOUNTAIN) r += 1;
  return r;
};
function unitReveal(st, u) { return reveal(st, u.owner, u.x, u.y, TT.visionRange(st, u)); }

// ---------------------------------------------------------------- units & stats
function spawnUnit(st, type, owner, x, y, home, ready) {
  const B = TT.UNITS[type];
  const u = { id: st.nextId++, type, owner, x, y, hp: B.hp, vet: false, kills: 0, naval: null, home: home == null ? -1 : home,
    canMove: !!ready, canAttack: !!ready, movedDist: 0, frozen: 0, slow: false };
  const tl = st.tiles[y * st.W + x];
  if (isWater(tl.t)) u.naval = 'boat';
  st.units.push(u);
  bump(st);
  unitReveal(st, u);
  return u;
}
TT.spawnUnit = spawnUnit;

TT.stats = function (st, u) {
  const B = TT.UNITS[u.type];
  const P = st.players[u.owner];
  let atk = B.atk, def = B.def, move = B.move, range = B.range, skills = B.skills;
  if (u.naval) {
    const N = TT.NAVAL[u.naval];
    atk = N.atk; def = N.def; move = N.move; range = N.range; skills = N.skills;
    if (P.tribe === 'tidecallers') move += 1;
  }
  if (P.buff.forge && atk > 0) atk += 1;
  if (P.buff.tailwind) move += 1;
  if (u.slow) move = Math.max(1, move - 1);
  return { atk, def, move, range, skills, maxHp: B.hp + (u.vet ? 5 : 0), name: u.naval ? TT.NAVAL[u.naval].name : B.name };
};
TT.unitName = u => u.naval ? TT.NAVAL[u.naval].name + ' (' + TT.UNITS[u.type].name + ')' : TT.UNITS[u.type].name;

TT.effRange = function (st, u, x, y, S) {
  S = S || TT.stats(st, u);
  const tl = st.tiles[y * st.W + x];
  return S.range + (S.range > 1 && tl.t === T.MOUNTAIN ? 1 : 0);
};

TT.unitValue = function (st, u) {
  const B = TT.UNITS[u.type];
  let v = B.super ? 14 : B.cost + 1;
  if (u.naval) v += TT.NAVAL[u.naval].cost * 0.6 + 1;
  if (u.vet) v += 2;
  return v;
};

// --- movement
// can player pid see unit u? stealthy units show only when something of pid stands next to them
TT.visibleTo = function (st, u, pid) {
  if (pid < 0 || u.owner === pid) return true;
  if (!st.players[pid].explored[u.y * st.W + u.x]) return false;
  if (TT.UNITS[u.type].skills.indexOf('stealth') < 0 || u.naval) return true;
  for (const o of st.units) if (o.owner === pid && cheb(o.x, o.y, u.x, u.y) <= 1) return true;
  for (const c of st.cities) if (c.owner === pid && cheb(c.x, c.y, u.x, u.y) <= 1) return true;
  return false;
};
const isRoad = tl => tl.road || tl.site >= 0;
TT.isRoad = isRoad;
function zocMap(st, pid) {
  const W = st.W, m = new Uint8Array(st.W * st.H);
  for (const e of st.units) {
    if (e.owner === pid) continue;
    if (TT.UNITS[e.type].skills.indexOf('stealth') >= 0 && !e.naval) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = e.x + dx, ny = e.y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < st.H) m[ny * W + nx] = 1;
    }
  }
  return m;
}
// 0 = blocked, 1 = enter, 2 = enter and stop
function enterMode(st, u, P, fly, toIdx) {
  const tt = st.tiles[toIdx];
  if (fly) return 1;
  if (u.naval) {
    if (isWater(tt.t)) return (tt.t === T.OCEAN && !P.techs.sailing) ? 0 : 1;
    if (tt.t === T.MOUNTAIN && !P.techs.climbing) return 0;
    return 2;
  }
  if (isWater(tt.t)) return (tt.imp === 'port' && tt.owner === u.owner) ? 2 : 0;
  if (tt.t === T.MOUNTAIN) { if (!P.techs.climbing) return 0; return P.tribe === 'ironpeak' ? 1 : 2; }
  if (tt.t === T.FOREST) return P.tribe === 'verdant' ? 1 : 2;
  return 1;
}
TT.enterMode = enterMode;

// returns Map idx -> {s, p, stop, occ}
TT.reach = function (st, u, moveOverride) {
  const S = TT.stats(st, u), P = st.players[u.owner];
  const W = st.W, mv = moveOverride != null ? moveOverride : S.move;
  const fly = has(S, 'fly');
  const occ = TT.occ(st);
  const zoc = fly ? null : zocMap(st, u.owner);
  const res = new Map(), done = new Set();
  const start = u.y * W + u.x;
  res.set(start, { s: 0, n: 0, p: -1, stop: false, occ: false });
  const open = [start];
  const roadOK = !u.naval && !fly;
  while (open.length) {
    // smallest cost first (maps are small, a linear scan is fine)
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (res.get(open[k]).s < res.get(open[bi]).s) bi = k;
    const ci = open.splice(bi, 1)[0];
    if (done.has(ci)) continue;
    done.add(ci);
    const cn = res.get(ci);
    if (cn.s >= mv - 1e-9 || cn.stop) continue;
    const cx = ci % W, cy = (ci / W) | 0, fromRoad = roadOK && isRoad(st.tiles[ci]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= st.H) continue;
      const ni = ny * W + nx;
      if (done.has(ni)) continue;
      let mode = enterMode(st, u, P, fly, ni);
      if (!mode) continue;
      const o = occ[ni];
      if (o && o.owner !== u.owner) continue;
      const onRoad = fromRoad && isRoad(st.tiles[ni]) && !TT.isWater(st.tiles[ni].t);
      if (onRoad && mode === 2) mode = 1;
      const cost = cn.s + (onRoad ? 0.5 : 1);
      if (cost > mv + 1e-9) continue;
      const prev = res.get(ni);
      if (prev && prev.s <= cost) continue;
      let stop = mode === 2;
      if (zoc && zoc[ni]) stop = true;
      res.set(ni, { s: cost, n: cn.n + 1, p: ci, stop, occ: !!o });
      open.push(ni);
    }
  }
  return res;
};
TT.pathTo = function (st, R, idx) {
  const path = [];
  let i = idx;
  while (i >= 0) { path.push([i % st.W, (i / st.W) | 0]); i = R.get(i).p; }
  return path.reverse();
};
TT.moveTargets = function (st, u) {
  if (!u.canMove) return [];
  const R = TT.reach(st, u), out = [];
  const start = u.y * st.W + u.x;
  R.forEach((n, i) => { if (i !== start && !n.occ) out.push(i); });
  return out;
};

TT.targetsFrom = function (st, u, x, y) {
  const S = TT.stats(st, u), r = TT.effRange(st, u, x, y, S);
  const P = st.players[u.owner], out = [];
  for (const e of st.units) {
    if (e.owner === u.owner) continue;
    const d = cheb(x, y, e.x, e.y);
    if (d === 0 || d > r) continue;
    if (!TT.visibleTo(st, e, u.owner)) continue;
    if (has(S, 'convert') && TT.UNITS[e.type].super) continue;
    out.push(e);
  }
  return out;
};
TT.attackTargets = function (st, u) {
  if (!u.canAttack) return [];
  const S = TT.stats(st, u);
  if (S.atk <= 0 && !has(S, 'convert')) return [];
  return TT.targetsFrom(st, u, u.x, u.y);
};

// --- combat
TT.defBonus = function (st, d, dx, dy) {
  dx = dx == null ? d.x : dx; dy = dy == null ? d.y : dy;
  const tl = st.tiles[dy * st.W + dx], P = st.players[d.owner], S = TT.stats(st, d);
  let b = 1;
  if (tl.site >= 0) {
    const c = st.cities[tl.site];
    if (c.owner === d.owner && has(S, 'fortify')) b = c.walls ? 4 : 1.5;
  } else if (d.naval) {
    if (P.techs.aquatism) b = 1.5;
  } else {
    if (tl.t === T.FOREST && P.techs.archery) b = 1.5;
    else if (tl.t === T.MOUNTAIN && P.techs.climbing) b = 1.5;
  }
  // aura
  let aura = has(S, 'aura');
  if (!aura) {
    for (const f of st.units) {
      if (f.owner !== d.owner || f === d) continue;
      if (cheb(f.x, f.y, dx, dy) === 1 && TT.UNITS[f.type].skills.indexOf('aura') >= 0 && !f.naval) { aura = true; break; }
    }
  }
  if (aura) b *= 1.25;
  if (P.tribe === 'frostkin' && tl.owner === d.owner) b *= 1.1;
  return b;
};

// opt: {ax, ay, moved, ahp, dx, dy, dhp}
TT.combat = function (st, a, d, opt) {
  opt = opt || {};
  const ax = opt.ax != null ? opt.ax : a.x, ay = opt.ay != null ? opt.ay : a.y;
  const dx = opt.dx != null ? opt.dx : d.x, dy = opt.dy != null ? opt.dy : d.y;
  const ahp = opt.ahp != null ? opt.ahp : a.hp, dhp = opt.dhp != null ? opt.dhp : d.hp;
  const moved = opt.moved != null ? opt.moved : a.movedDist;
  const SA = TT.stats(st, a), SD = TT.stats(st, d);
  let atk = SA.atk;
  if (has(SA, 'charge')) atk += 0.5 * moved;
  const ta = st.tiles[ay * st.W + ax], td = st.tiles[dy * st.W + dx];
  const high = !has(SA, 'fly') && ta.e > td.e;
  if (high) atk *= 1.25;
  const defB = TT.defBonus(st, d, dx, dy);
  const aF = atk * ahp / SA.maxHp;
  const dF = SD.def * dhp / SD.maxHp * defB;
  const tot = aF + dF;
  if (tot <= 0 || atk <= 0) return { dmg: 0, counter: 0, killed: false, counterKills: false, high, defB };
  const dmg = Math.round(aF / tot * atk * 4.5);
  const killed = dmg >= dhp;
  let counter = 0;
  if (!killed) {
    const dist = cheb(ax, ay, dx, dy);
    if (dist <= TT.effRange(st, d, dx, dy, SD)) counter = Math.round(dF / tot * SD.def * 4.5);
  }
  return { dmg, counter, killed, counterKills: counter >= ahp, high, defB };
};

function killUnit(st, u, killer, evs) {
  const i = st.units.indexOf(u);
  if (i >= 0) st.units.splice(i, 1);
  st.players[u.owner].losses++;
  if (killer) {
    const K = st.players[killer.owner];
    K.kills++; K.power = Math.min(TT.POWER_MAX, K.power + 1);
    killer.kills++;
    if (!killer.vet && killer.kills >= 3) {
      killer.vet = true; killer.hp = TT.stats(st, killer).maxHp;
      evs.push({ type: 'veteran', uid: killer.id, x: killer.x, y: killer.y });
    }
    if (K.tribe === 'emberfolk') { killer.hp = Math.min(TT.stats(st, killer).maxHp, killer.hp + 3); K.stars += 1; }
  }
  evs.push({ type: 'die', uid: u.id, x: u.x, y: u.y, owner: u.owner, utype: u.type, naval: u.naval });
  bump(st);
}

function canStand(st, u, x, y) {
  if (!TT.inB(st, x, y)) return false;
  if (TT.unitAt(st, x, y)) return false;
  const S = TT.stats(st, u), P = st.players[u.owner];
  if (has(S, 'fly')) return true;
  const tl = st.tiles[y * st.W + x];
  if (u.naval) return isWater(tl.t) && (tl.t !== T.OCEAN || P.techs.sailing);
  if (isWater(tl.t)) return false;
  if (tl.t === T.MOUNTAIN && !P.techs.climbing) return false;
  return true;
}

function damage(st, u, n, killer, evs, kind) {
  u.hp -= n;
  evs.push({ type: 'hurt', uid: u.id, x: u.x, y: u.y, n, kind: kind || 'hit' });
  if (u.hp <= 0) { killUnit(st, u, killer, evs); return true; }
  return false;
}

// ---------------------------------------------------------------- actions
function own(st, u) { return u && u.owner === st.current && !st.over; }

TT.move = function (st, uid, tx, ty) {
  const u = TT.getUnit(st, uid);
  if (!own(st, u) || !u.canMove) return null;
  const R = TT.reach(st, u);
  const ti = ty * st.W + tx, node = R.get(ti);
  if (!node || node.occ || ti === u.y * st.W + u.x) return null;
  const path = TT.pathTo(st, R, ti);
  const S = TT.stats(st, u);
  const evs = [];
  const tl = st.tiles[ti];
  let embark = false, disembark = false;
  const prevNaval = u.naval;
  if (!has(S, 'fly')) {
    if (u.naval && !isWater(tl.t)) { disembark = true; u.naval = null; }
    else if (!u.naval && isWater(tl.t)) { embark = true; u.naval = 'boat'; }
  }
  const fromX = u.x, fromY = u.y;
  u.x = tx; u.y = ty;
  u.movedDist += node.n;
  u.canMove = false;
  if (!has(S, 'dash') || embark || disembark) u.canAttack = false;
  bump(st);
  evs.push({ type: 'move', uid: u.id, path, from: [fromX, fromY], embark, disembark, prevNaval });
  const nrev = unitReveal(st, u);
  if (nrev) evs.push({ type: 'reveal', pid: u.owner, n: nrev });
  if (tl.ruin && !isWater(tl.t)) claimRuin(st, u, tl, evs);
  // stomp
  if (TT.UNITS[u.type].skills.indexOf('stomp') >= 0 && !u.naval) {
    for (const e of st.units.slice()) {
      if (e.owner !== u.owner && cheb(e.x, e.y, u.x, u.y) === 1) damage(st, e, 2, u, evs, 'stomp');
    }
  }
  checkWin(st, evs);
  return evs;
};

function claimRuin(st, u, tl, evs) {
  tl.ruin = false;
  const P = st.players[u.owner];
  const r = rand(st);
  let msg;
  const avail = TT.TECH_ORDER.filter(k => TT.canResearch(st, u.owner, k, true));
  if (r < 0.28) { P.stars += 10; msg = '10 stars'; }
  else if (r < 0.48 && avail.length) { const k = avail[(rand(st) * avail.length) | 0]; P.techs[k] = true; msg = 'the secret of ' + TT.TECHS[k].name; }
  else if (r < 0.68) {
    let n = 0;
    for (let k = 0; k < 3; k++) {
      let x = u.x, y = u.y;
      for (let s = 0; s < 6; s++) { x = Math.max(0, Math.min(st.W - 1, x + Math.round((rand(st) - 0.5) * 4))); y = Math.max(0, Math.min(st.H - 1, y + Math.round((rand(st) - 0.5) * 4))); n += reveal(st, u.owner, x, y, 1); }
    }
    msg = 'an old map (' + n + ' tiles revealed)';
  }
  else if (r < 0.86) {
    const spot = freeAdjacent(st, u.x, u.y, true);
    if (spot) { const nu = spawnUnit(st, 'swordsman', u.owner, spot[0], spot[1], -1, false); evs.push({ type: 'spawn', uid: nu.id, x: nu.x, y: nu.y }); msg = 'a band of Swordsmen'; }
    else { P.stars += 8; msg = '8 stars'; }
  }
  else {
    let best = null, bd = 99;
    for (const c of st.cities) if (c.owner === u.owner) { const d = cheb(c.x, c.y, u.x, u.y); if (d < bd) { bd = d; best = c; } }
    if (best) { addPop(st, best, 3, evs); msg = '3 population for ' + best.name; } else { P.stars += 8; msg = '8 stars'; }
  }
  evs.push({ type: 'ruin', x: u.x, y: u.y, pid: u.owner, msg });
  log(st, P.name + ' explored ruins and found ' + msg + '.', u.owner);
  bump(st);
}

function freeAdjacent(st, x, y, landOnly) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (!TT.inB(st, nx, ny) || TT.unitAt(st, nx, ny)) continue;
    const tl = st.tiles[ny * st.W + nx];
    if (landOnly && (isWater(tl.t) || tl.t === T.MOUNTAIN)) continue;
    return [nx, ny];
  }
  return null;
}

TT.attack = function (st, uid, tid) {
  const a = TT.getUnit(st, uid), d = TT.getUnit(st, tid);
  if (!own(st, a) || !d || !a.canAttack) return null;
  if (TT.attackTargets(st, a).indexOf(d) < 0) return null;
  const SA = TT.stats(st, a);
  const evs = [];
  const ranged = cheb(a.x, a.y, d.x, d.y) > 1;
  if (has(SA, 'convert')) {
    const from = d.owner;
    d.owner = a.owner; d.home = -1; d.canMove = false; d.canAttack = false; d.frozen = 0;
    st.players[from].losses++;
    evs.push({ type: 'convert', aid: a.id, did: d.id, from: [a.x, a.y], to: [d.x, d.y], prevOwner: from });
    a.canAttack = false; if (!has(SA, 'escape')) a.canMove = false;
    bump(st);
    unitReveal(st, d);
    log(st, st.players[a.owner].name + ' converted a ' + TT.unitName(d) + '.', a.owner);
    checkWin(st, evs);
    return evs;
  }
  const r = TT.combat(st, a, d);
  const ev = { type: 'attack', aid: a.id, did: d.id, from: [a.x, a.y], to: [d.x, d.y], ranged, dmg: r.dmg, counter: 0, killed: false, high: r.high, utype: a.type, naval: a.naval };
  evs.push(ev);
  const dx0 = d.x, dy0 = d.y;
  d.hp -= r.dmg;
  if (d.hp <= 0) {
    ev.killed = true;
    killUnit(st, d, a, evs);
    // melee advance
    if (!ranged && SA.range === 1 && canStand(st, a, dx0, dy0)) {
      const tl = st.tiles[dy0 * st.W + dx0];
      const fx = a.x, fy = a.y;
      a.x = dx0; a.y = dy0;
      evs.push({ type: 'advance', uid: a.id, from: [fx, fy], to: [dx0, dy0] });
      unitReveal(st, a);
      if (tl.ruin && !isWater(tl.t)) claimRuin(st, a, tl, evs);
    }
  } else {
    // shove
    let shoved = false;
    if (has(SA, 'shove') && !ranged) {
      const sx = Math.sign(d.x - a.x), sy = Math.sign(d.y - a.y);
      const nx = d.x + sx, ny = d.y + sy;
      if (canStand(st, d, nx, ny)) {
        evs.push({ type: 'shove', uid: d.id, from: [d.x, d.y], to: [nx, ny] });
        d.x = nx; d.y = ny; shoved = true; bump(st);
      } else {
        evs.push({ type: 'slam', uid: d.id, x: d.x, y: d.y });
        if (damage(st, d, 2, a, evs, 'slam')) { ev.killed = true; }
      }
    }
    if (!ev.killed && !shoved && r.counter > 0) {
      ev.counter = r.counter;
      a.hp -= r.counter;
      if (a.hp <= 0) { ev.attackerDied = true; killUnit(st, a, d, evs); }
    }
  }
  // splash
  if (has(SA, 'splash')) {
    const sd = Math.max(1, Math.round(r.dmg / 2));
    for (const e of st.units.slice()) {
      if (e.owner === a.owner || e === d) continue;
      if (cheb(e.x, e.y, dx0, dy0) === 1) damage(st, e, sd, a, evs, 'splash');
    }
    evs.push({ type: 'splash', x: dx0, y: dy0 });
  }
  if (st.units.indexOf(a) >= 0) {
    a.canAttack = has(SA, 'persist') && ev.killed;
    if (has(SA, 'escape')) a.canMove = true; else a.canMove = false;
  }
  bump(st);
  checkWin(st, evs);
  return evs;
};

TT.canCapture = function (st, u) {
  if (!u || !u.canMove || !u.canAttack || u.naval) return false;
  const S = TT.stats(st, u);
  if (has(S, 'fly') || has(S, 'infiltrate')) return false;
  const tl = st.tiles[u.y * st.W + u.x];
  if (tl.site < 0) return false;
  return st.cities[tl.site].owner !== u.owner;
};

TT.capture = function (st, uid) {
  const u = TT.getUnit(st, uid);
  if (!own(st, u) || !TT.canCapture(st, u)) return null;
  const tl = st.tiles[u.y * st.W + u.x];
  const c = st.cities[tl.site];
  const prev = c.owner, P = st.players[u.owner];
  const evs = [];
  c.owner = u.owner;
  if (prev === -1) {
    c.level = 1; c.pop = 0; c.founded = st.turn;
    claim(st, c, c.radius);
    log(st, P.name + ' founded ' + c.name + '.', u.owner);
  } else {
    for (const t of st.tiles) if (t.city === c.id) t.owner = u.owner;
    if (c.capital) { c.capital = false; }
    c.pending = [];
    for (const o of st.units) if (o.home === c.id) o.home = -1;
    log(st, P.name + ' captured ' + c.name + ' from ' + st.players[prev].name + '!', u.owner);
  }
  u.canMove = false; u.canAttack = false;
  reveal(st, u.owner, c.x, c.y, c.radius + 1);
  bump(st);
  evs.push({ type: 'capture', cid: c.id, x: c.x, y: c.y, pid: u.owner, prev });
  if (prev >= 0 && !st.cities.some(k => k.owner === prev)) eliminate(st, prev, u.owner, evs);
  checkWin(st, evs);
  return evs;
};

function eliminate(st, pid, by, evs) {
  const P = st.players[pid];
  P.alive = false;
  for (const o of st.units.slice()) if (o.owner === pid) killUnit(st, o, null, evs);
  evs.push({ type: 'eliminated', pid, by });
  log(st, P.name + ' has fallen.', pid);
}

TT.recover = function (st, uid) {
  const u = TT.getUnit(st, uid);
  if (!own(st, u) || !u.canMove || !u.canAttack) return null;
  const S = TT.stats(st, u);
  if (u.hp >= S.maxHp) return null;
  const tl = st.tiles[u.y * st.W + u.x];
  const amt = tl.owner === u.owner ? 4 : 2;
  const n = Math.min(amt, S.maxHp - u.hp);
  u.hp += n; u.canMove = false; u.canAttack = false;
  bump(st);
  return [{ type: 'heal', uid: u.id, x: u.x, y: u.y, n }];
};

TT.healTargets = function (st, u) {
  return st.units.filter(f => f.owner === u.owner && f !== u && cheb(f.x, f.y, u.x, u.y) === 1 && f.hp < TT.stats(st, f).maxHp);
};
TT.healOthers = function (st, uid) {
  const u = TT.getUnit(st, uid);
  if (!own(st, u) || !u.canMove || !u.canAttack || !has(TT.stats(st, u), 'heal')) return null;
  const ts = TT.healTargets(st, u);
  if (!ts.length) return null;
  const evs = [{ type: 'healwave', uid: u.id, x: u.x, y: u.y }];
  for (const f of ts) {
    const n = Math.min(4, TT.stats(st, f).maxHp - f.hp);
    f.hp += n;
    evs.push({ type: 'heal', uid: f.id, x: f.x, y: f.y, n });
  }
  u.canMove = false; u.canAttack = false;
  bump(st);
  return evs;
};

TT.disband = function (st, uid) {
  const u = TT.getUnit(st, uid);
  if (!own(st, u)) return null;
  const evs = [];
  st.players[u.owner].stars += Math.floor(TT.UNITS[u.type].cost / 2);
  killUnit(st, u, null, evs);
  st.players[u.owner].losses--;
  return evs;
};

TT.upgradeOptions = function (st, u) {
  if (!u.naval) return [];
  const P = st.players[u.owner];
  const out = [];
  if (u.naval === 'boat' && P.techs.sailing) out.push('ship');
  if (u.naval !== 'battleship' && P.techs.navigation) out.push('battleship');
  return out;
};
TT.upgrade = function (st, uid, kind) {
  const u = TT.getUnit(st, uid);
  if (!own(st, u) || TT.upgradeOptions(st, u).indexOf(kind) < 0) return null;
  const P = st.players[u.owner], cost = TT.NAVAL[kind].cost;
  if (P.stars < cost) return null;
  P.stars -= cost; u.naval = kind; bump(st);
  return [{ type: 'upgrade', uid: u.id, x: u.x, y: u.y }];
};

// --- cities
TT.income = function (st, pid) {
  const P = st.players[pid];
  let s = 0;
  for (const c of st.cities) {
    if (c.owner !== pid) continue;
    s += c.level + c.workshop + c.parks + (c.capital ? 1 : 0);
    if (c.capital && P.tribe === 'sunspire') s += 1;
  }
  if (P.techs.trade) s += TT.tradeLinks(st, pid);
  for (let i = 0; i < st.tiles.length; i++) if (st.tiles[i].imp === 'market' && st.tiles[i].owner === pid) s += TT.marketYield(st, i);
  if (P.embassy) s += TT.metRivals(st, pid).length;
  if (P.isAI) s += TT.DIFFICULTY[P.difficulty || 'normal'].bonus;
  return s;
};
// cities (other than the capital) joined to the capital through road or city tiles
TT.tradeLinks = function (st, pid) {
  const cap = st.cities.find(c => c.owner === pid && c.capital);
  if (!cap) return 0;
  const W = st.W, seen = new Uint8Array(W * st.H), q = [cap.y * W + cap.x];
  seen[q[0]] = 1;
  let n = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, y = (i / W) | 0, tl = st.tiles[i];
    if (tl.site >= 0 && tl.site !== cap.id && st.cities[tl.site].owner === pid) n++;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= st.H) continue;
      const ni = ny * W + nx;
      if (!seen[ni] && isRoad(st.tiles[ni])) { seen[ni] = 1; q.push(ni); }
    }
  }
  return n;
};
// a market earns 1 star for each farm, mine, lumber hut, port or temple next to it (at least 1, at most 4)
TT.MARKET_FEEDERS = { farm: 1, mine: 1, lumber: 1, port: 1, temple: 1 };
TT.marketYield = function (st, i) {
  const W = st.W, x = i % W, y = (i / W) | 0;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < st.H && TT.MARKET_FEEDERS[st.tiles[ny * W + nx].imp]) n++;
  }
  return Math.max(1, Math.min(4, n));
};
TT.metRivals = function (st, pid) {
  const P = st.players[pid], out = [];
  for (const Q of st.players) {
    if (Q.id === pid || !Q.alive) continue;
    if (st.cities.some(c => c.owner === Q.id && P.explored[c.y * st.W + c.x]) || st.units.some(u => u.owner === Q.id && P.explored[u.y * st.W + u.x])) out.push(Q.id);
  }
  return out;
};
TT.buildEmbassy = function (st, cid) {
  const c = st.cities[cid], P = st.players[st.current];
  if (!c || c.owner !== st.current || !c.capital || P.embassy || !P.techs.diplomacy || P.stars < 5) return null;
  P.stars -= 5; P.embassy = true;
  for (const q of TT.metRivals(st, P.id)) { const cap = st.cities.find(k => k.owner === q && k.capital); if (cap) reveal(st, P.id, cap.x, cap.y, 1); }
  log(st, P.name + ' opened an embassy.', P.id);
  bump(st);
  return [{ type: 'build', x: c.x, y: c.y, kind: 'embassy', cid }];
};
TT.canInfiltrate = function (st, u) {
  if (!u || !u.canMove || !u.canAttack || u.naval || TT.UNITS[u.type].skills.indexOf('infiltrate') < 0) return null;
  for (const c of st.cities) if (c.owner >= 0 && c.owner !== u.owner && cheb(c.x, c.y, u.x, u.y) <= 1) return c;
  return null;
};
TT.infiltrate = function (st, uid) {
  const u = TT.getUnit(st, uid);
  if (!own(st, u)) return null;
  const c = TT.canInfiltrate(st, u);
  if (!c) return null;
  const V = st.players[c.owner], P = st.players[u.owner];
  const n = Math.min(V.stars, 3 + c.level * 2);
  V.stars -= n; P.stars += n;
  c.pop = 0;
  const evs = [{ type: 'infiltrate', uid: u.id, x: c.x, y: c.y, from: [u.x, u.y], cid: c.id, n }];
  killUnit(st, u, null, evs);
  st.players[u.owner].losses--;
  log(st, P.name + ' infiltrated ' + c.name + ' and stole ' + n + ' stars!', u.owner);
  bump(st);
  return evs;
};
TT.cityUnits = (st, c) => st.units.filter(u => u.home === c.id && u.owner === c.owner).length;
TT.cityCap = c => c.level + 1;

TT.canTrain = function (st, cid, type) {
  const c = st.cities[cid], P = st.players[st.current], B = TT.UNITS[type];
  if (!c || c.owner !== st.current || !B || B.super) return false;
  if (B.tech && !P.techs[B.tech]) return false;
  if (P.stars < B.cost) return false;
  if (TT.unitAt(st, c.x, c.y)) return false;
  if (TT.cityUnits(st, c) >= TT.cityCap(c)) return false;
  return true;
};
TT.train = function (st, cid, type) {
  if (st.over || !TT.canTrain(st, cid, type)) return null;
  const c = st.cities[cid], P = st.players[st.current];
  P.stars -= TT.UNITS[type].cost;
  const u = spawnUnit(st, type, c.owner, c.x, c.y, c.id, false);
  return [{ type: 'spawn', uid: u.id, x: c.x, y: c.y }];
};

function addPop(st, c, n, evs) {
  c.pop += n;
  while (c.pop >= c.level + 1) {
    c.pop -= c.level + 1;
    c.level++;
    c.pending.push(c.level);
    evs.push({ type: 'levelup', cid: c.id, x: c.x, y: c.y, level: c.level });
    log(st, c.name + ' grew to level ' + c.level + '.', c.owner);
  }
  bump(st);
}

TT.buildOptions = function (st, pid, x, y) {
  const tl = st.tiles[y * st.W + x], P = st.players[pid], out = [];
  if (tl.owner !== pid || tl.city < 0 || st.cities[tl.city].owner !== pid) return out;
  const occ = TT.unitAt(st, x, y);
  if (occ && occ.owner !== pid) return out;
  const add = k => out.push(k);
  if (tl.res === 'fruit') add('fruit');
  if (tl.res === 'game') add('hunt');
  if (tl.res === 'fish') add('fish');
  if (tl.res === 'crop' && !tl.imp) add('farm');
  if (tl.res === 'ore' && !tl.imp) add('mine');
  if (tl.t === T.FOREST && !tl.imp && !tl.res) { add('lumber'); add('clear'); add('temple'); }
  if (tl.t === T.FIELD && !tl.imp && !tl.res && tl.site < 0) {
    add('temple'); add('grow');
    if (!st.tiles.some(t => t.imp === 'market' && t.city === tl.city)) add('market');
  }
  if (tl.res === 'whale') add('whale');
  if (!TT.isWater(tl.t) && !tl.road && tl.site < 0) add('road');
  if (tl.t === T.SHALLOW && !tl.imp && !tl.res) {
    let coast = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (TT.inB(st, nx, ny) && !isWater(st.tiles[ny * st.W + nx].t)) coast = true;
    }
    if (coast) add('port');
  }
  return out;
};
TT.canBuild = function (st, pid, x, y, k) {
  const B = TT.BUILD[k], P = st.players[pid];
  if (!B || TT.buildOptions(st, pid, x, y).indexOf(k) < 0) return false;
  if (!P.techs[B.tech]) return false;
  return P.stars >= Math.max(0, B.cost);
};
TT.build = function (st, x, y, k) {
  const pid = st.current;
  if (st.over || !TT.canBuild(st, pid, x, y, k)) return null;
  const tl = st.tiles[y * st.W + x], P = st.players[pid], B = TT.BUILD[k];
  const c = st.cities[tl.city];
  P.stars -= B.cost;
  const evs = [{ type: 'build', x, y, kind: k, cid: c.id }];
  if (k === 'fruit' || k === 'hunt' || k === 'fish' || k === 'whale') tl.res = null;
  else if (k === 'road') tl.road = true;
  else if (k === 'temple') tl.imp = 'temple';
  else if (k === 'market') tl.imp = 'market';
  else if (k === 'grow') tl.t = T.FOREST;
  else if (k === 'farm') tl.imp = 'farm';
  else if (k === 'mine') tl.imp = 'mine';
  else if (k === 'lumber') tl.imp = 'lumber';
  else if (k === 'port') tl.imp = 'port';
  else if (k === 'clear') { tl.t = T.FIELD; tl.imp = null; }
  if (B.pop) addPop(st, c, B.pop, evs);
  bump(st);
  return evs;
};

TT.chooseReward = function (st, cid, key) {
  const c = st.cities[cid];
  if (!c || !c.pending.length || c.owner < 0) return null;
  const lvl = c.pending[0];
  if (TT.rewardOptions(lvl).indexOf(key) < 0) return null;
  c.pending.shift();
  const P = st.players[c.owner];
  const evs = [{ type: 'reward', cid, key, x: c.x, y: c.y }];
  switch (key) {
    case 'workshop': c.workshop++; break;
    case 'explorer': {
      let n = 0;
      for (let k = 0; k < 4; k++) {
        let x = c.x, y = c.y;
        for (let s = 0; s < 7; s++) {
          x = Math.max(0, Math.min(st.W - 1, x + Math.round((rand(st) - 0.5) * 4)));
          y = Math.max(0, Math.min(st.H - 1, y + Math.round((rand(st) - 0.5) * 4)));
          n += reveal(st, c.owner, x, y, 1);
        }
      }
      evs.push({ type: 'reveal', pid: c.owner, n });
      break;
    }
    case 'walls': c.walls = true; break;
    case 'resources': P.stars += 5; break;
    case 'growth': addPop(st, c, 3, evs); break;
    case 'borders': c.radius = 2; claim(st, c, 2); reveal(st, c.owner, c.x, c.y, 3); break;
    case 'park': c.parks++; break;
    case 'giant': {
      const spot = TT.unitAt(st, c.x, c.y) ? freeAdjacent(st, c.x, c.y, true) : [c.x, c.y];
      if (spot) { const g = spawnUnit(st, 'giant', c.owner, spot[0], spot[1], -1, false); evs.push({ type: 'spawn', uid: g.id, x: g.x, y: g.y, big: true }); }
      else P.stars += 10;
      break;
    }
  }
  bump(st);
  return evs;
};

TT.buildWalls = function (st, cid) {
  const c = st.cities[cid], P = st.players[st.current];
  if (!c || c.owner !== st.current || c.walls || !P.techs.construction || P.stars < 5) return null;
  P.stars -= 5; c.walls = true; bump(st);
  return [{ type: 'build', x: c.x, y: c.y, kind: 'walls', cid }];
};

// --- tech
TT.techCost = function (st, pid, k) {
  const n = Math.max(1, st.cities.filter(c => c.owner === pid).length);
  let cost = TT.TECHS[k].tier * n + 4;
  if (st.players[pid].techs.philosophy) cost = Math.ceil(cost * 0.75);
  return cost;
};
TT.canResearch = function (st, pid, k, ignoreCost) {
  const P = st.players[pid], Tk = TT.TECHS[k];
  if (!Tk || P.techs[k]) return false;
  if (Tk.req && !P.techs[Tk.req]) return false;
  return ignoreCost || P.stars >= TT.techCost(st, pid, k);
};
TT.research = function (st, k) {
  const pid = st.current;
  if (st.over || !TT.canResearch(st, pid, k)) return null;
  const P = st.players[pid];
  P.stars -= TT.techCost(st, pid, k);
  P.techs[k] = true;
  bump(st);
  return [{ type: 'tech', pid, tech: k }];
};

// --- tribe power
TT.usePower = function (st) {
  const pid = st.current, P = st.players[pid];
  if (st.over || P.power < TT.POWER_COST) return null;
  P.power -= TT.POWER_COST;
  const tribe = TT.tribe(P.tribe);
  const evs = [{ type: 'power', pid, power: tribe.power }];
  const mine = st.units.filter(u => u.owner === pid);
  switch (tribe.power) {
    case 'overgrowth':
      for (const u of mine) { const m = TT.stats(st, u).maxHp; const n = Math.min(5, m - u.hp); if (n > 0) { u.hp += n; evs.push({ type: 'heal', uid: u.id, x: u.x, y: u.y, n }); } }
      { const cap = st.cities.find(c => c.owner === pid && c.capital); if (cap) addPop(st, cap, 1, evs); }
      break;
    case 'forge': P.buff.forge = true; break;
    case 'tailwind': P.buff.tailwind = true; break;
    case 'wildfire':
      for (const e of st.units.slice()) {
        if (e.owner === pid) continue;
        if (mine.some(u => st.units.indexOf(u) >= 0 && cheb(u.x, u.y, e.x, e.y) === 1)) {
          evs.push({ type: 'fire', x: e.x, y: e.y });
          damage(st, e, 4, null, evs, 'fire');
        }
      }
      break;
    case 'blizzard': {
      const srcs = mine.map(u => [u.x, u.y]).concat(st.cities.filter(c => c.owner === pid).map(c => [c.x, c.y]));
      for (const e of st.units) {
        if (e.owner === pid) continue;
        if (srcs.some(s => cheb(s[0], s[1], e.x, e.y) <= 2)) { e.frozen = 1; evs.push({ type: 'freeze', uid: e.id, x: e.x, y: e.y }); }
      }
      break;
    }
    case 'goldenage': {
      const n = st.cities.filter(c => c.owner === pid).length * 2;
      P.stars += n; evs.push({ type: 'gold', pid, n });
      break;
    }
  }
  log(st, P.name + ' unleashed ' + tribe.powerName + '!', pid);
  bump(st);
  checkWin(st, evs);
  return evs;
};

// ---------------------------------------------------------------- turns
function startTurn(st) {
  const P = st.players[st.current];
  P.buff = {};
  const evs = [];
  if (st.turn > 1) P.stars += TT.income(st, P.id);
  if (st.turn > 1) P.power = Math.min(TT.POWER_MAX, P.power + 1);
  const storm = st.storm;
  for (const u of st.units.slice()) {
    if (u.owner !== P.id) continue;
    u.canMove = !u.frozen; u.canAttack = true; u.movedDist = 0;
    u.frozen = 0;
    u.slow = !!(storm && cheb(u.x, u.y, storm.x, storm.y) <= 1);
    if (u.slow && u.naval && u.hp > 1 && !P.techs.aquatism) { const n = Math.min(2, u.hp - 1); u.hp -= n; evs.push({ type: 'hurt', uid: u.id, x: u.x, y: u.y, n, kind: 'storm' }); }
  }
  bump(st);
  return evs;
}
TT.startTurn = startTurn;

TT.endTurn = function (st) {
  if (st.over) return [];
  const P = st.players[st.current];
  // auto-resolve any leftover rewards
  for (const c of st.cities) while (c.owner === P.id && c.pending.length) TT.chooseReward(st, c.id, TT.rewardOptions(c.pending[0])[0]);
  P.buff = {};
  for (const u of st.units) if (u.owner === P.id) { u.slow = false; }
  const evs = [];
  let n = st.players.length, nxt = st.current;
  do { nxt = (nxt + 1) % n; if (nxt === 0) { st.turn++; roundEvents(st, evs); } } while (!st.players[nxt].alive && nxt !== st.current);
  st.current = nxt;
  // score snapshot
  for (const Q of st.players) { Q.score = TT.score(st, Q.id); }
  if (st.current === firstAlive(st)) for (const Q of st.players) Q.scoreHist.push(Q.score);
  if (st.settings.mode === 'score' && st.turn > st.settings.turnLimit && !st.over) {
    let best = null;
    for (const Q of st.players) if (Q.alive && (!best || Q.score > best.score)) best = Q;
    st.over = { winner: best.id, reason: 'score' };
    evs.push({ type: 'gameover', winner: best.id });
    return evs;
  }
  evs.push({ type: 'turn', pid: st.current, turn: st.turn });
  evs.push.apply(evs, startTurn(st));
  return evs;
};
function firstAlive(st) { for (const P of st.players) if (P.alive) return P.id; return 0; }

function roundEvents(st, evs) {
  if (!st.settings.events) return;
  const W = st.W, H = st.H;
  if (st.storm) {
    const s = st.storm;
    s.life--;
    if (s.life <= 0) { evs.push({ type: 'stormend', x: s.x, y: s.y }); st.storm = null; log(st, 'The storm has passed.'); }
    else {
      s.x = Math.max(1, Math.min(W - 2, s.x + s.dx));
      s.y = Math.max(1, Math.min(H - 2, s.y + s.dy));
      if (rand(st) < 0.3) { s.dx = Math.round((rand(st) - 0.5) * 2.4); s.dy = Math.round((rand(st) - 0.5) * 2.4); if (!s.dx && !s.dy) s.dx = 1; }
      evs.push({ type: 'stormmove', x: s.x, y: s.y });
    }
  } else if (st.turn > 3 && rand(st) < 0.16) {
    const x = 1 + ((rand(st) * (W - 2)) | 0), y = 1 + ((rand(st) * (H - 2)) | 0);
    let dx = Math.round((rand(st) - 0.5) * 2.4), dy = Math.round((rand(st) - 0.5) * 2.4);
    if (!dx && !dy) dy = 1;
    st.storm = { x, y, dx, dy, life: 4 + ((rand(st) * 3) | 0) };
    evs.push({ type: 'stormstart', x, y });
    log(st, 'A storm is gathering. Units inside it move slower; boats take damage.');
  }
  if (st.turn > 2 && rand(st) < 0.14) {
    let n = 0;
    for (let k = 0; k < 40 && n < 4; k++) {
      const i = (rand(st) * W * H) | 0, tl = st.tiles[i];
      if (tl.res || tl.imp || tl.site >= 0) continue;
      const res = tl.t === T.FIELD ? (rand(st) < 0.5 ? 'fruit' : 'crop') : tl.t === T.FOREST ? 'game' : tl.t === T.MOUNTAIN ? 'ore' : tl.t === T.SHALLOW ? 'fish' : null;
      if (!res) continue;
      tl.res = res; n++;
      evs.push({ type: 'bloom', x: i % W, y: (i / W) | 0, res });
    }
    if (n) { log(st, 'Wild growth: ' + n + ' new resources have appeared.'); bump(st); }
  }
}

// score = sum of these parts; the UI shows the same breakdown
TT.SCORE_PARTS = [
  { key: 'cities', name: 'Cities', rule: '50 per city + 100 per city level' },
  { key: 'parks', name: 'Parks', rule: '250 per park' },
  { key: 'tech', name: 'Technology', rule: '60 per technology' },
  { key: 'land', name: 'Territory', rule: '5 per tile inside your borders' },
  { key: 'army', name: 'Army', rule: '5 × the star cost of each unit' },
  { key: 'explore', name: 'Exploration', rule: '1 per tile explored' },
  { key: 'kills', name: 'Kills', rule: '10 per enemy unit destroyed' },
];
TT.scoreBreakdown = function (st, pid) {
  const P = st.players[pid];
  const b = { cities: 0, parks: 0, tech: 0, land: 0, army: 0, explore: 0, kills: 0, total: 0 };
  if (!P.alive) return b;
  for (const c of st.cities) if (c.owner === pid) { b.cities += 50 + c.level * 100; b.parks += c.parks * 250; }
  b.tech = Object.keys(P.techs).length * 60;
  for (const t of st.tiles) if (t.owner === pid) b.land += 5;
  for (const u of st.units) if (u.owner === pid) b.army += TT.UNITS[u.type].cost * 5;
  for (const e of P.explored) b.explore += e;
  b.kills = P.kills * 10;
  b.total = b.cities + b.parks + b.tech + b.land + b.army + b.explore + b.kills;
  return b;
};
TT.score = (st, pid) => TT.scoreBreakdown(st, pid).total;

function checkWin(st, evs) {
  if (st.over) return;
  const alive = st.players.filter(P => P.alive);
  const people = st.players.filter(P => !P.isAI);
  if (alive.length === 1) {
    st.over = { winner: alive[0].id, reason: 'domination' };
    evs.push({ type: 'gameover', winner: alive[0].id });
  } else if (people.length && people.every(P => !P.alive)) {
    let best = null;
    for (const Q of alive) { Q.score = TT.score(st, Q.id); if (!best || Q.score > best.score) best = Q; }
    st.over = { winner: best.id, reason: 'defeat' };
    evs.push({ type: 'gameover', winner: best.id });
  }
}
TT.checkWin = checkWin;

// ---------------------------------------------------------------- command log (lockstep multiplayer, replays)
// Every rule-changing action is a plain function TT.name(st, ...args). Wrapping them lets us record the
// top-level calls as commands ([name, ...args]); replaying the same commands on the same starting state
// reproduces the game exactly, because the engine's only randomness is the seeded st.rng.
TT.ACTIONS = ['move', 'attack', 'capture', 'recover', 'healOthers', 'disband', 'upgrade', 'train', 'build', 'research', 'chooseReward', 'usePower', 'buildWalls', 'buildEmbassy', 'infiltrate', 'endTurn'];
const recorders = new WeakMap();
let actionDepth = 0;
TT.ACTIONS.forEach(name => {
  const fn = TT[name];
  TT[name] = function (st) {
    const args = Array.prototype.slice.call(arguments, 1);
    actionDepth++;
    let r;
    try { r = fn.apply(this, arguments); } finally { actionDepth--; }
    if (r && actionDepth === 0) { const rec = recorders.get(st); if (rec) rec([name].concat(args)); }
    return r;
  };
});
TT.setRecorder = (st, fn) => { if (fn) recorders.set(st, fn); else recorders.delete(st); };
TT.exec = function (st, cmd) {
  if (!Array.isArray(cmd) || TT.ACTIONS.indexOf(cmd[0]) < 0) return null;
  return TT[cmd[0]].apply(null, [st].concat(cmd.slice(1)));
};
// compact fingerprint of everything that matters for play; equal hashes = same game
TT.hash = function (st) {
  const parts = [st.turn, st.current, st.rng, st.over ? st.over.winner : -1];
  for (const P of st.players) parts.push(P.stars, P.power, P.alive ? 1 : 0, P.embassy ? 1 : 0, P.isAI ? 1 : 0, Object.keys(P.techs).sort().join('.'));
  for (const u of st.units) parts.push(u.id, u.type, u.owner, u.x, u.y, u.hp, u.naval || '', u.canMove ? 1 : 0, u.canAttack ? 1 : 0, u.vet ? 1 : 0, u.frozen || 0);
  for (const c of st.cities) parts.push(c.owner, c.level, c.pop, c.walls ? 1 : 0, c.workshop, c.parks, c.radius, c.pending.join(','));
  for (const t of st.tiles) parts.push(t.t, t.owner, t.res || '', t.imp || '', t.road ? 1 : 0, t.ruin ? 1 : 0);
  if (st.storm) parts.push(st.storm.x, st.storm.y, st.storm.life);
  const s = parts.join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

// ---------------------------------------------------------------- save / load
TT.serialize = st => JSON.stringify(st);
TT.deserialize = s => { const st = JSON.parse(s); st.ver = (st.ver || 0) + 1; return st; };

})(typeof window !== 'undefined' ? window : globalThis);
