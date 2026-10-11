// Builds public/index.html: one self-contained page (game + styles inlined). No dependencies.
const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const shell = src('shell.html');
const js = ['engine', 'ai', 'art', 'renderIso', 'ui'].map(f => '// ---- ' + f + '.js\n' + src(f + '.js')).join('\n');
if (js.includes('</script')) throw new Error('script terminator inside JS');
const split = shell.indexOf('<div id="app">');
const head = shell.slice(0, split), body = shell.slice(split);
const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="12" fill="#4fb84a"/><path d="M20 22h24M32 22v24" stroke="#161a3a" stroke-width="8" stroke-linecap="round"/></svg>');
const page = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="theme-color" content="#1b1f45">\n<meta name="description" content="A hand-drawn turn-based tribe strategy game with smart bots.">\n<link rel="icon" href="' + icon + '">\n' + head + '\n</head>\n<body>\n' + body + '\n<script>\n' + js + '\n</script>\n</body>\n</html>\n';
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), page);
console.log('built public/index.html', (page.length / 1024).toFixed(1) + ' KB');
// Optional: an embed without <html>/<head>, used when publishing as a Claude artifact.
if (process.argv.includes('--artifact')) {
  fs.mkdirSync(path.join(__dirname, '.artifact'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '.artifact', 'tessera-tribes.html'), shell + '\n<script>\n' + js + '\n</script>\n');
  console.log('built .artifact/tessera-tribes.html');
}
