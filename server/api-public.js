// Logins, public forms (#hire, #apply), client account (#my-account), candidate account (#my-profile), files, CRM links.
const crypto = require('crypto');
const D = require('./db');
const L = require('./logic');
const V = require('./views');
const F = require('./files');
const R = require('./router');
const TEAM = require('./api-team');
const { route, newSession } = R;
const { get, all, insert, update, now, httpError } = D;

// ---------- public settings for forms ----------
route('GET', '/api/bootstrap', {}, () => {
  const s = D.settings();
  return {
    business: { name: s.business.name, short: s.business.short, support_phone: s.business.support_phone, primary: s.business.primary, accent: s.business.accent },
    jobs: L.jobList().filter((j) => !j.hidden), industries: Object.fromEntries(Object.keys(s.industries).map((k) => [k, L.jobList(k).filter((j) => !j.hidden)])), default_industry: s.default_industry, departments: s.departments, cities: s.cities.map((c) => c.name), skills: s.skills, stages: s.client_stages,
    closing_reasons: s.closing_reasons, job_close_reasons: s.job_close_reasons, reopen_reasons: s.reopen_reasons, lead_sources: s.lead_sources, src_tags: s.src_tags,
    steps: L.STEPS, consent: L.CONSENT_WORDING, fee: s.fee, agency_share_pct: s.agency_share_pct, gst: s.gst, match: s.match, quiet: s.quiet, log_deadline: s.log_deadline,
    test_mode: !s.crm.enabled, languages: s.languages, env: D.ENV.name, base_url: s.business.base_url,
  };
});

// ---------- team login (19.3) ----------
route('POST', '/api/team/login', { rate: { key: 'login', max: 30, minutes: 15 } }, (ctx) => {
  const { username, password, device } = ctx.body;
  const u = get('SELECT * FROM users WHERE username=?', String(username || '').trim().toLowerCase());
  const fail = (msg) => { D.history(username || '?', 'failed login', u ? u.id : null, null, null, msg, null, ctx.ip); throw httpError(401, msg); };
  if (!u) fail('Wrong username or password.');
  if (u.locked_until && u.locked_until > now()) fail(`Too many wrong tries. Locked until ${L.istTime(u.locked_until)}.`);
  if (!L.checkPassword(String(password || ''), u.pass_hash)) {
    const n = (u.failed || 0) + 1;
    if (n >= 5) {
      update('users', u.id, { failed: 0, locked_until: new Date(Date.now() + 15 * 60000).toISOString() });
      const boss = u.agency_id && u.level === 'sub' ? L.agencyAdmin(u.agency_id) : L.superAdmins().find((x) => x.id !== u.id);
      if (boss) L.alertUser(boss.id, `${u.name}'s login is locked after 5 wrong passwords`, u.id);
      fail('5 wrong tries. This login is locked for 15 minutes.');
    }
    update('users', u.id, { failed: n });
    fail(`Wrong username or password. ${5 - n} tries left.`);
  }
  if (u.status !== 'On') fail('This login is turned off. Ask your admin.');
  const ag = u.agency_id ? get('SELECT * FROM agencies WHERE id=?', u.agency_id) : null;
  if (ag && ag.status === 'Paused') fail('Your agency is paused. Contact BrillBrains.');
  update('users', u.id, { failed: 0, locked_until: null, last_login: now() });
  D.history(u.name, 'login', u.id, null, null, null, null, ctx.ip);
  const devices = JSON.parse(u.devices || '[]');
  // Extra check for super admin: WhatsApp code on each new device.
  if (u.level === 'super' && (!device || !devices.includes(device))) {
    const code = issueCode(u.whatsapp, 'team2fa');
    const token = newSession('team', u.id, null, { pending_2fa: true, device });
    // Test copy without WhatsApp: the code is shown on screen. Live copy without WhatsApp: only in the server log.
    if (!D.settings().crm.enabled && D.ENV.name === 'live') console.log(`[2-step code] ${u.username}: ${code} (WhatsApp not connected)`);
    return { token, need2fa: true, dev_code: showCode() ? code : undefined, must_change: !!u.must_change };
  }
  return { token: newSession('team', u.id, null, { device }), must_change: !!u.must_change };
});
route('POST', '/api/team/2fa', { auth: 'team', allow2fa: true }, (ctx) => {
  checkCode(ctx.user.whatsapp, 'team2fa', ctx.body.code);
  D.run('UPDATE sessions SET pending_2fa=0 WHERE token=?', ctx.session.token);
  const devices = JSON.parse(ctx.user.devices || '[]');
  if (ctx.session.device && !devices.includes(ctx.session.device)) update('users', ctx.user.id, { devices: JSON.stringify([...devices, ctx.session.device].slice(-10)) });
  return { ok: true };
});
route('POST', '/api/team/logout', { auth: 'team', allow2fa: true }, (ctx) => { D.run('DELETE FROM sessions WHERE token=?', ctx.session.token); D.history(ctx.actor.label, 'logout', ctx.user.id); return { ok: true }; });
route('POST', '/api/team/password', { auth: 'team' }, (ctx) => {
  const { old, password } = ctx.body;
  if (!L.checkPassword(String(old || ''), ctx.user.pass_hash)) throw httpError(400, 'Your current password is wrong', 'old');
  if (!password || String(password).length < 8) throw httpError(400, 'Use at least 8 characters', 'password');
  update('users', ctx.user.id, { pass_hash: L.hashPassword(password), must_change: 0 });
  D.history(ctx.actor.label, 'change password', ctx.user.id); return { ok: true };
});

// ---------- one-time codes for clients and candidates ----------
// Codes appear on screen only on the test copy while WhatsApp is not connected — never on the live copy.
const showCode = () => !D.settings().crm.enabled && D.ENV.name !== 'live';
function issueCode(phone, purpose) {
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  if (get('SELECT COUNT(*) c FROM otps WHERE phone=? AND created_at>?', phone, hourAgo).c >= 5) throw httpError(429, 'Too many codes asked for this number. Try again in an hour.');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  insert('otps', { phone, purpose, code_hash: L.sha(code + phone), expires: new Date(Date.now() + 10 * 60000).toISOString(), tries: 0, used: 0, created_at: now() });
  const who = get('SELECT id FROM users WHERE whatsapp=?', phone) ? ['user', get('SELECT id FROM users WHERE whatsapp=?', phone).id]
    : get('SELECT id FROM clients WHERE whatsapp=? AND merged_into IS NULL', phone) ? ['client', get('SELECT id FROM clients WHERE whatsapp=? AND merged_into IS NULL', phone).id]
      : get('SELECT id FROM candidates WHERE whatsapp=? AND merged_into IS NULL', phone) ? ['candidate', get('SELECT id FROM candidates WHERE whatsapp=? AND merged_into IS NULL', phone).id] : null;
  if (who) L.sendWA({ ptype: who[0], pid: who[1], format: 'bbhs_login_code', vars: { code }, secret: code });
  return code;
}
function checkCode(phone, purpose, code) {
  const o = get('SELECT * FROM otps WHERE phone=? AND purpose=? AND used=0 ORDER BY id DESC LIMIT 1', phone, purpose);
  if (!o || o.expires < now()) throw httpError(400, 'The code has expired. Ask for a new one.', 'code');
  if (o.tries >= 3) throw httpError(400, '3 wrong tries. Ask for a new code.', 'code');
  if (o.code_hash !== L.sha(String(code || '').trim() + phone)) { update('otps', o.id, { tries: o.tries + 1 }); throw httpError(400, `Wrong code. ${2 - o.tries} tries left.`, 'code'); }
  update('otps', o.id, { used: 1 });
}
route('POST', '/api/otp/request', { rate: { key: 'otp', max: 10, minutes: 60 } }, (ctx) => {
  const phone = L.digits10(ctx.body.phone); const kind = ctx.body.kind;
  if (!L.validPhone(phone)) throw httpError(400, 'Enter your 10-digit WhatsApp number', 'phone');
  const found = kind === 'client' ? (get('SELECT id FROM clients WHERE whatsapp=? AND merged_into IS NULL AND removed=0', phone) || get('SELECT id FROM client_members WHERE whatsapp=?', phone)) : get('SELECT id FROM candidates WHERE whatsapp=? AND merged_into IS NULL AND removed=0', phone);
  if (!found) throw httpError(404, kind === 'client' ? 'No client account with this number. Fill the hiring form first.' : 'No profile with this number. Fill the job form first.', 'phone');
  if (!showCode() && !D.settings().crm.enabled) throw httpError(400, 'Login codes are sent on WhatsApp, which is being set up. Please try again later or contact us on WhatsApp.', 'phone');
  const code = issueCode(phone, kind);
  return { sent: true, dev_code: showCode() ? code : undefined };
});
route('POST', '/api/otp/verify', {}, (ctx) => {
  const phone = L.digits10(ctx.body.phone); const kind = ctx.body.kind;
  checkCode(phone, kind, ctx.body.code);
  if (kind === 'client') {
    const c = get('SELECT * FROM clients WHERE whatsapp=? AND merged_into IS NULL AND removed=0', phone);
    if (c) { openedAccount('client', c.id); return { token: newSession('client', c.id) }; }
    const m = get('SELECT * FROM client_members WHERE whatsapp=?', phone);
    return { token: newSession('client', m.client_id, m.id) };
  }
  const c = get('SELECT * FROM candidates WHERE whatsapp=? AND merged_into IS NULL AND removed=0', phone);
  openedAccount('candidate', c.id);
  return { token: newSession('candidate', c.id) };
});
function openedAccount(type, id) {
  const table = type === 'client' ? 'clients' : 'candidates';
  const r = get(`SELECT account_status FROM ${table} WHERE id=?`, id);
  if (r && r.account_status !== 'Opened') { update(table, id, { account_status: 'Opened' }); D.history(type, 'account opened', id); }
}
route('POST', '/api/account/logout', {}, (ctx) => { D.run('DELETE FROM sessions WHERE token=?', ctx.req.headers['x-session'] || ''); return { ok: true }; });

// ---------- public forms ----------
function srcFrom(b) {
  const tags = D.settings().src_tags;
  if (b.ref) return 'Referral';
  if (b.src) return tags[b.src] || D.settings().lead_sources.find((x) => x.toLowerCase() === String(b.src).toLowerCase()) || b.src;
  return 'Website';
}
route('POST', '/api/public/hire', { rate: { key: 'form', max: 10, minutes: 60 } }, (ctx) => {
  const b = ctx.body;
  if (b.website) throw httpError(400, 'Please try again.'); // hidden field only bots fill in
  if (!b.contact || !String(b.contact).trim()) throw httpError(400, 'Please enter your name', 'contact');
  if (!b.company || !String(b.company).trim()) throw httpError(400, 'Please enter your company name', 'company');
  if (!b.city) throw httpError(400, 'Please enter your city', 'city');
  if (!b.business_type) throw httpError(400, 'Pick your type of business', 'business_type');
  if (!b.need) throw httpError(400, 'Tell us when you need staff', 'need');
  const r = L.intakeClient(b, { source: srcFrom(b) });
  openedAccount('client', r.client.id);
  return { id: r.client.id, isNew: r.isNew, token: newSession('client', r.client.id) };
});
route('POST', '/api/public/apply', { rate: { key: 'form', max: 10, minutes: 60 } }, async (ctx) => {
  const b = ctx.body;
  if (b.website) throw httpError(400, 'Please try again.'); // hidden field only bots fill in
  if (!b.name || !String(b.name).trim()) throw httpError(400, 'Please enter your name', 'name');
  if (!b.city) throw httpError(400, 'Please enter the city you want to work in', 'city');
  if (!b.job_wanted) throw httpError(400, 'Pick the job you want', 'job_wanted');
  if (b.job_wanted === 'Other' && !b.job_other) throw httpError(400, 'Type the job you want', 'job_other');
  const expMap = { Fresher: 0, '1–3 years': 2, '3–5 years': 4, '5–10 years': 7, '10+ years': 12 };
  let refBy = null;
  if (b.ref) { const rc = get('SELECT id FROM candidates WHERE id=?', L.resolveId(String(b.ref).toUpperCase())); refBy = rc ? rc.id : null; }
  const jobOk = b.job ? get('SELECT * FROM jobs WHERE id=?', String(b.job).toUpperCase()) : null;
  const r = L.intakeCandidate({ name: b.name, whatsapp: b.whatsapp, city: b.city, work_cities: [b.city], job_wanted: b.job_wanted === 'Other' ? b.job_other : b.job_wanted, exp_total: b.experience ? expMap[b.experience] : null, ref_by: refBy, apply_job: jobOk && ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(V.jobView(jobOk).status) ? jobOk.id : null }, { source: srcFrom(b) });
  if (refBy && r.isNew) insert('notes', { record_id: r.candidate.id, text: `Referred by ${refBy}`, author: 'Form', at: now() });
  if (b.cv && b.cv.base64) { try { const f = await F.saveFile({ recordId: r.candidate.id, type: 'cv', name: b.cv.name, base64: b.cv.base64, by: 'Candidate form' }); update('candidates', r.candidate.id, { cv_file: String(f.id) }); } catch (e) { insert('notes', { record_id: r.candidate.id, text: `CV not saved: ${e.message}`, author: 'Form', at: now() }); } }
  openedAccount('candidate', r.candidate.id);
  return { id: r.candidate.id, isNew: r.isNew, token: newSession('candidate', r.candidate.id) };
});

// ---------- client account (6.3) ----------
const C = { auth: 'client' };
const companyLabel = (cl) => {
  const kind = { 'Showroom B2C': 'showroom', 'Manufacturer B2B': 'manufacturer', Both: 'business' }[cl.business_type] || 'business';
  return `${cl.industry || 'Jewellery'} ${kind}, ${cl.city || 'India'}`;
};
function clientAppView(a, client) {
  const v = V.appView(a); const cand = get('SELECT * FROM candidates WHERE id=?', a.candidate_id); const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
  const showPhone = L.stepIdx(a.step) >= L.stepIdx('Client interview') || a.client_choice === 'Interested';
  const ours = all("SELECT * FROM interviews WHERE app_id=? AND round='ours' AND status='Completed'", a.id);
  const sc = L.matchScore(cand, job, L.ratingOf(cand.id));
  const js = (job.skills || []).map((x) => x.toLowerCase());
  return {
    id: a.id, step: a.step, result: a.result, job_id: job.id, job_title: job.title, candidate_id: cand.id, name: cand.name, city: cand.city, phone: showPhone ? cand.whatsapp : null,
    exp_total: cand.exp_total, exp_jewellery: cand.exp_jewellery, cur_salary: cand.cur_salary, exp_salary: cand.exp_salary, notice_days: cand.notice_days, current_company: cand.current_company,
    skills: (cand.skills || []).map((s) => ({ s, match: js.includes(s.toLowerCase()) })), score: sc.score, reasons: sc.reasons, short_cv: cand.short_cv_file || null, cv: showPhone ? cand.cv_file : null,
    our_notes: ours.map((i) => ({ remark: i.remark, rating: i.rating, qa: i.qa })), interviews: v.interviews.filter((i) => i.round === 'client'), offer_ctc: a.offer_ctc, joining_date: a.joining_date,
    offer_letter: a.offer_letter, offer_sent: a.offer_sent, checklist: a.checklist, joining_docs: a.joining_docs, client_choice: a.client_choice,
  };
}
route('GET', '/api/client/me', C, (ctx) => {
  const c = ctx.client; const perms = ctx.member ? ctx.member.perms || {} : { candidates: true, feedback: true, approve: true, bills: true, admin: true };
  const jobs = all('SELECT * FROM jobs WHERE client_id=? AND archived=0 ORDER BY created_at DESC', c.id).map((j) => V.jobView(j));
  const apps = all('SELECT a.* FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.client_id=?', c.id);
  const sent = apps.filter((a) => L.stepIdx(a.step) >= 3 && (a.result === 'open' || a.result === 'Hired' || a.client_choice));
  const candidates = perms.candidates ? sent.map((a) => clientAppView(a, c)) : [];
  const ivs = all("SELECT i.* FROM interviews i JOIN applications a ON a.id=i.app_id JOIN jobs j ON j.id=a.job_id WHERE j.client_id=? AND i.round='client' ORDER BY i.at DESC", c.id).map(L.interviewView)
    .map((i) => { const a = apps.find((x) => x.id === i.app_id); const cand = get('SELECT name, whatsapp FROM candidates WHERE id=?', a.candidate_id); return { ...i, candidate: cand.name, phone: cand.whatsapp, job: get('SELECT title FROM jobs WHERE id=?', a.job_id).title }; });
  const bills = perms.bills ? all("SELECT * FROM bills WHERE client_id=? AND status!='Draft' ORDER BY created_at DESC", c.id).map(L.billView).map((b) => {
    const a = V.appView(get('SELECT * FROM applications WHERE id=?', b.app_id)); const ap = get('SELECT * FROM applications WHERE id=?', b.app_id);
    const win = c.replacement_days || D.settings().replacement_days;
    return { ...b, candidate: a.candidate_name, job: a.job_title, joining_date: a.joining_date, upi: L.upiLink(b.balance, b.bill_no), can_replace: !!(ap.joined_at && L.daysBetween(ap.joined_at) <= win && !ap.replacement_used && !b.is_replacement && !b.replacement_requested), replacement_requested: b.replacement_requested, left_date: ap.left_date };
  }) : [];
  const waiting = candidates.filter((x) => x.step === 'Sent to client' && x.result === 'open' && !x.client_choice).length;
  const checklist = V.onboardingView(c).filter((x) => ['intro_call', 'kyc', 'contract', 'first_job'].includes(x.key));
  return {
    client: { ...c, templates: c.templates ? JSON.parse(c.templates) : D.settings().templates }, member: ctx.member, perms,
    counts: { open_jobs: jobs.filter((j) => !['Closed', 'Filled'].includes(j.status)).length, to_review: waiting, upcoming: ivs.filter((i) => ['Scheduled', 'Rescheduled'].includes(i.status) && i.at > now()).length, bills_due: bills.filter((b) => ['Due', 'Overdue', 'Part paid'].includes(b.view_status)).length },
    checklist: [{ key: 'request', label: 'Request received', done: true, date: c.created_at }, ...checklist], jobs, candidates, interviews: ivs, bills,
    members: all('SELECT * FROM client_members WHERE client_id=?', c.id), files: all("SELECT id, type, name, version, at FROM files WHERE record_id=? AND replaced=0", c.id),
    standard_templates: D.settings().templates, support: D.settings().business.support_phone,
  };
});
route('POST', '/api/client/jobs', C, (ctx) => {
  if (ctx.member && !(ctx.member.perms || {}).approve && !(ctx.member.perms || {}).admin) throw httpError(403, 'Your login cannot raise job openings.');
  const j = TEAM.createJob(ctx.client, ctx.body, ctx.actor, true);
  insert('notes', { record_id: j.id, text: `Raised by ${ctx.actor.label}`, author: ctx.actor.label, at: now() });
  return j;
});
function clientJob(ctx) { const j = get('SELECT * FROM jobs WHERE id=? AND client_id=?', ctx.params.id, ctx.client.id); if (!j) throw httpError(404, 'Job opening not found'); return j; }
route('POST', '/api/client/jobs/:id/:action', C, (ctx) => {
  const j = clientJob(ctx); const a = ctx.params.action;
  if (a === 'hold') return L.jobAction(j.id, 'hold', { reason: ctx.body.reason || 'Paused by client' }, ctx.actor);
  if (a === 'resume') return L.jobAction(j.id, 'resume', {}, ctx.actor);
  if (a === 'reopen') return L.jobAction(j.id, 'reopen', { add: ctx.body.add || 1, reason: ctx.body.reason || 'Client needs more people' }, ctx.actor);
  if (a === 'close') return L.jobAction(j.id, 'close', { reason: ctx.body.reason || 'Client stopped hiring' }, ctx.actor);
  if (a === 'approve-jd') {
    if (ctx.member && !(ctx.member.perms || {}).approve) throw httpError(403, 'Your login cannot approve job descriptions.');
    const r = L.jobAction(j.id, 'approve_jd', { note: `Approved by ${ctx.actor.label}` }, ctx.actor);
    try { const f = F.storeBuffer({ recordId: j.id, type: 'jd', name: `${j.id}-JD-approved.pdf`, buf: TEAM.jdPdf(get('SELECT * FROM jobs WHERE id=?', j.id)), mime: 'application/pdf', by: ctx.actor.label }); update('jobs', j.id, { jd: { ...(j.jd || {}), file: f.id } }); } catch { /* the job is open either way */ }
    L.alertUser(j.recruiter_id, `${ctx.client.company} approved the JD for ${j.id}`, j.id);
    return r;
  }
  if (a === 'jd-changes') {
    D.edit('jobs', j.id, { jd_status: 'Changes asked', jd_note: ctx.body.note || '' }, ctx.actor.label);
    insert('job_history', { job_id: j.id, at: now(), status: 'JD changes asked', by: ctx.actor.label, note: ctx.body.note || '' });
    L.alertUser(j.recruiter_id, `${ctx.client.company} asked for JD changes on ${j.id}: ${ctx.body.note || ''}`, j.id);
    return { ok: true };
  }
  throw httpError(400, 'Unknown action');
});
function clientApp(ctx) {
  const a = get('SELECT a.* FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND j.client_id=?', ctx.params.id, ctx.client.id);
  if (!a || L.stepIdx(a.step) < 3) throw httpError(404, 'Profile not found'); return a;
}
route('POST', '/api/client/apps/:id/interested', { auth: 'client', perm: 'candidates' }, (ctx) => {
  const a = clientApp(ctx); if (a.result !== 'open') throw httpError(400, 'This profile is closed.');
  update('applications', a.id, { client_choice: 'Interested' });
  if (L.stepIdx(a.step) < L.stepIdx('Client interview')) L.moveStep(a.id, 'Client interview', ctx.actor, `Interested — by ${ctx.actor.label}`);
  if (ctx.body.at) L.scheduleInterview(a.id, { round: 'client', at: ctx.body.at, place: ctx.body.place || ctx.client.city, interviewer: ctx.body.interviewer || ctx.client.contact, name: 'Client round' }, ctx.actor);
  const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); L.alertUser(a.owner_id || job.recruiter_id, `${ctx.client.company} wants to interview on ${a.id}`, a.id);
  return { ok: true };
});
route('POST', '/api/client/apps/:id/not-suitable', { auth: 'client', perm: 'candidates' }, (ctx) => {
  const a = clientApp(ctx); update('applications', a.id, { client_choice: 'Not suitable' });
  return L.closeApplication(a.id, 'Client rejected', ctx.actor, ctx.body.note || `Not suitable — by ${ctx.actor.label}`);
});
route('POST', '/api/client/interviews/:id/feedback', { auth: 'client', perm: 'feedback' }, (ctx) => {
  const iv = get('SELECT * FROM interviews WHERE id=?', ctx.params.id); if (!iv) throw httpError(404, 'Interview not found');
  ctx.params.id = iv.app_id; const a = clientApp(ctx);
  if (!['Selected', 'Another round', 'Not selected'].includes(ctx.body.result)) throw httpError(400, 'Pick a result', 'result');
  const r = L.recordInterview(iv.id, { status: 'Completed', result: ctx.body.result, remark: ctx.body.remark || `Feedback by ${ctx.actor.label}`, rating: ctx.body.rating }, ctx.actor);
  const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
  L.alertUser(a.owner_id || job.recruiter_id, `${ctx.client.company}: ${ctx.body.result} on ${a.id}${ctx.body.result === 'Selected' ? ' — record the offer' : ''}`, a.id);
  return r;
});
route('POST', '/api/client/apps/:id/offer-letter', { auth: 'client', perm: 'approve' }, (ctx) => {
  const a = clientApp(ctx);
  if (!a.offer_letter) return TEAM.makeOfferLetter(a, ctx.actor, !!ctx.body.send);
  if (ctx.body.send) {
    update('applications', a.id, { offer_sent: 1 }); L.appHist(a.id, a.step, ctx.actor, 'Offer letter checked and sent by client', 'paper');
    const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
    L.sendWA({ ptype: 'candidate', pid: a.candidate_id, format: 'bbhs_offer', vars: { job: job.title, company: ctx.client.company, ctc: L.inr(a.offer_ctc), joining_date: L.istFmt(a.joining_date, false) }, ap: a.id, by: ctx.actor, dedupe: `offersent:${a.id}:${a.offer_letter}` });
  }
  return { ok: true };
});
route('POST', '/api/client/apps/:id/checklist', { auth: 'client', perm: 'candidates' }, (ctx) => {
  const a = clientApp(ctx); const cl = { ...(a.checklist || {}) }; cl[ctx.body.item] = ctx.body.done ? { by: ctx.actor.label, at: now() } : null;
  update('applications', a.id, { checklist: cl }); L.appHist(a.id, a.step, ctx.actor, `${ctx.body.item}: ${ctx.body.done ? 'done' : 'not done'}`, 'checklist'); return { ok: true };
});
route('POST', '/api/client/bills/:id/replacement', { auth: 'client', perm: 'bills' }, (ctx) => {
  const b = get('SELECT * FROM bills WHERE id=? AND client_id=?', ctx.params.id, ctx.client.id); if (!b) throw httpError(404, 'Bill not found');
  if (!ctx.body.reason) throw httpError(400, 'Tell us what happened', 'reason');
  update('bills', b.id, { replacement_requested: 1 });
  const a = get('SELECT * FROM applications WHERE id=?', b.app_id); const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
  insert('notes', { record_id: a.id, text: `Client asked for a free replacement: ${ctx.body.reason}${ctx.body.date ? ` (last day ${ctx.body.date})` : ''}`, author: ctx.actor.label, at: now() });
  L.alertUser(job.recruiter_id || a.owner_id, `${ctx.client.company} asked for a free replacement on ${a.id}. Check the reason and mark "Left the job".`, a.id);
  return { ok: true };
});
route('POST', '/api/client/files', C, async (ctx) => {
  const b = ctx.body; const allowedTypes = ['gst', 'pan', 'owner_id', 'contract_signed', 'logo'];
  if (b.app_id) {
    ctx.params.id = b.app_id; const a = clientApp(ctx);
    const f = await F.saveFile({ recordId: a.id, type: b.type || 'joining_doc', name: b.name, base64: b.base64, by: ctx.actor.label });
    if (b.type === 'offer_signed') L.appHist(a.id, a.step, ctx.actor, 'Signed offer letter uploaded', 'paper');
    return f;
  }
  if (!allowedTypes.includes(b.type)) throw httpError(400, 'Unknown paper');
  const f = await F.saveFile({ recordId: ctx.client.id, type: b.type, name: b.name, base64: b.base64, by: ctx.actor.label });
  const c = get('SELECT * FROM clients WHERE id=?', ctx.client.id);
  if (['gst', 'pan', 'owner_id'].includes(b.type)) {
    const kyc = { ...(c.kyc || {}), [b.type]: f.id, ...(b.gstin ? { gstin: b.gstin } : {}) }; update('clients', c.id, { kyc });
    if (['gst', 'pan', 'owner_id'].every((k) => kyc[k])) { const ob = { ...(c.onboarding || {}), kyc: { done: true, date: now(), by: ctx.actor.label } }; update('clients', c.id, { onboarding: ob }); }
  }
  if (b.type === 'contract_signed') signContract(c, ctx, 'Signed copy uploaded', f.id);
  return f;
});
function signContract(c, ctx, method, fileId) {
  const contract = { by: ctx.actor.label, name: ctx.body.name || ctx.actor.label, at: now(), ip: ctx.ip, method, file: fileId || null };
  const stages = D.settings().client_stages; const patch = { contract: JSON.stringify(contract), onboarding: { ...(c.onboarding || {}), contract: { done: true, date: now(), by: ctx.actor.label } } };
  if (stages.indexOf('Client activated') > stages.indexOf(c.stage)) patch.stage = 'Client activated';
  D.edit('clients', c.id, patch, ctx.actor.label, ctx.ip);
}
route('POST', '/api/client/contract/sign', C, (ctx) => {
  if (!ctx.body.agree || !ctx.body.name) throw httpError(400, 'Type your full name and tick "I agree"', 'name');
  signContract(get('SELECT * FROM clients WHERE id=?', ctx.client.id), ctx, 'Signed online (I agree)'); return { ok: true };
});
route('PUT', '/api/client/templates', C, (ctx) => {
  const t = { ...D.settings().templates, ...(ctx.body || {}) }; D.edit('clients', ctx.client.id, { templates: JSON.stringify(t) }, ctx.actor.label); return { ok: true };
});
route('PUT', '/api/client/company', C, (ctx) => {
  const allowed = ['company', 'contact', 'email', 'city', 'business_type']; const patch = {};
  for (const k of allowed) if (ctx.body[k] !== undefined) patch[k] = ctx.body[k];
  if (ctx.body.extra) patch.extra = { ...(ctx.client.extra || {}), ...ctx.body.extra };
  if (ctx.body.gstin) patch.kyc = { ...(ctx.client.kyc || {}), gstin: ctx.body.gstin };
  return D.edit('clients', ctx.client.id, patch, ctx.actor.label);
});
route('POST', '/api/client/members', C, (ctx) => {
  if (ctx.member) throw httpError(403, 'Only the main contact can add people.');
  return TEAM.addMember(ctx.client, ctx.body, ctx.actor.label);
});
route('PATCH', '/api/client/members/:id', C, (ctx) => {
  if (ctx.member) throw httpError(403, 'Only the main contact can change people.');
  const m = get('SELECT * FROM client_members WHERE id=? AND client_id=?', ctx.params.id, ctx.client.id); if (!m) throw httpError(404, 'Not found');
  if (ctx.body.remove) { D.run('DELETE FROM client_members WHERE id=?', m.id); D.history(ctx.actor.label, 'remove member', ctx.client.id, null, m.name); return { ok: true }; }
  update('client_members', m.id, { perms: JSON.stringify(ctx.body.perms || m.perms), role: ctx.body.role || m.role }); D.history(ctx.actor.label, 'member rights', ctx.client.id, m.name, JSON.stringify(m.perms), JSON.stringify(ctx.body.perms)); return { ok: true };
});
route('GET', '/api/client/export', C, (ctx) => {
  const c = ctx.client; D.history(ctx.actor.label, 'download own data', c.id);
  const data = { client: c, members: all('SELECT * FROM client_members WHERE client_id=?', c.id), jobs: all('SELECT * FROM jobs WHERE client_id=?', c.id), bills: all('SELECT * FROM bills WHERE client_id=?', c.id), messages: all("SELECT at, direction, text FROM messages WHERE person_type='client' AND person_id=?", c.id), consents: all("SELECT * FROM consents WHERE person_type='client' AND person_id=?", c.id) };
  return { __file: { name: `my-data-${c.id}.json`, mime: 'application/json', buf: Buffer.from(JSON.stringify(data, null, 2)) } };
});
route('POST', '/api/client/delete-request', C, (ctx) => {
  if (get("SELECT 1 FROM data_requests WHERE person_id=? AND status='Waiting'", ctx.client.id)) return { ok: true };
  insert('data_requests', { person_type: 'client', person_id: ctx.client.id, kind: 'delete', status: 'Waiting', at: now() });
  for (const s of L.superAdmins()) L.alertUser(s.id, `${ctx.client.id} asked to delete their data`, ctx.client.id, false);
  return { ok: true };
});

// ---------- candidate account (6.4) ----------
const K = { auth: 'candidate' };
function profilePct(c) {
  const keys = ['name', 'city', 'job_wanted', 'exp_total', 'cur_salary', 'exp_salary', 'notice_days', 'cv_file', 'email'];
  const n = keys.filter((k) => c[k] !== null && c[k] !== undefined && c[k] !== '').length + ((c.skills || []).length ? 1 : 0);
  return Math.round((n / (keys.length + 1)) * 100);
}
function companyShown(a, cl) { return cl.hide_name_until === 'Always show' || L.stepIdx(a.step) >= L.stepIdx('Client interview'); }
route('GET', '/api/cand/me', K, (ctx) => {
  const c = ctx.candidate; const s = D.settings();
  const apps = all('SELECT * FROM applications WHERE candidate_id=? ORDER BY created_at DESC', c.id).map((a) => {
    const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const cl = get('SELECT * FROM clients WHERE id=?', job.client_id);
    const ivs = all('SELECT * FROM interviews WHERE app_id=? ORDER BY at', a.id).map(L.interviewView);
    return { id: a.id, step: a.step, result: a.result, job_title: job.title, city: job.city, company: companyShown(a, cl) ? cl.company : companyLabel(cl), company_shown: companyShown(a, cl), interviews: ivs, offer_ctc: a.offer_ctc, joining_date: a.joining_date, offer_letter: a.offer_sent ? a.offer_letter : null, joining_docs: a.joining_docs || [], checklist: a.checklist, left_date: a.left_date, steps: L.STEPS };
  });
  const rating = L.ratingOf(c.id);
  const onJob = new Set(apps.filter((a) => a.result === 'open' || a.result === 'Hired').map((a) => a.id));
  const appliedJobs = new Set(all("SELECT job_id FROM applications WHERE candidate_id=? AND result='open'", c.id).map((r) => r.job_id));
  const jobs = all('SELECT * FROM jobs WHERE archived=0').map((j) => V.jobView(j)).filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status) && !appliedJobs.has(j.id))
    .map((j) => { const m = L.matchScore(c, j, rating); const cl = get('SELECT * FROM clients WHERE id=?', j.client_id); return { id: j.id, title: j.title, city: j.city, company: cl.hide_name_until === 'Always show' ? cl.company : companyLabel(cl), salary: L.salaryText(j), exp: j.exp_from !== null ? `${j.exp_from}–${j.exp_to ?? '+'} yrs` : '', score: m.score, reasons: m.reasons }; })
    .filter((j) => j.score >= s.match.show).sort((a, b) => b.score - a.score);
  const next = apps.flatMap((a) => a.interviews.filter((i) => ['Scheduled', 'Rescheduled'].includes(i.status) && i.at > now()).map((i) => ({ ...i, app: a.id, job_title: a.job_title, company: a.company }))).sort((a, b) => (a.at < b.at ? -1 : 1))[0] || null;
  const offer = apps.find((a) => a.result === 'open' && a.step === 'Offer made') || null;
  return {
    profile: { ...c, cur_month: c.cur_salary ? Math.round(c.cur_salary / 12) : null, exp_month: c.exp_salary ? Math.round(c.exp_salary / 12) : null }, pct: profilePct(c), apps, jobs, next, offer,
    referral: L.link('apply', `?ref=${c.id}`), files: all('SELECT id, type, name, version, at FROM files WHERE record_id=? AND replaced=0', c.id), joining_items: s.templates.joining_checklist.split('\n').filter(Boolean), active: onJob.size,
  };
});
route('POST', '/api/cand/apply', K, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.body.job_id); if (!j) throw httpError(404, 'Job not found');
  if (!['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(V.jobView(j).status)) throw httpError(400, 'This job is not taking applications now.');
  const a = L.createApplication(ctx.candidate.id, j.id, ctx.actor, 'Candidate account', 'Candidate tapped Apply');
  if (j.recruiter_id) L.alertUser(j.recruiter_id, `${ctx.candidate.name} applied to ${j.id}`, a.id, false);
  return a;
});
route('PUT', '/api/cand/profile', K, (ctx) => {
  const b = ctx.body; const patch = {};
  for (const k of ['name', 'email', 'city', 'job_wanted', 'exp_total', 'exp_jewellery', 'notice_days', 'skills', 'current_company', 'looking', 'work_cities']) if (b[k] !== undefined) patch[k] = b[k] === '' ? null : b[k];
  if (b.cur_month !== undefined) patch.cur_salary = b.cur_month === '' ? null : Number(b.cur_month) * 12;
  if (b.exp_month !== undefined) patch.exp_salary = b.exp_month === '' ? null : Number(b.exp_month) * 12;
  if (patch.name !== undefined && !String(patch.name || '').trim()) throw httpError(400, 'Please enter your name', 'name');
  if (patch.job_wanted) patch.department = L.deptOf(patch.job_wanted);
  patch.last_updated = now();
  return D.edit('candidates', ctx.candidate.id, patch, ctx.actor.label);
});
function candApp(ctx) { const a = get('SELECT * FROM applications WHERE id=? AND candidate_id=?', ctx.params.id, ctx.candidate.id); if (!a) throw httpError(404, 'Application not found'); return a; }
route('POST', '/api/cand/interviews/:iv/:action', K, (ctx) => {
  const iv = get('SELECT * FROM interviews WHERE id=?', ctx.params.iv); if (!iv) throw httpError(404, 'Interview not found');
  ctx.params.id = iv.app_id; const a = candApp(ctx);
  if (ctx.params.action === 'confirm') { update('interviews', iv.id, { confirmed: 1 }); D.history(ctx.actor.label, 'confirm', iv.id, 'confirmed', 0, 1); L.appHist(a.id, a.step, ctx.actor, `${iv.id} confirmed by candidate`, 'interview'); return { ok: true }; }
  if (ctx.params.action === 'reschedule') { insert('notes', { record_id: a.id, text: `Candidate asked to reschedule ${iv.id}: ${ctx.body.note || ''}`, author: ctx.actor.label, at: now() }); L.alertUser(a.owner_id, `${ctx.candidate.name} asked to reschedule ${iv.id}`, a.id); return { ok: true }; }
  throw httpError(400, 'Unknown action');
});
route('POST', '/api/cand/apps/:id/accept', K, (ctx) => { const a = candApp(ctx); if (a.step !== 'Offer made' || a.result !== 'open') throw httpError(400, 'There is no offer waiting.'); return L.moveStep(a.id, 'Offer accepted', ctx.actor, 'Accepted in candidate account'); });
route('POST', '/api/cand/apps/:id/decline', K, (ctx) => { const a = candApp(ctx); if (a.step !== 'Offer made' || a.result !== 'open') throw httpError(400, 'There is no offer waiting.'); return L.closeApplication(a.id, 'Offer declined', ctx.actor, ctx.body.note || 'Declined in candidate account'); });
route('POST', '/api/cand/files', K, async (ctx) => {
  const b = ctx.body;
  if (b.app_id) {
    ctx.params.id = b.app_id; const a = candApp(ctx);
    const f = await F.saveFile({ recordId: a.id, type: b.type || 'joining_doc', name: b.name, base64: b.base64, by: ctx.actor.label });
    const docs = [...(a.joining_docs || []), { file: f.id, label: b.label || b.type, at: now() }];
    update('applications', a.id, { joining_docs: docs }); L.appHist(a.id, a.step, ctx.actor, `Uploaded ${b.label || b.type}`, 'paper');
    if (b.type === 'offer_signed') L.appHist(a.id, a.step, ctx.actor, 'Signed offer letter uploaded', 'paper');
    return f;
  }
  const f = await F.saveFile({ recordId: ctx.candidate.id, type: b.type === 'short_cv' ? 'short_cv' : 'cv', name: b.name, base64: b.base64, by: ctx.actor.label });
  update('candidates', ctx.candidate.id, { [b.type === 'short_cv' ? 'short_cv_file' : 'cv_file']: String(f.id), last_updated: now() });
  return f;
});
route('GET', '/api/cand/export', K, (ctx) => {
  const c = ctx.candidate; D.history(ctx.actor.label, 'download own data', c.id);
  const data = { profile: c, applications: all('SELECT id, job_id, step, result, created_at FROM applications WHERE candidate_id=?', c.id), messages: all("SELECT at, direction, text FROM messages WHERE person_type='candidate' AND person_id=?", c.id), consents: all("SELECT * FROM consents WHERE person_type='candidate' AND person_id=?", c.id) };
  return { __file: { name: `my-data-${c.id}.json`, mime: 'application/json', buf: Buffer.from(JSON.stringify(data, null, 2)) } };
});
route('POST', '/api/cand/delete-request', K, (ctx) => {
  if (!get("SELECT 1 FROM data_requests WHERE person_id=? AND status='Waiting'", ctx.candidate.id)) insert('data_requests', { person_type: 'candidate', person_id: ctx.candidate.id, kind: 'delete', status: 'Waiting', at: now() });
  update('candidates', ctx.candidate.id, { delete_requested: 1 });
  for (const s of L.superAdmins()) L.alertUser(s.id, `${ctx.candidate.id} asked to delete their data`, ctx.candidate.id, false);
  return { ok: true };
});

// ---------- files: opened only through the portal by people allowed to see the record ----------
route('GET', '/api/files/:id', {}, (ctx) => {
  const f = get('SELECT * FROM files WHERE id=?', ctx.params.id); if (!f) throw httpError(404, 'File not found');
  const s = R.loadSession(ctx.req); if (!s || s.expired || s.pending_2fa) throw httpError(401, 'Please log in.');
  const rid = f.record_id; let ok = false;
  if (s.kind === 'team') {
    const u = get('SELECT * FROM users WHERE id=?', s.subject_id);
    if (rid.startsWith('CA-')) { const c = get('SELECT * FROM candidates WHERE id=?', rid); ok = R.phoneVisible(u, c) || f.type === 'short_cv'; }
    else if (rid.startsWith('CL-')) ok = R.seeClient(u, get('SELECT * FROM clients WHERE id=?', rid));
    else if (rid.startsWith('AP-')) ok = R.seeApp(u, get('SELECT * FROM applications WHERE id=?', rid));
    else if (rid.startsWith('JB-')) { const j = get('SELECT * FROM jobs WHERE id=?', rid); ok = R.seeJob(u, j) || (j && j.agency_id === u.agency_id); }
    else if (rid.startsWith('BL-')) ok = R.seeBill(u, get('SELECT * FROM bills WHERE id=?', rid));
    if (ok) D.history(u.name, 'open file', rid, f.type, null, f.name, null, ctx.ip);
  } else if (s.kind === 'client') {
    const cid = L.resolveId(s.subject_id);
    if (rid === cid) ok = true;
    else if (rid.startsWith('JB-')) ok = !!get('SELECT 1 FROM jobs WHERE id=? AND client_id=?', rid, cid);
    else if (rid.startsWith('AP-')) ok = !!get('SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND j.client_id=?', rid, cid);
    else if (rid.startsWith('CA-')) { const a = get("SELECT a.* FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=? AND j.client_id=? ORDER BY a.created_at DESC", rid, cid); ok = a && L.stepIdx(a.step) >= 3 && (f.type === 'short_cv' || L.stepIdx(a.step) >= 4); }
  } else if (s.kind === 'candidate') {
    const cid = L.resolveId(s.subject_id);
    ok = rid === cid || !!get('SELECT 1 FROM applications WHERE id=? AND candidate_id=?', rid, cid);
  }
  if (!ok) throw httpError(403, 'You cannot open this file.');
  return { __file: { name: f.name, mime: f.mime, buf: F.readStored(f), inline: true } };
});
// Invoice PDF for the client's own bills.
route('GET', '/api/client/bills/:id/pdf', { auth: 'client', perm: 'bills' }, (ctx) => {
  const b = get("SELECT * FROM bills WHERE id=? AND client_id=? AND status!='Draft'", ctx.params.id, ctx.client.id); if (!b) throw httpError(404, 'Bill not found');
  return { __file: { name: `${(b.bill_no || b.id).replace(/\//g, '-')}.pdf`, mime: 'application/pdf', buf: TEAM.invoicePdf(b) } };
});

// ---------- links from the WhatsApp CRM (8.1) ----------
function crmCheck(ctx) {
  const want = Buffer.from(String(D.settings().crm.webhook_secret || '')); const got = Buffer.from(String(ctx.req.headers['x-bbhs-secret'] || ''));
  if (!want.length || want.length !== got.length || !crypto.timingSafeEqual(want, got)) { D.history('CRM', 'rejected webhook', null, null, null, null, null, ctx.ip); throw httpError(401, 'Not from the CRM'); }
}
route('POST', '/api/crm/inbound', {}, async (ctx) => {
  crmCheck(ctx); const b = ctx.body;
  if (b.kind === 'email') {
    return require('./mailbox').intakeEmail({ fromName: b.name, fromEmail: b.email, subject: b.subject || '', text: [b.text, b.phone, b.city, b.job].filter(Boolean).join('\n'), attachments: b.cv && b.cv.base64 ? [{ name: b.cv.name, buf: Buffer.from(String(b.cv.base64).replace(/^data:[^,]*,/, ''), 'base64') }] : [] });
  }
  const r = L.receiveReply(b.phone, b.text, b.button, { reply_to: b.reply_to, bot: b.bot, name: b.name, company: b.company, city: b.city, job: b.job, roles: b.roles, hasMedia: !!(b.media && b.media.base64) });
  // A CV sent as a WhatsApp file is saved on the candidate (PDF, Word, JPG or PNG).
  if (b.media && b.media.base64 && r.ptype === 'candidate') {
    const ext = { 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'image/jpeg': 'jpg', 'image/png': 'png' }[b.media.mime];
    let name = b.media.name || `whatsapp-file.${ext || 'bin'}`;
    if (ext && !/\.(pdf|docx?|jpe?g|png)$/i.test(name)) name += `.${ext}`;
    try {
      const f = await F.saveFile({ recordId: r.pid, type: 'cv', name, base64: b.media.base64, by: 'WhatsApp' });
      update('candidates', r.pid, { cv_file: String(f.id), last_updated: now() });
      r.effect = `${r.effect}; CV saved`;
    } catch (e) { insert('notes', { record_id: r.pid, text: `File on WhatsApp not saved as CV: ${e.message}`, author: 'WhatsApp', at: now() }); }
  }
  return r;
});
route('POST', '/api/crm/status', {}, (ctx) => {
  crmCheck(ctx); const b = ctx.body; const m = get('SELECT * FROM messages WHERE id=?', b.ref || b.id); if (!m) throw httpError(404, 'Message not found');
  update('messages', m.id, { status: b.status, error: b.error || null });
  if (b.status === 'failed') require('./crm').retryLater(m.id, b.error);
  return { ok: true };
});
