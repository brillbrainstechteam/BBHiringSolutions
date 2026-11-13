// Email inbox door (11.1): every job application in the hiring mailbox label becomes a candidate.
// Name, phone and email are read from the email and the CV where possible; anything not found is marked "Needs checking".
// Mailbox settings come from .env (IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS, IMAP_FOLDER). No outside packages.
const tls = require('tls');
const D = require('./db');
const F = require('./files');

// ---------- a small IMAP client (LOGIN, SELECT, UID SEARCH/FETCH/STORE) ----------
function imapConnect({ host, port }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host });
    let buf = Buffer.alloc(0); let tagN = 0; let pending = null; let greeted = false; let dead = null;
    sock.setTimeout(60000, () => { sock.destroy(new Error('Mailbox timed out')); });
    const fail = (e) => { dead = dead || e; if (pending) { pending.reject(e); pending = null; } else reject(e); };
    sock.on('error', fail);
    sock.on('close', () => fail(new Error('Mailbox closed the connection')));
    // Reads complete responses, keeping {n} literals (message bodies) as Buffers.
    const pump = () => {
      for (;;) {
        if (!greeted) {
          const i = buf.indexOf('\r\n'); if (i < 0) return;
          buf = buf.subarray(i + 2); greeted = true;
          resolve(api); continue;
        }
        if (!pending) return;
        let pos = pending.pos;
        const i = buf.indexOf('\r\n', pos); if (i < 0) return;
        const line = buf.subarray(pos, i).toString('latin1');
        const lit = /\{(\d+)\}$/.exec(line);
        if (lit) {
          const n = Number(lit[1]); if (buf.length < i + 2 + n) return;
          pending.literals.push(buf.subarray(i + 2, i + 2 + n));
          pending.pos = i + 2 + n; continue;
        }
        pending.lines.push(line); pending.pos = i + 2;
        if (line.startsWith(pending.tag + ' ')) {
          const p = pending; pending = null; buf = buf.subarray(p.pos);
          if (/^\S+ OK/.test(line)) p.resolve({ lines: p.lines, literals: p.literals });
          else p.reject(new Error(`Mailbox said: ${line.slice(p.tag.length + 1)}`));
        }
      }
    };
    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
    const api = {
      get dead() { return !!dead; },
      cmd(text) {
        return new Promise((res, rej) => {
          if (dead) { rej(dead); return; } // a closed connection answers nothing: fail now rather than wait forever
          const tag = `A${++tagN}`;
          pending = { tag, lines: [], literals: [], pos: 0, resolve: res, reject: rej };
          sock.write(`${tag} ${text}\r\n`);
          pump();
        });
      },
      end() { try { sock.write(`A${++tagN} LOGOUT\r\n`); } catch { /* closing */ } sock.end(); },
    };
  });
}
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ---------- MIME ----------
function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
    const b = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return b.toString(/utf-?8/i.test(cs) ? 'utf8' : 'latin1');
  });
}
function parseHeaders(str) {
  const h = {};
  for (const line of str.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':'); if (i < 1) continue;
    const k = line.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = line.slice(i + 1).trim();
  }
  return h;
}
const pct = (v) => { try { return Buffer.from(v.replace(/%([0-9A-F]{2})/gi, (x, hh) => String.fromCharCode(parseInt(hh, 16))), 'latin1').toString('utf8'); } catch { return v; } };
const param = (header, name) => {
  const h = String(header || '');
  // RFC 2231 continuations: name*0*=utf-8''part1; name*1*=part2 … joined in order.
  const pieces = [...h.matchAll(new RegExp(`(?:^|;)\\s*${name}\\*(\\d+)(\\*?)=\\s*("([^"]*)"|[^;]*)`, 'gi'))].map((m) => ({ n: Number(m[1]), enc: !!m[2], v: (m[4] !== undefined ? m[4] : m[3]).trim() })).sort((a, b) => a.n - b.n);
  if (pieces.length) { const joined = pieces.map((p) => (p.enc ? p.v.replace(/^[\w-]*'[\w-]*'/, '') : p.v)).join(''); return pieces.some((p) => p.enc) ? pct(joined) : decodeWords(joined); }
  const enc = new RegExp(`(?:^|;)\\s*${name}\\*=\\s*"?([^";]+)"?`, 'i').exec(h); if (enc) return pct(enc[1].replace(/^[\w-]*'[\w-]*'/, ''));
  const m = new RegExp(`(?:^|;)\\s*${name}=\\s*("([^"]*)"|[^;]*)`, 'i').exec(h); return m ? decodeWords((m[2] !== undefined ? m[2] : m[1]).trim()) : '';
};
function decodeBody(raw, cte) {
  const enc = String(cte || '').toLowerCase();
  if (enc === 'base64') return Buffer.from(raw.toString('latin1').replace(/\s+/g, ''), 'base64');
  if (enc === 'quoted-printable') return Buffer.from(raw.toString('latin1').replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
  return raw;
}
// Returns the headers of the message and every leaf part: { type, name, content }.
function parseMessage(buf) {
  const split = (b) => { const s = b.toString('latin1'); const i = s.search(/\r?\n\r?\n/); if (i < 0) return [s, Buffer.alloc(0)]; const sep = /\r?\n\r?\n/.exec(s.slice(i))[0].length; return [s.slice(0, i), Buffer.from(s.slice(i + sep), 'latin1')]; };
  const parts = [];
  const walk = (b, depth) => {
    const [hs, body] = split(b); const h = parseHeaders(hs);
    const ct = h['content-type'] || 'text/plain'; const type = ct.split(';')[0].trim().toLowerCase();
    if (type === 'message/rfc822' && depth < 6) { walk(decodeBody(body, h['content-transfer-encoding']), depth + 1); return h; }
    if (type.startsWith('multipart/') && depth < 6) {
      const boundary = param(ct, 'boundary'); if (!boundary) return h;
      const pieces = body.toString('latin1').split(`--${boundary}`).slice(1);
      for (const p of pieces) { if (p.startsWith('--')) break; walk(Buffer.from(p.replace(/^\r?\n/, ''), 'latin1'), depth + 1); }
      return h;
    }
    const EXT = { 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };
    let name = param(h['content-disposition'], 'filename') || param(ct, 'name');
    if (!name && EXT[type] && /attachment|inline/i.test(h['content-disposition'] || 'attachment')) name = `resume.${EXT[type]}`;
    // no name and a generic type: a PDF or old Word file by its first bytes is taken as the resume
    if (!name && type === 'application/octet-stream' && /attachment/i.test(h['content-disposition'] || '')) {
      const head = decodeBody(body, h['content-transfer-encoding']).subarray(0, 8);
      if (head.toString('latin1').startsWith('%PDF')) name = 'resume.pdf'; else if (head.toString('hex').startsWith('d0cf11e0')) name = 'resume.doc';
    }
    // a CV sent with a generic type (application/octet-stream) but a .pdf / .docx name is kept as it is
    parts.push({ type, name, content: decodeBody(body, h['content-transfer-encoding']) });
    return h;
  };
  const headers = walk(buf, 0);
  return { headers, parts };
}

// ---------- text out of a CV ----------
function textOfDocx(buf) {
  try { const z = F.unzip(buf); const xml = (z['word/document.xml'] || Buffer.alloc(0)).toString('utf8'); return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'); } catch { return ''; }
}
function cvText(att) {
  const better = require('./cvparse').cvText(att.name, att.content); if (better) return better; // reads Word/Chrome/Canva PDFs too
  const n = String(att.name || '').toLowerCase();
  if (n.endsWith('.docx')) return textOfDocx(att.content);
  if (n.endsWith('.txt')) return att.content.toString('utf8');
  return '';
}
function findPhone(text) {
  for (const m of String(text).matchAll(/(?:\+?91[\s-]?|0)?([6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}|[6-9]\d{4}[\s-]?\d{5})/g)) { const d = m[1].replace(/\D/g, ''); if (d.length === 10) return d; }
  return '';
}
const findEmail = (text) => (/[\w.+-]+@[\w-]+\.[\w.-]+/.exec(String(text)) || [''])[0];
function findName(text) {
  for (const line of String(text).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 15)) {
    if (/^(curriculum|resume|cv|bio[- ]?data|profile)\b/i.test(line)) continue;
    if (/^[A-Za-z][A-Za-z.]+(\s+[A-Za-z][A-Za-z.]+){1,3}$/.test(line) && line.length <= 40) return line.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return '';
}

// A CV attachment: any PDF or Word file; an image only when named like a resume (logos and signatures are not).
const isCv = (n) => /\.(pdf|docx?)$/i.test(n || '') || (/\.(jpe?g|png)$/i.test(n || '') && /cv|resume|bio.?data|profile/i.test(n || ''));
// The resumes in an email. A photo or scan sent as the resume ("IMG-20260320-WA0002.jpg") counts when the email has
// no PDF or Word CV and is not about joining papers: the biggest picture that is not an ID card, certificate or logo.
const PAPERS = /aadha?ar|adhar|pan ?card|pancard|cheque|sslc|hsc|marksheet|mark sheet|certificate|passport|voter|licen[cs]e|payslip|salary slip|offer letter|relieving|experience letter|signature|logo/i;
function cvFiles(atts, subject) {
  const docs = atts.filter((a) => isCv(a.name) && !PAPERS.test(a.name || '')); // an Aadhaar or PAN PDF is not a resume
  if (docs.some((a) => /\.(pdf|docx?)$/i.test(a.name)) || docs.length) return docs;
  if (/document|joining|offer letter|academic|kyc|aadha?ar|pan card|usage report|business proposal/i.test(subject || '')) return [];
  const size = (a) => (a.buf || a.content || []).length;
  return atts.filter((a) => /\.(jpe?g|png)$/i.test(a.name || '') && size(a) >= 50 * 1024 && !PAPERS.test(a.name)).sort((x, y) => size(y) - size(x)).slice(0, 1);
}
// A resume sent as a link instead of a file: Google Drive files and Google Docs shared with "anyone with the link"
// are downloaded (a Doc as PDF). Returns { name, buf } or { error } (not shared, not a resume, too big).
const DRIVE_FILE = /https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^ ]*&)?id=)([A-Za-z0-9_-]{20,})/;
const GDOC = /https?:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{20,})/;
function cvLinks(text) { const out = []; for (const u of String(text || '').match(/https?:\/\/[^\s"'<>)\]]+/g) || []) { const d = DRIVE_FILE.exec(u); const g = GDOC.exec(u); if (d) out.push({ kind: 'drive', id: d[1], url: u }); else if (g) out.push({ kind: 'doc', id: g[1], url: u }); } return out.filter((x, i, l) => l.findIndex((y) => y.id === x.id) === i).slice(0, 4); }
async function fetchLinked(l) {
  const url = l.kind === 'doc' ? `https://docs.google.com/document/d/${l.id}/export?format=pdf` : `https://drive.google.com/uc?export=download&id=${l.id}`;
  let res; try { res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) }); } catch (e) { return { error: `could not open the link (${e.message})` }; }
  if (!res.ok) return { error: res.status === 404 ? 'the link is not shared (or was removed)' : `the link answered ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer()); if (buf.length > 10 * 1024 * 1024) return { error: 'the file is bigger than 10 MB' };
  const cd = res.headers.get('content-disposition') || ''; const fn = (/filename\*=UTF-8''([^;]+)/i.exec(cd) || [])[1] || (/filename="?([^";]+)"?/i.exec(cd) || [])[1] || '';
  const head = buf.slice(0, 8).toString('latin1');
  const ext = head.startsWith('%PDF') ? 'pdf' : head.startsWith('PK') ? 'docx' : buf.slice(0, 4).toString('hex') === 'd0cf11e0' ? 'doc' : buf.slice(0, 3).toString('hex') === 'ffd8ff' ? 'jpg' : buf.slice(0, 4).toString('hex') === '89504e47' ? 'png' : null;
  if (!ext) return { error: /<html/i.test(buf.slice(0, 400).toString('latin1')) ? 'the link is not shared with "anyone with the link"' : 'the link is not a resume file' };
  let name = decodeURIComponent(fn || '').trim() || `resume-from-link.${ext}`; if (!/\.(pdf|docx?|jpe?g|png)$/i.test(name)) name = `${name.replace(/\.[^.]*$/, '')}.${ext}`;
  return { name, buf };
}
// The resume files an email has, and any resume links in its text downloaded as files (when the email has no file).
async function withLinked(atts, text) {
  if (atts.some((a) => isCv(a.name))) return { atts, notes: [] };
  const notes = []; const got = [];
  for (const l of cvLinks(text)) { const r = await fetchLinked(l); if (r.buf) got.push({ name: r.name, buf: r.buf, content: r.buf, fromLink: l.url }); else notes.push(`Resume link not downloaded: ${r.error}`); if (got.length) break; }
  return { atts: [...atts, ...got], notes };
}
// One email → one candidate lead (or an update to the same number).
// Your own addresses (the mailbox's domain, the business website's, the team's): their mail is not a candidate's.
function ownDomains() {
  const ds = new Set(String(process.env.IMAP_OWN_DOMAINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const add = (e) => { const d = String(e || '').split('@')[1]; if (d && !/^(gmail|yahoo|outlook|hotmail|rediffmail|icloud)\./i.test(d)) ds.add(d.toLowerCase()); };
  add(D.ENV.imap.user);
  try { ds.add(new URL(D.settings().business.base_url).hostname.replace(/^(www|hire|app)\./, '')); } catch { /* no site */ }
  for (const u of D.all("SELECT email FROM users WHERE email IS NOT NULL AND email != ''")) add(u.email);
  return [...ds];
}
// A link to a resume on a site the portal cannot download from (it needs a login there): kept so the team can open it.
const SKIP_LINK = /unsubscribe|groups\.google|support\.google|google\.com\/(maps|url)|facebook\.com|instagram\.com|twitter\.com|x\.com\/|wa\.me|mailto:|brillbrains/i;
function cvLinkIn(text) {
  for (const raw of String(text || '').replace(/=\r?\n/g, '').match(/https?:\/\/[^\s"'<>)\]]+/g) || []) {
    const u = raw.replace(/&amp;/g, '&').replace(/[.,;]+$/, '');
    if (!SKIP_LINK.test(u) && /cv|resume|bio.?data|portfolio|profile/i.test(u)) return u.split(/[?#]utm_|[?&]utm_/)[0];
  }
  return '';
}
const PAPER_SUBJ = /document|kyc|aadha?ar|pan card|bank details|joining|verification/i;
async function intakeEmail({ fromName, fromEmail, subject, text, attachments, folder }) {
  const L = require('./logic');
  const cvs = cvFiles(attachments || [], subject);
  const texts = cvs.map((a) => cvText({ name: a.name, content: a.buf }));
  const cvTextAll = texts.join('\n');
  const unread = cvs.filter((a, i) => String(texts[i] || '').replace(/\s/g, '').length < 100 && /\.(pdf|jpe?g|png)$/i.test(a.name)).slice(0, 2); // design PDFs, photos: the AI reads the file
  const all = `${subject || ''}\n${text || ''}\n${cvTextAll}`;
  const s = D.settings();
  // The AI (when a key is set) reads the email and the resume for the candidate's details; the rules below fill gaps.
  let ai = null; let aiErr = '';
  const LLM = require('./llm');
  if (LLM.available()) { try { ai = await LLM.extractCandidate({ subject, from: `${fromName || ''} <${fromEmail || ''}>`, body: text, resume: cvTextAll, files: unread.map((a) => ({ name: a.name, buf: a.buf })) }); } catch (e) { aiErr = e.message; } }
  if (ai && ai.is_job_application === false) return { skipped: 'Not a job application (AI)' };
  const d10 = (v) => { const x = String(v || '').replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(x) ? x : ''; };
  const phone = (ai && d10(ai.whatsapp)) || findPhone(all);
  const email = (ai && /@/.test(ai.email || '') && ai.email) || fromEmail || findEmail(all);
  const senderName = fromName && !/@/.test(fromName) && /\S+\s+\S+/.test(fromName.trim()) ? fromName.trim() : '';
  const name = (ai && ai.name) || senderName || findName(cvTextAll) || '';
  const cityRule = s.cities.map((c) => c.name).find((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(all)) || '';
  const city = (ai && ai.city) || cityRule || '';
  const jobRule = L.jobList().map((j) => j.title).sort((a, b) => b.length - a.length).find((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${subject}\n${text}\n${cvTextAll}`)) || '';
  const job = (ai && ai.job_wanted) || jobRule || '';
  // the same person writing again (a reply in the thread, documents later): their record, found by email address
  const known = (email ? D.get('SELECT id, whatsapp FROM candidates WHERE lower(email)=lower(?) AND merged_into IS NULL AND removed=0 ORDER BY (whatsapp != \'\') DESC, created_at LIMIT 1', email) : null)
    // or the same name where one side has no number (an agency's forward and the original, one read without it)
    || (name ? D.get('SELECT id, whatsapp FROM candidates WHERE lower(name)=lower(?) AND merged_into IS NULL AND removed=0 AND (whatsapp = \'\' OR ? = \'\') ORDER BY created_at LIMIT 1', name, phone) : null);
  const phoneUse = phone || (known && known.whatsapp) || '';
  const missing = [!name && 'name', !phoneUse && 'phone'].filter(Boolean);
  const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const r = L.intakeCandidate({ name: name || (email ? email.split('@')[0] : 'Email candidate'), whatsapp: phoneUse, email, city, state: (ai && ai.state) || '', work_cities: city ? [city] : [], job_wanted: job,
    ...(ai ? { exp_total: num(ai.exp_total), exp_jewellery: num(ai.exp_jewellery), current_company: ai.current_company || '', cur_salary: num(ai.current_salary_month) !== null ? num(ai.current_salary_month) * 12 : null, exp_salary: num(ai.expected_salary_month) !== null ? num(ai.expected_salary_month) * 12 : null, notice_days: num(ai.notice_days), skills: (ai.skills || []).slice(0, 12) } : {}) },
    { source: 'Email', allowNoPhone: true, consent: false, existingId: known ? known.id : null, needsCheck: missing.length ? `Not found in email or CV: ${missing.join(', ')}` : null });
  const id = r.candidate.id;
  D.insert('notes', { record_id: id, text: `Email: ${subject || '(no subject)'}${text ? ' — ' + String(text).trim().slice(0, 300) : ''}`, author: 'Email inbox', at: D.now() });
  if (ai) D.insert('notes', { record_id: id, text: `Read by AI: ${[ai.education && `education ${ai.education}`, (ai.languages || []).length && `languages ${ai.languages.join(', ')}`, ai.role_applied_for && `applied for ${ai.role_applied_for}`].filter(Boolean).join(' · ') || 'details filled from the email and resume'}`, author: 'Email inbox', at: D.now() });
  else if (aiErr) D.insert('notes', { record_id: id, text: `AI could not read this email (${aiErr}); details found by rules only.`, author: 'Email inbox', at: D.now() });
  if (folder && folder !== D.ENV.imap.folder) D.insert('notes', { record_id: id, text: `From the "${folder}" label in the mailbox.`, author: 'Email inbox', at: D.now() });
  if (!cvs.length) { const link = cvLinkIn(text); if (link) { D.update('candidates', id, { cv_link: link }); D.insert('notes', { record_id: id, text: `Resume sent as a link (open it to see the resume): ${link}`, author: 'Email inbox', at: D.now() }); } }
  // ID papers that came with the email are kept as documents, never as the resume
  for (const a of (attachments || []).filter((x) => PAPERS.test(x.name || '') && /\.(pdf|docx?|jpe?g|png)$/i.test(x.name || ''))) {
    try { await F.saveFile({ recordId: id, type: 'file', name: a.name, base64: a.buf.toString('base64'), by: 'Email inbox' }); } catch (e) { D.insert('notes', { record_id: id, text: `Attachment ${a.name} not saved: ${e.message}`, author: 'Email inbox', at: D.now() }); }
  }
  // Someone who has a resume already (a later email, often the documents we asked for): their resume stays unless
  // the new file is clearly a resume; the rest are kept as documents.
  const hadCv = known && D.get("SELECT 1 FROM candidates WHERE id=? AND cv_file IS NOT NULL AND cv_file != ''", id);
  let first = true;
  for (const a of cvs) {
    if (first && hadCv && (PAPER_SUBJ.test(subject || '') || !/cv|resume|bio.?data|profile/i.test(a.name || ''))) first = false;
    try {
      const f = await F.saveFile({ recordId: id, type: first ? 'cv' : 'file', name: a.name, base64: a.buf.toString('base64'), by: 'Email inbox' });
      if (first) { D.update('candidates', id, { cv_file: String(f.id) }); require('./cvparse').fillCandidate(id, a.name, a.buf, 'Email inbox'); }
      first = false;
    } catch (e) { D.insert('notes', { record_id: id, text: `Attachment ${a.name} not saved: ${e.message}`, author: 'Email inbox', at: D.now() }); }
  }
  // Candidates only: the team decides which job someone goes on (no applications from email).
  if (r.isNew) require('./mailer').newLead('candidate', D.get('SELECT * FROM candidates WHERE id=?', id));
  return { id, isNew: r.isNew, found: { name: !!name, phone: !!phone, email: !!email, city, job } };
}

// One email can sit in the label and the whole mailbox: it counts once.
async function clientOnce(headers, fn) {
  const id = String(headers['message-id'] || '').trim(); const key = id ? `msg:${id}` : '';
  if (key && D.get('SELECT 1 FROM mail_seen WHERE uid=?', key)) return;
  await fn(); if (key) D.run('INSERT OR IGNORE INTO mail_seen (uid,at) VALUES (?,?)', key, D.now());
}
// Clients reply to the group address, which reaches the whole mailbox and not only the hiring label. This looks for
// new mail from each client's own address, from the day this started, and leaves everything else unopened.
const L_accounts = () => require('./logic').accountsUsers().map((u) => u.email).filter(Boolean);
async function checkReplies(cfg) {
  const own = ownDomains(); const map = new Map();
  for (const c of D.all('SELECT * FROM clients WHERE merged_into IS NULL AND removed=0 AND junk=0')) for (const e of [c.email, (c.extra || {}).hr_email]) { const a = String(e || '').trim().toLowerCase(); if (a.includes('@') && !own.includes(a.split('@')[1])) map.set(a, c); }
  for (const a of [D.settings().accounts_email, ...L_accounts()]) if (String(a || '').includes('@')) map.set(String(a).trim().toLowerCase(), { accounts: true });
  if (!D.settings().client_mail_since) D.setSetting('client_mail_since', D.now());
  const d = new Date(D.settings().client_mail_since); const day = `${d.getUTCDate()}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}-${d.getUTCFullYear()}`;
  const folder = process.env.IMAP_REPLY_FOLDER || '[Gmail]/All Mail'; const box = await imapConnect(cfg); let got = 0;
  try {
    await box.cmd(`LOGIN ${q(cfg.user)} ${q(cfg.pass)}`); await box.cmd(`EXAMINE ${q(folder)}`);
    for (const [addr, client] of map) {
      const sr = await box.cmd(`UID SEARCH SINCE ${day} FROM ${q(addr)}`);
      const uids = (sr.lines.find((l) => l.startsWith('* SEARCH')) || '').replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean).filter((u) => !D.get('SELECT 1 FROM mail_seen WHERE uid=?', `reply:${u}`)).slice(0, 20);
      for (const uid of uids) {
        const fr = await box.cmd(`UID FETCH ${uid} BODY.PEEK[]`); const raw = fr.literals[0]; if (!raw) continue;
        const { headers, parts } = parseMessage(raw); const from = decodeWords(headers.from || ''); const fm = /<([^>]+)>/.exec(from); const email = String(fm ? fm[1] : from).trim().toLowerCase();
        if (email === addr) {
          const text = parts.filter((p) => p.type === 'text/plain' && !p.name).map((p) => p.content.toString('utf8')).join('\n') || parts.filter((p) => p.type === 'text/html' && !p.name).map((p) => p.content.toString('utf8').replace(/<[^>]+>/g, ' ')).join('\n');
          if (client.accounts) await clientOnce(headers, () => require('./flow').accountsMail(decodeWords(headers.subject || ''), text, parts.filter((p) => p.name).map((p) => ({ name: p.name, buf: p.content })), email)); else await clientOnce(headers, () => require('./flow').clientMail(client, decodeWords(headers.subject || ''), text, parts.filter((p) => p.name).map((p) => ({ name: p.name, buf: p.content })), email)); got++;
        }
        D.run('INSERT OR IGNORE INTO mail_seen (uid,at) VALUES (?,?)', `reply:${uid}`, D.now());
      }
    }
  } finally { box.end(); }
  D.setHealth('last_reply_check', `${D.now()} · ${map.size} client addresses · ${got} new`);
}
// Reads every email in the label not handled before (50 a run) and makes candidates; read/unread is left alone.
// One run at a time: a big backlog can outlast the 10-minute timer.
let running = null;
const folders = () => [...new Set([D.ENV.imap.folder, ...((D.settings().mail_extra_folders) || [])].filter(Boolean))];
function check() {
  if (running) return Promise.resolve({ skipped: 'Already checking the mailbox' });
  running = (async () => { let first = null; for (const fo of folders()) { const r = await checkNow(fo).catch((e) => ({ errors: [`${fo}: ${e.message}`] })); first = first || r; } return first; })().finally(() => { running = null; });
  return running;
}
async function checkNow(folderName) {
  const cfg = { ...D.ENV.imap, folder: folderName || D.ENV.imap.folder }; const mainFolder = cfg.folder === D.ENV.imap.folder;
  if (!cfg.host || !cfg.user) return { skipped: 'Email inbox not set in .env' };
  const done = { read: 0, leads: 0, errors: [] };
  const open = async () => { const b = await imapConnect(cfg); await b.cmd(`LOGIN ${q(cfg.user)} ${q(cfg.pass)}`); await b.cmd(`SELECT ${q(cfg.folder)}`); return b; };
  let box = await open();
  try {
    // Every email in the label, read or not (people open them too), each handled once: mail_seen remembers it.
    // IMAP_ONLY_UNREAD=1 goes back to unread emails only.
    const sr = await box.cmd(/^(1|true|yes|on)$/i.test(process.env.IMAP_ONLY_UNREAD || '') ? 'UID SEARCH UNSEEN' : 'UID SEARCH ALL');
    const uids = (sr.lines.find((l) => l.startsWith('* SEARCH')) || '').replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean)
      .filter((u) => !D.get('SELECT 1 FROM mail_seen WHERE uid=?', `${cfg.user}:${cfg.folder}:${u}`)).slice(0, 50);
    const dbg = process.env.MAIL_DEBUG ? (...a) => console.log(new Date().toISOString().slice(11, 19), ...a) : () => {}; dbg(`${uids.length} emails to read`);
    for (const uid of uids) {
      const key = `${cfg.user}:${cfg.folder}:${uid}`;
      try {
        if (!D.get('SELECT 1 FROM mail_seen WHERE uid=?', key)) {
          if (box.dead) box = await open(); // dropped while the last email was being read
          dbg(`fetch ${uid}`); const fr = await box.cmd(`UID FETCH ${uid} BODY.PEEK[]`); dbg(`  got ${fr.literals[0] ? fr.literals[0].length : 0} bytes`);
          const raw = fr.literals[0]; if (!raw) continue;
          const { headers, parts } = parseMessage(raw);
          const from = decodeWords(headers.from || '');
          const fm = /^(.*?)\s*<([^>]+)>/.exec(from);
          const text = parts.filter((p) => p.type === 'text/plain' && !p.name).map((p) => p.content.toString('utf8')).join('\n')
            || parts.filter((p) => p.type === 'text/html' && !p.name).map((p) => p.content.toString('utf8').replace(/<[^>]+>/g, ' ')).join('\n');
          const linked = await withLinked(parts.filter((p) => p.name).map((p) => ({ name: p.name, buf: p.content })), parts.filter((p) => !p.name && /^text\//.test(p.type)).map((p) => p.content.toString('utf8')).join('\n'));
          const attachments = linked.atts;
          const fromEmail = fm ? fm[2] : from; const hasCv = cvFiles(attachments, decodeWords(headers.subject || '')).length > 0;
          const own = ownDomains().includes((String(fromEmail).split('@')[1] || '').toLowerCase());
          const subj = decodeWords(headers.subject || '');
          // The team's own replies in a thread are not candidates; a CV they forward is (read from the CV, not the sender).
          const client = own ? null : require('./flow').clientByEmail(fromEmail); // a client's reply with papers lands on the client
          if (client) { await clientOnce(headers, () => require('./flow').clientMail(client, subj, text, attachments, fromEmail)); done.client = (done.client || 0) + 1; }
          else if (own && !hasCv) done.skipped = (done.skipped || 0) + 1;
          else if (hasCv || require('./llm').available() || /cv|resume|bio.?data|job|appl|position|profile|candidate|opening|vacanc|interview|portfolio|work experience/i.test(subj)) {
            // Several CVs with different phone numbers are different people (an agency sending profiles): one
            // candidate per CV, read from the CV alone. One person's CV + portfolio stays one candidate.
            const cvAtts = cvFiles(attachments, subj).filter((a) => !/portfolio|work.?sample/i.test(a.name));
            const phones = new Set(cvAtts.map((a) => findPhone(cvText({ name: a.name, content: a.buf }))).filter(Boolean));
            const batches = cvAtts.length > 1 && phones.size > 1
              ? cvAtts.map((a) => ({ fromName: '', fromEmail: '', subject: subj, text: '', attachments: [a] }))
              : [{ fromName: own ? '' : (fm ? fm[1].replace(/"/g, '').trim() : ''), fromEmail: own ? '' : fromEmail, subject: subj, text, attachments, folder: cfg.folder }];
            for (const b of batches) {
              const t0 = Date.now(); const r = await intakeEmail(b);
              dbg(`  ${r && r.skipped ? 'skipped' : 'candidate'} in ${Date.now() - t0} ms`, subj.slice(0, 60), batches.length > 1 ? `(${b.attachments[0].name})` : '');
              if (r && !r.skipped) done.leads++; else done.skipped = (done.skipped || 0) + 1;
            }
          } else done.skipped = (done.skipped || 0) + 1;
          D.run('INSERT OR IGNORE INTO mail_seen (uid,at) VALUES (?,?)', key, D.now());
        }
        if (/^(1|true|yes|on)$/i.test(process.env.IMAP_ONLY_UNREAD || '')) { if (box.dead) box = await open(); await box.cmd(`UID STORE ${uid} +FLAGS (\\Seen)`); }
        done.read++;
      } catch (e) { done.errors.push(`${uid}: ${e.message}`); }
    }
  } finally { box.end(); }
  if (mainFolder) { try { await checkReplies(cfg); } catch (e) { done.errors.push(`client replies: ${e.message}`); } }
  D.setHealth(mainFolder ? 'last_mail_check' : `last_mail_check:${cfg.folder}`, `${D.now()} · ${done.read} read · ${done.leads} candidates · ${done.skipped || 0} skipped`);
  if (done.errors.length) require('./alerts').devAlert('Email inbox: some emails could not be read', done.errors.join('; '));
  return done;
}

// Resumes missed earlier: every email in the label is read once more (50 a run; cvfix2 = again, with the matching below) and a CV attachment goes to the
// candidate it belongs to (the sender's address, or the phone or email written in the CV) when they have no resume yet.
let fixing = null;
function refetchCvs(o = {}) { if (fixing) return fixing; if (running && !o.force) return Promise.resolve({ skipped: 'busy' }); fixing = refetchNow(o).finally(() => { fixing = null; }); return fixing; }
async function refetchNow(o = {}) {
  let total = null; for (const fo of folders()) { const r = await refetchFolder(o, fo).catch((e) => ({ errors: [`${fo}: ${e.message}`] })); if (!total) total = r; else if (r && r.saved) total.saved = (total.saved || 0) + r.saved; } return total;
}
async function refetchFolder(o, folderName) {
  const cfg = { ...D.ENV.imap, folder: folderName }; if (!cfg.host || !cfg.user) return { skipped: 'Email inbox not set in .env' };
  if (!D.get("SELECT 1 FROM candidates WHERE source='Email' AND (cv_file IS NULL OR cv_file='') AND merged_into IS NULL AND removed=0")) return { done: 'no email candidate without a resume' };
  const out = { read: 0, saved: 0, errors: [] };
  const box = await imapConnect(cfg); await box.cmd(`LOGIN ${q(cfg.user)} ${q(cfg.pass)}`); await box.cmd(`SELECT ${q(cfg.folder)}`);
  try {
    const sr = await box.cmd('UID SEARCH ALL');
    const uids = (sr.lines.find((l) => l.startsWith('* SEARCH')) || '').replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean)
      .filter((u) => !D.get('SELECT 1 FROM mail_seen WHERE uid=?', `cvfix5:${cfg.user}:${cfg.folder}:${u}`));
    // how far through the mailbox the re-read is, for the Missing resumes window
    const totalN = (sr.lines.find((l) => l.startsWith('* SEARCH')) || '').replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean).length;
    D.setHealth('cv_refetch_progress', JSON.stringify({ total: totalN, left: Math.max(0, uids.length - (o.batch || 150)), at: D.now() }));
    uids.splice(o.batch || 150);
    const own = ownDomains();
    for (const uid of uids) {
      try {
        const fr = await box.cmd(`UID FETCH ${uid} BODY.PEEK[]`); const raw = fr.literals[0];
        if (raw) {
          const { headers, parts } = parseMessage(raw); out.read++;
          const from = decodeWords(headers.from || ''); const fm = /<([^>]+)>/.exec(from); const fromEmail = (fm ? fm[1] : from).trim().toLowerCase();
          const fromOwn = own.includes((fromEmail.split('@')[1] || ''));
          const lk = await withLinked(parts.filter((x) => x.name), parts.filter((x) => !x.name && /^text\//.test(x.type)).map((x) => x.content.toString('utf8')).join('\n'));
          const cvParts = cvFiles(lk.atts.map((x) => ({ ...x, content: x.content || x.buf })), decodeWords(headers.subject || '')).filter((x) => !/portfolio|work.?sample/i.test(x.name));
          // The candidates this very email made (their "Email: <subject>" note), still without a resume.
          const subj = decodeWords(headers.subject || '');
          const fromThis = subj ? D.all("SELECT DISTINCT c.* FROM candidates c JOIN notes n ON n.record_id=c.id WHERE n.text LIKE ? ESCAPE '\\' AND n.author='Email inbox' AND c.merged_into IS NULL AND c.removed=0 AND (c.cv_file IS NULL OR c.cv_file='')", `Email: ${subj.replace(/[\\%_]/g, (x) => `\\${x}`)}%`) : [];
          // a resume sent as a link: kept on the candidates this email made
          if (!cvParts.length && fromThis.length) { const link = cvLinkIn(parts.filter((x) => !x.name && /^text\//.test(x.type)).map((x) => x.content.toString('utf8')).join('\n')); if (link) for (const c of fromThis) if (!c.cv_link) { D.update('candidates', c.id, { cv_link: link }); D.insert('notes', { record_id: c.id, text: `Resume sent as a link (open it to see the resume): ${link}`, author: 'Email inbox', at: D.now() }); out.linked = (out.linked || 0) + 1; } }
          for (const p of cvParts) {
            const t = cvText({ name: p.name, content: p.content }); const ph = findPhone(t); const em = findEmail(t).toLowerCase();
            // the name written in the file name or the CV ("Resume_Mamta Vichare.pdf"): every part of it, 3+ letters
            const hay = `${p.name} ${t.slice(0, 3000)}`.toLowerCase().replace(/[^a-z]+/g, ' ');
            const named = (c) => { const ws = String(c.name || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3); return ws.length >= 2 && (ws.every((w) => ` ${hay} `.includes(` ${w} `)) || hay.replace(/ /g, '').includes(ws.join(''))); }; // "MandarRane-Resume.pdf" too
            const c = (!fromOwn && fromEmail ? D.get("SELECT * FROM candidates WHERE lower(email)=? AND merged_into IS NULL AND removed=0 AND (cv_file IS NULL OR cv_file='')", fromEmail) : null)
              || (ph ? D.get("SELECT * FROM candidates WHERE whatsapp=? AND merged_into IS NULL AND removed=0 AND (cv_file IS NULL OR cv_file='')", ph) : null)
              || (em ? D.get("SELECT * FROM candidates WHERE lower(email)=? AND merged_into IS NULL AND removed=0 AND (cv_file IS NULL OR cv_file='')", em) : null)
              || (cvParts.length === 1 && fromThis.length === 1 ? fromThis[0] : fromThis.find(named))
              || D.all("SELECT * FROM candidates WHERE source='Email' AND merged_into IS NULL AND removed=0 AND (cv_file IS NULL OR cv_file='')").find(named);
            if (!c || D.get("SELECT 1 FROM candidates WHERE id=? AND cv_file IS NOT NULL AND cv_file!=''", c.id)) continue; // none, or given one a moment ago
            try {
              const f = await F.saveFile({ recordId: c.id, type: 'cv', name: p.name, base64: p.content.toString('base64'), by: 'Email inbox' });
              D.update('candidates', c.id, { cv_file: String(f.id) }); require('./cvparse').fillCandidate(c.id, p.name, p.content, 'Email inbox');
              D.insert('notes', { record_id: c.id, text: `Resume ${p.name} added from their email (it was missed when the email was first read).`, author: 'Email inbox', at: D.now() }); out.saved++;
            } catch (e) { out.errors.push(`${uid} ${p.name}: ${e.message}`); }
          }
        }
        D.run('INSERT OR IGNORE INTO mail_seen (uid,at) VALUES (?,?)', `cvfix5:${cfg.user}:${cfg.folder}:${uid}`, D.now());
      } catch (e) { out.errors.push(`${uid}: ${e.message}`); }
    }
  } finally { box.end(); }
  D.setHealth('last_cv_refetch', `${D.now()} · ${out.read} read · ${out.saved} resumes added`);
  if (out.errors.length) D.setHealth('cv_refetch_errors', JSON.stringify(out.errors.slice(-15)));
  return out;
}

// One candidate's resume, looked for in the mailbox: their emails by address, phone number and name (the label, then
// All Mail on Gmail). The first resume file that is theirs is attached; the report says what each email had, so a
// resume that came only as a link (Naukri, Drive) or a file that cannot be saved is plain to see.
async function findFor(candId) {
  const cfg = D.ENV.imap; if (!cfg.host || !cfg.user) throw D.httpError(400, 'The email inbox is not set up on the server.');
  const c = D.get('SELECT * FROM candidates WHERE id=?', candId); if (!c) throw D.httpError(404, 'Candidate not found');
  const phone = String(c.whatsapp || '').replace(/\D/g, '').slice(-10); const nameWs = String(c.name || '').split(/\s+/).filter((w) => w.length >= 3);
  const terms = [c.email && `FROM ${q(c.email)}`, c.email && `TEXT ${q(c.email)}`, phone.length === 10 && `TEXT ${q(phone)}`, nameWs.length >= 2 && `TEXT ${q(nameWs.slice(0, 2).join(' '))}`, nameWs.length >= 2 && `SUBJECT ${q(nameWs[0])}`].filter(Boolean);
  const out = { searched: terms, folders: [], emails: [], saved: null };
  const box = await imapConnect(cfg); await box.cmd(`LOGIN ${q(cfg.user)} ${q(cfg.pass)}`);
  const hay = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const theirs = (p, text) => { const h = ` ${hay(`${p.name} ${text}`)} `; return (phone && h.replace(/ /g, '').includes(phone)) || (c.email && h.includes(hay(c.email))) || (nameWs.length >= 2 && nameWs.every((w) => h.includes(` ${w.toLowerCase()} `))); };
  try {
    for (const folder of [...folders(), /gmail/i.test(cfg.host) ? '[Gmail]/All Mail' : null].filter(Boolean)) {
      try { await box.cmd(`SELECT ${q(folder)}`); } catch { continue; }
      out.folders.push(folder); const uids = new Set();
      for (const t of terms) { try { const sr = await box.cmd(`UID SEARCH ${t}`); (sr.lines.find((l) => l.startsWith('* SEARCH')) || '').replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean).forEach((u) => uids.add(u)); } catch { /* a term the server does not take */ } }
      for (const uid of [...uids].sort((a, b) => Number(b) - Number(a)).slice(0, 12)) {
        const fr = await box.cmd(`UID FETCH ${uid} BODY.PEEK[]`); const raw = fr.literals[0]; if (!raw) continue;
        const { headers, parts } = parseMessage(raw); const subj = decodeWords(headers.subject || '');
        const files = parts.filter((p) => p.name);
        const text = parts.filter((p) => !p.name && /^text\//.test(p.type)).map((p) => p.content.toString('utf8')).join('\n');
        const lk = await withLinked(files, text); const cvs = cvFiles(lk.atts.map((x) => ({ ...x, content: x.content || x.buf })), subj);
        const links = [...new Set((text.match(/https?:\/\/[^\s"'<>]+/g) || []).filter((u) => /drive\.google|docs\.google|naukri|indeed|linkedin|dropbox|onedrive|cv|resume/i.test(u)))].slice(0, 4);
        const row = { folder, date: headers.date || '', from: decodeWords(headers.from || ''), subject: subj, files: files.map((p) => `${p.name} (${Math.round(p.content.length / 1024)} KB)`), links, result: '' };
        if (!out.saved && cvs.length) {
          const pick = cvs.find((p) => theirs(p, cvText({ name: p.name, content: p.content }))) || (cvs.length === 1 ? cvs[0] : null);
          if (pick) {
            try {
              const f = await F.saveFile({ recordId: c.id, type: 'cv', name: pick.name, base64: pick.content.toString('base64'), by: 'Email inbox' });
              D.update('candidates', c.id, { cv_file: String(f.id), last_updated: D.now() }); require('./cvparse').fillCandidate(c.id, pick.name, pick.content, 'Email inbox');
              D.insert('notes', { record_id: c.id, text: `Resume ${pick.name} found in their email (${subj || 'no subject'}) and attached.`, author: 'Email inbox', at: D.now() });
              out.saved = pick.name; row.result = `Attached ${pick.name}`;
            } catch (e) { row.result = `${pick.name} could not be saved: ${e.message}`; }
          } else row.result = 'Resume files here, but none names this candidate';
        } else if (!cvs.length) row.result = lk.notes.length ? lk.notes.join('; ') : links.length ? 'No resume file: only a link (not a Google Drive or Docs link)' : files.length ? 'Files, but none looks like a resume' : 'No attachment';
        out.emails.push(row);
      }
      if (out.saved) break;
    }
  } finally { box.end(); }
  return out;
}

// One-time: where an ID paper (Aadhaar, PAN …) took the place of a resume, the resume comes back; a paper that is
// someone's only "resume" becomes a document and they show as having no resume.
function fixPaperCvs() {
  let back = 0; let cleared = 0;
  for (const c of D.all("SELECT c.id, c.cv_file, f.name FROM candidates c JOIN files f ON CAST(f.id AS TEXT)=c.cv_file WHERE c.cv_file IS NOT NULL AND c.cv_file != ''")) {
    if (!PAPERS.test(c.name || '')) continue;
    const prev = D.all("SELECT * FROM files WHERE record_id=? AND type='cv' AND id != ? ORDER BY id DESC", c.id, Number(c.cv_file)).find((x) => !PAPERS.test(x.name || ''));
    D.run("UPDATE files SET type='file', replaced=0 WHERE id=?", Number(c.cv_file));
    if (prev) { D.run('UPDATE files SET replaced=0 WHERE id=?', prev.id); D.update('candidates', c.id, { cv_file: String(prev.id) }); D.insert('notes', { record_id: c.id, text: `Resume ${prev.name} is the resume again (${c.name} is an ID paper, kept as a document).`, author: 'System', at: D.now() }); back++; }
    else { D.update('candidates', c.id, { cv_file: null }); D.insert('notes', { record_id: c.id, text: `${c.name} is an ID paper, not a resume: kept as a document. No resume on file yet.`, author: 'System', at: D.now() }); cleared++; }
  }
  return { back, cleared };
}
try {
  const once = D.settings().done_once || [];
  if (!once.includes('cv_papers_fix')) { const r = fixPaperCvs(); D.setSetting('done_once', [...once, 'cv_papers_fix']); if (r.back || r.cleared) D.history('System', 'resumes put back', null, null, null, `${r.back} resumes back, ${r.cleared} papers were not resumes`); }
} catch (e) { console.error('Resume repair', e.message); }

module.exports = { fixPaperCvs, findFor, check, refetchCvs, intakeEmail, parseMessage, cvText, findPhone, findName };
