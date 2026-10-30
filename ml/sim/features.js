// Numeric state features for the long-horizon value model (ml/scripts/fit_value.py, polyrl/value.py).
// Full game state, not the seat's fogged view: the value model only scores states for the RL reward and never plays.
// FEATURE_NAMES is the contract with the Python side; append new features at the end.
'use strict';
const TT = require('./tt');

const FEATURE_NAMES = [
  'players', 'alive_players', 'turn', 'turn_limit', 'frac_elapsed', 'turns_left', 'domination', 'map_tiles',
  'alive', 'score', ...TT.SCORE_PARTS.map(p => 'score_' + p.key), 'stars', 'income', 'cities', 'city_levels', 'pop',
  'has_capital', 'units', 'unit_hp', 'techs', 'kills', 'losses',
  'rank', 'score_share', 'lead', 'max_other_score', 'max_other_cities', 'max_other_income', 'max_other_units',
  'sum_other_cities', 'sum_other_units', 'sum_other_income', 'city_share', 'unit_share',
];

// limit: the game's last turn (score mode: the turn limit; domination: the session's turn cap)
function features(st, pid, limit) {
  const S = st.settings, P = st.players[pid], n = st.players.length;
  const lim = S.mode === 'score' && S.turnLimit ? S.turnLimit : limit || 40;
  const per = st.players.map(Q => ({ id: Q.id, alive: Q.alive, score: Q.alive ? TT.score(st, Q.id) : 0, income: Q.alive ? TT.income(st, Q.id) : 0, cities: 0, units: 0 }));
  let levels = 0, pop = 0, capital = 0, hp = 0;
  for (const c of st.cities) {
    if (c.owner < 0 || !per[c.owner]) continue;
    per[c.owner].cities++;
    if (c.owner === pid) { levels += c.level; pop += c.pop || 0; if (c.capital) capital = 1; }
  }
  for (const u of st.units) {
    if (!per[u.owner]) continue;
    per[u.owner].units++;
    if (u.owner === pid) hp += u.hp;
  }
  const me = per[pid], others = per.filter(q => q.id !== pid && q.alive);
  const max = k => others.reduce((m, q) => Math.max(m, q[k]), 0);
  const sum = k => others.reduce((s, q) => s + q[k], 0);
  const b = P.alive ? TT.scoreBreakdown(st, pid) : {};
  const alive = per.filter(q => q.alive).length;
  const totScore = per.reduce((s, q) => s + q.score, 0);
  const rank = P.alive ? 1 + others.filter(q => q.score > me.score).length : n;
  return [
    n, alive, st.turn, lim, Math.min(1, st.turn / lim), Math.max(0, lim - st.turn), S.mode === 'domination' ? 1 : 0, st.W * st.H,
    P.alive ? 1 : 0, me.score, ...TT.SCORE_PARTS.map(p => b[p.key] || 0), P.alive ? P.stars : 0, me.income, me.cities, levels, pop,
    capital, me.units, hp, Object.keys(P.techs).length, P.kills || 0, P.losses || 0,
    rank, totScore > 0 ? me.score / totScore : 0, me.score - max('score'), max('score'), max('cities'), max('income'), max('units'),
    sum('cities'), sum('units'), sum('income'), me.cities / Math.max(1, me.cities + sum('cities')), me.units / Math.max(1, me.units + sum('units')),
  ];
}

module.exports = { FEATURE_NAMES, features };
