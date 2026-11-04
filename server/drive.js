// Google Drive CV folder, read on the timer (every 30 minutes): new or changed resumes in the folder (and its
// subfolders) go to their candidate, or make a new one, through server/resumes.js. Read-only access with a service
// account: share the folder with the account's email as Viewer. No outside packages.
//   GDRIVE_FOLDER_ID  the folder's ID (the last part of its link: drive.google.com/drive/folders/<ID>)
//   GDRIVE_SA_FILE    path to the service account's JSON key on the server (or GDRIVE_SA_JSON with the JSON itself)
//   GDRIVE_EVERY_MIN  minutes between reads (default 30)
const fs = require('fs');
const crypto = require('crypto');
const D = require('./db');
const R = require('./router');
const { route } = R;
const { get, now, httpError } = D;

D.db.exec('CREATE TABLE IF NOT EXISTS drive_seen (file_id TEXT PRIMARY KEY, md5 TEXT, path TEXT, status TEXT, at TEXT)');
const API = 'https://www.googleapis.com/drive/v3';
const configured = () => !!(process.env.GDRIVE_FOLDER_ID && (process.env.GDRIVE_SA_FILE || process.env.GDRIVE_SA_JSON));
function key() {
  const raw = process.env.GDRIVE_SA_JSON || fs.readFileSync(process.env.GDRIVE_SA_FILE, 'utf8');
  const k = JSON.parse(raw); if (!k.client_email || !k.private_key) throw new Error('The service account key has no client_email / private_key');
  return k;
}
let tok = null;
async function token() {
  if (tok && tok.exp > Date.now() + 60000) return tok.value;
  const k = key(); const t = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: t, exp: t + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(body).sign(k.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${body}.${sig}`, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({})); if (!res.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description || j.error || res.status}`);
  tok = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }; return tok.value;
}
async function api(url, raw) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(120000) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(`Drive said ${res.status}: ${(j.error && j.error.message) || ''}`); }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}
// every file under the folder, with its path ("B2C/Sales/Sales Executive/x.pdf")
async function listAll(folderId, prefix = '', out = [], depth = 0) {
  let page = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const j = await api(`${API}/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,md5Checksum,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? `&pageToken=${page}` : ''}`);
    for (const f of j.files || []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') { if (depth < 8) await listAll(f.id, `${prefix}${f.name}/`, out, depth + 1); } else out.push({ ...f, path: `${prefix}${f.name}` });
    }
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
let running = null; let lastRun = 0;
function check(force) {
  if (!configured()) return Promise.resolve({ skipped: 'Google Drive not set in .env' });
  const every = (Number(process.env.GDRIVE_EVERY_MIN) || 30) * 60000;
  if (running) return Promise.resolve({ skipped: 'Already reading Drive' });
  if (!force && Date.now() - lastRun < every) return Promise.resolve({ skipped: 'Not due yet' });
  lastRun = Date.now(); running = checkNow().finally(() => { running = null; }); return running;
}
async function checkNow() {
  const files = await listAll(process.env.GDRIVE_FOLDER_ID);
  const fresh = files.filter((f) => { const s = get('SELECT md5 FROM drive_seen WHERE file_id=?', f.id); return !s || (f.md5Checksum && s.md5 !== f.md5Checksum); }).slice(0, 40);
  const by = { label: 'Google Drive' }; const done = { files: files.length, read: 0, attached: 0, created: 0, skipped: 0, unmatched: 0, errors: [] };
  for (const f of fresh) {
    let status = 'skipped';
    try {
      const isDoc = f.mimeType === 'application/vnd.google-apps.document';
      if (isDoc || /\.(pdf|docx?|jpe?g|png)$/i.test(f.name)) {
        const buf = await api(isDoc ? `${API}/files/${f.id}/export?mimeType=application/pdf` : `${API}/files/${f.id}?alt=media&supportsAllDrives=true`, true);
        const r = await require('./resumes').attachResume({ file: isDoc ? `${f.path}.pdf` : f.path, buf, source: 'Google Drive' }, by); status = r.status; done.read++;
      }
    } catch (e) { status = 'error'; done.errors.push(`${f.path}: ${e.message}`); }
    if (status !== 'error') D.run('INSERT INTO drive_seen (file_id,md5,path,status,at) VALUES (?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET md5=excluded.md5, status=excluded.status, at=excluded.at', f.id, f.md5Checksum || f.modifiedTime, f.path, status, now());
    if (done[status] !== undefined) done[status]++;
  }
  D.setHealth('last_drive_check', `${now()} · ${done.files} files in the folder · ${done.attached} resumes attached · ${done.created} new candidates · ${done.unmatched} not matched`);
  if (done.errors.length) require('./alerts').devAlert('Google Drive: some files could not be read', done.errors.slice(0, 10).join('; '));
  return done;
}
// Super admin: read the folder now (Settings -> Health, or after setting it up).
route('POST', '/api/health/drive', { auth: 'team', levels: ['super'] }, async () => { if (!configured()) throw httpError(400, 'Add GDRIVE_FOLDER_ID and GDRIVE_SA_FILE to the server .env first.'); return check(true); });

// ---------- pushed from Google (Apps Script in the owner's Google account: docs/drive-apps-script.gs) ----------
// No Google credential on this server: a script inside Google reads the CV folder every 30 minutes and delivers new
// or changed files here, with the shared code DRIVE_PUSH_SECRET (in .env). The code can only deliver resumes.
const pushOk = (ctx) => {
  const want = String(process.env.DRIVE_PUSH_SECRET || ''); const got = String(ctx.req.headers['x-drive-secret'] || '');
  if (want.length < 20) throw httpError(503, 'Drive delivery is not set up (DRIVE_PUSH_SECRET in .env).');
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) throw httpError(403, 'Wrong code');
};
// which of the folder's files are new or changed since they were last delivered
route('POST', '/api/hooks/drive/new', { rate: { key: 'drivehook', max: 60, minutes: 10 } }, (ctx) => {
  pushOk(ctx);
  const list = Array.isArray((ctx.body || {}).files) ? ctx.body.files.slice(0, 5000) : [];
  return { ids: list.filter((f) => { const s = get('SELECT md5 FROM drive_seen WHERE file_id=?', String(f.id)); return !s || s.md5 !== String(f.v); }).map((f) => f.id) };
});
// one file: to its candidate, or a new one
route('POST', '/api/hooks/drive/file', { rate: { key: 'drivefile', max: 400, minutes: 10 } }, async (ctx) => {
  pushOk(ctx); const b = ctx.body || {};
  const buf = Buffer.from(String(b.base64 || ''), 'base64'); if (!b.id || !buf.length) throw httpError(400, 'No file');
  let r; try { r = await require('./resumes').attachResume({ file: String(b.path || b.name || 'resume.pdf'), buf, source: 'Google Drive' }, { label: 'Google Drive' }); } catch (e) { r = { status: 'unmatched', why: e.message }; }
  D.run('INSERT INTO drive_seen (file_id,md5,path,status,at) VALUES (?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET md5=excluded.md5, path=excluded.path, status=excluded.status, at=excluded.at', String(b.id), String(b.v || ''), String(b.path || ''), r.status, now());
  D.setHealth('last_drive_check', `${now()} · pushed from Google · last file: ${String(b.path || '').split('/').pop()} (${r.status})`);
  return { status: r.status, why: r.why || '' };
});

module.exports = { check, configured };
