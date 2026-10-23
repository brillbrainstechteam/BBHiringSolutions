/* BBHS core: API calls, routing, small UI kit, voice typing, the one WhatsApp message window. */
const BB = window.BB = { views: {}, panels: {}, boot: null, portal: null };

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => (n === null || n === undefined || n === '' || isNaN(n) ? '—' : '₹' + Math.round(Number(n)).toLocaleString('en-IN'));
const IST = { timeZone: 'Asia/Kolkata' };
const fmtD = (d) => (d ? new Date(d.length === 10 ? d + 'T00:00:00+05:30' : d).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-IN', { ...IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtT = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit' }) : '');
const daysAgo = (d) => { if (!d) return '—'; const n = Math.floor((Date.now() - new Date(d)) / 86400000); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
const istDay = (d = new Date()) => new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10);
const toLocalInput = (d) => { const t = new Date(new Date(d).getTime() + 330 * 60000); return t.toISOString().slice(0, 16); };
const fromLocalInput = (v) => (v ? new Date(v + ':00+05:30').toISOString() : '');
Object.assign(BB, { $, $$, esc, inr, fmtD, fmtDT, fmtT, daysAgo, istDay, toLocalInput, fromLocalInput });

const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  inbox: '<path d="M4 4h16v10h-5l-1 3h-4l-1-3H4z"/><path d="M4 14v6h16v-6"/>', building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 6 5"/>',
  flow: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="6" rx="1"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', note: '<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6M9 13h7M9 17h5"/>',
  rupee: '<path d="M6 4h12M6 9h12M9 4c6 0 6 9 0 9H6l8 8"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>', cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  report: '<path d="M4 4h16v16H4z"/><path d="M8 16v-4M12 16V8M16 16v-6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>', plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;
const waIcon = '<svg class="wa-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 2 1.1 1 2 1.3 2.3 1.4.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.2 1.3z"/></svg>';
Object.assign(BB, { icon, waIcon });

// Status badges
const statusBadge = (s) => `<span class="badge st-${String(s || '').replace(/\s+/g, '-')}">${esc(s)}</span>`;
const scoreBadge = (n) => `<span class="score ${n >= 70 ? 'hi' : n >= 55 ? 'mid' : ''}" title="Match score">${n}</span>`;
const levelName = (l) => ({ super: 'Super admin', admin: 'Admin', sub: 'Sub admin' }[l] || l);
const resultBadge = (r) => (r === 'open' ? '<span class="badge b-primary">Open</span>' : r === 'Hired' ? '<span class="badge b-green">Hired</span>' : `<span class="badge b-red">${esc(r)}</span>`);
const ticks = (st) => ({ 'would send': '<span class="badge b-outline tiny" title="Saved; sends when WhatsApp is connected">would send</span>', scheduled: '<span class="badge b-amber tiny">scheduled</span>', sending: '<span class="ticks">✓</span>', sent: '<span class="ticks">✓</span>', delivered: '<span class="ticks">✓✓</span>', read: '<span class="ticks read">✓✓</span>', failed: '<span class="badge b-red tiny">failed</span>', received: '' }[st] || esc(st));
Object.assign(BB, { statusBadge, scoreBadge, levelName, resultBadge, ticks });

// ---------- API ----------
const TOKEN_KEYS = { team: 'bbhs.team', client: 'bbhs.client', candidate: 'bbhs.cand' };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } } };
BB.store = store;
BB.token = (kind) => store.get(TOKEN_KEYS[kind || BB.portal]);
BB.setToken = (kind, t) => store.set(TOKEN_KEYS[kind], t);
async function api(path, opts = {}) {
  const kind = opts.kind || BB.portal;
  const headers = { 'Content-Type': 'application/json' };
  const t = BB.token(kind); if (t) headers['x-session'] = t;
  const res = await fetch(path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const j = ct.includes('json') ? await res.json() : { error: await res.text() };
    const e = new Error(j.error || 'Something went wrong'); e.field = j.field; e.status = res.status;
    if (res.status === 401 && !opts.noLogout && kind) { BB.setToken(kind, null); if (BB.onLogout) BB.onLogout(kind, e.message); }
    throw e;
  }
  if (ct.includes('json')) return res.json();
  return res;
}
BB.api = api;
BB.post = (p, body, o) => api(p, { ...o, method: 'POST', body: body || {} });
BB.put = (p, body) => api(p, { method: 'PUT', body: body || {} });
BB.patch = (p, body) => api(p, { method: 'PATCH', body: body || {} });
// Downloads and file opening go through fetch with the session, never a bare link.
BB.download = async (path, open = false) => {
  try {
    const res = await api(path); const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || ''; const name = (/filename="([^"]+)"/.exec(cd) || [])[1] || 'download';
    const url = URL.createObjectURL(blob);
    if (open && /pdf|image/.test(blob.type)) { window.open(url, '_blank'); }
    else { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { BB.toast(e.message, true); }
};
BB.openFile = (id) => BB.download(`/api/files/${id}`, true);

// ---------- toast, modal ----------
BB.toast = (msg, bad) => { const el = document.createElement('div'); el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg; $('#toast-root').appendChild(el); setTimeout(() => el.remove(), bad ? 5000 : 3000); };
BB.fail = (e) => BB.toast(e.message || String(e), true);
BB.modal = ({ title, body, foot, wide, onMount, onClose }) => {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-h"><h2 style="font-size:18px">${title}</h2><button class="x" data-x aria-label="Close">×</button></div><div class="modal-b">${body || ''}</div>${foot !== false ? `<div class="modal-f">${foot || ''}</div>` : ''}</div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('[data-x]', back).onclick = close; document.addEventListener('keydown', onKey);
  $('#modal-root').appendChild(back);
  const m = $('.modal', back); BB.attachMics(m);
  onMount && onMount(m, close);
  return { el: m, close };
};
// Field builder used everywhere. def: {name,label,type,options,value,required,voice,opt,hint,attrs,phone}
BB.field = (d) => {
  const v = d.value ?? '';
  const lab = d.label ? `<span class="lab">${esc(d.label)}${d.opt ? ' <span class="opt">(optional)</span>' : ''}</span>` : '';
  let inner;
  if (d.type === 'select') inner = `<select name="${d.name}" ${d.attrs || ''}>${d.placeholder !== false ? `<option value="">${esc(d.placeholder || 'Choose…')}</option>` : ''}${(d.options || []).map((o) => { const [val, text] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(text)}</option>`; }).join('')}</select>`;
  else if (d.type === 'textarea') inner = `<div class="inp-wrap"><textarea name="${d.name}" ${d.voice !== false ? 'data-voice' : ''} placeholder="${esc(d.placeholder || '')}" ${d.attrs || ''}>${esc(v)}</textarea></div>`;
  else if (d.type === 'check') return `<label class="row" style="gap:8px"><input type="checkbox" name="${d.name}" ${v ? 'checked' : ''} ${d.attrs || ''}> <span>${esc(d.label)}</span></label>`;
  else if (d.type === 'choice') inner = `<div class="choice">${d.options.map((o) => { const [val, text] = Array.isArray(o) ? o : [o, o]; return `<label><input type="radio" name="${d.name}" value="${esc(val)}" ${String(val) === String(v) ? 'checked' : ''}> ${esc(text)}</label>`; }).join('')}</div>`;
  else {
    const voice = d.voice !== false && ['text', undefined, 'tel', 'search'].includes(d.type);
    // Phone fields show the +91 country code in front; the 10 digits are what is saved.
    inner = `<div class="inp-wrap${d.phone ? ' has-cc' : ''}">${d.phone ? '<span class="cc" aria-hidden="true">+91</span>' : ''}<input name="${d.name}" type="${d.type || 'text'}" value="${esc(v)}" ${voice ? `data-voice ${d.phone ? 'data-phone' : ''}` : ''} ${d.list === 'cities' ? 'data-city' : d.list ? `list="${d.list}"` : ''} placeholder="${esc(d.placeholder || '')}" ${d.attrs || ''}></div>`;
  }
  return `<label class="field" data-f="${d.name}">${lab}${inner}${d.hint ? `<div class="faint small" style="margin-top:3px">${d.hint}</div>` : ''}</label>`;
};
BB.formValues = (root) => {
  const out = {};
  for (const el of $$('input[name], select[name], textarea[name]', root)) {
    if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; else if (!(el.name in out)) out[el.name] = ''; }
    else if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value.trim();
  }
  return out;
};
BB.showErr = (root, e) => {
  $$('.err-msg', root).forEach((x) => x.remove()); $$('.has-err', root).forEach((x) => x.classList.remove('has-err'));
  const f = e.field && $(`[data-f="${e.field}"]`, root);
  if (f) { f.classList.add('has-err'); f.insertAdjacentHTML('beforeend', `<div class="err-msg">${esc(e.message)}</div>`); const i = $('input,select,textarea', f); i && i.focus(); }
  else BB.toast(e.message, true);
};
// Form pop-up returning the values: BB.ask({title, fields, ok, submit:(vals)=>promise})
BB.ask = ({ title, fields, ok = 'Save', note, submit, wide, extra }) => new Promise((resolve) => {
  const m = BB.modal({ title, wide, body: `${note ? `<div class="notice" style="margin-bottom:12px">${note}</div>` : ''}<form class="stack" onsubmit="return false">${fields.map((f) => (typeof f === 'string' ? f : BB.field(f))).join('')}</form>${extra || ''}`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok>${esc(ok)}</button>`,
    onClose: () => resolve(null),
    onMount: (el, close) => {
      $('[data-cancel]', el).onclick = close;
      const go = async () => {
        const vals = BB.formValues(el); const btn = $('[data-ok]', el); btn.disabled = true;
        try { const r = submit ? await submit(vals) : vals; resolve(r ?? vals); el.closest('.modal-back').remove(); } catch (e) { BB.showErr(el, e); } finally { btn.disabled = false; }
      };
      $('[data-ok]', el).onclick = go;
      $('form', el).addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); go(); } });
      const first = $('input:not([type=hidden]),select,textarea', el); first && setTimeout(() => first.focus(), 30);
    } });
});
BB.confirm = (title, text, ok = 'Yes') => new Promise((resolve) => {
  BB.modal({ title, body: `<p style="margin:0">${text}</p>`, foot: `<button class="btn" data-c>Cancel</button><button class="btn primary" data-o>${esc(ok)}</button>`, onClose: () => resolve(false),
    onMount: (el) => { $('[data-c]', el).onclick = () => { el.closest('.modal-back').remove(); resolve(false); }; $('[data-o]', el).onclick = () => { el.closest('.modal-back').remove(); resolve(true); }; } });
});
BB.pickFile = (accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png') => new Promise((resolve) => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
  i.onchange = () => { const f = i.files[0]; if (!f) return resolve(null); if (f.size > 10 * 1024 * 1024 && !/\.(xlsx|csv)$/i.test(f.name)) { BB.toast('The file is bigger than 10 MB.', true); return resolve(null); } const r = new FileReader(); r.onload = () => resolve({ name: f.name, base64: r.result, size: f.size }); r.readAsDataURL(f); };
  i.click();
});
BB.copy = (text) => { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => BB.toast('Copied'), () => { prompt('Copy this:', text); }); };

// ---------- voice typing (English / Hindi) ----------
BB.voiceLang = store.get('bbhs.voice') || 'en-IN';
const HI_DIGITS = { '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9 };
const WORD_DIGITS = { zero: 0, oh: 0, o: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, tree: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9,
  shunya: 0, sunya: 0, 'शून्य': 0, ek: 1, 'एक': 1, do: 2, 'दो': 2, teen: 3, tin: 3, 'तीन': 3, char: 4, chaar: 4, 'चार': 4, panch: 5, paanch: 5, 'पांच': 5, 'पाँच': 5,
  chhe: 6, chhah: 6, che: 6, chah: 6, 'छह': 6, 'छः': 6, 'छे': 6, 'छै': 6, saat: 7, sat: 7, 'सात': 7, aath: 8, aat: 8, 'आठ': 8, nau: 9, nao: 9, 'नौ': 9 };
const REPEAT = { double: 2, dabal: 2, 'डबल': 2, triple: 3, tripal: 3, 'ट्रिपल': 3 };
const TENS = { twenty: 2, thirty: 3, forty: 4, fifty: 5, sixty: 6, seventy: 7, eighty: 8, ninety: 9 };
// "nine eight double two…" or Hindi digits → 10 digits
BB.spokenToDigits = (text) => {
  let s = String(text).toLowerCase().replace(/[०-९]/g, (c) => HI_DIGITS[c]).replace(/[,.\-+()]/g, ' ');
  const out = []; let rep = 1; let tens = false;
  for (const tok of s.split(/\s+/).filter(Boolean)) {
    // "ninety eight" → 98, "ninety" alone → 90
    if (tens && !(WORD_DIGITS[tok] >= 1 && tok !== 'o' && tok !== 'oh')) out.push('0');
    if (tens && WORD_DIGITS[tok] >= 1) { out.push(String(WORD_DIGITS[tok])); tens = false; rep = 1; continue; }
    tens = false;
    if (TENS[tok]) { out.push(String(TENS[tok])); tens = true; continue; }
    if (REPEAT[tok]) { rep = REPEAT[tok]; continue; }
    if (/^\d+$/.test(tok)) { out.push(tok.length === 1 ? tok.repeat(rep) : tok); rep = 1; continue; }
    if (WORD_DIGITS[tok] !== undefined) { out.push(String(WORD_DIGITS[tok]).repeat(rep)); rep = 1; }
  }
  if (tens) out.push('0');
  let d = out.join('');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(-10);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
};
// Hindi voice typing gives Devanagari; names, companies and cities are kept in English letters
// so they match the city list and read the same for the whole team ("राहुल शर्मा" → "Rahul Sharma").
const DV_CONS = { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n', 'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'ड़': 'r', 'ढ़': 'rh', 'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'फ़': 'f', 'य़': 'y' };
const DV_VOW = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o' };
const DV_SIGN = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o' };
// Usual English spellings of common names that letter-by-letter would get wrong.
const HI_WORDS = { 'अग्रवाल': 'Agarwal', 'सिंह': 'Singh', 'वर्मा': 'Verma', 'चौधरी': 'Chaudhary', 'श्रीवास्तव': 'Srivastava', 'मोहम्मद': 'Mohammad', 'आसिफ': 'Asif', 'आसिफ़': 'Asif', 'प्रीति': 'Preeti',
  'पूजा': 'Pooja', 'ज्योति': 'Jyoti', 'दीपक': 'Deepak', 'प्रदीप': 'Pradeep', 'संदीप': 'Sandeep', 'कुलदीप': 'Kuldeep', 'नीतू': 'Neetu', 'गीता': 'Geeta', 'सीमा': 'Seema', 'रीना': 'Reena',
  'जैन': 'Jain', 'पटेल': 'Patel', 'खान': 'Khan', 'अली': 'Ali', 'यादव': 'Yadav', 'मिश्रा': 'Mishra', 'त्रिपाठी': 'Tripathi', 'सोनी': 'Soni', 'ज्वेलर्स': 'Jewellers', 'ज्वेलरी': 'Jewellery' };
BB.toRoman = (text) => String(text).normalize('NFC').split(/(\s+)/).map((w) => {
  if (HI_WORDS[w]) return HI_WORDS[w];
  if (!/[ऀ-ॿ]/.test(w)) return w;
  const ch = [...w.replace(/[०-९]/g, (c) => HI_DIGITS[c])]; const parts = []; // {c: consonant, v: vowel or null (inherent a)}
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i] + (ch[i + 1] === '़' ? '़' : ''); if (ch[i + 1] === '़') i++;
    if (DV_CONS[c]) { const nx = ch[i + 1]; if (DV_SIGN[nx]) { parts.push({ c: DV_CONS[c], v: DV_SIGN[nx] }); i++; } else if (nx === '्') { parts.push({ c: DV_CONS[c], v: '' }); i++; } else parts.push({ c: DV_CONS[c], v: null }); }
    else if (DV_VOW[c]) parts.push({ c: '', v: DV_VOW[c] });
    else if (c === 'ं' || c === 'ँ') parts.push({ c: 'n', v: '' });
    else if (c === 'ः') parts.push({ c: 'h', v: '' });
    else if (!/[ऀ-ॿ]/.test(c)) parts.push({ c, v: '' });
  }
  // The silent "a": dropped at the end of a word and between a vowel+consonant and a consonant+vowel (जयपुर → jaypur).
  return parts.map((p, i) => {
    if (p.v !== null) return p.c + p.v;
    const last = i === parts.length - 1; const next = parts[i + 1]; const prev = parts[i - 1];
    if (last && parts.length > 1) return p.c;
    if (i > 0 && prev && prev.v && next && next.c && next.v !== '' && i < parts.length - 1 && !(i === 1 && parts.length <= 3)) return p.c;
    return p.c + 'a';
  }).join('').replace(/n(?=[pbm])/g, 'm');
}).join('').replace(/(^|\s)([a-z])/g, (m, s, c) => s + c.toUpperCase());
// Hindi names of big cities that the letter-by-letter spelling would not match.
const HI_CITY = { 'दिल्ली': 'Delhi', 'नई दिल्ली': 'New Delhi', 'मुंबई': 'Mumbai', 'बंबई': 'Mumbai', 'कोलकाता': 'Kolkata', 'कलकत्ता': 'Kolkata', 'चेन्नई': 'Chennai', 'बेंगलुरु': 'Bengaluru', 'बेंगलुरू': 'Bengaluru', 'बैंगलोर': 'Bengaluru', 'हैदराबाद': 'Hyderabad', 'गुड़गांव': 'Gurgaon', 'गुरुग्राम': 'Gurugram', 'लखनऊ': 'Lucknow', 'कोच्चि': 'Kochi', 'त्रिशूर': 'Thrissur' };
// The closest place in the list to what was heard (a letter or two out is fine).
BB.matchPlace = (heard) => {
  const raw = String(heard || '').trim(); if (!raw) return '';
  if (HI_CITY[raw]) return HI_CITY[raw];
  const roman = /[ऀ-ॿ]/.test(raw) ? BB.toRoman(raw) : raw;
  const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ay/g, 'ai').replace(/w/g, 'v').replace(/z/g, 'j').replace(/ph/g, 'f').replace(/au/g, 'o').replace(/(.)\1/g, '$1').replace(/(?<=.{3})[ae]$/, '');
  const dist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const n = norm(roman); let best = null; let bestD = 99;
  for (const p of BB.boot.places || []) { const d = dist(n, norm(p.name)); if (d < bestD) { bestD = d; best = p.name; } }
  return best && bestD <= Math.max(1, Math.floor(n.length / 4)) ? best : roman;
};
// ---------- city type-ahead (any town allowed); fills the State field next to it ----------
BB.placeOf = (name) => { const n = String(name || '').trim().toLowerCase(); return n ? (BB.boot.places || []).find((p) => p.name.toLowerCase() === n) : null; };
BB.attachCities = (root) => {
  for (const inp of $$('input[data-city]', root)) {
    if (inp.dataset.ta) continue; inp.dataset.ta = '1'; inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-autocomplete', 'list'); inp.setAttribute('aria-expanded', 'false');
    const list = document.createElement('div'); list.className = 'ta-list hidden'; list.setAttribute('role', 'listbox');
    inp.parentElement.appendChild(list);
    let items = []; let at = -1;
    const scope = () => inp.closest('form, .modal, .card') || document;
    const setState = () => {
      const st = $('[name=state]', scope()); if (!st) return;
      const p = BB.placeOf(inp.value);
      if (p) { if (!st.value || st.dataset.auto) { st.value = p.state; st.dataset.auto = '1'; } }
      else if (st.dataset.auto) { st.value = ''; delete st.dataset.auto; }
    };
    const close = () => { list.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); at = -1; };
    const pick = (p) => { inp.value = p.name; close(); setState(); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); };
    const draw = () => {
      list.innerHTML = items.map((p, i) => `<div class="ta-item ${i === at ? 'on' : ''}" role="option" data-i="${i}"><b>${esc(p.name)}</b><span>${esc(p.state)}</span></div>`).join('');
      list.classList.toggle('hidden', !items.length); inp.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    };
    const search = () => {
      const q = inp.value.trim().toLowerCase(); if (!q) { items = []; return close(); }
      const all = BB.boot.places || [];
      const starts = all.filter((p) => p.name.toLowerCase().startsWith(q));
      const has = all.filter((p) => !p.name.toLowerCase().startsWith(q) && (p.name.toLowerCase().includes(q) || p.state.toLowerCase().startsWith(q)));
      items = [...starts, ...has].slice(0, 8); at = items.length ? 0 : -1;
      if (items.length === 1 && items[0].name.toLowerCase() === q) { items = []; close(); return; }
      draw();
    };
    inp.addEventListener('input', (e) => { if (e.isTrusted) search(); setState(); });
    inp.addEventListener('focus', () => { if (inp.value) search(); });
    inp.addEventListener('keydown', (e) => {
      if (list.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % items.length; draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + items.length) % items.length; draw(); }
      else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); pick(items[at]); }
      else if (e.key === 'Escape') close();
      else if (e.key === 'Tab' && at >= 0 && inp.value.trim()) pick(items[at]);
    });
    list.addEventListener('mousedown', (e) => { const it = e.target.closest('[data-i]'); if (it) { e.preventDefault(); pick(items[Number(it.dataset.i)]); } });
    inp.addEventListener('blur', () => setTimeout(() => { close(); setState(); }, 120));
    const st = $('[name=state]', scope()); if (st) st.addEventListener('input', () => delete st.dataset.auto);
  }
};
// Tables marked "cards" show one card per row on phones; each cell gets its column name as a label.
BB.cardTables = (root) => root.querySelectorAll('table.cards').forEach((t) => {
  const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (!td.colSpan || td.colSpan < 2) td.dataset.label = heads[i] || ''; }));
});
BB.attachMics = (root) => {
  BB.attachCities(root);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  for (const inp of $$('[data-voice]', root)) {
    if (inp.dataset.mic) continue; inp.dataset.mic = '1';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mic'; b.title = 'Speak to type'; b.setAttribute('aria-label', 'Voice typing'); b.innerHTML = icon('mic');
    inp.parentElement.appendChild(b);
    b.onclick = () => {
      if (!SR) return BB.toast('Voice typing works in Chrome. Please type here.', true);
      if (b._rec) { b._rec.stop(); return; }
      const rec = new SR(); rec.lang = BB.voiceLang; rec.interimResults = false; rec.maxAlternatives = 1;
      b._rec = rec; b.classList.add('on');
      rec.onresult = (e) => {
        const said = Array.from(e.results).map((r) => r[0].transcript).join(' ');
        if (inp.dataset.phone !== undefined) inp.value = BB.spokenToDigits(said) || inp.value;
        else if (inp.dataset.city !== undefined) inp.value = BB.matchPlace(said); // a city is one answer, not added to
        else if (inp.tagName === 'INPUT' && /[ऀ-ॿ]/.test(said)) inp.value = (inp.value ? inp.value + ' ' : '') + BB.toRoman(said.trim());
        else inp.value = (inp.value ? inp.value + ' ' : '') + said.trim(); // notes and messages keep the Hindi as spoken
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      };
      rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') BB.toast(e.error === 'not-allowed' ? 'Allow the microphone to use voice typing.' : 'Could not hear that. Try again.', true); };
      rec.onend = () => { b.classList.remove('on'); b._rec = null; };
      rec.start();
    };
  }
};
BB.voiceSwitch = () => `<div class="voice-bar">${icon('mic', 'wa-ico')} Voice typing: <div class="seg" data-voice-seg><button type="button" data-l="en-IN" class="${BB.voiceLang === 'en-IN' ? 'on' : ''}">English</button><button type="button" data-l="hi-IN" class="${BB.voiceLang === 'hi-IN' ? 'on' : ''}">हिन्दी</button></div></div>`;
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-voice-seg] button'); if (!b) return;
  BB.voiceLang = b.dataset.l; store.set('bbhs.voice', b.dataset.l);
  $$('[data-voice-seg] button').forEach((x) => x.classList.toggle('on', x.dataset.l === BB.voiceLang));
});

// ---------- the one WhatsApp message window (8.2) ----------
BB.wa = async (o) => {
  let info;
  try { info = await BB.post('/api/wa/compose', o); } catch (e) { return BB.fail(e); }
  const fmts = info.formats; let fmt = info.suggested[0] || (o.text ? null : info.others[0]); let lang = info.person.lang || 'en';
  const vars = { ...info.vars }; let free = !fmt;
  const windowOpen = !!info.window_until;
  const fill = (f, l) => (fmts[f] ? (fmts[f][l] || fmts[f].en).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? vars[k] : m)) : '');
  const blanks = (f) => (fmts[f] ? [...new Set(((fmts[f].en || '').match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1)))] : []);
  const m = BB.modal({ title: `${waIcon} WhatsApp`, wide: true, foot: '<span class="faint small grow" data-note></span><button class="btn" data-c>Cancel</button><button class="btn wa" data-send>Send</button>', body: '<div data-body></div>' });
  const el = m.el;
  const render = () => {
    const f = fmt && fmts[fmt];
    $('[data-body]', el).innerHTML = `
      <div class="grid g2" style="gap:18px">
        <div class="stack">
          <div class="row"><b>${esc(info.person.name)}</b><span class="badge b-outline">${esc(info.person.type === 'user' ? 'Team' : info.person.type)}</span><span class="mono">${esc(info.person.id)}</span></div>
          <div class="row small"><span class="muted">Phone</span> <span class="mono">${esc(info.person.phone)}</span>${info.person.phone_hidden ? '<span class="badge b-outline tiny">hidden — another agency\'s candidate; the message still goes</span>' : ''}${info.person.opted_out ? '<span class="badge b-red">Opted out (STOP)</span>' : ''}</div>
          <div class="notice ${windowOpen ? '' : 'warn'} small">${windowOpen ? `Chat open until ${fmtT(info.window_until)} — you can type freely or send a format.` : 'Only an approved format can be sent (no message from them in the last 24 hours).'}</div>
          <div>
            <div class="row between"><b class="small">Suggested for this step</b><div class="seg" data-lang><button type="button" data-l="en" class="${lang === 'en' ? 'on' : ''}">English</button><button type="button" data-l="hi" class="${lang === 'hi' ? 'on' : ''}">Hindi</button></div></div>
            <div class="stack-sm" style="margin-top:6px">${info.suggested.length ? info.suggested.map((k) => fmtBtn(k)).join('') : '<div class="faint small">No suggestion for this step.</div>'}</div>
            <details style="margin-top:8px" ${info.suggested.length ? '' : 'open'}><summary class="small muted" style="cursor:pointer">Other formats</summary><div class="stack-sm" style="margin-top:6px">${info.others.map((k) => fmtBtn(k)).join('')}</div></details>
            ${windowOpen ? `<button type="button" class="fmt-chip ${free ? 'on' : ''}" data-free style="margin-top:6px">✎ Type a free message</button>` : ''}
          </div>
          ${f ? `<details ${blanks(fmt).some((b) => !vars[b]) ? 'open' : ''}><summary class="small muted" style="cursor:pointer">Edit the filled-in details</summary><div class="stack-sm" style="margin-top:8px">${blanks(fmt).map((b) => `<label class="field"><span class="lab">${esc(b.replace(/_/g, ' '))}</span><input data-var="${b}" value="${esc(vars[b] ?? '')}"></label>`).join('')}</div></details>` : ''}
          ${free ? `<label class="field"><span class="lab">Message</span><div class="inp-wrap"><textarea data-free-text data-voice>${esc(o.text || '')}</textarea></div></label>` : ''}
          ${f && !f.approved ? '<div class="notice bad small">This format is waiting for Meta approval and cannot be sent yet.</div>' : ''}
          ${info.quiet ? `<label class="row small"><input type="checkbox" data-later checked> Quiet hours (9 pm–9 am): send at ${fmtT(info.next9)} instead</label>` : ''}
        </div>
        <div><div class="small muted" style="margin-bottom:6px">Preview on their phone</div><div class="phone"><div class="msg out"><div class="fmt">${f ? esc(fmt) : 'Free message'}</div><div data-prev>${esc(free ? ($('[data-free-text]', el) || {}).value || o.text || '' : fill(fmt, lang))}</div>${f && f.buttons.length ? `<div class="btns">${f.buttons.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}<div class="meta">${fmtT(new Date())}</div></div></div></div>
      </div>`;
    BB.attachMics(el);
    $$('[data-fmt]', el).forEach((b) => (b.onclick = () => { fmt = b.dataset.fmt; free = false; render(); }));
    const fb = $('[data-free]', el); if (fb) fb.onclick = () => { free = true; fmt = null; render(); };
    $$('[data-lang] button', el).forEach((b) => (b.onclick = () => { lang = b.dataset.l; render(); }));
    $$('[data-var]', el).forEach((i) => (i.oninput = () => { vars[i.dataset.var] = i.value; $('[data-prev]', el).textContent = fill(fmt, lang); }));
    const ft = $('[data-free-text]', el); if (ft) ft.oninput = () => { $('[data-prev]', el).textContent = ft.value; };
    $('[data-send]', el).disabled = !!(f && !f.approved);
  };
  const fmtBtn = (k) => { const f = fmts[k]; if (!f) return ''; return `<button type="button" class="fmt-chip ${k === fmt && !free ? 'on' : ''} ${f.approved ? '' : 'pending'}" data-fmt="${k}"><span class="mono">${esc(k)}</span> <span class="badge ${f.type === 'Marketing' ? 'b-gold' : 'b-outline'} tiny">${f.type}</span>${f.approved ? '' : ' <span class="badge b-amber tiny">waiting for approval</span>'}</button>`; };
  render();
  $('[data-c]', el).onclick = m.close;
  $('[data-send]', el).onclick = async () => {
    const later = $('[data-later]', el);
    const body = { ptype: o.ptype, pid: o.pid, ap: o.ap, jb: o.jb, iv: o.iv, bl: o.bl, lang, sendLater: later ? later.checked : false };
    if (free) { body.text = ($('[data-free-text]', el) || {}).value; if (!body.text) return BB.toast('Type the message', true); } else { body.format = fmt; body.vars = vars; }
    try { const r = await BB.post('/api/wa/send', body); BB.toast(r.status === 'scheduled' ? 'Saved — sends at 9:00 am' : r.status === 'would send' ? 'Saved on the record (WhatsApp not connected: "would send")' : 'Sent'); m.close(); o.after && o.after(); } catch (e) { BB.fail(e); }
  };
};

// ---------- side panels (stack with Back) ----------
BB.stack = [];
BB.open = (type, id) => { BB.stack.push({ type, id }); BB.renderPanel(); };
BB.closePanels = () => { BB.stack = []; $('#panel-root').innerHTML = ''; };
BB.back = () => { BB.stack.pop(); BB.stack.length ? BB.renderPanel() : BB.closePanels(); };
BB.refreshPanel = () => { if (BB.stack.length) BB.renderPanel(true); };
BB.renderPanel = async (keepScroll) => {
  const top = BB.stack[BB.stack.length - 1]; const root = $('#panel-root');
  const prevScroll = keepScroll && $('.panel-b', root) ? $('.panel-b', root).scrollTop : 0;
  if (!$('.panel', root)) root.innerHTML = '<div class="panel-back"></div><div class="panel"><div class="panel-h"></div><div class="panel-b"><div class="empty">Loading…</div></div></div>';
  $('.panel-back', root).onclick = BB.closePanels;
  const h = $('.panel-h', root); const b = $('.panel-b', root);
  const render = BB.panels[top.type];
  if (!render) { b.innerHTML = '<div class="empty">Nothing to show.</div>'; return; }
  try {
    const out = await render(top.id);
    h.innerHTML = `<div class="grow">${BB.stack.length > 1 ? `<a href="#" data-back class="small">← Back to ${esc(BB.stack[BB.stack.length - 2].id)}</a>` : ''}${out.head}</div><button class="x" data-close aria-label="Close">×</button>`;
    b.innerHTML = out.body; b.scrollTop = prevScroll;
    $('[data-close]', h).onclick = BB.closePanels; const bk = $('[data-back]', h); if (bk) bk.onclick = (e) => { e.preventDefault(); BB.back(); };
    BB.attachMics(b); out.mount && out.mount(b, h);
  } catch (e) { b.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('.modal-back') && BB.stack.length) BB.closePanels(); });
// Any element with data-open="type:id" opens that panel.
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]'); if (!o || BB.portal !== 'team') return;
  e.preventDefault(); e.stopPropagation(); const [t, ...rest] = o.dataset.open.split(':'); BB.open(t, rest.join(':'));
});

// ---------- router ----------
// Clean addresses (/apply, /my-account/jobs, /team/applications). Old #links still work: they are turned into the
// clean address on arrival. Links written as href="#name" anywhere in the app are caught and opened the clean way.
BB.parseHash = () => {
  let h = location.hash.replace(/^#/, '');
  const path = location.pathname.replace(/^\/|\/$/g, '');
  if (!h) h = path + location.search;
  const [route, qs] = h.split('?');
  const parts = route.split('/');
  return { name: parts[0] || '', sub: parts.slice(1), q: Object.fromEntries(new URLSearchParams(qs || location.search.replace(/^\?/, ''))) };
};
BB.go = (to) => { const url = '/' + String(to || '').replace(/^[#/]+/, ''); if (location.pathname + location.search !== url) history.pushState(null, '', url); BB.route(); };
BB.setUrl = (to) => history.replaceState(null, '', '/' + String(to || '').replace(/^[#/]+/, ''));
const fromHash = () => { const h = location.hash.replace(/^#/, ''); if (h) { BB.setUrl(h); return true; } return false; };
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]'); if (!a || e.defaultPrevented || a.target || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const href = a.getAttribute('href');
  if (href === '#' || !(href.startsWith('#') || href === '/')) return;
  e.preventDefault(); BB.go(href === '/' ? '' : href.slice(1));
});
BB.route = () => {
  const r = BB.parseHash();
  const map = { hire: 'hire', apply: 'apply', 'my-account': 'client', 'my-profile': 'candidate', team: 'team' };
  const view = map[r.name] || 'landing';
  BB.portal = { client: 'client', candidate: 'candidate', team: 'team' }[view] || null;
  if (view !== 'team') BB.closePanels();
  document.body.dataset.view = view;
  (BB.views[view] || BB.views.landing)(r);
};
// Brand lockup: mark | BrillBrains / Hiring Solutions / tagline (as on the website).
// The full logo on wide screens, the BB mark where space is tight; the tagline names the part of the site.
BB.brand = (tagline, href = '/') => {
  const name = BB.boot.business.name || 'BrillBrains Hiring Solutions';
  return `<a class="brand" href="${href}"><img class="brand-logo" src="/img/logo.png" alt="${esc(name)}"><img class="brand-mark" src="/img/icon.png" alt="${esc(name)}">${tagline ? `<span class="brand-tag">${esc(tagline)}</span>` : ''}</a>`;
};
// Navy top bar. nav=false on the form links (they open only the form, no other menus).
BB.publicTop = (sub, nav = false) => `<header class="pub-top">${BB.brand(sub)}${nav ? `<nav class="pub-nav"><a href="#hire">For Employers</a><a href="#apply">For Candidates</a><a href="#my-account">Client login</a><a href="#my-profile">Candidate login</a></nav><details class="pub-login"><summary class="btn sm" aria-label="Menu"><span class="burger" aria-hidden="true"><i></i><i></i><i></i></span>Menu</summary><div class="pub-login-menu"><a href="#hire">For Employers</a><a href="#apply">For Candidates</a><hr><a href="#my-account">Client login</a><a href="#my-profile">Candidate login</a></div></details>` : `${sub === 'Team portal' ? '' : `<a class="btn sm top-home" href="/" aria-label="Back to home">${BB.icon('home')}<span>Home</span></a>`}<a class="btn sm help" href="https://wa.me/91${esc(BB.boot.business.support_phone)}" target="_blank" rel="noopener">${waIcon} Need help?</a>`}</header>`;
// Background behind the big headings: soft gold and sky glows drifting, small sparkles twinkling.
BB.deco = () => `<div class="deco-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="gem-bg" aria-hidden="true"><span class="orb o1"></span><span class="orb o2"></span><span class="orb o3"></span>${['s1', 's2', 's3', 's4', 's5'].map((c) => `<i class="spark ${c}"></i>`).join('')}</div>`;
// Split page: big heading + perks on the left, a card on the right.
BB.split = ({ top, eyebrow, title, lead, perks, card, foot, centered }) => { const back = eyebrow === 'Team portal' ? '' : `<a class="back-home" href="/">${BB.icon('home')} Back to home</a>`; return centered
  ? `<div class="pub">${top}<main class="pub-center"><section class="pub-intro">${back}<div class="deco-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span class="eyebrow">${esc(eyebrow)}</span><h1>${title}</h1></section><section class="card pub-card">${card}</section></main><div class="pub-foot">${foot || `© ${new Date().getFullYear()} ${esc(BB.boot.business.name)} · Your details are kept safe and used only for hiring.`}</div></div>`
  : `<div class="pub">${top}<main class="pub-split"><section class="pub-intro">${back}${BB.deco()}<span class="eyebrow">${esc(eyebrow)}</span><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}${perks && perks.length ? `<ul class="perks">${perks.map(([ic, b, s]) => `<li><span class="pi">${ic}</span><div><b>${esc(b)}</b><span>${esc(s)}</span></div></li>`).join('')}</ul>` : ''}</section><section class="card pub-card">${card}</section></main><div class="pub-foot">${foot || `© ${new Date().getFullYear()} ${esc(BB.boot.business.name)} · Your details are kept safe and used only for hiring.`}</div></div>`; };
BB.views.landing = (r) => {
  $('#app').innerHTML = `<div class="pub">${BB.publicTop('', true)}
    <main class="hero">
      <section class="pub-intro">${BB.deco()}
        <span class="eyebrow">${esc(BB.boot.business.name)}</span>
        <h1>Bringing the right <em>people</em> and companies together</h1>
        <p class="lead">Recruitment for the jewellery business — from the showroom floor to the karigar's bench. Tell us who you need, or the job you want, and our recruiters take it from there.</p>
        <ul class="trust"><li><b>Screened</b> every candidate is called and interviewed first</li><li><b>On WhatsApp</b> interviews, offers and updates on your phone</li><li><b>Free for candidates</b> employers pay only when someone joins</li></ul>
      </section>
      <section class="card pub-card" data-leadcard></section>
    </main>
    <div class="signin-row"><span class="muted">Already registered?</span><a href="#my-account">Client login</a><a href="#my-profile">Candidate login</a></div>
    <div class="pub-foot">© ${new Date().getFullYear()} ${esc(BB.boot.business.name)}</div></div>`;
  BB.leadFormCard($('[data-leadcard]'), 'job', (r && r.q) || {});
};
BB.start = async () => {
  try { BB.boot = await (await fetch('/api/bootstrap')).json(); } catch { $('#app').innerHTML = '<div class="boot">Cannot reach the server.</div>'; return; }
  document.documentElement.style.setProperty('--brand', BB.boot.business.primary);
  document.title = BB.boot.business.short + ' Hiring';
  const dl = document.createElement('datalist'); dl.id = 'cities'; dl.innerHTML = BB.boot.cities.map((c) => `<option value="${esc(c)}">`).join(''); document.body.appendChild(dl);
  // The test copy says so on every page, so nobody mistakes it for the live one.
  if (BB.boot.env !== 'live') document.body.insertAdjacentHTML('beforeend', `<div class="env-ribbon" title="Sample data and test WhatsApp — not the live copy">${esc(BB.boot.env)} copy</div>`);
  window.addEventListener('popstate', BB.route);
  window.addEventListener('hashchange', () => { if (fromHash()) BB.route(); });
  fromHash(); BB.route();
};
// Job list grouped by its 11 groups, for selects.
BB.jobOptions = (selected, withOther = true, industry) => {
  const list = (industry && BB.boot.industries && BB.boot.industries[industry]) || BB.boot.jobs;
  const groups = {}; for (const j of list) (groups[j.group] = groups[j.group] || []).push(j.title);
  return `<option value="">Choose…</option>${Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((t) => `<option ${t === selected ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('')}${withOther ? `<option value="Other" ${selected === 'Other' ? 'selected' : ''}>Other</option>` : ''}`;
};
BB.tracker = (step, result) => {
  const i = BB.boot.steps.indexOf(step);
  return `<div class="tracker ${result && result !== 'open' && result !== 'Hired' ? 'closed' : ''}">${BB.boot.steps.map((s, k) => `<div class="s ${k < i || (k === i && result === 'Hired') ? 'done' : ''} ${k === i && result !== 'Hired' ? 'cur' : ''}">${esc(s)}</div>`).join('')}</div>`;
};
