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
const recipients = () => { const v = D.settings().backup_email; const list = (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean); return v === undefined || v === null ? [D.ENV.smtp.from].filter(Boolean) : list; };
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
  const to = recipients(); let mailed = null;
  if (to.length) {
    const M = require('./mailer'); const big = buf.length > MAX_MAIL;
    const text = `The daily data backup for ${day}.\n\n${summary}\n\n${big ? `The file is ${Math.round(buf.length / 1048576)} MB, too big to attach. Download it from the portal: Settings, Health, Daily data backups.` : 'The Excel file is attached: one sheet each for candidates, clients, job openings and applications, with every column.'}\n\nThe portal keeps the last ${KEEP} days. Keep this email: it is your copy if the portal cannot be reached.`;
    mailed = M.queue({ to, subject: `BBHS data backup · ${day}`, text, html: M.layout(`Data backup · ${day}`, text.split('\n\n').map((p) => `<p style="font-size:14px;line-height:1.6;margin:0 0 12px">${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>`).join('')), kind: 'backup', attachments: big ? [] : [{ backup: name }], force: true, dedupe: force ? null : `backup:${day}` });
  }
  D.history(by || 'System', 'data backup', null, null, null, `${name} · ${summary}${to.length ? ` · emailed to ${to.join(', ')}` : ''}`);
  return { name, counts, emailed_to: to, mailed: !!mailed };
}
const fileOf = (name) => (NAME_RE.test(String(name || '')) && fs.existsSync(path.join(DIR, name)) ? path.join(DIR, name) : null);

const SUPER = { auth: 'team', levels: ['super'] };
route('GET', '/api/backups/excel', SUPER, () => ({ files: list(), emailed_to: recipients(), keep: KEEP }));
route('GET', '/api/backups/excel/:name', SUPER, (ctx) => {
  const f = fileOf(ctx.params.name); if (!f) throw D.httpError(404, 'Backup not found');
  D.history(ctx.actor.label, 'download backup', null, ctx.params.name, null, null, null, ctx.ip);
  return { __file: { name: ctx.params.name, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: fs.readFileSync(f) } };
});
route('POST', '/api/backups/excel/now', SUPER, (ctx) => daily(true, ctx.actor.label));

module.exports = { daily, list, fileOf, build, DIR };
