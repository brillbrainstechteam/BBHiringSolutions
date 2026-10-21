// File store, spreadsheet reading (CSV / XLSX), CSV downloads and simple PDF papers. No outside packages.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const D = require('./db');

const ALLOWED = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const MAX = 10 * 1024 * 1024;

// Checks type by extension and by the first bytes, size up to 10 MB. Old versions are kept.
function saveFile({ recordId, type, name, base64, by }) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (!ALLOWED[ext]) throw D.httpError(400, 'Only PDF, Word, JPG and PNG files are allowed.');
  const buf = Buffer.from(String(base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw D.httpError(400, 'The file is empty.');
  if (buf.length > MAX) throw D.httpError(400, 'The file is bigger than 10 MB.');
  const magic = buf.slice(0, 4).toString('hex');
  const ok = (ext === 'pdf' && buf.slice(0, 4).toString() === '%PDF') || (['jpg', 'jpeg'].includes(ext) && magic.startsWith('ffd8')) || (ext === 'png' && magic === '89504e47') ||
    (ext === 'docx' && magic === '504b0304') || (ext === 'doc' && magic === 'd0cf11e0');
  if (!ok) throw D.httpError(400, 'The file does not look like a real ' + ext.toUpperCase() + ' file.');
  if (virusCheck(buf)) throw D.httpError(400, 'The file failed the virus check.');
  return storeBuffer({ recordId, type, name, buf, mime: ALLOWED[ext], by });
}
// Virus check hook: blocks the EICAR test string. Connect a real scanner (e.g. ClamAV) here on the server.
const virusCheck = (buf) => buf.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');

function storeBuffer({ recordId, type, name, buf, mime, by }) {
  const prev = D.get('SELECT * FROM files WHERE record_id=? AND type=? AND replaced=0 ORDER BY version DESC LIMIT 1', recordId, type);
  const stored = crypto.randomBytes(12).toString('hex') + path.extname(name || '');
  fs.writeFileSync(path.join(D.DATA_DIR, 'files', stored), buf);
  if (prev) D.update('files', prev.id, { replaced: 1 });
  const row = { record_id: recordId, type, name, version: prev ? prev.version + 1 : 1, path: stored, mime, size: buf.length, uploaded_by: by || 'System', at: D.now(), replaced: 0 };
  const r = D.run('INSERT INTO files (record_id,type,name,version,path,mime,size,uploaded_by,at,replaced) VALUES (?,?,?,?,?,?,?,?,?,?)', row.record_id, row.type, row.name, row.version, row.path, row.mime, row.size, row.uploaded_by, row.at, 0);
  D.history(by, 'upload', recordId, type, prev ? `v${prev.version}` : null, `${name} v${row.version}`);
  return { id: Number(r.lastInsertRowid), ...row };
}
function readStored(file) { return fs.readFileSync(path.join(D.DATA_DIR, 'files', file.path)); }

// ---------- spreadsheets ----------
function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
// Minimal .xlsx reader: unzips the workbook and reads the first sheet's cells.
function unzip(buf) {
  const out = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28); const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42); const name = buf.slice(p + 46, p + 46 + nlen).toString();
    const lnlen = buf.readUInt16LE(local + 26); const lxlen = buf.readUInt16LE(local + 28);
    const data = buf.slice(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parseXLSX(buf) {
  const z = unzip(buf);
  const shared = [];
  if (z['xl/sharedStrings.xml']) for (const m of z['xl/sharedStrings.xml'].toString().matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
  const sheetName = Object.keys(z).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const xml = z[sheetName].toString();
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]; const inner = cm[2] || '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs); const t = /t="(\w+)"/.exec(attrs);
      let col = 0; if (ref) for (const ch of ref[1]) col = col * 26 + ch.charCodeAt(0) - 64; col -= 1;
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner); const is = /<is>([\s\S]*?)<\/is>/.exec(inner);
      let val = '';
      if (t && t[1] === 's' && v) val = shared[Number(v[1])] || '';
      else if (is) val = xmlText(is[1]);
      else if (v) val = xmlText(v[1]);
      row[col] = val;
    }
    rows.push(Array.from(row, (x) => (x === undefined ? '' : x)));
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
function readSpreadsheet(name, base64) {
  const buf = Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64');
  if (/\.xlsx$/i.test(name)) return parseXLSX(buf);
  if (/\.(csv|txt)$/i.test(name)) return parseCSV(buf.toString('utf8').replace(/^﻿/, ''));
  throw D.httpError(400, 'Upload an Excel (.xlsx) or CSV file.');
}
function toCSV(rows) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

// ---------- simple PDF (text papers: offer letter, invoice, short CV) ----------
function pdfSafe(s) { return String(s).replace(/₹/g, 'Rs. ').replace(/[^\x20-\x7E]/g, '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function wrap(line, max = 92) {
  const out = []; let cur = '';
  for (const w of String(line).split(' ')) { if ((cur + ' ' + w).trim().length > max) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  out.push(cur); return out;
}
// lines: strings, or {text, size, bold}. Brand bar at the top in the primary colour.
function makePdf(title, lines, brand) {
  const items = [];
  for (const l of lines) { const o = typeof l === 'string' ? { text: l } : l; for (const w of wrap(o.text, o.size && o.size > 12 ? 60 : 92)) items.push({ ...o, text: w }); }
  const pages = []; let cur = []; let y = 740;
  for (const it of items) { const h = (it.size || 10) + 6; if (y - h < 70) { pages.push(cur); cur = []; y = 740; } cur.push({ ...it, y }); y -= h; }
  pages.push(cur);
  const hex = (brand && brand.primary) || '#0E5E4E';
  const rgb = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  const kids = [];
  pages.forEach((pg, i) => {
    const pid = 5 + i * 2; const cid = pid + 1; kids.push(`${pid} 0 R`);
    let s = `${rgb} rg 0 792 612 -40 re f 1 1 1 rg BT /F2 13 Tf 40 766 Td (${pdfSafe((brand && brand.name) || 'BrillBrains Hiring Solutions')}) Tj ET 0 0 0 rg\n`;
    s += `BT /F2 15 Tf 40 724 Td (${pdfSafe(i === 0 ? title : title + ' (cont.)')}) Tj ET\n`;
    for (const it of pg) s += `BT /${it.bold ? 'F2' : 'F1'} ${it.size || 10} Tf 40 ${it.y - 34} Td (${pdfSafe(it.text)}) Tj ET\n`;
    s += `BT /F1 8 Tf 40 30 Td (Page ${i + 1} of ${pages.length}) Tj ET`;
    objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`;
    objs[cid] = `<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = Buffer.byteLength(out, 'latin1'); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

module.exports = { saveFile, storeBuffer, readStored, readSpreadsheet, parseCSV, toCSV, makePdf };
