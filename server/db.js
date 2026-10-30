// Database: Node's built-in SQLite. One file under data/, created on first run.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const ENV = require('./env');
const { defaultSettings } = require('./defaults');

const DATA_DIR = ENV.dataDir;
fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'bbhs.db');
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;'); // wait up to 5 s if another write is in progress

const JSON_COLS = new Set(['exp_business', 'kyc', 'extra', 'perms', 'jd', 'qa', 'buttons', 'checklist', 'onboarding', 'work_cities', 'skills', 'rounds', 'screening_qs', 'value', 'map', 'vars', 'joining_docs', 'social', 'resume_check', 'ad_match']);

db.exec(`
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, next INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS agencies (id TEXT PRIMARY KEY, name TEXT, city TEXT, since TEXT, status TEXT DEFAULT 'Active', share_pct REAL, is_sample INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, whatsapp TEXT, level TEXT, agency_id TEXT, role TEXT, username TEXT UNIQUE, pass_hash TEXT, status TEXT DEFAULT 'On', must_change INTEGER DEFAULT 1, failed INTEGER DEFAULT 0, locked_until TEXT, last_login TEXT, last_action TEXT, created_by TEXT, created_at TEXT, devices TEXT DEFAULT '[]', is_sample INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, kind TEXT, subject_id TEXT, member_id TEXT, created_at TEXT, last_seen TEXT, pending_2fa INTEGER DEFAULT 0, device TEXT);
CREATE TABLE IF NOT EXISTS iv_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, iv_id TEXT, app_id TEXT, candidate_id TEXT, author TEXT, author_kind TEXT, text TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS ix_ivn_app ON iv_notes(app_id);
CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id TEXT, app_id TEXT, iv_id TEXT, user_id TEXT, by TEXT, at TEXT, outcome TEXT, minutes REAL, note TEXT);
CREATE INDEX IF NOT EXISTS ix_calls_cand ON calls(candidate_id);
CREATE TABLE IF NOT EXISTS wa_clicks (id INTEGER PRIMARY KEY AUTOINCREMENT, page TEXT, button TEXT, src TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS partner_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, organisation TEXT, kind TEXT, whatsapp TEXT, email TEXT, city TEXT, message TEXT, source TEXT, status TEXT DEFAULT 'New', created_at TEXT);
CREATE TABLE IF NOT EXISTS account_passwords (kind TEXT, subject_id TEXT, pass_hash TEXT, updated_at TEXT, PRIMARY KEY (kind, subject_id));
CREATE TABLE IF NOT EXISTS otps (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, purpose TEXT, code_hash TEXT, expires TEXT, tries INTEGER DEFAULT 0, used INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, company TEXT, contact TEXT, whatsapp TEXT, email TEXT, city TEXT, state TEXT, business_type TEXT, need TEXT, roles TEXT, source TEXT, stage TEXT, agency_id TEXT, owner_id TEXT, account_status TEXT DEFAULT 'Not opened', is_new INTEGER DEFAULT 1, kyc TEXT DEFAULT '{}', contract TEXT, onboarding TEXT DEFAULT '{}', extra TEXT DEFAULT '{}', industry TEXT DEFAULT 'Jewellery', fee_type TEXT, fee_value REAL, replacement_days INTEGER, payment_days INTEGER, language TEXT DEFAULT 'en', hide_name_until TEXT DEFAULT 'Client interview', templates TEXT, opted_out INTEGER DEFAULT 0, dnc INTEGER DEFAULT 0, possible_repeat_of TEXT, junk INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, merged_into TEXT, removed INTEGER DEFAULT 0, old_code TEXT, needs_check TEXT, is_sample INTEGER DEFAULT 0, created_by TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS client_members (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT, name TEXT, whatsapp TEXT, role TEXT, perms TEXT DEFAULT '{}', created_at TEXT);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, client_id TEXT, title TEXT, department TEXT, city TEXT, openings INTEGER DEFAULT 1, sal_from INTEGER, sal_to INTEGER, exp_from REAL, exp_to REAL, notice_days INTEGER, skills TEXT DEFAULT '[]', agency_id TEXT, recruiter_id TEXT, priority TEXT DEFAULT 'Medium', jd_approved INTEGER DEFAULT 0, jd TEXT DEFAULT '{}', jd_status TEXT DEFAULT 'Not written', jd_note TEXT, manual TEXT, manual_reason TEXT, reopened_at TEXT, reopen_tag TEXT, replacement_for TEXT, status TEXT, rounds TEXT DEFAULT '["Our interview","Client interview"]', screening_qs TEXT DEFAULT '[]', notes TEXT, old_code TEXT, archived INTEGER DEFAULT 0, is_sample INTEGER DEFAULT 0, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS job_history (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, at TEXT, status TEXT, by TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS client_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT, at TEXT, text TEXT, by TEXT);
CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, name TEXT, whatsapp TEXT, email TEXT, city TEXT, work_cities TEXT DEFAULT '[]', job_wanted TEXT, department TEXT, exp_total REAL, exp_jewellery REAL, cur_salary INTEGER, exp_salary INTEGER, notice_days INTEGER, skills TEXT DEFAULT '[]', current_company TEXT, cv_file TEXT, short_cv_file TEXT, source TEXT, ref_by TEXT, tieup_id INTEGER, agency_id TEXT, recruiter_id TEXT, account_status TEXT DEFAULT 'Not opened', is_new INTEGER DEFAULT 1, looking TEXT DEFAULT 'Actively looking', opted_out INTEGER DEFAULT 0, consent_alerts INTEGER DEFAULT 0, possible_repeat_of TEXT, junk INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, merged_into TEXT, removed INTEGER DEFAULT 0, delete_requested INTEGER DEFAULT 0, needs_check TEXT, last_updated TEXT, old_code TEXT, is_sample INTEGER DEFAULT 0, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, candidate_id TEXT, job_id TEXT, step TEXT DEFAULT 'Applied', result TEXT DEFAULT 'open', owner_id TEXT, source TEXT, offer_ctc INTEGER, joining_date TEXT, reporting_to TEXT, client_choice TEXT, on_hold INTEGER DEFAULT 0, hold_reason TEXT, hold_until TEXT, at_risk INTEGER DEFAULT 0, left_date TEXT, left_reason TEXT, left_note TEXT, replacement_used INTEGER DEFAULT 0, replacement_of TEXT, offer_letter TEXT, offer_sent INTEGER DEFAULT 0, checklist TEXT DEFAULT '{}', joining_docs TEXT DEFAULT '[]', step_since TEXT, joined_at TEXT, is_sample INTEGER DEFAULT 0, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS app_history (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT, at TEXT, step TEXT, by TEXT, by_id TEXT, note TEXT, kind TEXT);
CREATE TABLE IF NOT EXISTS interviews (id TEXT PRIMARY KEY, app_id TEXT, round TEXT, name TEXT, at TEXT, place TEXT, interviewer TEXT, status TEXT DEFAULT 'Scheduled', result TEXT, remark TEXT, rating INTEGER, qa TEXT DEFAULT '[]', confirmed INTEGER DEFAULT 0, completed_by TEXT, completed_at TEXT, is_sample INTEGER DEFAULT 0, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS bills (id TEXT PRIMARY KEY, app_id TEXT, client_id TEXT, agency_id TEXT, bill_no TEXT, ctc INTEGER, fee REAL, gst REAL, cgst REAL, sgst REAL, igst REAL, total REAL, fee_note TEXT, status TEXT, issued_at TEXT, date TEXT, due_date TEXT, is_replacement INTEGER DEFAULT 0, credit_of TEXT, share_pct REAL, agency_share REAL, payout_status TEXT DEFAULT 'Not due', payout_paid_at TEXT, payout_ref TEXT, payout_hold INTEGER DEFAULT 0, replacement_requested INTEGER DEFAULT 0, is_sample INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT, date TEXT, amount REAL, mode TEXT, ref TEXT, tds REAL DEFAULT 0, by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, person_type TEXT, person_id TEXT, phone TEXT, direction TEXT, format TEXT, lang TEXT, text TEXT, buttons TEXT DEFAULT '[]', ap TEXT, jb TEXT, iv TEXT, bl TEXT, sent_by TEXT, status TEXT, read_by_us INTEGER DEFAULT 1, auto INTEGER DEFAULT 0, rule TEXT, dedupe TEXT, scheduled_at TEXT, tries INTEGER DEFAULT 0, error TEXT, reply_to TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, user_id TEXT, day TEXT, tasks TEXT, problems TEXT, plan TEXT, counts TEXT, status TEXT, approved_by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT, text TEXT, author TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS followups (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT, at TEXT, note TEXT, for_user TEXT, done INTEGER DEFAULT 0, alerted INTEGER DEFAULT 0, created_by TEXT);
CREATE TABLE IF NOT EXISTS postings (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, channel TEXT, owner TEXT, tag TEXT, done_date TEXT, post_link TEXT);
CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT, type TEXT, name TEXT, version INTEGER DEFAULT 1, path TEXT, mime TEXT, size INTEGER, uploaded_by TEXT, at TEXT, replaced INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS consents (id INTEGER PRIMARY KEY AUTOINCREMENT, person_type TEXT, person_id TEXT, what TEXT, wording TEXT, source TEXT, at TEXT, opted_out INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT, amount REAL, reason TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS column_maps (source TEXT PRIMARY KEY, map TEXT);
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, text TEXT, record_id TEXT, read INTEGER DEFAULT 0, at TEXT);
CREATE TABLE IF NOT EXISTS tieups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, city TEXT, contact TEXT, phone TEXT, owner_id TEXT, last_list TEXT, is_sample INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS saved_searches (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, name TEXT, query TEXT);
CREATE TABLE IF NOT EXISTS merges (old_id TEXT PRIMARY KEY, kept_id TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS data_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, person_type TEXT, person_id TEXT, kind TEXT, status TEXT DEFAULT 'Waiting', at TEXT, decided_by TEXT, decided_at TEXT);
CREATE TABLE IF NOT EXISTS health (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS bot_sessions (phone TEXT PRIMARY KEY, kind TEXT, person_id TEXT, step TEXT, data TEXT DEFAULT '{}', updated_at TEXT);
CREATE TABLE IF NOT EXISTS mail_seen (uid TEXT PRIMARY KEY, at TEXT);
CREATE TABLE IF NOT EXISTS emails (id INTEGER PRIMARY KEY AUTOINCREMENT, to_addr TEXT, subject TEXT, kind TEXT, record_id TEXT, text TEXT, html TEXT, status TEXT DEFAULT 'queued', tries INTEGER DEFAULT 0, error TEXT, at TEXT, sent_at TEXT);
CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, who TEXT, action TEXT, record_id TEXT, field TEXT, old TEXT, new TEXT, ids TEXT, ip TEXT);
CREATE TRIGGER IF NOT EXISTS history_no_update BEFORE UPDATE ON history BEGIN SELECT RAISE(ABORT, 'history cannot be edited'); END;
CREATE TRIGGER IF NOT EXISTS history_no_delete BEFORE DELETE ON history BEGIN SELECT RAISE(ABORT, 'history cannot be deleted'); END;
CREATE INDEX IF NOT EXISTS ix_apps_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS ix_cand_email ON candidates(lower(email));
CREATE INDEX IF NOT EXISTS ix_client_email ON clients(lower(email));

CREATE INDEX IF NOT EXISTS ix_apps_cand ON applications(candidate_id);
CREATE INDEX IF NOT EXISTS ix_msg_person ON messages(person_type, person_id);
CREATE INDEX IF NOT EXISTS ix_hist_rec ON history(record_id);
CREATE INDEX IF NOT EXISTS ix_apph ON app_history(app_id);
-- Lookups done on every page or every timer run.
CREATE INDEX IF NOT EXISTS ix_jobs_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS ix_iv_app ON interviews(app_id);
CREATE INDEX IF NOT EXISTS ix_iv_at ON interviews(status, at);
CREATE INDEX IF NOT EXISTS ix_bills_app ON bills(app_id);
CREATE INDEX IF NOT EXISTS ix_bills_client ON bills(client_id);
CREATE INDEX IF NOT EXISTS ix_pay_bill ON payments(bill_id);
CREATE INDEX IF NOT EXISTS ix_files_rec ON files(record_id, type);
CREATE INDEX IF NOT EXISTS ix_notes_rec ON notes(record_id);
CREATE INDEX IF NOT EXISTS ix_jobh_job ON job_history(job_id);
CREATE INDEX IF NOT EXISTS ix_msg_dedupe ON messages(dedupe);
CREATE INDEX IF NOT EXISTS ix_msg_status ON messages(status, scheduled_at);
CREATE INDEX IF NOT EXISTS ix_otp_phone ON otps(phone, purpose);
CREATE INDEX IF NOT EXISTS ix_members_phone ON client_members(whatsapp);
CREATE INDEX IF NOT EXISTS ix_follow_user ON followups(for_user, done);
CREATE INDEX IF NOT EXISTS ix_alerts_user ON alerts(user_id, read);
CREATE INDEX IF NOT EXISTS ix_logs_user ON logs(user_id, day);
CREATE INDEX IF NOT EXISTS ix_consent_person ON consents(person_type, person_id);
CREATE INDEX IF NOT EXISTS ix_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS ix_sessions_subject ON sessions(kind, subject_id);
CREATE INDEX IF NOT EXISTS ix_cand_phone ON candidates(whatsapp);
CREATE INDEX IF NOT EXISTS ix_client_phone ON clients(whatsapp);
`);

// Columns added after the first version.
for (const [table, col] of [['candidates', 'state TEXT'], ['candidates', "language TEXT DEFAULT 'en'"], ['candidates', "industry TEXT DEFAULT 'Jewellery'"], ['candidates', "exp_business TEXT DEFAULT '[]'"], ['users', 'email TEXT'], ['emails', 'send_after TEXT'], ['emails', 'dedupe TEXT'], ['interviews', 'mode TEXT'], ['interviews', 'link TEXT'], ['interviews', 'client_joins INTEGER DEFAULT 0'], ['candidates', "social TEXT DEFAULT '{}'"], ['candidates', "resume_check TEXT DEFAULT '{}'"], ['saved_searches', 'shared INTEGER DEFAULT 0'], ['saved_searches', 'created_at TEXT'], ['saved_searches', 'updated_at TEXT'], ['candidates', 'ad_campaign TEXT'], ['candidates', 'ad_set TEXT'], ['candidates', 'ad_name TEXT'], ['applications', 'ad_campaign TEXT'], ['applications', 'ad_set TEXT'], ['applications', 'ad_name TEXT'], ['clients', 'placeholder INTEGER DEFAULT 0'], ['jobs', "ad_match TEXT DEFAULT '[]'"], ['applications', 'screen TEXT'], ['applications', 'screen_note TEXT'], ['applications', 'screen_at TEXT'], ['applications', 'screen_by TEXT']]) { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* already there */ } }
db.exec('CREATE INDEX IF NOT EXISTS ix_emails_dedupe ON emails(dedupe); CREATE INDEX IF NOT EXISTS ix_emails_after ON emails(status, send_after);');

// ---------- small helpers ----------
const now = () => new Date().toISOString();
function decode(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (JSON_COLS.has(k) && typeof out[k] === 'string') { try { out[k] = JSON.parse(out[k]); } catch { /* keep text */ } }
  }
  return out;
}
function encode(v, k) {
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}
const all = (sql, ...p) => db.prepare(sql).all(...p).map(decode);
const get = (sql, ...p) => decode(db.prepare(sql).get(...p));
const run = (sql, ...p) => db.prepare(sql).run(...p);

function insert(table, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => encode(obj[k], k)));
  return obj;
}
function update(table, id, patch, idCol = 'id') {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${idCol}=?`, ...keys.map((k) => encode(patch[k], k)), id);
}
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// IDs come from counters: in order, never reused (even after delete or merge).
function nextId(prefix) {
  const pad = { AG: 2, U: 2, WA: 6, LG: 0 }[prefix];
  const row = db.prepare('SELECT next FROM counters WHERE name=?').get(prefix);
  const n = row ? row.next : 1;
  if (row) run('UPDATE counters SET next=? WHERE name=?', n + 1, prefix); else run('INSERT INTO counters (name,next) VALUES (?,?)', prefix, n + 1);
  return `${prefix}-${pad ? String(n).padStart(pad, '0') : n}`;
}

// ---------- settings ----------
// Kept for a minute, so a change saved by a setup script (outside this process) is picked up without a restart.
let settingsCache = null; let settingsAt = 0;
function settings() {
  if (settingsCache && Date.now() - settingsAt < 60000) return settingsCache;
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = JSON.parse(r.value);
  // Secrets and addresses set in .env win over the saved values (Settings shows them as "from .env").
  if (s.crm) {
    const c = ENV.crm; const crm = { ...s.crm, from_env: {} };
    if (c.enabled !== undefined) { crm.enabled = c.enabled; crm.from_env.enabled = true; }
    if (c.sendUrl) { crm.send_url = c.sendUrl; crm.from_env.send_url = true; }
    if (c.token) { crm.token = c.token; crm.from_env.token = true; }
    if (c.secret) { crm.webhook_secret = c.secret; crm.from_env.webhook_secret = true; }
    s.crm = crm;
  }
  if (s.business && ENV.baseUrl) s.business = { ...s.business, base_url: ENV.baseUrl.replace(/\/+$/, '') };
  settingsCache = s; settingsAt = Date.now();
  return s;
}
function setSetting(key, value) {
  run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  settingsCache = null;
}
function ensureSettings() {
  const defs = defaultSettings();
  const have = new Set(db.prepare('SELECT key FROM settings').all().map((r) => r.key));
  for (const [k, v] of Object.entries(defs)) if (!have.has(k)) setSetting(k, v);
  // New message formats and automatic rules added in later versions reach existing copies too.
  const cur = settings();
  const missingFormats = Object.keys(defs.formats).filter((k) => !cur.formats[k]);
  if (missingFormats.length) setSetting('formats', { ...cur.formats, ...Object.fromEntries(missingFormats.map((k) => [k, defs.formats[k]])) });
  const ruleKeys = new Set(cur.auto_rules.map((r) => r.key));
  const missingRules = defs.auto_rules.filter((r) => !ruleKeys.has(r.key));
  if (missingRules.length) setSetting('auto_rules', [...cur.auto_rules, ...missingRules]);
  // Once, on 30 Oct 2026 (asked for by the owner): post-join check-ins, the weekly "still looking?" and candidate
  // login codes off. Each can be switched back on in Settings -> Automatic messages.
  const once = settings().done_once || [];
  if (!once.includes('rules_off_2026_10_30')) {
    setSetting('auto_rules', settings().auto_rules.map((r) => (['post_join_checkin', 'still_looking', 'candidate_login'].includes(r.key) ? { ...r, on: false } : r)));
    setSetting('done_once', [...once, 'rules_off_2026_10_30']);
  }
  // Copies made before the navy-and-mustard design keep the old emerald on papers; move them over.
  if (cur.business && cur.business.primary === '#0E5E4E') setSetting('business', { ...cur.business, primary: '#101A3A', accent: '#D19B12' });
  const s = settings();
  const starts = { ...s.id_start, AG: 1, U: 1, WA: 1 };
  for (const [p, n] of Object.entries(starts)) {
    if (!db.prepare('SELECT 1 FROM counters WHERE name=?').get(p)) run('INSERT INTO counters (name,next) VALUES (?,?)', p, n);
  }
}
ensureSettings();

// History: append-only. Every create, edit, step move, download, login and failed login.
function history(who, action, recordId, field, oldV, newV, ids, ip) {
  run('INSERT INTO history (at,who,action,record_id,field,old,new,ids,ip) VALUES (?,?,?,?,?,?,?,?,?)', now(), who || 'System', action, recordId || null, field || null,
    oldV === undefined || oldV === null ? null : String(typeof oldV === 'object' ? JSON.stringify(oldV) : oldV),
    newV === undefined || newV === null ? null : String(typeof newV === 'object' ? JSON.stringify(newV) : newV),
    ids ? JSON.stringify(ids) : null, ip || null);
}
// Edit with history: writes one history line per changed field (old -> new).
function edit(table, id, patch, who, ip) {
  const before = get(`SELECT * FROM ${table} WHERE id=?`, id);
  if (!before) throw httpError(404, 'Record not found');
  const changed = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const a = JSON.stringify(before[k] ?? null); const b = JSON.stringify(v ?? null);
    if (a !== b) changed[k] = v;
  }
  if (!Object.keys(changed).length) return before;
  update(table, id, changed);
  for (const [k, v] of Object.entries(changed)) history(who, 'edit', id, k, before[k], v, null, ip);
  return get(`SELECT * FROM ${table} WHERE id=?`, id);
}
function httpError(code, msg, field) { const e = new Error(msg); e.status = code; e.field = field; return e; }

function backup() {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(DATA_DIR, 'backups', `bbhs-${day}.db`);
  if (!fs.existsSync(file)) { db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); }
  // keep 30 days
  const files = fs.readdirSync(path.join(DATA_DIR, 'backups')).filter((f) => f.endsWith('.db')).sort();
  while (files.length > 30) fs.unlinkSync(path.join(DATA_DIR, 'backups', files.shift()));
  // Second copy off this server (a mounted drive or a cloud-synced folder), also kept 30 days.
  if (ENV.backupDir) {
    fs.mkdirSync(ENV.backupDir, { recursive: true });
    const off = path.join(ENV.backupDir, path.basename(file));
    if (!fs.existsSync(off)) fs.copyFileSync(file, off);
    const offs = fs.readdirSync(ENV.backupDir).filter((f) => /^bbhs-.*\.db$/.test(f)).sort();
    while (offs.length > 30) fs.unlinkSync(path.join(ENV.backupDir, offs.shift()));
  }
  return file;
}
function testRestore() {
  const files = fs.readdirSync(path.join(DATA_DIR, 'backups')).filter((f) => f.endsWith('.db')).sort();
  if (!files.length) return { ok: false, note: 'No backup yet' };
  const f = path.join(DATA_DIR, 'backups', files[files.length - 1]);
  const t = new DatabaseSync(f, { readOnly: true });
  const counts = {};
  for (const tbl of ['clients', 'jobs', 'candidates', 'applications', 'bills']) counts[tbl] = t.prepare(`SELECT COUNT(*) c FROM ${tbl}`).get().c;
  t.close();
  return { ok: true, file: files[files.length - 1], counts };
}
function setHealth(key, value) { run('INSERT INTO health (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }

module.exports = { db, ENV, DATA_DIR, all, get, run, insert, update, tx, nextId, settings, setSetting, history, edit, httpError, now, backup, testRestore, setHealth };
