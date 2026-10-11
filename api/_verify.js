// Replays a finished game with the same rules engine the browsers use, so game records can't be invented by a
// modified client. Online games: every move must come from a player who controls that seat at that point.
// Solo games: the log must replay legally to a finished game (bot moves can't be checked, since bots think in the
// player's browser).
require('../src/engine.js');
const TT = globalThis.TT;

class VerifyError extends Error {}
const fail = (i, why) => { throw new VerifyError('entry ' + i + ': ' + why); };

// places follow the victory mode (see TT.standings): score games by score, domination by survival
function placings(st) {
  const out = {};
  TT.standings(st).forEach(r => { out[r.seat] = { place: r.place, score: TT.score(st, r.seat) }; });
  return out;
}
function runCommands(st, cmds, i, seat) {
  for (const c of cmds) {
    if (st.over) return;   // the result is fixed at the moment the game ended; later no-op end-turns are ignored
    if (seat != null && st.current !== seat) fail(i, 'moved out of turn');
    if (!Array.isArray(c) || TT.ACTIONS.indexOf(c[0]) < 0) fail(i, 'unknown command');
    if (!TT.exec(st, c)) fail(i, 'illegal ' + c[0]);
  }
}

// final: the room's fixed settings; players: [{ seat, user_id }]; moves: [{ author, seat, sys, cmds }] in log order
function verifyOnline({ final, players, moves }) {
  const st = TT.newGame(final);
  const humans = new Set(final.humans || []);
  const seatOf = new Map(players.map(p => [p.user_id, p.seat]));
  const bots = new Set(st.players.filter(P => !humans.has(P.id)).map(P => P.id));
  moves.forEach((m, i) => {
    const mine = seatOf.get(m.author);
    if (mine === undefined) fail(i, 'sent by someone who is not seated');
    if (m.sys === 'botify') {
      if (!humans.has(m.seat)) fail(i, 'handed a bot seat to a bot');
      bots.add(m.seat); st.players[m.seat].isAI = true; return;
    }
    if (m.sys === 'human') {
      if (m.seat !== mine) fail(i, 'took back someone else’s seat');
      bots.delete(m.seat); st.players[m.seat].isAI = false; return;
    }
    if (m.seat !== mine && !bots.has(m.seat)) fail(i, 'moved a seat the sender does not control');
    runCommands(st, m.cmds || [], i, m.seat);
  });
  if (!st.over) return { over: false, turn: st.turn };
  const pl = placings(st);
  return {
    over: true, winner: st.over.winner, reason: st.over.reason, turn: st.turn,
    seats: st.players.map(P => ({ seat: P.id, tribe: P.tribe, bot: !humans.has(P.id) })),
    results: players.filter(p => humans.has(p.seat)).map(p => ({
      seat: p.seat, user_id: p.user_id, tribe: st.players[p.seat].tribe,
      won: st.over.winner === p.seat && !bots.has(p.seat), left: bots.has(p.seat), place: pl[p.seat].place, score: pl[p.seat].score,
    })),
  };
}

const SOLO_KEYS = ['tribe', 'opponents', 'difficulty', 'size', 'mapType', 'mode', 'turnLimit', 'relief', 'events', 'fog', 'dayCycle', 'seed'];
function cleanSolo(settings) {
  const s = {};
  for (const k of SOLO_KEYS) if (settings && settings[k] !== undefined) s[k] = settings[k];
  if (!Number.isInteger(s.seed) || s.seed <= 0) throw new VerifyError('missing seed');
  if (!TT.tribe(s.tribe)) throw new VerifyError('unknown tribe');
  if (!TT.MAP_SIZES[s.size] || !TT.MAP_TYPES[s.mapType] || !TT.DIFFICULTY[s.difficulty]) throw new VerifyError('unknown settings');
  s.opponents = Math.max(1, Math.min(5, s.opponents | 0));
  s.turnLimit = 30;
  return Object.assign(s, { spectate: false, humans: [0], tribes: null });
}
function verifySolo({ settings, log }) {
  const S = cleanSolo(settings);
  if (!Array.isArray(log) || log.length > 40000) throw new VerifyError('bad log');
  const st = TT.newGame(S);
  runCommands(st, log, 0, null);
  if (!st.over) return { over: false, turn: st.turn };
  const pl = placings(st);
  return {
    over: true, winner: st.over.winner, reason: st.over.reason, turn: st.turn, settings: S,
    seats: st.players.map(P => ({ seat: P.id, tribe: P.tribe, bot: P.id !== 0 })),
    result: { seat: 0, tribe: st.players[0].tribe, won: st.over.winner === 0, left: false, place: pl[0].place, score: pl[0].score },
  };
}

module.exports = { verifyOnline, verifySolo, VerifyError };
