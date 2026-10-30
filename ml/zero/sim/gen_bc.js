#!/usr/bin/env node
// Warm-start data for PolyZero: the built-in bots play each other, and a sample of their atomic actions is recorded
// as (observation, legal actions, the bot's choice), plus the seat's final standing for the value target.
//
// The order of a bot's actions within a turn is mostly arbitrary (which unit moves first rarely matters), so the
// policy target is the bot's next action (half the mass) plus every action it still takes later that turn that is
// already legal now (the other half, shared equally). end_turn only counts when it is the next action.
//
// usage: node ml/zero/sim/gen_bc.js --games 800 --out runs/zero/bc --workers 4 [--seed 1] [--keep 0.12]
//        [--constraints '{"sizes":{"tiny":1,"small":1}}']
//
// Output: one shard per worker, <out>/bc-<w>.json (header) + <out>/bc-<w>.<array>.bin (raw little-endian arrays):
//   tiles  uint8   [n, PAD*PAD*F]   glob  float32 [n, G]     legal  int16 [total, 4]   loff  int32 [n + 1]
//   target int32   [n]   index of the bot's action in the sample's legal list
//   pi     float32 [total]   policy target, aligned with legal (see above)
//   out    float32 [n, 5]   final rank, players, final score, best rival final score, alive
//   info   int32   [n, 4]   game, seat, turn, difficulty (0 easy, 1 normal, 2 hard, 3 crazy)
'use strict';
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const TT = require('../../sim/tt');
const A = require('../../sim/actions');
const configs = require('../../sim/configs');
const C = require('./core');

const DIFFS = ['easy', 'normal', 'hard', 'crazy'];

function parseArgs(argv) {
  const a = { games: 100, out: 'runs/zero/bc', workers: 1, seed: 1, keep: 0.12, maxTurnsDomination: 50, constraints: null, worker: -1, first: 0, count: -1 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v = argv[i + 1];
    if (!(k in a)) throw new Error('unknown option ' + argv[i]);
    a[k] = k === 'out' ? v : k === 'constraints' ? JSON.parse(v) : Number(v);
    i++;
  }
  return a;
}

class Writer {
  constructor(file) { this.file = file; this.cols = { tiles: [], glob: [], legal: [], pi: [], target: [], out: [], info: [] }; this.loff = [0]; this.n = 0; }
  add(s) {
    const c = this.cols;
    c.tiles.push(Buffer.from(s.tiles.buffer)); c.glob.push(Buffer.from(s.glob.buffer)); c.legal.push(Buffer.from(s.legal.buffer)); c.pi.push(Buffer.from(s.pi.buffer));
    c.target.push(s.target); c.out.push.apply(c.out, s.out); c.info.push.apply(c.info, s.info);
    this.loff.push(this.loff[this.loff.length - 1] + s.legal.length / 4);
    this.n++;
  }
  close() {
    const c = this.cols, base = this.file;
    fs.writeFileSync(base + '.tiles.bin', Buffer.concat(c.tiles));
    fs.writeFileSync(base + '.glob.bin', Buffer.concat(c.glob));
    fs.writeFileSync(base + '.legal.bin', Buffer.concat(c.legal));
    fs.writeFileSync(base + '.pi.bin', Buffer.concat(c.pi));
    fs.writeFileSync(base + '.loff.bin', Buffer.from(Int32Array.from(this.loff).buffer));
    fs.writeFileSync(base + '.target.bin', Buffer.from(Int32Array.from(c.target).buffer));
    fs.writeFileSync(base + '.out.bin', Buffer.from(Float32Array.from(c.out).buffer));
    fs.writeFileSync(base + '.info.bin', Buffer.from(Int32Array.from(c.info).buffer));
    fs.writeFileSync(base + '.json', JSON.stringify({ n: this.n, actions: this.loff[this.n], pad: C.PAD, F: C.F, G: C.G, rules: TT.RULESET.name,
      arrays: { tiles: ['uint8', C.PAD * C.PAD * C.F], glob: ['float32', C.G], legal: ['int16', 4], pi: ['float32', 1], loff: ['int32', 1], target: ['int32', 1], out: ['float32', 5], info: ['int32', 4] } }));
  }
}

function playGame(g, a, wr) {
  const cfgSeed = (a.seed * 1000003 + g * 7919) | 0;
  const { settings, difficulties } = configs.sample(cfgSeed, a.constraints);
  TT.ML.seedRandom(cfgSeed ^ 0x5bd1e995);
  const st = TT.newGame(Object.assign({}, settings, { humans: [], spectate: false }));
  st.players.forEach((P, i) => { P.difficulty = difficulties[i]; });
  const R = configs.rng(cfgSeed ^ 0x2545f491), recs = [];
  let turnActs = [], turnKey = '';
  const maxTurns = settings.mode === 'score' ? settings.turnLimit : a.maxTurnsDomination;
  TT.ML.listen(st, {
    before(s, name, args) {
      const pid = s.current, key = pid + ':' + s.turn;
      if (key !== turnKey) { turnKey = key; turnActs = []; }
      const q = C.fromTuple(s, A.fromCommand(s, name, args));
      if (!q) return null;
      const ctx = { q, acts: turnActs, k: turnActs.length, rec: null };
      if (R() < a.keep) {
        const legal = C.legal(s, pid), target = C.indexOf(legal, q);
        if (target >= 0) { // (-1: ending the turn with a reward still pending, which the game then picks)
          const o = C.encode(s, pid);
          ctx.rec = { pid, turn: s.turn, tiles: o.tiles, glob: o.glob, legal, target };
        }
      }
      return ctx;
    },
    after(s, name, args, r, ctx) {
      if (!r || !ctx) return;
      ctx.acts.push(ctx.q);
      if (ctx.rec) { ctx.rec.acts = ctx.acts; ctx.rec.k = ctx.k; recs.push(ctx.rec); }
    },
  });
  while (!st.over && st.turn <= maxTurns) { TT.ML.botTurn(st); if (!st.over) TT.endTurn(st); }
  TT.ML.listen(st, null);
  for (const r of recs) {
    const pi = new Float32Array(r.legal.length / 4), later = new Set();
    for (const q of r.acts.slice(r.k + 1)) {
      const i = q[0] === C.V.end_turn ? -1 : C.indexOf(r.legal, q);
      if (i >= 0 && i !== r.target) later.add(i);
    }
    pi[r.target] = later.size ? 0.5 : 1;
    for (const i of later) pi[i] += 0.5 / later.size;
    r.pi = pi;
    delete r.acts;
  }
  const res = C.result(st);
  for (const r of recs) {
    const best = Math.max.apply(null, res.scores.filter((s, i) => i !== r.pid));
    r.out = [res.ranks[r.pid], res.n, res.scores[r.pid], best, res.alive[r.pid] ? 1 : 0];
    r.info = [g, r.pid, r.turn, DIFFS.indexOf(difficulties[r.pid])];
    wr.add(r);
  }
  return recs.length;
}

function runWorker(a) {
  fs.mkdirSync(a.out, { recursive: true });
  const wr = new Writer(path.join(a.out, 'bc-' + a.worker));
  let n = 0;
  const last = a.count < 0 ? a.games : a.first + a.count;
  for (let g = a.first; g < last; g++) n += playGame(g, a, wr);
  wr.close();
  return n;
}

function main() {
  const a = parseArgs(process.argv);
  if (a.worker >= 0) { const n = runWorker(a); process.send ? process.send({ n }) : console.log(n); return; }
  const t0 = Date.now(), W = Math.max(1, a.workers), per = Math.ceil(a.games / W);
  let done = 0, total = 0;
  for (let w = 0; w < W; w++) {
    const first = w * per, count = Math.max(0, Math.min(per, a.games - first));
    const args = process.argv.slice(2).concat(['--worker', String(w), '--first', String(first), '--count', String(count)]);
    const ch = fork(__filename, args);
    ch.on('message', m => { total += m.n; });
    ch.on('exit', code => {
      if (code) { console.error('worker ' + w + ' failed'); process.exitCode = 1; }
      if (++done === W) console.log(JSON.stringify({ games: a.games, samples: total, seconds: (Date.now() - t0) / 1000, out: a.out }));
    });
  }
}

main();
