// Excel / CSV import (sections 11.1 and 20): match columns once, preview, import, list rows that failed.
const D = require('./db');
const L = require('./logic');

const FIELDS = {
  candidates: [
    ['name', 'Candidate name', ['candidate name', 'name', 'full name']], ['whatsapp', 'WhatsApp / mobile', ['mobile', 'phone', 'whatsapp', 'contact', 'mobile no']], ['email', 'Email', ['email', 'e-mail', 'mail']],
    ['city', 'City / location', ['location', 'city', 'current location']], ['job_wanted', 'Job wanted', ['job wanted', 'desired role', 'role', 'designation']], ['current_company', 'Current company', ['current company', 'company']],
    ['cur_salary', 'Current CTC', ['current ctc', 'current salary', 'ctc']], ['exp_salary', 'Expected CTC', ['expected ctc', 'expected salary']], ['notice_days', 'Notice period', ['notice period', 'notice']],
    ['exp_total', 'Experience', ['experience years', 'experience', 'exp', 'total experience']], ['source', 'Source', ['source']], ['cv_file', 'Resume / CV link', ['resume', 'cv', 'resume / cv']],
    ['recruiter', 'Recruiter', ['recruiter']], ['created_at', 'Date added', ['date added', 'date']], ['client_name', 'Client name', ['client name', 'client']], ['job_code', 'Job code', ['job code', 'code']],
    ['position', 'Position title', ['position title', 'position']], ['status', 'Status', ['status']], ['remarks', 'Remarks', ['remarks', 'remark', 'notes']],
  ],
  clients: [
    ['created_at', 'Date', ['date']], ['business_type', 'Business type', ['business type']], ['city', 'City', ['city']], ['state', 'State', ['state']], ['est_year', 'Est year', ['est year', 'established']],
    ['team_size', 'Current team strength', ['current team strength', 'team size']], ['branches', 'Branches', ['branches']], ['website', 'Website', ['website']], ['company', 'Client name', ['client name', 'company', 'company name']],
    ['status', 'Status', ['status']], ['owner_name', 'Owner / management', ['owner / management', 'owner', 'management']], ['owner_mobile', 'Owner mobile', ['mobile no', 'owner mobile', 'mobile']],
    ['hr_name', 'HR name', ['hr name']], ['hr_email', 'HR email', ['hr email', 'email']], ['hr_mobile', 'HR mobile (second mobile no)', ['mobile no 2', 'hr mobile', 'mobile no.1']], ['remarks', 'Remarks', ['remarks']],
    ['last_updated', 'Last date updated', ['last date updated']], ['activation_date', 'Activation date', ['activation date']],
  ],
  jobs: [
    ['created_at', 'Date', ['date']], ['client_name', 'Client name', ['client name', 'client']], ['city', 'Area / location', ['area / location', 'location', 'area', 'city']], ['title', 'Position open', ['position open', 'position', 'job title']],
    ['old_code', 'Job code', ['job code', 'code']], ['openings', 'No. of vacancy', ['no. of vacancy', 'vacancy', 'openings']], ['salary', 'Salary range', ['salary range', 'salary']], ['notice', 'Notice period', ['notice period', 'notice']],
    ['recruiter', 'Recruiter', ['recruiter']], ['jd_link', 'JDs prep (link)', ['jds prep', 'jd', 'jd link']], ['closed', 'No. of closed vacancies', ['no. of closed vacancies', 'closed']], ['status', 'Status', ['status']], ['remarks', 'Remarks', ['remarks']],
  ],
};

function guessMap(kind, headers) {
  const map = {}; const used = new Set();
  for (const [key, , hints] of FIELDS[kind]) {
    for (const hint of hints) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && String(h).trim().toLowerCase() === hint);
      if (i >= 0) { map[key] = i; used.add(i); break; }
    }
    if (map[key] === undefined) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && hints.some((hint) => String(h).toLowerCase().includes(hint)));
      if (i >= 0) { map[key] = i; used.add(i); }
    }
  }
  return map;
}

// ---------- cleaning rules (20.4) ----------
function cleanCTC(v) {
  const s = String(v || '').trim().toLowerCase(); if (!s) return { value: null };
  const note = s.includes('stipend') ? 'stipend' : null;
  const num = parseFloat(s.replace(/,/g, '').match(/[\d.]+/) || '');
  if (isNaN(num)) return { value: null, note: `Salary unclear: ${v}` };
  if (/lpa|lakh|lac|\bl\b/.test(s)) return { value: Math.round(num * 100000), note };
  if (/k\b|k$|k\s/.test(s) || s.endsWith('k')) return { value: Math.round(num * 1000 * 12), note };
  if (num < 1000) return { value: Math.round(num * 100000), note: note || 'read as lakh a year' };
  if (num < 200000) return { value: Math.round(num * 12), note };
  return { value: Math.round(num), note };
}
function cleanNotice(v) {
  const s = String(v || '').trim().toLowerCase(); if (!s) return { value: null };
  if (s.includes('immediate')) return { value: 0 };
  const n = s.match(/(\d+)\s*(day|month|week)?/);
  if (n && !s.startsWith('can join')) { let d = Number(n[1]); if (n[2] === 'month') d *= 30; if (n[2] === 'week') d *= 7; return { value: d, note: s.includes('negotiable') ? 'Notice negotiable' : null }; }
  return { value: null, note: `Notice: ${v}` };
}
function cleanExp(v) {
  const s = String(v || '').trim().toLowerCase(); if (!s) return null;
  if (s.includes('fresher')) return 0;
  const n = parseFloat(s.match(/[\d.]+/) || ''); return isNaN(n) ? null : n;
}
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function cleanDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString(); // Excel serial
  const m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]*([a-z]{3})[a-z]*[\s\-/,]*(\d{2,4})?$/i);
  if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : 2026; return new Date(Date.UTC(y, MONTHS[m[2].toLowerCase()], Number(m[1]))).toISOString(); }
  const d = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (d) { const y = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]); return new Date(Date.UTC(y, Number(d[2]) - 1, Number(d[1]))).toISOString(); }
  const t = new Date(s); return isNaN(t) ? null : t.toISOString();
}
function cleanSalaryRange(v) {
  const s = String(v || '').toLowerCase().replace(/,/g, ''); const nums = (s.match(/[\d.]+/g) || []).map(Number);
  if (!nums.length) return [null, null];
  const mult = /lpa|lakh|lac/.test(s) || nums[0] < 100 ? 100000 : (/k/.test(s) ? 12000 : 1);
  return [Math.round(nums[0] * mult), Math.round((nums[1] || nums[0]) * mult)];
}
const OLD_STATUS = {
  'new': ['Applied', 'open'], 'screening': ['Screening', 'open'], 'shortlisted': ['Our interview', 'open', 'iv'], 'telephonic interview done': ['Our interview', 'open', 'iv'],
  'virtual interview done': ['Our interview', 'open', 'iv'], 'physical interview done': ['Our interview', 'open', 'iv'], 'client submitted': ['Sent to client', 'open'],
  'interview scheduled': ['Client interview', 'open'], 'selected': ['Client interview', 'open', 'selected'], 'offer released': ['Offer made', 'open'], 'joined': ['Joined', 'Hired'],
  'rejected': ['Screening', 'Not suitable'], 'client denied': ['Sent to client', 'Client rejected'], 'candidate denied': ['Screening', 'Candidate withdrew'],
  'backout': ['Offer accepted', 'Did not join'], 'on hold': ['Screening', 'open', 'hold'],
};
const CLIENT_STAGE = { 'on- hold': 'On hold', 'on-hold': 'On hold', 'on hold': 'On hold', 'not interested': 'Not interested', 'active': 'Client activated', 'activated': 'Client activated', 'in progress': 'Understanding needs' };
const userByName = (n) => n ? D.get('SELECT * FROM users WHERE lower(name)=lower(?) OR lower(username)=lower(?)', String(n).trim(), String(n).trim()) : null;
const clientByName = (n) => n ? D.get('SELECT * FROM clients WHERE lower(company)=lower(?) AND merged_into IS NULL', String(n).trim()) : null;

function runImport(kind, rows, map, opts) {
  const s = D.settings(); const by = opts.by; const who = L.actorName(by);
  const val = (r, k) => (map[k] === undefined || map[k] === '' || map[k] === null ? '' : String(r[Number(map[k])] ?? '').trim());
  const result = { created: 0, updated: 0, apps: 0, errors: [] };
  const silent = true; // no messages on import
  rows.forEach((r, i) => {
    const line = i + 2;
    try {
      if (kind === 'candidates') {
        const ctc = cleanCTC(val(r, 'cur_salary')); const ectc = cleanCTC(val(r, 'exp_salary')); const nt = cleanNotice(val(r, 'notice_days'));
        const rec = userByName(val(r, 'recruiter'));
        const d = {
          name: val(r, 'name'), whatsapp: L.digits10(val(r, 'whatsapp')), email: val(r, 'email'), city: val(r, 'city'), job_wanted: matchJobTitle(val(r, 'job_wanted') || val(r, 'position')),
          current_company: val(r, 'current_company'), cur_salary: ctc.value, exp_salary: ectc.value, notice_days: nt.value, exp_total: cleanExp(val(r, 'exp_total')), cv_file: val(r, 'cv_file') || null,
          created_at: cleanDate(val(r, 'created_at')) || undefined, tieup_id: opts.tieup_id || null,
        };
        if (!d.name) throw new Error('Name missing');
        const source = s.lead_sources.find((x) => x.toLowerCase() === val(r, 'source').toLowerCase()) || opts.source || 'Excel import';
        const res = L.intakeCandidate(d, { source, by: rec ? { uid: rec.id, label: who, agency_id: rec.agency_id } : by, silent, consent: false, allowNoPhone: true, needsCheck: L.validPhone(d.whatsapp) ? null : 'No phone found' });
        res.isNew ? result.created++ : result.updated++;
        const cid = res.candidate.id;
        const notes = [ctc.note, ectc.note, nt.note].filter(Boolean);
        if (notes.length) D.insert('notes', { record_id: cid, text: notes.join('; '), author: 'Import', at: D.now() });
        if (rec && !res.candidate.recruiter_id) D.update('candidates', cid, { recruiter_id: rec.id, agency_id: rec.agency_id });
        // Application on the job named in the row
        const code = val(r, 'job_code'); const cname = val(r, 'client_name'); const pos = val(r, 'position');
        let job = code ? D.get('SELECT * FROM jobs WHERE old_code=?', code) : null;
        if (!job && cname) { const cl = clientByName(cname); if (cl) job = D.get('SELECT * FROM jobs WHERE client_id=? AND lower(title)=lower(?)', cl.id, matchJobTitle(pos) || pos); }
        if ((code || cname) && !job) result.errors.push({ line, reason: `Job not found for ${code || cname + ' / ' + pos} (candidate saved without application)` });
        if (job && !D.get('SELECT 1 FROM applications WHERE candidate_id=? AND job_id=?', cid, job.id)) {
          const map20 = OLD_STATUS[val(r, 'status').toLowerCase()] || ['Applied', 'open'];
          const a = L.createApplication(cid, job.id, rec ? { uid: rec.id, label: who } : by, source, 'Imported');
          D.update('applications', a.id, { step: map20[0], result: map20[1], on_hold: map20[2] === 'hold' ? 1 : 0, hold_reason: map20[2] === 'hold' ? 'Old On Hold record' : null, owner_id: rec ? rec.id : a.owner_id, joined_at: map20[1] === 'Hired' ? (d.created_at || D.now()) : null });
          L.appHist(a.id, map20[0], by, `Imported with old status "${val(r, 'status')}"`, 'import');
          if (map20[2] === 'iv' || map20[2] === 'selected') D.insert('interviews', { id: D.nextId('IV'), app_id: a.id, round: map20[2] === 'iv' ? 'ours' : 'client', name: 'Imported', at: d.created_at || D.now(), place: '', interviewer: '', status: 'Completed', result: map20[2] === 'iv' ? 'Move ahead' : 'Selected', remark: 'Imported', qa: [], created_at: D.now() });
          if (val(r, 'remarks')) D.insert('notes', { record_id: a.id, text: val(r, 'remarks'), author: 'Import', at: D.now() });
          L.recalcJob(job.id, 'Import');
          result.apps++;
        } else if (val(r, 'remarks')) D.insert('notes', { record_id: cid, text: val(r, 'remarks'), author: 'Import', at: D.now() });
      } else if (kind === 'clients') {
        const hrMobile = L.digits10(val(r, 'hr_mobile')); const ownerMobile = L.digits10(val(r, 'owner_mobile'));
        const bt = val(r, 'business_type').toUpperCase();
        const d = {
          company: val(r, 'company'), contact: val(r, 'hr_name') || val(r, 'owner_name'), whatsapp: hrMobile || ownerMobile, email: val(r, 'hr_email'), city: val(r, 'city'), state: val(r, 'state'),
          business_type: bt.includes('B2B') && bt.includes('B2C') ? 'Both' : bt.includes('B2B') ? 'Manufacturer B2B' : bt.includes('B2C') ? 'Showroom B2C' : val(r, 'business_type'),
          stage: CLIENT_STAGE[val(r, 'status').toLowerCase()] || (s.client_stages.includes(val(r, 'status')) ? val(r, 'status') : s.client_stages[0]),
          extra: { est_year: val(r, 'est_year'), team_size: val(r, 'team_size'), branches: val(r, 'branches'), website: val(r, 'website'), owner_name: val(r, 'owner_name'), owner_mobile: ownerMobile, hr_name: val(r, 'hr_name'), hr_email: val(r, 'hr_email'), hr_mobile: hrMobile, activation_date: cleanDate(val(r, 'activation_date')) },
          created_at: cleanDate(val(r, 'created_at')) || undefined,
        };
        if (!d.company) throw new Error('Client name missing');
        const res = L.intakeClient(d, { source: opts.source || 'Excel import', by, silent, consent: false, allowNoPhone: true, needsCheck: d.whatsapp ? null : 'No phone found' });
        res.isNew ? result.created++ : result.updated++;
        const id = res.client.id;
        if (by && by.agency_id) D.update('clients', id, { agency_id: by.agency_id, is_new: 0 });
        const rem = val(r, 'remarks');
        if (rem) { D.insert('notes', { record_id: id, text: rem, author: 'Import', at: D.now() }); if (/not to be approached/i.test(rem)) D.update('clients', id, { dnc: 1 }); }
        if (val(r, 'last_updated')) D.insert('notes', { record_id: id, text: `Last date updated (old sheet): ${val(r, 'last_updated')}`, author: 'Import', at: D.now() });
        if (d.extra.activation_date) D.update('clients', id, { contract: JSON.stringify({ imported: true, at: d.extra.activation_date }), onboarding: { contract: { done: true, date: d.extra.activation_date, by: 'Import' } } });
      } else if (kind === 'jobs') {
        const cl = clientByName(val(r, 'client_name'));
        if (!cl) throw new Error(`Client "${val(r, 'client_name')}" not found`);
        const title = matchJobTitle(val(r, 'title'));
        const [sf, st] = cleanSalaryRange(val(r, 'salary'));
        const rec = userByName(val(r, 'recruiter'));
        if (val(r, 'old_code') && D.get('SELECT 1 FROM jobs WHERE old_code=?', val(r, 'old_code'))) { result.updated++; return; }
        const id = D.nextId('JB');
        D.insert('jobs', {
          id, client_id: cl.id, title: title || 'Other', department: L.deptOf(title), city: val(r, 'city') || cl.city, openings: Math.max(1, parseInt(val(r, 'openings')) || 1), sal_from: sf, sal_to: st,
          notice_days: cleanNotice(val(r, 'notice')).value, skills: [], agency_id: cl.agency_id || (rec && rec.agency_id) || (by && by.agency_id), recruiter_id: rec ? rec.id : null,
          jd_approved: val(r, 'jd_link') ? 1 : 0, jd_status: val(r, 'jd_link') ? 'Approved' : 'Not written', jd: val(r, 'jd_link') ? { file_link: val(r, 'jd_link') } : {},
          manual: /hold/i.test(val(r, 'status')) ? 'On hold' : null, manual_reason: /hold/i.test(val(r, 'status')) ? 'Imported as On hold' : null,
          old_code: val(r, 'old_code') || null, notes: [title ? null : `Position: ${val(r, 'title')}`, val(r, 'closed') ? `Closed vacancies (old sheet): ${val(r, 'closed')}` : null, val(r, 'remarks')].filter(Boolean).join(' · '),
          created_by: who, created_at: cleanDate(val(r, 'created_at')) || D.now(), rounds: ['Our interview', 'Client interview'], screening_qs: [],
        });
        if (!rec && val(r, 'recruiter')) result.errors.push({ line, reason: `Recruiter "${val(r, 'recruiter')}" not found (job saved without recruiter)` });
        L.recalcJob(id, 'Import', 'Imported');
        result.created++;
      }
    } catch (e) { result.errors.push({ line, reason: e.message }); }
  });
  D.history(who, 'import', null, kind, null, `${result.created} new, ${result.updated} updated, ${result.errors.length} errors`);
  return result;
}
function matchJobTitle(t) {
  if (!t) return '';
  const all = L.jobList().map((j) => j.title);
  const exact = all.find((x) => x.toLowerCase() === t.toLowerCase()); if (exact) return exact;
  const part = all.find((x) => x.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(x.toLowerCase()));
  return part || t;
}

module.exports = { FIELDS, guessMap, runImport, cleanCTC, cleanNotice, cleanExp, cleanDate, cleanSalaryRange };
