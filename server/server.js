// BBHS hiring software — one web app: forms, client account, candidate account and team portal.
// Run: npm start   (Node 22.5+; uses only Node's built-in modules)
const http = require('http');
const fs = require('fs');
const path = require('path');
const D = require('./db');
const R = require('./router');
require('./api-team');
require('./api-public');
require('./crm');
const { seed } = require('./seed');
const timer = require('./timer');

const PORT = Number(process.env.PORT) || 4600;
const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
// The five web addresses each open the one page; the page shows only that part.
const PAGES = ['/', '/hire', '/apply', '/my-account', '/my-profile', '/team'];

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN', ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 25 * 1024 * 1024) { reject(D.httpError(413, 'Upload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); if (!s) return resolve({}); try { resolve(JSON.parse(s)); } catch { reject(D.httpError(400, 'Bad request')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const out = await R.dispatch(req, res, url, body);
      if (out && out.__file) {
        const f = out.__file;
        return send(res, 200, f.buf, { 'Content-Type': f.mime, 'Content-Disposition': `${f.inline ? 'inline' : 'attachment'}; filename="${String(f.name).replace(/"/g, '')}"`, 'Cache-Control': 'no-store' });
      }
      return send(res, 200, JSON.stringify(out === undefined ? { ok: true } : out), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    let p = url.pathname;
    if (PAGES.includes(p.replace(/\/$/, '') || '/')) p = '/index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch (e) {
    const code = e.status || 500;
    if (code >= 500) { console.error(e); D.setHealth('last_failure', `${D.now()} ${req.method} ${url.pathname}: ${e.message}`); }
    return send(res, code, JSON.stringify({ error: code >= 500 ? 'Something went wrong on our side. Please try again.' : e.message, field: e.field }), { 'Content-Type': 'application/json; charset=utf-8' });
  }
});

if (process.env.BBHS_NO_SEED !== '1' && seed()) console.log('Sample data added (test copy). Logins are listed at the top of server/seed.js.');
timer.start();
server.listen(PORT, () => console.log(`BBHS hiring software on http://localhost:${PORT}  (forms: /hire /apply · accounts: /my-account /my-profile · team: /team)`));
