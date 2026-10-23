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

const PORT = D.ENV.port;
const { devAlert } = require('./alerts');
const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
// The five web addresses each open the one page; the page shows only that part.
const PAGES = ['/', '/hire', '/apply', '/my-account', '/my-profile', '/team'];

// The page with its title and link-preview tags (WhatsApp, Facebook, Google read these, not the app's script).
// The preview always says the business name; the line under it says what this link is for.
const META = {
  '/': ['BrillBrains Hiring Solutions', 'Hiring for the jewellery business: hire screened staff, or find your next jewellery job.'],
  '/apply': ['Jewellery jobs · BrillBrains Hiring Solutions', 'Apply for jewellery jobs in a minute: sales, purchase, cashier, karigar, CAD and more. Free for job seekers.'],
  '/hire': ['Hire jewellery staff · BrillBrains Hiring Solutions', 'Tell us who you need. We send screened, interviewed candidates for your jewellery business.'],
  '/my-account': ['Client login · BrillBrains Hiring Solutions', 'Log in to see your job openings, shortlisted candidates, interviews and bills.'],
  '/my-profile': ['Candidate login · BrillBrains Hiring Solutions', 'Log in to see matching jobs, your interviews and your offers.'],
  '/team': ['Team portal · BrillBrains Hiring Solutions', 'BrillBrains Hiring Solutions team portal.'],
};
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function pageHtml(page) {
  const name = D.settings().business.name || 'BrillBrains Hiring Solutions';
  const base = String(D.settings().business.base_url || '').replace(/\/$/, '');
  const [title, desc] = META[page] || META['/'];
  const url = base + (page === '/' ? '/' : page);
  const tags = [`<title>${escAttr(title)}</title>`, `<meta name="description" content="${escAttr(desc)}">`,
    `<meta property="og:site_name" content="${escAttr(name)}">`, `<meta property="og:title" content="${escAttr(name)}">`, `<meta property="og:description" content="${escAttr(desc)}">`,
    `<meta property="og:type" content="website">`, `<meta property="og:url" content="${escAttr(url)}">`,
    ...(/^https?:\/\//.test(base) ? [`<meta property="og:image" content="${escAttr(base)}/img/icon.png">`, '<meta property="og:image:width" content="192">', '<meta property="og:image:height" content="192">'] : []),
    `<meta name="twitter:card" content="summary">`, `<meta name="twitter:title" content="${escAttr(name)}">`, `<meta name="twitter:description" content="${escAttr(desc)}">`];
  return fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('<!--META-->', tags.join('\n  '));
}

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
    // The team portal is internal: reachable by its address, but kept out of search engines.
    if (p === '/team' || p.startsWith('/team/')) return send(res, 200, pageHtml('/team'), { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' });
    const page = '/' + (p.split('/')[1] || '');
    if (PAGES.includes(page) || p === '/index.html') return send(res, 200, pageHtml(PAGES.includes(page) ? page : '/'), { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' }); // the app's own pages, e.g. /my-account/jobs
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch (e) {
    const code = e.status || 500;
    if (code >= 500) { console.error(e); devAlert(`Error on ${req.method} ${url.pathname}`, e.message); }
    return send(res, code, JSON.stringify({ error: code >= 500 ? 'Something went wrong on our side. Please try again.' : e.message, field: e.field }), { 'Content-Type': 'application/json; charset=utf-8' });
  }
});

// Sample data only on the test copy. The live copy starts empty (create the super admin with npm run make-admin).
if (D.ENV.name !== 'live' && process.env.BBHS_NO_SEED !== '1' && seed()) console.log('Sample data added (test copy). Logins are listed at the top of server/seed.js.');
process.on('uncaughtException', (e) => { console.error(e); devAlert('Server error', e.stack || e.message); });
process.on('unhandledRejection', (e) => { console.error(e); devAlert('Server error', (e && e.message) || String(e)); });
timer.start();
server.listen(PORT, () => console.log(`BBHS hiring software (${D.ENV.name} copy) on http://localhost:${PORT}  (forms: /hire /apply · accounts: /my-account /my-profile · team: /team)`));
