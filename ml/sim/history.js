// Action history of a game, with what each player could see.
// Every top-level action is stored as a tuple (see actions.js) together with the set of players who saw it happen.
// The actor always sees its own actions; rivals see an action only through their own fog of war:
//   unit actions      the unit was visible to them before or after the action (stealth respected)
//   attack / convert  they could see the attacker, or the target tile, or the target was theirs
//   city actions      they have explored the city tile (captures: also the city's previous owner)
//   build             they have explored the tile
//   power             everyone (the game announces it)
//   research          nobody else
'use strict';
const TT = require('./tt');
const A = require('./actions');

class History {
  constructor(entries) { this.entries = entries || []; } // { turn, pid, t, seen: [pid...] }
  clone() { return new History(this.entries.slice()); }

  attach(st) {
    TT.ML.listen(st, {
      before: (s, name, args) => this._before(s, name, args),
      after: (s, name, args, r, ctx) => { if (r && ctx) this._after(s, name, args, ctx); },
    });
    return this;
  }

  _before(st, name, args) {
    const t = A.fromCommand(st, name, args);
    const n = st.players.length, pid = st.current, seen = new Array(n).fill(false);
    seen[pid] = true;
    const W = st.W, exp = (o, x, y) => !!st.players[o].explored[y * W + x];
    const U = id => TT.getUnit(st, id);
    let unit = null, city = null, post = false;
    switch (name) {
      case 'move': case 'recover': case 'healOthers': case 'disband': case 'upgrade': case 'examine': unit = U(args[0]); post = name === 'move'; break;
      case 'infiltrate': { unit = U(args[0]); const c = TT.canInfiltrate(st, unit); if (c) { city = c; seen[c.owner] = true; } break; }
      case 'attack': {
        unit = U(args[0]);
        const d = U(args[1]);
        if (d) { seen[d.owner] = true; for (let o = 0; o < n; o++) if (exp(o, d.x, d.y)) seen[o] = true; }
        break;
      }
      case 'capture': { unit = U(args[0]); const tl = st.tiles[unit.y * W + unit.x]; city = st.cities[tl.site]; if (city && city.owner >= 0) seen[city.owner] = true; post = true; break; }
      case 'train': case 'chooseReward': case 'buildWalls': case 'buildEmbassy': city = st.cities[args[0]]; break;
      case 'build': for (let o = 0; o < n; o++) if (exp(o, args[0], args[1])) seen[o] = true; break;
      case 'usePower': seen.fill(true); break;
    }
    if (unit) for (let o = 0; o < n; o++) if (TT.visibleTo(st, unit, o)) seen[o] = true;
    if (city) for (let o = 0; o < n; o++) if (exp(o, city.x, city.y)) seen[o] = true;
    return { t, turn: st.turn, pid, seen, uid: unit && post ? unit.id : -1, cid: city ? city.id : -1 };
  }

  _after(st, name, args, ctx) {
    const n = st.players.length;
    if (ctx.uid >= 0) { const u = TT.getUnit(st, ctx.uid); if (u) for (let o = 0; o < n; o++) if (TT.visibleTo(st, u, o)) ctx.seen[o] = true; }
    if (name === 'capture' && ctx.cid >= 0) { const c = st.cities[ctx.cid]; for (let o = 0; o < n; o++) if (st.players[o].explored[c.y * st.W + c.x]) ctx.seen[o] = true; }
    const seen = [];
    for (let o = 0; o < n; o++) if (ctx.seen[o]) seen.push(o);
    this.entries.push({ turn: ctx.turn, pid: ctx.pid, t: ctx.t, seen });
  }

  // Turns as seen by `viewer`, oldest first: [{ turn, pid, actions: [tuple...] }]. end_turn markers close a turn.
  turnsSeenBy(viewer, fromTurn) {
    const out = [];
    let cur = null;
    for (const e of this.entries) {
      if (e.turn < fromTurn) continue;
      if (!cur || cur.turn !== e.turn || cur.pid !== e.pid) { cur = { turn: e.turn, pid: e.pid, actions: [] }; out.push(cur); }
      if (e.t[1] === 'end_turn') continue;
      if (e.seen.indexOf(viewer) >= 0) cur.actions.push(e.t);
    }
    return out;
  }
}

module.exports = { History };
