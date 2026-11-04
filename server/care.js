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
    // For recording an offer by hand: everyone in an interview round, not yet at the offer.
    can_offer: all("SELECT * FROM applications WHERE result='open' AND step IN ('Our interview','Sent to client','Client interview')").filter((a) => R.seeApp(u, a)).map((a) => { const v = V.appView(a); return { id: a.id, label: `${v.candidate_name} · ${v.job_title} · ${v.client_name || ''}` }; }).sort((x, y) => x.label.localeCompare(y.label)),
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
const googleUrl = () => ''; // feedback stays with us: candidates rate their recruiter, no public review step
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
  return { recruiters: Object.values(per).map((p) => ({ ...p, avg: Math.round((p.sum / p.count) * 10) / 10 })).sort((x, y) => y.avg - x.avg), reviews: rows.filter((r) => !ctx.query.user || r.user_id === ctx.query.user), google_url: googleUrl(),
    client_reviews: all('SELECT r.*, u.name user_name, c.company, j.title job_title FROM client_reviews r JOIN users u ON u.id=r.user_id LEFT JOIN clients c ON c.id=r.client_id LEFT JOIN jobs j ON j.id=r.job_id ORDER BY r.at DESC').filter((r) => !ctx.query.user || r.user_id === ctx.query.user),
    askable: all("SELECT DISTINCT j.id, j.title, c.company, (SELECT MAX(sent_at) FROM client_review_asks k WHERE k.job_id=j.id) asked, (SELECT MAX(done_at) FROM client_review_asks k WHERE k.job_id=j.id) answered FROM interviews i JOIN applications a ON a.id=i.app_id JOIN jobs j ON j.id=a.job_id JOIN clients c ON c.id=j.client_id WHERE i.round != 'ours' AND i.status='Completed' ORDER BY j.id DESC") };
});

// ---------- reviews of recruiters by clients: kept for the super admin only ----------
// Once the client has interviewed our candidates for a job, the client gets a WhatsApp with a link to a short form
// (/rate/<code>, no login): 1-5 stars and a line for each recruiter on that job. Answers land in Recruiter reviews.
D.db.exec(`
CREATE TABLE IF NOT EXISTS client_review_asks (token TEXT PRIMARY KEY, client_id TEXT, job_id TEXT, sent_at TEXT, done_at TEXT);
CREATE TABLE IF NOT EXISTS client_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT, job_id TEXT, user_id TEXT, stars INTEGER, text TEXT, by_name TEXT, at TEXT);
`);
function jobRecruiters(jobId) {
  const j = get('SELECT * FROM jobs WHERE id=?', jobId) || {}; const ids = new Set([j.recruiter_id, ...(Array.isArray(j.owners) ? j.owners : [])]);
  for (const a of all('SELECT owner_id FROM applications WHERE job_id=?', jobId)) ids.add(a.owner_id);
  return [...ids].filter(Boolean).map((id) => get(`SELECT id, name FROM users WHERE id=? AND ${STAFF}`, id)).filter(Boolean);
}
// by: a super admin asking by hand (sent even if asked before); none: the automatic one after a client interview, once a job.
function askClientReview(jobId, by) {
  const j = get('SELECT * FROM jobs WHERE id=?', jobId); if (!j || !j.client_id) return { skipped: 'No client on this job' };
  if (!jobRecruiters(jobId).length) return { skipped: 'No recruiter on this job yet' };
  let ask = get('SELECT * FROM client_review_asks WHERE job_id=? AND done_at IS NULL', jobId);
  if (!ask) { ask = { token: require('crypto').randomBytes(12).toString('base64url'), client_id: j.client_id, job_id: jobId, sent_at: now(), done_at: null }; insert('client_review_asks', ask); }
  const link = L.link(`rate/${ask.token}`); const cl = get('SELECT contact, whatsapp FROM clients WHERE id=?', j.client_id) || {};
  // By hand, the link comes back too: while Meta has not approved the message, the super admin sends it themselves.
  let sent; try { sent = L.sendWA({ ptype: 'client', pid: j.client_id, format: 'bbhs_client_review', vars: { job: j.title, link }, ...(by ? { by } : { auto: true, rule: 'client_review', dedupe: `crev:${jobId}` }) }); } catch (e) { if (!by) throw e; sent = { skipped: e.message }; }
  if (by && sent && ['held', 'failed'].includes(sent.status)) sent = { skipped: sent.status === 'held' ? `held (${String(sent.error || '').replace(/^Held: /, '')}); it goes by itself once messages are on` : sent.error || 'failed' };
  return { ...sent, link, contact: cl.contact || '', whatsapp: cl.whatsapp || '', job: j.title };
}
const askOf = (token) => { const a = get('SELECT * FROM client_review_asks WHERE token=?', String(token || '')); if (!a) throw httpError(404, 'This link is not valid any more.'); return a; };
route('GET', '/api/pub/rate/:token', {}, (ctx) => {
  const a = askOf(ctx.params.token); const j = get('SELECT title FROM jobs WHERE id=?', a.job_id) || {}; const c = get('SELECT company, contact FROM clients WHERE id=?', a.client_id) || {};
  return { company: c.company, contact: c.contact, job: j.title, done: !!a.done_at, recruiters: jobRecruiters(a.job_id).map((r) => ({ id: r.id, name: r.name })) };
});
route('POST', '/api/pub/rate/:token', { rate: { key: 'crate', max: 20, minutes: 60 } }, (ctx) => {
  const a = askOf(ctx.params.token); const b = ctx.body || {}; const team = jobRecruiters(a.job_id);
  const given = (Array.isArray(b.ratings) ? b.ratings : []).filter((r) => team.some((t) => t.id === r.user_id) && Number(r.stars) >= 1 && Number(r.stars) <= 5);
  if (!given.length) throw httpError(400, 'Please give at least one rating (1 to 5 stars).');
  const by = String(b.name || '').trim().slice(0, 80) || (get('SELECT contact FROM clients WHERE id=?', a.client_id) || {}).contact || '';
  for (const r of given) {
    const row = { client_id: a.client_id, job_id: a.job_id, user_id: r.user_id, stars: Math.round(Number(r.stars)), text: String(r.text || '').trim().slice(0, 1500), by_name: by, at: now() };
    const old = get('SELECT id FROM client_reviews WHERE job_id=? AND user_id=?', a.job_id, r.user_id);
    if (old) update('client_reviews', old.id, row); else insert('client_reviews', row);
  }
  D.run('UPDATE client_review_asks SET done_at=? WHERE token=?', now(), a.token);
  const company = (get('SELECT company FROM clients WHERE id=?', a.client_id) || {}).company || '';
  for (const s of L.superAdmins()) insert('alerts', { user_id: s.id, text: `Client review from ${company}: ${given.map((r) => `${r.stars}★`).join(', ')}`, record_id: 'reviews', read: 0, at: now() });
  return { ok: true };
});
// The form a client opens from the WhatsApp: stars and a line for each recruiter, one Send.
function rateHtml(token) {
  const a = get('SELECT * FROM client_review_asks WHERE token=?', String(token || '')); if (!a) return null;
  const e = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const b = D.settings().business; const j = get('SELECT title FROM jobs WHERE id=?', a.job_id) || {}; const c = get('SELECT company, contact FROM clients WHERE id=?', a.client_id) || {};
  const people = jobRecruiters(a.job_id);
  const rows = people.map((p) => `<fieldset data-u="${e(p.id)}"><legend>${e(p.name)}</legend><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="s_${e(p.id)}" value="${n}"><span>★</span></label>`).join('')}</div><textarea maxlength="1500" placeholder="What went well, what could be better (optional)"></textarea></fieldset>`).join('');
  const body = a.done_at ? '<div class="done">Thank you! Your rating has reached our senior team.</div>'
    : people.length ? `<form id="f"><p>Thank you for meeting our candidates for <b>${e(j.title)}</b>. How did our recruiter${people.length > 1 ? 's' : ''} do? Only our senior team reads this.</p>${rows}<label class="nm">Your name<input name="name" value="${e(c.contact || '')}" maxlength="80"></label><button>Send</button><div id="err"></div></form>`
      : '<div class="done">Thank you. There is nothing to rate on this link yet.</div>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Rate your recruiter · ${e(b.name)}</title>
<style>:root{--navy:#101a3a;--gold:#d4a017;--ink:#1d2433;--muted:#5d6577;--line:#e6e8ef;--bg:#f6f7fb}*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
header{background:var(--navy);color:#fff;padding:18px 16px}header .in,main{max-width:560px;margin:0 auto}header b{font-size:15px}header span{display:block;font-size:12px;opacity:.7}main{padding:20px 16px 40px}
fieldset{border:1px solid var(--line);background:#fff;border-radius:12px;padding:12px 14px 14px;margin:0 0 12px}legend{font-weight:600;padding:0 4px}
.stars{display:flex;gap:6px;margin:4px 0 10px}.stars input{position:absolute;opacity:0}.stars span{font-size:32px;color:#d5d8e0;cursor:pointer;line-height:1}.stars label.on span{color:var(--gold)}
textarea,input[name=name]{width:100%;border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit;background:#fff}textarea{min-height:64px}.nm{display:block;font-size:14px;color:var(--muted);margin:4px 0 14px}
button{width:100%;background:var(--navy);color:#fff;border:0;border-radius:10px;padding:13px;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.6}#err{color:#b42318;margin-top:10px;font-size:14px}
.done{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px;text-align:center}</style></head>
<body><header><div class="in"><b>${e(b.name)}</b><span>${e(c.company || '')}</span></div></header><main>${body}</main>
<script>(function(){var f=document.getElementById('f');if(!f)return;
f.querySelectorAll('.stars').forEach(function(g){var ls=g.querySelectorAll('label');ls.forEach(function(l,i){l.addEventListener('click',function(){ls.forEach(function(x,k){x.classList.toggle('on',k<=i)})})})});
f.addEventListener('submit',function(ev){ev.preventDefault();var btn=f.querySelector('button'),err=document.getElementById('err');err.textContent='';
var ratings=[].map.call(f.querySelectorAll('fieldset'),function(fs){var c=fs.querySelector('input:checked');return{user_id:fs.dataset.u,stars:c?Number(c.value):0,text:fs.querySelector('textarea').value}}).filter(function(r){return r.stars});
if(!ratings.length){err.textContent='Please tap the stars for at least one person.';return}btn.disabled=true;
fetch('/api/pub/rate/${e(a.token)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.name.value,ratings:ratings})}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||'Could not send');f.outerHTML='<div class="done">Thank you! Your rating has reached our senior team.</div>'})}).catch(function(x){err.textContent=x.message;btn.disabled=false})})})();</script></body></html>`;
}
// Super admin: ask a client by hand (the jobs whose client has interviewed our candidates are offered).
route('POST', '/api/reviews/ask-client', { auth: 'team', levels: ['super'] }, (ctx) => askClientReview(String(ctx.body.job_id || ''), ctx.actor));


module.exports = { due, reply, record, forApp, recruitersOf, askClientReview, rateHtml, OUTCOMES };
