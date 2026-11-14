// Agents (tie-ups of type "Individual agent", across India). We send each one our openings on WhatsApp: a brief with
// what they earn per joining and a link to their page, which holds the ready message to forward in their network
// (job links carry the agent's source code). They send the resumes they collect back on WhatsApp: each resume is
// read and becomes a candidate with the source "<Agent name> - Agent". Results per agent: resumes, applications,
// interviews, offers, joined, revenue from those placements, what we paid the agent, and the profit.
const crypto = require('crypto');
const D = require('./db');
const L = require('./logic');
const R = require('./router');
const S = require('./sources');
const { route } = R;
const { get, all, insert, update, now, httpError } = D;
const T = { auth: 'team' };

for (const col of ['rate INTEGER', 'code TEXT', 'region TEXT', 'opted_out INTEGER DEFAULT 0']) { try { D.db.exec(`ALTER TABLE tieups ADD COLUMN ${col}`); } catch { /* already there */ } }
D.db.exec(`
CREATE TABLE IF NOT EXISTS agent_shares (id INTEGER PRIMARY KEY AUTOINCREMENT, tieup_id INTEGER, token TEXT UNIQUE, jobs TEXT, earning INTEGER, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS tieup_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, tieup_id INTEGER, amount REAL, day TEXT, note TEXT, by TEXT, at TEXT, expense_id INTEGER);
`);

const AGENT = 'Individual agent';
const sourceOf = (t) => `${String(t.name || '').trim()} - ${t.type === AGENT ? 'Agent' : (t.type || 'Tie-up')}`;
function codeOf(t) { if (t.code) return t.code; const c = S.codeFor(sourceOf(t), t.id); D.run('UPDATE tieups SET code=? WHERE id=?', c, t.id); return c; }
const tieup = (id) => get('SELECT * FROM tieups WHERE id=?', Number(id));
const byPhone = (phone) => { const p = L.digits10(phone); return p ? get("SELECT * FROM tieups WHERE phone=? AND IFNULL(opted_out,0)=0 ORDER BY (type='Individual agent') DESC LIMIT 1", p) : null; };

// ---------- the message they forward ----------
function jobLine(j, code, i) {
  const v = require('./views').jobView(j);
  const sal = v.salary_text && !/hidden/i.test(v.salary_text) ? ` · ${v.salary_text}` : '';
  return `${i + 1}. *${j.title}*, ${j.city || ''}${sal}${j.openings > 1 ? ` · ${j.openings} openings` : ''}\n   Details and apply: ${L.link(`jd/${j.id}`, `?src=${encodeURIComponent(code)}`)}`;
}
function forwardText(t, jobs) {
  const code = codeOf(t); const b = D.settings().business || {};
  return [`*Jobs open now* (${b.name || 'BrillBrains Hiring'})`, '', ...jobs.map((j, i) => jobLine(j, code, i)), '', `Interested? Send your resume on WhatsApp to ${t.contact || t.name}${t.phone ? ` (${t.phone})` : ''}, or apply on the link of the job.`].join('\n');
}

// ---------- share openings with an agent ----------
function share(t, jobIds, earning, by) {
  const jobs = jobIds.map((id) => get('SELECT * FROM jobs WHERE id=?', id)).filter(Boolean);
  if (!jobs.length) throw httpError(400, 'Pick the job openings to share', 'jobs');
  const amt = Math.max(0, Math.round(Number(earning ?? t.rate) || 0));
  const token = crypto.randomBytes(9).toString('base64url');
  insert('agent_shares', { tieup_id: t.id, token, jobs: jobs.map((j) => j.id), earning: amt, by: by.label, at: now() });
  if (amt && amt !== t.rate) update('tieups', t.id, { rate: amt });
  const link = L.link(`agent/${token}`); let wa = null;
  if (t.phone) { try { wa = L.sendWA({ ptype: 'tieup', pid: t.id, format: 'bbhs_agent_brief', vars: { jobs: jobs.map((j) => `${j.title} (${j.city || ''})`).join(', '), earning: amt ? `Rs ${amt.toLocaleString('en-IN')} for every candidate from you who joins` : 'a payout for every candidate from you who joins', link }, by, bulk: true, noEmailCopy: true }); } catch (e) { wa = { skipped: e.message }; } }
  D.history(by.label, 'openings shared with agent', `TU-${t.id}`, null, null, `${jobs.length} jobs${amt ? ` · Rs ${amt} per joining` : ''}`);
  return { link, text: forwardText(t, jobs), wa: wa && wa.skipped ? `Not sent on WhatsApp: ${wa.skipped}` : t.phone ? 'Sent on WhatsApp' : 'No WhatsApp number: share the link yourself', phone: t.phone };
}

// ---------- the agent's page: the message to forward, with copy and share buttons ----------
function pageHtml(token) {
  const sh = get('SELECT * FROM agent_shares WHERE token=?', String(token || '')); const t = sh && tieup(sh.tieup_id);
  const e = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (!sh || !t) return '<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:24px">This link is not valid any more.</p>';
  const jobs = JSON.parse(sh.jobs || '[]').map((id) => get('SELECT * FROM jobs WHERE id=?', id)).filter((j) => j && !j.archived);
  const text = forwardText(t, jobs); const b = D.settings().business || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Openings to share · ${e(b.name || 'BrillBrains Hiring')}</title>
<style>body{margin:0;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;background:#F6F7FB;color:#101A3A}main{max-width:680px;margin:0 auto;padding:20px 16px 40px}h1{font-size:20px;margin:0 0 4px}.card{background:#fff;border:1px solid #E3E7EF;border-radius:14px;padding:16px;margin-top:14px}textarea{width:100%;box-sizing:border-box;min-height:260px;border:1px solid #D6DCE8;border-radius:10px;padding:12px;font:14px/1.5 system-ui}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}.btn{flex:1 1 180px;text-align:center;padding:12px 14px;border-radius:10px;border:0;font:600 15px system-ui;cursor:pointer;text-decoration:none}.p{background:#101A3A;color:#fff}.g{background:#25D366;color:#fff}.m{color:#5B6478;font-size:13px}</style></head>
<body><main><h1>Hello ${e(t.contact || t.name)}</h1><div class="m">${jobs.length} opening${jobs.length === 1 ? '' : 's'} to share in your network.${sh.earning ? ` You earn <b>Rs ${Number(sh.earning).toLocaleString('en-IN')}</b> for every candidate from you who joins.` : ''}</div>
<div class="card"><b>1. Forward this message</b><div class="m">Copy it, or share it straight to WhatsApp groups and contacts.</div><textarea id="t" readonly>${e(text)}</textarea>
<div class="row"><button class="btn p" id="c">Copy message</button><a class="btn g" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Share on WhatsApp</a></div></div>
<div class="card"><b>2. Send us the resumes</b><div class="m">When people send you their resumes, forward each resume (PDF, Word or a photo) to us on WhatsApp${D.settings().business && D.settings().business.whatsapp ? ` at ${e(D.settings().business.whatsapp)}` : ''}. We read it, add the person, and count them as yours.</div></div>
</main><script>document.getElementById('c').onclick=function(){var t=document.getElementById('t');t.select();try{navigator.clipboard.writeText(t.value)}catch(e){document.execCommand('copy')}this.textContent='Copied';};</script></body></html>`;
}

// ---------- resumes and messages from an agent's number ----------
async function inbound(t, b) {
  const id = D.nextId('WA');
  insert('messages', { id, person_type: 'tieup', person_id: String(t.id), phone: L.digits10(b.phone), direction: 'in', text: b.text || b.button || (b.media ? `File: ${b.media.name || 'resume'}` : ''), buttons: [], sent_by: 'them', status: 'received', read_by_us: 0, at: now() });
  const isCv = !!(b.media && b.media.base64 && /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|image\/(jpeg|png))/.test(String(b.media.mime || '')));
  if (!isCv) { if (t.owner_id) L.alertUser(t.owner_id, `${t.name} (agent) wrote: ${String(b.text || b.button || '').slice(0, 80)}`, `TU-${t.id}`, false); return { id, ptype: 'tieup', pid: t.id, effect: 'Saved in inbox' }; }
  const ext = { 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'image/jpeg': 'jpg', 'image/png': 'png' }[String(b.media.mime).split(';')[0]];
  let name = String(b.media.name || `resume-from-${t.name}.${ext || 'pdf'}`).replace(/[\\/]/g, '_'); if (ext && !/\.(pdf|docx?|jpe?g|png)$/i.test(name)) name += `.${ext}`;
  const buf = Buffer.from(String(b.media.base64).replace(/^data:[^,]*,/, ''), 'base64');
  const src = sourceOf(t); const by = { label: `${t.name} (agent)` };
  const r = await require('./resumes').attachResume({ file: name, buf, source: src }, by);
  let effect = r.status === 'created' ? `New candidate ${r.id} from ${t.name}` : r.status === 'attached' ? `Resume added to ${r.id}` : `Not added: ${r.why || r.status}`;
  if (r.id) { const c = get('SELECT * FROM candidates WHERE id=?', r.id); if (c && !c.tieup_id) update('candidates', c.id, { tieup_id: t.id, ...(r.status === 'created' ? { source: src, source_code: codeOf(t) } : {}) }); }
  update('tieups', t.id, { last_list: L.istDay() });
  // a short thank-you to the agent, at most once an hour
  try { L.sendWA({ ptype: 'tieup', pid: t.id, text: r.id ? `Received the resume${r.name ? ` of ${r.name}` : ''}. Thank you.` : 'We received your file but could not read a resume in it. Please send the resume as a PDF or Word file.', by: { label: 'Auto' }, auto: true, dedupe: `agent_ack:${t.id}:${new Date().toISOString().slice(0, 13)}` }); } catch { /* the resume is saved either way */ }
  return { id, ptype: 'tieup', pid: t.id, effect };
}

// ---------- results ----------
function results(t) {
  const cands = all('SELECT id FROM candidates WHERE tieup_id=? AND merged_into IS NULL AND removed=0', t.id).map((c) => c.id);
  if (!cands.length) return { resumes: 0, applications: 0, interviews: 0, offers: 0, joined: 0, revenue: 0, paid: paidTo(t.id), profit: -paidTo(t.id) };
  const q = cands.map(() => '?').join(',');
  const apps = all(`SELECT * FROM applications WHERE candidate_id IN (${q})`, ...cands);
  const reached = (a, step) => a.result === 'Hired' || L.stepIdx(a.step) >= L.stepIdx(step);
  const ids = apps.map((a) => a.id);
  const revenue = ids.length ? (get(`SELECT SUM(fee) s FROM bills WHERE app_id IN (${ids.map(() => '?').join(',')}) AND status NOT IN ('Cancelled','Draft') AND credit_of IS NULL`, ...ids) || {}).s || 0 : 0;
  const paid = paidTo(t.id);
  return { resumes: cands.length, applications: apps.length, interviews: apps.filter((a) => reached(a, 'Our interview')).length, offers: apps.filter((a) => reached(a, 'Offer made')).length, joined: apps.filter((a) => a.result === 'Hired' || a.step === 'Joined' || a.joined_at).length, revenue: Math.round(revenue), paid, profit: Math.round(revenue - paid) };
}
const paidTo = (id) => Math.round((get('SELECT SUM(amount) s FROM tieup_payments WHERE tieup_id=?', id) || {}).s || 0);

// ---------- routes ----------
route('GET', '/api/tieups/results', T, () => Object.fromEntries(all('SELECT * FROM tieups').map((t) => [t.id, { ...results(t), code: codeOf(t), source: sourceOf(t) }])));
route('GET', '/api/tieups/:id/share', T, (ctx) => { const t = tieup(ctx.params.id); if (!t) throw httpError(404, 'Tie-up not found'); return { rate: t.rate || 0, jobs: all("SELECT id, title, city, openings FROM jobs WHERE archived=0 ORDER BY created_at DESC").filter((j) => !['Closed', 'Filled', 'On hold', 'Draft'].includes(L.computeJobStatus(j, L.appsOfJob(j.id)))) }; }); // live jobs only (a draft has no Apply button)
route('POST', '/api/tieups/:id/share', T, (ctx) => { const t = tieup(ctx.params.id); if (!t) throw httpError(404, 'Tie-up not found'); return share(t, [].concat(ctx.body.jobs || []), ctx.body.earning, ctx.actor); });
route('GET', '/api/tieups/:id/payments', T, (ctx) => all('SELECT * FROM tieup_payments WHERE tieup_id=? ORDER BY day DESC, id DESC', Number(ctx.params.id)));
route('POST', '/api/tieups/:id/pay', T, (ctx) => {
  const t = tieup(ctx.params.id); if (!t) throw httpError(404, 'Tie-up not found');
  const amount = Math.round(Number(ctx.body.amount) || 0); if (amount <= 0) throw httpError(400, 'Enter the amount paid', 'amount');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(ctx.body.day || '') ? ctx.body.day : L.istDay(); const note = String(ctx.body.note || '').trim().slice(0, 300);
  // into Expenses too, so Profit & Loss carries it
  const ex = D.run('INSERT INTO expenses (agency_id,date,category,amount,note,by,at) VALUES (?,?,?,?,?,?,?)', ctx.user.agency_id || null, day, 'Agent payments', amount, `${t.name}${note ? `: ${note}` : ''}`, ctx.actor.label, now());
  D.run('INSERT INTO tieup_payments (tieup_id,amount,day,note,by,at,expense_id) VALUES (?,?,?,?,?,?,?)', t.id, amount, day, note, ctx.actor.label, now(), Number(ex.lastInsertRowid));
  D.history(ctx.actor.label, 'agent paid', `TU-${t.id}`, null, null, `Rs ${amount}`);
  return { ok: true, paid: paidTo(t.id) };
});
route('GET', '/api/sources', T, () => S.list());

module.exports = { byPhone, inbound, pageHtml, sourceOf, codeOf, results, AGENT };
