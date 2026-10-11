// POST /api/finish  (Authorization: Bearer <player's Supabase access token>)
//   { room_id }              -> replays the room's move log; records every person's result once the game is over
//   { solo: { settings, log } } -> replays a solo game against bots and records the caller's result
// Records are written only here, with the service-role key, after the replay succeeds.
const crypto = require('crypto');
const sb = require('./_sb');
const { verifyOnline, verifySolo, VerifyError } = require('./_verify');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const gameIdFor = (userId, settings) => {
  const h = crypto.createHash('sha256').update(userId + '|' + JSON.stringify(settings)).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '5' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
};

async function finishOnline(user, roomId) {
  const [room] = await sb.get('rooms?id=eq.' + roomId + '&select=*');
  if (!room) return [404, { error: 'No such room.' }];
  const players = await sb.get('room_players?room_id=eq.' + roomId + '&select=seat,user_id,tribe');
  if (!players.some(p => p.user_id === user.id)) return [403, { error: 'You were not in that game.' }];
  if (room.status === 'finished') {
    const rows = await sb.get('game_results?game_id=eq.' + roomId + '&select=user_id,tribe,won,left_game,place,score,turns');
    return [200, Object.assign({ already: true }, room.result, { results: rows })];
  }
  if (room.status !== 'playing') return [409, { error: 'That game is not running.' }];
  const moves = await sb.getAll('moves?room_id=eq.' + roomId + '&select=author,seat,sys,cmds&order=seq.asc');
  let v;
  try { v = verifyOnline({ final: room.final, players, moves }); }
  catch (e) { if (e instanceof VerifyError) return [422, { error: 'The game log failed verification (' + e.message + ').' }]; throw e; }
  if (!v.over) return [409, { error: 'The game is not over yet.', turn: v.turn }];
  const ids = players.map(p => p.user_id);
  const profiles = await sb.get('profiles?id=in.(' + ids.join(',') + ')&select=id,username');
  const nameOf = id => (profiles.find(p => p.id === id) || {}).username || null;
  const bySeat = new Map(players.map(p => [p.seat, p.user_id]));
  const F = room.final;
  const rows = v.results.map(r => ({
    game_id: roomId, user_id: r.user_id, kind: 'online', tribe: r.tribe, won: r.won, left_game: r.left, place: r.place, score: r.score,
    turns: v.turn, seats: v.seats.length, humans: (F.humans || []).length, difficulty: F.difficulty, map_type: F.mapType, map_size: F.size, mode: F.mode, reason: v.reason,
    opponents: v.seats.filter(s => s.seat !== r.seat).map(s => ({ username: s.bot ? null : nameOf(bySeat.get(s.seat)), tribe: s.tribe, bot: s.bot })),
  }));
  if (rows.length) await sb.insertIgnore('game_results', rows, 'game_id,user_id');
  const result = { winner: v.winner, reason: v.reason, turn: v.turn, winner_name: v.seats[v.winner].bot ? null : nameOf(bySeat.get(v.winner)), winner_tribe: v.seats[v.winner].tribe };
  await sb.patch('rooms?id=eq.' + roomId + '&status=eq.playing', { status: 'finished', finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), result });
  return [200, Object.assign({}, result, { results: rows })];
}

async function finishSolo(user, solo) {
  const [profile] = await sb.get('profiles?id=eq.' + user.id + '&select=id');
  if (!profile) return [409, { error: 'Choose a player name first.' }];
  let v;
  try { v = verifySolo(solo || {}); }
  catch (e) { if (e instanceof VerifyError) return [422, { error: 'The game log failed verification (' + e.message + ').' }]; throw e; }
  if (!v.over) return [409, { error: 'The game is not over yet.' }];
  const S = v.settings, r = v.result;
  const row = {
    game_id: gameIdFor(user.id, S), user_id: user.id, kind: 'solo', tribe: r.tribe, won: r.won, left_game: false, place: r.place, score: r.score,
    turns: v.turn, seats: v.seats.length, humans: 1, difficulty: S.difficulty, map_type: S.mapType, map_size: S.size, mode: S.mode, reason: v.reason,
    opponents: v.seats.filter(s => s.seat !== 0).map(s => ({ username: null, tribe: s.tribe, bot: true })),
  };
  await sb.insertIgnore('game_results', [row], 'game_id,user_id');
  return [200, { winner: v.winner, reason: v.reason, turn: v.turn, results: [row] }];
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!sb.configured()) return res.status(503).json({ error: 'Game records need Supabase. See the README.' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed.' }); }
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Send a JSON body.' });
  try {
    const user = await sb.userFromToken(token);
    if (!user) return res.status(401).json({ error: 'Sign in again.' });
    let out;
    if (typeof b.room_id === 'string' && UUID.test(b.room_id)) out = await finishOnline(user, b.room_id);
    else if (b.solo && typeof b.solo === 'object') out = await finishSolo(user, b.solo);
    else out = [400, { error: 'Send room_id or solo.' }];
    return res.status(out[0]).json(out[1]);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'Game records are unavailable right now.' });
  }
};
