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
    inner = `<div class="inp-wrap"><input name="${d.name}" type="${d.type || 'text'}" value="${esc(v)}" ${voice ? `data-voice ${d.phone ? 'data-phone' : ''}` : ''} ${d.list ? `list="${d.list}"` : ''} placeholder="${esc(d.placeholder || '')}" ${d.attrs || ''}></div>`;
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
// "nine eight double two…" or Hindi digits → 10 digits
BB.spokenToDigits = (text) => {
  let s = String(text).toLowerCase().replace(/[०-९]/g, (c) => HI_DIGITS[c]).replace(/[,.\-+()]/g, ' ');
  const out = []; let rep = 1;
  for (const tok of s.split(/\s+/).filter(Boolean)) {
    if (REPEAT[tok]) { rep = REPEAT[tok]; continue; }
    if (/^\d+$/.test(tok)) { out.push(tok.length === 1 ? tok.repeat(rep) : tok); rep = 1; continue; }
    if (WORD_DIGITS[tok] !== undefined) { out.push(String(WORD_DIGITS[tok]).repeat(rep)); rep = 1; }
  }
  let d = out.join('');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(-10);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
};
BB.attachMics = (root) => {
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
        else inp.value = (inp.value ? inp.value + ' ' : '') + said.trim();
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
BB.parseHash = () => {
  let h = location.hash.replace(/^#/, '');
  const path = location.pathname.replace(/^\/|\/$/g, '');
  if (!h && path) h = path + location.search;
  const [route, qs] = h.split('?');
  const parts = route.split('/');
  return { name: parts[0] || '', sub: parts.slice(1), q: Object.fromEntries(new URLSearchParams(qs || location.search.replace(/^\?/, ''))) };
};
BB.go = (hash) => { if (location.hash === '#' + hash) BB.route(); else location.hash = hash; };
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
BB.brand = (tagline, href = '#') => {
  const name = BB.boot.business.name || 'BrillBrains Hiring Solutions';
  const [first, ...rest] = name.split(' ');
  return `<a class="brand" href="${href}"><img src="/img/icon.svg" alt=""><span class="bt"><b>${esc(first)}</b><span>${esc(rest.join(' '))}</span><small>${esc(tagline || 'Effective Recruitment Services')}</small></span></a>`;
};
// Navy top bar. nav=false on the form links (they open only the form, no other menus).
BB.publicTop = (sub, nav = false) => `<header class="pub-top">${BB.brand(sub)}${nav ? `<nav class="pub-nav"><a href="#hire">For Employers</a><a href="#apply">For Candidates</a><a href="#my-account">Client login</a><a href="#my-profile">My profile</a></nav><a class="btn gold" href="#team">Team login</a>` : `<a class="btn sm help" href="https://wa.me/91${esc(BB.boot.business.support_phone)}" target="_blank" rel="noopener">${waIcon} Need help?</a>`}</header>`;
// Line art from the website: fine arcs bottom-left, a row of dots top-left.
BB.deco = () => `<div class="deco-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div><svg class="deco-lines" viewBox="0 0 340 340" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${110 + i * 26} C 90 ${150 + i * 20}, 170 ${230 + i * 10}, 260 340" opacity="${0.35 + i * 0.06}"/>`).join('')}</svg>`;
// Split page: big heading + perks on the left, a card on the right.
BB.split = ({ top, eyebrow, title, lead, perks, card, foot }) => `<div class="pub">${top}<main class="pub-split"><section class="pub-intro">${BB.deco()}<span class="eyebrow">${esc(eyebrow)}</span><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}${perks && perks.length ? `<ul class="perks">${perks.map(([ic, b, s]) => `<li><span class="pi">${ic}</span><div><b>${esc(b)}</b><span>${esc(s)}</span></div></li>`).join('')}</ul>` : ''}</section><section class="card pub-card">${card}</section></main><div class="pub-foot">${foot || `© ${new Date().getFullYear()} ${esc(BB.boot.business.name)} · Your details are kept safe and used only for hiring.`}</div></div>`;
BB.views.landing = () => {
  const doors = [
    ['hire', 'brief', 'I want to hire', 'Tell us the staff you need. We send matching profiles.'],
    ['apply', 'users', 'I want a job', 'Showrooms, workshops and offices are hiring near you.'],
    ['my-account', 'building', 'Client account', 'Job openings, candidates, interviews and bills.'],
    ['my-profile', 'home', 'Candidate profile', 'Your applications, interviews and offers.'],
    ['team', 'key', 'Team portal', 'BrillBrains and partner agencies.'],
  ];
  $('#app').innerHTML = `<div class="pub">${BB.publicTop('', true)}
    <main class="hero">
      <section class="pub-intro">${BB.deco()}
        <span class="eyebrow">${esc(BB.boot.business.name)}</span>
        <h1>Bringing the right <em>people</em> and companies together</h1>
        <p class="lead">Recruitment for the jewellery trade — from the showroom floor to the karigar's bench. One place for businesses that hire, people who want work, and the teams that bring them together.</p>
        <div class="row" style="gap:12px"><a class="btn gold lg" href="#hire">I want to hire</a><a class="btn primary lg" href="#apply">I want a job</a></div>
      </section>
      <div class="hero-art" aria-hidden="true"><div class="orb"></div>
        <div class="float f1"><span class="av" style="background:var(--navy)">SE</span><div><b>Sales Executive</b><span>Mumbai · 6 profiles sent</span></div></div>
        <div class="float f2"><span class="av" style="background:var(--mustard)">✓</span><div><b>Offer accepted</b><span>Joins on Monday</span></div></div>
        <div class="float f3"><span class="av" style="background:var(--royal)">92</span><div><b>Strong match</b><span>Goldsmith · Jaipur</span></div></div>
      </div>
    </main>
    <section class="doors">${doors.map(([h, ic, t, s]) => `<a class="card door" href="#${h}"><span class="ic">${icon(ic)}</span><b>${t}</b><span class="muted small">${s}</span><span class="go">Open →</span></a>`).join('')}</section>
    <div class="pub-foot">© ${new Date().getFullYear()} ${esc(BB.boot.business.name)}</div></div>`;
};
BB.start = async () => {
  try { BB.boot = await (await fetch('/api/bootstrap')).json(); } catch { $('#app').innerHTML = '<div class="boot">Cannot reach the server.</div>'; return; }
  document.documentElement.style.setProperty('--brand', BB.boot.business.primary);
  document.title = BB.boot.business.short + ' Hiring';
  const dl = document.createElement('datalist'); dl.id = 'cities'; dl.innerHTML = BB.boot.cities.map((c) => `<option value="${esc(c)}">`).join(''); document.body.appendChild(dl);
  // The test copy says so on every page, so nobody mistakes it for the live one.
  if (BB.boot.env !== 'live') document.body.insertAdjacentHTML('beforeend', `<div class="env-ribbon" title="Sample data and test WhatsApp — not the live copy">${esc(BB.boot.env)} copy</div>`);
  window.addEventListener('hashchange', BB.route);
  BB.route();
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
