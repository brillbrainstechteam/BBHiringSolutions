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

// ---------- new templates made here, sent to Meta for approval ----------
const LANGS = [['en', 'English'], ['en_US', 'English (US)'], ['en_GB', 'English (UK)'], ['hi', 'Hindi'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi']];
const HEADS = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'];
const nums = (text) => [...String(text || '').matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]);
function checkTemplate(b) {
  const bad = (msg, field) => { throw httpError(400, msg, field); };
  const name = String(b.name || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!/^[a-z0-9_]{3,100}$/.test(name)) bad('Name: small letters, numbers and _ only (3 to 100)', 'name');
  const category = String(b.category || '').toUpperCase(); if (!['MARKETING', 'UTILITY'].includes(category)) bad('Pick the category', 'category');
  const language = String(b.language || ''); if (!LANGS.some(([k]) => k === language)) bad('Pick the language', 'language');
  const header_type = HEADS.includes(String(b.header_type || 'NONE').toUpperCase()) ? String(b.header_type || 'NONE').toUpperCase() : 'NONE';
  const header_text = String(b.header_text || '').trim(); const header_example = String(b.header_example || '').trim();
  if (header_type === 'TEXT') {
    if (!header_text) bad('Write the header', 'header_text'); if (header_text.length > 60) bad('The header takes up to 60 letters', 'header_text');
    const hv = nums(header_text); if (hv.length > 1 || (hv.length && hv[0] !== '1')) bad('The header can have one blank, written {{1}}', 'header_text');
    if (hv.length && !header_example) bad('Give a sample for the header blank', 'header_example');
  }
  const media_key = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header_type) ? String(b.media_key || '') : '';
  if (media_key) { const m = get('SELECT kind FROM studio_media WHERE key=?', media_key); if (!m || m.kind !== { IMAGE: 'image', VIDEO: 'video', DOCUMENT: 'document' }[header_type]) bad('Upload a sample file of the header type', 'media'); }
  const body = String(b.body || '').trim(); if (!body) bad('Write the message', 'body'); if (body.length > 1024) bad('The message takes up to 1024 letters', 'body');
  const want = [...new Set(nums(body))];
  if (want.some((v, i) => v !== String(i + 1))) bad('Number the blanks {{1}}, {{2}}, {{3}} … in order', 'body');
  if (/^\s*\{\{/.test(body) || /\}\}\s*[.!?]?\s*$/.test(body)) bad('Meta does not take a blank at the very start or end of the message: add a word before or after it', 'body');
  const examples = want.map((_, i) => String((b.examples || [])[i] || '').trim()); if (examples.some((x) => !x)) bad('Give a sample for every blank', 'examples');
  const footer = String(b.footer || '').trim(); if (footer.length > 60) bad('The footer takes up to 60 letters', 'footer'); if (/\{\{/.test(footer)) bad('The footer cannot have blanks', 'footer');
  const kind = ['quick', 'cta'].includes(b.button_kind) ? b.button_kind : 'none';
  let buttons = [];
  if (kind === 'quick') { buttons = (b.buttons || []).map((x) => ({ type: 'QUICK_REPLY', text: String(x.text || '').trim() })).filter((x) => x.text); if (buttons.length > 3) bad('Up to 3 quick replies', 'buttons'); }
  if (kind === 'cta') {
    buttons = (b.buttons || []).map((x) => ({ type: x.type === 'PHONE_NUMBER' ? 'PHONE_NUMBER' : 'URL', text: String(x.text || '').trim(), value: String(x.value || '').trim(), example: String(x.example || '').trim() })).filter((x) => x.text || x.value);
    if (buttons.length > 2) bad('Up to 2 link or call buttons', 'buttons'); if (buttons.filter((x) => x.type === 'PHONE_NUMBER').length > 1) bad('Only one call button', 'buttons');
    for (const x of buttons) {
      if (!x.text) bad('Give every button its words', 'buttons');
      if (x.type === 'URL' && !/^https:\/\/\S+$/.test(x.value)) bad('A link button needs a full https:// link', 'buttons');
      if (x.type === 'URL' && /\{\{/.test(x.value) && !/\{\{1\}\}$/.test(x.value)) bad('A changing link ends in {{1}}, e.g. https://site.com/jd/{{1}}', 'buttons');
      if (x.type === 'URL' && /\{\{1\}\}$/.test(x.value) && !x.example) bad('Give a sample full link for the changing link', 'buttons');
      if (x.type === 'PHONE_NUMBER' && !/^\+?\d{11,15}$/.test(x.value.replace(/[\s-]/g, ''))) bad('A call button needs the number with country code, e.g. +919876543210', 'buttons');
      if (x.type === 'PHONE_NUMBER') x.value = `+${x.value.replace(/\D/g, '')}`;
    }
  }
  if (buttons.some((x) => x.text.length > 25)) bad('Button words: up to 25 letters', 'buttons');
  return { name, category, language, header_type, header_text, header_example, media_key, body, examples, footer, button_kind: kind, buttons };
}
// Meta's shape, so the list and the preview read a draft like any other template.
const draftComponents = (t) => [
  ...(t.header_type === 'NONE' ? [] : [{ type: 'HEADER', format: t.header_type, ...(t.header_type === 'TEXT' ? { text: t.header_text } : {}) }]),
  { type: 'BODY', text: t.body }, ...(t.footer ? [{ type: 'FOOTER', text: t.footer }] : []),
  ...(t.buttons.length ? [{ type: 'BUTTONS', buttons: t.buttons.map((x) => (x.type === 'QUICK_REPLY' ? x : x.type === 'URL' ? { type: 'URL', text: x.text, url: x.value } : { type: 'PHONE_NUMBER', text: x.text, phone_number: x.value })) }] : []),
];
const EDITABLE_ST = ['DRAFT', 'NOT SENT', 'REJECTED'];
route('GET', '/api/studio/wa/options', T, () => ({ languages: LANGS }));
route('POST', '/api/studio/wa/templates', T, async (ctx) => {
  const b = ctx.body || {}; const t = checkTemplate(b); const key = `${t.name}|${t.language}`;
  const was = templateRow(key); const old = b.key ? templateRow(String(b.key)) : null;
  if (was && (!old || old.key !== key)) throw httpError(400, `${t.name} in ${t.language} already exists on the account. Give it a new name.`, 'name');
  if (was && !EDITABLE_ST.includes(was.status)) throw httpError(400, 'This template is already with Meta and cannot be changed here.', 'name');
  if (was && was.status === 'REJECTED') throw httpError(400, 'Meta keeps a rejected name: give the corrected template a new name.', 'name');
  if (old && old.key !== key && old.source === 'portal' && ['DRAFT', 'NOT SENT'].includes(old.status)) D.run('DELETE FROM wa_templates WHERE key=?', old.key);
  const row = { name: t.name, language: t.language, category: t.category, status: 'DRAFT', components: JSON.stringify(draftComponents(t)), source: 'portal', draft: JSON.stringify(t), error: null, by: ctx.actor.label, at: now() };
  if (was) update('wa_templates', key, row, 'key'); else insert('wa_templates', { key, ...row });
  if (!b.submit) { D.history(ctx.actor.label, 'WhatsApp template draft', key); return { key, status: 'DRAFT' }; }
  return submitTemplate(key, ctx.actor.label);
});
async function submitTemplate(key, by) {
  const r = templateRow(key); const t = JSON.parse(r.draft || '{}');
  if (!crmReady()) { update('wa_templates', key, { status: 'NOT SENT', error: 'The WhatsApp CRM is not linked (Settings → WhatsApp). Saved as a draft.' }, 'key'); throw httpError(400, 'Saved as a draft. Link the WhatsApp CRM in Settings → WhatsApp to send it to Meta.'); }
  let handle;
  try {
    if (t.media_key) {
      const m = get('SELECT * FROM studio_media WHERE key=?', t.media_key); const f = m && get('SELECT * FROM files WHERE id=?', m.file_id); if (!f) throw new Error('Upload the sample header file again');
      handle = (await crm()('/template-media', 'POST', { base64: F.readStored(f).toString('base64'), mime: m.mime, filename: m.name })).handle;
      if (!handle) throw new Error('Meta did not take the sample header file');
    } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(t.header_type)) throw new Error('Upload a sample header file: Meta reviews the template with it');
    const out = await crm()('/templates', 'POST', { templates: [{ name: t.name, category: t.category, language: t.language, raw_language: true, body: t.body, examples: t.examples, header_type: t.header_type === 'NONE' ? undefined : t.header_type, header_handle: handle, header_text: t.header_text || undefined, header_example: t.header_example || undefined, footer: t.footer || undefined, buttons: t.buttons }] });
    const res = (out.results || [])[0] || {};
    if (res.ok === false) throw new Error(/invalid parameter/i.test(res.error || '') ? `${res.error}: often the name was used before (deleted in the last 4 weeks)` : res.error || 'Meta did not take it');
    const st = String(res.status || 'PENDING').toUpperCase();
    update('wa_templates', key, { status: st, error: null, at: now() }, 'key');
    D.history(by, 'WhatsApp template sent to Meta', key);
    return { key, status: st };
  } catch (e) {
    update('wa_templates', key, { status: 'NOT SENT', error: e.message }, 'key');
    throw httpError(400, `Not sent to Meta: ${e.message}`);
  }
}
route('POST', '/api/studio/wa/templates/:key/submit', T, async (ctx) => { const r = templateRow(ctx.params.key); if (!r || r.source !== 'portal' || !['DRAFT', 'NOT SENT'].includes(r.status)) throw httpError(404, 'Draft not found'); return submitTemplate(r.key, ctx.actor.label); });
route('POST', '/api/studio/wa/templates/:key/delete', T, (ctx) => { const r = templateRow(ctx.params.key); if (!r || r.source !== 'portal' || !['DRAFT', 'NOT SENT'].includes(r.status)) throw httpError(400, 'Only drafts not sent to Meta can be removed here.'); D.run('DELETE FROM wa_templates WHERE key=?', r.key); D.history(ctx.actor.label, 'WhatsApp template draft removed', r.key); return { ok: true }; });

module.exports = { FIELDS, mergeVars, fillText, tplView, templateRow, campaignTemplate, filled, headerMedia, syncTemplates, crmReady };
