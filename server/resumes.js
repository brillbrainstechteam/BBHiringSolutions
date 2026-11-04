// Resumes from outside the portal (a zip of the Google Drive CV folder, or the Drive folder itself): each file goes to
// the candidate it belongs to (their phone or email in the CV, or their name in the file name or the CV) when that
// candidate has no resume yet; someone not in the portal becomes a new candidate (source Google Drive), with the
// role taken from the folder the file was in ("B2C/Sales/Sales Executive").
const path = require('path');
const D = require('./db');
const F = require('./files');
const R = require('./router');
const { route } = R;
const { get, all, insert, update, now, httpError } = D;

const CV_EXT = /\.(pdf|docx?|jpe?g|png)$/i;
const words = (t) => String(t || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
// "Naukri_YogitaRakhmajiMisal[3y_1m].pdf" -> "Yogita Rakhmaji Misal"; "Resume_Mamta Vichare (1).pdf" -> "Mamta Vichare"
function nameFromFile(file) {
  let n = path.basename(String(file || '')).replace(CV_EXT, '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[_.]+/g, ' ');
  if (/\b(image|img|scan|whatsapp|document|doc|file|page|photo|pdf)\b/i.test(n)) return ''; // camera and app names are not people
  n = n.replace(/^(naukri|indeed|apna|workindia|linkedin)[\s-]*/i, '').replace(/\b(cv|resume|bio ?data|profile|updated|final|new|latest|copy)\b/gi, ' ');
  n = n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[\-\d]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n.split(' ').filter((w) => w.length > 1).length >= 2 && n.length <= 40 ? n.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
}
// every part of the candidate's name (3+ letters) is in the text, or the name written without spaces is
function named(cname, hay) {
  const ws = words(cname).split(' ').filter((w) => w.length >= 3); if (ws.length < 2) return false;
  const h = ` ${words(hay)} `; return ws.every((w) => h.includes(` ${w} `)) || h.replace(/ /g, '').includes(ws.join(''));
}
const NO_CV = "merged_into IS NULL AND removed=0 AND (cv_file IS NULL OR cv_file='')";
const onDisk = (f) => { try { return !!f.path && require('fs').existsSync(path.join(D.DATA_DIR, 'files', f.path)); } catch { return false; } };

// Once (5 Nov 2026): candidates whose resume was saved but never linked as their resume get it linked; a resume
// link to a file that is not on disk is cleared (so the file can come again); and Drive files that were skipped or
// matched nobody are asked for once more by the Drive script.
D.db.exec('CREATE TABLE IF NOT EXISTS drive_seen (file_id TEXT PRIMARY KEY, md5 TEXT, path TEXT, status TEXT, at TEXT)');
(() => {
  const once = D.settings().done_once || []; if (once.includes('cv_link_repair_1')) return;
  let linked = 0; let cleared = 0;
  for (const c of all("SELECT id, cv_file FROM candidates WHERE merged_into IS NULL AND removed=0")) {
    const cur = c.cv_file ? get('SELECT * FROM files WHERE id=?', c.cv_file) : null;
    if (c.cv_file && cur && onDisk(cur)) continue;
    const f = all("SELECT * FROM files WHERE record_id=? AND type IN ('cv','file') AND replaced=0 ORDER BY (type='cv') DESC, id DESC", c.id).find((x) => CV_EXT.test(x.name || '') && onDisk(x));
    if (f) { update('candidates', c.id, { cv_file: String(f.id) }); linked++; } else if (c.cv_file) { update('candidates', c.id, { cv_file: null }); cleared++; }
  }
  let resend = 0; try { resend = D.run("DELETE FROM drive_seen WHERE status IN ('skipped','unmatched','error')").changes || 0; } catch { /* no Drive yet */ }
  D.setSetting('done_once', [...once, 'cv_link_repair_1']);
  D.setHealth('cv_link_repair', `${now()} · ${linked} resumes linked · ${cleared} broken links cleared · ${resend} Drive files to send again`);
  console.log(`Resume repair: ${linked} linked, ${cleared} broken links cleared, ${resend} Drive files to send again`);
})();

// Once (5 Nov 2026): the people from the Naukri exports in the Drive folder get the source "Google Drive - Naukri",
// told apart from the resumes. The 2 Nov import wrote their IDs to was-naukri-ids-2026-11-02.txt in the data folder;
// without that list, a Drive candidate with no resume file at all is one of them (the Naukri rows had no files).
(() => {
  const once = D.settings().done_once || []; if (once.includes('naukri_source_1')) return;
  const NAUKRI = 'Google Drive - Naukri'; let ids = null;
  try { ids = [...new Set((require('fs').readFileSync(path.join(D.DATA_DIR, 'was-naukri-ids-2026-11-02.txt'), 'utf8').match(/CA-\d+/g) || []))]; } catch { ids = null; }
  const rows = ids && ids.length ? ids.map((id) => get("SELECT id FROM candidates WHERE id=? AND source='Google Drive'", id)).filter(Boolean)
    : all("SELECT id FROM candidates WHERE source='Google Drive' AND (cv_file IS NULL OR cv_file='') AND NOT EXISTS (SELECT 1 FROM files f WHERE f.record_id=candidates.id)");
  for (const r of rows) update('candidates', r.id, { source: NAUKRI });
  const s = D.settings(); const add = ['Google Drive', NAUKRI].filter((x) => !(s.lead_sources || []).includes(x));
  if (add.length) D.setSetting('lead_sources', [...(s.lead_sources || []), ...add]);
  D.setSetting('done_once', [...(D.settings().done_once || []), 'naukri_source_1']);
  D.history('System', 'source', null, 'source', 'Google Drive', `${NAUKRI}: ${rows.length} candidates from the Naukri exports (${ids && ids.length ? 'from the import list' : 'Drive candidates with no resume file'})`);
  console.log(`Naukri source: ${rows.length} candidates now "${NAUKRI}" (${ids && ids.length ? 'from the import list' : 'no list found: Drive candidates with no file'})`);
})();

// folder path -> market, department and role. The CV folder is B2B | B2C | Pending Seggregatetion, then the
// department, then the role: "B2B/Designer/CAD Designer/x.pdf" -> B2B, Designer, CAD Designer. A file directly in a
// department folder has the department only; anything under Pending (Naukri, Images) has none.
const MARKET = { B2B: ['Manufacturer', 'Wholesaler'], B2C: ['Retailer'] };
function roleOf(file) {
  const parts = String(file || '').split('/').slice(0, -1).filter(Boolean);
  const at = parts.findIndex((p) => /^b2[bc]$/i.test(p.trim())); if (at < 0) return {};
  const tc = (s) => String(s || '').trim().replace(/\b\w/g, (c) => c.toUpperCase());
  return { market: parts[at].trim().toUpperCase(), dept: tc(parts[at + 1]), job: tc(parts[at + 2]) };
}

// One file. by: who is adding it; source: where it came from (for the note).
async function attachResume({ file, buf, source = 'Google Drive' }, by) {
  const name = path.basename(file); if (!CV_EXT.test(name)) return { status: 'skipped', why: 'not a resume file' };
  const cvparse = require('./cvparse'); const L = require('./logic'); const mail = require('./mailbox');
  if (/(^|[^a-z])(jd|job description)([^a-z]|$)/i.test(name)) return { status: 'skipped', why: 'a job description, not a resume' };
  let text = ''; try { text = cvparse.cvText(name, buf) || ''; } catch { text = ''; }
  // old Word (.doc): the readable runs of text inside it, enough for the name, phone and email
  if (!text.trim() && /\.doc$/i.test(name)) text = [...buf.toString('latin1').matchAll(/[\x20-\x7E]{4,}/g), ...buf.toString('utf16le').matchAll(/[\x20-\x7E]{4,}/g)].map((m) => m[0]).join('\n');
  const phone = mail.findPhone(text); const email = (/[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(text) || [''])[0].replace(/\.$/, '').toLowerCase();
  const fname = nameFromFile(file); const hay = `${name} ${fname} ${text.slice(0, 3000)}`;
  // The same file already on someone. Linked as their resume (and really on disk): nothing to do. Kept on their
  // record but never linked as the resume (how the 2 Nov import left them): link it now.
  const same = all("SELECT f.*, c.cv_file FROM files f LEFT JOIN candidates c ON c.id=f.record_id WHERE f.name=? AND f.type IN ('cv','file') AND f.replaced=0 ORDER BY f.id DESC", name);
  if (same.some((f) => String(f.cv_file || '') === String(f.id) && onDisk(f))) return { status: 'skipped', why: 'already attached' };
  const kept = same.find((f) => f.record_id && !f.cv_file && onDisk(f));
  if (kept) { update('candidates', kept.record_id, { cv_file: String(kept.id) }); insert('notes', { record_id: kept.record_id, text: `Resume ${name} linked (it was on file from ${source} but not shown as the resume).`, author: by.label || 'Resume import', at: now() }); return { status: 'attached', id: kept.record_id }; }
  let c = (phone ? get(`SELECT * FROM candidates WHERE whatsapp=? AND ${NO_CV}`, phone) : null)
    || (email ? get(`SELECT * FROM candidates WHERE lower(email)=? AND ${NO_CV}`, email) : null)
    || all(`SELECT * FROM candidates WHERE source LIKE 'Google Drive%' AND ${NO_CV}`).find((x) => named(x.name, hay))
    || all(`SELECT * FROM candidates WHERE ${NO_CV}`).find((x) => named(x.name, hay));
  let made = false;
  if (!c) {
    // someone with a resume already (same phone or email): leave them alone
    if ((phone && get('SELECT 1 FROM candidates WHERE whatsapp=? AND merged_into IS NULL AND removed=0', phone)) || (email && get('SELECT 1 FROM candidates WHERE lower(email)=? AND merged_into IS NULL AND removed=0', email))) return { status: 'skipped', why: 'that person already has a resume' };
    let ai = null; const LLM = require('./llm');
    if (LLM.available()) { try { ai = await LLM.extractCandidate({ subject: '', from: '', body: '', resume: text, files: text.replace(/\s/g, '').length < 100 && /\.(pdf|jpe?g|png)$/i.test(name) ? [{ name, buf }] : [] }); } catch { ai = null; } }
    const nm = (ai && ai.name) || fname || '';
    if (!nm && !phone) return { status: 'unmatched', why: 'no name or phone could be read' };
    const role = roleOf(file); const d10 = (v) => { const x = String(v || '').replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(x) ? x : ''; };
    const r = L.intakeCandidate({ name: nm || 'Resume candidate', whatsapp: (ai && d10(ai.whatsapp)) || phone, email: (ai && ai.email) || email, city: (ai && ai.city) || '', job_wanted: role.job || (ai && ai.job_wanted) || '', department: role.job ? undefined : role.dept || undefined, exp_business: MARKET[role.market] || undefined, exp_total: ai ? ai.exp_total : undefined, current_company: ai ? ai.current_company || '' : '' },
      { source, allowNoPhone: true, consent: false, silent: true, by, needsCheck: (ai && d10(ai.whatsapp)) || phone ? null : 'No phone found' });
    c = r.candidate; made = r.isNew;
  } else {
    // someone already here: the folder fills in the role, department and market they do not have yet
    const role = roleOf(file); const fill = {};
    if (role.job && !c.job_wanted) { fill.job_wanted = role.job; fill.department = L.deptOf ? L.deptOf(role.job) || role.dept || null : role.dept || null; } else if (role.dept && !c.department) fill.department = role.dept;
    const biz = Array.isArray(c.exp_business) ? c.exp_business : []; if (MARKET[role.market] && !biz.length) fill.exp_business = MARKET[role.market];
    if (Object.keys(fill).length) update('candidates', c.id, fill);
  }
  const f = await F.saveFile({ recordId: c.id, type: 'cv', name, base64: buf.toString('base64'), by: by.label || 'Resume import' });
  update('candidates', c.id, { cv_file: String(f.id) }); try { cvparse.fillCandidate(c.id, name, buf, by.label || 'Resume import'); } catch { /* the file is kept even if it cannot be read */ }
  insert('notes', { record_id: c.id, text: `Resume ${name} added from ${source}${file.includes('/') ? ` (${path.dirname(file)})` : ''}.`, author: by.label || 'Resume import', at: now() });
  return { status: made ? 'created' : 'attached', id: c.id, name: c.name };
}

// Many files (a zip, or one resume): the summary, and every file that found nobody.
async function attachMany(list, by, source) {
  const out = { attached: 0, created: 0, skipped: 0, unmatched: [], rows: [] };
  for (const x of list) {
    let r; try { r = await attachResume({ ...x, source }, by); } catch (e) { r = { status: 'unmatched', why: e.message }; }
    if (r.status === 'attached') out.attached++; else if (r.status === 'created') out.created++; else if (r.status === 'skipped') out.skipped++; else out.unmatched.push(`${path.basename(x.file)}: ${r.why}`);
    out.rows.push({ file: x.file, ...r });
  }
  return out;
}
route('POST', '/api/candidates/resume-files', { auth: 'team', levels: ['super'] }, async (ctx) => {
  const b = ctx.body || {}; const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64'); if (!buf.length) throw httpError(400, 'Choose the zip or the resume');
  let list;
  if (/\.zip$/i.test(b.name || '')) { const z = F.unzip(buf); list = Object.entries(z).filter(([n, v]) => !n.endsWith('/') && v && v.length && CV_EXT.test(n)).map(([file, v]) => ({ file, buf: v })); }
  else list = [{ file: String(b.name || 'resume.pdf'), buf }];
  if (!list.length) throw httpError(400, 'No PDF, Word or image resumes in that file.');
  const res = await attachMany(list, ctx.actor, b.source || 'Google Drive');
  D.history(ctx.actor.label, 'resume files', null, null, null, `${res.attached} attached, ${res.created} new, ${res.skipped} skipped, ${res.unmatched.length} not matched`);
  return { ...res, rows: undefined, total: list.length };
});

module.exports = { attachResume, attachMany, nameFromFile, roleOf };
