// Loads the game's rules engine and bot into Node for the ML tools, and adds:
//  - a ruleset: POLY_RULES=polytopia (default; The Battle of Polytopia, see rulesets/polytopia.js) or tessera (the
//    browser game in src/ as is). One process runs one ruleset, so pick it before the first require.
//  - a seedable Math.random (the bot's only source of nondeterminism; the engine uses its own seeded st.rng)
//  - per-game action listeners that see every top-level action just before and just after it runs
'use strict';
const path = require('path');
const SRC = path.join(__dirname, '..', '..', 'src');
require(path.join(SRC, 'engine.js'));
const TT = globalThis.TT;
const RULES = process.env.POLY_RULES || 'polytopia';
if (RULES !== 'tessera') require(path.join(__dirname, 'rulesets', RULES + '.js'))(TT);
else TT.RULESET = { name: 'tessera', hasPower: true, verbs: null };

// mulberry32, same family as the engine's rand()
let rs = 0x9e3779b9;
function seedRandom(seed) { rs = (seed | 0) || 0x9e3779b9; }
Math.random = function () {
  rs = (rs + 0x6D2B79F5) | 0;
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// listener = { before(st, name, args) -> ctx, after(st, name, args, result, ctx) }
// Only top-level calls are reported: endTurn resolving leftover rewards is part of endTurn.
const listeners = new WeakMap();
let depth = 0;
TT.ACTIONS.forEach(name => {
  const fn = TT[name];
  TT[name] = function (st) {
    const L = depth === 0 && st ? listeners.get(st) : null;
    const args = Array.prototype.slice.call(arguments, 1);
    const ctx = L ? L.before(st, name, args) : null;
    depth++;
    let r;
    try { r = fn.apply(this, arguments); } finally { depth--; }
    if (L) L.after(st, name, args, r, ctx);
    return r;
  };
});

require(path.join(SRC, 'ai.js')); // after the ruleset: the bot sizes up units and techs when it loads

TT.ML = {
  rules: TT.RULESET.name,
  seedRandom,
  // one bot turn without ending it, plus whatever the ruleset asks bots to do on top (examine ruins in polytopia)
  botTurn(st) { TT.AI.playTurnSync(st); if (!st.over && TT.RULESET.afterBotTurn) TT.RULESET.afterBotTurn(st); },
  listen(st, l) { if (l) listeners.set(st, l); else listeners.delete(st); },
  clone(st) { return TT.deserialize(TT.serialize(st)); },
};
module.exports = TT;
