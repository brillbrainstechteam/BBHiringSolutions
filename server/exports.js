// Daily data backup in Excel: candidates, clients, job openings and applications, one sheet each, every column.
// It opens anywhere without the portal, so the data stays reachable if this server is down: kept 30 days on the
// server (Settings › Health) and emailed each night to the backup address (Settings › Health, super admin).
const fs = require('fs');
const path = require('path');
const D = require('./db');
const F = require('./files');
const { route } = require('./router');

const DIR = path.join(D.DATA_DIR, 'backups', 'excel');
const KEEP = 30;
const MAX_MAIL = 18 * 1048576; // Gmail takes 25 MB; base64 makes a file a third bigger
const NAME_RE = /^bbhs-data-\d{4}-\d{2}-\d{2}\.xlsx$/;
const istDay = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

// One sheet from a query: the given columns first (names a person reads first), then every other column.
function sheet(name, sql, first = []) {
  const rows = D.all(sql);
  const keys = [...new Set([...first, ...rows.flatMap((r) => Object.keys(r))])];
  const cell = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'string' && v.length > 32000 ? `${v.slice(0, 32000)}…` : v);
  return { name, rows: [keys, ...rows.map((r) => keys.map((k) => cell(r[k])))], count: rows.length };
}
function build() {
  const sheets = [
    sheet('Candidates', 'SELECT * FROM candidates WHERE merged_into IS NULL ORDER BY created_at', ['id', 'name', 'whatsapp', 'email', 'city', 'job_wanted', 'department']),
    sheet('Clients', 'SELECT * FROM clients WHERE merged_into IS NULL ORDER BY created_at', ['id', 'company', 'contact', 'whatsapp', 'email', 'city', 'stage']),
    sheet('Job openings', 'SELECT c.company AS client_company, j.* FROM jobs j LEFT JOIN clients c ON c.id=j.client_id ORDER BY j.created_at', ['id', 'title', 'client_company', 'city', 'openings', 'status']),
    sheet('Applications', 'SELECT x.name AS candidate_name, x.whatsapp AS candidate_whatsapp, j.title AS job_title, c.company AS client_company, a.* FROM applications a LEFT JOIN candidates x ON x.id=a.candidate_id LEFT JOIN jobs j ON j.id=a.job_id LEFT JOIN clients c ON c.id=j.client_id ORDER BY a.created_at', ['id', 'candidate_name', 'candidate_whatsapp', 'job_title', 'client_company', 'step', 'result']),
  ];
  return { buf: F.toXLSXBook(sheets.map((s) => ({ name: s.name, rows: s.rows }))), counts: Object.fromEntries(sheets.map((s) => [s.name, s.count])) };
}
const recipients = () => { const v = D.settings().backup_email; return (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean); };
// Google Drive: a small Apps Script in the owner's Drive takes the file and saves it in their folder (no Google Cloud
// setup). Settings › Health makes the script with the folder and a secret key; the owner deploys it and pastes its link.
const driveCfg = () => D.settings().backup_drive || {};
const folderIdOf = (v) => { const s = String(v || '').trim(); const m = s.match(/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{10,})$/); return m ? m[1] : null; };
function script(folderId, key) {
  return `// BBHS daily backup → this Google Drive folder. Paste into script.google.com, then Deploy → New deployment → Web app
// (Execute as: Me, Who has access: Anyone) and paste the Web app URL back into the portal.
const FOLDER_ID = '${folderId}';
const KEY = '${key}';
const KEEP_DAYS = ${KEEP};
function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  if (d.key !== KEY) return out({ ok: false, error: 'Wrong key' });
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const old = folder.getFilesByName(d.name); while (old.hasNext()) old.next().setTrashed(true);
  const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(d.data), d.mime, d.name));
  const cut = Date.now() - KEEP_DAYS * 86400000; const it = folder.getFiles();
  while (it.hasNext()) { const x = it.next(); if (/^bbhs-data-/.test(x.getName()) && x.getDateCreated().getTime() < cut) x.setTrashed(true); }
  return out({ ok: true, url: f.getUrl() });
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;
}
async function toDrive(name, buf) {
  const c = driveCfg(); if (!c.url || !c.key) return null;
  try {
    const res = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key: c.key, name, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: buf.toString('base64') }), redirect: 'follow', signal: AbortSignal.timeout(180000) });
    const txt = await res.text(); let j = {}; try { j = JSON.parse(txt); } catch { throw new Error(/<html/i.test(txt) ? 'The link did not answer as a web app: check Who has access is Anyone' : `Unexpected answer (${res.status})`); }
    if (!j.ok) throw new Error(j.error || 'Drive did not save the file');
    D.setSetting('backup_drive', { ...driveCfg(), last_ok: now(), last_name: name, last_url: j.url || '', last_error: null }); return j;
  } catch (e) {
    D.setSetting('backup_drive', { ...driveCfg(), last_error: `${now()} ${e.message}` }); require('./alerts').devAlert('Backup upload to Drive failed', e.message); throw e;
  }
}
const now = () => D.now();
function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => NAME_RE.test(f)).sort().reverse().map((f) => { const st = fs.statSync(path.join(DIR, f)); return { name: f, size_kb: Math.round(st.size / 1024), at: st.mtime.toISOString() }; });
}
// Once a day (the timer calls it every run; it does nothing once today's file exists). force: make it again now.
function daily(force, by) {
  const day = istDay(); const name = `bbhs-data-${day}.xlsx`; const file = path.join(DIR, name);
  if (fs.existsSync(file) && !force) return null;
  fs.mkdirSync(DIR, { recursive: true });
  const { buf, counts } = build();
  fs.writeFileSync(`${file}.tmp`, buf); fs.renameSync(`${file}.tmp`, file); // never a half-written backup
  const old = fs.readdirSync(DIR).filter((f) => NAME_RE.test(f)).sort(); while (old.length > KEEP) fs.unlinkSync(path.join(DIR, old.shift()));
  const summary = Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join(' · ');
  D.setHealth('last_data_backup', `${D.now()} · ${summary}`);
  const drive = toDrive(name, buf).catch(() => null); // reported in Settings › Health
  const to = recipients(); let mailed = null;
  if (to.length) {
    const M = require('./mailer'); const big = buf.length > MAX_MAIL;
    const text = `The daily data backup for ${day}.\n\n${summary}\n\n${big ? `The file is ${Math.round(buf.length / 1048576)} MB, too big to attach. Download it from the portal: Settings, Health, Daily data backups.` : 'The Excel file is attached: one sheet each for candidates, clients, job openings and applications, with every column.'}\n\nThe portal keeps the last ${KEEP} days. Keep this email: it is your copy if the portal cannot be reached.`;
    mailed = M.queue({ to, subject: `BBHS data backup · ${day}`, text, html: M.layout(`Data backup · ${day}`, text.split('\n\n').map((p) => `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>`).join('')), kind: 'backup', attachments: big ? [] : [{ backup: name }], force: true, dedupe: force ? null : `backup:${day}` });
  }
  D.history(by || 'System', 'data backup', null, null, null, `${name} · ${summary}${to.length ? ` · emailed to ${to.join(', ')}` : ''}`);
  return { name, counts, emailed_to: to, mailed: !!mailed, drive };
}
const fileOf = (name) => (NAME_RE.test(String(name || '')) && fs.existsSync(path.join(DIR, name)) ? path.join(DIR, name) : null);

const SUPER = { auth: 'team', levels: ['super'] };
route('GET', '/api/backups/excel', SUPER, () => { const c = driveCfg(); return { files: list(), emailed_to: recipients(), keep: KEEP, drive: { folder_id: c.folder_id || '', url: c.url || '', last_ok: c.last_ok || null, last_url: c.last_url || '', last_error: c.last_error || null, script: c.folder_id && c.key ? script(c.folder_id, c.key) : '' } }; });
// Step 1: the folder → the script to paste. Step 2: the web app link → saved and tried with today's file.
route('POST', '/api/backups/drive/folder', SUPER, (ctx) => {
  const id = folderIdOf((ctx.body || {}).folder); if (!id) throw D.httpError(400, 'Paste the folder link from Google Drive', 'folder');
  const c = driveCfg(); const key = c.folder_id === id && c.key ? c.key : require('crypto').randomBytes(18).toString('hex');
  D.setSetting('backup_drive', { folder_id: id, key, url: c.folder_id === id ? c.url : '' }); D.history(ctx.actor.label, 'backup drive folder', null, null, null, id);
  return { script: script(id, key) };
});
route('POST', '/api/backups/drive/url', SUPER, async (ctx) => {
  const url = String((ctx.body || {}).url || '').trim(); if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw D.httpError(400, 'Paste the Web app URL (it ends in /exec)', 'url');
  if (!driveCfg().folder_id) throw D.httpError(400, 'Add the folder first');
  D.setSetting('backup_drive', { ...driveCfg(), url }); D.history(ctx.actor.label, 'backup drive link', null, null, null, null);
  let f = list()[0]; if (!f) { daily(true, ctx.actor.label); f = list()[0]; }
  try { const r = await toDrive(f.name, fs.readFileSync(path.join(DIR, f.name))); return { ok: true, url: r.url }; } catch (e) { throw D.httpError(400, `Saved, but the test upload failed: ${e.message}`); }
});
route('GET', '/api/backups/excel/:name', SUPER, (ctx) => {
  const f = fileOf(ctx.params.name); if (!f) throw D.httpError(404, 'Backup not found');
  D.history(ctx.actor.label, 'download backup', null, ctx.params.name, null, null, null, ctx.ip);
  return { __file: { name: ctx.params.name, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: fs.readFileSync(f) } };
});
route('POST', '/api/backups/excel/now', SUPER, (ctx) => daily(true, ctx.actor.label));

module.exports = { daily, list, fileOf, build, DIR };
