// One-time (and repeatable) Supabase setup through the Management API:
//   node scripts/supabase-setup.js --site https://your-game.vercel.app
// 1. applies supabase/migrations/*.sql (safe to re-run)
// 2. sets the auth Site URL and allowed redirect URLs (your site + local dev)
// 3. turns on Google sign-in when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set
// Reads SUPABASE_URL and SUPABASE_ACCESS_TOKEN (a personal access token) from the environment or .env.local.
const fs = require('fs');
const path = require('path');
require('../env')();

const URL0 = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const ref = (URL0.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/) || [])[1];
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const site = (arg('--site') || process.env.SITE_URL || '').replace(/\/+$/, '');
if (!ref || !TOKEN) { console.error('Set SUPABASE_URL (https://<ref>.supabase.co) and SUPABASE_ACCESS_TOKEN in .env.local first.'); process.exit(1); }

async function api(method, p, body) {
  const r = await fetch('https://api.supabase.com/v1/projects/' + ref + p, { method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(method + ' ' + p + ' -> ' + r.status + ': ' + text.slice(0, 400));
  return text ? JSON.parse(text) : null;
}

(async () => {
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    await api('POST', '/database/query', { query: fs.readFileSync(path.join(dir, f), 'utf8') });
    console.log('applied', f);
  }
  const allow = ['http://localhost:3000/**'];
  if (site) allow.unshift(site + '/**');
  const auth = { uri_allow_list: allow.join(',') };
  if (site) auth.site_url = site;
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    Object.assign(auth, { external_google_enabled: true, external_google_client_id: process.env.GOOGLE_CLIENT_ID, external_google_secret: process.env.GOOGLE_CLIENT_SECRET });
  }
  await api('PATCH', '/config/auth', auth);
  console.log('auth: redirect URLs', allow.join(', ') + (site ? '; site ' + site : '') + (auth.external_google_enabled ? '; Google sign-in on' : '; Google sign-in not configured (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)'));
  console.log('Google console: add this authorized redirect URI to your OAuth client: ' + URL0 + '/auth/v1/callback');
})().catch(e => { console.error(e.message); process.exit(1); });
