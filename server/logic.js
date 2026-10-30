// Business rules: steps and statuses (5), matching, fees (9.4, 16), WhatsApp records (8), leads (11), after joining (15).
const crypto = require('crypto');
const D = require('./db');
const { all, get, run, insert, update, nextId, settings, history, now, httpError } = D;

// Closing reasons the software uses itself (not in the team's pick list).
const SYSTEM_CLOSE = ['Position filled', 'Joined elsewhere', 'Requirement not met', 'Rejected at screening'];
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
    return { type, id, name: c.contact || c.company, company: c.company, phone: c.whatsapp, lang: c.language || 'en', opted_out: c.opted_out, consent: 1, agency_id: c.agency_id, record: c };
  }
  if (type === 'candidate') {
    const c = get('SELECT * FROM candidates WHERE id=?', id); if (!c) return null;
    return { type, id, name: c.name, phone: c.whatsapp, lang: c.language === 'hi' ? 'hi' : 'en', opted_out: c.opted_out, consent: c.consent_alerts, agency_id: c.agency_id, record: c };
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
  const w = settings().wa_pause || {};
  if (!w.candidates || msg.person_type !== 'candidate') return null;
  if ((w.allow || []).map((x) => String(x).replace(/\D/g, '').slice(-10)).includes(String(msg.phone || '').slice(-10))) return null;
  if (msg.format === 'bbhs_login_code') return null; // people must still be able to log in
  if (!msg.format && !['Auto', 'Bot', 'System'].includes(msg.sent_by)) return null; // typed by a team member
  return 'Held: candidate WhatsApp paused for testing';
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
    if (!fmt.approved) { if (o.auto) waOnlyStop = 'Format waiting for Meta approval'; else throw httpError(400, 'This format is waiting for Meta approval and cannot be sent.'); }
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
  if (o.format && !o.secret && email && D.ENV.emailCopies !== false) {
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
  const lang = o.lang || p.lang || 'en';
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
function alertUser(userId, text, recordId, sendTask = true) {
  if (!userId) return;
  insert('alerts', { user_id: userId, text, record_id: recordId || null, read: 0, at: now() });
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
  const close = titleCloseness(c.job_wanted, j.title); const cg = groupOf(c.job_wanted); const jg = groupOf(j.title);
  if (c.job_wanted && c.job_wanted.toLowerCase() === String(j.title).toLowerCase()) part('role', 1, `Wants ${j.title}`);
  else if (close >= 0.99) part('role', 0.9, `Wants ${c.job_wanted}`);
  else if (close >= 0.5) part('role', 0.75, `Wants ${c.job_wanted} (close)`);
  else if (cg && cg === jg) part('role', 0.5, `Same field: ${cg}`);
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
  const kinds = BUSINESS_OF[(j.client_id && (get('SELECT business_type FROM clients WHERE id=?', j.client_id) || {}).business_type) || ''] || [];
  const same = (Array.isArray(c.exp_business) ? c.exp_business : []).filter((b) => kinds.includes(b));
  if (same.length) reasons.push(`${same.join(' / ')} experience`);
  if (rating) part('rating', rating / 5, rating >= 4 ? `Rated ${rating.toFixed(1)}/5 in interviews` : null); else part('rating', 0.6);
  let pct = Math.round((score / total) * 100);
  if (NOT_LOOKING.includes(c.looking)) { pct = Math.round(pct * 0.8); gaps.push('Not looking now'); }
  return { score: pct, reasons: reasons.slice(0, 4), gaps: gaps.slice(0, 3) };
}
// Open jobs a candidate fits best (for the candidate's page and the note when they come in).
function jobsFor(c, limit = 5) {
  const placed = new Set(all("SELECT job_id FROM applications WHERE candidate_id=? AND result IN ('open','Hired')", c.id).map((r) => r.job_id));
  const rating = ratingOf(c.id);
  return all("SELECT * FROM jobs WHERE archived=0 AND status IN ('Open','Sourcing','Interviewing','Offer stage')")
    .filter((j) => !placed.has(j.id))
    .map((j) => ({ j, ...matchScore(c, j, rating) }))
    .filter((m) => m.score >= settings().match.show)
    .sort((a, b) => b.score - a.score).slice(0, limit);
}
function isPlaced(candId) {
  const j = get("SELECT joined_at FROM applications WHERE candidate_id=? AND result='Hired' AND left_date IS NULL ORDER BY joined_at DESC LIMIT 1", candId);
  return j && j.joined_at && daysBetween(j.joined_at) < 183;
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
  return { ...b, ...p, balance: Math.max(0, b.total - settled), view_status: st };
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
  const job = get('SELECT * FROM jobs WHERE id=?', app.job_id);
  const client = get('SELECT * FROM clients WHERE id=?', job.client_id);
  const cand = get('SELECT * FROM candidates WHERE id=?', app.candidate_id);
  const replacementOf = job.replacement_for && !get("SELECT 1 FROM bills WHERE is_replacement=1 AND credit_of IS NULL AND app_id IN (SELECT id FROM applications WHERE job_id=? AND replacement_of=?)", job.id, job.replacement_for) ? job.replacement_for : null;
  const ctc = app.offer_ctc || 0;
  let f = feeFor(client, job.agency_id, ctc);
  if (replacementOf) f = { fee: 0, share: 0, sharePct: 0, note: `Replacement for ${replacementOf}` };
  const g = gstFor(client.state || stateOf(client.city), f.fee);
  const id = nextId('BL');
  const bill = {
    id, app_id: app.id, client_id: client.id, agency_id: job.agency_id, bill_no: null, ctc, fee: f.fee, gst: g.gst, cgst: g.cgst, sgst: g.sgst, igst: g.igst,
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
function issueBill(billId, by) {
  const b = get('SELECT * FROM bills WHERE id=?', billId);
  if (b.status !== 'Draft') throw httpError(400, 'Only a draft bill can be issued.');
  const client = get('SELECT * FROM clients WHERE id=?', b.client_id);
  const days = client.payment_days || settings().payment_days;
  const bill_no = nextBillNo();
  update('bills', billId, { status: 'Issued', bill_no, issued_at: now(), date: istDay(), due_date: addDays(new Date(), days).slice(0, 10) });
  history(actorName(by), 'issue', billId, 'status', 'Draft', 'Issued');
  const app = get('SELECT * FROM applications WHERE id=?', b.app_id); const cand = get('SELECT * FROM candidates WHERE id=?', app.candidate_id);
  if (b.total > 0) sendWA({ ptype: 'client', pid: b.client_id, format: 'bbhs_bill_raised', vars: { bill_no, candidate: cand.name, amount: inr(b.total), link: upiLink(b.total, bill_no) }, bl: billId, ap: b.app_id, auto: true, rule: 'bill_raised', dedupe: `bill:${billId}` });
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
const roleTokens = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !/^\d+$/.test(w) && !/^v\d+$/.test(w)).map((w) => ROLE_SYN[w] || w).filter((w) => !ROLE_STOP.has(w));
const OPEN_STATUSES = ['Open', 'Sourcing', 'Interviewing', 'Offer stage'];
// The open jobs a role name points to. Every role word of the name is in the job title ("Sales Executive" ->
// "Senior Sales Executive"), or a job title of two words or more is wholly in the name. A city named in the text
// keeps only the jobs in that city. sameCity: only jobs in these cities (the candidate's).
function jobsForRole(text, opt = {}) {
  const words = roleTokens(text); if (!words.length) return [];
  const cityWords = new Map(); for (const c of settings().cities || []) cityWords.set(String(c.name || c).toLowerCase(), String(c.name || c));
  const said = [...cityWords.keys()].filter((c) => (' ' + words.join(' ') + ' ').includes(` ${c} `));
  const cityToks = new Set(said.flatMap((c) => c.split(' ')));
  const role = words.filter((w) => !cityToks.has(w)); if (!role.length) return [];
  const jobs = all('SELECT * FROM jobs WHERE archived=0 AND is_sample=0').filter((j) => OPEN_STATUSES.includes(computeJobStatus(j, appsOfJob(j.id))));
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
  return get('SELECT * FROM applications WHERE id=?', appId);
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
  const target = round === 'ours' ? 'Our interview' : 'Client interview';
  if (stepIdx(app.step) < stepIdx(target)) moveStep(appId, target, by, `${id} scheduled`);
  else appHist(appId, app.step, by, `${id} scheduled`, 'interview');
  const job = get('SELECT * FROM jobs WHERE id=?', app.job_id);
  const iv = get('SELECT * FROM interviews WHERE id=?', id);
  sendWA({ ptype: 'candidate', pid: app.candidate_id, format: 'bbhs_interview_scheduled', vars: ivVars(iv, job), ap: appId, jb: job.id, iv: id, auto: true, rule: 'interview_scheduled', dedupe: `ivs:${id}:${iv.at}` });
  recalcJob(job.id, actorName(by));
  return iv;
}
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
  const patch = { status: o.status, remark: o.remark, qa: o.qa || iv.qa || [], rating: o.rating ? Number(o.rating) : null };
  if (o.status === 'Rescheduled') {
    if (!o.new_at) throw httpError(400, 'Pick the new time', 'new_at');
    patch.at = new Date(o.new_at).toISOString(); patch.confirmed = 0; patch.result = null;
  }
  if (o.status === 'Completed') {
    if (!o.result) throw httpError(400, 'Pick a result', 'result');
    patch.result = o.result; patch.completed_by = by && by.uid ? by.uid : null; patch.completed_at = now();
  }
  update('interviews', ivId, patch);
  history(actorName(by), 'interview result', ivId, 'status', iv.status, `${o.status}${o.result ? ' / ' + o.result : ''}`);
  const app = get('SELECT * FROM applications WHERE id=?', iv.app_id);
  let next = 'Saved';
  if (o.status === 'Completed' && app.result === 'open') {
    if (iv.round === 'ours') {
      if (o.result === 'Move ahead' && iv.mode === 'phone') { appHist(app.id, app.step, by, `${ivId} (telephonic) cleared: ${o.remark}`, 'interview'); next = 'Schedule the virtual round'; }
      else if (o.result === 'Move ahead') { moveStep(app.id, 'Sent to client', by, `${ivId}: ${o.remark}`); next = `${app.id} moved to Sent to client`; }
      else if (o.result === 'Not selected') { closeApplication(app.id, 'Not suitable', by, `${ivId}: ${o.remark}`); next = `${app.id} closed (Not suitable)`; }
      else if (o.result === 'On hold') { update('applications', app.id, { on_hold: 1, hold_reason: o.remark }); appHist(app.id, app.step, by, `On hold after ${ivId}`, 'hold'); next = `${app.id} put on hold`; }
    } else {
      if (o.result === 'Selected') next = 'OPEN_OFFER';
      else if (o.result === 'Not selected') { closeApplication(app.id, 'Client rejected', by, `${ivId}: ${o.remark}`); next = `${app.id} closed (Client rejected)`; }
      else if (o.result === 'On hold') { update('applications', app.id, { on_hold: 1, hold_reason: o.remark }); next = `${app.id} put on hold`; }
      else next = 'Schedule the next round';
      appHist(app.id, app.step, by, `${ivId} result: ${o.result}`, 'interview');
    }
  } else appHist(app.id, app.step, by, `${ivId}: ${o.status}`, 'interview');
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
function logCall(o, by) {
  const cand = get('SELECT id FROM candidates WHERE id=?', o.candidate_id); if (!cand) throw httpError(404, 'Candidate not found');
  if (!CALL_OUTCOMES.includes(o.outcome)) throw httpError(400, 'Pick what happened on the call', 'outcome');
  const minutes = o.minutes === '' || o.minutes == null ? null : Math.max(0, Math.min(600, Number(o.minutes) || 0));
  insert('calls', { candidate_id: cand.id, app_id: o.app_id || null, iv_id: o.iv_id || null, user_id: by && by.uid, by: actorName(by), at: now(), outcome: o.outcome, minutes, note: String(o.note || '').slice(0, 2000) });
  if (o.app_id) appHist(o.app_id, (get('SELECT step FROM applications WHERE id=?', o.app_id) || {}).step, by, `Call: ${o.outcome}${minutes ? ` (${minutes} min)` : ''}${o.note ? ` — ${String(o.note).slice(0, 120)}` : ''}`, 'call');
  return { ok: true };
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
  }
  alertUser(job.recruiter_id, `${appId} left the job (${o.reason})`, appId);
  return { outcome };
}

// ---------- job actions ----------
function jobAction(jobId, action, o, by) {
  const job = get('SELECT * FROM jobs WHERE id=?', jobId); if (!job) throw httpError(404, 'Job opening not found');
  const who = actorName(by);
  if (action === 'hold') { update('jobs', jobId, { manual: 'On hold', manual_reason: o.reason || 'Hiring paused' }); }
  else if (action === 'resume') { update('jobs', jobId, { manual: null, manual_reason: null }); }
  else if (action === 'close') {
    if (!o.reason) throw httpError(400, 'Pick a reason', 'reason');
    update('jobs', jobId, { manual: 'Closed', manual_reason: o.reason });
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
  } else if (action === 'approve_jd') {
    update('jobs', jobId, { jd_approved: 1, jd_status: 'Approved', jd_note: o.note || null });
  } else throw httpError(400, 'Unknown action');
  history(who, `job ${action}`, jobId, 'manual', job.manual, o.reason || action);
  recalcJob(jobId, who, o.reason || action);
  return get('SELECT * FROM jobs WHERE id=?', jobId);
}

// ---------- leads: one receiving step for every door (11) ----------
const CONSENT_WORDING = 'By sending, you agree to be contacted on WhatsApp, phone and email, and to your profile being shared with employers.';
function saveConsent(ptype, pid, source, wording, what) {
  insert('consents', { person_type: ptype, person_id: pid, what: what || 'Contact on WhatsApp, phone and email; share profile with employers', wording: wording || CONSENT_WORDING, source, at: now(), opted_out: 0 });
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
    id, company: d.company || '', contact: d.contact || '', whatsapp: phone, email: d.email || '', city: d.city || '', state: d.state || stateOf(d.city), language: d.language === 'hi' ? 'hi' : 'en',
    business_type: d.business_type || '', need: d.need || '', roles: d.roles || '', source, stage: d.stage || settings().client_stages[0],
    agency_id: agency, owner_id: by && by.uid ? by.uid : null, is_new: by && by.uid ? 0 : 1, kyc: {}, onboarding: {}, extra: d.extra || {},
    industry: settings().default_industry, possible_repeat_of: repeat ? repeat.id : null, needs_check: o.needsCheck || null, old_code: d.old_code || null,
    created_by: who, created_at: d.created_at || now(), updated_at: now(),
  });
  history(who, 'create', id, null, null, `Client ${d.company || d.contact} from ${source}`);
  if (o.consent !== false) saveConsent('client', id, source, o.wording);
  if (o.consent !== false && !o.silent) sendWA({ ptype: 'client', pid: id, format: 'bbhs_client_welcome', vars: { client_id: id, link: link('my-account') }, auto: true, rule: 'client_welcome', dedupe: `welcome:${id}` });
  if (!agency && !o.silent) for (const s of superAdmins()) insert('alerts', { user_id: s.id, text: `New client lead ${id} (${d.company || d.contact})`, record_id: id, read: 0, at: now() });
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
  const existing = phone ? get('SELECT * FROM candidates WHERE whatsapp=? AND merged_into IS NULL AND removed=0', phone) : null;
  const fields = ['name', 'email', 'city', 'job_wanted', 'exp_total', 'exp_jewellery', 'cur_salary', 'exp_salary', 'notice_days', 'current_company', 'cv_file'];
  if (existing) {
    const fill = {};
    for (const k of fields) if ((existing[k] === null || existing[k] === '' || existing[k] === undefined) && d[k] !== undefined && d[k] !== '' && d[k] !== null) fill[k] = d[k];
    if (d.job_wanted) { fill.job_wanted = d.job_wanted; fill.department = dept; }
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
    id, name: d.name, whatsapp: phone, email: d.email || '', city: d.city || '', state: d.state || stateOf(d.city), work_cities: d.work_cities || (d.city ? [d.city] : []), language: d.language === 'hi' ? 'hi' : 'en', industry: d.industry || settings().default_industry || 'Jewellery', exp_business: cleanBusiness(d.exp_business),
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
  if (admin) alertUser(admin.id, `New ${type} lead assigned: ${rec.company || rec.name || id}`, id);
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
  const bot = require('./bot');
  if (opts.bot && (ptype === 'client' || ptype === 'candidate')) { bot.start(p10, ptype, pid, botNew); return { id, ptype, pid, effect: botNew ? `Bot started for new ${ptype} ${pid}` : 'Bot: already known' }; }
  if (bot.session(p10)) return { id, ptype, pid, effect: bot.answer(p10, button || text, opts.hasMedia) };
  const by = { label: `${ptype === 'client' ? 'Client' : 'Candidate'} on WhatsApp` };
  const t = String(button || text || '').trim().toLowerCase();
  let effect = 'Saved in inbox';
  const table = ptype === 'client' ? 'clients' : ptype === 'candidate' ? 'candidates' : null;
  if (table && (t === 'stop' || t === 'stop messages')) { update(table, pid, { opted_out: 1 }); insert('consents', { person_type: ptype, person_id: pid, what: 'Opted out (STOP)', wording: text, source: 'WhatsApp', at: now(), opted_out: 1 }); effect = 'Opted out'; sendSystemText(ptype, pid, 'You will not get any more automatic messages. Reply START to turn them back on.'); }
  else if (table && t === 'start') { update(table, pid, { opted_out: 0 }); insert('consents', { person_type: ptype, person_id: pid, what: 'Back in (START)', wording: text, source: 'WhatsApp', at: now(), opted_out: 0 }); effect = 'Opted back in'; sendSystemText(ptype, pid, 'Messages are turned back on. Reply STOP any time to stop them.'); }
  else if (ptype === 'candidate' && t === 'i agree') { update('candidates', pid, { consent_alerts: 1 }); saveConsent('candidate', pid, 'WhatsApp', text); effect = 'Consent saved'; }
  else if (ref && ref.iv && t === 'confirm') { update('interviews', ref.iv, { confirmed: 1 }); history(by.label, 'confirm', ref.iv, 'confirmed', 0, 1); effect = `${ref.iv} confirmed`; }
  else if (ref && ref.iv && t === 'reschedule') { const ap = get('SELECT * FROM applications WHERE id=?', ref.ap); if (ap) alertUser(ap.owner_id, `Reschedule asked for ${ref.iv}`, ref.iv); effect = 'Task alert to recruiter'; }
  else if (ref && ref.ap && t === 'accept offer') { moveStep(ref.ap, 'Offer accepted', by, 'Accepted on WhatsApp'); effect = `${ref.ap} → Offer accepted`; }
  else if (ref && ref.ap && t === 'decline') { closeApplication(ref.ap, 'Offer declined', by, 'Declined on WhatsApp'); effect = `${ref.ap} closed (Offer declined)`; }
  else if (ref && ['selected', 'another round', 'not selected'].includes(t)) {
    const iv = ref.iv ? get('SELECT * FROM interviews WHERE id=?', ref.iv) : get("SELECT * FROM interviews WHERE app_id=? AND round='client' ORDER BY at DESC LIMIT 1", ref.ap);
    if (iv) { const r = recordInterview(iv.id, { status: 'Completed', result: t === 'selected' ? 'Selected' : t === 'another round' ? 'Another round' : 'Not selected', remark: 'Feedback on WhatsApp' }, by); effect = `${iv.id} result saved`; if (r.next === 'OPEN_OFFER') { const ap = get('SELECT * FROM applications WHERE id=?', iv.app_id); alertUser(ap.owner_id, `Client selected on ${ap.id}: record the offer`, ap.id); } }
  }
  else if (ref && ref.ap && t === "i've joined") { const ap = get('SELECT * FROM applications WHERE id=?', ref.ap); alertUser(ap.owner_id, `${ap.id}: candidate says they have joined. Mark Joined.`, ap.id); effect = 'Task alert to recruiter'; }
  else if (ref && ref.jb && t === 'interested' && ptype === 'candidate') { try { const a = createApplication(pid, ref.jb, by, 'WhatsApp bot', 'Interested from job alert'); effect = `${a.id} created`; } catch (e) { effect = e.message; } }
  else if (t === 'need help' && ref && ref.ap) { update('applications', ref.ap, { at_risk: 1 }); const ap = get('SELECT * FROM applications WHERE id=?', ref.ap); alertUser(ap.owner_id, `${ap.id} at risk: candidate needs help`, ap.id); effect = 'Marked at risk'; }
  else if (ref && ref.jb && t === 'not interested' && ptype === 'candidate') { insert('notes', { record_id: pid, text: `Not interested in ${ref.jb} (reply to the job alert)`, author: by.label, at: now() }); effect = `Noted: not interested in ${ref.jb}`; }
  else if (t === 'share details' && ptype === 'candidate') { const c = get('SELECT recruiter_id FROM candidates WHERE id=?', pid) || {}; const ap = ref && ref.ap ? get('SELECT owner_id FROM applications WHERE id=?', ref.ap) : null; const owner = (ap && ap.owner_id) || c.recruiter_id; if (owner) alertUser(owner, `${pid} wants to share their salary and notice details: call or message them`, pid); sendSystemText('candidate', pid, 'Thank you. Please type your current salary, expected salary and notice period here, and we will update your profile.'); effect = 'Asked for details; recruiter alerted'; }
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

module.exports = { adLabel,
  STEPS, stepIdx, digits10, validPhone, inr, istDay, istFmt, istTime, istHour, inQuiet, next9am, daysBetween, addDays, hashPassword, checkPassword, newPassword, sha,
  waHeld, IV_MODES, clientSeesIv, addIvNote, CALL_OUTCOMES, logCall, jobList, deptOf, stateOf, person, fillFormat, windowOpenUntil, sendWA, setDispatcher, alertUser, link, agencyAdmin, superAdmins,
  computeJobStatus, jobStatusReason, recalcJob, filledCount, appsOfJob, matchScore, jobsFor, cleanBusiness, BUSINESS_TYPES, EXP_YEARS, JEW_YEARS, LOOKING, NOT_LOOKING, ratingOf, bestMatches, isPlaced, salaryText, autoJobAlert,
  feeFor, gstFor, fyOf, billView, refreshBill, createBillForApp, issueBill, upiLink,
  appHist, createApplication, moveStep, closeApplication, reopenApplication, screenApplication, SCREEN, jobsForRole, jobsForPerson, roleTokens, scheduleInterview, recordInterview, interviewView, ivVars, recordOffer, leftJob, jobAction,
  CONSENT_WORDING, saveConsent, intakeClient, intakeCandidate, assignLead, mergeRecords, resolveId, receiveReply, actorName,
};
