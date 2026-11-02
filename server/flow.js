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
// A client's own edited copy, when one was uploaded, stands in for the standard agreement.
const editedAgreement = (clientId) => get("SELECT * FROM files WHERE record_id=? AND type='agreement_client' AND replaced=0 ORDER BY id DESC LIMIT 1", clientId);
function agreementFile(clientId) {
  const own = clientId && editedAgreement(clientId);
  if (own) return { name: own.name, mime: own.mime, buf: F.readStored(own), at: own.at };
  const f = get("SELECT * FROM files WHERE record_id='AGREEMENT' AND type='agreement' AND replaced=0 ORDER BY id DESC LIMIT 1");
  if (f) return { name: f.name, mime: f.mime || DOCX, buf: F.readStored(f), at: f.at };
  if (!fs.existsSync(BUNDLED)) return null;
  return { name: 'Recruitment Agreement.docx', mime: DOCX, buf: fs.readFileSync(BUNDLED), at: null };
}
function agreementView(clientId) {
  const f = agreementFile(clientId); if (!f) return { name: '', text: '', at: null };
  let text = '';
  if (/\.docx$/i.test(f.name)) {
    let xml = ''; try { xml = (F.unzip(f.buf)['word/document.xml'] || Buffer.alloc(0)).toString('utf8'); } catch { /* opened as a file instead */ }
    text = xml.split(/<\/w:p>/).map((p) => p.replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return { name: f.name, text, at: f.at };
}
const agreementDownload = (clientId) => { const f = agreementFile(clientId); if (!f) throw httpError(404, 'The agreement has not been added yet.'); return { __file: { name: f.name, mime: f.mime, buf: f.buf } }; };
route('GET', '/api/agreement', CH, () => agreementView());
route('GET', '/api/agreement/file', CH, () => agreementDownload());
route('GET', '/api/client/agreement', C, (ctx) => agreementView(ctx.client.id));
route('GET', '/api/client/agreement/file', C, (ctx) => agreementDownload(ctx.client.id));
route('POST', '/api/agreement', SUPER, async (ctx) => {
  if (!/\.(docx|pdf)$/i.test(ctx.body.name || '')) throw httpError(400, 'Upload the agreement as a Word or PDF file');
  return F.saveFile({ recordId: 'AGREEMENT', type: 'agreement', name: ctx.body.name, base64: ctx.body.base64, by: ctx.actor.label });
});
// The generic offer letter, ready once the client selects someone.
const OFFER_TEMPLATE = path.join(__dirname, '..', 'assets', 'Generic_Offer_Letter_Montserrat_Clean.docx');
route('GET', '/api/offer-template/file', T, () => { if (!fs.existsSync(OFFER_TEMPLATE)) throw httpError(404, 'The offer letter template has not been added yet.'); return { __file: { name: 'Offer Letter Template.docx', mime: DOCX, buf: fs.readFileSync(OFFER_TEMPLATE) } }; });
// Files to attach to an email, read when it goes out.
function mailFiles(list) {
  const out = [];
  for (const a of list || []) {
    if (a.agreement) { const f = agreementFile(); if (f) out.push({ name: f.name, mime: f.mime, buf: f.buf }); } else if (a.file_id) { const f = get('SELECT * FROM files WHERE id=?', a.file_id); if (f) out.push({ name: f.name, mime: f.mime, buf: F.readStored(f) }); }
  }
  return out;
}

// ---------- the first call with a client ----------
if (!all('PRAGMA table_info(client_calls)').some((x) => x.name === 'call_roles')) D.db.exec('ALTER TABLE client_calls ADD COLUMN call_roles TEXT');
route('GET', '/api/call-script', T, () => ({ script: D.settings().call_script }));
// One call can carry many roles, each with its own count, location and department.
function callRoles(lines) {
  const txt = (v) => String(v ?? '').trim();
  const rows = (Array.isArray(lines) ? lines : []).map((x) => ({ role: txt(x.role), openings: txt(x.openings), location: txt(x.location), department: txt(x.department), skills: txt(x.skills), duties: txt(x.duties), notes: txt(x.notes) }));
  const named = rows.filter((x) => x.role || x.openings);
  if (named.some((x) => !x.role)) throw httpError(400, 'Write the role for every count', 'call_roles');
  const noCount = named.find((x) => !/^[1-9]\d*$/.test(x.openings)); if (noCount) throw httpError(400, `Write how many openings for ${noCount.role}`, 'call_roles');
  return { lines: named.map((x) => ({ ...x, openings: Number(x.openings), job_id: null })), loose: rows.filter((x) => !x.role && !x.openings).map((x) => [x.skills, x.duties, x.notes].filter(Boolean).join('\n')).filter(Boolean) };
}
// A role typed on a call joins the list, so it is suggested next time and on job forms.
function learnRoles(lines, industry) {
  const s = D.settings(); const key = s.industries[industry] ? industry : s.default_industry || Object.keys(s.industries)[0]; const ind = s.industries[key];
  const known = new Set(Object.values(ind.groups).flatMap((g) => g.jobs).map((x) => x.toLowerCase()));
  const fresh = [...new Set(lines.map((x) => x.role).filter((x) => !known.has(x.toLowerCase())))]; if (!fresh.length) return;
  const added = ind.groups['Added roles'] || { dept: 'Other', jobs: [] };
  D.setSetting('industries', { ...s.industries, [key]: { ...ind, groups: { ...ind.groups, 'Added roles': { ...added, jobs: [...added.jobs, ...fresh] } } } });
}
route('POST', '/api/clients/:id/calls', T, (ctx) => {
  const c = loadClient(ctx); const b = ctx.body || {}; const { lines, loose } = callRoles(b.call_roles);
  if (!lines.length && !loose.length) throw httpError(400, 'Fill in what the client told you', 'call_roles');
  learnRoles(lines, c.industry);
  const uniq = (k) => [...new Set(lines.map((x) => x[k]).filter(Boolean))].join(', ');
  const row = { client_id: c.id, openings: lines.length ? String(lines.reduce((t, x) => t + x.openings, 0)) : '', location: uniq('location'), department: uniq('department'), roles: lines.map((x) => `${x.role} (${x.openings})`).join(', '), call_roles: lines, skills: '', duties: '', notes: loose.join('\n'), by: ctx.actor.label, at: now() };
  insert('client_calls', row);
  const line = [['Number of openings', row.openings], ...lines.map((x) => [x.role, [`${x.openings} in ${x.location || c.city || 'no location given'}`, x.department, x.skills && `Skills: ${x.skills}`, x.duties && `Responsibilities: ${x.duties}`, x.notes && `Notes: ${x.notes}`].filter(Boolean).join('; ')]), ['Notes', row.notes]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
  insert('notes', { record_id: c.id, text: `Client call\n${line}`, author: ctx.actor.label, at: now() });
  const ob = { ...(c.onboarding || {}), intro_call: { done: true, date: now(), by: ctx.actor.label, note: '' } }; const st = D.settings().client_stages;
  update('clients', c.id, { onboarding: ob, is_new: 0, ...(st.indexOf('Understanding needs') > st.indexOf(c.stage) ? { stage: 'Understanding needs' } : {}) });
  D.history(ctx.actor.label, 'client call', c.id);
  return { ok: true };
});
// Every role not opened yet becomes a draft job. Salary and experience are filled on each job.
route('POST', '/api/clients/:id/calls/:call/jobs', T, (ctx) => {
  const c = loadClient(ctx); const k = get('SELECT * FROM client_calls WHERE id=? AND client_id=?', ctx.params.call, c.id); if (!k) throw httpError(404, 'Call not found');
  const lines = k.call_roles || []; const jobs = [];
  for (const x of lines.filter((l) => !l.job_id)) {
    const j = TEAM.createJob(c, { title: x.role, city: x.location, openings: x.openings, skills: String(x.skills || k.skills || '').split(',').map((s) => s.trim()).filter(Boolean), department: x.department || undefined, notes: [x.notes, k.notes].filter(Boolean).join('\n'), recruiter_id: ctx.user.level === 'sub' ? ctx.user.id : undefined }, ctx.actor, false);
    if (x.duties || k.duties) update('jobs', j.id, { jd: { ...(j.jd || {}), duties: x.duties || k.duties } });
    x.job_id = j.id; jobs.push(j.id);
  }
  if (!jobs.length) throw httpError(400, 'Every role on this call already has a job');
  update('client_calls', k.id, { call_roles: lines });
  return { jobs };
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
const clientEmail = (c) => c.email || (c.extra || {}).hr_email || '';
route('GET', '/api/email-templates', T, (ctx) => ({ templates: D.settings().email_templates, held: !!(D.settings().wa_pause || {}).email, can_send: M.configured(), from: D.ENV.smtp.from || '',
  recipients: String(ctx.query.ids || '').split(',').filter(Boolean).slice(0, 200).map((id) => get('SELECT * FROM clients WHERE id=? AND removed=0', id)).filter((c) => c && seeClient(ctx.user, c)).map((c) => ({ id: c.id, company: c.company, email: clientEmail(c), agreement: (editedAgreement(c.id) || {}).name || '' })) }));
route('POST', '/api/clients/email', T, (ctx) => {
  const b = ctx.body || {}; const ids = (b.ids || []).map(String).slice(0, 200); const sender = ctx.user.name;
  if (!ids.length) throw httpError(400, 'Pick at least one client');
  if (!String(b.subject || '').trim()) throw httpError(400, 'Write the subject', 'subject');
  if (!String(b.body || '').trim()) throw httpError(400, 'Write the message', 'body');
  const out = { done: 0, held: 0, skipped: [] }; const isContract = b.kind === 'contract';
  // The agreement is sent by a person, so it goes even while automatic messages are held.
  if (isContract && !M.configured()) throw httpError(400, 'Email is not set up on the server yet, so the agreement cannot go. Nothing was sent.');
  const typed = ids.length === 1 ? String(b.to || '').trim() : '';
  if (typed && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(typed)) throw httpError(400, 'Enter a valid email', 'to');
  for (const id of ids) {
    const c = get('SELECT * FROM clients WHERE id=? AND removed=0', id); if (!c || !seeClient(ctx.user, c)) { out.skipped.push(`${id}: not found`); continue; }
    const to = typed || clientEmail(c); if (!to) { if (ids.length === 1) throw httpError(400, 'Enter the client\'s email', 'to'); out.skipped.push(`${c.company}: no email`); continue; }
    if (typed && !clientEmail(c)) update('clients', c.id, { email: typed });
    const fill = (t) => String(t).replace(/\{(company|contact|sender)\}/g, (m, k) => ({ company: c.company, contact: c.contact || 'Sir/Madam', sender }[k]));
    const subject = fill(b.subject); const text = fill(b.body);
    const html = M.layout(subject, text.split(/\n{2,}/).map((p) => `<p style="font-size:14px;line-height:1.65;margin:0 0 12px">${p.split('\n').map((x) => x.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))).join('<br>')}</p>`).join(''));
    const eid = M.queue({ to, subject, text, html, kind: b.kind || 'client_mail', recordId: c.id, attachments: isContract || b.attach_agreement ? [editedAgreement(c.id) ? { file_id: editedAgreement(c.id).id } : { agreement: true }] : [], force: isContract, person: true });
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

// A signed copy by its file name, or a PDF or Word file sent on the agreement thread. KYC papers and logos in that thread are not one.
const KYC_FILE = /gst|\bpan\b|aadha+r|kyc|owner|id.?proof|logo/i;
const isSignedCopy = (name, subject) => !KYC_FILE.test(name) && (/sign|contract|agreement/i.test(name) || (/contract|agreement/i.test(subject || '') && /\.(pdf|docx?)$/i.test(name)));
// A client's reply with papers: the file lands on the client, whoever owns them gets an alert. Called by the inbox reader.
const KYC_NAMES = { gst: 'GST certificate', pan: 'Business PAN', owner_id: 'Owner ID' };
const kycByName = (n) => (/gst/i.test(n) ? 'gst' : /(^|[^a-z])pan([^a-z]|$)/i.test(n) ? 'pan' : /aadha+r|owner.?id|id.?proof|passport|driving|voter/i.test(n) ? 'owner_id' : null);
// What a client's attachment is: the AI reads PDFs and pictures when it can, otherwise the file name and subject decide.
async function readPaper(a, subject) {
  if (LLM.available() && /\.(pdf|jpe?g|png)$/i.test(a.name)) {
    try {
      const r = await LLM.json({ system: 'You sort papers a client company emails to a recruitment firm. gst: GST registration certificate. pan: PAN card of the business. owner_id: an ID proof of a person, such as Aadhaar, PAN of the owner, passport or driving licence. signed_agreement: a recruitment agreement that shows a signature or stamp. unsigned_agreement: the agreement with nothing signed. other: anything else.', user: `File name: ${a.name}\nEmail subject: ${subject || ''}`, schema: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { type: 'string', enum: ['gst', 'pan', 'owner_id', 'signed_agreement', 'unsigned_agreement', 'other'] } } }, name: 'client_paper', maxTokens: 60, files: [{ name: a.name, buf: a.buf }] });
      return (r.answer || r).kind;
    } catch { /* the name decides */ }
  }
  return kycByName(a.name) || (isSignedCopy(a.name, subject) ? 'signed_agreement' : 'other');
}
// A client's reply: it lands on the client's record, papers are filed by what they are, and the status updates itself.
// Called by the inbox reader.
async function clientMail(c, subject, text, attachments, from) {
  const saved = []; const kyc = []; let signed = null; let unsigned = false;
  for (const a of attachments || []) {
    if (/\.(png|jpe?g|gif)$/i.test(a.name) && a.buf.length < 30000) continue; // a logo in the signature
    try {
      const kind = await readPaper(a, subject); if (kind === 'unsigned_agreement') unsigned = true;
      const f = await F.saveFile({ recordId: c.id, type: KYC_NAMES[kind] ? kind : kind === 'signed_agreement' ? 'contract_signed' : 'client_mail', name: a.name, base64: a.buf.toString('base64'), by: 'Email inbox' }); saved.push(f.name || a.name);
      if (KYC_NAMES[kind]) { const now_ = get('SELECT kyc FROM clients WHERE id=?', c.id); update('clients', c.id, { kyc: { ...(now_.kyc || {}), [kind]: f.id } }); kyc.push(KYC_NAMES[kind]); }
      if (kind === 'signed_agreement' && !signed) signed = f;
    } catch (e) { insert('notes', { record_id: c.id, text: `Attachment ${a.name} not saved: ${e.message}`, author: 'Email inbox', at: now() }); }
  }
  run('INSERT INTO emails (to_addr,subject,kind,record_id,text,html,status,tries,at) VALUES (?,?,?,?,?,?,?,?,?)', from || c.email || '', subject || '(no subject)', 'client_reply', c.id, String(text || '').slice(0, 2000), '', 'received', 0, now());
  insert('notes', { record_id: c.id, text: `Email from the client: ${subject || '(no subject)'}${text ? ` — ${String(text).trim().slice(0, 300)}` : ''}${saved.length ? `\nSaved: ${saved.join(', ')}` : ''}`, author: 'Email inbox', at: now() });
  if (signed) update('clients', c.id, { contract: JSON.stringify({ file: signed.id, by: 'Email inbox', at: now(), method: 'Signed copy received by email' }) });
  const fresh = get('SELECT * FROM clients WHERE id=?', c.id); const left = Object.keys(KYC_NAMES).filter((k) => !(fresh.kyc || {})[k]);
  if (kyc.length && !left.length) update('clients', c.id, { onboarding: { ...(fresh.onboarding || {}), kyc: { done: true, date: now(), by: 'Email inbox' } } });
  if (signed || kyc.length) L.checkActivation(c.id, { label: 'Email inbox' });
  const said = [signed && 'the signed agreement', kyc.length && kyc.join(', ')].filter(Boolean).join(' and ');
  if (c.owner_id) L.alertUser(c.owner_id, `${c.company} emailed ${said ? `${said}: please check` : unsigned ? 'an agreement that looks unsigned' : saved.length ? `${saved.length} file(s)` : 'a reply'}${kyc.length && left.length ? `. Still needed: ${left.map((k) => KYC_NAMES[k]).join(', ')}` : ''}`, c.id, false);
}
const clientByEmail = (addr) => { const e = String(addr || '').toLowerCase(); if (!e) return null; return all('SELECT * FROM clients WHERE merged_into IS NULL AND removed=0').find((c) => String(c.email || '').toLowerCase() === e || String((c.extra || {}).hr_email || '').toLowerCase() === e) || null; };

// ---------- what the web says about a business (optional, paid per lookup) ----------
const S = (d) => ({ type: 'string', description: d });
// What a recruiter wants in front of them before calling a business about its hiring.
const LOOK_SYSTEM = 'You prepare a recruiter for a phone call with an Indian business about its hiring needs. Search the web for this exact business and use only what you find on its own site, LinkedIn, Google listing or news. Leave a field empty rather than guess. If you cannot be sure it is the right business, say so in "about". Keep every field short and plain.';
const LOOK_FIELDS = {
  about: 'Two short lines: what the business does and for whom',
  customers: 'Who they sell to: B2B, B2C or Both; empty if unknown',
  products: 'Main products or services, in a few words',
  branches: 'How many showrooms, offices or factories, and in which cities',
  team_size: 'Number of employees if published',
  est_year: 'Year started',
  owners: 'Owners or directors, with their roles',
  hiring: 'Signs they are hiring: open roles on their careers page or job sites, with the roles named',
  news: 'New showrooms, expansion or other news from the last 12 months',
  talk_points: '',
  website: 'Official website link', linkedin: 'Company LinkedIn link', instagram: 'Instagram link', facebook: 'Facebook link', phone: 'Public business phone', email: 'Public business email', address: 'Main address', sources: '',
};
const LOOK_SCHEMA = {
  type: 'object', additionalProperties: false, required: Object.keys(LOOK_FIELDS),
  properties: { ...Object.fromEntries(Object.entries(LOOK_FIELDS).map(([k, d]) => [k, S(`${d}; empty if not found`)])), talk_points: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short things to mention on the call, each tied to a fact above and to their hiring' }, sources: { type: 'array', items: { type: 'string' }, description: 'Links used' } },
};
route('POST', '/api/clients/:id/lookup', { auth: 'team', rate: { key: 'lookup', max: 20, minutes: 60 } }, async (ctx) => {
  const c = loadClient(ctx); const b = ctx.body || {}; const ex = c.extra || {};
  const r = await LLM.webLookup({
    system: LOOK_SYSTEM, maxTokens: 700,
    user: `Business: ${b.name || c.company}\nCity: ${b.city || c.city || ''}\nAddress: ${b.address || ex.address || ''}\nType: ${c.business_type || ''}`, schema: LOOK_SCHEMA, name: 'business',
  });
  // What this search cost, in rupees: the search fee plus the tokens, rounded up. An estimate at $1 = ₹88.
  const u = r.usage || {}; const usd = (u.searches || 0) * 0.01 + ((u.input_tokens || 0) * 0.2 + (u.output_tokens || 0) * 1.25) / 1e6;
  const online = { ...r.answer, at: now(), by: ctx.actor.label, cost_inr: Math.max(1, Math.ceil(usd * 88)) }; update('clients', c.id, { extra: { ...ex, online } });
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
    const r = TEAM.createJob(c, { ...b, city: x.city, openings: x.openings, recruiter_id: ctx.user.level === 'sub' ? ctx.user.id : b.recruiter_id || undefined, priority: b.priority || 'High', notes: b.notes || '', mass: 1 }, ctx.actor, false);
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
    case 'Client interview': return ivs.some((i) => i.result === 'Selected') ? 'Selected. Download the offer letter template below, fill it in, then record the offer.' : 'Record the client\'s decision. Selected goes to the offer; rejected goes back to searching.';
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
if (!all('PRAGMA table_info(expenses)').some((x) => x.name === 'vendor')) for (const col of ['vendor TEXT', 'invoice_no TEXT', 'client_id TEXT', 'job_id TEXT', 'file_id TEXT']) D.db.exec(`ALTER TABLE expenses ADD COLUMN ${col}`);
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
  const nameOf = (t, col, id) => (id ? (get(`SELECT ${col} n FROM ${t} WHERE id=?`, id) || {}).n || '' : '');
  const tags = { clients: all('SELECT * FROM clients WHERE removed=0 AND junk=0 AND placeholder=0 AND merged_into IS NULL ORDER BY company').filter((c) => seeClient(u, c)).map((c) => ({ id: c.id, name: c.company })), jobs: all('SELECT * FROM jobs WHERE archived=0 ORDER BY created_at DESC').filter((j) => seeJob(u, j)).map((j) => ({ id: j.id, name: `${j.title}${j.city ? `, ${j.city}` : ''}` })) };
  return { tags, months, expenses: exp.slice(0, 200).map((x) => ({ ...x, client_name: nameOf('clients', 'company', x.client_id), job_name: nameOf('jobs', 'title', x.job_id) })), revenue: rev.slice(0, 200), people, dues, categories: s.expense_categories, kinds: s.revenue_kinds, clients: isSuper(u) ? [] : undefined, agency: sc.id ? get('SELECT id, name FROM agencies WHERE id=?', sc.id) : null, agencies: isSuper(u) ? all('SELECT id, name FROM agencies') : [] };
});
const amount = (v) => { const n = Number(v); if (!n || n <= 0) throw httpError(400, 'Enter the amount', 'amount'); return n; };
const ownRow = (ctx, table) => { const r = get(`SELECT * FROM ${table} WHERE id=?`, ctx.params.id); if (!r || !bookScope(ctx).has(r)) throw httpError(404, 'Entry not found'); return r; };
const saveInvoice = async (id, file, by) => {
  if (!file || !file.base64) return null; if (!/\.(pdf|jpe?g|png|docx?)$/i.test(file.name || '')) throw httpError(400, 'Upload the invoice as a PDF, Word or image file');
  const f = await F.saveFile({ recordId: `EX-${id}`, type: 'expense_invoice', name: file.name, base64: file.base64, by }); update('expenses', id, { file_id: String(f.id) }); return f;
};
route('POST', '/api/expenses', ADMINS, async (ctx) => {
  const b = ctx.body || {}; const r = { agency_id: isSuper(ctx.user) ? b.agency_id || null : ctx.user.agency_id, date: b.date || L.istDay(), category: b.category || 'Other', amount: amount(b.amount), note: b.note || '', vendor: String(b.vendor || '').trim(), invoice_no: String(b.invoice_no || '').trim(), client_id: b.client_id || null, job_id: b.job_id || null, by: ctx.actor.label, at: now() };
  insert('expenses', r); const id = get('SELECT MAX(id) id FROM expenses').id; await saveInvoice(id, b.file, ctx.actor.label);
  D.history(ctx.actor.label, 'expense', null, r.category, null, r.amount); return { ok: true, id };
});
route('POST', '/api/expenses/:id/invoice', ADMINS, async (ctx) => { const r = ownRow(ctx, 'expenses'); const f = await saveInvoice(r.id, ctx.body, ctx.actor.label); if (!f) throw httpError(400, 'Pick the invoice file'); return { ok: true }; });
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

module.exports = { LOOK_SYSTEM, LOOK_SCHEMA, agreementFile, clientMail, clientByEmail, mailFiles, clientCvFor, makeClientCv, nextStep, cleanText };
