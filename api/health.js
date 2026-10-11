// GET /api/health -> { ok, leaderboard, rooms }. The game turns on online features only when these are true.
const { configured } = require('./_store');
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const on = configured();
  res.status(200).json({ ok: true, leaderboard: on, rooms: on });
};
