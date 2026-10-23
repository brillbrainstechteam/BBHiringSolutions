// Business rules: steps and statuses (5), matching, fees (9.4, 16), WhatsApp records (8), leads (11), after joining (15).
const crypto = require('crypto');
const D = require('./db');
const { all, get, run, insert, update, nextId, settings, history, now, httpError } = D;

const STEPS = ['Applied', 'Screening', 'Our interview', 'Sent to client', 'Client interview', 'Offer made', 'Offer accepted', 'Joined'];
// Routine messages go by email only (WhatsApp costs per message); everything someone must act on or know at once keeps WhatsApp too.
const EMAIL_ONLY_RULES = ['log_reminder', 'day_summary', 'monthly_summary', 'still_looking'];
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
    return { type, id, name: c.name, phone: c.whatsapp, lang: 'en', opted_out: c.opted_out, consent: c.consent_alerts, agency_id: c.agency_id, record: c };
  }
  if (type === 'user') {
    const u = get('SELECT * FROM users WHERE id=?', id); if (!u) return null;
    return { type, id, name: u.name, phone: u.whatsapp, lang: 'en', opted_out: 0, consent: 1, agency_id: u.agency_id, record: u };
  }
  return null;
}
const actorName = (a) => (a ? a.label || a.name || 'System' : 'System');

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
function matchScore(c, j, rating) {
  const w = settings().match.weights; let score = 0; const reasons = [];
  const total = Object.values(w).reduce((a, b) => a + Number(b), 0) || 100;
  const part = (k, frac, why) => { score += (Number(w[k]) || 0) * frac; if (why && frac >= 0.5) reasons.push(why); };
  if (c.job_wanted && c.job_wanted === j.title) part('role', 1, `Wants ${j.title}`);
  else if (c.department && c.department === j.department) part('role', 0.6, `${j.department} background`);
  else part('role', 0);
  const cities = [c.city, ...(Array.isArray(c.work_cities) ? c.work_cities : [])].filter(Boolean).map((x) => x.toLowerCase());
  part('city', cities.includes(String(j.city).toLowerCase()) ? 1 : 0, `Works in ${j.city}`);
  const e = c.exp_total;
  if (e === null || e === undefined) part('experience', 0.3);
  else if ((j.exp_from ?? 0) <= e && e <= (j.exp_to ?? 99)) part('experience', 1, `${e} yrs experience fits`);
  else if (e > (j.exp_to ?? 99)) part('experience', 0.7, `${e} yrs experience`);
  else if (e >= (j.exp_from ?? 0) - 1) part('experience', 0.5, 'Close on experience');
  else part('experience', 0);
  if (!c.exp_salary || !j.sal_to) part('salary', 0.5);
  else if (c.exp_salary <= j.sal_to) part('salary', 1, 'Salary within range');
  else if (c.exp_salary <= j.sal_to * 1.15) part('salary', 0.5, 'Salary slightly above range');
  else part('salary', 0);
  const js = (j.skills || []).map((x) => x.toLowerCase()); const cs = (c.skills || []).map((x) => x.toLowerCase());
  if (!js.length) part('skills', 0.5);
  else { const hit = js.filter((x) => cs.includes(x)).length; part('skills', hit / js.length, hit ? `${hit} of ${js.length} skills` : null); }
  if (c.notice_days === null || c.notice_days === undefined || j.notice_days === null || j.notice_days === undefined) part('notice', 0.5);
  else if (c.notice_days <= j.notice_days) part('notice', 1, c.notice_days === 0 ? 'Can join at once' : `Notice ${c.notice_days} days`);
  else if (c.notice_days <= j.notice_days * 2) part('notice', 0.5);
  else part('notice', 0);
  if (rating) part('rating', rating / 5, rating >= 4 ? `Rated ${rating.toFixed(1)}/5 in interviews` : null); else part('rating', 0.6);
  return { score: Math.round((score / total) * 100), reasons };
}
function isPlaced(candId) {
  const j = get("SELECT joined_at FROM applications WHERE candidate_id=? AND result='Hired' AND left_date IS NULL ORDER BY joined_at DESC LIMIT 1", candId);
  return j && j.joined_at && daysBetween(j.joined_at) < 183;
}
function bestMatches(job, limit = 10, forAlert = false) {
  const cands = all('SELECT * FROM candidates WHERE archived=0 AND junk=0 AND merged_into IS NULL AND removed=0');
  const onJob = new Set(all("SELECT candidate_id FROM applications WHERE job_id=? AND result='open'", job.id).map((r) => r.candidate_id));
  return cands
    .filter((c) => !onJob.has(c.id) && !isPlaced(c.id) && (!forAlert || (c.looking !== 'Not looking' && !c.opted_out)))
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
function createApplication(candId, jobId, by, source, note) {
  const cand = get('SELECT * FROM candidates WHERE id=?', candId); const job = get('SELECT * FROM jobs WHERE id=?', jobId);
  if (!cand || !job) throw httpError(404, 'Candidate or job opening not found');
  if (get("SELECT 1 FROM applications WHERE candidate_id=? AND job_id=? AND result='open'", candId, jobId)) throw httpError(400, `${cand.name} already has an open application on ${jobId}.`);
  const id = nextId('AP');
  insert('applications', { id, candidate_id: candId, job_id: jobId, step: 'Applied', result: 'open', owner_id: by && by.uid ? by.uid : job.recruiter_id, source: source || cand.source, step_since: now(), created_by: by && by.uid ? by.uid : null, created_at: now(), checklist: {}, joining_docs: [] });
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
  }
  recalcJob(app.job_id, actorName(by), `${appId} → ${step}`);
  return get('SELECT * FROM applications WHERE id=?', appId);
}
function closeApplication(appId, reason, by, note) {
  const app = get('SELECT * FROM applications WHERE id=?', appId);
  if (!app) throw httpError(404, 'Application not found');
  if (!settings().closing_reasons.includes(reason)) throw httpError(400, 'Pick a closing reason');
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
function reopenApplication(appId, by) {
  const app = get('SELECT * FROM applications WHERE id=?', appId);
  if (app.result === 'open') return app;
  if (get("SELECT 1 FROM applications WHERE candidate_id=? AND job_id=? AND result='open' AND id!=?", app.candidate_id, app.job_id, appId)) throw httpError(400, 'There is already an open application for this candidate on this job.');
  const step = app.result === 'Hired' ? 'Offer accepted' : app.step;
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
  const round = o.round === 'client' ? 'client' : 'ours';
  const id = nextId('IV');
  insert('interviews', { id, app_id: appId, round, name: o.name || (round === 'ours' ? 'Round 1' : 'Client round'), at: new Date(o.at).toISOString(), place: o.place || 'Office', interviewer: o.interviewer || '', status: 'Scheduled', qa: [], confirmed: 0, created_by: by && by.uid, created_at: now() });
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
function ivVars(iv, job) {
  return { round: iv.round === 'ours' ? 'interview' : 'interview with the client', job: job.title, date: istFmt(iv.at, false), time: istTime(iv.at), place: iv.place };
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
      if (o.result === 'Move ahead') { moveStep(app.id, 'Sent to client', by, `${ivId}: ${o.remark}`); next = `${app.id} moved to Sent to client`; }
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
  return { ...iv, view_status: pending ? 'Result pending' : iv.status };
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
    id, company: d.company || '', contact: d.contact || '', whatsapp: phone, email: d.email || '', city: d.city || '', state: d.state || stateOf(d.city),
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
    if (d.city) { fill.city = d.city; fill.state = d.state || stateOf(d.city); }
    if (d.exp_total !== undefined && d.exp_total !== null && d.exp_total !== '') fill.exp_total = d.exp_total;
    update('candidates', existing.id, { ...fill, is_new: 1, last_updated: now() });
    insert('notes', { record_id: existing.id, text: `Came again from ${source} on ${istFmt(now(), false)}`, author: who, at: now() });
    history(who, 'repeat lead', existing.id, null, null, source);
    if (o.consent !== false) { saveConsent('candidate', existing.id, source, o.wording); update('candidates', existing.id, { consent_alerts: 1 }); }
    return { candidate: get('SELECT * FROM candidates WHERE id=?', existing.id), isNew: false };
  }
  const id = nextId('CA');
  const repeat = d.email ? get('SELECT id FROM candidates WHERE lower(email)=lower(?) AND merged_into IS NULL', d.email) : null;
  const agency = by && by.agency_id ? by.agency_id : null;
  insert('candidates', {
    id, name: d.name, whatsapp: phone, email: d.email || '', city: d.city || '', state: d.state || stateOf(d.city), work_cities: d.work_cities || (d.city ? [d.city] : []),
    job_wanted: d.job_wanted || '', department: dept, exp_total: d.exp_total ?? null, exp_jewellery: d.exp_jewellery ?? null,
    cur_salary: d.cur_salary ?? null, exp_salary: d.exp_salary ?? null, notice_days: d.notice_days ?? null, skills: d.skills || [], current_company: d.current_company || '',
    cv_file: d.cv_file || null, source, ref_by: d.ref_by || null, tieup_id: d.tieup_id || null, agency_id: agency, recruiter_id: by && by.uid ? by.uid : null,
    is_new: by && by.uid ? 0 : 1, consent_alerts: o.consent !== false ? 1 : 0, possible_repeat_of: repeat ? repeat.id : null,
    needs_check: o.needsCheck || (!phone ? 'No phone found' : null), last_updated: now(), old_code: d.old_code || null, created_by: who, created_at: d.created_at || now(),
  });
  history(who, 'create', id, null, null, `Candidate ${d.name} from ${source}`);
  if (o.consent !== false) saveConsent('candidate', id, source, o.wording);
  if (o.consent !== false && !o.silent && phone) sendWA({ ptype: 'candidate', pid: id, format: 'bbhs_candidate_welcome', vars: { candidate_id: id, link: link('my-profile') }, auto: true, rule: 'candidate_welcome', dedupe: `welcome:${id}` });
  if (o.consent === false && !o.silent && phone) sendWA({ ptype: 'candidate', pid: id, format: 'bbhs_consent_request', auto: true, dedupe: `consent:${id}` });
  if (d.apply_job) { try { createApplication(id, d.apply_job, by || { label: 'Candidate' }, source, 'Applied from a job link'); } catch { /* job closed or missing */ } }
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

module.exports = {
  STEPS, stepIdx, digits10, validPhone, inr, istDay, istFmt, istTime, istHour, inQuiet, next9am, daysBetween, addDays, hashPassword, checkPassword, newPassword, sha,
  jobList, deptOf, stateOf, person, fillFormat, windowOpenUntil, sendWA, setDispatcher, alertUser, link, agencyAdmin, superAdmins,
  computeJobStatus, jobStatusReason, recalcJob, filledCount, appsOfJob, matchScore, ratingOf, bestMatches, isPlaced, salaryText, autoJobAlert,
  feeFor, gstFor, fyOf, billView, refreshBill, createBillForApp, issueBill, upiLink,
  appHist, createApplication, moveStep, closeApplication, reopenApplication, scheduleInterview, recordInterview, interviewView, ivVars, recordOffer, leftJob, jobAction,
  CONSENT_WORDING, saveConsent, intakeClient, intakeCandidate, assignLead, mergeRecords, resolveId, receiveReply, actorName,
};
