// Reads a CV (PDF, Word .docx or text) and picks out profile details: name, phone, email, city,
// job, experience, salaries, notice period, skills and current company.
// PDF text is read through each font's ToUnicode map, which is how Word, Chrome/Google Docs,
// Canva and most CV builders store it. Scanned (photo) CVs have no text, so nothing is found there.
const zlib = require('zlib');

// ---------- PDF ----------
function inflate(buf) {
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync, zlib.unzipSync]) { try { return fn(buf); } catch { /* next */ } }
  return Buffer.alloc(0);
}
// The value of /Key in a dictionary string: a reference, a nested << >>, an [ array ], a name or a number.
function dictVal(dict, key) {
  const m = new RegExp(`/${key}(?![\\w#])\\s*`).exec(dict); if (!m) return null;
  let i = m.index + m[0].length; const rest = dict.slice(i);
  const ref = /^(\d+)\s+\d+\s+R/.exec(rest); if (ref) return { ref: Number(ref[1]) };
  const open = rest.startsWith('<<') ? '<<' : rest.startsWith('[') ? '[' : null;
  if (open) {
    const close = open === '<<' ? '>>' : ']'; let depth = 0;
    for (let j = 0; j < rest.length; j++) {
      if (rest.startsWith(open, j)) { depth++; j += open.length - 1; } else if (rest.startsWith(close, j)) { depth--; j += close.length - 1; if (!depth) return { raw: rest.slice(0, j + 1) }; }
    }
    return { raw: rest };
  }
  return { raw: (/^[^\s/<>[\]]+|^\/[^\s/<>[\]]+/.exec(rest) || [''])[0] };
}
function readPdfObjects(buf) {
  const s = buf.toString('latin1'); const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    let end = s.indexOf('endobj', start); if (end < 0) break;
    const sm = /stream\r?\n/.exec(s.slice(start, end));
    let dict = s.slice(start, end); let stream = null;
    if (sm) {
      dict = s.slice(start, start + sm.index);
      const ds = start + sm.index + sm[0].length;
      const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let de = len ? ds + Number(len[1]) : s.indexOf('endstream', ds);
      if (de < ds || de > s.length) de = s.indexOf('endstream', ds);
      stream = buf.slice(ds, de);
      end = s.indexOf('endobj', de); if (end < 0) end = s.length;
    }
    objs.set(Number(m[1]), { dict, stream });
    re.lastIndex = end;
  }
  // Objects packed inside object streams (most PDFs since 2010).
  for (const o of [...objs.values()]) {
    if (!o.stream || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const data = inflate(o.stream).toString('latin1');
    const n = Number((dictVal(o.dict, 'N') || {}).raw); const first = Number((dictVal(o.dict, 'First') || {}).raw);
    const nums = data.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) {
      const num = nums[k * 2]; const off = first + nums[k * 2 + 1]; const next = k + 1 < n ? first + nums[k * 2 + 3] : data.length;
      if (!objs.has(num)) objs.set(num, { dict: data.slice(off, next), stream: null });
    }
  }
  return objs;
}
function streamData(o) {
  if (!o || !o.stream) return Buffer.alloc(0);
  return /FlateDecode/.test(o.dict) ? inflate(o.stream) : o.stream;
}
// ToUnicode map → { bytes per code, code (hex) → text }.
function parseCMap(text) {
  const map = new Map(); const hex = (h) => Buffer.from(h.length % 4 ? h.padStart(h.length + (4 - (h.length % 4)), '0') : h, 'hex').swap16().toString('utf16le');
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(text);
  const bytes = cs ? cs[1].length / 2 : 2;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const p of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(p[1].toLowerCase().padStart(bytes * 2, '0'), hex(p[2]));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(p[1], 16); const hi = parseInt(p[2], 16); if (hi - lo > 5000) continue;
      if (p[3].startsWith('[')) { const list = [...p[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]); for (let c = lo; c <= hi; c++) if (list[c - lo] !== undefined) map.set(c.toString(16).padStart(bytes * 2, '0'), hex(list[c - lo])); continue; }
      const dst = p[3].slice(1, -1); const base = parseInt(dst.slice(-4) || '0', 16); const pre = dst.slice(0, -4);
      for (let c = lo; c <= hi; c++) map.set(c.toString(16).padStart(bytes * 2, '0'), hex(pre + (base + c - lo).toString(16).padStart(4, '0')));
    }
  }
  return { bytes, map };
}
// Splits a content stream into operands and operators.
function* tokens(s) {
  let i = 0; const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      let depth = 1; let j = i + 1; let out = '';
      while (j < n && depth) {
        const ch = s[j];
        if (ch === '\\') {
          const nx = s[j + 1];
          if (/[0-7]/.test(nx)) { const oct = /^[0-7]{1,3}/.exec(s.slice(j + 1))[0]; out += String.fromCharCode(parseInt(oct, 8)); j += 1 + oct.length; continue; }
          out += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[nx] ?? (nx === '\r' || nx === '\n' ? '' : nx); j += 2; continue;
        }
        if (ch === '(') depth++; else if (ch === ')') { depth--; if (!depth) break; }
        out += ch; j++;
      }
      yield { t: 'str', v: Buffer.from(out, 'latin1') }; i = j + 1; continue;
    }
    if (c === '<' && s[i + 1] === '<') { yield { t: 'op', v: '<<' }; i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { yield { t: 'op', v: '>>' }; i += 2; continue; }
    if (c === '<') { const j = s.indexOf('>', i); const h = s.slice(i + 1, j).replace(/\s/g, ''); yield { t: 'str', v: Buffer.from(h.length % 2 ? h + '0' : h, 'hex') }; i = j + 1; continue; }
    if (c === '[' || c === ']') { yield { t: c }; i++; continue; }
    if (c === '/') { const m = /^\/[^\s/<>[\]()%{}]*/.exec(s.slice(i, i + 200)); yield { t: 'name', v: m[0].slice(1) }; i += m[0].length; continue; }
    const m = /^[^\s/<>[\]()%{}]+/.exec(s.slice(i, i + 200)); if (!m) { i++; continue; }
    const w = m[0]; i += w.length;
    yield /^[+-]?(\d+\.?\d*|\.\d+)$/.test(w) ? { t: 'num', v: Number(w) } : { t: 'op', v: w };
  }
}
function decodeStr(buf, font) {
  if (!font) return buf.toString('latin1');
  let out = ''; const b = font.bytes;
  for (let i = 0; i + b <= buf.length; i += b) { const code = buf.slice(i, i + b).toString('hex'); out += font.map.has(code) ? font.map.get(code) : (b === 1 ? String.fromCharCode(buf[i]) : ''); }
  return out;
}
function pageText(content, fonts) {
  let out = ''; let font = null; let size = 10; let ops = []; let arr = null; let lastY = null;
  const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const sp = () => { if (out && !/[\s]$/.test(out)) out += ' '; };
  for (const tk of tokens(content)) {
    if (tk.t === '[') { arr = []; continue; }
    if (tk.t === ']') { ops.push({ t: 'arr', v: arr || [] }); arr = null; continue; }
    if (arr) { arr.push(tk); continue; }
    if (tk.t !== 'op') { ops.push(tk); continue; }
    const op = tk.v;
    if (op === 'Tf') { const nm = ops.find((x) => x.t === 'name'); font = nm ? fonts[nm.v] || null : null; const sz = ops.filter((x) => x.t === 'num').pop(); if (sz && sz.v > 0) size = sz.v; }
    else if (op === 'Tj' || op === "'" || op === '"') { if (op !== 'Tj') nl(); const st = ops.filter((x) => x.t === 'str').pop(); if (st) out += decodeStr(st.v, font); }
    else if (op === 'TJ') { const a = ops.find((x) => x.t === 'arr'); for (const x of (a ? a.v : [])) { if (x.t === 'str') out += decodeStr(x.v, font); else if (x.t === 'num' && x.v < -180) sp(); } }
    else if (op === 'Td' || op === 'TD') { const ty = ops.length >= 2 ? ops[ops.length - 1].v : 0; const tx = ops.length >= 2 ? ops[ops.length - 2].v : 0; if (Math.abs(ty) > 0.5) nl(); else if (tx > size * 1.2) sp(); } // a step wider than a letter is a gap between words
    else if (op === 'Tm') { const y = ops.length >= 6 ? ops[ops.length - 1].v : null; if (y !== null) { if (lastY !== null && Math.abs(y - lastY) > 1) nl(); else sp(); lastY = y; } }
    else if (op === 'T*') nl();
    else if (op === 'ET') sp();
    ops = [];
  }
  return out;
}
function textOfPdf(buf) {
  const objs = readPdfObjects(buf);
  const deref = (v) => (v && v.ref !== undefined ? (objs.get(v.ref) || {}).dict || '' : v ? v.raw : '');
  const cmaps = new Map(); // font object number → parsed ToUnicode
  const fontsOf = (resDict) => {
    const out = {}; const fd = deref(dictVal(resDict, 'Font')); if (!fd) return out;
    for (const m of fd.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) {
      const num = Number(m[2]);
      if (!cmaps.has(num)) {
        const f = objs.get(num); const tu = f && dictVal(f.dict, 'ToUnicode');
        cmaps.set(num, tu && tu.ref !== undefined ? parseCMap(streamData(objs.get(tu.ref)).toString('latin1')) : null);
      }
      out[m[1]] = cmaps.get(num);
    }
    return out;
  };
  const pages = [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page(?![s\w])/.test(o.dict)).sort((a, b) => a[0] - b[0]);
  const parts = [];
  for (const [, p] of pages) {
    let res = dictVal(p.dict, 'Resources'); let node = p.dict;
    for (let k = 0; !res && k < 10; k++) { const par = dictVal(node, 'Parent'); if (!par || par.ref === undefined) break; node = deref(par); res = dictVal(node, 'Resources'); }
    const fonts = fontsOf(deref(res));
    const c = dictVal(p.dict, 'Contents'); if (!c) continue;
    const refs = c.ref !== undefined ? [c.ref] : [...String(c.raw).matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));
    const content = refs.map((r) => streamData(objs.get(r)).toString('latin1')).join('\n');
    parts.push(pageText(content, fonts));
  }
  return parts.join('\n');
}

// ---------- Word and plain text ----------
function textOfDocx(buf) {
  try {
    const z = require('./files').unzip(buf); const xml = (z['word/document.xml'] || Buffer.alloc(0)).toString('utf8');
    return xml.replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  } catch { return ''; }
}
function cvText(name, buf) {
  const n = String(name || '').toLowerCase(); let t = '';
  try {
    if (n.endsWith('.pdf') || buf.slice(0, 5).toString() === '%PDF-') t = textOfPdf(buf);
    else if (n.endsWith('.docx')) t = textOfDocx(buf);
    else if (n.endsWith('.txt')) t = buf.toString('utf8');
  } catch { t = ''; }
  return t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f­�]/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- details out of the text ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (t) => new RegExp(`(^|[^A-Za-z])${esc(t)}(?![A-Za-z])`, 'i');
function findPhone(text) {
  for (const m of String(text).matchAll(/(?:\+?91[\s-]*|0)?([6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}|[6-9]\d{4}[\s-]?\d{5})(?!\d)/g)) { const d = m[1].replace(/\D/g, ''); if (d.length === 10) return d; }
  return '';
}
const findEmail = (text) => (/[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(String(text)) || [''])[0].replace(/\.$/, '');
function findName(text) {
  const lab = /(?:^|\n)\s*(?:full\s+)?name\s*[:\-–]\s*([A-Za-z][A-Za-z .]{2,40})/i.exec(text);
  if (lab) return titleCase(lab[1].trim());
  for (const line of String(text).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12)) {
    if (/^(curriculum|resume|cv|bio[- ]?data|profile|summary|objective|contact)\b/i.test(line) || /@|\d{4}/.test(line)) continue;
    if (/^[A-Za-z][A-Za-z.']+(\s+[A-Za-z][A-Za-z.']+){1,3}$/.test(line) && line.length <= 40) return titleCase(line);
  }
  return '';
}
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s.'])([a-z])/g, (m, a, b) => a + b.toUpperCase());
// "₹ 3.6 LPA", "25,000 per month", "4.5 lakh" → yearly rupees.
function money(v) {
  const s = String(v).toLowerCase().replace(/,/g, ''); const num = parseFloat((/\d+(\.\d+)?/.exec(s) || [''])[0]); if (!num) return null;
  if (/lpa|lakh|lac|\bl\b/.test(s)) return Math.round(num * 100000);
  if (/\bk\b|k\s*(per|\/|pm|$)/.test(s)) return Math.round(num * 1000 * (/month|pm|p\.m/.test(s) ? 12 : 12));
  if (/month|pm|p\.m|\/m/.test(s)) return Math.round(num * 12);
  if (num < 100) return Math.round(num * 100000);
  if (num < 200000) return Math.round(num * 12);
  return Math.round(num);
}
const MONEY = '(?:rs\\.?|inr|₹)?\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:lpa|lakhs?|lacs?|l\\b|k\\b|\\/-)?(?:\\s*(?:per\\s+(?:month|annum)|p\\.?\\s?[ma]\\.?|\\/\\s*month|a\\s+month|monthly|annually))?';
function findSalary(text, kind) {
  const label = kind === 'current' ? '(?:current|present|last\\s+drawn)\\s*(?:ctc|salary|package|pay)' : '(?:expected|desired)\\s*(?:ctc|salary|package|pay)';
  const m = new RegExp(`${label}[^\\d₹]{0,15}(${MONEY})`, 'i').exec(text);
  return m ? money(m[1]) : null;
}
function findNotice(text) {
  const m = /notice\s*period[^\d\n]{0,15}(\d+)\s*(day|week|month)/i.exec(text);
  if (m) return Number(m[1]) * (m[2].toLowerCase().startsWith('month') ? 30 : m[2].toLowerCase().startsWith('week') ? 7 : 1);
  if (/notice\s*period[^\n]{0,20}\b(immediate|serving|nil|none)\b/i.test(text) || /immediate(ly)?\s+(joiner|available|joining)/i.test(text)) return 0;
  return null;
}
function findExperience(text) {
  const near = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:and|&)?\s*(\d{1,2})\s*months?)?[^\n]{0,40}?(?:experience|exp\b|in\s+(?:sales|retail|jewel))/i.exec(text)
    || /(?:experience|exp)\b[^\d\n]{0,25}(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:and|&)?\s*(\d{1,2})\s*months?)?/i.exec(text)
    || /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\s+(?:of|in)\b/i.exec(text.slice(0, 2000)); // "10+ years in business building"
  if (near) { const y = Number(near[1]) + (near[2] ? Number(near[2]) / 12 : 0); if (y <= 45) return Math.round(y * 10) / 10; }
  // Otherwise add up job date ranges such as "Jan 2019 – Present" or "2016 - 2020".
  const now = new Date(); const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  let first = null;
  for (const r of text.matchAll(new RegExp(`(?:${mon}\\s*)?((?:19|20)\\d{2})\\s*(?:-|–|—|to|till)\\s*(?:(?:${mon}\\s*)?((?:19|20)\\d{2})|present|current|till\\s*date|now|date)`, 'gi'))) {
    const start = new Date(Number(r[2]), r[1] ? months[r[1].slice(0, 3).toLowerCase()] : 0);
    if (start <= now && (!first || start < first)) first = start;
  }
  if (first) { const y = (now - first) / (365.25 * 864e5); if (y > 0 && y <= 45) return Math.round(y * 10) / 10; }
  return null;
}
const ORG = /\b(pvt|private|ltd|limited|llp|inc|jewell?ers?|jewels|jewell?ery|gold|diamonds?|group|company|industries|bank|stores?|retail|enterprises|exports|traders|corporation|& sons)\b/i;
function findCompany(text) {
  const m = /(?:currently|presently)\s+(?:working|employed)\s+(?:with|at|in)\s+(?:m\/s\.?\s*)?([A-Z][\w&.,' -]{2,60}?)(?:\s+(?:as|since|from)\b|[.,\n(])/i.exec(text)
    || /(?:current\s+(?:company|employer|organi[sz]ation))\s*[:\-–]\s*([^\n]{3,60})/i.exec(text);
  if (m) return m[1].trim();
  // The current job's line ("… – Present"): "Role at Company", "COMPANY | Role", or the company on the next line.
  const lines = String(text).split('\n');
  const i = lines.findIndex((l) => /(?:–|-|—|to)\s*(?:present|till\s*date|current|now)\b/i.test(l));
  if (i < 0) return '';
  const line = lines[i].replace(/\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?(?:19|20)\d{2}\s*(?:–|-|—|to)\s*(?:present|till\s*date|current|now)\b.*$/i, '').trim();
  const at = /\b(?:at|@)\s+([A-Z][\w&.' -]{2,50}?)\s*(?:[|,(]|$)/.exec(line); if (at) return at[1].trim();
  if (line.includes('|')) { const org = line.split('|').map((x) => x.trim()).find((x) => ORG.test(x) || (x.length > 3 && x === x.toUpperCase())); if (org) return titleCase(org); }
  const next = (lines[i + 1] || '').trim();
  if (ORG.test(next) && !/^[•\-–*]/.test(next)) return next.split(',')[0].trim();
  return '';
}
// Other names people write for the cities in the portal's list.
const CITY_ALIASES = { 'Delhi NCR': ['New Delhi', 'Delhi', 'Noida', 'Gurgaon', 'Gurugram', 'Ghaziabad', 'Faridabad'], Bengaluru: ['Bangalore'], Mumbai: ['Bombay', 'Navi Mumbai', 'Thane'], Kolkata: ['Calcutta'], Chennai: ['Madras'], Kochi: ['Cochin'] };
// The city on a "Location:" / "Current location" line first, then near the top, then anywhere.
function findCity(t, cities) {
  const names = cities.map((c) => c.name || c).filter(Boolean);
  const known = (part) => {
    for (const c of [...names].sort((a, b) => b.length - a.length)) if (word(c).test(part)) return c;
    for (const [c, al] of Object.entries(CITY_ALIASES)) if (names.includes(c) && al.some((a) => word(a).test(part))) return c;
    return '';
  };
  const lab = /(?:current\s+)?(?:location|city|address|based\s+in)\s*[:\-–]?\s*([^\n|•]{2,80})/i.exec(t);
  return (lab && known(lab[1])) || known(t.slice(0, 600)) || known(t) || '';
}
// All details found, using the portal's own lists of cities, jobs and skills.
function extract(text, lists = {}) {
  const t = String(text || '');
  const out = {};
  const name = findName(t); if (name) out.name = name;
  const phone = findPhone(t); if (phone) out.whatsapp = phone;
  const email = findEmail(t); if (email) out.email = email;
  const city = findCity(t, lists.cities || []);
  if (city) { out.city = city; const st = (lists.cities || []).find((c) => c.name === city); if (st && st.state) out.state = st.state; }
  const jobs = (lists.jobs || []).filter(Boolean).sort((a, b) => b.length - a.length);
  const job = jobs.find((j) => word(j).test(t.slice(0, 400))) || jobs.find((j) => word(j).test(t)); if (job) out.job_wanted = job; // the headline first
  const exp = findExperience(t); if (exp !== null) out.exp_total = exp;
  const cur = findSalary(t, 'current'); if (cur) out.cur_salary = cur;
  const ex = findSalary(t, 'expected'); if (ex) out.exp_salary = ex;
  const nt = findNotice(t); if (nt !== null) out.notice_days = nt;
  const skills = (lists.skills || []).filter((s) => s && word(s).test(t)); if (skills.length) out.skills = skills.slice(0, 15);
  const co = findCompany(t); if (co) out.current_company = co;
  return out;
}

// The portal's own lists: cities (with the bigger place list), job titles, skills.
function lists() {
  const D = require('./db'); const L = require('./logic'); const s = D.settings();
  const seen = new Set(); const cities = [];
  for (const p of [...s.cities, ...require('./places').PLACES]) { const k = p.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); cities.push({ name: p.name, state: p.state || L.stateOf(p.name) }); } }
  return { cities, jobs: L.jobList().filter((j) => !j.hidden).map((j) => j.title), skills: s.skills || [] };
}
const read = (name, buf) => extract(cvText(name, buf), lists());

// A CV was saved on a candidate: fill in the profile details that are still empty (never overwrites
// what the person or the team typed) and leave a note of what was filled.
const LABELS = { whatsapp: 'WhatsApp', email: 'email', city: 'city', job_wanted: 'job', exp_total: 'experience', cur_salary: 'current salary', exp_salary: 'expected salary', notice_days: 'notice period', current_company: 'current company', skills: 'skills' };
function fillCandidate(id, name, data, by) {
  const D = require('./db');
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data || '').replace(/^data:[^,]*,/, ''), 'base64');
  const c = D.get('SELECT * FROM candidates WHERE id=?', id); if (!c) return [];
  let found; try { found = read(name, buf); } catch { return []; }
  const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
  // Which values came from an earlier CV and were not changed since by the candidate or the team: a newer CV
  // replaces those (and clears the ones it does not have). Anything a person typed is never touched.
  const fromCv = new Set();
  for (const h of D.all("SELECT action, field, new, who FROM history WHERE record_id=? AND (action='filled from CV' OR action='edit') ORDER BY id", id)) {
    if (h.action === 'filled from CV') String(h.new || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((k) => fromCv.add(k));
    else if (h.field && h.who !== 'CV reader') fromCv.delete(h.field);
  }
  const set = {}; const cleared = [];
  for (const k of ['email', 'city', 'job_wanted', 'exp_total', 'cur_salary', 'exp_salary', 'notice_days', 'current_company', 'skills']) {
    const has = found[k] !== undefined && !empty(found[k]);
    if (has && (empty(c[k]) || fromCv.has(k))) { if (JSON.stringify(found[k]) !== JSON.stringify(c[k])) set[k] = found[k]; }
    else if (!has && fromCv.has(k) && !empty(c[k]) && k !== 'email' && k !== 'city') { set[k] = k === 'skills' ? [] : null; cleared.push(k); }
  }
  if (set.city && empty(c.work_cities)) set.work_cities = [set.city];
  // A number from the CV only when the record has none and no one else has it.
  if (found.whatsapp && empty(c.whatsapp) && !D.get('SELECT 1 FROM candidates WHERE whatsapp=? AND id<>? AND merged_into IS NULL', found.whatsapp, id)) {
    set.whatsapp = found.whatsapp; if (/no phone/i.test(c.needs_check || '')) set.needs_check = null;
  }
  const filled = Object.keys(set).filter((k) => LABELS[k] && !cleared.includes(k));
  if (!filled.length && !cleared.length) return [];
  D.update('candidates', id, { ...set, last_updated: D.now() });
  if (filled.length) D.history(by || 'CV reader', 'filled from CV', id, null, null, filled.join(', '));
  if (cleared.length) D.history(by || 'CV reader', 'cleared (not in the new CV)', id, null, null, cleared.join(', '));
  D.insert('notes', { record_id: id, text: `From the CV (${name}): ${filled.length ? `filled ${filled.map((k) => LABELS[k]).join(', ')}` : 'nothing new'}${cleared.length ? `; cleared ${cleared.map((k) => LABELS[k] || k).join(', ')} (from the earlier CV, not in this one)` : ''}.`, author: 'CV reader', at: D.now() });
  return filled.map((k) => LABELS[k]);
}

module.exports = { cvText, extract, read, fillCandidate, textOfPdf, textOfDocx, findPhone, findEmail, findName };
