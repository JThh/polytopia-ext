// Observations in two steps, so the same model input can come from the simulator or from a real Polytopia game:
//
//   snapshot(st, pid, hist)  simulator state -> PolyState: plain JSON of what one player knows at the start of its
//                            turn (ml/bridge/README.md documents every field; a real-game bridge emits the same)
//   render(polystate)        PolyState -> prompt text
//
// Only what the player could see is included: explored tiles (fog of war), visible units (stealth respected), the
// public scoreboard (tribe names only once met), and rivals' actions that happened in view (history.js).
//
// Prompt layout (the model's answer follows the final "actions:" line):
//   goal       decision-transformer conditioning: the final rank and score this trajectory reaches
//   game       ruleset, turn, mode, map, players
//   me         stars, income, (power), score, rank, kills; score_parts; techs
//   rivals     public scoreboard
//   board      one line per row, run-length encoded: "x0-x1" + terrain letter + owner digit
//   features   resources, improvements, roads, ruins, (storm)
//   cities     mine in detail, other known cities briefly
//   units      mine in detail, visible enemies
//   history    my last turns' actions, rivals' actions I saw since then
'use strict';
const TT = require('./tt');
const A = require('./actions');

const HEADER = '<polytopia v1>';
const TERRAIN = ['ocean', 'shallow', 'field', 'forest', 'mountain'];          // engine terrain index -> PolyState name
const LETTER = { ocean: 'w', shallow: 's', field: 'p', forest: 'f', mountain: 'm' }; // PolyState name -> board letter

function scoreRank(st, pid) {
  const me = TT.score(st, pid);
  const alive = st.players.filter(P => P.alive);
  return { score: me, rank: alive.filter(Q => TT.score(st, Q.id) > me).length + 1, of: alive.length };
}

function known(st, viewer, pid) {
  if (pid === viewer) return true;
  const P = st.players[viewer], W = st.W;
  return st.cities.some(c => c.owner === pid && P.explored[c.y * W + c.x]) || st.units.some(u => u.owner === pid && P.explored[u.y * W + u.x]);
}

// ---------------------------------------------------------------- simulator -> PolyState
function snapshot(st, pid, hist, opts) {
  opts = opts || {};
  const P = st.players[pid], S = st.settings, W = st.W, sr = scoreRank(st, pid), b = TT.scoreBreakdown(st, pid);
  const parts = {};
  for (const p of TT.SCORE_PARTS) parts[p.key] = b[p.key];
  const tiles = [];
  for (let y = 0; y < st.H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      const i = y * W + x, tl = st.tiles[i];
      row.push(P.explored[i] ? { terrain: TERRAIN[tl.t], owner: tl.owner, resource: tl.res && !tl.imp ? tl.res : null, improvement: tl.imp || null, road: !!(tl.road && tl.site < 0), ruin: !!tl.ruin } : null);
    }
    tiles.push(row);
  }
  const cities = [];
  for (const c of st.cities) {
    if (c.owner === pid) cities.push({ id: c.id, x: c.x, y: c.y, owner: pid, capital: !!c.capital, level: c.level, pop: c.pop, units: TT.cityUnits(st, c), unit_cap: TT.cityCap(c),
      radius: c.radius, walls: !!c.walls, workshop: c.workshop, parks: c.parks, trade: c.prod || 0, pending: c.pending.slice() });
    else if (P.explored[c.y * W + c.x]) cities.push({ id: c.id, x: c.x, y: c.y, owner: c.owner, capital: !!c.capital, level: c.level, walls: !!c.walls });
  }
  const units = [];
  for (const u of st.units) {
    if (u.owner !== pid && !TT.visibleTo(st, u, pid)) continue;
    const o = { id: u.id, type: u.type, owner: u.owner, x: u.x, y: u.y, hp: u.hp, max_hp: TT.stats(st, u).maxHp, naval: u.naval || null, veteran: !!u.vet };
    if (u.owner === pid) Object.assign(o, { home: u.home, kills: u.kills, frozen: !!(u.frozen || !u.canMove), slow: !!u.slow });
    units.push(o);
  }
  const nTurns = opts.histTurns == null ? 2 : opts.histTurns;
  const history = hist && nTurns > 0 ? hist.turnsSeenBy(pid, Math.max(1, st.turn - nTurns)).filter(g => g.pid === pid ? g.turn < st.turn : g.actions.length) : null;
  return {
    version: 1, rules: TT.RULESET.name, turn: st.turn, turn_limit: S.mode === 'score' ? S.turnLimit : null, mode: S.mode, map_type: S.mapType,
    width: W, height: st.H, players: st.players.length, events: !!S.events,
    me: { id: pid, tribe: TT.tribe(P.tribe).name, stars: P.stars, income: TT.income(st, pid), power: TT.RULESET.hasPower ? P.power : null, power_cost: TT.RULESET.hasPower ? TT.POWER_COST : null,
      score: sr.score, rank: sr.rank, alive_players: sr.of, kills: P.kills, losses: P.losses, embassy: !!P.embassy,
      techs: Object.keys(P.techs).sort((a, c) => TT.TECH_ORDER.indexOf(a) - TT.TECH_ORDER.indexOf(c)), score_parts: parts },
    rivals: st.players.filter(Q => Q.id !== pid).map(Q => ({ id: Q.id, tribe: known(st, pid, Q.id) ? TT.tribe(Q.tribe).name : null, alive: Q.alive, score: Q.alive ? TT.score(st, Q.id) : 0 })),
    tiles, cities, units,
    storm: st.storm && P.explored[st.storm.y * W + st.storm.x] ? { x: st.storm.x, y: st.storm.y, dx: st.storm.dx, dy: st.storm.dy, turns_left: st.storm.life } : null,
    history,
    goal: opts.goal || null,
  };
}

// ---------------------------------------------------------------- PolyState -> text
const xy = (x, y) => '(' + x + ',' + y + ')';

function boardLines(s) {
  const out = [];
  for (let y = 0; y < s.height; y++) {
    const runs = [], row = s.tiles[y];
    let x0 = 0, key = null;
    const flush = x1 => runs.push((x0 === x1 ? String(x0) : x0 + '-' + x1) + key);
    for (let x = 0; x < s.width; x++) {
      const t = row[x];
      const k = t ? LETTER[t.terrain] + (t.owner >= 0 ? t.owner : '') : '?';
      if (k !== key) { if (key !== null) flush(x - 1); key = k; x0 = x; }
    }
    flush(s.width - 1);
    out.push('y' + y + ': ' + runs.join(' '));
  }
  return out;
}

function featureLines(s) {
  const res = {}, imp = {}, roads = [], ruins = [];
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const t = s.tiles[y][x];
    if (!t) continue;
    if (t.resource) (res[t.resource] || (res[t.resource] = [])).push(xy(x, y));
    if (t.improvement) (imp[t.improvement] || (imp[t.improvement] = [])).push(xy(x, y));
    if (t.road) roads.push(xy(x, y));
    if (t.ruin) ruins.push(xy(x, y));
  }
  const group = o => Object.keys(o).map(k => k + ' ' + o[k].join(' ')).join(' | ') || 'none';
  const out = ['resources: ' + group(res), 'improvements: ' + group(imp)];
  if (roads.length) out.push('roads: ' + roads.join(' '));
  if (ruins.length) out.push('ruins: ' + ruins.join(' '));
  if (s.storm) out.push('storm: ' + xy(s.storm.x, s.storm.y) + ' heading ' + xy(s.storm.dx, s.storm.dy) + ' turns_left=' + s.storm.turns_left);
  return out;
}

function cityLines(s) {
  const mine = [], other = [];
  for (const c of s.cities) {
    if (c.owner === s.me.id) {
      let t = A.cityRef(c.id) + ' ' + xy(c.x, c.y) + (c.capital ? ' capital' : '') + ' level=' + c.level + ' pop=' + c.pop + '/' + (c.level + 1) +
        ' units=' + c.units + '/' + c.unit_cap + ' radius=' + c.radius;
      if (c.walls) t += ' walls';
      if (c.workshop) t += ' workshop=' + c.workshop;
      if (c.parks) t += ' parks=' + c.parks;
      if (c.trade) t += ' trade=' + c.trade;
      if (c.pending && c.pending.length) t += ' reward_pending=' + c.pending.join(',');
      mine.push(' ' + t);
    } else other.push(' ' + A.cityRef(c.id) + ' ' + xy(c.x, c.y) + (c.owner < 0 ? ' village' : ' P' + c.owner + (c.capital ? ' capital' : '') + ' level=' + c.level + (c.walls ? ' walls' : '')));
  }
  return ['my cities:'].concat(mine.length ? mine : [' none'], ['other cities:'], other.length ? other : [' none']);
}

function unitLines(s) {
  const mine = [], foe = [];
  for (const u of s.units) {
    let t = u.type + '#' + u.id + ' ' + xy(u.x, u.y) + ' hp=' + u.hp + '/' + u.max_hp;
    if (u.naval) t += ' ' + u.naval;
    if (u.veteran) t += ' veteran';
    if (u.owner === s.me.id) {
      if (u.home >= 0) t += ' home=' + A.cityRef(u.home);
      if (u.kills) t += ' kills=' + u.kills;
      if (u.frozen) t += ' frozen';
      if (u.slow) t += ' slow';
      mine.push(' ' + t);
    } else foe.push(' P' + u.owner + ' ' + t);
  }
  return ['my units:'].concat(mine.length ? mine : [' none'], ['enemy units:'], foe.length ? foe : [' none']);
}

function historyLines(s, cap) {
  if (!s.history) return [];
  if (!s.history.length) return ['history: none'];
  const out = ['history:'];
  for (const g of s.history) {
    let acts = g.actions, more = '';
    if (acts.length > cap) { more = ' (+' + (acts.length - cap) + ' earlier)'; acts = acts.slice(-cap); }
    out.push(' ' + (g.pid === s.me.id ? 'me' : 'P' + g.pid) + ' turn ' + g.turn + more + ': ' + A.formatInline(acts));
  }
  return out;
}

// goal = { rank, score }: the final rank and final score to aim for (decision-transformer return-to-go)
const goalLine = (goal, score) => 'goal: final_rank=' + goal.rank + ' final_score=' + goal.score + ' score_to_go=' + (goal.score - score);
// add a goal line to a prompt made without one (training data is relabelled once the game's outcome is known)
const withGoal = (prompt, goal, score) => prompt.replace(HEADER + '\n', HEADER + '\n' + goalLine(goal, score) + '\n');

function render(s, opts) {
  opts = opts || {};
  const me = s.me, lines = [HEADER];
  if (s.goal) lines.push(goalLine(s.goal, me.score));
  lines.push('game: rules=' + s.rules + ' turn=' + s.turn + (s.turn_limit ? ' of ' + s.turn_limit : '') + ' mode=' + s.mode + ' map=' + s.map_type + ' size=' + s.width + 'x' + s.height +
    ' players=' + s.players + ' events=' + (s.events ? 'on' : 'off'));
  lines.push('me: P' + me.id + ' tribe=' + me.tribe + ' stars=' + me.stars + ' income=' + me.income + (me.power != null ? ' power=' + me.power + '/' + me.power_cost : '') +
    ' score=' + me.score + ' rank=' + me.rank + '/' + me.alive_players + ' kills=' + me.kills + ' losses=' + me.losses + (me.embassy ? ' embassy' : ''));
  lines.push('score_parts: ' + Object.keys(me.score_parts).map(k => k + '=' + me.score_parts[k]).join(' '));
  lines.push('techs: ' + (me.techs.join(' ') || 'none'));
  lines.push('rivals: ' + s.rivals.map(r => 'P' + r.id + ' ' + (r.tribe || '?') + (r.alive ? ' score=' + r.score : ' fallen')).join(' | '));
  lines.push('board: rows y=0..' + (s.height - 1) + ', runs x0-x1 + terrain (w deep water, s shallow, p field, f forest, m mountain, ? unexplored) + owner');
  lines.push.apply(lines, boardLines(s));
  lines.push.apply(lines, featureLines(s));
  lines.push.apply(lines, cityLines(s));
  lines.push.apply(lines, unitLines(s));
  lines.push.apply(lines, historyLines(s, opts.histCap || 40));
  lines.push('actions:');
  return lines.join('\n') + '\n';
}

function observe(st, pid, hist, opts) {
  opts = opts || {};
  const s = snapshot(st, pid, hist, opts);
  return { prompt: render(s, opts), state: s, meta: { turn: st.turn, pid, score: s.me.score, rank: s.me.rank, stars: s.me.stars, income: s.me.income } };
}

module.exports = { observe, snapshot, render, scoreRank, goalLine, withGoal, HEADER };
