require('../src/engine.js'); require('../src/ai.js');
const TT = globalThis.TT;
const A = process.argv[2]||'hard', B = process.argv[3]||'easy', N = +process.argv[4]||12, opp = +process.argv[5]||1;
const types = Object.keys(TT.MAP_TYPES);
let wA=0,wB=0,other=0, sA=0, sB=0;
for (let g=0; g<N; g++) for (let swap=0; swap<2; swap++) {
  const st = TT.newGame({ spectate:true, opponents:opp, mapType: types[g%types.length], size: g%2?'small':'normal', seed: 7000+g*13, mode:'score', turnLimit: 40 });
  // A plays seat 0 when swap=0 else seat 1; other seats B
  const aSeat = swap;
  st.players.forEach((p,i)=> p.difficulty = i===aSeat ? A : B);
  let guard=0;
  while(!st.over && guard++<5000){ TT.AI.playTurnSync(st); TT.endTurn(st); }
  const w = st.over ? st.over.winner : -1;
  if (w===aSeat) wA++; else if (w>=0) wB++; else other++;
  sA += TT.score(st,aSeat); sB += st.players.filter((p,i)=>i!==aSeat).reduce((s,p)=>s+TT.score(st,p.id),0)/opp;
}
console.log(`${A} vs ${B} (x${opp}): ${A} wins ${wA}, ${B} wins ${wB}, none ${other} | avg score ${Math.round(sA/(2*N))} vs ${Math.round(sB/(2*N))}`);
