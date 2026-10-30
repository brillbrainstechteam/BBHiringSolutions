// Read models: records with their worked-out numbers (never typed by hand).
const D = require('./db');
const L = require('./logic');
const { get, all } = D;

const userName = (id) => { if (!id) return ''; const u = get('SELECT name FROM users WHERE id=?', id); return u ? u.name : id; };
const agencyName = (id) => { if (!id) return ''; const a = get('SELECT name FROM agencies WHERE id=?', id); return a ? a.name : id; };

function jobView(j, apps) {
  if (!j) return j;
  apps = apps || L.appsOfJob(j.id);
  const status = L.computeJobStatus(j, apps);
  const open = apps.filter((a) => a.result === 'open');
  const client = get('SELECT company, city, placeholder, internal FROM clients WHERE id=?', j.client_id) || {};
  const cnt = (steps) => open.filter((a) => steps.includes(a.step)).length;
  return {
    ...j, status, reason: L.jobStatusReason(j, apps), filled: L.filledCount(apps), client_name: client.company, client_tbc: !!client.placeholder, internal: !!client.internal, recruiter_name: userName(j.recruiter_id), agency_name: agencyName(j.agency_id),
    apps_total: apps.length, apps_open: open.length, days_open: L.daysBetween(j.created_at),
    reopened: j.reopened_at && L.daysBetween(j.reopened_at) <= 30 ? (j.reopen_tag || 'Reopened') : null,
    counts: { screening: cnt(['Applied', 'Screening', 'Our interview']), waiting: cnt(['Sent to client']), interviews: cnt(['Client interview']), offers: cnt(['Offer made', 'Offer accepted']) },
    // One line per seat: who holds it (offer accepted or joined), in the order they took it; the rest are open.
    seats: (() => {
      // The order seats were taken in: when the offer was accepted (joining later does not move anyone).
      const takenAt = (a) => (get("SELECT MIN(at) t FROM app_history WHERE app_id=? AND step='Offer accepted'", a.id) || {}).t || a.joined_at || a.step_since || '';
      const held = apps.filter((a) => (a.result === 'open' && a.step === 'Offer accepted') || a.result === 'Hired').map((a) => ({ ...a, taken: takenAt(a) })).sort((a, b) => (a.taken < b.taken ? -1 : 1));
      return Array.from({ length: Math.max(j.openings, held.length) }, (_, i) => { const a = held[i]; if (!a) return { n: i + 1 }; const c = get('SELECT name FROM candidates WHERE id=?', a.candidate_id) || {}; return { n: i + 1, app_id: a.id, candidate: c.name, state: a.result === 'Hired' ? 'Joined' : 'Offer accepted', joining_date: a.joining_date }; });
    })(),
  };
}
function candStatus(candId) {
  const apps = all('SELECT step, result, left_date FROM applications WHERE candidate_id=?', candId);
  if (apps.some((a) => a.result === 'Hired' && !a.left_date)) return 'Hired';
  const open = apps.filter((a) => a.result === 'open').length;
  return open ? `In process · ${open}` : 'Available';
}
function appView(a) {
  if (!a) return a;
  const c = get('SELECT id, name, whatsapp, city, agency_id, job_wanted, exp_total FROM candidates WHERE id=?', a.candidate_id) || {};
  const j = get('SELECT id, title, client_id, city, recruiter_id, agency_id, openings FROM jobs WHERE id=?', a.job_id) || {};
  const cl = get('SELECT id, company FROM clients WHERE id=?', j.client_id) || {};
  const ivs = all('SELECT * FROM interviews WHERE app_id=? ORDER BY at', a.id).map(L.interviewView);
  return {
    ...a, candidate_name: c.name, candidate_city: c.city, job_title: j.title, job_city: j.city, client_id: cl.id, client_name: cl.company, owner_name: userName(a.owner_id),
    ad: L.adLabel(a), days_in_step: L.daysBetween(a.step_since || a.created_at), interviews: ivs, step_no: L.stepIdx(a.step) + 1,
  };
}
function clientView(c) {
  const jobs = all('SELECT * FROM jobs WHERE client_id=? AND archived=0', c.id).map((j) => jobView(j));
  return { ...c, agency_name: agencyName(c.agency_id), owner_name: userName(c.owner_id), jobs_open: jobs.filter((j) => !['Closed', 'Filled'].includes(j.status)).length, jobs_total: jobs.length };
}
const ONBOARDING = [
  { key: 'intro_call', label: 'Intro call', stage: 'Understanding needs' },
  { key: 'background', label: 'Background note' },
  { key: 'proposal', label: 'Proposal sent', stage: 'Proposal and pitch deck' },
  { key: 'meeting', label: 'Meeting (optional)' },
  { key: 'kyc', label: 'KYC received' },
  { key: 'contract', label: 'Contract signed', stage: 'Client activated' },
  { key: 'account', label: 'Account opened' },
  { key: 'first_job', label: 'First job opening', stage: 'Job opening active' },
];
// Some checklist items tick themselves from the data.
function onboardingView(c) {
  const ob = c.onboarding || {};
  const auto = {
    kyc: ['gst', 'pan', 'owner_id'].every((k) => (c.kyc || {})[k]),
    contract: !!c.contract,
    account: c.account_status === 'Opened',
    first_job: !!get('SELECT 1 FROM jobs WHERE client_id=?', c.id),
  };
  return ONBOARDING.map((it) => ({ ...it, ...(ob[it.key] || {}), done: !!((ob[it.key] || {}).done || auto[it.key]) }));
}
function threadName(ptype, pid) {
  const p = L.person(ptype, pid);
  return p ? (ptype === 'client' ? `${p.record.company || p.name}` : p.name) : pid;
}

module.exports = { userName, agencyName, jobView, candStatus, appView, clientView, onboardingView, ONBOARDING, threadName };
