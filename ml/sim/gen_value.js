#!/usr/bin/env node
// Training data for the long-horizon value model: bots play games drawn from the RL curriculum and the eval setup, and
// every seat's turn-start state is recorded as features (features.js) with how that seat's game finally ended.
// Seats are perturbed so the model also sees what weak play leads to: some seats pass whole turns (a per-seat rate of
// 0, 0.15 or 0.4) and any turn is played as the easy bot with probability --p-easy. Without this the data has almost no
// passive turns, because the bots always spend their stars.
//
// usage: node ml/sim/gen_value.js --games 2400 --workers 8 --out runs/value/data [--seed 7]
//        [--constraints '[{"sizes":{"small":1}}, ...]'] (one entry per setup, cycled over games)
'use strict';
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const configs = require('./configs');
const { Session } = require('./session');
const { features, FEATURE_NAMES } = require('./features');
const TT = require('./tt');

const EMPTY = '[("tribe", "end_turn")]';
// the RL curriculum stages of ml/configs/rl_longterm_v4.yaml and the eval sample of ml/configs/eval.yaml
const SETUPS = [
  { sample: { sizes: { tiny: 1, small: 1 }, players: [2, 3], difficulties: { easy: 1, normal: 1 }, modes: { score: 1 }, turnLimits: [15, 20] } },
  { sample: { sizes: { small: 1, normal: 1 }, players: [2, 4], difficulties: { normal: 1, hard: 1 }, modes: { score: 1 }, turnLimits: [20, 25, 30] } },
  { sample: { sizes: { small: 1, normal: 2, large: 1 }, players: [2, 6], difficulties: { hard: 2, crazy: 1 }, modes: { score: 4, domination: 1 }, turnLimits: [25, 30, 35] }, maxTurns: 40 },
  { sample: { sizes: { small: 1, normal: 2, large: 1 }, players: [2, 5], difficulties: { hard: 2, crazy: 1 }, modes: { score: 1 }, turnLimits: [30] }, maxTurns: 40 },
];

function parseArgs(argv) {
  const a = { games: 200, workers: 1, out: 'runs/value/data', seed: 7, pEasy: 0.08, constraints: null, worker: -1 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v = argv[i + 1];
    if (!(k in a)) throw new Error('unknown option ' + argv[i]);
    a[k] = k === 'out' ? v : k === 'constraints' ? JSON.parse(v) : Number(v);
    i++;
  }
  return a;
}

function playGame(g, a, setups) {
  const cfgSeed = (a.seed * 1000003 + g * 7919) | 0, setup = setups[g % setups.length];
  const { settings, difficulties } = configs.sample(cfgSeed, setup.sample);
  const R = configs.rng(cfgSeed ^ 0x51ed270b);
  TT.ML.seedRandom(cfgSeed ^ 0x5bd1e995);
  const limit = setup.maxTurns || 40;
  const sess = new Session(settings, { modelSeats: [], difficulties, maxTurns: settings.mode === 'score' ? settings.turnLimit + 1 : limit });
  const st = sess.st, n = st.players.length;
  const lazy = st.players.map(() => { const r = R(); return r < 0.7 ? 0 : r < 0.9 ? 0.15 : 0.4; });
  const recs = [];
  let guard = 0;
  while (!sess.over && guard++ < 5000) {
    const pid = st.current;
    if (!st.players[pid].alive) { sess.botTurn(); continue; }
    const r = R();
    const pert = r < lazy[pid] ? 'empty' : r < lazy[pid] + a.pEasy ? 'easy' : '';
    recs.push({ pid, turn: st.turn, f: features(st, pid, limit), pert });
    if (pert === 'empty') sess.applyPlan(EMPTY);
    else if (pert === 'easy') {
      const P = st.players[pid], d = P.difficulty;
      P.difficulty = 'easy';
      sess.botTurn();
      P.difficulty = d;
    } else sess.botTurn();
  }
  const res = sess.result();
  return recs.map(x => ({ g, ...x, setup: g % setups.length, n, lazy: lazy[x.pid], won: res.winner === x.pid ? 1 : 0, rank: res.ranks[x.pid],
    alive: res.alive[x.pid] ? 1 : 0, score: res.scores[x.pid], end_turn: res.turn }));
}

function runWorker(a) {
  const setups = a.constraints || SETUPS;
  const file = path.join(a.out, 'shard-' + a.worker + '.jsonl');
  const fd = fs.openSync(file, 'w');
  let rows = 0, games = 0;
  for (let g = a.worker; g < a.games; g += a.workers) {
    for (const rec of playGame(g, a, setups)) { fs.writeSync(fd, JSON.stringify(rec) + '\n'); rows++; }
    games++;
  }
  fs.closeSync(fd);
  return { rows, games };
}

function main() {
  const a = parseArgs(process.argv);
  fs.mkdirSync(a.out, { recursive: true });
  if (a.worker >= 0) { const r = runWorker(a); process.send ? process.send({ done: r }) : console.log(JSON.stringify(r)); return; }
  fs.writeFileSync(path.join(a.out, 'features.json'), JSON.stringify({ names: FEATURE_NAMES, setups: a.constraints || SETUPS, args: a }, null, 1));
  const t0 = Date.now();
  if (a.workers <= 1) { a.worker = 0; a.workers = 1; console.log(JSON.stringify(runWorker(a)), 'secs', (Date.now() - t0) / 1000); return; }
  let done = 0, rows = 0, games = 0;
  for (let w = 0; w < a.workers; w++) {
    const ch = fork(__filename, process.argv.slice(2).concat(['--worker', String(w)]), { stdio: 'inherit' });
    ch.on('message', m => {
      if (!m.done) return;
      rows += m.done.rows; games += m.done.games;
      if (++done === a.workers) console.log(JSON.stringify({ rows, games }), 'secs', (Date.now() - t0) / 1000);
    });
    ch.on('exit', code => { if (code) { console.error('worker', w, 'failed with code', code); process.exitCode = 1; } });
  }
}

main();
