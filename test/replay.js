// Lockstep check: record every command while bots play, replay them on a fresh game from the same
// settings, and require identical state fingerprints at every turn boundary and at the end.
require('../src/engine.js'); require('../src/ai.js');
const TT = globalThis.TT;
const types = Object.keys(TT.MAP_TYPES), sizes = ['tiny', 'small', 'normal'];
let games = 0, cmdsTotal = 0, checks = 0, fails = 0;
for (let g = 0; g < Number(process.argv[2] || 24); g++) {
  const settings = { spectate: true, opponents: 1 + (g % 5), mapType: types[g % types.length], size: sizes[g % 3], seed: 9000 + g * 31, difficulty: ['easy', 'normal', 'hard', 'crazy'][g % 4], events: true };
  const live = TT.newGame(settings);
  const log = [], marks = [];
  TT.setRecorder(live, c => log.push(JSON.parse(JSON.stringify(c))));
  let guard = 0;
  while (!live.over && live.turn <= 45 && guard++ < 6000) { TT.AI.playTurnSync(live); TT.endTurn(live); marks.push([log.length, TT.hash(live)]); }
  const rep = TT.newGame(settings);
  let mi = 0;
  for (let i = 0; i < log.length; i++) {
    if (!TT.exec(rep, log[i])) { fails++; console.log('game', g, 'cmd', i, 'rejected on replay', JSON.stringify(log[i])); break; }
    while (mi < marks.length && marks[mi][0] === i + 1) { checks++; if (TT.hash(rep) !== marks[mi][1]) { fails++; console.log('game', g, 'desync after cmd', i); mi = marks.length; break; } mi++; }
  }
  if (TT.hash(rep) !== TT.hash(live)) { fails++; console.log('game', g, 'final hash differs'); }
  games++; cmdsTotal += log.length;
}
console.log({ games, commands: cmdsTotal, checkpoints: checks, failures: fails });
process.exit(fails ? 1 : 0);
