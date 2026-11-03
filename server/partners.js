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
`);

const STATUSES = ['New', 'Contacted', 'Meeting fixed', 'Partner', 'Not relevant'];
const TYPES = ['CAD / jewellery design institute', 'Jewellery design college', 'Gemmology institute', 'Goldsmith / karigar training centre', 'Retail and sales training institute', 'Polytechnic / ITI', 'University / college department', 'Skill development centre (NSDC / PMKVY)'];
// What one search usually costs: OpenAI charges per web search ($0.01) plus the words read and written.
const ESTIMATE = { low: 3, high: 8 };

const T = { auth: 'team' };
const ADMIN = { auth: 'team', levels: ['super', 'admin'], rate: { key: 'partner_search', max: 30, minutes: 60 } };

route('GET', '/api/partners', T, (ctx) => {
  const q = ctx.query; const s = String(q.q || '').toLowerCase();
  const rows = all('SELECT * FROM partners ORDER BY at DESC, id DESC').filter((p) => (!q.status || p.status === q.status) && (!q.city || p.city === q.city) && (!s || [p.name, p.type, p.courses, p.city, p.area].some((x) => String(x || '').toLowerCase().includes(s))));
  const counts = Object.fromEntries(STATUSES.map((x) => [x, all('SELECT 1 FROM partners WHERE status=?', x).length]));
  return { rows, counts, total: all('SELECT 1 FROM partners').length, statuses: STATUSES, types: TYPES, estimate: ESTIMATE, can_search: ['super', 'admin'].includes(ctx.user.level), ai: LLM.provider() === 'openai', searches: all('SELECT * FROM partner_searches ORDER BY id DESC LIMIT 10').map((x) => ({ ...x, query: JSON.parse(x.query || '{}') })), spent_inr: (get('SELECT SUM(cost_inr) n FROM partner_searches') || {}).n || 0 };
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
  const where = [q.area, q.city, q.state].filter(Boolean).join(', ');
  const r = await LLM.webLookup({ system: SYSTEM, name: 'institutes', schema: SCHEMA, maxTokens: 2500,
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
  const b = ctx.body || {}; if (!String(b.name || '').trim()) throw httpError(400, 'Enter the name', 'name');
  insert('partners', { name: b.name.trim(), type: b.type || '', industry: 'Jewellery', courses: b.courses || '', address: b.address || '', area: b.area || '', city: b.city || '', state: b.state || '', distance_km: null, phone: b.phone || '', email: b.email || '', website: b.website || '', source_url: '', why: '', status: 'New', note: b.note || '', search_id: null, by: ctx.actor.label, at: now() });
  return { id: get('SELECT last_insert_rowid() id').id };
});
route('PATCH', '/api/partners/:id', T, (ctx) => {
  const p = get('SELECT * FROM partners WHERE id=?', ctx.params.id); if (!p) throw httpError(404, 'Partner not found');
  const b = ctx.body || {}; const patch = {};
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw httpError(400, 'Pick a status'); patch.status = b.status; }
  for (const k of ['note', 'phone', 'email', 'website', 'courses']) if (b[k] !== undefined) patch[k] = String(b[k]).slice(0, 2000);
  update('partners', p.id, patch); D.history(ctx.actor.label, 'partner', String(p.id), null, null, JSON.stringify(patch));
  return get('SELECT * FROM partners WHERE id=?', p.id);
});

module.exports = { STATUSES, TYPES };
