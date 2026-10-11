// GET /api/health -> { ok, online, records }
// online: the page was given Supabase settings; records: this server can verify and record finished games.
const sb = require('./_sb');
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, online: !!(sb.url && sb.publicKey), records: sb.configured() });
};
