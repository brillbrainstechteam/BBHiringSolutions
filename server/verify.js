// Candidate verification without a paid provider: the candidate uploads a masked Aadhaar and the PAN card, and
// declares they have no criminal cases. The team checks each one on the free government sites and records the result,
// and calls the last employer. "ID verified" = Aadhaar and PAN checked; "Fully checked" = that plus a good reference.
const D = require('./db');
const L = require('./logic');
const F = require('./files');
const R = require('./router');
const { route } = R;
const { get, all, insert, now, httpError } = D;

D.db.exec(`
CREATE TABLE IF NOT EXISTS cand_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id TEXT, kind TEXT, file_id TEXT, status TEXT, note TEXT, by TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS ix_cand_checks ON cand_checks(candidate_id);
`);

// upload: the candidate can send it; results: what the team can record; how: where to check it for free.
const KINDS = {
  aadhaar: { label: 'Aadhaar (masked)', upload: true, results: ['Verified', 'Does not match'], how: 'Check the number exists, the age band and the state on myaadhaar.uidai.gov.in → Verify Aadhaar, and that the name and photo match the person.', link: 'https://myaadhaar.uidai.gov.in/verifyAadhaar' },
  pan: { label: 'PAN card', upload: true, results: ['Verified', 'Does not match'], how: 'Check the PAN, name and date of birth on the Income Tax site → Verify Your PAN.', link: 'https://eportal.incometax.gov.in/iec/foservices/#/pre-login/verifyYourPAN' },
  address: { label: 'Address proof', upload: true, results: ['Verified', 'Does not match'], how: 'Match the address with Aadhaar or a recent utility bill, rent agreement or bank statement in their name.' },
  education: { label: 'Highest education certificate', upload: true, results: ['Verified', 'Does not match'], how: 'Check the certificate with the board or university (many are on DigiLocker: ask the candidate to share it from there).', link: 'https://www.digilocker.gov.in/' },
  experience: { label: 'Experience / relieving letters', upload: true, results: ['Verified', 'Does not match'], how: 'Match employer names and dates with the resume and the EPF service history. Call HR on the number from the company website, never the number on the letter.' },
  salary: { label: 'Salary proof (3 payslips or Form 26AS)', upload: true, results: ['Verified', 'Does not match'], how: 'Payslips should match the bank credits; Form 26AS (income tax site) shows the salary and TDS each employer reported.' },
  uan: { label: 'EPF service history (UAN)', upload: true, results: ['Verified', 'Does not match'], how: 'The candidate downloads the service history from the EPFO member passbook (UAN login): it lists every employer with joining and exit dates.', link: 'https://passbook.epfindia.gov.in/' },
  court: { label: 'Court record check', upload: false, results: ['No cases found', 'Case found'], how: 'Search eCourts by name and father’s name in the districts where they lived and worked in the last 7 years. Note the districts searched.', link: 'https://services.ecourts.gov.in/' },
  reference: { label: 'Last employer reference', upload: false, results: ['Good', 'Concern'], how: 'Call the last employer (not a friend the candidate names): dates, role, why they left, any cash or stock issue, would they rehire.', link: '' },
};
const GOOD = ['Verified', 'No cases found', 'Good'];
const BAD = ['Does not match', 'Case found', 'Concern'];

function stateOf(candId) {
  const rows = all('SELECT * FROM cand_checks WHERE candidate_id=? ORDER BY id', candId);
  const last = {}; for (const r of rows) if (r.kind !== 'declaration') last[r.kind] = r;
  const decl = rows.filter((r) => r.kind === 'declaration').pop() || null;
  const items = Object.entries(KINDS).map(([k, x]) => {
    const r = last[k]; const file = r && r.file_id ? r.file_id : (rows.filter((y) => y.kind === k && y.file_id).pop() || {}).file_id || null;
    const status = !r ? 'Not started' : r.status;
    return { kind: k, label: x.label, upload: x.upload, results: x.results, how: x.how, link: x.link, status, ok: GOOD.includes(status), bad: BAD.includes(status), file, note: r ? r.note : '', by: r ? r.by : '', at: r ? r.at : null };
  });
  const ok = (k) => items.find((i) => i.kind === k).ok;
  const flag = items.some((i) => i.bad);
  const summary = flag ? 'Problem found' : ok('aadhaar') && ok('pan') && ok('reference') ? 'Fully checked' : ok('aadhaar') && ok('pan') ? 'ID verified' : items.some((i) => i.status !== 'Not started') || decl ? 'In progress' : 'Not started';
  return { items, declaration: decl ? { text: decl.note, at: decl.at } : null, summary };
}
const badge = (candId) => stateOf(candId).summary;

const T = { auth: 'team' };
const K = { auth: 'candidate' };
const seeCand = (ctx) => { const c = get('SELECT * FROM candidates WHERE id=?', L.resolveId(ctx.params.id)); if (!c || !R.phoneVisible(ctx.user, c)) throw httpError(404, 'Only the candidate\'s own agency can verify them.'); return c; };

route('GET', '/api/candidates/:id/verify', T, (ctx) => stateOf(seeCand(ctx).id));
// The team records a result, with the document if the candidate gave it on paper or WhatsApp.
route('POST', '/api/candidates/:id/verify/:kind', T, async (ctx) => {
  const c = seeCand(ctx); const k = ctx.params.kind; const x = KINDS[k]; if (!x) throw httpError(400, 'Unknown check');
  const b = ctx.body; let fileId = null;
  if (b.file && b.file.base64) { if (!x.upload) throw httpError(400, 'This check has no document.'); fileId = String((await F.saveFile({ recordId: c.id, type: `verify_${k}`, name: b.file.name, base64: b.file.base64, by: ctx.actor.label })).id); }
  const status = b.status || (fileId ? 'Uploaded' : ''); if (!['Uploaded', ...x.results].includes(status)) throw httpError(400, 'Pick the result', 'status');
  if (BAD.includes(status) && !String(b.note || '').trim()) throw httpError(400, 'Say what you found', 'note');
  if (status === 'Uploaded' && !fileId) throw httpError(400, 'Choose the file');
  insert('cand_checks', { candidate_id: c.id, kind: k, file_id: fileId, status, note: String(b.note || '').trim().slice(0, 1000), by: ctx.actor.label, at: now() });
  D.history(ctx.actor.label, 'verification', c.id, x.label, null, status);
  return stateOf(c.id);
});

// The candidate's side: what we have, and their uploads and declaration.
route('GET', '/api/cand/verify', K, (ctx) => { const s = stateOf(ctx.candidate.id); const asked = askedOf(ctx.candidate.id); const show = asked.length ? asked : ['aadhaar', 'pan']; return { ...s, asked, items: s.items.filter((i) => i.upload && show.includes(i.kind)).sort((a, b) => show.indexOf(a.kind) - show.indexOf(b.kind)).map(({ kind, label, status, ok, bad, file }) => ({ kind, label, status, ok, bad, has_file: !!file })) }; });
route('POST', '/api/cand/verify', { ...K, rate: { key: 'verify', max: 20, minutes: 60 } }, async (ctx) => {
  const c = ctx.candidate; const b = ctx.body;
  if (b.declare) {
    if (b.declare !== true) throw httpError(400, 'Tick the box to declare');
    insert('cand_checks', { candidate_id: c.id, kind: 'declaration', file_id: null, status: 'Declared', note: 'I have no criminal case against me, and the documents I upload are mine and true.', by: 'Candidate', at: now() });
  } else {
    const x = KINDS[b.kind]; if (!x || !x.upload) throw httpError(400, 'Pick the document');
    if (!b.base64) throw httpError(400, 'Choose the file');
    const f = await F.saveFile({ recordId: c.id, type: `verify_${b.kind}`, name: b.name, base64: b.base64, by: 'Candidate' });
    insert('cand_checks', { candidate_id: c.id, kind: b.kind, file_id: String(f.id), status: 'Uploaded', note: '', by: 'Candidate', at: now() });
    if (c.recruiter_id) L.alertUser(c.recruiter_id, `${c.name} uploaded ${x.label}: check and verify it`, c.id, false);
  }
  return { ok: true };
});


// ---------- Asking for documents, and verification as a service to clients ----------
D.db.exec(`
CREATE TABLE IF NOT EXISTS doc_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id TEXT, kinds TEXT, app_id TEXT, order_id INTEGER, why TEXT, by TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS ix_doc_requests ON doc_requests(candidate_id);
CREATE TABLE IF NOT EXISTS verify_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id TEXT, client_id TEXT, app_id TEXT, package TEXT, name TEXT, checks TEXT, price REAL, status TEXT, note TEXT, by TEXT, at TEXT, done_at TEXT, done_by TEXT, report_file TEXT, revenue_id INTEGER);
CREATE INDEX IF NOT EXISTS ix_verify_orders ON verify_orders(candidate_id);
`);
for (const col of ['services TEXT', 'vendor_cost REAL', 'bill_id TEXT', 'initiated_at TEXT', 'order_day TEXT', 'provider_ref TEXT']) { try { D.db.exec(`ALTER TABLE verify_orders ADD COLUMN ${col}`); } catch { /* already there */ } }
const C = { auth: 'client' };
const ins = (t, o) => { insert(t, o); return get('SELECT last_insert_rowid() AS id').id; };
const orderNo = (o) => `VR-${String(o.id).padStart(4, '0')}`;
const DEFAULT_PACKAGES = [
  { key: 'id', name: 'ID check', checks: ['aadhaar', 'pan'], price: 199, about: 'Aadhaar and PAN match the person' },
  { key: 'employment', name: 'Employment history', checks: ['uan', 'experience'], price: 499, about: 'Past employers and dates from EPF records and their letters' },
  { key: 'court', name: 'Court record check', checks: ['court'], price: 499, about: 'Criminal and civil cases on eCourts in the districts they lived and worked' },
  { key: 'reference', name: 'Reference call', checks: ['reference'], price: 299, about: 'A call to the last employer: role, dates, why they left' },
  { key: 'salary', name: 'Salary proof', checks: ['salary'], price: 299, about: 'Payslips or Form 26AS checked against what they told us' },
  { key: 'standard', name: 'Standard', checks: ['aadhaar', 'pan', 'uan', 'experience', 'court', 'reference'], price: 1499, about: 'ID + employment history + court records + reference call' },
  { key: 'complete', name: 'Complete', checks: ['aadhaar', 'pan', 'address', 'education', 'uan', 'experience', 'salary', 'court', 'reference'], price: 3499, about: 'Standard + address + education + salary proof' },
];
// The services offered now (Settings can still give its own list): ID check, Employment history, Court record check.
const ACTIVE = ['id', 'employment', 'court'];
const packages = () => (Array.isArray(D.settings().verify_packages) && D.settings().verify_packages.length ? D.settings().verify_packages : DEFAULT_PACKAGES.filter((p) => ACTIVE.includes(p.key)));
const anyPackage = (k) => (Array.isArray(D.settings().verify_packages) && D.settings().verify_packages.length ? D.settings().verify_packages : DEFAULT_PACKAGES).find((x) => x.key === k);
// What our own (BrillBrains) openings ask for at the offer stage.
const INTERNAL_DOCS = ['aadhaar', 'pan', 'address', 'education', 'experience', 'salary', 'uan'];
const docLabels = (kinds) => kinds.filter((k) => KINDS[k] && KINDS[k].upload).map((k) => `• ${KINDS[k].label}`).join('\n');

// Ask the candidate for documents: saved as a request (their portal shows exactly these), and a WhatsApp with the link.
function requestDocs(candId, kinds, by, o = {}) {
  const c = get('SELECT * FROM candidates WHERE id=?', candId); if (!c) throw httpError(404, 'Candidate not found');
  const want = [...new Set(kinds)].filter((k) => KINDS[k] && KINDS[k].upload); if (!want.length) throw httpError(400, 'Pick at least one document', 'kinds');
  const st = stateOf(c.id); const missing = want.filter((k) => { const i = st.items.find((x) => x.kind === k); return !i || (!i.ok && !i.file); });
  const id = Number(ins('doc_requests', { candidate_id: c.id, kinds: want, app_id: o.app_id || null, order_id: o.order_id || null, why: o.why || '', by: (by && by.label) || 'System', at: now() }));
  D.history((by && by.label) || 'System', 'documents asked', c.id, null, null, want.map((k) => KINDS[k].label).join(', '));
  let wa = { skipped: 'Nothing missing' };
  if (missing.length && c.whatsapp) wa = L.sendWA({ ptype: 'candidate', pid: c.id, format: 'bbhs_documents_request', vars: { documents: docLabels(missing), link: L.link('my-profile/verify') }, ap: o.app_id || undefined, by, auto: !!o.auto, rule: o.auto ? 'docs_internal' : undefined, bulk: !o.auto, dedupe: `docs:${c.id}:${id}` });
  return { id, asked: want, missing, sent: !wa.skipped, why_not_sent: wa.skipped || null, link: `${L.link('my-profile/verify')}` };
}
// The documents asked last (what the candidate's page puts first).
const askedOf = (candId) => { const r = get('SELECT * FROM doc_requests WHERE candidate_id=? ORDER BY id DESC LIMIT 1', candId); return r ? (Array.isArray(r.kinds) ? r.kinds : JSON.parse(r.kinds || '[]')) : []; };

// Offer made on one of our own openings: ask for the joining documents, once per application.
function autoInternal(app, by) {
  try {
    const j = get('SELECT client_id FROM jobs WHERE id=?', app.job_id); const cl = j && get('SELECT internal FROM clients WHERE id=?', j.client_id); if (!cl || !cl.internal) return;
    if (get('SELECT 1 FROM doc_requests WHERE app_id=?', app.id)) return;
    const rule = (D.settings().auto_rules || []).find((r) => r.key === 'docs_internal'); if (rule && rule.on === false) return;
    requestDocs(app.candidate_id, INTERNAL_DOCS, by || { label: 'System' }, { app_id: app.id, why: 'Offer on a BrillBrains opening', auto: true });
  } catch (e) { /* never block the offer */ }
}

route('POST', '/api/candidates/:id/docs-request', T, (ctx) => { const c = seeCand(ctx); return requestDocs(c.id, Array.isArray(ctx.body.kinds) ? ctx.body.kinds : [], ctx.actor, { app_id: ctx.body.app_id }); });

// ---- Verification orders (a client asks us to verify a candidate they are considering) ----
const orderView = (o) => { const st = stateOf(o.candidate_id); const checks = Array.isArray(o.checks) ? o.checks : JSON.parse(o.checks || '[]'); const items = st.items.filter((i) => checks.includes(i.kind));
  const done = items.filter((i) => i.ok || i.bad).length; const c = get('SELECT name FROM candidates WHERE id=?', o.candidate_id) || {}; const cl = get('SELECT company FROM clients WHERE id=?', o.client_id) || {};
  const services = o.services ? JSON.parse(o.services) : [{ key: o.package, name: o.name, price: o.price, cost: o.vendor_cost ?? null, status: o.status }];
  return { ...o, no: orderNo(o), checks, services, margin: o.vendor_cost === null || o.vendor_cost === undefined ? null : Math.round((o.price || 0) - o.vendor_cost), day: o.order_day || String(o.at || '').slice(0, 10), bill_no: o.bill_id ? ((get('SELECT bill_no FROM bills WHERE id=?', o.bill_id) || {}).bill_no || o.bill_id) : null, candidate_name: c.name || o.candidate_id, client_name: cl.company || '', progress: `${done} of ${items.length}`, ready: items.length > 0 && done === items.length, problem: items.some((i) => i.bad), items }; };
function placeOrder(candId, clientId, pkgKey, by, o = {}) {
  if (Array.isArray(o.services) && o.services.length) return placeMany(candId, clientId, o.services, by, o);
  const p = packages().find((x) => x.key === pkgKey) || anyPackage(pkgKey); if (!p) throw httpError(400, 'Pick a verification package', 'package');
  if (get("SELECT 1 FROM verify_orders WHERE candidate_id=? AND client_id=? AND package=? AND status IN ('Requested','In progress')", candId, clientId, p.key)) throw httpError(400, `${p.name} is already ordered for this candidate`);
  const id = Number(ins('verify_orders', { candidate_id: candId, client_id: clientId, app_id: o.app_id || null, package: p.key, name: p.name, checks: p.checks, price: Number(o.price ?? p.price) || 0, status: 'Requested', note: o.note || '', by: (by && by.label) || 'Client', at: now() }));
  const ord = get('SELECT * FROM verify_orders WHERE id=?', id);
  try { requestDocs(candId, p.checks, by, { order_id: id, app_id: o.app_id, why: `${p.name} verification for a client` }); } catch (e) { /* nothing to upload for this package */ }
  const c = get('SELECT recruiter_id, name FROM candidates WHERE id=?', candId) || {}; const owner = (o.app_id && (get('SELECT owner_id FROM applications WHERE id=?', o.app_id) || {}).owner_id) || c.recruiter_id;
  if (owner) L.alertUser(owner, `${orderNo(ord)}: ${p.name} verification ordered for ${c.name || candId}`, candId, false);
  D.history((by && by.label) || 'Client', 'verification ordered', candId, null, null, `${orderNo(ord)} ${p.name} · ₹${ord.price}`);
  return orderView(ord);
}
// Several services in one order: one line each with our price and the vendor's cost.
function placeMany(candId, clientId, keys, by, o = {}) {
  const prices = o.prices || {}; const costs = o.costs || {};
  const lines = [...new Set(keys)].map((k) => { const p = anyPackage(k); if (!p) throw httpError(400, 'Pick the services', 'services'); return { key: p.key, name: p.name, checks: p.checks, price: Number(prices[k] ?? p.price) || 0, cost: costs[k] === '' || costs[k] === undefined || costs[k] === null ? null : Number(costs[k]) || 0, status: 'Requested' }; });
  if (!lines.length) throw httpError(400, 'Tick at least one service', 'services');
  for (const r of all("SELECT * FROM verify_orders WHERE candidate_id=? AND client_id=? AND status IN ('Requested','In progress')", candId, clientId)) {
    const have = r.services ? JSON.parse(r.services).map((x) => x.key) : [r.package]; const dup = lines.find((l) => have.includes(l.key));
    if (dup) throw httpError(400, `${dup.name} is already ordered for this candidate (${orderNo(r)})`, 'services');
  }
  const checks = [...new Set(lines.flatMap((l) => l.checks))]; const name = lines.map((l) => l.name).join(' + ');
  const costKnown = lines.some((l) => l.cost !== null); const day = /^\d{4}-\d{2}-\d{2}$/.test(o.day || '') ? o.day : L.istDay();
  const id = Number(ins('verify_orders', { candidate_id: candId, client_id: clientId, app_id: o.app_id || null, package: lines.map((l) => l.key).join('+'), name, checks, price: lines.reduce((t, l) => t + l.price, 0), vendor_cost: costKnown ? lines.reduce((t, l) => t + (l.cost || 0), 0) : null, services: JSON.stringify(lines.map(({ checks: _c, ...l }) => l)), order_day: day, status: 'Requested', note: o.note || '', by: (by && by.label) || 'Client', at: now() }));
  const ord = get('SELECT * FROM verify_orders WHERE id=?', id);
  try { requestDocs(candId, checks, by, { order_id: id, app_id: o.app_id, why: `${name} verification for a client` }); } catch (e) { /* nothing to upload for these services */ }
  const c = get('SELECT recruiter_id, name FROM candidates WHERE id=?', candId) || {}; const owner = (o.app_id && (get('SELECT owner_id FROM applications WHERE id=?', o.app_id) || {}).owner_id) || c.recruiter_id;
  if (owner) L.alertUser(owner, `${orderNo(ord)}: ${name} verification ordered for ${c.name || candId}`, candId, false);
  D.history((by && by.label) || 'Client', 'verification ordered', candId, null, null, `${orderNo(ord)} ${name} · ₹${ord.price}`);
  return orderView(ord);
}
// A provider is connected when its keys are in .env (IDfy: IDFY_ACCOUNT_ID and IDFY_API_KEY).
const provider = () => (process.env.IDFY_ACCOUNT_ID && process.env.IDFY_API_KEY ? 'IDfy' : null);
// The report the client receives: each check, its result, who did it and when, and what was used.
function reportPdf(o) {
  const v = orderView(o); const c = get('SELECT * FROM candidates WHERE id=?', o.candidate_id) || {}; const biz = D.settings().business || {};
  const lines = [{ text: `Verification report · ${v.no}`, size: 14, bold: true }, '', `Candidate: ${c.name || ''} (${c.id})`, `For: ${v.client_name}`, `Package: ${v.name}`, `Ordered: ${L.istFmt(o.at, false)}   ·   Completed: ${L.istFmt(o.done_at || now(), false)}`, ''];
  lines.push({ text: v.problem ? 'Result: a problem was found (see below)' : 'Result: all checks clear', bold: true }, '');
  for (const i of v.items) { lines.push({ text: `${i.label}: ${i.status}`, bold: true }); if (i.note) lines.push(`   ${i.note}`); if (i.by) lines.push(`   Checked by ${i.by}${i.at ? ` on ${L.istFmt(i.at, false)}` : ''}`); lines.push(`   How: ${i.how}`); lines.push(''); }
  const decl = stateOf(o.candidate_id).declaration; lines.push(decl ? `Candidate's declaration (no criminal case, documents are true): given on ${L.istFmt(decl.at, false)}` : 'Candidate has not given the declaration.');
  lines.push('', 'Documents were shared by the candidate with consent and checked on official government sites or with past employers. Identity numbers are kept masked.');
  return F.makePdf(`Verification report · ${v.no}`, lines, biz);
}
function completeOrder(o, by) {
  const v = orderView(o); if (!v.ready) throw httpError(400, `Record all the checks first (${v.progress} done)`);
  const buf = reportPdf({ ...o, done_at: now() });
  const f = F.storeBuffer({ recordId: o.candidate_id, type: 'verify_report', name: `${orderNo(o)}-verification-report.pdf`, buf, mime: 'application/pdf', by: by.label });
  let revenueId = o.revenue_id; const cl = get('SELECT agency_id FROM clients WHERE id=?', o.client_id) || {};
  if (!revenueId && !o.bill_id && o.price > 0) revenueId = Number(ins('revenue_logs', { agency_id: cl.agency_id || null, date: L.istDay(), kind: 'Background verification', client_id: o.client_id, amount: o.price, note: `${orderNo(o)} ${o.name} · ${v.candidate_name}`, by: by.label, at: now() }));
  D.run('UPDATE verify_orders SET status=?, done_at=?, done_by=?, report_file=?, revenue_id=? WHERE id=?', 'Completed', now(), by.label, String(f.id), revenueId || null, o.id);
  D.history(by.label, 'verification completed', o.candidate_id, null, null, `${orderNo(o)} ${v.problem ? 'problem found' : 'all clear'}`);
  return orderView(get('SELECT * FROM verify_orders WHERE id=?', o.id));
}
const seeOrder = (u, o) => { const cl = get('SELECT * FROM clients WHERE id=?', o.client_id); return !!cl && R.seeClient(u, cl); };

route('GET', '/api/verify/packages', T, () => packages());
// Who can be verified from the form: candidates hired or offered a job (with that client).
route('GET', '/api/verify/candidates', T, (ctx) => {
  const OFFER = ['Offer made', 'Offer accepted', 'Joined'];
  const apps = all("SELECT * FROM applications WHERE result IN ('open','Hired') ORDER BY created_at DESC").filter((a) => (a.result === 'Hired' || OFFER.includes(a.step)) && R.seeApp(ctx.user, a));
  return { provider: provider(), rows: apps.map((a) => { const c = get('SELECT name FROM candidates WHERE id=?', a.candidate_id) || {}; const j = get('SELECT title, client_id FROM jobs WHERE id=?', a.job_id) || {}; const cl = get('SELECT company FROM clients WHERE id=?', j.client_id) || {}; return { app_id: a.id, candidate_id: a.candidate_id, name: c.name || a.candidate_id, job_title: j.title || '', client_id: j.client_id, client_name: cl.company || '', stage: a.result === 'Hired' ? 'Hired' : a.step }; }).filter((x) => x.client_id) };
});
// Start the checks: through the provider once connected; until then the team does them by hand.
route('POST', '/api/verify-orders/:id/initiate', T, (ctx) => {
  const o = get('SELECT * FROM verify_orders WHERE id=?', Number(ctx.params.id)); if (!o || !seeOrder(ctx.user, o)) throw httpError(404, 'Order not found');
  if (o.status !== 'Requested') throw httpError(400, `This order is ${o.status.toLowerCase()} already`);
  const p = provider(); const lines = o.services ? JSON.parse(o.services).map((l) => ({ ...l, status: 'Initiated' })) : null;
  D.run('UPDATE verify_orders SET status=?, initiated_at=?, services=COALESCE(?, services) WHERE id=?', 'In progress', now(), lines ? JSON.stringify(lines) : null, o.id);
  D.history(ctx.actor.label, 'verification initiated', o.candidate_id, null, null, `${orderNo(o)} ${p ? `with ${p}` : 'by hand (no provider connected yet)'}`);
  return { ...orderView(get('SELECT * FROM verify_orders WHERE id=?', o.id)), mode: p ? 'provider' : 'manual', provider: p };
});
// Accounts: the invoice for an order (amount + 18% GST); the bill then carries the revenue.
route('POST', '/api/verify-orders/:id/invoice', { ...T, accounts: true }, (ctx) => {
  const o = get('SELECT * FROM verify_orders WHERE id=?', Number(ctx.params.id)); if (!o || !seeOrder(ctx.user, o)) throw httpError(404, 'Order not found');
  if (o.bill_id) throw httpError(400, 'This order has an invoice already');
  const b = ctx.body || {}; const fee = Math.round(Number(b.amount ?? o.price) || 0); if (fee <= 0) throw httpError(400, 'Enter the amount', 'amount');
  const gst = Math.round(b.gst !== undefined && b.gst !== '' ? Number(b.gst) : fee * 0.18); const c = get('SELECT * FROM clients WHERE id=?', o.client_id) || {}; const v = orderView(o);
  const day = L.istDay(); const id = D.nextId('BL'); const no = String(b.bill_no || '').trim();
  if (no && get('SELECT 1 FROM bills WHERE bill_no=?', no)) throw httpError(400, 'This invoice number is already on another bill', 'bill_no');
  insert('bills', { id, app_id: null, client_id: c.id, agency_id: c.agency_id || null, bill_no: no || null, ctc: 0, fee, gst, cgst: 0, sgst: 0, igst: 0, total: fee + gst, fee_note: `Background verification ${v.no}: ${v.name}`, status: 'Issued', issued_at: now(), date: day, due_date: new Date(Date.parse(day) + (c.payment_days || D.settings().payment_days || 15) * 86400000).toISOString().slice(0, 10), share_pct: 0, agency_share: 0, payout_status: 'Not due', person_name: v.candidate_name, job_name: 'Background verification', created_at: now() });
  if (o.revenue_id) D.run('DELETE FROM revenue_logs WHERE id=?', o.revenue_id); // the bill is the revenue now
  D.run('UPDATE verify_orders SET bill_id=?, revenue_id=NULL WHERE id=?', id, o.id);
  D.history(ctx.actor.label, 'verification invoiced', o.candidate_id, null, null, `${v.no} → ${id} ${L.inr(fee + gst)}`);
  return { ok: true, id };
});
// The vendor's cost, filled in later (their invoice).
route('POST', '/api/verify-orders/:id/cost', T, (ctx) => {
  const o = get('SELECT * FROM verify_orders WHERE id=?', Number(ctx.params.id)); if (!o || !seeOrder(ctx.user, o)) throw httpError(404, 'Order not found');
  const costs = (ctx.body || {}).costs || {}; const lines = o.services ? JSON.parse(o.services) : null;
  if (lines) { for (const l of lines) if (costs[l.key] !== undefined && costs[l.key] !== '') l.cost = Number(costs[l.key]) || 0; }
  const total = lines ? (lines.some((l) => l.cost !== null && l.cost !== undefined) ? lines.reduce((t, l) => t + (l.cost || 0), 0) : null) : Number((ctx.body || {}).total) || null;
  D.run('UPDATE verify_orders SET vendor_cost=?, services=COALESCE(?, services) WHERE id=?', total, lines ? JSON.stringify(lines) : null, o.id);
  return orderView(get('SELECT * FROM verify_orders WHERE id=?', o.id));
});
// The finished report to the client by email (PDF attached); it is also in their account.
route('POST', '/api/verify-orders/:id/send', T, (ctx) => {
  const o = get('SELECT * FROM verify_orders WHERE id=?', Number(ctx.params.id)); if (!o || !seeOrder(ctx.user, o)) throw httpError(404, 'Order not found');
  if (o.status !== 'Completed' || !o.report_file) throw httpError(400, 'Make the report first');
  const cl = get('SELECT * FROM clients WHERE id=?', o.client_id) || {}; const to = String((ctx.body || {}).to || cl.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw httpError(400, 'The client has no email: add it on the client, or type one', 'to');
  const v = orderView(o); const M = require('./mailer'); const subject = `Verification report ${v.no}: ${v.candidate_name}`;
  const text = `Hello ${cl.contact || ''},\n\nThe ${v.name} verification of ${v.candidate_name} is complete: ${v.problem ? 'a problem was found, details in the report' : 'all checks are clear'}.\n\nThe report is attached. You can also download it from your account.\n\nBrillBrains Hiring Solutions`;
  M.queue({ to, subject, text, html: M.layout(subject, `<p style="font-size:14px;line-height:1.7">${text.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])).replace(/\n/g, '<br>')}</p>`), kind: 'verify_report', recordId: o.candidate_id, attachments: [{ file_id: o.report_file }], force: true, person: true });
  D.history(ctx.actor.label, 'verification report sent', o.candidate_id, null, null, `${v.no} to ${to}`);
  return { ok: true, to };
});
route('GET', '/api/verify-orders', T, (ctx) => { const q = ctx.query; const rows = all('SELECT * FROM verify_orders ORDER BY id DESC LIMIT 500').filter((o) => seeOrder(ctx.user, o) && (!q.candidate || o.candidate_id === q.candidate) && (!q.status || o.status === q.status)).map(orderView);
  return { rows, packages: packages(), counts: { open: rows.filter((o) => ['Requested', 'In progress'].includes(o.status)).length } }; });
route('POST', '/api/verify-orders', T, (ctx) => { const b = ctx.body; const c = get('SELECT * FROM candidates WHERE id=?', L.resolveId(b.candidate_id)); if (!c) throw httpError(404, 'Candidate not found');
  const cl = get('SELECT * FROM clients WHERE id=?', b.client_id); if (!cl || !R.seeClient(ctx.user, cl)) throw httpError(400, 'Pick the client', 'client_id');
  return placeOrder(c.id, cl.id, b.package, ctx.actor, { app_id: b.app_id, price: b.price, note: b.note, services: b.services, prices: b.prices, costs: b.costs, day: b.day }); });
route('POST', '/api/verify-orders/:id/status', T, (ctx) => { const o = get('SELECT * FROM verify_orders WHERE id=?', Number(ctx.params.id)); if (!o || !seeOrder(ctx.user, o)) throw httpError(404, 'Order not found');
  const s = ctx.body.status; if (!['In progress', 'Cancelled', 'Requested'].includes(s)) throw httpError(400, 'Pick a status'); D.run('UPDATE verify_orders SET status=? WHERE id=?', s, o.id); return orderView(get('SELECT * FROM verify_orders WHERE id=?', o.id)); });
route('POST', '/api/verify-orders/:id/complete', T, (ctx) => { const o = get('SELECT * FROM verify_orders WHERE id=?', Number(ctx.params.id)); if (!o || !seeOrder(ctx.user, o)) throw httpError(404, 'Order not found'); if (o.status === 'Completed') throw httpError(400, 'Already completed'); return completeOrder(o, ctx.actor); });

// Client side: order for a candidate we sent them, and see the orders with their reports.
const clientCand = (ctx, appId) => { const a = get('SELECT * FROM applications WHERE id=?', appId); const j = a && get('SELECT client_id FROM jobs WHERE id=?', a.job_id); if (!a || !j || j.client_id !== ctx.client.id) throw httpError(404, 'Candidate not found'); return a; };
route('GET', '/api/client/verify', C, (ctx) => ({ packages: packages().map(({ key, name, price, about }) => ({ key, name, price, about })), orders: all('SELECT * FROM verify_orders WHERE client_id=? ORDER BY id DESC', ctx.client.id).map((o) => { const v = orderView(o); return { id: o.id, no: v.no, app_id: o.app_id, name: o.name, price: o.price, status: o.status, at: o.at, done_at: o.done_at, progress: v.progress, problem: o.status === 'Completed' ? v.problem : null, report: o.status === 'Completed' }; }) }));
route('POST', '/api/client/verify', C, (ctx) => { const a = clientCand(ctx, ctx.body.app_id); const v = placeOrder(a.candidate_id, ctx.client.id, ctx.body.package, ctx.actor, { app_id: a.id }); return { ok: true, no: v.no }; });
route('GET', '/api/client/verify/:id/report', C, (ctx) => { const o = get('SELECT * FROM verify_orders WHERE id=? AND client_id=?', Number(ctx.params.id), ctx.client.id); if (!o || o.status !== 'Completed') throw httpError(404, 'The report is not ready yet');
  return { __file: { name: `${orderNo(o)}-verification-report.pdf`, mime: 'application/pdf', buf: reportPdf(o) } }; });
route('GET', '/api/verify-orders/:id/report', T, (ctx) => { const o = get('SELECT * FROM verify_orders WHERE id=?', Number(ctx.params.id)); if (!o || !seeOrder(ctx.user, o)) throw httpError(404, 'Order not found');
  return { __file: { name: `${orderNo(o)}-verification-report.pdf`, mime: 'application/pdf', buf: reportPdf(o) } }; });

module.exports = { stateOf, badge, KINDS, requestDocs, autoInternal, packages, placeOrder, INTERNAL_DOCS };
