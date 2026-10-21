// File store, spreadsheet reading (CSV / XLSX), CSV downloads and simple PDF papers. No outside packages.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const D = require('./db');

const ALLOWED = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const MAX = 10 * 1024 * 1024;

// Checks type by extension and by the first bytes, size up to 10 MB, virus scan. Old versions are kept.
async function saveFile({ recordId, type, name, base64, by }) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (!ALLOWED[ext]) throw D.httpError(400, 'Only PDF, Word, JPG and PNG files are allowed.');
  const buf = Buffer.from(String(base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw D.httpError(400, 'The file is empty.');
  if (buf.length > MAX) throw D.httpError(400, 'The file is bigger than 10 MB.');
  const magic = buf.slice(0, 4).toString('hex');
  const ok = (ext === 'pdf' && buf.slice(0, 4).toString() === '%PDF') || (['jpg', 'jpeg'].includes(ext) && magic.startsWith('ffd8')) || (ext === 'png' && magic === '89504e47') ||
    (ext === 'docx' && magic === '504b0304') || (ext === 'doc' && magic === 'd0cf11e0');
  if (!ok) throw D.httpError(400, 'The file does not look like a real ' + ext.toUpperCase() + ' file.');
  const scan = await virusScan(buf);
  if (!scan.clean) throw D.httpError(400, `The file failed the virus check${scan.virus ? ` (${scan.virus})` : ''}.`);
  return storeBuffer({ recordId, type, name, buf, mime: ALLOWED[ext], by });
}
// Virus scan through ClamAV's clamd (CLAMD_HOST / CLAMD_PORT in .env), using its INSTREAM command.
// Without clamd only the EICAR test string is blocked, and Settings → Health says so.
function virusScan(buf) {
  if (buf.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) return Promise.resolve({ clean: false, virus: 'EICAR test file' });
  const { host, port } = D.ENV.clamd;
  if (!host) return Promise.resolve({ clean: true, scanned: false });
  return new Promise((resolve, reject) => {
    const sock = require('net').createConnection({ host, port });
    let out = '';
    sock.setTimeout(30000, () => { sock.destroy(); reject(D.httpError(503, 'The virus scanner did not answer. Please try again.')); });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024); const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
        sock.write(len); sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
    sock.on('data', (d) => { out += d.toString(); });
    sock.on('end', () => {
      const res = out.replace(/\0/g, '').trim();
      if (/OK$/.test(res)) resolve({ clean: true, scanned: true });
      else if (/FOUND$/.test(res)) resolve({ clean: false, virus: res.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') });
      else reject(D.httpError(503, `The virus scanner could not check the file (${res || 'no answer'}).`));
    });
    sock.on('error', (e) => { require('./alerts').devAlert('Virus scanner unreachable', e.message); reject(D.httpError(503, 'The virus scanner is not reachable. Please try again later.')); });
  });
}

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
// ---------- Excel (.xlsx) writer: one sheet, stored (uncompressed) zip ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipStore(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8'); const nameBuf = Buffer.from(name); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data); centrals.push(ch, nameBuf); offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); const n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
function toXLSX(rows, sheetName = 'Sheet1') {
  const x = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const col = (i) => { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${col(ci)}${ri + 1}`;
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return zipStore({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
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
  const hex = (brand && brand.primary) || '#101A3A';
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

module.exports = { unzip, toXLSX, saveFile, storeBuffer, readStored, readSpreadsheet, parseCSV, toCSV, makePdf };
