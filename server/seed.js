// Sample data for the test copy. Every sample row is marked is_sample=1 and can be removed in
// Settings → "Remove sample data" before going live.
//
// TEST LOGINS (team portal, #team) — test values only, for the local test copy:
//   preeti       / Test@1234   Super admin (BrillBrains)     — asks for a WhatsApp code on a new device; in test mode the code is shown on screen
//   rohan.mehta  / Test@1234   Admin, AG-02 Partner Agency – Mumbai
//   sneha.patil  / Test@1234   Sub admin (recruiter), AG-02
//   arjun.rao    / Test@1234   Sub admin (recruiter), AG-02
//   kavita.sharma/ Test@1234   Admin, AG-03 Partner Agency – Jaipur
//   imran.khan   / Test@1234   Sub admin, AG-03
// Client and candidate accounts log in with their WhatsApp number; in test mode the 6-digit code is shown on screen.
//   Client  Lustre Stores        9820011111
//   Candidate Rakesh Yadav       9876500005
const D = require('./db');
const L = require('./logic');
const TEAM = require('./api-team');

const TEST_PASSWORD = 'Test@1234';

function seed() {
  if (D.get('SELECT 1 FROM users LIMIT 1')) return false;
  const ago = (days, h = 11) => new Date(Date.now() - days * 86400000 + (h - 11) * 3600000).toISOString();
  const ahead = (days, h = 11) => { const d = new Date(Date.now() + days * 86400000); const ist = new Date(d.getTime() + 330 * 60000); return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, 0) - 330 * 60000).toISOString(); };
  D.tx(() => {
    const ags = [['BrillBrains In-house', 'Mumbai', 0], ['Partner Agency – Mumbai', 'Mumbai', null], ['Partner Agency – Jaipur', 'Jaipur', null]];
    for (const [name, city, share] of ags) D.insert('agencies', { id: D.nextId('AG'), name, city, since: '2026-04-01', status: 'Active', share_pct: share, is_sample: 1, created_at: ago(200) });
    const users = [
      ['Preeti', '9820000001', 'super', null, 'Head office', 'preeti'],
      ['Rohan Mehta', '9820000002', 'admin', 'AG-02', 'Agency owner', 'rohan.mehta'],
      ['Sneha Patil', '9820000003', 'sub', 'AG-02', 'Recruiter', 'sneha.patil'],
      ['Arjun Rao', '9820000004', 'sub', 'AG-02', 'Recruiter', 'arjun.rao'],
      ['Kavita Sharma', '9820000005', 'admin', 'AG-03', 'Agency owner', 'kavita.sharma'],
      ['Imran Khan', '9820000006', 'sub', 'AG-03', 'Recruiter', 'imran.khan'],
      ['Neha Joshi', '9820000007', 'admin', 'AG-01', 'In-house lead', 'neha.joshi'],
    ];
    const hash = L.hashPassword(TEST_PASSWORD);
    for (const [name, wa, level, ag, role, username] of users) D.insert('users', { id: D.nextId('U'), name, whatsapp: wa, level, agency_id: ag, role, username, pass_hash: hash, status: 'On', must_change: 0, failed: 0, last_login: ago(0, 10), last_action: ago(0, 10), created_by: 'U-01', created_at: ago(180), is_sample: 1 });
    const U = (id) => { const u = D.get('SELECT * FROM users WHERE id=?', id); return { uid: u.id, name: u.name, label: u.name, level: u.level, agency_id: u.agency_id }; };
    const sneha = U('U-03'); const arjun = U('U-04'); const rohan = U('U-02'); const imran = U('U-06'); const kavita = U('U-05');

    // Clients
    const clients = [
      [{ company: 'Lustre Stores', contact: 'Anita Desai', whatsapp: '9820011111', city: 'Mumbai', business_type: 'Showroom B2C', need: 'Hiring now', roles: 'Sales Executive, Cashier', email: 'hr@lustre.example' }, 'Client referral', 'AG-02', 'U-02', 'Job opening active'],
      [{ company: 'Navratna Jewels', contact: 'Vikram Jain', whatsapp: '9820022222', city: 'Jaipur', business_type: 'Manufacturer B2B', need: 'Hiring now', roles: 'Goldsmith, CAD Designer' }, 'Exhibition', 'AG-03', 'U-05', 'Job opening active'],
      [{ company: 'Surat Diamond House', contact: 'Hetal Shah', whatsapp: '9820033333', city: 'Surat', business_type: 'Both', need: 'Hiring soon', roles: 'Diamond Assorter' }, 'LinkedIn', 'AG-02', 'U-02', 'Agreement shared'],
      [{ company: 'Kanak Gold', contact: 'Rajiv Malhotra', whatsapp: '9820044444', city: 'Delhi NCR', business_type: 'Showroom B2C', need: 'Just exploring', roles: 'Store Manager' }, 'Website', null, null, 'Call initiated'],
      [{ company: 'Heritage Kundan', contact: 'Meera Rathore', whatsapp: '9820055555', city: 'Jaipur', business_type: 'Showroom B2C', need: 'Hiring now', roles: 'Kundan Worker, Sales Executive' }, 'Referral', 'AG-03', 'U-05', 'Client activated'],
    ];
    for (const [d, src, ag, owner, stage] of clients) {
      const r = L.intakeClient(d, { source: src, silent: true });
      D.update('clients', r.client.id, { agency_id: ag, owner_id: owner, stage, is_new: ag ? 0 : 1, is_sample: 1, created_at: ago(ag ? 60 : 1), account_status: ag ? 'Opened' : 'Not opened',
        onboarding: ag ? { intro_call: { done: true, date: ago(55), by: 'Rohan Mehta', note: 'Owner keen, 3 branches' }, background: { done: true, date: ago(54), by: 'Rohan Mehta' }, proposal: { done: true, date: ago(50), by: 'Rohan Mehta' } } : {},
        contract: stage === 'Job opening active' || stage === 'Client activated' ? JSON.stringify({ by: d.contact, at: ago(45), method: 'Signed online (I agree)' }) : null,
        kyc: stage === 'Job opening active' ? { gst: 1, pan: 1, owner_id: 1, gstin: '27AAACL1234C1Z1' } : {} });
    }
    D.insert('client_members', { client_id: 'CL-1001', name: 'Shivani Kulkarni', whatsapp: '9820011112', role: 'HR', perms: JSON.stringify({ candidates: true, feedback: true, approve: false, bills: false }), created_at: ago(40) });

    // Job openings
    const mkJob = (clientId, b, by, daysAgo) => { const c = D.get('SELECT * FROM clients WHERE id=?', clientId); const j = TEAM.createJob(c, b, by, false); D.update('jobs', j.id, { created_at: ago(daysAgo), is_sample: 1 }); D.run('UPDATE job_history SET at=? WHERE job_id=?', ago(daysAgo), j.id); return j.id; };
    const J1 = mkJob('CL-1001', { title: 'Sales Executive', city: 'Mumbai', openings: 2, sal_from: 300000, sal_to: 420000, exp_from: 1, exp_to: 5, notice_days: 30, skills: ['Gold knowledge', 'Customer handling', 'Hindi'], jd_approved: true, priority: 'High', recruiter_id: 'U-03' }, rohan, 40);
    const J2 = mkJob('CL-1001', { title: 'Cashier', city: 'Mumbai', openings: 1, sal_from: 240000, sal_to: 300000, exp_from: 1, exp_to: 4, notice_days: 15, skills: ['Billing software', 'MS Excel'], jd_approved: true, recruiter_id: 'U-04' }, rohan, 30);
    const J3 = mkJob('CL-1002', { title: 'Goldsmith (Karigar)', city: 'Jaipur', openings: 3, sal_from: 240000, sal_to: 360000, exp_from: 3, exp_to: 15, notice_days: 15, skills: ['Polishing', 'Stone setting'], jd_approved: true, recruiter_id: 'U-06' }, kavita, 35);
    const J4 = mkJob('CL-1002', { title: 'CAD Designer (Matrix)', city: 'Jaipur', openings: 1, sal_from: 360000, sal_to: 540000, exp_from: 2, exp_to: 6, notice_days: 30, skills: ['CAD (Matrix)'], jd_approved: true, recruiter_id: 'U-06' }, kavita, 20);
    const J5 = mkJob('CL-1003', { title: 'Diamond Assorter', city: 'Surat', openings: 2, sal_from: 300000, sal_to: 480000, exp_from: 2, exp_to: 8, notice_days: 30, skills: ['Diamond knowledge'], jd_approved: false, recruiter_id: 'U-04' }, rohan, 5);
    const J6 = mkJob('CL-1005', { title: 'Kundan Worker', city: 'Jaipur', openings: 1, sal_from: 216000, sal_to: 300000, exp_from: 2, exp_to: 10, notice_days: 7, jd_approved: true, recruiter_id: 'U-06' }, kavita, 70);
    const J7 = mkJob('CL-1001', { title: 'Store Manager', city: 'Mumbai', openings: 1, sal_from: 600000, sal_to: 800000, exp_from: 6, exp_to: 15, notice_days: 60, skills: ['Team handling', 'Gold knowledge'], jd_approved: true, recruiter_id: 'U-03' }, rohan, 12);
    D.update('jobs', J5, { jd: { summary: 'Sort and grade diamonds for our Surat unit.' }, jd_status: 'Draft' });

    // Candidates
    const cands = [
      ['Priya Shah', '9876500001', 'Mumbai', 'Sales Executive', 3, 300000, 360000, 30, ['Gold knowledge', 'Customer handling', 'Hindi', 'English'], 'Naukri', 'AG-02', 'U-03'],
      ['Aman Verma', '9876500002', 'Mumbai', 'Sales Executive', 2, 264000, 330000, 15, ['Customer handling', 'Hindi'], 'Apna', 'AG-02', 'U-03'],
      ['Pooja Nair', '9876500003', 'Mumbai', 'Senior Sales Executive', 5, 420000, 480000, 30, ['Gold knowledge', 'Diamond knowledge', 'Customer handling'], 'LinkedIn', 'AG-02', 'U-03'],
      ['Sunil Gupta', '9876500004', 'Mumbai', 'Cashier', 2, 216000, 264000, 0, ['Billing software', 'MS Excel', 'Tally'], 'Walk-in', 'AG-02', 'U-04'],
      ['Rakesh Yadav', '9876500005', 'Mumbai', 'Cashier', 3, 240000, 288000, 15, ['Billing software', 'MS Excel'], 'Referral', 'AG-02', 'U-04'],
      ['Mohan Lal Soni', '9876500006', 'Jaipur', 'Goldsmith (Karigar)', 12, 300000, 336000, 7, ['Polishing', 'Stone setting'], 'College tie-up', 'AG-03', 'U-06'],
      ['Farhan Qureshi', '9876500007', 'Jaipur', 'Goldsmith (Karigar)', 6, 240000, 300000, 15, ['Polishing'], 'WhatsApp bot', 'AG-03', 'U-06'],
      ['Deepa Kumari', '9876500008', 'Jaipur', 'CAD Designer (Matrix)', 3, 360000, 450000, 30, ['CAD (Matrix)', 'CAD (Rhino)'], 'LinkedIn', 'AG-03', 'U-06'],
      ['Hitesh Patel', '9876500009', 'Surat', 'Diamond Assorter', 4, 300000, 390000, 30, ['Diamond knowledge'], 'Naukri', 'AG-02', 'U-04'],
      ['Kiran Solanki', '9876500010', 'Surat', 'Diamond Assorter', 6, 360000, 420000, 60, ['Diamond knowledge', 'Gujarati'], 'Agency database', 'AG-02', 'U-04'],
      ['Ravi Kumar', '9876500011', 'Jaipur', 'Kundan Worker', 8, 240000, 276000, 7, [], 'Walk-in', 'AG-03', 'U-06'],
      ['Sanjay Bhatt', '9876500012', 'Mumbai', 'Store Manager', 9, 720000, 780000, 60, ['Team handling', 'Gold knowledge'], 'LinkedIn', 'AG-02', 'U-03'],
      ['Neelam Chauhan', '9876500013', 'Delhi NCR', 'Sales Executive', 1, 216000, 264000, 0, ['Hindi'], 'Facebook ad', null, null],
      ['Asha Reddy', '9876500014', 'Hyderabad', 'Jewellery Designer', 4, 420000, 540000, 30, ['Hand sketching'], 'Instagram', null, null],
      ['Vijay Rathod', '9876500015', 'Ahmedabad', 'Accountant', 5, 360000, 420000, 30, ['Tally', 'GST filing'], 'Naukri', 'AG-01', 'U-07'],
      ['Geeta Menon', '9876500016', 'Mumbai', 'Sales Executive', 4, 330000, 396000, 30, ['Customer handling', 'Gold knowledge', 'Marathi'], 'Job post', 'AG-02', 'U-03'],
    ];
    for (const [name, wa, city, job, exp, cur, expS, notice, skills, src, ag, rec] of cands) {
      const r = L.intakeCandidate({ name, whatsapp: wa, city, job_wanted: job, exp_total: exp, exp_jewellery: exp, cur_salary: cur, exp_salary: expS, notice_days: notice, skills, current_company: exp > 0 ? 'Local jeweller' : '' }, { source: src, silent: true });
      D.update('candidates', r.candidate.id, { agency_id: ag, recruiter_id: rec, is_new: ag ? 0 : 1, is_sample: 1, created_at: ago(ag ? 45 : 2), last_updated: ago(ag ? 20 : 2) });
    }
    // Applications along the path
    const app = (cand, job, by, daysAgo) => { const a = L.createApplication(cand, job, by, null, 'Added from matches'); D.update('applications', a.id, { created_at: ago(daysAgo), step_since: ago(daysAgo), is_sample: 1 }); D.run('UPDATE app_history SET at=? WHERE app_id=?', ago(daysAgo), a.id); return a.id; };
    const step = (id, s, by, daysAgo) => { L.moveStep(id, s, by, 'Sample'); D.update('applications', id, { step_since: ago(daysAgo) }); D.run('UPDATE app_history SET at=? WHERE id=(SELECT MAX(id) FROM app_history WHERE app_id=?)', ago(daysAgo), id); };
    // J1 Sales Executive (2 openings)
    const a1 = app('CA-3001', J1, sneha, 30); step(a1, 'Screening', sneha, 28);
    const iv1 = L.scheduleInterview(a1, { round: 'ours', at: ago(25, 12), place: 'Zoom', interviewer: 'Sneha Patil', name: 'Round 1' }, sneha);
    L.recordInterview(iv1.id, { status: 'Completed', result: 'Move ahead', remark: 'Strong on gold rates, good Hindi and English', rating: 5, qa: [{ q: 'How do you explain making charges?', a: 'Clearly, with an example bill' }] }, sneha);
    L.scheduleInterview(a1, { round: 'client', at: ago(18, 15), place: 'Lustre Stores, Andheri', interviewer: 'Anita Desai', name: 'Client round' }, sneha);
    const civ = D.get("SELECT id FROM interviews WHERE app_id=? AND round='client'", a1).id;
    L.recordInterview(civ, { status: 'Completed', result: 'Selected', remark: 'Client liked her', rating: 4 }, sneha);
    L.recordOffer(a1, { ctc: 380000, joining_date: L.istDay(new Date(Date.now() - 12 * 86400000)), reporting_to: 'Store Manager' }, sneha);
    L.moveStep(a1, 'Offer accepted', { label: 'Priya Shah — candidate' }, 'Accepted on WhatsApp');
    L.moveStep(a1, 'Joined', sneha, 'Joined on time');
    D.update('applications', a1, { joined_at: ago(12) });
    const a2 = app('CA-3002', J1, sneha, 20); step(a2, 'Screening', sneha, 18); step(a2, 'Sent to client', sneha, 9);
    const a3 = app('CA-3016', J1, sneha, 6); step(a3, 'Screening', sneha, 5);
    L.scheduleInterview(a3, { round: 'ours', at: ago(1, 16), place: 'Office, Andheri', interviewer: 'Sneha Patil' }, sneha); // result pending
    const a4 = app('CA-3003', J1, arjun, 15); step(a4, 'Screening', arjun, 14); L.closeApplication(a4, 'Candidate withdrew', arjun, 'Took another offer');
    // J2 Cashier
    const a5 = app('CA-3005', J2, arjun, 14); step(a5, 'Screening', arjun, 13);
    const iv5 = L.scheduleInterview(a5, { round: 'ours', at: ago(10, 11), place: 'Phone', interviewer: 'Arjun Rao' }, arjun);
    L.recordInterview(iv5.id, { status: 'Completed', result: 'Move ahead', remark: 'Fast on billing software', rating: 4 }, arjun);
    L.moveStep(a5, 'Client interview', { label: 'Anita Desai — client' }, 'Interested');
    L.scheduleInterview(a5, { round: 'client', at: ago(5, 12), place: 'Lustre Stores, Andheri', interviewer: 'Anita Desai' }, arjun);
    const civ5 = D.get("SELECT id FROM interviews WHERE app_id=? AND round='client'", a5).id;
    L.recordInterview(civ5, { status: 'Completed', result: 'Selected', remark: 'Good fit', rating: 4 }, arjun);
    L.recordOffer(a5, { ctc: 276000, joining_date: L.istDay(new Date(Date.now() + 10 * 86400000)), reporting_to: 'Accounts Head' }, arjun);
    const a6 = app('CA-3004', J2, arjun, 9); step(a6, 'Screening', arjun, 9);
    // J3 Goldsmith (3 openings)
    const a7 = app('CA-3006', J3, imran, 25); step(a7, 'Screening', imran, 24);
    L.scheduleInterview(a7, { round: 'ours', at: ahead(1, 11), place: 'Navratna workshop, Johari Bazar', interviewer: 'Imran Khan', name: 'Practical test' }, imran);
    const a8 = app('CA-3007', J3, imran, 12); // stuck at Applied for 12 days
    // J4 CAD Designer
    const a9 = app('CA-3008', J4, imran, 10); step(a9, 'Screening', imran, 8); step(a9, 'Sent to client', imran, 6);
    L.moveStep(a9, 'Client interview', { label: 'Vikram Jain — client' }, 'Interested');
    L.scheduleInterview(a9, { round: 'client', at: ahead(2, 15), place: 'Navratna office, MI Road', interviewer: 'Vikram Jain' }, imran);
    // J6 Kundan Worker: filled
    const a10 = app('CA-3011', J6, imran, 60); step(a10, 'Screening', imran, 58); step(a10, 'Sent to client', imran, 50);
    step(a10, 'Client interview', imran, 45);
    L.recordOffer(a10, { ctc: 264000, joining_date: L.istDay(new Date(Date.now() - 40 * 86400000)) }, imran);
    L.moveStep(a10, 'Offer accepted', imran, 'Accepted'); L.moveStep(a10, 'Joined', imran, 'Joined');
    D.update('applications', a10, { joined_at: ago(40) });
    // J7 Store Manager
    const a11 = app('CA-3012', J7, sneha, 8); step(a11, 'Screening', sneha, 7);

    // Bills: issue both, one paid (payout due), one open
    for (const b of D.all("SELECT * FROM bills WHERE status='Draft'")) { L.issueBill(b.id, rohan); D.update('bills', b.id, { is_sample: 1 }); }
    const b10 = D.get('SELECT * FROM bills WHERE app_id=?', a10);
    D.update('bills', b10.id, { issued_at: ago(39), date: L.istDay(new Date(Date.now() - 39 * 86400000)), due_date: L.istDay(new Date(Date.now() - 24 * 86400000)), created_at: ago(39) });
    D.insert('payments', { bill_id: b10.id, date: L.istDay(new Date(Date.now() - 20 * 86400000)), amount: b10.total - 2200, mode: 'Bank transfer', ref: 'NEFT 88123', tds: 2200, by: 'Preeti', created_at: ago(20) });
    L.refreshBill(b10.id, 'Preeti');

    // Tie-ups, notes, logs, follow-ups
    D.insert('tieups', { name: 'Jaipur Gem & Jewellery Institute', type: 'Institute', city: 'Jaipur', contact: 'Mr. Agarwal', phone: '9414000001', owner_id: 'U-06', last_list: ago(15), is_sample: 1 });
    D.insert('tieups', { name: 'SNDT College of Design', type: 'College', city: 'Mumbai', contact: 'Prof. Kulkarni', phone: '9820099999', owner_id: 'U-03', last_list: ago(40), is_sample: 1 });
    D.update('candidates', 'CA-3006', { tieup_id: 1 });
    D.insert('notes', { record_id: 'CL-1001', text: 'MOM: Anita wants 2 sales staff before Diwali; prefers Marathi speakers.', author: 'Rohan Mehta', at: ago(35) });
    for (const [uid, days] of [['U-02', [1, 2, 3, 4, 5, 6]], ['U-03', [1, 2, 4, 5, 6]], ['U-04', [1, 3, 4]], ['U-05', [1, 2, 3, 4, 5]], ['U-06', [2, 3, 5, 6]]]) {
      for (const d of days) { const day = L.istDay(new Date(Date.now() - d * 86400000)); D.insert('logs', { id: `LG-${uid}-${day}`, user_id: uid, day, tasks: 'Screened candidates, called clients', problems: '', plan: 'Follow up on interviews', counts: '{}', status: d > 2 ? 'Approved' : 'Submitted', approved_by: d > 2 ? 'U-01' : null, at: ago(d, 18) }); }
    }
    D.insert('followups', { record_id: 'CL-1003', at: ahead(0, 17), note: 'Call Hetal about the agreement', for_user: 'U-02', done: 0, created_by: 'U-02' });

    // A few replies so the inbox has unread threads.
    L.receiveReply('9876500007', 'Sir, I am available any day for the test', null, { ptype: 'candidate', pid: 'CA-3007' });
    L.receiveReply('9820033333', 'Please send the agreement again, the link expired', null, { ptype: 'client', pid: 'CL-1003' });
    D.run('UPDATE interviews SET is_sample=1'); D.run('UPDATE applications SET is_sample=1'); D.run('UPDATE jobs SET is_sample=1'); D.run('UPDATE bills SET is_sample=1');
    // Older messages look delivered/read.
    D.run("UPDATE messages SET status='read' WHERE direction='out' AND at < ?", ago(2));
  });
  return true;
}
module.exports = { seed, TEST_PASSWORD };
