// Return-to-go targets for decision-transformer conditioning.
// Training prompts carry the score and rank the trajectory actually reached (hindsight relabelling). At play time
// the model is asked for a strong result instead: rank 1 and a high final score for this kind of game, taken from
// the winners' scores in the generated dataset (targets.json, written by gen_sft.js) with a fallback formula.
'use strict';
const fs = require('fs');
const path = require('path');

let table = null;
function load(file) {
  file = file || process.env.POLY_TARGETS || path.join(__dirname, '..', 'data', 'sft', 'targets.json');
  try { table = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { table = {}; }
  return table;
}

const keys = (mode, W, n, limit) => [mode + '|' + W + '|' + n + '|' + limit, mode + '|' + W + '|' + n, mode + '|' + W, mode];

// target final score for a winner of this kind of game
function targetScore(settings, W, nPlayers) {
  if (!table) load();
  const limit = settings.mode === 'score' ? settings.turnLimit : 0;
  for (const k of keys(settings.mode, W, nPlayers, limit)) if (table[k]) return table[k].q90;
  const turns = settings.mode === 'score' ? settings.turnLimit : 30;
  const perTurn = globalThis.TT && globalThis.TT.RULESET && globalThis.TT.RULESET.name === 'tessera' ? 190 : 330; // winners' pace in bot games
  return Math.round(perTurn * turns * Math.sqrt(W / 16) / 10) * 10;
}

function goal(st, pid, boost) {
  const TT = globalThis.TT;
  const now = st.players[pid].alive ? TT.score(st, pid) : 0;
  const t = Math.round(targetScore(st.settings, st.W, st.players.length) * (boost || 1));
  return { rank: 1, score: Math.max(t, now + 50) };
}

// quantile table from finished games: rows = [{ mode, W, n, limit, score, rank }]
function build(rows) {
  const groups = {};
  for (const r of rows) if (r.rank === 1) for (const k of keys(r.mode, r.W, r.n, r.mode === 'score' ? r.limit : 0)) (groups[k] || (groups[k] = [])).push(r.score);
  const out = {};
  for (const k of Object.keys(groups)) {
    const v = groups[k].sort((a, b) => a - b);
    if (v.length < 5) continue;
    const q = f => v[Math.min(v.length - 1, Math.floor(f * v.length))];
    out[k] = { n: v.length, q50: q(0.5), q90: q(0.9), max: v[v.length - 1] };
  }
  return out;
}

module.exports = { load, goal, targetScore, build };
