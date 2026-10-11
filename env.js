// Loads .env.local / .env into process.env for the build and the local dev server (Vercel sets real env vars).
const fs = require('fs');
const path = require('path');
module.exports = function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(__dirname, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
};
