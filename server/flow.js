// The working process from first client call to payment: call notes, agreement, client emails, online lookup, jobs
// from notes, mass hiring, creatives, screening with AI, CVs for clients, offer stages, invoices through Accounts,
// the admin's books, and the list of messages on hold.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./db');
const L = require('./logic');
const V = require('./views');
const F = require('./files');
const R = require('./router');
const M = require('./mailer');
const LLM = require('./llm');
const RES = require('./resume');
const TEAM = require('./api-team');
const { route, isSuper, seeClient, seeJob, seeBill } = R;
const { get, all, insert, update, run, now, httpError } = D;

D.db.exec(`
CREATE TABLE IF NOT EXISTS client_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT, openings TEXT, location TEXT, department TEXT, roles TEXT, skills TEXT, duties TEXT, notes TEXT, job_id TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS creatives (job_id TEXT PRIMARY KEY, status TEXT, brief TEXT, link TEXT, note TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS ai_fit (candidate_id TEXT, job_id TEXT, score INTEGER, points TEXT, gaps TEXT, key TEXT, at TEXT, PRIMARY KEY (candidate_id, job_id));
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, agency_id TEXT, date TEXT, category TEXT, amount REAL, note TEXT, by TEXT, at TEXT, removed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS revenue_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, agency_id TEXT, date TEXT, kind TEXT, client_id TEXT, amount REAL, note TEXT, by TEXT, at TEXT, removed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS bill_followups (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT, note TEXT, next_at TEXT, by TEXT, at TEXT);
`);

const T = { auth: 'team' };
const CH = { auth: 'team', channels: true };
const C = { auth: 'client' };
const ADMINS = { auth: 'team', levels: ['super', 'admin'] };
const SUPER = { auth: 'team', levels: ['super'] };
const mustSee = (ok, what) => { if (!ok) throw httpError(403, `You cannot see this ${what}.`); };
const loadClient = (ctx) => { const c = get('SELECT * FROM clients WHERE id=?', ctx.params.id); mustSee(seeClient(ctx.user, c), 'client'); return c; };
const loadJob = (ctx) => { const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j) || R.sameAgency(ctx.user, j), 'job opening'); return j; };
const loadApp = (ctx) => { const a = get('SELECT * FROM applications WHERE id=?', ctx.params.id); mustSee(R.seeApp(ctx.user, a), 'application'); return a; };
const loadBill = (ctx) => { const b = get('SELECT * FROM bills WHERE id=?', ctx.params.id); mustSee(b && seeBill(ctx.user, b), 'bill'); return b; };
const money = (y) => (y ? L.inr(y) : '');

// ---------- Recruitment Agreement: the standard copy for every login ----------
const BUNDLED = path.join(__dirname, '..', 'assets', 'Recruitment Agreement.docx');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function agreementFile() {
  const f = get("SELECT * FROM files WHERE record_id='AGREEMENT' AND type='agreement' AND replaced=0 ORDER BY id DESC LIMIT 1");
  if (f) return { name: f.name, mime: f.mime || DOCX, buf: F.readStored(f), at: f.at };
  if (!fs.existsSync(BUNDLED)) return null;
  return { name: 'Recruitment Agreement.docx', mime: DOCX, buf: fs.readFileSync(BUNDLED), at: null };
}
function agreementView() {
  const f = agreementFile(); if (!f) return { name: '', text: '', at: null };
  let text = '';
  if (/\.docx$/i.test(f.name)) {
    const xml = (F.unzip(f.buf)['word/document.xml'] || Buffer.alloc(0)).toString('utf8');
    text = xml.split(/<\/w:p>/).map((p) => p.replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return { name: f.name, text, at: f.at };
}
const agreementDownload = () => { const f = agreementFile(); if (!f) throw httpError(404, 'The agreement has not been added yet.'); return { __file: { name: f.name, mime: f.mime, buf: f.buf } }; };
route('GET', '/api/agreement', CH, () => agreementView());
route('GET', '/api/agreement/file', CH, () => agreementDownload());
route('GET', '/api/client/agreement', C, () => agreementView());
route('GET', '/api/client/agreement/file', C, () => agreementDownload());
route('POST', '/api/agreement', SUPER, async (ctx) => {
  if (!/\.(docx|pdf)$/i.test(ctx.body.name || '')) throw httpError(400, 'Upload the agreement as a Word or PDF file');
  return F.saveFile({ recordId: 'AGREEMENT', type: 'agreement', name: ctx.body.name, base64: ctx.body.base64, by: ctx.actor.label });
});
// Files to attach to an email, read when it goes out.
function mailFiles(list) {
  const out = [];
  for (const a of list || []) {
    if (a.agreement) { const f = agreementFile(); if (f) out.push({ name: f.name, mime: f.mime, buf: f.buf }); } else if (a.file_id) { const f = get('SELECT * FROM files WHERE id=?', a.file_id); if (f) out.push({ name: f.name, mime: f.mime, buf: F.readStored(f) }); }
  }
  return out;
}

// ---------- the first call with a client ----------
route('GET', '/api/call-script', T, () => ({ script: D.settings().call_script }));
route('POST', '/api/clients/:id/calls', T, (ctx) => {
  const c = loadClient(ctx); const b = ctx.body || {};
  if (!['openings', 'location', 'department', 'roles', 'skills', 'duties'].some((k) => String(b[k] || '').trim())) throw httpError(400, 'Fill in what the client told you', 'roles');
  const row = { client_id: c.id, openings: b.openings || '', location: b.location || '', department: b.department || '', roles: b.roles || '', skills: b.skills || '', duties: b.duties || '', notes: b.notes || '', by: ctx.actor.label, at: now() };
  insert('client_calls', row);
  const line = [['Number of openings', row.openings], ['Location', row.location], ['Department', row.department], ['Roles', row.roles], ['Skills required', row.skills], ['Roles and responsibilities expected', row.duties], ['Notes', row.notes]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
  insert('notes', { record_id: c.id, text: `Client call\n${line}`, author: ctx.actor.label, at: now() });
  const ob = { ...(c.onboarding || {}), intro_call: { done: true, date: now(), by: ctx.actor.label, note: '' } }; const st = D.settings().client_stages;
  update('clients', c.id, { onboarding: ob, is_new: 0, ...(st.indexOf('Understanding needs') > st.indexOf(c.stage) ? { stage: 'Understanding needs' } : {}) });
  D.history(ctx.actor.label, 'client call', c.id);
  return { ok: true };
});
route('POST', '/api/clients/:id/thanks', T, (ctx) => {
  const c = loadClient(ctx);
  const r = L.sendWA({ ptype: 'client', pid: c.id, format: 'bbhs_client_thanks', by: ctx.actor, rule: 'client_thanks' });
  if (r && r.skipped) throw httpError(400, r.skipped);
  return { held: r.status === 'held', status: r.status };
});
route('POST', '/api/clients/:id/group', T, (ctx) => {
  const c = loadClient(ctx); const b = ctx.body || {};
  const g = { name: b.name || `${c.company} × BrillBrains`, link: b.link || '', dp_file: b.dp_file || (c.wa_group || {}).dp_file || null, created: !!b.created, at: b.created ? (c.wa_group || {}).at || now() : null, by: ctx.actor.label };
  D.edit('clients', c.id, { wa_group: g }, ctx.actor.label, ctx.ip); return g;
});

// ---------- email from the portal: one client or many ----------
route('GET', '/api/email-templates', T, () => ({ templates: D.settings().email_templates, held: !!(D.settings().wa_pause || {}).email, can_send: M.configured() }));
route('POST', '/api/clients/email', T, (ctx) => {
  const b = ctx.body || {}; const ids = (b.ids || []).map(String).slice(0, 200); const sender = ctx.user.name;
  if (!ids.length) throw httpError(400, 'Pick at least one client');
  if (!String(b.subject || '').trim()) throw httpError(400, 'Write the subject', 'subject');
  if (!String(b.body || '').trim()) throw httpError(400, 'Write the message', 'body');
  const out = { done: 0, held: 0, skipped: [] }; const isContract = b.kind === 'contract';
  for (const id of ids) {
    const c = get('SELECT * FROM clients WHERE id=? AND removed=0', id); if (!c || !seeClient(ctx.user, c)) { out.skipped.push(`${id}: not found`); continue; }
    const to = c.email || (c.extra || {}).hr_email; if (!to) { out.skipped.push(`${c.company}: no email`); continue; }
    const fill = (t) => String(t).replace(/\{(company|contact|sender)\}/g, (m, k) => ({ company: c.company, contact: c.contact || 'Sir/Madam', sender }[k]));
    const subject = fill(b.subject); const text = fill(b.body);
    const html = M.layout(subject, text.split(/\n{2,}/).map((p) => `<p style="font-size:14px;line-height:1.65;margin:0 0 12px">${p.split('\n').map((x) => x.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))).join('<br>')}</p>`).join(''));
    const eid = M.queue({ to, subject, text, html, kind: b.kind || 'client_mail', recordId: c.id, attachments: b.attach_agreement ? [{ agreement: true }] : [] });
    if (!eid) { out.skipped.push(`${c.company}: not a valid email`); continue; }
    if (isContract) {
      const st = D.settings().client_stages;
      update('clients', c.id, { onboarding: { ...(c.onboarding || {}), proposal: { done: true, date: now(), by: ctx.actor.label, note: 'Agreement emailed' } }, ...(st.indexOf('Agreement shared') > st.indexOf(c.stage) ? { stage: 'Agreement shared' } : {}) });
    }
    insert('notes', { record_id: c.id, text: `Email${get('SELECT status FROM emails WHERE id=?', eid).status === 'held' ? ' saved (messages are off)' : ' sent'}: ${subject}`, author: ctx.actor.label, at: now() });
    out.done++; if (get('SELECT status FROM emails WHERE id=?', eid).status === 'held') out.held++;
  }
  D.history(ctx.actor.label, 'client email', null, 'emails', null, `${out.done} of ${ids.length}: ${b.subject}`);
  return out;
});

// A client's reply with papers: the file lands on the client, whoever owns them gets an alert. Called by the inbox reader.
async function clientMail(c, subject, text, attachments) {
  const saved = [];
  for (const a of attachments || []) {
    try { const f = await F.saveFile({ recordId: c.id, type: /sign|contract|agreement/i.test(`${a.name} ${subject}`) ? 'contract_signed' : 'client_mail', name: a.name, base64: a.buf.toString('base64'), by: 'Email inbox' }); saved.push(f.name || a.name); } catch (e) { insert('notes', { record_id: c.id, text: `Attachment ${a.name} not saved: ${e.message}`, author: 'Email inbox', at: now() }); }
  }
  insert('notes', { record_id: c.id, text: `Email from the client: ${subject || '(no subject)'}${text ? ` — ${String(text).trim().slice(0, 300)}` : ''}${saved.length ? `\nSaved: ${saved.join(', ')}` : ''}`, author: 'Email inbox', at: now() });
  if (c.owner_id) L.alertUser(c.owner_id, `${c.company} emailed${saved.length ? ` ${saved.length} file(s)` : ''}: check KYC and contract`, c.id, false);
}
const clientByEmail = (addr) => { const e = String(addr || '').toLowerCase(); if (!e) return null; return all('SELECT * FROM clients WHERE merged_into IS NULL AND removed=0').find((c) => String(c.email || '').toLowerCase() === e || String((c.extra || {}).hr_email || '').toLowerCase() === e) || null; };

// ---------- what the web says about a business (optional, paid per lookup) ----------
const S = (d) => ({ type: 'string', description: d });
const LOOK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['about', 'website', 'instagram', 'facebook', 'linkedin', 'phone', 'email', 'address', 'branches', 'est_year', 'owners', 'kind', 'sources'],
  properties: { about: S('2-3 lines on what the business does'), website: S('Official website; empty if none'), instagram: S('Instagram link; empty if none'), facebook: S('Facebook link; empty if none'), linkedin: S('LinkedIn link; empty if none'), phone: S('Public business phone; empty if none'), email: S('Public business email; empty if none'), address: S('Main address; empty if unknown'), branches: S('Number or list of branches; empty if unknown'), est_year: S('Year started; empty if unknown'), owners: S('Owners or directors named publicly; empty if unknown'), kind: S('Retailer, manufacturer, wholesaler, exporter or online brand; empty if unknown'), sources: { type: 'array', items: { type: 'string' }, description: 'Links you used' } },
};
route('POST', '/api/clients/:id/lookup', { auth: 'team', rate: { key: 'lookup', max: 20, minutes: 60 } }, async (ctx) => {
  const c = loadClient(ctx); const b = ctx.body || {}; const ex = c.extra || {};
  const r = await LLM.webLookup({
    system: 'You research Indian businesses for a recruitment agency. Search the web for the exact business named. Use only what you find, and leave a field empty rather than guess. If you cannot tell which business it is, say so in "about".',
    user: `Business: ${b.name || c.company}\nCity: ${b.city || c.city || ''}\nAddress: ${b.address || ex.address || ''}\nType: ${c.business_type || ''}`, schema: LOOK_SCHEMA, name: 'business',
  });
  const online = { ...r.answer, at: now(), by: ctx.actor.label }; update('clients', c.id, { extra: { ...ex, online } });
  D.history(ctx.actor.label, 'online lookup', c.id);
  return { ...online, usage: r.usage };
});

// ---------- jobs: from pasted notes, and many cities at once ----------
const JOB_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'city', 'openings', 'skills', 'duties', 'sal_from', 'sal_to', 'exp_from', 'exp_to', 'notice_days', 'jewellery', 'priority', 'notes'],
  properties: { title: S('The job title, from the list when one fits'), city: S('City'), openings: { type: 'number' }, skills: { type: 'array', items: { type: 'string' } }, duties: S('Roles and responsibilities, one per line'), sal_from: { type: ['number', 'null'], description: 'Rupees a month' }, sal_to: { type: ['number', 'null'], description: 'Rupees a month' }, exp_from: { type: ['number', 'null'] }, exp_to: { type: ['number', 'null'] }, notice_days: { type: ['number', 'null'] }, jewellery: { type: 'string', enum: ['Required', 'Preferred', 'Not required'] }, priority: { type: 'string', enum: ['High', 'Medium', 'Low'] }, notes: S('Anything else worth keeping') },
};
function ruleNotes(text) {
  const t = String(text); const pick = (re) => (re.exec(t) || [])[1];
  const n = (x) => (x === undefined ? null : Number(x));
  return { title: (pick(/(?:role|position|designation|hiring for)s?\s*[:\-]\s*(.+)/i) || '').trim(), city: (pick(/(?:location|city)\s*[:\-]\s*(.+)/i) || '').trim(), openings: n(pick(/(?:openings?|vacanc(?:y|ies)|positions?)\s*[:\-]?\s*(\d+)/i)) || 1, skills: (pick(/skills?(?: required)?\s*[:\-]\s*(.+)/i) || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean), duties: (pick(/responsibilit(?:y|ies)[^:\n]*[:\-]\s*(.+)/i) || '').trim(), sal_from: null, sal_to: null, exp_from: n(pick(/(\d+)\s*(?:\+|to|-)?\s*\d*\s*(?:years?|yrs?)/i)), exp_to: null, notice_days: null, jewellery: /jewell?ery/i.test(t) ? 'Required' : 'Preferred', priority: /urgent|immediate/i.test(t) ? 'High' : 'Medium', notes: t.slice(0, 1500) };
}
route('POST', '/api/jobs/from-notes', { auth: 'team', rate: { key: 'jobnotes', max: 40, minutes: 60 } }, async (ctx) => {
  const text = String((ctx.body || {}).text || '').trim(); if (text.length < 10) throw httpError(400, 'Paste the notes first', 'text');
  if (!LLM.available()) return { job: ruleNotes(text), ai: false };
  const titles = L.jobList().map((j) => j.title).slice(0, 300).join(', ');
  try {
    const job = await LLM.json({ system: `You turn a recruiter's call notes into a job opening for a recruitment agency in India's jewellery trade. Use only what the notes say; leave unknown things null or empty. Salaries in LPA become rupees a month. "jewellery" is "Required" when jewellery experience is demanded or the employer is a jewellery business and the role needs trade knowledge. Prefer a title from this list when one fits: ${titles}`, user: text.slice(0, 6000), schema: JOB_SCHEMA, name: 'job', maxTokens: 1200 });
    return { job, ai: true };
  } catch (e) { return { job: ruleNotes(text), ai: false, note: e.message }; }
});
route('POST', '/api/jobs/mass', T, (ctx) => {
  const b = ctx.body || {}; const c = get('SELECT * FROM clients WHERE id=?', b.client_id); mustSee(seeClient(ctx.user, c), 'client');
  if (!b.title) throw httpError(400, 'Pick the role', 'title');
  const rows = String(b.lines || '').split(/\n+/).map((l) => /^\s*(.+?)\s*[:\-,=]\s*(\d+)\s*$/.exec(l)).filter(Boolean).map((m) => ({ city: m[1], openings: Number(m[2]) }));
  if (!rows.length) throw httpError(400, 'Write one city per line, like Mumbai: 20', 'lines');
  const batch = `MH-${Date.now().toString(36).toUpperCase()}`; const jobs = [];
  for (const x of rows) {
    const r = TEAM.createJob(c, { ...b, city: x.city, openings: x.openings, recruiter_id: ctx.user.level === 'sub' ? ctx.user.id : b.recruiter_id || undefined, priority: b.priority || 'High', notes: b.notes || '' }, ctx.actor, false);
    update('jobs', r.id, { mass_batch: batch }); jobs.push(r.id);
  }
  D.history(ctx.actor.label, 'mass hiring', c.id, null, null, `${rows.reduce((t, x) => t + x.openings, 0)} ${b.title} in ${rows.length} cities`);
  return { batch, jobs, total: rows.reduce((t, x) => t + x.openings, 0) };
});

// ---------- creatives: the social media specialist's steps for each job ----------
const CREATIVE = ['Brief shared', 'With designer', 'Sent for approval', 'Approved', 'Posted'];
function briefOf(j) {
  const v = V.jobView(j); const jd = j.jd || {}; const c = get('SELECT business_type FROM clients WHERE id=?', j.client_id) || {};
  const vars = { title: j.title, client_type: c.business_type || '', city: j.city || '', openings: j.openings, salary: v.salary_text || '', experience: j.exp_from !== null && j.exp_from !== undefined ? `${j.exp_from}-${j.exp_to ?? '+'} years` : '', must: String(jd.must || (j.skills || []).join(', ')).replace(/\n/g, '; '), link: L.link('apply', `?job=${j.id}`) };
  return String(D.settings().creative_template || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}
route('GET', '/api/creatives', CH, () => ({ steps: CREATIVE, rows: Object.fromEntries(all('SELECT * FROM creatives').map((r) => [r.job_id, r])) }));
route('GET', '/api/creatives/:id', CH, (ctx) => { const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); if (!j) throw httpError(404, 'Job not found'); return { ...(get('SELECT * FROM creatives WHERE job_id=?', j.id) || {}), steps: CREATIVE, brief: (get('SELECT brief FROM creatives WHERE job_id=?', j.id) || {}).brief || briefOf(j), title: j.title }; });
route('POST', '/api/creatives', CH, (ctx) => {
  const b = ctx.body || {}; const ids = (b.ids || []).map(String).slice(0, 200); const limited = R.channelOnly(ctx.user);
  if (!ids.length) throw httpError(400, 'Tick some jobs first');
  if (b.status && !CREATIVE.includes(b.status)) throw httpError(400, 'Pick a step');
  if (b.status === 'Approved' && limited) throw httpError(403, 'An admin approves the creative.');
  let done = 0;
  for (const id of ids) {
    const j = get('SELECT * FROM jobs WHERE id=?', id); if (!j || !(limited || seeJob(ctx.user, j) || R.sameAgency(ctx.user, j))) continue;
    const old = get('SELECT * FROM creatives WHERE job_id=?', id);
    const row = { job_id: id, status: b.status || (old || {}).status || 'Brief shared', brief: b.brief ?? (old || {}).brief ?? briefOf(j), link: b.link ?? (old || {}).link ?? '', note: b.note ?? (old || {}).note ?? '', by: ctx.actor.label, at: now() };
    if (old) { const { job_id, ...rest } = row; update('creatives', id, rest, 'job_id'); } else insert('creatives', row);
    D.history(ctx.actor.label, 'creative', id, 'status', (old || {}).status || null, row.status); done++;
  }
  return { done };
});

// ---------- screening: the best people for a job, from applications and the resume bank ----------
const cleanText = (t, c) => {
  let s = String(t || '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ').replace(/https?:\/\/\S+|www\.\S+|wa\.me\/\S+|linkedin\.com\/\S+/gi, ' ').replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 10 ? ' ' : m));
  if (c && c.whatsapp) s = s.split(c.whatsapp).join(' ');
  if (c && c.email) s = s.split(c.email).join(' ');
  return s;
};
function jobFacts(j) {
  const jd = j.jd || {}; const pm = (y) => (y ? Math.round(y / 12) : null);
  return { title: j.title, city: j.city, department: j.department, experience_years: [j.exp_from, j.exp_to], salary_per_month: [pm(j.sal_from), pm(j.sal_to)], join_within_days: j.notice_days, skills: j.skills || [], summary: jd.summary || '', duties: jd.duties || '', must_have: jd.must || '', good_to_have: jd.good || '', jewellery_experience: jd.jewel_need ? { need: jd.jewel_need, years: jd.jewel_years || '', detail: jd.jewel_note || '' } : 'not stated', notes: j.notes || '' };
}
function candFacts(c) {
  const pm = (y) => (y ? Math.round(y / 12) : null);
  return { id: c.id, wants: c.job_wanted, city: c.city, will_work_in: c.work_cities || [], experience_years: c.exp_total, jewellery_years: c.exp_jewellery, worked_with: c.exp_business || [], current_company: c.current_company, domain: c.domain, skills: c.skills || [], salary_now: pm(c.cur_salary), salary_expected: pm(c.exp_salary), notice_days: c.notice_days, cv: cleanText(RES.cvTextOf(c), c).replace(/\s+/g, ' ').slice(0, 1800) };
}
const fitKey = (j, c) => crypto.createHash('sha1').update(JSON.stringify([jobFacts(j), c.cv_file, c.last_updated, c.skills, c.exp_total])).digest('hex');
const fitOf = (j, c) => { const r = get('SELECT * FROM ai_fit WHERE candidate_id=? AND job_id=?', c.id, j.id); if (!r || r.key !== fitKey(j, c)) return null; return { score: r.score, points: JSON.parse(r.points || '[]'), gaps: JSON.parse(r.gaps || '[]') }; };
const FIT_SCHEMA = { type: 'object', additionalProperties: false, required: ['results'], properties: { results: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'score', 'points', 'gaps'], properties: { id: { type: 'string' }, score: { type: 'number', description: '0 to 100' }, points: { type: 'array', items: { type: 'string' }, description: '2 to 4 short reasons this person suits the job, with facts from their profile' }, gaps: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short risks or missing things to check on the call' } } } } } };
const FIT_SYSTEM = `You screen candidates for a recruitment agency in India's jewellery trade. For each candidate, judge how well they suit this job from the facts and CV given, and write key pointers a recruiter can read in seconds.
Score honestly: 85+ strong fit on role, experience and must-haves; 60-84 worth a call; below 60 weak. If jewellery experience is "Required", a person without it cannot score above 55.
Base every point on what is written. Never invent experience. Short phrases, no full stops.`;
async function fitBatch(job, cands) {
  const r = await LLM.json({ system: FIT_SYSTEM, user: `Job:\n${JSON.stringify(jobFacts(job))}\n\nCandidates:\n${JSON.stringify(cands.map(candFacts))}`, schema: FIT_SCHEMA, name: 'screening', maxTokens: 2500 });
  let saved = 0;
  for (const x of r.results || []) {
    const c = cands.find((k) => k.id === x.id); if (!c) continue;
    D.run('INSERT OR REPLACE INTO ai_fit (candidate_id, job_id, score, points, gaps, key, at) VALUES (?,?,?,?,?,?,?)', c.id, job.id, Math.max(0, Math.min(100, Math.round(x.score))), JSON.stringify((x.points || []).slice(0, 4)), JSON.stringify((x.gaps || []).slice(0, 3)), fitKey(job, c), now()); saved++;
  }
  return saved;
}
const openApps = (j) => all("SELECT * FROM applications WHERE job_id=? AND result='open' ORDER BY created_at DESC", j.id);
const bankOf = (j, n) => L.bestMatches(j, n).filter((m) => m.score >= D.settings().match.show);
function rowFor(j, c, sc, extra) {
  const ai = fitOf(j, c);
  return { candidate_id: c.id, name: c.name, city: c.city, wants: c.job_wanted, exp: c.exp_total, jewellery: c.exp_jewellery, score: ai ? ai.score : sc.score, by_ai: !!ai, points: ai ? ai.points : sc.reasons, gaps: ai ? ai.gaps : sc.gaps, source: c.source, has_cv: !!c.cv_file, ...extra };
}
route('GET', '/api/jobs/:id/screen', T, (ctx) => {
  const j = loadJob(ctx);
  const apps = openApps(j).map((a) => { const c = get('SELECT * FROM candidates WHERE id=?', a.candidate_id); return rowFor(j, c, L.matchScore(c, j, L.ratingOf(c.id)), { app_id: a.id, step: a.step, screen: a.screen }); }).sort((x, y) => y.score - x.score);
  const seen = new Set(all('SELECT candidate_id FROM applications WHERE job_id=?', j.id).map((r) => r.candidate_id));
  const bank = bankOf(j, 40).filter((m) => !seen.has(m.c.id)).slice(0, 15).map((m) => rowFor(j, m.c, m, {})).sort((x, y) => y.score - x.score);
  return { apps, bank, ai: LLM.available(), scored: apps.concat(bank).filter((x) => x.by_ai).length };
});
route('POST', '/api/jobs/:id/ai-fit', { auth: 'team', rate: { key: 'aifit', max: 60, minutes: 60 } }, async (ctx) => {
  const j = loadJob(ctx); const seen = new Set();
  const apps = openApps(j).map((a) => get('SELECT * FROM candidates WHERE id=?', a.candidate_id));
  const onJob = new Set(all('SELECT candidate_id FROM applications WHERE job_id=?', j.id).map((r) => r.candidate_id));
  const bank = bankOf(j, 40).filter((m) => !onJob.has(m.c.id)).slice(0, 15).map((m) => m.c);
  const todo = [...apps, ...bank].filter((c) => { if (seen.has(c.id) || fitOf(j, c)) return false; seen.add(c.id); return true; });
  const now8 = todo.slice(0, 8); if (!now8.length) return { done: 0, left: 0 };
  const done = await fitBatch(j, now8);
  return { done, left: todo.length - now8.length };
});
// Several at once: every ticked job, or all open jobs with people waiting on them.
route('POST', '/api/applications/screen-bulk', T, (ctx) => {
  const b = ctx.body || {}; const out = { done: 0, errors: [] };
  for (const id of (b.ids || []).slice(0, 200)) { try { const a = get('SELECT * FROM applications WHERE id=?', id); mustSee(R.seeApp(ctx.user, a), 'application'); L.screenApplication(id, b.verdict, ctx.actor, b.note); out.done++; } catch (e) { out.errors.push(`${id}: ${e.message}`); } }
  return out;
});

// ---------- the CV the client sees: no phone, no email ----------
function clientCvLines(c) {
  const head = [{ text: `${c.id} · ${c.job_wanted || ''}`, bold: true, size: 12 }, `City: ${c.city || '-'}  ·  Will work in: ${(c.work_cities || []).join(', ') || c.city || '-'}`, `Experience: ${c.exp_total ?? '-'} years (jewellery ${c.exp_jewellery ?? '-'})`, `Current company: ${c.current_company || '-'}`, `Expected salary: ${c.exp_salary ? `${L.inr(c.exp_salary / 12)} a month` : '-'}  ·  Notice: ${c.notice_days ?? '-'} days`, '', { text: 'Skills', bold: true }, (c.skills || []).join(', ') || '-', ''];
  const body = cleanText(RES.cvTextOf(c), c).split('\n').map((l) => l.replace(/\b(?:phone|mobile|mob|contact(?: no\.?)?|whatsapp|e-?mail|tel)\b\s*(?:no\.?)?\s*[:\-.]*\s*$/i, '').trimEnd()).filter((l, i, a) => l.trim() || (a[i - 1] || '').trim());
  return [...head, ...(body.join('').trim() ? [{ text: 'Resume', bold: true }, ...body] : []), '', 'Contact details are held by BrillBrains Hiring Solutions, who arrange all interviews.'];
}
function makeClientCv(c, by) {
  const f = F.storeBuffer({ recordId: c.id, type: 'short_cv', name: `CV-${c.id}.pdf`, buf: F.makePdf(`Candidate CV · ${String(c.name || '').split(' ')[0]}`, clientCvLines(c), D.settings().business), mime: 'application/pdf', by: L.actorName(by) });
  update('candidates', c.id, { short_cv_file: String(f.id), short_cv_for: c.cv_file || 'profile' });
  D.history(L.actorName(by), 'client cv', c.id); return f;
}
function clientCvFor(candId, by) { const c = get('SELECT * FROM candidates WHERE id=?', candId); if (!c) return null; return c.short_cv_file && c.short_cv_for === (c.cv_file || 'profile') ? get('SELECT * FROM files WHERE id=?', c.short_cv_file) : makeClientCv(c, by); }
route('POST', '/api/applications/:id/client-cv', T, (ctx) => { const a = loadApp(ctx); return makeClientCv(get('SELECT * FROM candidates WHERE id=?', a.candidate_id), ctx.actor); });

// ---------- offer stages and the invoice through Accounts ----------
const OFFER_STAGES = { verbal: ['verbal_at', 'Verbal offer made by the client'], verbal_ok: ['verbal_ok_at', 'Candidate accepted verbally'], letter: ['letter_at', 'Offer letter shared by the client'] };
route('POST', '/api/applications/:id/offer-stage', T, (ctx) => {
  const a = loadApp(ctx); const s = OFFER_STAGES[(ctx.body || {}).stage]; if (!s) throw httpError(400, 'Pick a stage');
  if (a.result !== 'open') throw httpError(400, 'This application is closed.');
  const on = ctx.body.on !== false; update('applications', a.id, { [s[0]]: on ? now() : null });
  L.appHist(a.id, a.step, ctx.actor, on ? s[1] : `Undone: ${s[1]}`, 'offer'); return { ok: true };
});
function askAccounts(a, actor) {
  if (!a.offer_ctc) throw httpError(400, 'Record the offer first: the invoice needs the yearly CTC.');
  const bill = L.createBillForApp(a, actor); if (!bill) throw httpError(400, 'Internal hiring has no invoice.');
  const b = get('SELECT * FROM bills WHERE id=?', bill.id); const v = V.appView(a); const c = get('SELECT * FROM clients WHERE id=?', b.client_id);
  const to = D.settings().accounts_email; const k = c.kyc || {};
  const pairs = [['Client', c.company], ['GSTIN', k.gstin || 'not given'], ['Client email', c.email || ''], ['Candidate', v.candidate_name], ['Position', v.job_title], ['Yearly CTC', L.inr(b.ctc)], ['Joining date', a.joining_date ? L.istFmt(a.joining_date, false) : ''], ['Our fee', L.inr(b.fee)], ['GST', L.inr(b.gst)], ['Total', L.inr(b.total)], ['Our reference', b.id]].filter(([, x]) => x);
  const sender = actor.label || 'BrillBrains Hiring';
  const text = `Please prepare the invoice for ${c.company}.\n\n${pairs.map(([x, y]) => `${x}: ${y}`).join('\n')}\n\nSend it directly to the client and keep Hiring Solutions in CC so that we get the invoice number.\n\nRegards,\n${sender}`;
  const eid = to ? M.queue({ to, subject: `Please prepare the invoice: ${c.company} (${b.id})`, text, html: M.layout('Please prepare the invoice', `<p style="font-size:14px;line-height:1.65">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`), kind: 'invoice_request', recordId: b.id }) : null;
  update('bills', b.id, { accounts_asked_at: now() }); L.appHist(a.id, a.step, actor, `Accounts asked for the invoice (${b.id})`, 'paper');
  return { bill_id: b.id, email: !to ? 'no address' : get('SELECT status FROM emails WHERE id=?', eid).status };
}
route('POST', '/api/applications/:id/ask-invoice', ADMINS, (ctx) => askAccounts(loadApp(ctx), ctx.actor));
route('POST', '/api/bills/:id/invoice', ADMINS, async (ctx) => {
  const b = loadBill(ctx); const x = ctx.body || {}; const no = String(x.invoice_no || '').trim(); if (!no) throw httpError(400, 'Enter the invoice number from Accounts', 'invoice_no');
  if (get('SELECT 1 FROM bills WHERE bill_no=? AND id!=?', no, b.id)) throw httpError(400, 'This invoice number is already on another bill', 'invoice_no');
  if (b.status === 'Draft') L.issueBill(b.id, ctx.actor, { bill_no: no }); else update('bills', b.id, { bill_no: no });
  if (x.file && x.file.base64) { const f = await F.saveFile({ recordId: b.id, type: 'invoice', name: x.file.name, base64: x.file.base64, by: ctx.actor.label }); update('bills', b.id, { invoice_file: String(f.id) }); }
  D.history(ctx.actor.label, 'invoice recorded', b.id, 'bill_no', b.bill_no, no);
  return get('SELECT * FROM bills WHERE id=?', b.id);
});
route('POST', '/api/bills/:id/followup', ADMINS, (ctx) => {
  const b = loadBill(ctx); const x = ctx.body || {}; if (!String(x.note || '').trim()) throw httpError(400, 'Write what the client said', 'note');
  const next = x.next_at ? new Date(x.next_at).toISOString() : null;
  insert('bill_followups', { bill_id: b.id, note: x.note, next_at: next, by: ctx.actor.label, at: now() });
  if (next) insert('followups', { record_id: b.id, at: next, note: `Payment follow-up: ${x.note}`, for_user: ctx.user.id, done: 0, created_by: ctx.user.id });
  return { ok: true };
});
route('GET', '/api/bills/:id/followups', T, (ctx) => { const b = loadBill(ctx); return all('SELECT * FROM bill_followups WHERE bill_id=? ORDER BY at DESC', b.id); });

// What to do next on an application, in the words of the process.
function nextStep(a, bill) {
  const ivs = all('SELECT * FROM interviews WHERE app_id=? ORDER BY at', a.id); const live = ivs.find((i) => ['Scheduled', 'Rescheduled'].includes(i.status));
  if (a.result === 'Hired') {
    if (!bill) return null; if (bill.status === 'Draft') return 'Record the invoice number from Accounts on the bill.';
    return bill.status === 'Paid' ? null : 'Follow up with the client until the payment is in.';
  }
  if (a.result !== 'open') return 'Closed. Look for more candidates on the job: its top matches are on the job page.';
  if (live) return `Record the result of ${live.name} once it is done.`;
  const passed = (m) => ivs.some((i) => i.round === 'ours' && i.mode === m && i.result === 'Move ahead');
  switch (a.step) {
    case 'Applied': case 'Screening': return 'Screen the CV: accept to call them, or mark it not suitable.';
    case 'Our interview': return !passed('phone') ? 'Schedule the telephonic round.' : !passed('video') ? 'Telephonic cleared. Schedule the virtual round.' : 'Virtual cleared. Send the CV to the client.';
    case 'Sent to client': return 'The CV goes without phone and email. When the client replies, schedule their interview.';
    case 'Client interview': return 'Record the client\'s decision. Selected goes to the offer; rejected goes back to searching.';
    case 'Offer made': return !a.verbal_at ? 'Note the client\'s verbal offer.' : !a.verbal_ok_at ? 'Note whether the candidate accepted verbally.' : !a.letter_at ? 'Note when the client shares the offer letter.' : bill && bill.accounts_asked_at ? 'Mark the offer accepted once the candidate accepts it.' : 'Ask Accounts to prepare the invoice.';
    case 'Offer accepted': return bill && bill.accounts_asked_at ? 'Mark joined on the joining date.' : 'Ask Accounts to prepare the invoice.';
    default: return null;
  }
}

// ---------- the admin's books: revenue, expenses and how the agency is doing ----------
function bookScope(ctx) {
  const u = ctx.user; const q = ctx.query || {};
  if (isSuper(u)) return { id: q.agency || null, has: (x) => !q.agency || x.agency_id === q.agency };
  const shared = R.sharedWith(u); return { id: u.agency_id, has: (x) => x.agency_id === u.agency_id || (shared && !x.agency_id) };
}
route('GET', '/api/books', ADMINS, (ctx) => {
  const sc = bookScope(ctx); const s = D.settings(); const u = ctx.user;
  const bills = all("SELECT * FROM bills WHERE status NOT IN ('Draft','Cancelled') AND credit_of IS NULL").filter(sc.has);
  const pays = all('SELECT p.* FROM payments p').map((p) => ({ ...p, agency_id: (get('SELECT agency_id FROM bills WHERE id=?', p.bill_id) || {}).agency_id })).filter(sc.has);
  const exp = all('SELECT * FROM expenses WHERE removed=0 ORDER BY date DESC, id DESC').filter(sc.has); const rev = all('SELECT * FROM revenue_logs WHERE removed=0 ORDER BY date DESC, id DESC').filter(sc.has);
  const m = {}; const row = (k) => (m[k] = m[k] || { month: k, billed: 0, received: 0, other: 0, expenses: 0, share: 0 });
  for (const b of bills) { const r = row(String(b.issued_at || b.date).slice(0, 7)); r.billed += b.fee; r.share += b.agency_share || 0; }
  for (const p of pays) row(String(p.date).slice(0, 7)).received += p.amount;
  for (const x of rev) row(String(x.date).slice(0, 7)).other += x.amount;
  for (const x of exp) row(String(x.date).slice(0, 7)).expenses += x.amount;
  const months = Object.values(m).sort((a, b) => (a.month < b.month ? 1 : -1)).map((r) => ({ ...r, net: r.billed + r.other - r.expenses }));
  const people = all("SELECT id, name, level FROM users WHERE status='On' AND level!='super'").filter((x) => { const f = get('SELECT agency_id FROM users WHERE id=?', x.id); return sc.has(f); }).map((x) => {
    const apps = all('SELECT a.step, a.result, a.joined_at FROM applications a JOIN jobs j ON j.id=a.job_id WHERE COALESCE(a.owner_id, j.recruiter_id)=?', x.id);
    const fee = all('SELECT b.fee FROM bills b JOIN applications a ON a.id=b.app_id JOIN jobs j ON j.id=a.job_id WHERE COALESCE(a.owner_id, j.recruiter_id)=? AND b.status NOT IN (\'Draft\',\'Cancelled\')', x.id).reduce((t, b) => t + b.fee, 0);
    return { id: x.id, name: x.name, level: x.level, applications: apps.length, sent: apps.filter((a) => L.stepIdx(a.step) >= 3).length, hires: apps.filter((a) => a.result === 'Hired').length, fee };
  });
  const dues = all("SELECT * FROM bills WHERE status='Issued' AND credit_of IS NULL").filter(sc.has).map(L.billView).reduce((t, b) => t + b.balance, 0);
  return { months, expenses: exp.slice(0, 200), revenue: rev.slice(0, 200), people, dues, categories: s.expense_categories, kinds: s.revenue_kinds, clients: isSuper(u) ? [] : undefined, agency: sc.id ? get('SELECT id, name FROM agencies WHERE id=?', sc.id) : null, agencies: isSuper(u) ? all('SELECT id, name FROM agencies') : [] };
});
const amount = (v) => { const n = Number(v); if (!n || n <= 0) throw httpError(400, 'Enter the amount', 'amount'); return n; };
const ownRow = (ctx, table) => { const r = get(`SELECT * FROM ${table} WHERE id=?`, ctx.params.id); if (!r || !bookScope(ctx).has(r)) throw httpError(404, 'Entry not found'); return r; };
route('POST', '/api/expenses', ADMINS, (ctx) => {
  const b = ctx.body || {}; const r = { agency_id: isSuper(ctx.user) ? b.agency_id || null : ctx.user.agency_id, date: b.date || L.istDay(), category: b.category || 'Other', amount: amount(b.amount), note: b.note || '', by: ctx.actor.label, at: now() };
  insert('expenses', r); D.history(ctx.actor.label, 'expense', null, r.category, null, r.amount); return { ok: true };
});
route('POST', '/api/expenses/:id/delete', ADMINS, (ctx) => { const r = ownRow(ctx, 'expenses'); update('expenses', r.id, { removed: 1 }); D.history(ctx.actor.label, 'expense removed', null, r.category, r.amount, null); return { ok: true }; });
route('POST', '/api/revenue', ADMINS, (ctx) => {
  const b = ctx.body || {}; const r = { agency_id: isSuper(ctx.user) ? b.agency_id || null : ctx.user.agency_id, date: b.date || L.istDay(), kind: b.kind || 'Other', client_id: b.client_id || null, amount: amount(b.amount), note: b.note || '', by: ctx.actor.label, at: now() };
  insert('revenue_logs', r); D.history(ctx.actor.label, 'revenue', null, r.kind, null, r.amount); return { ok: true };
});
route('POST', '/api/revenue/:id/delete', ADMINS, (ctx) => { const r = ownRow(ctx, 'revenue_logs'); update('revenue_logs', r.id, { removed: 1 }); D.history(ctx.actor.label, 'revenue removed', null, r.kind, r.amount, null); return { ok: true }; });

// ---------- messages on hold: everything to switch on later ----------
const MAIL_KINDS = {
  contract: ['Recruitment Agreement to a client', 'Email set-up'], kyc: ['KYC request to a client', 'Email set-up'], client_mail: ['Emails written to clients from the portal', 'Email set-up'], invoice_request: ['Invoice request to Accounts', 'Email set-up and the Accounts email in Settings'],
  new_client: ['New client alert to the team', 'Email set-up'], new_candidate: ['New candidate alert to the team', 'Email set-up'], client_confirmation: ['"We received your request" to clients', 'Email set-up'], candidate_confirmation: ['"Your application is in" to candidates', 'Email set-up'],
};
route('GET', '/api/holds', SUPER, () => {
  const s = D.settings(); const w = s.wa_pause || {}; const fm = s.formats || {};
  const held = Object.fromEntries(all("SELECT format k, COUNT(*) n, MAX(at) last FROM messages WHERE status='held' GROUP BY format").map((r) => [r.k || 'typed', r]));
  const rows = s.auto_rules.filter((r) => r.format).map((r) => {
    const f = fm[r.format] || {}; const h = held[r.format] || {};
    const need = [!f.approved && 'Meta approval of the template', f.off && 'Switch on in Message formats', !r.on && 'Switch on in Automatic messages', ['bbhs_login_code', 'bbhs_team_login'].includes(r.format) ? null : null].filter(Boolean);
    return { key: r.key, when: r.when, to: r.to, format: r.format, channel: 'WhatsApp and email', state: ['bbhs_login_code', 'bbhs_team_login'].includes(r.format) ? 'Stays on (logins)' : w.everyone ? 'Held' : 'On', held: h.n || 0, last: h.last || null, need };
  });
  const mails = all("SELECT kind k, COUNT(*) n, MAX(at) last FROM emails WHERE status='held' GROUP BY kind").map((r) => { const k = r.k || ''; const [label, need] = MAIL_KINDS[k] || (k.startsWith('copy:') ? [`Email copy of ${k.slice(5)}`, 'Email set-up'] : [k || 'Other email', 'Email set-up']); return { kind: k, label, need, held: r.n, last: r.last }; });
  return { wa: !!w.everyone, email: !!w.email, allow: w.allow || [], rows, mails, smtp: M.configured(), crm: !!s.crm.enabled, accounts_email: s.accounts_email || '', unapproved: Object.entries(fm).filter(([, f]) => !f.approved).map(([k]) => k) };
});

module.exports = { clientMail, clientByEmail, mailFiles, clientCvFor, makeClientCv, nextStep, cleanText };
