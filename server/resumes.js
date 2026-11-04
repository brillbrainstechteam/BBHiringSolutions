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

// folder path -> the role and department ("Resume - CV/B2C/Sales/Sales Executive/x.pdf" -> Sales Executive, Sales)
function roleOf(file) {
  const parts = String(file || '').split('/').slice(0, -1).filter(Boolean);
  const leaf = parts[parts.length - 1] || ''; const dept = parts[parts.length - 2] || '';
  if (!leaf || /^(resume|cv|images?|pending|naukri)/i.test(leaf) || /^b2[bc]$/i.test(leaf)) return {};
  return { job: leaf.replace(/\b\w/g, (c) => c.toUpperCase()), dept: /^b2[bc]$/i.test(dept) ? '' : dept };
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
  // already attached (the same file name on someone): nothing to do
  if (get("SELECT 1 FROM files WHERE name=? AND type='cv' AND replaced=0", name)) return { status: 'skipped', why: 'already attached' };
  let c = (phone ? get(`SELECT * FROM candidates WHERE whatsapp=? AND ${NO_CV}`, phone) : null)
    || (email ? get(`SELECT * FROM candidates WHERE lower(email)=? AND ${NO_CV}`, email) : null)
    || all(`SELECT * FROM candidates WHERE source='Google Drive' AND ${NO_CV}`).find((x) => named(x.name, hay))
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
    const r = L.intakeCandidate({ name: nm || 'Resume candidate', whatsapp: (ai && d10(ai.whatsapp)) || phone, email: (ai && ai.email) || email, city: (ai && ai.city) || '', job_wanted: role.job || (ai && ai.job_wanted) || '', exp_total: ai ? ai.exp_total : undefined, current_company: ai ? ai.current_company || '' : '' },
      { source, allowNoPhone: true, consent: false, silent: true, by, needsCheck: (ai && d10(ai.whatsapp)) || phone ? null : 'No phone found' });
    c = r.candidate; made = r.isNew;
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
