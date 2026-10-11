// Several people at one table: the game must keep going while anyone is still alive, and seats handed to a bot
// (someone left) or taken back (they returned) mid-game must replay to the same state on every client.
require('../src/engine.js'); require('../src/ai.js');
const TT = globalThis.TT;
const types = Object.keys(TT.MAP_TYPES), ids = TT.TRIBES.map(t => t.id);
const N = Number(process.argv[2] || 30);
let fails = 0, kept = 0, flips = 0, ends = {}, cmds = 0;
const fail = (g, m) => { fails++; console.log('game', g, m); };
for (let g = 0; g < N; g++) {
  const people = 2 + (g % 3), opponents = people - 1 + (g % 3);
  const settings = { opponents, humans: Array.from({ length: people }, (_, i) => i), tribes: ids.slice(g % 6).concat(ids).slice(0, people), mapType: types[g % types.length], size: ['tiny', 'small'][g % 2], seed: 4200 + g * 17, difficulty: 'hard', spectate: false };
  const live = TT.newGame(settings);
  const log = [];
  TT.setRecorder(live, c => log.push(JSON.parse(JSON.stringify(c))));
  let seededRand = g * 7919 + 1;
  const rand = () => (seededRand = (seededRand * 48271) % 2147483647) / 2147483647;
  let guard = 0;
  while (!live.over && live.turn <= 60 && guard++ < 9000) {
    // occasionally someone leaves (a bot takes the seat) or comes back
    if (rand() < 0.04) {
      const seat = Math.floor(rand() * people), P = live.players[seat];
      if (P.alive) { const sys = P.isAI ? 'human' : 'botify'; P.isAI = sys === 'botify'; log.push({ sys, seat }); flips++; }
    }
    const before = live.players.filter(P => !P.isAI && P.alive).length;
    TT.AI.playTurnSync(live); TT.endTurn(live);
    const peopleAlive = live.players.filter(P => !P.isAI && P.alive).length;
    if (!live.over && before > peopleAlive && peopleAlive > 0) kept++;
    if (live.over && live.over.reason === 'defeat' && peopleAlive > 0) fail(g, 'ended in defeat while ' + peopleAlive + ' people were still playing');
  }
  if (live.over) ends[live.over.reason] = (ends[live.over.reason] || 0) + 1; else ends.unfinished = (ends.unfinished || 0) + 1;
  // replay on a fresh client
  const rep = TT.newGame(settings);
  for (let i = 0; i < log.length; i++) {
    const c = log[i];
    if (c.sys) { rep.players[c.seat].isAI = c.sys === 'botify'; continue; }
    if (!TT.exec(rep, c)) { fail(g, 'command ' + i + ' rejected on replay'); break; }
  }
  if (TT.hash(rep) !== TT.hash(live)) fail(g, 'replay drifted');
  cmds += log.length;
}
console.log({ games: N, commands: cmds, seatChanges: flips, eliminationsWhileOthersPlayed: kept, ends, failures: fails });
process.exit(fails ? 1 : 0);
