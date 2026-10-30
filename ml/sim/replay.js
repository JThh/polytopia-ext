// Per-action replay frames of a running Session, for the replay viewer (ml/scripts/record_replay.py).
// The recorder chains onto the game's action listener: every top-level action still goes to the Session's History
// exactly as before (so prompts are unchanged), and also produces a frame with the board after the action.
// Frames are compact: tiles as a diff against the previous frame, units/cities/players in full (they are small).
'use strict';
const TT = require('./tt');
const A = require('./actions');

// tile: [terrain, elevation, owner, territory city, city site, resource, improvement, road, ruin]
const encTile = tl => [tl.t, tl.e || 0, tl.owner, tl.city, tl.site, tl.res || 0, tl.imp || 0, tl.road ? 1 : 0, tl.ruin ? 1 : 0];

class Recorder {
  constructor(sess, viewer) {
    const st = sess.st, hist = sess.hist;
    this.viewer = viewer;
    this.frames = [];
    this.seq = 0;
    this.prevTiles = st.tiles.map(tl => JSON.stringify(encTile(tl)));
    this.prevExp = Array.from(st.players[viewer].explored, v => (v ? 1 : 0));
    this.frames.push({
      k: 'init', W: st.W, H: st.H, viewer,
      settings: { size: st.settings.size, mapType: st.settings.mapType, mode: st.settings.mode, turnLimit: st.settings.turnLimit },
      players: st.players.map(P => ({ id: P.id, tribe: P.tribe, name: P.name, color: P.color, ai: !!P.isAI, difficulty: P.difficulty || null })),
      tiles: st.tiles.map(encTile), explored: this.prevExp.slice(), ...this.dyn(st),
    });
    TT.ML.listen(st, {
      before: (s, name, args) => ({ h: hist._before(s, name, args), pid: s.current }),
      after: (s, name, args, r, ctx) => {
        if (r && ctx.h) hist._after(s, name, args, ctx.h);
        this.frame(s, name, r, ctx);
      },
    });
  }

  dyn(st) {
    return {
      turn: st.turn, cur: st.current, over: !!st.over,
      units: st.units.map(u => [u.id, u.type, u.owner, u.x, u.y, u.hp, TT.stats(st, u).maxHp, u.vet ? 1 : 0, u.naval || 0]),
      cities: st.cities.map(c => [c.id, c.x, c.y, c.owner, c.level, c.pop, c.capital ? 1 : 0, c.walls ? 1 : 0, c.name || '', TT.cityCap(c)]),
      pl: st.players.map(P => [P.alive ? 1 : 0, P.alive ? P.stars : 0, P.alive ? TT.income(st, P.id) : 0, P.alive ? TT.score(st, P.id) : 0,
        Object.keys(P.techs).length]),
    };
  }

  frame(st, name, r, ctx) {
    const dt = [], ex = [];
    st.tiles.forEach((tl, i) => {
      const e = encTile(tl), s = JSON.stringify(e);
      if (s !== this.prevTiles[i]) { this.prevTiles[i] = s; dt.push([i, e]); }
    });
    const exp = st.players[this.viewer].explored;
    for (let i = 0; i < exp.length; i++) if (exp[i] && !this.prevExp[i]) { this.prevExp[i] = 1; ex.push(i); }
    const t = ctx.h ? ctx.h.t : null;
    this.frames.push({ i: ++this.seq, pid: ctx.pid, verb: name, a: t ? A.formatTuple(t) : name, ok: !!r, dt, ex, ...this.dyn(st) });
  }

  take() { const f = this.frames; this.frames = []; return f; }
}

module.exports = { Recorder };
