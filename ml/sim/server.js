#!/usr/bin/env node
// Simulator server for the Python trainer: one JSON request per line on stdin, one JSON reply per line on stdout.
// A process holds any number of games (Sessions) by id; run several processes for parallel rollouts.
//
//   {"op":"new", "settings":{...}} | {"op":"new", "sample":{constraints}, "seed":n}
//        optional: "model_seats":[0], "difficulties":[...], "hist_turns":2, "max_turns":60, "random_model_seat":true
//                                         -> {gid, settings, difficulties, model_seats, status}
//   {"op":"advance", "gid"}               bots play until a model seat is to move or the game ends -> {status}
//   {"op":"observe", "gid", "boost":1.0}  prompt for the player to move, goal = strong-play target -> {prompt, meta, goal}
//   {"op":"evaluate", "gid", "plans":[text...], "horizon":1, "seed":n}
//                                         score each plan on its own copy of the game -> {results:[...]}
//   {"op":"step", "gid", "plan":text}     play the plan for real, then advance -> {report, status}
//   {"op":"result", "gid"}  {"op":"close", "gid"}  {"op":"spec"}  {"op":"ping"}
// Real-game bridge (see ml/bridge/README.md):
//   {"op":"render", "state":PolyState, "goal":{rank,score}}  -> {prompt}
//   {"op":"compile", "text"}              model output -> {actions:[tuple], commands:[PolyCommand], complete, error}
//   {"op":"snapshot"|"exec"|"end_turn", "gid", ...}  the simulator behind the same bridge interface (tests, demos)
'use strict';
const readline = require('readline');
const TT = require('./tt');
const A = require('./actions');
const configs = require('./configs');
const targets = require('./targets');
const { Session } = require('./session');
const { render, snapshot } = require('./observe');

const games = new Map();
let nextId = 1;

function get(gid) { const s = games.get(gid); if (!s) throw new Error('no game ' + gid); return s; }

const ops = {
  ping: () => ({ pong: true, pid: process.pid }),
  spec: () => A.spec(),
  targets: m => ({ table: targets.load(m.file) }),
  new(m) {
    let settings = m.settings, difficulties = m.difficulties;
    if (!settings) { const c = configs.sample(m.seed || ((Math.random() * 2147483647) | 0), m.sample); settings = c.settings; difficulties = difficulties || c.difficulties; }
    const n = (settings.tribes ? settings.tribes.length : (settings.opponents | 0) + 1);
    let seats = m.model_seats || [0];
    if (m.random_model_seat) seats = [configs.rng(settings.seed ^ 0x51ed)() * n | 0];
    if (m.seed != null) TT.ML.seedRandom(m.seed);
    const s = new Session(settings, { modelSeats: seats, difficulties, histTurns: m.hist_turns, histCap: m.hist_cap, maxTurns: m.max_turns });
    const gid = nextId++;
    games.set(gid, s);
    return { gid, settings: s.st.settings, difficulties: s.st.players.map(P => P.difficulty), tribes: s.st.players.map(P => P.tribe), model_seats: seats, status: s.advance() };
  },
  advance: m => ({ status: get(m.gid).advance() }),
  observe(m) {
    const s = get(m.gid), pid = s.st.current;
    const goal = m.goal || s.goalFor(pid, m.boost);
    const o = s.observe(pid, goal);
    return { prompt: o.prompt, meta: o.meta, goal };
  },
  evaluate(m) {
    const s = get(m.gid);
    if (!s.status().modelTurn) throw new Error('not a model turn');
    return { results: s.evaluate(m.plans, m.horizon == null ? 1 : m.horizon, m.seed == null ? 12345 : m.seed) };
  },
  step(m) {
    const s = get(m.gid);
    if (!s.status().modelTurn) throw new Error('not a model turn');
    if (m.seed != null) TT.ML.seedRandom(m.seed);
    const pid = s.st.current, before = s.metrics(pid);
    const report = s.applyPlan(m.plan);
    const status = s.advance();
    return { report, before, after: s.metrics(pid), status };
  },
  // what the built-in bot would play now (on a copy): a baseline, and an optional teacher sample for RL groups
  botplan(m) {
    const b = get(m.gid).clone(), pid = b.st.current, i0 = b.hist.entries.length;
    if (m.difficulty) b.st.players[pid].difficulty = m.difficulty;
    TT.ML.seedRandom(m.seed == null ? 777 : m.seed);
    TT.ML.botTurn(b.st);
    const acts = b.hist.entries.slice(i0).filter(e => e.pid === pid).map(e => e.t);
    acts.push(A.END.slice());
    return { plan: A.formatList(acts) };
  },
  metrics: m => { const s = get(m.gid); return { metrics: s.st.players.map(P => s.metrics(P.id)) }; },
  // ---- real-game bridge (ml/bridge): PolyState in, PolyCommands out
  render: m => ({ prompt: render(Object.assign({}, m.state, m.goal ? { goal: m.goal } : {}), { histCap: m.hist_cap }) }),
  // strong-play goal for a game described by PolyState fields (what the model is asked to reach)
  target: m => ({ goal: { rank: 1, score: Math.round(targets.targetScore({ mode: m.mode, turnLimit: m.turn_limit }, m.width, m.players) * (m.boost || 1)) } }),
  compile(m) {
    const p = A.parse(m.text);
    return { actions: p.actions, commands: p.actions.map(A.toCommand), complete: p.complete, error: p.error };
  },
  // the simulator posing as a real-game bridge: PolyState of the player to move, one PolyCommand at a time
  snapshot(m) {
    const s = get(m.gid), pid = s.st.current;
    return { state: snapshot(s.st, pid, m.history === false ? null : s.hist, { histTurns: s.opts.histTurns, goal: m.goal || null }) };
  },
  exec(m) {
    const s = get(m.gid), t = A.fromPolyCommand(m.command);
    if (!t) return { result: { ok: false, err: 'unknown_command' } };
    const r = A.execute(s.st, s.st.current, t);
    return { result: { ok: r.ok, err: r.err, end: r.end } };
  },
  end_turn(m) {
    const s = get(m.gid);
    if (!s.st.over) TT.endTurn(s.st);
    return { status: s.advance() };
  },
  result: m => get(m.gid).result(),
  replay: m => ({ state: TT.serialize(get(m.gid).st) }),
  close: m => ({ closed: games.delete(m.gid) }),
};

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (!line.trim()) return;
  let m, reply;
  try {
    m = JSON.parse(line);
    const fn = ops[m.op];
    if (!fn) throw new Error('unknown op ' + m.op);
    reply = Object.assign({ ok: true, id: m.id }, fn(m));
  } catch (e) {
    reply = { ok: false, id: m && m.id, error: String(e && e.stack || e) };
  }
  process.stdout.write(JSON.stringify(reply) + '\n');
});
rl.on('close', () => process.exit(0));
