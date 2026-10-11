// Server-side Supabase access over its REST API with the service-role (secret) key. Never sent to browsers.
// Files starting with "_" are not routes on Vercel.
const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const PUBLIC_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';

exports.url = URL;
exports.publicKey = PUBLIC_KEY;
exports.configured = () => !!(URL && SERVICE);
// new-style keys (sb_secret_...) go in the apikey header only; legacy JWT keys also as the bearer token
const serviceHeaders = () => (SERVICE.startsWith('sb_') ? { apikey: SERVICE } : { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE });

async function rest(method, path, body, extra) {
  const r = await fetch(URL + '/rest/v1/' + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, serviceHeaders(), extra || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error('storage ' + r.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}
exports.get = path => rest('GET', path);
exports.getAll = async path => {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const page = await rest('GET', path + '&offset=' + off + '&limit=1000');
    out.push(...page);
    if (page.length < 1000) return out;
  }
};
exports.insertIgnore = (table, rows, onConflict) => rest('POST', table + '?on_conflict=' + onConflict, rows, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
exports.patch = (path, body) => rest('PATCH', path, body, { Prefer: 'return=minimal' });

// who is calling: checks the player's access token with Supabase Auth
exports.userFromToken = async token => {
  if (!token) return null;
  const r = await fetch(URL + '/auth/v1/user', { headers: { apikey: PUBLIC_KEY || SERVICE, Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j && j.id ? j : null;
};
