// Logins, public forms (#hire, #apply), client account (#my-account), candidate account (#my-profile), files, CRM links.
const crypto = require('crypto');
const D = require('./db');
const L = require('./logic');
const V = require('./views');
const F = require('./files');
const CV = require('./cvparse');
const R = require('./router');
const TEAM = require('./api-team');
const { route, newSession } = R;
const { get, all, insert, update, now, httpError } = D;

// ---------- public settings for forms ----------
route('GET', '/api/bootstrap', {}, () => {
  const s = D.settings();
  return {
    business: { name: s.business.name, short: s.business.short, support_phone: s.business.support_phone, primary: s.business.primary, accent: s.business.accent },
    jobs: L.jobList().filter((j) => !j.hidden), places: (() => { const seen = new Set(); const out = []; for (const p of [...s.cities, ...require('./places').PLACES]) { const k = p.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push({ name: p.name, state: p.state || L.stateOf(p.name) }); } } return out; })(), industries: Object.fromEntries(Object.keys(s.industries).map((k) => [k, L.jobList(k).filter((j) => !j.hidden)])), default_industry: s.default_industry, departments: s.departments, cities: s.cities.map((c) => c.name), skills: s.skills, stages: s.client_stages,
    closing_reasons: s.closing_reasons, job_close_reasons: s.job_close_reasons, reopen_reasons: s.reopen_reasons, lead_sources: s.lead_sources, src_tags: s.src_tags, industry_list: s.industry_list || ['Jewellery'], default_industry: s.default_industry || 'Jewellery',
    steps: L.STEPS, consent: L.CONSENT_WORDING, fee: s.fee, replacement_days: s.replacement_days, payment_days: s.payment_days, agency_share_pct: s.agency_share_pct, gst: s.gst, match: s.match, quiet: s.quiet, log_deadline: s.log_deadline,
    test_mode: !s.crm.enabled, languages: s.languages, env: D.ENV.name, base_url: s.business.base_url, landing: s.landing || null, landing_roles: s.landing_roles || [], looking: L.LOOKING,
  };
});
// Home page: open jobs anyone can see (no employer names), and how many there are per field of work.
// The home page search narrows it: ?title= (part of the job title), ?city=, ?group= (field of work).
// With a search, "similar" lists other open jobs in the same field (or the same job in other cities).
// One open job's title and city, for the "You are applying for" line on the form (the client is never shown).
route('GET', '/api/public/job/:id', { rate: { key: 'pubjobs', max: 240, minutes: 60 } }, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=? AND archived=0 AND is_sample=0', String(ctx.params.id).toUpperCase());
  const v = j && V.jobView(j); if (!v || !['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(v.status)) throw httpError(404, 'Job not open');
  return { id: v.id, title: v.title, city: v.city };
});
// The open job whose saved ad names match these (src, ad_campaign, ad_set, ad_name), for the same line on the form.
route('GET', '/api/public/ad-job', { rate: { key: 'pubjobs', max: 240, minutes: 60 } }, (ctx) => {
  const jobs = jobsByAdNames(ctx.query, srcFrom(ctx.query)).map((id) => get('SELECT id, title, city FROM jobs WHERE id=?', id));
  if (!jobs.length) throw httpError(404, 'No job for this ad');
  return { id: jobs[0].id, title: jobs[0].title, city: jobs[0].city, jobs };
});
route('GET', '/api/public/jobs', { rate: { key: 'pubjobs', max: 240, minutes: 60 } }, (ctx) => {
  const q = ctx.query || {};
  const open = all('SELECT * FROM jobs WHERE archived=0 AND is_sample=0 ORDER BY created_at DESC').map((j) => V.jobView(j)).filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status));
  const groups = {}; for (const x of L.jobList()) groups[x.title] = x.group;
  const seats = (j) => Math.max(1, (j.openings || 1) - (j.filled || 0));
  const card = (j) => ({ id: j.id, title: j.title, city: j.city, salary: L.salaryText(j), exp: j.exp_from !== null && j.exp_from !== undefined ? `${j.exp_from}–${j.exp_to ?? '+'} yrs` : '', group: groups[j.title] || 'Other roles', seats: seats(j), posted: j.created_at });
  const byGroup = {}; for (const j of open) { const g = groups[j.title] || 'Other roles'; byGroup[g] = (byGroup[g] || 0) + seats(j); }
  const low = (v) => String(v || '').trim().toLowerCase();
  const title = low(q.title); const city = low(q.city); const group = String(q.group || '').trim();
  const out = { total: open.reduce((n, j) => n + seats(j), 0), groups: byGroup };
  if (!title && !city && !group) return { ...out, jobs: open.slice(0, 9).map(card) };
  const fits = (j) => (!title || low(j.title).includes(title) || title.includes(low(j.title))) && (!city || low(j.city) === city) && (!group || (groups[j.title] || 'Other roles') === group);
  const hits = open.filter(fits);
  const wantGroup = group || groups[open.find((j) => low(j.title) === title)?.title] || (L.jobList().find((x) => low(x.title) === title) || {}).group;
  const similar = open.filter((j) => !hits.includes(j) && ((wantGroup && groups[j.title] === wantGroup) || (title && low(j.title).includes(title))))
    .sort((a, b) => Number(!!title && !low(a.title).includes(title)) - Number(!!title && !low(b.title).includes(title))).slice(0, 6); // the same job in other cities first
  return { ...out, search: { title: q.title || '', city: q.city || '', group }, jobs: hits.slice(0, 30).map(card), similar: similar.map(card) };
});
// "Become a partner" (partners page): saved, and the super admins get a task.
// A WhatsApp button on the public site was clicked: which page, which button, and the ad or link source (?src=).
route('POST', '/api/public/wa-click', { rate: { key: 'waclick', max: 120, minutes: 60 } }, (ctx) => {
  const b = ctx.body || {}; const t = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  insert('wa_clicks', { page: t(b.page) || 'Website', button: t(b.button) || 'WhatsApp', src: t(b.src), at: now() });
  return { ok: true };
});
route('POST', '/api/public/partner', { rate: { key: 'form', max: 60, minutes: 60 } }, (ctx) => {
  const b = ctx.body || {};
  if (b.website) throw httpError(400, 'Please try again.');
  if (!String(b.name || '').trim()) throw httpError(400, 'Please enter your name', 'name');
  if (!String(b.organisation || '').trim()) throw httpError(400, 'Please enter your organisation', 'organisation');
  const phone = L.digits10(b.whatsapp); if (!L.validPhone(phone)) throw httpError(400, 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9', 'whatsapp');
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email).trim())) throw httpError(400, 'Enter a valid email, or leave it empty', 'email');
  const kinds = ['Placement agency', 'Training institute', 'Industry body / association', 'Independent recruiter', 'Other'];
  insert('partner_requests', { name: String(b.name).trim(), organisation: String(b.organisation).trim(), kind: kinds.includes(b.kind) ? b.kind : 'Other', whatsapp: phone, email: String(b.email || '').trim(), city: String(b.city || '').trim(), message: String(b.message || '').slice(0, 1000), source: String(b.src || 'Website').slice(0, 40), created_at: now() });
  const text = `New partner request: ${String(b.organisation).trim()} (${kinds.includes(b.kind) ? b.kind : 'Other'}), ${String(b.city || '').trim() || 'city not given'}`;
  for (const u of L.superAdmins()) L.alertUser(u.id, text, null, true);
  D.history('Partner form', 'partner request', null, 'partner_requests', null, String(b.organisation).trim(), null, ctx.ip);
  return { ok: true };
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
// Codes can reach the person: WhatsApp is connected, or this is the test copy (code on screen).
const canSendCodes = () => D.settings().crm.enabled || showCode();
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
route('POST', '/api/otp/request', { rate: { key: 'otp', max: 40, minutes: 60 } }, (ctx) => {
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
// Email and password: a second way in for candidates and client owners who set a password in their account.
// Kept in its own table, so a password hash never travels with a profile. The WhatsApp code stays the main login.
const hasPassword = (kind, id) => !!get('SELECT 1 FROM account_passwords WHERE kind=? AND subject_id=?', kind, id);
route('POST', '/api/account/login', { rate: { key: 'pwlogin', max: 20, minutes: 15 } }, (ctx) => {
  const kind = ctx.body.kind === 'client' ? 'client' : 'candidate';
  const email = String(ctx.body.email || '').trim().toLowerCase(); const pw = String(ctx.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Enter your email', 'email');
  if (!pw) throw httpError(400, 'Enter your password', 'password');
  const table = kind === 'client' ? 'clients' : 'candidates';
  const rows = all(`SELECT r.id, p.pass_hash FROM ${table} r JOIN account_passwords p ON p.kind=? AND p.subject_id=r.id WHERE lower(r.email)=? AND r.merged_into IS NULL AND r.removed=0`, kind, email);
  const hit = rows.find((r) => L.checkPassword(pw, r.pass_hash));
  if (!hit) throw httpError(400, rows.length ? 'Email or password is wrong.' : 'No account uses this email yet. Create an account first.', 'password');
  openedAccount(kind, hit.id);
  return { token: newSession(kind, hit.id) };
});
// One email logs in to one account: refuse if another account of the same kind already has a password on it.
function emailFree(kind, email, selfId) {
  const table = kind === 'client' ? 'clients' : 'candidates';
  if (get(`SELECT 1 FROM ${table} r JOIN account_passwords p ON p.kind=? AND p.subject_id=r.id WHERE lower(r.email)=? AND r.id<>? AND r.merged_into IS NULL AND r.removed=0`, kind, email, selfId || '')) throw httpError(400, 'This email is already used to log in to another account. Use a different email.', 'email');
}
function savePassword(kind, id, pw, who = 'Form') {
  D.run('INSERT INTO account_passwords (kind, subject_id, pass_hash, updated_at) VALUES (?,?,?,?) ON CONFLICT(kind, subject_id) DO UPDATE SET pass_hash=excluded.pass_hash, updated_at=excluded.updated_at', kind, id, L.hashPassword(pw), now());
  D.history(who, 'password set', id);
}
function setPassword(kind, rec, b, actor, ip) {
  const pw = String(b.password || '');
  if (pw.length < 8) throw httpError(400, 'Use at least 8 characters.', 'password');
  const email = String(b.email || rec.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Add your email first — you log in with it.', 'email');
  emailFree(kind, email, rec.id);
  if (email !== String(rec.email || '').toLowerCase()) D.edit(kind === 'client' ? 'clients' : 'candidates', rec.id, { email }, actor.label, ip);
  savePassword(kind, rec.id, pw, actor.label);
  return { ok: true, email };
}
// ---------- create an account with email, forgot password, reset ----------
const KINDS = { client: 'clients', candidate: 'candidates' };
const kindOf = (k) => (k === 'client' ? 'client' : 'candidate');
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
function checkNewPassword(b) {
  const pw = String(b.password || '');
  if (pw.length < 8) throw httpError(400, 'Use at least 8 characters.', 'password');
  if (b.confirm !== undefined && b.confirm !== pw) throw httpError(400, 'The two passwords do not match.', 'confirm');
  return pw;
}
// Create an account with email and password. Right after the form, the session from the form is proof enough.
// From the login page: step 1 (/register-start) finds the profile by its email and sends a 6-digit code to that
// email (and its WhatsApp, while email sending is being set up); step 2 sends the code back with the password.
// Without the code, anyone who knows someone's email could open their account.
route('POST', '/api/account/register', { rate: { key: 'pwreg', max: 20, minutes: 60 } }, (ctx) => {
  const kind = kindOf(ctx.body.kind); const b = ctx.body;
  const email = cleanEmail(b.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'Enter a valid email', 'email');
  const pw = checkNewPassword(b);
  let rec = null;
  const sess = ctx.req.headers['x-session'] ? get('SELECT * FROM sessions WHERE token=? AND kind=?', ctx.req.headers['x-session'], kind) : null;
  if (sess && !sess.member_id) rec = get(`SELECT * FROM ${KINDS[kind]} WHERE id=?`, L.resolveId(sess.subject_id));
  else if (b.code && !b.phone) {
    rec = signupRecord(kind, email);
    checkCode(rec.whatsapp, `signup:${kind}`, b.code);
  } else {
    const phone = L.digits10(b.phone);
    if (!L.validPhone(phone)) throw httpError(400, 'Enter your 10-digit WhatsApp number', 'phone');
    rec = get(`SELECT * FROM ${KINDS[kind]} WHERE whatsapp=? AND merged_into IS NULL AND removed=0`, phone);
    if (!rec) throw httpError(404, kind === 'client' ? 'No client account with this number. Fill the hiring form first.' : 'No profile with this number. Fill the job form first.', 'phone');
    checkCode(phone, kind, b.code);
  }
  if (!rec) throw httpError(400, 'Please log in again.');
  if (hasPassword(kind, rec.id)) throw httpError(400, 'This account already has a password. Log in, or use Forgot password.', 'email');
  emailFree(kind, email, rec.id);
  if (email !== String(rec.email || '').toLowerCase()) D.edit(KINDS[kind], rec.id, { email }, kind === 'client' ? 'Client' : 'Candidate', ctx.ip);
  savePassword(kind, rec.id, pw, kind === 'client' ? 'Client' : 'Candidate');
  return { ok: true, email };
});
function signupRecord(kind, email) {
  const rec = get(`SELECT * FROM ${KINDS[kind]} WHERE lower(email)=? AND merged_into IS NULL AND removed=0 ORDER BY created_at DESC`, email);
  if (!rec) throw httpError(400, 'The code is wrong or has expired. Ask for a new one.', 'code');
  return rec;
}
route('POST', '/api/account/register-start', { rate: { key: 'pwsignup', max: 10, minutes: 60 } }, (ctx) => {
  const kind = kindOf(ctx.body.kind); const email = cleanEmail(ctx.body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'Enter a valid email', 'email');
  checkNewPassword(ctx.body);
  // The email is optional on the forms, so it may not be on any profile yet: then the WhatsApp number used in
  // the form finds the profile, and the code goes there (the email is added to the profile when the code is right).
  const byEmail = get(`SELECT * FROM ${KINDS[kind]} WHERE lower(email)=? AND merged_into IS NULL AND removed=0 ORDER BY created_at DESC`, email);
  if (!byEmail) {
    if (!ctx.body.phone) return { need_phone: true };
    const phone = L.digits10(ctx.body.phone);
    if (!L.validPhone(phone)) throw httpError(400, 'Enter your 10-digit WhatsApp number', 'phone');
    const rec = get(`SELECT * FROM ${KINDS[kind]} WHERE whatsapp=? AND merged_into IS NULL AND removed=0`, phone);
    if (!rec) throw httpError(404, kind === 'client' ? 'No client account with this number. Fill the hiring form first.' : 'No profile with this number. Fill the job form first.', 'phone');
    if (hasPassword(kind, rec.id)) throw httpError(400, 'This profile already has an email login. Log in, or use Forgot password.', 'phone');
    emailFree(kind, email, rec.id);
    const code = issueCode(phone, kind);
    return { sent: true, by_whatsapp: true, phone, dev_code: showCode() ? code : undefined };
  }
  const rec = byEmail;
  if (hasPassword(kind, rec.id)) throw httpError(400, 'This email already has an account. Log in, or use Forgot password.', 'email');
  emailFree(kind, email, rec.id);
  const mailer = require('./mailer');
  if (!L.validPhone(rec.whatsapp) && !mailer.configured()) throw httpError(400, 'We cannot send you a code right now. Please log in with your WhatsApp number.', 'email');
  let code;
  if (L.validPhone(rec.whatsapp)) code = issueCode(rec.whatsapp, `signup:${kind}`);
  else { code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); insert('otps', { phone: rec.whatsapp || '', purpose: `signup:${kind}`, code_hash: L.sha(code + (rec.whatsapp || '')), expires: new Date(Date.now() + 10 * 60000).toISOString(), tries: 0, used: 0, created_at: now() }); }
  mailer.accountCode(email, code, rec.id, 'signup');
  return { sent: true, by_email: mailer.configured(), by_whatsapp: L.validPhone(rec.whatsapp), dev_code: showCode() ? code : undefined };
});
// Forgot password: a 6-digit code goes to the account's WhatsApp and to its email. The answer is the same
// whether or not the email is known, so nobody can use this to find out who has an account.
route('POST', '/api/account/forgot', { rate: { key: 'pwforgot', max: 10, minutes: 60 } }, (ctx) => {
  const kind = kindOf(ctx.body.kind); const email = cleanEmail(ctx.body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'Enter your email', 'email');
  const rec = get(`SELECT r.* FROM ${KINDS[kind]} r JOIN account_passwords p ON p.kind=? AND p.subject_id=r.id WHERE lower(r.email)=? AND r.merged_into IS NULL AND r.removed=0`, kind, email);
  let dev;
  if (rec && L.validPhone(rec.whatsapp)) {
    const code = issueCode(rec.whatsapp, `reset:${kind}`);
    require('./mailer').accountCode(email, code, rec.id, 'reset');
    dev = showCode() ? code : undefined;
  }
  return { sent: true, dev_code: dev };
});
route('POST', '/api/account/reset', { rate: { key: 'pwreset', max: 20, minutes: 60 } }, (ctx) => {
  const kind = kindOf(ctx.body.kind); const email = cleanEmail(ctx.body.email);
  const rec = get(`SELECT r.* FROM ${KINDS[kind]} r JOIN account_passwords p ON p.kind=? AND p.subject_id=r.id WHERE lower(r.email)=? AND r.merged_into IS NULL AND r.removed=0`, kind, email);
  if (!rec) throw httpError(400, 'The code is wrong or has expired. Ask for a new one.', 'code');
  const pw = checkNewPassword(ctx.body);
  checkCode(rec.whatsapp, `reset:${kind}`, ctx.body.code);
  savePassword(kind, rec.id, pw, kind === 'client' ? 'Client' : 'Candidate');
  D.run('DELETE FROM sessions WHERE kind=? AND subject_id=?', kind, rec.id); // old logins end with the old password
  return { ok: true };
});
// English / हिन्दी from the switch in the account: the screens and the WhatsApp messages follow it.
const langOf = (ctx) => { const l = ctx.body.language; if (!['en', 'hi'].includes(l)) throw httpError(400, 'Pick English or Hindi'); return l; };
route('POST', '/api/cand/language', { auth: 'candidate' }, (ctx) => { update('candidates', ctx.candidate.id, { language: langOf(ctx) }); return { ok: true }; });
route('POST', '/api/client/language', { auth: 'client' }, (ctx) => { update('clients', ctx.client.id, { language: langOf(ctx) }); return { ok: true }; });
route('POST', '/api/cand/password', { auth: 'candidate', rate: { key: 'pwset', max: 10, minutes: 60 } }, (ctx) => setPassword('candidate', ctx.candidate, ctx.body, ctx.actor, ctx.ip));
route('POST', '/api/client/password', { auth: 'client', rate: { key: 'pwset', max: 10, minutes: 60 } }, (ctx) => {
  if (ctx.member) throw httpError(403, 'Team members log in with their WhatsApp number.');
  return setPassword('client', ctx.client, ctx.body, ctx.actor, ctx.ip);
});
route('POST', '/api/account/logout', {}, (ctx) => { D.run('DELETE FROM sessions WHERE token=?', ctx.req.headers['x-session'] || ''); return { ok: true }; });

// ---------- public forms ----------
// Which ad: campaign, ad set and ad name, sent by the form from the link the ad opened.
// A portal job ID written in the ad set, ad or campaign name ("JB-2001 Sales Executive Mumbai"), so one link serves every ad.
function jobInAd(b) {
  for (const v of [b.ad_set, b.ad_name, b.ad_campaign]) { const m = /(?:^|[^A-Za-z0-9])JB[-\s_]?(\d{3,})(?!\d)/i.exec(String(v || '')); if (m) return `JB-${m[1]}`; }
  return null;
}
// The job whose saved ad names (Meta / LinkedIn campaign, ad set, ad) match this applicant's link. Every name filled
// in on the job must match (letter case and extra spaces ignored); the job with the most matching names wins.
function jobByAdNames(b, source) { return jobsByAdNames(b, source)[0] || null; }
// Every open job whose saved names match (one ad can serve several jobs with the same need), best match first.
function jobsByAdNames(b, source) {
  const n = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const got = { campaign: n(b.ad_campaign), adset: n(b.ad_set), ad: n(b.ad_name) };
  if (!got.campaign && !got.adset && !got.ad) return null;
  const platform = /linkedin/i.test(source) ? 'LinkedIn' : /facebook|instagram|meta/i.test(source) ? 'Meta' : null;
  const hits = new Map();
  for (const j of all("SELECT * FROM jobs WHERE archived=0 AND is_sample=0 AND ad_match IS NOT NULL AND ad_match != '[]'")) {
    if (!['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(V.jobView(j).status)) continue;
    for (const m of j.ad_match || []) {
      if (platform && m.platform && m.platform !== platform) continue;
      const keys = ['campaign', 'adset', 'ad'].filter((k) => m[k]);
      if (!keys.length || !keys.every((k) => n(m[k]) === got[k])) continue;
      if (!hits.has(j.id) || hits.get(j.id).score < keys.length) hits.set(j.id, { j, score: keys.length });
    }
  }
  return [...hits.values()].sort((a, b) => b.score - a.score || (b.j.created_at > a.j.created_at ? 1 : -1)).map((h) => h.j.id);
}
function adFrom(b) {
  const t = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const ad = { campaign: t(b.ad_campaign), adset: t(b.ad_set), ad: t(b.ad_name) };
  return ad.campaign || ad.adset || ad.ad ? ad : null;
}
function srcFrom(b) {
  const tags = D.settings().src_tags;
  if (b.ref) return 'Referral';
  // ?src= or, from an ad's tracking, ?utm_source= (Meta's {{site_source_name}} gives fb, ig, an or msg).
  const raw = String(b.src || b.utm_source || '').trim().slice(0, 40);
  if (raw) { const k = { facebook: 'fb', an: 'fb', msg: 'fb', instagram: 'ig' }[raw.toLowerCase()] || raw; return tags[k] || tags[k.toLowerCase()] || D.settings().lead_sources.find((x) => x.toLowerCase() === raw.toLowerCase()) || raw; }
  return 'Website';
}
route('POST', '/api/public/hire', { rate: { key: 'form', max: 60, minutes: 60 } }, (ctx) => {
  const b = ctx.body;
  if (b.website) throw httpError(400, 'Please try again.'); // hidden field only bots fill in
  if (!b.contact || !String(b.contact).trim()) throw httpError(400, 'Please enter your name', 'contact');
  if (!b.company || !String(b.company).trim()) throw httpError(400, 'Please enter your company name', 'company');
  if (!b.city) throw httpError(400, 'Please enter your city', 'city');
  if (!b.business_type) throw httpError(400, 'Pick your type of business', 'business_type');
  if (!b.need) throw httpError(400, 'Tell us when you need staff', 'need');
  if (b.email) b.email = String(b.email).trim();
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email).trim())) throw httpError(400, 'Enter a valid email, or leave it empty', 'email');
  const r = L.intakeClient({ ...b, language: b.lang }, { source: srcFrom(b) });
  const mailer = require('./mailer');
  if (r.isNew) mailer.newLead('client', r.client);
  mailer.confirmToPerson('client', r.client);
  if (['en', 'hi'].includes(b.lang)) update('clients', r.client.id, { language: b.lang });
  return formDone('client', r.isNew, r.client.id, r.client.whatsapp);
});
// The job form's first step: read the chosen CV and hand back the details to fill in. Nothing is saved here.
route('POST', '/api/public/cv-read', { rate: { key: 'cvread', max: 80, minutes: 60 } }, (ctx) => {
  const b = ctx.body || {};
  if (!b.base64 || !/\.(pdf|docx|txt)$/i.test(String(b.name || ''))) return { fields: {}, readable: false };
  const buf = Buffer.from(String(b.base64).replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.length > 10 * 1024 * 1024) throw httpError(400, 'The file is bigger than 10 MB.');
  return { fields: CV.read(b.name, buf), readable: true };
});
route('POST', '/api/public/apply', { rate: { key: 'form', max: 60, minutes: 60 } }, async (ctx) => {
  const b = ctx.body;
  if (b.website) throw httpError(400, 'Please try again.'); // hidden field only bots fill in
  if (!b.name || !String(b.name).trim()) throw httpError(400, 'Please enter your name', 'name');
  if (b.email) b.email = String(b.email).trim();
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email).trim())) throw httpError(400, 'Enter a valid email, or leave it empty', 'email');

  if (!b.city) throw httpError(400, 'Please enter the city you want to work in', 'city');
  if (!b.job_wanted) throw httpError(400, 'Pick the job you want', 'job_wanted');
  const business = L.cleanBusiness(b.exp_business);
  // Required on the current form (which always sends the field); a page opened before this question existed still goes through.
  if (b.exp_business !== undefined && b.experience && b.experience !== 'Fresher' && !business.length) throw httpError(400, 'Tick where you have worked: wholesaler, manufacturer or retailer', 'exp_business');
  if (b.job_wanted === 'Other' && !b.job_other) throw httpError(400, 'Type the job you want', 'job_other');
  const expMap = L.EXP_YEARS; const jewMap = L.JEW_YEARS;
  let refBy = null;
  if (b.ref) { const rc = get('SELECT id FROM candidates WHERE id=?', L.resolveId(String(b.ref).toUpperCase())); refBy = rc ? rc.id : null; }
  const adJobs = !b.job && !jobInAd(b) ? jobsByAdNames(b, srcFrom(b)) : [];
  const jobId = b.job ? String(b.job).toUpperCase() : jobInAd(b) || adJobs[0] || null;
  const jobOk = jobId ? get('SELECT * FROM jobs WHERE id=?', jobId) : null;
  const r = L.intakeCandidate({ exp_business: business, exp_jewellery: b.exp_jewellery in jewMap ? jewMap[b.exp_jewellery] : null, language: b.lang, name: b.name, whatsapp: b.whatsapp, email: b.email || '', city: b.city, state: b.state, work_cities: [b.city], job_wanted: b.job_wanted === 'Other' ? b.job_other : b.job_wanted, exp_total: b.experience ? expMap[b.experience] : null, ref_by: refBy, apply_job: jobOk && ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(V.jobView(jobOk).status) ? jobOk.id : null }, { source: srcFrom(b), ad: adFrom(b) });
  // The same ad on several jobs: an application on each of the others too.
  for (const extra of adJobs.slice(1)) { try { L.createApplication(r.candidate.id, extra, { label: 'Candidate' }, srcFrom(b), 'Applied from an ad', adFrom(b)); } catch { /* already on it */ } }
  { const mailer = require('./mailer'); const rec = get('SELECT * FROM candidates WHERE id=?', r.candidate.id); if (r.isNew) mailer.newLead('candidate', rec); mailer.confirmToPerson('candidate', rec); }
  if (refBy && r.isNew) insert('notes', { record_id: r.candidate.id, text: `Referred by ${refBy}`, author: 'Form', at: now() });
  if (b.cv && b.cv.base64) { try { const f = await F.saveFile({ recordId: r.candidate.id, type: 'cv', name: b.cv.name, base64: b.cv.base64, by: 'Candidate form' }); update('candidates', r.candidate.id, { cv_file: String(f.id) }); CV.fillCandidate(r.candidate.id, b.cv.name, b.cv.base64, 'Candidate form'); } catch (e) { insert('notes', { record_id: r.candidate.id, text: `CV not saved: ${e.message}`, author: 'Form', at: now() }); } }
  if (['en', 'hi'].includes(b.lang)) update('candidates', r.candidate.id, { language: b.lang });
  return formDone('candidate', r.isNew, r.candidate.id, r.candidate.whatsapp);
});
// A new sign-up opens its own fresh account straight away: it holds only what this person just typed.
// A number we already know never opens without the WhatsApp code (someone could type another person's number).
function formDone(kind, isNew, id, phone) {
  const out = { id, isNew, phone, can_verify: canSendCodes() };
  // New job seekers activate their profile first: a WhatsApp code or email + password proves the number is theirs.
  if (isNew && kind === 'client') { openedAccount(kind, id); out.token = newSession(kind, id); }
  if (isNew && kind === 'candidate') out.activate = true;
  return out;
}

// ---------- client account (6.3) ----------
const C = { auth: 'client' };
const companyLabel = (cl) => {
  const kind = { 'Showroom B2C': 'showroom', 'Manufacturer B2B': 'manufacturer', Both: 'business' }[cl.business_type] || 'business';
  return `${cl.industry || 'Jewellery'} ${kind}, ${cl.city || 'India'}`;
};
function clientAppView(a, client) {
  const v = V.appView(a); const cand = get('SELECT * FROM candidates WHERE id=?', a.candidate_id); const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
  // Clients never get a candidate's phone, email or full CV (it carries both); our team stays in between.
  const avail = get("SELECT note, at FROM app_history WHERE app_id=? AND kind='availability' ORDER BY id DESC LIMIT 1", a.id);
  const ours = all("SELECT * FROM interviews WHERE app_id=? AND round='ours' AND status='Completed'", a.id);
  // Every round's result and notes (ours and theirs) travel with the candidate; the candidate never sees these.
  const rounds = all('SELECT * FROM interviews WHERE app_id=? ORDER BY at', a.id).map(L.interviewView).map((i) => ({ id: i.id, name: i.name, mode_label: i.mode_label, at: i.at, status: i.view_status, result: i.result, remark: i.status === 'Completed' ? i.remark : null, rating: i.rating, qa: i.qa, notes: i.notes, client_joins: L.clientSeesIv(i) }));
  const sc = L.matchScore(cand, job, L.ratingOf(cand.id));
  const js = (job.skills || []).map((x) => x.toLowerCase());
  return {
    id: a.id, step: a.step, result: a.result, job_id: job.id, job_title: job.title, candidate_id: cand.id, name: cand.name, city: cand.city, phone: null, availability: avail ? { text: avail.note, at: avail.at } : null,
    exp_total: cand.exp_total, exp_jewellery: cand.exp_jewellery, exp_business: cand.exp_business || [], cur_salary: cand.cur_salary, exp_salary: cand.exp_salary, notice_days: cand.notice_days, current_company: cand.current_company,
    skills: (cand.skills || []).map((s) => ({ s, match: js.includes(s.toLowerCase()) })), score: sc.score, reasons: sc.reasons, short_cv: cand.short_cv_file || null, cv: null,
    our_notes: ours.map((i) => ({ remark: i.remark, rating: i.rating, qa: i.qa })), rounds, interviews: v.interviews.filter((i) => L.clientSeesIv(i)), offer_ctc: a.offer_ctc, joining_date: a.joining_date,
    offer_letter: a.offer_letter, offer_sent: a.offer_sent, checklist: a.checklist, joining_docs: a.joining_docs, client_choice: a.client_choice,
  };
}
route('GET', '/api/client/me', C, (ctx) => {
  const c = ctx.client; const perms = ctx.member ? ctx.member.perms || {} : { candidates: true, feedback: true, approve: true, bills: true, admin: true };
  const jobs = all('SELECT * FROM jobs WHERE client_id=? AND archived=0 ORDER BY created_at DESC', c.id).map((j) => V.jobView(j));
  const apps = all('SELECT a.* FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.client_id=?', c.id);
  // Everyone shared with the client stays on their list, closed ones too (with a plain reason), so nobody just disappears.
  const sent = apps.filter((a) => L.stepIdx(a.step) >= 3);
  const candidates = perms.candidates ? sent.map((a) => clientAppView(a, c)) : [];
  const ivs = all("SELECT i.* FROM interviews i JOIN applications a ON a.id=i.app_id JOIN jobs j ON j.id=a.job_id WHERE j.client_id=? AND (i.round='client' OR i.client_joins=1) ORDER BY i.at DESC", c.id).map(L.interviewView)
    .map((i) => { const a = apps.find((x) => x.id === i.app_id); const cand = get('SELECT name FROM candidates WHERE id=?', a.candidate_id); return { ...i, candidate: cand.name, job: get('SELECT title FROM jobs WHERE id=?', a.job_id).title }; });
  const bills = perms.bills ? all("SELECT * FROM bills WHERE client_id=? AND status!='Draft' ORDER BY created_at DESC", c.id).map(L.billView).map((b) => {
    const a = V.appView(get('SELECT * FROM applications WHERE id=?', b.app_id)); const ap = get('SELECT * FROM applications WHERE id=?', b.app_id);
    const win = c.replacement_days || D.settings().replacement_days;
    return { ...b, candidate: a.candidate_name, job: a.job_title, joining_date: a.joining_date, upi: L.upiLink(b.balance, b.bill_no), can_replace: !!(ap.joined_at && L.daysBetween(ap.joined_at) <= win && !ap.replacement_used && !b.is_replacement && !b.replacement_requested), replacement_requested: b.replacement_requested, left_date: ap.left_date };
  }) : [];
  const waiting = candidates.filter((x) => x.step === 'Sent to client' && x.result === 'open' && !x.client_choice).length;
  const checklist = V.onboardingView(c).filter((x) => ['intro_call', 'kyc', 'contract', 'first_job'].includes(x.key));
  return {
    client: { ...c, templates: c.templates ? JSON.parse(c.templates) : D.settings().templates }, member: ctx.member, perms, has_password: hasPassword('client', c.id),
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
  if (a === 'add-seat') { const r = L.jobAction(j.id, 'add_seat', { add: ctx.body.add || 1, reason: ctx.body.reason || 'Client needs more people' }, ctx.actor); L.alertUser(j.recruiter_id, `${ctx.client.company} added ${Number(ctx.body.add) || 1} seat(s) to ${j.id}`, j.id); return r; }
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
// The client shares when they can meet the candidate; our recruiter fixes the interview from these times.
route('POST', '/api/client/apps/:id/availability', { auth: 'client', perm: 'candidates' }, (ctx) => {
  const a = clientApp(ctx); if (a.result !== 'open') throw httpError(400, 'This profile is closed.');
  // Each option is a window: { from, to } on one day (an older single time is still accepted).
  const slots = (Array.isArray(ctx.body.slots) ? ctx.body.slots : []).filter(Boolean).map((x) => (typeof x === 'string' ? { from: new Date(x), to: null } : { from: new Date(x.from), to: x.to ? new Date(x.to) : null }));
  for (const [i, s] of slots.entries()) {
    if (isNaN(s.from) || (s.to && isNaN(s.to))) throw httpError(400, 'Pick a date and time', `slot${i + 1}`);
    if (s.to && s.to <= s.from) throw httpError(400, 'The end time must be after the start time', `slot${i + 1}`);
    if ((s.to || s.from) <= new Date()) throw httpError(400, 'Pick a time from now onwards', `slot${i + 1}`);
  }
  if (!slots.length) throw httpError(400, 'Give at least one date and time', 'slot1');
  const b = ctx.body;
  const when = (s) => `${L.istFmt(s.from.toISOString())}${s.to ? ` – ${L.istTime(s.to.toISOString())}` : ''}`;
  const text = `Interview availability from ${ctx.actor.label}: ${slots.map(when).join(' · ')}${b.place ? ` · Place: ${b.place}` : ''}${b.interviewer ? ` · Meets: ${b.interviewer}` : ''}${b.note ? ` · ${b.note}` : ''}`;
  update('applications', a.id, { client_choice: 'Availability shared' });
  if (L.stepIdx(a.step) < L.stepIdx('Client interview')) L.moveStep(a.id, 'Client interview', ctx.actor, 'Client shared interview availability');
  L.appHist(a.id, get('SELECT step FROM applications WHERE id=?', a.id).step, ctx.actor, text, 'availability');
  insert('notes', { record_id: a.id, text, author: ctx.actor.label, at: now() });
  const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
  L.alertUser(a.owner_id || job.recruiter_id, `${ctx.client.company} shared interview times for ${a.id}: fix the interview`, a.id);
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
  if (!L.clientSeesIv(iv)) throw httpError(403, 'Our team records this round.');
  // A virtual round the client joined is one of ours: "Selected" there means move ahead to the final round.
  const result = iv.round === 'ours' ? ({ Selected: 'Move ahead', 'Not selected': 'Not selected', 'Another round': 'On hold' }[ctx.body.result]) : ctx.body.result;
  const r = L.recordInterview(iv.id, { status: 'Completed', result, remark: ctx.body.remark || `Feedback by ${ctx.actor.label}`, rating: ctx.body.rating }, ctx.actor);
  const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
  L.alertUser(a.owner_id || job.recruiter_id, `${ctx.client.company}: ${ctx.body.result} on ${a.id}${ctx.body.result === 'Selected' ? ' — record the offer' : ''}`, a.id);
  return r;
});
// Offers are recorded by our team (team portal); clients no longer add offer details or letters themselves.
// A client's note on an interview they take part in (shown to our team and on the candidate everywhere but the candidate's own page).
route('POST', '/api/client/interviews/:id/notes', { auth: 'client', perm: 'candidates' }, (ctx) => {
  const iv = get('SELECT * FROM interviews WHERE id=?', ctx.params.id); if (!iv) throw httpError(404, 'Interview not found');
  ctx.params.id = iv.app_id; const a = clientApp(ctx);
  if (!L.clientSeesIv(iv)) throw httpError(403, 'Notes can be added to your interview rounds.');
  const r = L.addIvNote(iv.id, ctx.body.text, `${ctx.actor.label} (${ctx.client.company})`, 'client');
  const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
  L.alertUser(a.owner_id || job.recruiter_id, `${ctx.client.company} added a note on ${iv.id} (${a.id})`, a.id, false);
  return r;
});
// Calendar file for one interview (Google Calendar, Outlook, phone calendars all open .ics).
route('GET', '/api/client/interviews/:id/ics', { auth: 'client' }, (ctx) => {
  const iv = get('SELECT * FROM interviews WHERE id=?', ctx.params.id); if (!iv) throw httpError(404, 'Interview not found');
  ctx.params.id = iv.app_id; const a = clientApp(ctx); if (!L.clientSeesIv(iv)) throw httpError(403, 'Not your round');
  const cand = get('SELECT name FROM candidates WHERE id=?', a.candidate_id); const job = get('SELECT title FROM jobs WHERE id=?', a.job_id);
  const st = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(new Date(iv.at).getTime() + 45 * 60000);
  const esc = (t) => String(t || '').replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BrillBrains Hiring//EN', 'BEGIN:VEVENT', `UID:${iv.id}@hire.brillbrainsconsultants.com`, `DTSTAMP:${st(new Date())}`, `DTSTART:${st(iv.at)}`, `DTEND:${st(end)}`,
    `SUMMARY:${esc(`Interview: ${cand.name} — ${job.title} (${iv.name})`)}`, `LOCATION:${esc(iv.link || iv.place)}`, `DESCRIPTION:${esc(`${iv.name} with ${cand.name} for ${job.title}. Arranged by BrillBrains Hiring Solutions.${iv.link ? `\nJoin: ${iv.link}` : ''}`)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return { __file: { buf: Buffer.from(body, 'utf8'), mime: 'text/calendar; charset=utf-8', name: `${iv.id}.ics` } };
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
// What a full profile needs; a fresher (0 years) is not asked for a current salary or notice period.
const PROFILE_ITEMS = [['name', 'Name'], ['city', 'City'], ['job_wanted', 'Job you want'], ['exp_total', 'Experience'], ['cur_salary', 'Current salary'], ['exp_salary', 'Expected salary'], ['notice_days', 'Notice period'], ['cv_file', 'CV'], ['email', 'Email'], ['skills', 'Skills']];
function profileGaps(c) {
  const fresher = c.exp_total === 0;
  const items = PROFILE_ITEMS.filter(([k]) => !(fresher && (k === 'cur_salary' || k === 'notice_days')));
  const missing = items.filter(([k]) => (k === 'skills' ? !(c.skills || []).length : c[k] === null || c[k] === undefined || c[k] === ''));
  return { pct: Math.round(((items.length - missing.length) / items.length) * 100), missing: missing.map(([key, label]) => ({ key, label })) };
}
const profilePct = (c) => profileGaps(c).pct;
// Candidates never see the employer's name in their account, only a description ("Jewellery showroom, Jaipur").
function companyShown() { return false; }
route('GET', '/api/cand/me', K, (ctx) => {
  const c = ctx.candidate; const s = D.settings();
  const apps = all('SELECT * FROM applications WHERE candidate_id=? ORDER BY created_at DESC', c.id).map((a) => {
    const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const cl = get('SELECT * FROM clients WHERE id=?', job.client_id);
    const ivs = all('SELECT * FROM interviews WHERE app_id=? ORDER BY at', a.id).map(L.interviewView).map(({ notes, remark, rating, qa, ...i }) => i);
    return { id: a.id, step: a.step, result: a.result, job_title: job.title, city: job.city, company: companyShown(a, cl) ? cl.company : companyLabel(cl), company_shown: companyShown(a, cl), interviews: ivs, offer_ctc: a.offer_ctc, joining_date: a.joining_date, offer_letter: a.offer_sent ? a.offer_letter : null, joining_docs: a.joining_docs || [], checklist: a.checklist, left_date: a.left_date, steps: L.STEPS };
  });
  const rating = L.ratingOf(c.id);
  const onJob = new Set(apps.filter((a) => a.result === 'open' || a.result === 'Hired').map((a) => a.id));
  const appliedJobs = new Set(all("SELECT job_id FROM applications WHERE candidate_id=? AND result='open'", c.id).map((r) => r.job_id));
  const jobs = all('SELECT * FROM jobs WHERE archived=0').map((j) => V.jobView(j)).filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status) && !appliedJobs.has(j.id))
    .map((j) => { const m = L.matchScore(c, j, rating); const cl = get('SELECT * FROM clients WHERE id=?', j.client_id); return { id: j.id, title: j.title, city: j.city, company: companyLabel(cl), salary: L.salaryText(j), exp: j.exp_from !== null ? `${j.exp_from}–${j.exp_to ?? '+'} yrs` : '', score: m.score, reasons: m.reasons }; })
    .filter((j) => j.score >= s.match.show).sort((a, b) => b.score - a.score);
  const next = apps.flatMap((a) => a.interviews.filter((i) => ['Scheduled', 'Rescheduled'].includes(i.status) && i.at > now()).map((i) => ({ ...i, app: a.id, job_title: a.job_title, company: a.company }))).sort((a, b) => (a.at < b.at ? -1 : 1))[0] || null;
  const offer = apps.find((a) => a.result === 'open' && a.step === 'Offer made') || null;
  return {
    profile: { ...c, resume_check: undefined, cur_month: c.cur_salary ? Math.round(c.cur_salary / 12) : null, exp_month: c.exp_salary ? Math.round(c.exp_salary / 12) : null }, pct: profilePct(c),
    resume: resumeState(c), missing: profileGaps(c).missing, has_password: hasPassword('candidate', c.id), apps, jobs, next, offer,
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
// Social profiles: only web links, one per network.
const SOCIAL_KEYS = ['linkedin', 'instagram', 'facebook', 'portfolio', 'youtube'];
function cleanSocial(v) {
  const out = {};
  for (const k of SOCIAL_KEYS) {
    let u = String((v || {})[k] || '').trim(); if (!u) continue;
    if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
    try { const x = new URL(u); if (!['http:', 'https:'].includes(x.protocol) || !x.hostname.includes('.')) throw new Error(); out[k] = x.toString().slice(0, 300); } catch { throw httpError(400, 'That link does not look right', `social_${k}`); }
  }
  return out;
}
// Resume score (kept with the profile; the CV is read again only when a new one is uploaded).
const RES = require('./resume');
function resumeState(c) {
  const rc = c.resume_check || {};
  let len = rc.cv_len;
  if (rc.cv_for !== (c.cv_file || null)) { len = RES.cvTextOf(c).length; update('candidates', c.id, { resume_check: { ...rc, cv_for: c.cv_file || null, cv_len: len } }); }
  return { ...RES.check(c, len || 0), built: rc.resume || null, ai: RES.aiAvailable() };
}
route('POST', '/api/cand/resume/build', { auth: 'candidate', rate: { key: 'resume', max: 12, minutes: 60 } }, async (ctx) => RES.build(get('SELECT * FROM candidates WHERE id=?', ctx.candidate.id), ctx.actor.label));
route('GET', '/api/cand/resume/pdf', K, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.candidate.id); const r = (c.resume_check || {}).resume;
  if (!r) throw httpError(400, 'Create your resume first.');
  const f = RES.savePdf(c, r, ctx.actor.label);
  return { __file: { buf: require('./files').readStored(f), mime: 'application/pdf', name: f.name } };
});
route('PUT', '/api/cand/profile', K, (ctx) => {
  const b = ctx.body; const patch = {};
  if (b.exp_business !== undefined) b.exp_business = L.cleanBusiness(b.exp_business);
  for (const k of ['exp_business', 'name', 'email', 'city', 'state', 'job_wanted', 'exp_total', 'exp_jewellery', 'notice_days', 'skills', 'current_company', 'looking', 'work_cities']) if (b[k] !== undefined) patch[k] = b[k] === '' ? null : b[k];
  if (patch.looking && !L.LOOKING.includes(patch.looking)) throw httpError(400, 'Pick a looking status', 'looking');
  if (b.social !== undefined) patch.social = cleanSocial(b.social);
  // A new city brings its own state (the profile has no State box), unless a state was sent with it.
  if (patch.city && patch.city !== ctx.candidate.city && b.state === undefined) patch.state = L.stateOf(patch.city) || null;
  const yearly = (month, now) => (month === '' ? null : Number(month) === Math.round((now || 0) / 12) ? now : Number(month) * 12);
  if (b.cur_month !== undefined) patch.cur_salary = yearly(b.cur_month, ctx.candidate.cur_salary);
  if (b.exp_month !== undefined) patch.exp_salary = yearly(b.exp_month, ctx.candidate.exp_salary);
  if (patch.name !== undefined && !String(patch.name || '').trim()) throw httpError(400, 'Please enter your name', 'name');
  if (patch.job_wanted) patch.department = L.deptOf(patch.job_wanted);
  patch.last_updated = now();
  return D.edit('candidates', ctx.candidate.id, patch, ctx.actor.label);
});
// Changing the WhatsApp number: a code goes to the NEW number, and only that code saves it.
// The old number stays in the record's history; the new one becomes the login number at once.
function newNumberCheck(ctx, raw) {
  const phone = L.digits10(raw);
  if (!L.validPhone(phone)) throw httpError(400, 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9', 'phone');
  if (phone === ctx.candidate.whatsapp) throw httpError(400, 'This is already your number.', 'phone');
  if (get('SELECT 1 FROM candidates WHERE whatsapp=? AND id<>? AND merged_into IS NULL AND removed=0', phone, ctx.candidate.id)) throw httpError(400, 'This number is on another profile with us. Please message us to join the two.', 'phone');
  return phone;
}
route('POST', '/api/cand/phone/request', { auth: 'candidate', rate: { key: 'phone', max: 6, minutes: 60 } }, (ctx) => {
  const phone = newNumberCheck(ctx, ctx.body.phone);
  if (!showCode() && !D.settings().crm.enabled) throw httpError(400, 'Codes are sent on WhatsApp, which is being set up. Please try again later.', 'phone');
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  if (get('SELECT COUNT(*) c FROM otps WHERE phone=? AND created_at>?', phone, hourAgo).c >= 5) throw httpError(429, 'Too many codes asked for this number. Try again in an hour.');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  insert('otps', { phone, purpose: `phone:${ctx.candidate.id}`, code_hash: L.sha(code + phone), expires: new Date(Date.now() + 10 * 60000).toISOString(), tries: 0, used: 0, created_at: now() });
  L.sendWA({ ptype: 'candidate', pid: ctx.candidate.id, toPhone: phone, format: 'bbhs_login_code', vars: { code }, secret: code });
  return { sent: true, phone, dev_code: showCode() ? code : undefined };
});
route('POST', '/api/cand/phone/verify', { auth: 'candidate' }, (ctx) => {
  const phone = newNumberCheck(ctx, ctx.body.phone);
  checkCode(phone, `phone:${ctx.candidate.id}`, ctx.body.code);
  const old = ctx.candidate.whatsapp;
  const patch = { whatsapp: phone, last_updated: now() };
  if (/no phone/i.test(ctx.candidate.needs_check || '')) patch.needs_check = null;
  D.edit('candidates', ctx.candidate.id, patch, ctx.actor.label, ctx.ip);
  insert('notes', { record_id: ctx.candidate.id, text: `WhatsApp number changed by the candidate from ${old || 'none'} to ${phone} (checked with a code sent to the new number).`, author: ctx.actor.label, at: now() });
  return { ok: true, phone };
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
  const filled = b.type === 'short_cv' ? [] : CV.fillCandidate(ctx.candidate.id, b.name, b.base64, ctx.actor.label);
  return { ...f, filled };
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
    if (rid.startsWith('CA-')) { const c = get('SELECT * FROM candidates WHERE id=?', rid); ok = R.phoneVisible(u, c) || ['cv', 'short_cv'].includes(f.type); }
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
    // Only our short CV (the full CV carries phone and email), once any of this candidate's applications to them was sent.
    else if (rid.startsWith('CA-')) ok = f.type === 'short_cv' && all('SELECT a.step FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=? AND j.client_id=?', rid, cid).some((a) => L.stepIdx(a.step) >= 3);
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
      const filled = CV.fillCandidate(r.pid, name, b.media.base64, 'WhatsApp');
      r.effect = `${r.effect}; CV saved${filled.length ? ` (filled ${filled.join(', ')})` : ''}`;
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
