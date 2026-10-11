// The /api/finish verifier: a whole online game (people, bots, a seat handed to a bot and taken back) must verify
// to the same winner the players saw; tampered logs must be rejected. Also checks solo-game verification.
require('../src/engine.js'); require('../src/ai.js');
const { verifyOnline, verifySolo, VerifyError } = require('../api/_verify.js');
const TT = globalThis.TT;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const rejects = (fn, re, m) => { try { fn(); ok(false, m + ' (accepted)'); } catch (e) { ok(e instanceof VerifyError && re.test(e.message), m + ': ' + e.message); } };

function playOnline(seed) {
  const final = { opponents: 4, size: 'small', mapType: 'continents', difficulty: 'normal', mode: 'score', turnLimit: 30, humans: [0, 2, 3], tribes: ['emberfolk', null, 'tidecallers', 'verdant', null], spectate: false, seed };
  const users = { 0: 'u-ana', 2: 'u-ben', 3: 'u-cyr' };
  const players = Object.keys(users).map(s => ({ seat: +s, user_id: users[s] }));
  const live = TT.newGame(final), moves = [], buf = [];
  TT.setRecorder(live, c => buf.push(JSON.parse(JSON.stringify(c))));
  const runner = seat => { for (let k = 1; k <= 5; k++) { const q = (seat - k + 5) % 5; if (live.players[q].alive && !live.players[q].isAI) return users[q]; } return users[0]; };
  let guard = 0;
  while (!live.over && guard++ < 4000) {
    if (live.turn === 6 && live.current === 0 && !live.players[3].isAI) { live.players[3].isAI = true; moves.push({ author: 'u-ana', seat: 3, sys: 'botify' }); }
    if (live.turn === 9 && live.current === 0 && live.players[3].isAI && live.players[3].alive) { live.players[3].isAI = false; moves.push({ author: 'u-cyr', seat: 3, sys: 'human' }); }
    const seat = live.current, author = live.players[seat].isAI ? runner(seat) : users[seat];
    TT.AI.playTurnSync(live); TT.endTurn(live);
    moves.push({ author, seat, cmds: buf.splice(0) });
  }
  return { final, players, moves, live };
}

for (const seed of [11, 23, 37]) {
  const g = playOnline(seed);
  const v = verifyOnline(g);
  ok(v.over && v.winner === g.live.over.winner && v.reason === g.live.over.reason && v.turn === g.live.turn, 'seed ' + seed + ' verifies to the live result');
  ok(v.results.length === 3 && v.results.filter(r => r.won).length <= 1 && v.results.every(r => r.score === TT.score(g.live, r.seat)), 'seed ' + seed + ' results per person');
  ok(new Set(v.results.map(r => r.place)).size === 3, 'distinct places');
  // tampering
  const human = g.moves.findIndex(m => !m.sys && m.seat === 2 && m.cmds.length > 1);
  const forged = JSON.parse(JSON.stringify(g.moves)); forged[human].author = 'u-ana';
  rejects(() => verifyOnline(Object.assign({}, g, { moves: forged })), /does not control/, 'move for another person');
  const illegal = JSON.parse(JSON.stringify(g.moves)); illegal[human].cmds.unshift(['research', 'nonexistent-tech']);
  rejects(() => verifyOnline(Object.assign({}, g, { moves: illegal })), /illegal|unknown/, 'illegal command');
  const outOfTurn = JSON.parse(JSON.stringify(g.moves)); outOfTurn[human].seat = outOfTurn[human].seat === 2 ? 0 : 2; outOfTurn[human].author = outOfTurn[human].seat === 0 ? 'u-ana' : 'u-ben';
  rejects(() => verifyOnline(Object.assign({}, g, { moves: outOfTurn })), /out of turn/, 'moves out of turn');
  const stranger = JSON.parse(JSON.stringify(g.moves)); stranger[0].author = 'u-mallory';
  rejects(() => verifyOnline(Object.assign({}, g, { moves: stranger })), /not seated/, 'move from someone not in the room');
  ok(verifyOnline(Object.assign({}, g, { moves: g.moves.slice(0, 40) })).over === false, 'unfinished game is not recorded');
}

// solo
const S = { tribe: 'sunspire', opponents: 2, difficulty: 'easy', size: 'tiny', mapType: 'pangaea', mode: 'domination', turnLimit: 30, relief: 'dramatic', events: true, fog: true, dayCycle: true, seed: 777 };
const solo = TT.newGame(Object.assign({}, S, { spectate: false, humans: null, tribes: null })), log = [];
TT.setRecorder(solo, c => log.push(JSON.parse(JSON.stringify(c))));
let guard = 0;
while (!solo.over && guard++ < 3000) { TT.AI.playTurnSync(solo); TT.endTurn(solo); }
const vs = verifySolo({ settings: S, log });
ok(vs.over && vs.winner === solo.over.winner && vs.result.score === TT.score(solo, 0) && vs.result.won === (solo.over.winner === 0), 'solo game verifies');
rejects(() => verifySolo({ settings: Object.assign({}, S, { seed: 778 }), log }), /illegal/, 'solo log under another seed');
rejects(() => verifySolo({ settings: Object.assign({}, S, { seed: 0 }), log }), /seed/, 'solo without a seed');
console.log({ verifyFailures: fails });
process.exit(fails ? 1 : 0);
