// GET  /api/scores  -> { scores: [{ name, tribe, score, turn, mode, difficulty, won, at }] }  (top 20)
// POST /api/scores  { name, tribe, score, turn, mode, difficulty, won }  -> 201
const { configured, redis } = require('./_store');
const KEY = 'tessera:scores';
const TRIBES = ['verdant', 'ironpeak', 'tidecallers', 'emberfolk', 'frostkin', 'sunspire'];
const MODES = ['domination', 'score'];
const DIFFS = ['easy', 'normal', 'hard', 'crazy'];
const cleanName = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>"`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!configured()) return res.status(503).json({ error: 'Leaderboard storage is not configured.' });
  try {
    if (req.method === 'GET') {
      const raw = await redis(['ZRANGE', KEY, '0', '19', 'REV', 'WITHSCORES']);
      const scores = [];
      for (let i = 0; i < raw.length; i += 2) { try { scores.push(Object.assign(JSON.parse(raw[i]), { score: Number(raw[i + 1]) })); } catch (e) { /* skip bad rows */ } }
      return res.status(200).json({ scores });
    }
    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = null; } }
      if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Send a JSON body.' });
      const name = cleanName(b.name), score = int(b.score, 0, 250000), turn = int(b.turn, 1, 400);
      if (!name) return res.status(400).json({ error: 'Name is required.' });
      if (score == null || turn == null) return res.status(400).json({ error: 'Score or turn is out of range.' });
      if (!TRIBES.includes(b.tribe) || !MODES.includes(b.mode) || !DIFFS.includes(b.difficulty)) return res.status(400).json({ error: 'Unknown tribe, mode or difficulty.' });
      const entry = { name, tribe: b.tribe, turn, mode: b.mode, difficulty: b.difficulty, won: !!b.won, at: Date.now() };
      await redis(['ZADD', KEY, String(score), JSON.stringify(entry)]);
      await redis(['ZREMRANGEBYRANK', KEY, '0', '-501']); // keep the best 500
      return res.status(201).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (e) {
    return res.status(502).json({ error: 'Leaderboard storage is unavailable right now.' });
  }
};
