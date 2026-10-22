// Email inbox door (11.1): every unread email with a CV in the jobs@ mailbox becomes a candidate lead.
// Name, phone and email are read from the email and the CV where possible; anything not found is marked "Needs checking".
// Mailbox settings come from .env (IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS, IMAP_FOLDER). No outside packages.
const tls = require('tls');
const zlib = require('zlib');
const D = require('./db');
const F = require('./files');

// ---------- a small IMAP client (LOGIN, SELECT, UID SEARCH/FETCH/STORE) ----------
function imapConnect({ host, port }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host });
    let buf = Buffer.alloc(0); let tagN = 0; let pending = null; let greeted = false;
    sock.setTimeout(60000, () => { sock.destroy(new Error('Mailbox timed out')); });
    const fail = (e) => { if (pending) { pending.reject(e); pending = null; } else reject(e); };
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
      cmd(text) {
        return new Promise((res, rej) => {
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
function textOfPdf(buf) {
  const s = buf.toString('latin1'); const out = [];
  const re = /stream\r?\n/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length; const end = s.indexOf('endstream', start); if (end < 0) break;
    let data = Buffer.from(s.slice(start, end), 'latin1');
    try { data = zlib.inflateSync(data); } catch { /* not compressed */ }
    const t = data.toString('latin1');
    for (const x of t.matchAll(/\[(.*?)\]\s*TJ|\((.*?)(?<!\\)\)\s*Tj/gs)) {
      const piece = x[1] !== undefined ? [...x[1].matchAll(/\((.*?)(?<!\\)\)/g)].map((y) => y[1]).join('') : x[2];
      out.push(piece.replace(/\\([()\\])/g, '$1'));
    }
    out.push('\n');
  }
  return out.join('\n').replace(/[^\x20-\x7E\n]/g, ' ');
}
function textOfDocx(buf) {
  try { const z = F.unzip(buf); const xml = (z['word/document.xml'] || Buffer.alloc(0)).toString('utf8'); return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'); } catch { return ''; }
}
function cvText(att) {
  const n = String(att.name || '').toLowerCase();
  if (n.endsWith('.pdf')) return textOfPdf(att.content);
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

// One email → one candidate lead (or an update to the same number).
async function intakeEmail({ fromName, fromEmail, subject, text, attachments }) {
  const L = require('./logic');
  const cvs = (attachments || []).filter((a) => /\.(pdf|docx?|jpe?g|png)$/i.test(a.name || ''));
  const cvTextAll = cvs.map((a) => cvText({ name: a.name, content: a.buf })).join('\n');
  const all = `${subject || ''}\n${text || ''}\n${cvTextAll}`;
  const s = D.settings();
  const phone = findPhone(all);
  const email = fromEmail || findEmail(all);
  const senderName = fromName && !/@/.test(fromName) && /\S+\s+\S+/.test(fromName.trim()) ? fromName.trim() : '';
  const name = senderName || findName(cvTextAll) || '';
  const city = s.cities.map((c) => c.name).find((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(all)) || '';
  const job = L.jobList().map((j) => j.title).sort((a, b) => b.length - a.length).find((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${subject}\n${text}\n${cvTextAll}`)) || '';
  const missing = [!name && 'name', !phone && 'phone'].filter(Boolean);
  const r = L.intakeCandidate({ name: name || (email ? email.split('@')[0] : 'Email candidate'), whatsapp: phone, email, city, work_cities: city ? [city] : [], job_wanted: job },
    { source: 'Email', allowNoPhone: true, consent: false, needsCheck: missing.length ? `Not found in email or CV: ${missing.join(', ')}` : null });
  const id = r.candidate.id;
  D.insert('notes', { record_id: id, text: `Email: ${subject || '(no subject)'}${text ? ' — ' + String(text).trim().slice(0, 300) : ''}`, author: 'Email inbox', at: D.now() });
  let first = true;
  for (const a of cvs) {
    try {
      const f = await F.saveFile({ recordId: id, type: first ? 'cv' : 'file', name: a.name, base64: a.buf.toString('base64'), by: 'Email inbox' });
      if (first) D.update('candidates', id, { cv_file: String(f.id) });
      first = false;
    } catch (e) { D.insert('notes', { record_id: id, text: `Attachment ${a.name} not saved: ${e.message}`, author: 'Email inbox', at: D.now() }); }
  }
  if (r.isNew) require('./mailer').newLead('candidate', D.get('SELECT * FROM candidates WHERE id=?', id));
  return { id, isNew: r.isNew, found: { name: !!name, phone: !!phone, email: !!email, city, job } };
}

// Reads unread emails (up to 25 a run), makes leads, marks them read.
async function check() {
  const cfg = D.ENV.imap;
  if (!cfg.host || !cfg.user) return { skipped: 'Email inbox not set in .env' };
  const done = { read: 0, leads: 0, errors: [] };
  const box = await imapConnect(cfg);
  try {
    await box.cmd(`LOGIN ${q(cfg.user)} ${q(cfg.pass)}`);
    await box.cmd(`SELECT ${q(cfg.folder)}`);
    const sr = await box.cmd('UID SEARCH UNSEEN');
    const uids = (sr.lines.find((l) => l.startsWith('* SEARCH')) || '').replace('* SEARCH', '').trim().split(/\s+/).filter(Boolean).slice(0, 25);
    for (const uid of uids) {
      const key = `${cfg.user}:${cfg.folder}:${uid}`;
      try {
        if (!D.get('SELECT 1 FROM mail_seen WHERE uid=?', key)) {
          const fr = await box.cmd(`UID FETCH ${uid} BODY.PEEK[]`);
          const raw = fr.literals[0]; if (!raw) continue;
          const { headers, parts } = parseMessage(raw);
          const from = decodeWords(headers.from || '');
          const fm = /^(.*?)\s*<([^>]+)>/.exec(from);
          const text = parts.filter((p) => p.type === 'text/plain' && !p.name).map((p) => p.content.toString('utf8')).join('\n')
            || parts.filter((p) => p.type === 'text/html' && !p.name).map((p) => p.content.toString('utf8').replace(/<[^>]+>/g, ' ')).join('\n');
          const attachments = parts.filter((p) => p.name).map((p) => ({ name: p.name, buf: p.content }));
          if (attachments.some((a) => /\.(pdf|docx?|jpe?g|png)$/i.test(a.name)) || /cv|resume|bio.?data|job|apply/i.test(headers.subject || '')) {
            await intakeEmail({ fromName: fm ? fm[1].replace(/"/g, '').trim() : '', fromEmail: fm ? fm[2] : from, subject: decodeWords(headers.subject || ''), text, attachments });
            done.leads++;
          }
          D.run('INSERT OR IGNORE INTO mail_seen (uid,at) VALUES (?,?)', key, D.now());
        }
        await box.cmd(`UID STORE ${uid} +FLAGS (\\Seen)`);
        done.read++;
      } catch (e) { done.errors.push(`${uid}: ${e.message}`); }
    }
  } finally { box.end(); }
  D.setHealth('last_mail_check', `${D.now()} · ${done.read} read · ${done.leads} leads`);
  if (done.errors.length) require('./alerts').devAlert('Email inbox: some emails could not be read', done.errors.join('; '));
  return done;
}

module.exports = { check, intakeEmail, parseMessage, cvText, findPhone, findName };
