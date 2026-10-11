// Local preview that mimics Vercel: serves public/ and runs api/*.js as functions.
// Without storage env vars it uses an in-memory leaderboard (wiped on restart).
const http = require('http');
const fs = require('fs');
const path = require('path');
if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) process.env.TESSERA_DEV_MEMORY = '1';
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
    const file = path.join(__dirname, 'api', name + '.js');
    if (!name || name.startsWith('_') || !fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      req.query = Object.fromEntries(url.searchParams);
      try { req.body = raw && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : raw; } catch (e) { req.body = raw; }
      try { await require(file)(req, res); } catch (e) { console.error(e); res.status(500).json({ error: 'Function crashed' }); }
    });
    return;
  }
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = path.join(__dirname, 'public', p);
  if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('Tessera Tribes on http://localhost:' + PORT + (process.env.TESSERA_DEV_MEMORY ? '  (in-memory leaderboard)' : '')));
