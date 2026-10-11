// Online rooms for live multiplayer. The server stores a lobby and an append-only command log; every
// client replays the same log with the same deterministic engine, so the server never runs game rules.
//
// GET  /api/room?id=CODE&from=N          -> { room, log: [entries from N], len }
// POST /api/room { op: 'create', name, settings }          -> { id, clientId, seat }
// POST /api/room { op: 'join', id, name, clientId? }       -> { id, clientId, seat }   (clientId rejoins the same seat)
// POST /api/room { op: 'tribe', id, clientId, tribe }      -> { ok }
// POST /api/room { op: 'start', id, clientId }             -> { ok }   (host only; open seats become bots)
// POST /api/room { op: 'push', id, clientId, base, entries } -> { len } | 409 { len }
//   entry: { seat, cmds, h } for moves; { seat, sys: 'botify' } hands a seat to a bot; { seat, sys: 'human' } takes your own seat back
const crypto = require('crypto');
const { configured, redis, pushIfLen } = require('./_store');

const TTL = 3 * 24 * 3600;
const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TRIBES = ['verdant', 'ironpeak', 'tidecallers', 'emberfolk', 'frostkin', 'sunspire'];
const SIZES = ['tiny', 'small', 'normal', 'large', 'huge'];
const MAPS = ['pangaea', 'continents', 'archipelago', 'lakes', 'highlands', 'waterworld'];
const DIFFS = ['easy', 'normal', 'hard', 'crazy'];
const k = { room: id => 'room:' + id, seat: (id, p) => 'room:' + id + ':seat:' + p, info: id => 'room:' + id + ':info', log: id => 'room:' + id + ':log' };
const cleanName = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>"`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
const newId = () => Array.from(crypto.randomBytes(5), b => CODE[b % CODE.length]).join('');
const token = () => crypto.randomBytes(16).toString('hex');

function cleanSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  const opp = Math.max(1, Math.min(5, Number(s.opponents) | 0 || 3));
  return {
    opponents: opp,
    size: SIZES.includes(s.size) ? s.size : 'small',
    mapType: MAPS.includes(s.mapType) ? s.mapType : 'pangaea',
    difficulty: DIFFS.includes(s.difficulty) ? s.difficulty : 'normal',
    mode: s.mode === 'score' ? 'score' : 'domination',
    turnLimit: 30,
    relief: ['flat', 'gentle', 'dramatic'].includes(s.relief) ? s.relief : 'dramatic',
    fog: s.fog !== false,
    events: s.events !== false,
    dayCycle: s.dayCycle !== false,
    seed: (Math.floor(Math.random() * 2147483646) + 1),
  };
}
async function loadRoom(id) {
  const raw = await redis(['GET', k.room(id)]);
  return raw ? JSON.parse(raw) : null;
}
async function seatsOf(id, room) {
  const n = room.settings.opponents + 1;
  const keys = Array.from({ length: n }, (_, p) => k.seat(id, p));
  const owners = await redis(['MGET'].concat(keys));
  const flat = await redis(['HGETALL', k.info(id)]);
  const info = {};
  for (let i = 0; i < flat.length; i += 2) info[flat[i]] = flat[i + 1];
  return Array.from({ length: n }, (_, p) => ({ pid: p, owner: owners[p] || null, name: info['n' + p] || '', tribe: info['t' + p] || null }));
}
function publicRoom(room, seats, clientId) {
  return {
    id: room.id, status: room.status, settings: room.settings, final: room.final || null, hostSeat: 0,
    seats: seats.map(s => ({ pid: s.pid, claimed: !!s.owner, name: s.name, tribe: s.tribe, mine: !!clientId && s.owner === clientId, bot: room.final ? !room.final.humans.includes(s.pid) : false })),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!configured()) return res.status(503).json({ error: 'Online rooms need storage. See the README.' });
  try {
    if (req.method === 'GET') {
      const id = String((req.query && req.query.id) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      const room = id && await loadRoom(id);
      if (!room) return res.status(404).json({ error: 'No room with that code.' });
      const from = Math.max(0, Number(req.query.from) | 0);
      const seats = await seatsOf(id, room);
      const log = room.status === 'playing' ? (await redis(['LRANGE', k.log(id), String(from), '-1'])).map(e => JSON.parse(e)) : [];
      return res.status(200).json({ room: publicRoom(room, seats, req.query.clientId), log, from, len: from + log.length });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed.' }); }
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = null; } }
    if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Send a JSON body.' });

    if (b.op === 'create') {
      const name = cleanName(b.name) || 'Host';
      const settings = cleanSettings(b.settings);
      let id = null;
      for (let i = 0; i < 6 && !id; i++) { const c = newId(); if (await redis(['SET', k.room(c), JSON.stringify({ id: c, status: 'lobby', created: Date.now(), settings }), 'NX', 'EX', String(TTL)])) id = c; }
      if (!id) return res.status(500).json({ error: 'Could not allocate a room code.' });
      const clientId = token();
      const room = await loadRoom(id); room.hostCid = clientId;
      await redis(['SET', k.room(id), JSON.stringify(room), 'EX', String(TTL)]);
      await redis(['SET', k.seat(id, 0), clientId, 'EX', String(TTL)]);
      const tribe = TRIBES.includes(b.tribe) ? b.tribe : 'verdant';
      await redis(['HSET', k.info(id), 'n0', name, 't0', tribe]);
      await redis(['EXPIRE', k.info(id), String(TTL)]);
      return res.status(201).json({ id, clientId, seat: 0 });
    }

    const id = String(b.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const room = id && await loadRoom(id);
    if (!room) return res.status(404).json({ error: 'No room with that code.' });
    const seats = await seatsOf(id, room);
    const mine = b.clientId ? seats.find(s => s.owner === b.clientId) : null;

    if (b.op === 'join') {
      if (mine) return res.status(200).json({ id, clientId: b.clientId, seat: mine.pid, rejoined: true });
      if (room.status !== 'lobby') return res.status(409).json({ error: 'That game has already started.' });
      const clientId = token(), name = cleanName(b.name) || 'Player';
      for (const s of seats) {
        if (s.owner) continue;
        if (await redis(['SET', k.seat(id, s.pid), clientId, 'NX', 'EX', String(TTL)])) {
          const taken = new Set(seats.map(x => x.tribe).filter(Boolean));
          const tribe = TRIBES.includes(b.tribe) && !taken.has(b.tribe) ? b.tribe : TRIBES.find(t => !taken.has(t));
          await redis(['HSET', k.info(id), 'n' + s.pid, name, 't' + s.pid, tribe]);
          return res.status(200).json({ id, clientId, seat: s.pid });
        }
      }
      return res.status(409).json({ error: 'That room is full.' });
    }
    if (!mine) return res.status(403).json({ error: 'You are not seated in this room.' });

    if (b.op === 'tribe') {
      if (room.status !== 'lobby') return res.status(409).json({ error: 'The game has started.' });
      if (!TRIBES.includes(b.tribe)) return res.status(400).json({ error: 'Unknown tribe.' });
      if (seats.some(s => s.pid !== mine.pid && s.tribe === b.tribe)) return res.status(409).json({ error: 'Another player has that tribe.' });
      await redis(['HSET', k.info(id), 't' + mine.pid, b.tribe]);
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'start') {
      if (room.hostCid !== b.clientId) return res.status(403).json({ error: 'Only the host can start.' });
      if (room.status !== 'lobby') return res.status(200).json({ ok: true });
      const humans = seats.filter(s => s.owner).map(s => s.pid);
      const tribes = seats.map(s => (s.owner ? s.tribe : null));
      room.status = 'playing';
      room.final = Object.assign({}, room.settings, { humans, tribes, spectate: false });
      await redis(['SET', k.room(id), JSON.stringify(room), 'EX', String(TTL)]);
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'push') {
      if (room.status !== 'playing') return res.status(409).json({ error: 'The game has not started.' });
      const entries = Array.isArray(b.entries) ? b.entries.slice(0, 50) : [];
      if (!entries.length) return res.status(400).json({ error: 'Nothing to push.' });
      const items = [];
      for (const e of entries) {
        if (!e || typeof e !== 'object' || !Number.isInteger(e.seat) || e.seat < 0 || e.seat >= seats.length) return res.status(400).json({ error: 'Bad entry.' });
        const sys = e.sys === 'botify' || e.sys === 'human' ? e.sys : undefined;
        if (sys === 'human' && e.seat !== mine.pid) return res.status(403).json({ error: 'You can only take back your own seat.' });
        const s = JSON.stringify({ seat: e.seat, cmds: sys ? [] : Array.isArray(e.cmds) ? e.cmds.slice(0, 400) : [], h: String(e.h || '').slice(0, 16), sys, cid: b.clientId.slice(0, 8) });
        if (s.length > 60000) return res.status(413).json({ error: 'Entry too large.' });
        items.push(s);
      }
      const base = Math.max(0, Number(b.base) | 0);
      const len = await pushIfLen(k.log(id), base, items, TTL);
      if (len < 0) { const cur = Number(await redis(['LLEN', k.log(id)])); return res.status(409).json({ error: 'Out of date; resync.', len: cur }); }
      return res.status(200).json({ len });
    }
    return res.status(400).json({ error: 'Unknown op.' });
  } catch (e) {
    return res.status(502).json({ error: 'Room storage is unavailable right now.' });
  }
};
