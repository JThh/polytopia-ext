// Fairness harness: every tribe pairing, both seat orders, several seeds and maps, Hard vs Hard.
// Reports win rate per tribe and for the first seat. Usage: node test/balance.js [seedsPerPair] [players]
require('../src/engine.js'); require('../src/ai.js');
const TT = globalThis.TT;
const K = Number(process.argv[2] || 6), N = Number(process.argv[3] || 2);
const ids = TT.TRIBES.map(t => t.id), types = ['pangaea', 'continents', 'lakes', 'highlands', 'archipelago'];
const stat = {}; ids.forEach(t => stat[t] = { g: 0, w: 0, score: 0 });
let seat0 = 0, games = 0, turns = 0, dom = 0;
const combos = [];
if (N === 2) { for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) { combos.push([ids[a], ids[b]]); combos.push([ids[b], ids[a]]); } }
else { for (let r = 0; r < 30; r++) { const pool = ids.slice(); const pick = []; for (let k = 0; k < N; k++) pick.push(pool.splice((r * 7 + k * 3 + (r >> 1)) % pool.length, 1)[0]); combos.push(pick); } }
const t0 = Date.now();
combos.forEach((tribes, ci) => {
  for (let s = 0; s < K; s++) {
    const st = TT.newGame({ tribes, humans: [], opponents: N - 1, size: N > 2 ? 'normal' : 'small', mapType: types[(ci + s) % types.length], seed: 1234 + ci * 97 + s * 13, difficulty: 'hard', mode: 'score', turnLimit: 40 });
    let guard = 0;
    while (!st.over && guard++ < 8000) { TT.AI.playTurnSync(st); TT.endTurn(st); }
    const w = st.over.winner;
    st.players.forEach(P => { stat[P.tribe].g++; stat[P.tribe].score += TT.score(st, P.id); if (P.id === w) stat[P.tribe].w++; });
    if (w === 0) seat0++;
    if (st.over.reason === 'domination') dom++;
    games++; turns += st.turn;
  }
});
const rows = ids.map(t => ({ tribe: TT.tribe(t).name, games: stat[t].g, winRate: (stat[t].w / stat[t].g).toFixed(3), avgScore: Math.round(stat[t].score / stat[t].g) }));
console.table(rows);
console.log({ games, players: N, expectedWinRate: (1 / N).toFixed(3), seat0WinRate: (seat0 / games).toFixed(3), dominationShare: (dom / games).toFixed(2), avgTurns: (turns / games).toFixed(1), secs: ((Date.now() - t0) / 1000).toFixed(0) });
