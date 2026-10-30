#!/usr/bin/env node
// PolyZero simulator server: one JSON request per line on stdin, one JSON reply per line on stdout.
// A process holds games by id and search states by handle. Python runs one process per self-play worker.
//
//   {"op":"spec"}                                  vocabularies and tensor layout (core.spec)
//   {"op":"new", "settings":{...}|"sample":{constraints}, "seed":n, "max_turns":50,
//    "seats":["net:a","bot:crazy",...] | "plan":{"main":"net:a", "main_seat":-1, "others":"bot:crazy"}}
//                                                  a seat is played by the caller's agent if its label starts with "net"
//                                                  (the rest names the agent), by the built-in bot otherwise. A plan
//                                                  puts `main` in one seat (-1: a random one, k: seat k mod players)
//                                                  and `others` everywhere else, once the player count is known.
//                                                  -> {gid, settings, seats, tribes, status, root?}
//   {"op":"bots", "gid"}                           bot seats play until a net seat is to move or the game ends -> {status}
//   {"op":"obs", "gid"}                            observation + legal actions of the player to move -> {obs, legal}
//   {"op":"root", "gid", "seed"}                   start a search at the current state -> {h, obs, legal}
//   {"op":"expand", "jobs":[[h, a], ...]}          child of handle h by its legal action #a, for each job
//                                                  -> {nodes:[{h, obs, legal, ended, over, result}]}
//   {"op":"free", "hs":[h, ...]}                   drop search states
//   {"op":"act", "gid", "q":[verb,src,dst,arg]}    play an action for real (end_turn: end the turn, then bots play)
//                                                  -> {ok, err, tuple, status}
//   {"op":"step", "free":[h...], "acts":[[gid, q, seed], ...], "jobs":[[h, a], ...]}
//                                                  all three in one round trip (what the Python driver uses); every
//                                                  act that leaves a net seat to move also opens the next search root
//                                                  -> {acts:[{ok, err, tuple, end, status, root?, result?}], nodes:[...]}
//   {"op":"result", "gid"}  {"op":"close", "gid"}  {"op":"ping"}
//
// Arrays travel as base64 little-endian buffers: obs.tiles (uint8, PAD*PAD*F), obs.glob (float32, G), legal (int16,
// 4 per action). A search never touches the real game: the root shares the game's state read-only, every child is a
// copy. Children get a fresh random seed, so ruins examined inside a search do not reveal what the real game's seed
// will give, and the view is frozen at the root (see core.js).
'use strict';
const readline = require('readline');
const TT = require('../../sim/tt');
const configs = require('../../sim/configs');
const C = require('./core');

const games = new Map();
const nodes = new Map();
let nextGid = 1, nextH = 1;

const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const obsOut = o => ({ tiles: b64(o.tiles), glob: b64(o.glob) });
function getGame(gid) { const g = games.get(gid); if (!g) throw new Error('no game ' + gid); return g; }
function getNode(h) { const n = nodes.get(h); if (!n) throw new Error('no node ' + h); return n; }

const isNet = s => s.slice(0, 3) === 'net';
function over(g) { return !!g.st.over || g.st.turn > g.maxTurns; }
function status(g) {
  const st = g.st;
  return { over: over(g), turn: st.turn, current: st.current, net_turn: !over(g) && isNet(g.seats[st.current]) };
}
function runBots(g) {
  let guard = 0;
  while (!over(g) && !isNet(g.seats[g.st.current]) && guard++ < 2000) {
    TT.ML.botTurn(g.st);
    if (!g.st.over) TT.endTurn(g.st);
  }
  return status(g);
}
function makeRoot(g, seed) {
  const st = g.st, pid = st.current;
  const view = Uint8Array.from(st.players[pid].explored);
  const legal = C.legal(st, pid, { view });
  const h = nextH++;
  nodes.set(h, { st, pid, view, legal, ended: false, seed: seed == null ? 1 : seed | 0 });
  return { h, pid, turn: st.turn, obs: obsOut(C.encode(st, pid, { view })), legal: b64(legal) };
}
function act(g, q, seed) {
  const st = g.st, pid = st.current;
  if (!isNet(g.seats[pid]) || over(g)) throw new Error('not a net turn');
  const r = C.apply(st, pid, q);
  let s;
  if (r.end) { TT.endTurn(st); s = runBots(g); } else s = status(g);
  const out = { ok: r.ok || r.end, err: r.err, tuple: r.tuple, end: r.end, status: s };
  if (s.net_turn) out.root = makeRoot(g, seed);
  if (s.over) out.result = C.result(st);
  return out;
}
function mix(a, b) { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35); h ^= h >>> 15; return h | 0; }

const ops = {
  ping: () => ({ pong: true, pid: process.pid }),
  spec: () => ({ spec: C.spec() }),
  new(m) {
    let settings = m.settings, difficulties = null;
    if (!settings) { const c = configs.sample(m.seed == null ? 1 : m.seed, m.sample); settings = c.settings; difficulties = c.difficulties; }
    const n = settings.tribes ? settings.tribes.length : (settings.opponents | 0) + 1;
    let seats;
    if (m.plan) {
      const k = m.plan.main_seat == null || m.plan.main_seat < 0 ? (configs.rng((settings.seed | 0) ^ 0x51ed)() * n) | 0 : m.plan.main_seat % n;
      seats = new Array(n).fill(m.plan.others || 'bot:hard');
      seats[k] = m.plan.main || 'net';
    } else {
      seats = (m.seats || ['net']).slice(0, n);
      while (seats.length < n) seats.push(difficulties ? 'bot:' + difficulties[seats.length] : 'bot:hard');
    }
    const humans = [];
    seats.forEach((s, i) => { if (isNet(s)) humans.push(i); });
    if (m.seed != null) TT.ML.seedRandom(m.seed ^ 0x2f6b);
    const st = TT.newGame(Object.assign({}, settings, { humans, spectate: false }));
    st.players.forEach((P, i) => { if (P.isAI) P.difficulty = seats[i].split(':')[1] || 'hard'; });
    const g = { st, seats, maxTurns: m.max_turns || (settings.mode === 'score' ? (settings.turnLimit || 30) + 1 : 50) };
    const gid = nextGid++;
    games.set(gid, g);
    const s = m.no_bots ? status(g) : runBots(g);
    const out = { gid, settings: st.settings, seats, tribes: st.players.map(P => P.tribe), status: s };
    if (s.net_turn && !m.no_bots) out.root = makeRoot(g, m.seed);
    if (s.over) out.result = C.result(st);
    return out;
  },
  bots: m => ({ status: runBots(getGame(m.gid)) }),
  obs(m) {
    const g = getGame(m.gid), pid = g.st.current;
    return { pid, obs: obsOut(C.encode(g.st, pid)), legal: b64(C.legal(g.st, pid)) };
  },
  root: m => makeRoot(getGame(m.gid), m.seed),
  expand: m => ({ nodes: expand(m.jobs) }),
  free(m) { for (const h of m.hs) nodes.delete(h); return { n: nodes.size }; },
  act: m => act(getGame(m.gid), m.q, m.seed),
  step(m) {
    for (const h of m.free || []) nodes.delete(h);
    const acts = (m.acts || []).map(([gid, q, seed]) => act(getGame(gid), q, seed));
    return { acts, nodes: expand(m.jobs || []), live: nodes.size };
  },
  result: m => ({ result: C.result(getGame(m.gid).st) }),
  close(m) { return { closed: games.delete(m.gid) }; },
};

function expand(jobs) {
  const out = [];
  for (const [h, a] of jobs) {
    const p = getNode(h), q = p.legal.subarray(4 * a, 4 * a + 4);
    if (q.length !== 4) throw new Error('no action ' + a + ' at node ' + h);
    const ch = nextH++;
    if (q[0] === C.V.end_turn) {
      nodes.set(ch, { st: p.st, pid: p.pid, view: p.view, legal: new Int16Array(0), ended: true, seed: p.seed });
      out.push({ h: ch, obs: obsOut(C.encode(p.st, p.pid, { view: p.view, ended: true })), legal: '', ended: true, over: false });
      continue;
    }
    const st = TT.ML.clone(p.st);
    st.rng = mix(p.seed, ch);
    const r = C.apply(st, p.pid, q);
    if (!r.ok) throw new Error('illegal action in search: ' + JSON.stringify(r.tuple) + ' ' + r.err);
    const done = !!st.over;
    const legal = done ? new Int16Array(0) : C.legal(st, p.pid, { view: p.view });
    nodes.set(ch, { st, pid: p.pid, view: p.view, legal, ended: false, seed: p.seed });
    const node = { h: ch, obs: obsOut(C.encode(st, p.pid, { view: p.view })), legal: b64(legal), ended: false, over: done };
    if (done) node.result = C.result(st);
    out.push(node);
  }
  return out;
}

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
