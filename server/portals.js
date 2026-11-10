// Job portals (Naukri and the like): quotes, the subscription taken, payments, and what each one brought back.
// Results are worked out from candidates whose source is the portal's source name, so nothing is typed twice.
// Spend data: super admin and admins only.
const D = require('./db');
const { route } = require('./router');
const { get, all, insert, update, now, httpError } = D;

D.db.exec(`
CREATE TABLE IF NOT EXISTS portals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, website TEXT, kind TEXT, good_for TEXT, source_name TEXT, status TEXT DEFAULT 'Evaluating', login_holder TEXT, note TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS portal_quotes (id INTEGER PRIMARY KEY AUTOINCREMENT, portal_id INTEGER, date TEXT, plan TEXT, price REAL, gst REAL, includes TEXT, credits INTEGER, months INTEGER, valid_till TEXT, file_id TEXT, taken INTEGER DEFAULT 0, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS portal_subs (id INTEGER PRIMARY KEY AUTOINCREMENT, portal_id INTEGER, quote_id INTEGER, plan TEXT, start TEXT, end TEXT, amount REAL, frequency TEXT, auto_renew INTEGER DEFAULT 0, credits INTEGER, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS portal_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, portal_id INTEGER, sub_id INTEGER, date TEXT, amount REAL, ref TEXT, file_id TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS portal_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, portal_id INTEGER, sub_id INTEGER, date TEXT, credits INTEGER, note TEXT, by TEXT, at TEXT);
`);

const STATUSES = ['Evaluating', 'Quote received', 'Active', 'Paused', 'Ended'];
const KINDS = ['Resume database', 'Job postings', 'Both'];
const FREQ = ['One-time', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly'];
const ADMIN = { auth: 'team', levels: ['super', 'admin'] };
const L = () => require('./logic');
const lastId = () => get('SELECT last_insert_rowid() id').id;
const day = (v) => { const s = String(v || '').trim(); if (!s) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw httpError(400, 'Use a date like 2026-11-10'); return s; };
const money = (v, field, need) => { if (v === '' || v === null || v === undefined) { if (need) throw httpError(400, 'Enter the amount', field); return null; } const n = Number(v); if (!(n >= 0)) throw httpError(400, 'Enter the amount as a number', field); return Math.round(n * 100) / 100; };
const rating = () => ({ good: 3, poor: 1, ...(D.settings().portal_rating || {}) }); // return (fees ÷ spend): good from, poor below
const today = () => L().istDay();
const addMonths = (d, m) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + m); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

function current(pid) { return get('SELECT * FROM portal_subs WHERE portal_id=? ORDER BY start DESC, id DESC LIMIT 1', pid) || null; }
// What a portal brought in a window: candidates from it, how far they got, and the money.
function results(p, from, to) {
  const src = String(p.source_name || p.name).trim().toLowerCase();
  const inWin = (d) => (!from || L().istDay(d) >= from) && (!to || L().istDay(d) <= to);
  const cands = all('SELECT id, created_at FROM candidates WHERE merged_into IS NULL AND removed=0 AND lower(trim(source))=?', src).filter((c) => inWin(c.created_at));
  const ids = new Set(cands.map((c) => c.id));
  const apps = ids.size ? all('SELECT * FROM applications').filter((a) => ids.has(a.candidate_id)) : [];
  const appIds = new Set(apps.map((a) => a.id));
  const hasIv = new Set(appIds.size ? all('SELECT DISTINCT app_id FROM interviews').map((x) => x.app_id).filter((x) => appIds.has(x)) : []);
  const per = (fn) => new Set(apps.filter(fn).map((a) => a.candidate_id)).size;
  const hired = apps.filter((a) => a.result === 'Hired');
  const fees = hired.length ? all("SELECT app_id, fee FROM bills WHERE status NOT IN ('Draft','Cancelled') AND credit_of IS NULL").filter((b) => appIds.has(b.app_id)).reduce((t, b) => t + (b.fee || 0), 0) : 0;
  const pays = all('SELECT amount, date FROM portal_payments WHERE portal_id=?', p.id).filter((x) => (!from || x.date >= from) && (!to || x.date <= to));
  const spend = pays.reduce((t, x) => t + (x.amount || 0), 0);
  const r = rating(); const ret = spend ? fees / spend : null;
  const verdict = !spend ? null : ret >= r.good ? 'Good' : ret < r.poor ? 'Poor' : 'Average';
  const div = (a, b) => (b ? Math.round(a / b) : null);
  return { found: cands.length, relevant: per(() => true), sent: per((a) => L().stepIdx(a.step) >= 3), interviewed: per((a) => hasIv.has(a.id)), hired: new Set(hired.map((a) => a.candidate_id)).size, fees: Math.round(fees), spend: Math.round(spend),
    per_candidate: div(spend, cands.length), per_interview: div(spend, per((a) => hasIv.has(a.id))), per_hire: div(spend, hired.length), return_x: ret === null ? null : Math.round(ret * 10) / 10, verdict,
    last30: all('SELECT created_at FROM candidates WHERE merged_into IS NULL AND removed=0 AND lower(trim(source))=?', src).filter((c) => c.created_at >= new Date(Date.now() - 30 * 86400000).toISOString()).length };
}
function view(p) {
  const s = current(p.id); const t = today();
  const daysLeft = s && s.end ? Math.round((new Date(`${s.end}T00:00:00Z`) - new Date(`${t}T00:00:00Z`)) / 86400000) : null;
  const yearStart = `${new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1}-04-01`;
  const paidYear = get('SELECT COALESCE(SUM(amount),0) n FROM portal_payments WHERE portal_id=? AND date>=?', p.id, yearStart).n;
  const all1 = results(p); const live = s && s.start <= t && (!s.end || s.end >= t);
  const used = s ? get('SELECT COALESCE(SUM(credits),0) n FROM portal_usage WHERE sub_id=?', s.id).n : 0;
  return { ...p, sub: s ? { ...s, days_left: daysLeft, live: !!live, credits_used: used } : null, paid_year: Math.round(paidYear), results: all1,
    idle: !!(live && all1.last30 < 3) }; // paid for, but almost nothing came in the last 30 days
}
const one = (id) => { const p = get('SELECT * FROM portals WHERE id=?', id); if (!p) throw httpError(404, 'Portal not found'); return p; };
const fileFrom = (b, pid, type, by) => (b.file && b.file.base64 ? require('./files').storeBuffer({ recordId: `PT-${pid}`, type, name: b.file.name || 'file.pdf', buf: Buffer.from(String(b.file.base64).replace(/^data:[^,]*,/, ''), 'base64'), mime: b.file.mime || 'application/octet-stream', by }).id : null);
// A portal's source name joins the source list, so candidates from it can be tagged.
function learnSource(name) { const s = D.settings(); const list = s.lead_sources || []; if (name && !list.some((x) => x.toLowerCase() === name.toLowerCase())) D.setSetting('lead_sources', [...list, name]); }

route('GET', '/api/portals', ADMIN, () => {
  const rows = all('SELECT * FROM portals ORDER BY name').map(view);
  return { rows, statuses: STATUSES, kinds: KINDS, freq: FREQ, rating: rating(), sources: D.settings().lead_sources || [] };
});
route('GET', '/api/portals/:id', ADMIN, (ctx) => {
  const p = one(ctx.params.id); const q = ctx.query; const s = current(p.id);
  const win = q.period === 'all' || !s ? {} : { from: s.start, to: s.end };
  return { ...view(p), period: q.period === 'all' || !s ? 'all' : 'sub', window: win, res: results(p, win.from, win.to),
    quotes: all('SELECT * FROM portal_quotes WHERE portal_id=? ORDER BY date DESC, id DESC', p.id), subs: all('SELECT * FROM portal_subs WHERE portal_id=? ORDER BY start DESC', p.id),
    payments: all('SELECT * FROM portal_payments WHERE portal_id=? ORDER BY date DESC, id DESC', p.id), usage: all('SELECT * FROM portal_usage WHERE portal_id=? ORDER BY date DESC, id DESC LIMIT 50', p.id), freq: FREQ, statuses: STATUSES, kinds: KINDS };
});
route('POST', '/api/portals', ADMIN, (ctx) => {
  const b = ctx.body || {}; const name = String(b.name || '').trim(); if (!name) throw httpError(400, 'Enter the portal name', 'name');
  const rec = { name, website: String(b.website || '').trim(), kind: KINDS.includes(b.kind) ? b.kind : 'Resume database', good_for: String(b.good_for || '').trim(), source_name: String(b.source_name || name).trim(), status: STATUSES.includes(b.status) ? b.status : 'Evaluating', login_holder: String(b.login_holder || '').trim(), note: String(b.note || '').trim() };
  if (b.id) { one(b.id); update('portals', b.id, rec); learnSource(rec.source_name); D.history(ctx.actor.label, 'edit portal', `PT-${b.id}`, null, null, name); return { id: Number(b.id) }; }
  if (get('SELECT 1 FROM portals WHERE lower(name)=lower(?)', name)) throw httpError(409, `${name} is already added`, 'name');
  insert('portals', { ...rec, by: ctx.actor.label, at: now() }); const id = lastId(); learnSource(rec.source_name);
  D.history(ctx.actor.label, 'add portal', `PT-${id}`, null, null, name); return { id };
});
route('POST', '/api/portals/:id/quotes', ADMIN, (ctx) => {
  const p = one(ctx.params.id); const b = ctx.body || {};
  if (!String(b.plan || '').trim()) throw httpError(400, 'Enter the plan', 'plan');
  const rec = { portal_id: p.id, date: day(b.date) || today(), plan: String(b.plan).trim(), price: money(b.price, 'price', true), gst: money(b.gst, 'gst'), includes: String(b.includes || '').trim(), credits: b.credits ? Math.round(Number(b.credits)) : null, months: b.months ? Math.round(Number(b.months)) : null, valid_till: day(b.valid_till), by: ctx.actor.label, at: now() };
  insert('portal_quotes', rec); const id = lastId(); const f = fileFrom(b, p.id, `quote-${id}`, ctx.actor.label); if (f) update('portal_quotes', id, { file_id: f });
  if (p.status === 'Evaluating') update('portals', p.id, { status: 'Quote received' });
  return { id };
});
// Take a quote: the subscription is made from it (and the quote is marked taken).
route('POST', '/api/portals/:id/subs', ADMIN, (ctx) => {
  const p = one(ctx.params.id); const b = ctx.body || {};
  const start = day(b.start); if (!start) throw httpError(400, 'Enter the start date', 'start');
  const end = day(b.end) || (b.months ? addMonths(start, Number(b.months)) : null); if (!end) throw httpError(400, 'Enter the end date', 'end'); if (end < start) throw httpError(400, 'The end date is before the start', 'end');
  const rec = { plan: String(b.plan || '').trim() || 'Plan', start, end, amount: money(b.amount, 'amount', true), frequency: FREQ.includes(b.frequency) ? b.frequency : 'Yearly', auto_renew: b.auto_renew ? 1 : 0, credits: b.credits ? Math.round(Number(b.credits)) : null };
  if (b.id) { update('portal_subs', b.id, rec); return { id: Number(b.id) }; }
  insert('portal_subs', { ...rec, portal_id: p.id, quote_id: b.quote_id || null, by: ctx.actor.label, at: now() }); const id = lastId();
  if (b.quote_id) D.run('UPDATE portal_quotes SET taken=(id=?) WHERE portal_id=?', b.quote_id, p.id);
  update('portals', p.id, { status: 'Active' }); D.history(ctx.actor.label, 'portal subscription', `PT-${p.id}`, null, null, `${rec.plan} ${start} to ${end}`);
  return { id };
});
route('POST', '/api/portals/:id/payments', ADMIN, (ctx) => {
  const p = one(ctx.params.id); const b = ctx.body || {}; const s = current(p.id);
  insert('portal_payments', { portal_id: p.id, sub_id: b.sub_id || (s && s.id) || null, date: day(b.date) || today(), amount: money(b.amount, 'amount', true), ref: String(b.ref || '').trim(), by: ctx.actor.label, at: now() }); const id = lastId();
  const f = fileFrom(b, p.id, `payment-${id}`, ctx.actor.label); if (f) update('portal_payments', id, { file_id: f });
  return { id };
});
route('POST', '/api/portals/:id/usage', ADMIN, (ctx) => {
  const p = one(ctx.params.id); const b = ctx.body || {}; const s = current(p.id); const n = Math.round(Number(b.credits));
  if (!(n > 0)) throw httpError(400, 'Enter how many credits were used', 'credits');
  insert('portal_usage', { portal_id: p.id, sub_id: s ? s.id : null, date: day(b.date) || today(), credits: n, note: String(b.note || '').trim(), by: ctx.actor.label, at: now() }); return { id: lastId() };
});
route('POST', '/api/portals/:id/remove-row', ADMIN, (ctx) => {
  const p = one(ctx.params.id); const b = ctx.body || {}; const T = { quote: 'portal_quotes', payment: 'portal_payments', usage: 'portal_usage', sub: 'portal_subs' }[b.kind]; if (!T) throw httpError(400, 'Unknown row');
  D.run(`DELETE FROM ${T} WHERE id=? AND portal_id=?`, b.id, p.id); D.history(ctx.actor.label, 'remove portal row', `PT-${p.id}`, b.kind, b.id, null); return { ok: true };
});
// Timer: renewal alerts 15 and 3 days before a subscription ends (once each).
function sweep() {
  let n = 0;
  for (const s of all('SELECT s.*, p.name FROM portal_subs s JOIN portals p ON p.id=s.portal_id WHERE p.status=?', 'Active')) {
    const left = Math.round((new Date(`${s.end}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000);
    for (const at of [15, 3]) {
      if (left !== at) continue; const k = `portal_renew_${s.id}_${at}`; if (get('SELECT 1 FROM health WHERE key=?', k)) continue;
      for (const u of L().superAdmins()) L().alertUser(u.id, `${s.name}: the ${s.plan} subscription ends in ${at} days (${s.end})${s.auto_renew ? ' and renews by itself' : ''}`, null, false);
      D.setHealth(k, now()); n++;
    }
  }
  return n;
}
module.exports = { sweep, results, STATUSES };
