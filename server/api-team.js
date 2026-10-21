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
function page(ctx, rows, name, columns) {
  const fmt = ctx.query.format;
  if (fmt === 'csv' || fmt === 'xlsx') {
    D.history(ctx.actor.label, 'download', null, name, null, `${rows.length} rows`, null, ctx.ip);
    const cols = columns || Object.keys(rows[0] || {}).filter((k) => typeof rows[0][k] !== 'object');
    const table = [cols.map((c) => (Array.isArray(c) ? c[1] : c)), ...rows.map((r) => cols.map((c) => (Array.isArray(c) ? (typeof c[0] === 'function' ? c[0](r) : r[c[0]]) : r[c])))];
    if (fmt === 'xlsx') return { __file: { name: `${name}-${L.istDay()}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: F.toXLSX(table, name) } };
    return { __file: { name: `${name}-${L.istDay()}.csv`, mime: 'text/csv', buf: Buffer.from(F.toCSV(table), 'utf8') } };
  }
  const size = 50; const p = Math.max(1, Number(ctx.query.page) || 1);
  return { rows: rows.slice((p - 1) * size, p * size), total: rows.length, page: p, pages: Math.max(1, Math.ceil(rows.length / size)) };
}
const like = (q, ...vals) => !q || vals.some((v) => v && String(v).toLowerCase().includes(String(q).toLowerCase()));
function mustSee(ok, what = 'record') { if (!ok) throw httpError(403, `You cannot see this ${what}.`); }
const visibleJobs = (u) => all('SELECT * FROM jobs WHERE archived=0 ORDER BY created_at DESC').filter((j) => seeJob(u, j));
function visibleApps(u) {
  const jobs = new Map(all('SELECT * FROM jobs').map((j) => [j.id, j]));
  return all('SELECT * FROM applications ORDER BY created_at DESC').filter((a) => seeApp(u, a, jobs.get(a.job_id)));
}

// ---------- me / menu counts ----------
route('GET', '/api/me', { auth: 'team', allow2fa: true }, (ctx) => {
  const u = ctx.user;
  const counts = {
    leads: isSuper(u) ? get('SELECT (SELECT COUNT(*) FROM clients WHERE agency_id IS NULL AND junk=0 AND archived=0) + (SELECT COUNT(*) FROM candidates WHERE agency_id IS NULL AND is_new=1 AND junk=0 AND archived=0) c').c : 0,
    pending: all("SELECT i.*, a.job_id, a.owner_id FROM interviews i JOIN applications a ON a.id=i.app_id WHERE i.status IN ('Scheduled','Rescheduled') AND i.at < ?", now()).filter((i) => seeApp(u, { id: i.app_id, owner_id: i.owner_id, job_id: i.job_id })).length,
    unread: unreadThreads(u),
    alerts: get('SELECT COUNT(*) c FROM alerts WHERE user_id=? AND read=0', u.id).c,
  };
  return { user: { id: u.id, name: u.name, level: u.level, agency_id: u.agency_id, role: u.role, username: u.username, must_change: u.must_change, whatsapp: u.whatsapp }, agency: ctx.agency, counts };
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
  if (u.level !== 'super' && deadlinePassed() && !get('SELECT 1 FROM logs WHERE user_id=? AND day=?', u.id, L.istDay())) return 'Log missing today';
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
  return { id: u.id, name: u.name, level: u.level, role: u.role, agency_id: u.agency_id, agency_name: V.agencyName(u.agency_id), status: personStatus(u), last_login: u.last_login, ...perfOf(u.id, from, to), logs: lg, log_pct: Math.round((lg.filter((x) => x.status).length / 7) * 100) };
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
  return { level: 'super', agencies, people };
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
  const jobs = visibleJobs(u).map((j) => V.jobView(j));
  const apps = visibleApps(u);
  const appIds = new Set(apps.map((a) => a.id));
  const ivs = all('SELECT * FROM interviews').filter((i) => appIds.has(i.app_id)).map(L.interviewView);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString();
  const byStatus = {};
  for (const j of jobs) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  const bills = all('SELECT * FROM bills').filter((b) => seeBill(u, b)).map(L.billView);
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
  for (const j of jobs.filter((x) => x.status === 'Draft' && ['Not written', 'Changes asked'].includes(x.jd_status))) att.push({ kind: 'Write job description', text: `${j.id} ${j.title} — ${j.client_name}${j.jd_status === 'Changes asked' ? ' (client asked for changes)' : ''}`, open: { type: 'job', id: j.id }, wa: { ptype: 'user', pid: j.recruiter_id || u.id, format: 'bbhs_team_task_alert', jb: j.id, vars: { task: `Write the JD for ${j.id}`, record_id: j.id } } });
  if (deadlinePassed() || true) {
    const team = all("SELECT * FROM users WHERE status='On' AND level!='super'").filter((x) => (isSuper(u) && x.level === 'admin') || (u.level === 'admin' && x.agency_id === u.agency_id && x.level === 'sub') || x.id === u.id);
    for (const x of team) if (!get('SELECT 1 FROM logs WHERE user_id=? AND day=?', x.id, L.istDay()) && deadlinePassed()) att.push({ kind: 'Log missing', text: `${x.name} has no daily log today`, open: { type: 'person', id: x.id }, wa: { ptype: 'user', pid: x.id, format: 'bbhs_log_reminder', vars: { deadline: D.settings().log_deadline, link: L.link('team') } } });
  }
  for (const b of bills.filter((x) => x.view_status === 'Overdue')) { const cl = get('SELECT company FROM clients WHERE id=?', b.client_id); att.push({ kind: 'Overdue bill', text: `${b.bill_no} ${cl.company} — ${L.inr(b.balance)}`, open: { type: 'bill', id: b.id }, wa: { ptype: 'client', pid: b.client_id, format: 'bbhs_payment_reminder', bl: b.id, vars: { bill_no: b.bill_no, amount: L.inr(b.balance), status: 'overdue', link: L.upiLink(b.balance, b.bill_no) } } }); }
  for (const b of bills.filter((x) => x.status === 'Draft')) { const cl = get('SELECT company FROM clients WHERE id=?', b.client_id); att.push({ kind: 'Bill to issue', text: `${b.id} draft for ${cl.company}`, open: { type: 'bill', id: b.id } }); }
  if (isSuper(u)) {
    const nl = get('SELECT (SELECT COUNT(*) FROM clients WHERE agency_id IS NULL AND junk=0 AND archived=0) + (SELECT COUNT(*) FROM candidates WHERE agency_id IS NULL AND is_new=1 AND junk=0 AND archived=0) c').c;
    if (nl) att.push({ kind: 'Leads to assign', text: `${nl} new lead(s) waiting for an agency`, open: { type: 'page', id: 'leads' } });
    for (const r of all("SELECT * FROM data_requests WHERE status='Waiting'")) att.push({ kind: 'Data request', text: `${r.person_id} asked to ${r.kind === 'delete' ? 'delete their data' : r.kind}`, open: { type: 'page', id: 'settings' } });
  }
  const leadsNew = isSuper(u) ? get('SELECT (SELECT COUNT(*) FROM clients WHERE agency_id IS NULL AND junk=0 AND archived=0) + (SELECT COUNT(*) FROM candidates WHERE agency_id IS NULL AND is_new=1 AND junk=0 AND archived=0) c').c : 0;
  const out = {
    counts: {
      open_jobs: jobs.filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status)).length,
      active_apps: apps.filter((a) => a.result === 'open').length,
      interviews_7: ivs.filter((i) => ['Scheduled', 'Rescheduled'].includes(i.status) && i.at >= now() && i.at <= in7).length,
      offers_waiting: apps.filter((a) => a.result === 'open' && a.step === 'Offer made').length,
      joined_30: apps.filter((a) => a.result === 'Hired' && a.joined_at && L.daysBetween(a.joined_at) <= 30).length,
      new_leads: leadsNew,
    },
    attention: att, by_status: byStatus,
  };
  if (isSuper(u)) out.agencies = all('SELECT * FROM agencies ORDER BY id').map((ag) => ({ id: ag.id, name: ag.name, status: agencyStatus(ag), open_jobs: jobs.filter((j) => j.agency_id === ag.id && !['Closed', 'Filled'].includes(j.status)).length, active_apps: apps.filter((a) => a.result === 'open' && (jobs.find((j) => j.id === a.job_id) || {}).agency_id === ag.id).length }));
  if (u.level === 'sub') out.mine = perfOf(u.id, new Date(Date.now() - 30 * 86400000).toISOString());
  return out;
});

// ---------- My day (sub admin home) ----------
route('GET', '/api/myday', T, (ctx) => {
  const u = ctx.user; const today = L.istDay();
  const apps = visibleApps(u); const ids = new Set(apps.map((a) => a.id));
  const ivs = all('SELECT * FROM interviews ORDER BY at').filter((i) => ids.has(i.app_id)).map(L.interviewView);
  return {
    interviews: ivs.filter((i) => L.istDay(i.at) === today && i.status !== 'Cancelled').map((i) => ({ ...i, app: V.appView(apps.find((a) => a.id === i.app_id)) })),
    pending: ivs.filter((i) => i.view_status === 'Result pending').map((i) => ({ ...i, app: V.appView(apps.find((a) => a.id === i.app_id)) })),
    followups: all('SELECT * FROM followups WHERE for_user=? AND done=0 ORDER BY at', u.id),
    stuck: apps.filter((a) => a.result === 'open' && !a.on_hold && L.daysBetween(a.step_since || a.created_at) >= 7).map(V.appView),
    log_due: !get('SELECT 1 FROM logs WHERE user_id=? AND day=?', u.id, today) && u.level !== 'super',
  };
});

// ---------- leads (11.3) ----------
route('GET', '/api/leads', SUPER, (ctx) => {
  const q = ctx.query; const days = Number(q.days) || 30; const since = new Date(Date.now() - days * 86400000).toISOString();
  const filt = (r) => (!q.source || r.source === q.source) && (!q.agency || (q.agency === 'none' ? !r.agency_id : r.agency_id === q.agency)) && (!q.new || r.is_new) && (!q.from || r.created_at >= q.from);
  const clients = all('SELECT * FROM clients WHERE junk=0 AND merged_into IS NULL AND removed=0 ORDER BY created_at DESC').filter((c) => (!c.agency_id || q.all) && filt(c)).map(V.clientView);
  const cands = all('SELECT * FROM candidates WHERE junk=0 AND merged_into IS NULL AND removed=0 ORDER BY created_at DESC').filter((c) => ((!c.agency_id && c.is_new) || q.all) && filt(c));
  const check = [
    ...all("SELECT id, name AS label, whatsapp, email, source, needs_check, possible_repeat_of, created_at, 'candidate' AS type FROM candidates WHERE (needs_check IS NOT NULL OR possible_repeat_of IS NOT NULL) AND merged_into IS NULL AND junk=0"),
    ...all("SELECT id, company AS label, whatsapp, email, source, needs_check, possible_repeat_of, created_at, 'client' AS type FROM clients WHERE (needs_check IS NOT NULL OR possible_repeat_of IS NOT NULL) AND merged_into IS NULL AND junk=0"),
  ];
  const srcCount = {};
  for (const r of [...all('SELECT source, created_at FROM clients'), ...all('SELECT source, created_at FROM candidates')]) if (r.created_at >= since) srcCount[r.source || 'Other'] = (srcCount[r.source || 'Other'] || 0) + 1;
  const hires = {};
  for (const a of all("SELECT a.source, a.joined_at FROM applications a WHERE a.result='Hired'")) if (a.joined_at >= since) hires[a.source || 'Other'] = (hires[a.source || 'Other'] || 0) + 1;
  if (q.format) {
    if (q.tab === 'candidate') return page(ctx, cands, 'candidate-leads', ['id', 'name', 'whatsapp', 'job_wanted', 'city', 'source', 'created_at', 'agency_id']);
    if (q.tab === 'check') return page(ctx, check, 'leads-to-check', ['id', 'type', 'label', 'whatsapp', 'email', 'source', 'needs_check', 'possible_repeat_of']);
    return page(ctx, clients, 'client-leads', ['id', 'company', 'contact', 'whatsapp', 'city', 'need', 'roles', 'source', 'created_at', 'agency_name']);
  }
  return { clients, candidates: cands, check, sources: srcCount, hires, agencies: all("SELECT id, name FROM agencies WHERE status='Active'") };
});
route('POST', '/api/leads/assign', SUPER, (ctx) => {
  const { type, ids, agency_id } = ctx.body;
  const out = (ids || [ctx.body.id]).map((id) => L.assignLead(type, id, agency_id, ctx.actor));
  return { ok: true, count: out.length };
});
route('POST', '/api/leads/junk', T, (ctx) => {
  const { type, id } = ctx.body; const table = type === 'client' ? 'clients' : 'candidates';
  D.edit(table, id, { junk: 1, is_new: 0 }, ctx.actor.label, ctx.ip); return { ok: true };
});
route('POST', '/api/leads/quick', T, (ctx) => {
  const b = ctx.body; const by = { ...ctx.actor };
  if (b.type === 'client') { const r = L.intakeClient({ contact: b.name, company: b.company || b.name, whatsapp: b.phone, city: b.city, need: b.note }, { source: b.source || 'Walk-in', by }); if (b.note) insert('notes', { record_id: r.client.id, text: b.note, author: ctx.actor.label, at: now() }); return { id: r.client.id, isNew: r.isNew }; }
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
route('GET', '/api/clients', T, (ctx) => {
  const q = ctx.query; const u = ctx.user;
  const rows = all('SELECT * FROM clients WHERE merged_into IS NULL AND removed=0 AND junk=0 ORDER BY created_at DESC')
    .filter((c) => seeClient(u, c) && (q.archived ? c.archived : !c.archived) && (!q.stage || c.stage === q.stage) && like(q.q, c.id, c.company, c.contact, c.city, c.whatsapp, c.old_code))
    .map(V.clientView);
  return page(ctx, rows, 'clients', ['id', 'company', 'contact', 'whatsapp', 'city', 'business_type', 'stage', 'agency_name', 'owner_name', 'jobs_open', 'jobs_total', 'account_status', 'source']);
});
route('POST', '/api/clients', T, (ctx) => {
  const b = ctx.body; const r = L.intakeClient(b, { source: b.source || `Created by ${ctx.actor.label}`, by: ctx.actor });
  if (!r.isNew && !seeClient(ctx.user, r.client)) throw httpError(400, `This number already belongs to ${r.client.id} in another agency.`);
  if (r.isNew && ctx.user.level !== 'super') update('clients', r.client.id, { agency_id: ctx.user.agency_id, owner_id: ctx.user.id, is_new: 0 });
  return { id: r.client.id, isNew: r.isNew };
});
route('GET', '/api/clients/:id', T, (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', L.resolveId(ctx.params.id)); mustSee(seeClient(ctx.user, c), 'client');
  const jobs = all('SELECT * FROM jobs WHERE client_id=? ORDER BY created_at DESC', c.id).map((j) => V.jobView(j));
  return {
    ...V.clientView(c), onboarding_items: V.onboardingView(c), jobs, members: all('SELECT * FROM client_members WHERE client_id=?', c.id),
    messages: all("SELECT * FROM messages WHERE person_type='client' AND person_id=? ORDER BY at DESC LIMIT 30", c.id),
    files: all('SELECT * FROM files WHERE record_id=? AND replaced=0 ORDER BY at DESC', c.id), notes: all('SELECT * FROM notes WHERE record_id=? ORDER BY at DESC', c.id),
    consents: all("SELECT * FROM consents WHERE person_type='client' AND person_id=? ORDER BY at DESC", c.id), agencies: all('SELECT id, name FROM agencies'),
    agency_users: all("SELECT id, name FROM users WHERE agency_id=? AND status='On'", c.agency_id),
  };
});
route('PATCH', '/api/clients/:id', T, (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', ctx.params.id); mustSee(seeClient(ctx.user, c), 'client');
  const allowed = ['company', 'contact', 'whatsapp', 'email', 'city', 'state', 'business_type', 'need', 'roles', 'stage', 'owner_id', 'industry', 'fee_type', 'fee_value', 'replacement_days', 'payment_days', 'language', 'hide_name_until', 'extra', 'archived', 'dnc'];
  if (isSuper(ctx.user)) allowed.push('agency_id');
  const patch = {}; for (const k of allowed) if (ctx.body[k] !== undefined) patch[k] = ctx.body[k];
  if (patch.whatsapp) { patch.whatsapp = L.digits10(patch.whatsapp); if (!L.validPhone(patch.whatsapp)) throw httpError(400, 'Enter a 10-digit WhatsApp number', 'whatsapp'); }
  if (patch.fee_value === '') patch.fee_value = null;
  if (patch.agency_id && patch.agency_id !== c.agency_id) { const adm = L.agencyAdmin(patch.agency_id); patch.owner_id = adm ? adm.id : null; patch.is_new = 0; }
  return D.edit('clients', c.id, patch, ctx.actor.label, ctx.ip);
});
route('POST', '/api/clients/:id/onboarding', T, (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', ctx.params.id); mustSee(seeClient(ctx.user, c), 'client');
  const { item, done, note } = ctx.body; const it = V.ONBOARDING.find((x) => x.key === item); if (!it) throw httpError(400, 'Unknown item');
  const ob = { ...(c.onboarding || {}) }; ob[item] = { done: !!done, date: done ? now() : null, by: ctx.actor.label, note: note || (ob[item] || {}).note || '' };
  const patch = { onboarding: ob };
  const stages = D.settings().client_stages;
  if (done && it.stage && stages.indexOf(it.stage) > stages.indexOf(c.stage)) patch.stage = it.stage;
  if (item === 'contract' && done && !c.contract) patch.contract = JSON.stringify({ by: ctx.actor.label, at: now(), method: 'Marked by team' });
  D.edit('clients', c.id, patch, ctx.actor.label, ctx.ip);
  if (done && note) insert('notes', { record_id: c.id, text: `${it.label}: ${note}`, author: ctx.actor.label, at: now() });
  return { ok: true, stage: patch.stage || c.stage };
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
  let rows = visibleJobs(u).map((j) => V.jobView(j));
  const counts = { All: rows.length, Active: rows.filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status)).length };
  for (const s of ['Draft', 'Open', 'Sourcing', 'Interviewing', 'Offer stage', 'Filled', 'On hold', 'Closed']) counts[s] = rows.filter((j) => j.status === s).length;
  rows = rows.filter((j) => (!q.status || q.status === 'All' || (q.status === 'Active' ? ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status) : j.status === q.status)) && (!q.client || j.client_id === q.client) && like(q.q, j.id, j.title, j.client_name, j.city, j.old_code, j.recruiter_name));
  const p = page(ctx, rows, 'job-openings', ['id', 'title', 'client_name', 'city', 'openings', 'filled', 'apps_total', 'status', 'recruiter_name', 'days_open', 'old_code']);
  return p.__file ? p : { ...p, counts };
});
route('POST', '/api/jobs', ADMINS, (ctx) => {
  const b = ctx.body; const c = get('SELECT * FROM clients WHERE id=?', b.client_id); mustSee(seeClient(ctx.user, c), 'client');
  return createJob(c, b, ctx.actor, false);
});
function createJob(c, b, actor, byClient) {
  if (!b.title) throw httpError(400, 'Pick the job', 'title');
  const id = D.nextId('JB');
  const recruiter = b.recruiter_id || (byClient ? (get("SELECT recruiter_id FROM jobs WHERE client_id=? AND recruiter_id IS NOT NULL ORDER BY created_at DESC", c.id) || {}).recruiter_id || c.owner_id : actor.uid);
  const toYear = (v) => (v === '' || v === null || v === undefined ? null : Number(v) * (b.salary_per === 'month' ? 12 : 1));
  insert('jobs', {
    id, client_id: c.id, title: b.title === 'Other' ? (b.title_other || 'Other') : b.title, department: L.deptOf(b.title), city: b.city || c.city, openings: Math.max(1, Number(b.openings) || 1),
    sal_from: toYear(b.sal_from), sal_to: toYear(b.sal_to), exp_from: b.exp_from === '' ? null : b.exp_from ?? null, exp_to: b.exp_to === '' ? null : b.exp_to ?? null, notice_days: b.notice_days === '' ? null : b.notice_days ?? null,
    skills: b.skills || [], agency_id: c.agency_id, recruiter_id: recruiter || null, priority: b.priority || 'Medium', jd_approved: byClient ? 0 : (b.jd_approved ? 1 : 0), jd_status: b.jd_approved && !byClient ? 'Approved' : 'Not written',
    rounds: b.rounds || ['Our interview', 'Client interview'], screening_qs: b.screening_qs || [], notes: b.notes || '', created_by: L.actorName(actor), created_at: now(), status: null,
  });
  D.history(L.actorName(actor), 'create', id, null, null, `${b.title} for ${c.company}`);
  for (const ch of D.settings().posting_channels) insert('postings', { job_id: id, channel: ch.channel, owner: ch.owner, tag: ch.tag });
  L.recalcJob(id, L.actorName(actor), byClient ? 'Raised by client' : 'Job opening made');
  if (recruiter && byClient) L.alertUser(recruiter, `${c.company} raised a new job opening ${id}: write the job description`, id);
  const stages = D.settings().client_stages;
  if (stages.indexOf('Job opening active') > stages.indexOf(c.stage)) update('clients', c.id, { stage: 'Job opening active' });
  return get('SELECT * FROM jobs WHERE id=?', id);
}
module.exports.createJob = createJob;
route('GET', '/api/jobs/:id', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j) || (ctx.user.level !== 'super' && j && j.agency_id === ctx.user.agency_id), 'job opening');
  const apps = L.appsOfJob(j.id);
  const client = get('SELECT * FROM clients WHERE id=?', j.client_id);
  return {
    ...V.jobView(j, apps), client, apps: apps.map(V.appView).map((a) => ({ ...a, score: L.matchScore(get('SELECT * FROM candidates WHERE id=?', a.candidate_id), j, L.ratingOf(a.candidate_id)).score })),
    matches: L.bestMatches(j, 10).map((m) => ({ ...candidateOut(ctx.user, m.c), score: m.score, reasons: m.reasons, status: V.candStatus(m.c.id) })),
    history: all('SELECT * FROM job_history WHERE job_id=? ORDER BY at DESC, id DESC', j.id), postings: all('SELECT * FROM postings WHERE job_id=?', j.id).map((p) => ({ ...p, apply_link: L.link('apply', `?src=${p.tag}&job=${j.id}`), apps: apps.filter((a) => a.source === (D.settings().src_tags[p.tag] || p.tag)).length })),
    recruiters: all("SELECT id, name FROM users WHERE agency_id=? AND status='On'", j.agency_id), files: all('SELECT * FROM files WHERE record_id=? AND replaced=0', j.id),
    notes: all('SELECT * FROM notes WHERE record_id=? ORDER BY at DESC', j.id), jd_template: (D.settings().jd_templates || {})[j.title] || D.settings().jd_template, salary_text: L.salaryText(j),
  };
});
route('PATCH', '/api/jobs/:id', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  const allowed = ['title', 'city', 'openings', 'sal_from', 'sal_to', 'exp_from', 'exp_to', 'notice_days', 'skills', 'priority', 'rounds', 'screening_qs', 'notes', 'archived'];
  if (ctx.user.level !== 'sub') allowed.push('recruiter_id');
  const patch = {}; for (const k of allowed) if (ctx.body[k] !== undefined) patch[k] = ctx.body[k];
  if (patch.title) patch.department = L.deptOf(patch.title);
  D.edit('jobs', j.id, patch, ctx.actor.label, ctx.ip);
  if (patch.recruiter_id && patch.recruiter_id !== j.recruiter_id) L.alertUser(patch.recruiter_id, `You are now the recruiter on ${j.id}`, j.id);
  L.recalcJob(j.id, ctx.actor.label, 'Edited');
  return get('SELECT * FROM jobs WHERE id=?', j.id);
});
route('POST', '/api/jobs/:id/action', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  return L.jobAction(j.id, ctx.body.action, ctx.body, ctx.actor);
});
route('POST', '/api/jobs/:id/jd', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  const jd = { ...(j.jd || {}), ...(ctx.body.jd || {}) };
  const patch = { jd, jd_status: ctx.body.send ? 'Waiting for client' : (j.jd_status === 'Not written' ? 'Draft' : j.jd_status) };
  D.edit('jobs', j.id, patch, ctx.actor.label, ctx.ip);
  if (ctx.body.send) {
    insert('job_history', { job_id: j.id, at: now(), status: 'JD sent', by: ctx.actor.label, note: 'Sent to client for approval' });
    L.sendWA({ ptype: 'client', pid: j.client_id, format: 'bbhs_team_task_alert', vars: { task: `Please approve the job description for ${j.title}`, record_id: j.id, link: L.link('my-account') }, jb: j.id, by: ctx.actor });
  }
  return get('SELECT * FROM jobs WHERE id=?', j.id);
});
route('GET', '/api/jobs/:id/jd.pdf', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  return { __file: { name: `${j.id}-JD.pdf`, mime: 'application/pdf', buf: jdPdf(j) } };
});
function jdPdf(j) {
  const jd = j.jd || {}; const c = get('SELECT * FROM clients WHERE id=?', j.client_id);
  const L2 = [{ text: `${j.title} — ${j.city}`, size: 13, bold: true }, ''];
  for (const [k, lab] of [['summary', 'Role summary'], ['duties', 'Duties'], ['must', 'Must-have skills'], ['good', 'Good to have'], ['salary', 'Salary'], ['timings', 'Timings'], ['benefits', 'Benefits'], ['incentives', 'Incentives'], ['location', 'Location']]) {
    const v = k === 'salary' ? (jd.salary || L.salaryText(j)) : jd[k]; if (v) { L2.push({ text: lab, bold: true }); for (const line of String(v).split('\n')) L2.push(line); L2.push(''); }
  }
  L2.push(`Apply: ${L.link('apply', `?job=${j.id}`)}`);
  return F.makePdf(`Job description · ${j.id}`, L2, D.settings().business, c);
}
module.exports.jdPdf = jdPdf;
route('POST', '/api/jobs/:id/posting', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  const p = get('SELECT * FROM postings WHERE id=? AND job_id=?', ctx.body.id, j.id); if (!p) throw httpError(404, 'Posting not found');
  update('postings', p.id, { done_date: ctx.body.done ? (p.done_date || now()) : null, post_link: ctx.body.post_link ?? p.post_link, owner: ctx.body.owner ?? p.owner });
  D.history(ctx.actor.label, 'posting', j.id, p.channel, p.done_date ? 'done' : 'not done', ctx.body.done ? 'done' : 'not done');
  return { ok: true };
});
route('POST', '/api/jobs/:id/alert', ADMINS, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.params.id); mustSee(seeJob(ctx.user, j), 'job opening');
  const targets = ctx.body.ids && ctx.body.ids.length ? ctx.body.ids : L.bestMatches(j, 30, true).filter((m) => m.score >= D.settings().match.strong).map((m) => m.c.id);
  const budget = D.settings().bulk_budget; let sent = 0; const skipped = [];
  for (const cid of targets.slice(0, budget)) {
    const r = L.sendWA({ ptype: 'candidate', pid: cid, format: 'bbhs_job_alert', vars: { job: j.title, city: j.city, salary: L.salaryText(j) }, jb: j.id, by: ctx.actor, bulk: true, dedupe: `alert:${j.id}:${cid}` });
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
route('GET', '/api/candidates', T, (ctx) => {
  const q = ctx.query; const u = ctx.user; const s = D.settings();
  const minE = q.exp_min === undefined || q.exp_min === '' ? null : Number(q.exp_min); const maxE = q.exp_max === undefined || q.exp_max === '' ? null : Number(q.exp_max);
  const maxSal = q.sal_max ? Number(q.sal_max) * 12 : null; const fresh = q.updated ? Number(q.updated) : null;
  const rows = all('SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0 ORDER BY created_at DESC')
    .filter((c) => (q.archived ? c.archived : !c.archived) && (!q.dept || c.department === q.dept) && (!q.city || c.city === q.city || (c.work_cities || []).includes(q.city)) && (!q.job || c.job_wanted === q.job)
      && (minE === null || (c.exp_total ?? -1) >= minE) && (maxE === null || (c.exp_total ?? 999) <= maxE) && (!maxSal || (c.exp_salary || 0) <= maxSal) && (!q.notice || (c.notice_days ?? 999) <= Number(q.notice))
      && (!q.looking || c.looking === q.looking) && (!q.source || c.source === q.source) && (!q.tieup || String(c.tieup_id) === String(q.tieup)) && (!q.agency || c.agency_id === q.agency)
      && (!fresh || L.daysBetween(c.last_updated || c.created_at) <= fresh) && (!q.stale || L.daysBetween(c.last_updated || c.created_at) > 90)
      && like(q.q, c.id, c.name, R.phoneVisible(u, c) ? c.whatsapp : '', c.job_wanted, c.city, c.current_company, c.old_code))
    .map((c) => ({ ...candidateOut(u, c), status: V.candStatus(c.id) }))
    .filter((c) => !q.status || c.status.startsWith(q.status));
  if (['csv', 'xlsx'].includes(ctx.query.format) && !isSuper(u) && rows.length > 500) throw httpError(403, 'Agencies cannot download the whole resume bank. Narrow the filters first.');
  return page(ctx, rows, 'candidates', ['id', 'name', 'whatsapp', 'job_wanted', 'department', 'city', 'exp_total', [(r) => r.exp_salary ? Math.round(r.exp_salary / 12) : '', 'expected_per_month'], 'notice_days', 'source', 'looking', 'status']);
});
route('POST', '/api/candidates', T, (ctx) => {
  const b = ctx.body;
  const r = L.intakeCandidate({ ...b, exp_salary: b.exp_salary_month ? Number(b.exp_salary_month) * 12 : b.exp_salary, cur_salary: b.cur_salary_month ? Number(b.cur_salary_month) * 12 : b.cur_salary }, { source: b.source || `Created by ${ctx.actor.label}`, by: ctx.actor });
  if (r.isNew && !r.candidate.agency_id) update('candidates', r.candidate.id, { agency_id: ctx.user.agency_id, recruiter_id: ctx.user.id, is_new: 0 });
  return { id: r.candidate.id, isNew: r.isNew };
});
route('GET', '/api/candidates/:id', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', L.resolveId(ctx.params.id)); if (!c) throw httpError(404, 'Candidate not found');
  const u = ctx.user; const show = R.phoneVisible(u, c);
  const apps = all('SELECT * FROM applications WHERE candidate_id=? ORDER BY created_at DESC', c.id).map(V.appView);
  const msgs = seeThread(u, 'candidate', c.id) ? all("SELECT * FROM messages WHERE person_type='candidate' AND person_id=? ORDER BY at DESC LIMIT 30", c.id) : [];
  return {
    ...candidateOut(u, c), status: V.candStatus(c.id), apps, messages: msgs, rating: L.ratingOf(c.id), can_message: seeThread(u, 'candidate', c.id) || isSuper(u),
    files: show ? all('SELECT * FROM files WHERE record_id=? AND replaced=0 ORDER BY at DESC', c.id) : all("SELECT * FROM files WHERE record_id=? AND replaced=0 AND type='short_cv'", c.id),
    notes: all('SELECT * FROM notes WHERE record_id=? ORDER BY at DESC', c.id), consents: all("SELECT * FROM consents WHERE person_type='candidate' AND person_id=? ORDER BY at DESC", c.id),
    tieup: c.tieup_id ? get('SELECT * FROM tieups WHERE id=?', c.tieup_id) : null, referral_link: L.link('apply', `?ref=${c.id}`), agency_name: V.agencyName(c.agency_id), recruiter_name: V.userName(c.recruiter_id),
  };
});
route('PATCH', '/api/candidates/:id', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.params.id); if (!c) throw httpError(404, 'Not found');
  if (!R.phoneVisible(ctx.user, c)) throw httpError(403, 'Only the candidate\'s own agency can edit this profile.');
  const allowed = ['name', 'whatsapp', 'email', 'city', 'work_cities', 'job_wanted', 'exp_total', 'exp_jewellery', 'cur_salary', 'exp_salary', 'notice_days', 'skills', 'current_company', 'looking', 'tieup_id', 'archived', 'recruiter_id'];
  const patch = {}; for (const k of allowed) if (ctx.body[k] !== undefined) patch[k] = ctx.body[k];
  if (patch.whatsapp) { patch.whatsapp = L.digits10(patch.whatsapp); if (!L.validPhone(patch.whatsapp)) throw httpError(400, 'Enter a 10-digit WhatsApp number', 'whatsapp'); }
  if (patch.job_wanted) patch.department = L.deptOf(patch.job_wanted);
  patch.last_updated = now();
  if (isSuper(ctx.user) && ctx.body.agency_id !== undefined) patch.agency_id = ctx.body.agency_id;
  return D.edit('candidates', c.id, patch, ctx.actor.label, ctx.ip);
});
route('POST', '/api/candidates/bulk', T, (ctx) => {
  const { ids, action, job_id } = ctx.body; const out = { done: 0, errors: [] };
  if (action === 'add_to_job') {
    const j = get('SELECT * FROM jobs WHERE id=?', job_id); mustSee(seeJob(ctx.user, j) || (j && j.agency_id === ctx.user.agency_id), 'job opening');
    for (const id of ids) { try { L.createApplication(id, job_id, ctx.actor, null, 'Added from resume bank'); out.done++; } catch (e) { out.errors.push(`${id}: ${e.message}`); } }
  } else if (action === 'alert') {
    if (ctx.user.level === 'sub') throw httpError(403, 'Sub admins cannot send bulk job alerts.');
    const j = get('SELECT * FROM jobs WHERE id=?', job_id); if (!j) throw httpError(400, 'Pick a job');
    for (const id of ids.slice(0, D.settings().bulk_budget)) { const r = L.sendWA({ ptype: 'candidate', pid: id, format: 'bbhs_job_alert', vars: { job: j.title, city: j.city, salary: L.salaryText(j) }, jb: j.id, by: ctx.actor, bulk: true, dedupe: `alert:${j.id}:${id}` }); if (r.skipped) out.errors.push(`${id}: ${r.skipped}`); else out.done++; }
  }
  return out;
});
route('GET', '/api/gap', T, (ctx) => {
  const s = D.settings(); const cities = s.cities.map((c) => c.name); const depts = s.departments;
  const grid = {};
  for (const c of all("SELECT city, department, work_cities FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0 AND archived=0 AND looking IN ('Actively looking','Open to offers')")) {
    const key = `${c.city}|${c.department}`; grid[key] = (grid[key] || 0) + 1;
  }
  return { cities, depts, grid, targets: s.gap_targets || {} };
});
// Target count for one city × department box of the gap view (empty clears it).
route('POST', '/api/gap/target', ADMINS, (ctx) => {
  const { cell, target } = ctx.body; if (!cell || !cell.includes('|')) throw httpError(400, 'Pick a box');
  const t = { ...(D.settings().gap_targets || {}) }; const n = Number(target);
  if (!target || !n) delete t[cell]; else t[cell] = Math.round(n);
  D.setSetting('gap_targets', t); D.history(ctx.actor.label, 'gap target', null, cell, null, target || 'cleared'); return { ok: true };
});
route('GET', '/api/tieups', T, () => all('SELECT t.*, (SELECT COUNT(*) FROM candidates c WHERE c.tieup_id=t.id) AS candidates FROM tieups t ORDER BY name').map((t) => ({ ...t, owner_name: V.userName(t.owner_id) })));
route('POST', '/api/tieups', T, (ctx) => {
  const b = ctx.body; if (!b.name) throw httpError(400, 'Enter the name', 'name');
  if (b.id) { D.edit('tieups', b.id, { name: b.name, type: b.type, city: b.city, contact: b.contact, phone: L.digits10(b.phone), owner_id: b.owner_id, last_list: b.last_list }, ctx.actor.label); return { id: b.id }; }
  const r = D.run('INSERT INTO tieups (name,type,city,contact,phone,owner_id,last_list) VALUES (?,?,?,?,?,?,?)', b.name, b.type || 'College', b.city || '', b.contact || '', L.digits10(b.phone), b.owner_id || ctx.user.id, b.last_list || null);
  D.history(ctx.actor.label, 'create', `TU-${r.lastInsertRowid}`, null, null, b.name); return { id: Number(r.lastInsertRowid) };
});
route('GET', '/api/saved-searches', T, (ctx) => all('SELECT * FROM saved_searches WHERE user_id=?', ctx.user.id));
route('POST', '/api/saved-searches', T, (ctx) => { D.run('INSERT INTO saved_searches (user_id,name,query) VALUES (?,?,?)', ctx.user.id, ctx.body.name, JSON.stringify(ctx.body.query)); return { ok: true }; });

// ---------- Excel import ----------
route('POST', '/api/import/preview', T, (ctx) => {
  const { kind, name, base64, source } = ctx.body; if (!I.FIELDS[kind]) throw httpError(400, 'Pick what you are uploading');
  const rows = F.readSpreadsheet(name, base64); if (!rows.length) throw httpError(400, 'The file has no rows.');
  const headers = rows[0].map(String);
  const saved = get('SELECT map FROM column_maps WHERE source=?', `${kind}:${source || ''}`);
  return { headers, sample: rows.slice(1, 11), total: rows.length - 1, map: saved ? saved.map : I.guessMap(kind, headers), fields: I.FIELDS[kind].map(([k, label]) => ({ key: k, label })), saved: !!saved };
});
route('POST', '/api/import/run', T, (ctx) => {
  const { kind, name, base64, source, map, tieup_id } = ctx.body;
  if (kind !== 'candidates' && ctx.user.level === 'sub') throw httpError(403, 'Only admins can import clients and jobs.');
  const rows = F.readSpreadsheet(name, base64).slice(1);
  D.run('INSERT INTO column_maps (source,map) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET map=excluded.map', `${kind}:${source || ''}`, JSON.stringify(map));
  const res = I.runImport(kind, rows, map, { source, by: ctx.actor, tieup_id });
  if (tieup_id) update('tieups', tieup_id, { last_list: now() });
  return res;
});

// ---------- applications ----------
route('GET', '/api/applications', T, (ctx) => {
  const q = ctx.query;
  const rows = visibleApps(ctx.user).map(V.appView)
    .filter((a) => (!q.job || a.job_id === q.job) && (q.closed ? true : a.result === 'open') && (!q.step || a.step === q.step) && like(q.q, a.id, a.candidate_name, a.job_title, a.client_name));
  return page(ctx, rows, 'applications', ['id', 'candidate_name', 'job_id', 'job_title', 'client_name', 'step', 'result', 'days_in_step', 'owner_name', 'source']);
});
route('GET', '/api/board', T, (ctx) => {
  const q = ctx.query;
  const rows = visibleApps(ctx.user).filter((a) => a.result === 'open' && (!q.job || a.job_id === q.job)).map(V.appView);
  return { steps: L.STEPS, apps: rows, jobs: visibleJobs(ctx.user).map((j) => ({ id: j.id, title: j.title, client: V.jobView(j).client_name })) };
});
route('POST', '/api/applications', T, (ctx) => {
  const j = get('SELECT * FROM jobs WHERE id=?', ctx.body.job_id); mustSee(seeJob(ctx.user, j) || (j && j.agency_id === ctx.user.agency_id), 'job opening');
  return L.createApplication(ctx.body.candidate_id, j.id, ctx.actor, ctx.body.source, ctx.body.note);
});
function loadApp(ctx) {
  const a = get('SELECT * FROM applications WHERE id=?', ctx.params.id); mustSee(a && seeApp(ctx.user, a), 'application'); return a;
}
route('GET', '/api/applications/:id', T, (ctx) => {
  const a = loadApp(ctx); const v = V.appView(a);
  const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const cand = get('SELECT * FROM candidates WHERE id=?', a.candidate_id); const client = get('SELECT * FROM clients WHERE id=?', job.client_id);
  const bill = get('SELECT * FROM bills WHERE app_id=? AND credit_of IS NULL ORDER BY created_at DESC', a.id);
  return {
    ...v, candidate: candidateOut(ctx.user, cand), job: V.jobView(job), client: { id: client.id, company: client.company, contact: client.contact },
    history: all('SELECT * FROM app_history WHERE app_id=? ORDER BY at DESC, id DESC', a.id), messages: all('SELECT * FROM messages WHERE ap=? ORDER BY at DESC', a.id),
    score: L.matchScore(cand, job, L.ratingOf(cand.id)), bill: bill ? L.billView(bill) : null, suggest: suggestFor(a), steps: L.STEPS,
    files: all('SELECT * FROM files WHERE record_id=? AND replaced=0 ORDER BY at DESC', a.id), notes: all('SELECT * FROM notes WHERE record_id=? ORDER BY at DESC', a.id),
    checklist_items: D.settings().templates.joining_checklist.split('\n').filter(Boolean),
    replacement_window: (client.replacement_days || D.settings().replacement_days),
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
  return L.moveStep(a.id, step, ctx.actor, ctx.body.note || (ctx.body.next ? 'Move to next step' : 'Step set by hand'));
});
route('POST', '/api/applications/:id/close', T, (ctx) => { const a = loadApp(ctx); return L.closeApplication(a.id, ctx.body.reason, ctx.actor, ctx.body.note); });
route('POST', '/api/applications/:id/reopen', T, (ctx) => { const a = loadApp(ctx); return L.reopenApplication(a.id, ctx.actor); });
route('POST', '/api/applications/:id/hold', T, (ctx) => {
  const a = loadApp(ctx); const on = !!ctx.body.on;
  if (on && !ctx.body.reason) throw httpError(400, 'Give the reason', 'reason');
  update('applications', a.id, { on_hold: on ? 1 : 0, hold_reason: on ? ctx.body.reason : null, hold_until: on ? ctx.body.until || null : null });
  L.appHist(a.id, a.step, ctx.actor, on ? `On hold: ${ctx.body.reason}${ctx.body.until ? ' until ' + ctx.body.until : ''}` : 'Hold removed', 'hold');
  if (on && ctx.body.until) insert('followups', { record_id: a.id, at: new Date(ctx.body.until + 'T09:00:00+05:30').toISOString(), note: `Come back to ${a.id}: ${ctx.body.reason}`, for_user: ctx.user.id, created_by: ctx.user.id });
  return { ok: true };
});
route('POST', '/api/applications/:id/offer', T, (ctx) => { const a = loadApp(ctx); return L.recordOffer(a.id, ctx.body, ctx.actor); });
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
      if (action === 'step') L.moveStep(id, step, ctx.actor, 'Bulk move'); else if (action === 'close') L.closeApplication(id, reason, ctx.actor, 'Bulk close');
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
  const iv = get('SELECT * FROM interviews WHERE id=?', ctx.params.id); const a = iv && get('SELECT * FROM applications WHERE id=?', iv.app_id);
  mustSee(a && seeApp(ctx.user, a), 'interview'); return L.recordInterview(iv.id, ctx.body, ctx.actor);
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
    .map((t) => { const last = get('SELECT text, direction, status FROM messages WHERE person_type=? AND person_id=? ORDER BY at DESC LIMIT 1', t.person_type, t.person_id); return { ...t, name: V.threadName(t.person_type, t.person_id), last }; })
    .filter((t) => like(ctx.query.q, t.name, t.person_id));
  const failed = f === 'Failed' ? all("SELECT * FROM messages WHERE status='failed' ORDER BY at DESC").filter((m) => seeThread(u, m.person_type, m.person_id)) : [];
  return { threads: f === 'Failed' ? [] : rows, failed };
});
route('GET', '/api/wa/thread/:ptype/:pid', T, (ctx) => {
  const { ptype, pid } = ctx.params; mustSee(seeThread(ctx.user, ptype, pid) || isSuper(ctx.user), 'chat');
  D.run("UPDATE messages SET read_by_us=1 WHERE person_type=? AND person_id=? AND direction='in'", ptype, pid);
  const p = L.person(ptype, pid); const rec = p.record;
  const showPhone = ptype !== 'candidate' || R.phoneVisible(ctx.user, rec);
  return {
    person: { type: ptype, id: pid, name: V.threadName(ptype, pid), phone: showPhone ? p.phone : R.maskPhone(p.phone), opted_out: p.opted_out, window_until: L.windowOpenUntil(ptype, pid) },
    messages: all('SELECT * FROM messages WHERE person_type=? AND person_id=? ORDER BY at', ptype, pid),
    quick: ptype === 'client' ? ['bbhs_shortlist_ready', 'bbhs_feedback_request', 'bbhs_payment_reminder'] : ptype === 'candidate' ? ['bbhs_details_request', 'bbhs_interview_reminder', 'bbhs_job_alert'] : ['bbhs_team_task_alert', 'bbhs_log_reminder', 'bbhs_day_summary'],
  };
});
// Everything the one message window needs: who, window, suggested formats, filled-in details.
// The filled-in details for a message (name, job, date, amount, link …) from the linked records.
function composeVars(b, p) {
  const s = D.settings(); const vars = { name: p.name };
  let job = b.jb ? get('SELECT * FROM jobs WHERE id=?', b.jb) : null; const app = b.ap ? get('SELECT * FROM applications WHERE id=?', b.ap) : null;
  if (app && !job) job = get('SELECT * FROM jobs WHERE id=?', app.job_id);
  if (job) { const cl = get('SELECT * FROM clients WHERE id=?', job.client_id); Object.assign(vars, { job: job.title, job_id: job.id, city: job.city, salary: L.salaryText(job), company: cl.company, count: get("SELECT COUNT(*) c FROM applications WHERE job_id=? AND step='Sent to client' AND result='open'", job.id).c }); }
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
  const forType = { client: ['bbhs_client_welcome', 'bbhs_shortlist_ready', 'bbhs_feedback_request', 'bbhs_bill_raised', 'bbhs_payment_reminder', 'bbhs_team_task_alert'], candidate: ['bbhs_candidate_welcome', 'bbhs_details_request', 'bbhs_interview_scheduled', 'bbhs_interview_reminder', 'bbhs_offer', 'bbhs_joining_reminder', 'bbhs_post_join_checkin', 'bbhs_job_alert', 'bbhs_still_looking', 'bbhs_consent_request'], user: ['bbhs_team_task_alert', 'bbhs_log_reminder', 'bbhs_day_summary'] }[b.ptype];
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
route('GET', '/api/logs', T, (ctx) => {
  const u = ctx.user; const today = L.istDay();
  const mine = get('SELECT * FROM logs WHERE user_id=? AND day=?', u.id, today);
  const from = new Date(new Date(today + 'T00:00:00+05:30')).toISOString();
  const team = all("SELECT * FROM users WHERE status='On' AND level!='super' ORDER BY agency_id, name").filter((x) => isSuper(u) || (u.level === 'admin' && x.agency_id === u.agency_id && x.level === 'sub'))
    .map((x) => ({ id: x.id, name: x.name, level: x.level, agency_name: V.agencyName(x.agency_id), dots: logDots(x.id), today: get('SELECT * FROM logs WHERE user_id=? AND day=?', x.id, today), can_approve: (isSuper(u) && x.level === 'admin') || (u.level === 'admin' && x.level === 'sub') }));
  const recent = all('SELECT * FROM logs ORDER BY day DESC, at DESC LIMIT 200').filter((l) => team.some((t) => t.id === l.user_id) || l.user_id === u.id).map((l) => ({ ...l, name: V.userName(l.user_id) }));
  return { mine, counts: perfOf(u.id, from), deadline: D.settings().log_deadline, team, recent, my_dots: logDots(u.id) };
});
route('POST', '/api/logs', T, (ctx) => {
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
route('POST', '/api/logs/:id/approve', ADMINS, (ctx) => {
  const lg = get('SELECT * FROM logs WHERE id=?', ctx.params.id); if (!lg) throw httpError(404, 'Log not found');
  const owner = get('SELECT * FROM users WHERE id=?', lg.user_id);
  if (!((isSuper(ctx.user) && owner.level === 'admin') || (ctx.user.level === 'admin' && owner.level === 'sub' && owner.agency_id === ctx.user.agency_id) || isSuper(ctx.user))) throw httpError(403, 'You cannot approve this log.');
  update('logs', lg.id, { status: 'Approved', approved_by: ctx.user.id }); D.history(ctx.actor.label, 'log approved', lg.id); return { ok: true };
});

// ---------- bills, payments, payouts (16) ----------
route('GET', '/api/bills', T, (ctx) => {
  if (ctx.user.level === 'sub') throw httpError(403, 'Sub admins do not see bills.');
  const q = ctx.query;
  const rows = all('SELECT * FROM bills ORDER BY created_at DESC').filter((b) => seeBill(ctx.user, b)).map(L.billView).map((b) => {
    const a = V.appView(get('SELECT * FROM applications WHERE id=?', b.app_id)); return { ...b, client_name: (get('SELECT company FROM clients WHERE id=?', b.client_id) || {}).company, candidate_name: a.candidate_name, job_title: a.job_title, joining_date: a.joining_date, agency_name: V.agencyName(b.agency_id), bb_share: b.fee - b.agency_share };
  }).filter((b) => (!q.status || b.view_status === q.status) && (!q.client || b.client_id === q.client) && (!q.agency || b.agency_id === q.agency) && like(q.q, b.id, b.bill_no, b.client_name, b.candidate_name));
  const live = rows.filter((b) => !['Draft', 'Cancelled'].includes(b.view_status));
  const totals = { billed: live.reduce((a, b) => a + b.total, 0), received: live.reduce((a, b) => a + b.paid + b.tds, 0), outstanding: live.reduce((a, b) => a + b.balance, 0), overdue: live.filter((b) => b.view_status === 'Overdue').reduce((a, b) => a + b.balance, 0), agency_due: live.filter((b) => b.payout_status === 'Due').reduce((a, b) => a + b.agency_share, 0) };
  const p = page(ctx, rows, 'bills', ['id', 'bill_no', 'client_name', 'candidate_name', 'job_title', 'joining_date', 'ctc', 'fee', 'gst', 'total', 'paid', 'tds', 'balance', 'view_status', 'agency_name', 'agency_share', 'bb_share', 'payout_status']);
  return p.__file ? p : { ...p, totals };
});
function loadBill(ctx) { const b = get('SELECT * FROM bills WHERE id=?', ctx.params.id); mustSee(b && seeBill(ctx.user, b), 'bill'); return b; }
route('GET', '/api/bills/:id', T, (ctx) => {
  const b = loadBill(ctx); const v = L.billView(b); const a = V.appView(get('SELECT * FROM applications WHERE id=?', b.app_id));
  return { ...v, app: a, client: get('SELECT * FROM clients WHERE id=?', b.client_id), payments: all('SELECT * FROM payments WHERE bill_id=? ORDER BY date', b.id), credits: all('SELECT * FROM credit_notes WHERE bill_id=?', b.id), upi: L.upiLink(v.balance || v.total, b.bill_no), agency_name: V.agencyName(b.agency_id) };
});
route('PATCH', '/api/bills/:id', ADMINS, (ctx) => {
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
route('POST', '/api/bills/:id/issue', ADMINS, (ctx) => { const b = loadBill(ctx); return L.issueBill(b.id, ctx.actor); });
route('POST', '/api/bills/:id/payment', SUPER, (ctx) => {
  const b = loadBill(ctx); if (!['Issued'].includes(b.status)) throw httpError(400, 'Payments can be recorded only on an issued bill.');
  const amt = Number(ctx.body.amount) || 0; const tds = Number(ctx.body.tds) || 0;
  if (amt <= 0 && tds <= 0) throw httpError(400, 'Enter the amount received', 'amount');
  insert('payments', { bill_id: b.id, date: ctx.body.date || L.istDay(), amount: amt, mode: ctx.body.mode || 'UPI', ref: ctx.body.ref || '', tds, by: ctx.actor.label, created_at: now() });
  D.history(ctx.actor.label, 'payment', b.id, null, null, `${L.inr(amt)} ${ctx.body.mode || ''} ${ctx.body.ref || ''}${tds ? ' TDS ' + L.inr(tds) : ''}`);
  return L.refreshBill(b.id, ctx.actor.label);
});
route('POST', '/api/bills/:id/credit', SUPER, (ctx) => {
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
route('POST', '/api/bills/payouts', SUPER, (ctx) => {
  const ids = ctx.body.ids || []; let n = 0;
  for (const id of ids) { const b = get('SELECT * FROM bills WHERE id=?', id); if (b && b.payout_status === 'Due') { update('bills', id, { payout_status: 'Paid', payout_paid_at: now(), payout_ref: ctx.body.ref || '' }); D.history(ctx.actor.label, 'payout paid', id, 'payout_status', 'Due', 'Paid'); n++; } }
  return { paid: n };
});
route('GET', '/api/bills/:id/pdf', T, (ctx) => { const b = loadBill(ctx); D.history(ctx.actor.label, 'download', b.id, 'invoice'); return { __file: { name: `${(b.bill_no || b.id).replace(/\//g, '-')}.pdf`, mime: 'application/pdf', buf: invoicePdf(b) } }; });
function invoicePdf(b) {
  const s = D.settings(); const biz = s.business; const v = L.billView(b);
  const c = get('SELECT * FROM clients WHERE id=?', b.client_id); const a = V.appView(get('SELECT * FROM applications WHERE id=?', b.app_id));
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
route('GET', '/api/money', SUPER, () => {
  const bills = all("SELECT * FROM bills WHERE status NOT IN ('Draft','Cancelled')").map(L.billView);
  const pays = all('SELECT * FROM payments');
  const bucket = (d, by) => { if (by === 'month') return String(d).slice(0, 7); const t = new Date(d); const day = (t.getUTCDay() + 6) % 7; return new Date(t.getTime() - day * 86400000).toISOString().slice(0, 10); };
  const agg = (by) => {
    const m = {};
    for (const b of bills) { const k = bucket(b.issued_at || b.date, by); m[k] = m[k] || { billed: 0, received: 0, overdue: 0, gst: 0, shares_due: 0 }; m[k].billed += b.total; m[k].gst += b.gst; if (b.view_status === 'Overdue') m[k].overdue += b.balance; if (b.payout_status === 'Due') m[k].shares_due += b.agency_share; }
    for (const p of pays) { const k = bucket(p.date, by); m[k] = m[k] || { billed: 0, received: 0, overdue: 0, gst: 0, shares_due: 0 }; m[k].received += p.amount; }
    return Object.entries(m).sort((x, y) => (x[0] < y[0] ? 1 : -1)).map(([k, v]) => ({ period: k, ...v }));
  };
  return { months: agg('month'), weeks: agg('week').slice(0, 12), oldest: bills.filter((b) => b.balance > 0).sort((x, y) => (x.due_date < y.due_date ? -1 : 1)).slice(0, 20).map((b) => ({ ...b, client_name: get('SELECT company FROM clients WHERE id=?', b.client_id).company, days_overdue: b.due_date ? L.daysBetween(b.due_date) : 0 })), payouts_due: bills.filter((b) => b.payout_status === 'Due').map((b) => ({ ...b, agency_name: V.agencyName(b.agency_id) })) };
});
route('GET', '/api/earnings', ADMINS, (ctx) => {
  const ag = ctx.query.agency && isSuper(ctx.user) ? ctx.query.agency : ctx.user.agency_id;
  const bills = all("SELECT * FROM bills WHERE agency_id=? AND status NOT IN ('Draft','Cancelled')", ag).map(L.billView);
  const months = {};
  for (const b of bills) { const k = String(b.issued_at || b.date).slice(0, 7); months[k] = months[k] || { bills: 0, billed: 0, shares: 0, paid: 0, due: 0, not_due: 0 }; const m = months[k]; m.bills++; m.billed += b.fee; m.shares += b.agency_share; if (b.payout_status === 'Paid') m.paid += b.agency_share; else if (b.payout_status === 'Due') m.due += b.agency_share; else m.not_due += b.agency_share; }
  const rows = Object.entries(months).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, v]) => ({ month: k, ...v }));
  if (['csv', 'xlsx'].includes(ctx.query.format)) return page(ctx, rows, `earnings-${ag}`, ['month', 'bills', 'billed', 'shares', 'paid', 'due', 'not_due']);
  return { agency: get('SELECT * FROM agencies WHERE id=?', ag), months: rows, bills: bills.map((b) => ({ ...b, client_name: get('SELECT company FROM clients WHERE id=?', b.client_id).company })) };
});

// ---------- logins & team ----------
route('GET', '/api/users', ADMINS, (ctx) => {
  const u = ctx.user;
  const users = all('SELECT * FROM users ORDER BY id').filter((x) => isSuper(u) || x.agency_id === u.agency_id).map((x) => ({ id: x.id, name: x.name, whatsapp: x.whatsapp, level: x.level, agency_id: x.agency_id, agency_name: V.agencyName(x.agency_id), role: x.role, username: x.username, status: x.status, last_login: x.last_login, locked: x.locked_until && x.locked_until > now(), created_by: x.created_by, view_status: personStatus(x) }));
  if (ctx.query.format) return page(ctx, users, 'logins', ['id', 'name', 'username', 'level', 'agency_name', 'role', 'status', 'view_status', 'last_login', 'created_by']);
  return { users, agencies: isSuper(u) ? all('SELECT * FROM agencies ORDER BY id').map((a) => ({ ...a, view_status: agencyStatus(a), people: all('SELECT 1 FROM users WHERE agency_id=?', a.id).length })) : [] };
});
const usernameFrom = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
route('GET', '/api/users/suggest', ADMINS, (ctx) => {
  let base = usernameFrom(ctx.query.name || ''); let n = base; let i = 2;
  while (get('SELECT 1 FROM users WHERE username=?', n)) n = `${base}${i++}`;
  return { username: n };
});
route('POST', '/api/users', ADMINS, (ctx) => {
  const u = ctx.user; const b = ctx.body;
  if (!b.name) throw httpError(400, 'Enter the name', 'name');
  const level = isSuper(u) ? (b.level || 'sub') : 'sub';
  const agency = isSuper(u) ? b.agency_id : u.agency_id;
  if (level !== 'super' && !agency) throw httpError(400, 'Pick the agency', 'agency_id');
  const username = (b.username || usernameFrom(b.name)).toLowerCase().trim();
  if (!/^[a-z0-9._-]{3,}$/.test(username)) throw httpError(400, 'Username: at least 3 letters, numbers or dots', 'username');
  if (get('SELECT 1 FROM users WHERE username=?', username)) throw httpError(400, 'This username is already used', 'username');
  const phone = L.digits10(b.whatsapp); if (!L.validPhone(phone)) throw httpError(400, 'Enter a 10-digit WhatsApp number', 'whatsapp');
  const pw = L.newPassword(); const id = D.nextId('U');
  insert('users', { id, name: b.name, whatsapp: phone, level, agency_id: level === 'super' ? null : agency, role: b.role || (level === 'admin' ? 'Agency owner' : 'Recruiter'), username, pass_hash: L.hashPassword(pw), status: 'On', must_change: 1, failed: 0, created_by: u.id, created_at: now() });
  D.history(ctx.actor.label, 'create login', id, null, null, `${username} (${level})`);
  L.sendWA({ ptype: 'user', pid: id, format: 'bbhs_team_login', vars: { username, password: pw, link: L.link('team') }, by: ctx.actor, rule: 'team_login', secret: pw });
  return { id, username, password: pw };
});
function canManage(u, target) { return isSuper(u) || (u.level === 'admin' && target.agency_id === u.agency_id && target.level === 'sub'); }
route('POST', '/api/users/:id/reset', ADMINS, (ctx) => {
  const t = get('SELECT * FROM users WHERE id=?', ctx.params.id); if (!t || !canManage(ctx.user, t)) throw httpError(403, 'You cannot reset this login.');
  const pw = L.newPassword(); update('users', t.id, { pass_hash: L.hashPassword(pw), must_change: 1, failed: 0, locked_until: null });
  D.run('DELETE FROM sessions WHERE kind=? AND subject_id=?', 'team', t.id);
  D.history(ctx.actor.label, 'reset password', t.id);
  L.sendWA({ ptype: 'user', pid: t.id, format: 'bbhs_team_login', vars: { username: t.username, password: pw, link: L.link('team') }, by: ctx.actor, rule: 'team_login', secret: pw });
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
  const t = get('SELECT * FROM users WHERE id=?', ctx.params.id); if (!t || !canManage(ctx.user, t)) throw httpError(403, 'You cannot edit this login.');
  const patch = {}; for (const k of ['name', 'role', 'whatsapp']) if (ctx.body[k] !== undefined) patch[k] = k === 'whatsapp' ? L.digits10(ctx.body[k]) : ctx.body[k];
  return D.edit('users', t.id, patch, ctx.actor.label, ctx.ip);
});
route('POST', '/api/agencies', SUPER, (ctx) => {
  const b = ctx.body; if (!b.name) throw httpError(400, 'Enter the agency name', 'name');
  const id = D.nextId('AG');
  insert('agencies', { id, name: b.name, city: b.city || '', since: L.istDay(), status: 'Active', share_pct: b.share_pct === '' || b.share_pct === undefined ? null : Number(b.share_pct), created_at: now() });
  D.history(ctx.actor.label, 'create', id, null, null, b.name);
  let admin = null;
  if (b.admin_name) {
    const phone = L.digits10(b.admin_whatsapp); if (!L.validPhone(phone)) throw httpError(400, 'Enter the admin\'s 10-digit WhatsApp number', 'admin_whatsapp');
    let username = usernameFrom(b.admin_name); let i = 2; const base = username; while (get('SELECT 1 FROM users WHERE username=?', username)) username = `${base}${i++}`;
    const pw = L.newPassword(); const uid = D.nextId('U');
    insert('users', { id: uid, name: b.admin_name, whatsapp: phone, level: 'admin', agency_id: id, role: 'Agency owner', username, pass_hash: L.hashPassword(pw), status: 'On', must_change: 1, created_by: ctx.user.id, created_at: now() });
    L.sendWA({ ptype: 'user', pid: uid, format: 'bbhs_team_login', vars: { username, password: pw, link: L.link('team') }, by: ctx.actor, rule: 'team_login', secret: pw });
    admin = { id: uid, username, password: pw };
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

// ---------- settings (super admin) ----------
const EDITABLE = ['business', 'industries', 'default_industry', 'hidden_jobs', 'departments', 'cities', 'skills', 'client_stages', 'closing_reasons', 'job_close_reasons', 'reopen_reasons', 'lead_sources', 'src_tags', 'fee', 'agency_share_pct', 'gst', 'replacement_days', 'payment_days', 'targets', 'log_deadline', 'quiet', 'daily_limit', 'bulk_budget', 'match', 'languages', 'id_start', 'bill_prefix', 'retention_years', 'team_idle_hours', 'formats', 'auto_rules', 'crm', 'posting_channels', 'gap_targets', 'templates', 'jd_template', 'jd_templates'];
route('GET', '/api/settings', SUPER, () => { const s = { ...D.settings() }; s.crm = { ...s.crm, token: s.crm.token ? '••••••••' : '', webhook_secret: s.crm.from_env && s.crm.from_env.webhook_secret ? '••••••••' : s.crm.webhook_secret }; return s; });
route('POST', '/api/health/mail', SUPER, async () => require('./mailbox').check());
route('PUT', '/api/settings/:key', SUPER, (ctx) => {
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
route('POST', '/api/settings/formats/push', SUPER, async (ctx) => {
  const s = D.settings(); const names = ctx.body.names && ctx.body.names.length ? ctx.body.names : Object.keys(s.formats);
  const templates = [];
  for (const name of names) {
    const f = s.formats[name]; if (!f) continue;
    for (const lang of s.languages) if (f[lang]) templates.push({ name, category: f.type.toUpperCase(), language: lang, body: metaBody(f[lang]).body, buttons: f.buttons });
  }
  const out = await crmCall('/templates', 'POST', { templates });
  D.history(ctx.actor.label, 'templates sent to Meta', null, null, null, `${templates.length} templates`);
  return out;
});
route('POST', '/api/settings/formats/sync', SUPER, async (ctx) => {
  const out = await crmCall('/templates', 'GET');
  const s = D.settings(); const formats = JSON.parse(JSON.stringify(s.formats)); const seen = {};
  for (const t of out.templates || []) {
    if (!formats[t.name]) continue;
    (seen[t.name] = seen[t.name] || {})[t.language] = t.status;
  }
  for (const [name, langs] of Object.entries(seen)) {
    formats[name].meta_status = langs;
    formats[name].approved = Object.values(langs).length > 0 && Object.values(langs).every((st) => st === 'APPROVED');
  }
  D.setSetting('formats', formats);
  D.history(ctx.actor.label, 'templates status from Meta', null, null, null, `${Object.keys(seen).length} formats`);
  return { formats: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v])), missing: Object.keys(formats).filter((k) => !seen[k]) };
});

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
route('GET', '/api/health', SUPER, () => {
  const h = Object.fromEntries(all('SELECT * FROM health').map((r) => [r.key, r.value]));
  const fs = require('fs'); const path = require('path');
  let bytes = 0; for (const f of fs.readdirSync(path.join(D.DATA_DIR, 'files'))) bytes += fs.statSync(path.join(D.DATA_DIR, 'files', f)).size;
  const dbBytes = fs.statSync(path.join(D.DATA_DIR, 'bbhs.db')).size;
  return { ...h, failed: all("SELECT * FROM messages WHERE status='failed' ORDER BY at DESC LIMIT 50"), scheduled: get("SELECT COUNT(*) c FROM messages WHERE status='scheduled'").c, files_mb: (bytes / 1048576).toFixed(2), db_mb: (dbBytes / 1048576).toFixed(2), backups: fs.readdirSync(path.join(D.DATA_DIR, 'backups')).sort().reverse().slice(0, 30), crm_enabled: D.settings().crm.enabled,
    setup: { copy: D.ENV.name, virus_scanner: D.ENV.clamd.host ? `ClamAV at ${D.ENV.clamd.host}:${D.ENV.clamd.port}` : 'Not set — only the EICAR test file is blocked (set CLAMD_HOST)', alerts: D.ENV.alertWebhook ? 'Alert webhook set' : 'Not set (ALERT_WEBHOOK_URL)', offsite_backup: D.ENV.backupDir || 'Not set (BACKUP_DIR)', email_inbox: D.ENV.imap.host ? `${D.ENV.imap.user} on ${D.ENV.imap.host}` : 'Not set (IMAP_HOST, IMAP_USER, IMAP_PASS)' } };
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
route('GET', '/api/alerts', T, (ctx) => all('SELECT * FROM alerts WHERE user_id=? ORDER BY at DESC LIMIT 50', ctx.user.id));
route('POST', '/api/alerts/read', T, (ctx) => { if (ctx.body.id) D.run('UPDATE alerts SET read=1 WHERE id=? AND user_id=?', ctx.body.id, ctx.user.id); else D.run('UPDATE alerts SET read=1 WHERE user_id=?', ctx.user.id); return { ok: true }; });
route('POST', '/api/notes', T, (ctx) => {
  if (!ctx.body.text) throw httpError(400, 'Write the note', 'text');
  insert('notes', { record_id: ctx.body.record_id, text: ctx.body.text, author: ctx.actor.label, at: now() }); D.history(ctx.actor.label, 'note', ctx.body.record_id); return { ok: true };
});
route('POST', '/api/followups', T, (ctx) => {
  const b = ctx.body; if (!b.at) throw httpError(400, 'Pick the date and time', 'at');
  insert('followups', { record_id: b.record_id, at: new Date(b.at).toISOString(), note: b.note || '', for_user: b.for_user || ctx.user.id, done: 0, created_by: ctx.user.id }); return { ok: true };
});
route('POST', '/api/followups/:id/done', T, (ctx) => { D.run('UPDATE followups SET done=1 WHERE id=? AND for_user=?', ctx.params.id, ctx.user.id); return { ok: true }; });
route('GET', '/api/history/:id', T, (ctx) => all('SELECT * FROM history WHERE record_id=? ORDER BY id DESC LIMIT 200', ctx.params.id));
route('POST', '/api/files', T, async (ctx) => {
  const b = ctx.body; const f = await F.saveFile({ recordId: b.record_id, type: b.type || 'file', name: b.name, base64: b.base64, by: ctx.actor.label });
  if (b.type === 'cv') update('candidates', b.record_id, { cv_file: String(f.id), last_updated: now() });
  if (b.type === 'short_cv') update('candidates', b.record_id, { short_cv_file: String(f.id) });
  if (['gst', 'pan', 'owner_id'].includes(b.type)) { const c = get('SELECT * FROM clients WHERE id=?', b.record_id); update('clients', c.id, { kyc: { ...(c.kyc || {}), [b.type]: f.id } }); }
  if (b.type === 'contract_signed') update('clients', b.record_id, { contract: JSON.stringify({ file: f.id, by: ctx.actor.label, at: now(), method: 'Signed copy uploaded' }) });
  if (b.type === 'jd') D.edit('jobs', b.record_id, { jd: { ...(get('SELECT jd FROM jobs WHERE id=?', b.record_id) || {}).jd, file: f.id } }, ctx.actor.label);
  return f;
});
route('POST', '/api/candidates/:id/short-cv', T, (ctx) => {
  const c = get('SELECT * FROM candidates WHERE id=?', ctx.params.id); if (!c) throw httpError(404, 'Not found');
  const lines = [{ text: `${c.id} · ${c.job_wanted || ''}`, bold: true, size: 12 }, `City: ${c.city || '—'}  ·  Will work in: ${(c.work_cities || []).join(', ') || c.city || '—'}`, `Experience: ${c.exp_total ?? '—'} years (jewellery ${c.exp_jewellery ?? '—'})`,
    `Current company: ${c.current_company || '—'}`, `Expected salary: ${c.exp_salary ? L.inr(c.exp_salary / 12) + ' a month' : '—'}  ·  Notice: ${c.notice_days ?? '—'} days`, '', { text: 'Skills', bold: true }, (c.skills || []).join(', ') || '—', '', 'Phone and email are shared once you choose to interview.'];
  const f = F.storeBuffer({ recordId: c.id, type: 'short_cv', name: `ShortCV-${c.id}.pdf`, buf: F.makePdf(`Profile · ${c.name.split(' ')[0]}`, lines, D.settings().business), mime: 'application/pdf', by: ctx.actor.label });
  update('candidates', c.id, { short_cv_file: String(f.id) }); return f;
});

// ---------- reports (17) ----------
route('GET', '/api/reports/:name', ADMINS, (ctx) => {
  const u = ctx.user; const q = ctx.query; const name = ctx.params.name;
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
    const steps = [['Client leads', clients.length], ['Clients signed', clients.filter((c) => c.contract).length], ['Candidates added', apps.filter((a) => inR(a.created_at)).length]];
    for (const st of ['Screening', 'Our interview', 'Sent to client', 'Client interview', 'Offer made', 'Offer accepted', 'Joined']) steps.push([st, new Set(hist.filter((h) => h.step === st).map((h) => h.app_id)).size]);
    rows = steps.map(([step, n], i) => ({ step, count: n, drop: i > 2 && steps[i - 1][1] ? `${Math.round((1 - n / steps[i - 1][1]) * 100)}%` : '' }));
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
  } else if (name === 'sources') {
    const m = {};
    const add = (src, k) => { m[src || 'Other'] = m[src || 'Other'] || { source: src || 'Other', client_leads: 0, candidate_leads: 0, applications: 0, hires: 0 }; m[src || 'Other'][k]++; };
    for (const c of all('SELECT source, created_at FROM clients')) if (inR(c.created_at)) add(c.source, 'client_leads');
    for (const c of all('SELECT source, created_at FROM candidates')) if (inR(c.created_at)) add(c.source, 'candidate_leads');
    for (const a of apps) { if (inR(a.created_at)) add(a.source, 'applications'); if (a.result === 'Hired' && inR(a.joined_at)) add(a.source, 'hires'); }
    rows = Object.values(m).sort((a, b) => b.candidate_leads + b.client_leads - (a.candidate_leads + a.client_leads));
  } else if (name === 'performance') {
    rows = all("SELECT * FROM users WHERE level!='super'").filter((x) => (isSuper(u) || x.agency_id === u.agency_id) && (!q.agency || x.agency_id === q.agency) && (!q.person || x.id === q.person)).map((x) => ({ person: `${x.id} ${x.name}`, agency: V.agencyName(x.agency_id), level: x.level, ...perfOf(x.id, from, to) }));
  } else if (name === 'money') {
    rows = all("SELECT * FROM bills WHERE status NOT IN ('Draft')").filter((b) => seeBill(u, b) && inR(b.issued_at || b.created_at) && (!q.agency || b.agency_id === q.agency) && (!q.client || b.client_id === q.client)).map(L.billView).map((b) => ({ bill: b.bill_no || b.id, client: get('SELECT company FROM clients WHERE id=?', b.client_id).company, agency: V.agencyName(b.agency_id), fee: b.fee, gst: b.gst, total: b.total, received: b.paid, tds: b.tds, balance: b.balance, status: b.view_status, agency_share: b.agency_share, payout: b.payout_status }));
  } else if (name === 'replacements') {
    rows = apps.filter((a) => a.left_date && inR(new Date(a.left_date).toISOString())).map((a) => { const v = V.appView(a); const cl = get('SELECT * FROM clients WHERE id=?', v.client_id); const win = cl.replacement_days || D.settings().replacement_days; return { application: a.id, candidate: v.candidate_name, client: v.client_name, job: v.job_title, joined: L.istFmt(a.joined_at, false), left: a.left_date, days: L.daysBetween(a.joined_at, a.left_date), within_window: L.daysBetween(a.joined_at, a.left_date) <= win ? 'Yes' : 'No', reason: a.left_reason, free_replacement: a.replacement_used ? 'Yes' : 'No' }; });
  } else if (name === 'bank') {
    const cands = all('SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0').filter((c) => (!q.city || c.city === q.city) && (!q.dept || c.department === q.dept));
    const m = {};
    for (const c of cands) { const k = `${c.city || '—'}|${c.department || '—'}`; m[k] = m[k] || { city: c.city || '—', department: c.department || '—', active: 0, new_in_range: 0, fresh_90: 0, stale_90: 0 }; if (['Actively looking', 'Open to offers'].includes(c.looking)) m[k].active++; if (inR(c.created_at)) m[k].new_in_range++; if (L.daysBetween(c.last_updated || c.created_at) <= 90) m[k].fresh_90++; else m[k].stale_90++; }
    rows = Object.values(m).sort((a, b) => b.active - a.active);
  } else if (name === 'logs') {
    const people = all("SELECT * FROM users WHERE level!='super' AND status='On'").filter((x) => (isSuper(u) || x.agency_id === u.agency_id) && (!q.person || x.id === q.person));
    const days = Math.min(92, Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000)));
    rows = people.map((x) => { const logs = all('SELECT day, status FROM logs WHERE user_id=?', x.id).filter((l) => l.day >= from.slice(0, 10) && l.day <= to.slice(0, 10)); return { person: `${x.id} ${x.name}`, agency: V.agencyName(x.agency_id), days, submitted: logs.length, approved: logs.filter((l) => l.status === 'Approved').length, missing: Math.max(0, days - logs.length) }; });
  } else throw httpError(404, 'Unknown report');
  if (['csv', 'xlsx'].includes(q.format)) return page(ctx, rows, `report-${name}`, cols || Object.keys(rows[0] || { empty: '' }));
  return { rows };
});
module.exports.removePerson = removePerson;
