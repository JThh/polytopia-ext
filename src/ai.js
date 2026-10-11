/* Tessera Tribes — bot. Tactical combat search + threat maps + strategic goals + economy planner. */
(function (G) {
'use strict';
const TT = G.TT;
const T = TT.T;
const AI = TT.AI = {};
const cheb = TT.dist, has = TT.has;
const INF = 1e9;

// ---------------------------------------------------------------- pathing
function heapPush(h, p, i) {
  h.push([p, i]);
  let k = h.length - 1;
  while (k > 0) { const pa = (k - 1) >> 1; if (h[pa][0] <= h[k][0]) break; const t = h[pa]; h[pa] = h[k]; h[k] = t; k = pa; }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === k) break;
      const t = h[m]; h[m] = h[k]; h[k] = t; k = m;
    }
  }
  return top;
}

function moveClass(st, pid, u, extra) {
  const P = st.players[pid];
  const S = u ? TT.stats(st, u) : null;
  return Object.assign({
    pid, climb: !!P.techs.climbing, fishing: !!P.techs.fishing, sail: !!P.techs.sailing,
    verdant: P.tribe === 'verdant', ironpeak: P.tribe === 'ironpeak', fly: S ? has(S, 'fly') : false, potentialPort: false,
  }, extra || {});
}
function edgeCost(st, cls, a, b) {
  if (cls.fly) return 1;
  const ta = st.tiles[a], tb = st.tiles[b];
  const wa = ta.t <= 1, wb = tb.t <= 1;
  if (wb) {
    if (!cls.fishing && !cls.potentialPort) return INF;
    if (tb.t === T.OCEAN && !cls.sail) return INF;
    if (!wa) {
      if (tb.imp === 'port' && tb.owner === cls.pid) return 1.5;
      return cls.potentialPort ? 4 : INF;
    }
    return 0.45;
  }
  if (tb.t === T.MOUNTAIN && !cls.climb) return INF;
  if (!wa && TT.isRoad(ta) && TT.isRoad(tb)) return 0.5;
  let c = 1;
  if (tb.t === T.FOREST && !cls.verdant) c = 1.7;
  else if (tb.t === T.MOUNTAIN && !cls.ironpeak) c = 1.7;
  if (wa) c += 1;
  return c;
}
function dijkstra(st, cls, srcs, reverse) {
  const W = st.W, H = st.H, N = W * H;
  const d = new Float64Array(N).fill(INF);
  const h = [];
  for (const s of srcs) { d[s] = 0; heapPush(h, 0, s); }
  while (h.length) {
    const [p, c] = heapPop(h);
    if (p > d[c]) continue;
    const cx = c % W, cy = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      const w = reverse ? edgeCost(st, cls, n, c) : edgeCost(st, cls, c, n);
      if (w >= INF) continue;
      const nd = p + w;
      if (nd < d[n]) { d[n] = nd; heapPush(h, nd, n); }
    }
  }
  return d;
}
AI.dijkstra = dijkstra;
AI.moveClass = moveClass;

// ---------------------------------------------------------------- threat
function threatLists(st, pid) {
  const W = st.W, N = W * st.H, P = st.players[pid];
  const lists = new Array(N);
  for (const e of st.units) {
    if (e.owner === pid) continue;
    if (!TT.visibleTo(st, e, pid)) continue;
    const S = TT.stats(st, e);
    if (S.atk <= 0 && !has(S, 'convert')) continue;
    const pos = [];
    if (has(S, 'dash') && !e.frozen) {
      const R = TT.reach(st, e, S.move);
      R.forEach((n, i) => { if (!n.occ || i === e.y * W + e.x) pos.push(i); });
    } else pos.push(e.y * W + e.x);
    const mark = new Uint8Array(N);
    for (const i of pos) {
      const x = i % W, y = (i / W) | 0, r = TT.effRange(st, e, x, y, S);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= st.H) continue;
        mark[ny * W + nx] = 1;
      }
    }
    for (let i = 0; i < N; i++) if (mark[i]) (lists[i] || (lists[i] = [])).push(e);
  }
  return lists;
}
function riskAt(st, u, x, y, hp, lists, excludeId) {
  const L = lists[y * st.W + x];
  if (!L) return 0;
  let s = 0;
  for (const e of L) {
    if (e.id === excludeId || st.units.indexOf(e) < 0) continue;
    const SE = TT.stats(st, e);
    if (has(SE, 'convert')) { if (!TT.UNITS[u.type].super) s += hp * 0.7; continue; }
    const r = TT.combat(st, e, u, { dx: x, dy: y, dhp: Math.max(1, hp), moved: has(SE, 'charge') ? 2 : 0 });
    s += r.dmg;
  }
  return s;
}
AI.threatLists = threatLists;
AI.riskAt = riskAt;

// ---------------------------------------------------------------- analysis
function analyze(st, pid) {
  const W = st.W, N = W * st.H, P = st.players[pid];
  const vis = i => P.explored[i];
  const ctx = { pid, P, W, N };
  ctx.my = st.units.filter(u => u.owner === pid);
  ctx.enemies = st.units.filter(u => u.owner !== pid && TT.visibleTo(st, u, pid));
  ctx.myCities = st.cities.filter(c => c.owner === pid);
  const known = st.cities.filter(c => c.owner !== pid && vis(c.y * W + c.x));
  ctx.villages = known.filter(c => c.owner === -1);
  ctx.enemyCities = known.filter(c => c.owner >= 0);
  ctx.lists = threatLists(st, pid);
  // city threat
  ctx.cityThreat = {};
  for (const c of ctx.myCities) {
    let threat = 0, defense = 0;
    for (const e of ctx.enemies) {
      const d = cheb(e.x, e.y, c.x, c.y);
      if (d <= 3) { const S = TT.stats(st, e); threat += (S.atk + 0.5) * e.hp / S.maxHp * (d <= 1 ? 1.6 : d === 2 ? 1.2 : 0.8); }
    }
    for (const u of ctx.my) {
      const d = cheb(u.x, u.y, c.x, c.y);
      if (d <= 1) { const S = TT.stats(st, u); defense += (S.def + 0.3) * u.hp / S.maxHp * (d === 0 ? 1.5 : 0.7); }
    }
    const occ = TT.unitAt(st, c.x, c.y);
    ctx.cityThreat[c.id] = { threat, defense, garrisoned: !!(occ && occ.owner === pid), enemyOn: !!(occ && occ.owner !== pid) };
  }
  // frontier sample
  const fr = [];
  for (let i = 0; i < N; i++) {
    if (!vis(i)) continue;
    const x = i % W, y = (i / W) | 0;
    let unk = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < st.H && !vis(ny * W + nx)) unk++;
    }
    if (unk >= 2) fr.push(i);
  }
  ctx.frontier = [];
  fr.sort(() => Math.random() - 0.5);
  for (const i of fr) {
    if (ctx.frontier.length >= 18) break;
    if (ctx.frontier.every(j => cheb(i % W, (i / W) | 0, j % W, (j / W) | 0) >= 3)) ctx.frontier.push(i);
  }
  let ex = 0; for (let i = 0; i < N; i++) ex += P.explored[i];
  ctx.exploredFrac = ex / N;
  // war intensity
  let minD = 99;
  for (const ec of ctx.enemyCities) for (const c of ctx.myCities) minD = Math.min(minD, cheb(ec.x, ec.y, c.x, c.y));
  let nearEnemyUnits = 0;
  for (const e of ctx.enemies) for (const c of ctx.myCities) if (cheb(e.x, e.y, c.x, c.y) <= 4) { nearEnemyUnits++; break; }
  ctx.war = ctx.enemyCities.length ? (1 + (minD < 8 ? 0.5 : 0)) : (ctx.enemies.length ? 0.5 : 0.1);
  ctx.war += Math.min(1, nearEnemyUnits * 0.25);
  if (st.turn < 4) ctx.war *= 0.5;
  ctx.threatened = ctx.myCities.filter(c => { const t = ctx.cityThreat[c.id]; return t.threat > t.defense * 0.8 + 0.5; });
  return ctx;
}
AI.analyze = analyze;

function econAnalysis(st, pid, ctx) {
  const W = st.W, P = st.players[pid];
  const terr = { fruit: 0, game: 0, fish: 0, crop: 0, ore: 0, forest: 0, mountain: 0, coast: 0 };
  for (let i = 0; i < ctx.N; i++) {
    const tl = st.tiles[i];
    if (tl.owner !== pid || tl.city < 0) continue;
    if (tl.res === 'fruit') terr.fruit++;
    else if (tl.res === 'game') terr.game++;
    else if (tl.res === 'fish') terr.fish++;
    else if (tl.res === 'crop' && !tl.imp) terr.crop++;
    else if (tl.res === 'ore' && !tl.imp) terr.ore++;
    else if (tl.res === 'whale') terr.whale = (terr.whale || 0) + 1;
    if (tl.t === T.FIELD && !tl.imp && !tl.res && tl.site < 0) terr.field = (terr.field || 0) + 1;
    if (tl.t === T.FOREST && !tl.imp && !tl.res) terr.forest++;
    if (tl.t === T.MOUNTAIN) terr.mountain++;
    if (tl.t === T.SHALLOW && !tl.imp && !tl.res) terr.coast++;
  }
  ctx.terr = terr;
  // reachability of objectives
  const srcs = ctx.myCities.map(c => c.y * W + c.x);
  const targets = ctx.villages.concat(ctx.enemyCities).map(c => c.y * W + c.x);
  ctx.wantsPort = false; ctx.wantsSail = false; ctx.mountainBlocked = false;
  ctx.freeVillages = ctx.villages.length;
  if (srcs.length && targets.length) {
    const dNow = dijkstra(st, moveClass(st, pid, null), srcs, false);
    const unreach = targets.filter(t => dNow[t] >= INF);
    if (unreach.length) {
      const dPort = dijkstra(st, moveClass(st, pid, null, { potentialPort: true, fishing: true }), srcs, false);
      const dSail = dijkstra(st, moveClass(st, pid, null, { potentialPort: true, fishing: true, sail: true }), srcs, false);
      const dClimb = dijkstra(st, moveClass(st, pid, null, { climb: true }), srcs, false);
      for (const t of unreach) {
        if (dClimb[t] < INF) ctx.mountainBlocked = true;
        else if (dPort[t] < INF) ctx.wantsPort = true;
        else if (dSail[t] < INF) { ctx.wantsPort = true; ctx.wantsSail = true; }
      }
      ctx.unreachable = unreach.length;
    }
    ctx.hasPort = st.tiles.some(t => t.imp === 'port' && t.owner === pid);
  }
  ctx.enemyNaval = ctx.enemies.some(e => e.naval);
  ctx.military = ctx.my.filter(u => TT.UNITS[u.type].atk > 0).length;
}

// ---------------------------------------------------------------- turn driver
AI.turn = function* (st) {
  const pid = st.current, P = st.players[pid];
  const D = TT.DIFFICULTY[P.difficulty || 'hard'];
  const jitter = () => 1 + (Math.random() * 2 - 1) * D.noise;
  yield* resolveRewards(st, pid);
  if (st.over) return;
  if (shouldUsePower(st, pid) && Math.random() >= (D.econSkip || 0)) { const ev = TT.usePower(st); if (ev) yield ev; }
  if (st.over) return;
  for (const u of st.units.slice()) {
    if (u.owner === pid && TT.canCapture(st, u)) { const ev = TT.capture(st, u.id); if (ev) yield ev; if (st.over) return; }
  }
  yield* attackPhase(st, pid, D, jitter, true);
  if (st.over) return;
  yield* movePhase(st, pid, D, jitter, false);
  if (st.over) return;
  yield* attackPhase(st, pid, D, jitter, false);
  if (st.over) return;
  yield* movePhase(st, pid, D, jitter, true);
  if (st.over) return;
  yield* economy(st, pid, D, jitter);
  yield* resolveRewards(st, pid);
};

// play an entire AI turn synchronously (for tests / instant mode)
AI.playTurnSync = function (st) { for (const _ of AI.turn(st)) { /* consume */ } };

// ---------------------------------------------------------------- rewards
function* resolveRewards(st, pid) {
  const ctx = { exploredFrac: 0 };
  const P = st.players[pid];
  let ex = 0; for (const e of P.explored) ex += e;
  ctx.exploredFrac = ex / P.explored.length;
  for (const c of st.cities) {
    while (c.owner === pid && c.pending.length) {
      const key = chooseReward(st, pid, c, ctx);
      const ev = TT.chooseReward(st, c.id, key);
      if (!ev) break;
      yield ev;
    }
  }
}
function chooseReward(st, pid, c, ctx) {
  const lvl = c.pending[0];
  const enemyNear = st.units.some(e => e.owner !== pid && cheb(e.x, e.y, c.x, c.y) <= 4 && st.players[pid].explored[e.y * st.W + e.x]);
  const enemyCityNear = st.cities.some(k => k.owner >= 0 && k.owner !== pid && cheb(k.x, k.y, c.x, c.y) <= 6);
  if (lvl === 2) return ctx.exploredFrac < 0.3 && st.turn < 8 ? 'explorer' : 'workshop';
  if (lvl === 3) return enemyNear || (enemyCityNear && c.capital) ? 'walls' : 'resources';
  if (lvl === 4) {
    let gain = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = c.x + dx, ny = c.y + dy;
      if (!TT.inB(st, nx, ny) || Math.max(Math.abs(dx), Math.abs(dy)) < 2) continue;
      const tl = st.tiles[ny * st.W + nx];
      if (tl.city === -1 && (tl.res || tl.t === T.FOREST)) gain++;
    }
    return gain >= 4 ? 'borders' : 'growth';
  }
  return enemyNear || enemyCityNear || st.turn > 18 ? 'giant' : 'park';
}

// ---------------------------------------------------------------- power
function shouldUsePower(st, pid) {
  const P = st.players[pid];
  if (P.power < TT.POWER_COST) return false;
  const tribe = TT.tribe(P.tribe);
  const mine = st.units.filter(u => u.owner === pid);
  const enemies = st.units.filter(u => u.owner !== pid && P.explored[u.y * st.W + u.x]);
  const full = P.power >= TT.POWER_MAX - 1;
  switch (tribe.power) {
    case 'overgrowth': {
      let miss = 0; for (const u of mine) miss += Math.min(5, TT.stats(st, u).maxHp - u.hp);
      return miss >= 12 || (full && miss >= 5);
    }
    case 'forge': case 'tailwind': {
      let ready = 0;
      for (const u of mine) if (enemies.some(e => cheb(e.x, e.y, u.x, u.y) <= TT.stats(st, u).move + TT.stats(st, u).range)) ready++;
      return ready >= 3 || (full && ready >= 1);
    }
    case 'wildfire': {
      let n = 0;
      for (const e of enemies) if (mine.some(u => cheb(u.x, u.y, e.x, e.y) === 1)) n += e.hp <= 3 ? 2 : 1;
      return n >= 3 || (full && n >= 1);
    }
    case 'blizzard': {
      let n = 0;
      const srcs = mine.map(u => [u.x, u.y]).concat(st.cities.filter(c => c.owner === pid).map(c => [c.x, c.y]));
      for (const e of enemies) if (srcs.some(s => cheb(s[0], s[1], e.x, e.y) <= 2)) n++;
      return n >= 3 || (full && n >= 1);
    }
    case 'goldenage': return true;
  }
  return false;
}

// ---------------------------------------------------------------- attacks
function* attackPhase(st, pid, D, jitter, allowMove) {
  const W = st.W;
  for (let iter = 0; iter < 90; iter++) {
    if (st.over) return;
    const lists = threatLists(st, pid);
    const cands = [];
    const maxDmg = new Map(); // enemy id -> [{uid, dmg}]
    for (const u of st.units) {
      if (u.owner !== pid || !u.canAttack) continue;
      const S = TT.stats(st, u);
      if (S.atk <= 0 && !has(S, 'convert')) continue;
      const positions = [[u.x, u.y, u.movedDist]];
      if (allowMove && u.canMove && has(S, 'dash')) {
        const R = TT.reach(st, u);
        R.forEach((n, i) => { if (!n.occ && i !== u.y * W + u.x) positions.push([i % W, (i / W) | 0, u.movedDist + n.s]); });
      }
      for (const p of positions) {
        for (const d of TT.targetsFrom(st, u, p[0], p[1])) {
          const r = has(S, 'convert') ? null : TT.combat(st, u, d, { ax: p[0], ay: p[1], moved: p[2] });
          cands.push({ u, S, x: p[0], y: p[1], moved: p[2], d, r });
          if (r) {
            let arr = maxDmg.get(d.id);
            if (!arr) maxDmg.set(d.id, arr = []);
            const ex = arr.find(a => a.uid === u.id);
            if (ex) ex.dmg = Math.max(ex.dmg, r.dmg); else arr.push({ uid: u.id, dmg: r.dmg });
          }
        }
      }
    }
    if (!cands.length) return;
    let best = null;
    for (const c of cands) {
      const v = evalAttack(st, pid, c, lists, maxDmg, D) * jitter();
      if (!best || v > best.v) { best = c; best.v = v; }
    }
    if (!best || best.v < 0.45) return;
    const { u, x, y, d } = best;
    if (x !== u.x || y !== u.y) {
      const ev = TT.move(st, u.id, x, y);
      if (!ev) return;
      yield ev;
      if (st.over) return;
      if (st.units.indexOf(u) < 0 || !u.canAttack) continue;
    }
    if (st.units.indexOf(d) < 0) continue;
    const ev2 = TT.attack(st, u.id, d.id);
    if (!ev2) return;
    yield ev2;
  }
}

function evalAttack(st, pid, c, lists, maxDmg, D) {
  const { u, S, x, y, d, r } = c;
  const W = st.W;
  const tv = TT.unitValue(st, d), mv = TT.unitValue(st, u);
  const dTile = st.tiles[d.y * W + d.x];
  let v;
  if (!r) { // convert
    const rk = riskAt(st, u, x, y, u.hp, lists);
    v = tv * 1.7 + 1 - mv * Math.min(1, rk / u.hp) * 0.6;
  } else {
    if (r.dmg <= 0) return -1;
    const melee = cheb(x, y, d.x, d.y) === 1;
    let finalX = x, finalY = y, hpAfter = u.hp;
    if (r.killed) {
      v = tv + 2;
      if (melee && S.range === 1) { finalX = d.x; finalY = d.y; }
      if (has(S, 'persist')) v += 0.8;
    } else {
      const rem = d.hp - r.dmg;
      v = tv * (r.dmg / d.hp) * 0.75;
      let slam = false;
      if (has(S, 'shove') && melee) {
        const nx = d.x + Math.sign(d.x - x), ny = d.y + Math.sign(d.y - y);
        const blocked = !TT.inB(st, nx, ny) || TT.unitAt(st, nx, ny) || (!d.naval && st.tiles[ny * W + nx].t <= 1) || (d.naval && st.tiles[ny * W + nx].t > 1);
        if (blocked) { slam = true; v += rem <= 2 ? tv + 2 : tv * 0.15; }
        else { v += 0.8; if (dTile.site >= 0) v += 2.5; }
      }
      if (D.lookahead && !slam) {
        const arr = maxDmg.get(d.id) || [];
        if (arr.some(a => a.uid !== u.id && a.dmg >= rem)) v += tv * 0.5;
      }
      if (!(has(S, 'shove') && melee && !slam)) {
        if (r.counterKills) { v -= mv + 2; hpAfter = 0; }
        else { v -= mv * (r.counter / u.hp) * 0.7; hpAfter = u.hp - r.counter; }
      }
    }
    if (has(S, 'splash')) {
      const sd = Math.max(1, Math.round(r.dmg / 2));
      for (const e of st.units) {
        if (e.owner === pid || e === d || cheb(e.x, e.y, d.x, d.y) !== 1) continue;
        v += sd >= e.hp ? TT.unitValue(st, e) + 1 : TT.unitValue(st, e) * sd / e.hp * 0.6;
      }
    }
    if (hpAfter > 0 && !has(S, 'escape')) {
      const rk = riskAt(st, u, finalX, finalY, hpAfter, lists, r.killed ? d.id : -1);
      v -= mv * Math.min(1.1, rk / hpAfter) * 0.45 * (D.risk == null ? 1 : D.risk);
    }
  }
  if (dTile.site >= 0) {
    const city = st.cities[dTile.site];
    if (city.owner === pid) v += 6;
    else if (city.owner === d.owner) v += r && r.killed ? 3 : 0.4;
    else v += 1;
  } else if (dTile.owner === pid) v += 1.2;
  // leaving own threatened city
  if (x !== u.x || y !== u.y) {
    const ct = st.tiles[u.y * W + u.x];
    if (ct.site >= 0 && st.cities[ct.site].owner === pid && lists[u.y * W + u.x]) v -= 3;
  }
  if (r && S.range > 1) v += 0.3;
  return v;
}

// ---------------------------------------------------------------- moves
function buildGoals(st, pid, ctx) {
  const W = st.W, P = st.players[pid], goals = [];
  const early = st.turn <= 12;
  for (const c of ctx.villages) goals.push({ i: c.y * W + c.x, kind: 'village', base: early ? 14 : 10, cap: 1, capture: true });
  for (const c of ctx.enemyCities) {
    const occ = TT.unitAt(st, c.x, c.y);
    const weak = !occ || occ.owner === pid;
    goals.push({ i: c.y * W + c.x, kind: 'enemycity', base: (weak ? 11 : 7) + (c.capital ? 2 : 0) + c.level * 0.5, cap: 3 + c.level, capture: true, army: true });
  }
  for (const c of ctx.myCities) {
    const t = ctx.cityThreat[c.id];
    if (t.threat > 0.4) {
      const need = Math.max(1, Math.ceil((t.threat - t.defense) / 2.5));
      goals.push({ i: c.y * W + c.x, kind: 'defend', base: 9 + t.threat * 1.2 + (c.capital ? 3 : 0), cap: need + 1, defend: true });
    }
  }
  for (let i = 0; i < ctx.N; i++) {
    const tl = st.tiles[i];
    if (tl.ruin && P.explored[i]) goals.push({ i, kind: 'ruin', base: 7, cap: 1 });
  }
  const exploreBase = ctx.exploredFrac < 0.4 ? 5 : ctx.exploredFrac < 0.75 ? 3 : 1.2;
  for (const i of ctx.frontier) goals.push({ i, kind: 'explore', base: exploreBase, cap: 1, explore: true });
  for (const e of ctx.enemies) {
    goals.push({ i: e.y * W + e.x, kind: 'hunt', base: TT.unitValue(st, e) * 0.55 + (st.tiles[e.y * W + e.x].owner === pid ? 3 : 0), cap: 2, army: true, unit: e });
  }
  return goals;
}

function goalMult(st, u, S, g, ctx) {
  const B = TT.UNITS[u.type];
  const fly = has(S, 'fly');
  if (has(S, 'infiltrate')) return g.kind === 'enemycity' ? 1.6 : g.kind === 'explore' ? 0.6 : 0;
  if (g.capture && (fly || B.atk <= 0)) return g.kind === 'enemycity' ? 0.4 : 0;
  if (B.atk <= 0) { // mind bender: follow army
    if (g.kind === 'hunt') return 0.9;
    if (g.kind === 'explore') return 0.2;
    if (g.kind === 'ruin') return 0.5;
  }
  let m = 1;
  if (g.kind === 'explore') m = (S.move >= 2 || fly ? 1.6 : 0.8) * (u.naval ? 1.2 : 1);
  if (g.kind === 'village' && S.move >= 2) m = 1.2;
  if (g.kind === 'defend') m = (S.def >= 2 ? 1.3 : 0.9);
  if (g.kind === 'enemycity' || g.kind === 'hunt') m = 0.6 + Math.min(1.2, ctx.war * 0.5) + (B.cost >= 5 ? 0.3 : 0);
  if (B.super) { if (g.kind === 'explore' || g.kind === 'ruin') m *= 0.3; }
  return m;
}

function* movePhase(st, pid, D, jitter, escapeOnly) {
  const W = st.W;
  const ctx = analyze(st, pid);
  const goals = buildGoals(st, pid, ctx);
  const claimed = new Map();
  // units already sitting on capture targets claim them
  for (const u of ctx.my) {
    const tl = st.tiles[u.y * W + u.x];
    if (tl.site >= 0 && st.cities[tl.site].owner !== pid) claimed.set(u.y * W + u.x, 9);
  }
  let units = st.units.filter(u => u.owner === pid && u.canMove && (!escapeOnly || !u.canAttack));
  // order: threatened/injured first, then by proximity to enemies
  const prio = u => {
    let p = 0;
    if (ctx.lists[u.y * W + u.x]) p += 10;
    const S = TT.stats(st, u);
    if (u.hp < S.maxHp * 0.5) p += 5;
    if (S.move >= 2) p -= 2;
    return -p;
  };
  units.sort((a, b) => prio(a) - prio(b));
  for (const u of units) {
    if (st.over) return;
    if (st.units.indexOf(u) < 0 || !u.canMove) continue;
    const S = TT.stats(st, u);
    const cur = u.y * W + u.x;
    const curTile = st.tiles[cur];
    const lists = ctx.lists;
    // stand still on capture targets (unless about to die)
    if (curTile.site >= 0 && st.cities[curTile.site].owner !== pid && !has(S, 'fly') && !u.naval && TT.UNITS[u.type].atk > 0) {
      const rk = riskAt(st, u, u.x, u.y, u.hp, lists);
      if (rk < u.hp * 1.3 || st.cities[curTile.site].owner === -1) continue;
    }
    if (!escapeOnly && u.canAttack && TT.canInfiltrate(st, u)) { const ev = TT.infiltrate(st, u.id); if (ev) { yield ev; continue; } }
    if (!escapeOnly && u.canAttack) {
      if (has(S, 'heal')) {
        let miss = 0;
        for (const f of TT.healTargets(st, u)) miss += Math.min(4, TT.stats(st, f).maxHp - f.hp);
        if (miss >= 5) { const ev = TT.healOthers(st, u.id); if (ev) { yield ev; continue; } }
      }
      if (u.hp <= S.maxHp * 0.6) {
        const rk = riskAt(st, u, u.x, u.y, u.hp, lists);
        const inOwn = curTile.owner === pid;
        if ((rk < u.hp * 0.45 && inOwn) || rk === 0) { const ev = TT.recover(st, u.id); if (ev) { yield ev; continue; } }
      }
    }
    // goal selection
    const cls = moveClass(st, pid, u);
    const dFrom = dijkstra(st, cls, [cur], false);
    let best = null;
    for (const g of goals) {
      const used = claimed.get(g.i) || 0;
      if (used >= g.cap) continue;
      if (g.unit && st.units.indexOf(g.unit) < 0) continue;
      let dist = dFrom[g.i];
      if (g.unit || g.capture) { // goal tile may be blocked; use neighbours
        if (dist >= INF) {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = (g.i % W) + dx, ny = ((g.i / W) | 0) + dy;
            if (TT.inB(st, nx, ny)) dist = Math.min(dist, dFrom[ny * W + nx] + 1);
          }
        }
      }
      if (dist >= INF) continue;
      const m = goalMult(st, u, S, g, ctx);
      if (m <= 0) continue;
      const turns = dist / Math.max(1, S.move);
      const score = g.base * m / (1 + turns * 0.75) * jitter();
      if (!best || score > best.score) best = { g, score };
    }
    // injured units head home
    if (u.hp < S.maxHp * 0.45 && ctx.myCities.length) {
      let hc = null, hd = INF;
      for (const c of ctx.myCities) { const dd = dFrom[c.y * W + c.x]; if (dd < hd) { hd = dd; hc = c; } }
      if (hc) { const sc = 8 / (1 + hd / S.move * 0.75); if (!best || sc > best.score) best = { g: { i: hc.y * W + hc.x, kind: 'home', base: 8, cap: 9 }, score: sc }; }
    }
    if (best) claimed.set(best.g.i, (claimed.get(best.g.i) || 0) + 1);
    const goalIdx = best ? best.g.i : -1;
    const dTo = goalIdx >= 0 ? dijkstra(st, cls, [goalIdx], true) : null;
    // choose tile
    const R = TT.reach(st, u);
    const mv = TT.unitValue(st, u);
    const aggr = best && (best.g.kind === 'enemycity' || best.g.kind === 'hunt' || best.g.kind === 'defend') ? 0.35 : 0.8;
    const P = st.players[pid];
    let bt = cur, bs = -INF;
    R.forEach((n, i) => {
      if (n.occ && i !== cur) return;
      const x = i % W, y = (i / W) | 0, tl = st.tiles[i];
      let s = 0;
      if (dTo) s -= Math.min(60, dTo[i]) * 1.4;
      // exploration value
      const vr = (has(S, 'scout') ? 2 : 1) + (tl.t === T.MOUNTAIN ? 1 : 0);
      let unk = 0;
      for (let dy = -vr; dy <= vr; dy++) for (let dx = -vr; dx <= vr; dx++) {
        const nx = x + dx, ny = y + dy;
        if (TT.inB(st, nx, ny) && !P.explored[ny * W + nx]) unk++;
      }
      s += unk * (ctx.exploredFrac < 0.6 ? 0.35 : 0.15);
      if (tl.site >= 0) {
        const c = st.cities[tl.site];
        if (c.owner !== pid && !has(S, 'fly') && TT.UNITS[u.type].atk > 0) s += c.owner === -1 ? 7 : 6;
        if (c.owner === pid) {
          const th = ctx.cityThreat[c.id];
          if (th && th.threat > 0.4) s += 4 + th.threat * 0.5; else if (TT.cityUnits(st, c) < TT.cityCap(c)) s -= 1.5;
        }
      }
      if (tl.ruin && !u.naval) s += 3;
      if (!u.naval && !has(S, 'fly')) {
        if ((tl.t === T.FOREST && P.techs.archery) || (tl.t === T.MOUNTAIN && P.techs.climbing)) s += 0.4;
      }
      const rk = riskAt(st, u, x, y, u.hp, lists);
      if (rk > 0) s -= mv * Math.min(1.3, rk / u.hp) * aggr * (u.hp < S.maxHp * 0.5 ? 1.8 : 1) * (D.risk == null ? 1 : D.risk);
      // aura: shaman wants to stand next to friends; others next to shamans
      if (has(S, 'aura') || has(S, 'heal')) { let f = 0; for (const o of ctx.my) if (o !== u && cheb(o.x, o.y, x, y) === 1) f++; s += Math.min(3, f) * 0.6; }
      if (i === cur) s += 0.15;
      if (s > bs) { bs = s; bt = i; }
    });
    if (bt !== cur) {
      const ev = TT.move(st, u.id, bt % W, (bt / W) | 0);
      if (ev) yield ev;
    }
  }
}

// ---------------------------------------------------------------- economy
const ROLE = {};
for (const k of TT.UNIT_ORDER) {
  const B = TT.UNITS[k], sk = s => B.skills.indexOf(s) >= 0;
  const hpF = B.hp / 10;
  const off = (B.atk * 1.3 + B.def * 0.6) * hpF + (B.move - 1) * 0.8 + (B.range - 1) * 0.9 + (sk('persist') ? 0.8 : 0) + (sk('charge') ? 0.8 : 0) + (sk('splash') ? 1 : 0) + (sk('escape') ? 0.4 : 0);
  const dfn = (B.def * 1.4 + B.atk * 0.5) * hpF + (sk('fortify') ? 0.8 : 0) + (sk('shove') ? 0.6 : 0) + (sk('aura') ? 0.8 : 0);
  const exp = B.move * 1.3 + (B.atk + B.def) * 0.3 + (sk('fly') ? 1 : 0) - (B.atk <= 0 ? 9 : 0);
  ROLE[k] = { off, dfn, exp };
}
AI.ROLE = ROLE;

// Optional rule-variant hooks (TT.AIHOOKS), unset in the game itself: techValue(st, pid, k, ctx) -> number|null,
// buildPop(st, pid, x, y, k) -> population a build would add, skipBuild { key: true }, noWalls (walls not for sale).
function techValue(st, pid, k, ctx) {
  const H = TT.AIHOOKS;
  if (H && H.techValue) { const hv = H.techValue(st, pid, k, ctx); if (hv != null) return hv; }
  const t = ctx.terr, w = ctx.war, P = st.players[pid];
  const rem = TT.TECH_ORDER.filter(q => !P.techs[q]).length;
  switch (k) {
    case 'organization': return t.fruit * 1.7 + 0.7;
    case 'hunting': return t.game * 1.7 + 0.7;
    case 'fishing': return t.fish * 1.7 + (ctx.wantsPort ? 6 : 0) + 0.4 + t.coast * 0.1;
    case 'climbing': return t.mountain * 0.25 + 0.8 + (ctx.mountainBlocked ? 3 : 0);
    case 'riding': return 1.6 + (st.turn < 14 ? ctx.freeVillages * 0.5 : 0) + w * 0.8 + (ctx.exploredFrac < 0.5 ? 1 : 0);
    case 'farming': return t.crop * 2.6 + 0.3;
    case 'mining': return t.ore * 2.6 + 0.3;
    case 'forestry': return t.forest * 0.7 + 0.6 + w * 0.5;
    case 'shields': return (ctx.threatened.length ? 4 : 0.6) + w * 0.6;
    case 'archery': return 1 + w * 1.6;
    case 'meditation': return 0.4 + w * 0.6;
    case 'ballooning': return 0.8 + (ctx.wantsPort ? 1.2 : 0) + w * 0.5;
    case 'sailing': return ctx.wantsSail ? 5 : ctx.enemyNaval ? 2 : (ctx.hasPort ? 1 : 0.2);
    case 'chivalry': return w * 3.4 + 0.6;
    case 'construction': return ctx.threatened.length * 2 + 0.3;
    case 'philosophy': return rem * 0.35 + w * 0.8;
    case 'smithery': return w * 3 + 0.8;
    case 'navigation': return ctx.enemyNaval || ctx.wantsSail ? 2.5 + w : 0.3;
    case 'mathematics': return w * 3 + 0.6;
    case 'roads': return 0.5 + ctx.myCities.length * 0.25;
    case 'trade': return ctx.myCities.length * 0.9;
    case 'diplomacy': return 0.5 + TT.metRivals(st, pid).length * 0.7 + w * 1.2;
    case 'whaling': return (ctx.terr.whale || 0) * 2.4 + 0.3;
    case 'aquatism': return ctx.enemyNaval ? 2 : 0.3;
    case 'spiritualism': return 0.4 + (t.forest + (ctx.terr.field || 0)) * 0.12;
  }
  return 0.5;
}

function econCandidates(st, pid, ctx, D, jitter) {
  const W = st.W, P = st.players[pid], H = TT.AIHOOKS;
  const out = [];
  const threatened = ctx.threatened.length > 0;
  const lateF = st.turn > 22 ? 0.75 : 1;
  // techs
  for (const k of TT.TECH_ORDER) {
    if (!TT.canResearch(st, pid, k, true)) continue;
    const cost = TT.techCost(st, pid, k);
    let v = techValue(st, pid, k, ctx);
    // unlock value of children
    for (const q of TT.TECH_ORDER) if (TT.TECHS[q].req === k) v += techValue(st, pid, q, ctx) * 0.25;
    out.push({ kind: 'tech', key: k, cost, pri: v / cost * jitter() * (threatened ? 0.6 : 1), exec: () => TT.research(st, k) });
  }
  // builds
  for (let i = 0; i < ctx.N; i++) {
    const tl = st.tiles[i];
    if (tl.owner !== pid) continue;
    const x = i % W, y = (i / W) | 0;
    for (const k of TT.buildOptions(st, pid, x, y)) {
      const B = TT.BUILD[k];
      if (!P.techs[B.tech] || k === 'clear' || k === 'road' || k === 'grow' || (H && H.skipBuild && H.skipBuild[k])) continue;
      if (k === 'market') { const gain = TT.marketYield(st, i); out.push({ kind: 'build', key: k, cost: B.cost, pri: gain * 3.2 / B.cost * jitter(), exec: () => TT.build(st, x, y, k) }); continue; }
      const c = st.cities[tl.city];
      const need = c.level + 1 - c.pop, pop = H && H.buildPop ? H.buildPop(st, pid, x, y, k) : B.pop;
      let v = pop * 2 * lateF + (pop >= need ? 3 + (c.capital ? 0.5 : 0) : pop / need * 1.2);
      if (k === 'port') v += ctx.wantsPort && !ctx.hasPort ? 9 : 0;
      if (k === 'whale') v += 3;
      const cost = Math.max(1, B.cost);
      out.push({ kind: 'build', key: k, cost: Math.max(0, B.cost), pri: v / cost * jitter() * (threatened ? 0.6 : 1), exec: () => TT.build(st, x, y, k) });
    }
  }
  // walls
  if (P.techs.construction && !(H && H.noWalls)) for (const c of ctx.myCities) {
    if (c.walls) continue;
    const th = ctx.cityThreat[c.id];
    if (th.threat > 1) out.push({ kind: 'walls', cost: 5, pri: (th.threat * 0.4 + (c.capital ? 1 : 0)) / 5 * 2, exec: () => TT.buildWalls(st, c.id) });
  }
  // units
  const nUnits = ctx.my.length;
  const expanders = ctx.my.filter(u => TT.UNITS[u.type].atk > 0 && !u.naval).length;
  const freeVillages = ctx.villages.length;
  const desiredArmy = 2 + ctx.myCities.length * (1 + ctx.war * 0.5) + (ctx.enemies.length ? 2 : 0);
  for (const c of ctx.myCities) {
    if (TT.unitAt(st, c.x, c.y)) continue;
    if (TT.cityUnits(st, c) >= TT.cityCap(c)) continue;
    const th = ctx.cityThreat[c.id];
    let needDef = th.threat > th.defense * 0.8 + 0.3 ? 2.8 + th.threat * 0.3 : 0;
    let needExp = freeVillages > 0 && expanders < freeVillages + ctx.myCities.length ? (st.turn <= 14 ? 2.1 : 1.3) : 0;
    if (ctx.exploredFrac < 0.45 && st.turn < 12) needExp = Math.max(needExp, 1.1);
    let needOff = nUnits < desiredArmy ? 1.1 + (desiredArmy - nUnits) * 0.2 : 0.35;
    needOff *= Math.min(1.6, 0.5 + ctx.war * 0.6);
    // city near the front matters more for offense
    let nearE = 99;
    for (const ec of ctx.enemyCities) nearE = Math.min(nearE, cheb(ec.x, ec.y, c.x, c.y));
    if (nearE < 7) needOff *= 1.25;
    let bestU = null;
    for (const k of TT.UNIT_ORDER) {
      const B = TT.UNITS[k];
      if (B.tech && !P.techs[B.tech]) continue;
      const R = ROLE[k], sq = Math.sqrt(B.cost);
      let q = Math.max(needDef * R.dfn, needExp * R.exp, needOff * R.off) / sq / 2.6;
      if (k === 'mindbender') q = ctx.enemies.length >= 3 && ctx.war > 0.8 ? 1.2 : 0.2;
      if (k === 'cloak') q = ctx.enemyCities.length && ctx.war > 0.6 && !ctx.my.some(o => o.type === 'cloak') ? 2.2 : 0.05;
      if (k === 'balloon' && ctx.wantsPort && !ctx.hasPort) q *= 1.4;
      if (k === 'catapult' && ctx.enemyCities.length === 0) q *= 0.5;
      q *= jitter();
      if (!bestU || q > bestU.pri) bestU = { kind: 'unit', key: k, cost: B.cost, pri: q, exec: () => TT.train(st, c.id, k) };
    }
    if (bestU) out.push(bestU);
  }
  if (P.techs.diplomacy && !P.embassy) {
    const cap = ctx.myCities.find(c => c.capital), met = TT.metRivals(st, pid).length;
    if (cap && met) out.push({ kind: 'embassy', cost: 5, pri: met * 1.6 / 5, exec: () => TT.buildEmbassy(st, cap.id) });
  }
  // naval upgrades
  for (const u of ctx.my) {
    if (!u.naval) continue;
    for (const k of TT.upgradeOptions(st, u)) {
      const cost = TT.NAVAL[k].cost;
      const v = (k === 'battleship' ? 7 : 4) * (ctx.enemyNaval ? 1.5 : 1) * (ctx.war > 0.8 ? 1.2 : 0.6);
      out.push({ kind: 'upgrade', cost, pri: v / cost * jitter(), exec: () => TT.upgrade(st, u.id, k) });
    }
  }
  return out;
}

function* economy(st, pid, D, jitter) {
  const P = st.players[pid];
  for (let iter = 0; iter < 80; iter++) {
    if (st.over) return;
    if (D.econSkip && Math.random() < D.econSkip) return;
    const ctx = analyze(st, pid);
    econAnalysis(st, pid, ctx);
    const cands = econCandidates(st, pid, ctx, D, jitter).filter(c => c.pri > 0);
    if (!cands.length) return;
    cands.sort((a, b) => b.pri - a.pri);
    const affordable = cands.filter(c => c.cost <= P.stars);
    if (!affordable.length) return;
    const best = affordable[0], top = cands[0];
    if (top !== best && top.cost <= P.stars + TT.income(st, pid) + 1 && top.pri > best.pri * 1.5) return; // save up
    const inc = Math.max(1, TT.income(st, pid));
    const floor = 0.3 / (1 + Math.max(0, P.stars - inc) / (inc * 1.5));
    if (best.pri < floor) return;
    const ev = best.exec();
    if (!ev) return;
    yield ev;
    yield* resolveRewards(st, pid);
  }
}

})(typeof window !== 'undefined' ? window : globalThis);
