// Random game configurations for data generation and RL, covering every map type, size, player count (2-6),
// tribe line-up, game mode and bot difficulty the game offers.
'use strict';
const TT = require('./tt');

function rng(seed) {
  let a = (seed | 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickW = (R, w) => { const ks = Object.keys(w); let tot = 0; for (const k of ks) tot += w[k]; let r = R() * tot; for (const k of ks) { r -= w[k]; if (r <= 0) return k; } return ks[ks.length - 1]; };
const pick = (R, arr) => arr[(R() * arr.length) | 0];

// players that fit each map size
const PLAYERS = { tiny: [2, 3], small: [2, 3, 4], normal: [2, 3, 4, 5], large: [3, 4, 5, 6], huge: [4, 5, 6] };

const DEFAULTS = {
  sizes: { tiny: 0.15, small: 0.3, normal: 0.35, large: 0.15, huge: 0.05 },
  players: null,                    // [min, max] clamp, null = whatever fits the size
  mapTypes: null,                   // null = all
  modes: { score: 0.8, domination: 0.2 },
  turnLimits: [20, 25, 30, 35, 40],
  difficulties: { easy: 0.1, normal: 0.25, hard: 0.45, crazy: 0.2 },
  events: 0.85,
};

// returns { settings, difficulties } for Session / TT.newGame
function sample(seed, constraints) {
  const C = Object.assign({}, DEFAULTS, constraints || {});
  const R = rng(seed);
  let size = pickW(R, C.sizes);
  let opts = PLAYERS[size];
  if (C.players) opts = opts.filter(n => n >= C.players[0] && n <= C.players[1]);
  if (!opts.length) { size = 'normal'; opts = [Math.max(2, Math.min(5, C.players[0]))]; }
  const n = pick(R, opts);
  const mapType = pick(R, C.mapTypes || Object.keys(TT.MAP_TYPES));
  const mode = pickW(R, C.modes);
  const ids = TT.TRIBES.map(t => t.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; const t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
  const tribes = ids.slice(0, n);
  const difficulties = tribes.map(() => pickW(R, C.difficulties));
  const settings = { tribes, opponents: n - 1, size, mapType, mode, turnLimit: mode === 'score' ? pick(R, C.turnLimits) : 30,
    events: R() < C.events, fog: true, difficulty: 'hard', seed: 1 + ((R() * 2147483646) | 0) };
  return { settings, difficulties };
}

module.exports = { sample, rng, DEFAULTS, PLAYERS };
