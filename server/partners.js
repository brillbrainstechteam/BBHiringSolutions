// Partners: institutes, colleges and training centres whose students make good candidates (CAD design institutes,
// jewellery design colleges, gemmology and goldsmith training). Found with an AI web search the team pays for per
// search, kept here with a status, and worked like leads.
const D = require('./db');
const LLM = require('./llm');
const R = require('./router');
const { route } = R;
const { get, all, insert, update, now, httpError } = D;

D.db.exec(`
CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, industry TEXT, courses TEXT, address TEXT, area TEXT, city TEXT, state TEXT, distance_km REAL, phone TEXT, email TEXT, website TEXT, source_url TEXT, why TEXT, status TEXT DEFAULT 'New', note TEXT, search_id INTEGER, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS partner_searches (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT, found INTEGER, added INTEGER, cost_inr INTEGER, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS partner_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, partner_id INTEGER, kind TEXT, text TEXT, by TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS ix_pact ON partner_activity(partner_id);
`);
// Vendors database: contact person, WhatsApp number, owner, and where the follow-up sequence is.
for (const col of ['contact_role TEXT', 'contact_name TEXT', 'whatsapp TEXT', 'owner_id TEXT', 'seq_on INTEGER DEFAULT 0', 'seq_step INTEGER DEFAULT 0', 'seq_start TEXT', 'next_at TEXT', 'last_contact_at TEXT', 'opted_out INTEGER DEFAULT 0']) { try { D.db.exec(`ALTER TABLE partners ADD COLUMN ${col}`); } catch { /* already there */ } }

const STATUSES = ['New', 'Contacted', 'Interested', 'Meeting fixed', 'Partner', 'Not interested', 'Not relevant'];
// Follow-ups stop by themselves once a vendor reaches one of these (a person takes it from there).
const STOP = ['Interested', 'Meeting fixed', 'Partner', 'Not interested', 'Not relevant'];
// The follow-up sequence: day counted from the first WhatsApp. WhatsApp steps go from the business number once
// Meta approves the message; until then (and for calls) the owner gets a task with the message ready to send.
const SEQUENCE = [
  { day: 0, kind: 'whatsapp', format: 'bbhs_partner_outreach', label: 'WhatsApp introduction' },
  { day: 3, kind: 'call', label: 'Call: introduce us and ask for a meeting with the placement cell' },
  { day: 7, kind: 'whatsapp', format: 'bbhs_partner_followup', label: 'WhatsApp follow-up' },
  { day: 14, kind: 'call', label: 'Last call: ask who handles placements, then mark the status' },
];
const seq = () => (Array.isArray(D.settings().vendor_sequence) && D.settings().vendor_sequence.length ? D.settings().vendor_sequence : SEQUENCE);
const TYPES = ['CAD / jewellery design institute', 'Jewellery design college', 'Gemmology institute', 'Goldsmith / karigar training centre', 'Retail and sales training institute', 'Polytechnic / ITI', 'University / college department', 'Skill development centre (NSDC / PMKVY)'];
// What one search usually costs: OpenAI charges per web search ($0.01) plus the words read and written.
const ESTIMATE = { low: 3, high: 8 };

const T = { auth: 'team' };
const ADMIN = { auth: 'team', levels: ['super', 'admin'], rate: { key: 'partner_search', max: 30, minutes: 60 } };

route('GET', '/api/partners', T, (ctx) => {
  const q = ctx.query; const s = String(q.q || '').toLowerCase();
  const nowIso = now(); const lastSearch = (get('SELECT MAX(id) id FROM partner_searches') || {}).id;
  const rows = all('SELECT * FROM partners ORDER BY at DESC, id DESC').filter((p) => (!q.status || p.status === q.status) && (!q.city || p.city === q.city) && (!q.type || p.type === q.type) && (!q.search || String(p.search_id) === String(q.search === 'last' ? lastSearch : q.search))
    && (!q.due || (p.seq_on && p.next_at && p.next_at <= nowIso)) && (!q.seq || (q.seq === 'on' ? p.seq_on : !p.seq_on)) && (!s || [p.name, p.type, p.courses, p.city, p.area, p.contact_name].some((x) => String(x || '').toLowerCase().includes(s))))
    .map((p) => { const st = seq()[p.seq_step]; return { ...p, wa: waNumber(p), next_step: p.seq_on && st ? st.label : null, owner_name: p.owner_id ? (get('SELECT name FROM users WHERE id=?', p.owner_id) || {}).name : null }; });
  const counts = Object.fromEntries(STATUSES.map((x) => [x, all('SELECT 1 FROM partners WHERE status=?', x).length]));
  const due = all('SELECT 1 FROM partners WHERE seq_on=1 AND next_at<=?', nowIso).length;
  const fm = D.settings().formats || {}; const crmOn = !!(D.settings().crm || {}).enabled;
  return { rows, counts, due, last_search: lastSearch || null, sequence: seq(), wa_ready: { outreach: !!(fm.bbhs_partner_outreach && fm.bbhs_partner_outreach.approved && crmOn), followup: !!(fm.bbhs_partner_followup && fm.bbhs_partner_followup.approved && crmOn) },
    cities: [...new Set(all('SELECT city FROM partners').map((x) => x.city).filter(Boolean))].sort(), types_in: [...new Set(all('SELECT type FROM partners').map((x) => x.type).filter(Boolean))].sort(),
    total: all('SELECT 1 FROM partners').length, statuses: STATUSES, types: TYPES, estimate: ESTIMATE, can_search: ['super', 'admin'].includes(ctx.user.level), ai: LLM.provider() === 'openai', searches: all('SELECT * FROM partner_searches ORDER BY id DESC LIMIT 10').map((x) => ({ ...x, query: JSON.parse(x.query || '{}') })), spent_inr: (get('SELECT SUM(cost_inr) n FROM partner_searches') || {}).n || 0 };
});

const str = (d) => ({ type: 'string', description: d });
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['places'],
  properties: { places: { type: 'array', description: 'Each institute found, best match first', items: { type: 'object', additionalProperties: false, required: ['name', 'type', 'courses', 'address', 'area', 'city', 'state', 'distance_km', 'phone', 'email', 'website', 'source_url', 'why'], properties: {
    name: str('Name of the institute'), type: str('Kind of institute'), courses: str('Courses that fit the search, with length if published'), address: str('Full address; empty if not found'), area: str('Locality or area'), city: str('City'), state: str('State'),
    distance_km: { type: ['number', 'null'], description: 'Rough distance in km from the area searched; null if unknown' }, phone: str('Public phone; empty if not found'), email: str('Public email; empty if not found'), website: str('Official website; empty if not found'), source_url: str('Page the facts came from'), why: str('One line: why its students suit the jobs searched for'),
  } } } },
};
const SYSTEM = 'You find training institutes in India whose students or graduates could be hired by jewellery businesses. Search the web and return only real places that exist now, with facts you found on their own site or a reliable listing. Never invent a phone number, email or address: leave it empty if you did not find it. Keep within the distance asked when a distance is given.';

route('POST', '/api/partners/search', ADMIN, async (ctx) => {
  const b = ctx.body || {}; const q = { type: String(b.type || '').trim(), industry: String(b.industry || 'Jewellery').trim(), course: String(b.course || '').trim(), state: String(b.state || '').trim(), city: String(b.city || '').trim(), area: String(b.area || '').trim(), km: Number(b.km) || 0 };
  if (!q.city && !q.state) throw httpError(400, 'Enter a city or a state', 'city');
  if (!q.type && !q.course) throw httpError(400, 'Enter the type of institute or the course', 'type');
  // The same search again finds the same places (and costs again): point to what is already saved instead.
  const norm = (x) => JSON.stringify(['type', 'industry', 'course', 'state', 'city', 'area', 'km'].map((k) => String(x[k] ?? '').trim().toLowerCase().replace(/\s+/g, ' ')));
  const same = all('SELECT * FROM partner_searches ORDER BY id DESC').find((x) => { try { return norm(JSON.parse(x.query || '{}')) === norm(q); } catch { return false; } });
  if (same && !b.again) throw httpError(409, `This search was already run on ${new Date(same.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })} by ${same.by} (${same.found} found, ${same.added} saved). Those institutes are already in the Vendors database.`);
  const where = [q.area, q.city, q.state].filter(Boolean).join(', ');
  const r = await LLM.webLookup({ system: SYSTEM, name: 'institutes', schema: SCHEMA, maxTokens: 2500, searches: 2,
    user: `Find: ${q.type || 'institutes'}${q.course ? ` teaching ${q.course}` : ''}\nIndustry the students will work in: ${q.industry}\nWhere: ${where}${q.km ? `, within ${q.km} km of ${q.area || q.city || q.state}` : ''}\nReturn up to 15.` });
  const u = r.usage || {}; const usd = (u.searches || 0) * 0.01 + ((u.input_tokens || 0) * 0.2 + (u.output_tokens || 0) * 1.25) / 1e6; const cost = Math.max(1, Math.ceil(usd * 88));
  insert('partner_searches', { query: JSON.stringify(q), found: 0, added: 0, cost_inr: cost, by: ctx.actor.label, at: now() }); const sid = get('SELECT last_insert_rowid() id').id;
  const places = (r.answer.places || []).filter((p) => p.name); let added = 0;
  for (const p of places) {
    if (get('SELECT 1 FROM partners WHERE lower(name)=lower(?) AND lower(city)=lower(?)', p.name.trim(), String(p.city || '').trim())) continue;
    insert('partners', { name: p.name.trim(), type: p.type, industry: q.industry, courses: p.courses, address: p.address, area: p.area, city: p.city || q.city, state: p.state || q.state, distance_km: p.distance_km, phone: p.phone, email: p.email, website: p.website, source_url: p.source_url, why: p.why, status: 'New', note: '', search_id: sid, by: ctx.actor.label, at: now() }); added++;
  }
  D.run('UPDATE partner_searches SET found=?, added=? WHERE id=?', places.length, added, sid);
  D.history(ctx.actor.label, 'partner search', null, null, null, `${where}: ${places.length} found, ${added} new, ₹${cost}`);
  return { found: places.length, added, cost_inr: cost };
});
route('POST', '/api/partners', T, (ctx) => {
  const L = require('./logic'); const b = ctx.body || {}; const t = (k) => String(b[k] || '').trim();
  if (!t('name')) throw httpError(400, 'Enter the name of the institute or college', 'name');
  if (!t('city')) throw httpError(400, 'Enter the city', 'city');
  const dup = get('SELECT id, status FROM partners WHERE lower(name)=lower(?) AND lower(city)=lower(?)', t('name'), t('city'));
  if (dup) throw httpError(409, `${t('name')}, ${t('city')} is already in the Vendors database (status: ${dup.status}).`, 'name');
  const wa = t('whatsapp') ? L.digits10(t('whatsapp')) : ''; if (wa && !L.validPhone(wa)) throw httpError(400, 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9', 'whatsapp');
  if (t('email') && !L.EMAIL_RE.test(t('email'))) throw httpError(400, 'Enter a valid email ID, or leave it empty', 'email');
  if (!wa && !t('phone') && !t('email')) throw httpError(400, 'Enter at least one way to reach them: WhatsApp number, phone or email ID', 'whatsapp');
  insert('partners', { name: t('name'), type: t('type'), industry: t('industry') || 'Jewellery', courses: t('courses'), address: t('address'), area: t('area'), city: t('city'), state: t('state'), distance_km: null, phone: t('phone'), email: t('email'), website: t('website'), source_url: '', why: '', status: STATUSES.includes(b.status) ? b.status : 'New', note: t('note'), search_id: null, by: ctx.actor.label, at: now(), contact_name: t('contact_name'), contact_role: t('contact_role'), whatsapp: wa || null, owner_id: ctx.user.id });
  const id = get('SELECT last_insert_rowid() id').id; act(id, 'note', 'Added by hand', ctx.actor.label);
  return { id };
});
route('PATCH', '/api/partners/:id', T, (ctx) => {
  const p = get('SELECT * FROM partners WHERE id=?', ctx.params.id); if (!p) throw httpError(404, 'Partner not found');
  const b = ctx.body || {}; const patch = {};
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw httpError(400, 'Pick a status'); patch.status = b.status; }
  for (const k of ['note', 'phone', 'email', 'website', 'courses', 'contact_name', 'contact_role', 'whatsapp', 'owner_id', 'address', 'area', 'city', 'state', 'type']) if (b[k] !== undefined) patch[k] = String(b[k]).slice(0, 2000);
  if (patch.whatsapp) { const L = require('./logic'); const w = L.digits10(patch.whatsapp); if (!L.validPhone(w)) throw httpError(400, 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9', 'whatsapp'); patch.whatsapp = w; }
  if (patch.status && STOP.includes(patch.status) && p.seq_on) { patch.seq_on = 0; patch.next_at = null; }
  update('partners', p.id, patch); D.history(ctx.actor.label, 'partner', String(p.id), null, null, JSON.stringify(patch));
  if (b.status !== undefined && b.status !== p.status) act(p.id, 'status', `Status: ${p.status} → ${b.status}${patch.seq_on === 0 ? ' (follow-ups stopped)' : ''}`, ctx.actor.label);
  if (b.note !== undefined && b.note !== p.note && String(b.note).trim()) act(p.id, 'note', String(b.note).trim(), ctx.actor.label);
  return get('SELECT * FROM partners WHERE id=?', p.id);
});

// ---------- Vendors: WhatsApp outreach and the follow-up sequence ----------
function waNumber(p) { const L = require('./logic'); for (const x of [p.whatsapp, ...String(p.phone || '').split(/[,/;|]| or /)]) { const d = L.digits10(String(x || '')); if (L.validPhone(d)) return d; } return null; }
function act(pid, kind, text, by) { insert('partner_activity', { partner_id: pid, kind, text, by: by || 'System', at: now() }); }
const varsOf = (p) => ({ name: p.contact_name || 'Sir / Madam', institute: p.name, city: p.city || '' });
// One WhatsApp to a vendor: from the business number when Meta has approved the message, else a ready-to-send
// chat link that opens the sender's own WhatsApp. Either way it is logged and the vendor moves to Contacted.
function sendTo(p, format, by, o = {}) {
  const L = require('./logic'); const s = D.settings(); const fm = (s.formats || {})[format];
  const wa = waNumber(p); if (!wa) return { skipped: 'No WhatsApp number' };
  if (p.opted_out) return { skipped: 'Asked not to be messaged' };
  const text = L.fillFormat(format, 'en', varsOf(p));
  let via = 'link'; let r = null;
  if (fm && fm.approved && !fm.off && (s.crm || {}).enabled) { r = L.sendWA({ ptype: 'partner', pid: p.id, format, vars: varsOf(p), by, auto: !!o.auto, bulk: !!o.bulk, noEmailCopy: true, dedupe: o.dedupe }); via = r && r.skipped ? 'skipped' : 'business'; }
  if (via === 'skipped') return { skipped: r.skipped };
  if (via === 'link' && o.auto) return { needs_hand: true, text, link: `https://wa.me/91${wa}?text=${encodeURIComponent(text)}` };
  act(p.id, 'whatsapp', `${via === 'business' ? 'WhatsApp sent from the business number' : 'WhatsApp opened to send from own phone'}: ${format === 'bbhs_partner_followup' ? 'follow-up' : 'introduction'}`, L.actorName(by));
  update('partners', p.id, { last_contact_at: now(), ...(p.status === 'New' ? { status: 'Contacted' } : {}) });
  return { via, text, link: via === 'link' ? `https://wa.me/91${wa}?text=${encodeURIComponent(text)}` : null };
}
function startSeq(p, by, fromStep = 0) {
  if (STOP.includes(p.status)) return false;
  // Day 0 is the step before fromStep (it has just happened), so the next step falls on its own day from now.
  const st = seq(); const start = new Date(Date.now() - (fromStep > 0 && st[fromStep - 1] ? st[fromStep - 1].day : 0) * 86400000).toISOString();
  update('partners', p.id, { seq_on: 1, seq_step: fromStep, seq_start: start, next_at: st[fromStep] ? new Date(new Date(start).getTime() + st[fromStep].day * 86400000).toISOString() : null, owner_id: p.owner_id || (by && by.uid) || null });
  act(p.id, 'sequence', 'Follow-ups started', require('./logic').actorName(by)); return true;
}
function advance(p) {
  const st = seq(); const n = (p.seq_step || 0) + 1;
  if (!st[n]) { update('partners', p.id, { seq_on: 0, seq_step: n, next_at: null }); act(p.id, 'sequence', 'Follow-ups finished: decide the status'); return; }
  update('partners', p.id, { seq_step: n, next_at: new Date(new Date(p.seq_start || now()).getTime() + st[n].day * 86400000).toISOString() });
}
function taskFor(p, title, detail) {
  const L = require('./logic'); const owner = p.owner_id || (L.superAdmins()[0] || {}).id || null;
  insert('tasks', { id: D.nextId('TK'), title, detail, area: 'Vendors', owner_id: owner, due_date: L.istDay(), status: 'Pending', by: 'Vendor follow-ups', at: now() });
  if (owner) L.alertUser(owner, title, null, false);
}
// Every timer run: due follow-up steps happen (or become a task for the owner).
function sweep() {
  let n = 0;
  for (const p of all("SELECT * FROM partners WHERE seq_on=1 AND next_at IS NOT NULL AND next_at<=?", now())) {
    if (STOP.includes(p.status)) { update('partners', p.id, { seq_on: 0, next_at: null }); continue; }
    const step = seq()[p.seq_step || 0]; if (!step) { advance(p); continue; }
    try {
      if (step.kind === 'whatsapp') {
        const r = sendTo(p, step.format, { label: 'Vendor follow-ups' }, { auto: true, dedupe: `vendor:${p.id}:${p.seq_step}` });
        if (r.needs_hand) { taskFor(p, `WhatsApp ${p.name} (${step.label})`, `Open the vendor in Vendors and press WhatsApp, or send this:\n\n${r.text}`); act(p.id, 'task', `Task made: ${step.label}`); }
        else if (r.skipped) act(p.id, 'skipped', `${step.label} skipped: ${r.skipped}`);
      } else { taskFor(p, `Call ${p.name}${p.contact_name ? ` (${p.contact_name})` : ''}: ${step.label.replace(/^[^:]*:\s*/, '')}`, `Phone: ${p.phone || waNumber(p) || 'not known'}${p.city ? `\nCity: ${p.city}` : ''}`); act(p.id, 'task', `Task made: ${step.label}`); }
    } catch (e) { act(p.id, 'error', `${step.label} failed: ${e.message}`); }
    advance(get('SELECT * FROM partners WHERE id=?', p.id)); n++;
  }
  return n;
}
const one = (id) => { const p = get('SELECT * FROM partners WHERE id=?', id); if (!p) throw httpError(404, 'Vendor not found'); return p; };
route('GET', '/api/partners/:id/activity', T, (ctx) => ({ rows: all('SELECT * FROM partner_activity WHERE partner_id=? ORDER BY id DESC LIMIT 100', ctx.params.id) }));
// WhatsApp one vendor (the introduction first time, then the follow-up), and start follow-ups unless told not to.
route('POST', '/api/partners/:id/whatsapp', T, (ctx) => {
  const p = one(ctx.params.id); const b = ctx.body || {};
  const format = b.format === 'bbhs_partner_followup' || (!b.format && p.last_contact_at) ? 'bbhs_partner_followup' : 'bbhs_partner_outreach';
  const r = sendTo(p, format, ctx.actor); if (r.skipped) throw httpError(400, r.skipped === 'No WhatsApp number' ? 'Add a WhatsApp number for this vendor first' : r.skipped);
  const fresh = one(p.id); if (b.sequence !== false && !fresh.seq_on && format === 'bbhs_partner_outreach') startSeq(fresh, ctx.actor, 1);
  return r;
});
route('POST', '/api/partners/bulk', T, (ctx) => {
  const b = ctx.body || {}; const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 300); if (!ids.length) throw httpError(400, 'Select some vendors first');
  const out = { done: 0, skipped: [], links: [] };
  for (const id of ids) {
    const p = get('SELECT * FROM partners WHERE id=?', id); if (!p) continue;
    if (b.action === 'status') { if (!STATUSES.includes(b.value)) throw httpError(400, 'Pick a status'); update('partners', p.id, { status: b.value, ...(STOP.includes(b.value) ? { seq_on: 0, next_at: null } : {}) }); act(p.id, 'status', `Status: ${p.status} → ${b.value}`, ctx.actor.label); out.done++; continue; }
    if (b.action === 'owner') { update('partners', p.id, { owner_id: b.value || null }); out.done++; continue; }
    if (b.action === 'stop') { if (p.seq_on) { update('partners', p.id, { seq_on: 0, next_at: null }); act(p.id, 'sequence', 'Follow-ups stopped', ctx.actor.label); out.done++; } continue; }
    if (b.action === 'sequence') { // start follow-ups: the first step (WhatsApp introduction) is due now, the timer does the rest
      if (p.seq_on) { out.skipped.push({ id, reason: 'Follow-ups already running' }); continue; }
      if (STOP.includes(p.status)) { out.skipped.push({ id, reason: `Status is ${p.status}` }); continue; }
      if (!waNumber(p) && !p.phone) { out.skipped.push({ id, reason: 'No phone number' }); continue; }
      startSeq(p, ctx.actor, 0); out.done++; continue;
    }
    throw httpError(400, 'Unknown action');
  }
  if (b.action === 'sequence' && out.done) sweep(); // the WhatsApp introduction goes (or becomes a task) straight away
  return out;
});


module.exports = { STATUSES, TYPES, SEQUENCE, sweep, waNumber };
