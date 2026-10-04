// Quick consistency check. Run: node tools/check.js   (no install needed, not part of the app)
// 1. every script and stylesheet in index.html is in the service worker list, with the same ?v=
// 2. CACHE number matches ?v
// 3. every file in the list exists
// 4. every https host used in the code is allowed by the Content-Security-Policy
const fs = require('fs');
const read = (f) => fs.readFileSync(f, 'utf8');
const html = read('index.html'), sw = read('sw.js');
const bad = [];

const used = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)\?v=\d+)"/g)].map((m) => m[1]);
const shell = (sw.match(/const SHELL = \[([^\]]*)\]/) || [, ''])[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
for (const u of used) if (!shell.includes(u)) bad.push('Not in SHELL (or other ?v=): ' + u);
for (const f of shell) if (f !== './' && !fs.existsSync(f.split('?')[0])) bad.push('SHELL lists a missing file: ' + f);

const cache = (sw.match(/const CACHE = 'fred-v(\d+)'/) || [])[1];
const vs = new Set(used.map((u) => u.split('?v=')[1]));
if (vs.size !== 1 || !vs.has(cache)) bad.push('CACHE v' + cache + ' and ?v= (' + [...vs].join(',') + ') differ');

const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
const allowed = new Set((csp.match(/https:\/\/[a-z0-9.-]+/g) || []));
for (const f of fs.readdirSync('.').filter((n) => n.endsWith('.js') && n !== 'sw.js')) {
  for (const h of new Set(read(f).match(/https:\/\/[a-z0-9.-]+/g) || [])) {
    if (h === 'https://www.w3.org') continue; // SVG namespace, not a request
    if (!allowed.has(h)) bad.push(f + ' uses ' + h + ' which the CSP does not allow');
  }
}

console.log(bad.length ? bad.join('\n') : 'OK: service worker list, versions and CSP hosts are consistent.');
process.exit(bad.length ? 1 : 0);
