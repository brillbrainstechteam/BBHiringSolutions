// Campaign studio: WhatsApp templates (any approved on Meta) with their blanks filled from candidate details,
// header media uploaded here, and the merge fields shared with email designs. Meta is reached only through the
// WhatsApp CRM (its /api/hiring links); the token never sits in this app.
const crypto = require('crypto');
const D = require('./db');
const L = require('./logic');
const F = require('./files');
const { route } = require('./router');
const { get, all, insert, update, now, httpError } = D;

const T = { auth: 'team' };
D.db.exec('CREATE TABLE IF NOT EXISTS wa_templates (key TEXT PRIMARY KEY, name TEXT, language TEXT, category TEXT, status TEXT, components TEXT, source TEXT, draft TEXT, meta_id TEXT, error TEXT, by TEXT, at TEXT, synced_at TEXT)');
D.db.exec('CREATE TABLE IF NOT EXISTS studio_media (key TEXT PRIMARY KEY, file_id INTEGER, kind TEXT, name TEXT, mime TEXT, size INTEGER, meta_id TEXT, meta_at TEXT, by TEXT, at TEXT)');

const crm = () => require('./api-team').crmCall;
const crmReady = () => { const c = D.settings().crm || {}; return !!(c.send_url && c.token); };

// ---------- merge fields: the same list for WhatsApp blanks and email designs ----------
const FIELDS = [
  ['name', 'Full name'], ['first_name', 'First name'], ['city', 'City'], ['job_wanted', 'Job they want'],
  ['job_title', 'Job opening: title'], ['job_city', 'Job opening: city'], ['job_link', 'Job opening: details link'], ['job_apply', 'Job opening: apply link'],
  ['profile_link', 'Their profile link'], ['apply_link', 'Apply page link'], ['company', 'Our business name'],
];
function mergeVars(c, job) {
  const b = D.settings().business || {};
  return {
    name: c.name || '', first_name: String(c.name || '').trim().split(/\s+/)[0] || '', city: c.city || '', job_wanted: c.job_wanted || '',
    job_title: job ? job.title : '', job_city: job ? job.city || '' : '', job_link: job ? L.link(`jd/${job.id}`) : '', job_apply: job ? L.link('apply', `?job=${job.id}&src=campaign`) : '',
    profile_link: L.link('my-profile'), apply_link: L.link('apply', '?src=campaign'), company: b.name || 'BrillBrains Hiring Solutions',
  };
}
// {name} style blanks in an email design or a typed message.
const fillText = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? vars[k] : m === '{name}' ? 'there' : ''));

// ---------- templates ----------
const tokens = (text) => [...new Set([...String(text || '').matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((m) => m[1]))];
function tplView(r) {
  const comps = JSON.parse(r.components || '[]'); const part = (t) => comps.find((c) => c.type === t);
  const h = part('HEADER'); const b = part('BODY'); const f = part('FOOTER'); const bt = (part('BUTTONS') || {}).buttons || [];
  return {
    key: r.key, name: r.name, language: r.language, category: r.category, status: r.status, source: r.source, error: r.error || '', by: r.by || '', at: r.at, synced_at: r.synced_at,
    header: h ? { format: h.format, text: h.text || '', vars: tokens(h.text) } : null,
    body: b ? b.text || '' : '', body_vars: tokens(b && b.text), footer: f ? f.text || '' : '',
    buttons: bt.map((x, i) => ({ index: i, type: x.type, text: x.text || '', url: x.url || '', phone: x.phone_number || '', dynamic: x.type === 'URL' && /\{\{\s*\w+\s*\}\}/.test(x.url || '') })),
    draft: r.draft ? JSON.parse(r.draft) : null,
  };
}
// What Meta holds now (every template on the account), through the CRM. Kept here so the list opens without waiting.
async function syncTemplates(by) {
  if (!crmReady()) throw httpError(400, 'Set the CRM send link and token first (Settings → WhatsApp).');
  const out = await crm()('/templates?all=1', 'GET');
  const list = out.templates || []; const seen = new Set();
  D.tx(() => {
    for (const t of list) {
      const key = `${t.name}|${t.language}`; seen.add(key); const was = get('SELECT * FROM wa_templates WHERE key=?', key);
      const row = { name: t.name, language: t.language, category: t.category || '', status: t.status || '', components: JSON.stringify(t.components || []), meta_id: t.id || null, synced_at: now() };
      if (was) update('wa_templates', key, row, 'key'); else insert('wa_templates', { key, ...row, source: 'meta', at: now() });
    }
    // Gone from Meta (deleted there): drop it here too, unless it is a draft made here that was never sent.
    for (const r of all("SELECT key, status FROM wa_templates WHERE source='meta' OR status NOT IN ('DRAFT','NOT SENT')")) if (!seen.has(r.key)) D.run('DELETE FROM wa_templates WHERE key=?', r.key);
  });
  D.setHealth('wa_templates_synced', now());
  if (by) D.history(by, 'WhatsApp templates read from Meta', null, null, null, `${list.length} templates`);
  return list.length;
}
const templateRow = (key) => get('SELECT * FROM wa_templates WHERE key=?', key);

route('GET', '/api/studio/wa/templates', T, async () => {
  let note = '';
  const last = get("SELECT value FROM health WHERE key='wa_templates_synced'");
  if (crmReady() && (!last || Date.now() - new Date(last.value) > 10 * 60000)) { try { await syncTemplates(null); } catch (e) { note = `Could not read Meta just now: ${e.message}`; } }
  if (!crmReady()) note = 'The WhatsApp CRM is not linked (Settings → WhatsApp), so this is the last list read from Meta.';
  const rows = all('SELECT * FROM wa_templates ORDER BY status=\'APPROVED\' DESC, name, language').map(tplView);
  return { templates: rows, fields: FIELDS, note, synced_at: (get("SELECT value FROM health WHERE key='wa_templates_synced'") || {}).value || null, live: !!(D.settings().crm || {}).enabled };
});
route('POST', '/api/studio/wa/sync', T, async (ctx) => ({ count: await syncTemplates(ctx.actor.label) }));

// ---------- media: header images, videos and PDFs, and email images ----------
const MEDIA = {
  jpg: ['image/jpeg', 'image', 5], jpeg: ['image/jpeg', 'image', 5], png: ['image/png', 'image', 5],
  mp4: ['video/mp4', 'video', 16], pdf: ['application/pdf', 'document', 16],
};
function sniff(buf) {
  const hex = buf.slice(0, 12).toString('hex');
  if (hex.startsWith('ffd8')) return 'image/jpeg'; if (hex.startsWith('89504e47')) return 'image/png';
  if (buf.slice(0, 1024).toString('latin1').includes('%PDF')) return 'application/pdf'; if (buf.slice(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  return '';
}
route('POST', '/api/studio/media', T, (ctx) => {
  const b = ctx.body || {}; const name = String(b.name || 'file').slice(0, 120); const ext = name.split('.').pop().toLowerCase(); const t = MEDIA[ext];
  if (!t) throw httpError(400, 'Use a JPG or PNG image, an MP4 video or a PDF.');
  const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw httpError(400, 'The file is empty.');
  if (buf.length > t[2] * 1024 * 1024) throw httpError(400, `WhatsApp takes ${t[1] === 'image' ? 'images' : t[1] === 'video' ? 'videos' : 'PDFs'} up to ${t[2]} MB.`);
  if (sniff(buf) !== t[0]) throw httpError(400, `The file does not look like a real ${ext.toUpperCase()} file.`);
  const key = crypto.randomBytes(12).toString('hex');
  const f = F.storeBuffer({ recordId: `STUDIO-${key.slice(0, 8)}`, type: 'studio', name, buf, mime: t[0], by: ctx.actor.label });
  insert('studio_media', { key, file_id: f.id, kind: t[1], name, mime: t[0], size: buf.length, by: ctx.actor.label, at: now() });
  return { key, kind: t[1], name, mime: t[0], size: buf.length, url: `/api/public/studio-media/${key}` };
});
// Served by its long random key: images in emails and header media must open for the people they go to.
route('GET', '/api/public/studio-media/:key', {}, (ctx) => {
  const m = get('SELECT * FROM studio_media WHERE key=?', String(ctx.params.key || '').replace(/[^a-f0-9]/g, ''));
  const f = m && get('SELECT * FROM files WHERE id=?', m.file_id); if (!f) throw httpError(404, 'Not found');
  return { __file: { name: m.name, mime: m.mime, buf: F.readStored(f), inline: true } };
});
// The header for Meta: its media id (uploaded once through the CRM, good for 30 days; renewed after 25), or the
// public link when the CRM is not connected yet.
async function headerMedia(key) {
  const m = get('SELECT * FROM studio_media WHERE key=?', key); if (!m) throw httpError(400, 'Upload the header file again.', 'media');
  const base = String(D.settings().business.base_url || '').replace(/\/$/, '');
  if (crmReady() && (D.settings().crm || {}).enabled) {
    if (m.meta_id && Date.now() - new Date(m.meta_at) < 25 * 86400000) return { kind: m.kind, ref: { id: m.meta_id }, name: m.name };
    const f = get('SELECT * FROM files WHERE id=?', m.file_id);
    const r = await crm()('/media', 'POST', { base64: F.readStored(f).toString('base64'), mime: m.mime, filename: m.name });
    if (!r.id) throw httpError(502, 'Meta did not take the header file.');
    update('studio_media', key, { meta_id: r.id, meta_at: now() }, 'key');
    return { kind: m.kind, ref: { id: r.id }, name: m.name };
  }
  return { kind: m.kind, ref: /^https:\/\//.test(base) ? { link: `${base}/api/public/studio-media/${key}` } : { link: `https://example.invalid/${key}` }, name: m.name };
}

// One person's message from a template: Meta's components plus the text we keep on their record.
// map: { header: {src, text, fallback}, body: [{src, text, fallback}], buttons: { index: {src, text, fallback} } }
// src is a merge field, or "text" for the same words for everyone.
function filled(t, map, vars, media) {
  const val = (m, label, slot) => {
    const x = m || {}; if (!x.src) throw httpError(400, `Choose what goes in ${slot}`, 'tpl');
    const v = String(x.src === 'text' ? x.text || '' : vars[x.src] ?? '').trim() || String(x.fallback || '').trim();
    if (!v) throw Object.assign(new Error(`No ${label}`), { skip: true });
    return v.slice(0, 1000);
  };
  const named = (tok) => !/^\d+$/.test(tok);
  const label = (m) => (m && m.src && m.src !== 'text' ? (FIELDS.find(([k]) => k === m.src) || [])[1] || m.src : 'value').toLowerCase();
  const comps = []; let headText = '';
  if (t.header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(t.header.format)) {
    if (!media) throw httpError(400, 'This template has a header file: upload the image, video or PDF.', 'media');
    const kind = t.header.format.toLowerCase(); const obj = { ...media.ref }; if (kind === 'document') obj.filename = media.name;
    comps.push({ type: 'header', parameters: [{ type: kind, [kind]: obj }] });
  } else if (t.header && t.header.format === 'TEXT') {
    headText = t.header.text;
    if (t.header.vars.length) { const v = val(map.header, label(map.header), 'the header blank'); headText = headText.replace(/\{\{\s*\w+\s*\}\}/, v); comps.push({ type: 'header', parameters: [{ type: 'text', text: v, ...(named(t.header.vars[0]) ? { parameter_name: t.header.vars[0] } : {}) }] }); }
  }
  let body = t.body;
  if (t.body_vars.length) {
    const ps = t.body_vars.map((tok, i) => { const v = val((map.body || [])[i], label((map.body || [])[i]), `{{${tok}}}`); body = body.replace(new RegExp(`\\{\\{\\s*${tok}\\s*\\}\\}`, 'g'), v); return { type: 'text', text: v, ...(named(tok) ? { parameter_name: tok } : {}) }; });
    comps.push({ type: 'body', parameters: ps });
  }
  for (const b of t.buttons) if (b.dynamic) { const m = (map.buttons || {})[b.index]; comps.push({ type: 'button', sub_type: 'url', index: String(b.index), parameters: [{ type: 'text', text: val(m, `${label(m)} for the ${b.text} button`, `the ${b.text} link`) }] }); }
  const text = [headText && `*${headText}*`, t.header && t.header.format !== 'TEXT' ? `[${t.header.format.toLowerCase()}${media ? `: ${media.name}` : ''}]` : '', body, t.footer && `_${t.footer}_`].filter(Boolean).join('\n\n');
  return { name: t.name, language: t.language, category: t.category, components: comps, text, buttons: t.buttons.map((b) => b.text) };
}
// The template ready to send, checked once for the whole campaign.
function campaignTemplate(spec) {
  const r = spec && spec.key ? templateRow(spec.key) : null; if (!r) throw httpError(400, 'Pick the WhatsApp template', 'tpl');
  const t = tplView(r); if (t.status !== 'APPROVED') throw httpError(400, `${t.name} is not approved by Meta yet (${String(t.status || 'not sent').toLowerCase()}).`, 'tpl');
  return t;
}
// Preview for one person (the first in the audience, or a sample).
route('POST', '/api/studio/wa/preview', T, (ctx) => {
  const b = ctx.body || {}; const t = tplView(templateRow(String(b.key || '')) || {}); if (!t.name) throw httpError(404, 'Template not found');
  const c = (b.candidate_id && get('SELECT * FROM candidates WHERE id=?', String(b.candidate_id))) || { name: 'Priya Sharma', city: 'Mumbai', job_wanted: 'Sales Executive' };
  const job = b.job_id ? get('SELECT * FROM jobs WHERE id=?', String(b.job_id)) : null;
  const m = b.media_key ? get('SELECT * FROM studio_media WHERE key=?', b.media_key) : null;
  try { const f = filled(t, b.map || {}, mergeVars(c, job), m ? { kind: m.kind, ref: { link: `/api/public/studio-media/${m.key}` }, name: m.name } : t.header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(t.header.format) ? { kind: 'x', ref: {}, name: '(no file yet)' } : null); return { ok: true, who: c.name, text: f.text, buttons: f.buttons }; } catch (e) { return { ok: false, who: c.name, error: e.message }; }
});

module.exports = { FIELDS, mergeVars, fillText, tplView, templateRow, campaignTemplate, filled, headerMedia, syncTemplates, crmReady };
