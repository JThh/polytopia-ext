require('../src/engine.js'); require('../src/ai.js');
const TT = globalThis.TT;
function check(st, where) {
  const seen = new Map();
  for (const u of st.units) {
    const k = u.y*st.W+u.x;
    if (seen.has(k)) throw new Error(where+': two units on tile '+u.x+','+u.y);
    seen.set(k,u);
    const tl = st.tiles[k], S = TT.stats(st,u);
    if (u.hp <= 0) throw new Error(where+': dead unit alive '+u.id);
    if (u.hp > S.maxHp) throw new Error(where+': hp>max '+u.type+' '+u.hp);
    const fly = TT.has(S,'fly');
    if (!fly && !u.naval && TT.isWater(tl.t)) throw new Error(where+': land unit on water '+u.type);
    if (!fly && u.naval && !TT.isWater(tl.t)) throw new Error(where+': boat on land');
    if (!st.players[u.owner].alive) throw new Error(where+': unit of dead player');
  }
  for (const P of st.players) if (P.stars < 0) throw new Error(where+': negative stars');
  for (const c of st.cities) { if (c.owner>=0 && c.pop >= c.level+1) throw new Error('pop overflow'); }
}
const types = Object.keys(TT.MAP_TYPES), sizes = ['tiny','small','normal','large','huge'];
let games = 0, overs = 0, totalTurns = 0, worst = 0;
const winsByTribe = {};
for (let rep = 0; rep < 2; rep++) for (const mapType of types) for (const size of sizes) {
  const opp = 1 + ((rep*7 + sizes.indexOf(size)*3 + types.indexOf(mapType)) % 5);
  const st = TT.newGame({ spectate: true, opponents: opp, mapType, size, seed: 77 + rep*1000 + types.indexOf(mapType)*31 + sizes.indexOf(size), difficulty: ['easy','normal','hard','crazy'][(rep+sizes.indexOf(size))%4], mode: rep ? 'score':'domination', turnLimit: 50 });
  check(st,'init');
  let guard = 0;
  while (!st.over && st.turn <= 70 && guard++ < 6000) {
    const t0 = Date.now();
    for (const evs of TT.AI.turn(st)) check(st, mapType+'/'+size+' t'+st.turn);
    worst = Math.max(worst, Date.now()-t0);
    TT.endTurn(st); check(st,'end');
  }
  games++; totalTurns += st.turn; if (st.over) { overs++; const w = st.players[st.over.winner].tribe; winsByTribe[w]=(winsByTribe[w]||0)+1; }
  process.stdout.write(`${mapType}/${size} p${opp+1} t${st.turn} ${st.over?st.over.reason:'-'}  `);
}
console.log('\ngames',games,'finished',overs,'avgTurns',(totalTurns/games).toFixed(1),'worstTurnMs',worst, JSON.stringify(winsByTribe));
