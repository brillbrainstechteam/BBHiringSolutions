// Time-based rules, checked every 10 minutes (8.5): reminders, result pending, overdue bills, check-ins, logs.
const D = require('./db');
const L = require('./logic');
const V = require('./views');
const { all, get, update, now } = D;

function runTimer() {
  const done = {};
  const count = (k) => { done[k] = (done[k] || 0) + 1; };
  const t = Date.now();
  // Messages held back in quiet hours go out at 9 am.
  for (const m of all("SELECT * FROM messages WHERE status='scheduled' AND scheduled_at<=?", now())) {
    update('messages', m.id, { status: D.settings().crm.enabled ? 'sending' : 'would send', at: now() });
    if (D.settings().crm.enabled) require('./crm').dispatchStored(m.id);
    count('released');
  }
  // Interview reminders: the day before and 2 hours before.
  for (const iv of all("SELECT * FROM interviews WHERE status IN ('Scheduled','Rescheduled') AND at>?", now())) {
    const hrs = (new Date(iv.at) - t) / 3600000;
    const a = get('SELECT * FROM applications WHERE id=?', iv.app_id); if (!a || a.result !== 'open') continue;
    const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const vars = L.ivVars(iv, job);
    const tag = hrs <= 2 ? '2h' : hrs <= 30 && L.istDay(iv.at) !== L.istDay() ? '1d' : null;
    if (!tag) continue;
    const r = L.sendWA({ ptype: 'candidate', pid: a.candidate_id, format: 'bbhs_interview_reminder', vars, ap: a.id, iv: iv.id, auto: true, rule: 'interview_reminder', dedupe: `ivr:${iv.id}:${iv.at}:${tag}` });
    if (!r.skipped) count('interview_reminder');
    if (iv.round === 'client') L.sendWA({ ptype: 'client', pid: job.client_id, format: 'bbhs_interview_reminder', vars: { ...vars, round: `interview with ${get('SELECT name FROM candidates WHERE id=?', a.candidate_id).name}` }, ap: a.id, iv: iv.id, auto: true, rule: 'interview_reminder', dedupe: `ivrc:${iv.id}:${iv.at}:${tag}` });
  }
  // Result pending → task alert to the interviewer (or the owner).
  for (const iv of all("SELECT * FROM interviews WHERE status IN ('Scheduled','Rescheduled') AND at<?", now())) {
    const a = get('SELECT * FROM applications WHERE id=?', iv.app_id); if (!a) continue;
    const who = get('SELECT id FROM users WHERE lower(name)=lower(?)', iv.interviewer || '') || { id: a.owner_id };
    if (iv.round === 'ours' && !get('SELECT 1 FROM alerts WHERE record_id=? AND text LIKE ?', iv.id, 'Result pending%')) { L.alertUser(who.id, `Result pending for ${iv.id}`, iv.id); count('result_pending'); }
    // Client rounds: feedback request 48 hours after.
    if (iv.round === 'client' && (t - new Date(iv.at)) / 3600000 >= 48) {
      const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const cand = get('SELECT name FROM candidates WHERE id=?', a.candidate_id);
      const r = L.sendWA({ ptype: 'client', pid: job.client_id, format: 'bbhs_feedback_request', vars: { candidate: cand.name, job: job.title }, ap: a.id, iv: iv.id, auto: true, rule: 'feedback_request', dedupe: `fb:${iv.id}` });
      if (!r.skipped) count('feedback_request');
    }
  }
  // Applications stuck 7 days → task alert to the owner (once per step).
  for (const a of all("SELECT * FROM applications WHERE result='open' AND on_hold=0")) {
    if (L.daysBetween(a.step_since || a.created_at) >= 7 && a.owner_id && !get('SELECT 1 FROM alerts WHERE record_id=? AND text=?', a.id, `${a.id} stuck at ${a.step} for 7 days`)) { L.alertUser(a.owner_id, `${a.id} stuck at ${a.step} for 7 days`, a.id); count('stuck'); }
    if (a.on_hold && a.hold_until && a.hold_until <= L.istDay()) update('applications', a.id, { on_hold: 0 });
  }
  // Joining reminders (3 days, 1 day before).
  for (const a of all("SELECT * FROM applications WHERE result='open' AND step='Offer accepted' AND joining_date IS NOT NULL")) {
    const d = Math.ceil((new Date(a.joining_date + 'T09:00:00+05:30') - t) / 86400000);
    if (d === 3 || d === 1) {
      const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const cl = get('SELECT company FROM clients WHERE id=?', job.client_id);
      const r = L.sendWA({ ptype: 'candidate', pid: a.candidate_id, format: 'bbhs_joining_reminder', vars: { company: cl.company, date: L.istFmt(a.joining_date, false) }, ap: a.id, auto: true, rule: 'joining_reminder', dedupe: `join:${a.id}:${d}` });
      if (!r.skipped) count('joining_reminder');
    }
  }
  // Day 30 / 60 / 90 check-ins.
  for (const a of all("SELECT * FROM applications WHERE result='Hired' AND left_date IS NULL AND joined_at IS NOT NULL")) {
    const days = L.daysBetween(a.joined_at);
    for (const mark of [30, 60, 90]) if (days >= mark && days < mark + 5) {
      const job = get('SELECT * FROM jobs WHERE id=?', a.job_id); const cl = get('SELECT company FROM clients WHERE id=?', job.client_id);
      const r = L.sendWA({ ptype: 'candidate', pid: a.candidate_id, format: 'bbhs_post_join_checkin', vars: { days: mark, company: cl.company }, ap: a.id, auto: true, rule: 'post_join_checkin', dedupe: `checkin:${a.id}:${mark}` });
      if (!r.skipped) count('checkin');
    }
  }
  // Bills: due in 3 days, due today, then every 7 days overdue.
  for (const b of all("SELECT * FROM bills WHERE status='Issued'").map(L.billView)) {
    if (b.balance <= 0 || !b.due_date) continue;
    const d = Math.round((new Date(b.due_date + 'T00:00:00+05:30') - new Date(L.istDay() + 'T00:00:00+05:30')) / 86400000);
    let tag = null; if (d === 3) tag = 'd3'; else if (d === 0) tag = 'd0'; else if (d < 0 && (-d) % 7 === 0) tag = `o${-d}`;
    if (!tag) continue;
    const r = L.sendWA({ ptype: 'client', pid: b.client_id, format: 'bbhs_payment_reminder', vars: { bill_no: b.bill_no, amount: L.inr(b.balance), status: d > 0 ? `due in ${d} days` : d === 0 ? 'due today' : 'overdue', link: L.upiLink(b.balance, b.bill_no) }, bl: b.id, auto: true, rule: 'payment_reminder', dedupe: `pay:${b.id}:${tag}` });
    if (!r.skipped) count('payment_reminder');
  }
  // Daily log reminder 30 minutes before the deadline.
  const [dh, dm] = D.settings().log_deadline.split(':').map(Number); const h = L.istHour();
  if (h >= dh + dm / 60 - 0.5 && h < dh + dm / 60) {
    for (const u of all("SELECT * FROM users WHERE status='On' AND level!='super'")) {
      if (!get('SELECT 1 FROM logs WHERE user_id=? AND day=?', u.id, L.istDay())) { const r = L.sendWA({ ptype: 'user', pid: u.id, format: 'bbhs_log_reminder', vars: { deadline: D.settings().log_deadline, link: L.link('team') }, auto: true, rule: 'log_reminder', dedupe: `log:${u.id}:${L.istDay()}` }); if (!r.skipped) count('log_reminder'); }
    }
  }
  // Evening summary to each admin and super admin (after the log deadline).
  if (h >= dh + dm / 60 + 1 && h < 21) {
    for (const u of all("SELECT * FROM users WHERE status='On' AND level IN ('admin','super')")) {
      const since = new Date(t - 86400000).toISOString();
      const moves = all('SELECT h.* FROM app_history h JOIN applications a ON a.id=h.app_id JOIN jobs j ON j.id=a.job_id WHERE h.at>?' + (u.level === 'admin' ? ' AND j.agency_id=?' : ''), ...(u.level === 'admin' ? [since, u.agency_id] : [since]));
      const summary = `${moves.filter((m) => m.kind === 'step').length} step moves, ${moves.filter((m) => m.step === 'Sent to client' && m.kind === 'step').length} sent to clients, ${moves.filter((m) => m.step === 'Joined' && m.kind === 'step').length} joined`;
      L.sendWA({ ptype: 'user', pid: u.id, format: 'bbhs_day_summary', vars: { date: L.istFmt(now(), false), summary, link: L.link('team') }, auto: true, rule: 'day_summary', dedupe: `sum:${u.id}:${L.istDay()}` });
    }
  }
  // Follow-ups due → bell + WhatsApp task alert.
  for (const f of all('SELECT * FROM followups WHERE done=0 AND alerted=0 AND at<=?', now())) { L.alertUser(f.for_user, `Follow-up: ${f.note || f.record_id}`, f.record_id); update('followups', f.id, { alerted: 1 }); count('followup'); }
  // Weekly freshness ping to candidates not updated in 90 days (Mondays).
  if (new Date(t + 330 * 60000).getUTCDay() === 1) {
    for (const c of all("SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0 AND archived=0 AND looking!='Placed' AND whatsapp!=''")) {
      if (L.daysBetween(c.last_updated || c.created_at) > 90) L.sendWA({ ptype: 'candidate', pid: c.id, format: 'bbhs_still_looking', vars: { link: L.link('my-profile') }, auto: true, rule: 'still_looking', dedupe: `fresh:${c.id}:${L.istDay()}` });
    }
  }
  // Retention: ask to remove candidates inactive for the set years.
  const yrs = D.settings().retention_years;
  const old = all('SELECT id FROM candidates WHERE removed=0 AND merged_into IS NULL').filter((c) => { const r = get('SELECT last_updated, created_at FROM candidates WHERE id=?', c.id); return L.daysBetween(r.last_updated || r.created_at) > yrs * 365; });
  if (old.length) for (const s of L.superAdmins()) if (!get('SELECT 1 FROM alerts WHERE user_id=? AND text LIKE ? AND at>?', s.id, 'Retention:%', new Date(t - 7 * 86400000).toISOString())) D.insert('alerts', { user_id: s.id, text: `Retention: ${old.length} candidate(s) inactive for ${yrs}+ years can be removed`, record_id: null, read: 0, at: now() });
  // Daily backup.
  try { D.backup(); } catch (e) { D.setHealth('last_failure', `${now()} backup: ${e.message}`); }
  D.setHealth('timer_last_run', now());
  return { ran_at: now(), ...done };
}

function start() {
  setTimeout(() => { try { runTimer(); } catch (e) { console.error('timer', e); D.setHealth('last_failure', `${now()} timer: ${e.message}`); } }, 5000);
  setInterval(() => { try { runTimer(); } catch (e) { console.error('timer', e); D.setHealth('last_failure', `${now()} timer: ${e.message}`); } }, 10 * 60 * 1000);
}
module.exports = { runTimer, start };
