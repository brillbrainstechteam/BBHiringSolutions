// Team portal API (section 6.5). Every handler checks access with the rules in router.js.
const D = require('./db');
const L = require('./logic');
const V = require('./views');
const F = require('./files');
const I = require('./importer');
const R = require('./router');
const { route, isSuper, seeClient, seeJob, seeApp, seeBill, seeThread, candidateOut } = R;
const { get, all, insert, update, now, httpError } = D;

const T = { auth: 'team' };
const SUPER = { auth: 'team', levels: ['super'] };
const ADMINS = { auth: 'team', levels: ['super', 'admin'] };

// Lists: 50 rows a page; filters run on the full data. format=xlsx (or csv) downloads with filters on.
// Sort a list by one of its allowed fields. Blanks stay last either way.
function sortBy(rows, q, allowed) {
  if (!allowed.includes(q.sort)) return rows; const k = q.sort; const dir = q.dir === 'desc' ? -1 : 1; const blank = (v) => v === null || v === undefined || v === '';
  return [...rows].sort((a, b) => { const x = a[k]; const y = b[k]; if (blank(x) || blank(y)) return blank(x) - blank(y); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { sensitivity: 'base', numeric: true })) * dir; });
}
function page(ctx, rows, name, columns) {
  const fmt = ctx.query.format;
  // Lists leave the portal (Excel/CSV) only for the super admin; admins and sub admins work on screen.
  if ((fmt === 'csv' || fmt === 'xlsx') && !isSuper(ctx.user)) { D.history(ctx.actor.label, 'download refused', null, name, null, null, null, ctx.ip); throw httpError(403, 'Downloads are for the super admin only.'); }
  if (fmt === 'csv' || fmt === 'xlsx') {
    D.history(ctx.actor.label, 'download', null, name, null, `${rows.length} rows`, null, ctx.ip);
    const cols = columns || Object.keys(rows[0] || {}).filter((k) => typeof rows[0][k] !== 'object');
    const table = [cols.map((c) => (Array.isArray(c) ? c[1] : c)), ...rows.map((r) => cols.map((c) => (Array.isArray(c) ? (typeof c[0] === 'function' ? c[0](r) : r[c[0]]) : r[c])))];
    if (fmt === 'xlsx') return { __file: { name: `${name}-${L.istDay()}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: F.toXLSX(table, name) } };
    return { __file: { name: `${name}-${L.istDay()}.csv`, mime: 'text/csv', buf: Buffer.from(F.toCSV(table), 'utf8') } };
  }
  const size = ctx.query.all ? 2000 : 50; const p = Math.max(1, Number(ctx.query.page) || 1); // all=1: pickers that list everything
  return { rows: rows.slice((p - 1) * size, p * size), total: rows.length, page: p, pages: Math.max(1, Math.ceil(rows.length / size)) };
}
const like = (q, ...vals) => !q || vals.some((v) => v && String(v).toLowerCase().includes(String(q).toLowerCase()));
function mustSee(ok, what = 'record') { if (!ok) throw httpError(403, `You cannot see this ${what}.`); }
const leadCount = (u) => all('SELECT * FROM clients WHERE agency_id IS NULL AND old_client=0 AND junk=0 AND archived=0 AND merged_into IS NULL AND removed=0').filter((c) => seeClient(u, c)).length;
const visibleJobs = (u) => all('SELECT * FROM jobs WHERE archived=0 ORDER BY created_at DESC').filter((j) => seeJob(u, j));
function visibleApps(u) {
  const jobs = new Map(all('SELECT * FROM jobs').map((j) => [j.id, j]));
  return all('SELECT * FROM applications ORDER BY created_at DESC').filter((a) => seeApp(u, a, jobs.get(a.job_id)));
}

// ---------- me / menu counts ----------
route('GET', '/api/me', { auth: 'team', allow2fa: true, channels: true, accounts: true }, (ctx) => {
  const u = ctx.user; const open_call = L.openCall(u.id);
  const counts = {
    leads: leadCount(u),
    cand_new: isSuper(u) ? get('SELECT COUNT(*) c FROM candidates WHERE agency_id IS NULL AND is_new=1 AND junk=0 AND archived=0 AND merged_into IS NULL AND removed=0').c : 0,
    pending: all("SELECT i.*, a.job_id, a.owner_id FROM interviews i JOIN applications a ON a.id=i.app_id WHERE i.status IN ('Scheduled','Rescheduled') AND i.at < ?", now()).filter((i) => seeApp(u, { id: i.app_id, owner_id: i.owner_id, job_id: i.job_id })).length,
    unread: unreadThreads(u),
    alerts: get('SELECT COUNT(*) c FROM alerts WHERE user_id=? AND read=0', u.id).c,
  };
  return { user: { id: u.id, name: u.name, level: u.level, agency_id: u.agency_id, role: u.role, username: u.username, must_change: u.must_change, whatsapp: u.whatsapp, team: u.team || 'Recruitment', channel_only: R.channelOnly(u), accounts_only: R.accountsOnly(u), leads: isSuper(u) || R.sharedWith(u) || R.canAllocate(u) }, agency: ctx.agency, counts, open_call };
});
function unreadThreads(u) {
  const rows = all("SELECT person_type, person_id FROM messages WHERE direction='in' AND read_by_us=0 GROUP BY person_type, person_id");
  return rows.filter((r) => seeThread(u, r.person_type, r.person_id)).length;
}

// ---------- search everything (18) ----------
route('GET', '/api/search', T, (ctx) => {
  const q = String(ctx.query.q || '').trim(); if (q.length < 2) return { groups: [] };
  const u = ctx.user; const id = L.resolveId(q.toUpperCase());
  const ph = L.digits10(q);
  const m = (vals) => vals.some((v) => v && String(v).toLowerCase().includes(q.toLowerCase())) || (ph.length >= 4 && vals.some((v) => v && String(v).includes(ph)));
  const clients = all('SELECT * FROM clients WHERE merged_into IS NULL AND removed=0').filter((c) => seeClient(u, c) && (c.id === id || m([c.id, c.company, c.contact, c.whatsapp, c.old_code]))).slice(0, 8);
  const jobs = visibleJobs(u).filter((j) => j.id === id || m([j.id, j.title, j.old_code, j.city])).slice(0, 8);
  const cands = all('SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0').filter((c) => c.id === id || m([c.id, c.name, R.phoneVisible(u, c) ? c.whatsapp : '', c.email, c.old_code])).slice(0, 8);
  const apps = visibleApps(u).filter((a) => a.id === id).slice(0, 5);
  D.history(ctx.actor.label, 'search', null, null, null, q);
  return {
    groups: [
      { type: 'client', title: 'Clients', items: clients.map((c) => ({ id: c.id, label: c.company || c.contact, sub: c.city })) },
      { type: 'job', title: 'Job openings', items: jobs.map((j) => ({ id: j.id, label: j.title, sub: V.jobView(j).client_name })) },
      { type: 'candidate', title: 'Candidates', items: cands.map((c) => ({ id: c.id, label: c.name, sub: `${c.job_wanted || ''} · ${c.city || ''}` })) },
      { type: 'application', title: 'Applications', items: apps.map((a) => { const v = V.appView(a); return { id: a.id, label: `${v.candidate_name} on ${v.job_title}`, sub: a.step }; }) },
    ].filter((g) => g.items.length),
  };
});

// ---------- performance (9) ----------
function perfOf(userId, fromISO, toISO = now()) {
  const inRange = (t) => t && t >= fromISO && t <= toISO;
  const h = all('SELECT * FROM app_history WHERE by_id=?', userId).filter((x) => inRange(x.at));
  const added = all('SELECT created_at FROM applications WHERE created_by=?', userId).filter((a) => inRange(a.created_at)).length;
  const screened = h.filter((x) => x.kind === 'step' && x.step === 'Screening').length;
  const sent = h.filter((x) => x.kind === 'step' && x.step === 'Sent to client').length;
  const offers = h.filter((x) => x.kind === 'offer').length;
  const joined = h.filter((x) => x.kind === 'step' && x.step === 'Joined').length;
  const interviews = all("SELECT completed_at FROM interviews WHERE completed_by=? AND status='Completed'", userId).filter((i) => inRange(i.completed_at)).length;
  const days = Math.max(1, Math.round((new Date(toISO) - new Date(fromISO)) / 86400000));
  const k = days / 30; const t = targetsFor(userId);
  const target = Math.round(((Math.min(1, screened / (t.screened * k)) + Math.min(1, sent / (t.sent * k)) + Math.min(1, joined / (t.joined * k))) / 3) * 100);
  return { added, screened, interviews, sent, offers, joined, target };
}
// Recruiter targets per role tag (Settings → Fees & limits); the standard targets apply to any other role.
function targetsFor(userId) {
  const all = D.settings().targets; const u = get('SELECT role FROM users WHERE id=?', userId);
  const byRole = (all.roles || {})[(u && u.role) || ''];
  return byRole || { screened: all.screened, sent: all.sent, joined: all.joined };
}
function logDots(userId, n = 7) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = L.istDay(new Date(Date.now() - i * 86400000));
    const lg = get('SELECT status FROM logs WHERE user_id=? AND day=?', userId, day);
    out.push({ day, status: lg ? lg.status : null });
  }
  return out;
}
function deadlinePassed() { const [h, m] = D.settings().log_deadline.split(':').map(Number); return L.istHour() >= h + m / 60; }
function personStatus(u) {
  if (u.status !== 'On') return 'Login off';
  const ag = u.agency_id ? get('SELECT status FROM agencies WHERE id=?', u.agency_id) : null;
  if (ag && ag.status === 'Paused') return 'Paused';
  const last = [u.last_login, u.last_action].filter(Boolean).sort().pop();
  const idle = last ? L.daysBetween(last) : 99;
  if (idle >= 3) return `Inactive ${idle > 90 ? '90+' : idle} days`;
  return 'Active';
}
function activity7(userId) {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const day = L.istDay(new Date(Date.now() - i * 86400000));
    const n = all('SELECT at FROM app_history WHERE by_id=?', userId).filter((x) => L.istDay(x.at) === day).length + all('SELECT completed_at FROM interviews WHERE completed_by=?', userId).filter((x) => x.completed_at && L.istDay(x.completed_at) === day).length;
    out.push({ day, n });
  }
  return out;
}
function agencyStatus(ag) {
  if (ag.status === 'Paused') return 'Paused';
  const people = all("SELECT * FROM users WHERE agency_id=? AND status='On'", ag.id).map(personStatus);
  if (!people.length || people.every((s) => s.startsWith('Inactive'))) return 'Inactive';
  if (people.some((s) => s.startsWith('Inactive') || s === 'Log missing today')) return 'Needs attention';
  return 'On track';
}
function personRow(u, from, to) {
  const lg = logDots(u.id);
  const tk = all('SELECT * FROM tasks WHERE removed=0').filter((t) => L.ownsTask(t, u.id)); const today = L.istDay();
  const tasks = { tasks_done: tk.filter((t) => t.status === 'Done' && t.done_at && t.done_at >= from && t.done_at <= to).length, tasks_open: tk.filter((t) => t.status !== 'Done').length, tasks_overdue: tk.filter((t) => t.status !== 'Done' && t.due_date && t.due_date < today).length };
  return { id: u.id, name: u.name, level: u.level, role: u.role, agency_id: u.agency_id, agency_name: V.agencyName(u.agency_id), status: personStatus(u), last_login: u.last_login, ...perfOf(u.id, from, to), ...tasks, logs: lg, log_pct: Math.round((lg.filter((x) => x.status).length / 7) * 100) };
}
// One agency's pipeline at this moment (not the date range). agency 'own' = BrillBrains' own work (no agency).
function pipelineOf(agencyId) {
  const own = agencyId === 'own'; const where = own ? 'agency_id IS NULL' : 'agency_id=?'; const args = own ? [] : [agencyId];
  const clients = all(`SELECT id, company FROM clients WHERE ${where} AND COALESCE(placeholder,0)=0`, ...args);
  const jobs = all(`SELECT * FROM jobs WHERE ${where} AND archived=0`, ...args).map((j) => V.jobView(j));
  const ids = jobs.map((j) => j.id); const apps = ids.length ? all(`SELECT * FROM applications WHERE job_id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const offered = new Set(ids.length ? all(`SELECT DISTINCT h.app_id FROM app_history h JOIN applications a ON a.id=h.app_id WHERE h.kind='offer' AND a.job_id IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => r.app_id) : []);
  const OFFER = ['Offer made', 'Offer accepted', 'Joined'];
  for (const a of apps) if (a.offer_sent || OFFER.includes(a.step) || a.result === 'Hired') offered.add(a.id);
  const joined = (a) => a.result === 'Hired' || a.step === 'Joined' || !!a.joined_at;
  const ACTIVE_NOT = ['Closed', 'Filled', 'Draft', 'On hold'];
  const active = jobs.filter((j) => !ACTIVE_NOT.includes(j.status));
  const activeClients = new Set(active.map((j) => j.client_id));
  const stages = Object.fromEntries(L.STEPS.map((st) => [st, 0]));
  for (const a of apps) if (a.result === 'open' && stages[a.step] !== undefined) stages[a.step]++;
  const done = { Joined: apps.filter(joined).length, Rejected: apps.filter((a) => a.result === 'Rejected').length, Withdrawn: apps.filter((a) => !['open', 'Hired', 'Rejected'].includes(a.result)).length };
  const perJob = jobs.filter((j) => j.status !== 'Draft').map((j) => {
    const ja = apps.filter((a) => a.job_id === j.id); const st = {}; for (const a of ja) if (a.result === 'open') st[a.step] = (st[a.step] || 0) + 1;
    return { id: j.id, title: j.title, client_name: j.client_name, status: j.status, openings: j.openings || 1, total: ja.length, open: ja.filter((a) => a.result === 'open').length, stages: st, offers: ja.filter((a) => offered.has(a.id)).length, joined: ja.filter(joined).length };
  }).sort((x, y) => (ACTIVE_NOT.includes(x.status) - ACTIVE_NOT.includes(y.status)) || y.open - x.open);
  const closedJoined = jobs.filter((j) => ['Closed', 'Filled'].includes(j.status) && apps.some((a) => a.job_id === j.id && joined(a)));
  return {
    clients: clients.length, clients_active: activeClients.size, clients_list: clients.map((c) => ({ id: c.id, company: c.company, active_jobs: active.filter((j) => j.client_id === c.id).length })).sort((x, y) => y.active_jobs - x.active_jobs),
    active_jobs: active.length, openings: active.reduce((n, j) => n + (j.openings || 1), 0), on_hold: jobs.filter((j) => j.status === 'On hold').length,
    apps_total: apps.length, apps_open: apps.filter((a) => a.result === 'open').length, stages, done,
    offers: offered.size, closed_joined: closedJoined.length, jobs: perJob,
  };
}
route('GET', '/api/performance', T, (ctx) => {
  const u = ctx.user; const days = Number(ctx.query.days) || 30;
  const from = ctx.query.from ? new Date(ctx.query.from).toISOString() : new Date(Date.now() - days * 86400000).toISOString();
  const to = ctx.query.to ? new Date(new Date(ctx.query.to).getTime() + 86399000).toISOString() : now();
  if (u.level === 'sub') return { level: 'sub', me: personRow(u, from, to), activity: activity7(u.id) };
  const users = all("SELECT * FROM users WHERE level!='super' ORDER BY agency_id, level, name").filter((x) => isSuper(u) || (x.agency_id === u.agency_id && (x.level === 'sub' || x.id === u.id)));
  const people = users.map((x) => personRow(x, from, to));
  if (u.level === 'admin') {
    const subs = people.filter((p) => p.level === 'sub');
    const sum = (k) => subs.reduce((a, p) => a + p[k], 0);
    return { level: 'admin', team: { members: subs.length, active: subs.filter((p) => p.status === 'Active').length, screened: sum('screened'), sent: sum('sent'), offers: sum('offers'), joined: sum('joined') }, people, me: personRow(u, from, to) };
  }
  const agencies = all('SELECT * FROM agencies ORDER BY id').filter((a) => !ctx.query.agency || a.id === ctx.query.agency).map((ag) => {
    const jobs = all('SELECT * FROM jobs WHERE agency_id=? AND archived=0', ag.id).map((j) => V.jobView(j));
    const apps = all('SELECT a.* FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.agency_id=?', ag.id);
    const bills = all("SELECT * FROM bills WHERE agency_id=? AND status NOT IN ('Cancelled','Draft') AND credit_of IS NULL", ag.id).filter((b) => b.created_at >= from && b.created_at <= to);
    const ppl = people.filter((p) => p.agency_id === ag.id);
    const h = all('SELECT h.* FROM app_history h JOIN applications a ON a.id=h.app_id JOIN jobs j ON j.id=a.job_id WHERE j.agency_id=?', ag.id).filter((x) => x.at >= from && x.at <= to);
    return {
      ...ag, view_status: agencyStatus(ag), active_today: ppl.filter((p) => p.status === 'Active').length, people: ppl.length,
      open_jobs: jobs.filter((j) => !['Closed', 'Filled', 'Draft'].includes(j.status)).length, active_apps: apps.filter((a) => a.result === 'open').length,
      sent: h.filter((x) => x.kind === 'step' && x.step === 'Sent to client').length, joined: h.filter((x) => x.kind === 'step' && x.step === 'Joined').length,
      fee: bills.reduce((a, b) => a + b.fee, 0), share: bills.reduce((a, b) => a + b.agency_share, 0), log_pct: ppl.length ? Math.round(ppl.reduce((a, p) => a + p.log_pct, 0) / ppl.length) : 0,
    };
  });
  return { level: 'super', agencies, people, own_jobs: get('SELECT COUNT(*) n FROM jobs WHERE agency_id IS NULL AND archived=0').n, agency_options: all('SELECT id, name FROM agencies ORDER BY name'), pipeline: ctx.query.agency ? pipelineOf(ctx.query.agency) : null };
});
route('GET', '/api/person/:id', T, (ctx) => {
  const u = ctx.user; const p = get('SELECT * FROM users WHERE id=?', ctx.params.id);
  mustSee(p && (isSuper(u) || p.id === u.id || (u.level === 'admin' && p.agency_id === u.agency_id)), 'person');
  const apps = all("SELECT * FROM applications WHERE owner_id=? AND result='open'", p.id).map(V.appView);
  return { ...personRow(p, new Date(Date.now() - 30 * 86400000).toISOString()), whatsapp: p.whatsapp, activity: activity7(p.id), apps };
});

// ---------- dashboard ----------
route('GET', '/api/dashboard', T, (ctx) => {
  const u = ctx.user;
  // Super admin: Overall (default), our own work ('none'), or one agency.
  const ag = isSuper(u) ? String(ctx.query.agency || '') : '';
  const inAg = (id) => !ag || (ag === 'none' ? !id : id === ag);
  const jobs = visibleJobs(u).filter((j) => inAg(j.agency_id)).map((j) => V.jobView(j));
  const jobIds = new Set(jobs.map((j) => j.id));
  const apps = visibleApps(u).filter((a) => !ag || jobIds.has(a.job_id));
  const appIds = new Set(apps.map((a) => a.id));
  const ivs = all('SELECT * FROM interviews').filter((i) => appIds.has(i.app_id)).map(L.interviewView);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString();
  const byStatus = {};
  for (const j of jobs) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  const bills = all('SELECT * FROM bills').filter((b) => seeBill(u, b) && inAg(b.agency_id)).map(L.billView);
  const att = [];
  for (const i of ivs.filter((x) => x.view_status === 'Result pending')) {
    const a = V.appView(apps.find((x) => x.id === i.app_id));
    const interviewer = get('SELECT id FROM users WHERE lower(name)=lower(?)', i.interviewer || '');
    att.push({ kind: 'Result not recorded', text: `${i.id} ${a.candidate_name} — ${a.job_title} (${i.round === 'ours' ? 'our round' : 'client round'})`, record: i.app_id, open: { type: 'application', id: i.app_id }, wa: i.round === 'client' ? { ptype: 'client', pid: a.client_id, format: 'bbhs_feedback_request', ap: a.id, iv: i.id } : { ptype: 'user', pid: (interviewer && interviewer.id) || a.owner_id, format: 'bbhs_team_task_alert', ap: a.id, iv: i.id, vars: { task: `Record result of ${i.id}`, record_id: i.id } } });
  }
  for (const a of apps.filter((x) => x.result === 'open' && !x.on_hold && L.daysBetween(x.step_since || x.created_at) >= 7)) {
    const v = V.appView(a);
    att.push({ kind: 'Stuck 7+ days', text: `${a.id} ${v.candidate_name} at ${a.step} for ${v.days_in_step} days`, open: { type: 'application', id: a.id }, wa: u.level === 'admin' || isSuper(u) ? { ptype: 'user', pid: a.owner_id, format: 'bbhs_team_task_alert', ap: a.id, vars: { task: `Move ${a.id} forward`, record_id: a.id } } : { ptype: 'candidate', pid: a.candidate_id, ap: a.id, suggest: true } });
  }
  for (const a of apps.filter((x) => x.at_risk && x.result === 'Hired' && !x.left_date)) { const v = V.appView(a); att.push({ kind: 'At risk', text: `${a.id} ${v.candidate_name} asked for help at ${v.client_name}`, open: { type: 'application', id: a.id }, wa: { ptype: 'candidate', pid: a.candidate_id, ap: a.id, suggest: true } }); }
  for (const j of jobs.filter((x) => x.status === 'Open' && x.apps_total === 0)) att.push({ kind: 'No candidates', text: `${j.id} ${j.title} — ${j.client_name}`, open: { type: 'job', id: j.id }, wa: { ptype: 'user', pid: j.recruiter_id || u.id, format: 'bbhs_team_task_alert', jb: j.id, vars: { task: `Add candidates to ${j.id}`, record_id: j.id } } });
  // Automatic matching: open jobs that still need people and have strong matches in the resume bank not yet added.
  for (const j of jobs.filter((x) => ['Open', 'Sourcing'].includes(x.status) && (x.apps_open || 0) < (x.openings || 1) * 3)) {
    const strong = L.bestMatches(get('SELECT * FROM jobs WHERE id=?', j.id), 10).filter((m) => m.score >= D.settings().match.strong);
    if (strong.length) att.push({ kind: 'Strong matches', text: `${strong.length} strong match${strong.length > 1 ? 'es' : ''} for ${j.id} ${j.title} — top: ${strong[0].c.name} (${strong[0].score}%)`, open: { type: 'job', id: j.id } });
  }
  for (const j of jobs.filter((x) => x.status === 'Draft' && ['Not written', 'Changes asked'].includes(x.jd_status))) att.push({ kind: 'Write job description', text: `${j.id} ${j.title} — ${j.client_name}${j.jd_status === 'Changes asked' ? ' (client asked for changes)' : ''}`, open: { type: 'job', id: j.id }, wa: { ptype: 'user', pid: j.recruiter_id || u.id, format: 'bbhs_team_task_alert', jb: j.id, vars: { task: `Write the JD for ${j.id}`, record_id: j.id } } });
  for (const t of L.openTasksOf(u.id)) att.push({ kind: t.due_date && t.due_date < L.istDay() ? 'Task overdue' : 'Task', text: `${t.title}${t.due_date ? ` · due ${L.istFmt(t.due_date, false)}` : ''}`, open: { type: 'task', id: t.id } });
  for (const b of bills.filter((x) => x.view_status === 'Overdue')) { const cl = get('SELECT company FROM clients WHERE id=?', b.client_id); att.push({ kind: 'Overdue bill', text: `${b.bill_no} ${cl.company} — ${L.inr(b.balance)}`, open: { type: 'bill', id: b.id }, wa: { ptype: 'client', pid: b.client_id, format: 'bbhs_payment_reminder', bl: b.id, vars: { bill_no: b.bill_no, amount: L.inr(b.balance), status: 'overdue', link: L.upiLink(b.balance, b.bill_no) } } }); }
  for (const b of bills.filter((x) => x.status === 'Draft')) { const cl = get('SELECT company FROM clients WHERE id=?', b.client_id); att.push({ kind: 'Bill to issue', text: `${b.id} draft for ${cl.company}`, open: { type: 'bill', id: b.id } }); }
  const leadsNew = leadCount(u);
  if (leadsNew && R.canAllocate(u)) att.push({ kind: 'Leads to assign', text: `${leadsNew} new client lead(s) waiting for an agency`, open: { type: 'page', id: 'leads' } });
  if (isSuper(u)) {
    const nc = get('SELECT COUNT(*) c FROM candidates WHERE agency_id IS NULL AND is_new=1 AND junk=0 AND archived=0 AND merged_into IS NULL AND removed=0').c;
    if (nc) att.push({ kind: 'New candidates', text: `${nc} new candidate(s) waiting for an agency`, open: { type: 'page', id: 'candidates' } });
    for (const r of all("SELECT * FROM data_requests WHERE status='Waiting'")) att.push({ kind: 'Data request', text: `${r.person_id} asked to ${r.kind === 'delete' ? 'delete their data' : r.kind}`, open: { type: 'page', id: 'settings' } });
  }
  const live = jobs.filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status));
  const hiredOf = new Map(); for (const a of apps) if (a.result === 'Hired' && !a.left_date) hiredOf.set(a.job_id, (hiredOf.get(a.job_id) || 0) + 1);
  const out = {
    counts: {
      open_jobs: live.length,
      // Clients with an enquiry in hand: a job opening being written (Draft) or being worked on.
      active_clients: new Set(jobs.filter((j) => j.client_id && (j.status === 'Draft' || live.includes(j))).map((j) => j.client_id)).size,
      seats_open: live.reduce((t, j) => t + Math.max(0, (j.openings || 1) - (hiredOf.get(j.id) || 0)), 0),
      feedback_due: ivs.filter((i) => i.view_status === 'Result pending').length,
      active_apps: apps.filter((a) => a.result === 'open').length,
      interviews_7: ivs.filter((i) => ['Scheduled', 'Rescheduled'].includes(i.status) && i.at >= now() && i.at <= in7).length,
      offers_waiting: apps.filter((a) => a.result === 'open' && a.step === 'Offer made').length,
      joined_30: apps.filter((a) => a.result === 'Hired' && a.joined_at && L.daysBetween(a.joined_at) <= 30).length,
      new_leads: leadsNew,
    },
    attention: att, by_status: byStatus, agency: ag,
  };
  if (isSuper(u)) out.agency_options = all('SELECT id, name FROM agencies ORDER BY name').map((x) => ({ id: x.id, name: x.name }));
  if (isSuper(u) && !ag) out.agencies = all('SELECT * FROM agencies ORDER BY id').map((ag) => ({ id: ag.id, name: ag.name, status: agencyStatus(ag), open_jobs: jobs.filter((j) => j.agency_id === ag.id && !['Closed', 'Filled'].includes(j.status)).length, active_apps: apps.filter((a) => a.result === 'open' && (jobs.find((j) => j.id === a.job_id) || {}).agency_id === ag.id).length }));
  if (u.level === 'sub') out.mine = perfOf(u.id, new Date(Date.now() - 30 * 86400000).toISOString());
  return out;
});

// ---------- Business health (super admin: every agency; admin: their agency) ----------
// Clients with open requirements, openings and seats, applications by stage, and the money: the fee we can earn
// on every open seat (from the salary offered), what the closed positions earned, what came in and what is pending.
// Clients are High or Low ticket by the fee they bring (open opportunity plus earned), from Settings › ticket.
const OPEN_JOB = ['Open', 'Sourcing', 'Interviewing', 'Offer stage'];
const ctcMid = (j) => { const lo = j.sal_from || j.sal_to; const hi = j.sal_to || j.sal_from; return lo ? (lo + hi) / 2 : 0; };
route('GET', '/api/health', T, (ctx) => {
  const u = ctx.user; if (u.level === 'sub') throw httpError(403, 'This view is for admins.');
  const ag = isSuper(u) ? String(ctx.query.agency || '') : '';
  const inAg = (id) => !ag || (ag === 'none' ? !id : id === ag);
  const highFrom = Number((D.settings().ticket || {}).high_from) || 100000;
  const jobs = visibleJobs(u).filter((j) => inAg(j.agency_id));
  const jobIds = new Set(jobs.map((j) => j.id));
  const apps = visibleApps(u).filter((a) => jobIds.has(a.job_id));
  const bills = all('SELECT * FROM bills').filter((b) => seeBill(u, b) && inAg(b.agency_id) && !['Draft', 'Cancelled'].includes(b.status)).map(L.billView);
  const billedApps = new Set(bills.map((b) => b.app_id).filter(Boolean));
  // Period (closed positions and their money only; open work is always as of now): All time, 30 or 90 days, this financial year.
  const period = ['30', '90', 'fy'].includes(ctx.query.period) ? ctx.query.period : '';
  const since = period === 'fy' ? (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return new Date(Date.UTC(y, 3, 1)).toISOString(); })() : period ? new Date(Date.now() - Number(period) * 86400000).toISOString() : '';
  const inPeriod = (d) => !since || (!!d && String(d) >= since.slice(0, String(d).length > 10 ? 24 : 10));
  const clientOf = new Map(); const cl = (id) => { if (!clientOf.has(id)) clientOf.set(id, get('SELECT * FROM clients WHERE id=?', id) || null); return clientOf.get(id); };
  const agName = new Map(all('SELECT id, name FROM agencies').map((x) => [x.id, x.name]));
  const zero = () => Object.fromEntries(L.STAGES.map((s) => [s, 0]));
  const byJob = new Map(); for (const a of apps) { const l = byJob.get(a.job_id) || []; l.push(a); byJob.set(a.job_id, l); }
  const rows = new Map();
  const rowOf = (cid) => { if (!rows.has(cid)) { const c = cl(cid) || {}; rows.set(cid, { id: cid, company: c.company || cid, agency_id: c.agency_id || null, agency: agName.get(c.agency_id) || 'BrillBrains (own)', open_jobs: 0, draft_jobs: 0, seats: 0, apps: 0, stages: zero(), projected: 0, closed: 0, earned: 0, received: 0, pending: 0, jobs: [] }); } return rows.get(cid); };
  for (const j of jobs) {
    const c = cl(j.client_id); if (!c || c.placeholder || c.internal) continue;
    const list = byJob.get(j.id) || []; const hired = list.filter((a) => a.result === 'Hired' && !a.left_date).length;
    const open = OPEN_JOB.includes(j.status); const r = rowOf(j.client_id);
    const seats = open ? Math.max(0, (j.openings || 1) - hired) : 0;
    const mid = ctcMid(j); const fee = mid ? L.feeFor(c, j.agency_id, mid).fee : 0;
    const st = zero(); let active = 0; for (const a of list) if (a.result === 'open') { const s = L.stageOfApp(a); if (st[s] !== undefined) { st[s]++; active++; } }
    if (open) { r.open_jobs++; r.seats += seats; r.projected += fee * seats; }
    if (j.status === 'Draft') r.draft_jobs++;
    r.apps += active; for (const s of L.STAGES) r.stages[s] += st[s];
    if (open || j.status === 'Draft' || active) r.jobs.push({ id: j.id, title: j.title, city: j.city, status: j.status, sal_from: j.sal_from, sal_to: j.sal_to, no_salary: !j.sal_from && !j.sal_to, openings: j.openings || 1, hired, seats, fee_each: fee, projected: open ? fee * seats : 0, apps: active, stages: st });
  }
  // Closed positions: joined candidates; earned is the bill fee, or the fee to bill on the offered CTC.
  for (const a of apps.filter((x) => x.result === 'Hired' && inPeriod(x.joined_at || x.joining_date))) {
    const j = jobs.find((x) => x.id === a.job_id); const c = j && cl(j.client_id); if (!c || c.placeholder || c.internal) continue;
    const r = rowOf(j.client_id); r.closed++;
    if (!billedApps.has(a.id)) { const fee = L.feeFor(c, j.agency_id, a.offer_ctc || ctcMid(j)).fee; r.earned += fee; r.pending += fee; }
  }
  for (const b of bills.filter((x) => inPeriod(x.date || x.issued_at || x.created_at))) {
    if (!rows.has(b.client_id) && !cl(b.client_id)) continue;
    const r = rowOf(b.client_id); const fee = Number(b.fee) || 0; const settled = (b.paid || 0) + (b.tds || 0) + (b.credit || 0);
    const got = b.total > 0 ? Math.min(fee, Math.round((fee * settled) / b.total)) : fee;
    r.earned += fee; r.received += got; r.pending += fee - got;
  }
  // How fast each client responds, from the last 180 days: CV sent → the client's next move (interview fixed, moved on or
  // rejected), and client interview → feedback recorded. Plus what is waiting on the client right now.
  const DAY = 86400000; const since180 = new Date(Date.now() - 180 * DAY).toISOString();
  const appClient = new Map(); for (const a of apps) { const j = jobs.find((x) => x.id === a.job_id); if (j) appClient.set(a.id, j.client_id); }
  const gaps = new Map(); const addGap = (cid, d) => { if (cid && d >= 0) { const l = gaps.get(cid) || []; l.push(d); gaps.set(cid, l); } };
  const hist = all("SELECT app_id, at, step, kind FROM app_history WHERE kind IN ('step','close','interview') AND at >= ? ORDER BY app_id, at", since180).filter((x) => appClient.has(x.app_id));
  for (let i = 0; i < hist.length; i++) {
    const x = hist[i]; if (x.kind !== 'step' || x.step !== 'Sent to client') continue;
    let nx = null; for (let k = i + 1; k < hist.length && hist[k].app_id === x.app_id; k++) if (!(hist[k].kind === 'step' && hist[k].step === 'Sent to client')) { nx = hist[k]; break; }
    if (nx) addGap(appClient.get(x.app_id), (Date.parse(nx.at) - Date.parse(x.at)) / DAY);
  }
  const civs = all("SELECT app_id, at, completed_at, status FROM interviews WHERE round='client' AND at >= ?", since180).filter((x) => appClient.has(x.app_id));
  for (const iv of civs) if (iv.completed_at && iv.at && iv.completed_at > iv.at) addGap(appClient.get(iv.app_id), (Date.parse(iv.completed_at) - Date.parse(iv.at)) / DAY);
  const waits = new Map(); const addWait = (cid, d) => { if (!cid) return; const w = waits.get(cid) || { n: 0, oldest: 0 }; w.n++; w.oldest = Math.max(w.oldest, Math.floor(d)); waits.set(cid, w); };
  for (const a of apps.filter((x) => x.result === 'open' && !x.on_hold && x.step === 'Sent to client')) addWait(appClient.get(a.id), (Date.now() - Date.parse(a.step_since || a.created_at)) / DAY);
  const nowIso = new Date().toISOString();
  for (const iv of all("SELECT app_id, at FROM interviews WHERE round='client' AND status IN ('Scheduled','Rescheduled') AND at < ?", nowIso).filter((x) => appClient.has(x.app_id))) { const a = apps.find((y) => y.id === iv.app_id); if (a && a.result === 'open') addWait(appClient.get(iv.app_id), (Date.now() - Date.parse(iv.at)) / DAY); }
  const median = (l) => { const s = [...l].sort((p, q) => p - q); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  for (const r of rows.values()) {
    const l = gaps.get(r.id) || []; const w = waits.get(r.id) || { n: 0, oldest: 0 };
    r.resp_days = l.length ? Math.round(median(l) * 10) / 10 : null; r.resp_n = l.length;
    r.response = r.resp_days === null ? (w.n ? (w.oldest > 5 ? 'Slow' : 'Waiting') : '') : r.resp_days <= 2 ? 'Fast' : r.resp_days <= 5 ? 'Average' : 'Slow';
    r.waiting = w.n; r.wait_oldest = w.oldest; r.stuck = w.n > 0 && w.oldest > 5;
  }
  let list = [...rows.values()].filter((r) => r.open_jobs || r.draft_jobs || r.apps || r.earned);
  for (const r of list) { r.ticket = r.projected + r.earned >= highFrom ? 'High' : 'Low'; r.jobs.sort((x, y) => y.projected - x.projected); }
  const ticket = ['High', 'Low'].includes(ctx.query.ticket) ? ctx.query.ticket : '';
  const split = { High: 0, Low: 0 }; for (const r of list) split[r.ticket] += r.projected;
  const counts = { High: list.filter((r) => r.ticket === 'High').length, Low: list.filter((r) => r.ticket === 'Low').length };
  if (ticket) list = list.filter((r) => r.ticket === ticket);
  list.sort((x, y) => y.projected + y.earned - (x.projected + x.earned));
  const sum = (k) => list.reduce((t, r) => t + r[k], 0);
  const stages = zero(); for (const r of list) for (const s of L.STAGES) stages[s] += r.stages[s];
  const totals = { clients_open: list.filter((r) => r.open_jobs).length, open_jobs: sum('open_jobs'), draft_jobs: sum('draft_jobs'), seats: sum('seats'), apps: sum('apps'), stages, projected: sum('projected'), closed: sum('closed'), earned: sum('earned'), received: sum('received'), pending: sum('pending'), split, ticket_counts: counts };
  const no_salary = list.flatMap((r) => r.jobs.filter((j) => j.no_salary && j.status !== 'Draft').map((j) => ({ id: j.id, title: j.title, client: r.company })));
  const out = { totals, clients: list, stages: L.STAGES, high_from: highFrom, ticket, agency: ag, period, no_salary };
  if (isSuper(u)) {
    out.agency_options = all('SELECT id, name FROM agencies ORDER BY name');
    if (!ag) { const by = new Map(); for (const r of list) { const k = r.agency_id || 'none'; const x = by.get(k) || { id: k, name: r.agency, clients: 0, open_jobs: 0, seats: 0, apps: 0, closed: 0, projected: 0, earned: 0, received: 0, pending: 0 }; x.clients++; for (const f of ['open_jobs', 'seats', 'apps', 'closed', 'projected', 'earned', 'received', 'pending']) x[f] += r[f]; by.set(k, x); } out.agencies = [...by.values()].sort((x, y) => y.projected - x.projected); }
  }
  return out;
});

// ---------- My work (admin and sub admin dashboards): client work and candidate work, by what each person does ----------
const FOCUS = ['auto', 'clients', 'candidates', 'both'];
route('POST', '/api/me/focus', T, (ctx) => { const f = String(ctx.body.focus || 'auto'); if (!FOCUS.includes(f)) throw httpError(400, 'Pick what to show'); update('users', ctx.user.id, { work_focus: f === 'auto' ? null : f }); return { ok: true }; });
route('GET', '/api/my-work', T, (ctx) => {
  const u = ctx.user; const today = L.istDay(); const om = L.ownerMap(); const since30 = new Date(Date.now() - 30 * 86400000).toISOString(); const month = `${today.slice(0, 7)}-01`;
  const owns = (row, main) => row[main] === u.id || (Array.isArray(row.owners) && row.owners.includes(u.id));
  let clients = all('SELECT * FROM clients WHERE removed=0 AND archived=0 AND merged_into IS NULL').filter((c) => !c.placeholder && !c.internal && owns(c, 'owner_id'));
  let myJobs = all('SELECT * FROM jobs WHERE archived=0').filter((j) => (om.get(j.id) || []).includes(u.id)).map((j) => V.jobView(j));
  let apps = all("SELECT * FROM applications WHERE result='open'").filter((a) => L.ownsApp(u.id, a, om));
  const tasks = all("SELECT * FROM tasks WHERE removed=0 AND status!='Done'").filter((t) => taskOwnerIds(t).includes(u.id));
  // Nothing allocated to this person yet: they see all the team's work (their agency), so nothing waits unseen.
  const everyone = !clients.length && !myJobs.length && !apps.length && !tasks.length;
  if (everyone) {
    clients = all('SELECT * FROM clients WHERE removed=0 AND archived=0 AND merged_into IS NULL').filter((c) => !c.placeholder && !c.internal && seeClient(u, c));
    myJobs = visibleJobs(u).map((j) => V.jobView(j)); apps = visibleApps(u).filter((a) => a.result === 'open');
  }
  const areaClient = tasks.filter((t) => /client|lead|onboard|agreement|proposal|jd|requirement|kyc/i.test(`${t.area} ${t.title}`)).length;
  const areaCand = tasks.filter((t) => /candidate|screen|interview|sourc|call|resume|cv|offer|joining/i.test(`${t.area} ${t.title}`)).length;
  const clientScore = clients.length * 3 + areaClient * 2; const candScore = apps.length + myJobs.length + areaCand * 2;
  const pick = u.work_focus || 'auto'; if (everyone && pick === 'auto') u.work_focus = 'both';
  const show = pick === 'clients' ? { clients: true, candidates: false } : pick === 'candidates' ? { clients: false, candidates: true } : pick === 'both' || everyone ? { clients: true, candidates: true }
    : { clients: clientScore > 0 || u.level === 'admin', candidates: candScore > 0 || u.level === 'sub' };
  const lead = show.clients && show.candidates ? (clientScore >= candScore ? 'clients' : 'candidates') : show.clients ? 'clients' : 'candidates';
  const it = (text, open, when) => ({ text, open, when: when || null }); const co = (c) => ({ type: 'client', id: c.id });
  // Client work: what to do next on each client, by stage and journey step
  const facts = new Map(clients.map((c) => [c.id, L.clientFacts(c)]));
  const fu = all("SELECT * FROM followups WHERE done=0 AND for_user=? AND at<=?", u.id, new Date(`${today}T23:59:59+05:30`).toISOString()).filter((f) => clients.some((c) => c.id === f.record_id));
  const clientActions = [
    { key: 'new', title: 'New clients to call', link: 'clients?stage=Call initiated', items: clients.filter((c) => c.stage === 'Call initiated').map((c) => it(c.company, co(c))) },
    { key: 'proposal', title: 'Proposal to send', items: clients.filter((c) => ['Requirement understanding', 'Requirement received'].includes(c.stage)).map((c) => it(`${c.company} · ${c.stage}`, co(c))) },
    { key: 'agreement', title: 'Agreement to chase', link: 'clients?stage=Agreement follow-up', items: clients.filter((c) => ['Agreement shared', 'Agreement follow-up'].includes(c.stage)).map((c) => it(`${c.company} · ${c.stage}`, co(c))) },
    { key: 'jd', title: 'Job descriptions to write or get approved', items: myJobs.filter((j) => !j.jd_approved && j.jd_status !== 'Approved' && j.status !== 'Closed').map((j) => it(`${j.title} · ${j.client_name || ''}`, { type: 'job', id: j.id })) },
    { key: 'onboard', title: 'Onboarding steps to finish', items: clients.filter((c) => c.activated_at && !facts.get(c.id).onboarded).map((c) => it(`${c.company} · ${L.ONBOARD_STEPS.filter((k) => !L.onboardDone(c, k)).length} steps left`, co(c))) },
    { key: 'followups', title: 'Requirement follow-ups due', items: fu.map((f) => it(f.note || 'Follow up', { type: 'client', id: f.record_id }, f.at)) },
    { key: 'noopen', title: 'No current opening: ask for new requirements', link: 'clients?stage=No current opening', items: clients.filter((c) => c.stage === 'No current opening').map((c) => it(c.company, co(c))) },
  ].map((s) => ({ ...s, count: s.items.length, items: s.items.slice(0, 5) })).filter((s) => s.count);
  const stages = D.settings().client_stages.map((s) => ({ stage: s, n: clients.filter((c) => c.stage === s).length, side: L.CLIENT_SIDE.includes(s) }));
  const clientSnap = { owned: clients.length, active: clients.filter((c) => c.activated_at).length, activated_month: clients.filter((c) => c.activated_at && c.activated_at >= month).length,
    onboarded: clients.filter((c) => facts.get(c.id).onboarded).length, openings: myJobs.filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status)).length, openings_month: myJobs.filter((j) => j.created_at >= month).length };
  // Candidate work: my job openings with each stage, and my numbers
  const stageCounts = (list) => { const o = Object.fromEntries(L.STAGES.map((s) => [s, 0])); for (const a of list) { const s = L.stageOfApp(a); if (o[s] !== undefined) o[s]++; } return o; };
  const jobsOut = myJobs.filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status)).map((j) => { const ja = apps.filter((a) => a.job_id === j.id); return { id: j.id, title: j.title, client: j.client_name, city: j.city, seats: Math.max(0, (j.openings || 1) - (j.filled || 0)), counts: stageCounts(ja), total: ja.length }; }).sort((a, b) => b.total - a.total);
  const perf = perfOf(u.id, since30);
  const candSnap = { open_apps: apps.length, by_stage: stageCounts(apps), interviews_week: all("SELECT at, app_id FROM interviews WHERE status IN ('Scheduled','Rescheduled') AND at>=? AND at<=?", new Date().toISOString(), new Date(Date.now() + 7 * 86400000).toISOString()).filter((i) => apps.some((a) => a.id === i.app_id)).length,
    calls7: get('SELECT COUNT(*) n FROM calls WHERE user_id=? AND at>=?', u.id, new Date(Date.now() - 7 * 86400000).toISOString()).n };
  return { focus: pick, everyone, show, lead, stages: L.STAGES, client: { actions: clientActions, stages, snap: clientSnap }, candidate: { jobs: jobsOut.slice(0, 12), snap: candSnap, perf },
    tasks: { open: tasks.length, overdue: tasks.filter((t) => t.due_date && t.due_date < today).length } };
});

// ---------- Team at work (admin dashboard): each person's numbers, and where the clients stand ----------
route('GET', '/api/team-overview', T, (ctx) => {
  const u = ctx.user; if (u.level === 'sub') throw httpError(403, 'This view is for admins.');
  const ag = isSuper(u) ? String(ctx.query.agency || '') : u.agency_id;
  const people = all("SELECT id, name, level, agency_id FROM users WHERE status='On' AND level IN ('admin','sub') ORDER BY CASE level WHEN 'admin' THEN 0 ELSE 1 END, name").filter((p) => !ag || p.agency_id === ag);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString(); const since7 = new Date(Date.now() - 7 * 86400000).toISOString(); const today = L.istDay();
  const clients = all('SELECT * FROM clients WHERE removed=0 AND archived=0 AND merged_into IS NULL').filter((c) => seeClient(u, c) && !c.placeholder && !c.internal && (!ag || c.agency_id === ag));
  const jobs = all('SELECT * FROM jobs WHERE archived=0').filter((j) => (!ag || j.agency_id === ag)); const open = ['Open', 'Sourcing', 'Interviewing', 'Offer stage'];
  const apps = all("SELECT * FROM applications WHERE result='open'"); const tasks = all("SELECT * FROM tasks WHERE removed=0 AND status!='Done'");
  const owns = (row, main, uid) => row[main] === uid || (Array.isArray(row.owners) && row.owners.includes(uid));
  const rows = people.map((p) => {
    const perf = perfOf(p.id, since30); const mine = tasks.filter((t) => taskOwnerIds(t).includes(p.id));
    return { id: p.id, name: p.name, level: p.level, clients: clients.filter((c) => owns(c, 'owner_id', p.id)).length,
      jobs: jobs.filter((j) => open.includes(j.status) && owns(j, 'recruiter_id', p.id)).length,
      apps: apps.filter((a) => a.owner_id === p.id).length,
      calls7: get('SELECT COUNT(*) n FROM calls WHERE user_id=? AND at>=?', p.id, since7).n,
      screened: perf.screened, sent: perf.sent, interviews: perf.interviews, offers: perf.offers, joined: perf.joined, target: perf.target,
      tasks_open: mine.length, tasks_overdue: mine.filter((t) => t.due_date && t.due_date < today).length };
  });
  const stages = D.settings().client_stages.map((s) => ({ stage: s, n: clients.filter((c) => c.stage === s).length, side: L.CLIENT_SIDE.includes(s) }));
  const followups = all("SELECT f.*, c.company FROM followups f JOIN clients c ON c.id=f.record_id WHERE f.done=0 AND f.note LIKE 'Ask % for the requirement%' ORDER BY f.at").filter((f) => clients.some((c) => c.id === f.record_id)).slice(0, 8).map((f) => ({ id: f.id, client_id: f.record_id, company: f.company, at: f.at }));
  return { people: rows, stages, followups, total_clients: clients.length };
});

// ---------- My day (sub admin home) ----------
route('GET', '/api/people', T, (ctx) => taskOwners(ctx.user).map((x) => ({ id: x.id, name: x.name, level: x.level })));
const setOwners = (ctx, table, rec, mainCol) => {
  if (!['super', 'admin'].includes(ctx.user.level)) throw httpError(403, 'Admins set the owners');
  const team = taskOwners(ctx.user); const ids = [...new Set((Array.isArray(ctx.body.owners) ? ctx.body.owners : []).filter(Boolean))];
  const before = [rec[mainCol], ...(Array.isArray(rec.owners) ? rec.owners : [])].filter(Boolean);
  if (ids.some((id) => !team.some((x) => x.id === id) && !before.includes(id))) throw httpError(400, 'Pick people from your team', 'owners'); // owners it already has stay allowed
  update(table, rec.id, { owners: ids, [mainCol]: ids[0] || null });
  const name = table === 'clients' ? rec.company : `${rec.title} (${rec.id})`;
  for (const id of ids) if (!before.includes(id) && id !== ctx.user.id) L.alertUser(id, `You now own ${table === 'clients' ? 'the client' : 'the job'} ${name}${table === 'clients' ? ' and its job openings' : ''}`, rec.id, true);
  D.history(ctx.actor.label, 'owners', rec.id, 'owners', before.join(','), ids.join(','));
  return { ok: true, owners: ids };
};
route('POST', '/api/clients/:id/owners', T, (ctx) => { const c = get('SELECT * FROM clients WHERE id=?', ctx.params.id); mustSee(c && seeClient(ctx.user, c), 'client'); return setOwners(ctx, 'clients', c, 'owner_id'); });
route('POST', '/api/jobs/:id/owners', T, (ctx) => { const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening'); return setOwners(ctx, 'jobs', j, 'recruiter_id'); });
// Today: what each person should do now, from everything they own, most urgent first. Each line opens the record
// or the list it belongs to.
route('GET', '/api/today', T, (ctx) => {
  const u = ctx.user; const today = L.istDay(); const om = L.ownerMap();
  const mine = visibleApps(u).filter((a) => a.result === 'open' && L.ownsApp(u.id, a, om)); const ids = new Set(mine.map((a) => a.id));
  const view = new Map(mine.map((a) => [a.id, V.appView(a)])); const who = (a) => `${view.get(a.id).candidate_name} · ${view.get(a.id).job_title}`;
  const stage = new Map(mine.map((a) => [a.id, L.stageOfApp(a)]));
  const ivs = all("SELECT * FROM interviews WHERE status IN ('Scheduled','Rescheduled') ORDER BY at").filter((i) => ids.has(i.app_id)).map(L.interviewView);
  const end = new Date(`${today}T23:59:59+05:30`).toISOString();
  const calls = all('SELECT * FROM followups WHERE done=0 AND at<=? ORDER BY at', end).filter((f) => f.for_user === u.id || ids.has(f.record_id));
  const it = (text, open, when) => ({ text, open, when: when || null });
  const appOpen = (a) => ({ type: 'application', id: a.id });
  const at = (s) => mine.filter((a) => stage.get(a.id) === s);
  const vids = at('Virtual'); const virtualToBook = vids.filter((a) => !ivs.some((i) => i.app_id === a.id && i.mode === 'video'));
  const clientApps = at('Client'); const clientToFix = clientApps.filter((a) => !ivs.some((i) => i.app_id === a.id && i.round === 'client'));
  const offers = at('Offer'); const joining = offers.filter((a) => a.step === 'Offer accepted' && a.joining_date && a.joining_date <= L.istDay(new Date(Date.now() + 7 * 86400000)));
  const myJobs = all('SELECT * FROM jobs WHERE archived=0').filter((j) => (om.get(j.id) || []).includes(u.id)).map((j) => V.jobView(j)).filter((j) => j.status === 'Draft');
  const tasks = all("SELECT * FROM tasks WHERE removed=0 AND status!='Done' ORDER BY COALESCE(due_date,'9999')").filter((t) => taskOwnerIds(t).includes(u.id) && (!t.due_date || t.due_date <= today));
  const sections = [
    { key: 'calls', title: 'Calls and follow-ups due', items: calls.map((f) => it(f.note, f.record_id && ids.has(f.record_id) ? { type: 'application', id: f.record_id } : null, f.at)) },
    { key: 'interviews', title: 'Interviews today', items: ivs.filter((i) => L.istDay(i.at) === today && i.view_status !== 'Result pending').map((i) => it(`${i.name}: ${who({ id: i.app_id })}`, { type: 'application', id: i.app_id }, i.at)) },
    { key: 'feedback', title: 'Feedback to record', items: ivs.filter((i) => i.view_status === 'Result pending').map((i) => it(`${i.name}: ${who({ id: i.app_id })}`, { type: 'application', id: i.app_id }, i.at)) },
    { key: 'screening', title: 'To screen', link: 'applications?mine=1&stage=Screening', items: at('Screening').map((a) => it(who(a), appOpen(a))) },
    { key: 'telephonic', title: 'Telephonic round to do', link: 'applications?mine=1&stage=Telephonic', items: at('Telephonic').filter((a) => !ivs.some((i) => i.app_id === a.id && i.mode === 'phone')).map((a) => it(who(a), appOpen(a))) },
    { key: 'virtual', title: 'Virtual round to book', link: 'applications?mine=1&stage=Virtual', items: virtualToBook.map((a) => { const c = get('SELECT pref_time, pref_days FROM candidates WHERE id=?', a.candidate_id) || {}; return it(`${who(a)}${c.pref_time || c.pref_days ? ' · gave a time' : ' · waiting for their time'}`, appOpen(a)); }) },
    { key: 'client', title: 'Client round to fix', link: 'applications?mine=1&stage=Client', items: clientToFix.map((a) => it(who(a), appOpen(a))) },
    { key: 'offers', title: 'Offers waiting for an answer', link: 'applications?mine=1&stage=Offer', items: offers.filter((a) => a.step === 'Offer made').map((a) => it(who(a), appOpen(a))) },
    { key: 'joining', title: 'Joining in the next 7 days', items: joining.map((a) => it(`${who(a)} · joins ${a.joining_date}`, appOpen(a))) },
    { key: 'tasks', title: 'Tasks due', link: 'tasks', items: tasks.map((t) => it(t.title, { type: 'task', id: t.id }, t.due_date)) },
    { key: 'jds', title: 'Job descriptions to finish', items: myJobs.map((j) => it(`${j.title} · ${j.client_name || ''}`, { type: 'job', id: j.id })) },
  ].map((s) => ({ ...s, count: s.items.length, items: s.items.slice(0, 6) }));
  return { sections, owned: { clients: all('SELECT id, owner_id, owners FROM clients').filter((c) => c.owner_id === u.id || (Array.isArray(c.owners) && c.owners.includes(u.id))).length, jobs: [...om.values()].filter((x) => x.includes(u.id)).length, applications: mine.length } };
});
route('GET', '/api/myday', T, (ctx) => {
  const u = ctx.user; const today = L.istDay();
  const apps = visibleApps(u); const ids = new Set(apps.map((a) => a.id));
  const ivs = all('SELECT * FROM interviews ORDER BY at').filter((i) => ids.has(i.app_id)).map(L.interviewView);
  return {
    interviews: ivs.filter((i) => L.istDay(i.at) === today && i.status !== 'Cancelled').map((i) => ({ ...i, app: V.appView(apps.find((a) => a.id === i.app_id)) })),
    pending: ivs.filter((i) => i.view_status === 'Result pending').map((i) => ({ ...i, app: V.appView(apps.find((a) => a.id === i.app_id)) })),
    followups: all('SELECT * FROM followups WHERE for_user=? AND done=0 ORDER BY at', u.id),
    stuck: apps.filter((a) => a.result === 'open' && !a.on_hold && L.daysBetween(a.step_since || a.created_at) >= 7).map(V.appView),
    tasks: L.openTasksOf(u.id),
  };
});

// ---------- leads (11.3) ----------
// Candidate filters shared by the Candidates page and Candidate leads (same names in the address, so a download
// always matches the screen): designation (job), department, city (or a city they would work in), state,
// application date (from / to, India time), years in the jewellery industry (none, under 1, 1–3, 3–5, 5–10, 10+), experience in years (min / max) and expected salary a month (min / max).
// A salary filter leaves out people who have not given an expected salary.
const JEW_RANGE = { lt1: [0, 1], '1-3': [1, 3], '3-5': [3, 5], '5-10': [5, 10], '10+': [10, Infinity] };
const many = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
function candMatch(q) {
  const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const eMin = num(q.exp_min); const eMax = num(q.exp_max); const sMin = num(q.sal_min); const sMax = num(q.sal_max);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : null; const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : null;
  return (c) => {
    // Each of these takes one value or several ("a,b"): a candidate matching any of them stays.
    const list = (k) => many(q[k]);
    const also = Array.isArray(c.also_roles) ? c.also_roles : [];
    if (q.dept && !list('dept').includes(c.department) && !also.some((x) => list('dept').includes(L.deptOf(x)))) return false;
    if (q.job && c.job_wanted !== q.job && !list('job').includes(c.job_wanted) && !also.some((x) => x === q.job || list('job').includes(x))) return false; // a typed role may hold a comma
    if (q.source && !list('source').includes(c.source)) return false;
    if (q.company) { const co = String(c.current_company || '').replace(/\s+/g, ' ').trim().toLowerCase(); if (!list('company').some((x) => x.toLowerCase() === co)) return false; }
    if (q.domain && !list('domain').includes(c.domain || 'Not read yet')) return false;
    if (q.biz && !(c.exp_business || []).some((x) => (q.biz === 'B2C' ? x === 'Retailer' : x !== 'Retailer'))) return false;
    if (q.city && !list('city').some((x) => c.city === x || (c.work_cities || []).includes(x))) return false;
    if (q.state && !list('state').includes(c.state || L.stateOf(c.city))) return false;
    if (q.skillgroup) { const SK = require('./skills'); const gs = SK.groups(D.settings()); if (!(c.skills || []).some((s) => many(q.skillgroup).includes(SK.groupOf(s, gs)))) return false; }
    if (q.skills) { const has = (c.skills || []).map((x) => String(x).toLowerCase()); if (!list('skills').some((x) => has.includes(x.toLowerCase()))) return false; }
    if (q.ad && ![c.ad_campaign, c.ad_set, c.ad_name].includes(q.ad)) return false;
    if (from || to) { const day = L.istDay(c.created_at); if ((from && day < from) || (to && day > to)) return false; }
    if (q.jewellery === '0' && c.exp_jewellery !== 0) return false;
    if (JEW_RANGE[q.jewellery]) { const y = c.exp_jewellery; const [lo, hi] = JEW_RANGE[q.jewellery]; if (!(y > 0 && y >= lo && y < hi)) return false; }
    if (eMin !== null && !((c.exp_total ?? -1) >= eMin)) return false;
    if (eMax !== null && !((c.exp_total ?? Infinity) <= eMax)) return false;
    if (sMin !== null || sMax !== null) {
      if (!c.exp_salary) return false; const m = c.exp_salary / 12;
      if (sMin !== null && m < sMin) return false;
      if (sMax !== null && m > sMax) return false;
    }
    return true;
  };
}
// Campaigns, ad sets and ad names seen so far, for the "Any ad" filter.
const adOptions = (table) => [...new Set(all(`SELECT ad_campaign, ad_set, ad_name FROM ${table} WHERE ad_campaign IS NOT NULL OR ad_set IS NOT NULL OR ad_name IS NOT NULL`).flatMap((r) => [r.ad_campaign, r.ad_set, r.ad_name]).filter(Boolean))].sort();
const CAND_EXPORT = ['id', 'name', 'whatsapp', 'email', [(r) => (r.cv_file ? L.link('team/candidates', `?cv=${r.id}`) : r.cv_link || ''), 'resume_link'], 'domain', [(r) => (r.skills || []).join(', '), 'skills'], 'job_wanted', 'department', 'city', 'state', 'exp_total', 'exp_jewellery', [(r) => (r.exp_business || []).join(', '), 'worked_in'], [(r) => (r.cur_salary ? Math.round(r.cur_salary / 12) : ''), 'current_per_month'], [(r) => (r.exp_salary ? Math.round(r.exp_salary / 12) : ''), 'expected_per_month'], 'notice_days', 'current_company', 'looking', 'source', 'source_code', [(r) => L.istDay(r.created_at), 'applied_on']];
// Client leads for everyone who can see them; candidates, hires and downloads stay with the super admin.
route('GET', '/api/leads', T, (ctx) => {
  const u = ctx.user; const sup = isSuper(u);
  if (ctx.query.format && !sup) throw httpError(403, 'Only the super admin downloads leads.');
  const q = ctx.query; const days = Number(q.days) || 30; const since = new Date(Date.now() - days * 86400000).toISOString();
  const autoSince = new Date(Date.now() - 7 * 86400000).toISOString(); // auto-assigned leads stay in view for a week
  const filt = (r) => (!q.source || many(q.source).includes(r.source)) && (!q.agency || (q.agency === 'none' ? !r.agency_id : r.agency_id === q.agency)) && (!q.new || r.is_new) && (!q.from || L.istDay(r.created_at) >= q.from) && (!q.to || L.istDay(r.created_at) <= q.to);
  const clients = all('SELECT * FROM clients WHERE junk=0 AND old_client=0 AND merged_into IS NULL AND removed=0 ORDER BY created_at DESC').filter((c) => seeClient(u, c) && (!c.agency_id || q.all || ((c.extra || {}).auto_assigned && (c.extra.auto_assigned.at || '') >= autoSince)) && filt(c)).map(V.clientView);
  const match = candMatch(q);
  const cands = !sup ? [] : all('SELECT * FROM candidates WHERE junk=0 AND merged_into IS NULL AND removed=0 ORDER BY created_at DESC').filter((c) => ((!c.agency_id && c.is_new) || q.all) && filt(c) && match(c));
  const check = [ // the candidate rows show on the Candidates page (Needs checking tab)
    ...all("SELECT id, name AS label, whatsapp, email, source, needs_check, possible_repeat_of, created_at, 'candidate' AS type FROM candidates WHERE (needs_check IS NOT NULL OR possible_repeat_of IS NOT NULL) AND merged_into IS NULL AND junk=0"),
    ...all("SELECT id, company AS label, whatsapp, email, source, needs_check, possible_repeat_of, created_at, 'client' AS type FROM clients WHERE (needs_check IS NOT NULL OR possible_repeat_of IS NOT NULL) AND merged_into IS NULL AND junk=0"),
  ].filter((r) => sup || (r.type === 'client' && seeClient(u, get('SELECT * FROM clients WHERE id=?', r.id))));
  const srcCount = {};
  for (const r of sup ? [...all('SELECT source, created_at FROM clients'), ...all('SELECT source, created_at FROM candidates')] : all('SELECT * FROM clients').filter((c) => seeClient(u, c))) if (r.created_at >= since) srcCount[r.source || 'Other'] = (srcCount[r.source || 'Other'] || 0) + 1;
  const hires = {};
  if (sup) for (const a of all("SELECT a.source, a.joined_at FROM applications a WHERE a.result='Hired'")) if (a.joined_at >= since) hires[a.source || 'Other'] = (hires[a.source || 'Other'] || 0) + 1;
  if (q.format) {
    const only = q.ids ? new Set(String(q.ids).split(',')) : null; const pick = (rows) => (only ? rows.filter((r) => only.has(r.id)) : rows);
    if (q.tab === 'candidate') return page(ctx, pick(cands), 'candidate-leads', [...CAND_EXPORT, 'agency_id']);
    if (q.tab === 'check') return page(ctx, check, 'leads-to-check', ['id', 'type', 'label', 'whatsapp', 'email', 'source', 'needs_check', 'possible_repeat_of']);
    return page(ctx, pick(clients), 'client-leads', ['id', 'company', 'contact', 'whatsapp', 'email', 'city', 'state', 'business_type', 'need', 'roles', 'stage', 'source', 'created_at', 'agency_name']);
  }
  return { clients, candidates: cands, check, sources: srcCount, hires, stages: D.settings().client_stages, agencies: all("SELECT id, name FROM agencies WHERE status='Active'"), can_allocate: R.canAllocate(u), can_download: sup, shared: R.sharedWith(u), auto: sup ? { on: L.autoAssignOn(), weights: L.AUTO_WEIGHTS } : null };
});
// How each agency scores right now for a new lead (the super admin sees this beside the auto-assignment switch).
route('GET', '/api/leads/auto-scores', T, (ctx) => {
  if (!isSuper(ctx.user)) throw httpError(403, 'Only the super admin sees this.');
  return { on: L.autoAssignOn(), weights: L.AUTO_WEIGHTS, agencies: L.agencyScores({ city: ctx.query.city || '' }) };
});
route('POST', '/api/leads/assign', T, (ctx) => {
  const { type, ids, agency_id } = ctx.body; const u = ctx.user;
  if (!R.canAllocate(u)) throw httpError(403, 'Clients are allocated once a second agency is active.');
  if (!isSuper(u)) {
    if (type !== 'client') throw httpError(403, 'Only the super admin assigns candidates.');
    if (!get("SELECT 1 FROM agencies WHERE id=? AND status='Active'", agency_id)) throw httpError(400, 'Pick an active agency', 'agency_id');
    for (const id of ids || [ctx.body.id]) { const c = get('SELECT * FROM clients WHERE id=?', id); if (c && c.agency_id) throw httpError(400, `${id} is already allocated`); }
  }
  const out = (ids || [ctx.body.id]).map((id) => L.assignLead(type, id, agency_id, ctx.actor));
  return { ok: true, count: out.length };
});
// Bulk actions on ticked leads (Leads page, super admin): mark seen, junk, send the account link on WhatsApp,
// move clients to a stage, add candidates to a job opening. Each record is done on its own; failures are listed.
// Requirement later: a follow-up on the date they gave, for the client's owner (it shows in their day and the bell).
function setRequirementLater(c, at, note, ctx) {
  const who = c.owner_id || ctx.user.id; const text = `Ask ${c.company} for the requirement${note ? `: ${String(note).trim()}` : ''}`;
  insert('followups', { record_id: c.id, at: at.toISOString(), note: text, for_user: who, done: 0, created_by: ctx.user.id });
  insert('notes', { record_id: c.id, text: `Requirement later — follow up on ${L.istFmt(at.toISOString(), false)}${note ? `: ${String(note).trim()}` : ''}`, author: ctx.actor.label, at: now() });
}
route('POST', '/api/leads/bulk', T, (ctx) => {
  if (!isSuper(ctx.user) && ctx.body.type !== 'client') throw httpError(403, 'Only the super admin acts on candidates here.');
  const { type, action, value } = ctx.body; const ids = (ctx.body.ids || []).map(String).slice(0, 500);
  const table = type === 'client' ? 'clients' : 'candidates'; const out = { done: 0, skipped: [] };
  if (!ids.length) throw httpError(400, 'Tick some leads first');
  if (action === 'stage' && !D.settings().client_stages.includes(value)) throw httpError(400, 'Pick a stage');
  if (action === 'add_to_job' && !get('SELECT 1 FROM jobs WHERE id=?', value)) throw httpError(400, 'Pick a job opening');
  for (const id of ids) {
    try {
      const r = get(`SELECT id FROM ${table} WHERE id=? AND merged_into IS NULL AND removed=0`, id); if (!r || (type === 'client' && !seeClient(ctx.user, get('SELECT * FROM clients WHERE id=?', id)))) { out.skipped.push(`${id}: not found`); continue; }
      if (action === 'seen') D.edit(table, id, { is_new: 0 }, ctx.actor.label, ctx.ip);
      else if (action === 'junk') D.edit(table, id, { junk: 1, is_new: 0 }, ctx.actor.label, ctx.ip);
      else if (action === 'stage' && type === 'client') {
        const c = get('SELECT * FROM clients WHERE id=?', id);
        if (value === 'Client activated' && !c.activated_at && !L.activationState(c).ready) { out.skipped.push(`${c.company}: no signed contract yet`); continue; }
        if (value === 'Requirement later') { const at = new Date(ctx.body.follow_up_at || ''); if (Number.isNaN(at.getTime())) throw httpError(400, 'Pick the date to follow up for the requirement', 'follow_up_at'); setRequirementLater(c, at, ctx.body.follow_up_note, ctx); }
        D.edit(table, id, { stage: value, is_new: 0 }, ctx.actor.label, ctx.ip);
      }
      else if (action === 'add_to_job' && type === 'candidate') L.createApplication(id, value, ctx.actor, null, 'Added from Leads');
      else if (action === 'welcome') {
        const s = L.sendWA({ ptype: type, pid: id, format: type === 'client' ? 'bbhs_client_welcome' : 'bbhs_candidate_welcome', vars: { client_id: id, candidate_id: id, link: L.link(type === 'client' ? 'my-account' : 'my-profile') }, by: ctx.actor, bulk: true, dedupe: `welcome-again:${id}:${L.istDay()}` });
        if (s && s.skipped) { out.skipped.push(`${id}: ${s.skipped}`); continue; }
      } else throw httpError(400, 'Unknown action');
      out.done++;
    } catch (e) { if (e.status === 400 && e.message === 'Unknown action') throw e; out.skipped.push(`${id}: ${e.message}`); }
  }
  D.history(ctx.actor.label, `bulk ${action}`, null, table, null, `${out.done} of ${ids.length}${value ? ` (${value})` : ''}`, ids.join(','), ctx.ip);
  return out;
});
// Screen protection (guard.js): blocked print / copy / screenshot attempts by admins and sub admins go to the
// history, at most once a minute per person and kind, so the super admin can see who tried what.
const lastEvent = new Map();
route('POST', '/api/security-event', { auth: 'team', channels: true, accounts: true, calling: true, rate: { key: 'secevent', max: 120, minutes: 60 } }, (ctx) => {
  const what = String(ctx.body.what || '').slice(0, 40).replace(/[^\w ]/g, '');
  const key = `${ctx.user.id}:${what}`; const t = Date.now();
  if (what && (lastEvent.get(key) || 0) < t - 60000) { lastEvent.set(key, t); D.history(ctx.actor.label, `blocked ${what}`, null, 'screen', null, null, null, ctx.ip); }
  return { ok: true };
});
route('POST', '/api/leads/junk', T, (ctx) => {
  const { type, id } = ctx.body; const table = type === 'client' ? 'clients' : 'candidates';
  if (type === 'client') mustSee(seeClient(ctx.user, get('SELECT * FROM clients WHERE id=?', id)), 'client');
  D.edit(table, id, { junk: 1, is_new: 0 }, ctx.actor.label, ctx.ip); return { ok: true };
});
route('POST', '/api/leads/quick', T, (ctx) => {
  const b = ctx.body; const by = { ...ctx.actor };
  if (b.type === 'client') { const r = L.quickClient(b, by); return { id: r.client.id, isNew: r.isNew }; }
  const r = L.intakeCandidate({ name: b.name, whatsapp: b.phone, city: b.city, job_wanted: b.job_wanted }, { source: b.source || 'Walk-in', by });
  if (b.note) insert('notes', { record_id: r.candidate.id, text: b.note, author: ctx.actor.label, at: now() });
  return { id: r.candidate.id, isNew: r.isNew };
});
route('POST', '/api/merge', T, (ctx) => {
  const { type, keep, drop, chosen } = ctx.body;
  if (type === 'client') { mustSee(seeClient(ctx.user, get('SELECT * FROM clients WHERE id=?', keep)) && seeClient(ctx.user, get('SELECT * FROM clients WHERE id=?', drop)), 'client'); }
  return L.mergeRecords(type, keep, drop, chosen, ctx.actor);
});
route('GET', '/api/merge/:type/:a/:b', T, (ctx) => {
  const table = ctx.params.type === 'client' ? 'clients' : 'candidates';
  const a = get(`SELECT * FROM ${table} WHERE id=?`, ctx.params.a); const b = get(`SELECT * FROM ${table} WHERE id=?`, ctx.params.b);
  if (ctx.params.type === 'candidate') return { a: candidateOut(ctx.user, a), b: candidateOut(ctx.user, b) };
  mustSee(seeClient(ctx.user, a) || isSuper(ctx.user), 'client'); return { a, b };
});

// ---------- clients ----------
// Filters the Clients list and its Reports share (each chart opens the list with its filter).
const clientFilt = (q) => (c) => (!q.stage || c.stage === q.stage) && (!q.lifecycle || (q.lifecycle === 'Active' ? !!c.activated_at : !c.activated_at))
  && (!q.city || (q.city === 'none' ? !c.city : String(c.city || '').toLowerCase() === String(q.city).toLowerCase())) && (!q.business_type || (q.business_type === 'none' ? !c.business_type : c.business_type === q.business_type))
  && (!q.source || c.source === q.source) && (!q.agency || (q.agency === 'none' ? !c.agency_id : c.agency_id === q.agency)) && (!q.need || (q.need === 'none' ? !c.need : c.need === q.need)) && (!q.new || c.is_new)
  && (!q.missing || (q.missing === 'email' ? !c.email : q.missing === 'size' ? !((c.extra || {}).team_size || ((c.extra || {}).online || {}).team_size) : q.missing === 'online' ? !(c.extra || {}).online : true));
route('GET', '/api/clients/report', T, (ctx) => {
  const q = ctx.query; const u = ctx.user; const s = D.settings();
  const rows = all('SELECT * FROM clients WHERE merged_into IS NULL AND removed=0 AND junk=0 AND archived=0').filter((c) => seeClient(u, c) && clientFilt(q)(c)).map(V.clientView); // the same clients as the list, so every count opens to the same rows
  const tally = (fn) => { const m = new Map(); for (const c of rows) { const v = fn(c); if (v !== null && v !== undefined && v !== '') m.set(v, (m.get(v) || 0) + 1); } return m; };
  const top = (m, n, f) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ label: String(k), n: v, f: f(k) }));
  const BT = { 'Showroom B2C': 'B2C (showroom)', 'Manufacturer B2B': 'B2B (manufacturer)', Both: 'B2B and B2C' };
  const weeks = []; const day0 = new Date(`${L.istDay()}T00:00:00Z`); const dow = (day0.getUTCDay() + 6) % 7; const mon = new Date(day0.getTime() - dow * 86400000);
  for (let i = 11; i >= 0; i--) { const st = new Date(mon.getTime() - i * 7 * 86400000); const from = st.toISOString().slice(0, 10); const to = new Date(st.getTime() + 6 * 86400000).toISOString().slice(0, 10); weeks.push({ label: from, n: rows.filter((c) => { const d = L.istDay(c.created_at); return d >= from && d <= to; }).length, f: null }); }
  const ags = all("SELECT id, name FROM agencies WHERE status='Active'");
  // Revenue opportunity (admins): our fee on every open seat, from the salary offered and the client's fee terms;
  // the same sum as the dashboard. Open jobs with no salary cannot be counted and are listed as such.
  let revenue = null;
  if (u.level !== 'sub') {
    const ids = new Set(rows.filter((c) => !c.internal && !c.placeholder).map((c) => c.id)); const per = new Map(); let noSal = 0; // our own hiring earns no fee
    for (const j of all('SELECT * FROM jobs WHERE archived=0').filter((x) => ids.has(x.client_id))) {
      const st = V.jobView(j).status; if (!OPEN_JOB.includes(st)) continue;
      const hired = get("SELECT COUNT(*) n FROM applications WHERE job_id=? AND result='Hired' AND left_date IS NULL", j.id).n;
      const seats = Math.max(0, (j.openings || 1) - hired); if (!seats) continue;
      const mid = ctcMid(j); if (!mid) { noSal++; continue; }
      const c = rows.find((x) => x.id === j.client_id); const fee = L.feeFor(c, j.agency_id, mid).fee * seats;
      const p = per.get(c.id) || { label: c.company || c.id, n: 0, seats: 0, jobs: 0, open: `client:${c.id}` }; p.n += fee; p.seats += seats; p.jobs++; per.set(c.id, p);
    }
    const list = [...per.values()].map((p) => ({ ...p, n: Math.round(p.n) })).sort((a, b) => b.n - a.n);
    revenue = { total: list.reduce((t, x) => t + x.n, 0), clients: list.length, no_salary_jobs: noSal, list };
  }
  return {
    total: rows.length, revenue,
    tiles: [
      { label: 'Active clients', n: rows.filter((c) => c.activated_at).length, f: { lifecycle: 'Active' } },
      { label: 'With open job openings', n: rows.filter((c) => c.jobs_open > 0).length, f: { jobs: 'open' } },
      { label: 'New, not yet seen', n: rows.filter((c) => c.is_new).length, f: { new: '1' } },
      { label: 'No email on file', n: rows.filter((c) => !c.email).length, f: { missing: 'email' } },
      { label: 'Client info not fetched', n: rows.filter((c) => !(c.extra || {}).online).length, f: { missing: 'online' } },
      ...(ags.length > 1 && isSuper(u) ? [{ label: 'Not assigned to an agency', n: rows.filter((c) => !c.agency_id).length, f: { agency: 'none' } }] : []),
    ],
    lifecycle: [{ label: 'Leads', n: rows.filter((c) => !c.activated_at).length, f: { lifecycle: 'Lead' } }, { label: 'Active clients', n: rows.filter((c) => c.activated_at).length, f: { lifecycle: 'Active' } }],
    business: ['Showroom B2C', 'Manufacturer B2B', 'Both', ''].map((k) => ({ label: k ? BT[k] : 'Not known', n: rows.filter((c) => (c.business_type || '') === k).length, f: { business_type: k || 'none' } })),
    need: ['Hiring now', 'Hiring soon', 'Just exploring', ''].map((k) => ({ label: k || 'Not asked', n: rows.filter((c) => (c.need || '') === k).length, f: { need: k || 'none' } })),
    jobs: [{ label: 'Open job openings', n: rows.filter((c) => c.jobs_open > 0).length, f: { jobs: 'open' } }, { label: 'Jobs, none open now', n: rows.filter((c) => c.jobs_total > 0 && c.jobs_open === 0).length, f: { jobs: 'closed' } }, { label: 'No job opening yet', n: rows.filter((c) => c.jobs_total === 0).length, f: { jobs: 'none' } }],
    stage: (s.client_stages || []).map((st) => ({ label: st, n: rows.filter((c) => c.stage === st).length, f: { stage: st } })).filter((x) => x.n),
    city: top(tally((c) => c.city || 'Not set'), 12, (k) => ({ city: k === 'Not set' ? 'none' : k })),
    source: top(tally((c) => c.source || 'Not set'), 10, (k) => (k === 'Not set' ? null : { source: k })),
    agency: ags.length > 1 ? [...ags.map((a) => ({ label: a.name, n: rows.filter((c) => c.agency_id === a.id).length, f: { agency: a.id } })), { label: 'Not assigned', n: rows.filter((c) => !c.agency_id).length, f: { agency: 'none' } }].filter((x) => x.n).sort((a, b) => b.n - a.n) : [],
    open_jobs: rows.filter((c) => c.jobs_open > 0).sort((a, b) => b.jobs_open - a.jobs_open).slice(0, 10).map((c) => ({ label: c.company || c.id, n: c.jobs_open, open: `client:${c.id}` })),
    weeks,
  };
});
route('GET', '/api/clients', T, (ctx) => {
  const q = ctx.query; const u = ctx.user;
  const rows = all('SELECT * FROM clients WHERE merged_into IS NULL AND removed=0 AND junk=0 ORDER BY created_at DESC')
    .filter((c) => seeClient(u, c) && (q.archived ? c.archived : !c.archived) && clientFilt(q)(c) && like(q.q, c.id, c.company, c.contact, c.city, c.whatsapp, c.old_code))
    .map(V.clientView).filter((c) => !q.jobs || (q.jobs === 'open' ? c.jobs_open > 0 : q.jobs === 'none' ? c.jobs_total === 0 : c.jobs_total > 0 && c.jobs_open === 0));
  return page(ctx, sortBy(rows, q, ['company', 'city', 'lifecycle', 'stage', 'agency_name', 'jobs_open', 'account_status']), 'clients', ['id', 'company', 'contact', 'whatsapp', 'city', 'business_type', 'stage', 'agency_name', 'owner_name', 'jobs_open', 'jobs_total', 'account_status', 'source']);
});
route('POST', '/api/clients/:id/pocs', T, (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', ctx.params.id); mustSee(c && seeClient(ctx.user, c), 'client'); const b = ctx.body || {}; const ex = { ...(c.extra || {}) }; let list = Array.isArray(ex.pocs) ? [...ex.pocs] : [];
  if (b.remove !== undefined) list = list.filter((_, i) => i !== Number(b.remove));
  else if (b.main !== undefined) list = list.map((p, i) => ({ ...p, main: i === Number(b.main) }));
  else if (b.edit !== undefined) { const i = Number(b.edit); if (!list[i]) throw httpError(404, 'Point of contact not found'); const p = L.cleanPoc(b); if (!p) throw httpError(400, 'Write the name', 'name'); if (!p.whatsapp && !p.email) throw httpError(400, 'Add a WhatsApp number or an email', 'whatsapp'); list[i] = { ...list[i], ...p }; }
  else { const p = L.cleanPoc(b); if (!p) throw httpError(400, 'Write the name', 'name'); if (!p.whatsapp && !p.email) throw httpError(400, 'Add a WhatsApp number or an email', 'whatsapp'); if (b.main || !list.length) list = list.map((x) => ({ ...x, main: false })); list.push({ ...p, main: !!b.main || !list.length, by: ctx.actor.label, at: now() }); }
  if (list.length && !list.some((p) => p.main)) list[0].main = true;
  D.edit('clients', c.id, { extra: { ...ex, pocs: list } }, ctx.actor.label, ctx.ip); return { pocs: list };
});
route('POST', '/api/clients', T, (ctx) => {
  const b = ctx.body; L.needEmail(b); L.okHrEmail(b); L.cleanPoc({ name: b.poc_name, role: b.poc_role, email: b.poc_email, whatsapp: b.poc_whatsapp });
  const r = L.intakeClient(b, { source: b.source || `Created by ${ctx.actor.label}`, by: ctx.actor }); L.saveClientExtras(r.client.id, b, ctx.actor);
  if (!r.isNew && !seeClient(ctx.user, r.client)) throw httpError(400, `This number already belongs to ${r.client.id} in another agency.`);
  if (r.isNew && ctx.user.level !== 'super') update('clients', r.client.id, { agency_id: ctx.user.agency_id, owner_id: ctx.user.id, is_new: 0 });
  return { id: r.client.id, isNew: r.isNew };
});
// A client's past with us at a glance: counts, roles, hires and every interaction, newest first.
// Clients' ratings of our recruiters are asked for by WhatsApp; only super admins see those messages.
const msgHide = (u) => (isSuper(u) ? '' : " AND COALESCE(format, '') != 'bbhs_client_review'");
function clientPast(c, u) {
  const jobs = all('SELECT * FROM jobs WHERE client_id=? ORDER BY created_at DESC', c.id).map((j) => V.jobView(j));
  const apps = all('SELECT a.*, j.title job_title, x.name person FROM applications a JOIN jobs j ON j.id=a.job_id JOIN candidates x ON x.id=a.candidate_id WHERE j.client_id=?', c.id);
  const hired = apps.filter((a) => a.result === 'Hired'); const money = true;
  const bills = all("SELECT * FROM bills WHERE client_id=? AND status NOT IN ('Draft','Cancelled') AND credit_of IS NULL", c.id);
  const uniq = (l) => [...new Set(l.filter(Boolean))];
  const closedJob = (j) => ['Closed', 'Filled'].includes(j.status);
  // Each item says what it is (type, for the filters), where it leads (open: a panel; go: a page) and its full text (detail, for search).
  const line = [
    ...all('SELECT * FROM client_calls WHERE client_id=? AND roles<>\'\'', c.id).map((x) => ({ at: x.at, type: 'call', kind: 'Requirement call', text: x.roles, detail: [x.roles && `Roles: ${x.roles}`, x.location && `Location: ${x.location}`, x.skills && `Skills: ${x.skills}`, x.duties && `Duties: ${x.duties}`, x.notes && `Notes: ${x.notes}`].filter(Boolean).join('\n'), by: x.by, open: x.job_id ? `job:${x.job_id}` : null })),
    ...all("SELECT * FROM calls WHERE client_id=? AND status='Done'", c.id).map((x) => ({ at: x.at, type: 'call', kind: x.party === 'client' ? 'Call with client' : 'Call with candidate', text: [x.outcome, (x.topics || []).join(', ')].filter(Boolean).join(' · '), detail: x.note || '', by: x.by, open: x.party !== 'client' && x.candidate_id ? `candidate:${x.candidate_id}` : null })),
    ...all("SELECT id, subject, status, at, text, to_addr FROM emails WHERE record_id=? AND status IN ('sent','received')", c.id).map((x) => ({ at: x.at, type: 'email', kind: x.status === 'received' ? 'Email from client' : 'Email sent', text: x.subject, detail: `${x.to_addr ? `To: ${x.to_addr}\n\n` : ''}${String(x.text || '').slice(0, 1500)}` })),
    ...all(`SELECT format, text, at, sent_by, direction FROM messages WHERE person_type='client' AND person_id=? AND status NOT IN ('held','failed')${msgHide(u)}`, c.id).map((x) => ({ at: x.at, type: 'wa', kind: x.direction === 'in' ? 'WhatsApp from client' : 'WhatsApp sent', text: String(x.text || '').replace(/\s+/g, ' ').slice(0, 110), detail: String(x.text || ''), by: x.sent_by, go: `whatsapp?t=client:${c.id}` })),
    ...all("SELECT text, author, at FROM notes WHERE record_id=? AND author<>'Email inbox' AND text NOT LIKE 'Client call%' AND text NOT LIKE 'Email %'", c.id).map((x) => ({ at: x.at, type: 'note', kind: 'Note', text: String(x.text).replace(/\s+/g, ' ').slice(0, 140), detail: String(x.text).length > 140 ? String(x.text) : '', by: x.author })),
    ...jobs.map((j) => ({ at: j.created_at, type: closedJob(j) ? 'closed' : 'job', kind: closedJob(j) ? `Job opening · ${j.status}` : 'Job opening', text: `${j.title}${j.city ? `, ${j.city}` : ''} · ${j.filled || 0} of ${j.openings} filled`, status: j.status, open: `job:${j.id}` })),
    ...hired.map((a) => ({ at: a.joined_at || a.step_since, type: 'hire', kind: 'Hired', text: `${a.person} as ${a.job_title}`, open: `application:${a.id}` })),
    ...(money ? bills.map((b) => ({ at: b.issued_at || b.date, type: 'bill', kind: 'Bill', text: `${b.bill_no || 'Bill'} · ₹${Math.round(b.fee).toLocaleString('en-IN')} · ${b.status}`, open: `bill:${b.id}` })) : []),
  ].filter((x) => x.at).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 400);
  return { jobs: jobs.length, open: jobs.filter((j) => !closedJob(j)).length, closed: jobs.filter(closedJob).length, calls: line.filter((x) => x.type === 'call').length, talks: line.filter((x) => x.type === 'wa' || x.type === 'email').length, applications: apps.length, sent: apps.filter((a) => L.stepIdx(a.step) >= 3).length, hires: hired.length, fees: money ? bills.reduce((t, b) => t + (b.fee || 0), 0) : null,
    roles_hired: uniq(hired.map((a) => a.job_title)), roles_asked: uniq(jobs.map((j) => j.title)), hired: hired.map((a) => ({ name: a.person, role: a.job_title, date: a.joined_at || a.step_since })), timeline: line };
}
route('GET', '/api/clients/:id', T, (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', L.resolveId(ctx.params.id)); mustSee(seeClient(ctx.user, c), 'client');
  const jobs = all('SELECT * FROM jobs WHERE client_id=? ORDER BY created_at DESC', c.id).map((j) => V.jobView(j));
  return {
    ...V.clientView(c), past: clientPast(c, ctx.user), onboarding_items: V.onboardingView(c), jobs, members: all('SELECT * FROM client_members WHERE client_id=?', c.id),
    messages: all(`SELECT * FROM messages WHERE person_type='client' AND person_id=?${msgHide(ctx.user)} ORDER BY at DESC LIMIT 30`, c.id),
    files: all('SELECT * FROM files WHERE record_id=? AND replaced=0 ORDER BY at DESC', c.id), notes: all('SELECT * FROM notes WHERE record_id=? ORDER BY at DESC', c.id),
    activation: L.activationState(c), calls: all('SELECT * FROM client_calls WHERE client_id=? ORDER BY at DESC', c.id), call_log: all("SELECT * FROM calls WHERE client_id=? AND status='Done' ORDER BY at DESC LIMIT 200", c.id), call_apps: all("SELECT a.id, a.candidate_id, a.job_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.client_id=? AND a.result='open' ORDER BY a.created_at DESC LIMIT 100", c.id).map(V.appView).map((x) => [x.id, `${x.candidate_name} · ${x.job_title}`]), mails: all('SELECT id, subject, kind, status, at, to_addr FROM emails WHERE record_id=? ORDER BY id DESC LIMIT 20', c.id),
    consents: all("SELECT * FROM consents WHERE person_type='client' AND person_id=? ORDER BY at DESC", c.id), agencies: all(`SELECT id, name FROM agencies${isSuper(ctx.user) ? '' : " WHERE status='Active'"}`), can_allocate: isSuper(ctx.user) || (!c.agency_id && R.canAllocate(ctx.user)),
    agency_users: all("SELECT id, name FROM users WHERE agency_id=? AND status='On'", c.agency_id || D.soleAgency()),
  };
});
route('PATCH', '/api/clients/:id', T, (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', ctx.params.id); mustSee(seeClient(ctx.user, c), 'client');
  const allowed = ['company', 'contact', 'whatsapp', 'email', 'city', 'state', 'business_type', 'need', 'roles', 'stage', 'owner_id', 'industry', 'fee_type', 'fee_value', 'replacement_days', 'payment_days', 'language', 'hide_name_until', 'extra', 'archived', 'dnc'];
  if (isSuper(ctx.user) || (!c.agency_id && R.canAllocate(ctx.user))) allowed.push('agency_id');
  const patch = {}; for (const k of allowed) if (ctx.body[k] !== undefined) patch[k] = ctx.body[k];
  if (patch.whatsapp) { patch.whatsapp = L.digits10(patch.whatsapp); if (!L.validPhone(patch.whatsapp)) throw httpError(400, 'Enter a 10-digit WhatsApp number', 'whatsapp'); }
  if (patch.fee_value === '') patch.fee_value = null;
  if (patch.email !== undefined) { patch.email = String(patch.email || '').trim(); if (!patch.email) throw httpError(400, 'Enter the email ID', 'email'); if (!L.EMAIL_RE.test(patch.email)) throw httpError(400, 'Enter a valid email ID', 'email'); }
  if (patch.company !== undefined && !String(patch.company || '').trim()) throw httpError(400, 'Enter the company name', 'company');
  if (patch.extra && patch.extra.hr_email && !L.EMAIL_RE.test(String(patch.extra.hr_email).trim())) throw httpError(400, 'Enter a valid HR email ID, or leave it empty', 'hr_email');
  if (patch.stage === 'Requirement later') { const at = new Date(ctx.body.follow_up_at || ''); if (Number.isNaN(at.getTime())) throw httpError(400, 'Pick the date to follow up for the requirement', 'follow_up_at'); setRequirementLater(c, at, ctx.body.follow_up_note, ctx); }
  if (patch.stage === 'Client activated' && !c.activated_at) { const st = L.activationState(c); if (!st.ready) throw httpError(400, 'Upload the signed contract to activate this client. All other work can carry on without it.'); }
  if (patch.agency_id && patch.agency_id !== c.agency_id) { const adm = L.agencyAdmin(patch.agency_id); patch.owner_id = adm ? adm.id : null; patch.is_new = 0; D.run('UPDATE jobs SET agency_id=? WHERE client_id=? AND agency_id IS NULL', patch.agency_id, c.id); }
  return D.edit('clients', c.id, patch, ctx.actor.label, ctx.ip);
});
route('POST', '/api/clients/:id/onboarding', T, (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', ctx.params.id); mustSee(seeClient(ctx.user, c), 'client');
  const { item, done, note } = ctx.body; const it = V.ONBOARDING.find((x) => x.key === item); if (!it) throw httpError(400, 'Unknown item');
  const ob = { ...(c.onboarding || {}) }; ob[item] = { done: !!done, date: done ? now() : null, by: ctx.actor.label, note: note || (ob[item] || {}).note || '' };
  const patch = { onboarding: ob };
  if (item === 'contract' && done && !c.contract) patch.contract = JSON.stringify({ by: ctx.actor.label, at: now(), method: 'Marked by team' });
  if (item === 'group_dp' && done) patch.wa_group = { ...(c.wa_group || {}), created: true, at: (c.wa_group || {}).at || now(), by: ctx.actor.label };
  D.edit('clients', c.id, patch, ctx.actor.label, ctx.ip);
  if (done && note) insert('notes', { record_id: c.id, text: `${it.label}: ${note}`, author: ctx.actor.label, at: now() });
  L.checkActivation(c.id, ctx.actor); L.syncClientStage(c.id, ctx.actor);
  return { ok: true, stage: get('SELECT stage FROM clients WHERE id=?', c.id).stage };
});
route('POST', '/api/clients/:id/summary', T, (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', ctx.params.id); mustSee(seeClient(ctx.user, c), 'client');
  const key = /^\d{4}-\d{2}$/.test(ctx.body.month || '') ? ctx.body.month : require('./monthly').prevMonthKey();
  const r = require('./monthly').makeSummary(c.id, key, ctx.actor);
  if (ctx.body.send) L.sendWA({ ptype: 'client', pid: c.id, format: 'bbhs_monthly_summary', vars: { month: r.label, summary: r.short, link: L.link('my-account/company') }, by: ctx.actor });
  return { file_id: r.file.id, label: r.label };
});
route('POST', '/api/clients/:id/members', T, (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', ctx.params.id); mustSee(seeClient(ctx.user, c), 'client');
  return addMember(c, ctx.body, ctx.actor.label);
});
function addMember(c, b, who) {
  const ph = L.digits10(b.whatsapp); if (!b.name) throw httpError(400, 'Enter a name', 'name'); if (!L.validPhone(ph)) throw httpError(400, 'Enter a 10-digit WhatsApp number', 'whatsapp');
  const r = D.run('INSERT INTO client_members (client_id,name,whatsapp,role,perms,created_at) VALUES (?,?,?,?,?,?)', c.id, b.name, ph, b.role || 'HR', JSON.stringify(b.perms || { candidates: true, feedback: true, approve: false, bills: false }), now());
  D.history(who, 'add member', c.id, null, null, `${b.name} (${b.role})`);
  return { id: Number(r.lastInsertRowid) };
}
module.exports.addMember = addMember;

// ---------- job openings ----------
route('GET', '/api/jobs', T, (ctx) => {
  const q = ctx.query; const u = ctx.user;
  const reach = new Map(all("SELECT job_id, SUM(CASE WHEN status='Done' THEN 1 ELSE 0 END) d, SUM(CASE WHEN status='Not needed' THEN 0 ELSE 1 END) n FROM postings WHERE ckey IS NOT NULL GROUP BY job_id").map((r) => [r.job_id, r]));
  const creative = new Map(all('SELECT job_id, status FROM creatives').map((r) => [r.job_id, r.status]));
  // Priority: a high CTC and a client who has given us many openings over time both push a job up. Each is ranked
  // against the jobs in this list (0-1) and the two count equally: score 0-100.
  const clientOpenings = new Map(all('SELECT client_id, SUM(COALESCE(openings, 1)) n, COUNT(*) jobs FROM jobs GROUP BY client_id').map((r) => [r.client_id, r]));
  let rows = visibleJobs(u).map((j) => { const co = clientOpenings.get(j.client_id) || {}; return { ...V.jobView(j), reach_done: (reach.get(j.id) || {}).d || 0, reach_total: (reach.get(j.id) || {}).n || 0, creative: creative.get(j.id) || '', ctc: j.sal_to || j.sal_from || null, client_openings: co.n || 0, client_jobs: co.jobs || 0 }; });
  const rankOf = (list) => { const v = list.filter((x) => x > 0).sort((a, b) => a - b); return (x) => (x > 0 && v.length ? v.filter((y) => y <= x).length / v.length : 0); };
  const ctcRank = rankOf(rows.map((j) => j.ctc || 0)); const volRank = rankOf(rows.map((j) => j.client_openings));
  for (const j of rows) j.pscore = Math.round(50 * ctcRank(j.ctc || 0) + 50 * volRank(j.client_openings));
  // The stage the team filters by. Open = live with candidates to send; No relevant candidates = live, nobody in
  // process and nobody in the resume bank who fits (counted every 10 minutes).
  const stageOf = (j) => (['Closed', 'Filled'].includes(j.status) ? 'Closed' : j.status === 'On hold' ? 'On hold' : ['Sourcing', 'Interviewing', 'Offer stage'].includes(j.status) ? 'Hiring in progress' : j.match_n === 0 ? 'No relevant candidates' : 'Open');
  for (const j of rows) j.stage = stageOf(j);
  const ACTIVE = ['Open', 'Hiring in progress', 'No relevant candidates'];
  const stages = { 'All active': rows.filter((j) => ACTIVE.includes(j.stage)).length, All: rows.length };
  for (const st of ['Open', 'Hiring in progress', 'No relevant candidates', 'On hold', 'Closed']) stages[st] = rows.filter((j) => j.stage === st).length;
  const bulkN = rows.filter((j) => j.mass).length;
  const stg = q.stage || (q.status ? 'All' : 'All active');
  if (stg !== 'All') rows = rows.filter((j) => (stg === 'All active' ? ACTIVE.includes(j.stage) : j.stage === stg));
  if (q.mass) rows = rows.filter((j) => j.mass);
  const counts = { All: rows.length, Active: rows.filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status)).length };
  for (const s of ['Draft', 'Open', 'Sourcing', 'Interviewing', 'Offer stage', 'Filled', 'On hold', 'Closed']) counts[s] = rows.filter((j) => j.status === s).length;
  rows = rows.filter((j) => (!q.status || q.status === 'All' || (q.status === 'Active' ? ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status) : j.status === q.status)) && (!q.client || j.client_id === q.client) && (!q.city || j.city === q.city) && (!q.recruiter || j.recruiter_id === q.recruiter) && (!Number(q.opened) || L.daysBetween(j.reopened_at || j.created_at) <= Number(q.opened)) && (!Number(q.ctc_min) || (j.ctc || 0) >= Number(q.ctc_min)) && like(q.q, j.id, j.title, j.client_name, j.city, j.old_code, j.recruiter_name, j.reopen_tag, j.reopen_tag ? 'replacement' : ''));
  const p = page(ctx, sortBy(rows, q, ['title', 'client_name', 'ctc', 'pscore', 'client_openings', 'filled', 'apps_total', 'reach_done', 'status', 'recruiter_name', 'days_open']), 'job-openings', ['id', 'title', 'client_name', 'city', 'ctc', 'client_openings', 'pscore', 'openings', 'filled', 'apps_total', 'status', 'recruiter_name', 'days_open', 'old_code']);
  // Choices for the filters, from the jobs this person can see
  const all0 = visibleJobs(u).map((j) => V.jobView(j)); const uniq = (f) => [...new Map(all0.map(f).filter((x) => x && x[0]).map((x) => [x[0], x])).values()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const options = { clients: uniq((j) => [j.client_id, j.client_name]), cities: uniq((j) => [j.city, j.city]), recruiters: uniq((j) => [j.recruiter_id, j.recruiter_name]) };
  return p.__file ? p : { ...p, counts, stages, bulk_count: bulkN, options };
});
// One "Client to be confirmed" per agency (the super admin's has no agency), made the first time it is needed. No
// messages go to it; the job's client is changed to the real one later.
const cleanAdMatch = (list) => (Array.isArray(list) ? list : []).slice(0, 30).map((x) => {
  const t = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return { platform: x.platform === 'LinkedIn' ? 'LinkedIn' : 'Meta', campaign: t(x.campaign), adset: t(x.adset), ad: t(x.ad) };
}).filter((x) => x.campaign || x.adset || x.ad);
const TBC = 'Client to be confirmed';
function placeholderClient(agencyId) {
  const c = get('SELECT * FROM clients WHERE placeholder=1 AND removed=0 AND agency_id IS ?', agencyId || null); if (c) return c;
  const id = D.nextId('CL');
  insert('clients', { id, company: TBC, contact: '', whatsapp: '', email: '', city: '', source: 'Job ad', stage: 'Job opening activated', agency_id: agencyId || null, is_new: 0, kyc: {}, onboarding: {}, extra: {}, placeholder: 1, created_by: 'System', created_at: now(), updated_at: now() });
  return get('SELECT * FROM clients WHERE id=?', id);
}
// BrillBrains' own hiring ("Internal"): one such client per agency, made the first time it is needed. Never billed.
function internalClient(agencyId) {
  const c = get('SELECT * FROM clients WHERE internal=1 AND removed=0 AND agency_id IS ?', agencyId || null); if (c) return c;
  const biz = D.settings().business || {}; const id = D.nextId('CL');
  insert('clients', { id, company: `${biz.name || 'BrillBrains Hiring Solutions'} (Internal)`, contact: '', whatsapp: '', email: '', city: biz.city || '', source: 'Internal', stage: 'Job opening activated', agency_id: agencyId || null, is_new: 0, kyc: {}, onboarding: {}, extra: {}, internal: 1, created_by: 'System', created_at: now(), updated_at: now() });
  return get('SELECT * FROM clients WHERE id=?', id);
}
// Every job opening carries its salary (a range is fine): the projected revenue is worked out from it.
const needSalary = (b) => { if (!(Number(b.sal_from) > 0) && !(Number(b.sal_to) > 0)) throw httpError(400, 'Give the salary offered (from, and to if it is a range)', 'sal_from'); if (Number(b.sal_from) > 0 && Number(b.sal_to) > 0 && Number(b.sal_to) < Number(b.sal_from)) throw httpError(400, 'Salary to is less than salary from', 'sal_to'); };
// Every level can open a job; a sub admin's job is always their own (they are its recruiter).
route('POST', '/api/jobs', T, (ctx) => {
  const b = ctx.body; const c = b.client_id === 'TBC' ? placeholderClient(ctx.user.agency_id) : b.client_id === 'INTERNAL' ? internalClient(ctx.user.agency_id) : get('SELECT * FROM clients WHERE id=?', b.client_id); mustSee(seeClient(ctx.user, c), 'client');
  if (ctx.user.level === 'sub') b.recruiter_id = ctx.user.id;
  needSalary(b);
  const made = createJob(c, b, ctx.actor, false);
  if (b.clone_of) { const o = get('SELECT * FROM jobs WHERE id=?', b.clone_of); if (o && (seeJob(ctx.user, o) || R.sameAgency(ctx.user, o))) { update('jobs', made.id, { jd: o.jd || {}, jd_status: o.jd && Object.keys(o.jd).length ? 'Draft' : 'Not written', rounds: o.rounds, screening_qs: o.screening_qs }); D.history(ctx.actor.label, 'clone job', made.id, null, o.id, null); } }
  if (b.jewel_need) { const j = get('SELECT jd FROM jobs WHERE id=?', made.id); update('jobs', made.id, { jd: { ...(j.jd || {}), jewel_need: b.jewel_need, ...(b.duties ? { duties: b.duties } : {}) } }); }
  if (b.call_id) { const k = get('SELECT * FROM client_calls WHERE id=? AND client_id=?', b.call_id, c.id); const r = k && k.call_roles; if (r && r[b.call_line]) { r[b.call_line].job_id = made.id; update('client_calls', k.id, { call_roles: r }); } }
  return made;
});
function createJob(c, b, actor, byClient) {
  const made = createJob0(c, b, actor, byClient); if (made && made.id) setImmediate(() => { try { L.refreshMatchCounts(made.id); } catch { /* counted on the next timer run */ } }); return made;
}
function createJob0(c, b, actor, byClient) {
  if (!b.title) throw httpError(400, 'Pick the job', 'title');
  if (c.quiet) update('clients', c.id, { quiet: 0 }); // a new opening: this client can hear from us again
  const id = D.nextId('JB');
  const recruiter = b.recruiter_id || (byClient ? (get("SELECT recruiter_id FROM jobs WHERE client_id=? AND recruiter_id IS NOT NULL ORDER BY created_at DESC", c.id) || {}).recruiter_id || c.owner_id : actor.uid);
  const toYear = (v) => (v === '' || v === null || v === undefined ? null : Number(v) * (b.salary_per === 'month' ? 12 : 1));
  insert('jobs', {
    id, client_id: c.id, title: b.title === 'Other' ? (b.title_other || 'Other') : b.title, department: b.department || L.deptOf(b.title), city: b.city || c.city, openings: Math.max(1, Number(b.openings) || 1), market: b.market || '', mass: b.mass ? 1 : 0,
    sal_from: toYear(b.sal_from), sal_to: toYear(b.sal_to), exp_from: b.exp_from === '' ? null : b.exp_from ?? null, exp_to: b.exp_to === '' ? null : b.exp_to ?? null, notice_days: b.notice_days === '' ? null : b.notice_days ?? null,
    skills: b.skills || [], agency_id: c.agency_id, recruiter_id: recruiter || null, priority: b.priority || 'Medium', jd_approved: byClient ? 0 : (b.jd_approved ? 1 : 0), jd_status: b.jd_approved && !byClient ? 'Approved' : 'Not written',
    rounds: b.rounds || ['Telephonic round', 'Virtual round', 'Final round (in person)'], screening_qs: b.screening_qs || [], notes: b.notes || '', created_by: L.actorName(actor), created_at: now(), status: null,
  });
  D.history(L.actorName(actor), 'create', id, null, null, `${b.title} for ${c.company}`);
  syncPostings(id);
  L.recalcJob(id, L.actorName(actor), byClient ? 'Raised by client' : 'Job opening made');
  if (recruiter && byClient) L.alertUser(recruiter, `${c.company} raised a new job opening ${id}: write the job description`, id, 'jobs');
  const stages = D.settings().client_stages;
  L.syncClientStage(c.id, actor);
  return get('SELECT * FROM jobs WHERE id=?', id);
}
module.exports.createJob = createJob; module.exports.needSalary = needSalary;
// ---------- hiring channels: a checklist row per channel on every job, and the tracker across jobs ----------
const channels = () => (D.settings().hiring_channels || []).map((c) => { const o = c.owner_id && get('SELECT name FROM users WHERE id=?', c.owner_id); return o ? { ...c, owner: o.name } : c; });
const POST_STATUS = ['', 'Pending', 'Done', 'Not needed'];
function syncPostings(jobId) {
  const have = new Set(all('SELECT ckey FROM postings WHERE job_id=? AND ckey IS NOT NULL', jobId).map((p) => p.ckey));
  for (const ch of channels()) if (!have.has(ch.key)) insert('postings', { job_id: jobId, channel: ch.channel, owner: ch.owner, tag: ch.tag, ckey: ch.key, status: '' });
}
function setPosting(p, status, link, actor) {
  if (!POST_STATUS.includes(status || '')) throw httpError(400, 'Pick Pending, Done or Not needed');
  update('postings', p.id, { status: status || '', done_date: status === 'Done' ? (p.done_date || now()) : null, done_by: status === 'Done' ? actor.label : null, post_link: link !== undefined ? link : p.post_link, updated_by: actor.label, updated_at: now() });
  D.history(actor.label, 'posting', p.job_id, p.channel, p.status || 'not started', status || 'not started');
}
function postingRows(j, apps) {
  syncPostings(j.id); const tags = D.settings().src_tags || {}; const byKey = new Map(channels().map((c) => [c.key, c]));
  return all('SELECT * FROM postings WHERE job_id=? AND ckey IS NOT NULL', j.id).filter((p) => byKey.has(p.ckey)).map((p) => { const ch = byKey.get(p.ckey); return { ...p, group: ch.group, section: ch.section, how: ch.how, owner: ch.owner, owner_id: ch.owner_id, status: p.status || (p.done_date ? 'Done' : ''), apply_link: L.link('apply', `?job=${j.id}&src=${p.tag}`), apps: apps.filter((a) => a.source === (tags[p.tag] || p.tag)).length }; })
    .sort((a, b) => channels().findIndex((c) => c.key === a.ckey) - channels().findIndex((c) => c.key === b.ckey));
}
// One job in Digital Reach: its channels, for the social media person as well as the team.
route('GET', '/api/reach/:id', { ...T, channels: true }, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); const limited = R.channelOnly(ctx.user); mustSee(limited ? !!j : seeJob(ctx.user, j) || R.sameAgency(ctx.user, j), 'job opening');
  const v = V.jobView(j);
  return { job: { id: j.id, title: j.title, city: j.city, openings: j.openings, client: limited ? '' : v.client_name }, rows: postingRows(j, all('SELECT * FROM applications WHERE job_id=?', j.id)), people: limited ? [] : all("SELECT id, name FROM users WHERE status='On' AND level IN ('super','admin','sub') ORDER BY name") };
});
// Digital Reach: every active job, every channel.
route('GET', '/api/postings/tracker', { ...T, channels: true }, (ctx) => {
  const limited = R.channelOnly(ctx.user);
  const jobs = all('SELECT * FROM jobs WHERE archived=0 ORDER BY created_at DESC').filter((j) => limited || seeJob(ctx.user, j) || R.sameAgency(ctx.user, j)).map((j) => V.jobView(j)).filter((j) => ctx.query.all || !['Closed', 'Filled'].includes(j.status));
  const cells = {};
  for (const j of jobs) { syncPostings(j.id); cells[j.id] = {}; for (const p of all('SELECT ckey, status, done_date, post_link, done_by, updated_by, updated_at FROM postings WHERE job_id=? AND ckey IS NOT NULL', j.id)) cells[j.id][p.ckey] = { status: p.status || (p.done_date ? 'Done' : ''), done_date: p.done_date, post_link: p.post_link, done_by: p.done_by, updated_by: p.updated_by, updated_at: p.updated_at }; }
  const tags = Object.fromEntries(channels().map((c) => [c.key, c.tag]));
  // What was last changed, by whom: everyone sees the same list.
  const names = new Map(jobs.map((j) => [j.id, `${j.title}${j.city ? `, ${j.city}` : ''}`]));
  const recent = all('SELECT job_id, channel, status, updated_by, updated_at FROM postings WHERE updated_at IS NOT NULL ORDER BY updated_at DESC LIMIT 60').filter((p) => names.has(p.job_id)).slice(0, 12).map((p) => ({ ...p, job: names.get(p.job_id) }));
  const people = limited ? [] : all("SELECT id, name FROM users WHERE status='On' AND level IN ('super','admin','sub') ORDER BY name");
  return { recent, people, channels: channels(), link_base: L.link('apply', '?'), tags, jobs: jobs.map((j) => ({ id: j.id, title: j.title, city: j.city, client: limited ? '' : j.client_name, status: j.status, priority: j.priority })), cells };
});
// Who owns a channel: any login, or a shared label. Applies to every job.
route('POST', '/api/channels/owner', T, (ctx) => {
  const b = ctx.body || {}; const list = D.settings().hiring_channels || []; const ch = list.find((c) => c.key === b.key); if (!ch) throw httpError(404, 'Channel not found');
  const who = b.owner_id ? get("SELECT id, name FROM users WHERE id=? AND status='On'", b.owner_id) : null; if (b.owner_id && !who) throw httpError(400, 'Pick a person with a login');
  const label = String(b.owner || '').trim().slice(0, 40); if (!who && !label) throw httpError(400, 'Pick an owner');
  D.setSetting('hiring_channels', list.map((c) => { if (c.key !== b.key) return c; const { owner_id: _, ...rest } = c; return who ? { ...rest, owner: who.name, owner_id: who.id } : { ...rest, owner: label }; }));
  D.run('UPDATE postings SET owner=? WHERE ckey=?', who ? who.name : label, b.key);
  D.history(ctx.actor.label, 'channel owner', null, ch.channel, ch.owner, who ? who.name : label);
  return { ok: true };
});
// The same status on one channel for every ticked job.
route('POST', '/api/postings/tracker/bulk', { ...T, channels: true }, (ctx) => {
  const b = ctx.body || {}; let done = 0;
  for (const id of (b.job_ids || []).slice(0, 200)) {
    const j = get('SELECT * FROM jobs WHERE id=?', id); if (!j || !(R.channelOnly(ctx.user) || seeJob(ctx.user, j) || R.sameAgency(ctx.user, j))) continue;
    syncPostings(j.id); const p = get('SELECT * FROM postings WHERE job_id=? AND ckey=?', j.id, b.ckey); if (p) { setPosting(p, b.status, '', ctx.actor); done++; }
  }
  return { done };
});
route('POST', '/api/postings/tracker', { ...T, channels: true }, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.body.job_id); mustSee(R.channelOnly(ctx.user) ? !!j : seeJob(ctx.user, j) || R.sameAgency(ctx.user, j), 'job opening');
  syncPostings(j.id); const p = get('SELECT * FROM postings WHERE job_id=? AND ckey=?', j.id, ctx.body.ckey); if (!p) throw httpError(404, 'Channel not found');
  setPosting(p, ctx.body.status, ctx.body.post_link, ctx.actor); return { ok: true };
});

// ---------- Excel upload of job openings (and their clients) ----------
// Reads the "Client Job Tracking Sheet" (or the first sheet): Date, Client Name, Area, Position Open, No. of Vacancy,
// Job Code, Salary Range, Notice Period, Recruiter, Status, Remarks. A "Client Master" sheet, when present, fills in the
// new clients' contact, phone, email, city and state. dry=true only shows what would happen. Nothing is sent to anyone.
const normH = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const findCol = (head, names, nth = 0) => { const hs = head.map(normH); const hits = hs.map((h, i) => (names.includes(h) ? i : -1)).filter((i) => i >= 0); return hits[nth] ?? -1; };
const phone10 = (v) => { let t = String(v || '').trim(); if (/^\d+(\.\d+)?e\d+$/i.test(t)) t = String(Math.round(Number(t))); const d = t.replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(d) ? d : ''; };
const nameKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function sheetDate(v) {
  const t = String(v || '').trim(); if (!t) return null;
  if (/^\d{5}(\.\d+)?$/.test(t)) return new Date((Number(t) - 25569) * 86400000).toISOString();
  const m = /(\d{1,2})\s*(?:st|nd|rd|th)?[\s-]*([a-z]{3})[a-z]*\.?(?:[\s-]*(\d{4}))?/i.exec(t); if (!m) return null;
  const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()); if (mon < 0) return null;
  let y = m[3] ? Number(m[3]) : new Date().getUTCFullYear(); let d = new Date(Date.UTC(y, mon, Number(m[1]), 6));
  if (!m[3] && d > new Date()) d = new Date(Date.UTC(--y, mon, Number(m[1]), 6));
  return d.toISOString();
}
// "6 to 7 LPA", "4.5 LPA", "15LPA", "25000 per month", "25k" -> yearly rupees.
function sheetSalary(v) {
  const t = String(v || '').toLowerCase(); const nums = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number); if (!nums.length) return [null, null];
  const mult = /lpa|lakh|lac|\bl\b/.test(t) ? 100000 : /k\b/.test(t) ? 1000 * (/(month|pm|p\.m)/.test(t) ? 12 : 12) : /(month|pm|p\.m)/.test(t) ? 12 : (nums[0] < 100 ? 100000 : 1);
  const a = Math.round(nums[0] * mult); const b = Math.round((nums[1] ?? nums[0]) * mult); return [Math.min(a, b), Math.max(a, b)];
}
const sheetNotice = (v) => { const t = String(v || '').toLowerCase(); const n = (t.match(/\d+(?:\.\d+)?/) || [])[0]; if (!n) return null; return Math.round(Number(n) * (/month/.test(t) ? 30 : 1)); };
route('POST', '/api/jobs/import', T, (ctx) => {
  const u = ctx.user; const b = ctx.body || {};
  if (!b.base64 || !b.name) throw httpError(400, 'Pick the Excel file');
  const rows = F.readSpreadsheet(b.name, b.base64, b.sheet || 'Client Job Tracking Sheet') || F.readSpreadsheet(b.name, b.base64);
  const hi = rows.findIndex((r) => r.map(normH).includes('client name') && r.map(normH).some((h) => ['position open', 'position', 'job title', 'job', 'role'].includes(h)));
  if (hi < 0) throw httpError(400, 'No header row with "Client Name" and "Position Open" found. Use the Client Job Tracking Sheet layout.');
  const head = rows[hi];
  const col = { date: findCol(head, ['date']), client: findCol(head, ['client name', 'client']), city: findCol(head, ['area', 'city', 'location']), title: findCol(head, ['position open', 'position', 'job title', 'job', 'role']), openings: findCol(head, ['no of vacancy', 'vacancy', 'vacancies', 'openings']), code: findCol(head, ['job code', 'code']), salary: findCol(head, ['salary range', 'salary']), notice: findCol(head, ['notice period month', 'notice period', 'notice']), recruiter: findCol(head, ['recruiter']), status: findCol(head, ['status']), remarks: findCol(head, ['remarks', 'notes']) };
  const cell = (r, k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
  // Client details from the "Client Master" sheet, when the file has one.
  const master = new Map();
  const mrows = /\.xlsx$/i.test(b.name) ? F.readSpreadsheet(b.name, b.base64, 'Client Master') : null;
  if (mrows) {
    const mi = mrows.findIndex((r) => r.map(normH).includes('client name')); const mh = mi >= 0 ? mrows[mi] : [];
    const mc = { client: findCol(mh, ['client name']), city: findCol(mh, ['city']), state: findCol(mh, ['state']), type: findCol(mh, ['business type']), owner: findCol(mh, ['owner management', 'owner']), mobile: findCol(mh, ['mobile no', 'mobile']), hr: findCol(mh, ['hr name']), email: findCol(mh, ['hr email', 'email']), hrMobile: findCol(mh, ['mobile no', 'mobile'], 1), remarks: findCol(mh, ['remarks']), status: findCol(mh, ['status']) };
    const mcell = (r, k) => (mc[k] >= 0 ? String(r[mc[k]] ?? '').trim() : '');
    if (mi >= 0) for (const [ri, r] of mrows.slice(mi + 1).entries()) { const n = mcell(r, 'client'); if (n && !master.has(nameKey(n))) master.set(nameKey(n), { name: n, row: mi + ri + 2, status: mcell(r, 'status'), city: mcell(r, 'city'), state: mcell(r, 'state'), type: mcell(r, 'type'), contact: [mcell(r, 'owner'), mcell(r, 'hr')].find((x) => x && !/^n\/?a$/i.test(x)) || '', phone: phone10(mcell(r, 'mobile')) || phone10(mcell(r, 'hrMobile')), email: /@/.test(mcell(r, 'email')) ? mcell(r, 'email') : '', remarks: mcell(r, 'remarks') }); }
  }
  const users = all("SELECT id, name, level, agency_id FROM users WHERE status='On'").filter((x) => isSuper(u) || x.agency_id === u.agency_id);
  const clientsSeen = new Map(); const plan = [];
  const existingClients = all('SELECT * FROM clients WHERE removed=0 AND merged_into IS NULL AND placeholder=0').filter((c) => seeClient(u, c));
  for (const [i, r] of rows.slice(hi + 1).entries()) {
    const client = cell(r, 'client'); const title = cell(r, 'title'); if (!client && !title) continue;
    const line = { row: hi + i + 2, client, title, city: cell(r, 'city'), code: cell(r, 'code') };
    if (!client || !title) { plan.push({ ...line, result: 'skip', why: !client ? 'No client name' : 'No position' }); continue; }
    const key = nameKey(client);
    const own = /^(internal|brill ?brains\b.*)$/.test(key);
    let c = own ? internalClient(u.agency_id) : clientsSeen.get(key) || existingClients.find((x) => nameKey(x.company) === key) || null;
    const [sf, st] = sheetSalary(cell(r, 'salary')); const statusText = cell(r, 'status');
    const rec = users.find((x) => nameKey(x.name).split(' ')[0] === nameKey(cell(r, 'recruiter')).split(' ')[0] && nameKey(cell(r, 'recruiter')));
    const job = { title, city: line.city, openings: Math.max(1, Math.round(Number(cell(r, 'openings')) || 1)), sal_from: sf, sal_to: st, notice_days: sheetNotice(cell(r, 'notice')), code: line.code, created_at: sheetDate(cell(r, 'date')), status: /hold/i.test(statusText) ? 'On hold' : /(close|cancel|fill)/i.test(statusText) ? 'Closed' : 'Open', recruiter: u.level === 'sub' ? u.id : rec ? rec.id : u.id, recruiter_name: u.level === 'sub' ? u.name : rec ? rec.name : `${u.name}${cell(r, 'recruiter') ? ` (no login for "${cell(r, 'recruiter')}")` : ''}`, remarks: cell(r, 'remarks'), sheet_status: statusText };
    if (c && c.id && get('SELECT 1 FROM jobs WHERE client_id=? AND lower(title)=lower(?) AND IFNULL(old_code,\'\')=? AND archived=0', c.id, title, line.code)) { plan.push({ ...line, client_new: false, result: 'skip', why: 'Already in the portal' }); continue; }
    if (!c) { c = { key, company: client, new: true, ...(master.get(key) || {}), city: (master.get(key) || {}).city || line.city }; clientsSeen.set(key, c); }
    plan.push({ ...line, client_new: !!c.new, client_ref: c, job, result: 'create' });
  }
  // Clients only in the Client Master sheet: added too (unless unticked), at the stage their status says.
  const stageOf = (t) => { const x = String(t || '').toLowerCase(); return /requirement active|job/.test(x) ? 'Job opening activated' : /hold/.test(x) ? 'Decision on hold' : /no current|no active/.test(x) ? 'No current opening' : /not interested/.test(x) ? 'Not interested' : /understanding|input/.test(x) ? 'Understanding needs' : /agreement|contract/.test(x) ? 'Agreement shared' : /proposal/.test(x) ? 'Proposal and pitch deck' : 'Call initiated'; };
  if (b.all_clients !== false) for (const [key, m] of master) {
    if (clientsSeen.has(key) || existingClients.some((x) => nameKey(x.company) === key)) continue;
    const c = { key, company: m.name, new: true, ...m, stage: stageOf(m.status) }; clientsSeen.set(key, c);
    plan.push({ row: m.row, client: m.name, client_new: true, client_ref: c, title: '', city: m.city, result: 'client', status: c.stage });
  }
  const out = (p) => ({ row: p.row, client: p.client, client_new: !!p.client_new, client_phone: p.client_ref ? p.client_ref.phone || p.client_ref.whatsapp || '' : '', title: p.title, city: p.city, code: p.code, result: p.result, why: p.why || '', openings: p.job && p.job.openings, salary: p.job && (p.job.sal_from ? L.salaryText(p.job) : ''), notice_days: p.job && p.job.notice_days, status: p.job ? p.job.status : p.status, recruiter: p.job && p.job.recruiter_name });
  const summary = { jobs: plan.filter((p) => p.result === 'create').length, skipped: plan.filter((p) => p.result === 'skip').length, new_clients: [...clientsSeen.values()].filter((c) => c.new).length, clients_only: plan.filter((p) => p.result === 'client').length, existing_clients: new Set(plan.filter((p) => p.result === 'create' && !p.client_new).map((p) => p.client_ref.id)).size };
  if (b.dry) return { summary, rows: plan.map(out) };
  // Create: clients first (straight into the list, no welcome message), then the jobs.
  const made = [];
  for (const c of clientsSeen.values()) {
    if (!c.new) continue;
    const id = D.nextId('CL');
    insert('clients', { id, company: c.company, contact: c.contact || '', whatsapp: c.phone || '', email: c.email || '', city: c.city || '', state: c.state || L.stateOf(c.city), business_type: c.type || '', source: 'Excel upload', stage: c.stage || 'Job opening activated', agency_id: u.agency_id || null, owner_id: u.id, is_new: 0, kyc: {}, onboarding: {}, extra: {}, created_by: ctx.actor.label, created_at: now(), updated_at: now() });
    if (c.remarks) insert('notes', { record_id: id, text: `From Client Master${c.status ? ` (${c.status})` : ''}: ${c.remarks}`, author: 'Excel upload', at: now() });
    D.history(ctx.actor.label, 'create', id, null, null, `Client ${c.company} from Excel upload`);
    c.id = id;
  }
  for (const p of plan.filter((x) => x.result === 'create')) {
    const c = get('SELECT * FROM clients WHERE id=?', p.client_ref.id); const jb = p.job;
    const note = [jb.code ? `Job code ${jb.code}` : '', jb.sheet_status ? `Status in sheet: ${jb.sheet_status}` : '', jb.remarks].filter(Boolean).join(' · ');
    const j = createJob(c, { title: jb.title, city: jb.city, openings: jb.openings, sal_from: jb.sal_from, sal_to: jb.sal_to, notice_days: jb.notice_days, notes: note, jd_approved: b.approve !== false, recruiter_id: jb.recruiter }, ctx.actor, false);
    update('jobs', j.id, { old_code: jb.code || null, ...(jb.created_at ? { created_at: jb.created_at } : {}), ...(jb.status !== 'Open' ? { manual: jb.status, manual_reason: 'From the Excel upload' } : {}) });
    L.recalcJob(j.id, ctx.actor.label, 'From the Excel upload');
    made.push(j.id);
  }
  D.history(ctx.actor.label, 'import', null, 'jobs', null, `${made.length} job openings, ${summary.new_clients} new clients from ${b.name}`, null, ctx.ip);
  return { summary, created: made, rows: plan.map(out) };
});
route('GET', '/api/jobs/:id', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j) || R.sameAgency(ctx.user, j), 'job opening');
  const apps = L.appsOfJob(j.id);
  const client = get('SELECT * FROM clients WHERE id=?', j.client_id);
  return {
    ...V.jobView(j, apps), client, apps: apps.map(V.appView).map((a) => { const stage = L.stageOfApp(a); return { ...a, stage, next_stage: L.nextStageOf(a, stage), score: L.matchScore(get('SELECT * FROM candidates WHERE id=?', a.candidate_id), j, L.ratingOf(a.candidate_id)).score }; }),
    matches: L.bestMatches(j, 10).map((m) => ({ ...candidateOut(ctx.user, m.c), score: m.score, reasons: m.reasons, gaps: m.gaps, status: V.candStatus(m.c.id) })),
    history: all('SELECT * FROM job_history WHERE job_id=? ORDER BY at DESC, id DESC', j.id), postings: postingRows(j, apps), creative: get('SELECT status, link, by, at FROM creatives WHERE job_id=?', j.id) || null,
    recruiters: all("SELECT id, name FROM users WHERE agency_id=? AND status='On'", j.agency_id), files: all('SELECT * FROM files WHERE record_id=? AND replaced=0', j.id),
    notes: all('SELECT * FROM notes WHERE record_id=? ORDER BY at DESC', j.id), jd_template: (D.settings().jd_templates || {})[j.title] || D.settings().jd_template, salary_text: L.salaryText(j),
  };
});
route('PATCH', '/api/jobs/:id', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  const allowed = ['title', 'city', 'openings', 'sal_from', 'sal_to', 'exp_from', 'exp_to', 'notice_days', 'skills', 'priority', 'rounds', 'screening_qs', 'notes', 'archived', 'market', 'department', 'mass'];
  if (ctx.body.mass !== undefined) ctx.body.mass = ctx.body.mass ? 1 : 0;
  allowed.push('recruiter_id');
  const patch = {}; for (const k of allowed) if (ctx.body[k] !== undefined) patch[k] = ctx.body[k];
  if (patch.sal_from !== undefined || patch.sal_to !== undefined) needSalary({ sal_from: patch.sal_from !== undefined ? patch.sal_from : j.sal_from, sal_to: patch.sal_to !== undefined ? patch.sal_to : j.sal_to });
  // The ads this job runs under (Meta / LinkedIn campaign, ad set, ad names); applicants from those ads land on it.
  if (ctx.body.ad_match !== undefined) patch.ad_match = cleanAdMatch(ctx.body.ad_match);
  // Every level can set the real client (for a job first posted as "Client to be confirmed"), within their own agency.
  if (ctx.body.client_id && ctx.body.client_id !== j.client_id) {
    const nc = get('SELECT * FROM clients WHERE id=? AND removed=0 AND merged_into IS NULL', ctx.body.client_id); mustSee(seeClient(ctx.user, nc), 'client');
    if (!isSuper(ctx.user) && nc.agency_id !== j.agency_id) throw httpError(403, 'Pick a client of your own agency.');
    patch.client_id = nc.id; if (isSuper(ctx.user)) patch.agency_id = nc.agency_id;
  }
  if (patch.title) patch.department = L.deptOf(patch.title);
  D.edit('jobs', j.id, patch, ctx.actor.label, ctx.ip);
  if (patch.recruiter_id && patch.recruiter_id !== j.recruiter_id) L.alertUser(patch.recruiter_id, `You are now the recruiter on ${j.id}`, j.id, 'jobs');
  L.recalcJob(j.id, ctx.actor.label, 'Edited');
  return get('SELECT * FROM jobs WHERE id=?', j.id);
});
// Bulk actions on ticked job openings: status (approve JD, hold, resume, close, reopen), priority, recruiter, client.
route('POST', '/api/jobs/bulk', T, (ctx) => {
  const b = ctx.body || {}; const out = { done: 0, errors: [] };
  for (const id of (b.ids || []).slice(0, 500)) {
    try {
      const j = get('SELECT * FROM jobs WHERE id=?', id); mustSee(seeJob(ctx.user, j), 'job opening');
      if (['hold', 'resume', 'close', 'reopen', 'approve_jd'].includes(b.action)) L.jobAction(id, b.action, { reason: b.reason }, ctx.actor);
      else if (b.action === 'priority') { if (!['High', 'Medium', 'Low'].includes(b.priority)) throw httpError(400, 'Pick a priority'); D.edit('jobs', id, { priority: b.priority }, ctx.actor.label, ctx.ip); }
      else if (b.action === 'recruiter') {
        D.edit('jobs', id, { recruiter_id: b.recruiter_id || null }, ctx.actor.label, ctx.ip);
        if (b.recruiter_id && b.recruiter_id !== j.recruiter_id) L.alertUser(b.recruiter_id, `You are now the recruiter on ${j.id}`, j.id, 'jobs');
      } else if (b.action === 'client') {
        const nc = get('SELECT * FROM clients WHERE id=? AND removed=0 AND merged_into IS NULL', b.client_id); mustSee(seeClient(ctx.user, nc), 'client');
        if (!isSuper(ctx.user) && nc.agency_id !== j.agency_id) throw httpError(403, 'Pick a client of your own agency.');
        D.edit('jobs', id, { client_id: nc.id, ...(isSuper(ctx.user) ? { agency_id: nc.agency_id } : {}) }, ctx.actor.label, ctx.ip);
      } else throw httpError(400, 'Unknown action');
      out.done++;
    } catch (e) { out.errors.push(`${id}: ${e.message}`); }
  }
  return out;
});
route('POST', '/api/jobs/:id/action', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  return L.jobAction(j.id, ctx.body.action, ctx.body, ctx.actor);
});
route('POST', '/api/jobs/:id/jd', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  const jd = { ...(j.jd || {}), ...(ctx.body.jd || {}) };
  const pool = D.settings().jd_templates || {}; if (!pool[j.title]) D.setSetting('jd_templates', { ...pool, [j.title]: cleanJd(jd) }); // the first JD for a role joins the pool
  const patch = { jd, jd_status: ctx.body.send ? 'Waiting for client' : (j.jd_status === 'Not written' ? 'Draft' : j.jd_status) };
  D.edit('jobs', j.id, patch, ctx.actor.label, ctx.ip);
  if (ctx.body.send) {
    insert('job_history', { job_id: j.id, at: now(), status: 'JD sent', by: ctx.actor.label, note: 'Sent to client for approval' });
    L.sendWA({ ptype: 'client', pid: j.client_id, format: 'bbhs_jd_approval', vars: { job: j.title, job_id: j.id, link: L.link('my-account') }, jb: j.id, by: ctx.actor, auto: true, rule: 'jd_approval' });
  }
  return get('SELECT * FROM jobs WHERE id=?', j.id);
});
// ---------- JD pool: one JD per role, and AI writing ----------
const JD_KEYS = ['about', 'summary', 'duties', 'must', 'good', 'experience', 'education', 'languages', 'salary', 'timings', 'benefits', 'incentives', 'location', 'reporting', 'jewel_need', 'jewel_years', 'jewel_note'];
const jdSections = () => (Array.isArray(D.settings().jd_sections) && D.settings().jd_sections.length ? D.settings().jd_sections : require('./defaults').defaultSettings().jd_sections);
module.exports.jdSections = jdSections;
const cleanJd = (v) => Object.fromEntries([...new Set([...JD_KEYS, ...jdSections().map((x) => x.key)])].map((k) => [k, String((v || {})[k] ?? '').slice(0, 4000)]));
module.exports.cleanJd = (v) => cleanJd(v);
route('GET', '/api/jd-pool', T, () => ({ pool: D.settings().jd_templates || {}, standard: D.settings().jd_template, ai: require('./jdwriter').available() }));
route('POST', '/api/jd-pool', T, (ctx) => {
  const title = String(ctx.body.title || '').trim(); if (!title) throw httpError(400, 'Pick the role');
  const pool = { ...(D.settings().jd_templates || {}) };
  if (ctx.body.remove) delete pool[title]; else pool[title] = cleanJd(ctx.body.jd);
  D.setSetting('jd_templates', pool); D.history(ctx.actor.label, ctx.body.remove ? 'remove JD' : 'save JD', null, 'jd_pool', null, title);
  return { ok: true };
});
// JDs already written, as Word or PDF files: the text is sorted into the pool's sections, one role per file name.
route('POST', '/api/jd-pool/upload', { ...T, rate: { key: 'jdwrite', max: 60, minutes: 60 } }, async (ctx) => {
  const b = ctx.body || {}; const name = String(b.name || ''); if (!/\.(pdf|docx)$/i.test(name)) throw httpError(400, 'Upload a PDF or Word file');
  const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64'); if (!buf.length) throw httpError(400, 'The file is empty.');
  const title = String(b.title || name.replace(/\.[^.]+$/, '').replace(/\b(jd|job description|profile|final|new|copy)\b|[_\-()\d]+/gi, ' ').replace(/\s+/g, ' ')).trim() || name;
  let text = ''; try { text = require('./cvparse').cvText(name, buf) || ''; } catch { /* a scan: the AI reads the file */ }
  const LLM = require('./llm'); let jd = { summary: text.trim().slice(0, 4000) };
  if (LLM.available()) {
    const keys = ['summary', 'duties', 'must', 'good', 'education', 'languages', 'timings', 'benefits', 'incentives', 'location'];
    const r = await LLM.json({ system: 'You sort a job description into sections for a recruitment firm. Keep the words of the document. Leave a section empty if the document does not cover it.', user: text.trim().length > 80 ? text.slice(0, 12000) : `File: ${name}`, files: text.trim().length > 80 ? [] : [{ name, buf }], schema: { type: 'object', additionalProperties: false, required: keys, properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])) }, name: 'jd', maxTokens: 1800 });
    jd = r.answer || r;
  } else if (!text.trim()) throw httpError(424, 'This file has no readable text.');
  D.setSetting('jd_templates', { ...(D.settings().jd_templates || {}), [title]: cleanJd(jd) }); D.history(ctx.actor.label, 'upload JD', null, 'jd_pool', null, title);
  return { title };
});
// AI: a JD from the role's facts. A few a minute per login is plenty (each one costs a little).
route('POST', '/api/jd/write', { auth: 'team', rate: { key: 'jdwrite', max: 30, minutes: 60 } }, async (ctx) => {
  const b = ctx.body || {}; if (!b.title) throw httpError(400, 'Pick the role');
  const facts = { title: b.title, city: b.city || '', experience: b.experience || '', salary: b.salary || '', jewellery_industry_experience: { need: b.jewel_need || 'Preferred', years: b.jewel_years || '', detail: b.jewel_note || '' }, extra_notes: String(b.notes || '').slice(0, 1500) };
  return { jd: cleanJd(await require('./jdwriter').writeSimple(facts)) };
});
// The jewellery line of a JD ("Required · 2+ years · diamond retail"), for the PDF and the client.
const jewelLine = (jd) => (jd && jd.jewel_need ? [jd.jewel_need, jd.jewel_years ? `${jd.jewel_years}+ years` : '', jd.jewel_note].filter(Boolean).join(' · ') : '');
module.exports.jewelLine = jewelLine;
module.exports.jdPdf = (j) => jdPdf(j);
route('GET', '/api/jobs/:id/jd.pdf', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  return { __file: { name: `${j.id}-JD.pdf`, mime: 'application/pdf', buf: jdPdf(j) } };
});
// The JD the portal shows: the job's own, on top of the JD pool copy for its title (or the standard JD), {job} and
// {city} filled in. Shared by the PDF and the public page.
function jdOf(j) {
  const t = (D.settings().jd_templates || {})[j.title] || D.settings().jd_template || {}; const fill = (x) => (typeof x === 'string' ? x.replace(/\{job\}/g, j.title).replace(/\{city\}/g, j.city || '') : x);
  return Object.fromEntries(Object.entries({ ...t, ...(j.jd || {}) }).map(([k, x]) => [k, fill(x)]));
}
function jdPdf(j) {
  const jd = jdOf(j); const c = get('SELECT * FROM clients WHERE id=?', j.client_id);
  const L2 = [{ text: `${j.title} — ${j.city}`, size: 13, bold: true }, ''];
  if (jewelLine(jd)) jd.jewel_text = jewelLine(jd);
  const order = jdSections().map((x) => [x.key, x.label]); const at = order.findIndex(([k]) => k === 'duties');
  order.splice(at >= 0 ? at + 1 : order.length, 0, ['jewel_text', 'Jewellery industry experience']);
  for (const [k, lab] of order) {
    const v = k === 'salary' ? (jd.salary || L.salaryText(j)) : jd[k]; if (v) { L2.push({ text: lab, bold: true }); for (const line of String(v).split('\n')) L2.push(line); L2.push(''); }
  }
  L2.push(`Apply: ${L.link('apply', `?job=${j.id}`)}`);
  return F.makePdf(`Job description · ${j.id}`, L2, D.settings().business, c);
}
module.exports.jdPdf = jdPdf;
// The job description as a web page for candidates: the link the team copies and shares. The client is not named.
function jdHtml(id, src) {
  const j = get('SELECT * FROM jobs WHERE id=? AND archived=0 AND is_sample=0', String(id).toUpperCase()); if (!j) return null;
  const v = V.jobView(j); const open = ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(v.status);
  const e = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const jd = jdOf(j); if (jewelLine(jd)) jd.jewel_text = jewelLine(jd);
  const b = D.settings().business; const apply = L.link('apply', `?job=${j.id}${src && /^[\w-]{2,20}$/.test(src) ? `&src=${encodeURIComponent(src)}` : ''}`);
  const list = (t) => { const lines = String(t).split('\n').map((x) => x.replace(/^[-•*]\s*/, '').trim()).filter(Boolean); return lines.length > 1 ? `<ul>${lines.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : `<p>${e(lines[0] || '')}</p>`; };
  // No JD typed in: the uploaded JD document is read, without the client's name, contact, emails or numbers.
  const docText = () => {
    const f = (jd.file && get('SELECT * FROM files WHERE id=?', jd.file)) || get("SELECT * FROM files WHERE record_id=? AND type='jd' AND name NOT LIKE '%-JD-approved.pdf' ORDER BY id DESC LIMIT 1", j.id);
    if (!f) return '';
    let t = ''; try { t = require('./cvparse').cvText(f.name, F.readStored(f)) || ''; } catch { return ''; }
    const cl = get('SELECT company, contact FROM clients WHERE id=?', j.client_id) || {};
    const names = v.internal ? [] : [cl.company, String(cl.company || '').replace(/\b(private|pvt\.?|limited|ltd\.?|llp|inc\.?)\b/gi, '').trim(), cl.contact].filter((x) => x && x.length >= 3);
    for (const n of names) t = t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'our client');
    t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '').replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g, '');
    // how to reach the client and the document's own title are left out: candidates apply with the button
    return t.split('\n').filter((l) => !/^\s*(contact|e-?mail|call|phone|mobile|whatsapp|send (your )?(cv|resume)|interested candidates|job description\b)/i.test(l)).join('\n').replace(/[ \t]+\n/g, '\n').trim();
  };
  // A document as sections: short lines (or ones ending in ':') are headings, bullet lines a list.
  const docHtml = (t) => { let out = ''; let ul = false; const close = () => { if (ul) { out += '</ul>'; ul = false; } };
    for (const raw of t.split('\n')) { const l = raw.trim(); if (!l) { close(); continue; }
      const bullet = /^([-•*·▪●◦]|\d{1,2}[.)])\s+/.test(l);
      if (bullet) { if (!ul) { out += '<ul>'; ul = true; } out += `<li>${e(l.replace(/^([-•*·▪●◦]|\d{1,2}[.)])\s+/, ''))}</li>`; continue; }
      close();
      if (l.length <= 48 && (/:$/.test(l) || (/^[A-Z][^.!?]*$/.test(l) && l.split(' ').length <= 6))) out += `<h2>${e(l.replace(/:$/, ''))}</h2>`; else out += `<p>${e(l)}</p>`;
    }
    close(); return out; };
  const secs = ((o) => { const i = o.findIndex(([k]) => k === 'duties'); o.splice(i >= 0 ? i + 1 : o.length, 0, ['jewel_text', 'Jewellery industry experience']); return o; })(jdSections().filter((x) => x.public !== false && x.key !== 'location').map((x) => [x.key, x.key === 'summary' ? 'About the role' : x.key === 'duties' ? 'What you will do' : x.label]))
    .filter(([k]) => jd[k]).map(([k, l]) => `<section><h2>${l}</h2>${list(jd[k])}</section>`).join('');
  const facts = [['Location', j.city], ['Experience', j.exp_from != null ? `${j.exp_from}${j.exp_to != null ? `–${j.exp_to}` : '+'} years` : ''], ['Openings', j.openings]].filter(([, x]) => x);
  const title = `${j.title} · ${j.city}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)} · ${e(b.name)}</title>
<meta name="description" content="${e(String(jd.summary || `${j.title} job in ${j.city}`).slice(0, 160))}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(String(jd.summary || '').slice(0, 200))}"><meta name="robots" content="noindex">
<style>:root{--navy:#101a3a;--gold:#d4a017;--ink:#1d2433;--muted:#5d6577;--line:#e6e8ef;--bg:#f6f7fb}*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
header{background:var(--navy);color:#fff;padding:18px 16px}header .in,main{max-width:760px;margin:0 auto}header b{font-size:15px;letter-spacing:.02em}header span{display:block;font-size:12px;opacity:.7}
main{padding:20px 16px 90px}.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px}h1{font-size:26px;line-height:1.25;margin:0 0 6px}.where{color:var(--muted);margin:0 0 16px}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}.facts span{background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:14px}.facts b{font-weight:600}
section{margin-top:22px}.doc h2{margin-top:20px}.doc p{margin:0 0 8px}h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px}ul{margin:0;padding-left:20px}li{margin:4px 0}p{margin:0}
.apply{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);padding:12px 16px}.apply a{display:block;max-width:760px;margin:0 auto;text-align:center;background:var(--gold);color:var(--navy);font-weight:700;text-decoration:none;padding:14px;border-radius:12px}
.closed{background:#fff7e0;border:1px solid #f0d58a;border-radius:12px;padding:12px 14px;margin-bottom:14px}</style></head>
<body><header><div class="in"><b>${e(b.name)}</b><span>Jobs in jewellery</span></div></header><main><div class="card">
${open ? '' : '<div class="closed">This job is no longer taking applications. <a href="/">See open jobs</a></div>'}
<h1>${e(j.title)}</h1><p class="where">${e(j.city)}${j.department ? ` · ${e(j.department)}` : ''}</p><div class="facts">${facts.map(([l, x]) => `<span>${l}: <b>${e(x)}</b></span>`).join('')}</div>
${((own, doc) => (own ? secs : doc ? `<section class="doc">${docHtml(doc)}</section>` : secs || '<section><p>Apply to hear more about this job.</p></section>'))(['summary', 'duties', 'must', 'good', 'education'].some((k) => String((j.jd || {})[k] || '').trim()), docText())}
</div></main>${open ? `<div class="apply"><a href="${e(apply)}">Apply for this job</a></div>` : ''}</body></html>`;
}
module.exports.jdHtml = jdHtml;
route('POST', '/api/jobs/:id/posting', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  const p = get('SELECT * FROM postings WHERE id=? AND job_id=?', ctx.body.id, j.id); if (!p) throw httpError(404, 'Posting not found');
  setPosting(p, ctx.body.status !== undefined ? ctx.body.status : ctx.body.done ? 'Done' : '', ctx.body.post_link, ctx.actor);
  return { ok: true };
});
route('POST', '/api/jobs/:id/alert', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  const targets = ctx.body.ids && ctx.body.ids.length ? ctx.body.ids : L.bestMatches(j, 30, true).filter((m) => m.score >= D.settings().match.strong).map((m) => m.c.id);
  const budget = D.settings().bulk_budget; let sent = 0; const skipped = []; const fm = D.settings().formats;
  const format = fm.bbhs_job_interest && fm.bbhs_job_interest.approved && !fm.bbhs_job_interest.off ? 'bbhs_job_interest' : fm.bbhs_job_alert && fm.bbhs_job_alert.approved && !fm.bbhs_job_alert.off ? 'bbhs_job_alert' : null;
  if (!format) throw httpError(400, 'The job interest message (bbhs_job_interest) is waiting for Meta approval. Send it from Settings → Message formats; until then, call and use Interested / Not interested.');
  for (const cid of targets.slice(0, budget)) {
    const r = L.sendWA({ ptype: 'candidate', pid: cid, format, vars: { job: j.title, city: j.city, salary: L.SAL_HIDDEN, link: L.link(`jd/${j.id}`) }, jb: j.id, by: ctx.actor, bulk: true, dedupe: `alert:${j.id}:${cid}` });
    if (r.skipped) skipped.push(`${cid}: ${r.skipped}`); else sent++;
  }
  return { sent, skipped };
});
route('POST', '/api/jobs/:id/send-profiles', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  const moved = [];
  for (const id of ctx.body.ids || []) { const a = get('SELECT * FROM applications WHERE id=? AND job_id=?', id, j.id); if (a && a.result === 'open' && L.stepIdx(a.step) < 3) { L.moveStep(a.id, 'Sent to client', ctx.actor, 'Profiles sent'); moved.push(a.id); } }
  const count = get("SELECT COUNT(*) c FROM applications WHERE job_id=? AND step='Sent to client' AND result='open'", j.id).c;
  if (!moved.length) L.sendWA({ ptype: 'client', pid: j.client_id, format: 'bbhs_shortlist_ready', vars: { count, job: j.title, job_id: j.id, link: L.link('my-account') }, jb: j.id, by: ctx.actor });
  return { moved, count };
});

// ---------- candidates (resume bank) ----------
// The resume bank as filtered by q (the same filters a segment saves), as this user may see it.
// Everything but the dropdown filters (those are candMatch): archived, notice, looking, tie-up, agency, new, freshness, search.
const OLD_STATUS = { Hired: 'Placed - BBHS', 'In process': 'Active application - BBHS' };
function candBase(q, u) {
  const fresh = q.updated ? Number(q.updated) : null;
  const want = many(q.looking).concat(OLD_STATUS[q.status] ? [OLD_STATUS[q.status]] : []); let states = null;
  const statusOk = (c) => { if (!want.length) return true; if (!states) states = L.appStates(); return want.includes(L.jobStatusOf(c, states.get(c.id))); };
  const worked = many(q.worked);
  const ind = q.industry || 'all'; const inInd = (c) => ind === 'all' || (c.industry || 'Jewellery') === ind; // old segments may still carry an industry
  return (c) => (q.archived ? c.archived : !c.archived) && inInd(c) && (!q.notice || (c.notice_days ?? 999) <= Number(q.notice))
      && statusOk(c) && (!worked.length || (c.exp_business || []).some((x) => worked.includes(x))) && (!q.tieup || String(c.tieup_id) === String(q.tieup)) && (!q.agency || (q.agency === 'none' ? !c.agency_id : q.agency === 'any' ? !!c.agency_id : c.agency_id === q.agency)) && (!q.new || c.is_new)
      && (!q.cv || (q.cv === 'yes' ? !!c.cv_file : !c.cv_file))
      && (!fresh || L.daysBetween(c.last_updated || c.created_at) <= fresh) && (!q.stale || L.daysBetween(c.last_updated || c.created_at) > 90)
      && like(q.q, c.id, c.name, R.phoneVisible(u, c) ? c.whatsapp : '', c.job_wanted, (c.also_roles || []).join(' '), c.city, c.current_company, c.old_code, c.domain, (c.skills || []).join(' '));
}
// The values each dropdown can still offer, with counts: worked out from the candidates matching every OTHER filter,
// so picking Design narrows designations and skills to what Design candidates have (and so on, in any order).
const FACETS = {
  domain: (c) => [c.domain || 'Not read yet'],
  dept: (c) => [c.department, ...(c.also_roles || []).map((x) => L.deptOf(x))],
  job: (c) => [c.job_wanted, ...(c.also_roles || [])],
  skills: (c) => (c.skills || []).map((x) => String(x).trim()),
  city: (c) => [c.city, ...(c.work_cities || [])],
  state: (c) => [c.state || L.stateOf(c.city)],
  source: (c) => [c.source],
  company: (c) => [String(c.current_company || '').replace(/\s+/g, ' ').trim()],
};
function candFacets(q, u) {
  const base = candBase(q, u); const pool = all('SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0').filter(base);
  const out = {};
  for (const [k, vals] of Object.entries(FACETS)) {
    const m = candMatch({ ...q, [k]: '' }); const tally = new Map();
    for (const c of pool) if (m(c)) for (const v of new Set(vals(c).filter(Boolean))) tally.set(v, (tally.get(v) || 0) + 1);
    out[k] = [...tally.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, k === 'skills' ? 400 : 300);
  }
  return out;
}
function candRows(q, u) {
  const match = candMatch(q); const base = candBase(q, u); const states = L.appStates();
  return all('SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0 ORDER BY created_at DESC')
    .filter((c) => base(c) && match(c))
    .map((c) => { const js = L.jobStatusOf(c, states.get(c.id)); return { ...candidateOut(u, c), job_status: js, status: js }; });
}
// ---------- Add to the lists: a domain, department, designation or skill that is not there yet (admins) ----------
route('POST', '/api/taxonomy', T, (ctx) => {
  if (!['super', 'admin'].includes(ctx.user.level)) throw httpError(403, 'Admins add to these lists.');
  const b = ctx.body || {}; const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (name.length < 2) throw httpError(400, 'Type the name', 'name');
  const s = D.settings(); const same = (l) => (l || []).some((x) => String(x).toLowerCase() === name.toLowerCase());
  const save = (k, v) => { D.setSetting(k, v); D.history(ctx.actor.label, 'setting', 'settings', k, null, `added ${name}`); };
  if (b.kind === 'domain') { if (same(s.industry_list)) throw httpError(400, `${name} is already a domain`, 'name'); save('industry_list', [...(s.industry_list || []), name]); }
  else if (b.kind === 'dept') { if (same(s.departments)) throw httpError(400, `${name} is already a department`, 'name'); save('departments', [...(s.departments || []), name]); }
  else if (b.kind === 'job') {
    const dept = String(b.dept || '').trim(); if (!dept) throw httpError(400, 'Pick its department', 'dept');
    const inds = JSON.parse(JSON.stringify(s.industries)); const key = s.default_industry && inds[s.default_industry] ? s.default_industry : Object.keys(inds)[0]; const groups = inds[key].groups;
    if (Object.values(groups).some((g) => same(g.jobs))) throw httpError(400, `${name} is already a designation`, 'name');
    const gname = Object.keys(groups).find((g) => groups[g].dept === dept) || dept; groups[gname] = groups[gname] || { dept, jobs: [] }; groups[gname].jobs.push(name);
    save('industries', inds); if (!(s.departments || []).includes(dept)) save('departments', [...(s.departments || []), dept]);
  } else if (b.kind === 'skill') {
    const SK = require('./skills'); const group = SK.GROUPS.some((g) => g.name === b.group) ? b.group : SK.groupOf(name);
    const cur = SK.groups(s); if (cur.some((g) => same(g.skills))) throw httpError(400, `${name} is already a skill`, 'name');
    const own = { ...(s.skill_groups || {}) }; own[group] = [...(own[group] || (cur.find((g) => g.name === group) || { skills: [] }).skills), name]; save('skill_groups', own);
  } else throw httpError(400, 'Pick what to add');
  return { ok: true, name };
});
// ---------- Candidate reports: counts by group, each with the filter that opens those candidates ----------
route('GET', '/api/candidates/report', T, (ctx) => {
  const q = { ...ctx.query }; const u = ctx.user; const SK = require('./skills');
  const base = candBase(q, u); const match = candMatch(q);
  const rows = all('SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0').filter((c) => base(c) && match(c));
  const tally = (fn) => { const m = new Map(); for (const c of rows) for (const v of new Set([].concat(fn(c)).filter((x) => x !== null && x !== undefined && x !== ''))) m.set(v, (m.get(v) || 0) + 1); return m; };
  const top = (m, n, f) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ label: String(k), n: v, f: f(k) }));
  const groups = SK.groups(D.settings());
  const expBand = (y) => (y === null || y === undefined ? null : y === 0 ? 'Fresher' : y < 3 ? '1–2 years' : y < 6 ? '3–5 years' : y < 11 ? '6–10 years' : '10+ years');
  const EXP = [['Fresher', { exp_min: '0', exp_max: '0' }], ['1–2 years', { exp_min: '0.1', exp_max: '2.99' }], ['3–5 years', { exp_min: '3', exp_max: '5.99' }], ['6–10 years', { exp_min: '6', exp_max: '10.99' }], ['10+ years', { exp_min: '11' }]];
  const expM = tally((c) => expBand(c.exp_total));
  const jewBand = (y) => (y === null || y === undefined ? null : y === 0 ? '0' : y < 1 ? 'lt1' : y < 3 ? '1-3' : y < 5 ? '3-5' : y < 10 ? '5-10' : '10+');
  const JEW = [['0', 'None'], ['lt1', 'Under 1 year'], ['1-3', '1–3 years'], ['3-5', '3–5 years'], ['5-10', '5–10 years'], ['10+', '10+ years']];
  const jewM = tally((c) => jewBand(c.exp_jewellery));
  const stM = L.appStates(); const lookM = tally((c) => L.jobStatusOf(c, stM.get(c.id)));
  // Added per week, the last 12 weeks (India time, weeks start Monday)
  const weeks = []; const day0 = new Date(`${L.istDay()}T00:00:00Z`); const dow = (day0.getUTCDay() + 6) % 7; const mon = new Date(day0.getTime() - dow * 86400000);
  for (let i = 11; i >= 0; i--) { const s = new Date(mon.getTime() - i * 7 * 86400000); const e = new Date(s.getTime() + 6 * 86400000); const from = s.toISOString().slice(0, 10); const to = e.toISOString().slice(0, 10); weeks.push({ label: from, to, n: rows.filter((c) => { const d = L.istDay(c.created_at); return d >= from && d <= to; }).length, f: { from, to } }); }
  return {
    total: rows.length,
    tiles: [
      { label: 'New, not yet seen', n: rows.filter((c) => c.is_new).length, f: { new: '1' } },
      { label: 'Not assigned to an agency', n: rows.filter((c) => !c.agency_id).length, f: { agency: 'none' } },
      { label: 'No resume on file', n: rows.filter((c) => !c.cv_file).length, f: { cv: 'no' } },
      { label: 'Current status unknown', n: rows.filter((c) => L.jobStatusOf(c, stM.get(c.id)) === 'Current status unknown').length, f: { looking: 'Current status unknown' } },
    ],
    dept: top(tally((c) => c.department || 'Not set'), 12, (k) => (k === 'Not set' ? null : { dept: k })),
    job: top(tally((c) => c.job_wanted || 'Not set'), 12, (k) => (k === 'Not set' ? null : { job: k })),
    domain: top(tally((c) => c.domain || 'Not read yet'), 10, (k) => ({ domain: k })),
    city: top(tally((c) => c.city || 'Not set'), 12, (k) => (k === 'Not set' ? null : { city: k })),
    source: top(tally((c) => c.source || 'Not set'), 10, (k) => (k === 'Not set' ? null : { source: k })),
    skill_group: [...groups.map((g) => g.name), SK.OTHER].map((g) => ({ label: g, n: rows.filter((c) => (c.skills || []).some((s) => SK.groupOf(s, groups) === g)).length, f: { skillgroup: g } })).filter((x) => x.n).sort((a, b) => b.n - a.n),
    skills: top(tally((c) => (c.skills || []).map((s) => String(s).trim())), 15, (k) => ({ skills: k })),
    exp: EXP.map(([l, f]) => ({ label: l, n: expM.get(l) || 0, f })).concat([{ label: 'Not given', n: rows.filter((c) => c.exp_total === null || c.exp_total === undefined).length, f: null }]),
    jewellery: JEW.map(([k, l]) => ({ label: l, n: jewM.get(k) || 0, f: { jewellery: k } })),
    looking: L.JOB_STATUSES.map((k) => ({ label: k, n: lookM.get(k) || 0, f: { looking: k } })),
    worked: L.BUSINESS_TYPES.map((k) => ({ label: k, n: rows.filter((c) => (c.exp_business || []).includes(k)).length, f: { worked: k } })),
    worked_people: rows.filter((c) => (c.exp_business || []).length).length, // each person once (someone can tick two or three)
    assigned: [{ label: 'Assigned', n: rows.filter((c) => c.agency_id).length, f: { agency: 'any' } }, { label: 'Not assigned', n: rows.filter((c) => !c.agency_id).length, f: { agency: 'none' } }],
    resume: [{ label: 'Resume on file', n: rows.filter((c) => c.cv_file).length, f: { cv: 'yes' } }, { label: 'No resume', n: rows.filter((c) => !c.cv_file).length, f: { cv: 'no' } }],
    weeks,
  };
});
// Every matching candidate's CV in one zip, with the list as Excel. Downloads are for the super admin only.
route('GET', '/api/candidates/cvs.zip', { auth: 'team', levels: ['super'] }, (ctx) => {
  const rows = candRows(ctx.query, ctx.user); const files = {}; let size = 0; let skipped = 0;
  const safe = (v) => String(v || '').replace(/[^\w .-]+/g, '').trim().slice(0, 60) || 'candidate';
  for (const c of rows) {
    const fl = c.cv_file && get('SELECT * FROM files WHERE id=?', c.cv_file); if (!fl) continue;
    let buf; try { buf = F.readStored(fl); } catch { skipped++; continue; }
    if (size + buf.length > 200 * 1024 * 1024 || Object.keys(files).length >= 1000) { skipped++; continue; }
    const ext = (/\.[a-z0-9]{2,5}$/i.exec(fl.name || '') || ['.pdf'])[0];
    files[`CVs/${c.id} ${safe(c.name)}${ext}`] = buf; size += buf.length;
  }
  files['candidates.xlsx'] = F.toXLSX([['ID', 'Name', 'WhatsApp', 'Email', 'Job wanted', 'Department', 'City', 'Experience (yrs)', 'Jewellery (yrs)', 'Status', 'Source', 'CV in zip'], ...rows.map((c) => [c.id, c.name, c.whatsapp, c.email, c.job_wanted, c.department, c.city, c.exp_total ?? '', c.exp_jewellery ?? '', c.status, c.source, Object.keys(files).some((k) => k.startsWith(`CVs/${c.id} `)) ? 'Yes' : 'No'])], 'candidates');
  D.history(ctx.actor.label, 'download', null, 'candidate CVs', null, `${rows.length} candidates, ${Object.keys(files).length - 1} CVs${skipped ? `, ${skipped} left out` : ''}`, null, ctx.ip);
  return { __file: { name: `candidates-cvs-${L.istDay()}.zip`, mime: 'application/zip', buf: F.zipStore(files) } };
});
route('GET', '/api/candidates', T, (ctx) => {
  const q = ctx.query; const u = ctx.user;
  const ind = q.industry || 'all'; const inInd = (c) => ind === 'all' || (c.industry || 'Jewellery') === ind;
  const rows = sortBy(candRows(q, u), q, ['name', 'job_wanted', 'source', 'exp_total', 'city', 'status', 'created_at']);
  const open = all('SELECT is_new, agency_id, skills, needs_check, possible_repeat_of FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0 AND archived=0');
  // Skills to filter by: the ones candidates really have, most common first.
  const tally = {}; for (const c of open) for (const s of c.skills || []) { const k = String(s).trim(); if (k) tally[k] = (tally[k] || 0) + 1; }
  ctx.quick = { all: open.length, new: open.filter((c) => c.is_new && !c.agency_id).length, unassigned: open.filter((c) => !c.agency_id).length, check: open.filter((c) => c.needs_check || c.possible_repeat_of).length, skills: Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 300).map(([k]) => k) };
  ctx.designations = [...new Set(all('SELECT industry, job_wanted, also_roles FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0').filter(inInd).flatMap((c) => [c.job_wanted, ...(c.also_roles || [])]).filter(Boolean))].sort();
  // Only the super admin downloads candidates (as filtered on screen); agencies and recruiters work in the portal.
  if (['csv', 'xlsx'].includes(ctx.query.format) && !isSuper(u)) throw httpError(403, 'Only the super admin can download candidates.');
  return { ...page(ctx, rows, 'candidates', [...CAND_EXPORT, [(r) => L.adLabel(r), 'ad'], 'status']), designations: ctx.designations, ads: adOptions('candidates'), quick: ctx.quick, facets: ['csv', 'xlsx'].includes(ctx.query.format) ? undefined : candFacets(q, u) };
});
route('POST', '/api/candidates', T, async (ctx) => {
  // Same questions and checks as the public job-seeker form (api-public /apply), plus salary, notice, industry and source.
  const b = ctx.body;
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email).trim())) throw httpError(400, 'Enter a valid email, or leave it empty', 'email');
  if (!b.job_wanted) throw httpError(400, 'Pick the job they want', 'job_wanted');
  if (b.job_wanted === 'Other' && !b.job_other) throw httpError(400, 'Type the job they want', 'job_other');
  if (!b.city) throw httpError(400, 'Enter the city they want to work in', 'city');
  if (!String(b.source || '').trim()) throw httpError(400, 'Pick where this candidate came from', 'source');
  const business = L.cleanBusiness(b.exp_business);
  if (b.experience && b.experience !== 'Fresher' && !business.length) throw httpError(400, 'Tick where they have worked: wholesaler, manufacturer or retailer', 'exp_business');
  const month = (v) => (v === '' || v === undefined || v === null ? null : Number(v) * 12);
  const d = {
    name: b.name, whatsapp: b.whatsapp, email: String(b.email || '').trim(), city: b.city, state: b.state, work_cities: [b.city],
    job_wanted: b.job_wanted === 'Other' ? b.job_other : b.job_wanted, industry: b.industry,
    exp_total: b.experience in L.EXP_YEARS ? L.EXP_YEARS[b.experience] : b.exp_total ?? null,
    exp_jewellery: b.exp_jewellery in L.JEW_YEARS ? L.JEW_YEARS[b.exp_jewellery] : null, exp_business: business,
    cur_salary: b.cur_salary_month !== undefined ? month(b.cur_salary_month) : b.cur_salary, exp_salary: b.exp_salary_month !== undefined ? month(b.exp_salary_month) : b.exp_salary,
    notice_days: b.notice_days ?? null,
  };
  // Unticked consent: the candidate gets a consent request and no job alerts until they agree.
  const r = L.intakeCandidate(d, { source: b.source || `Created by ${ctx.actor.label}`, by: ctx.actor, ...(b.consent !== undefined ? { consent: !!b.consent } : {}) });
  if (r.isNew && !r.candidate.agency_id) update('candidates', r.candidate.id, { agency_id: ctx.user.agency_id, recruiter_id: ctx.user.id, is_new: 0 });
  if (b.cv && b.cv.base64) {
    try {
      const f = await F.saveFile({ recordId: r.candidate.id, type: 'cv', name: b.cv.name, base64: b.cv.base64, by: ctx.actor.label });
      update('candidates', r.candidate.id, { cv_file: String(f.id) }); require('./cvparse').fillCandidate(r.candidate.id, b.cv.name, b.cv.base64, ctx.actor.label);
    } catch (e) { insert('notes', { record_id: r.candidate.id, text: `CV not saved: ${e.message}`, author: ctx.actor.label, at: now() }); }
  }
  return { id: r.candidate.id, isNew: r.isNew };
});
// ---------- candidates from resumes ----------
// Read one CV: the details found, and whether this person is already in the portal (same WhatsApp or email).
route('POST', '/api/candidates/cv-read', T, async (ctx) => {
  const b = ctx.body || {};
  if (!b.base64 || !/\.(pdf|docx|txt)$/i.test(String(b.name || ''))) return { fields: {}, readable: false, why: 'Only PDF, Word (.docx) or text CVs can be read.' };
  const buf = Buffer.from(String(b.base64).replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.length > 10 * 1024 * 1024) throw httpError(400, 'The file is bigger than 10 MB.');
  let fields = {}; try { fields = require('./cvparse').read(b.name, buf); } catch { /* unreadable */ }
  // With an AI key, the AI reads the resume too; its answers win where it found something.
  const LLM = require('./llm');
  if (LLM.available()) {
    try {
      const text = require('./cvparse').cvText(b.name, buf);
      if (text && text.trim().length > 40) {
        const ai = await LLM.extractCandidate({ resume: text });
        const pick = { name: ai.name, whatsapp: String(ai.whatsapp || '').replace(/\D/g, '').slice(-10), email: ai.email, city: ai.city, state: ai.state, job_wanted: ai.job_wanted, exp_total: ai.exp_total, current_company: ai.current_company, skills: ai.skills };
        for (const [k, v] of Object.entries(pick)) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) fields[k] = v;
        fields.ai = true;
      }
    } catch { /* the rules' answer stands */ }
  }
  const readable = Object.keys(fields).length > 0;
  const same = (fields.whatsapp && get('SELECT id, name FROM candidates WHERE whatsapp=? AND merged_into IS NULL AND removed=0', fields.whatsapp)) || (fields.email && get('SELECT id, name FROM candidates WHERE lower(email)=lower(?) AND merged_into IS NULL AND removed=0', fields.email)) || null;
  return { fields, readable, why: readable ? '' : 'No text found: a scanned or photo CV. Type the details.', existing: same };
});
// Create (or update, when the WhatsApp number is already known) one candidate from a CV, keep the CV on them, and
// optionally add them to a job. No message goes to the candidate.
route('POST', '/api/candidates/from-cv', T, async (ctx) => {
  const b = ctx.body || {}; const v = b.fields || {};
  if (!String(v.name || '').trim()) throw httpError(400, 'Enter the name', 'name');
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v.email).trim())) throw httpError(400, 'Enter a valid email, or leave it empty', 'email');
  const num = (x) => (x === '' || x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(x));
  const d = { name: String(v.name).trim(), whatsapp: v.whatsapp || '', email: String(v.email || '').trim(), city: v.city || '', state: v.state || '', work_cities: v.city ? [v.city] : [], job_wanted: v.job_wanted || '', exp_total: num(v.exp_total), current_company: v.current_company || '', skills: Array.isArray(v.skills) ? v.skills : [] };
  const phone = String(d.whatsapp).replace(/\D/g, '').slice(-10);
  const r = L.intakeCandidate(d, { source: b.source || 'Resume upload', by: ctx.actor, consent: false, silent: true, allowNoPhone: true, needsCheck: phone ? null : 'No phone found' });
  if (r.isNew && !r.candidate.agency_id) update('candidates', r.candidate.id, { agency_id: ctx.user.agency_id, recruiter_id: ctx.user.id, is_new: 0 });
  if (b.cv && b.cv.base64) {
    try {
      const fl = await F.saveFile({ recordId: r.candidate.id, type: 'cv', name: b.cv.name, base64: b.cv.base64, by: ctx.actor.label });
      update('candidates', r.candidate.id, { cv_file: String(fl.id) }); require('./cvparse').fillCandidate(r.candidate.id, b.cv.name, b.cv.base64, ctx.actor.label);
    } catch (e) { insert('notes', { record_id: r.candidate.id, text: `CV not saved: ${e.message}`, author: ctx.actor.label, at: now() }); }
  }
  let application = null; let appError = '';
  if (b.job_id) {
    const j = get('SELECT * FROM jobs WHERE id=?', b.job_id);
    if (!j || !seeJob(ctx.user, j)) appError = 'You cannot add to that job';
    else { try { application = L.createApplication(r.candidate.id, j.id, ctx.actor, b.source || 'Resume upload', 'Added from a resume').id; } catch (e) { appError = e.message; } }
  }
  return { id: r.candidate.id, isNew: r.isNew, name: d.name, application, appError };
});
route('GET', '/api/candidates/:id', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', L.resolveId(ctx.params.id)); if (!c) throw httpError(404, 'Candidate not found');
  const u = ctx.user; const show = R.phoneVisible(u, c);
  const apps = all('SELECT * FROM applications WHERE candidate_id=? ORDER BY created_at DESC', c.id).map(V.appView);
  const msgs = seeThread(u, 'candidate', c.id) ? all("SELECT * FROM messages WHERE person_type='candidate' AND person_id=? ORDER BY at DESC LIMIT 30", c.id) : [];
  if (c.is_new) update('candidates', c.id, { is_new: 0 }); // opened, so no longer new
  return {
    ...candidateOut(u, c), status: V.candStatus(c.id), job_status: L.jobStatusOf(c, L.appStateOf(c.id)), apps, messages: msgs, rating: L.ratingOf(c.id), can_message: seeThread(u, 'candidate', c.id) || isSuper(u),
    verify: require('./verify').badge(c.id),
    ad_plan: L.adPlanFor(c.id),
    job_matches: L.jobsFor(c, 20).filter((m) => seeJob(u, m.j)).slice(0, 6).map((m) => ({ id: m.j.id, title: m.j.title, city: m.j.city, client_name: (get('SELECT company FROM clients WHERE id=?', m.j.client_id) || {}).company, score: m.score, reasons: m.reasons, gaps: m.gaps })),
    files: show ? all('SELECT * FROM files WHERE record_id=? AND replaced=0 ORDER BY at DESC', c.id) : all("SELECT * FROM files WHERE record_id=? AND replaced=0 AND type IN ('cv','short_cv') ORDER BY at DESC", c.id),
    // History tab: every application, open or closed, with its screening, interviews (results and notes), calls and steps.
    track: apps.map((a) => ({ id: a.id, job_id: a.job_id, job_title: a.job_title, client_name: a.client_name, step: a.step, result: a.result, created_at: a.created_at, screen: a.screen, screen_note: a.screen_note, screen_by: a.screen_by, screen_at: a.screen_at, offer_ctc: a.offer_ctc, joining_date: a.joining_date,
      interviews: (a.interviews || []).map((i) => ({ id: i.id, name: i.name, round: i.round, mode: i.mode, mode_label: i.mode_label, at: i.at, status: i.status, result: i.result, rating: i.rating, remark: i.remark, interviewer: i.interviewer, notes: all('SELECT author, author_kind, text, at FROM iv_notes WHERE iv_id=? ORDER BY at', i.id) })),
      calls: all("SELECT * FROM calls WHERE app_id=? AND status='Done' ORDER BY at", a.id), steps: all("SELECT at, step, by, note, kind FROM app_history WHERE app_id=? ORDER BY at, id", a.id) })),
    story: L.candidateStory(c.id), known: L.candidateKnown(c), eval_criteria: D.settings().eval_criteria || [],
    notes: all('SELECT * FROM notes WHERE record_id=? ORDER BY at DESC', c.id), calls: all("SELECT * FROM calls WHERE candidate_id=? AND status='Done' ORDER BY at DESC LIMIT 200", c.id), call_outcomes: L.CALL_OUTCOMES,
    iv_notes: all('SELECT n.*, i.name iv_name, i.mode, i.at iv_at FROM iv_notes n JOIN interviews i ON i.id=n.iv_id WHERE n.candidate_id=? ORDER BY n.at DESC', c.id), consents: all("SELECT * FROM consents WHERE person_type='candidate' AND person_id=? ORDER BY at DESC", c.id),
    tieup: c.tieup_id ? get('SELECT * FROM tieups WHERE id=?', c.tieup_id) : null, referral_link: L.link('apply', `?ref=${c.id}`), agency_name: V.agencyName(c.agency_id), recruiter_name: V.userName(c.recruiter_id),
  };
});
route('PATCH', '/api/candidates/:id', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.params.id); if (!c) throw httpError(404, 'Not found');
  if (!R.phoneVisible(ctx.user, c)) throw httpError(403, 'Only the candidate\'s own agency can edit this profile.');
  if (ctx.body.exp_business !== undefined) ctx.body.exp_business = L.cleanBusiness(ctx.body.exp_business);
  const allowed = ['exp_business', 'name', 'whatsapp', 'email', 'city', 'state', 'work_cities', 'industry', 'domain', 'job_wanted', 'exp_total', 'exp_jewellery', 'cur_salary', 'exp_salary', 'notice_days', 'skills', 'current_company', 'looking', 'tieup_id', 'archived', 'recruiter_id', 'language'];
  const patch = {}; for (const k of allowed) if (ctx.body[k] !== undefined) patch[k] = ctx.body[k];
  if (patch.language !== undefined) patch.language = require('./lang').pick(patch.language);
  if (patch.looking && !L.LOOKING.includes(patch.looking)) throw httpError(400, 'Pick a looking status', 'looking');
  // An answer from the team for the candidate: saved with today's date (not interested keeps them out of matching)
  if (patch.looking === '' || patch.looking === null) { if (c.looking) { patch.looking = null; patch.looking_at = null; } else delete patch.looking; }
  else if (patch.looking && patch.looking === c.looking) delete patch.looking; // unchanged: the date they said it stays
  else if (patch.looking) { patch.looking_at = now(); patch.not_interested_at = patch.looking === 'Not interested' ? (c.not_interested_at || now()) : null; }
  if (patch.whatsapp) { patch.whatsapp = L.digits10(patch.whatsapp); if (!L.validPhone(patch.whatsapp)) throw httpError(400, 'Enter a 10-digit WhatsApp number', 'whatsapp'); }
  if (patch.job_wanted) patch.department = L.deptOf(patch.job_wanted);
  Object.assign(patch, L.cleanPrefs(ctx.body));
  patch.last_updated = now();
  if (isSuper(ctx.user) && ctx.body.agency_id !== undefined) patch.agency_id = ctx.body.agency_id;
  return D.edit('candidates', c.id, patch, ctx.actor.label, ctx.ip);
});
// A structured view of the candidate, saved each time so earlier ones stay. The last one opens ready to update.
route('POST', '/api/candidates/:id/evaluation', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.params.id); if (!c) throw httpError(404, 'Candidate not found'); const b = ctx.body || {}; const known = D.settings().eval_criteria || [];
  const scores = Object.fromEntries(Object.entries(b.scores || {}).filter(([k, v]) => known.includes(k) && ['Strong', 'OK', 'Weak', 'N/A'].includes(v))); const note = String(b.note || '').trim();
  if (!Object.values(scores).some((v) => v !== 'N/A')) throw httpError(400, 'Mark at least one point', 'scores');
  const a = b.app_id ? get('SELECT * FROM applications WHERE id=? AND candidate_id=?', b.app_id, c.id) : null;
  insert('evaluations', { candidate_id: c.id, app_id: a ? a.id : null, scores, note, by: ctx.actor.label, at: now() });
  // What is not relevant for this job is remembered on the job, so the next candidate's form starts with it set.
  if (a) { const j = get('SELECT * FROM jobs WHERE id=?', a.job_id); const na = new Set(j.eval_na || []); for (const [k, v] of Object.entries(scores)) { if (v === 'N/A') na.add(k); else na.delete(k); } update('jobs', j.id, { eval_na: [...na] }); }
  return { ok: true };
});
// The copy with phone and email taken out, for reading or sharing inside the team.
route('POST', '/api/candidates/:id/hidden-cv', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.params.id); if (!c) throw httpError(404, 'Candidate not found'); if (!c.cv_file) throw httpError(400, 'No resume uploaded yet.');
  return require('./flow').clientCvFor(c.id, ctx.actor);
});
// Someone in Sales who now wants HR: the role they want changes, their past work stays, and HR searches find them.
route('POST', '/api/candidates/:id/map-role', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.params.id); if (!c) throw httpError(404, 'Candidate not found'); const b = ctx.body || {}; const u = ctx.user;
  if (!(isSuper(u) || (c.agency_id && c.agency_id === u.agency_id) || all('SELECT * FROM applications WHERE candidate_id=?', c.id).some((a) => seeApp(u, a)))) throw httpError(404, 'Candidate not found');
  const role = String(b.role === 'Other' ? b.other || '' : b.role || '').trim(); const note = String(b.note || '').trim(); if (!role) throw httpError(400, 'Pick the new role', 'role'); if (!note) throw httpError(400, 'Say why the role is changing', 'note');
  const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase(); if (same(role, c.job_wanted)) throw httpError(400, 'This is already their role', 'role');
  const also = (c.also_roles || []).filter((x) => !same(x, role)); if (b.keep && c.job_wanted && !also.some((x) => same(x, c.job_wanted))) also.push(c.job_wanted);
  D.edit('candidates', c.id, { job_wanted: role, department: L.deptOf(role), also_roles: also, last_updated: now() }, ctx.actor.label, ctx.ip);
  const line = `Role changed from ${c.job_wanted || 'none'} to ${role}${b.keep ? ` (still open to ${c.job_wanted})` : ''}: ${note}`; insert('notes', { record_id: c.id, text: line, author: ctx.actor.label, at: now() });
  const a = b.app ? get('SELECT * FROM applications WHERE id=? AND candidate_id=?', b.app, c.id) : null; if (a) L.appHist(a.id, a.step, ctx.actor, line, 'interview');
  const fresh = get('SELECT * FROM candidates WHERE id=?', c.id); return { ok: true, jobs: L.jobsForRole(role, {}).filter((j) => seeJob(u, j)).slice(0, 5).map((j) => ({ id: j.id, title: j.title, city: j.city })), also_roles: fresh.also_roles };
});
route('POST', '/api/candidates/:id/ask', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', L.resolveId(ctx.params.id)); if (!c) throw httpError(404, 'Candidate not found');
  const what = ctx.body.what; const PL = require('./profilelink');
  const r = what === 'experience' ? PL.askExperience(c.id, ctx.actor, false) : PL.ask(c.id, ctx.actor, false);
  if (r && r.skipped) throw httpError(400, `Not sent: ${r.skipped}`); return { ok: true };
});
route('POST', '/api/candidates/bulk', T, (ctx) => {
  const { ids, action, job_id } = ctx.body; const out = { done: 0, errors: [] };
  if (action === 'add_to_job') {
    const j = get('SELECT * FROM jobs WHERE id=?', job_id); mustSee(seeJob(ctx.user, j) || R.sameAgency(ctx.user, j), 'job opening');
    for (const id of ids) { try { L.createApplication(id, job_id, ctx.actor, null, 'Added from resume bank'); out.done++; } catch (e) { out.errors.push(`${id}: ${e.message}`); } }
  } else if (action === 'ask_profile') { // resume & details request to the ticked candidates (those still missing something)
    for (const id of ids.slice(0, D.settings().bulk_budget)) { const r = require('./profilelink').ask(id, ctx.actor, false); if (r && r.skipped) out.errors.push(`${id}: ${r.skipped}`); else out.done++; }
  } else if (action === 'ask_experience') { // total experience question on WhatsApp; the tap saves it
    for (const id of ids.slice(0, D.settings().bulk_budget)) { const r = require('./profilelink').askExperience(L.resolveId ? L.resolveId(id) : id, ctx.actor, true); if (r && r.skipped) out.errors.push(`${id}: ${r.skipped}`); else out.done++; }
  } else if (action === 'ask_status') { // the job status question on WhatsApp; their tap sets the status
    const states = L.appStates();
    for (const id of ids.slice(0, D.settings().bulk_budget)) { const c = get('SELECT * FROM candidates WHERE id=?', L.resolveId(id)); if (!c) { out.errors.push(`${id}: not found`); continue; }
      const js = L.jobStatusOf(c, states.get(c.id)); if (js.endsWith('BBHS')) { out.errors.push(`${c.id}: ${js}, no need to ask`); continue; }
      const r = L.sendWA({ ptype: 'candidate', pid: c.id, format: 'bbhs_still_looking', vars: { link: L.link('my-profile') }, by: ctx.actor, bulk: true, dedupe: `status:${c.id}:${L.istDay()}` }); if (r.skipped) out.errors.push(`${c.id}: ${r.skipped}`); else out.done++; }
  } else if (action === 'alert') {
    const j = get('SELECT * FROM jobs WHERE id=?', job_id); if (!j) throw httpError(400, 'Pick a job');
    for (const id of ids.slice(0, D.settings().bulk_budget)) { const r = L.sendWA({ ptype: 'candidate', pid: id, format: 'bbhs_job_alert', vars: { job: j.title, city: j.city, salary: L.SAL_HIDDEN }, jb: j.id, by: ctx.actor, bulk: true, dedupe: `alert:${j.id}:${id}` }); if (r.skipped) out.errors.push(`${id}: ${r.skipped}`); else out.done++; }
  } else return bulkUpdate(ctx, out);
  return out;
});
// Bulk changes to the ticked candidates. Everyone in the team can set the looking status, add a note or a follow-up;
// admins (and the super admin) can also assign a recruiter and archive. Only the candidate's own agency changes a
// candidate (the super admin changes any); the rest are listed as skipped.
function bulkUpdate(ctx, out) {
  const u = ctx.user; const b = ctx.body; const ids = [...new Set((b.ids || []).map(String))].slice(0, 500);
  if (!ids.length) throw httpError(400, 'Tick some candidates first');
  const adminOnly = ['assign', 'archive', 'unarchive'];
  if (!['set_looking', 'note', 'followup', ...adminOnly].includes(b.action)) throw httpError(400, 'Unknown action');
  if (b.action === 'set_looking' && !L.LOOKING.includes(b.looking)) throw httpError(400, 'Pick a looking status', 'looking');
  if (b.action === 'note' && !String(b.text || '').trim()) throw httpError(400, 'Write the note', 'text');
  let when = null; if (b.action === 'followup') { when = new Date(b.at); if (!b.at || Number.isNaN(when.getTime())) throw httpError(400, 'Pick the date and time', 'at'); }
  let rec = null;
  if (b.action === 'assign') {
    rec = get("SELECT * FROM users WHERE id=? AND status='On' AND level!='super'", b.recruiter_id); if (!rec) throw httpError(400, 'Pick a recruiter', 'recruiter_id');
    if (!isSuper(u) && rec.agency_id !== u.agency_id) throw httpError(403, 'Pick someone from your own agency', 'recruiter_id');
  }
  for (const id of ids) {
    const c = get('SELECT * FROM candidates WHERE id=? AND removed=0', L.resolveId(id)); if (!c) { out.errors.push(`${id}: not found`); continue; }
    const own = isSuper(u) || (c.agency_id && c.agency_id === u.agency_id);
    if (b.action !== 'note' && b.action !== 'followup' && !own) { out.errors.push(`${c.id}: another agency's candidate`); continue; }
    if (b.action === 'set_looking') L.setLooking(c.id, b.looking, ctx.actor, 'set by the team');
    else if (b.action === 'note') { insert('notes', { record_id: c.id, text: String(b.text).trim(), author: ctx.actor.label, at: now() }); D.history(ctx.actor.label, 'note', c.id); }
    else if (b.action === 'followup') insert('followups', { record_id: c.id, at: when.toISOString(), note: String(b.note || '').trim(), for_user: u.id, done: 0, created_by: u.id });
    else if (b.action === 'assign') {
      if (c.agency_id && c.agency_id !== rec.agency_id) { out.errors.push(`${c.id}: belongs to another agency`); continue; }
      D.edit('candidates', c.id, { recruiter_id: rec.id, agency_id: rec.agency_id, is_new: 0 }, ctx.actor.label, ctx.ip);
    } else D.edit('candidates', c.id, { archived: b.action === 'archive' ? 1 : 0 }, ctx.actor.label, ctx.ip);
    out.done++;
  }
  if (b.action === 'assign' && out.done && rec.id !== u.id) L.alertUser(rec.id, `${out.done} candidate${out.done === 1 ? '' : 's'} assigned to you by ${u.name}`, null, 'leads');
  D.history(ctx.actor.label, `bulk ${b.action}`, null, 'candidates', null, `${out.done} done, ${out.errors.length} skipped`, null, ctx.ip);
  return out;
}
route('GET', '/api/gap', T, (ctx) => {
  const s = D.settings(); const cities = s.cities.map((c) => c.name); const depts = s.departments;
  const grid = {};
  for (const c of all("SELECT city, department, work_cities FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0 AND archived=0 AND looking IN ('Actively looking','Open to offers')")) {
    const key = `${c.city}|${c.department}`; grid[key] = (grid[key] || 0) + 1;
  }
  return { cities, depts, grid, targets: s.gap_targets || {} };
});
// Target count for one city × department box of the gap view (empty clears it).
route('POST', '/api/gap/target', T, (ctx) => {
  const { cell, target } = ctx.body; if (!cell || !cell.includes('|')) throw httpError(400, 'Pick a box');
  const t = { ...(D.settings().gap_targets || {}) }; const n = Number(target);
  if (!target || !n) delete t[cell]; else t[cell] = Math.round(n);
  D.setSetting('gap_targets', t); D.history(ctx.actor.label, 'gap target', null, cell, null, target || 'cleared'); return { ok: true };
});
route('GET', '/api/tieups', T, () => all('SELECT t.*, (SELECT COUNT(*) FROM candidates c WHERE c.tieup_id=t.id) AS candidates FROM tieups t ORDER BY name').map((t) => ({ ...t, owner_name: V.userName(t.owner_id) })));
for (const col of ['email TEXT', 'designation TEXT', 'tieup_date TEXT', 'roles TEXT', 'shared_count INTEGER', 'note TEXT']) { try { D.db.exec(`ALTER TABLE tieups ADD COLUMN ${col}`); } catch { /* already there */ } }
route('POST', '/api/tieups', T, (ctx) => {
  const b = ctx.body; const t = (k) => String(b[k] ?? '').trim();
  if (!t('name')) throw httpError(400, t('type') === 'Individual agent' ? 'Enter the agent\'s name' : 'Enter the name of the college or institute', 'name');
  if (t('type') === 'Individual agent' && !t('phone')) throw httpError(400, 'An agent needs a WhatsApp number: their resumes come from it', 'phone');
  if (!t('city')) throw httpError(400, 'Enter the city', 'city');
  if (t('email') && !L.EMAIL_RE.test(t('email'))) throw httpError(400, 'Enter a valid email ID, or leave it empty', 'email');
  if (t('phone') && !L.validPhone(L.digits10(t('phone')))) throw httpError(400, 'Enter a 10-digit mobile number, or leave it empty', 'phone');
  if (t('shared_count') && !(Number(t('shared_count')) >= 0)) throw httpError(400, 'Enter how many candidates as a number', 'shared_count');
  const rec = { name: t('name'), type: t('type') || 'College', city: t('city'), contact: t('contact'), designation: t('designation'), phone: L.digits10(t('phone')) || '', email: t('email'), tieup_date: t('tieup_date') || null, roles: t('roles'), shared_count: t('shared_count') ? Math.round(Number(t('shared_count'))) : null, last_list: t('last_list') || null, note: t('note'), region: t('region'), rate: t('rate') ? Math.max(0, Math.round(Number(t('rate')) || 0)) : null };
  if (b.id) { D.edit('tieups', b.id, rec, ctx.actor.label); return { id: b.id }; }
  if (get('SELECT 1 FROM tieups WHERE lower(name)=lower(?) AND lower(city)=lower(?)', rec.name, rec.city)) throw httpError(409, `${rec.name}, ${rec.city} is already a tie-up.`, 'name');
  const r = D.run('INSERT INTO tieups (name,type,city,contact,phone,owner_id,last_list,email,designation,tieup_date,roles,shared_count,note,region,rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', rec.name, rec.type, rec.city, rec.contact, rec.phone, b.owner_id || ctx.user.id, rec.last_list, rec.email, rec.designation, rec.tieup_date, rec.roles, rec.shared_count, rec.note, rec.region, rec.rate);
  D.history(ctx.actor.label, 'create', `TU-${r.lastInsertRowid}`, null, null, b.name); return { id: Number(r.lastInsertRowid) };
});
// ---------- segments (saved candidate searches) ----------
// A segment is a named set of resume-bank filters. Its owner sees it; shared ones are seen by the whole team.
// The list of people is worked out again each time, so counts and downloads are always current.
const SEG_KEYS = ['q', 'industry', 'domain', 'skills', 'skillgroup', 'worked', 'biz', 'cv', 'company', 'dept', 'job', 'city', 'state', 'ad', 'jewellery', 'from', 'to', 'exp_min', 'exp_max', 'sal_min', 'sal_max', 'looking', 'status', 'source', 'updated', 'notice', 'stale', 'archived'];
const segQuery = (raw) => { const q = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; return Object.fromEntries(SEG_KEYS.filter((k) => q[k] !== undefined && q[k] !== null && q[k] !== '').map((k) => [k, String(q[k])])); };
const segVisible = (u) => all('SELECT s.*, us.name AS owner_name FROM saved_searches s LEFT JOIN users us ON us.id=s.user_id WHERE s.user_id=? OR s.shared=1 ORDER BY s.name COLLATE NOCASE', u.id);
function segOwn(ctx) {
  const s = get('SELECT * FROM saved_searches WHERE id=?', Number(ctx.params.id)); if (!s) throw httpError(404, 'Segment not found');
  if (s.user_id !== ctx.user.id && !s.shared) throw httpError(404, 'Segment not found');
  return s;
}
const canEditSeg = (u, s) => s.user_id === u.id || isSuper(u);
route('GET', '/api/saved-searches', T, (ctx) => segVisible(ctx.user).map((s) => ({ id: s.id, name: s.name, query: JSON.stringify(segQuery(s.query)), shared: s.shared })));
route('POST', '/api/saved-searches', T, (ctx) => {
  const b = ctx.body; const name = String(b.name || '').trim(); if (!name) throw httpError(400, 'Give the segment a name', 'name');
  const q = segQuery(b.query); const t = D.now();
  const r = D.run('INSERT INTO saved_searches (user_id,name,query,shared,created_at,updated_at) VALUES (?,?,?,?,?,?)', ctx.user.id, name, JSON.stringify(q), b.shared ? 1 : 0, t, t);
  D.history(ctx.actor.label, 'create', `SEG-${r.lastInsertRowid}`, null, null, name); return { ok: true, id: Number(r.lastInsertRowid) };
});
route('GET', '/api/segments', T, (ctx) => ({
  segments: segVisible(ctx.user).map((s) => { const q = segQuery(s.query); return { id: s.id, name: s.name, query: q, count: candRows(q, ctx.user).length, shared: !!s.shared, owner: s.owner_name || s.user_id, mine: s.user_id === ctx.user.id, can_edit: canEditSeg(ctx.user, s), updated_at: s.updated_at || s.created_at }; }),
  can_download: isSuper(ctx.user),
}));
route('PATCH', '/api/segments/:id', T, (ctx) => {
  const s = segOwn(ctx); if (!canEditSeg(ctx.user, s)) throw httpError(403, 'Only the person who made this segment can change it.');
  const b = ctx.body; const patch = { updated_at: D.now() };
  if (b.name !== undefined) { patch.name = String(b.name).trim(); if (!patch.name) throw httpError(400, 'Give the segment a name', 'name'); }
  if (b.shared !== undefined) patch.shared = b.shared ? 1 : 0;
  if (b.query !== undefined) patch.query = JSON.stringify(segQuery(b.query));
  update('saved_searches', s.id, patch); return { ok: true };
});
route('POST', '/api/segments/:id/delete', T, (ctx) => {
  const s = segOwn(ctx); if (!canEditSeg(ctx.user, s)) throw httpError(403, 'Only the person who made this segment can delete it.');
  D.run('DELETE FROM saved_searches WHERE id=?', s.id); D.history(ctx.actor.label, 'delete', `SEG-${s.id}`, null, s.name, null); return { ok: true };
});
// The people in a segment, as an Excel file named after it (super admin only, like every candidate download).
route('GET', '/api/segments/:id/candidates', T, (ctx) => {
  const s = segOwn(ctx); const rows = candRows(segQuery(s.query), ctx.user);
  const slug = String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `segment-${s.id}`;
  return page(ctx, rows, `segment-${slug}`, [...CAND_EXPORT, 'status']);
});

// ---------- Excel import ----------
// The client leads template: the same columns as Quick add lead, with one example row (skipped on upload).
route('GET', '/api/import/template/leads', T, () => {
  const head = I.FIELDS.leads.map(([, label]) => label);
  const ex = { company: 'EXAMPLE – delete this row', name: 'Ramesh Soni', phone: '9876543210', email: 'owner@example.com', hr_email: 'hr@example.com', city: 'Jaipur', business_type: 'Showroom B2C', need: 'Hiring now', roles: 'Sales Executive x 2, Cashier x 1', source: 'Referral', poc_name: 'Neha Jain', poc_role: 'HR manager', poc_email: 'neha@example.com', poc_whatsapp: '9876500000', note: 'Met at the trade fair' };
  return { __file: { name: 'client-leads-template.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: F.toXLSX([head, I.FIELDS.leads.map(([k]) => ex[k] || '')], 'Client leads') } };
});
route('POST', '/api/import/preview', T, (ctx) => {
  const { kind, name, base64, source } = ctx.body; if (!I.FIELDS[kind]) throw httpError(400, 'Pick what you are uploading');
  const rows = F.readSpreadsheet(name, base64); if (!rows.length) throw httpError(400, 'The file has no rows.');
  const headers = rows[0].map(String);
  const saved = get('SELECT map FROM column_maps WHERE source=?', `${kind}:${source || ''}`);
  return { headers, sample: rows.slice(1, 11), total: rows.length - 1, map: saved ? saved.map : I.guessMap(kind, headers), fields: I.FIELDS[kind].map(([k, label]) => ({ key: k, label })), saved: !!saved };
});
route('POST', '/api/import/run', T, (ctx) => {
  const { kind, name, base64, source, map, tieup_id } = ctx.body;
  const rows = F.readSpreadsheet(name, base64).slice(1);
  D.run('INSERT INTO column_maps (source,map) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET map=excluded.map', `${kind}:${source || ''}`, JSON.stringify(map));
  const res = I.runImport(kind, rows, map, { source, by: ctx.actor, tieup_id });
  if (tieup_id) update('tieups', tieup_id, { last_list: now() });
  return res;
});

// ---------- applications ----------
// Applications matching the list's filters.
function appRows(q, u) {
  const rows = visibleApps(u).map(V.appView)
    .filter((a) => (!q.job || a.job_id === q.job) && (!q.title || a.job_title === q.title || many(q.title).includes(a.job_title)) && (!q.client || a.client_id === q.client) && (!q.owner || a.owner_id === q.owner) && (!q.source || a.source === q.source) && (!q.from || L.istDay(a.created_at) >= q.from) && (!q.to || L.istDay(a.created_at) <= q.to) && (q.closed === '1' ? a.result !== 'open' : q.screen ? true : a.result === 'open') && (!q.step || a.step === q.step) && (!q.screen || (q.screen === 'none' ? !a.screen : a.screen === q.screen)) && (!q.ad || [a.ad_campaign, a.ad_set, a.ad_name].includes(q.ad)) && like(q.q, a.id, a.candidate_name, a.job_title, a.client_name, a.ad));
  return rows;
}
// Each application's fit with its job: the AI's score when it has read them, otherwise the matching rules. Best first.
function scoreApps(rows, q) {
  const flow = require('./flow'); const cands = new Map(all('SELECT * FROM candidates').map((c) => [c.id, c])); const jobs = new Map(all('SELECT * FROM jobs').map((j) => [j.id, j]));
  const out = rows.map((a) => { const c = cands.get(a.candidate_id); const j = jobs.get(a.job_id); if (!c || !j) return { ...a, score: 0, good: [], gaps: [] }; const f = flow.rowFor(j, c, L.matchScore(c, j, L.ratingOf(c.id)), {}); return { ...a, cv_file: c.cv_file || null, exp: c.exp_total, score: f.score, good: f.points || [], gaps: f.gaps || [] }; })
    .filter((a) => { if (!q.exp) return true; const e = a.exp; const band = e === null || e === undefined || e === '' ? 'none' : e < 1 ? '0-1' : e < 3 ? '1-3' : e < 5 ? '3-5' : e < 10 ? '5-10' : '10+'; return String(q.exp).split(',').includes(band); })
    .filter((a) => (q.score_min === undefined || q.score_min === '' || a.score >= Number(q.score_min)) && (q.score_max === undefined || q.score_max === '' || a.score <= Number(q.score_max)));
  return q.sort ? sortBy(out, q, ['score', 'candidate_name', 'source', 'job_title', 'step', 'days_in_step']) : [...out].sort((x, y) => y.score - x.score);
}
route('POST', '/api/applications/reject-below', T, (ctx) => {
  const b = ctx.body || {}; const n = Number(b.score); if (!(n > 0 && n <= 100)) throw httpError(400, 'Enter a score from 1 to 100', 'score');
  const f = { ...(b.filters || {}) }; delete f.sort;
  const list = scoreApps(appRows(f, ctx.user), f).filter((a) => a.result === 'open' && !a.on_hold && ['Applied', 'Screening'].includes(a.step) && a.score < n);
  if (b.dry) return { count: list.length };
  let done = 0; for (const a of list.slice(0, 500)) { try { L.screenApplication(a.id, 'Rejected', ctx.actor, `Score ${a.score}, below ${n}`); done++; } catch { /* moved on since */ } }
  D.history(ctx.actor.label, 'reject below score', null, 'score', null, `${done} below ${n}`);
  return { done };
});
route('GET', '/api/applications', T, (ctx) => {
  const q = ctx.query; let base = appRows(q, ctx.user);
  if (q.mine === '1') { const om = L.ownerMap(); base = base.filter((a) => L.ownsApp(ctx.user.id, a, om)); }
  // The stage of each open application, how many are at each (with the other filters), then the stage picked.
  for (const r of base) { r.stage = L.stageOfApp(r); r.next_stage = L.nextStageOf(r, r.stage); r.stage_state = L.stageStateOf(r, r.stage); }
  const stage_counts = Object.fromEntries(L.STAGES.map((s) => [s, base.filter((r) => r.stage === s).length]));
  // In the stage picked: how many are eligible, scheduled, waiting for feedback…
  const inStage = q.stage ? base.filter((r) => r.stage === q.stage) : base;
  const state_counts = {}; if (q.stage) for (const r of inStage) state_counts[r.stage_state] = (state_counts[r.stage_state] || 0) + 1;
  const rows = scoreApps(q.state ? inStage.filter((r) => r.stage_state === q.state) : inStage, q);
  const placed = new Set(all("SELECT candidate_id FROM applications WHERE result='Hired' AND left_date IS NULL").map((r) => r.candidate_id)); for (const r of rows) r.cand_placed = placed.has(r.candidate_id);
  // the candidate's mobile under their name (masked where this login may not see it)
  for (const r of rows) { const c = get('SELECT * FROM candidates WHERE id=?', r.candidate_id) || {}; r.phone = c.whatsapp ? (R.phoneVisible(ctx.user, c) ? c.whatsapp : R.maskPhone(c.whatsapp)) : ''; }
  const vis = visibleApps(ctx.user); const counts = { open: vis.filter((a) => a.result === 'open').length, closed: vis.filter((a) => a.result !== 'open').length, joined: vis.filter((a) => a.result === 'Hired').length };
  return { counts, stage_counts, state_counts, ...page(ctx, rows, 'applications', ['id', 'candidate_name', 'phone', 'cand_placed', 'stage', 'stage_state', 'next_stage', 'on_hold', 'exp', 'candidate_id', 'score', 'job_id', 'job_title', 'client_name', 'step', 'result', 'days_in_step', 'owner_name', 'source', 'ad', 'screen', 'screen_note']), ads: adOptions('applications'), screens: L.SCREEN.filter((x) => x !== 'Requirement not met'),
    // Choices for the filters: the jobs, clients, owners and sources these applications have.
    // Each list follows the other filters picked (a client picked: only that client's job titles, jobs, owners, sources),
    // within the open or closed tab being looked at.
    options: (() => {
      const all0 = visibleApps(ctx.user).map(V.appView).filter((a) => (q.closed === '1' ? a.result !== 'open' : a.result === 'open'));
      const keep = (a, skip) => (skip === 'client' || !q.client || a.client_id === q.client) && (skip === 'title' || !q.title || a.job_title === q.title || many(q.title).includes(a.job_title))
        && (skip === 'job' || !q.job || a.job_id === q.job) && (skip === 'owner' || !q.owner || a.owner_id === q.owner) && (skip === 'source' || !q.source || a.source === q.source);
      const pool = (skip) => all0.filter((a) => keep(a, skip));
      const uniq = (skip, f) => [...new Map(pool(skip).map(f).filter((x) => x && x[0]).map((x) => [x[0], x])).values()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      return { titles: [...new Set(pool('title').map((a) => a.job_title).filter(Boolean))].sort(), jobs: uniq('job', (a) => [a.job_id, `${a.job_title} · ${a.client_name || ''}${a.job_city ? ` · ${a.job_city}` : ''}`]), clients: uniq('client', (a) => [a.client_id, a.client_name]), owners: uniq('owner', (a) => [a.owner_id, a.owner_name]), sources: [...new Set(pool('source').map((a) => a.source).filter(Boolean))].sort() };
    })() };
});
// The hiring pipeline for the dashboard: each open job with how many of its open applications are at each stage.
route('GET', '/api/pipeline', T, (ctx) => {
  const om = L.ownerMap(); const apps = visibleApps(ctx.user).filter((a) => a.result === 'open' && (ctx.query.mine !== '1' || L.ownsApp(ctx.user.id, a, om))).map(V.appView);
  const jobs = new Map();
  for (const a of apps) {
    const st = L.stageOfApp(a); if (!L.STAGES.includes(st)) continue;
    const j = jobs.get(a.job_id) || { job_id: a.job_id, title: a.job_title, client: a.client_name, city: a.job_city, counts: Object.fromEntries(L.STAGES.map((s) => [s, 0])), total: 0, oldest: 0 };
    j.counts[st]++; j.total++; j.oldest = Math.max(j.oldest, a.days_in_step || 0); jobs.set(a.job_id, j);
  }
  const rows = [...jobs.values()].map((j) => { const jr = get('SELECT priority FROM jobs WHERE id=?', j.job_id) || {}; return { ...j, priority: jr.priority || 'Medium' }; })
    .sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.priority] ?? 1) - ({ High: 0, Medium: 1, Low: 2 }[b.priority] ?? 1) || b.total - a.total);
  const totals = Object.fromEntries(L.STAGES.map((s) => [s, rows.reduce((t, r) => t + r.counts[s], 0)]));
  return { stages: L.STAGES, rows, totals };
});
route('GET', '/api/board', T, (ctx) => {
  const q = ctx.query;
  const rows = visibleApps(ctx.user).filter((a) => a.result === 'open' && (!q.job || a.job_id === q.job)).map(V.appView);
  return { steps: L.STEPS, apps: rows, jobs: visibleJobs(ctx.user).map((j) => ({ id: j.id, title: j.title, client: V.jobView(j).client_name })) };
});
route('POST', '/api/applications', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.body.job_id); mustSee(seeJob(ctx.user, j) || R.sameAgency(ctx.user, j), 'job opening');
  return L.createApplication(ctx.body.candidate_id, j.id, ctx.actor, ctx.body.source, ctx.body.note);
});
function loadApp(ctx) {
  const a = get('SELECT * FROM applications WHERE id=?', ctx.params.id); mustSee(a && seeApp(ctx.user, a), 'application'); return a;
}
// The telephonic round's call task: set or move its time (the reminder goes again at the new time).
route('POST', '/api/applications/:id/call-task', T, (ctx) => {
  const a = get('SELECT * FROM applications WHERE id=?', ctx.params.id); if (!a) throw httpError(404, 'Application not found');
  const at = ctx.body.at && !Number.isNaN(Date.parse(ctx.body.at)) ? new Date(ctx.body.at).toISOString() : null; if (!at) throw httpError(400, 'Pick the time', 'at');
  const t = get("SELECT * FROM followups WHERE record_id=? AND done=0 AND note LIKE 'Telephonic round:%' ORDER BY at LIMIT 1", a.id);
  if (t) D.update('followups', t.id, { at, alerted: 0 });
  else { const c = get('SELECT name FROM candidates WHERE id=?', a.candidate_id) || {}; const j = get('SELECT title, recruiter_id FROM jobs WHERE id=?', a.job_id) || {}; const owner = a.owner_id || j.recruiter_id || ctx.user.id; D.insert('followups', { record_id: a.id, at, note: `Telephonic round: call ${c.name} for ${j.title}.`, for_user: owner, done: 0, created_by: ctx.user.id }); }
  L.appHist(a.id, a.step, ctx.actor, `Call time set: ${L.istFmt(at)}`, 'call');
  return { ok: true, at };
});
route('GET', '/api/applications/:id', T, (ctx) => {
  const a = loadApp(ctx); const v = V.appView(a);
  const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const cand = get('SELECT * FROM candidates WHERE id=?', a.candidate_id); const client = get('SELECT * FROM clients WHERE id=?', job.client_id);
  const bill = get('SELECT * FROM bills WHERE app_id=? AND credit_of IS NULL ORDER BY created_at DESC', a.id);
  return {
    ...v, candidate: candidateOut(ctx.user, cand), cv_name: cand.cv_file ? (get('SELECT name FROM files WHERE id=?', cand.cv_file) || {}).name || '' : '', story: L.candidateStory(a.candidate_id), known: L.candidateKnown(cand), eval_criteria: D.settings().eval_criteria || [], eval_na: job.eval_na || [], rounds: L.roundsOf(a), other_apps: all('SELECT * FROM applications WHERE candidate_id=? AND id<>? ORDER BY created_at DESC', a.candidate_id, a.id).filter((x) => R.seeApp(ctx.user, x)).map(V.appView).map((x) => ({ id: x.id, job_title: x.job_title, client_name: x.client_name, step: x.step, result: x.result })), slot_ask: get("SELECT * FROM slot_asks WHERE app_id=? AND status<>'Cancelled' ORDER BY id DESC LIMIT 1", a.id) || null, questions: get('SELECT * FROM app_questions WHERE app_id=?', a.id) || null, prep: get('SELECT * FROM app_prep WHERE app_id=?', a.id) || null, job: V.jobView(job), client: { id: client.id, company: client.company, contact: client.contact },
    history: all('SELECT * FROM app_history WHERE app_id=? ORDER BY at DESC, id DESC', a.id), messages: all('SELECT * FROM messages WHERE ap=? ORDER BY at DESC', a.id),
    score: (() => { const m = L.matchScore(cand, job, L.ratingOf(cand.id)); const f = require('./flow').rowFor(job, cand, m, {}); return { ...m, score: f.score, reasons: f.points, gaps: f.gaps }; })(), bill: bill ? L.billView(bill) : null, suggest: suggestFor(a), steps: L.STEPS, selected: !!get("SELECT 1 FROM interviews WHERE app_id=? AND result='Selected'", a.id), next: require('./flow').nextStep(a, bill), client_cv: cand.short_cv_file || null,
    files: all('SELECT * FROM files WHERE record_id=? AND replaced=0 ORDER BY at DESC', a.id), notes: all('SELECT * FROM notes WHERE record_id=? ORDER BY at DESC', a.id),
    calls: all("SELECT * FROM calls WHERE app_id=? AND status='Done' ORDER BY at DESC LIMIT 200", a.id), call_outcomes: L.CALL_OUTCOMES, client_city: client.city,
    checklist_items: D.settings().templates.joining_checklist.split('\n').filter(Boolean),
    replacement_window: (client.replacement_days || D.settings().replacement_days), care: a.result === 'Hired' ? require('./care').forApp(a) : null, verify: require('./verify').badge(a.candidate_id), placed_on: ((p) => (p && p.id !== a.id ? p.id : null))(L.placedOn(a.candidate_id)),
    call_plan: { task: get("SELECT f.id, f.at, u.name owner FROM followups f LEFT JOIN users u ON u.id=f.for_user WHERE f.record_id=? AND f.done=0 AND f.note LIKE 'Telephonic round:%' ORDER BY f.at LIMIT 1", a.id) || null, asked: get("SELECT at, status FROM messages WHERE person_type='candidate' AND person_id=? AND format='bbhs_contact_prefs' ORDER BY at DESC LIMIT 1", a.candidate_id) || null },
  };
});
// Suggested next WhatsApp message by step (8.3).
function suggestFor(a) {
  const iv = get("SELECT * FROM interviews WHERE app_id=? AND status IN ('Scheduled','Rescheduled') ORDER BY at", a.id);
  if (a.result === 'Hired') return { ptype: 'candidate', format: 'bbhs_post_join_checkin', label: 'Check-in with the new hire' };
  if (a.result !== 'open') return null;
  if (iv) return { ptype: 'candidate', format: 'bbhs_interview_reminder', label: 'Interview reminder', iv: iv.id };
  switch (a.step) {
    case 'Applied': case 'Screening': return { ptype: 'candidate', format: 'bbhs_details_request', label: 'Ask salary and notice' };
    case 'Our interview': return { ptype: 'candidate', format: 'bbhs_interview_reminder', label: 'Interview reminder' };
    case 'Sent to client': return { ptype: 'client', format: 'bbhs_shortlist_ready', label: 'Profiles ready' };
    case 'Client interview': return { ptype: 'client', format: 'bbhs_feedback_request', label: 'Ask the client for feedback' };
    case 'Offer made': return { ptype: 'candidate', format: 'bbhs_offer', label: 'Send the offer' };
    case 'Offer accepted': return { ptype: 'candidate', format: 'bbhs_joining_reminder', label: 'Joining reminder' };
    default: return null;
  }
}
route('POST', '/api/applications/:id/step', T, (ctx) => {
  const a = loadApp(ctx);
  const step = ctx.body.next ? L.STEPS[Math.min(L.STEPS.length - 1, L.stepIdx(a.step) + 1)] : ctx.body.step;
  if (step === 'Joined' && a.step !== 'Offer accepted' && !ctx.body.force) throw httpError(400, 'Mark Joined after the offer is accepted.');
  if (L.needsCall(a, step, ctx.user)) throw httpError(400, 'Log a call on this application first: every step needs its call on record.', 'call');
  if (!ctx.body.force || ctx.body.rounds) L.passRounds(a.id, step, ctx.body.skip_reason, ctx.actor);
  return L.moveStep(a.id, step, ctx.actor, ctx.body.note || (ctx.body.next ? 'Move to next step' : 'Step set by hand'));
});
// Rounds are never compulsory. Skipping one, or adding one, keeps the reason.
const roundOf = (a, key) => { const r = L.roundsOf(a).find((x) => x.key === key); if (!r) throw httpError(400, 'Pick the round'); return r; };
route('POST', '/api/applications/:id/skip-round', T, (ctx) => {
  const a = loadApp(ctx); if (a.result !== 'open') throw httpError(400, 'This application is closed.'); const r = roundOf(a, (ctx.body || {}).key);
  if (['Scheduled', 'Result pending'].includes(r.status)) throw httpError(400, 'This round is booked. Record or cancel it first.');
  if (!String((ctx.body || {}).reason || '').trim()) throw httpError(400, 'Give the reason for skipping this round', 'reason');
  L.skipRounds(a, [r], ctx.body.reason, ctx.actor); return { ok: true };
});
route('POST', '/api/applications/:id/skip-round/undo', T, (ctx) => {
  const a = loadApp(ctx); const r = roundOf(a, (ctx.body || {}).key); D.run('DELETE FROM round_skips WHERE app_id=? AND mode=?', a.id, r.key); L.appHist(a.id, a.step, ctx.actor, `${r.name}: Not needed taken back`, 'interview'); return { ok: true };
});
route('POST', '/api/applications/:id/rounds', T, (ctx) => {
  const a = loadApp(ctx); const b = ctx.body || {}; const name = String(b.name || '').trim(); const reason = String(b.reason || '').trim();
  if (a.result !== 'open') throw httpError(400, 'This application is closed.'); if (!name) throw httpError(400, 'Name the round', 'name'); if (!L.IV_MODES[b.mode]) throw httpError(400, 'Pick the type', 'mode'); if (!reason) throw httpError(400, 'Give the reason for this round', 'reason');
  insert('extra_rounds', { app_id: a.id, mode: b.mode, name, reason, by: ctx.actor.label, at: now() }); L.appHist(a.id, a.step, ctx.actor, `Round added: ${name}. ${reason}`, 'interview'); return { ok: true };
});
route('POST', '/api/applications/:id/rounds/:rid/delete', T, (ctx) => {
  const a = loadApp(ctx); const r = L.roundsOf(a).find((x) => x.extra_id === Number(ctx.params.rid)); if (!r) throw httpError(404, 'Round not found'); if (r.interview_ids.length) throw httpError(400, 'This round has an interview on it.');
  D.run('DELETE FROM extra_rounds WHERE id=?', r.extra_id); D.run('DELETE FROM round_skips WHERE app_id=? AND mode=?', a.id, r.key); L.appHist(a.id, a.step, ctx.actor, `Round removed: ${r.name}`, 'interview'); return { ok: true };
});
route('POST', '/api/applications/:id/close', T, (ctx) => { const a = loadApp(ctx); return L.closeApplication(a.id, ctx.body.reason, ctx.actor, ctx.body.note); });
// Match candidates to jobs: every candidate (that this login can see) gets an application on each open job their ad
// names or "Job you want" point to, unless they already have one there (open or closed). dry=true only shows it.
// Ad applicants without an open application: what happens to each (dry), and open them now.
route('POST', '/api/applications/ad-applicants', T, (ctx) => {
  const only = (ctx.body || {}).only ? String(ctx.body.only) : null; // one candidate, from their profile: any team member
  if (!only && !['super', 'admin'].includes(ctx.user.level)) throw httpError(403, 'For admins');
  if (!(ctx.body || {}).dry) L.reopenRefilled(ctx.actor, { only });
  const r = L.openAdApplications(ctx.actor, { dry: !!(ctx.body || {}).dry, report: true, only, days: only ? 365 : 90 });
  if (!(ctx.body || {}).dry) D.history(ctx.actor.label, 'ad applications opened', null, null, null, `${r.made} opened`, null, ctx.ip);
  return r;
});
route('POST', '/api/applications/auto-map', T, (ctx) => {
  const u = ctx.user; const b = ctx.body || {}; const plan = [];
  // Email candidates stay candidates only: the team picks their jobs by hand.
  const cands = all("SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0 AND archived=0 AND source != 'Email' AND source NOT LIKE 'Google Drive%'").filter((c) => isSuper(u) || c.agency_id === u.agency_id || !c.agency_id);
  for (const c of cands) {
    if (b.ids && !b.ids.includes(c.id)) continue;
    if (L.isPlaced(c.id)) continue; // hired through us: not matched again
    const m = L.jobsForPerson(c, b.same_city ? { cities: [c.city, ...(c.work_cities || [])].filter(Boolean) } : {});
    for (const j of m.jobs) {
      if (!seeJob(u, j) && j.agency_id !== u.agency_id) continue;
      if (get('SELECT 1 FROM applications WHERE candidate_id=? AND job_id=?', c.id, j.id)) continue;
      plan.push({ cand: c, job: j, by: m.by });
    }
  }
  const byJob = {}; for (const p of plan) { const k = p.job.id; byJob[k] = byJob[k] || { job_id: k, title: p.job.title, city: p.job.city, client: (get('SELECT company FROM clients WHERE id=?', p.job.client_id) || {}).company, candidates: [] }; byJob[k].candidates.push({ id: p.cand.id, name: p.cand.name, job_wanted: p.cand.job_wanted, city: p.cand.city, by: p.by }); }
  const summary = { applications: plan.length, candidates: new Set(plan.map((p) => p.cand.id)).size, jobs: Object.keys(byJob).length, unmatched: cands.filter((c) => !L.jobsForPerson(c).jobs.length).length };
  if (b.dry) return { summary, jobs: Object.values(byJob).sort((a, z) => z.candidates.length - a.candidates.length) };
  let made = 0; const errors = [];
  for (const p of plan) {
    try { L.createApplication(p.cand.id, p.job.id, ctx.actor, p.cand.source, `Matched automatically (${p.by})`, p.cand.ad_set || p.cand.ad_name || p.cand.ad_campaign ? { campaign: p.cand.ad_campaign, adset: p.cand.ad_set, ad: p.cand.ad_name } : null); made++; } catch (e) { errors.push(`${p.cand.id} on ${p.job.id}: ${e.message}`); }
  }
  D.history(ctx.actor.label, 'match candidates to jobs', null, 'applications', null, `${made} applications made`, null, ctx.ip);
  return { summary, made, errors };
});
route('POST', '/api/applications/:id/screen', T, (ctx) => { const a = loadApp(ctx); return L.screenApplication(a.id, ctx.body.verdict, ctx.actor, ctx.body.note); });
route('POST', '/api/applications/:id/reopen', T, (ctx) => { const a = loadApp(ctx); return L.reopenApplication(a.id, ctx.actor); });
route('POST', '/api/applications/:id/hold', T, (ctx) => {
  const a = loadApp(ctx); const on = !!ctx.body.on;
  if (on && !ctx.body.reason) throw httpError(400, 'Give the reason', 'reason');
  update('applications', a.id, { on_hold: on ? 1 : 0, hold_reason: on ? ctx.body.reason : null, hold_until: on ? ctx.body.until || null : null });
  L.appHist(a.id, a.step, ctx.actor, on ? `On hold: ${ctx.body.reason}${ctx.body.until ? ' until ' + ctx.body.until : ''}` : 'Hold removed', 'hold');
  if (on && ctx.body.until) insert('followups', { record_id: a.id, at: new Date(ctx.body.until + 'T09:00:00+05:30').toISOString(), note: `Come back to ${a.id}: ${ctx.body.reason}`, for_user: ctx.user.id, created_by: ctx.user.id });
  return { ok: true };
});
route('POST', '/api/applications/:id/offer', T, (ctx) => { const a = loadApp(ctx); const r = L.recordOffer(a.id, ctx.body, ctx.actor); require('./flow').autoAccounts(a.id, ctx.actor); return r; });
route('POST', '/api/applications/:id/accept', T, (ctx) => { const a = loadApp(ctx); if (a.step !== 'Offer made') throw httpError(400, 'Record the offer first.'); return L.moveStep(a.id, 'Offer accepted', ctx.actor, 'Offer accepted (marked by team)'); });
route('POST', '/api/applications/:id/decline', T, (ctx) => { const a = loadApp(ctx); return L.closeApplication(a.id, 'Offer declined', ctx.actor, ctx.body.note); });
route('POST', '/api/applications/:id/joined', T, (ctx) => {
  const a = loadApp(ctx); if (a.step !== 'Offer accepted') throw httpError(400, 'The offer must be accepted before marking Joined.');
  if (ctx.body.joining_date) update('applications', a.id, { joining_date: ctx.body.joining_date });
  return L.moveStep(a.id, 'Joined', ctx.actor, 'Marked joined');
});
route('POST', '/api/applications/:id/no-join', T, (ctx) => { const a = loadApp(ctx); return L.closeApplication(a.id, 'Did not join', ctx.actor, ctx.body.note); });
route('POST', '/api/applications/:id/left', T, (ctx) => { const a = loadApp(ctx); return L.leftJob(a.id, ctx.body, ctx.actor); });
route('POST', '/api/applications/:id/risk', T, (ctx) => { const a = loadApp(ctx); update('applications', a.id, { at_risk: ctx.body.on ? 1 : 0 }); L.appHist(a.id, a.step, ctx.actor, ctx.body.on ? 'Marked at risk' : 'At risk cleared', 'risk'); return { ok: true }; });
route('POST', '/api/applications/:id/checklist', T, (ctx) => {
  const a = loadApp(ctx); const cl = { ...(a.checklist || {}) }; cl[ctx.body.item] = ctx.body.done ? { by: ctx.actor.label, at: now() } : null;
  update('applications', a.id, { checklist: cl }); L.appHist(a.id, a.step, ctx.actor, `${ctx.body.item}: ${ctx.body.done ? 'done' : 'not done'}`, 'checklist'); return { ok: true };
});
route('POST', '/api/applications/:id/offer-letter', T, (ctx) => { const a = loadApp(ctx); return makeOfferLetter(a, ctx.actor, ctx.body.send); });
function makeOfferLetter(a, actor, send) {
  if (!a.offer_ctc) throw httpError(400, 'Record the offer first.');
  const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const c = get('SELECT * FROM clients WHERE id=?', job.client_id); const cand = get('SELECT * FROM candidates WHERE id=?', a.candidate_id);
  const tpl = (c.templates ? JSON.parse(c.templates) : {}).offer_letter || D.settings().templates.offer_letter;
  const vars = { candidate: cand.name, job: job.title, ctc: L.inr(a.offer_ctc), joining_date: L.istFmt(a.joining_date, false), reporting_to: a.reporting_to || 'your manager', company: c.company, city: job.city, date: L.istFmt(now(), false) };
  const text = tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  const buf = F.makePdf(`Offer letter · ${c.company}`, text.split('\n'), { ...D.settings().business, name: c.company });
  const f = F.storeBuffer({ recordId: a.id, type: 'offer_letter', name: `Offer-${a.id}.pdf`, buf, mime: 'application/pdf', by: L.actorName(actor) });
  update('applications', a.id, { offer_letter: String(f.id), offer_sent: send ? 1 : 0 });
  L.appHist(a.id, a.step, actor, send ? 'Offer letter made and sent to candidate' : 'Offer letter made (client to check)', 'paper');
  if (send) L.sendWA({ ptype: 'candidate', pid: a.candidate_id, format: 'bbhs_offer', vars: { job: job.title, company: c.company, ctc: L.inr(a.offer_ctc), joining_date: L.istFmt(a.joining_date, false) }, ap: a.id, jb: job.id, by: actor, dedupe: `offerletter:${a.id}:${f.id}` });
  return { file_id: f.id };
}
module.exports.makeOfferLetter = makeOfferLetter;
route('POST', '/api/applications/bulk', T, (ctx) => {
  const { ids, action, step, reason } = ctx.body; const out = { done: 0, errors: [] };
  for (const id of ids || []) {
    try {
      const a = get('SELECT * FROM applications WHERE id=?', id); mustSee(a && seeApp(ctx.user, a), 'application');
      if (action === 'step') { if (L.needsCall(get('SELECT * FROM applications WHERE id=?', id), step, ctx.user)) throw httpError(400, 'Log a call first'); L.passRounds(id, step, ctx.body.skip_reason, ctx.actor); L.moveStep(id, step, ctx.actor, 'Bulk move'); } else if (action === 'close') L.closeApplication(id, reason, ctx.actor, 'Bulk close');
      else if (action === 'screen') L.screenApplication(id, ctx.body.verdict, ctx.actor, ctx.body.note || 'Bulk');
      else if (action === 'wa') {
        const ptype = ctx.body.to === 'client' ? 'client' : 'candidate'; const job = get('SELECT * FROM jobs WHERE id=?', a.job_id);
        const pid = ptype === 'client' ? job.client_id : a.candidate_id; const p = L.person(ptype, pid);
        const r = L.sendWA({ ptype, pid, format: ctx.body.format, vars: composeVars({ ptype, pid, ap: id }, p), ap: id, jb: a.job_id, by: ctx.actor, bulk: true });
        if (r.skipped) throw new Error(r.skipped);
        L.appHist(id, a.step, ctx.actor, `WhatsApp ${ctx.body.format} to ${ptype} (bulk)`, 'wa');
      }
      else if (action === 'owner') { update('applications', id, { owner_id: ctx.body.owner_id }); L.appHist(id, a.step, ctx.actor, `Owner → ${V.userName(ctx.body.owner_id)}`, 'owner'); }
      out.done++;
    } catch (e) { out.errors.push(`${id}: ${e.message}`); }
  }
  return out;
});

// ---------- interviews ----------
// Everyone screened in and not yet at the offer, with the round they are in now: telephonic, virtual, then the client.
// Reminders for several booked interviews at once. ids: interview ids, or application ids (their next booked interview).
route('POST', '/api/interviews/remind', T, (ctx) => {
  const b = ctx.body || {}; const to = [].concat(b.to || []); const ch = [].concat(b.channels || []);
  if (!to.length) throw httpError(400, 'Pick who gets the reminder', 'to'); if (!ch.length) throw httpError(400, 'Pick WhatsApp, email or both', 'channels');
  if (b.when === 'at' && !b.at) throw httpError(400, 'Pick the date and time', 'at');
  const mailer = require('./mailer'); const out = { done: 0, errors: [] }; const seen = new Set(); const nowMs = Date.now();
  for (const id of [].concat(b.ids || []).slice(0, 200)) {
    const iv = get('SELECT * FROM interviews WHERE id=?', id) || get("SELECT * FROM interviews WHERE app_id=? AND status IN ('Scheduled','Rescheduled') AND at>? ORDER BY at LIMIT 1", id, now()) || get("SELECT * FROM interviews WHERE app_id=? AND status IN ('Scheduled','Rescheduled') ORDER BY at DESC LIMIT 1", id);
    if (!iv) { out.errors.push(`${id}: no interview booked`); continue; }
    if (seen.has(iv.id)) continue; seen.add(iv.id);
    if (!['Scheduled', 'Rescheduled'].includes(iv.status) || new Date(iv.at).getTime() < nowMs) { out.errors.push(`${id}: not an upcoming interview`); continue; }
    const a = get('SELECT * FROM applications WHERE id=?', iv.app_id); if (!a || !seeApp(ctx.user, a)) { out.errors.push(`${id}: not yours to remind`); continue; }
    const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const cand = get('SELECT * FROM candidates WHERE id=?', a.candidate_id) || {}; const client = get('SELECT * FROM clients WHERE id=?', job.client_id) || {};
    const ivAt = new Date(iv.at).getTime();
    const sendAt = b.when === '1d' ? ivAt - 86400000 : b.when === '2h' ? ivAt - 7200000 : b.when === 'at' ? new Date(b.at).getTime() : null;
    const later = sendAt && sendAt > nowMs + 60000 ? new Date(sendAt).toISOString() : undefined;
    const vars = L.ivVars(iv, job); const tag = `ivb:${iv.id}:${b.when || 'now'}:${later || ''}`;
    const interviewer = iv.interviewer ? get('SELECT * FROM users WHERE lower(name)=lower(?)', iv.interviewer) : null;
    const people = [];
    if (to.includes('candidate')) people.push({ ptype: 'candidate', pid: cand.id, email: cand.email, name: cand.name, vars });
    if (to.includes('client') && iv.round === 'client') people.push({ ptype: 'client', pid: client.id, email: client.email, name: client.contact || client.company, vars: { ...vars, round: `interview with ${cand.name}` } });
    if (to.includes('interviewer') && interviewer) people.push({ ptype: 'user', pid: interviewer.id, email: interviewer.email, name: interviewer.name, task: `${vars.round} with ${cand.name} for ${job.title}, ${vars.date} ${vars.time}` });
    if (!people.length) { out.errors.push(`${id}: nobody to remind (client only for client rounds; interviewer needs a login)`); continue; }
    let sent = 0;
    for (const p of people) {
      if (ch.includes('whatsapp')) {
        try {
          const r = p.ptype === 'user'
            ? L.sendWA({ ptype: 'user', pid: p.pid, format: 'bbhs_team_task_alert', vars: { task: `Interview reminder: ${p.task}`, record_id: a.id }, ap: a.id, iv: iv.id, by: ctx.actor, bulk: true, noEmailCopy: true, sendLater: later, dedupe: `${tag}:u:${p.pid}` })
            : L.sendWA({ ptype: p.ptype, pid: p.pid, format: b.format || 'bbhs_interview_reminder', vars: p.vars, ap: a.id, iv: iv.id, by: ctx.actor, bulk: true, noEmailCopy: true, sendLater: later, dedupe: `${tag}:${p.ptype}:${p.pid}` });
          if (r && r.skipped) out.errors.push(`${id} ${p.name}: WhatsApp ${r.skipped}`); else sent++;
        } catch (e) { out.errors.push(`${id} ${p.name}: WhatsApp ${e.message}`); }
      }
      if (ch.includes('email')) {
        if (!p.email) { out.errors.push(`${id} ${p.name}: no email`); continue; }
        const v = p.vars || vars; const subject = `Reminder: ${v.round} for ${job.title} on ${v.date} at ${v.time}`;
        const lines = [`Hello ${String(p.name || '').split(' ')[0]},`, '', `This is a reminder of the ${v.round} for the ${job.title} role.`, '', `Date: ${v.date}`, `Time: ${v.time}`, `Venue: ${v.place || '—'}`, ...(b.note ? ['', String(b.note)] : []), '', 'The calendar invite is attached.', '', 'BrillBrains Hiring Solutions'];
        const html = mailer.layout(subject, `<p style="font-size:14px;line-height:1.7">${lines.map((x) => String(x).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))).join('<br>')}</p>`);
        try { mailer.queue({ to: p.email, subject, text: lines.join('\n'), html, kind: 'interview_reminder', recordId: a.id, sendAfter: later, dedupe: `${tag}:mail:${p.ptype}:${p.pid}`, attachments: [{ ics_iv: iv.id }] }); sent++; } catch (e) { out.errors.push(`${id} ${p.name}: email ${e.message}`); }
      }
    }
    if (sent) { out.done++; L.appHist ? L.appHist(a.id, a.step, ctx.actor, `Interview reminder ${later ? `set for ${L.istFmt(later)}` : 'sent'} (${ch.join(' + ')}) to ${people.map((x) => x.ptype === 'user' ? 'interviewer' : x.ptype).join(', ')}`) : null; }
  }
  return out;
});
route('GET', '/api/interviews/rounds', T, (ctx) => {
  const want = ctx.query.round || ''; const settled = ['Cleared', 'Not needed', 'Not cleared'];
  const rows = visibleApps(ctx.user).filter((a) => a.result === 'open' && (['Our interview', 'Sent to client', 'Client interview'].includes(a.step) || (['Applied', 'Screening'].includes(a.step) && a.screen === 'Accepted'))).map((a) => {
    const v = V.appView(a); const rounds = L.roundsOf(a); const client = L.stepIdx(a.step) >= L.stepIdx('Sent to client');
    const cur = rounds.filter((r) => (client ? r.mode === 'in_person' : r.mode !== 'in_person')).find((r) => !settled.includes(r.status)) || null;
    const c = get('SELECT * FROM candidates WHERE id=?', a.candidate_id) || {}; const task = get(`SELECT at FROM followups WHERE record_id=? AND done=0 ORDER BY at LIMIT 1`, a.id);
    const iv = cur && cur.interview_ids.length ? get("SELECT * FROM interviews WHERE id=?", cur.interview_ids[cur.interview_ids.length - 1]) : null;
    return { id: a.id, candidate_id: a.candidate_id, candidate_name: v.candidate_name, job_title: v.job_title, client_name: v.client_name, owner_name: v.owner_name, step: a.step, round: cur ? cur.name : client ? 'Client round done' : 'Ready for the client', round_key: cur ? cur.key : null, mode: cur ? cur.mode : client ? 'in_person' : 'ready', status: cur ? cur.status : 'Next step', at: cur && cur.status !== 'To do' ? cur.at : null, iv_id: iv && ['Scheduled', 'Rescheduled'].includes(iv.status) ? iv.id : null, best: L.prefNote(c), task_at: task ? task.at : null, asked: !c.pref_time && !c.pref_days && !!get("SELECT 1 FROM messages WHERE person_type='candidate' AND person_id=? AND format='bbhs_contact_prefs'", c.id) };
  });
  // Offered the job after the client round: kept in Interviews under Job offered.
  for (const a of visibleApps(ctx.user).filter((x) => x.result === 'open' && ['Offer made', 'Offer accepted'].includes(x.step))) { const v = V.appView(a); rows.push({ id: a.id, candidate_id: a.candidate_id, candidate_name: v.candidate_name, job_title: v.job_title, client_name: v.client_name, owner_name: v.owner_name, step: a.step, round: 'Job offered', round_key: null, mode: 'offer', status: a.step === 'Offer accepted' ? 'Offer accepted' : 'Offer made', at: a.joining_date || null, iv_id: null }); }
  const order = { 'Result pending': 0, Scheduled: 1, 'To do': 2, 'No-show': 2, 'On hold': 3, 'Next step': 4 };
  const counts = { all: rows.length, phone: rows.filter((r) => r.mode === 'phone').length, video: rows.filter((r) => r.mode === 'video').length, in_person: rows.filter((r) => r.mode === 'in_person').length, ready: rows.filter((r) => r.mode === 'ready').length, offer: rows.filter((r) => r.mode === 'offer').length };
  return { counts, rows: rows.filter((r) => !want || r.mode === want || (want === 'video' && !['phone', 'in_person', 'ready', 'offer'].includes(r.mode))).sort((x, y) => (order[x.status] ?? 5) - (order[y.status] ?? 5) || String(x.at || x.task_at || '9').localeCompare(String(y.at || y.task_at || '9'))) };
});
route('GET', '/api/interviews', T, (ctx) => {
  const f = ctx.query.filter || 'Upcoming';
  const apps = new Map(visibleApps(ctx.user).map((a) => [a.id, a]));
  let rows = all('SELECT * FROM interviews ORDER BY at').filter((i) => apps.has(i.app_id)).map(L.interviewView).map((i) => { const a = V.appView(apps.get(i.app_id)); return { ...i, candidate_name: a.candidate_name, candidate_id: a.candidate_id, job_title: a.job_title, job_id: a.job_id, client_name: a.client_name, client_id: a.client_id }; });
  rows = rows.filter((i) => f === 'All' || (f === 'Upcoming' && ['Scheduled', 'Rescheduled'].includes(i.status) && i.view_status !== 'Result pending') || (f === 'Result pending' && i.view_status === 'Result pending') || (f === 'Done' && i.status === 'Completed') || (f === 'Cancelled / no-show' && ['Cancelled', 'No-show'].includes(i.status)));
  if (f === 'Done' || f === 'All') rows.reverse();
  return page(ctx, rows, 'interviews', ['id', 'at', 'candidate_name', 'job_title', 'client_name', 'round', 'interviewer', 'view_status', 'result', 'rating', 'remark']);
});
route('GET', '/api/calendar', T, (ctx) => {
  const u = ctx.user; const scope = ctx.query.scope || 'me';
  const from = ctx.query.from || new Date(Date.now() - 86400000).toISOString(); const to = ctx.query.to || new Date(Date.now() + 14 * 86400000).toISOString();
  const apps = new Map(visibleApps(u).map((a) => [a.id, a]));
  const rows = all("SELECT * FROM interviews WHERE at>=? AND at<=? AND status NOT IN ('Cancelled') ORDER BY at", from, to).filter((i) => apps.has(i.app_id))
    .filter((i) => scope === 'all' || (scope === 'me' ? (apps.get(i.app_id).owner_id === u.id || (i.interviewer || '').toLowerCase() === u.name.toLowerCase()) : true))
    .map((i) => { const a = V.appView(apps.get(i.app_id)); return { ...L.interviewView(i), candidate_id: a.candidate_id, candidate_name: a.candidate_name, job_title: a.job_title, client_name: a.client_name }; });
  // Clash: same candidate or same interviewer within the same hour.
  for (const i of rows) i.clash = rows.some((o) => o.id !== i.id && Math.abs(new Date(o.at) - new Date(i.at)) < 3600000 && (o.candidate_id === i.candidate_id || (o.interviewer && o.interviewer === i.interviewer)));
  return rows;
});
route('POST', '/api/interviews', T, (ctx) => {
  const a = get('SELECT * FROM applications WHERE id=?', ctx.body.app_id); mustSee(a && seeApp(ctx.user, a), 'application');
  const iv = L.scheduleInterview(a.id, ctx.body, ctx.actor);
  const clash = all("SELECT i.id FROM interviews i JOIN applications a ON a.id=i.app_id WHERE i.id!=? AND i.status IN ('Scheduled','Rescheduled') AND ABS(strftime('%s',i.at)-strftime('%s',?))<3600 AND (a.candidate_id=? OR (i.interviewer!='' AND i.interviewer=?))", iv.id, iv.at, a.candidate_id, iv.interviewer || '#');
  return { ...iv, clash: clash.map((c) => c.id) };
});
route('POST', '/api/interviews/:id/result', T, (ctx) => {
  const ivNow = get('SELECT * FROM interviews WHERE id=?', ctx.params.id); if (ivNow && ivNow.mode === 'phone' && ctx.body.status === 'Completed' && L.callGateOn() && ctx.user.level !== 'super' && !get("SELECT 1 FROM calls WHERE app_id=? AND status='Done' AND at>=?", ivNow.app_id, ivNow.created_at || ivNow.at)) throw httpError(400, 'Log the call first: the telephonic round needs its call on record.', 'call');
  const iv = get('SELECT * FROM interviews WHERE id=?', ctx.params.id); const a = iv && get('SELECT * FROM applications WHERE id=?', iv.app_id);
  mustSee(a && seeApp(ctx.user, a), 'interview'); return L.recordInterview(iv.id, ctx.body, ctx.actor);
});
route('POST', '/api/interviews/:id/notes', T, (ctx) => {
  const iv = get('SELECT * FROM interviews WHERE id=?', ctx.params.id); const a = iv && get('SELECT * FROM applications WHERE id=?', iv.app_id);
  mustSee(a && seeApp(ctx.user, a), 'interview'); return L.addIvNote(iv.id, ctx.body.text, ctx.actor.label, 'team');
});
const callAccess = (ctx, b) => {
  if (b.app_id) { const a = get('SELECT * FROM applications WHERE id=?', b.app_id); mustSee(a && seeApp(ctx.user, a), 'application'); }
  if (b.client_id) { const c = get('SELECT * FROM clients WHERE id=?', b.client_id); mustSee(c && seeClient(ctx.user, c), 'client'); }
};
route('GET', '/api/call-topics', T, () => ({ topics: D.settings().call_topics || [], outcomes: L.CALL_OUTCOMES }));
// Call now tapped by mistake (or the call never went through): the open call is dropped, with the reason kept.
route('POST', '/api/calls/open/cancel', { ...T, calling: true }, (ctx) => {
  const k = L.openCall(ctx.user.id); if (!k) return { ok: true };
  D.update('calls', k.id, { status: 'Cancelled', outcome: 'Not called', note: String((ctx.body || {}).reason || 'Tapped Call by mistake').slice(0, 300) });
  D.history(ctx.actor.label, 'call cancelled', k.app_id || k.candidate_id || k.client_id, null, null, `Call with ${k.who} not made: ${(ctx.body || {}).reason || 'tapped by mistake'}`, null, ctx.ip);
  return { ok: true };
});
route('POST', '/api/calls/start', { ...T, calling: true }, (ctx) => { const b = ctx.body || {}; callAccess(ctx, b); return L.startCall(b, ctx.actor); });
route('POST', '/api/calls', { ...T, calling: true }, (ctx) => {
  const b = ctx.body || {}; callAccess(ctx, b); const r = L.logCall(b, ctx.actor); const p = L.cleanPrefs(b);
  // Preferences heard on the call are kept on the candidate.
  const cid = b.candidate_id || (b.id ? (get('SELECT candidate_id FROM calls WHERE id=?', b.id) || {}).candidate_id : null); const cand = cid && get('SELECT * FROM candidates WHERE id=?', cid);
  if (cand && Object.keys(p).some((k) => (p[k] || null) !== (cand[k] || null))) D.edit('candidates', cand.id, p, ctx.actor.label, ctx.ip);
  return r;
});
route('POST', '/api/interviews/:id/confirm', T, (ctx) => {
  const iv = get('SELECT * FROM interviews WHERE id=?', ctx.params.id); const a = iv && get('SELECT * FROM applications WHERE id=?', iv.app_id);
  mustSee(a && seeApp(ctx.user, a), 'interview'); update('interviews', iv.id, { confirmed: 1 }); D.history(ctx.actor.label, 'confirm', iv.id, 'confirmed', 0, 1); return { ok: true };
});

// ---------- WhatsApp (section 8) ----------
route('GET', '/api/wa/threads', T, (ctx) => {
  const f = ctx.query.filter || 'All'; const u = ctx.user;
  const rows = all('SELECT person_type, person_id, MAX(at) last_at, SUM(CASE WHEN direction=\'in\' AND read_by_us=0 THEN 1 ELSE 0 END) unread FROM messages GROUP BY person_type, person_id ORDER BY last_at DESC')
    .filter((t) => seeThread(u, t.person_type, t.person_id))
    .filter((t) => f === 'All' || (f === 'Clients' && t.person_type === 'client') || (f === 'Candidates' && t.person_type === 'candidate') || (f === 'Team' && t.person_type === 'user') || (f === 'Unread' && t.unread > 0) || (f === 'Failed'))
    .map((t) => { const last = get(`SELECT text, direction, status FROM messages WHERE person_type=? AND person_id=?${msgHide(u)} ORDER BY at DESC LIMIT 1`, t.person_type, t.person_id); return { ...t, name: V.threadName(t.person_type, t.person_id), last }; })
    .filter((t) => t.last && like(ctx.query.q, t.name, t.person_id)); // a thread holding only hidden messages is left out
  const failed = f === 'Failed' ? all("SELECT * FROM messages WHERE status='failed' ORDER BY at DESC").filter((m) => seeThread(u, m.person_type, m.person_id)) : [];
  return { threads: f === 'Failed' ? [] : rows, failed };
});
route('GET', '/api/wa/thread/:ptype/:pid', T, (ctx) => {
  const { ptype, pid } = ctx.params; mustSee(seeThread(ctx.user, ptype, pid) || isSuper(ctx.user), 'chat');
  D.run("UPDATE messages SET read_by_us=1 WHERE person_type=? AND person_id=? AND direction='in'", ptype, pid);
  const p = L.person(ptype, pid); const rec = p.record;
  const showPhone = ptype !== 'candidate' || R.phoneVisible(ctx.user, rec);
  return {
    person: { type: ptype, id: pid, name: V.threadName(ptype, pid), phone: showPhone ? p.phone : R.maskPhone(p.phone), opted_out: p.opted_out, lang: p.lang, window_until: L.windowOpenUntil(ptype, pid) },
    messages: all(`SELECT * FROM messages WHERE person_type=? AND person_id=?${msgHide(ctx.user)} ORDER BY at`, ptype, pid),
    quick: ptype === 'client' ? ['bbhs_shortlist_ready', 'bbhs_feedback_request', 'bbhs_payment_reminder'] : ptype === 'candidate' ? ['bbhs_details_request', 'bbhs_interview_reminder', 'bbhs_job_alert'] : ['bbhs_team_task_alert', 'bbhs_log_reminder', 'bbhs_day_summary'],
  };
});
// Everything the one message window needs: who, window, suggested formats, filled-in details.
// The filled-in details for a message (name, job, date, amount, link …) from the linked records.
function composeVars(b, p) {
  const s = D.settings(); const vars = { name: p.name };
  let job = b.jb ? get('SELECT * FROM jobs WHERE id=?', b.jb) : null; const app = b.ap ? get('SELECT * FROM applications WHERE id=?', b.ap) : null;
  if (app && !job) job = get('SELECT * FROM jobs WHERE id=?', app.job_id);
  if (job) { const cl = get('SELECT * FROM clients WHERE id=?', job.client_id); Object.assign(vars, { job: job.title, job_id: job.id, city: job.city, salary: L.SAL_HIDDEN, company: cl.company, count: get("SELECT COUNT(*) c FROM applications WHERE job_id=? AND step='Sent to client' AND result='open'", job.id).c }); }
  if (app) { const cand = get('SELECT * FROM candidates WHERE id=?', app.candidate_id); Object.assign(vars, { candidate: cand.name, ctc: L.inr(app.offer_ctc), joining_date: L.istFmt(app.joining_date, false), date: L.istFmt(app.joining_date, false), days: app.joined_at ? L.daysBetween(app.joined_at) : '' }); }
  const iv = b.iv ? get('SELECT * FROM interviews WHERE id=?', b.iv) : (app ? get("SELECT * FROM interviews WHERE app_id=? AND status IN ('Scheduled','Rescheduled') ORDER BY at", app.id) : null);
  if (iv && job) Object.assign(vars, L.ivVars(iv, job));
  if (b.bl) { const bl = L.billView(get('SELECT * FROM bills WHERE id=?', b.bl)); Object.assign(vars, { bill_no: bl.bill_no || bl.id, amount: L.inr(bl.balance || bl.total), status: bl.view_status.toLowerCase(), link: L.upiLink(bl.balance || bl.total, bl.bill_no) }); }
  if (b.ptype === 'client') Object.assign(vars, { client_id: p.id, link: vars.link || L.link('my-account') });
  if (b.ptype === 'candidate') Object.assign(vars, { candidate_id: p.id, link: vars.link || L.link('my-profile') });
  if (b.ptype === 'user') Object.assign(vars, { link: L.link('team'), deadline: s.log_deadline, date: L.istFmt(now(), false), username: p.record.username });
  Object.assign(vars, b.vars || {});
  return vars;
}
route('POST', '/api/wa/compose', T, (ctx) => {
  const b = ctx.body; const p = L.person(b.ptype, b.pid); if (!p) throw httpError(404, 'Person not found');
  if (b.ptype !== 'candidate') mustSee(seeThread(ctx.user, b.ptype, b.pid) || isSuper(ctx.user) || b.ptype === 'user', 'person');
  const s = D.settings(); const vars = composeVars(b, p); const app = b.ap ? get('SELECT * FROM applications WHERE id=?', b.ap) : null;
  const forType = { client: ['bbhs_client_welcome', 'bbhs_shortlist_ready', 'bbhs_feedback_request', 'bbhs_bill_raised', 'bbhs_payment_reminder', 'bbhs_jd_approval'], candidate: ['bbhs_candidate_welcome', 'bbhs_details_request', 'bbhs_interview_scheduled', 'bbhs_interview_reminder', 'bbhs_offer', 'bbhs_joining_reminder', 'bbhs_post_join_checkin', 'bbhs_job_alert', 'bbhs_still_looking', 'bbhs_documents_request', 'bbhs_consent_request'], user: ['bbhs_team_task_alert', 'bbhs_log_reminder', 'bbhs_day_summary'] }[b.ptype];
  const suggested = [b.format, ...(app ? [suggestFor(app)].filter((x) => x && x.ptype === b.ptype).map((x) => x.format) : [])].filter(Boolean);
  const showPhone = b.ptype !== 'candidate' || R.phoneVisible(ctx.user, p.record);
  return {
    person: { type: b.ptype, id: p.id, name: p.name, phone: showPhone ? p.phone : R.maskPhone(p.phone), phone_hidden: !showPhone, opted_out: p.opted_out, lang: p.lang },
    window_until: L.windowOpenUntil(b.ptype, b.pid), quiet: L.inQuiet(), next9: L.next9am(),
    suggested: [...new Set(suggested)], others: forType.filter((f) => !suggested.includes(f)),
    formats: Object.fromEntries(forType.concat(suggested).map((k) => [k, s.formats[k]]).filter((x) => x[1])), vars,
  };
});
route('POST', '/api/wa/send', T, (ctx) => {
  const b = ctx.body;
  if (b.ptype === 'user') { const t = get('SELECT * FROM users WHERE id=?', b.pid); mustSee(t && (isSuper(ctx.user) || t.agency_id === ctx.user.agency_id), 'person'); }
  else if (b.ptype === 'client') mustSee(seeThread(ctx.user, 'client', b.pid) || isSuper(ctx.user), 'client');
  const r = L.sendWA({ ptype: b.ptype, pid: b.pid, format: b.format || null, text: b.text, lang: b.lang, vars: b.vars, ap: b.ap, jb: b.jb, iv: b.iv, bl: b.bl, by: ctx.actor, sendLater: b.sendLater ? true : undefined });
  if (r.skipped) throw httpError(400, r.skipped);
  if (b.ap) L.appHist(b.ap, get('SELECT step FROM applications WHERE id=?', b.ap).step, ctx.actor, `WhatsApp ${b.format || 'message'} to ${b.ptype}`, 'wa');
  return r;
});
route('POST', '/api/wa/simulate', T, (ctx) => {
  // Test mode: acts as the person replying, exactly as the CRM webhook would deliver it.
  const b = ctx.body; const p = L.person(b.ptype, b.pid); if (!p) throw httpError(404, 'Person not found');
  return L.receiveReply(p.phone, b.text, b.button, { ptype: b.ptype, pid: b.pid, reply_to: b.reply_to });
});
route('POST', '/api/wa/retry/:id', T, (ctx) => {
  const m = get('SELECT * FROM messages WHERE id=?', ctx.params.id); if (!m) throw httpError(404, 'Not found');
  update('messages', m.id, { status: D.settings().crm.enabled ? 'sending' : 'would send', tries: 0, error: null });
  require('./crm').dispatchStored(m.id); return { ok: true };
});
route('POST', '/api/wa/tick/:id', T, (ctx) => {
  // Test mode: move a message along sent → delivered → read, as CRM status updates would.
  const m = get('SELECT * FROM messages WHERE id=?', ctx.params.id); if (!m) throw httpError(404, 'Not found');
  const next = { 'would send': 'sent', sending: 'sent', sent: 'delivered', delivered: 'read' }[m.status] || m.status; update('messages', m.id, { status: next }); return { status: next };
});

// ---------- daily logs (9.3) ----------
route('GET', '/api/logs', SUPER, (ctx) => {
  const u = ctx.user; const today = L.istDay();
  const mine = get('SELECT * FROM logs WHERE user_id=? AND day=?', u.id, today);
  const from = new Date(new Date(today + 'T00:00:00+05:30')).toISOString();
  const team = all("SELECT * FROM users WHERE status='On' AND level!='super' ORDER BY agency_id, name").filter((x) => isSuper(u) || (u.level === 'admin' && x.agency_id === u.agency_id && x.level === 'sub'))
    .map((x) => ({ id: x.id, name: x.name, level: x.level, agency_name: V.agencyName(x.agency_id), dots: logDots(x.id), today: get('SELECT * FROM logs WHERE user_id=? AND day=?', x.id, today), can_approve: (isSuper(u) && x.level === 'admin') || (u.level === 'admin' && x.level === 'sub') }));
  const recent = all('SELECT * FROM logs ORDER BY day DESC, at DESC LIMIT 200').filter((l) => team.some((t) => t.id === l.user_id) || l.user_id === u.id).map((l) => ({ ...l, name: V.userName(l.user_id) }));
  return { mine, counts: perfOf(u.id, from), deadline: D.settings().log_deadline, team, recent, my_dots: logDots(u.id) };
});
route('POST', '/api/logs', SUPER, (ctx) => {
  const u = ctx.user; if (u.level === 'super') throw httpError(400, 'Super admin does not fill a daily log.');
  const b = ctx.body; if (!b.tasks || !String(b.tasks).trim()) throw httpError(400, 'Write what you did today', 'tasks');
  const today = L.istDay(); const id = `LG-${u.id}-${today}`;
  const from = new Date(new Date(today + 'T00:00:00+05:30')).toISOString();
  const existing = get('SELECT * FROM logs WHERE id=?', id);
  if (existing && existing.status === 'Approved') throw httpError(400, 'Today\'s log is already approved.');
  const row = { id, user_id: u.id, day: today, tasks: b.tasks, problems: b.problems || '', plan: b.plan || '', counts: JSON.stringify(perfOf(u.id, from)), status: 'Submitted', at: now() };
  if (existing) update('logs', id, row); else insert('logs', row);
  D.history(ctx.actor.label, 'log submitted', id); return row;
});
route('POST', '/api/logs/:id/approve', SUPER, (ctx) => {
  const lg = get('SELECT * FROM logs WHERE id=?', ctx.params.id); if (!lg) throw httpError(404, 'Log not found');
  const owner = get('SELECT * FROM users WHERE id=?', lg.user_id);
  if (!((isSuper(ctx.user) && owner.level === 'admin') || (ctx.user.level === 'admin' && owner.level === 'sub' && owner.agency_id === ctx.user.agency_id) || isSuper(ctx.user))) throw httpError(403, 'You cannot approve this log.');
  update('logs', lg.id, { status: 'Approved', approved_by: ctx.user.id }); D.history(ctx.actor.label, 'log approved', lg.id); return { ok: true };
});

// ---------- bills, payments, payouts (16) ----------
// A bill added by hand has no application behind it: its names are kept on the bill.
const billApp = (b) => (b.app_id ? V.appView(get('SELECT * FROM applications WHERE id=?', b.app_id)) : { candidate_name: b.person_name || '', job_title: b.job_name || '', joining_date: b.joining_on || null });
const billDay = (b) => String(b.issued_at || b.date || b.created_at || '').slice(0, 10);
route('GET', '/api/bills', { ...T, accounts: true }, (ctx) => {
  const q = ctx.query;
  const seen = all('SELECT * FROM bills ORDER BY created_at DESC').filter((b) => seeBill(ctx.user, b)).map(L.billView).map((b) => {
    const a = billApp(b); return { ...b, bill_day: billDay(b), client_name: (get('SELECT company FROM clients WHERE id=?', b.client_id) || {}).company, candidate_name: a.candidate_name, job_title: a.job_title, joining_date: a.joining_date, agency_name: V.agencyName(b.agency_id), bb_share: b.fee - (b.agency_share || 0) };
  });
  const scoped = seen.filter((b) => (!q.status || b.view_status === q.status) && (!q.client || b.client_id === q.client) && (!q.agency || b.agency_id === q.agency) && (!q.from || b.bill_day >= q.from) && (!q.to || b.bill_day <= q.to) && like(q.q, b.id, b.bill_no, b.client_name, b.candidate_name));
  const rows = scoped.filter((b) => !q.stage || b.stage === q.stage);
  const live = scoped.filter((b) => !['Draft', 'Cancelled'].includes(b.view_status));
  const totals = { billed: live.reduce((a, b) => a + b.total, 0), received: live.reduce((a, b) => a + b.paid + b.tds, 0), outstanding: live.reduce((a, b) => a + b.balance, 0), overdue: live.filter((b) => b.view_status === 'Overdue').reduce((a, b) => a + b.balance, 0), agency_due: live.filter((b) => b.payout_status === 'Due').reduce((a, b) => a + (b.agency_share || 0), 0) };
  const group = (key, name) => { const m = {}; for (const b of live) { const id = b[key] || ''; const r = (m[id] = m[id] || { id, name: b[name] || 'BrillBrains', bills: 0, billed: 0, received: 0, outstanding: 0 }); r.bills++; r.billed += b.total; r.received += b.paid + b.tds; r.outstanding += b.balance; } return Object.values(m).sort((x, y) => y.outstanding - x.outstanding); };
  const p = page(ctx, sortBy(rows, q, ['bill_no', 'bill_day', 'client_name', 'candidate_name', 'total', 'stage']), 'bills', ['id', 'bill_no', 'bill_day', 'client_name', 'candidate_name', 'job_title', 'joining_date', 'ctc', 'fee', 'gst', 'total', 'paid', 'tds', 'balance', 'stage', 'view_status', 'agency_name', 'agency_share', 'bb_share', 'payout_status']);
  return p.__file ? p : { ...p, totals, by_client: group('client_id', 'client_name'), by_agency: group('agency_id', 'agency_name'), clients: all('SELECT * FROM clients WHERE removed=0 AND junk=0 AND placeholder=0 AND merged_into IS NULL ORDER BY company').filter((c) => seeClient(ctx.user, c)).map((c) => [c.id, c.company]), agencies: isSuper(ctx.user) ? all('SELECT id, name FROM agencies').map((a) => [a.id, a.name]) : [] };
});
const STAGES = ['Billed', 'Received', 'Outstanding'];
const receiveBill = (b, actor) => { const v = L.billView(b); if (v.balance > 0) insert('payments', { bill_id: b.id, date: L.istDay(), amount: v.balance, mode: 'Marked received', ref: '', tds: 0, by: actor.label, created_at: now() }); return L.refreshBill(b.id, actor.label); };
const mustMoney = (ctx) => { if (!R.canMoney(ctx.user)) throw httpError(403, 'Only an admin records money received.'); };
const noMoneyMarks = (ctx, stage) => { if (stage === 'Received') mustMoney(ctx); };
route('POST', '/api/bills', { ...T, accounts: true }, async (ctx) => {
  const b = ctx.body || {}; const c = get('SELECT * FROM clients WHERE id=?', b.client_id); if (!c || !seeClient(ctx.user, c)) throw httpError(400, 'Pick the client', 'client_id');
  const total = Math.round(Number(b.amount) || 0); if (total <= 0) throw httpError(400, 'Enter the invoice amount', 'amount');
  const gst = Math.round(Number(b.gst) || 0); if (gst < 0 || gst >= total) throw httpError(400, 'GST must be less than the amount', 'gst');
  const no = String(b.bill_no || '').trim(); if (no && get('SELECT 1 FROM bills WHERE bill_no=?', no)) throw httpError(400, 'This invoice number is already on another bill', 'bill_no');
  const stage = STAGES.includes(b.stage) ? b.stage : 'Billed'; noMoneyMarks(ctx, stage);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : L.istDay(); const agency = c.agency_id || ctx.user.agency_id || D.soleAgency() || null; const fee = total - gst; const pct = agency ? L.feeFor(c, agency, 0).sharePct : 0;
  const id = D.nextId('BL');
  insert('bills', { id, app_id: null, client_id: c.id, agency_id: agency, bill_no: no || null, ctc: 0, fee, gst, cgst: 0, sgst: 0, igst: 0, total, fee_note: 'Added by hand', status: 'Issued', issued_at: new Date(`${day}T12:00:00+05:30`).toISOString(), date: day, due_date: b.due_date || new Date(Date.parse(day) + (c.payment_days || D.settings().payment_days) * 86400000).toISOString().slice(0, 10), share_pct: pct, agency_share: Math.floor((fee * pct) / 100), payout_status: 'Not due', person_name: String(b.person_name || '').trim(), job_name: String(b.job_name || '').trim(), stage: stage === 'Outstanding' ? 'Outstanding' : null, created_at: now() });
  if (b.file && b.file.base64) { const f = await F.saveFile({ recordId: id, type: 'invoice', name: b.file.name, base64: b.file.base64, by: ctx.actor.label }); update('bills', id, { invoice_file: String(f.id) }); }
  D.history(ctx.actor.label, 'create', id, null, null, `Bill added by hand: ${L.inr(total)}`);
  if (stage === 'Received') receiveBill(get('SELECT * FROM bills WHERE id=?', id), ctx.actor);
  return { ok: true, id };
});
route('POST', '/api/bills/stage', { ...T, accounts: true }, (ctx) => {
  const { ids, stage } = ctx.body || {}; if (!STAGES.includes(stage)) throw httpError(400, 'Pick a stage'); noMoneyMarks(ctx, stage); const out = { done: 0, skipped: 0 };
  for (const id of (ids || []).slice(0, 200)) {
    const b = get('SELECT * FROM bills WHERE id=?', id); if (!b || !seeBill(ctx.user, b) || !['Issued', 'Paid'].includes(b.status)) { out.skipped++; continue; }
    if (stage === 'Received') receiveBill(b, ctx.actor);
    else { if (L.billView(b).view_status === 'Paid') { out.skipped++; continue; } update('bills', b.id, { stage: stage === 'Outstanding' ? 'Outstanding' : null }); }
    D.history(ctx.actor.label, 'bill stage', b.id, 'stage', L.billView(b).stage, stage); out.done++;
  }
  return out;
});
function loadBill(ctx) { const b = get('SELECT * FROM bills WHERE id=?', ctx.params.id); mustSee(b && seeBill(ctx.user, b), 'bill'); return b; }
route('GET', '/api/bills/:id', { ...T, accounts: true }, (ctx) => {
  const b = loadBill(ctx); const v = L.billView(b); const a = billApp(b);
  return { ...v, app: a, client: get('SELECT * FROM clients WHERE id=?', b.client_id), payments: all('SELECT * FROM payments WHERE bill_id=? ORDER BY date', b.id), credits: all('SELECT * FROM credit_notes WHERE bill_id=?', b.id), upi: L.upiLink(v.balance || v.total, b.bill_no), agency_name: V.agencyName(b.agency_id) };
});
route('PATCH', '/api/bills/:id', { ...T, accounts: true }, (ctx) => {
  const b = loadBill(ctx); if (b.status !== 'Draft') throw httpError(400, 'Issued bills cannot be edited. Use a credit note.');
  const ctc = Number(ctx.body.ctc ?? b.ctc); const client = get('SELECT * FROM clients WHERE id=?', b.client_id);
  const f = b.is_replacement ? { fee: 0, share: 0 } : feeOverride(client, b.agency_id, ctc, ctx.body.fee);
  const g = L.gstFor(client.state || L.stateOf(client.city), f.fee);
  return D.edit('bills', b.id, { ctc, fee: f.fee, gst: g.gst, cgst: g.cgst, sgst: g.sgst, igst: g.igst, total: f.fee + g.gst, agency_share: f.share }, ctx.actor.label, ctx.ip);
});
function feeOverride(client, agencyId, ctc, fee) {
  const f = L.feeFor(client, agencyId, ctc);
  if (fee !== undefined && fee !== null && fee !== '') { const v = Math.round(Number(fee)); return { fee: v, share: Math.floor((v * f.sharePct) / 100) }; }
  return f;
}
route('POST', '/api/bills/:id/issue', { ...T, accounts: true }, (ctx) => { const b = loadBill(ctx); return L.issueBill(b.id, ctx.actor); });
route('POST', '/api/bills/:id/payment', { ...T, accounts: true }, (ctx) => {
  mustMoney(ctx); const b = loadBill(ctx); if (!['Issued'].includes(b.status)) throw httpError(400, 'Payments can be recorded only on an issued bill.');
  const amt = Number(ctx.body.amount) || 0; const tds = Number(ctx.body.tds) || 0;
  if (amt <= 0 && tds <= 0) throw httpError(400, 'Enter the amount received', 'amount');
  insert('payments', { bill_id: b.id, date: ctx.body.date || L.istDay(), amount: amt, mode: ctx.body.mode || 'UPI', ref: ctx.body.ref || '', tds, by: ctx.actor.label, created_at: now() });
  D.history(ctx.actor.label, 'payment', b.id, null, null, `${L.inr(amt)} ${ctx.body.mode || ''} ${ctx.body.ref || ''}${tds ? ' TDS ' + L.inr(tds) : ''}`);
  return L.refreshBill(b.id, ctx.actor.label);
});
route('POST', '/api/bills/:id/credit', ADMINS, (ctx) => {
  const b = loadBill(ctx); if (b.status === 'Draft') throw httpError(400, 'Edit the draft instead.');
  const amt = Number(ctx.body.amount); if (!amt) throw httpError(400, 'Enter the amount', 'amount'); if (!ctx.body.reason) throw httpError(400, 'Give the reason', 'reason');
  insert('credit_notes', { bill_id: b.id, amount: amt, reason: ctx.body.reason, by: ctx.actor.label, at: now() });
  if (amt >= b.total) update('bills', b.id, { status: 'Cancelled', payout_status: 'Not due' });
  D.history(ctx.actor.label, 'credit note', b.id, null, null, `${L.inr(amt)}: ${ctx.body.reason}`);
  let newBill = null;
  if (ctx.body.reissue) {
    const id = D.nextId('BL'); newBill = { ...b, id, status: 'Draft', bill_no: null, issued_at: null, due_date: null, created_at: now(), payout_status: 'Not due', payout_paid_at: null, payout_ref: null, credit_of: null };
    insert('bills', newBill); D.history(ctx.actor.label, 'create', id, null, null, `Replaces ${b.id}`);
  }
  return { ok: true, new_bill: newBill && newBill.id };
});
route('POST', '/api/bills/payouts', ADMINS, (ctx) => {
  const ids = ctx.body.ids || []; let n = 0;
  for (const id of ids) { const b = get('SELECT * FROM bills WHERE id=?', id); if (b && b.payout_status === 'Due') { update('bills', id, { payout_status: 'Paid', payout_paid_at: now(), payout_ref: ctx.body.ref || '' }); D.history(ctx.actor.label, 'payout paid', id, 'payout_status', 'Due', 'Paid'); n++; } }
  return { paid: n };
});
route('GET', '/api/bills/:id/pdf', { ...T, accounts: true }, (ctx) => { const b = loadBill(ctx); D.history(ctx.actor.label, 'download', b.id, 'invoice'); return { __file: { name: `${(b.bill_no || b.id).replace(/\//g, '-')}.pdf`, mime: 'application/pdf', buf: invoicePdf(b) } }; });
function invoicePdf(b) {
  const s = D.settings(); const biz = s.business; const v = L.billView(b);
  const c = get('SELECT * FROM clients WHERE id=?', b.client_id); const a = billApp(b);
  const words = amountWords(Math.round(b.total));
  const lines = [
    { text: b.status === 'Draft' ? 'DRAFT — not issued yet' : `Tax invoice ${b.bill_no}`, size: 12, bold: true },
    `${biz.name} · ${biz.address}`, `GSTIN ${biz.gstin} · PAN ${biz.pan} · State: ${biz.state}`, '',
    { text: 'Bill to', bold: true }, `${c.company}`, `${c.city || ''} ${c.state || L.stateOf(c.city) || ''}`, `GSTIN: ${(c.kyc || {}).gstin || 'not given'}`, '',
    `Bill date: ${L.istFmt(b.issued_at || b.date, false)}    Due date: ${b.due_date ? L.istFmt(b.due_date, false) : '—'}`, '',
    { text: 'Line', bold: true },
    `Recruitment fee — ${a.candidate_name}, ${a.job_title}, joined ${L.istFmt(a.joining_date, false)}, yearly CTC ${L.inr(b.ctc)}${b.is_replacement ? ' (free replacement)' : ''}`,
    `Fee (${b.fee_note}): ${L.inr(b.fee)}`,
    b.igst ? `IGST ${s.gst.rate}%: ${L.inr(b.igst)}` : `CGST ${s.gst.rate / 2}%: ${L.inr(b.cgst)}    SGST ${s.gst.rate / 2}%: ${L.inr(b.sgst)}`,
    { text: `Total: ${L.inr(b.total)}`, bold: true, size: 12 }, `Amount in words: Rupees ${words} only`, '',
    `Paid so far: ${L.inr(v.paid)}  TDS: ${L.inr(v.tds)}  Balance: ${L.inr(v.balance)}`, '',
    { text: 'Pay to', bold: true }, biz.bank, `UPI: ${biz.upi_id}`,
  ];
  return F.makePdf('Invoice', lines, biz);
}
function amountWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : `${t[Math.floor(x / 10)]} ${a[x % 10]}`.trim());
  const three = (x) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred ${two(x % 100)}` : two(x)).trim();
  if (n === 0) return 'Zero';
  const parts = []; const cr = Math.floor(n / 10000000); n %= 10000000; const lk = Math.floor(n / 100000); n %= 100000; const th = Math.floor(n / 1000); n %= 1000;
  if (cr) parts.push(`${two(cr)} Crore`); if (lk) parts.push(`${two(lk)} Lakh`); if (th) parts.push(`${two(th)} Thousand`); if (n) parts.push(three(n));
  return parts.join(' ');
}
module.exports.invoicePdf = invoicePdf;
route('GET', '/api/earnings', T, (ctx) => {
  const ag = ctx.query.agency && isSuper(ctx.user) ? ctx.query.agency : ctx.user.agency_id;
  const bills = all("SELECT * FROM bills WHERE agency_id=? AND status NOT IN ('Draft','Cancelled')", ag).map(L.billView);
  const months = {};
  for (const b of bills) { const k = String(b.issued_at || b.date).slice(0, 7); months[k] = months[k] || { bills: 0, billed: 0, shares: 0, paid: 0, due: 0, not_due: 0 }; const m = months[k]; m.bills++; m.billed += b.fee; m.shares += b.agency_share; if (b.payout_status === 'Paid') m.paid += b.agency_share; else if (b.payout_status === 'Due') m.due += b.agency_share; else m.not_due += b.agency_share; }
  const rows = Object.entries(months).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, v]) => ({ month: k, ...v }));
  if (['csv', 'xlsx'].includes(ctx.query.format)) return page(ctx, rows, `earnings-${ag}`, ['month', 'bills', 'billed', 'shares', 'paid', 'due', 'not_due']);
  return { agency: get('SELECT * FROM agencies WHERE id=?', ag), months: rows, bills: bills.map((b) => ({ ...b, client_name: get('SELECT company FROM clients WHERE id=?', b.client_id).company })) };
});

// ---------- logins & team ----------
route('GET', '/api/users', T, (ctx) => {
  const u = ctx.user;
  const users = all('SELECT * FROM users ORDER BY id').filter((x) => isSuper(u) || x.agency_id === u.agency_id).map((x) => ({ id: x.id, name: x.name, whatsapp: x.whatsapp, email: x.email || '', level: x.level, team: x.team || 'Recruitment', agency_id: x.agency_id, agency_name: V.agencyName(x.agency_id), role: x.role, username: x.username, status: x.status, last_login: x.last_login, locked: x.locked_until && x.locked_until > now(), created_by: x.created_by, view_status: personStatus(x) }));
  if (ctx.query.format) return page(ctx, users, 'logins', ['id', 'name', 'username', 'level', 'team', 'agency_name', 'role', 'status', 'view_status', 'last_login', 'created_by']);
  return { users, agencies: isSuper(u) ? all('SELECT * FROM agencies ORDER BY id').map((a) => ({ ...a, view_status: agencyStatus(a), people: all('SELECT 1 FROM users WHERE agency_id=?', a.id).length })) : [] };
});
const usernameFrom = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
route('GET', '/api/users/suggest', T, (ctx) => {
  let base = usernameFrom(ctx.query.name || ''); let n = base; let i = 2;
  while (get('SELECT 1 FROM users WHERE username=?', n)) n = `${base}${i++}`;
  return { username: n };
});
route('POST', '/api/users', ADMINS, (ctx) => { // super admins anywhere; an agency's admin adds sub admins to their own agency
  const u = ctx.user; const b = ctx.body;
  if (!b.name) throw httpError(400, 'Enter the name', 'name');
  const level = isSuper(u) ? (b.level || 'sub') : 'sub';
  if (!['super', 'admin', 'sub'].includes(level)) throw httpError(400, 'Pick the level: sub admin, admin or super admin', 'level');
  const team = isSuper(u) && L.TEAMS.includes(b.team) ? b.team : 'Recruitment';
  const limited = R.channelOnly({ level, team }) || R.accountsOnly({ level, team }); // these people belong to head office, not an agency
  const agency = isSuper(u) ? b.agency_id : u.agency_id;
  if (level !== 'super' && !limited && !agency) throw httpError(400, 'Pick the agency', 'agency_id');
  if (level !== 'super' && !limited && !get('SELECT 1 FROM agencies WHERE id=?', agency)) throw httpError(400, 'That agency does not exist', 'agency_id');
  const username = (b.username || usernameFrom(b.name)).toLowerCase().trim();
  if (!/^[a-z0-9._-]{3,}$/.test(username)) throw httpError(400, 'Username: at least 3 letters, numbers or dots', 'username');
  if (get('SELECT 1 FROM users WHERE username=?', username)) throw httpError(400, 'This username is already used', 'username');
  const phone = L.digits10(b.whatsapp); if (!L.validPhone(phone)) throw httpError(400, 'Enter a 10-digit WhatsApp number', 'whatsapp');
  const pw = L.newPassword(); const id = D.nextId('U');
  const email = String(b.email || '').trim(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'Enter a valid email, or leave it empty', 'email');
  insert('users', { id, name: b.name, whatsapp: phone, email: email || null, level, team, agency_id: level === 'super' || limited ? null : agency, role: b.role || (level === 'admin' ? 'Agency owner' : limited ? team : 'Recruiter'), username, pass_hash: L.hashPassword(pw), status: 'On', must_change: 1, failed: 0, created_by: u.id, created_at: now() });
  D.history(ctx.actor.label, 'create login', id, null, null, `${username} (${level})`);
  L.sendWA({ ptype: 'user', pid: id, format: 'bbhs_team_login', vars: { username, password: pw, link: L.link('team') }, by: ctx.actor, rule: 'team_login', secret: pw, auto: true }); // quietly skipped while Meta has not approved it: the admin sees the password on screen
  return { id, username, password: pw, name: b.name, whatsapp: phone, email: email || null };
});
function canManage(u, target) { return isSuper(u) || (u.level === 'admin' && target.agency_id === u.agency_id && target.level === 'sub'); }
route('POST', '/api/users/:id/reset', ADMINS, (ctx) => {
  const t = get('SELECT * FROM users WHERE id=?', ctx.params.id); if (!t || !canManage(ctx.user, t)) throw httpError(403, 'You cannot reset this login.');
  const pw = L.newPassword(); update('users', t.id, { pass_hash: L.hashPassword(pw), must_change: 1, failed: 0, locked_until: null });
  D.run('DELETE FROM sessions WHERE kind=? AND subject_id=?', 'team', t.id);
  D.history(ctx.actor.label, 'reset password', t.id);
  L.sendWA({ ptype: 'user', pid: t.id, format: 'bbhs_team_login', vars: { username: t.username, password: pw, link: L.link('team') }, by: ctx.actor, rule: 'team_login', secret: pw, auto: true }); // quietly skipped while Meta has not approved it: the admin sees the password on screen
  return { password: pw };
});
route('POST', '/api/users/:id/toggle', ADMINS, (ctx) => {
  const t = get('SELECT * FROM users WHERE id=?', ctx.params.id); if (!t || !canManage(ctx.user, t) || t.id === ctx.user.id) throw httpError(403, 'You cannot change this login.');
  const st = t.status === 'On' ? 'Off' : 'On'; D.edit('users', t.id, { status: st }, ctx.actor.label, ctx.ip);
  if (st === 'Off') D.run('DELETE FROM sessions WHERE kind=? AND subject_id=?', 'team', t.id);
  return { status: st };
});
route('POST', '/api/users/:id/unlock', ADMINS, (ctx) => {
  const t = get('SELECT * FROM users WHERE id=?', ctx.params.id); if (!t || !canManage(ctx.user, t)) throw httpError(403, 'You cannot unlock this login.');
  update('users', t.id, { failed: 0, locked_until: null }); D.history(ctx.actor.label, 'unlock', t.id); return { ok: true };
});
route('PATCH', '/api/users/:id', ADMINS, (ctx) => {
  const t = get('SELECT * FROM users WHERE id=?', ctx.params.id); const self = t && t.id === ctx.user.id;
  if (!t || !(canManage(ctx.user, t) || self)) throw httpError(403, 'You cannot edit this login.');
  const patch = {}; for (const k of self && !isSuper(ctx.user) ? ['name', 'whatsapp', 'email'] : ['name', 'role', 'whatsapp', 'email']) if (ctx.body[k] !== undefined) patch[k] = k === 'whatsapp' ? L.digits10(ctx.body[k]) : k === 'email' ? String(ctx.body[k]).trim() || null : ctx.body[k];
  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(patch.email)) throw httpError(400, 'Enter a valid email, or leave it empty', 'email');
  if (ctx.body.team !== undefined && isSuper(ctx.user) && !self) { if (!L.TEAMS.includes(ctx.body.team)) throw httpError(400, 'Pick the team', 'team'); patch.team = ctx.body.team; }
  return D.edit('users', t.id, patch, ctx.actor.label, ctx.ip);
});
route('POST', '/api/agencies', SUPER, (ctx) => {
  const b = ctx.body; const name = String(b.name || '').trim(); if (!name) throw httpError(400, 'Enter the agency name', 'name');
  if (get('SELECT 1 FROM agencies WHERE lower(name)=lower(?)', name)) throw httpError(400, 'An agency with this name already exists', 'name');
  // Check the admin's details before anything is saved, so a wrong number never leaves an agency behind.
  const adminName = String(b.admin_name || '').trim(); let phone = null; let email = null;
  if (adminName || b.admin_whatsapp) {
    if (!adminName) throw httpError(400, 'Enter the admin\'s name', 'admin_name');
    phone = L.digits10(b.admin_whatsapp); if (!L.validPhone(phone)) throw httpError(400, 'Enter the admin\'s 10-digit WhatsApp number', 'admin_whatsapp');
    email = String(b.admin_email || '').trim() || null; if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw httpError(400, 'Enter a valid email, or leave it empty', 'admin_email');
  }
  const id = D.nextId('AG');
  insert('agencies', { id, name, city: b.city || '', since: L.istDay(), status: 'Active', share_pct: b.share_pct === '' || b.share_pct === undefined ? null : Number(b.share_pct), created_at: now() });
  D.history(ctx.actor.label, 'create', id, null, null, name);
  let admin = null;
  if (adminName) {
    let username = usernameFrom(adminName); let i = 2; const base = username; while (get('SELECT 1 FROM users WHERE username=?', username)) username = `${base}${i++}`;
    const pw = L.newPassword(); const uid = D.nextId('U');
    insert('users', { id: uid, name: adminName, whatsapp: phone, email, level: 'admin', agency_id: id, role: 'Agency owner', username, pass_hash: L.hashPassword(pw), status: 'On', must_change: 1, failed: 0, created_by: ctx.user.id, created_at: now() });
    L.sendWA({ ptype: 'user', pid: uid, format: 'bbhs_team_login', vars: { username, password: pw, link: L.link('team') }, by: ctx.actor, rule: 'team_login', secret: pw, auto: true }); // quietly skipped while Meta has not approved it: the admin sees the password on screen
    admin = { id: uid, username, password: pw, name: adminName, whatsapp: phone, email };
  }
  return { id, admin };
});
route('PATCH', '/api/agencies/:id', SUPER, (ctx) => {
  const patch = {}; for (const k of ['name', 'city', 'share_pct']) if (ctx.body[k] !== undefined) patch[k] = ctx.body[k] === '' ? null : ctx.body[k];
  return D.edit('agencies', ctx.params.id, patch, ctx.actor.label, ctx.ip);
});
route('POST', '/api/agencies/:id/toggle', SUPER, (ctx) => {
  const a = get('SELECT * FROM agencies WHERE id=?', ctx.params.id); if (!a) throw httpError(404, 'Agency not found');
  const st = a.status === 'Active' ? 'Paused' : 'Active'; D.edit('agencies', a.id, { status: st }, ctx.actor.label, ctx.ip);
  if (st === 'Paused') D.run("DELETE FROM sessions WHERE kind='team' AND subject_id IN (SELECT id FROM users WHERE agency_id=?)", a.id);
  return { status: st };
});

// Deleting an agency: its people lose access, its work stays with BrillBrains, and nothing it is owed can be lost.
const agencyUse = (id) => ({ logins: all('SELECT 1 FROM users WHERE agency_id=?', id).length, clients: all('SELECT 1 FROM clients WHERE agency_id=?', id).length, jobs: all('SELECT 1 FROM jobs WHERE agency_id=?', id).length, candidates: all('SELECT 1 FROM candidates WHERE agency_id=?', id).length, payouts_due: all("SELECT 1 FROM bills WHERE agency_id=? AND payout_status='Due'", id).length });
route('GET', '/api/agencies/:id/use', SUPER, (ctx) => { if (!get('SELECT 1 FROM agencies WHERE id=?', ctx.params.id)) throw httpError(404, 'Agency not found'); return agencyUse(ctx.params.id); });
route('POST', '/api/agencies/:id/delete', SUPER, (ctx) => {
  const a = get('SELECT * FROM agencies WHERE id=?', ctx.params.id); if (!a) throw httpError(404, 'Agency not found');
  if (String((ctx.body || {}).name || '').trim().toLowerCase() !== a.name.trim().toLowerCase()) throw httpError(400, 'Type the agency name exactly', 'name');
  const use = agencyUse(a.id); if (use.payouts_due) throw httpError(400, `${use.payouts_due} payout(s) are still due to this agency. Pay them first.`);
  D.run("UPDATE users SET status='Off' WHERE agency_id=?", a.id);
  D.run("DELETE FROM sessions WHERE kind='team' AND subject_id IN (SELECT id FROM users WHERE agency_id=?)", a.id);
  for (const t of ['clients', 'jobs', 'candidates', 'expenses', 'revenue_logs']) D.run(`UPDATE ${t} SET agency_id=NULL WHERE agency_id=?`, a.id);
  D.run('DELETE FROM agencies WHERE id=?', a.id);
  D.history(ctx.actor.label, 'agency deleted', a.id, 'name', a.name, null, null, ctx.ip);
  return { ok: true, ...use };
});

// ---------- tasks: who owns what ----------
const canTask = (u, t) => isSuper(u) || !t.agency_id || t.agency_id === u.agency_id || taskOwnerIds(t).includes(u.id);
// Owners to pick from: the team, not the super admins (they see and do everything already).
const taskOwners = (u) => all("SELECT id, name, level, agency_id, team FROM users WHERE status='On' AND level IN ('super','admin','sub') ORDER BY CASE level WHEN 'super' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name").filter((x) => x.level === 'super' || isSuper(u) || !u.agency_id || x.agency_id === u.agency_id || x.id === u.id);
const taskOwnerIds = (t) => [...new Set([t.owner_id, ...(Array.isArray(t.owners) ? t.owners : [])].filter(Boolean))];
const taskRow = (t) => { const ids = taskOwnerIds(t); return { ...t, owners: ids, owner_name: ids.map((id) => (get('SELECT name FROM users WHERE id=?', id) || {}).name).filter(Boolean).join(', ') }; };
const loadTask = (ctx) => { const t = get('SELECT * FROM tasks WHERE id=? AND removed=0', ctx.params.id); if (!t || !canTask(ctx.user, t)) throw httpError(404, 'Task not found'); return t; };
const TASK_STATUS = ['Pending', 'In progress', 'Done'];
route('GET', '/api/tasks', T, (ctx) => {
  const u = ctx.user; const q = ctx.query; const rows = all('SELECT * FROM tasks WHERE removed=0 ORDER BY status=\'Done\', COALESCE(due_date, \'9999\'), area, at').filter((t) => canTask(u, t)); const owners = taskOwners(u);
  const list = rows.filter((t) => (!q.owner || (q.owner === 'none' ? !taskOwnerIds(t).length : taskOwnerIds(t).includes(q.owner))) && (!q.status || t.status === q.status) && (!q.area || t.area === q.area) && like(q.q, t.title, t.detail, t.area)).map(taskRow);
  const team = owners.map((x) => ({ ...x, open: rows.filter((t) => taskOwnerIds(t).includes(x.id) && t.status !== 'Done').length, done: rows.filter((t) => taskOwnerIds(t).includes(x.id) && t.status === 'Done').length }));
  return { rows: list, owners, team, areas: [...new Set(rows.map((t) => t.area).filter(Boolean))], statuses: TASK_STATUS, can_perf: u.level !== 'sub' };
});
route('GET', '/api/tasks/:id', T, (ctx) => taskRow(loadTask(ctx)));
const taskFields = (ctx, b, t) => {
  const title = String(b.title ?? (t || {}).title ?? '').trim(); if (!title) throw httpError(400, 'Write the task', 'title');
  // owners: a list (owner_id alone still works); the first is the main one
  const team = taskOwners(ctx.user);
  const ownersIn = Array.isArray(b.owners) ? b.owners : b.owner_id !== undefined ? (b.owner_id ? [b.owner_id] : []) : t ? taskOwnerIds(t) : [];
  const owners = [...new Set(ownersIn.filter(Boolean))]; if (owners.some((id) => !team.some((x) => x.id === id) && !(t ? taskOwnerIds(t) : []).includes(id))) throw httpError(400, 'Pick people from your team', 'owners');
  const owner = owners[0] || null;
  const status = TASK_STATUS.includes(b.status) ? b.status : (t || {}).status || 'Pending';
  return { title, detail: String(b.detail ?? (t || {}).detail ?? '').trim(), area: String(b.area ?? (t || {}).area ?? '').trim(), owner_id: owner, owners, due_date: b.due_date === undefined ? (t || {}).due_date || null : b.due_date || null, status, done_at: status === 'Done' ? (t && t.done_at) || now() : null, done_by: status === 'Done' ? (t && t.done_by) || ctx.actor.label : null };
};
const tellOwner = (ctx, t, before = []) => { for (const id of taskOwnerIds(t)) if (id !== ctx.user.id && !before.includes(id)) L.alertUser(id, `New task: ${t.title}`, t.id, true); };
route('POST', '/api/tasks', T, (ctx) => { const id = D.nextId('TK'); const r = { id, ...taskFields(ctx, ctx.body || {}), agency_id: ctx.user.agency_id || null, by: ctx.actor.label, at: now() }; insert('tasks', r); D.history(ctx.actor.label, 'create', id, null, null, r.title); tellOwner(ctx, r); return taskRow(get('SELECT * FROM tasks WHERE id=?', id)); });
route('PATCH', '/api/tasks/:id', T, (ctx) => { const t = loadTask(ctx); const r = taskFields(ctx, ctx.body || {}, t); update('tasks', t.id, r); D.history(ctx.actor.label, 'task', t.id, 'status', t.status, r.status); tellOwner(ctx, { ...t, ...r }, taskOwnerIds(t)); return taskRow(get('SELECT * FROM tasks WHERE id=?', t.id)); });
route('POST', '/api/tasks/:id/delete', T, (ctx) => { const t = loadTask(ctx); update('tasks', t.id, { removed: 1 }); D.history(ctx.actor.label, 'task removed', t.id); return { ok: true }; });

// ---------- campaigns to candidates on WhatsApp and email ----------
// Who gets it: the ticked candidates or a saved segment. STOP and no consent are always left out; the send time can follow each person's window.
const CHANNELS = ['preferred', 'whatsapp', 'email', 'both'];
// kind template: any approved WhatsApp template (studio), kind design: a saved email design (studio).
// segments: one or more saved segments (people in several are sent once). send_at: one time for everyone.
const campaignAudience = (b, u) => {
  const segIds = [...new Set([...(Array.isArray(b.segments) ? b.segments : []), ...(b.segment ? [b.segment] : [])].map(String))];
  if (segIds.length) {
    const segs = segIds.map((sid) => { const s = segVisible(u).find((x) => String(x.id) === sid); if (!s) throw httpError(404, 'Segment not found'); return s; });
    const byId = new Map(); for (const s of segs) for (const c of candRows(segQuery(s.query), u)) if (!byId.has(c.id)) byId.set(c.id, c);
    return { people: [...byId.values()], audience: `${segs.length > 1 ? 'Segments' : 'Segment'}: ${segs.map((s) => s.name).join(', ')}`, segments: segIds };
  }
  const people = (b.ids || []).map((id) => get('SELECT * FROM candidates WHERE id=? AND removed=0', id)).filter(Boolean);
  return { people, audience: `${people.length} ticked`, segments: [] };
};
route('GET', '/api/campaigns/audience', T, (ctx) => { const q = ctx.query || {}; const r = campaignAudience({ segments: String(q.segments || '').split(',').filter(Boolean), ids: String(q.ids || '').split(',').filter(Boolean) }, ctx.user); return { total: r.people.length, audience: r.audience, first: r.people[0] ? r.people[0].id : null }; });
route('POST', '/api/campaigns', T, async (ctx) => {
  const M = require('./mailer'); const S = require('./studio'); const b = ctx.body || {}; const u = ctx.user; const kind = ['job', 'prefs', 'template', 'design'].includes(b.kind) ? b.kind : 'message'; let channel = CHANNELS.includes(b.channel) ? b.channel : 'preferred'; const timing = b.timing === 'preferred' ? 'preferred' : 'now';
  if (kind === 'template') channel = 'whatsapp'; if (kind === 'design') channel = 'email';
  const job = ['job', 'template', 'design'].includes(kind) && b.job_id ? get('SELECT * FROM jobs WHERE id=?', String(b.job_id)) : null; if (kind === 'job' && !job) throw httpError(400, 'Pick the job', 'job_id');
  const text = String(b.body || '').trim(); let subject = String(b.subject || '').trim(); if (kind === 'message' && !text) throw httpError(400, 'Write the message', 'body'); if (kind === 'message' && channel !== 'whatsapp' && !subject) throw httpError(400, 'Write the email subject', 'subject');
  let sendAt = null; if (b.send_at) { const d = new Date(b.send_at); if (Number.isNaN(d.getTime())) throw httpError(400, 'Pick a valid send time', 'send_at'); if (d < new Date(Date.now() - 60000)) throw httpError(400, 'The send time has passed', 'send_at'); if (d > new Date(Date.now() + 60 * 86400000)) throw httpError(400, 'Schedule at most 60 days ahead', 'send_at'); sendAt = d.toISOString(); }
  const tpl = kind === 'template' ? S.campaignTemplate(b.tpl) : null; const tmap = (b.tpl && b.tpl.map) || {};
  const design = kind === 'design' ? S.designRow(String(b.design_id || '')) : null; if (kind === 'design' && !design) throw httpError(400, 'Pick the email design', 'design_id');
  if (design && !subject) subject = design.subject; if (kind === 'design' && !subject) throw httpError(400, 'Write the email subject', 'subject');
  const { people, audience, segments } = campaignAudience(b, u);
  if (!people.length) throw httpError(400, 'Nobody to send to');
  const media = tpl && tpl.header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tpl.header.format) ? await S.headerMedia(String((b.tpl || {}).media_key || '')) : null;
  const cap = D.settings().bulk_budget; const id = D.nextId('CM'); const out = { wa: 0, email: 0, skipped: {} }; const skip = (why) => { out.skipped[why] = (out.skipped[why] || 0) + 1; };
  const news = D.settings().formats.bbhs_candidate_news; const waFormat = kind === 'job' ? 'bbhs_job_alert' : kind === 'prefs' ? 'bbhs_contact_prefs' : 'bbhs_candidate_news'; const waReady = kind === 'job' || ((D.settings().formats[waFormat] || {}).approved);
  const link = L.link('my-profile'); const fill = (t, c) => String(t).replace(/\{name\}/g, c.name || 'there');
  people.forEach((p, n) => {
    const c = get('SELECT * FROM candidates WHERE id=?', p.id); if (n >= cap) return skip(`Over the limit of ${cap} per campaign`);
    if (c.opted_out) return skip('Said STOP'); if (!c.consent_alerts) return skip('No consent for messages');
    const when = timing === 'preferred' ? L.nextPreferred(c) : sendAt;
    if (kind === 'template') {
      if (!c.whatsapp) return skip('No WhatsApp number');
      let t; try { t = S.filled(tpl, tmap, S.mergeVars(c, job), media); } catch (e) { if (e.skip) return skip(e.message); throw e; }
      try { const r = L.sendWA({ ptype: 'candidate', pid: c.id, template: t, jb: job ? job.id : null, by: ctx.actor, bulk: true, noEmailCopy: true, sendLater: when || undefined, dedupe: `camp:${id}:${c.id}` }); if (r.skipped) skip(r.skipped); else out.wa++; } catch (e) { skip(e.message); }
      return;
    }
    if (kind === 'design') {
      if (!c.email) return skip('No email');
      const vars = S.mergeVars(c, job); const sub = S.fillText(subject, vars); const m = S.renderDesign(design, vars, sub);
      if (M.queue({ to: c.email, subject: sub, text: m.text, html: m.html, kind: 'campaign', recordId: c.id, sendAfter: when || undefined, dedupe: `camp:${id}:${c.id}:mail` })) out.email++; else skip('Email not valid');
      return;
    }
    let wa = channel === 'whatsapp' || channel === 'both'; let mail = channel === 'email' || channel === 'both';
    if (kind === 'prefs') { wa = true; mail = false; } else if (channel === 'preferred') { if (c.pref_channel === 'Email' && c.email) mail = true; else if (c.whatsapp) wa = true; else mail = true; }
    if (wa && !waReady) { wa = false; if (channel === 'preferred' && c.email) mail = true; skip('WhatsApp format waiting for Meta approval'); }
    if (wa && !c.whatsapp) { wa = false; skip('No WhatsApp number'); }
    if (mail && !c.email) { mail = false; skip('No email'); }
    if (wa) { try { const r = L.sendWA({ ptype: 'candidate', pid: c.id, format: waFormat, vars: kind === 'job' ? { job: job.title, city: job.city, salary: L.SAL_HIDDEN } : kind === 'prefs' ? {} : { message: fill(text, c) }, rule: kind === 'prefs' ? 'pref1-bulk' : undefined, jb: job ? job.id : null, by: ctx.actor, bulk: true, noEmailCopy: true, sendLater: when || undefined, dedupe: `camp:${id}:${c.id}` }); if (r.skipped) skip(r.skipped); else out.wa++; } catch (e) { skip(e.message); } }
    if (mail) {
      const sub = kind === 'job' ? `New job: ${job.title}, ${job.city}` : fill(subject, c); const body = kind === 'job' ? `Hello ${c.name || 'there'},\n\nWe have a ${job.title} opening in ${job.city}. If you are interested, reply to this email or open your profile: ${link}\n\nBrillBrains Hiring Solutions` : `${fill(text, c)}\n\nBrillBrains Hiring Solutions`;
      const html = M.layout(sub, body.split(/\n{2,}/).map((x) => `<p style="font-size:14px;line-height:1.65;margin:0 0 12px">${x.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])).replace(/\n/g, '<br>')}</p>`).join(''));
      if (M.queue({ to: c.email, subject: sub, text: body, html, kind: 'campaign', recordId: c.id, sendAfter: when || undefined, dedupe: `camp:${id}:${c.id}:mail` })) out.email++; else skip('Email not valid');
    }
  });
  const autoName = kind === 'template' ? `WhatsApp: ${tpl.name}` : kind === 'design' ? `Email: ${design.name}` : job ? `Job alert: ${job.title}` : kind === 'prefs' ? 'Contact preferences' : subject || text.slice(0, 40);
  insert('campaigns', { id, name: String(b.name || '').trim() || autoName, kind, job_id: job ? job.id : null, subject, body: kind === 'template' ? tpl.body : text, channel, timing, audience, total: people.length, wa: out.wa, email: out.email, skipped: JSON.stringify(out.skipped), user_id: u.id, agency_id: u.agency_id || null, by: ctx.actor.label, at: now(), segments: JSON.stringify(segments), send_at: sendAt, tpl: tpl ? JSON.stringify({ key: tpl.key, name: tpl.name, language: tpl.language, map: tmap, media_key: (b.tpl || {}).media_key || null }) : null, design_id: design ? design.id : null });
  D.history(ctx.actor.label, 'campaign', id, null, null, `${out.wa} WhatsApp, ${out.email} email to ${audience}${sendAt ? ` at ${sendAt}` : ''}`); return { id, ...out, total: people.length, send_at: sendAt };
});
// Stop a scheduled campaign: whatever has not gone yet is taken off.
route('POST', '/api/campaigns/:id/cancel', T, (ctx) => {
  const x = get('SELECT * FROM campaigns WHERE id=?', ctx.params.id); if (!x || !seeCampaign(ctx.user, x)) throw httpError(404, 'Campaign not found');
  const wa = D.run("DELETE FROM messages WHERE direction='out' AND status='scheduled' AND dedupe LIKE ?", `camp:${x.id}:%`).changes; const mail = D.run("DELETE FROM emails WHERE status='scheduled' AND dedupe LIKE ?", `camp:${x.id}:%`).changes;
  D.history(ctx.actor.label, 'campaign cancelled', x.id, null, null, `${wa} WhatsApp, ${mail} email taken off`); return { wa, email: mail };
});
// What happened to each campaign, by channel, read from the messages and emails it made (they carry the campaign in their key).
const WA_STEP = { sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed' };
const waState = (st) => WA_STEP[st] || (st === 'held' ? 'On hold' : st === 'scheduled' ? 'Scheduled' : st === 'would send' ? 'Not sent (test copy)' : 'Sending');
const mailState = (st) => (st === 'sent' ? 'Sent' : st === 'failed' ? 'Failed' : st === 'held' ? 'On hold' : st === 'scheduled' ? 'Scheduled' : /not sent/.test(st || '') ? 'Not sent (email not set up)' : 'Sending');
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
function campaignStats(x) {
  const wa = all("SELECT * FROM messages WHERE direction='out' AND dedupe LIKE ?", `camp:${x.id}:%`); const mails = all('SELECT * FROM emails WHERE dedupe LIKE ?', `camp:${x.id}:%`);
  const count = (list, f) => list.reduce((m, r) => { const k = f(r.status); m[k] = (m[k] || 0) + 1; return m; }, {});
  const w = count(wa, waState); const e = count(mails, mailState); const out = (o, ks) => ks.reduce((t, k) => t + (o[k] || 0), 0);
  const waTried = out(w, ['Sent', 'Delivered', 'Read', 'Failed']); const waReached = out(w, ['Delivered', 'Read']); const mailTried = out(e, ['Sent', 'Failed']);
  const people = [...new Set([...wa.map((m) => m.person_id), ...mails.map((m) => m.record_id)])];
  const ids = people.length ? `(${people.map(() => '?').join(',')})` : "('')";
  const replied = new Set(all(`SELECT DISTINCT person_id FROM messages WHERE person_type='candidate' AND direction='in' AND at>=? AND person_id IN ${ids}`, x.at, ...people).map((r) => r.person_id)).size;
  const applied = x.job_id ? all(`SELECT DISTINCT candidate_id FROM applications WHERE job_id=? AND created_at>=? AND candidate_id IN ${ids}`, x.job_id, x.at, ...people).length : null;
  const stopped = all(`SELECT DISTINCT person_id FROM consents WHERE person_type='candidate' AND at>=? AND what LIKE 'Opted out%' AND person_id IN ${ids}`, x.at, ...people).length;
  // Button taps and replies to this campaign's messages, by what they said.
  const refs = wa.map((m) => m.id); const taps = {};
  if (refs.length) for (const r of all(`SELECT text FROM messages WHERE direction='in' AND reply_to IN (${refs.map(() => '?').join(',')})`, ...refs)) { const k = String(r.text || '').trim().slice(0, 40) || '(no text)'; taps[k] = (taps[k] || 0) + 1; }
  return { taps, whatsapp: { total: wa.length, by: w, delivered_rate: pct(waReached, waTried), read_rate: pct(w.Read || 0, waTried), failed: w.Failed || 0 }, email: { total: mails.length, by: e, sent_rate: pct(e.Sent || 0, mailTried), failed: e.Failed || 0 }, reached: people.length, replied, reply_rate: pct(replied, people.length), applied, stopped };
}
const seeCampaign = (u, x) => isSuper(u) || x.user_id === u.id || (x.agency_id && x.agency_id === u.agency_id);
const campRow = (x) => ({ ...x, skipped: JSON.parse(x.skipped || '{}'), job_title: x.job_id ? (get('SELECT title FROM jobs WHERE id=?', x.job_id) || {}).title : '', stats: campaignStats(x) });
route('GET', '/api/campaigns', T, (ctx) => {
  const q = ctx.query || {}; const rows = all('SELECT * FROM campaigns ORDER BY at DESC LIMIT 500').filter((x) => seeCampaign(ctx.user, x) && (!q.from || x.at.slice(0, 10) >= q.from) && (!q.to || x.at.slice(0, 10) <= q.to) && (!q.kind || x.kind === q.kind) && like(q.q, x.name, x.audience, x.by)).map(campRow);
  const sum = (f) => rows.reduce((t, r) => t + (f(r) || 0), 0); const tried = (r, ks) => ks.reduce((t, k) => t + (r.stats.whatsapp.by[k] || 0), 0);
  const waTried = sum((r) => tried(r, ['Sent', 'Delivered', 'Read', 'Failed'])); const waReached = sum((r) => tried(r, ['Delivered', 'Read'])); const mailTried = sum((r) => (r.stats.email.by.Sent || 0) + (r.stats.email.by.Failed || 0));
  return { rows, totals: { campaigns: rows.length, whatsapp: sum((r) => r.stats.whatsapp.total), email: sum((r) => r.stats.email.total), wa_delivered_rate: pct(waReached, waTried), wa_read_rate: pct(sum((r) => r.stats.whatsapp.by.Read), waTried), email_sent_rate: pct(sum((r) => r.stats.email.by.Sent), mailTried), replied: sum((r) => r.stats.replied), reached: sum((r) => r.stats.reached) }, segments: segVisible(ctx.user).map((x) => [x.id, x.name]) };
});
route('GET', '/api/campaigns/:id', T, (ctx) => {
  const x = get('SELECT * FROM campaigns WHERE id=?', ctx.params.id); if (!x || !seeCampaign(ctx.user, x)) throw httpError(404, 'Campaign not found');
  const name = (id) => (get('SELECT name FROM candidates WHERE id=?', id) || {}).name || id; const replied = (id) => !!get("SELECT 1 FROM messages WHERE person_type='candidate' AND person_id=? AND direction='in' AND at>=?", id, x.at);
  const people = {};
  for (const m of all("SELECT * FROM messages WHERE direction='out' AND dedupe LIKE ?", `camp:${x.id}:%`)) people[m.person_id] = { ...(people[m.person_id] || {}), id: m.person_id, whatsapp: waState(m.status), wa_error: m.error || '' };
  for (const m of all('SELECT * FROM emails WHERE dedupe LIKE ?', `camp:${x.id}:%`)) people[m.record_id] = { ...(people[m.record_id] || {}), id: m.record_id, email: mailState(m.status), mail_error: m.error || '' };
  return { ...campRow(x), people: Object.values(people).map((p) => ({ ...p, name: name(p.id), replied: replied(p.id) })) };
});
route('GET', '/api/contact-prefs', T, () => L.PREF);
// The message they will get, shown before sending.
route('GET', '/api/candidates/:id/ask-prefs', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.params.id); if (!c) throw httpError(404, 'Candidate not found'); if (!c.whatsapp) throw httpError(400, 'This candidate has no WhatsApp number.');
  const f = D.settings().formats.bbhs_contact_prefs; const lang = c.language && f[c.language] ? c.language : 'en';
  return { text: L.fillFormat('bbhs_contact_prefs', lang, { name: String(c.name || '').split(' ')[0] }), buttons: f.buttons, approved: !!f.approved };
});
// One candidate, asked on WhatsApp with tap buttons. A recruiter pressing it sends it even while messages are off.
route('POST', '/api/candidates/:id/ask-prefs', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.params.id); if (!c) throw httpError(404, 'Candidate not found'); if (!c.whatsapp) throw httpError(400, 'This candidate has no WhatsApp number.');
  if (!D.settings().formats.bbhs_contact_prefs.approved) throw httpError(400, 'The preferences message is waiting for Meta approval. Send it from Settings → Message formats.');
  const r = L.sendWA({ ptype: 'candidate', pid: c.id, format: 'bbhs_contact_prefs', vars: {}, rule: 'pref1', by: ctx.actor, noEmailCopy: true }); if (r.skipped) throw httpError(400, `Not sent: ${r.skipped}`); return { ok: true };
});

// ---------- departments & roles (every team level) ----------
// The same lists Settings edits (departments, and each industry's groups of jobs), so job openings, the job-seeker
// form and the candidate filters pick up a new role at once. Anyone in the team can add; hiding or renaming stays in Settings.
function roleCatalog(industry) {
  const s = D.settings(); const name = industry && s.industries[industry] ? industry : s.default_industry && s.industries[s.default_industry] ? s.default_industry : Object.keys(s.industries)[0];
  const groups = s.industries[name].groups; const hidden = new Set(s.hidden_jobs || []);
  const wanted = Object.fromEntries(all('SELECT job_wanted, COUNT(*) n FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0 GROUP BY job_wanted').map((r) => [r.job_wanted, r.n]));
  const depts = [...new Set([...(s.departments || []), ...Object.values(groups).map((g) => g.dept)])];
  return { industry: name, industries: Object.keys(s.industries), departments: depts.map((d) => ({ name: d, roles: Object.values(groups).filter((g) => g.dept === d).flatMap((g) => g.jobs).map((t) => ({ title: t, hidden: hidden.has(t), candidates: wanted[t] || 0 })) })) };
}
const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
route('GET', '/api/roles', T, (ctx) => roleCatalog(ctx.query.industry));
route('POST', '/api/roles/department', T, (ctx) => {
  const name = String(ctx.body.name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw httpError(400, 'Type the department name', 'name');
  if (name.length > 40) throw httpError(400, 'Keep the name under 40 letters', 'name');
  const s = D.settings(); const known = [...(s.departments || []), ...Object.values(s.industries).flatMap((i) => Object.values(i.groups).map((g) => g.dept))];
  if (known.some((d) => sameText(d, name))) throw httpError(400, 'This department already exists', 'name');
  D.setSetting('departments', [...(s.departments || []), name]);
  D.history(ctx.actor.label, 'add department', 'settings', 'departments', null, name);
  return { ok: true, name };
});
route('POST', '/api/roles/role', T, (ctx) => {
  const title = String(ctx.body.title || '').trim().replace(/\s+/g, ' '); const dept = String(ctx.body.department || '').trim();
  if (!title) throw httpError(400, 'Type the role name', 'title');
  if (title.length > 60) throw httpError(400, 'Keep the role under 60 letters', 'title');
  const cat = roleCatalog(ctx.body.industry);
  if (!cat.departments.some((d) => d.name === dept)) throw httpError(400, 'Pick a department', 'department');
  const s = D.settings();
  for (const [indName, ind] of Object.entries(s.industries)) for (const g of Object.values(ind.groups)) {
    const hit = g.jobs.find((j) => sameText(j, title)); if (hit) throw httpError(400, `"${hit}" already exists under ${g.dept}${indName !== cat.industry ? ` (${indName})` : ''}`, 'title');
  }
  // Goes into the department's group (the one named after it if there are several); a new department gets its own group.
  const inds = JSON.parse(JSON.stringify(s.industries)); const groups = inds[cat.industry].groups;
  const mine = Object.entries(groups).filter(([, g]) => g.dept === dept);
  const key = (mine.find(([k]) => sameText(k, dept)) || mine[0] || [dept])[0];
  groups[key] = groups[key] || { dept, jobs: [] }; groups[key].jobs.push(title);
  D.setSetting('industries', inds);
  D.history(ctx.actor.label, 'add role', 'settings', 'industries', null, `${title} (${dept})`);
  return { ok: true, title, department: dept };
});

// ---------- settings (super admin) ----------
const EDITABLE = ['ticket', 'team_login', 'languages', 'aftercare', 'google_review_url', 'eval_criteria', 'call_topics', 'call_gate', 'accounts_email', 'resume_alert_pct', 'expense_tree', 'expense_accounts', 'revenue_kinds', 'call_script', 'email_templates', 'creative_template', 'hiring_channels', 'landing_roles', 'wa_pause', 'business', 'industries', 'default_industry', 'hidden_jobs', 'departments', 'cities', 'skills', 'client_stages', 'closing_reasons', 'job_close_reasons', 'reopen_reasons', 'lead_sources', 'src_tags', 'fee', 'agency_share_pct', 'gst', 'replacement_days', 'payment_days', 'targets', 'log_deadline', 'quiet', 'daily_limit', 'bulk_budget', 'match', 'languages', 'id_start', 'bill_prefix', 'retention_years', 'team_idle_hours', 'formats', 'auto_rules', 'crm', 'posting_channels', 'gap_targets', 'templates', 'jd_template', 'jd_templates', 'lead_auto_assign', 'jd_sections', 'backup_email'];
// Everyone in the team can set up what goes out. Connection secrets and the checks on the team's own activity stay with the super admin.
const SUPER_ONLY = ['backup_drive', 'backup_email', 'lead_auto_assign', 'ticket', 'crm', 'resume_alert_pct', 'call_gate', 'google_review_url', 'team_login'];
route('GET', '/api/settings', T, (ctx) => { const s = { ...D.settings() }; if (!isSuper(ctx.user)) { for (const k of SUPER_ONLY) delete s[k]; return s; } s.crm = { ...s.crm, token: s.crm.token ? '••••••••' : '', webhook_secret: s.crm.from_env && s.crm.from_env.webhook_secret ? '••••••••' : s.crm.webhook_secret }; return s; });
route('POST', '/api/health/mail', SUPER, async () => require('./mailbox').check());
route('POST', '/api/health/email', SUPER, (ctx) => {
  const M = require('./mailer'); if (!M.configured()) throw httpError(400, 'Outgoing email is not set up yet (SMTP_HOST and SMTP_FROM in .env).');
  const to = ctx.body.to || D.ENV.notifyEmails[0]; if (!to) throw httpError(400, 'Type an address to send the test to', 'to');
  const id = M.testEmail(to); if (!id) throw httpError(400, 'That email address does not look right', 'to');
  return { id, to };
});
route('GET', '/api/health/emails', SUPER, () => all('SELECT id, to_addr, subject, kind, status, tries, error, at, sent_at FROM emails ORDER BY id DESC LIMIT 50'));
route('PUT', '/api/settings/:key', T, (ctx) => {
  if (!isSuper(ctx.user) && SUPER_ONLY.includes(ctx.params.key)) throw httpError(403, 'This setting is for the super admin.');
  const k = ctx.params.key; if (!EDITABLE.includes(k)) throw httpError(400, 'This setting cannot be changed here.');
  const old = D.settings()[k]; let v = ctx.body.value;
  if (k === 'crm') { const raw = JSON.parse(D.db.prepare('SELECT value FROM settings WHERE key=?').get('crm').value); if (v.token === '••••••••') v = { ...v, token: raw.token }; if (v.webhook_secret === '••••••••') v = { ...v, webhook_secret: raw.webhook_secret }; delete v.from_env; }
  if (k === 'id_start') { for (const [p, n] of Object.entries(v)) { const cur = get('SELECT next FROM counters WHERE name=?', p); if (cur && Number(n) > cur.next) D.run('UPDATE counters SET next=? WHERE name=?', Number(n), p); } }
  D.setSetting(k, v); D.history(ctx.actor.label, 'setting', 'settings', k, k === 'crm' ? '(hidden)' : old, k === 'crm' ? '(hidden)' : v);
  return { ok: true };
});
// ---------- formats → Meta templates through the CRM ----------
function crmBase() {
  const c = D.settings().crm;
  if (!c.send_url || !c.token) throw httpError(400, 'Set the CRM send link and token first (Settings → WhatsApp).');
  return c.send_url.replace(/\/send\/?$/, '');
}
module.exports.crmCall = (...a) => crmCall(...a);
async function crmCall(path, method, body) {
  const res = await fetch(crmBase() + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${D.settings().crm.token}` }, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(502, `CRM answered ${res.status}: ${out.error || 'no details'}`);
  return out;
}
// "Hello {name}, … {link}" → "Hello {{1}}, … {{2}}." — Meta numbers blanks by position and rejects a body that ends with one.
function metaBody(text) {
  const order = [...new Set((text.match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1)))];
  let body = text.replace(/\{(\w+)\}/g, (m, k) => `{{${order.indexOf(k) + 1}}}`);
  if (/\}\}\s*$/.test(body)) body = body.replace(/\s*$/, '.');
  return { body, order };
}
route('POST', '/api/settings/formats/push', T, async (ctx) => pushFormats(ctx.body.names || [], ctx.actor.label));
async function pushFormats(namesIn, who) {
  const s = D.settings(); const names = namesIn.filter((k) => s.formats[k]);
  if (!names.length) throw httpError(400, 'Select the formats to send.');
  // Meta refuses a name and language it already has ("Invalid parameter"), so those are left out and said so.
  const have = {}; for (const t of (await crmCall('/templates', 'GET')).templates || []) (have[t.name] = have[t.name] || {})[t.language] = t.status;
  const templates = []; const skipped = [];
  for (const name of names) {
    const f = s.formats[name]; if (!f) continue;
    for (const lang of s.languages) {
      if (!f[lang]) continue; const st = (have[name] || {})[lang];
      if (st) skipped.push({ name, language: lang, ok: false, skipped: true, error: st === 'APPROVED' ? 'Already approved on Meta' : st === 'REJECTED' ? 'Rejected earlier: Meta keeps the name, so change it in WhatsApp Manager or give the format a new name' : `Already with Meta (${st.toLowerCase()})` });
      else templates.push({ name, category: f.type.toUpperCase(), language: lang, body: metaBody(f[lang]).body, buttons: f.buttons });
    }
  }
  const out = templates.length ? await crmCall('/templates', 'POST', { templates }) : { results: [] };
  // Remember what Meta now holds, so the list shows "waiting for Meta" straight away (not "not sent").
  { const fm = JSON.parse(JSON.stringify(D.settings().formats)); const mark = (name, lang, st) => { if (!fm[name] || !st) return; fm[name].meta_status = { ...(fm[name].meta_status || {}), [lang]: st }; if (lang === 'en' || !fm[name].en) fm[name].approved = st === 'APPROVED'; };
    for (const r of out.results || []) if (r.ok) mark(r.name, r.language, String(r.status || 'PENDING').toUpperCase());
    for (const t of templates) if (!(out.results || []).some((r) => r.name === t.name && r.language === t.language)) mark(t.name, t.language, 'PENDING'); // CRM gave no per-template answer: it took them
    for (const x of skipped) mark(x.name, x.language, (have[x.name] || {})[x.language]);
    D.setSetting('formats', fm); }
  const hint = (e) => (/invalid parameter/i.test(e || '') ? `${e}: usually the name was used before (deleted in the last 4 weeks) or a blank sits at the very start or end` : e);
  D.history(who, 'templates sent to Meta', null, null, null, `${templates.length} templates`);
  return { ...out, results: [...(out.results || []).map((r) => (r.ok ? r : { ...r, error: hint(r.error) })), ...skipped] };
}
// One time, on the copy where the CRM is set up: the two vendor outreach messages go to Meta for approval.
setTimeout(async () => {
  try {
    const s = D.settings(); if (D.ENV.name !== "live" || (s.done_once || []).includes("push_partner_formats") || !s.crm || !s.crm.send_url || !s.crm.token) return;
    const r = await pushFormats(['bbhs_partner_outreach', 'bbhs_partner_followup'], 'System (vendor messages)');
    console.log('vendor formats sent to Meta:', JSON.stringify(r.results || r).slice(0, 600));
    D.setHealth('partner_formats_push', `${D.now()} ${JSON.stringify(r.results || []).slice(0, 400)}`);
    D.setSetting('done_once', [...(D.settings().done_once || []), 'push_partner_formats']);
  } catch (e) { console.error('vendor formats push failed:', e.message); }
}, 15000);
async function syncFormats(by) {
  const out = await crmCall('/templates', 'GET');
  const s = D.settings(); const formats = JSON.parse(JSON.stringify(s.formats)); const seen = {};
  for (const t of out.templates || []) {
    if (!formats[t.name]) continue;
    (seen[t.name] = seen[t.name] || {})[t.language] = t.status;
  }
  for (const [name, langs] of Object.entries(seen)) {
    formats[name].meta_status = langs;
    // English is what everyone falls back to, so its approval decides whether the format can be sent.
    formats[name].approved = (langs.en || Object.values(langs)[0]) === 'APPROVED';
  }
  D.setSetting('formats', formats);
  if (by) D.history(by, 'templates status from Meta', null, null, null, `${Object.keys(seen).length} formats`);
  return { formats: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v])), missing: Object.keys(formats).filter((k) => !seen[k]) };
}
route('POST', '/api/settings/formats/sync', T, (ctx) => syncFormats(ctx.actor.label));
// Every 30 minutes (from the timer) while any template waits for Meta: approvals show up without pressing anything.
module.exports.autoSyncFormats = async () => {
  const s = D.settings(); if (!s.crm || !s.crm.send_url || !s.crm.token) return 0;
  const waiting = Object.values(s.formats || {}).some((x) => Object.values(x.meta_status || {}).some((st) => !['APPROVED', 'REJECTED'].includes(st)));
  const last = get("SELECT value FROM health WHERE key='formats_synced'"); if (!waiting && last) return 0; // the first run checks once anyway (templates sent before this was saved)
  if (last && Date.now() - new Date(last.value) < 29 * 60000) return 0;
  D.setHealth('formats_synced', now()); await syncFormats(null); return 1;
};

route('POST', '/api/settings/remove-sample', SUPER, (ctx) => {
  D.tx(() => {
    for (const t of ['interviews', 'bills']) D.run(`DELETE FROM ${t} WHERE is_sample=1`);
    D.run('DELETE FROM app_history WHERE app_id IN (SELECT id FROM applications WHERE is_sample=1)');
    D.run('DELETE FROM applications WHERE is_sample=1');
    D.run('DELETE FROM job_history WHERE job_id IN (SELECT id FROM jobs WHERE is_sample=1)'); D.run('DELETE FROM postings WHERE job_id IN (SELECT id FROM jobs WHERE is_sample=1)');
    D.run('DELETE FROM jobs WHERE is_sample=1');
    D.run("DELETE FROM messages WHERE (person_type='candidate' AND person_id IN (SELECT id FROM candidates WHERE is_sample=1)) OR (person_type='client' AND person_id IN (SELECT id FROM clients WHERE is_sample=1))");
    D.run('DELETE FROM candidates WHERE is_sample=1'); D.run('DELETE FROM clients WHERE is_sample=1'); D.run('DELETE FROM tieups WHERE is_sample=1');
  });
  D.history(ctx.actor.label, 'remove sample data'); return { ok: true };
});
// System health (Settings › Health). Its own address: /api/health is the business dashboard.
route('GET', '/api/system-health', SUPER, () => {
  const h = Object.fromEntries(all('SELECT * FROM health').map((r) => [r.key, r.value]));
  const fs = require('fs'); const path = require('path');
  let bytes = 0; for (const f of fs.readdirSync(path.join(D.DATA_DIR, 'files'))) bytes += fs.statSync(path.join(D.DATA_DIR, 'files', f)).size;
  const dbBytes = fs.statSync(path.join(D.DATA_DIR, 'bbhs.db')).size;
  return { ...h, failed: all("SELECT * FROM messages WHERE status='failed' ORDER BY at DESC LIMIT 50"), scheduled: get("SELECT COUNT(*) c FROM messages WHERE status='scheduled'").c, files_mb: (bytes / 1048576).toFixed(2), db_mb: (dbBytes / 1048576).toFixed(2), backups: fs.readdirSync(path.join(D.DATA_DIR, 'backups')).filter((f) => f.endsWith('.db')).sort().reverse().slice(0, 30), crm_enabled: D.settings().crm.enabled,
    setup: { copy: D.ENV.name, virus_scanner: D.ENV.clamd.host ? `ClamAV at ${D.ENV.clamd.host}:${D.ENV.clamd.port}` : 'Not set — only the EICAR test file is blocked (set CLAMD_HOST)', alerts: D.ENV.alertWebhook ? 'Alert webhook set' : 'Not set (ALERT_WEBHOOK_URL)', offsite_backup: D.ENV.backupDir || 'Not set (BACKUP_DIR)', email_inbox: D.ENV.imap.host ? `${D.ENV.imap.user} on ${D.ENV.imap.host}` : 'Not set (IMAP_HOST, IMAP_USER, IMAP_PASS)', outgoing_email: D.ENV.smtp.host ? `${D.ENV.smtp.from} via ${D.ENV.smtp.host}:${D.ENV.smtp.port}` : 'Not set (SMTP_HOST, SMTP_FROM, SMTP_USER, SMTP_PASS)', notify_emails: D.ENV.notifyEmails.join(', ') || 'Not set (NOTIFY_EMAILS)', whatsapp: D.settings().crm.enabled ? `Connected via ${D.settings().crm.send_url}` : 'Not connected (CRM_ENABLED, CRM_SEND_URL, CRM_TOKEN, CRM_WEBHOOK_SECRET)' } };
});
route('POST', '/api/health/backup', SUPER, (ctx) => { const f = D.backup(); D.history(ctx.actor.label, 'backup'); return { file: require('path').basename(f) }; });
route('POST', '/api/health/restore-test', SUPER, (ctx) => { const r = D.testRestore(); D.setHealth('last_restore_test', `${now()} ${r.ok ? 'OK' : 'failed'}`); D.history(ctx.actor.label, 'restore test', null, null, null, JSON.stringify(r)); return r; });
route('POST', '/api/health/timer', SUPER, () => require('./timer').runTimer());
route('GET', '/api/data-requests', SUPER, () => all('SELECT * FROM data_requests ORDER BY at DESC').map((r) => ({ ...r, name: V.threadName(r.person_type, r.person_id) })));
route('POST', '/api/data-requests/:id/:decision', SUPER, (ctx) => {
  const r = get('SELECT * FROM data_requests WHERE id=?', ctx.params.id); if (!r || r.status !== 'Waiting') throw httpError(400, 'Request not open');
  if (ctx.params.decision === 'approve' && r.kind === 'delete') removePerson(r.person_type, r.person_id, ctx.actor.label);
  update('data_requests', r.id, { status: ctx.params.decision === 'approve' ? 'Done' : 'Rejected', decided_by: ctx.actor.label, decided_at: now() });
  return { ok: true };
});
// Delete my data: personal details and files go; IDs, bills and counts stay as "Removed person".
function removePerson(ptype, pid, who) {
  const fs = require('fs'); const path = require('path');
  for (const f of all('SELECT * FROM files WHERE record_id=? OR record_id IN (SELECT id FROM applications WHERE candidate_id=?)', pid, pid)) { try { fs.unlinkSync(path.join(D.DATA_DIR, 'files', f.path)); } catch { /* already gone */ } D.run('DELETE FROM files WHERE id=?', f.id); }
  if (ptype === 'candidate') update('candidates', pid, { name: 'Removed person', whatsapp: '', email: '', city: '', current_company: '', cv_file: null, short_cv_file: null, skills: [], work_cities: [], removed: 1, archived: 1 });
  else update('clients', pid, { contact: 'Removed person', company: 'Removed person', whatsapp: '', email: '', kyc: {}, extra: {}, removed: 1, archived: 1 });
  D.run('UPDATE messages SET text=?, phone=? WHERE person_type=? AND person_id=?', '(removed)', '', ptype, pid);
  D.run('DELETE FROM notes WHERE record_id=?', pid);
  D.history(who, 'data deleted', pid);
}

// ---------- bell, notes, follow-ups, history, files ----------
route('GET', '/api/alerts', { ...T, channels: true, accounts: true }, (ctx) => all('SELECT * FROM alerts WHERE user_id=? ORDER BY at DESC LIMIT 50', ctx.user.id));
route('POST', '/api/alerts/read', { ...T, channels: true, accounts: true, calling: true }, (ctx) => { if (ctx.body.id) D.run('UPDATE alerts SET read=1 WHERE id=? AND user_id=?', ctx.body.id, ctx.user.id); else D.run('UPDATE alerts SET read=1 WHERE user_id=?', ctx.user.id); return { ok: true }; });
route('POST', '/api/notes', T, (ctx) => {
  if (!ctx.body.text) throw httpError(400, 'Write the note', 'text');
  insert('notes', { record_id: ctx.body.record_id, text: ctx.body.text, author: ctx.actor.label, at: now() }); D.history(ctx.actor.label, 'note', ctx.body.record_id); return { ok: true };
});
route('POST', '/api/followups', T, (ctx) => {
  const b = ctx.body; if (!b.at) throw httpError(400, 'Pick the date and time', 'at'); const at = new Date(b.at); if (Number.isNaN(at.getTime())) throw httpError(400, 'Pick the date and time', 'at');
  const team = taskOwners(ctx.user); const want = [...new Set((Array.isArray(b.for_users) && b.for_users.length ? b.for_users : [b.for_user || ctx.user.id]).filter(Boolean))];
  const bad = want.find((id) => id !== ctx.user.id && !team.some((x) => x.id === id)); if (bad) throw httpError(400, 'Pick people from your team', 'for_users');
  for (const uid of want) insert('followups', { record_id: b.record_id, at: at.toISOString(), note: b.note || '', for_user: uid, done: 0, created_by: ctx.user.id });
  return { ok: true, people: want.length };
});
route('POST', '/api/followups/:id/done', T, (ctx) => { D.run('UPDATE followups SET done=1 WHERE id=? AND for_user=?', ctx.params.id, ctx.user.id); return { ok: true }; });
route('GET', '/api/history/:id', T, (ctx) => all('SELECT * FROM history WHERE record_id=? ORDER BY id DESC LIMIT 200', ctx.params.id));
route('POST', '/api/files', T, async (ctx) => {
  const b = ctx.body; if (b.type === 'agreement_client' && !/\.(docx|pdf)$/i.test(b.name || '')) throw httpError(400, 'Upload the agreement as a Word or PDF file');
  const forClient = b.type === 'short_cv' ? get('SELECT * FROM candidates WHERE id=?', b.record_id) : null;
  if (b.type === 'short_cv') { if (!forClient) throw httpError(404, 'Candidate not found'); require('./flow').checkClientCv(b.name, b.base64, forClient); }
  const f = await F.saveFile({ recordId: b.record_id, type: b.type || 'file', name: b.name, base64: b.base64, by: ctx.actor.label });
  if (b.type === 'cv') { update('candidates', b.record_id, { cv_file: String(f.id), last_updated: now() }); f.filled = require('./cvparse').fillCandidate(b.record_id, b.name, b.base64, ctx.actor.label); }
  if (b.type === 'short_cv') update('candidates', b.record_id, { short_cv_file: String(f.id), short_cv_for: forClient.cv_file || 'profile' });
  if (['gst', 'pan', 'owner_id'].includes(b.type)) { const c = get('SELECT * FROM clients WHERE id=?', b.record_id); update('clients', c.id, { kyc: { ...(c.kyc || {}), [b.type]: f.id } }); L.checkActivation(c.id, ctx.actor); }
  if (b.type === 'contract_signed') update('clients', b.record_id, { contract: JSON.stringify({ file: f.id, by: ctx.actor.label, at: now(), method: 'Signed copy uploaded' }) });
  if (b.type === 'contract_signed') L.checkActivation(b.record_id, ctx.actor);
  if (b.type === 'offer_letter') update('applications', b.record_id, { offer_letter: String(f.id) });
  if (b.type === 'jd') D.edit('jobs', b.record_id, { jd: { ...(get('SELECT jd FROM jobs WHERE id=?', b.record_id) || {}).jd, file: f.id } }, ctx.actor.label);
  return f;
});
// A wrong upload comes off the record (the stored file is kept), and whatever it counted for goes with it.
route('POST', '/api/files/:id/remove', T, (ctx) => {
  const f = get('SELECT * FROM files WHERE id=? AND replaced=0', ctx.params.id); if (!f) throw httpError(404, 'File not found');
  const u = ctx.user; const rid = String(f.record_id);
  const rec = (t) => get(`SELECT * FROM ${t} WHERE id=?`, rid);
  const ok = rid.startsWith('CL-') ? R.seeClient(u, rec('clients')) : rid.startsWith('CA-') ? R.phoneVisible(u, rec('candidates')) : rid.startsWith('AP-') ? R.seeApp(u, rec('applications')) : rid.startsWith('JB-') ? R.seeJob(u, rec('jobs')) || R.sameAgency(u, rec('jobs')) : false;
  mustSee(ok, 'file');
  update('files', f.id, { replaced: 1 });
  if (['gst', 'pan', 'owner_id'].includes(f.type)) {
    const c = rec('clients'); const kyc = { ...(c.kyc || {}) }; delete kyc[f.type]; const ob = { ...(c.onboarding || {}) }; delete ob.kyc;
    update('clients', c.id, { kyc, onboarding: ob });
  }
  if (f.type === 'contract_signed') {
    const c = rec('clients'); let k = {}; try { k = JSON.parse(c.contract) || {}; } catch { /* no contract */ }
    if (String(k.file) === String(f.id)) {
      const ob = { ...(c.onboarding || {}) }; delete ob.contract;
      const patch = { contract: null, onboarding: ob };
      if (c.activated_at && c.activated_at !== c.created_at) { patch.activated_at = null; if (c.stage === 'Client activated') patch.stage = 'Agreement shared'; } // active only because of this file
      update('clients', c.id, patch);
    }
  }
  if (f.type === 'cv' || f.type === 'short_cv') { const k = f.type === 'cv' ? 'cv_file' : 'short_cv_file'; const c = rec('candidates'); if (String(c[k]) === String(f.id)) update('candidates', c.id, { [k]: null }); }
  if (f.type === 'offer_letter') { const a = rec('applications'); if (String(a.offer_letter) === String(f.id)) update('applications', a.id, { offer_letter: null }); }
  if (f.type === 'jd') { const j = rec('jobs'); if (String((j.jd || {}).file) === String(f.id)) { const jd = { ...j.jd }; delete jd.file; update('jobs', j.id, { jd }); } }
  D.history(ctx.actor.label, 'remove file', rid, f.type, f.name, null, null, ctx.ip);
  return { ok: true };
});
route('POST', '/api/candidates/:id/short-cv', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.params.id); if (!c) throw httpError(404, 'Not found');
  const lines = [{ text: `${c.id} · ${c.job_wanted || ''}`, bold: true, size: 12 }, `City: ${c.city || '—'}  ·  Will work in: ${(c.work_cities || []).join(', ') || c.city || '—'}`, `Experience: ${c.exp_total ?? '—'} years (jewellery ${c.exp_jewellery ?? '—'})`,
    `Current company: ${c.current_company || '—'}`, `Expected salary: ${c.exp_salary ? L.inr(c.exp_salary / 12) + ' a month' : '—'}  ·  Notice: ${c.notice_days ?? '—'} days`, '', { text: 'Skills', bold: true }, (c.skills || []).join(', ') || '—', '', 'Phone and email are shared once you choose to interview.'];
  const f = F.storeBuffer({ recordId: c.id, type: 'short_cv', name: `ShortCV-${c.id}.pdf`, buf: F.makePdf(`Profile · ${c.name.split(' ')[0]}`, lines, D.settings().business), mime: 'application/pdf', by: ctx.actor.label });
  update('candidates', c.id, { short_cv_file: String(f.id) }); return f;
});
// One candidate's full profile as a PDF, made fresh each time, for every team level (super, admin, sub admin).
// Phone and email are in it only for the candidate's own agency (and the super admin), as on screen.
route('GET', '/api/candidates/:id/profile.pdf', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=? AND removed=0', L.resolveId(ctx.params.id)); if (!c) throw httpError(404, 'Candidate not found');
  const u = ctx.user; const show = R.phoneVisible(u, c);
  const money = (y) => (y ? `${L.inr(y / 12)} a month` : '—'); const yrs = (n) => (n === null || n === undefined ? '—' : `${n} years`);
  const apps = all('SELECT * FROM applications WHERE candidate_id=? ORDER BY created_at DESC', c.id).map(V.appView);
  const lines = [
    { text: `${c.id} · ${c.job_wanted || 'Job not given'}`, bold: true, size: 12 },
    ...(show ? [`WhatsApp: ${c.whatsapp || '—'}  ·  Email: ${c.email || '—'}`] : ['Phone and email: held by the candidate\'s own agency']),
    `City: ${[c.city, c.state].filter(Boolean).join(', ') || '—'}  ·  Will work in: ${(c.work_cities || []).join(', ') || c.city || '—'}`,
    `Industry: ${c.industry || '—'}  ·  Department: ${c.department || '—'}`,
    '', { text: 'Experience', bold: true },
    `Total: ${yrs(c.exp_total)}  ·  In jewellery: ${c.exp_jewellery === 0 ? 'none' : yrs(c.exp_jewellery)}`,
    `Worked with: ${(c.exp_business || []).join(', ') || '—'}  ·  Current company: ${c.current_company || '—'}`,
    `Current salary: ${money(c.cur_salary)}  ·  Expected: ${money(c.exp_salary)}  ·  Notice: ${c.notice_days ?? '—'} days`,
    `Job status: ${L.jobStatusOf(c, L.appStateOf(c.id))}`,
    '', { text: 'Skills', bold: true }, (c.skills || []).join(', ') || '—',
    '', { text: `Applications (${apps.length})`, bold: true },
    ...(apps.length ? apps.map((a) => `${a.id}  ${a.job_title || ''}${a.client_name ? ` (${a.client_name})` : ''}  ·  ${a.step}${a.result && a.result !== 'open' ? ` · ${a.result}` : ''}`) : ['None yet']),
    '', `Source: ${c.source || '—'}  ·  Joined: ${L.istDay(c.created_at)}  ·  Last updated: ${L.istDay(c.last_updated || c.created_at)}`,
  ];
  D.history(ctx.actor.label, 'download', c.id, 'profile pdf', null, null, null, ctx.ip);
  const safe = String(c.name || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  return { __file: { name: `Profile-${c.id}${safe ? `-${safe}` : ''}.pdf`, mime: 'application/pdf', buf: F.makePdf(`Candidate profile · ${c.name}`, lines, D.settings().business) } };
});

// ---------- reports (17) ----------
// Reports by level: the super admin sees everything; an admin sees their agency; a sub admin only their own
// performance and daily logs.
const SUB_REPORTS = ['performance'];
const seePerson = (u, x) => isSuper(u) || x.id === u.id || (u.level === 'admin' && x.agency_id === u.agency_id);
route('GET', '/api/reports/:name', T, (ctx) => {
  const u = ctx.user; const q = ctx.query; const name = ctx.params.name;
  if (name === 'logs' && !isSuper(u)) throw httpError(403, 'This report is for the super admin.');
  if (u.level === 'sub' && !SUB_REPORTS.includes(name)) throw httpError(403, 'Sub admins see their own performance and daily logs only.');
  const from = q.from ? new Date(q.from).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
  const to = q.to ? new Date(new Date(q.to).getTime() + 86399000).toISOString() : now();
  const inR = (t) => t && t >= from && t <= to;
  const jobs = visibleJobs(u).filter((j) => (!q.agency || j.agency_id === q.agency) && (!q.client || j.client_id === q.client));
  const jobIds = new Set(jobs.map((j) => j.id));
  const apps = all('SELECT * FROM applications').filter((a) => jobIds.has(a.job_id) && (!q.job || a.job_id === q.job));
  const appIds = new Set(apps.map((a) => a.id));
  const hist = all('SELECT * FROM app_history WHERE kind=?', 'step').filter((h) => appIds.has(h.app_id) && inR(h.at));
  let rows = []; let cols = null;
  if (name === 'funnel') {
    const clients = all('SELECT * FROM clients WHERE merged_into IS NULL').filter((c) => seeClient(u, c) && inR(c.created_at) && (!q.agency || c.agency_id === q.agency));
    const steps = [['Client leads', clients.length], ['Clients signed', clients.filter((c) => c.contract).length]];
    // Each application that came in, by how far it got: screened in, telephonic and virtual rounds cleared, the
    // client's yes, the offer, joined. Rounds marked not needed count as passed.
    const cohort = apps.filter((a) => inR(a.created_at)); const passed = (r) => r && ['Cleared', 'Not needed'].includes(r.status);
    const reach = (a) => {
      const si = L.stepIdx(a.step); const rs = L.roundsOf(a); const ph = rs.find((x) => x.mode === 'phone'); const vd = rs.find((x) => x.mode === 'video'); const cl = rs.find((x) => x.mode === 'in_person');
      let n = 1; // applied
      if (a.screen === 'Accepted' || si >= L.stepIdx('Our interview')) n = 2;
      if (n >= 2 && (passed(ph) || si >= L.stepIdx('Sent to client'))) n = 3;
      if (n >= 3 && (passed(vd) || si >= L.stepIdx('Sent to client'))) n = 4;
      if (si >= L.stepIdx('Sent to client')) n = Math.max(n, 4);
      if ((cl && cl.status === 'Cleared') || si >= L.stepIdx('Offer made')) n = 5;
      if (si >= L.stepIdx('Offer made')) n = 6;
      if (si >= L.stepIdx('Offer accepted')) n = 7;
      if (a.result === 'Hired' || si >= L.stepIdx('Joined')) n = 8;
      return n;
    };
    const got = cohort.map(reach);
    [['Applications in', 1], ['Screened in (eligible for telephonic)', 2], ['Telephonic round cleared', 3], ['Virtual round cleared (CV to client)', 4], ['Selected by the client', 5], ['Offer made', 6], ['Offer accepted', 7], ['Joined', 8]].forEach(([l, k]) => steps.push([l, got.filter((g) => g >= k).length]));
    rows = steps.map(([step, n], i) => ({ step, count: n, drop: i > 2 && steps[i - 1][1] ? `${Math.round((n / steps[i - 1][1]) * 100)}% of the step before` : '' }));
  } else if (name === 'clients') {
    rows = all('SELECT * FROM clients WHERE merged_into IS NULL AND removed=0').filter((c) => seeClient(u, c) && (!q.client || c.id === q.client)).map((c) => {
      const js = jobs.filter((j) => j.client_id === c.id).map((j) => V.jobView(j)); const as = apps.filter((a) => js.some((j) => j.id === a.job_id));
      const sentAt = (jid) => { const h = all("SELECT at FROM app_history WHERE step='Sent to client' AND app_id IN (SELECT id FROM applications WHERE job_id=?) ORDER BY at LIMIT 1", jid)[0]; return h ? h.at : null; };
      const ttf = js.map((j) => sentAt(j.id) ? L.daysBetween(j.created_at, sentAt(j.id)) : null).filter((x) => x !== null);
      const fill = as.filter((a) => a.result === 'Hired').map((a) => L.daysBetween(js.find((j) => j.id === a.job_id).created_at, a.joined_at));
      const bills = all("SELECT * FROM bills WHERE client_id=? AND status NOT IN ('Draft','Cancelled')", c.id).map(L.billView);
      return { client: `${c.id} ${c.company}`, jobs: js.length, openings: js.reduce((a, j) => a + j.openings, 0), filled: js.reduce((a, j) => a + j.filled, 0), first_cv_days: ttf.length ? Math.round(ttf.reduce((a, b) => a + b, 0) / ttf.length) : '', fill_days: fill.length ? Math.round(fill.reduce((a, b) => a + b, 0) / fill.length) : '', hires: as.filter((a) => a.result === 'Hired').length, billed: bills.reduce((a, b) => a + b.total, 0), paid: bills.reduce((a, b) => a + b.paid, 0) };
    }).filter((r) => r.jobs);
  } else if (name === 'jobs') {
    rows = jobs.filter((j) => !q.job || j.id === q.job).map((j) => {
      const v = V.jobView(j); const as = apps.filter((a) => a.job_id === j.id); const bySrc = {};
      for (const a of as) bySrc[a.source || 'Other'] = (bySrc[a.source || 'Other'] || 0) + 1;
      const r = { job: `${j.id} ${j.title}`, client: v.client_name, status: v.status, days_open: v.days_open, interviews: get('SELECT COUNT(*) c FROM interviews WHERE app_id IN (SELECT id FROM applications WHERE job_id=?)', j.id).c, by_source: Object.entries(bySrc).map(([k, n]) => `${k}: ${n}`).join(', ') };
      for (const st of L.STEPS) r[st] = as.filter((a) => a.step === st).length;
      return r;
    });
  } else if (name === 'whatsapp') {
    if (!isSuper(u)) throw httpError(403, 'Only the super admin sees website WhatsApp clicks.');
    const m = {};
    for (const c of all('SELECT * FROM wa_clicks WHERE at>=? AND at<=?', from, to)) { const k = [c.page, c.button, c.src || 'Direct'].join('|'); m[k] = m[k] || { page: c.page, button: c.button, source: c.src || 'Direct', clicks: 0, last_click: c.at }; m[k].clicks++; if (c.at > m[k].last_click) m[k].last_click = c.at; }
    rows = Object.values(m).sort((a, b) => b.clicks - a.clicks);
  } else if (name === 'sources') {
    const m = {};
    const add = (src, k) => { m[src || 'Other'] = m[src || 'Other'] || { source: src || 'Other', client_leads: 0, candidate_leads: 0, applications: 0, hires: 0 }; m[src || 'Other'][k]++; };
    const mine = (r) => isSuper(u) || r.agency_id === u.agency_id; // admins count only their own agency's leads
    for (const c of all('SELECT source, created_at, agency_id FROM clients')) if (inR(c.created_at) && mine(c)) add(c.source, 'client_leads');
    for (const c of all('SELECT source, created_at, agency_id FROM candidates')) if (inR(c.created_at) && mine(c)) add(c.source, 'candidate_leads');
    for (const a of apps) { if (inR(a.created_at)) add(a.source, 'applications'); if (a.result === 'Hired' && inR(a.joined_at)) add(a.source, 'hires'); }
    rows = Object.values(m).sort((a, b) => b.candidate_leads + b.client_leads - (a.candidate_leads + a.client_leads));
  } else if (name === 'performance') {
    rows = all("SELECT * FROM users WHERE level!='super'").filter((x) => seePerson(u, x) && (!q.agency || x.agency_id === q.agency) && (!q.person || x.id === q.person)).map((x) => ({ person: `${x.id} ${x.name}`, agency: V.agencyName(x.agency_id), level: x.level, ...perfOf(x.id, from, to) }));
  } else if (name === 'money') {
    rows = all("SELECT * FROM bills WHERE status NOT IN ('Draft')").filter((b) => seeBill(u, b) && inR(b.issued_at || b.created_at) && (!q.agency || b.agency_id === q.agency) && (!q.client || b.client_id === q.client)).map(L.billView).map((b) => ({ bill: b.bill_no || b.id, client: get('SELECT company FROM clients WHERE id=?', b.client_id).company, agency: V.agencyName(b.agency_id), fee: b.fee, gst: b.gst, total: b.total, received: b.paid, tds: b.tds, balance: b.balance, status: b.view_status, agency_share: b.agency_share, payout: b.payout_status }));
  } else if (name === 'replacements') {
    rows = apps.filter((a) => a.left_date && inR(new Date(a.left_date).toISOString())).map((a) => { const v = V.appView(a); const cl = get('SELECT * FROM clients WHERE id=?', v.client_id); const win = cl.replacement_days || D.settings().replacement_days; return { application: a.id, candidate: v.candidate_name, client: v.client_name, job: v.job_title, joined: L.istFmt(a.joined_at, false), left: a.left_date, days: L.daysBetween(a.joined_at, a.left_date), within_window: L.daysBetween(a.joined_at, a.left_date) <= win ? 'Yes' : 'No', reason: a.left_reason, free_replacement: a.replacement_used ? 'Yes' : 'No' }; });
  } else if (name === 'bank') {
    const cands = all('SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0').filter((c) => (!q.city || c.city === q.city) && (!q.dept || String(q.dept).split(',').includes(c.department)));
    const m = {};
    for (const c of cands) { const k = `${c.city || '—'}|${c.department || '—'}`; m[k] = m[k] || { city: c.city || '—', department: c.department || '—', active: 0, new_in_range: 0, fresh_90: 0, stale_90: 0 }; if (['Actively looking', 'Open to offers'].includes(c.looking)) m[k].active++; if (inR(c.created_at)) m[k].new_in_range++; if (L.daysBetween(c.last_updated || c.created_at) <= 90) m[k].fresh_90++; else m[k].stale_90++; }
    rows = Object.values(m).sort((a, b) => b.active - a.active);
  } else if (name === 'logs') {
    const people = all("SELECT * FROM users WHERE level!='super' AND status='On'").filter((x) => seePerson(u, x) && (!q.person || x.id === q.person));
    const days = Math.min(92, Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000)));
    rows = people.map((x) => { const logs = all('SELECT day, status FROM logs WHERE user_id=?', x.id).filter((l) => l.day >= from.slice(0, 10) && l.day <= to.slice(0, 10)); return { person: `${x.id} ${x.name}`, agency: V.agencyName(x.agency_id), days, submitted: logs.length, approved: logs.filter((l) => l.status === 'Approved').length, missing: Math.max(0, days - logs.length) }; });
  } else if (name === 'resumes') {
    if (!isSuper(u)) throw httpError(403, 'This report is for the super admin.');
    const since = new Date(Date.now() - L.RESUME_DAYS * 86400000).toISOString(); const total = get('SELECT COUNT(*) n FROM candidates WHERE cv_file IS NOT NULL AND merged_into IS NULL AND removed=0').n;
    rows = all('SELECT user_id, COUNT(*) n, MAX(at) last FROM resume_use WHERE at>=? GROUP BY user_id ORDER BY n DESC', since).map((r) => { const x = get('SELECT name, level FROM users WHERE id=?', r.user_id) || {}; return { person: x.name || r.user_id, level: x.level === 'sub' ? 'Sub admin' : 'Admin', resumes_opened: r.n, percent_of_all: total ? Math.round((r.n / total) * 100) : 0, last_opened: L.istFmt(r.last) }; });
  } else throw httpError(404, 'Unknown report');
  if (['csv', 'xlsx'].includes(q.format)) return page(ctx, rows, `report-${name}`, cols || Object.keys(rows[0] || { empty: '' }));
  return { rows };
});
module.exports.removePerson = removePerson;
require('./profilelink'); // resume and details from candidates, on a link with no login
require('./resumes'); // resumes from a zip of the Drive folder (Candidates -> Attach resumes)
const healthOf = (k) => { const v = (get('SELECT value FROM health WHERE key=?', k) || {}).value; if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : null; } catch { return v || null; } };
route('GET', '/api/resumes/missing', { auth: 'team', levels: ['super', 'admin'] }, (ctx) => {
  const rows = all("SELECT id, name, source, email, whatsapp, created_at FROM candidates WHERE merged_into IS NULL AND removed=0 AND IFNULL(junk,0)=0 AND (cv_file IS NULL OR cv_file='') AND (source LIKE 'Email%' OR source LIKE 'Google Drive%') ORDER BY created_at DESC");
  const count = (f) => rows.filter(f).length;
  return { counts: { email: count((c) => /^Email/.test(c.source || '')), drive: count((c) => c.source === 'Google Drive'), naukri: count((c) => c.source === 'Google Drive - Naukri') }, rows: rows.slice(0, 300).map((c) => ({ ...c, whatsapp: c.whatsapp ? `${String(c.whatsapp).slice(0, 2)}••••${String(c.whatsapp).slice(-2)}` : '' })),
    email: { on: !!D.ENV.imap.host, last: healthOf('last_cv_refetch'), progress: healthOf('cv_refetch_progress'), errors: healthOf('cv_refetch_errors') || [] }, drive: { last: healthOf('last_drive_check') } };
});
route('POST', '/api/candidates/:id/find-resume', { auth: 'team', levels: ['super', 'admin', 'sub'], rate: { key: 'findcv', max: 60, minutes: 60 } }, async (ctx) => require('./mailbox').findFor(L.resolveId(String(ctx.params.id))));
route('POST', '/api/resumes/missing/fetch', { auth: 'team', levels: ['super'], rate: { key: 'cvrefetch', max: 20, minutes: 60 } }, async () => {
  if (!D.ENV.imap.host) throw httpError(400, 'The email inbox is not set up on the server.');
  const r = await require('./mailbox').refetchCvs({ force: true, batch: 300 }); return r;
});
require('./drive'); // the Google Drive CV folder, read on the timer
require('./trash'); // delete with a recycle bin (Settings -> Deleted items)
require('./lang'); // translation, voice notes and recordings
require('./care'); // check-ins after joining, replacements, recruiter reviews
require('./verify'); // candidate ID and reference checks
require('./partners'); // institutes and colleges that train candidates
require('./exports'); // daily data backup in Excel
require('./portals'); // job portals: quotes, subscriptions, payments, results
require('./flow'); // client onboarding, screening with AI, client CVs, invoices, books
require('./studio'); // campaign studio: WhatsApp templates, header media, email designs
require('./metaads'); // Meta ads made from the portal (paused until turned on)
require('./adspend'); // ad spend reports from Meta and LinkedIn (Job openings -> Ad spend)
