// Builds public/index.html: one self-contained page (game + styles inlined). No dependencies.
// Online play is switched on when SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) are set, in the
// environment or in .env.local. Both are public by design; the database is protected by row-level security.
const fs = require('fs');
const path = require('path');
require('./env')();
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const shell = src('shell.html');
const js = ['engine', 'ai', 'art', 'renderIso', 'online', 'ui'].map(f => '// ---- ' + f + '.js\n' + src(f + '.js')).join('\n');
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), SB_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
// supabase-js, pinned and integrity-checked
const SB_JS = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js" integrity="sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok" crossorigin="anonymous"></script>\n';
const online = SB_URL && SB_KEY ? SB_JS + '<script>window.TESSERA_CONFIG = ' + JSON.stringify({ supabaseUrl: SB_URL, supabaseKey: SB_KEY }).replace(/</g, '\\u003c') + ';</script>\n' : '';
if (js.includes('</script')) throw new Error('script terminator inside JS');
const split = shell.indexOf('<div id="app">');
const head = shell.slice(0, split), body = shell.slice(split);
const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="12" fill="#4fb84a"/><path d="M20 22h24M32 22v24" stroke="#161a3a" stroke-width="8" stroke-linecap="round"/></svg>');
const page = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="theme-color" content="#1b1f45">\n<meta name="description" content="A hand-drawn turn-based tribe strategy game with smart bots.">\n<link rel="icon" href="' + icon + '">\n' + head + '\n</head>\n<body>\n' + body + '\n' + online + '<script>\n' + js + '\n</script>\n</body>\n</html>\n';
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), page);
console.log('built public/index.html', (page.length / 1024).toFixed(1) + ' KB', online ? '(online play on: ' + SB_URL + ')' : '(online play off: no Supabase settings)');
// Optional: an embed without <html>/<head>, used when publishing as a Claude artifact.
if (process.argv.includes('--artifact')) {
  fs.mkdirSync(path.join(__dirname, '.artifact'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '.artifact', 'tessera-tribes.html'), shell + '\n<script>\n' + js + '\n</script>\n');
  console.log('built .artifact/tessera-tribes.html');
}
