// Resume and details from candidates who have none on file: a WhatsApp message (bbhs_profile_update) with a link to
// a short page, no login (/u/<code>): upload the resume, current and expected salary (a month) and the notice period.
// It saves straight onto their profile. Sent by hand (Candidates -> select -> Ask for resume & details) or once by
// itself to new candidates who came without a resume (automatic message "resume_request"; bulk imports left out).
const crypto = require('crypto');
const D = require('./db');
const L = require('./logic');
const F = require('./files');
const R = require('./router');
const { route } = R;
const { get, all, insert, update, now, httpError } = D;

D.db.exec('CREATE TABLE IF NOT EXISTS profile_links (token TEXT PRIMARY KEY, candidate_id TEXT, created_at TEXT, used_at TEXT)');
const DAYS = 30; // a link works for a month
const IMPORTED = /^(google drive|excel import|naukri)/i; // bulk imports: no opt-in, never messaged by the rule
const linkOf = (candId) => {
  let t = get('SELECT * FROM profile_links WHERE candidate_id=? AND created_at > ? ORDER BY created_at DESC', candId, new Date(Date.now() - (DAYS - 3) * 86400000).toISOString());
  if (!t) { t = { token: crypto.randomBytes(12).toString('base64url'), candidate_id: candId, created_at: now(), used_at: null }; insert('profile_links', t); }
  return L.link(`u/${t.token}`);
};
// One candidate: the message, unless they already have a resume and all three details.
function ask(candId, by, auto) {
  const c = get('SELECT * FROM candidates WHERE id=? AND removed=0 AND merged_into IS NULL', candId); if (!c) return { skipped: 'Not found' };
  if (c.cv_file && c.cur_salary && c.exp_salary && c.notice_days !== null && c.notice_days !== undefined) return { skipped: 'Resume and details already there' };
  return L.sendWA({ ptype: 'candidate', pid: c.id, format: 'bbhs_profile_update', vars: { link: linkOf(c.id) }, by, ...(auto ? { auto: true, rule: 'resume_request', dedupe: `profile:${c.id}` } : { bulk: true, dedupe: `profile:${c.id}:${L.istDay()}` }) });
}
// The automatic one: new candidates (the last 7 days) with no resume, a WhatsApp number, not a bulk import, once.
function sweep() {
  const fm = (D.settings().formats || {}).bbhs_profile_update; const rule = (D.settings().auto_rules || []).find((r) => r.key === 'resume_request');
  if (!fm || !fm.approved || fm.off || (rule && !rule.on)) return 0; // waits for Meta's approval, and stops when switched off
  const since = new Date(Date.now() - 7 * 86400000).toISOString(); const hourAgo = new Date(Date.now() - 3600000).toISOString(); let n = 0;
  for (const c of all("SELECT id, source FROM candidates WHERE removed=0 AND merged_into IS NULL AND IFNULL(junk,0)=0 AND (cv_file IS NULL OR cv_file='') AND whatsapp != '' AND IFNULL(opted_out,0)=0 AND created_at > ? AND created_at < ?", since, hourAgo)) {
    if (IMPORTED.test(c.source || '') || get("SELECT 1 FROM messages WHERE dedupe=?", `profile:${c.id}`)) continue;
    const r = ask(c.id, { label: 'System' }, true); if (r && !r.skipped) n++;
  }
  return n;
}

// ---------- the page ----------
const tokenRow = (token) => { const t = get('SELECT * FROM profile_links WHERE token=?', String(token || '')); if (!t || t.created_at < new Date(Date.now() - DAYS * 86400000).toISOString()) return null; return t; };
function pageHtml(token) {
  const t = tokenRow(token); const b = D.settings().business;
  const e = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const c = t && get('SELECT * FROM candidates WHERE id=?', t.candidate_id);
  const month = (y) => (y ? Math.round(y / 12) : '');
  const notice = [[0, 'Immediate'], [15, '15 days'], [30, '30 days'], [45, '45 days'], [60, '60 days'], [90, '90 days']];
  const body = !c ? '<div class="done">This link has expired. Please reply on WhatsApp and we will send a new one.</div>'
    : `<form id="f"><p>Hello ${e(String(c.name || '').split(' ')[0])}, please share these so we can match you with the right jobs. It takes 2 minutes.</p>
      <label class="up"><span>Your latest resume <small>(PDF, Word or a photo, up to 10 MB)</small></span><input type="file" name="cv" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"><b id="cvn">${c.cv_file ? 'We have a resume on file; upload a newer one if you like.' : ''}</b></label>
      <label>Current salary (₹ a month)<input name="cur" inputmode="numeric" placeholder="e.g. 25000" value="${e(month(c.cur_salary))}"></label>
      <label>Expected salary (₹ a month)<input name="exp" inputmode="numeric" placeholder="e.g. 30000" value="${e(month(c.exp_salary))}"></label>
      <label>Notice period<select name="notice"><option value="">Pick one</option>${notice.map(([v, l]) => `<option value="${v}" ${c.notice_days === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button>Send</button><div id="err"></div></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Your resume and details · ${e(b.name)}</title>
<style>:root{--navy:#101a3a;--gold:#d4a017;--ink:#1d2433;--muted:#5d6577;--line:#e6e8ef;--bg:#f6f7fb}*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
header{background:var(--navy);color:#fff;padding:18px 16px}header .in,main{max-width:520px;margin:0 auto}header b{font-size:15px}main{padding:20px 16px 40px}
form{display:grid;gap:14px}label{display:grid;gap:6px;font-size:14px;color:var(--muted)}input,select{width:100%;border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit;background:#fff;color:var(--ink)}
.up{background:#fff;border:1px dashed #b9bfd0;border-radius:12px;padding:14px}.up small{color:var(--muted)}#cvn{font-size:13px;color:var(--ink);font-weight:500}
button{background:var(--navy);color:#fff;border:0;border-radius:10px;padding:13px;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.6}#err{color:#b42318;font-size:14px}
.done{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px;text-align:center}</style></head>
<body><header><div class="in"><b>${e(b.name)}</b></div></header><main>${body}</main>
<script>(function(){var f=document.getElementById('f');if(!f)return;var fi=f.cv;fi.onchange=function(){document.getElementById('cvn').textContent=fi.files[0]?fi.files[0].name:''};
f.addEventListener('submit',function(ev){ev.preventDefault();var err=document.getElementById('err'),btn=f.querySelector('button');err.textContent='';var file=fi.files[0];
if(file&&file.size>10*1024*1024){err.textContent='The resume is bigger than 10 MB.';return}btn.disabled=true;btn.textContent='Sending…';
var go=function(cv){fetch('/api/pub/profile/${e(t ? t.token : '')}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cur:f.cur.value,exp:f.exp.value,notice:f.notice.value,cv:cv})}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||'Could not send');f.outerHTML='<div class="done">Thank you! Your details are saved. We will be in touch when a matching job opens.</div>'})}).catch(function(x){err.textContent=x.message;btn.disabled=false;btn.textContent='Send'})};
if(!file)return go(null);var rd=new FileReader();rd.onload=function(){go({name:file.name,base64:rd.result})};rd.readAsDataURL(file)})})();</script></body></html>`;
}
route('POST', '/api/pub/profile/:token', { rate: { key: 'profilelink', max: 20, minutes: 60 } }, async (ctx) => {
  const t = tokenRow(ctx.params.token); if (!t) throw httpError(404, 'This link has expired. Please ask us for a new one on WhatsApp.');
  const c = get('SELECT * FROM candidates WHERE id=?', t.candidate_id); if (!c) throw httpError(404, 'Not found');
  const b = ctx.body || {}; const num = (v) => { const n = Math.round(Number(String(v || '').replace(/[^\d.]/g, ''))); return n > 0 ? n : null; };
  const cur = num(b.cur); const exp = num(b.exp); const notice = b.notice === '' || b.notice === undefined ? null : Number(b.notice);
  if (!b.cv && !cur && !exp && notice === null) throw httpError(400, 'Please upload your resume or fill in the details.');
  const patch = { last_updated: now() };
  if (cur) patch.cur_salary = cur * 12; if (exp) patch.exp_salary = exp * 12; if (notice !== null && !Number.isNaN(notice)) patch.notice_days = notice;
  update('candidates', c.id, patch);
  if (b.cv && b.cv.base64) {
    const f = await F.saveFile({ recordId: c.id, type: 'cv', name: b.cv.name, base64: b.cv.base64, by: 'Candidate (link)' });
    update('candidates', c.id, { cv_file: String(f.id) }); try { require('./cvparse').fillCandidate(c.id, b.cv.name, b.cv.base64, 'Candidate (link)'); } catch { /* the file is kept */ }
  }
  D.run('UPDATE profile_links SET used_at=? WHERE token=?', now(), t.token);
  insert('notes', { record_id: c.id, text: `Shared their ${[b.cv && 'resume', cur && 'current salary', exp && 'expected salary', notice !== null && 'notice period'].filter(Boolean).join(', ')} on the link`, author: 'Candidate', at: now() });
  if (c.needs_check && /resume|salary|notice/i.test(c.needs_check)) update('candidates', c.id, { needs_check: null });
  return { ok: true };
});

module.exports = { ask, sweep, pageHtml };
