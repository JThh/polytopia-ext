// Codec round trip: bots play; every action is encoded as a tuple (on the pre-action state), printed as text,
// parsed back, and replayed through actions.execute on a fresh game. The replay must match the live game exactly,
// which proves the tuple format is lossless and every verb compiles to the same engine call the bot made.
'use strict';
const TT = require('../sim/tt');
const A = require('../sim/actions');
const types = Object.keys(TT.MAP_TYPES), sizes = ['tiny', 'small', 'normal', 'large'], ids = TT.TRIBES.map(t => t.id);
console.log('rules:', TT.ML.rules);
const N = Number(process.argv[2] || 24);
let games = 0, tuples = 0, fails = 0;
const verbs = {};
for (let g = 0; g < N; g++) {
  TT.ML.seedRandom(1000 + g);
  const players = 2 + (g % 5);
  const settings = { tribes: ids.slice(g % ids.length).concat(ids).slice(0, players), humans: [], opponents: players - 1, mapType: types[g % types.length], size: sizes[Math.min(3, (g % 4) + (players > 4 ? 1 : 0))], seed: 500 + g * 37, difficulty: 'hard', mode: 'score', turnLimit: 30 + (g % 3) * 5 };
  const live = TT.newGame(settings);
  const turns = []; // [pid, text]
  let cur = null;
  TT.ML.listen(live, {
    before(st, name, args) { return A.fromCommand(st, name, args); },
    after(st, name, args, r, t) {
      if (!r) return;
      (cur || (cur = [])).push(t);
      if (name === 'endTurn') { turns.push(A.formatList(cur)); cur = null; }
    },
  });
  let guard = 0;
  while (!live.over && guard++ < 6000) {
    TT.ML.botTurn(live);
    if (live.over) break;
    TT.endTurn(live);
  }
  if (cur) turns.push(A.formatList(cur));
  const rep = TT.newGame(settings);
  outer: for (let k = 0; k < turns.length; k++) {
    const p = A.parse(turns[k]);
    if (p.error || !p.complete) { fails++; console.log('game', g, 'turn', k, 'parse error', p.error); break; }
    for (const t of p.actions) {
      const pid = rep.current;
      const r = t[1] === 'end_turn' ? (TT.endTurn(rep), { ok: true }) : A.execute(rep, pid, t);
      verbs[t[1]] = (verbs[t[1]] || 0) + 1;
      tuples++;
      if (!r.ok) { fails++; console.log('game', g, 'rejected', A.formatTuple(t), r.err); break outer; }
    }
  }
  if (TT.hash(rep) !== TT.hash(live)) { fails++; console.log('game', g, 'replay drifted'); }
  games++;
}
console.log({ games, tuples, failures: fails, verbs });
process.exit(fails ? 1 : 0);
