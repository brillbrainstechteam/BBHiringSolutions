// Delete with a recycle bin: deleting a client, job, candidate or application moves it and everything that hangs off
// it (a client's jobs, a job's applications, their history, interviews, notes, files...) into the bin in one piece.
// Nothing else in the portal sees it any more. The super admin can restore it from Settings -> Deleted items, or
// delete it for good. Records with bills are never deleted: the accounts need them.
const D = require('./db');
const L = require('./logic');
const R = require('./router');
const { route, isSuper } = R;
const { get, all, insert, now, httpError } = D;

const T = { auth: 'team' };
const SUPER = { auth: 'team', levels: ['super'] };
D.db.exec('CREATE TABLE IF NOT EXISTS trash (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, ref_id TEXT, label TEXT, agency_id TEXT, rows TEXT, counts TEXT, deleted_by TEXT, deleted_at TEXT)');

const KINDS = { client: 'clients', job: 'jobs', candidate: 'candidates', application: 'applications' };
const keyOf = (table, r) => (table === 'account_passwords' ? `${r.kind}|${r.subject_id}` : String(r.id));

// Everything that goes with one record, gathered into bag = { table: [rows] }.
function gather(kind, id) {
  const bag = {}; const seen = {};
  const take = (table, where, ...args) => {
    const rows = all(`SELECT * FROM ${table} WHERE ${where}`, ...args);
    seen[table] = seen[table] || new Set();
    for (const r of rows) { const k = keyOf(table, r); if (!seen[table].has(k)) { seen[table].add(k); (bag[table] = bag[table] || []).push(r); } }
    return rows;
  };
  const byRecord = (rid) => { for (const t of ['notes', 'files', 'followups', 'alerts']) take(t, 'record_id=?', rid); };
  const person = (ptype, pid) => { take('consents', 'person_type=? AND person_id=?', ptype, pid); take('messages', 'person_type=? AND person_id=?', ptype, pid); take('data_requests', 'person_type=? AND person_id=?', ptype, pid); take('account_passwords', 'kind=? AND subject_id=?', ptype, pid); };
  const app = (aid) => { take('applications', 'id=?', aid); for (const t of ['app_history', 'interviews', 'iv_notes', 'calls']) take(t, 'app_id=?', aid); byRecord(aid); };
  const job = (jid) => { for (const a of all('SELECT id FROM applications WHERE job_id=?', jid)) app(a.id); take('jobs', 'id=?', jid); take('job_history', 'job_id=?', jid); take('postings', 'job_id=?', jid); byRecord(jid); };
  if (kind === 'application') app(id);
  else if (kind === 'job') job(id);
  else if (kind === 'candidate') {
    for (const a of all('SELECT id FROM applications WHERE candidate_id=?', id)) app(a.id);
    take('candidates', 'id=?', id); take('calls', 'candidate_id=?', id); take('iv_notes', 'candidate_id=?', id); byRecord(id); person('candidate', id);
  } else if (kind === 'client') {
    for (const j of all('SELECT id FROM jobs WHERE client_id=?', id)) job(j.id);
    take('clients', 'id=?', id); take('client_members', 'client_id=?', id); take('client_activity', 'client_id=?', id); byRecord(id); person('client', id);
  }
  return bag;
}
// The record itself, who may delete it, and what it is called.
function target(u, kind, id) {
  if (!KINDS[kind]) throw httpError(400, 'Unknown record type');
  const rec = get(`SELECT * FROM ${KINDS[kind]} WHERE id=?`, kind === 'candidate' || kind === 'client' ? L.resolveId(String(id)) : String(id));
  if (!rec) throw httpError(404, 'Not found (maybe already deleted)');
  const agency = kind === 'application' ? (get('SELECT agency_id FROM jobs WHERE id=?', rec.job_id) || {}).agency_id : rec.agency_id;
  if (!isSuper(u) && !(u.level === 'admin' && agency && agency === u.agency_id)) throw httpError(403, 'Only the super admin, or the admin of the agency it belongs to, can delete this.');
  const label = kind === 'client' ? rec.company : kind === 'candidate' ? rec.name : kind === 'job' ? `${rec.title}${rec.city ? `, ${rec.city}` : ''}` : (() => { const c = get('SELECT name FROM candidates WHERE id=?', rec.candidate_id) || {}; const j = get('SELECT title FROM jobs WHERE id=?', rec.job_id) || {}; return `${c.name || rec.candidate_id} on ${j.title || rec.job_id}`; })();
  return { rec, agency, label };
}
const countsOf = (bag) => Object.fromEntries(Object.entries(bag).map(([t, rows]) => [t, rows.length]));
function deleteOne(u, actor, kind, id, dry) {
  const t = target(u, kind, id); const rid = t.rec.id; const bag = gather(kind, rid);
  const appIds = (bag.applications || []).map((a) => a.id);
  const billed = all(`SELECT id, bill_no FROM bills WHERE ${kind === 'client' ? 'client_id=? OR ' : ''}app_id IN (${appIds.map(() => '?').join(',') || "''"})`, ...(kind === 'client' ? [rid] : []), ...appIds);
  if (billed.length) throw httpError(400, `This has bills (${billed.map((b) => b.bill_no || b.id).join(', ')}), so it stays for the accounts. Close it instead.`);
  const counts = countsOf(bag);
  if (dry) return { kind, id: rid, label: t.label, counts };
  insert('trash', { kind, ref_id: rid, label: t.label, agency_id: t.agency || null, rows: JSON.stringify(bag), counts: JSON.stringify(counts), deleted_by: actor.label, deleted_at: now() });
  for (const [table, rows] of Object.entries(bag)) for (const r of rows) {
    if (table === 'account_passwords') D.run('DELETE FROM account_passwords WHERE kind=? AND subject_id=?', r.kind, r.subject_id); else D.run(`DELETE FROM ${table} WHERE id=?`, r.id);
  }
  if (kind === 'candidate' || kind === 'client') D.run('DELETE FROM sessions WHERE kind=? AND subject_id=?', kind, rid);
  for (const jid of new Set((bag.applications || []).map((a) => a.job_id))) if (get('SELECT 1 FROM jobs WHERE id=?', jid)) L.recalcJob(jid, actor.label, 'An application was deleted');
  D.history(actor.label, 'delete', rid, kind, null, `${t.label} moved to Deleted items (${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')})`);
  return { ok: true, kind, id: rid, label: t.label, counts };
}

// Once (31 Oct 2026): applications made automatically for Email candidates (by the inbox or the auto-mapper) go to
// Deleted items; email candidates stay candidates only. Restorable from Settings -> Deleted items.
if (!(D.settings().done_once || []).includes('email_apps_binned')) {
  const sys = { level: 'super' }; const actor = { label: 'System: email applications removed' }; let n = 0;
  for (const a of all("SELECT a.id FROM applications a JOIN candidates c ON c.id=a.candidate_id WHERE c.source='Email' AND EXISTS (SELECT 1 FROM app_history h WHERE h.app_id=a.id AND (h.note LIKE 'From the email%' OR h.note LIKE 'Matched automatically%'))")) {
    try { deleteOne(sys, actor, 'application', a.id); n++; } catch (e) { console.error('email app', a.id, e.message); }
  }
  D.setSetting('done_once', [...(D.settings().done_once || []), 'email_apps_binned']);
  if (n) console.log(`Moved ${n} email applications to Deleted items`);
}

// dry=true: what would go with it (for the confirmation). ids: several of one kind at once.
route('POST', '/api/delete', T, (ctx) => {
  const b = ctx.body || {}; const ids = Array.isArray(b.ids) ? b.ids.slice(0, 500) : [b.id];
  if (ids.length === 1) return deleteOne(ctx.user, ctx.actor, b.kind, ids[0], b.dry);
  const out = { done: 0, errors: [], counts: {} };
  for (const id of ids) {
    try { const r = deleteOne(ctx.user, ctx.actor, b.kind, id, b.dry); out.done++; for (const [k, n] of Object.entries(r.counts)) out.counts[k] = (out.counts[k] || 0) + n; } catch (e) { out.errors.push(`${id}: ${e.message}`); }
  }
  return out;
});
route('GET', '/api/trash', SUPER, () => ({ rows: all('SELECT id, kind, ref_id, label, counts, deleted_by, deleted_at FROM trash ORDER BY deleted_at DESC LIMIT 500').map((t) => ({ ...t, counts: JSON.parse(t.counts || '{}') })) }));
// Put everything back as it was. A row whose id is taken again in the meantime is skipped.
route('POST', '/api/trash/:id/restore', SUPER, (ctx) => {
  const t = get('SELECT * FROM trash WHERE id=?', ctx.params.id); if (!t) throw httpError(404, 'Not in Deleted items');
  const bag = JSON.parse(t.rows || '{}'); let back = 0; const skipped = [];
  const order = ['clients', 'client_members', 'client_activity', 'candidates', 'jobs', 'job_history', 'postings', 'applications', 'app_history', 'interviews', 'iv_notes', 'calls'];
  for (const table of [...order, ...Object.keys(bag).filter((x) => !order.includes(x))]) for (const r of bag[table] || []) {
    try { insert(table, r); back++; } catch (e) { skipped.push(`${table} ${keyOf(table, r)}`); }
  }
  D.run('DELETE FROM trash WHERE id=?', t.id);
  for (const j of (bag.jobs || []).concat((bag.applications || []).map((a) => ({ id: a.job_id })))) if (get('SELECT 1 FROM jobs WHERE id=?', j.id)) L.recalcJob(j.id, ctx.actor.label, 'Restored');
  D.history(ctx.actor.label, 'restore', t.ref_id, t.kind, null, `${t.label} restored from Deleted items`);
  return { ok: true, restored: back, skipped };
});
route('POST', '/api/trash/:id/purge', SUPER, (ctx) => {
  const t = get('SELECT * FROM trash WHERE id=?', ctx.params.id); if (!t) throw httpError(404, 'Not in Deleted items');
  D.run('DELETE FROM trash WHERE id=?', t.id);
  D.history(ctx.actor.label, 'delete for good', t.ref_id, t.kind, null, t.label);
  return { ok: true };
});
