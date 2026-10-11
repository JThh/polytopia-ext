// Storage for the leaderboard and online rooms. Uses Upstash Redis over its REST API, which is what
// Vercel's Redis marketplace integration provisions. Files starting with "_" are not routes on Vercel.
const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DEV_MEMORY = process.env.TESSERA_DEV_MEMORY === '1';

// Append items to a list only if it still has the expected length (optimistic lock for room logs).
const PUSH_IF_LEN = "if redis.call('LLEN', KEYS[1]) == tonumber(ARGV[1]) then for i = 3, #ARGV do redis.call('RPUSH', KEYS[1], ARGV[i]) end redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) return redis.call('LLEN', KEYS[1]) else return -1 end";

// ---- in-memory stand-in, only for `npm run dev` without real storage
const mem = new Map();
const zset = k => { let z = mem.get(k); if (!z) { z = []; mem.set(k, z); } return z; };
function memCommand(cmd) {
  const [op, key, ...a] = cmd;
  switch (op) {
    case 'ZADD': { const z = zset(key); z.push({ score: Number(a[0]), member: a[1] }); z.sort((x, y) => x.score - y.score); return 1; }
    case 'ZRANGE': { const z = zset(key).slice().reverse().slice(Number(a[0]), Number(a[1]) + 1); return z.flatMap(e => [e.member, String(e.score)]); }
    case 'ZREMRANGEBYRANK': { const z = zset(key), keep = -Number(a[1]) - 1; if (z.length > keep) z.splice(0, z.length - keep); return 0; }
    case 'GET': { const v = mem.get(key); return v == null ? null : v; }
    case 'MGET': return [key].concat(a).map(k => (mem.has(k) ? mem.get(k) : null));
    case 'SET': { const nx = a.includes('NX'); if (nx && mem.has(key)) return null; mem.set(key, a[0]); return 'OK'; }
    case 'HSET': { let h = mem.get(key); if (!h) { h = {}; mem.set(key, h); } for (let i = 0; i < a.length; i += 2) h[a[i]] = a[i + 1]; return 1; }
    case 'HGETALL': { const h = mem.get(key) || {}; return Object.entries(h).flat(); }
    case 'LRANGE': { const l = mem.get(key) || []; const s = Number(a[0]), e = Number(a[1]); return l.slice(s, e < 0 ? l.length + e + 1 : e + 1); }
    case 'LLEN': return (mem.get(key) || []).length;
    case 'EXPIRE': return 1;
    default: throw new Error('unsupported in dev memory store: ' + op);
  }
}

exports.configured = () => !!(URL && TOKEN) || DEV_MEMORY;
async function redis(cmd) {
  if (!(URL && TOKEN)) { if (DEV_MEMORY) return memCommand(cmd); throw new Error('storage not configured'); }
  const r = await fetch(URL, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd.map(String)) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j.result;
}
exports.redis = redis;
exports.pushIfLen = async function (key, base, items, ttl) {
  if (!(URL && TOKEN) && DEV_MEMORY) {
    let l = mem.get(key); if (!l) { l = []; mem.set(key, l); }
    if (l.length !== base) return -1;
    l.push(...items); return l.length;
  }
  return Number(await redis(['EVAL', PUSH_IF_LEN, '1', key, String(base), String(ttl)].concat(items)));
};
