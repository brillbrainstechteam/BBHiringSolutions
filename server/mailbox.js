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
const param = (header, name) => { const m = new RegExp(`${name}\\*?=\\s*"?([^";]+)"?`, 'i').exec(header || ''); return m ? decodeWords(m[1].replace(/^utf-8''/i, '')).replace(/%([0-9A-F]{2})/gi, (x, hh) => String.fromCharCode(parseInt(hh, 16))) : ''; };
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
    if (type.startsWith('multipart/') && depth < 6) {
      const boundary = param(ct, 'boundary'); if (!boundary) return h;
      const pieces = body.toString('latin1').split(`--${boundary}`).slice(1);
      for (const p of pieces) { if (p.startsWith('--')) break; walk(Buffer.from(p.replace(/^\r?\n/, ''), 'latin1'), depth + 1); }
      return h;
    }
    const name = param(h['content-disposition'], 'filename') || param(ct, 'name');
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
async function intakeEmail({ fromName, fromEmail, subject, text, attachments }) {
  const L = require('./logic');
  const cvs = (attachments || []).filter((a) => isCv(a.name));
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
  let first = true;
  for (const a of cvs) {
    try {
      const f = await F.saveFile({ recordId: id, type: first ? 'cv' : 'file', name: a.name, base64: a.buf.toString('base64'), by: 'Email inbox' });
      if (first) { D.update('candidates', id, { cv_file: String(f.id) }); require('./cvparse').fillCandidate(id, a.name, a.buf, 'Email inbox'); }
      first = false;
    } catch (e) { D.insert('notes', { record_id: id, text: `Attachment ${a.name} not saved: ${e.message}`, author: 'Email inbox', at: D.now() }); }
  }
  // An application too, but only when the email clearly names the job: a portal job ID (JB-2031) anywhere in the
  // subject or text, or else a role in the subject ("Application for CAD Designer") that matches open jobs.
  const applied = [];
  const idHit = /(?:^|[^A-Za-z0-9])JB[-\s_]?(\d{3,})(?!\d)/i.exec(`${subject || ''}\n${text || ''}\n${(ai && ai.job_id_mentioned) || ''}`);
  const role = (ai && ai.role_applied_for) || String(subject || '').replace(/\b(application|applying|apply|resume|cv|for|the|post|of|job|re|fw|fwd)\b/gi, ' ');
  let targets = idHit ? [D.get('SELECT * FROM jobs WHERE id=?', `JB-${idHit[1]}`)].filter(Boolean) : L.jobsForRole(role);
  if (!idHit && L.roleTokens(role).length < 2 && targets.length > 1) targets = []; // one vague word ("Sales") is not clear enough
  for (const j of targets) { try { applied.push(L.createApplication(id, j.id, { label: 'Email inbox' }, 'Email', `From the email "${String(subject || '').slice(0, 80)}"`).id); } catch { /* closed job, or already on it */ } }
  if (r.isNew) require('./mailer').newLead('candidate', D.get('SELECT * FROM candidates WHERE id=?', id));
  return { id, isNew: r.isNew, applications: applied, found: { name: !!name, phone: !!phone, email: !!email, city, job } };
}

// Reads every email in the label not handled before (50 a run) and makes candidates; read/unread is left alone.
// One run at a time: a big backlog can outlast the 10-minute timer.
let running = null;
function check() {
  if (running) return Promise.resolve({ skipped: 'Already checking the mailbox' });
  running = checkNow().finally(() => { running = null; });
  return running;
}
async function checkNow() {
  const cfg = D.ENV.imap;
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
          const attachments = parts.filter((p) => p.name).map((p) => ({ name: p.name, buf: p.content }));
          const fromEmail = fm ? fm[2] : from; const hasCv = attachments.some((a) => isCv(a.name));
          const own = ownDomains().includes((String(fromEmail).split('@')[1] || '').toLowerCase());
          const subj = decodeWords(headers.subject || '');
          // The team's own replies in a thread are not candidates; a CV they forward is (read from the CV, not the sender).
          if (own && !hasCv) done.skipped = (done.skipped || 0) + 1;
          else if (hasCv || require('./llm').available() || /cv|resume|bio.?data|job|appl|position|profile|candidate|opening|vacanc|interview|portfolio|work experience/i.test(subj)) {
            // Several CVs with different phone numbers are different people (an agency sending profiles): one
            // candidate per CV, read from the CV alone. One person's CV + portfolio stays one candidate.
            const cvAtts = attachments.filter((a) => isCv(a.name) && !/portfolio|work.?sample/i.test(a.name));
            const phones = new Set(cvAtts.map((a) => findPhone(cvText({ name: a.name, content: a.buf }))).filter(Boolean));
            const batches = cvAtts.length > 1 && phones.size > 1
              ? cvAtts.map((a) => ({ fromName: '', fromEmail: '', subject: subj, text: '', attachments: [a] }))
              : [{ fromName: own ? '' : (fm ? fm[1].replace(/"/g, '').trim() : ''), fromEmail: own ? '' : fromEmail, subject: subj, text, attachments }];
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
  D.setHealth('last_mail_check', `${D.now()} · ${done.read} read · ${done.leads} candidates · ${done.skipped || 0} skipped`);
  if (done.errors.length) require('./alerts').devAlert('Email inbox: some emails could not be read', done.errors.join('; '));
  return done;
}

module.exports = { check, intakeEmail, parseMessage, cvText, findPhone, findName };
