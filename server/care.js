// After joining: weekly, then monthly check-ins with the candidate and the client for the first 90 days, a call
// task for the recruiter at each one, and the replacements that follow when someone leaves. Also the candidates'
// reviews of their recruiter, which only the super admin reads.
const D = require('./db');
const L = require('./logic');
const V = require('./views');
const R = require('./router');
const { route, isSuper } = R;
const { get, all, insert, update, now, httpError } = D;

D.db.exec(`
CREATE TABLE IF NOT EXISTS care_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT, day INTEGER, party TEXT, status TEXT, outcome TEXT, note TEXT, by TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS ix_care_app ON care_checks(app_id);
CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id TEXT, user_id TEXT, app_id TEXT, stars INTEGER, text TEXT, google INTEGER DEFAULT 0, at TEXT);
`);

const T = { auth: 'team' };
const OUTCOMES = ['Doing well', 'Some concerns', 'Has left', 'No answer'];
const PARTIES = { candidate: 'Candidate', client: 'Client' };
const plan = () => { const c = D.settings().aftercare || {}; return { candidate: c.candidate || [7, 14, 21, 30, 60, 90], client: c.client || [7, 30, 60, 90] }; };
const marks = () => { const p = plan(); return [...new Set([...p.candidate, ...p.client])].sort((x, y) => x - y); };
const ownerOf = (a) => a.owner_id || (get('SELECT recruiter_id FROM jobs WHERE id=?', a.job_id) || {}).recruiter_id;
const dayDate = (a, day) => new Date(new Date(a.joined_at).getTime() + day * 86400000).toISOString();
const windowOf = (a) => { const j = get('SELECT client_id FROM jobs WHERE id=?', a.job_id); const c = get('SELECT replacement_days FROM clients WHERE id=?', j.client_id) || {}; return c.replacement_days || D.settings().replacement_days; };

// Run by the timer: each check-in that falls due goes out once, with a call task for the recruiter. A placement
// older than a check-in by a week skips it, so switching this on never floods anyone with old ones.
function due(count) {
  const p = plan();
  for (const a of all("SELECT * FROM applications WHERE result='Hired' AND left_date IS NULL AND joined_at IS NOT NULL")) {
    const days = L.daysBetween(a.joined_at);
    for (const day of marks()) {
      if (days < day || days >= day + 7 || get('SELECT 1 FROM care_checks WHERE app_id=? AND day=?', a.id, day)) continue;
      const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const cl = get('SELECT * FROM clients WHERE id=?', job.client_id); const cand = get('SELECT * FROM candidates WHERE id=?', a.candidate_id);
      for (const party of Object.keys(PARTIES)) {
        if (!p[party].includes(day)) continue;
        const r = party === 'candidate'
          ? L.sendWA({ ptype: 'candidate', pid: a.candidate_id, format: 'bbhs_post_join_checkin', vars: { days: day, company: cl.company }, ap: a.id, auto: true, rule: 'post_join_checkin', dedupe: `checkin:${a.id}:${day}` })
          : L.sendWA({ ptype: 'client', pid: cl.id, format: 'bbhs_client_hire_checkin', vars: { candidate: cand.name, job: job.title, days: day }, ap: a.id, auto: true, rule: 'client_hire_checkin', dedupe: `hirecheck:${a.id}:${day}` });
        insert('care_checks', { app_id: a.id, day, party, status: r && !r.skipped && r.status !== 'held' ? 'Sent' : 'Due', at: now() });
      }
      if (day === 14) L.sendWA({ ptype: 'candidate', pid: a.candidate_id, format: 'bbhs_review_request', vars: { link: L.link('my-profile/review') }, ap: a.id, auto: true, rule: 'review_request', dedupe: `review:${a.id}` });
      const o = ownerOf(a);
      if (o) insert('followups', { record_id: a.id, at: now(), note: `Day ${day} check-in: ${cand.name} at ${cl.company}. Speak to them and log how it is going.`, for_user: o, done: 0, created_by: o });
      if (count) count('aftercare');
    }
  }
}

// One answer from the candidate, the client or the recruiter, saved on the check-in it belongs to.
function record(a, party, outcome, by, note) {
  if (!PARTIES[party]) throw httpError(400, 'Pick who you spoke to', 'party');
  if (!OUTCOMES.includes(outcome)) throw httpError(400, 'Pick how it is going', 'outcome');
  if (!a.joined_at) throw httpError(400, 'This candidate has not joined yet.');
  const days = L.daysBetween(a.joined_at);
  const open = get("SELECT * FROM care_checks WHERE app_id=? AND party=? AND status<>'Done' ORDER BY day DESC LIMIT 1", a.id, party);
  const day = open ? open.day : [...marks()].reverse().find((m) => m <= days && !get("SELECT 1 FROM care_checks WHERE app_id=? AND day=? AND party=? AND status='Done'", a.id, m, party)) ?? days;
  const row = { status: 'Done', outcome, note: String(note || '').trim().slice(0, 1000), by: by.label, at: now() };
  if (open) update('care_checks', open.id, row); else insert('care_checks', { app_id: a.id, day, party, ...row });
  D.run("UPDATE followups SET done=1 WHERE record_id=? AND done=0 AND note LIKE 'Day % check-in:%'", a.id);
  L.appHist(a.id, a.step, by, `Day ${day} check-in with the ${party}: ${outcome}${row.note ? ` (${row.note})` : ''}`, 'care');
  const o = ownerOf(a);
  if (outcome === 'Some concerns') { update('applications', a.id, { at_risk: 1 }); if (o && by.label.includes('WhatsApp')) L.alertUser(o, `${a.id}: the ${party} has concerns at day ${day}. Call them.`, a.id, 'candidate'); }
  if (outcome === 'Doing well' && !by.label.includes('WhatsApp')) update('applications', a.id, { at_risk: 0 });
  if (outcome === 'Has left' && o) L.alertUser(o, `${a.id}: the ${party} says the candidate has left. Mark "Left the job" to start the replacement.`, a.id, 'candidate');
  return { ok: true, day };
}

// Taps on the check-in buttons. Returns the effect, or null when the reply is not about a check-in.
const TAPS = { candidate: { 'all good': 'Doing well', 'need help': 'Some concerns' }, client: { 'doing well': 'Doing well', 'some concerns': 'Some concerns', 'has left': 'Has left' } };
function reply(ref, ptype, t, by) {
  if (!ref || !ref.ap || !['post_join_checkin', 'client_hire_checkin'].includes(ref.rule)) return null;
  const outcome = (TAPS[ptype] || {})[t]; if (!outcome) return null;
  const a = get('SELECT * FROM applications WHERE id=?', ref.ap); if (!a || !a.joined_at) return null;
  record(a, ptype, outcome, by);
  return `Check-in answer saved: ${outcome}`;
}

function scheduleOf(a) {
  const p = plan(); const since = a.joined_at ? L.daysBetween(a.joined_at, a.left_date ? new Date(a.left_date) : undefined) : 0;
  const rows = all('SELECT * FROM care_checks WHERE app_id=? ORDER BY day, id', a.id);
  return marks().map((day) => {
    const mine = rows.filter((r) => r.day === day);
    const parties = Object.keys(PARTIES).filter((x) => p[x].includes(day) || mine.some((r) => r.party === x)).map((party) => {
      const r = mine.filter((x) => x.party === party).pop();
      const status = r ? (r.status === 'Done' ? r.outcome : r.status === 'Sent' ? 'Waiting for answer' : 'To do') : a.left_date ? '—' : since < day ? 'Upcoming' : 'Missed';
      return { party, status, note: r && r.note, by: r && r.by, at: r && r.at };
    });
    return { day, date: a.joined_at ? dayDate(a, day) : null, parties, done: parties.length > 0 && parties.every((x) => OUTCOMES.includes(x.status)) };
  });
}
function forApp(a) {
  if (!a.joined_at) return null;
  const since = L.daysBetween(a.joined_at, a.left_date ? new Date(a.left_date) : undefined);
  const extra = all('SELECT * FROM care_checks WHERE app_id=? AND day NOT IN (' + marks().join(',') + ") AND status='Done' ORDER BY at", a.id);
  return { since, window: windowOf(a), schedule: scheduleOf(a), extra, outcomes: OUTCOMES, parties: PARTIES, over: since > Math.max(...marks()) || !!a.left_date };
}

route('POST', '/api/applications/:id/checkin', T, (ctx) => {
  const a = get('SELECT * FROM applications WHERE id=?', ctx.params.id); if (!a || !R.seeApp(ctx.user, a)) throw httpError(404, 'Application not found');
  if (a.result !== 'Hired') throw httpError(400, 'Check-ins are for candidates who have joined.');
  return record(a, ctx.body.party, ctx.body.outcome, ctx.actor, ctx.body.note);
});

// The Offer page: offers waiting to be accepted or joined, everyone in their first 90 days, and every replacement.
const txt = (s) => String(s || '').toLowerCase();
function replacementOf(a) {
  const used = !!a.replacement_used; const win = windowOf(a); const stay = L.daysBetween(a.joined_at, new Date(a.left_date).toISOString());
  const next = get('SELECT * FROM applications WHERE replacement_of=? ORDER BY created_at DESC', a.id)
    || (used ? get("SELECT * FROM applications WHERE job_id=? AND id<>? AND result='Hired' AND joined_at>? ORDER BY joined_at", a.job_id, a.id, new Date(a.left_date).toISOString()) : null);
  const open = used && !next ? get("SELECT * FROM applications WHERE job_id=? AND id<>? AND result='open' AND created_at>? ORDER BY created_at DESC", a.job_id, a.id, new Date(a.left_date).toISOString()) : null;
  const by = next || open;
  const status = !used ? 'Not covered' : next && next.result === 'Hired' ? 'Replaced' : by ? 'In progress' : 'To find';
  return { status, free: used, why: used ? '' : stay > win ? `Left after ${stay} days (window ${win})` : a.left_reason || 'Not a free replacement', stay, by: by ? { id: by.id, name: (get('SELECT name FROM candidates WHERE id=?', by.candidate_id) || {}).name, step: by.step, result: by.result } : null };
}
route('GET', '/api/aftercare', T, (ctx) => {
  const u = ctx.user; const q = ctx.query; const s = txt(q.q); const last = Math.max(...marks());
  const match = (v) => !s || [v.candidate_name, v.client_name, v.job_title, v.id].some((x) => txt(x).includes(s));
  const joined = all("SELECT * FROM applications WHERE result='Hired' AND joined_at IS NOT NULL AND left_date IS NULL").filter((a) => R.seeApp(u, a) && L.daysBetween(a.joined_at) <= last + 7);
  const active = joined.map((a) => {
    const v = V.appView(a); const sch = scheduleOf(a); const since = L.daysBetween(a.joined_at); const win = windowOf(a);
    const todo = sch.filter((x) => x.day <= since && x.parties.some((p) => ['To do', 'Waiting for answer', 'Missed'].includes(p.status)));
    const next = sch.find((x) => x.day > since);
    const done = all("SELECT * FROM care_checks WHERE app_id=? AND status='Done' ORDER BY at DESC LIMIT 1", a.id)[0];
    return { id: a.id, candidate_id: a.candidate_id, candidate_name: v.candidate_name, client_name: v.client_name, job_title: v.job_title, owner_name: v.owner_name, joined_at: a.joined_at, since, at_risk: !!a.at_risk, schedule: sch, todo: todo.map((x) => x.day), next: next ? { day: next.day, date: next.date } : null, last: done ? { day: done.day, party: done.party, outcome: done.outcome, note: done.note, at: done.at } : null, window_left: Math.max(0, win - since) };
  }).filter(match);
  const today = new Date().toISOString().slice(0, 10);
  const offers = all("SELECT * FROM applications WHERE result='open' AND step IN ('Offer made','Offer accepted') ORDER BY joining_date").filter((a) => R.seeApp(u, a)).map((a) => {
    const v = V.appView(a); const late = !!a.joining_date && a.joining_date < today;
    return { id: a.id, candidate_id: a.candidate_id, candidate_name: v.candidate_name, client_name: v.client_name, job_title: v.job_title, owner_name: v.owner_name, step: a.step, ctc: a.offer_ctc || 0, joining_date: a.joining_date || null, late, days: a.joining_date ? L.daysBetween(today + 'T00:00:00Z', a.joining_date + 'T00:00:00Z') : null };
  }).filter(match);
  const leftApps = all('SELECT * FROM applications WHERE left_date IS NOT NULL ORDER BY left_date DESC').filter((a) => R.seeApp(u, a) && a.joined_at);
  const asked = all("SELECT b.app_id FROM bills b WHERE b.replacement_requested=1").map((b) => b.app_id);
  const replacements = [
    ...all('SELECT * FROM applications WHERE id IN (' + (asked.map(() => '?').join(',') || "''") + ') AND left_date IS NULL', ...asked).filter((a) => R.seeApp(u, a)).map((a) => ({ a, r: { status: 'Client asked', free: true, why: 'The client asked for a replacement. Mark "Left the job" to start it.', stay: L.daysBetween(a.joined_at), by: null } })),
    ...leftApps.map((a) => ({ a, r: replacementOf(a) })),
  ].map(({ a, r }) => { const v = V.appView(a); return { id: a.id, candidate_id: a.candidate_id, candidate_name: v.candidate_name, client_name: v.client_name, job_id: a.job_id, job_title: v.job_title, owner_name: v.owner_name, joined_at: a.joined_at, left_date: a.left_date, left_reason: a.left_reason, ...r }; }).filter(match);
  return {
    offers,
    active: active.sort((x, y) => y.todo.length - x.todo.length || Number(y.at_risk) - Number(x.at_risk) || x.since - y.since), replacements,
    counts: { offers: offers.length, late: offers.filter((x) => x.late).length, active: active.length, todo: active.filter((x) => x.todo.length).length, at_risk: active.filter((x) => x.at_risk).length, to_find: replacements.filter((x) => ['To find', 'Client asked'].includes(x.status)).length, in_progress: replacements.filter((x) => x.status === 'In progress').length },
    marks: marks(), plan: plan(), outcomes: OUTCOMES,
  };
});

// ---------- reviews of recruiters by candidates: kept for the super admin only ----------
const STAFF = "level IN ('super','admin','sub') AND status='On'";
function recruitersOf(candId) {
  const ids = new Set();
  for (const a of all('SELECT a.owner_id, j.recruiter_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=?', candId)) for (const x of [a.owner_id, a.recruiter_id]) if (x) ids.add(x);
  const c = get('SELECT recruiter_id FROM candidates WHERE id=?', candId); if (c && c.recruiter_id) ids.add(c.recruiter_id);
  for (const x of all("SELECT DISTINCT user_id FROM calls WHERE candidate_id=? AND status='Done'", candId)) if (x.user_id) ids.add(x.user_id);
  return [...ids].map((id) => get(`SELECT id, name FROM users WHERE id=? AND ${STAFF}`, id)).filter(Boolean);
}
const googleUrl = () => String(D.settings().google_review_url || '').trim();
route('GET', '/api/cand/reviews', { auth: 'candidate' }, (ctx) => {
  const mine = all('SELECT * FROM reviews WHERE candidate_id=?', ctx.candidate.id);
  return { recruiters: recruitersOf(ctx.candidate.id).map((r) => { const x = mine.find((m) => m.user_id === r.id); return { id: r.id, name: r.name.split(' ')[0], stars: x ? x.stars : null, text: x ? x.text : '' }; }), google: !!googleUrl() };
});
route('POST', '/api/cand/reviews', { auth: 'candidate', rate: { key: 'review', max: 20, minutes: 60 } }, (ctx) => {
  const b = ctx.body; const c = ctx.candidate;
  if (!recruitersOf(c.id).some((r) => r.id === b.user_id)) throw httpError(400, 'Pick the recruiter you worked with');
  const stars = Math.round(Number(b.stars)); if (!(stars >= 1 && stars <= 5)) throw httpError(400, 'Pick 1 to 5 stars', 'stars');
  const text = String(b.text || '').trim().slice(0, 1500);
  const old = get('SELECT * FROM reviews WHERE candidate_id=? AND user_id=?', c.id, b.user_id);
  if (old) update('reviews', old.id, { stars, text, at: now() }); else insert('reviews', { candidate_id: c.id, user_id: b.user_id, app_id: null, stars, text, google: 0, at: now() });
  const name = (get('SELECT name FROM users WHERE id=?', b.user_id) || {}).name || '';
  for (const s of L.superAdmins()) insert('alerts', { user_id: s.id, text: `New review: ${stars}★ for ${name}`, record_id: 'reviews', read: 0, at: now() });
  return { ok: true, google_url: stars >= 4 ? googleUrl() || null : null, name: name.split(' ')[0] };
});
route('POST', '/api/cand/reviews/:uid/google', { auth: 'candidate' }, (ctx) => { D.run('UPDATE reviews SET google=1 WHERE candidate_id=? AND user_id=?', ctx.candidate.id, ctx.params.uid); return { ok: true }; });
route('GET', '/api/reviews', { auth: 'team', levels: ['super'] }, (ctx) => {
  const rows = all('SELECT r.*, c.name candidate_name, u.name user_name, u.level FROM reviews r JOIN candidates c ON c.id=r.candidate_id JOIN users u ON u.id=r.user_id ORDER BY r.at DESC');
  const per = {};
  for (const r of rows) { const p = (per[r.user_id] = per[r.user_id] || { id: r.user_id, name: r.user_name, level: r.level, count: 0, sum: 0, low: 0, google: 0 }); p.count += 1; p.sum += r.stars; if (r.stars <= 2) p.low += 1; if (r.google) p.google += 1; }
  return { recruiters: Object.values(per).map((p) => ({ ...p, avg: Math.round((p.sum / p.count) * 10) / 10 })).sort((x, y) => y.avg - x.avg), reviews: rows.filter((r) => !ctx.query.user || r.user_id === ctx.query.user), google_url: googleUrl() };
});

module.exports = { due, reply, record, forApp, recruitersOf, OUTCOMES };
