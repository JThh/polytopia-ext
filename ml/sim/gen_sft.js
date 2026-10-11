#!/usr/bin/env node
// Builds the SFT dataset: bots play each other in randomly configured games (every map type and size, 2-6 tribes,
// both modes, mixed difficulties, storms on/off). Every turn of every seat becomes one sample:
//   prompt     = the seat's observation at the start of its turn (observe.js), with a goal line added after the game:
//                the final rank and score this seat actually reached (decision-transformer hindsight relabelling)
//   completion = the seat's actions that turn as a tuple list (actions.js), ending with ("tribe", "end_turn")
// Samples are kept with a probability that favours strong play (hard/crazy bots, high final rank) so the set stays
// compact; weaker trajectories are kept at a lower rate because their goal lines teach what low returns look like.
//
// usage: node ml/sim/gen_sft.js --games 3000 --out ml/data/sft --workers 8 [--seed 1] [--keep 1] [--val-every 40]
//        [--hist-turns 2] [--max-prompt-chars 14000] [--constraints '{"sizes":{"small":1}}']
'use strict';
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const TT = require('./tt');
const A = require('./actions');
const configs = require('./configs');
const targets = require('./targets');
const { Session } = require('./session');
const { observe, withGoal } = require('./observe');

function parseArgs(argv) {
  const a = { games: 200, out: path.join(__dirname, '..', 'data', 'sft'), workers: 1, seed: 1, keep: 1, valEvery: 40, histTurns: 2, histCap: 40,
    maxPromptChars: 14000, maxTurnsDomination: 50, constraints: null, worker: -1 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v = argv[i + 1];
    if (!(k in a)) throw new Error('unknown option ' + argv[i]);
    a[k] = k === 'out' ? v : k === 'constraints' ? JSON.parse(v) : Number(v);
    i++;
  }
  return a;
}

const DIFF_W = { easy: 0.3, normal: 0.6, hard: 1, crazy: 1 };
function keepProb(rank, n, alive, difficulty, trivial) {
  let p = DIFF_W[difficulty] || 0.5;
  if (rank !== 1) p *= !alive ? 0.15 : rank <= Math.ceil(n / 2) ? 0.6 : 0.35;
  if (trivial) p *= 0.3;
  return p;
}

function playGame(g, a) {
  const cfgSeed = (a.seed * 1000003 + g * 7919) | 0;
  const { settings, difficulties } = configs.sample(cfgSeed, a.constraints);
  TT.ML.seedRandom(cfgSeed ^ 0x5bd1e995);
  const sess = new Session(settings, { modelSeats: [], difficulties, histTurns: a.histTurns, histCap: a.histCap,
    maxTurns: settings.mode === 'score' ? settings.turnLimit + 1 : a.maxTurnsDomination });
  const st = sess.st, recs = [];
  while (!sess.over) {
    const pid = st.current, turn = st.turn;
    const obs = observe(st, pid, sess.hist, { histTurns: a.histTurns, histCap: a.histCap });
    const i0 = sess.hist.entries.length;
    sess.botTurn();
    const acts = sess.hist.entries.slice(i0).filter(e => e.pid === pid && e.turn === turn).map(e => e.t);
    if (!acts.length || acts[acts.length - 1][1] !== 'end_turn') acts.push(A.END.slice());
    recs.push({ pid, turn, prompt: obs.prompt, score: obs.meta.score, acts });
  }
  const res = sess.result();
  const R = configs.rng(cfgSeed ^ 0x2545f491);
  const split = g % a.valEvery === 0 ? 'val' : 'train';
  const samples = [];
  let skippedLong = 0;
  for (const r of recs) {
    const rank = res.ranks[r.pid], fscore = res.scores[r.pid], diff = difficulties[r.pid];
    const trivial = r.acts.length === 1;
    if (R() >= keepProb(rank, res.n, res.alive[r.pid], diff, trivial) * a.keep) continue;
    const prompt = withGoal(r.prompt, { rank, score: fscore }, r.score);
    if (prompt.length > a.maxPromptChars) { skippedLong++; continue; }
    samples.push({ prompt, completion: A.formatList(r.acts), meta: { game: g, seat: r.pid, turn: r.turn, tribe: res.tribes[r.pid], difficulty: diff, final_rank: rank,
      final_score: fscore, players: res.n, size: settings.size, map: settings.mapType, mode: settings.mode, n_actions: r.acts.length } });
  }
  const outcome = { mode: settings.mode, W: st.W, n: res.n, limit: settings.turnLimit, turns: res.turn, reason: res.reason,
    seats: res.scores.map((s, i) => ({ score: s, rank: res.ranks[i], difficulty: difficulties[i], tribe: res.tribes[i] })) };
  return { split, samples, outcome, skippedLong, turns: recs.length };
}

function runWorker(a) {
  const files = { train: path.join(a.out, 'shard-' + a.worker + '-train.jsonl'), val: path.join(a.out, 'shard-' + a.worker + '-val.jsonl') };
  const fd = { train: fs.openSync(files.train, 'w'), val: fs.openSync(files.val, 'w') };
  const outcomes = [];
  let skippedLong = 0, seatTurns = 0;
  for (let g = a.worker; g < a.games; g += a.workers) {
    const r = playGame(g, a);
    for (const s of r.samples) fs.writeSync(fd[r.split], JSON.stringify(s) + '\n');
    outcomes.push(r.outcome); skippedLong += r.skippedLong; seatTurns += r.turns;
    if (process.send && (g / a.workers | 0) % 10 === 0) process.send({ progress: 1 });
  }
  fs.closeSync(fd.train); fs.closeSync(fd.val);
  return { outcomes, skippedLong, seatTurns, files };
}

function summarize(a, parts) {
  const stats = { games: a.games, seatTurns: 0, skippedLong: 0, samples: { train: 0, val: 0 }, promptChars: 0, completionChars: 0, actions: 0,
    verbs: {}, byDifficulty: {}, byRank: {}, bySize: {}, byPlayers: {}, byMode: {}, maxPromptChars: 0 };
  const rows = [];
  for (const p of parts) {
    stats.seatTurns += p.seatTurns; stats.skippedLong += p.skippedLong;
    for (const o of p.outcomes) for (const s of o.seats) rows.push({ mode: o.mode, W: o.W, n: o.n, limit: o.limit, score: s.score, rank: s.rank });
  }
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const split of ['train', 'val']) {
    const out = fs.openSync(path.join(a.out, split + '.jsonl'), 'w');
    for (const p of parts) {
      const text = fs.readFileSync(p.files[split], 'utf8');
      fs.writeSync(out, text);
      fs.unlinkSync(p.files[split]);
      for (const line of text.split('\n')) {
        if (!line) continue;
        const s = JSON.parse(line);
        stats.samples[split]++;
        stats.promptChars += s.prompt.length; stats.completionChars += s.completion.length; stats.actions += s.meta.n_actions;
        stats.maxPromptChars = Math.max(stats.maxPromptChars, s.prompt.length);
        inc(stats.byDifficulty, s.meta.difficulty); inc(stats.byRank, s.meta.final_rank); inc(stats.bySize, s.meta.size); inc(stats.byPlayers, s.meta.players); inc(stats.byMode, s.meta.mode);
        for (const m of s.completion.matchAll(/^\[?\s*\("[^"]+", "([a-z_]+)"/gm)) inc(stats.verbs, m[1]);
      }
    }
    fs.closeSync(out);
  }
  const n = stats.samples.train + stats.samples.val;
  stats.avgPromptChars = Math.round(stats.promptChars / n); stats.avgCompletionChars = Math.round(stats.completionChars / n); stats.avgActions = +(stats.actions / n).toFixed(1);
  delete stats.promptChars; delete stats.completionChars; delete stats.actions;
  fs.writeFileSync(path.join(a.out, 'stats.json'), JSON.stringify(stats, null, 1));
  fs.writeFileSync(path.join(a.out, 'targets.json'), JSON.stringify(targets.build(rows), null, 1));
  fs.writeFileSync(path.join(a.out, 'action_spec.json'), JSON.stringify(A.spec(), null, 1));
  return stats;
}

function main() {
  const a = parseArgs(process.argv);
  fs.mkdirSync(a.out, { recursive: true });
  if (a.worker >= 0) { const r = runWorker(a); process.send ? process.send({ done: r }) : console.log(JSON.stringify(r)); return; }
  const t0 = Date.now();
  if (a.workers <= 1) { a.worker = 0; a.workers = 1; const stats = summarize(a, [runWorker(a)]); console.log(JSON.stringify(stats, null, 1), '\nsecs', (Date.now() - t0) / 1000); return; }
  const parts = [];
  let done = 0, ticks = 0;
  for (let w = 0; w < a.workers; w++) {
    const args = process.argv.slice(2).concat(['--worker', String(w)]);
    const ch = fork(__filename, args, { stdio: 'inherit' });
    ch.on('message', m => {
      if (m.progress) { ticks++; if (ticks % 10 === 0) process.stderr.write('.'); }
      if (m.done) { parts[w] = m.done; if (++done === a.workers) { const stats = summarize(a, parts); console.log('\n' + JSON.stringify(stats, null, 1), '\nsecs', (Date.now() - t0) / 1000); } }
    });
    ch.on('exit', code => { if (code) { console.error('worker', w, 'failed with code', code); process.exitCode = 1; } });
  }
}

if (require.main === module) main();
module.exports = { playGame, keepProb };
