// Business rules: steps and statuses (5), matching, fees (9.4, 16), WhatsApp records (8), leads (11), after joining (15).
const crypto = require('crypto');
const D = require('./db');
const { all, get, run, insert, update, nextId, settings, history, now, httpError } = D;

// Closing reasons the software uses itself (not in the team's pick list).
const SYSTEM_CLOSE = ['Job closed', 'Position filled', 'Joined elsewhere', 'Already hired', 'Requirement not met', 'Rejected at screening', 'Rejected at telephonic round', 'Rejected at virtual round'];
// The screening decision on an application. Not met / Rejected close it; Under consideration / Accepted keep it open
// (reopening one closed by an earlier screening decision), and move it on: Applied -> Screening, Accepted -> Our interview.
const SCREEN = ['Under consideration', 'Requirement not met', 'Rejected', 'Accepted'];
const STEPS = ['Applied', 'Screening', 'Our interview', 'Sent to client', 'Client interview', 'Offer made', 'Offer accepted', 'Joined'];
// Routine messages go by email only (WhatsApp costs per message); everything someone must act on or know at once keeps WhatsApp too.
const EMAIL_ONLY_RULES = ['log_reminder', 'day_summary', 'monthly_summary', 'still_looking'];
// The team's daily messages never go on WhatsApp (by email once email is set up, otherwise not at all).
const NEVER_WHATSAPP_RULES = ['log_reminder', 'day_summary'];
const ruleChannel = (r) => (r && r.channel) || (r && EMAIL_ONLY_RULES.includes(r.key) ? 'email' : 'both');
const ACTION_RULES = ['client_welcome', 'candidate_welcome', 'interview_scheduled', 'offer', 'shortlist_ready', 'bill_raised', 'jd_approval'];
const stepIdx = (s) => STEPS.indexOf(s);
const INTERVIEW_STEPS = ['Our interview', 'Sent to client', 'Client interview'];

// ---------- small utils ----------
function digits10(v) {
  if (v === null || v === undefined) return '';
  let d = String(v).replace(/\.0+$/, '').replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(-10);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
const validPhone = (d) => /^[6-9]\d{9}$/.test(d);
function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '₹' + Math.round(Number(n)).toLocaleString('en-IN');
}
// India time helpers. Everything is stored in UTC ISO; India is UTC+5:30.
const IST_MS = 330 * 60 * 1000;
const istDate = (d = new Date()) => new Date(new Date(d).getTime() + IST_MS);
const istDay = (d = new Date()) => istDate(d).toISOString().slice(0, 10);
const istHour = (d = new Date()) => { const t = istDate(d); return t.getUTCHours() + t.getUTCMinutes() / 60; };
function istFmt(d, withTime = true) {
  if (!d) return '';
  const opts = { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return new Date(d).toLocaleString('en-IN', opts);
}
const istTime = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
// Next 9:00 am India time after the given moment.
function next9am(d = new Date()) {
  const t = istDate(d);
  const target = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), settings().quiet.to, 0, 0));
  if (t.getUTCHours() >= settings().quiet.to) target.setUTCDate(target.getUTCDate() + 1);
  return new Date(target.getTime() - IST_MS).toISOString();
}
function inQuiet(d = new Date()) {
  const q = settings().quiet; const h = istHour(d);
  return q.from > q.to ? (h >= q.from || h < q.to) : (h >= q.from && h < q.to);
}
const daysBetween = (a, b = new Date()) => Math.floor((new Date(b) - new Date(a)) / 86400000);
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000).toISOString();

// Passwords are stored scrambled (scrypt with a salt), never plain.
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const h = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
function newPassword() {
  const words = ['Gold', 'Ruby', 'Pearl', 'Opal', 'Jade', 'Topaz', 'Coral', 'Amber'];
  return words[crypto.randomInt(words.length)] + crypto.randomInt(1000, 9999) + '!' + crypto.randomBytes(2).toString('hex');
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ---------- job list helpers (from Settings) ----------
function jobList(industry) {
  const s = settings();
  const ind = s.industries[industry || s.default_industry] || Object.values(s.industries)[0];
  const out = [];
  for (const [group, g] of Object.entries(ind.groups)) for (const j of g.jobs) out.push({ group, dept: g.dept, title: j, hidden: s.hidden_jobs.includes(j) });
  return out;
}
function deptOf(title) {
  const s = settings();
  for (const ind of Object.values(s.industries)) for (const g of Object.values(ind.groups)) if (g.jobs.includes(title)) return g.dept;
  return 'Other';
}
function stateOf(city) {
  const name = String(city || '').trim().toLowerCase(); if (!name) return '';
  const c = settings().cities.find((x) => x.name.toLowerCase() === name) || require('./places').PLACES.find((x) => x.name.toLowerCase() === name);
  return c ? c.state : '';
}

// ---------- people ----------
function person(type, id) {
  if (type === 'client') {
    const c = get('SELECT * FROM clients WHERE id=?', id); if (!c) return null;
    return { type, id, name: c.contact || c.company, company: c.company, phone: c.whatsapp, lang: require('./lang').pick(c.language), opted_out: c.opted_out, consent: 1, agency_id: c.agency_id, record: c };
  }
  if (type === 'candidate') {
    const c = get('SELECT * FROM candidates WHERE id=?', id); if (!c) return null;
    return { type, id, name: c.name, phone: c.whatsapp, lang: require('./lang').pick(c.language), opted_out: c.opted_out, consent: c.consent_alerts, agency_id: c.agency_id, record: c };
  }
  if (type === 'user') {
    const u = get('SELECT * FROM users WHERE id=?', id); if (!u) return null;
    return { type, id, name: u.name, phone: u.whatsapp, lang: 'en', opted_out: 0, consent: 1, agency_id: u.agency_id, record: u };
  }
  return null;
}
const actorName = (a) => (a ? a.label || a.name || 'System' : 'System');
// Testing pause (settings.wa_pause): why a WhatsApp to a candidate is held instead of sent, or null to send it.
function waHeld(msg) {
  // Asking a client for a slot, and telling the candidate the time it gives, are started by a recruiter, so they go.
  if (['bbhs_bill_raised', 'bbhs_payment_reminder'].includes(msg.format) && msg.sent_by !== 'Auto') return null; // Accounts pressed Send
  if (msg.format === 'bbhs_contact_prefs' && msg.rule === 'pref1') return null; // asked of one candidate by a recruiter
  if (msg.format === 'bbhs_client_slots' || (msg.format === 'bbhs_interview_scheduled' && msg.iv && (get('SELECT from_ask FROM interviews WHERE id=?', msg.iv) || {}).from_ask)) return null;
  if (msg.person_type === 'client' && (msg.format || ['Auto', 'Bot', 'System'].includes(msg.sent_by)) && !['bbhs_login_code', 'bbhs_team_login'].includes(msg.format)) {
    const c = get('SELECT quiet FROM clients WHERE id=?', msg.person_id); if (c && c.quiet) return 'Held: earlier client, no messages until a new job opening';
  }
  const w = settings().wa_pause || {};
  if (!w.everyone && !(w.candidates && msg.person_type === 'candidate')) return null;
  if (['bbhs_login_code', 'bbhs_team_login'].includes(msg.format)) return null; // people must still be able to log in
  if (!msg.format && !['Auto', 'Bot', 'System'].includes(msg.sent_by)) return null; // typed by a team member
  if ((w.allow || []).map((x) => String(x).replace(/\D/g, '').slice(-10)).includes(String(msg.phone || '').slice(-10))) return null;
  return w.everyone ? 'Held: messages are off' : 'Held: candidate WhatsApp paused for testing';
}

// ---------- WhatsApp records (section 8) ----------
function fillFormat(fmtName, lang, vars) {
  const f = settings().formats[fmtName];
  if (!f) return '';
  const tpl = f[lang] || f.en;
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined && vars[k] !== null && vars[k] !== '' ? String(vars[k]) : m));
}
function windowOpenUntil(ptype, pid) {
  const last = get("SELECT at FROM messages WHERE person_type=? AND person_id=? AND direction='in' ORDER BY at DESC LIMIT 1", ptype, pid);
  if (!last) return null;
  const until = new Date(new Date(last.at).getTime() + 86400000);
  return until > new Date() ? until.toISOString() : null;
}
let dispatcher = null; // set by the CRM bridge (phase 6)
function setDispatcher(fn) { dispatcher = fn; }

// One function for every message. Rules: approved formats only, quiet hours, daily limit,
// never the same reminder twice, opted-out people get no automatic or bulk messages.
function sendWA(o) {
  const s = settings();
  const p = person(o.ptype, o.pid);
  if (!p) return { skipped: 'Person not found' };
  if (p.record && p.record.removed) return { skipped: 'Removed person' };
  let fmt = null; let waOnlyStop = null; // reasons that stop the WhatsApp copy but not the email
  if (o.format) {
    fmt = s.formats[o.format];
    if (!fmt) return { skipped: 'Unknown format' };
    // Switched off in Settings → Message formats: not sent to anyone, by WhatsApp or email.
    if (fmt.off) { if (o.auto || o.bulk) return { skipped: 'Message switched off in Settings' }; throw httpError(400, 'This message is switched off in Settings → Message formats. Switch it on there to send it.'); }
    if (!fmt.approved && !(s.wa_pause || {}).everyone) { if (o.auto) waOnlyStop = 'Format waiting for Meta approval'; else throw httpError(400, 'This format is waiting for Meta approval and cannot be sent.'); }
  }
  if (o.toPhone) p.phone = o.toPhone; // a one-off number, e.g. the code that proves a new number is theirs
  if (!p.phone) waOnlyStop = 'No WhatsApp number';
  if (o.rule) {
    const r = s.auto_rules.find((x) => x.key === o.rule);
    if (r && !r.on) return { skipped: 'Automatic message turned off in Settings' };
  }
  if ((o.auto || o.bulk) && p.opted_out) return { skipped: 'Opted out (STOP)' };
  if (fmt && fmt.type === 'Marketing' && p.type === 'candidate' && !p.consent) return { skipped: 'No consent for job alerts yet' };
  if (o.dedupe && get('SELECT 1 FROM messages WHERE dedupe=?', o.dedupe)) return { skipped: 'Already sent before' };
  // Email copy of the same message, under the same rules (on in Settings, not after STOP, never twice) and the
  // same timing (held to 9 am in quiet hours). Codes and passwords never go by email.
  const email = p.record && p.record.email; let emailed = false;
  if (o.format && !o.secret && !o.noEmailCopy && email && D.ENV.emailCopies !== false) {
    const mailAt = o.sendLater && o.sendLater !== true ? o.sendLater : (o.auto || o.sendLater) && inQuiet() && p.type !== 'user' ? next9am() : null;
    emailed = require('./mailer').configured(); // only counts once email is really set up
    require('./mailer').copyOfWhatsApp({ to: email, personType: p.type, format: o.format, text: fillFormat(o.format, o.lang || p.lang || 'en', { name: p.name, ...(o.vars || {}) }), recordId: p.id, sendAfter: mailAt, dedupe: o.dedupe ? `mail:${o.dedupe}` : null });
  }
  if (waOnlyStop) return { skipped: waOnlyStop, emailed };
  // "Email only" messages skip WhatsApp when the email went; someone without an email still gets WhatsApp.
  if (emailed && o.rule && ruleChannel(s.auto_rules.find((x) => x.key === o.rule)) === 'email') return { skipped: 'Email only (Settings)', emailed };
  if (o.rule && NEVER_WHATSAPP_RULES.includes(o.rule)) return { skipped: 'Daily team message: email only, never WhatsApp', emailed };
  // The daily cap is for reminders and alerts. Messages that follow something the team or client just did
  // (welcome, interview fixed, offer, profiles sent, bill) always go, or an offer could be dropped on a busy day.
  if (o.auto && p.type !== 'user' && !ACTION_RULES.includes(o.rule)) {
    const today = istDay();
    const sentToday = all("SELECT at FROM messages WHERE person_type=? AND person_id=? AND direction='out' AND auto=1", p.type, p.id).filter((m) => istDay(m.at) === today).length;
    if (sentToday >= s.daily_limit) return { skipped: `Daily limit of ${s.daily_limit} reached` };
  }
  if (!o.format && !windowOpenUntil(p.type, p.id)) throw httpError(400, 'Only an approved format can be sent: the 24-hour window is closed.');
  // A format goes in the person's language once it has that text (and Meta has approved it, where we know); else in English.
  const want = o.lang || p.lang || 'en'; const ms = (fmt && fmt.meta_status) || {};
  const lang = !fmt || want === 'en' || (fmt[want] && (!Object.keys(ms).length || ms[want] === 'APPROVED')) ? want : 'en';
  const vars = { name: p.name, ...(o.vars || {}) };
  const text = o.format ? fillFormat(o.format, lang, vars) : o.text;
  let scheduled = null;
  if ((o.auto || o.sendLater) && inQuiet() && p.type !== 'user') scheduled = next9am();
  if (o.sendLater && o.sendLater !== true) scheduled = o.sendLater;
  const id = nextId('WA');
  const msg = {
    id, person_type: p.type, person_id: p.id, phone: p.phone, direction: 'out', format: o.format || null, lang, text,
    buttons: fmt ? fmt.buttons : (o.buttons || []), ap: o.ap || null, jb: o.jb || null, iv: o.iv || null, bl: o.bl || null,
    sent_by: o.auto ? 'Auto' : actorName(o.by), status: scheduled ? 'scheduled' : (s.crm.enabled ? 'sending' : 'would send'),
    read_by_us: 1, auto: o.auto ? 1 : 0, rule: o.rule || null, dedupe: o.dedupe || null, scheduled_at: scheduled, at: now(),
  };
  // Saved history never keeps a password: the text is masked after it is handed to the CRM.
  const realText = msg.text;
  if (o.secret) msg.text = msg.text.split(o.secret).join('••••••••');
  const held = waHeld(msg); if (held) { msg.status = 'held'; msg.error = held; insert('messages', msg); return msg; }
  insert('messages', msg);
  if (!scheduled && dispatcher && s.crm.enabled) dispatcher(msg, realText, vars);
  D.setHealth('last_wa_sent', now());
  return msg;
}

// ---------- alerts (bell) ----------
// The bell alert always; a WhatsApp too when sendTask is set and that kind is switched on in Settings (task_<kind>).
function alertUser(userId, text, recordId, sendTask = true) {
  if (!userId) return;
  insert('alerts', { user_id: userId, text, record_id: recordId || null, read: 0, at: now() });
  if (typeof sendTask === 'string') { const r = settings().auto_rules.find((x) => x.key === `task_${sendTask}`); if (r && !r.on) return; }
  if (sendTask) sendWA({ ptype: 'user', pid: userId, format: 'bbhs_team_task_alert', vars: { task: text, record_id: recordId || '', link: link('team') }, auto: true, rule: 'team_task_alert', dedupe: `task:${userId}:${text}:${recordId}:${istDay()}` });
}
const link = (part, q = '') => `${settings().business.base_url}/${part}${q}`;
function agencyAdmin(agencyId) { return get("SELECT * FROM users WHERE agency_id=? AND level='admin' AND status='On' ORDER BY id LIMIT 1", agencyId); }
function superAdmins() { return all("SELECT * FROM users WHERE level='super' AND status='On'"); }

// ---------- job status (5.2) ----------
function appsOfJob(jobId) { return all('SELECT * FROM applications WHERE job_id=?', jobId); }
function filledCount(apps) { return apps.filter((a) => (a.result === 'open' && a.step === 'Offer accepted') || a.result === 'Hired').length; }
function computeJobStatus(job, apps) {
  if (job.manual === 'Closed') return 'Closed';
  if (job.manual === 'On hold') return 'On hold';
  if (filledCount(apps) >= job.openings) return 'Filled';
  if (!job.jd_approved && apps.length === 0) return 'Draft';
  const open = apps.filter((a) => a.result === 'open');
  if (open.some((a) => a.step === 'Offer made')) return 'Offer stage';
  if (open.some((a) => INTERVIEW_STEPS.includes(a.step))) return 'Interviewing';
  if (open.length) return 'Sourcing';
  return 'Open';
}
function jobStatusReason(job, apps) {
  const st = computeJobStatus(job, apps); const open = apps.filter((a) => a.result === 'open');
  const n = (step) => open.filter((a) => a.step === step).length;
  switch (st) {
    case 'Closed': return `Closed: ${job.manual_reason || 'no reason given'}`;
    case 'On hold': return `Paused: ${job.manual_reason || 'hiring paused'}`;
    case 'Filled': return `${filledCount(apps)} of ${job.openings} seats filled`;
    case 'Draft': return 'Job description not approved yet';
    case 'Offer stage': return `${n('Offer made')} offer(s) made, waiting for the candidate`;
    case 'Interviewing': return `${n('Our interview') + n('Sent to client') + n('Client interview')} candidate(s) in interviews`;
    case 'Sourcing': return `${open.length} candidate(s) being screened`;
    default: return 'Live, nobody in process right now';
  }
}
function recalcJob(jobId, by, note) {
  const job = get('SELECT * FROM jobs WHERE id=?', jobId); if (!job) return null;
  const st = computeJobStatus(job, appsOfJob(jobId));
  if (st !== job.status) {
    update('jobs', jobId, { status: st });
    insert('job_history', { job_id: jobId, at: now(), status: st, by: by || 'Software', note: note || (st === 'Filled' ? 'All seats filled, closes on its own' : '') });
    history(by || 'Software', 'status', jobId, 'status', job.status, st);
    if (job.status === 'Draft' && st !== 'Draft') autoJobAlert(jobId);
  }
  return st;
}

// ---------- matching ----------
function ratingOf(candId) {
  const r = get("SELECT AVG(i.rating) r FROM interviews i JOIN applications a ON a.id=i.app_id WHERE a.candidate_id=? AND i.rating IS NOT NULL", candId);
  return r && r.r ? r.r : null;
}
// ---------- matching a candidate to a job ----------
// Score 0–100 from weighted parts (settings: match.weights). Each part also says why, briefly:
// reasons = what fits (shown to the team, clients and candidates); gaps = what does not (team only).
const WORD_SKIP = new Set(['senior', 'sr', 'junior', 'jr', 'trainee', 'assistant', 'asst', 'head', 'lead', 'the', 'and', 'of', 'for', '&', '-']);
const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !WORD_SKIP.has(w)).map((w) => w.replace(/s$/, ''));
function titleCloseness(a, b) {
  const x = new Set(words(a)); const y = new Set(words(b)); if (!x.size || !y.size) return 0;
  const both = [...x].filter((w) => y.has(w)).length;
  return both / Math.min(x.size, y.size); // "Senior Sales Executive" vs "Sales Executive" = 1
}
function groupOf(title) {
  const t = String(title || '').toLowerCase();
  for (const ind of Object.values(settings().industries)) for (const [g, v] of Object.entries(ind.groups)) if (v.jobs.some((x) => x.toLowerCase() === t)) return g;
  return null;
}
const perMonth = (yearly) => `₹${Math.round(yearly / 12 / 1000)}k/mo`;
function skillHit(js, cs) {
  const n = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const have = cs.map(n);
  return js.filter((k) => { const kk = n(k); return have.some((h) => h === kk || (kk.length > 3 && h.includes(kk)) || (h.length > 3 && kk.includes(h))); });
}
// Where a candidate has worked (asked on the job form when they have experience), and how it lines up with clients.
const BUSINESS_TYPES = ['Wholesaler', 'Manufacturer', 'Retailer'];
const cleanBusiness = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter((x) => BUSINESS_TYPES.includes(x));
// The job-seeker form's experience choices as years (the public form and the team's Create candidate form).
// A candidate's looking status. Not looking, Not interested and Joined elsewhere count as off the market for matching and job alerts.
const LOOKING = ['Actively looking', 'Open to offers', 'Not looking', 'Not interested', 'Not reachable', 'Joined elsewhere', 'Placed'];
const NOT_LOOKING = ['Not looking', 'Not interested', 'Joined elsewhere'];
const EXP_YEARS = { Fresher: 0, '1–3 years': 2, '3–5 years': 4, '5–10 years': 7, '10+ years': 12 };
const JEW_YEARS = { 'No experience': 0, 'Less than 1 year': 0.5, '1–3 years': 2, '3–5 years': 4, '5–10 years': 7, '10+ years': 12 };
const BUSINESS_OF = { 'Showroom B2C': ['Retailer'], 'Manufacturer B2B': ['Manufacturer', 'Wholesaler'], Both: ['Retailer', 'Manufacturer', 'Wholesaler'] };
function matchScore(c, j, rating) {
  const w = settings().match.weights; let score = 0; const reasons = []; const gaps = [];
  const total = Object.values(w).reduce((a, b) => a + Number(b), 0) || 100;
  const part = (k, frac, why, gap) => { score += (Number(w[k]) || 0) * frac; if (why && frac >= 0.5) reasons.push(why); if (gap && frac < 0.5) gaps.push(gap); };
  // Role: same title, a close title, the same field of work, or the same department.
  // Someone remapped to a new role can stay open to the old one: the role that fits this job best counts.
  const jg = groupOf(j.title); const fits = [c.job_wanted, ...(Array.isArray(c.also_roles) ? c.also_roles : [])].filter(Boolean).map((r) => {
    const close = titleCloseness(r, j.title); const cg = groupOf(r);
    if (r.toLowerCase() === String(j.title).toLowerCase()) return [1, `Wants ${j.title}`]; if (close >= 0.99) return [0.9, `Wants ${r}`]; if (close >= 0.5) return [0.75, `Wants ${r} (close)`]; if (cg && cg === jg) return [0.5, `Same field: ${cg}`]; return [0, null];
  }).sort((x, y) => y[0] - x[0]);
  if (fits[0] && fits[0][0]) part('role', fits[0][0], fits[0][1]);
  else if (c.department && c.department === j.department) part('role', 0.4, null, `${j.department} background, other role`);
  else part('role', 0, null, c.job_wanted ? `Wants ${c.job_wanted}` : 'Job wanted not given');
  // Place: the job's city, or a city they will work in; the same state counts a little.
  const cities = [c.city, ...(Array.isArray(c.work_cities) ? c.work_cities : [])].filter(Boolean).map((x) => x.toLowerCase());
  const jcity = String(j.city || '').toLowerCase(); const jstate = stateOf(j.city); const cstate = c.state || stateOf(c.city);
  if (jcity && cities.includes(jcity)) part('city', 1, c.city && c.city.toLowerCase() === jcity ? `Lives in ${j.city}` : `Will work in ${j.city}`);
  else if (jstate && cstate && jstate === cstate) part('city', 0.45, null, `In ${c.city || cstate}, same state`);
  else part('city', 0, null, c.city ? `Based in ${c.city}` : 'City not given');
  // Experience against the job's range (freshers fit jobs that start at 0).
  const e = c.exp_total; const from = j.exp_from ?? 0; const to = j.exp_to ?? 99;
  if (e === null || e === undefined) part('experience', 0.3, null, 'Experience not given');
  else if (e === 0 && from === 0) part('experience', 1, 'Fresher, job takes freshers');
  else if (e >= from && e <= to) part('experience', 1, `${e} yrs experience fits`);
  else if (e > to) part('experience', 0.7, `${e} yrs, more than asked`);
  else if (e >= from - 1) { part('experience', 0.5); gaps.push(`${e} yrs, close to ${from}+`); }
  else part('experience', 0, null, `${e} yrs, needs ${from}+`);
  // Salary: what they expect against the job's top.
  if (!c.exp_salary || !j.sal_to) part('salary', 0.5, null, !c.exp_salary ? 'Expected salary not given' : null);
  else if (c.exp_salary <= j.sal_to) part('salary', 1, `Expects ${perMonth(c.exp_salary)}, in budget`);
  else if (c.exp_salary <= j.sal_to * 1.15) { part('salary', 0.5); gaps.push(`Expects ${perMonth(c.exp_salary)}, a little above`); }
  else part('salary', 0, null, `Expects ${perMonth(c.exp_salary)}, above budget`);
  // Skills: a job skill counts when the candidate has it or something close ("CAD" in "CAD design").
  const js = j.skills || []; const cs = c.skills || [];
  if (!js.length) part('skills', 0.5);
  else { const hit = skillHit(js, cs); part('skills', hit.length / js.length, hit.length ? `Skills: ${hit.slice(0, 3).join(', ')}` : null, hit.length ? null : 'No matching skills'); }
  // Notice period against how soon the job needs someone.
  if (c.notice_days === null || c.notice_days === undefined || j.notice_days === null || j.notice_days === undefined) part('notice', 0.5);
  else if (c.notice_days <= j.notice_days) part('notice', 1, c.notice_days === 0 ? 'Can join at once' : `Joins in ${c.notice_days} days`);
  else if (c.notice_days <= j.notice_days * 2) part('notice', 0.5, null, `Notice ${c.notice_days} days`);
  else part('notice', 0, null, `Notice ${c.notice_days} days`);
  if (c.exp_jewellery >= 1) reasons.push(`${c.exp_jewellery} yrs in jewellery`);
  const kinds = BUSINESS_OF[{ B2B: 'Manufacturer B2B', B2C: 'Showroom B2C', Both: 'Both' }[j.market] || (j.client_id && (get('SELECT business_type FROM clients WHERE id=?', j.client_id) || {}).business_type) || ''] || [];
  const same = (Array.isArray(c.exp_business) ? c.exp_business : []).filter((b) => kinds.includes(b));
  if (same.length) reasons.push(`${same.join(' / ')} experience`);
  if (rating) part('rating', rating / 5, rating >= 4 ? `Rated ${rating.toFixed(1)}/5 in interviews` : null); else part('rating', 0.6);
  let pct = Math.round((score / total) * 100);
  if (NOT_LOOKING.includes(c.looking)) { pct = Math.round(pct * 0.8); gaps.push('Not looking now'); }
  return { score: pct, reasons: reasons.slice(0, 4), gaps: gaps.slice(0, 3) };
}
// Open jobs a candidate fits best (for the candidate's page and the note when they come in).
function jobsFor(c, limit = 5) {
  if (isPlaced(c.id)) return [];
  const placed = new Set(all("SELECT job_id FROM applications WHERE candidate_id=? AND result IN ('open','Hired')", c.id).map((r) => r.job_id));
  const rating = ratingOf(c.id);
  return all("SELECT * FROM jobs WHERE archived=0 AND status IN ('Open','Sourcing','Interviewing','Offer stage')")
    .filter((j) => !placed.has(j.id))
    .map((j) => ({ j, ...matchScore(c, j, rating) }))
    .filter((m) => m.score >= settings().match.show)
    .sort((a, b) => b.score - a.score).slice(0, limit);
}
// Hired through us and still in that job: kept off matching, and any other application closes.
function placedOn(candId) { return get("SELECT id, job_id FROM applications WHERE candidate_id=? AND result='Hired' AND left_date IS NULL ORDER BY joined_at DESC LIMIT 1", candId) || null; }
function isPlaced(candId) { return !!placedOn(candId); }
function closePlacedApps(by = { label: 'System' }) {
  let n = 0;
  for (const a of all("SELECT o.id, h.id hired FROM applications o JOIN applications h ON h.candidate_id=o.candidate_id AND h.result='Hired' AND h.left_date IS NULL WHERE o.result='open'")) { closeApplication(a.id, 'Already hired', by, `Hired through us on ${a.hired}`); n++; }
  return n;
}
function bestMatches(job, limit = 10, forAlert = false) {
  const cands = all('SELECT * FROM candidates WHERE archived=0 AND junk=0 AND merged_into IS NULL AND removed=0');
  const onJob = new Set(all("SELECT candidate_id FROM applications WHERE job_id=? AND result='open'", job.id).map((r) => r.candidate_id));
  return cands
    .filter((c) => !onJob.has(c.id) && !isPlaced(c.id) && (!forAlert || (!NOT_LOOKING.includes(c.looking) && !c.opted_out)))
    .map((c) => ({ c, ...matchScore(c, job, ratingOf(c.id)) }))
    .sort((a, b) => b.score - a.score).slice(0, limit);
}
// Automatic job alert to strong matches when a job goes live (8.5).
function autoJobAlert(jobId) {
  const job = get('SELECT * FROM jobs WHERE id=?', jobId); if (!job) return;
  const strong = settings().match.strong;
  for (const m of bestMatches(job, 30, true).filter((m) => m.score >= strong)) {
    sendWA({ ptype: 'candidate', pid: m.c.id, format: 'bbhs_job_alert', vars: { job: job.title, city: job.city, salary: salaryText(job) }, jb: job.id, auto: true, rule: 'job_alert', dedupe: `alert:${job.id}:${m.c.id}` });
  }
}
const salaryText = (j) => (j.sal_from || j.sal_to ? `${inr((j.sal_from || j.sal_to) / 12)}–${inr((j.sal_to || j.sal_from) / 12)} a month` : 'as per experience');

// ---------- fees and bills ----------
function feeFor(client, agencyId, ctc) {
  const s = settings();
  const type = client && client.fee_type ? client.fee_type : s.fee.type;
  const value = client && client.fee_value !== null && client.fee_value !== undefined && client.fee_type ? client.fee_value : s.fee.value;
  const fee = type === 'fixed' ? Math.round(value) : Math.round((ctc * value) / 100);
  const ag = agencyId ? get('SELECT share_pct FROM agencies WHERE id=?', agencyId) : null;
  const sharePct = ag && ag.share_pct !== null && ag.share_pct !== undefined ? ag.share_pct : s.agency_share_pct;
  const share = Math.floor((fee * sharePct) / 100);
  return { fee, sharePct, share, bb: fee - share, note: type === 'fixed' ? `Fixed ${inr(value)} per hire` : `${value}% of yearly CTC` };
}
function gstFor(clientState, fee) {
  const s = settings();
  if (!s.gst.on) return { cgst: 0, sgst: 0, igst: 0, gst: 0 };
  const g = Math.round((fee * s.gst.rate) / 100);
  if (!clientState || clientState === s.business.state) return { cgst: g / 2, sgst: g / 2, igst: 0, gst: g };
  return { cgst: 0, sgst: 0, igst: g, gst: g };
}
function fyOf(d = new Date()) {
  const t = istDate(d); const y = t.getUTCFullYear() % 100; const m = t.getUTCMonth();
  const start = m >= 3 ? y : y - 1;
  return `${String(start).padStart(2, '0')}-${String(start + 1).padStart(2, '0')}`;
}
function nextBillNo() {
  const fy = fyOf(); const key = `BILL-${fy}`;
  const row = get('SELECT next FROM counters WHERE name=?', key);
  const n = row ? row.next : 1;
  if (row) run('UPDATE counters SET next=? WHERE name=?', n + 1, key); else run('INSERT INTO counters (name,next) VALUES (?,?)', key, n + 1);
  return `${settings().bill_prefix}/${fy}/${String(n).padStart(3, '0')}`;
}
function billPaid(billId) {
  const r = get('SELECT COALESCE(SUM(amount),0) paid, COALESCE(SUM(tds),0) tds FROM payments WHERE bill_id=?', billId);
  const cn = get('SELECT COALESCE(SUM(amount),0) c FROM credit_notes WHERE bill_id=?', billId);
  return { paid: r.paid, tds: r.tds, credit: cn.c };
}
function billView(b) {
  if (!b) return b;
  const p = billPaid(b.id);
  const settled = p.paid + p.tds + p.credit;
  let st = b.status;
  if (b.status === 'Issued') {
    if (b.total <= 0 || settled >= b.total - 0.5) st = 'Paid';
    else if (settled > 0) st = new Date(b.due_date) < new Date() ? 'Overdue' : 'Part paid';
    else st = new Date(b.due_date) < new Date() ? 'Overdue' : 'Due';
  }
  // Billed, Received or Outstanding: the three a bill can stand at once it is raised.
  const stage = ['Draft', 'Cancelled'].includes(st) ? st : st === 'Paid' ? 'Received' : st === 'Part paid' || st === 'Overdue' || b.stage === 'Outstanding' ? 'Outstanding' : 'Billed';
  return { ...b, ...p, balance: Math.max(0, b.total - settled), view_status: st, stage };
}
function refreshBill(billId, by) {
  const b = billView(get('SELECT * FROM bills WHERE id=?', billId));
  if (b.view_status === 'Paid' && b.status !== 'Paid') {
    update('bills', billId, { status: 'Paid', payout_status: b.payout_hold ? 'On hold' : (b.agency_share > 0 ? 'Due' : 'Not due') });
    history(by, 'bill paid', billId, 'status', b.status, 'Paid');
  }
  return billView(get('SELECT * FROM bills WHERE id=?', billId));
}
function createBillForApp(app, by) {
  const made = get("SELECT * FROM bills WHERE app_id=? AND credit_of IS NULL AND status!='Cancelled'", app.id); if (made) return made; // already made when Accounts were asked
  const job = get('SELECT * FROM jobs WHERE id=?', app.job_id);
  const client = get('SELECT * FROM clients WHERE id=?', job.client_id);
  if (client && client.internal) return null; // BrillBrains' own hiring: nobody to bill
  const cand = get('SELECT * FROM candidates WHERE id=?', app.candidate_id);
  const replacementOf = job.replacement_for && !get("SELECT 1 FROM bills WHERE is_replacement=1 AND credit_of IS NULL AND app_id IN (SELECT id FROM applications WHERE job_id=? AND replacement_of=?)", job.id, job.replacement_for) ? job.replacement_for : null;
  const ctc = app.offer_ctc || 0;
  const agencyId = job.agency_id || require('./db').soleAgency(); // no agency on the client: the one active agency shares the fee
  let f = feeFor(client, agencyId, ctc);
  if (replacementOf) f = { fee: 0, share: 0, sharePct: 0, note: `Replacement for ${replacementOf}` };
  const g = gstFor(client.state || stateOf(client.city), f.fee);
  const id = nextId('BL');
  const bill = {
    id, app_id: app.id, client_id: client.id, agency_id: agencyId, bill_no: null, ctc, fee: f.fee, gst: g.gst, cgst: g.cgst, sgst: g.sgst, igst: g.igst,
    total: f.fee + g.gst, fee_note: f.note, status: 'Draft', date: istDay(), due_date: null, is_replacement: replacementOf ? 1 : 0,
    share_pct: f.sharePct, agency_share: f.share, payout_status: 'Not due', created_at: now(),
  };
  insert('bills', bill);
  if (replacementOf) {
    update('applications', app.id, { replacement_of: replacementOf });
    const first = get('SELECT * FROM bills WHERE app_id=? AND credit_of IS NULL', replacementOf);
    if (first && first.payout_hold) { update('bills', first.id, { payout_hold: 0, payout_status: first.status === 'Paid' ? 'Due' : 'Not due' }); history(by, 'payout released', first.id, 'payout_hold', 1, 0); }
  }
  history(actorName(by), 'create', id, null, null, `Bill for ${cand.name} (${app.id})`);
  return bill;
}
// Accounts raise the invoice and send it to the client themselves: o.bill_no is their number, and we send nothing.
function issueBill(billId, by, o = {}) {
  const b = get('SELECT * FROM bills WHERE id=?', billId);
  if (b.status !== 'Draft') throw httpError(400, 'Only a draft bill can be issued.');
  const client = get('SELECT * FROM clients WHERE id=?', b.client_id);
  const days = client.payment_days || settings().payment_days;
  const bill_no = o.bill_no || nextBillNo();
  update('bills', billId, { status: 'Issued', bill_no, issued_at: now(), date: istDay(), due_date: addDays(new Date(), days).slice(0, 10) });
  history(actorName(by), 'issue', billId, 'status', 'Draft', 'Issued');
  const app = get('SELECT * FROM applications WHERE id=?', b.app_id); const cand = get('SELECT * FROM candidates WHERE id=?', app.candidate_id);
  if (b.total > 0 && !o.bill_no) sendWA({ ptype: 'client', pid: b.client_id, format: 'bbhs_bill_raised', vars: { bill_no, candidate: cand.name, amount: inr(b.total), link: upiLink(b.total, bill_no) }, bl: billId, ap: b.app_id, auto: true, rule: 'bill_raised', dedupe: `bill:${billId}` });
  return refreshBill(billId, by);
}
const upiLink = (amt, ref) => `upi://pay?pa=${settings().business.upi_id}&pn=${encodeURIComponent(settings().business.name)}&am=${Math.round(amt)}&tn=${encodeURIComponent(ref || '')}`;

// ---------- applications ----------
function appHist(appId, step, by, note, kind = 'step') {
  insert('app_history', { app_id: appId, at: now(), step, by: actorName(by), by_id: by && by.uid ? by.uid : null, note: note || '', kind });
}
function createApplication(candId, jobId, by, source, note, ad) {
  const cand = get('SELECT * FROM candidates WHERE id=?', candId); const job = get('SELECT * FROM jobs WHERE id=?', jobId);
  if (!cand || !job) throw httpError(404, 'Candidate or job opening not found');
  if (get("SELECT 1 FROM applications WHERE candidate_id=? AND job_id=? AND result='open'", candId, jobId)) throw httpError(400, `${cand.name} already has an open application on ${jobId}.`);
  const id = nextId('AP');
  insert('applications', { id, candidate_id: candId, job_id: jobId, step: 'Applied', result: 'open', owner_id: by && by.uid ? by.uid : job.recruiter_id, source: source || cand.source, ...adCols(ad), step_since: now(), created_by: by && by.uid ? by.uid : null, created_at: now(), checklist: {}, joining_docs: [] });
  appHist(id, 'Applied', by, note || 'Added to job');
  history(actorName(by), 'create', id, null, null, `${cand.name} on ${jobId}`, [candId, jobId]);
  recalcJob(jobId, actorName(by), `${id} added`);
  const hired = placedOn(candId); if (hired) closeApplication(id, 'Already hired', by, `Hired through us on ${hired.id}`);
  return get('SELECT * FROM applications WHERE id=?', id);
}
function moveStep(appId, step, by, note) {
  const app = get('SELECT * FROM applications WHERE id=?', appId);
  if (!app) throw httpError(404, 'Application not found');
  if (!STEPS.includes(step)) throw httpError(400, 'Unknown step');
  if (app.result !== 'open' && step !== 'Joined') throw httpError(400, 'This application is closed. Reopen it first.');
  if (step === app.step) return app;
  // An offer always has its salary and joining date: "Offer made" comes from recording the offer, not a bare step change.
  if (step === 'Offer made' && !app.offer_ctc) throw httpError(400, 'Record the offer first: the yearly CTC and the joining date (Record offer).');
  // A job has a number of seats (openings): accepting an offer or joining takes one, and no more than that.
  if ((step === 'Offer accepted' || step === 'Joined') && app.step !== 'Offer accepted') {
    const j0 = get('SELECT * FROM jobs WHERE id=?', app.job_id);
    const taken = filledCount(appsOfJob(app.job_id).filter((a) => a.id !== appId));
    if (taken >= j0.openings) throw httpError(400, `All ${j0.openings} seat${j0.openings === 1 ? '' : 's'} on ${j0.id} are already taken. Add a seat to the job first (Reopen, or the client's "I need this role again").`);
  }
  const patch = { step, step_since: now() };
  if (step === 'Joined') { patch.result = 'Hired'; patch.joined_at = now(); if (!app.joining_date) patch.joining_date = istDay(); }
  update('applications', appId, patch);
  appHist(appId, step, by, note);
  history(actorName(by), 'step', appId, 'step', app.step, step);
  const job = get('SELECT * FROM jobs WHERE id=?', app.job_id);
  if (step === 'Sent to client') {
    try { require('./flow').clientCvFor(app.candidate_id, by); } catch (e) { console.error('Client CV', appId, e.message); }
    const count = get("SELECT COUNT(*) c FROM applications WHERE job_id=? AND step='Sent to client' AND result='open'", job.id).c;
    sendWA({ ptype: 'client', pid: job.client_id, format: 'bbhs_shortlist_ready', vars: { count, job: job.title, job_id: job.id, link: link('my-account') }, jb: job.id, ap: appId, auto: true, rule: 'shortlist_ready', dedupe: `shortlist:${appId}` });
  }
  if (step === 'Offer accepted') {
    const owner = app.owner_id || job.recruiter_id; alertUser(owner, `Offer accepted on ${appId}`, appId, false);
  }
  if (step === 'Joined') {
    createBillForApp({ ...app, ...patch }, by);
    update('candidates', app.candidate_id, { looking: 'Placed' });
    // They have a job now: their other applications still in process close, and those recruiters are told.
    for (const o of all("SELECT * FROM applications WHERE candidate_id=? AND id<>? AND result='open'", app.candidate_id, appId)) {
      closeApplication(o.id, 'Joined elsewhere', by, `Joined ${job.title} (${job.id}) through ${appId}`);
      const oj = get('SELECT * FROM jobs WHERE id=?', o.job_id); alertUser(o.owner_id || oj.recruiter_id, `${o.id} closed: the candidate joined ${job.id} elsewhere`, o.id, false);
    }
  }
  if (recalcJob(app.job_id, actorName(by), `${appId} → ${step}`) === 'Filled') closeRestOfFilledJob(app.job_id, by);
  return get('SELECT * FROM applications WHERE id=?', appId);
}
// All seats taken: everyone else still in process on that job closes (they stay in the resume bank for other jobs).
function closeRestOfFilledJob(jobId, by) {
  const job = get('SELECT * FROM jobs WHERE id=?', jobId);
  for (const a of all("SELECT * FROM applications WHERE job_id=? AND result='open' AND step NOT IN ('Offer accepted','Joined')", jobId)) closeApplication(a.id, 'Position filled', by, `All ${job.openings} seat${job.openings === 1 ? '' : 's'} on ${jobId} are taken`);
}
function closeApplication(appId, reason, by, note) {
  const app = get('SELECT * FROM applications WHERE id=?', appId);
  if (!app) throw httpError(404, 'Application not found');
  if (!settings().closing_reasons.includes(reason) && !SYSTEM_CLOSE.includes(reason)) throw httpError(400, 'Pick a closing reason');
  update('applications', appId, { result: reason });
  appHist(appId, app.step, by, `Closed: ${reason}${note ? ' — ' + note : ''}`, 'close');
  history(actorName(by), 'close', appId, 'result', app.result, reason);
  D.run(`UPDATE slot_asks SET status='Closed' WHERE app_id=? AND status IN (${OPEN_ASK})`, appId);
  // Asked Accounts for an invoice, then the offer fell through: the unissued draft goes.
  if (reason !== 'Did not join') for (const b of all("SELECT * FROM bills WHERE app_id=? AND status='Draft' AND credit_of IS NULL", appId)) { update('bills', b.id, { status: 'Cancelled', payout_status: 'Not due' }); history(actorName(by), 'cancel', b.id, 'status', b.status, 'Cancelled'); }
  if (reason === 'Did not join') {
    for (const b of all("SELECT * FROM bills WHERE app_id=? AND status!='Cancelled' AND credit_of IS NULL", appId)) {
      if (b.status !== 'Draft') insert('credit_notes', { bill_id: b.id, amount: b.total, reason: 'Did not join', by: actorName(by), at: now() });
      update('bills', b.id, { status: 'Cancelled', payout_status: 'Not due' });
      history(actorName(by), 'cancel', b.id, 'status', b.status, 'Cancelled');
    }
  }
  const before = get('SELECT status FROM jobs WHERE id=?', app.job_id).status;
  const st = recalcJob(app.job_id, actorName(by), reason === 'Did not join' ? `${appId} did not join, seat opens again` : `${appId} closed: ${reason}`);
  return { app: get('SELECT * FROM applications WHERE id=?', appId), jobBefore: before, jobAfter: st };
}
// ---------- role matching (ad names and "Job you want" -> open jobs) ----------
// Words that say nothing about the role ("Hiring_Leads_..._Adset_2510 - Copy"), and short forms people write.
const ROLE_STOP = new Set(['hiring', 'hire', 'leads', 'lead', 'adset', 'ad', 'ads', 'set', 'copy', 'campaign', 'new', 'job', 'jobs', 'vacancy', 'vacancies', 'opening', 'openings', 'recruitment', 'the', 'for', 'and', 'of', 'in', 'at', 'to', 'a', 'an', 'we', 'are', 'urgent', 'required', 'wanted', 'india', 'meta', 'fb', 'ig', 'insta', 'instagram', 'facebook', 'linkedin', 'post', 'creative', 'video', 'image', 'reel', 'carousel', 'static', 'female', 'male', 'role', 'position']);
const ROLE_SYN = { exec: 'executive', exe: 'executive', ex: 'executive', exective: 'executive', excutive: 'executive', sr: 'senior', jr: 'junior', mgr: 'manager', merchandizer: 'merchandiser', merchandier: 'merchandiser', telecalling: 'telecaller', telesales: 'telecaller', tele: 'telecaller', caller: 'telecaller', designers: 'designer', mis: 'mis' };
const roleTokens = (t) => String(t || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !/^\d+$/.test(w) && !/^v\d+$/.test(w)).map((w) => ROLE_SYN[w] || w).filter((w) => !ROLE_STOP.has(w));
const OPEN_STATUSES = ['Open', 'Sourcing', 'Interviewing', 'Offer stage'];
// The open jobs a role name points to. Every role word of the name is in the job title ("Sales Executive" ->
// "Senior Sales Executive"), or a job title of two words or more is wholly in the name. A city named in the text
// keeps only the jobs in that city. sameCity: only jobs in these cities (the candidate's).
function jobsForRole(text, opt = {}) {
  const words = roleTokens(text); if (!words.length) return [];
  const cityWords = new Map(); for (const c of settings().cities || []) cityWords.set(String(c.name || c).toLowerCase(), String(c.name || c));
  const said = [...cityWords.keys()].filter((c) => (' ' + words.join(' ') + ' ').includes(` ${c} `));
  const cityToks = new Set(said.flatMap((c) => c.split(' ')));
  const jobs = all('SELECT * FROM jobs WHERE archived=0 AND is_sample=0').filter((j) => OPEN_STATUSES.includes(computeJobStatus(j, appsOfJob(j.id))));
  // Words no job title uses ("BBHS", "PD", a date code) say nothing about the role and are left out.
  const known = new Set([...jobs.map((j) => j.title), ...jobList().map((x) => x.title)].flatMap((t) => roleTokens(t)));
  const role = words.filter((w) => !cityToks.has(w) && known.has(w)); if (!role.length) return [];
  return jobs.filter((j) => {
    const jt = roleTokens(j.title); if (!jt.length) return false;
    const fits = role.every((w) => jt.includes(w)) || (jt.length >= 2 && jt.every((w) => role.includes(w)));
    if (!fits) return false;
    const city = String(j.city || '').toLowerCase();
    if (said.length && !said.includes(city)) return false;
    if (opt.cities && opt.cities.length && !opt.cities.map((x) => String(x).toLowerCase()).includes(city)) return false;
    return true;
  });
}
// The open jobs for a person or a form: the ad set, then the ad, then the campaign name (the first that names a role
// with open jobs), and otherwise the job they asked for.
function jobsForPerson(p, opt = {}) {
  for (const t of [p.ad_set, p.ad_name, p.ad_campaign]) { if (!t) continue; const hit = jobsForRole(t, opt); if (hit.length) return { jobs: hit, by: `ad "${t}"` }; }
  if (p.job_wanted) { const hit = jobsForRole(p.job_wanted, opt); if (hit.length) return { jobs: hit, by: `job wanted "${p.job_wanted}"` }; }
  return { jobs: [], by: '' };
}
// Everyone who came from an ad or a job platform gets an application: candidates with no open application (from the last
// 60 days) go onto the open jobs their ad (or the job they asked for) points to, skipping jobs they were already on.
// No job found: the candidate is flagged so the team picks the job.
// A job open again (a seat added, a replacement, reopened): applications that were closed only because the job
// filled or closed come back, as they were. Not for anyone hired through us, or already open on that job again.
function reopenRefilled(by = { label: 'System' }, o = {}) {
  let n = 0; const out = [];
  for (const j of all("SELECT * FROM jobs WHERE archived=0 AND is_sample=0")) {
    if (!OPEN_STATUSES.includes(computeJobStatus(j, appsOfJob(j.id)))) continue;
    for (const a of all("SELECT * FROM applications WHERE job_id=? AND result IN ('Position filled','Job closed') AND (? IS NULL OR candidate_id=?) ORDER BY created_at", j.id, o.only || null, o.only || null)) {
      if (isPlaced(a.candidate_id)) continue;
      if (get("SELECT 1 FROM applications WHERE candidate_id=? AND job_id=? AND result='open'", a.candidate_id, j.id)) continue;
      if (!OPEN_STATUSES.includes(computeJobStatus(j, appsOfJob(j.id)))) break; // the seats ran out again
      out.push({ app: a.id, job: j.id, was: a.result });
      if (o.dry) continue;
      try { reopenApplication(a.id, by); appHist(a.id, a.step, by, `Reopened: ${j.id} has open seats again (it was closed as ${a.result})`, 'reopen'); n++; } catch { /* seats or a duplicate */ }
    }
  }
  return o.dry ? out : n;
}
function adPlanFor(candId) { const r = openAdApplications({ label: 'System' }, { dry: true, report: true, only: candId, days: 365 }); return r.rows[0] || null; }
function openAdApplications(by = { label: 'System' }, o = {}) {
  const since = new Date(Date.now() - (o.days || 90) * 86400000).toISOString(); let made = 0; const report = [];
  // From an ad (ad names on the link) or from Instagram or LinkedIn (the source), with no open application. People
  // brought in from Google Drive (resumes and the Naukri exports) are candidates only: never an application here.
  const AD_SOURCE = /instagram|linkedin/i; const DRIVE = /^google drive/i;
  const rows = all(`SELECT c.* FROM candidates c WHERE c.removed=0 AND IFNULL(c.junk,0)=0 AND c.merged_into IS NULL AND IFNULL(c.last_updated, c.created_at) > ? AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id=c.id AND a.result='open') ORDER BY c.created_at DESC`, since)
    .filter((c) => (!o.only || c.id === o.only) && !DRIVE.test(c.source || '') && (c.ad_set || c.ad_name || c.ad_campaign || AD_SOURCE.test(c.source || '')));
  for (const c of rows) {
    const line = { id: c.id, name: c.name, source: c.source, ad: [c.ad_campaign, c.ad_set, c.ad_name].filter(Boolean).join(' › '), job_wanted: c.job_wanted, jobs: [], result: '' };
    report.push(line);
    const hired = placedOn(c.id); if (hired) { line.result = `Hired on ${hired.id}`; continue; }
    const had = new Set(all('SELECT job_id FROM applications WHERE candidate_id=?', c.id).map((r) => r.job_id));
    const m = jobsForPerson(c); const jobs = m.jobs.filter((x) => !had.has(x.id)).slice(0, 3);
    if (!jobs.length) {
      const back = m.jobs.length ? all(`SELECT id, job_id, result FROM applications WHERE candidate_id=? AND result IN ('Position filled','Job closed') AND job_id IN (${m.jobs.map(() => '?').join(',')})`, c.id, ...m.jobs.map((x) => x.id)) : [];
      line.result = back.length ? `${back.map((x) => x.id).join(', ')} was closed as ${back[0].result}: it reopens now that ${back[0].job_id} has open seats` : m.jobs.length ? `Already applied to ${m.jobs.map((x) => x.id).join(', ')} (closed)` : 'No open job matches the ad or the job they want';
      if (back.length) line.jobs = back.map((x) => x.job_id);
      if (!o.dry && !m.jobs.length && !c.needs_check) update('candidates', c.id, { needs_check: 'From an ad: pick the job' });
      continue;
    }
    line.jobs = jobs.map((x) => `${x.id} ${x.title}`); line.by = m.by;
    if (o.dry) { line.result = `Will open on ${line.jobs.join(', ')}`; continue; }
    const done = [];
    for (const x of jobs) { try { createApplication(c.id, x.id, by, c.source, `Applied from an ad (matched by ${m.by})`, { campaign: c.ad_campaign, adset: c.ad_set, ad: c.ad_name }); made++; done.push(x.id); } catch (e) { line.error = e.message; } }
    line.result = done.length ? `Opened on ${done.join(', ')}` : `Could not open: ${line.error}`;
    if (done.length && c.needs_check === 'From an ad: pick the job') update('candidates', c.id, { needs_check: null });
  }
  return o.report ? { made, rows: report } : made;
}
function screenApplication(appId, verdict, by, note) {
  if (!SCREEN.includes(verdict)) throw httpError(400, 'Pick a screening decision');
  let app = get('SELECT * FROM applications WHERE id=?', appId); if (!app) throw httpError(404, 'Application not found');
  const closeAs = { 'Requirement not met': 'Requirement not met', Rejected: 'Rejected at screening' }[verdict];
  update('applications', appId, { screen: verdict, screen_note: note || null, screen_at: now(), screen_by: actorName(by) });
  appHist(appId, app.step, by, `Screening: ${verdict}${note ? ` — ${note}` : ''}`, 'screen');
  if (closeAs) { if (app.result === 'open') closeApplication(appId, closeAs, by, note); return get('SELECT * FROM applications WHERE id=?', appId); }
  if (app.result !== 'open') { if (!['Requirement not met', 'Rejected at screening'].includes(app.result)) throw httpError(400, `This application is closed (${app.result}). Reopen it first.`); reopenApplication(appId, by); app = get('SELECT * FROM applications WHERE id=?', appId); }
  const target = verdict === 'Accepted' ? 'Our interview' : 'Screening';
  if (stepIdx(app.step) < stepIdx(target)) moveStep(appId, target, by, `Screening: ${verdict}`);
  if (verdict === 'Accepted') phoneTask(appId);
  return get('SELECT * FROM applications WHERE id=?', appId);
}
// Screened in: the owner gets a call task for the telephonic round at the candidate's best time, and when we do not
// know that time the candidate is asked for it on WhatsApp. Their answer moves the task to that time.
const PHONE_TASK = 'Telephonic round:';
function phoneTask(appId) {
  const a = get('SELECT * FROM applications WHERE id=?', appId); const c = get('SELECT * FROM candidates WHERE id=?', a.candidate_id); const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
  const owner = a.owner_id || job.recruiter_id; if (!owner || !c) return;
  if (get(`SELECT 1 FROM followups WHERE record_id=? AND done=0 AND note LIKE '${PHONE_TASK}%'`, appId)) return;
  const known = !!(c.pref_time || c.pref_days);
  insert('followups', { record_id: appId, at: (known && nextPreferred(c)) || now(), note: `${PHONE_TASK} call ${c.name} for ${job.title}. ${known ? `Best time: ${prefNote(c)}.` : 'Asked on WhatsApp for their best time.'}`, for_user: owner, done: 0, created_by: owner });
  if (!known && c.whatsapp) { try { sendWA({ ptype: 'candidate', pid: c.id, format: 'bbhs_contact_prefs', vars: {}, rule: 'pref1_screen', auto: true, ap: appId, dedupe: `prefs:${c.id}:${appId}`, noEmailCopy: true }); } catch (e) { /* the task still stands */ } }
}
function phoneTaskTimes(candId) {
  const c = get('SELECT * FROM candidates WHERE id=?', candId);
  for (const f of all(`SELECT f.* FROM followups f JOIN applications a ON a.id=f.record_id WHERE a.candidate_id=? AND f.done=0 AND f.note LIKE '${PHONE_TASK}%'`, candId)) {
    update('followups', f.id, { at: nextPreferred(c) || now(), note: f.note.replace(/ (Best time:.*|Asked on WhatsApp for their best time\.)$/, ` Best time: ${prefNote(c) || 'any time'}.`), alerted: 0 });
    alertUser(f.for_user, `${c.name} gave their best time to call: ${prefNote(c) || 'any time'}`, f.record_id, false);
  }
}
function reopenApplication(appId, by) {
  const app = get('SELECT * FROM applications WHERE id=?', appId);
  if (app.result === 'open') return app;
  if (get("SELECT 1 FROM applications WHERE candidate_id=? AND job_id=? AND result='open' AND id!=?", app.candidate_id, app.job_id, appId)) throw httpError(400, 'There is already an open application for this candidate on this job.');
  const step = app.result === 'Hired' ? 'Offer accepted' : app.step;
  if (step === 'Offer accepted' || step === 'Joined') {
    const j0 = get('SELECT * FROM jobs WHERE id=?', app.job_id);
    if (filledCount(appsOfJob(app.job_id).filter((a) => a.id !== appId)) >= j0.openings) throw httpError(400, `All seats on ${j0.id} are taken. Add a seat to the job first.`);
  }
  update('applications', appId, { result: 'open', step, step_since: now() });
  appHist(appId, step, by, 'Reopened', 'reopen');
  history(actorName(by), 'reopen', appId, 'result', app.result, 'open');
  recalcJob(app.job_id, actorName(by), `${appId} reopened`);
  return get('SELECT * FROM applications WHERE id=?', appId);
}

// ---------- interviews ----------
function scheduleInterview(appId, o, by) {
  const app = get('SELECT * FROM applications WHERE id=?', appId);
  if (!app || app.result !== 'open') throw httpError(400, 'Interviews can only be set on an open application.');
  if (!o.at) throw httpError(400, 'Pick a date and time', 'at');
  // Our usual rounds: 1) telephonic (our team), 2) virtual (our team, sometimes with the client), 3) in person with the client.
  const mode = IV_MODES[o.mode] ? o.mode : (o.round === 'client' ? 'in_person' : null);
  const round = mode === 'in_person' || (!mode && o.round === 'client') ? 'client' : 'ours';
  const clientJoins = mode === 'video' && (o.client_joins === true || o.client_joins === '1' || o.client_joins === 1 || o.client_joins === 'on') ? 1 : 0;
  const id = nextId('IV');
  const place = mode === 'phone' ? 'Phone call' : mode === 'video' ? (o.place || 'Video call') : (o.place || 'Office');
  insert('interviews', { id, app_id: appId, round, mode, link: mode === 'video' ? String(o.link || '').trim() : '', client_joins: clientJoins, name: o.name || (mode ? IV_MODES[mode] : (round === 'ours' ? 'Round 1' : 'Client round')), at: new Date(o.at).toISOString(), place, interviewer: o.interviewer || '', status: 'Scheduled', qa: [], confirmed: 0, created_by: by && by.uid, created_at: now() });
  history(actorName(by), 'create', id, null, null, `${round} interview on ${appId}`);
  if (o.from_ask) update('interviews', id, { from_ask: o.from_ask });
  if (o.round_key) update('interviews', id, { round_key: String(o.round_key) });
  if (mode) D.run('DELETE FROM round_skips WHERE app_id=? AND mode=?', appId, o.round_key || mode); // booked after all: "Not needed" no longer stands
  if (round === 'client') D.run(`UPDATE slot_asks SET status='Scheduled', iv_id=? WHERE app_id=? AND status IN (${OPEN_ASK})`, id, appId);
  const target = round === 'ours' ? 'Our interview' : 'Client interview';
  if (stepIdx(app.step) < stepIdx(target)) moveStep(appId, target, by, `${id} scheduled`);
  else appHist(appId, app.step, by, `${id} scheduled`, 'interview');
  const job = get('SELECT * FROM jobs WHERE id=?', app.job_id);
  const iv = get('SELECT * FROM interviews WHERE id=?', id);
  if (!o.now) sendWA({ ptype: 'candidate', pid: app.candidate_id, format: 'bbhs_interview_scheduled', vars: ivVars(iv, job), ap: appId, jb: job.id, iv: id, auto: true, rule: 'interview_scheduled', dedupe: `ivs:${id}:${iv.at}` });
  recalcJob(job.id, actorName(by));
  return iv;
}
// Sections of the team. Everyone outside Recruitment who is a sub admin gets the hiring-channels-only login.
const TEAMS = ['Recruitment', 'Accounts', 'Social media & marketing', 'Tech'];
const IV_MODES = { phone: 'Telephonic round', video: 'Virtual round', in_person: 'Final round (in person)' };
function ivVars(iv, job) {
  return { round: iv.mode === 'phone' ? 'telephonic interview' : iv.mode === 'video' ? (iv.client_joins ? 'video interview with the client' : 'video interview') : iv.round === 'ours' ? 'interview' : 'interview with the client', job: job.title, date: istFmt(iv.at, false), time: istTime(iv.at), place: iv.place };
}
// Result of an interview (pop-up). Returns what happened next so the screen can say it.
function recordInterview(ivId, o, by) {
  const iv = get('SELECT * FROM interviews WHERE id=?', ivId);
  if (!iv) throw httpError(404, 'Interview not found');
  if (!o.status) throw httpError(400, 'Say what happened', 'status');
  if (!o.remark || !String(o.remark).trim()) throw httpError(400, 'A remark is required', 'remark');
  if (iv.mode === 'phone' && o.status === 'Completed') D.run(`UPDATE followups SET done=1 WHERE record_id=? AND done=0 AND note LIKE '${PHONE_TASK}%'`, iv.app_id); // the call task is done
  if (o.status === 'Completed' && o.result === 'Move ahead' && o.next && !String(o.skip_reason || '').trim()) { // asked before anything is saved
    const appNow = get('SELECT * FROM applications WHERE id=?', iv.app_id); const rows = roundsOf(appNow).filter((r) => !r.interview_ids.includes(ivId)); const at = rows.findIndex((r) => r.key === o.next);
    const left = o.next === 'client' ? rows.filter((r) => r.status === 'To do' && r.mode !== 'in_person') : rows.slice(0, Math.max(0, at)).filter((r) => r.status === 'To do');
    if (left.length) throw httpError(400, `Give the reason for skipping: ${left.map((r) => r.name).join(', ')}`, 'skip_reason');
  }
  const patch = { status: o.status, remark: o.remark, qa: o.qa || iv.qa || [], rating: o.rating ? Number(o.rating) : null };
  if (o.status === 'Rescheduled') {
    if (!o.new_at) throw httpError(400, 'Pick the new time', 'new_at');
    patch.at = new Date(o.new_at).toISOString(); patch.confirmed = 0; patch.result = null;
  }
  if (o.status === 'Completed') {
    if (!o.result) throw httpError(400, 'Pick a result', 'result');
    patch.result = o.result; patch.completed_by = by && by.uid ? by.uid : null; patch.completed_at = now();
    // The feedback form: each point Strong / OK / Weak / Not relevant, with what was good and what worried.
    if (o.feedback && typeof o.feedback === 'object') {
      const marks = ['Strong', 'OK', 'Weak', 'N/A']; const points = Object.fromEntries(Object.entries(o.feedback.points || {}).filter(([k, v]) => k && marks.includes(v)).slice(0, 40));
      patch.iv_feedback = { points, liked: String(o.feedback.liked || '').trim().slice(0, 1500), concerns: String(o.feedback.concerns || '').trim().slice(0, 1500) };
      // Every round's feedback (ours, and the client's) counts as the candidate's evaluation, so the score stays up to date.
      if (Object.values(points).some((v) => v !== 'N/A')) { const ap = get('SELECT candidate_id FROM applications WHERE id=?', iv.app_id); insert('evaluations', { candidate_id: ap.candidate_id, app_id: iv.app_id, scores: points, note: `${iv.round === 'client' ? 'Client said, ' : ''}${iv.name}: ${String(o.remark || '').trim()}`, by: actorName(by), at: now() }); }
    }
  }
  update('interviews', ivId, patch);
  history(actorName(by), 'interview result', ivId, 'status', iv.status, `${o.status}${o.result ? ' / ' + o.result : ''}`);
  const app = get('SELECT * FROM applications WHERE id=?', iv.app_id);
  let next = 'Saved';
  if (o.status === 'Completed' && app.result === 'open') {
    if (iv.round === 'ours') {
      if (o.result === 'Move ahead' && o.next) {
        appHist(app.id, app.step, by, `${ivId} cleared: ${o.remark}`, 'interview');
        if (o.next === 'client') { passRounds(app.id, 'Sent to client', o.skip_reason, by); if (stepIdx(app.step) < stepIdx('Sent to client')) moveStep(app.id, 'Sent to client', by, `${ivId}: ${o.remark}`); next = `${app.id} moved to Sent to client`; }
        else { const rows = roundsOf(app); const at = rows.findIndex((r) => r.key === o.next); if (at < 0) throw httpError(400, 'Pick where next'); skipRounds(app, rows.slice(0, at).filter((r) => r.status === 'To do'), o.skip_reason, by); next = `SCHEDULE:${o.next}`; }
      } else if (o.result === 'Move ahead' && iv.mode === 'phone') { appHist(app.id, app.step, by, `${ivId} (telephonic) cleared: ${o.remark}`, 'interview'); next = 'Schedule the virtual round'; }
      else if (o.result === 'Move ahead') { moveStep(app.id, 'Sent to client', by, `${ivId}: ${o.remark}`); next = `${app.id} moved to Sent to client`; }
      else if (o.result === 'Not selected') { const why = iv.mode === 'phone' ? 'Rejected at telephonic round' : iv.mode === 'video' ? 'Rejected at virtual round' : 'Not suitable'; closeApplication(app.id, why, by, `${ivId}: ${o.remark}`); next = `${app.id} closed (${why})`; }
      else if (o.result === 'On hold') { update('applications', app.id, { on_hold: 1, hold_reason: o.remark }); appHist(app.id, app.step, by, `On hold after ${ivId}`, 'hold'); next = `${app.id} put on hold`; }
    } else {
      if (o.result === 'Selected') next = 'OPEN_OFFER';
      else if (o.result === 'Not selected') { closeApplication(app.id, 'Client rejected', by, `${ivId}: ${o.remark}`); next = `${app.id} closed (Client rejected)`; }
      else if (o.result === 'On hold') { update('applications', app.id, { on_hold: 1, hold_reason: o.remark }); next = `${app.id} put on hold`; }
      else next = 'Schedule the next round';
      appHist(app.id, app.step, by, `${ivId} result: ${o.result}`, 'interview');
    }
  } else appHist(app.id, app.step, by, `${ivId}: ${o.status}`, 'interview');
  // The client has met our candidate: ask them, once for this job, to rate the recruiter (super admins read it).
  if (o.status === 'Completed' && iv.round !== 'ours') { try { require('./care').askClientReview(app.job_id); } catch (e) { console.error('client review ask', e.message); } }
  return { iv: get('SELECT * FROM interviews WHERE id=?', ivId), next };
}
function interviewView(iv) {
  if (!iv) return iv;
  const pending = ['Scheduled', 'Rescheduled'].includes(iv.status) && new Date(iv.at) < new Date();
  return { ...iv, view_status: pending ? 'Result pending' : iv.status, mode_label: IV_MODES[iv.mode] || (iv.round === 'ours' ? 'Our interview' : 'Client interview'),
    notes: all('SELECT id, author, author_kind, text, at FROM iv_notes WHERE iv_id=? ORDER BY at', iv.id) };
}
// Interviews the client takes part in: the in-person (client) rounds and any virtual round they join.
const clientSeesIv = (iv) => iv.round === 'client' || !!iv.client_joins;
// A note on one interview, by our team or by the client. Shown wherever the candidate is shown, except to the candidate.
function addIvNote(ivId, text, author, kind) {
  const iv = get('SELECT * FROM interviews WHERE id=?', ivId); if (!iv) throw httpError(404, 'Interview not found');
  const t = String(text || '').trim(); if (!t) throw httpError(400, 'Write the note', 'text');
  const app = get('SELECT candidate_id FROM applications WHERE id=?', iv.app_id) || {};
  insert('iv_notes', { iv_id: iv.id, app_id: iv.app_id, candidate_id: app.candidate_id, author, author_kind: kind, text: t.slice(0, 2000), at: now() });
  appHist(iv.app_id, (get('SELECT step FROM applications WHERE id=?', iv.app_id) || {}).step, { label: author }, `Note on ${iv.id}: ${t.slice(0, 140)}`, 'note');
  return { ok: true };
}
// Phone calls to candidates (the telephonic round and every follow-up): who called, when, what happened.
const CALL_OUTCOMES = ['Connected', 'No answer', 'Busy', 'Call back later', 'Switched off', 'Wrong number', 'Not interested'];
// Who the call was with, and which client and application it counts towards: this is the record of work done.
function callRow(o) {
  const app = o.app_id ? get('SELECT * FROM applications WHERE id=?', o.app_id) : null; const job = app ? get('SELECT client_id FROM jobs WHERE id=?', app.job_id) : null;
  const party = o.party === 'client' || (o.client_id && !o.candidate_id) ? 'client' : 'candidate';
  const candidate_id = o.candidate_id || (app ? app.candidate_id : null) || null; const client_id = o.client_id || (job ? job.client_id : null) || null;
  if (party === 'candidate' && !get('SELECT 1 FROM candidates WHERE id=?', candidate_id)) throw httpError(404, 'Candidate not found');
  if (party === 'client' && !get('SELECT 1 FROM clients WHERE id=?', client_id)) throw httpError(404, 'Client not found');
  return { party, candidate_id, client_id, app_id: app ? app.id : null };
}
function startCall(o, by) {
  const open = openCall(by.uid); if (open) throw httpError(409, `Log your call with ${open.who} first.`);
  const r = callRow(o); insert('calls', { ...r, user_id: by.uid, by: actorName(by), at: now(), outcome: '', status: 'Open' });
  return openCall(by.uid);
}
const callWho = (k) => (k.party === 'client' ? (get('SELECT company FROM clients WHERE id=?', k.client_id) || {}).company : (get('SELECT name FROM candidates WHERE id=?', k.candidate_id) || {}).name) || 'this person';
function openCall(userId) { const k = get("SELECT * FROM calls WHERE user_id=? AND status='Open' ORDER BY id DESC LIMIT 1", userId); return k ? { ...k, who: callWho(k) } : null; }
function logCall(o, by) {
  if (!CALL_OUTCOMES.includes(o.outcome)) throw httpError(400, 'Pick what happened on the call', 'outcome');
  const topics = [...new Set((Array.isArray(o.topics) ? o.topics : []).map((x) => String(x).trim()).filter(Boolean))]; if (!topics.length) throw httpError(400, 'Pick at least one topic', 'topics');
  const note = String(o.note || '').trim(); if (!note) throw httpError(400, 'Write the summary of the call', 'note');
  const minutes = o.minutes === '' || o.minutes == null ? null : Math.max(0, Math.min(600, Number(o.minutes) || 0));
  // When the call happened (a call logged later keeps its real date); never in the future.
  const when = o.at && !Number.isNaN(Date.parse(o.at)) && Date.parse(o.at) <= Date.now() + 300000 ? new Date(o.at).toISOString() : now();
  const list = settings().call_topics || []; const fresh = topics.filter((x) => !list.some((y) => y.toLowerCase() === x.toLowerCase())); if (fresh.length) D.setSetting('call_topics', [...list, ...fresh]); // a typed topic joins the list
  const was = o.id ? get("SELECT * FROM calls WHERE id=? AND user_id=? AND status='Open'", o.id, by.uid) : null;
  const r = callRow(was ? { ...was, app_id: o.app_id || was.app_id } : o); const row = { ...r, at: when, outcome: o.outcome, minutes, note: note.slice(0, 4000), topics, status: 'Done' };
  if (was) update('calls', was.id, row); else insert('calls', { ...row, iv_id: o.iv_id || null, user_id: by && by.uid, by: actorName(by) });
  if (r.app_id) appHist(r.app_id, (get('SELECT step FROM applications WHERE id=?', r.app_id) || {}).step, by, `Call with ${r.party}: ${o.outcome}${minutes ? ` (${minutes} min)` : ''}. ${topics.join(', ')}. ${note.slice(0, 160)}`, 'call');
  return { ok: true };
}
// The team's rule: a step moves on only with a call on the record. Off on test copies unless switched on there.
const callGateOn = () => { const v = settings().call_gate; return v === undefined ? D.ENV.name !== 'test' : !!v; };
function needsCall(app, step, u) {
  if (!callGateOn() || u.level === 'super' || stepIdx(step) <= stepIdx(app.step) || stepIdx(app.step) < stepIdx('Screening')) return false;
  return !get("SELECT 1 FROM calls WHERE app_id=? AND status='Done' AND at>=?", app.id, app.step_since || app.created_at);
}

// ---------- how and when a candidate wants to be reached ----------
const PREF = { channel: ['WhatsApp', 'Email', 'Phone call'], time: ['Morning (9 to 12)', 'Afternoon (12 to 4)', 'Evening (4 to 8)'], days: ['Weekdays', 'Weekends'] };
const PREF_HOURS = { Morning: [9, 12], Afternoon: [12, 16], Evening: [16, 20] };
function cleanPrefs(b) { const out = {}; for (const [k, list] of Object.entries(PREF)) { const v = b[`pref_${k}`]; if (v !== undefined) out[`pref_${k}`] = v && list.includes(v) ? v : null; } return out; }
const istNow = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value])); return { hour: Number(p.hour), weekend: ['Sat', 'Sun'].includes(p.weekday) }; };
function inPreferred(c, d = new Date()) {
  const t = istNow(d); const hours = c.pref_time ? PREF_HOURS[c.pref_time.split(' ')[0]] : null;
  if (c.pref_days === 'Weekdays' && t.weekend) return false; if (c.pref_days === 'Weekends' && !t.weekend) return false;
  return !hours || (t.hour >= hours[0] && t.hour < hours[1]);
}
// The first moment inside their window, in half-hour steps: null when now is fine.
function nextPreferred(c, from = new Date()) { if (inPreferred(c, from)) return null; for (let i = 1; i <= 16 * 24; i++) { const d = new Date(Math.ceil(from.getTime() / 1800000) * 1800000 + (i - 1) * 1800000); if (inPreferred(c, d)) return d.toISOString(); } return null; }
const prefNote = (c) => [c.pref_channel, c.pref_time && c.pref_time.split(' (')[0].toLowerCase(), c.pref_days && c.pref_days.toLowerCase()].filter(Boolean).join(', ');

// The three taps on WhatsApp: channel, then time, then days. Each answer is saved before the next question goes.
const PREF_ASK = {
  pref2: { text: '2 of 3: What time is best to call you?', buttons: ['Morning 9 to 12', 'Afternoon 12 to 4', 'Evening 4 to 8', 'Any time'] },
  pref3: { text: '3 of 3: Which days suit you?', buttons: ['Weekdays', 'Weekends', 'Any day'] },
};
function prefAnswer(step, t, candId, by) {
  const pick = (list) => list.find((x) => t.startsWith(x.split(' ')[0].toLowerCase()));
  const c = get('SELECT * FROM candidates WHERE id=?', candId); const say = (rule, text, buttons) => { try { sendWA({ ptype: 'candidate', pid: candId, text, buttons: buttons || [], rule, by: { label: 'Preferences' } }); } catch (e) { /* the window may have closed: the answer is still saved */ } };
  if (step.startsWith('pref1')) { const v = pick(PREF.channel); if (!v) return null; update('candidates', candId, { pref_channel: v }); say('pref2', PREF_ASK.pref2.text, PREF_ASK.pref2.buttons); return `Prefers ${v}`; }
  if (step === 'pref2') { const v = t.startsWith('any') ? null : pick(PREF.time); if (!v && !t.startsWith('any')) return null; update('candidates', candId, { pref_time: v }); say('pref3', PREF_ASK.pref3.text, PREF_ASK.pref3.buttons); return `Best time: ${v || 'any time'}`; }
  if (step === 'pref3') { const v = t.startsWith('any') ? null : pick(PREF.days); if (!v && !t.startsWith('any')) return null; update('candidates', candId, { pref_days: v }); const f = get('SELECT * FROM candidates WHERE id=?', candId); say('pref_done', `Thank you. We will reach you on ${f.pref_channel || 'WhatsApp'}${f.pref_time ? `, ${f.pref_time.split(' (')[0].toLowerCase()}` : ''}${f.pref_days ? `, ${f.pref_days.toLowerCase()}` : ''}.`); history('Candidate on WhatsApp', 'contact preferences', candId, null, null, prefNote(f)); phoneTaskTimes(candId); return `Best days: ${v || 'any day'}`; }
  return null;
}

// ---------- what we already know about a candidate, in one place ----------
const EVAL_POINTS = { Strong: 2, OK: 1, Weak: 0 };
const evalView = (e) => { if (!e) return null; const all_ = Object.entries(e.scores || {}); const marks = all_.filter(([, v]) => v in EVAL_POINTS); const by = (r) => all_.filter(([, v]) => v === r).map(([k]) => k.split('|').pop().trim()); const max = marks.length * 2; return { ...e, marked: marks.length, percent: max ? Math.round((marks.reduce((t, [, v]) => t + EVAL_POINTS[v], 0) / max) * 100) : null, weak: by('Weak'), strong: by('Strong'), ok: by('OK'), na: by('N/A') }; };
const jobOf = (appId) => { const r = appId ? get('SELECT j.title t FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=?', appId) : null; return r ? r.t : ''; };
// One line per event, each from where it is really held, so nothing shows twice.
function candidateStory(candidateId) {
  const apps = all('SELECT id FROM applications WHERE candidate_id=?', candidateId).map((a) => a.id); const inApps = apps.length ? `(${apps.map(() => '?').join(',')})` : "('')"; const row = (at, kind, title, detail, by, app) => ({ at, kind, title, detail: detail || '', by: by || '', job: jobOf(app), app_id: app || null });
  return [
    ...all("SELECT * FROM files WHERE record_id=? AND type='cv'", candidateId).map((f) => row(f.at, 'Resume', 'Resume added', f.name, f.by)),
    ...all(`SELECT * FROM app_history WHERE kind IN ('screen','close') AND app_id IN ${inApps}`, ...apps).map((h) => row(h.at, h.kind === 'close' ? 'Closed' : 'Screening', h.note.split(' — ')[0].replace(/^Screening: /, ''), h.note.split(' — ').slice(1).join(' — '), h.by, h.app_id)),
    ...all("SELECT * FROM calls WHERE candidate_id=? AND status='Done'", candidateId).map((k) => row(k.at, 'Call', `${k.party === 'client' ? 'Client call' : 'Call'}: ${k.outcome}`, [(k.topics || []).join(', '), k.note].filter(Boolean).join('. '), k.by, k.app_id)),
    ...all('SELECT * FROM evaluations WHERE candidate_id=?', candidateId).map(evalView).map((e) => row(e.at, 'Evaluation', `Evaluation${e.percent === null ? '' : `: ${e.percent}%`}`, [e.strong.length && `Strong: ${e.strong.join(', ')}`, e.ok.length && `OK: ${e.ok.join(', ')}`, e.weak.length && `Weak: ${e.weak.join(', ')}`, e.na.length && `Not relevant: ${e.na.join(', ')}`, e.note].filter(Boolean).join('. '), e.by, e.app_id)),
    ...all(`SELECT * FROM interviews WHERE status IN ('Completed','No-show') AND app_id IN ${inApps}`, ...apps).map((i) => row(i.at, 'Round', `${i.name}: ${i.status === 'Completed' ? i.result || 'Done' : i.status}`, i.remark, i.interviewer, i.app_id)),
    ...all(`SELECT * FROM round_skips WHERE app_id IN ${inApps}`, ...apps).map((x) => row(x.at, 'Round', `${IV_MODES[x.mode] || 'Round'}: Not needed`, x.reason, x.by, x.app_id)),
    ...all("SELECT * FROM notes WHERE record_id=? AND text LIKE 'Role changed%'", candidateId).map((n) => row(n.at, 'Role', n.text.split(':')[0], n.text.split(':').slice(1).join(':').trim(), n.author)),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
}
function candidateKnown(c) {
  const call = get("SELECT * FROM calls WHERE candidate_id=? AND status='Done' ORDER BY at DESC LIMIT 1", c.id); const ev = evalView(get('SELECT * FROM evaluations WHERE candidate_id=? ORDER BY id DESC LIMIT 1', c.id));
  const decision = get("SELECT h.* FROM app_history h JOIN applications a ON a.id=h.app_id WHERE a.candidate_id=? AND h.kind IN ('screen','close') ORDER BY h.at DESC LIMIT 1", c.id);
  return { prefs: { channel: c.pref_channel || '', time: c.pref_time || '', days: c.pref_days || '', note: prefNote(c), now_ok: inPreferred(c) }, last_call: call ? { ...call, job: jobOf(call.app_id), days: daysBetween(call.at) } : null, evaluation: ev ? { ...ev, job: jobOf(ev.app_id) } : null, decision: decision ? { note: decision.note, by: decision.by, at: decision.at, job: jobOf(decision.app_id) } : null };
}

// ---------- offers ----------
function recordOffer(appId, o, by) {
  const app = get('SELECT * FROM applications WHERE id=?', appId);
  if (!app || app.result !== 'open') throw httpError(400, 'The application is not open.');
  const ctc = Number(o.ctc);
  if (!ctc || ctc < 10000) throw httpError(400, 'Enter the yearly CTC in rupees', 'ctc');
  if (!o.joining_date) throw httpError(400, 'Pick the joining date', 'joining_date');
  update('applications', appId, { offer_ctc: ctc, joining_date: o.joining_date, reporting_to: o.reporting_to || '' });
  appHist(appId, 'Offer made', by, `Offer ${inr(ctc)} a year, joining ${o.joining_date}`, 'offer');
  if (app.step !== 'Offer made') moveStep(appId, 'Offer made', by, 'Offer recorded');
  const job = get('SELECT * FROM jobs WHERE id=?', app.job_id); const client = get('SELECT * FROM clients WHERE id=?', job.client_id);
  sendWA({ ptype: 'candidate', pid: app.candidate_id, format: 'bbhs_offer', vars: { job: job.title, company: client.company, ctc: inr(ctc), joining_date: istFmt(o.joining_date, false) }, ap: appId, jb: job.id, auto: true, rule: 'offer', dedupe: `offer:${appId}:${ctc}:${o.joining_date}` });
  return get('SELECT * FROM applications WHERE id=?', appId);
}

// ---------- after joining (15) ----------
function leftJob(appId, o, by) {
  const app = get('SELECT * FROM applications WHERE id=?', appId);
  if (!app || app.result !== 'Hired') throw httpError(400, 'Only a joined hire can be marked as left.');
  if (!o.date) throw httpError(400, 'Enter the last working day', 'date');
  update('applications', appId, { left_date: o.date, left_reason: o.reason, left_note: o.note || '' });
  appHist(appId, 'Joined', by, `Left on ${o.date}: ${o.reason}`, 'left');
  update('candidates', app.candidate_id, { looking: 'Actively looking', last_updated: now() });
  const job = get('SELECT * FROM jobs WHERE id=?', app.job_id); const client = get('SELECT * FROM clients WHERE id=?', job.client_id);
  const windowDays = client.replacement_days || settings().replacement_days;
  const within = app.joined_at && daysBetween(app.joined_at, o.date) <= windowDays;
  const free = ['Left on their own', 'Absconded'].includes(o.reason) && within && !app.replacement_used && !app.replacement_of;
  let outcome = 'No free replacement: the client can reopen the job as normal.';
  if (free) {
    update('applications', appId, { replacement_used: 1 });
    update('jobs', job.id, { openings: job.openings + 1, manual: null, manual_reason: null, reopened_at: now(), reopen_tag: `Replacement for ${appId}`, replacement_for: appId });
    insert('job_history', { job_id: job.id, at: now(), status: 'Reopened', by: actorName(by), note: `+1 opening, replacement for ${appId}` });
    const b = get('SELECT * FROM bills WHERE app_id=? AND credit_of IS NULL', appId);
    if (b && b.payout_status !== 'Paid') update('bills', b.id, { payout_hold: 1, payout_status: 'On hold' });
    recalcJob(job.id, actorName(by), `Reopened for replacement of ${appId}`);
    outcome = `Free replacement: ${job.id} reopened with +1 opening, no new fee.`;
  } else if (o.reopen) {
    // Not a free replacement, but the client wants the seat filled again: reopened and tagged, billed as usual.
    update('jobs', job.id, { openings: job.openings + 1, manual: null, manual_reason: null, reopened_at: now(), reopen_tag: `Replacement for ${appId}` });
    insert('job_history', { job_id: job.id, at: now(), status: 'Reopened', by: actorName(by), note: `+1 opening, replacement for ${appId} (fee applies)` });
    recalcJob(job.id, actorName(by), `Reopened for replacement of ${appId}`);
    outcome = `${job.id} reopened with +1 opening as a replacement (the fee applies).`;
  }
  alertUser(job.recruiter_id, `${appId} left the job (${o.reason})`, appId, 'candidate');
  return { outcome };
}

// ---------- interview rounds: one line each, none of them compulsory ----------
const BASE_ROUNDS = [['phone', IV_MODES.phone], ['video', IV_MODES.video], ['in_person', IV_MODES.in_person]];
function roundsOf(app) {
  const ivs = all('SELECT * FROM interviews WHERE app_id=? ORDER BY at', app.id).map(interviewView); const skips = all('SELECT * FROM round_skips WHERE app_id=?', app.id);
  const rows = [...BASE_ROUNDS.map(([key, name]) => ({ key, mode: key, name })), ...all('SELECT * FROM extra_rounds WHERE app_id=? ORDER BY id', app.id).map((x) => ({ key: `x${x.id}`, extra_id: x.id, mode: x.mode, name: x.name, added_reason: x.reason, added_by: x.by, added_at: x.at }))];
  return rows.map((r) => {
    const own = ivs.filter((i) => (i.round_key || i.mode || (i.round === 'client' ? 'in_person' : 'phone')) === r.key); const last = own.find((i) => ['Scheduled', 'Rescheduled'].includes(i.status)) || own.filter((i) => i.status !== 'Cancelled').pop() || own[own.length - 1]; const skip = skips.find((x) => x.mode === r.key);
    const status = skip ? 'Not needed' : !last || last.status === 'Cancelled' ? 'To do' : ['Scheduled', 'Rescheduled'].includes(last.status) ? (last.view_status === 'Result pending' ? 'Result pending' : 'Scheduled') : last.status === 'No-show' ? 'No-show' : last.result === 'Not selected' ? 'Not cleared' : last.result === 'On hold' ? 'On hold' : 'Cleared';
    return { ...r, status, interview_ids: own.map((i) => i.id), at: last ? last.at : null, skip_reason: skip ? skip.reason : '', skip_by: skip ? skip.by : '', skip_at: skip ? skip.at : null };
  });
}
// Where an open application is in the hiring flow, as the team works it: screening, the telephonic round, the
// virtual round, with the client, the offer, joined. Our interview splits into its two rounds.
const STAGES = ['Screening', 'Telephonic', 'Virtual', 'Client', 'Offer'];
function stageOfApp(a) {
  if (a.result === 'Hired') return 'Joined'; if (a.result !== 'open') return 'Closed';
  if (['Applied', 'Screening'].includes(a.step)) return 'Screening';
  if (a.step === 'Our interview') { const r = roundsOf(a).find((x) => x.mode !== 'in_person' && !['Cleared', 'Not needed', 'Not cleared'].includes(x.status)); return r && r.mode === 'phone' ? 'Telephonic' : 'Virtual'; }
  if (['Sent to client', 'Client interview'].includes(a.step)) return 'Client';
  if (['Offer made', 'Offer accepted'].includes(a.step)) return 'Offer';
  return 'Joined';
}
// The stage an application moves to when the current one is cleared: telephonic -> virtual (or the client when
// the virtual round is not needed), virtual -> the client, screening -> telephonic, client -> offer.
// Within a stage: eligible (awaiting the round), scheduled, feedback due (the time has passed), or on hold / no-show.
// Recording the round completed moves the application to the next stage, eligible again.
const ROUND_STATE = { 'To do': 'Eligible', Scheduled: 'Scheduled', 'Result pending': 'Feedback due', 'On hold': 'On hold', 'No-show': 'No-show' };
function stageStateOf(a, stage = stageOfApp(a)) {
  if (stage === 'Screening') return 'To screen';
  if (stage === 'Telephonic' || stage === 'Virtual') { const r = roundsOf(a).find((x) => x.mode === (stage === 'Telephonic' ? 'phone' : 'video') && !['Cleared', 'Not needed', 'Not cleared'].includes(x.status)) || roundsOf(a).find((x) => x.mode !== 'in_person' && !['Cleared', 'Not needed', 'Not cleared'].includes(x.status)); return r ? ROUND_STATE[r.status] || 'Eligible' : 'Eligible'; }
  if (stage === 'Client') { const r = roundsOf(a).find((x) => x.mode === 'in_person' && !['Cleared', 'Not needed', 'Not cleared'].includes(x.status)); return r ? ROUND_STATE[r.status] || 'Eligible' : 'Selected'; }
  if (stage === 'Offer') return a.step === 'Offer accepted' ? 'Joining' : 'Waiting for answer';
  return '';
}
function nextStageOf(a, stage = stageOfApp(a)) {
  if (stage === 'Screening') return 'Telephonic';
  if (stage === 'Telephonic') { const v = roundsOf(a).find((x) => x.mode === 'video'); return v && !['Not needed', 'Cleared'].includes(v.status) ? 'Virtual' : 'Client'; }
  if (stage === 'Virtual') return 'Client';
  if (stage === 'Client') return 'Offer';
  return '';
}
// Owners: several people can own a client, a job or a task. A client's owners own its jobs and their applications.
const listOf = (v) => (Array.isArray(v) ? v : []);
function ownersOfJob(j, clientOf = (id) => get('SELECT owner_id, owners FROM clients WHERE id=?', id)) {
  if (!j) return []; const c = j.client_id ? clientOf(j.client_id) : null;
  return [...new Set([j.recruiter_id, ...listOf(j.owners), c && c.owner_id, ...listOf(c && c.owners)].filter(Boolean))];
}
// For a whole list at once: job id -> its owners.
function ownerMap() {
  const cl = new Map(all('SELECT id, owner_id, owners FROM clients').map((c) => [c.id, c]));
  return new Map(all('SELECT id, client_id, recruiter_id, owners FROM jobs').map((j) => [j.id, ownersOfJob(j, (id) => cl.get(id))]));
}
const ownsApp = (uid, a, map) => a.owner_id === uid || (map.get(a.job_id) || []).includes(uid);
function skipRounds(app, rows, reason, by) {
  if (!rows.length) return; const why = String(reason || '').trim(); if (!why) throw httpError(400, `Give the reason for skipping: ${rows.map((r) => r.name).join(', ')}`, 'skip_reason');
  for (const r of rows) { D.run('INSERT OR REPLACE INTO round_skips (app_id, mode, reason, by, at) VALUES (?, ?, ?, ?, ?)', app.id, r.key, why, actorName(by), now()); appHist(app.id, get('SELECT step FROM applications WHERE id=?', app.id).step, by, `${r.name}: Not needed. ${why}`, 'interview'); }
}
// Going past our own rounds to the client: a round left at To do needs its reason.
function passRounds(appId, step, reason, by) {
  const app = get('SELECT * FROM applications WHERE id=?', appId); if (stepIdx(step) < stepIdx('Sent to client') || stepIdx(app.step) >= stepIdx('Sent to client')) return;
  skipRounds(app, roundsOf(app).filter((r) => r.status === 'To do' && r.mode !== 'in_person'), reason, by);
}

// ---------- job actions ----------
function jobAction(jobId, action, o, by) {
  const job = get('SELECT * FROM jobs WHERE id=?', jobId); if (!job) throw httpError(404, 'Job opening not found');
  const who = actorName(by); let closedApps = 0; let restored = 0;
  if (action === 'hold') { update('jobs', jobId, { manual: 'On hold', manual_reason: o.reason || 'Hiring paused' }); }
  else if (action === 'resume') { update('jobs', jobId, { manual: null, manual_reason: null }); }
  else if (action === 'close') {
    if (!o.reason) throw httpError(400, 'Pick a reason', 'reason');
    update('jobs', jobId, { manual: 'Closed', manual_reason: o.reason });
    // Nothing stays in progress on a closed job. Interviews ahead come off the calendar.
    for (const a of appsOfJob(jobId).filter((x) => x.result === 'open')) {
      closeApplication(a.id, 'Job closed', by, o.reason); closedApps++;
      D.run("UPDATE interviews SET status='Cancelled' WHERE app_id=? AND status IN ('Scheduled','Rescheduled') AND at>?", a.id, now());
    }
  } else if (action === 'add_seat') {
    // More people for the same position while it is still hiring: same job ID, one more seat each.
    const add = Math.max(1, Math.min(50, Number(o.add) || 1));
    update('jobs', jobId, { openings: job.openings + add });
    insert('job_history', { job_id: jobId, at: now(), status: `+${add} seat${add === 1 ? '' : 's'} (${job.openings + add} in all)`, by: who, note: o.reason || '' });
    history(who, 'edit', jobId, 'openings', job.openings, job.openings + add);
  } else if (action === 'reopen') {
    const cur = computeJobStatus(job, appsOfJob(jobId));
    if (!['Filled', 'Closed'].includes(cur)) throw httpError(400, 'Only a Filled or Closed job can be reopened.');
    const add = cur === 'Filled' ? Math.max(1, Number(o.add) || 1) : 0;
    update('jobs', jobId, { manual: null, manual_reason: null, openings: job.openings + add, reopened_at: now(), reopen_tag: 'Reopened' });
    insert('job_history', { job_id: jobId, at: now(), status: 'Reopened', by: who, note: `${o.reason || 'Reopened'}${add ? `, +${add} opening(s)` : ''}` });
    // Those closed only because the job closed come back. One that cannot (the seats are taken) stays closed.
    for (const a of appsOfJob(jobId).filter((x) => x.result === 'Job closed')) { try { reopenApplication(a.id, by); restored++; } catch (e) { appHist(a.id, a.step, by, `Not reopened with the job: ${e.message}`, 'reopen'); } }
  } else if (action === 'approve_jd') {
    update('jobs', jobId, { jd_approved: 1, jd_status: 'Approved', jd_note: o.note || null });
  } else throw httpError(400, 'Unknown action');
  history(who, `job ${action}`, jobId, 'manual', job.manual, o.reason || action);
  recalcJob(jobId, who, o.reason || action);
  return { ...get('SELECT * FROM jobs WHERE id=?', jobId), closed_apps: closedApps, restored_apps: restored };
}

// ---------- leads: one receiving step for every door (11) ----------
const CONSENT_WORDING = 'By sending, you agree to be contacted on WhatsApp, phone and email, and to your profile being shared with employers.';
function saveConsent(ptype, pid, source, wording, what) {
  insert('consents', { person_type: ptype, person_id: pid, what: what || 'Contact on WhatsApp, phone and email; share profile with employers', wording: wording || CONSENT_WORDING, source, at: now(), opted_out: 0 });
}
// A lead becomes an active client with the signed contract. KYC is tracked but not needed, and work on a lead is never blocked.
function activationState(c) {
  const ob = c.onboarding || {}; const k = c.kyc || {};
  const kyc = ['gst', 'pan', 'owner_id'].every((x) => k[x]) || !!(ob.kyc || {}).done; const contract = !!c.contract || !!(ob.contract || {}).done;
  return { kyc, contract, ready: contract, missing: contract ? [] : ['Signed contract'] };
}
function checkActivation(clientId, by) {
  const c = get('SELECT * FROM clients WHERE id=?', clientId); if (!c || c.activated_at || !activationState(c).ready) return false;
  const stages = settings().client_stages; const patch = { activated_at: now() };
  if (stages.indexOf('Client activated') > stages.indexOf(c.stage)) patch.stage = 'Client activated';
  update('clients', c.id, patch); history(actorName(by), 'activate', c.id, 'stage', c.stage, 'Active client');
  if (c.owner_id) alertUser(c.owner_id, `${c.company} is now an active client: signed contract is in`, c.id, false);
  return true;
}
function intakeClient(d, o) {
  const phone = digits10(d.whatsapp);
  const source = o.source || 'Website';
  const by = o.by; const who = actorName(by);
  if (!d.contact && !d.company) throw httpError(400, 'Please enter your name', 'contact');
  if (!validPhone(phone)) { if (!o.allowNoPhone) throw httpError(400, 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9', 'whatsapp'); }
  let existing = phone ? get('SELECT * FROM clients WHERE whatsapp=? AND merged_into IS NULL AND removed=0', phone) : null;
  if (existing) {
    const fill = {};
    for (const k of ['company', 'contact', 'email', 'city', 'business_type', 'need', 'roles']) if (!existing[k] && d[k]) fill[k] = d[k];
    if (d.roles && existing.roles && !existing.roles.includes(d.roles)) fill.roles = `${existing.roles}; ${d.roles}`;
    if (d.need) fill.need = d.need;
    update('clients', existing.id, { ...fill, is_new: 1, updated_at: now() });
    insert('notes', { record_id: existing.id, text: `Came again from ${source} on ${istFmt(now(), false)}${d.roles ? ' — roles: ' + d.roles : ''}${d.need ? ' — ' + d.need : ''}`, author: who, at: now() });
    history(who, 'repeat lead', existing.id, null, null, source);
    if (o.consent !== false) saveConsent('client', existing.id, source, o.wording);
    return { client: get('SELECT * FROM clients WHERE id=?', existing.id), isNew: false };
  }
  const id = nextId('CL');
  const repeat = d.email ? get('SELECT id FROM clients WHERE lower(email)=lower(?) AND merged_into IS NULL', d.email) : null;
  const agency = by && by.agency_id ? by.agency_id : null;
  insert('clients', {
    id, company: d.company || '', contact: d.contact || '', whatsapp: phone, email: d.email || '', city: d.city || '', state: d.state || stateOf(d.city), language: require('./lang').pick(d.language),
    business_type: d.business_type || '', need: d.need || '', roles: d.roles || '', source, stage: d.stage || settings().client_stages[0],
    agency_id: agency, owner_id: by && by.uid ? by.uid : null, is_new: by && by.uid ? 0 : 1, kyc: {}, onboarding: {}, extra: d.extra || {},
    industry: settings().default_industry, possible_repeat_of: repeat ? repeat.id : null, needs_check: o.needsCheck || null, old_code: d.old_code || null,
    created_by: who, created_at: d.created_at || now(), updated_at: now(),
  });
  history(who, 'create', id, null, null, `Client ${d.company || d.contact} from ${source}`);
  if (o.consent !== false) saveConsent('client', id, source, o.wording);
  if (o.consent !== false && !o.silent) sendWA({ ptype: 'client', pid: id, format: 'bbhs_client_welcome', vars: { client_id: id, link: link('my-account') }, auto: true, rule: 'client_welcome', dedupe: `welcome:${id}` });
  if (!agency && !o.silent) {
    const team = D.soleAgency() ? D.all("SELECT id, team FROM users WHERE agency_id=? AND status='On'", D.soleAgency()).filter((x) => (x.team || 'Recruitment') === 'Recruitment') : [];
    for (const s of [...superAdmins(), ...team]) insert('alerts', { user_id: s.id, text: `New client lead ${id} (${d.company || d.contact})`, record_id: id, read: 0, at: now() });
  }
  return { client: get('SELECT * FROM clients WHERE id=?', id), isNew: true };
}
// The ad a lead came from (campaign, ad set, ad name from the link), as columns; empty when there was no ad.
const adCols = (ad) => (ad ? { ad_campaign: ad.campaign || null, ad_set: ad.adset || null, ad_name: ad.ad || null } : {});
const adLabel = (r) => [r.ad_campaign, r.ad_set, r.ad_name].filter(Boolean).join(' › ');
function intakeCandidate(d, o) {
  const phone = digits10(d.whatsapp);
  const source = o.source || 'Website';
  const by = o.by; const who = actorName(by);
  if (!d.name) throw httpError(400, 'Please enter your name', 'name');
  if (!validPhone(phone) && !o.allowNoPhone) throw httpError(400, 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9', 'whatsapp');
  const dept = d.department || (d.job_wanted ? deptOf(d.job_wanted) : null);
  // the same number first; else the record the caller already knows (o.existingId, e.g. the same email address)
  const existing = (phone ? get('SELECT * FROM candidates WHERE whatsapp=? AND merged_into IS NULL AND removed=0', phone) : null)
    || (o.existingId ? get('SELECT * FROM candidates WHERE id=? AND merged_into IS NULL AND removed=0', o.existingId) : null);
  const fields = ['name', 'email', 'city', 'job_wanted', 'exp_total', 'exp_jewellery', 'cur_salary', 'exp_salary', 'notice_days', 'current_company', 'cv_file', 'pref_channel', 'pref_time', 'pref_days'];
  if (existing) {
    const fill = {};
    for (const k of fields) if ((existing[k] === null || existing[k] === '' || existing[k] === undefined) && d[k] !== undefined && d[k] !== '' && d[k] !== null) fill[k] = d[k];
    if (d.job_wanted) { fill.job_wanted = d.job_wanted; fill.department = dept; }
    if (validPhone(phone) && !existing.whatsapp) { fill.whatsapp = phone; if (existing.name) fill.needs_check = null; } // the number arrived later
    if (d.exp_jewellery !== undefined && d.exp_jewellery !== null && d.exp_jewellery !== '') fill.exp_jewellery = d.exp_jewellery;
    if (d.city) { fill.city = d.city; fill.state = d.state || stateOf(d.city); }
    if (d.exp_total !== undefined && d.exp_total !== null && d.exp_total !== '') fill.exp_total = d.exp_total;
    update('candidates', existing.id, { ...fill, ...adCols(o.ad), is_new: 1, last_updated: now() });
    insert('notes', { record_id: existing.id, text: `Came again from ${source}${o.ad ? ` (ad: ${adLabel(adCols(o.ad))})` : ''} on ${istFmt(now(), false)}`, author: who, at: now() });
    history(who, 'repeat lead', existing.id, null, null, source);
    if (o.consent !== false) { saveConsent('candidate', existing.id, source, o.wording); update('candidates', existing.id, { consent_alerts: 1 }); }
    if (d.apply_job) { try { createApplication(existing.id, d.apply_job, by || { label: 'Candidate' }, source, 'Applied again from a job link', o.ad); } catch { /* already on this job, or job closed */ } }
    return { candidate: get('SELECT * FROM candidates WHERE id=?', existing.id), isNew: false };
  }
  const id = nextId('CA');
  const repeat = d.email ? get('SELECT id FROM candidates WHERE lower(email)=lower(?) AND merged_into IS NULL', d.email) : null;
  const agency = by && by.agency_id ? by.agency_id : null;
  insert('candidates', {
    ...cleanPrefs(d), id, name: d.name, whatsapp: phone, email: d.email || '', city: d.city || '', state: d.state || stateOf(d.city), work_cities: d.work_cities || (d.city ? [d.city] : []), language: require('./lang').pick(d.language), industry: d.industry || settings().default_industry || 'Jewellery', exp_business: cleanBusiness(d.exp_business),
    job_wanted: d.job_wanted || '', department: dept, exp_total: d.exp_total ?? null, exp_jewellery: d.exp_jewellery ?? null,
    cur_salary: d.cur_salary ?? null, exp_salary: d.exp_salary ?? null, notice_days: d.notice_days ?? null, skills: d.skills || [], current_company: d.current_company || '',
    cv_file: d.cv_file || null, source, ...adCols(o.ad), ref_by: d.ref_by || null, tieup_id: d.tieup_id || null, agency_id: agency, recruiter_id: by && by.uid ? by.uid : null,
    is_new: by && by.uid ? 0 : 1, consent_alerts: o.consent !== false ? 1 : 0, possible_repeat_of: repeat ? repeat.id : null,
    needs_check: o.needsCheck || (!phone ? 'No phone found' : null), last_updated: now(), old_code: d.old_code || null, created_by: who, created_at: d.created_at || now(),
  });
  history(who, 'create', id, null, null, `Candidate ${d.name} from ${source}`);
  if (o.consent !== false) saveConsent('candidate', id, source, o.wording);
  if (o.consent !== false && !o.silent && phone) sendWA({ ptype: 'candidate', pid: id, format: 'bbhs_candidate_welcome', vars: { candidate_id: id, link: link('my-profile') }, auto: true, rule: 'candidate_welcome', dedupe: `welcome:${id}` });
  if (o.consent === false && !o.silent && phone) sendWA({ ptype: 'candidate', pid: id, format: 'bbhs_consent_request', auto: true, dedupe: `consent:${id}` });
  if (d.apply_job) { try { createApplication(id, d.apply_job, by || { label: 'Candidate' }, source, 'Applied from a job link', o.ad); } catch { /* job closed or missing */ } }
  // Automatic matching: the open jobs this person fits best go on their record as a note for the team.
  try {
    const fits = jobsFor(get('SELECT * FROM candidates WHERE id=?', id), 3);
    if (fits.length) insert('notes', { record_id: id, text: `Matches open jobs: ${fits.map((m) => `${m.j.id} ${m.j.title}, ${m.j.city} (${m.score}%: ${m.reasons.slice(0, 2).join(', ')})`).join(' · ')}`, author: 'Matching', at: now() });
  } catch { /* matching never blocks a sign-up */ }
  return { candidate: get('SELECT * FROM candidates WHERE id=?', id), isNew: true };
}
function assignLead(type, id, agencyId, by) {
  const table = type === 'client' ? 'clients' : 'candidates';
  const rec = get(`SELECT * FROM ${table} WHERE id=?`, id); if (!rec) throw httpError(404, 'Lead not found');
  const ag = get('SELECT * FROM agencies WHERE id=?', agencyId); if (!ag) throw httpError(400, 'Pick an agency');
  const admin = agencyAdmin(agencyId);
  const patch = { agency_id: agencyId, is_new: 0 };
  if (type === 'client') patch.owner_id = admin ? admin.id : null; else patch.recruiter_id = rec.recruiter_id || (admin ? admin.id : null);
  D.edit(table, id, patch, actorName(by));
  if (type === 'client') run('UPDATE jobs SET agency_id=? WHERE client_id=? AND agency_id IS NULL', agencyId, id); // its jobs go with it
  if (admin) alertUser(admin.id, `New ${type} lead assigned: ${rec.company || rec.name || id}`, id, 'leads');
  return get(`SELECT * FROM ${table} WHERE id=?`, id);
}

// Merge two records: the kept one keeps its ID, the other points to it forever (11.2).
function mergeRecords(type, keepId, dropId, chosen, by) {
  const table = type === 'client' ? 'clients' : 'candidates';
  const keep = get(`SELECT * FROM ${table} WHERE id=?`, keepId); const drop = get(`SELECT * FROM ${table} WHERE id=?`, dropId);
  if (!keep || !drop || keepId === dropId) throw httpError(400, 'Pick two different records');
  const who = actorName(by);
  return D.tx(() => {
    const patch = {};
    for (const [k, from] of Object.entries(chosen || {})) if (from === 'drop') patch[k] = drop[k];
    if (Object.keys(patch).length) D.edit(table, keepId, patch, who);
    if (type === 'candidate') {
      for (const a of all('SELECT * FROM applications WHERE candidate_id=?', dropId)) {
        const clash = get("SELECT id FROM applications WHERE candidate_id=? AND job_id=? AND result='open'", keepId, a.job_id);
        if (clash && a.result === 'open') { update('applications', a.id, { result: 'Candidate withdrew' }); appHist(a.id, a.step, by, `Closed as duplicate of ${clash.id} during merge`, 'close'); }
        update('applications', a.id, { candidate_id: keepId });
      }
    } else {
      run('UPDATE jobs SET client_id=? WHERE client_id=?', keepId, dropId);
      run('UPDATE bills SET client_id=? WHERE client_id=?', keepId, dropId);
      run('UPDATE client_members SET client_id=? WHERE client_id=?', keepId, dropId);
    }
    run('UPDATE messages SET person_id=? WHERE person_type=? AND person_id=?', keepId, type, dropId);
    run('UPDATE files SET record_id=? WHERE record_id=?', keepId, dropId);
    run('UPDATE notes SET record_id=? WHERE record_id=?', keepId, dropId);
    run('UPDATE consents SET person_id=? WHERE person_type=? AND person_id=?', keepId, type, dropId);
    update(table, dropId, { merged_into: keepId, archived: 1, possible_repeat_of: null });
    update(table, keepId, { possible_repeat_of: null });
    insert('merges', { old_id: dropId, kept_id: keepId, by: who, at: now() });
    history(who, 'merge', keepId, null, dropId, keepId, [keepId, dropId]);
    return get(`SELECT * FROM ${table} WHERE id=?`, keepId);
  });
}
const resolveId = (id) => { const m = get('SELECT kept_id FROM merges WHERE old_id=?', id); return m ? resolveId(m.kept_id) : id; };

// ---------- replies from WhatsApp (8.7) ----------
// ---------- asking the client for an interview slot ----------
const OPEN_ASK = "'Waiting','Another time','Replied','Suggested'";
const openAsks = (clientId) => all(`SELECT * FROM slot_asks WHERE client_id=? AND status IN (${OPEN_ASK}) ORDER BY id DESC`, clientId);
// A reply belongs to the application the message was about; with no such link, only a single open ask is safe to use.
function askFor(clientId, ref) { const open = openAsks(clientId); return (ref && ref.ap && open.find((x) => x.app_id === ref.ap)) || (open.length === 1 ? open[0] : null); }
const askOwner = (app) => app.owner_id || (get('SELECT recruiter_id FROM jobs WHERE id=?', app.job_id) || {}).recruiter_id;
function fixAsk(ask, at, by) {
  const app = get('SELECT * FROM applications WHERE id=?', ask.app_id); const whenText = istFmt(at);
  if (!app || app.result !== 'open') { update('slot_asks', ask.id, { status: 'Closed', replied_at: now() }); return 'Application is closed'; }
  if (new Date(at) <= new Date()) {
    update('slot_asks', ask.id, { status: 'Another time', reply_note: `The time picked (${whenText}) has passed`, replied_at: now() });
    alertUser(askOwner(app), `${app.id}: the client picked a time that has passed. Ask again.`, app.id, 'client'); return 'Slot has passed';
  }
  const iv = scheduleInterview(app.id, { round: 'client', mode: 'in_person', at, place: ask.place, name: 'Client round', from_ask: ask.id }, by);
  update('slot_asks', ask.id, { status: 'Scheduled', iv_id: iv.id, picked_at: iv.at, replied_at: now() });
  const job = get('SELECT * FROM jobs WHERE id=?', app.job_id); const cand = get('SELECT name FROM candidates WHERE id=?', app.candidate_id);
  alertUser(askOwner(app), `${app.id}: interview fixed for ${whenText}`, app.id, 'client');
  try { sendWA({ ptype: 'client', pid: ask.client_id, text: `Thank you. The interview with ${cand.name} for the ${job.title} role is fixed for ${whenText} at ${iv.place}. We will confirm with the candidate.`, ap: app.id, jb: job.id, iv: iv.id, by: { label: 'Interview slots' } }); } catch (e) { appHist(app.id, get('SELECT step FROM applications WHERE id=?', app.id).step, by, `Client not told on WhatsApp: ${e.message}`, 'interview'); }
  return `${iv.id} scheduled`;
}
function receiveReply(phone, text, button, opts = {}) {
  const p10 = digits10(phone);
  let ptype = null; let pid = null;
  const cand = get('SELECT id FROM candidates WHERE whatsapp=? AND merged_into IS NULL ORDER BY created_at DESC', p10);
  const cli = get('SELECT id FROM clients WHERE whatsapp=? AND merged_into IS NULL ORDER BY created_at DESC', p10);
  const usr = get('SELECT id FROM users WHERE whatsapp=?', p10);
  if (opts.ptype && opts.pid) { ptype = opts.ptype; pid = opts.pid; }
  else if (cli) { ptype = 'client'; pid = cli.id; } else if (cand) { ptype = 'candidate'; pid = cand.id; } else if (usr) { ptype = 'user'; pid = usr.id; }
  let botNew = false;
  if (!pid) {
    // Unknown number: the bot decides client or candidate (11.1); the bot conversation fills the details.
    const label = opts.name || `WhatsApp ${p10}`;
    if (opts.bot === 'client') { const r = intakeClient({ contact: label, company: opts.company || '', whatsapp: p10, city: opts.city, roles: opts.roles }, { source: 'WhatsApp bot', silent: true, needsCheck: 'Bot: details coming' }); ptype = 'client'; pid = r.client.id; }
    else { const r = intakeCandidate({ name: label, whatsapp: p10, city: opts.city, job_wanted: opts.job }, { source: 'WhatsApp bot', silent: true, needsCheck: 'Bot: details coming' }); ptype = 'candidate'; pid = r.candidate.id; }
    botNew = true;
  }
  const last = get("SELECT * FROM messages WHERE person_type=? AND person_id=? AND direction='out' ORDER BY at DESC LIMIT 1", ptype, pid);
  const ref = opts.reply_to ? get('SELECT * FROM messages WHERE id=?', opts.reply_to) : last;
  const id = nextId('WA');
  insert('messages', { id, person_type: ptype, person_id: pid, phone: p10, direction: 'in', text: text || button, buttons: [], ap: ref && ref.ap, jb: ref && ref.jb, iv: ref && ref.iv, bl: ref && ref.bl, sent_by: 'them', status: 'received', read_by_us: 0, reply_to: ref ? ref.id : null, at: now() });
  D.setHealth('last_wa_received', now());
  { const rec = ptype === 'candidate' || ptype === 'client' ? get(`SELECT language FROM ${ptype}s WHERE id=?`, pid) : null; require('./lang').onInbound(id, rec && rec.language); }
  const bot = require('./bot');
  if (opts.bot && (ptype === 'client' || ptype === 'candidate')) { bot.start(p10, ptype, pid, botNew); return { id, ptype, pid, effect: botNew ? `Bot started for new ${ptype} ${pid}` : 'Bot: already known' }; }
  if (bot.session(p10)) return { id, ptype, pid, effect: bot.answer(p10, button || text, opts.hasMedia) };
  const by = { label: `${ptype === 'client' ? 'Client' : 'Candidate'} on WhatsApp` };
  const t = String(button || text || '').trim().toLowerCase();
  let effect = 'Saved in inbox';
  const table = ptype === 'client' ? 'clients' : ptype === 'candidate' ? 'candidates' : null;
  const ask = ptype === 'client' ? askFor(pid, ref) : null;
  const slotNo = ask && Number((t.match(/^(?:slot|option)?\s*#?\s*([123])$/) || [])[1]);
  if (table && (t === 'stop' || t === 'stop messages')) { update(table, pid, { opted_out: 1 }); insert('consents', { person_type: ptype, person_id: pid, what: 'Opted out (STOP)', wording: text, source: 'WhatsApp', at: now(), opted_out: 1 }); effect = 'Opted out'; sendSystemText(ptype, pid, 'You will not get any more automatic messages. Reply START to turn them back on.'); }
  else if (table && t === 'start') { update(table, pid, { opted_out: 0 }); insert('consents', { person_type: ptype, person_id: pid, what: 'Back in (START)', wording: text, source: 'WhatsApp', at: now(), opted_out: 0 }); effect = 'Opted back in'; sendSystemText(ptype, pid, 'Messages are turned back on. Reply STOP any time to stop them.'); }
  else if (ask && slotNo && ask.slots[slotNo - 1]) effect = fixAsk(ask, ask.slots[slotNo - 1], by);
  else if (ask && t === 'another time') { update('slot_asks', ask.id, { status: 'Another time', replied_at: now() }); alertUser(askOwner(get('SELECT * FROM applications WHERE id=?', ask.app_id)), `${ask.app_id}: the client asked for another time`, ask.app_id, 'client'); effect = 'Client asked for another time'; }
  else if (ask && !button && t) {
    update('slot_asks', ask.id, { status: 'Replied', reply: String(text).slice(0, 500), replied_at: now() }); alertUser(askOwner(get('SELECT * FROM applications WHERE id=?', ask.app_id)), `${ask.app_id}: the client replied about the slot: ${String(text).slice(0, 120)}`, ask.app_id, 'client'); effect = 'Client replied about the slot';
    setImmediate(() => require('./flow').readSlotReply(ask.id, text).catch((e) => console.error('Slot reply', ask.id, e.message)));
  }
  else if (ptype === 'candidate' && ref && /^pref[123]/.test(ref.rule || '') && (effect = prefAnswer(ref.rule, t, pid, by) || effect) !== 'Saved in inbox') { /* a preference was saved */ }
  else if (ptype === 'candidate' && t === 'i agree') { update('candidates', pid, { consent_alerts: 1 }); saveConsent('candidate', pid, 'WhatsApp', text); effect = 'Consent saved'; }
  else if (ref && ref.iv && t === 'confirm') { update('interviews', ref.iv, { confirmed: 1 }); history(by.label, 'confirm', ref.iv, 'confirmed', 0, 1); effect = `${ref.iv} confirmed`; }
  else if (ref && ref.iv && t === 'reschedule') { const ap = get('SELECT * FROM applications WHERE id=?', ref.ap); if (ap) alertUser(ap.owner_id, `Reschedule asked for ${ref.iv}`, ref.iv, 'candidate'); effect = 'Task alert to recruiter'; }
  else if (ref && ref.ap && t === 'accept offer') { moveStep(ref.ap, 'Offer accepted', by, 'Accepted on WhatsApp'); effect = `${ref.ap} → Offer accepted`; }
  else if (ref && ref.ap && t === 'decline') { closeApplication(ref.ap, 'Offer declined', by, 'Declined on WhatsApp'); effect = `${ref.ap} closed (Offer declined)`; }
  else if (ref && ['selected', 'another round', 'not selected'].includes(t)) {
    const iv = ref.iv ? get('SELECT * FROM interviews WHERE id=?', ref.iv) : get("SELECT * FROM interviews WHERE app_id=? AND round='client' ORDER BY at DESC LIMIT 1", ref.ap);
    if (iv) { const r = recordInterview(iv.id, { status: 'Completed', result: t === 'selected' ? 'Selected' : t === 'another round' ? 'Another round' : 'Not selected', remark: 'Feedback on WhatsApp' }, by); effect = `${iv.id} result saved`; if (r.next === 'OPEN_OFFER') { const ap = get('SELECT * FROM applications WHERE id=?', iv.app_id); alertUser(ap.owner_id, `Client selected on ${ap.id}: record the offer`, ap.id, 'client'); } }
  }
  else if (ref && ref.ap && t === "i've joined") { const ap = get('SELECT * FROM applications WHERE id=?', ref.ap); alertUser(ap.owner_id, `${ap.id}: candidate says they have joined. Mark Joined.`, ap.id, 'candidate'); effect = 'Task alert to recruiter'; }
  else if (ref && ref.jb && t === 'interested' && ptype === 'candidate') { try { const a = createApplication(pid, ref.jb, by, 'WhatsApp bot', 'Interested from job alert'); effect = `${a.id} created`; } catch (e) { effect = e.message; } }
  else if (ref && ref.ap && (ptype === 'candidate' || ptype === 'client') && (effect = require('./care').reply(ref, ptype, t, by) || effect) !== 'Saved in inbox') { /* a check-in answer was saved */ }
  else if (t === 'need help' && ref && ref.ap) { update('applications', ref.ap, { at_risk: 1 }); const ap = get('SELECT * FROM applications WHERE id=?', ref.ap); alertUser(ap.owner_id, `${ap.id} at risk: candidate needs help`, ap.id, 'candidate'); effect = 'Marked at risk'; }
  else if (ref && ref.jb && t === 'not interested' && ptype === 'candidate') { insert('notes', { record_id: pid, text: `Not interested in ${ref.jb} (reply to the job alert)`, author: by.label, at: now() }); effect = `Noted: not interested in ${ref.jb}`; }
  else if (t === 'share details' && ptype === 'candidate') { const c = get('SELECT recruiter_id FROM candidates WHERE id=?', pid) || {}; const ap = ref && ref.ap ? get('SELECT owner_id FROM applications WHERE id=?', ref.ap) : null; const owner = (ap && ap.owner_id) || c.recruiter_id; if (owner) alertUser(owner, `${pid} wants to share their salary and notice details: call or message them`, pid, 'candidate'); sendSystemText('candidate', pid, 'Thank you. Please type your current salary, expected salary and notice period here, and we will update your profile.'); effect = 'Asked for details; recruiter alerted'; }
  else if (t === 'not looking' && ptype === 'candidate') { update('candidates', pid, { looking: 'Not looking', last_updated: now() }); effect = 'Marked Not looking'; }
  else if (t === 'still looking' && ptype === 'candidate') { update('candidates', pid, { looking: 'Actively looking', last_updated: now() }); effect = 'Marked Actively looking'; }
  // Unread alert to the owner of this person.
  if (table) {
    const rec = get(`SELECT * FROM ${table} WHERE id=?`, pid);
    const owner = ptype === 'client' ? rec.owner_id : rec.recruiter_id;
    if (owner) insert('alerts', { user_id: owner, text: `${ptype === 'client' ? 'Client' : 'Candidate'} replied: ${(text || button || '').slice(0, 60)}`, record_id: pid, read: 0, at: now() });
  }
  return { id, ptype, pid, effect };
}
function sendSystemText(ptype, pid, text) {
  const p = person(ptype, pid);
  insert('messages', { id: nextId('WA'), person_type: ptype, person_id: pid, phone: p.phone, direction: 'out', text, buttons: [], sent_by: 'Auto', status: settings().crm.enabled ? 'sending' : 'would send', read_by_us: 1, auto: 1, at: now() });
}

module.exports = { stageStateOf, ownersOfJob, ownerMap, ownsApp, STAGES, stageOfApp, nextStageOf, reopenRefilled, adPlanFor, openAdApplications, placedOn, closePlacedApps, adLabel,
  STEPS, stepIdx, digits10, validPhone, inr, istDay, istFmt, istTime, istHour, inQuiet, next9am, daysBetween, addDays, hashPassword, checkPassword, newPassword, sha,
  activationState, checkActivation, waHeld, TEAMS, IV_MODES, clientSeesIv, addIvNote, CALL_OUTCOMES, logCall, jobList, deptOf, stateOf, person, fillFormat, windowOpenUntil, sendWA, setDispatcher, alertUser, link, agencyAdmin, superAdmins,
  computeJobStatus, jobStatusReason, recalcJob, filledCount, appsOfJob, matchScore, jobsFor, cleanBusiness, BUSINESS_TYPES, EXP_YEARS, JEW_YEARS, LOOKING, NOT_LOOKING, ratingOf, bestMatches, isPlaced, salaryText, autoJobAlert,
  feeFor, gstFor, fyOf, billView, refreshBill, createBillForApp, issueBill, upiLink,
  appHist, createApplication, moveStep, closeApplication, reopenApplication, screenApplication, SCREEN, jobsForRole, jobsForPerson, roleTokens, scheduleInterview, recordInterview, interviewView, ivVars, recordOffer, leftJob, jobAction,
  CONSENT_WORDING, saveConsent, intakeClient, intakeCandidate, assignLead, mergeRecords, resolveId, receiveReply, actorName,
};
// ---------- many resumes opened by one person ----------
const RESUME_DAYS = 30;
function resumeUse(user, candidateId) {
  if (user.level === 'super') return;
  D.run('INSERT OR REPLACE INTO resume_use (user_id, candidate_id, at) VALUES (?, ?, ?)', user.id, candidateId, now());
  const since = addDays(new Date(), -RESUME_DAYS); const used = get('SELECT COUNT(*) n FROM resume_use WHERE user_id=? AND at>=?', user.id, since).n;
  const total = get("SELECT COUNT(*) n FROM candidates WHERE cv_file IS NOT NULL AND merged_into IS NULL AND removed=0").n;
  const pct = Number(settings().resume_alert_pct) || 30; if (used < Math.max(10, Math.ceil((total * pct) / 100))) return;
  if (get('SELECT 1 FROM resume_alerts WHERE user_id=? AND at>=?', user.id, since)) return;
  D.run('INSERT OR REPLACE INTO resume_alerts (user_id, at) VALUES (?, ?)', user.id, now());
  for (const s of superAdmins()) alertUser(s.id, `${user.name} opened or downloaded ${used} of ${total} resumes (${Math.round((used / total) * 100)}%) in the last ${RESUME_DAYS} days`, user.id, true);
  history(user.name, 'resume alert', user.id, null, null, `${used} of ${total}`);
}
const accountsUsers = () => all("SELECT * FROM users WHERE level='sub' AND team='Accounts' AND status='On'");
const ownsTask = (t, userId) => t.owner_id === userId || (Array.isArray(t.owners) && t.owners.includes(userId));
const openTasksOf = (userId) => all("SELECT * FROM tasks WHERE removed=0 AND status<>'Done' ORDER BY COALESCE(due_date, '9999'), at").filter((t) => ownsTask(t, userId));
Object.assign(module.exports, { ownsTask, prefAnswer, PREF, cleanPrefs, inPreferred, nextPreferred, prefNote, evalView, candidateStory, candidateKnown, startCall, openCall, needsCall, callGateOn, roundsOf, skipRounds, passRounds, openTasksOf, accountsUsers, fixAsk, openAsks, OPEN_ASK, resumeUse, RESUME_DAYS });
