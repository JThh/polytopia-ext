// Drives ml/sim/server.js the way the Python trainer does. The model seat is played by plans the bot writes
// (op "botplan"), so every tuple must be valid; branch evaluation is checked on good, empty and malformed plans.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const proc = spawn(process.execPath, [path.join(__dirname, '..', 'sim', 'server.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = readline.createInterface({ input: proc.stdout });
const waiting = new Map();
let id = 0;
rl.on('line', line => { const r = JSON.parse(line); const w = waiting.get(r.id); waiting.delete(r.id); r.ok ? w.res(r) : w.rej(new Error(r.error)); });
const call = (op, m) => new Promise((res, rej) => { const k = ++id; waiting.set(k, { res, rej }); proc.stdin.write(JSON.stringify(Object.assign({ op, id: k }, m)) + '\n'); });

let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };

(async () => {
  const N = Number(process.argv[2] || 4);
  let turns = 0, evals = 0;
  for (let g = 0; g < N; g++) {
    const g0 = await call('new', { sample: { sizes: { tiny: 1, small: 1 }, modes: { score: 1 }, turnLimits: [15] }, seed: 31 + g, random_model_seat: true });
    const gid = g0.gid;
    let status = g0.status;
    while (!status.over) {
      check(status.modelTurn, 'advance stopped on a bot seat');
      const o = await call('observe', { gid });
      check(o.prompt.startsWith('<polytopia v1>\ngoal: final_rank=1 '), 'prompt has a strong-play goal');
      const { plan } = await call('botplan', { gid });
      if (turns % 3 === 0) {
        const ev = await call('evaluate', { gid, plans: [plan, '[("tribe", "end_turn")]', '[("giant#999", "fly", (1, 2))', 'no list here'], horizon: 1, seed: 5 });
        const [good, empty, bad, junk] = ev.results;
        check(good.report.invalid === 0 && good.report.complete, 'bot plan valid in evaluation ' + JSON.stringify(good.report.errors));
        check(empty.report.valid === 0 && empty.report.endedExplicitly, 'empty plan just ends the turn');
        check(bad.report.invalid === 1 && bad.report.errors.unknown_verb === 1 && !bad.report.complete, 'malformed plan: unknown verb + truncated list');
        check(junk.report.parsed === 0 && junk.report.parseError, 'junk does not parse');
        check(good.before.score === empty.before.score, 'branches start from the same state');
        evals++;
      }
      const st = await call('step', { gid, plan });
      check(st.report.invalid === 0, 'bot plan valid when stepped ' + JSON.stringify(st.report.errors));
      status = st.status;
      turns++;
    }
    const r = await call('result', { gid });
    check(r.scores.length === r.n && r.ranks.includes(1), 'result has scores and a winner');
    await call('close', { gid });
  }
  console.log({ games: N, modelTurns: turns, evaluations: evals, failures: fails });
  proc.stdin.end();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
