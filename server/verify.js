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
route('GET', '/api/cand/verify', K, (ctx) => { const s = stateOf(ctx.candidate.id); return { ...s, items: s.items.filter((i) => i.upload).map(({ kind, label, status, ok, bad, file }) => ({ kind, label, status, ok, bad, has_file: !!file })) }; });
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

module.exports = { stateOf, badge, KINDS };
