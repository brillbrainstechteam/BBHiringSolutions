// Monthly summary for each client (section 17, optional): openings, hires and bills for one month,
// saved as a PDF on the client (they download it from Company & papers) and announced on WhatsApp.
const D = require('./db');
const L = require('./logic');
const F = require('./files');
const { get, all } = D;

// "2026-10" → { from, to, label } in India time.
function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - 330 * 60000).toISOString();
  const to = new Date(Date.UTC(y, m, 1) - 330 * 60000 - 1).toISOString();
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return { from, to, label };
}
const prevMonthKey = (d = new Date()) => { const t = new Date(new Date(d).getTime() + 330 * 60000); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - 1); return t.toISOString().slice(0, 7); };

function numbers(clientId, key) {
  const { from, to } = monthRange(key);
  const inR = (t) => t && t >= from && t <= to;
  const jobs = all('SELECT * FROM jobs WHERE client_id=?', clientId);
  const ids = new Set(jobs.map((j) => j.id));
  const apps = all('SELECT * FROM applications').filter((a) => ids.has(a.job_id));
  const appIds = new Set(apps.map((a) => a.id));
  const hist = all("SELECT * FROM app_history WHERE kind='step'").filter((h) => appIds.has(h.app_id) && inR(h.at));
  const moved = (step) => new Set(hist.filter((h) => h.step === step).map((h) => h.app_id)).size;
  const bills = all("SELECT * FROM bills WHERE client_id=? AND status NOT IN ('Draft','Cancelled')", clientId).map(L.billView);
  const views = jobs.map((j) => ({ ...j, status: L.computeJobStatus(j, apps.filter((a) => a.job_id === j.id)) }));
  return {
    jobs: views, newJobs: jobs.filter((j) => inR(j.created_at)).length, openJobs: views.filter((j) => !['Closed', 'Filled'].includes(j.status)).length,
    sent: moved('Sent to client'), interviews: all('SELECT * FROM interviews').filter((i) => appIds.has(i.app_id) && i.round === 'client' && inR(i.at)).length,
    offers: moved('Offer made'), joined: apps.filter((a) => a.result === 'Hired' && inR(a.joined_at)),
    billed: bills.filter((b) => inR(b.issued_at)), paid: all('SELECT p.* FROM payments p JOIN bills b ON b.id=p.bill_id WHERE b.client_id=?', clientId).filter((p) => inR(new Date(p.date + 'T12:00:00+05:30').toISOString())),
    due: bills.filter((b) => b.balance > 0),
  };
}

function makeSummary(clientId, key, by) {
  const c = get('SELECT * FROM clients WHERE id=?', clientId); if (!c) throw D.httpError(404, 'Client not found');
  const { label } = monthRange(key); const n = numbers(clientId, key);
  const lines = [
    { text: `${c.company} · ${label}`, size: 13, bold: true }, '',
    { text: 'This month', bold: true },
    `New job openings: ${n.newJobs}    Open now: ${n.openJobs}`,
    `Profiles sent to you: ${n.sent}    Your interviews: ${n.interviews}    Offers made: ${n.offers}    Joined: ${n.joined.length}`, '',
    { text: 'Job openings', bold: true },
    ...n.jobs.map((j) => `${j.id} ${j.title}, ${j.city} — ${j.status} (${j.openings} opening${j.openings > 1 ? 's' : ''})`), '',
    { text: 'People who joined', bold: true },
    ...(n.joined.length ? n.joined.map((a) => { const cand = get('SELECT name FROM candidates WHERE id=?', a.candidate_id); const j = get('SELECT title FROM jobs WHERE id=?', a.job_id); return `${cand.name} — ${j.title}, joined ${L.istFmt(a.joining_date, false)}`; }) : ['None this month']), '',
    { text: 'Bills', bold: true },
    `Billed this month: ${L.inr(n.billed.reduce((s, b) => s + b.total, 0))} (${n.billed.length} bill${n.billed.length === 1 ? '' : 's'})`,
    `Paid this month: ${L.inr(n.paid.reduce((s, p) => s + p.amount, 0))}`,
    `Still due: ${L.inr(n.due.reduce((s, b) => s + b.balance, 0))}${n.due.length ? ' — ' + n.due.map((b) => `${b.bill_no} ${L.inr(b.balance)} (${b.view_status})`).join(', ') : ''}`,
  ];
  const buf = F.makePdf(`Monthly hiring summary`, lines, D.settings().business);
  const f = F.storeBuffer({ recordId: clientId, type: `monthly_summary`, name: `Summary-${key}.pdf`, buf, mime: 'application/pdf', by: L.actorName(by) || 'Software' });
  // Each month is its own file, so older months stay downloadable.
  D.update('files', f.id, { type: `monthly_summary_${key}` });
  return { file: f, label, short: `${n.newJobs} new openings, ${n.sent} profiles sent, ${n.joined.length} joined` };
}

// Called by the timer: on the 1st (India time), for every client with at least one job opening.
function runMonthly() {
  const t = new Date(Date.now() + 330 * 60000);
  if (t.getUTCDate() !== 1) return 0;
  const key = prevMonthKey(); let n = 0;
  for (const c of all('SELECT * FROM clients WHERE merged_into IS NULL AND removed=0 AND archived=0')) {
    if (!get('SELECT 1 FROM jobs WHERE client_id=?', c.id)) continue;
    if (get('SELECT 1 FROM files WHERE record_id=? AND type=?', c.id, `monthly_summary_${key}`)) continue;
    const r = makeSummary(c.id, key, null);
    L.sendWA({ ptype: 'client', pid: c.id, format: 'bbhs_monthly_summary', vars: { month: r.label, summary: r.short, link: L.link('my-account/company') }, auto: true, rule: 'monthly_summary', dedupe: `monthly:${c.id}:${key}` });
    n++;
  }
  return n;
}

module.exports = { makeSummary, runMonthly, prevMonthKey };
