/* The working process on screen: client call, agreement, email, online lookup, WhatsApp group, screening with AI,
   offer stages, invoices, books, and the messages on hold. Panels and pages call into BB.flow. */
(() => {
  const { $, $$, esc, inr, fmtD, fmtDT, field, scoreBadge } = BB;
  const P = BB.pages;
  const me = () => BB.me.user;
  const canAdmin = () => !me().accounts_only;
  const done = (msg) => { if (msg) BB.toast(msg); if (BB.refreshPanel) BB.refreshPanel(); if (BB.refreshPage) BB.refreshPage(); };
  const act = async (fn, msg) => { try { const r = await fn(); done(typeof msg === 'function' ? msg(r) : msg); return r; } catch (e) { BB.fail(e); return null; } };
  // Several files at once, read one by one.
  BB.pickFiles = (accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png') => new Promise((resolve) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = true;
    i.onchange = () => resolve([...i.files]); i.click();
  });
  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, base64: String(r.result).split(',')[1] }); r.onerror = rej; r.readAsDataURL(f); });

  const F = BB.flow = {};

  // ---------- client: from lead to active client ----------
  const callRoleRows = (x) => `<div class="flow-call-roles">${x.call_roles.map((l, i) => `<div class="call-role"><div class="row between"><span class="grow"><b>${esc(l.role)}</b> · ${l.openings} ${l.openings === 1 ? 'opening' : 'openings'}${l.location ? ` · ${esc(l.location)}` : ''}${l.department ? ` · ${esc(l.department)}` : ''}</span>${l.job_id ? `<button class="btn sm" data-fopen="${esc(l.job_id)}">${esc(l.job_id)}</button>` : `<button class="btn sm" data-fline="${x.id}:${i}">Open job</button>`}</div>${l.skills || l.duties || l.notes ? `<dl class="kv" style="margin-top:6px">${[['Skills', l.skills], ['Responsibilities', l.duties], ['Notes', l.notes]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}</div>`).join('')}</div>`;
  // One card per role on the call: each has its own count, place, skills, duties and notes.
  const roleList = () => { const seen = new Map(); for (const j of [...BB.boot.jobs, ...(BB.addedRoles || [])]) if (!seen.has(j.title.toLowerCase())) seen.set(j.title.toLowerCase(), j); return [...seen.values()]; };
  const deptList = () => [...new Set([...(BB.boot.departments || []), ...BB.boot.jobs.map((j) => j.dept)].filter(Boolean))];
  const roleRow = (l = {}) => `<div class="role-card" data-frole><div class="role-head"><b data-rtitle>Role</b><button type="button" class="role-x" data-frm aria-label="Remove this role" title="Remove this role">×</button></div>
    <div class="role-grid"><label class="field role-name"><span class="lab">Role</span><div class="cbx"><input data-r="role" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" placeholder="Start typing a role" value="${esc(l.role || '')}"><div class="cbx-pop" role="listbox" hidden></div></div></label>
    <label class="field"><span class="lab">Openings</span><input data-r="openings" type="number" min="1" inputmode="numeric" value="${esc(l.openings || '')}"></label>
    <label class="field"><span class="lab">Location</span><input data-r="location" value="${esc(l.location || '')}"></label>
    <label class="field"><span class="lab">Department <span class="opt">(optional)</span></span><select data-r="department"><option value="">Choose…</option>${deptList().map((d) => `<option ${d === l.department ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label></div>
    ${field({ name: 'r_skills', label: 'Skills required', opt: true, attrs: 'data-r="skills"', value: l.skills || '' })}
    ${field({ name: 'r_duties', label: 'Roles and responsibilities expected', type: 'textarea', opt: true, attrs: 'data-r="duties"', value: l.duties || '' })}
    ${field({ name: 'r_notes', label: 'Other notes', type: 'textarea', opt: true, attrs: 'data-r="notes"', value: l.notes || '' })}</div>`;
  // The role box: suggestions as you type, best matches first, and a typed role can be added to the list.
  const wireCombo = (card) => {
    const inp = $('[data-r=role]', card); const pop = $('.cbx-pop', card); let items = []; let at = -1;
    const close = () => { pop.hidden = true; inp.setAttribute('aria-expanded', 'false'); at = -1; };
    const pick = (i) => { const it = items[i]; if (!it) return; inp.value = it.title; if (it.fresh) { BB.addedRoles = [...(BB.addedRoles || []), { title: it.title, group: 'Added roles', dept: '' }]; BB.toast(`${it.title} added to the role list`); } const d = $('[data-r=department]', card); if (it.dept && !d.value && [...d.options].some((o) => o.value === it.dept)) d.value = it.dept; close(); inp.dispatchEvent(new Event('input', { bubbles: true })); close(); $('[data-r=openings]', card).focus(); };
    const draw = () => { pop.innerHTML = items.map((x, i) => `<button type="button" class="cbx-opt ${i === at ? 'on' : ''}" role="option" data-i="${i}">${x.fresh ? `<span>Add “${esc(x.title)}” as a new role</span>` : `<span>${esc(x.title)}</span><span class="cbx-group">${esc(x.group)}</span>`}</button>`).join(''); pop.hidden = !items.length; inp.setAttribute('aria-expanded', String(!pop.hidden)); const on = $('.cbx-opt.on', pop); if (on) on.scrollIntoView({ block: 'nearest' }); };
    const show = () => { const q = inp.value.trim().toLowerCase(); const all = roleList(); const hit = q ? all.filter((j) => j.title.toLowerCase().includes(q)).sort((a, b) => a.title.toLowerCase().indexOf(q) - b.title.toLowerCase().indexOf(q) || a.title.length - b.title.length) : all; items = hit.slice(0, 40); if (q && !all.some((j) => j.title.toLowerCase() === q)) items.push({ title: inp.value.trim(), fresh: true }); at = -1; draw(); };
    inp.onfocus = show; inp.oninput = show; inp.onblur = () => setTimeout(close, 120);
    pop.onmousedown = (e) => { e.preventDefault(); const b = e.target.closest('.cbx-opt'); if (b) pick(Number(b.dataset.i)); };
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (pop.hidden) show(); at = (at + (e.key === 'ArrowDown' ? 1 : items.length - 1 + (at < 0 ? 1 : 0))) % Math.max(items.length, 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!pop.hidden) pick(at < 0 ? 0 : at); }
      else if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close(); }
    };
  };
  const readRoles = (box) => $$('[data-frole]', box).map((r) => Object.fromEntries($$('[data-r]', r).map((i) => [i.dataset.r, i.value.trim()])));
  const wireRoles = (box) => {
    const sum = () => { const t = readRoles(box).reduce((n, x) => n + (Number(x.openings) || 0), 0); $('[data-ftotal]', box).textContent = t ? `Total openings: ${t}` : ''; const cards = $$('[data-frole]', box); cards.forEach((k, i) => { $('[data-rtitle]', k).textContent = cards.length > 1 ? `Role ${i + 1}` : 'Role'; $('[data-frm]', k).hidden = cards.length === 1; }); };
    box.oninput = sum;
    box.onclick = (e) => {
      if (e.target.closest('[data-frm]')) { e.target.closest('[data-frole]').remove(); sum(); }
      if (e.target.closest('[data-fadd]')) { const all = readRoles(box); const last = all[all.length - 1] || {}; $('[data-frows]', box).insertAdjacentHTML('beforeend', roleRow({ location: last.location })); const n = $$('[data-frole]', box).pop(); wireCombo(n); BB.attachMics(n); sum(); $('[data-r=role]', n).focus(); n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    };
    $$('[data-frole]', box).forEach(wireCombo); sum();
  };
  // What the web says about a client, laid out to read during a call.
  const webLink = (u) => (/^https?:\/\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''))}</a>` : esc(u));
  const clientInfo = (o) => {
    const phones = String(o.phone || '').split(/[;,/]/).map((x) => x.trim()).filter(Boolean);
    const tile = (l, v) => (v ? `<div class="ci-tile"><div class="ci-lab">${l}</div><div class="ci-val">${v}</div></div>` : '');
    const links = [['Website', o.website], ['LinkedIn', o.linkedin], ['Instagram', o.instagram], ['Facebook', o.facebook]].filter(([, v]) => /^https?:\/\//i.test(v || ''));
    const talk = Array.isArray(o.talk_points) ? o.talk_points.filter(Boolean) : [];
    return `<details class="sec ci" open><summary><span class="ci-ico">${BB.icon('search')}</span><span class="grow"><b>Client info</b><span class="small muted"> · found ${fmtD(o.at)}, please check before using</span></span><span class="ci-chev" aria-hidden="true"></span></summary>
      ${o.about ? `<p class="ci-about">${esc(o.about)}</p>` : ''}
      ${talk.length ? `<div class="ci-talk"><div class="ci-lab">Talk about on the call</div><ul>${talk.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${o.hiring ? `<div class="ci-hire"><div class="ci-lab">Signs they are hiring</div><div class="ci-val">${esc(o.hiring)}</div></div>` : ''}
      ${links.length ? `<div class="ci-links">${links.map(([l, u]) => `<a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">${l} ↗</a>`).join('')}</div>` : ''}
      <div class="ci-grid">${tile('Sells to', esc(o.customers || ''))}${tile('Products', esc(o.products || ''))}${tile('Showrooms', esc(o.showrooms || ''))}${tile('Locations', esc(o.branches || ''))}${tile('Employees', esc(o.team_size || ''))}${tile('Scale', esc(o.operations || ''))}${tile('Owners', esc(o.owners || ''))}${tile('Started', esc(o.est_year || ''))}${tile('Recent news', esc(o.news || ''))}${tile('Phone', phones.map((p) => `<a href="tel:${esc(p.replace(/[^\d+]/g, ''))}">${esc(p)}</a>`).join('<br>'))}${tile('Email', o.email ? `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : '')}${tile('Address', esc(o.address || ''))}${tile('Business', esc(o.kind || ''))}</div>
      <div class="ci-foot"><span class="ci-cost">About ₹${o.cost_inr || 1} charged for this search</span><span class="row"><button class="btn sm" data-flook>Search again · about ₹${o.cost_inr || 1}</button><button class="btn sm primary" data-fuse>Use these details</button></span></div></details>`;
  };
  // The client's past with us: counts first, then roles, hires and every interaction.
  F.clientHistory = (c) => {
    const p = c.past || {}; const tile = (l, v) => `<div class="ci-tile"><div class="ci-lab">${l}</div><div class="hist-num">${v}</div></div>`;
    const chips = (l) => (l || []).map((x) => `<span class="badge b-outline">${esc(x)}</span>`).join('') || '<span class="faint small">None yet.</span>';
    return `<div class="sec"><h3>Summary</h3><div class="hist-grid">${tile('Job openings', p.jobs || 0)}${tile('Open now', p.open || 0)}${tile('Candidates sent', p.sent || 0)}${tile('Candidates hired', p.hires || 0)}${p.fees === null || p.fees === undefined ? '' : tile('Fees billed', inr(p.fees))}</div></div>
      <div class="sec"><h3>Roles hired for</h3><div class="row">${chips(p.roles_hired)}</div></div>
      <div class="sec"><h3>Roles asked for</h3><div class="row">${chips(p.roles_asked)}</div></div>
      ${(p.hired || []).length ? `<div class="sec"><h3>Candidates hired</h3>${p.hired.map((x) => `<div class="hist-row"><span class="grow"><b>${esc(x.name)}</b> · ${esc(x.role)}</span><span class="small muted">${fmtD(x.date)}</span></div>`).join('')}</div>` : ''}
      <div class="sec"><h3>Past interactions</h3>${(p.timeline || []).map((x) => `<div class="hist-row"><span class="badge b-outline">${esc(x.kind)}</span><span class="grow small">${esc(x.text)}${x.by ? ` <span class="faint">· ${esc(x.by)}</span>` : ''}</span><span class="small muted nw">${fmtD(x.at)}</span></div>`).join('') || '<div class="faint small">Nothing yet.</div>'}</div>`;
  };
  F.client = (c) => {
    const a = c.activation || {};
    return `      <div class="row" style="margin-bottom:14px"><button class="btn sm primary" data-fcall>Client call notes</button><button class="btn sm" data-fmail="pitch">Send pitch deck</button><button class="btn sm" data-fagree>Agreement${a.contract ? ' <span class="badge b-green tiny">Signed</span>' : ''}</button><button class="btn sm" data-fmail="kyc">Ask for KYC</button><button class="btn sm" data-fmail="general">Email</button><button class="btn sm" data-fthanks>Thank-you message</button><button class="btn sm" data-flook>${BB.icon('search')} Client info</button><button class="btn sm" data-fgroup>WhatsApp group</button></div>`;
  };
  F.clientMore = (c) => {
    const g = c.wa_group || {}; const o = (c.extra || {}).online; const k = c.kyc || {}; const a = c.activation || {};
    const docs = [['Signed agreement', a.contract], ['GST certificate', k.gst], ['Business PAN', k.pan], ['Owner ID', k.owner_id]];
    return `<div class="sec"><h3>Papers received</h3><div class="row">${docs.map(([l, on]) => `<span class="badge ${on ? 'b-green' : 'b-outline'}">${on ? '✓ ' : ''}${l}</span>`).join('')}</div></div>
      ${BB.callsBlock({ party: 'client', client_id: c.id, apps: c.call_apps }, c.call_log, c.whatsapp)}
      ${(c.calls || []).length ? `<div class="sec"><h3>Requirements from calls</h3><div class="stack-sm">${c.calls.map((x) => `<div class="card pad small"><div class="row between"><span class="faint">${fmtDT(x.at)} · ${esc(x.by)}</span>${x.call_roles ? (x.call_roles.filter((l) => !l.job_id).length ? `<button class="btn sm" data-fjobs="${x.id}">Open ${x.call_roles.filter((l) => !l.job_id).length > 1 ? 'all as draft jobs' : 'as a draft job'}</button>` : '') : `<button class="btn sm" data-fjob="${x.id}">Open a job from this</button>`}</div>${x.call_roles ? callRoleRows(x) : ''}<dl class="kv" style="margin-top:6px">${[...(x.call_roles ? [] : [['Openings', x.openings], ['Location', x.location], ['Department', x.department], ['Roles', x.roles]]), ['Skills', x.skills], ['Responsibilities', x.duties], ['Notes', x.notes]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`).join('')}</div></div>` : ''}
      ${o ? clientInfo(o) : ''}
      ${g.name ? `<div class="sec"><h3>WhatsApp group</h3><div class="small"><b>${esc(g.name)}</b> ${g.created ? '<span class="badge b-green">Created</span>' : '<span class="badge b-outline">To create</span>'}${g.link ? ` · <a href="${esc(g.link)}" target="_blank" rel="noopener">invite link</a>` : ''}</div></div>` : ''}
      ${(c.mails || []).length ? `<div class="sec"><h3>Emails</h3>${c.mails.map((m) => `<div class="small">${fmtDT(m.at)} · ${esc(m.subject)} <span class="badge ${m.status === 'received' ? 'b-green' : 'b-outline'}">${m.status === 'received' ? 'Client replied' : esc(m.status)}</span></div>`).join('')}</div>` : ''}`;
  };
  // Everything about one client's agreement in one place: get it, edit it, send it, file the signed copy.
  const agreementBox = (c) => {
    const own = (c.files || []).find((f) => f.type === 'agreement_client'); const signed = (c.files || []).find((f) => f.type === 'contract_signed');
    const row = (t, s, btns) => `<div class="agr-row"><div class="grow"><b>${t}</b><div class="small muted">${s}</div></div><div class="row agr-btns">${btns}</div></div>`;
    BB.modal({ title: `Agreement · ${esc(c.company)}`, wide: true,
      body: row('Agreement for this client', own ? `Edited copy: ${esc(own.name)}, ${fmtD(own.at)}, ${esc(own.uploaded_by || '')}` : 'Standard Recruitment Agreement', '<button class="btn sm" data-agdl>Download</button>')
        + row('Edit and re-upload', 'Download it, make the changes in Word, then upload it here. Only this client gets your edited copy.', `<button class="btn sm" data-agup>${own ? 'Replace edited copy' : 'Upload edited copy'}</button>${own ? '<button class="btn sm" data-agstd>Use standard</button>' : ''}`)
        + row('Send to the client', c.email || (c.extra || {}).hr_email ? `Goes to ${esc(c.email || c.extra.hr_email)} with the agreement above attached.` : 'Add the client\'s email in the next step.', '<button class="btn sm primary" data-agsend>Send agreement</button>')
        + row('Signed agreement', signed ? `${esc(signed.name)}, ${fmtD(signed.at)}` : (c.activation || {}).contract ? 'Signed, no file on record' : 'Not received yet. Upload it here when it comes in, and the client becomes active.', `${signed ? `<button class="btn sm" data-agsee="${signed.id}">Open</button>` : ''}<button class="btn sm" data-agsigned>${signed ? 'Replace signed copy' : 'Upload signed copy'}</button>`),
      foot: '<button class="btn" data-cancel>Close</button>',
      onMount: (el, close) => {
        const q = (s) => $(s, el); q('[data-cancel]').onclick = close;
        q('[data-agdl]').onclick = () => BB.download(own ? `/api/files/${own.id}` : '/api/agreement/file');
        q('[data-agsend]').onclick = () => { close(); F.composeMail([c.id], 'contract', 'Send agreement'); };
        const put = async (type, accept, msg) => { const f = await BB.pickFile(accept); if (f) { close(); act(() => BB.post('/api/files', { record_id: c.id, type, ...f }), msg); } };
        q('[data-agup]').onclick = () => put('agreement_client', '.docx,.pdf', 'Edited agreement saved for this client');
        q('[data-agsigned]').onclick = () => put('contract_signed', undefined, 'Signed agreement saved');
        const std = q('[data-agstd]'); if (std) std.onclick = () => { close(); act(() => BB.post(`/api/files/${own.id}/remove`), 'Back to the standard agreement'); };
        const see = q('[data-agsee]'); if (see) see.onclick = () => BB.openFile(see.dataset.agsee);
      } });
  };
  F.composeMail = async (ids, kind, label, job) => {
    const t = await BB.api(`/api/email-templates?ids=${ids.join(',')}`); const tp = t.templates[kind] || t.templates.general;
    const contract = kind === 'contract'; const doc = { contract: 'Recruitment Agreement', pitch: 'BrillBrains Hiring Solutions Pitch Deck', jd: 'Job description (PDF)', cv: 'Candidate CV, without phone and email' }[kind]; const held = t.held && !doc; const one = t.recipients.length === 1 ? t.recipients[0] : null; const none = t.recipients.filter((x) => !x.email);
    const who = `<div class="small muted">${t.from ? `From: <b>${esc(t.from)}</b>` : ''}${one ? '' : `<div>To: each client's saved email (${t.recipients.length - none.length} of ${t.recipients.length})${none.length ? `. No email for ${none.slice(0, 3).map((x) => esc(x.company)).join(', ')}${none.length > 3 ? ` and ${none.length - 3} more` : ''}` : ''}</div>`}</div>`;
    const v = await BB.ask({ title: label, wide: true, fields: [who, ...(one ? [{ name: 'to', label: 'To', type: 'email', value: one.email }] : []), { name: 'subject', label: 'Subject', value: tp.subject }, { name: 'body', label: 'Message', type: 'textarea', value: tp.body, voice: false }, doc ? `<div class="small muted">Attached: ${contract ? (one ? esc(one.agreement || doc) : `${doc}, or the client's edited copy`) : doc}</div>` : { name: 'attach_agreement', label: 'Attach the Recruitment Agreement', type: 'check' }], ok: held ? 'Save for later' : 'Send', submit: (x) => BB.post('/api/clients/email', { ids, kind, job, ...x }) });
    if (v) done(`${v.done} of ${ids.length} ${v.held ? 'saved' : 'sent'}${v.skipped.length ? ` · ${v.skipped[0]}` : ''}`);
  };
  // Voice notes on a call: speak or type, and the roles in it wait on the client, ready to become jobs.
  const wireVoice = (m) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let rec = null; let on = false;
    const box = $('[data-vtext]', m); const mic = $('[data-vmic]', m); const state = $('[data-vstate]', m); const live = $('[data-vlive]', m);
    const show = (x) => { mic.classList.toggle('on', x); state.textContent = x ? 'Listening… tap to stop' : 'Tap the mic and speak'; };
    const stop = () => { on = false; if (rec) { try { rec.stop(); } catch { /* already stopped */ } } };
    const start = () => { rec = new SR(); rec.lang = $('[data-vlang]', m).value; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => { let now = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) box.value = `${box.value}${box.value && !/\s$/.test(box.value) ? ' ' : ''}${t.trim()}`; else now += t; } live.textContent = now; };
      rec.onerror = (e) => { if (e.error === 'not-allowed') { on = false; show(false); BB.toast('Allow the microphone to record.', true); } };
      rec.onend = () => { live.textContent = ''; if (on && box.isConnected) { try { rec.start(); } catch { on = false; show(false); } } else show(false); }; // the browser stops after a pause; keep going until tapped
      rec.start(); };
    mic.onclick = () => { if (!SR) return BB.toast('Recording works in Chrome or Edge. You can type here instead.', true); if (on) stop(); else { on = true; show(true); start(); } };
    return stop;
  };
  F.clientMount = (el, c) => {
    const on = (s, fn) => { const b = $(s, el); if (b) b.onclick = fn; };
    on('[data-fcall]', async () => {
      const { script } = await BB.api('/api/call-script'); let stopMic = () => {};
      setTimeout(() => { const box = $('.modal [data-froles]'); if (!box) return; wireRoles(box); stopMic = wireVoice($('.modal'));
        const fill = $('.modal [data-vfill]'); fill.onclick = async () => { const text = $('.modal [data-vtext]').value.trim(); if (text.length < 10) return BB.toast('Say or type the notes first', true); fill.disabled = true; fill.textContent = 'Reading…';
          try { const r = await BB.post(`/api/clients/${c.id}/read-notes`, { text }); if (!r.roles.length) BB.toast('No roles found in the notes', true); else { $('[data-frows]', box).innerHTML = r.roles.map(roleRow).join(''); $$('[data-frole]', box).forEach(wireCombo); BB.attachMics(box); box.dispatchEvent(new Event('input')); BB.toast(`${r.roles.length} role${r.roles.length === 1 ? '' : 's'} filled in. Check them before saving.`); } } catch (e) { BB.fail(e); }
          fill.disabled = false; fill.textContent = 'Fill roles from notes'; }; }, 0);
      const v = await BB.ask({ title: 'Client call notes', wide: true, fields: [`<div class="notice small flow-script">${esc(script)}</div>`,
        `<div class="vn-box"><div class="vn-top"><button type="button" class="vn-mic" data-vmic aria-label="Start recording">${BB.icon('mic')}</button><div class="grow"><b data-vstate>Tap the mic and speak</b><div class="vn-lang"><select data-vlang aria-label="Language"><option value="en-IN">English</option><option value="hi-IN" ${BB.voiceLang === 'hi-IN' ? 'selected' : ''}>Hindi</option></select></div></div><button type="button" class="btn sm" data-vfill>Fill roles from notes</button></div><label class="field"><span class="lab">Notes from the call</span><textarea data-vtext rows="4"></textarea></label><div class="small muted" data-vlive></div></div>`,
        `<div class="field" data-froles data-f="call_roles"><div data-frows>${roleRow({ location: c.city || '' })}</div><div class="row between" style="margin-top:8px"><button type="button" class="btn sm" data-fadd>+ Add another role</button><span class="small muted" data-ftotal></span></div></div>`], ok: 'Save call notes', submit: (x) => { stopMic(); return BB.post(`/api/clients/${c.id}/calls`, { call_roles: readRoles($('.modal [data-froles]')), notes: $('.modal [data-vtext]').value }); } });
      if (v) done(v.roles ? `Saved with ${v.roles} role${v.roles === 1 ? '' : 's'}: open jobs from Client calls` : 'Call notes saved');
    });
    $$('[data-fmail]', el).forEach((b) => (b.onclick = () => F.composeMail([c.id], b.dataset.fmail, b.textContent)));
    on('[data-fthanks]', () => act(() => BB.post(`/api/clients/${c.id}/thanks`), (r) => (r.held ? 'Saved: messages are off for now' : 'Sent')));
    on('[data-fagree]', () => agreementBox(c));
    $$('[data-flook]', el).forEach((lk) => (lk.onclick = async () => {
      const v = await BB.ask({ title: 'Client info', fields: [{ name: 'name', label: 'Business name', value: c.company }, { name: 'city', label: 'City', value: c.city || '', opt: true }, { name: 'address', label: 'Address', opt: true }], ok: 'Search', submit: (x) => BB.post(`/api/clients/${c.id}/lookup`, x) });
      if (v) done('Client info is ready below');
    }));
    on('[data-fuse]', () => { const o = c.extra.online; const ex = { ...c.extra }; const n = parseInt(String(o.showrooms || '').replace(/[^\d]/g, ''), 10); const scale = ['Single city', 'Several cities', 'Several states', 'Pan-India', 'International'].find((x) => String(o.operations || '').toLowerCase().includes(x.toLowerCase())); for (const [k, s] of [['website', o.website], ['branches', o.branches], ['est_year', o.est_year], ['owner_name', o.owners], ['address', o.address], ['team_size', o.team_size], ['showrooms', n > 0 ? n : null], ['op_scale', scale]]) if (s && (ex[k] === undefined || ex[k] === null || ex[k] === '')) ex[k] = s; const bt = /both/i.test(o.customers || '') ? 'Both' : /b2b/i.test(o.customers || '') ? 'Manufacturer B2B' : /b2c/i.test(o.customers || '') ? 'Showroom B2C' : null; act(() => BB.patch(`/api/clients/${c.id}`, { extra: ex, ...(!c.email && o.email ? { email: o.email } : {}), ...(!c.business_type && bt ? { business_type: bt } : {}) }), 'Saved on the client'); });
    on('[data-fgroup]', () => groupDialog(c));
    $$('[data-fopen]', el).forEach((b) => (b.onclick = () => BB.open('job', b.dataset.fopen)));
    $$('[data-fjobs]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/clients/${c.id}/calls/${b.dataset.fjobs}/jobs`), (r) => `${r.jobs.length} draft ${r.jobs.length === 1 ? 'job' : 'jobs'} opened: add the salary on each`)));
    $$('[data-fline]', el).forEach((b) => (b.onclick = () => { const [id, i] = b.dataset.fline.split(':'); const x = c.calls.find((k) => String(k.id) === id); const l = x.call_roles[i]; BB.newJob(c.id, { title: l.role, city: l.location, openings: l.openings, skills: String(l.skills || x.skills || '').split(',').map((s) => s.trim()).filter(Boolean), duties: l.duties || x.duties, department: l.department, notes: [l.notes, x.notes].filter(Boolean).join(' · '), call_id: x.id, call_line: Number(i) }); }));
    $$('[data-fjob]', el).forEach((b) => (b.onclick = () => { const x = c.calls.find((k) => String(k.id) === b.dataset.fjob); BB.newJob(c.id, { title: String(x.roles || '').split(/[,\n]/)[0].trim(), city: x.location, openings: parseInt(x.openings, 10) || 1, skills: String(x.skills || '').split(',').map((s) => s.trim()).filter(Boolean), duties: x.duties, notes: x.notes }); }));
  };
  // The group's picture: the client's logo in a ring, 640 × 640, ready to set on WhatsApp.
  function groupDp(logo, company) {
    return new Promise((resolve, reject) => {
      const img = new Image(); img.onerror = () => reject(new Error('That file could not be read as an image')); img.onload = () => {
        const n = 640; const cv = document.createElement('canvas'); cv.width = n; cv.height = n; const x = cv.getContext('2d');
        const g = x.createLinearGradient(0, 0, n, n); g.addColorStop(0, '#101A3A'); g.addColorStop(1, '#22305F'); x.fillStyle = g; x.fillRect(0, 0, n, n);
        x.fillStyle = '#fff'; x.beginPath(); x.arc(n / 2, 270, 200, 0, Math.PI * 2); x.fill(); x.strokeStyle = '#D19B12'; x.lineWidth = 10; x.stroke();
        const s = Math.min(290 / img.width, 290 / img.height); const w = img.width * s; const h = img.height * s; x.drawImage(img, (n - w) / 2, 270 - h / 2, w, h);
        x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = '600 36px Arial'; x.fillText(String(company).slice(0, 26), n / 2, 540); x.fillStyle = '#E6C66E'; x.font = '26px Arial'; x.fillText('with BrillBrains Hiring', n / 2, 585);
        resolve(cv.toDataURL('image/png'));
      }; img.src = logo;
    });
  }
  function groupDialog(c) {
    const g = c.wa_group || {}; let dp = null;
    BB.ask({ title: 'WhatsApp group with the client', wide: true, fields: [{ name: 'name', label: 'Group name', value: g.name || `${c.company} × BrillBrains` }, { name: 'link', label: 'Invite link (optional)', value: g.link || '', opt: true, voice: false }, { name: 'created', label: 'Group created', type: 'check', value: g.created },
      '<div class="row"><button type="button" class="btn sm" data-dpmake>Make group picture from logo</button><span class="small muted">Pick the logo; we frame it and you download it.</span></div><img data-dpimg alt="" class="flow-dp hidden">'],
    ok: 'Save', submit: async (v) => { let dp_file; if (dp) { const f = await BB.post('/api/files', { record_id: c.id, type: 'group_dp', name: `Group-${c.id}.png`, base64: dp.split(',')[1] }); dp_file = f.id; } return BB.post(`/api/clients/${c.id}/group`, { ...v, dp_file }); } }).then((x) => x && done('Group saved'));
    setTimeout(() => {
      const b = $('[data-dpmake]'); if (!b) return;
      b.onclick = async () => {
        const f = await BB.pickFile('.jpg,.jpeg,.png'); if (!f) return;
        try { dp = await groupDp(`data:image/${/\.png$/i.test(f.name) ? 'png' : 'jpeg'};base64,${f.base64}`, c.company); const i = $('[data-dpimg]'); i.src = dp; i.classList.remove('hidden'); const a = document.createElement('a'); a.href = dp; a.download = `${c.company}-group.png`; a.click(); } catch (e) { BB.fail(e); }
      };
    }, 60);
  }

  // ---------- job: screening board ----------
  const fitRow = (r, j) => `<tr><td style="width:64px">${scoreBadge(r.score)}${r.by_ai ? '<div class="tiny faint">AI</div>' : ''}</td><td><a href="#" data-open="${r.app_id ? `application:${r.app_id}` : `candidate:${r.candidate_id}`}"><b>${esc(r.name)}</b></a> <span class="tiny muted">${esc(r.wants || '')} · ${esc(r.city || '—')} · ${r.exp ?? '—'} yrs${r.jewellery ? ` · ${r.jewellery} in jewellery` : ''}${r.has_cv ? '' : ' · no CV'}</span>
      <div class="fit-pts">${(r.points || []).map((x) => `<span class="ok">✓ ${esc(x)}</span>`).join('')}${(r.gaps || []).map((x) => `<span class="no">✗ ${esc(x)}</span>`).join('')}</div></td>
    <td class="nowrap">${r.app_id ? (r.screen === 'Accepted' ? '<span class="badge b-green">Accepted</span>' : `<span class="badge b-outline">${esc(r.step)}</span><div class="row" style="margin-top:4px"><button class="btn sm primary" data-qs="Accepted" data-ap="${r.app_id}">Accept</button><button class="btn sm" data-qs="Rejected" data-ap="${r.app_id}">Not suitable</button></div>`) : `<button class="btn sm primary" data-add="${r.candidate_id}">Open application</button>`}</td></tr>`;
  const loadScreen = async (el, j) => {
    const box = $('[data-flow-screen]', el); if (!box) return;
    let d; try { d = await BB.api(`/api/jobs/${j.id}/screen`); } catch (e) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="sec"><div class="row between"><h3 style="margin:0">Screening (${d.apps.length}) <span class="faint small">· best first</span></h3><div class="row">${d.ai ? '<button class="btn sm gold" data-fit>✦ Rank with AI</button>' : ''}<button class="btn sm" data-addcvs>Add CVs</button></div></div>
        <div class="card tbl-wrap" style="margin-top:8px"><table class="tbl"><tbody>${d.apps.map((r) => fitRow(r, j)).join('') || '<tr><td class="empty">No open applications yet.</td></tr>'}</tbody></table></div></div>
      <div class="sec"><h3>Top matches not applied yet <span class="faint small">· resume bank, any source</span></h3><div class="card tbl-wrap"><table class="tbl"><tbody>${d.bank.map((r) => fitRow(r, j)).join('') || '<tr><td class="empty">No strong matches in the resume bank.</td></tr>'}</tbody></table></div></div>`;
    BB.wireQuickScreen(box, () => done());
    $$('[data-add]', box).forEach((b) => (b.onclick = () => act(() => BB.post('/api/applications', { candidate_id: b.dataset.add, job_id: j.id }), 'Application opened')));
    const fit = $('[data-fit]', box);
    if (fit) fit.onclick = async () => {
      fit.disabled = true; let left = 1; let total = 0;
      try { while (left > 0) { fit.textContent = total ? `Ranked ${total}…` : 'Ranking…'; const r = await BB.post(`/api/jobs/${j.id}/ai-fit`); total += r.done; left = r.done ? r.left : 0; } BB.toast(total ? `${total} ranked` : 'Everyone is already ranked'); loadScreen(el, j); } catch (e) { BB.fail(e); fit.disabled = false; fit.textContent = '✦ Rank with AI'; }
    };
    $('[data-addcvs]', box).onclick = () => F.addCvs(j.id);
  };
  // CVs from referrals, WhatsApp, job portals or Drive: each makes the candidate if new, and opens the application.
  F.addCvs = async (jobId) => {
    const v = await BB.ask({ title: jobId ? 'Add CVs to this job' : 'Upload CVs', note: 'Each CV creates the candidate if they are new. Same phone number means the same person.', fields: [{ name: 'source', label: 'Where are they from?', type: 'select', options: BB.boot.lead_sources, value: 'Referral', placeholder: false }], ok: 'Pick CVs' });
    if (!v) return; const files = await BB.pickFiles(); if (!files.length) return;
    let ok = 0; const bad = []; BB.toast(`Reading ${files.length} CV${files.length > 1 ? 's' : ''}…`);
    for (const f of files) {
      try {
        if (f.size > 10 * 1024 * 1024) throw new Error('bigger than 10 MB');
        const cv = await readFile(f); const r = await BB.post('/api/candidates/cv-read', cv); const fields = r.fields || {};
        await BB.post('/api/candidates/from-cv', { fields: { ...fields, name: fields.name || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }, cv, job_id: jobId, source: v.source }); ok++;
      } catch (e) { bad.push(`${f.name}: ${e.message}`); }
    }
    BB.toast(`${ok} of ${files.length} added${bad.length ? ` · ${bad[0]}` : ''}`, !!bad.length); done();
  };
  F.jobMount = (el, j) => { loadScreen(el, j); const c = $('[data-fcreative]', el); if (c) c.onclick = () => BB.open('reach', j.id); };

  // ---------- application: what next, and the offer stages ----------
  F.appNext = (a) => (a.next ? `<div class="flow-next"><b>Next:</b> ${esc(a.next)}</div>` : '');
  F.appOffer = (a) => {
    if (!['Sent to client', 'Client interview', 'Offer made', 'Offer accepted', 'Joined'].includes(a.step) || (a.result !== 'open' && a.result !== 'Hired')) return '';
    const tpl = a.selected || ['Offer made', 'Offer accepted', 'Joined'].includes(a.step) ? `<div class="offer-tpl"><div class="grow"><b>Offer letter template</b><div class="small muted">Download the Word template and fill in the details in [brackets].</div></div><button class="btn sm primary" data-ftpl>Download</button></div>` : '';
    const st = [['verbal', 'Client made a verbal offer', a.verbal_at], ['verbal_ok', 'Candidate accepted verbally', a.verbal_ok_at], ['letter', 'Client shared the offer letter', a.letter_at]];
    const asked = a.bill && a.bill.accounts_asked_at;
    return `${tpl}<div class="sec card pad"><h3 style="margin-bottom:6px">Offer steps</h3>${st.map(([k, l, at]) => `<label class="row small"><input type="checkbox" data-ostage="${k}" ${at ? 'checked' : ''} ${a.result === 'open' ? '' : 'disabled'}> ${l}${at ? ` <span class="faint">${fmtDT(at)}</span>` : ''}</label>`).join('')}
      ${canAdmin() && a.offer_ctc ? `<div class="row" style="margin-top:8px">${asked ? `<span class="small muted">Accounts asked ${fmtDT(asked)}</span>` : ''}<button class="btn sm ${asked ? '' : 'primary'}" data-faccounts>${asked ? 'Ask again' : 'Ask Accounts for the invoice'}</button>${a.bill ? `<a href="#" class="small" data-open="bill:${a.bill.id}">Open bill</a>` : ''}</div>` : ''}</div>`;
  };
  // ---------- Campaigns to candidates ----------
  const PREF_FIELDS = (p, cur = {}) => `<div class="grid g3">${field({ name: 'pref_channel', label: 'Best way to reach', type: 'select', options: p.channel, opt: true, placeholder: 'Any', value: cur.pref_channel || '' })}${field({ name: 'pref_time', label: 'Best time to call', type: 'select', options: p.time, opt: true, placeholder: 'Any time', value: cur.pref_time || '' })}${field({ name: 'pref_days', label: 'Best days', type: 'select', options: p.days, opt: true, placeholder: 'Any day', value: cur.pref_days || '' })}</div>`;
  BB.prefFields = PREF_FIELDS;
  F.campaign = async (audience) => {
    const jobs = (await BB.api('/api/jobs?size=200')).rows.filter((j) => ['Open', 'Sourcing', 'Interviewing'].includes(j.status));
    setTimeout(() => { const m = $('.modal'); if (!m) return; const show = () => { const k = ($('[name=kind]:checked', m) || {}).value; const ch = ($('[name=channel]:checked', m) || {}).value; $('[data-f=job_id]', m).classList.toggle('hidden', k !== 'job'); $('[data-f=body]', m).classList.toggle('hidden', k !== 'message'); $('[data-f=subject]', m).classList.toggle('hidden', k !== 'message' || ch === 'whatsapp'); $('[data-f=channel]', m).classList.toggle('hidden', k === 'prefs'); }; $$('input[type=radio]', m).forEach((r) => (r.onchange = show)); show(); }, 0);
    const v = await BB.ask({ title: `Send campaign · ${esc(audience.label)}`, wide: true, note: 'People who said STOP or have not given consent are left out. While messages are off, campaigns wait on hold.', fields: [
      { name: 'kind', label: 'What', type: 'choice', options: [['job', 'Job alert'], ['message', 'Message'], ['prefs', 'Ask contact preferences']], value: 'job' },
      { name: 'job_id', label: 'Job opening', type: 'select', options: jobs.map((j) => [j.id, `${j.title}, ${j.city || ''}`]) },
      { name: 'subject', label: 'Email subject', voice: false }, { name: 'body', label: 'Message ({name} becomes their name)', type: 'textarea' },
      { name: 'channel', label: 'Send by', type: 'choice', options: [['preferred', 'Their preferred channel'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['both', 'Both']], value: 'preferred' },
      { name: 'timing', label: 'When', type: 'choice', options: [['now', 'Now'], ['preferred', 'In each person\'s preferred time']], value: 'now' },
      { name: 'name', label: 'Campaign name', opt: true, voice: false }], ok: 'Send', submit: (x) => BB.post('/api/campaigns', { ...x, ids: audience.ids, segment: audience.segment }) });
    if (v) { BB.go('team/campaigns'); setTimeout(() => BB.open('campaign', v.id), 400); const sk = Object.entries(v.skipped); BB.modal({ title: 'Campaign sent', foot: false, body: `<p>${v.wa} on WhatsApp, ${v.email} by email, of ${v.total}.</p>${sk.length ? `<div class="small">${sk.map(([k, n]) => `<div>${esc(k)}: ${n}</div>`).join('')}</div>` : ''}` }); }
  };
  // ---------- Campaigns: how each one did, channel by channel ----------
  const rate = (n) => (n === null || n === undefined ? '—' : `${n}%`);
  const chips = (by) => Object.entries(by).map(([k, n]) => `<span class="badge ${/Delivered|Read|Sent/.test(k) ? 'b-green' : /Failed/.test(k) ? 'b-red' : 'b-outline'} tiny">${esc(k)} ${n}</span>`).join(' ') || '<span class="faint">—</span>';
  P.campaigns = async ({ el, actions, q }) => {
    const d = await BB.api(`/api/campaigns?${BB.qs({ q: q.q, kind: q.kind, from: q.from, to: q.to })}`); const t = d.totals;
    actions.innerHTML = '<button class="btn primary" data-cnew>+ New campaign</button>';
    el.innerHTML = `${F.periodBar(q)}<div class="grid camp-tiles">${[['Campaigns', t.campaigns], ['WhatsApp delivered', rate(t.wa_delivered_rate)], ['WhatsApp read', rate(t.wa_read_rate)], ['Emails sent', rate(t.email_sent_rate)], ['Replied', `${t.replied} of ${t.reached}`]].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
      <div class="filters exp-filters"><input placeholder="Search campaigns…" value="${esc(q.q || '')}" data-q data-xq><select data-cf="kind"><option value="">Any kind</option><option value="job" ${q.kind === 'job' ? 'selected' : ''}>Job alerts</option><option value="message" ${q.kind === 'message' ? 'selected' : ''}>Messages</option></select></div>
      <div class="card">${BB.table([{ t: 'Campaign', f: (x) => `<b>${esc(x.name)}</b><div class="tiny muted">${esc(x.kind === 'job' ? `Job alert · ${x.job_title}` : x.kind === 'prefs' ? 'Contact preferences' : 'Message')} · ${esc(x.audience)}</div>` }, { t: 'Sent', f: (x) => `${fmtD(x.at)}<div class="tiny muted">${esc(x.by)}</div>` }, { t: 'People', num: 1, f: (x) => x.total }, { t: 'WhatsApp', f: (x) => `<b>${x.stats.whatsapp.total}</b> <span class="small muted">delivered ${rate(x.stats.whatsapp.delivered_rate)} · read ${rate(x.stats.whatsapp.read_rate)}</span>` }, { t: 'Email', f: (x) => `<b>${x.stats.email.total}</b> <span class="small muted">sent ${rate(x.stats.email.sent_rate)}</span>` }, { t: 'Replied', num: 1, f: (x) => `${x.stats.replied}<div class="tiny muted">${rate(x.stats.reply_rate)}</div>` }, { t: 'Applied', num: 1, f: (x) => (x.stats.applied === null ? '—' : x.stats.applied) }, { t: 'Left out', num: 1, f: (x) => Object.values(x.skipped).reduce((a, b) => a + b, 0) }], d.rows, { open: (x) => `campaign:${x.id}`, empty: 'No campaigns yet. Press + New campaign, or tick candidates and press Send campaign.' })}</div>`;
    F.wirePeriod(el); let tq; $('[data-q]', el).oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => BB.setQ({ q: e.target.value }), 350); };
    $$('[data-cf]', el).forEach((f) => (f.onchange = () => BB.setQ({ [f.dataset.cf]: f.value })));
    $('[data-cnew]', actions).onclick = async () => { if (!d.segments.length) return BB.toast('Save a segment first in Candidates, or tick candidates there and press Send campaign', true); const v = await BB.ask({ title: 'New campaign', fields: [{ name: 'segment', label: 'Send to', type: 'select', options: d.segments, placeholder: false }], ok: 'Next' }); if (v) F.campaign({ segment: v.segment, label: (d.segments.find(([id]) => String(id) === String(v.segment)) || [])[1] }); };
  };
  BB.panels.campaign = async (id) => {
    const x = await BB.api(`/api/campaigns/${id}`); const s = x.stats; const sk = Object.entries(x.skipped);
    return { head: `<div class="row"><h2>${esc(x.name)}</h2></div><div class="small muted">${esc(x.kind === 'job' ? `Job alert · ${x.job_title}` : 'Message')} · ${esc(x.audience)} · ${fmtDT(x.at)} · ${esc(x.by)}</div>`,
      body: `<div class="grid g2"><div class="card pad"><h3>WhatsApp · ${s.whatsapp.total}</h3><div class="kn-row"><span>Delivered</span><div><b>${rate(s.whatsapp.delivered_rate)}</b></div></div><div class="kn-row"><span>Read</span><div><b>${rate(s.whatsapp.read_rate)}</b></div></div><div class="kn-row"><span>Status</span><div>${chips(s.whatsapp.by)}</div></div></div>
        <div class="card pad"><h3>Email · ${s.email.total}</h3><div class="kn-row"><span>Sent</span><div><b>${rate(s.email.sent_rate)}</b></div></div><div class="kn-row"><span>Status</span><div>${chips(s.email.by)}</div></div><div class="tiny muted" style="margin-top:6px">Email opens are not tracked.</div></div></div>
        <div class="card pad sec"><div class="kn-row"><span>Replied</span><div>${s.replied} of ${s.reached} (${rate(s.reply_rate)})</div></div>${s.applied !== null ? `<div class="kn-row"><span>Applied to the job</span><div>${s.applied}</div></div>` : ''}<div class="kn-row"><span>Said STOP after</span><div>${s.stopped}</div></div>${sk.length ? `<div class="kn-row"><span>Left out</span><div>${sk.map(([k, n]) => `${esc(k)}: ${n}`).join('<br>')}</div></div>` : ''}${x.body ? `<div class="kn-row"><span>Message</span><div class="small">${esc(x.body)}</div></div>` : ''}</div>
        <div class="sec"><h3>People</h3>${BB.table([{ t: 'Candidate', f: (p) => `<a href="#" data-open="candidate:${p.id}">${esc(p.name)}</a>` }, { t: 'WhatsApp', f: (p) => (p.whatsapp ? `${esc(p.whatsapp)}${p.wa_error ? `<div class="tiny muted">${esc(p.wa_error)}</div>` : ''}` : '—') }, { t: 'Email', f: (p) => (p.email ? `${esc(p.email)}${p.mail_error ? `<div class="tiny muted">${esc(p.mail_error)}</div>` : ''}` : '—') }, { t: 'Replied', f: (p) => (p.replied ? 'Yes' : '—') }], x.people, { empty: 'Nobody yet.' })}</div>`, mount: () => {} };
  };


  // ---------- What we already know: read this before calling or assessing again ----------
  const daysAgo = (n) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
  F.known = (k, c, next) => {
    const call = k.last_call; const ev = k.evaluation; const d = k.decision; const pm = (y) => (y ? inr(y / 12) : ''); const facts = [c.exp_total != null && `${c.exp_total} yrs experience`, c.cur_salary && `now ${pm(c.cur_salary)}/mo`, c.exp_salary && `expects ${pm(c.exp_salary)}/mo`, c.notice_days != null && `${c.notice_days} days notice`, c.city].filter(Boolean); const pf = k.prefs || {};
    const line = (label, body) => `<div class="kn-row"><span>${label}</span><div>${body}</div></div>`;
    return `<div class="sec card pad known"><h3>What we already know</h3>
      ${call && call.days <= 3 ? `<div class="notice gold">Spoken to ${daysAgo(call.days)} by ${esc(call.by)}. Read this before calling again.</div>` : ''}
      ${line('Last contact', call ? `<b>${esc(call.outcome)}</b> · ${fmtD(call.at)} · ${esc(call.by)}${call.job ? ` · ${esc(call.job)}` : ''}${call.note ? `<div class="small muted">${esc(call.note)}</div>` : ''}` : '<span class="faint">No call on record</span>')}
      ${line('Interview feedback', ev ? `<b>${ev.percent === null ? 'Saved' : `${ev.percent}%`}</b> · ${ev.marked} points · ${fmtD(ev.at)} · ${esc(ev.by)}${ev.weak.length ? `<div class="small muted">Weak: ${esc(ev.weak.join(', '))}</div>` : ''}` : '<span class="faint">No feedback yet</span>')}
      ${line('Last decision', d ? `${esc(d.note)} · ${fmtD(d.at)} · ${esc(d.by)}${d.job ? ` · ${esc(d.job)}` : ''}` : '<span class="faint">None yet</span>')}
      ${line('Reach them', `${pf.note ? `${esc(pf.note)}${pf.now_ok ? '' : ' <span class="badge b-amber">Not their time now</span>'}` : '<span class="faint">No preference given</span>'}${c.id && c.whatsapp ? ` <button class="btn sm ghost" data-askprefs="${esc(c.id)}">Ask on WhatsApp</button>` : ''}`)}
      ${facts.length ? line('On file', esc(facts.join(' · '))) : ''}${next ? line('Next', esc(next)) : ''}</div>`;
  };
  F.story = (rows) => (rows.length ? `<div class="story">${rows.map((r) => `<div class="story-row"><span class="story-when">${fmtD(r.at)}</span><div class="grow"><b>${esc(r.title)}</b>${r.job ? ` <span class="faint small">· ${esc(r.job)}</span>` : ''}${r.detail ? `<div class="small muted">${esc(r.detail)}</div>` : ''}${r.by ? `<div class="tiny faint">${esc(r.by)}</div>` : ''}</div></div>`).join('')}</div>` : '<div class="faint small">Nothing yet.</div>');
  // ---------- Evaluation: the same points for every candidate ----------
  const EVAL_OPTS = ['Strong', 'OK', 'Weak', 'N/A'];
  F.evalBlock = (rec) => { const e = rec.known.evaluation; return `<div class="sec card pad stack-sm"><div class="row between"><h3 style="margin:0">Interview feedback</h3><button class="btn sm ${e ? '' : 'primary'}" data-evalopen>${e ? 'Update feedback' : 'Interview feedback'}</button></div>${e ? `<div class="eval-grid">${Object.entries(e.scores).map(([k, v]) => `<div class="eval-row"><span>${esc(k.split('|').pop().trim())}</span><span class="badge ${v === 'Strong' ? 'b-green' : v === 'Weak' ? 'b-red' : v === 'N/A' ? 'b-outline faint' : 'b-outline'}">${esc(v === 'N/A' ? 'Not relevant' : v)}</span></div>`).join('')}</div>${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}<div class="tiny faint">${esc(e.by)} · ${fmtDT(e.at)}</div>` : '<div class="faint small">No interview feedback yet.</div>'}</div>`; };
  F.evalOpen = async (cid, app, rec) => {
    const last = rec.known.evaluation; const was = { ...Object.fromEntries((rec.eval_na || []).map((k) => [k, 'N/A'])), ...(last && (!app || last.app_id === app) ? last.scores : {}) }; const groups = {}; for (const x of rec.eval_criteria) { const g = x.includes('|') ? x.split('|')[0].trim() : 'General'; (groups[g] = groups[g] || []).push(x); }
    const body = Object.entries(groups).map(([g, list]) => `<div class="eval-group"><h4>${esc(g)}</h4>${list.map((k) => `<div class="eval-row"><span>${esc(k.split('|').pop().trim())}</span><span class="eval-pick">${EVAL_OPTS.map((o) => `<label class="${o === 'N/A' ? 'na' : ''}"><input type="radio" name="${esc(k)}" data-ev="${esc(k)}" value="${o}" ${was[k] === o ? 'checked' : ''}> ${o === 'N/A' ? 'Not relevant' : o}</label>`).join('')}</span></div>`).join('')}</div>`).join('');
    const v = await BB.ask({ title: 'Interview feedback', note: `Mark what you checked. Not relevant is remembered for this job${app ? '' : ' when you evaluate from an application'}.`, wide: true, fields: [`<div class="eval-form">${body}</div>`, { name: 'note', label: 'Overall comment', type: 'textarea', opt: true }], ok: 'Save feedback', submit: (x) => { const scores = {}; $$('.modal [data-ev]:checked').forEach((i) => (scores[i.dataset.ev] = i.value)); return BB.post(`/api/candidates/${cid}/evaluation`, { scores, note: x.note, app_id: app }); } });
    if (v) done('Feedback saved');
  };

  // ---------- Interview rounds: one line each, one action each ----------
  const RND_CLS = { 'To do': 'b-outline', Scheduled: 'b-primary', 'Result pending': 'b-amber', Cleared: 'b-green', 'Not cleared': 'b-red', 'On hold': 'b-amber', 'No-show': 'b-red', 'Not needed': 'b-outline' };
  const ROUND_TYPES = [['phone', 'Telephonic'], ['video', 'Virtual'], ['in_person', 'In person']];
  F.appRounds = (a, ivCard) => {
    const open = a.result === 'open'; const ivOf = (r) => r.interview_ids.map((id) => a.interviews.find((i) => i.id === id)).filter(Boolean);
    const row = (r) => {
      const free = open && ['To do', 'No-show'].includes(r.status); const live = ['Scheduled', 'Result pending'].includes(r.status); const cards = ivOf(r).map(ivCard).join('');
      return `<div class="rnd"><div class="rnd-top"><div class="grow"><b>${esc(r.name)}</b> <span class="badge ${RND_CLS[r.status] || 'b-outline'}">${esc(r.status)}</span>${r.at && r.status !== 'To do' ? ` <span class="small muted">${fmtDT(r.at)}</span>` : ''}${r.added_reason ? `<div class="tiny muted">Added by ${esc(r.added_by)}: ${esc(r.added_reason)}</div>` : ''}${r.status === 'Not needed' ? `<div class="small">${esc(r.skip_reason)}</div><div class="tiny muted">${esc(r.skip_by)} · ${fmtDT(r.skip_at)}</div>` : ''}</div>
        ${free ? `<details class="step-menu"><summary class="btn sm">Choose</summary><div class="step-pop right" role="menu"><button type="button" role="menuitem" data-rsched="${esc(r.key)}">Schedule</button><button type="button" role="menuitem" data-rskip="${esc(r.key)}">Not needed</button>${r.extra_id && !r.interview_ids.length ? `<button type="button" role="menuitem" data-rdel="${r.extra_id}">Remove round</button>` : ''}</div></details>` : ''}${open && r.status === 'Not needed' ? `<button class="btn sm ghost" data-runskip="${esc(r.key)}">Undo</button>` : ''}</div>
        ${cards ? (live ? `<div class="rnd-iv">${cards}</div>` : `<details class="rnd-iv" ${['Cleared', 'Not cleared', 'On hold'].includes(r.status) ? 'open' : ''}><summary class="small">Details</summary>${cards}</details>`) : ''}</div>`;
    };
    return `<div class="sec card pad stack-sm"><div class="row between"><h3 style="margin:0">Interview rounds</h3>${open ? '<button class="btn sm" data-radd>+ Add round</button>' : ''}</div>${a.rounds.map(row).join('')}</div>`;
  };
  // Moving past our own rounds to the client asks once why those left at To do are not needed.
  const toDo = (a) => a.rounds.filter((r) => r.status === 'To do' && r.mode !== 'in_person');
  F.moveTo = async (a, body) => {
    const s = BB.boot.steps; const to = body.next ? s[s.indexOf(a.step) + 1] : body.step; const idx = (x) => s.indexOf(x); const left = idx(a.step) < idx('Sent to client') && idx(to) >= idx('Sent to client') ? toDo(a) : [];
    let skip_reason; if (left.length) { const v = await BB.ask({ title: `Skip ${left.map((r) => r.name).join(' and ')}?`, fields: [{ name: 'reason', label: 'Why are they not needed?', type: 'textarea' }], ok: 'Skip and move' }); if (!v) return; skip_reason = v.reason; }
    try { await BB.post(`/api/applications/${a.id}/step`, { ...body, rounds: true, skip_reason }); done('Moved'); } catch (e) { BB.fail(e); if (e.field === 'call' && (await BB.logCall({ party: 'candidate', candidate_id: a.candidate_id, app_id: a.id }))) done('Call logged. Press again to move on.'); }
  };
  // Move to a stage. Telephonic and virtual are both Our interview: going to Virtual skips a telephonic round still
  // to do (with the reason); going back to Telephonic undoes that skip. Rejected closes the application.
  F.moveToStage = async (a, stage) => {
    const s = BB.boot.steps; const late = s.indexOf(a.step) >= s.indexOf('Sent to client');
    if (stage === 'Rejected') { const v = await BB.ask({ title: 'Reject', note: `This closes ${a.id}. You can reopen it later.`, fields: [{ name: 'reason', label: 'Reason', type: 'select', options: late ? ['Client rejected', 'Candidate withdrew', 'No response', 'Not suitable'] : [{ Screening: 'Rejected at screening', Telephonic: 'Rejected at telephonic round', Virtual: 'Rejected at virtual round' }[{ 'Telephonic round': 'Telephonic', 'Virtual round': 'Virtual' }[BB.stageOf(a)] || (['Applied', 'Screening'].includes(a.step) ? 'Screening' : 'Virtual')], 'Candidate withdrew', 'No response', 'Not suitable'], placeholder: false }, { name: 'note', label: 'Note', type: 'textarea', opt: true }], ok: 'Reject', submit: (x) => BB.post(`/api/applications/${a.id}/close`, x) }); if (v) done('Rejected'); return; }
    if (!['Telephonic round', 'Virtual round'].includes(stage)) return F.moveTo(a, { step: stage, note: 'Set by hand', force: true });
    const phone = a.rounds.find((r) => r.mode === 'phone');
    // A telephonic round that is booked or done without a result moves on through its feedback.
    if (stage === 'Virtual round' && phone && !['To do', 'Cleared', 'Not needed', 'Not cleared'].includes(phone.status)) { BB.toast(`Record the ${phone.name} feedback: Cleared moves them to the virtual round`); return BB.feedbackFor(a.id); }
    try {
      if (stage === 'Virtual round' && phone && phone.status === 'To do') { const v = await BB.ask({ title: `Skip ${phone.name}?`, fields: [{ name: 'reason', label: 'Why is it not needed?', type: 'textarea' }], ok: 'Skip and move' }); if (!v) return; await BB.post(`/api/applications/${a.id}/skip-round`, { key: phone.key, reason: v.reason }); }
      if (stage === 'Telephonic round' && phone && phone.status === 'Not needed') await BB.post(`/api/applications/${a.id}/skip-round/undo`, { key: phone.key });
    } catch (e) { return BB.fail(e); }
    if (a.step === 'Our interview') return done(`Moved to ${stage}`);
    return F.moveTo(a, { step: 'Our interview', note: `Set by hand: ${stage}`, force: true });
  };
  F.nextChoices = (a, i) => { const mine = a.rounds.findIndex((r) => r.interview_ids.includes(i.id)); const list = a.rounds.map((r, k) => ({ ...r, k })).filter((r) => r.status === 'To do' && r.k !== mine).map((r) => [r.key, `Schedule ${r.name}`]); return BB.boot.steps.indexOf(a.step) < BB.boot.steps.indexOf('Sent to client') ? [...list, ['client', 'Send to client']] : list; };
  F.skipsFor = (a, target, i) => { const rows = a.rounds.filter((r) => !r.interview_ids.includes(i.id)); if (target === 'client') return rows.filter((r) => r.status === 'To do' && r.mode !== 'in_person'); const at = rows.findIndex((r) => r.key === target); return rows.slice(0, Math.max(0, at)).filter((r) => r.status === 'To do'); };
  // Same person, a new direction: found under the new role from now on.
  F.changeRole = async (cid, current, app) => {
    const v = await BB.ask({ title: 'Change role', fields: [`<div class="small muted">Now: <b>${esc(current || 'Not given')}</b></div><label class="field" data-f="role"><span class="lab">New role</span><select name="role">${BB.jobOptions('')}</select></label>`, { name: 'other', label: 'If Other, type the role', opt: true, voice: false }, ...(current ? [{ name: 'keep', label: `Still open to ${current}`, type: 'check' }] : []), { name: 'note', label: 'Why? What did you learn from the candidate?', type: 'textarea' }], ok: 'Change role', submit: (x) => BB.post(`/api/candidates/${cid}/map-role`, { ...x, app }) });
    if (v) done(`Role changed${v.jobs.length ? `. ${v.jobs.length} open job${v.jobs.length === 1 ? '' : 's'} match: ${v.jobs.map((j) => j.title).join(', ')}` : ''}`);
  };
  F.addRound = async (a, pre = {}) => { const v = await BB.ask({ title: 'Add round', fields: [`<div class="grid g2">${field({ name: 'name', label: 'Round name', voice: false, value: pre.name || '', placeholder: 'e.g. Second client round' })}${field({ name: 'mode', label: 'Type', type: 'select', options: ROUND_TYPES, value: pre.mode || '', placeholder: false })}</div>`, { name: 'reason', label: 'Why is this round needed?', type: 'textarea' }], ok: 'Add round', submit: (x) => BB.post(`/api/applications/${a.id}/rounds`, x) }); if (v) done('Round added. Schedule it from the Now card.'); };
  F.appCv = (a) => (a.step === 'Our interview' ? '' : '<button class="btn sm" data-fcvmail>Email CV to client</button>');
  F.appMount = (el, a) => {
    $$('[data-ostage]', el).forEach((c) => (c.onchange = () => act(() => BB.post(`/api/applications/${a.id}/offer-stage`, { stage: c.dataset.ostage, on: c.checked }), (r) => (r.needs_offer ? 'Saved. Record the offer so Accounts can be asked for the invoice' : r.asked ? (r.asked.email === 'no address' ? 'Saved. Accounts see it in Invoicing; no Accounts email is set' : 'Saved. Accounts asked for the invoice') : 'Saved'))));
    const tp = $('[data-ftpl]', el); if (tp) tp.onclick = () => BB.download('/api/offer-template/file');
    const ac = $('[data-faccounts]', el); if (ac) ac.onclick = () => act(() => BB.post(`/api/applications/${a.id}/ask-invoice`), (r) => (r.email === 'no address' ? 'Draft bill made. Add the Accounts email in Settings → Fees & limits' : r.email === 'held' ? 'Draft bill made. The email is saved: messages are off' : 'Accounts asked'));
    const roundBy = (k) => a.rounds.find((r) => r.key === k);
    $$('[data-rsched]', el).forEach((b) => (b.onclick = () => { const r = roundBy(b.dataset.rsched); BB.schedule(a, r.mode, r); }));
    $$('[data-rskip]', el).forEach((b) => (b.onclick = async () => { const r = roundBy(b.dataset.rskip); const v = await BB.ask({ title: `Not needed: ${r.name}`, fields: [{ name: 'reason', label: 'Why is this round not needed?', type: 'textarea' }], ok: 'Save', submit: (x) => BB.post(`/api/applications/${a.id}/skip-round`, { key: r.key, reason: x.reason }) }); if (v) done('Saved with the reason'); }));
    $$('[data-runskip]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/applications/${a.id}/skip-round/undo`, { key: b.dataset.runskip }), 'Undone')));
    $$('[data-rdel]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/applications/${a.id}/rounds/${b.dataset.rdel}/delete`), 'Round removed')));
    $$('[data-radd]', el).forEach((b) => (b.onclick = () => F.addRound(a)));
    const cr = $('[data-chrole]', el); if (cr) cr.onclick = () => F.changeRole(a.candidate_id, (a.candidate || {}).job_wanted, a.id);
    $$('[data-fslots]', el).forEach((b) => (b.onclick = () => askSlots(a).then((x) => x && done('Sent to the client'))));
    $$('[data-sfix]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/slot-asks/${b.dataset.sfix}/schedule`), (r) => r.effect)));
    $$('[data-scancel]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/slot-asks/${b.dataset.scancel}/cancel`), 'Request cancelled')));
    const pm = $('[data-fprep]', el); if (pm) pm.onclick = async () => { pm.disabled = true; pm.textContent = 'Writing…'; await act(() => BB.post(`/api/applications/${a.id}/prep`), 'Preparation questions ready. Read them, then share.'); pm.disabled = false; };
    const ps = $('[data-fprepshare]', el); if (ps) ps.onclick = () => act(() => BB.post(`/api/applications/${a.id}/prep/share`), (r) => (r.emailed ? 'Shared: in their profile, and by email' : 'Shared in their profile'));
    const qm = $('[data-fqmake]', el); if (qm) qm.onclick = async () => { qm.disabled = true; qm.textContent = 'Reading the resume…'; await act(() => BB.post(`/api/applications/${a.id}/questions`, { round: ($('[data-fqround]', el) || {}).value || '', lang: ($('[data-fqlang]', el) || {}).value || 'en' }), 'Questions ready'); qm.disabled = false; qm.textContent = a.questions ? 'Make again' : 'Make questions with AI'; };
    const qc = $('[data-fqcopy]', el); if (qc) qc.onclick = async () => { const t = a.questions.questions.map((s) => `${s.title}\n${s.questions.map((x, i) => `${i + 1}. ${x.q}`).join('\n')}`).join('\n\n'); try { await navigator.clipboard.writeText(t); BB.toast('Questions copied'); } catch { BB.toast('Could not copy', true); } };
    $$('[data-fcvmail]', el).forEach((b) => (b.onclick = () => F.composeMail([a.client.id], 'cv', 'Email CV to client', a.id)));
  };

  // ---------- bill: Accounts' invoice and payment follow-ups ----------
  F.bill = (b) => `<div class="sec"><h3>Invoice from Accounts</h3><div class="row small">${b.accounts_asked_at ? `<span class="muted">Accounts asked ${fmtDT(b.accounts_asked_at)}</span>` : '<span class="muted">Accounts not asked yet</span>'}${b.invoice_file ? `<button class="btn sm" data-file="${b.invoice_file}">Invoice file</button>` : ''}${canAdmin() || me().accounts_only ? `<button class="btn sm primary" data-finv>${b.bill_no ? 'Update invoice' : 'Record invoice'}</button><button class="btn sm" data-ffu>Log payment follow-up</button>` : ''}</div><div data-fus class="stack-sm" style="margin-top:8px"></div></div>`;
  F.billMount = async (el, b) => {
    const inv = $('[data-finv]', el);
    if (inv) inv.onclick = () => {
      let file = null;
      BB.ask({ title: 'Record invoice', note: 'Saves the number and the file. To send it to the client, use Send invoice after this.', fields: [{ name: 'invoice_no', label: 'Invoice number', value: b.bill_no || '' }, '<div class="row"><button type="button" class="btn sm" data-invf>Attach the invoice</button><span class="small muted" data-invn></span></div>'], ok: 'Save', submit: (x) => BB.post(`/api/bills/${b.id}/invoice`, { ...x, file }) }).then((v) => v && done('Invoice saved'));
      setTimeout(() => { const t = $('[data-invf]'); if (t) t.onclick = async () => { const f = await BB.pickFile('.pdf,.jpg,.jpeg,.png'); if (f) { file = f; $('[data-invn]').textContent = f.name; } }; }, 60);
    };
    const fu = $('[data-ffu]', el); if (fu) fu.onclick = async () => { const v = await BB.ask({ title: 'Payment follow-up', fields: [{ name: 'note', label: 'What did the client say?', type: 'textarea' }, { name: 'next_at', label: 'Next follow-up', type: 'datetime-local', opt: true }], ok: 'Save', submit: (x) => BB.post(`/api/bills/${b.id}/followup`, { ...x, next_at: x.next_at ? BB.fromLocalInput(x.next_at) : null }) }); if (v) done('Follow-up saved'); };
    try { const rows = await BB.api(`/api/bills/${b.id}/followups`); const box = $('[data-fus]', el); if (box) box.innerHTML = rows.map((r) => `<div class="small">${fmtDT(r.at)} · ${esc(r.by)}: ${esc(r.note)}${r.next_at ? ` <span class="faint">· next ${fmtDT(r.next_at)}</span>` : ''}</div>`).join(''); } catch { /* the bill still opens */ }
  };

  // ---------- jobs page: paste notes, mass hiring ----------
  F.jobsActions = (actions) => {
    const b = $('[data-fmass]', actions); if (b) b.onclick = F.mass;
  };
  F.mass = async () => {
    const r = await BB.api('/api/clients?all=1'); const list = r.rows.filter((c) => !c.placeholder);
    const v = await BB.ask({ title: 'Mass hiring', note: 'One role in many cities: one job opening per city, all marked as one drive.', wide: true, fields: [`<div class="grid g2"><label class="field"><span class="lab">Client</span><select name="client_id"><option value="">Choose…</option>${list.map((c) => `<option value="${c.id}">${esc(c.company)}</option>`).join('')}</select></label><label class="field"><span class="lab">Job</span><select name="title">${BB.jobOptions('')}</select></label></div>`,
      { name: 'lines', label: 'City and number of people, one per line', type: 'textarea', placeholder: 'Mumbai: 20\nSurat: 15', voice: false },
      `<div class="grid g4">${field({ name: 'sal_from', label: 'Salary from / month', type: 'number', opt: true })}${field({ name: 'sal_to', label: 'Salary to / month', type: 'number', opt: true })}${field({ name: 'exp_from', label: 'Exp from (yrs)', type: 'number', opt: true })}${field({ name: 'exp_to', label: 'Exp to (yrs)', type: 'number', opt: true })}</div>`,
      { name: 'notes', label: 'Notes', type: 'textarea', opt: true }], ok: 'Create openings', submit: (x) => BB.post('/api/jobs/mass', { ...x, salary_per: 'month' }) });
    if (v) done(`${v.jobs.length} openings made for ${v.total} people`);
  };

  // ---------- clients page: lead or active, email in bulk ----------
  F.clientsMount = (el) => {
    const bar = $('[data-cbar]', el); if (!bar) return;
    const n = () => { const k = BB.selected(el).length; $('[data-ccount]', bar).textContent = BB.bulkCount('client', k); bar.classList.toggle('has-sel', k > 0); };
    BB.wireSelect(el, n); $$('[data-sel]', el).forEach((x) => x.addEventListener('change', n));
    const stg = $('[data-cstage]', bar); stg.onchange = async () => { const v = stg.value; const ids = BB.selected(el); stg.value = ''; if (!v) return; if (!ids.length) return BB.toast('Select some clients first', true); await act(() => BB.post('/api/leads/bulk', { type: 'client', ids, action: 'stage', value: v }), (r) => `${r.done} of ${ids.length} updated${r.skipped.length ? ` · ${r.skipped[0].split(': ').pop()}` : ''}`); };
    $$('[data-cm]', bar).forEach((b) => (b.onclick = () => { const ids = BB.selected(el); if (!ids.length) return BB.toast('Select some clients first', true); F.composeMail(ids, b.dataset.cm, b.textContent); }));
  };

  // ---------- hiring channels: creatives and many jobs at once ----------

  // ---------- Recruitment Agreement page ----------
  P.agreement = async ({ el, actions }) => {
    const a = await BB.api('/api/agreement');
    actions.innerHTML = `<button class="btn" data-adl>Download</button>${me().level === 'super' ? '<button class="btn primary" data-aup>Replace the agreement</button>' : ''}`;
    el.innerHTML = `<div class="card pad flow-doc">${esc(a.text || 'Download the file to read it.')}</div>`;
    $('[data-adl]', actions).onclick = () => BB.download('/api/agreement/file');
    const up = $('[data-aup]', actions); if (up) up.onclick = async () => { const f = await BB.pickFile('.docx,.pdf'); if (f) act(() => BB.post('/api/agreement', f), 'Agreement replaced'); };
  };

  // ---------- Tasks: who owns what ----------
  const TASK_CLS = { Pending: 'b-amber', 'In progress': 'b-primary', Done: 'b-green' };
  const taskForm = (d, t) => BB.ask({ title: t ? 'Edit task' : 'Add task', fields: [{ name: 'title', label: 'Task', value: t ? t.title : '', voice: false }, `<div class="grid g3">${field({ name: 'area', label: 'Area', opt: true, value: t ? t.area : '' })}${field({ name: 'owner_id', label: 'Owner', type: 'select', options: d.owners.map((x) => [x.id, x.name]), opt: true, value: t ? t.owner_id : '' })}${field({ name: 'due_date', label: 'Due', type: 'date', opt: true, value: t ? t.due_date : '' })}</div>`, { name: 'detail', label: 'Details', type: 'textarea', opt: true, value: t ? t.detail : '' }], ok: 'Save', submit: (v) => (t ? BB.patch(`/api/tasks/${t.id}`, v) : BB.post('/api/tasks', v)) });
  P.tasks = async ({ el, actions, q, me: u }) => {
    const d = await BB.api(`/api/tasks?${BB.qs({ q: q.q, owner: q.owner, status: q.status, area: q.area })}`);
    actions.innerHTML = `${u.agency_id ? '<button class="btn" data-tmember>+ Add team member</button>' : ''}<button class="btn primary" data-tadd>+ Add task</button>`;
    el.innerHTML = `<div class="filters exp-filters"><input placeholder="Search tasks…" value="${esc(q.q || '')}" data-q data-xq><select data-tf="owner"><option value="">Everyone</option><option value="none" ${q.owner === 'none' ? 'selected' : ''}>No owner yet</option>${d.owners.map((x) => `<option value="${x.id}" ${q.owner === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><select data-tf="area"><option value="">All areas</option>${d.areas.map((x) => `<option ${q.area === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><select data-tf="status"><option value="">Any status</option>${d.statuses.map((x) => `<option ${q.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="card">${BB.table([{ t: 'Task', f: (t) => `<a href="#" data-open="task:${t.id}"><b>${esc(t.title)}</b></a>${t.detail ? `<div class="tiny muted">${esc(t.detail)}</div>` : ''}` }, { t: 'Area', f: (t) => esc(t.area || '—') }, { t: 'Owner', f: (t) => `<select class="mini stage-sel" data-towner="${t.id}" aria-label="Owner"><option value="">No owner</option>${d.owners.map((x) => `<option value="${x.id}" ${t.owner_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` }, { t: 'Due', f: (t) => (t.due_date ? fmtD(t.due_date) : '—') }, { t: 'Status', f: (t) => `<select class="mini stage-sel" data-tstatus="${t.id}" aria-label="Status">${d.statuses.map((x) => `<option ${t.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select>` }], d.rows, { empty: 'No tasks for these filters.' })}</div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>Team</h3></div>${BB.table([{ t: 'Person', f: (x) => `<b>${esc(x.name)}</b><div class="tiny muted">${BB.levelName(x.level)}</div>` }, { t: 'Open tasks', num: 1, f: (x) => x.open }, { t: 'Done', num: 1, f: (x) => x.done }, ...(d.can_perf ? [{ t: '', f: () => '<a href="/team/performance">Performance</a>' }] : [])], d.team, { empty: 'No team members yet.' })}</div>`;
    let tt; $('[data-q]', el).oninput = (e) => { clearTimeout(tt); tt = setTimeout(() => BB.setQ({ q: e.target.value }), 350); };
    $$('[data-tf]', el).forEach((f) => (f.onchange = () => BB.setQ({ [f.dataset.tf]: f.value })));
    $$('[data-towner]', el).forEach((f) => (f.onchange = () => act(() => BB.patch(`/api/tasks/${f.dataset.towner}`, { owner_id: f.value }), 'Owner saved')));
    $$('[data-tstatus]', el).forEach((f) => (f.onchange = () => act(() => BB.patch(`/api/tasks/${f.dataset.tstatus}`, { status: f.value }), 'Status saved')));
    $('[data-tadd]', actions).onclick = () => taskForm(d).then((x) => x && done('Task added'));
    const tm = $('[data-tmember]', actions); if (tm) tm.onclick = async () => { const v = await BB.ask({ title: 'Add team member', fields: [{ name: 'name', label: 'Name', voice: false }, field({ name: 'whatsapp', label: 'WhatsApp', type: 'tel', phone: true }), { name: 'email', label: 'Email', opt: true, voice: false }, { name: 'role', label: 'Role', opt: true, voice: false }], ok: 'Create login', submit: (x) => BB.post('/api/users', { ...x, level: 'sub', agency_id: u.agency_id }) }); if (v) { BB.modal({ title: 'Login created', foot: false, body: `<div class="stack"><div>Username: <b class="mono">${esc(v.username)}</b></div><div>Password: <b class="mono" style="font-size:18px">${esc(v.password)}</b></div><div class="small muted">Shown once.</div></div>` }); BB.refreshPage(); } };
  };
  BB.panels.task = async (id) => {
    const t = await BB.api(`/api/tasks/${id}`); const d = await BB.api('/api/tasks?status=none');
    return { head: `<div class="row"><h2>${esc(t.title)}</h2><span class="badge ${TASK_CLS[t.status] || 'b-outline'}">${esc(t.status)}</span></div>`, body: `<div class="card pad sec"><dl class="kv"><dt>Area</dt><dd>${esc(t.area || '—')}</dd><dt>Owner</dt><dd>${esc(t.owner_name || 'No owner yet')}</dd><dt>Due</dt><dd>${t.due_date ? fmtD(t.due_date) : '—'}</dd><dt>Details</dt><dd>${esc(t.detail || '—')}</dd><dt>Added by</dt><dd>${esc(t.by || '')}</dd></dl></div><div class="row">${t.status !== 'Done' ? '<button class="btn sm primary" data-tdone>Mark done</button>' : '<button class="btn sm" data-topen>Reopen</button>'}${t.status === 'Pending' ? '<button class="btn sm" data-tstart>Mark in progress</button>' : ''}<button class="btn sm" data-tedit>Edit</button><button class="btn sm danger" data-tdel>Remove</button></div>`,
      mount: (el) => {
        const set = (status, msg) => act(() => BB.patch(`/api/tasks/${t.id}`, { status }), msg); const on = (s, f) => { const x = $(s, el); if (x) x.onclick = f; };
        on('[data-tdone]', () => set('Done', 'Task done')); on('[data-topen]', () => set('Pending', 'Reopened')); on('[data-tstart]', () => set('In progress', 'In progress'));
        on('[data-tedit]', () => taskForm(d, t).then((x) => x && done('Saved')));
        on('[data-tdel]', async () => { if (await BB.confirm('Remove this task', 'It comes off the list.', 'Remove')) { await act(() => BB.post(`/api/tasks/${t.id}/delete`), 'Removed'); BB.closePanels(); } });
      } };
  };

  // ---------- The Accounts desk ----------
  F.sendBill = async (b, kind) => {
    const reminder = kind === 'reminder'; const email = b.client_email ?? (b.client || {}).email ?? ''; const already = reminder ? '' : '<div class="small muted">Sent it yourself? <a href="#" data-sent>Mark as already sent</a></div>';
    setTimeout(() => { const l = $('.modal [data-sent]'); if (l) l.onclick = async (e) => { e.preventDefault(); $('.modal [data-cancel]').click(); act(() => BB.post(`/api/bills/${b.id}/send`, { already: true }), 'Marked as sent'); }; }, 0);
    const v = await BB.ask({ title: reminder ? 'Payment reminder' : 'Send invoice', fields: [{ name: 'email', label: 'Email', type: 'check', value: true }, { name: 'to', label: 'Client email', type: 'email', value: email, opt: true }, { name: 'whatsapp', label: 'WhatsApp', type: 'check', value: true }, already], ok: 'Send', submit: (x) => BB.post(`/api/bills/${b.id}/send`, { ...x, kind }) });
    if (v) done(`Sent by ${v.sent.join(' and ')}`);
  };
  const billRows = { Client: (b) => `<b>${esc(b.client_name)}</b>${b.gstin ? `<div class="tiny muted">GSTIN ${esc(b.gstin)}</div>` : ''}`, Candidate: (b) => `${esc(b.candidate_name || '—')}${b.job_title ? `<div class="tiny muted">${esc(b.job_title)}</div>` : ''}` };
  P.accounts = async ({ el, q }) => {
    const d = await BB.api('/api/accounts/home'); const tab = q.tab || 'raise';
    const tabs = [['raise', 'To raise', d.to_raise.length], ['send', 'To send', d.to_send.length], ['follow', 'Payment follow-up', d.followups.length], ['offers', 'Offers', d.offers.length]];
    const sums = (l) => l.reduce((t, x) => t + x.total, 0);
    el.innerHTML = `<div class="grid exp-tiles">${[['Invoices to raise', sums(d.to_raise)], ['Waiting to be sent', sums(d.to_send)], ['Payment pending', d.due]].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${inr(v)}</div></div>`).join('')}</div>
      <div class="tabs">${tabs.map(([k, l, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l} <span class="n">${n}</span></button>`).join('')}</div><div class="card" style="margin-top:14px">${
  tab === 'raise' ? BB.table([{ t: 'Client', f: billRows.Client }, { t: 'Candidate', f: billRows.Candidate }, { t: 'Joining', f: (b) => (b.joining_date ? fmtD(b.joining_date) : '—') }, { t: 'CTC', num: 1, f: (b) => inr(b.ctc) }, { t: 'Fee', num: 1, f: (b) => inr(b.fee) }, { t: 'GST', num: 1, f: (b) => inr(b.gst) }, { t: 'Invoice total', num: 1, f: (b) => `<b>${inr(b.total)}</b>` }], d.to_raise, { open: (b) => `bill:${b.id}`, empty: 'No invoices to raise.' })
    : tab === 'send' ? BB.table([{ t: 'Invoice', f: (b) => `<b>${esc(b.bill_no || '—')}</b>` }, { t: 'Client', f: billRows.Client }, { t: 'Candidate', f: billRows.Candidate }, { t: 'Amount', num: 1, f: (b) => `<b>${inr(b.total)}</b>` }, { t: '', f: (b) => `<span onclick="event.stopPropagation()"><button class="btn sm primary" data-asend="${b.id}">Send</button></span>` }], d.to_send, { open: (b) => `bill:${b.id}`, empty: 'Nothing waiting to be sent.' })
      : tab === 'follow' ? BB.table([{ t: 'Invoice', f: (b) => `<b>${esc(b.bill_no || '—')}</b><div class="tiny muted">${esc(b.sent_via || '')}</div>` }, { t: 'Client', f: billRows.Client }, { t: 'Pending', num: 1, f: (b) => `<b>${inr(b.balance)}</b>` }, { t: 'Due', f: (b) => `${b.due_date ? fmtD(b.due_date) : '—'}${b.days_overdue ? `<div class="tiny" style="color:var(--danger,#c0392b)">${b.days_overdue} days late</div>` : ''}` }, { t: 'Last follow-up', f: (b) => `${esc(b.last_note || '—')}${b.last_at ? `<div class="tiny muted">${fmtDT(b.last_at)}</div>` : ''}` }, { t: 'Next', f: (b) => (b.next_at ? fmtDT(b.next_at) : '—') }, { t: '', f: (b) => `<span onclick="event.stopPropagation()"><button class="btn sm" data-aremind="${b.id}">Remind</button></span>` }], d.followups, { open: (b) => `bill:${b.id}`, empty: 'No payments pending.' })
        : BB.table([{ t: 'Candidate', f: (x) => `<b>${esc(x.candidate_name)}</b><div class="tiny muted">${esc(x.job_title)}</div>` }, { t: 'Client', f: (x) => esc(x.client_name) }, { t: 'Step', f: (x) => esc(x.step) }, { t: 'Offer letter', f: (x) => (x.letter_at ? fmtD(x.letter_at) : 'Not yet') }, { t: 'Joining', f: (x) => (x.joining_date ? fmtD(x.joining_date) : '—') }, { t: 'CTC', num: 1, f: (x) => inr(x.ctc) }, { t: 'Invoice amount', num: 1, f: (x) => `<b>${inr(x.total)}</b>` }, { t: 'Bill', f: (x) => (x.bill_id ? `<a href="#" data-open="bill:${x.bill_id}">${esc(x.bill_status)}</a>` : 'Not asked yet') }], d.offers, { empty: 'No offers yet.' })}</div>`;
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => BB.setQ({ tab: b.dataset.tab === 'raise' ? '' : b.dataset.tab })));
    $$('[data-asend]', el).forEach((b) => (b.onclick = () => F.sendBill(d.to_send.find((x) => x.id === b.dataset.asend), 'invoice')));
    $$('[data-aremind]', el).forEach((b) => (b.onclick = () => F.sendBill(d.followups.find((x) => x.id === b.dataset.aremind), 'reminder')));
  };
  const searchPage = (url, render) => async ({ el, q }) => {
    const rows = await BB.api(`${url}?${BB.qs({ q: q.q })}`); el.innerHTML = `<div class="filters exp-filters"><input placeholder="Search…" value="${esc(q.q || '')}" data-q data-xq></div><div class="card">${render(rows)}</div>`;
    let t; $('[data-q]', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => BB.setQ({ q: e.target.value }), 350); };
  };
  P.acclients = searchPage('/api/accounts/clients', (rows) => BB.table([{ t: 'Client', f: (c) => `<b>${esc(c.company)}</b><div class="tiny muted">${esc(c.contact || '')}</div>` }, { t: 'City', f: (c) => esc(c.city || '—') }, { t: 'Contact', f: (c) => `${esc(c.whatsapp || '—')}<div class="tiny muted">${esc(c.email || '')}</div>` }, { t: 'GSTIN', f: (c) => esc(c.gstin || '—') }, { t: 'Billed', num: 1, f: (c) => inr(c.billed) }, { t: 'Pending', num: 1, f: (c) => `<b>${inr(c.outstanding)}</b>` }], rows, { open: (c) => `accclient:${c.id}`, empty: 'No clients found.' }));
  P.accandidates = searchPage('/api/accounts/candidates', (rows) => BB.table([{ t: 'Candidate', f: (x) => `<b>${esc(x.name)}</b><div class="tiny muted">${esc(x.city || '')}</div>` }, { t: 'Position', f: (x) => esc(x.job_title) }, { t: 'Client', f: (x) => esc(x.client_name) }, { t: 'Step', f: (x) => esc(x.result === 'open' ? x.step : x.result) }, { t: 'Joining', f: (x) => (x.joining_date ? fmtD(x.joining_date) : '—') }, { t: 'CTC', num: 1, f: (x) => inr(x.ctc) }], rows, { empty: 'No candidates with an offer yet.' }));
  BB.panels.accclient = async (id) => {
    const c = await BB.api(`/api/accounts/clients/${id}`);
    return { head: `<div class="row"><h2>${esc(c.company)}</h2></div>`, body: `<div class="card pad sec"><dl class="kv"><dt>Contact</dt><dd>${esc(c.contact || '—')}</dd><dt>WhatsApp</dt><dd>${esc(c.whatsapp || '—')}</dd><dt>Email</dt><dd>${esc(c.email || '—')}</dd><dt>City</dt><dd>${esc([c.city, c.state].filter(Boolean).join(', ') || '—')}</dd><dt>GSTIN</dt><dd>${esc(c.gstin || '—')}</dd><dt>Payment days</dt><dd>${c.payment_days}</dd></dl>${c.kyc.length ? `<div class="row" style="margin-top:10px">${c.kyc.map((k) => `<button class="btn sm" data-file="${esc(k.file)}">${esc(k.label)}</button>`).join('')}</div>` : ''}</div>
      <div class="sec"><h3>Bills</h3>${BB.table([{ t: 'Invoice', f: (b) => esc(b.bill_no || 'To raise') }, { t: 'Candidate', f: (b) => esc(b.candidate_name || '—') }, { t: 'Total', num: 1, f: (b) => inr(b.total) }, { t: 'Pending', num: 1, f: (b) => inr(b.balance) }, { t: 'Stage', f: (b) => esc(b.stage) }], c.bills, { open: (b) => `bill:${b.id}`, empty: 'No bills yet.' })}</div>`, mount: () => {} };
  };

  // A call started from the portal stays on screen until it is logged.
  F.callBar = () => {
    const k = BB.me.open_call; let bar = $('[data-callbar]'); if (!k) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'call-bar'; bar.dataset.callbar = 1; document.body.appendChild(bar); }
    bar.innerHTML = `<b>Call with ${esc(k.who)} not logged yet</b><span class="grow">Nothing else can be saved until it is.</span><button class="btn sm ghost" data-callskip>I did not call</button><button class="btn sm primary" data-calllog>Log this call</button>`;
    $('[data-callskip]', bar).onclick = () => BB.ask({ title: `No call with ${esc(k.who)}?`, note: 'The call is dropped and you can carry on. If you did speak to them, log the call instead.', fields: [{ name: 'reason', label: 'What happened', type: 'select', options: ['Tapped Call by mistake', 'Did not go through', 'Called from another phone and logged it there'], placeholder: false }], ok: 'Drop the call', submit: (v) => BB.post('/api/calls/open/cancel', v) }).then(async (x) => { if (x) { await BB.refreshCounts(); BB.toast('Call dropped. Carry on.'); } });
    $('[data-calllog]', bar).onclick = () => BB.logCall({ ...k, started_at: k.at }).then(async (x) => { if (x) { await BB.refreshCounts(); done('Call logged'); } });
  };

  // ---------- Time period, shared by Expenses, Client bills and Summary ----------
  const PERIODS = [['', 'All time'], ['month', 'This month'], ['last', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This financial year'], ['lastfy', 'Last financial year'], ['custom', 'Custom dates']];
  const periodDates = (k) => {
    const [y, m] = BB.istDay().split('-').map(Number); const day = (a, b, c2) => new Date(Date.UTC(a, b - 1, c2)).toISOString().slice(0, 10); const fy = m >= 4 ? y : y - 1;
    if (k === 'month') return [day(y, m, 1), day(y, m + 1, 0)]; if (k === 'last') return [day(y, m - 1, 1), day(y, m, 0)];
    if (k === 'quarter') { const start = m - ((m + 8) % 3); return [day(y, start, 1), day(y, start + 3, 0)]; }
    if (k === 'fy') return [day(fy, 4, 1), day(fy + 1, 3, 31)]; if (k === 'lastfy') return [day(fy - 1, 4, 1), day(fy, 3, 31)]; return ['', ''];
  };
  F.periodBar = (q) => `<div class="period-bar"><select data-period aria-label="Time period">${PERIODS.map(([k, l]) => `<option value="${k}" ${(q.period || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select><label class="small">From <input type="date" data-pf="from" value="${esc(q.from || '')}"></label><label class="small">To <input type="date" data-pf="to" value="${esc(q.to || '')}"></label></div>`;
  F.wirePeriod = (el) => {
    const p = $('[data-period]', el); p.onchange = () => { if (p.value === 'custom') return BB.setQ({ period: 'custom' }); const [from, to] = periodDates(p.value); BB.setQ({ period: p.value, from, to, page: 1 }); };
    $$('[data-pf]', el).forEach((i) => (i.onchange = () => BB.setQ({ period: 'custom', [i.dataset.pf]: i.value, page: 1 })));
  };
  // An uploaded invoice is read like a CV: the form is filled and a person checks it before saving.
  const invoiceTop = (has) => `<div class="inv-top"><button type="button" class="btn sm primary" data-xfile>${has ? 'Replace invoice' : 'Upload invoice'}</button><span class="small muted" data-xname>${has ? 'Invoice on file' : 'PDF, Word or image. The details below fill in by themselves.'}</span></div>`;
  const wireInvoice = (m, kind, onFile, apply) => {
    const note = $('[data-xname]', m); $('[data-xfile]', m).onclick = async () => {
      const f = await BB.pickFile(INVOICE_TYPES); if (!f) return; onFile(f); note.textContent = `Reading ${f.name}…`;
      try { apply(await BB.post('/api/read-invoice', { kind, name: f.name, base64: f.base64 })); note.textContent = `${f.name}: details filled in. Please check them.`; } catch (e) { note.textContent = `${f.name} attached. ${e.message}`; }
    };
  };
  const fill = (m, name, v) => { const i = $(`[name="${name}"]`, m); if (i && v !== '' && v !== null && v !== undefined) i.value = v; };

  // ---------- Expenses ----------
  const INVOICE_TYPES = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
  const PAY_BADGE = { Paid: 'b-green', 'Not paid': 'b-red', 'Part paid': 'b-amber' };
  const NEW_OPT = '__new';
  const expenseForm = (d, x, agency) => {
    const r = x || {}; let file = null; const names = d.tree.map((t) => t.name); const cats = r.category && !names.includes(r.category) ? [r.category, ...names] : names;
    const subsOf = (cat) => { const t = d.tree.find((y) => y.name === cat); const list = t ? t.subs : []; return r.sub && r.category === cat && !list.includes(r.sub) ? [r.sub, ...list] : list; };
    const subOpts = (cat, val) => `<option value="">Choose…</option>${subsOf(cat).map((y) => `<option ${y === val ? 'selected' : ''}>${esc(y)}</option>`).join('')}<option value="${NEW_OPT}">+ Add a new subcategory</option>`;
    const first = r.category || cats[0];
    setTimeout(() => {
      const m = $('.modal'); if (!m) return; const q = (n) => $(`[name="${n}"]`, m); const show = (n, on) => $(`[data-f="${n}"]`, m).classList.toggle('hidden', !on);
      const refresh = () => { const isNew = q('category').value === NEW_OPT; show('sub', !isNew); show('category_new', isNew); show('sub_new', isNew || q('sub').value === NEW_OPT); const st = q('pay_status').value; show('paid_amount', st === 'Part paid'); show('paid_via', st !== 'Not paid'); };
      q('category').onchange = () => { q('sub').innerHTML = subOpts(q('category').value, ''); refresh(); }; q('sub').onchange = refresh; q('pay_status').onchange = refresh; refresh();
      wireInvoice(m, 'expense', (f) => { file = f; }, (r) => {
        fill(m, 'date', r.date); fill(m, 'amount', r.amount); fill(m, 'vendor', r.party); fill(m, 'invoice_no', r.invoice_no); fill(m, 'note', r.description);
        if (r.category) { q('category').value = r.category; q('sub').innerHTML = subOpts(r.category, r.sub); refresh(); }
      });
    }, 0);
    return BB.ask({ title: x ? 'Edit expense' : 'Add expense', wide: true, fields: [
      invoiceTop(!!r.file_id),
      `<div class="grid g3">${field({ name: 'date', label: 'Date', type: 'date', value: r.date ? String(r.date).slice(0, 10) : BB.istDay() })}${field({ name: 'amount', label: 'Amount (₹)', type: 'number', value: r.amount })}${field({ name: 'pay_status', label: 'Payment status', type: 'select', options: d.statuses, placeholder: false, value: r.pay_status || 'Paid' })}</div>`,
      `<div class="grid g2">${field({ name: 'category', label: 'Category', type: 'select', options: [...cats, [NEW_OPT, '+ Add a new category']], placeholder: false, value: first })}<label class="field" data-f="sub"><span class="lab">Subcategory <span class="opt">(optional)</span></span><select name="sub">${subOpts(first, r.sub)}</select></label></div>`,
      `<div class="grid g2">${field({ name: 'category_new', label: 'New category', opt: true, voice: false })}${field({ name: 'sub_new', label: 'New subcategory', opt: true, voice: false })}</div>`,
      `<div class="grid g2">${field({ name: 'vendor', label: 'Paid to', opt: true, placeholder: 'Naukri, Meta, Vi…', value: r.vendor })}${field({ name: 'invoice_no', label: 'Invoice number', opt: true, value: r.invoice_no })}</div>`,
      `<div class="grid g2">${field({ name: 'paid_via', label: 'Paid from', type: 'select', options: d.accounts, opt: true, value: r.paid_via })}${field({ name: 'paid_amount', label: 'Paid so far (₹)', type: 'number', opt: true, value: r.paid_amount })}</div>`,
      { name: 'note', label: 'Description', opt: true, value: r.note },
      `<details class="exp-more"><summary>Link to a client or job</summary><div class="grid g2">${field({ name: 'client_id', label: 'Client', type: 'select', options: d.tags.clients, opt: true, value: r.client_id })}${field({ name: 'job_id', label: 'Job opening', type: 'select', options: d.tags.jobs, opt: true, value: r.job_id })}</div></details>`,
    ], ok: 'Save expense', submit: (v) => BB.post(x ? `/api/expenses/${x.id}` : '/api/expenses', { ...v, file, agency_id: agency || undefined }) });
  };
  F.billForm = (r) => {
    let file = null;
    setTimeout(() => { const m = $('.modal'); if (!m) return; wireInvoice(m, 'bill', (f) => { file = f; }, (x) => { fill(m, 'date', x.date); fill(m, 'amount', x.amount); fill(m, 'gst', x.tax); fill(m, 'bill_no', x.invoice_no); fill(m, 'person_name', x.person); fill(m, 'client_id', x.client_id); }); }, 0);
    return BB.ask({ title: 'Add bill', wide: true, fields: [
      invoiceTop(false),
      `<div class="grid g2">${field({ name: 'client_id', label: 'Client', type: 'select', options: r.clients })}${field({ name: 'stage', label: 'Stage', type: 'select', options: ['Billed', 'Received', 'Outstanding'], placeholder: false, value: 'Billed' })}</div>`,
      `<div class="grid g2">${field({ name: 'bill_no', label: 'Invoice number', opt: true, voice: false })}${field({ name: 'date', label: 'Invoice date', type: 'date', value: BB.istDay() })}</div>`,
      `<div class="grid g2">${field({ name: 'amount', label: 'Invoice amount with GST (₹)', type: 'number' })}${field({ name: 'gst', label: 'GST in this amount (₹)', type: 'number', opt: true })}</div>`,
      `<div class="grid g2">${field({ name: 'person_name', label: 'Candidate', opt: true })}${field({ name: 'job_name', label: 'Position', opt: true })}</div>`,
    ], ok: 'Save bill', submit: (v) => BB.post('/api/bills', { ...v, file }) });
  };
  F.expenses = async ({ el, actions, q }) => {
    const d = await BB.api(`/api/expenses?${BB.qs({ q: q.q, category: q.category, status: q.status, from: q.from, to: q.to, agency: q.agency })}`); const t = d.totals;
    actions.innerHTML = '<button class="btn primary" data-xadd>+ Add expense</button>';
    const opt = (list, val) => list.map((x) => `<option ${x === val ? 'selected' : ''}>${esc(x)}</option>`).join('');
    el.innerHTML = `<div class="grid exp-tiles">${[['Total expenses', t.total], ['Paid', t.paid], ['Yet to pay', t.due]].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${inr(v)}</div></div>`).join('')}</div>
      <div class="filters exp-filters"><input placeholder="Search paid to, invoice, description…" value="${esc(q.q || '')}" data-xq><select data-xf="category"><option value="">All categories</option>${opt(d.tree.map((x) => x.name), q.category)}</select><select data-xf="status"><option value="">Any payment status</option>${opt(d.statuses, q.status)}</select>${d.agencies.length ? `<select data-xf="agency"><option value="">All agencies and BrillBrains</option>${d.agencies.map((a) => `<option value="${a.id}" ${q.agency === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}</div>
      <div class="card">${BB.table([{ t: 'Date', f: (r) => fmtD(r.date) }, { t: 'Category', f: (r) => `<b>${esc(r.category)}</b>${r.sub ? `<div class="tiny muted">${esc(r.sub)}</div>` : ''}` }, { t: 'Paid to', f: (r) => `${esc(r.vendor || '—')}${[r.invoice_no && `Invoice ${r.invoice_no}`, r.note, r.client_name, r.job_name].filter(Boolean).length ? `<div class="tiny muted">${[r.invoice_no && `Invoice ${r.invoice_no}`, r.note, r.client_name, r.job_name].filter(Boolean).map(esc).join(' · ')}</div>` : ''}` }, { t: 'Amount', num: 1, f: (r) => `<b>${inr(r.amount)}</b>` }, { t: 'Payment', f: (r) => `<span class="badge ${PAY_BADGE[r.pay_status] || 'b-outline'}">${esc(r.pay_status)}</span><div class="tiny muted">${r.pay_status === 'Part paid' ? `${inr(r.balance)} left` : esc(r.paid_via || '')}</div>` }, { t: 'Invoice', f: (r) => (r.file_id ? `<button class="btn sm" data-xopen="${r.file_id}">Open</button>` : `<button class="btn sm" data-xup="${r.id}">Upload</button>`) }, { t: '', f: (r) => `<span class="row nowrap"><button class="btn sm ghost" data-xedit="${r.id}">Edit</button><button class="btn sm ghost" data-delx="${r.id}">Remove</button></span>` }], d.rows, { empty: 'No expenses yet.' })}</div>`;
    const qi = $('[data-xq]', el); qi.onchange = () => BB.setQ({ q: qi.value });
    $$('[data-xf]', el).forEach((f) => (f.onchange = () => BB.setQ({ [f.dataset.xf]: f.value })));
    $('[data-xadd]', actions).onclick = () => expenseForm(d, null, q.agency).then((x) => x && done('Expense added'));
    $$('[data-xedit]', el).forEach((b) => (b.onclick = () => expenseForm(d, d.rows.find((x) => String(x.id) === b.dataset.xedit), q.agency).then((x) => x && done('Expense saved'))));
    $$('[data-xopen]', el).forEach((b) => (b.onclick = () => BB.openFile(b.dataset.xopen)));
    $$('[data-xup]', el).forEach((b) => (b.onclick = async () => { const f = await BB.pickFile(INVOICE_TYPES); if (f) act(() => BB.post(`/api/expenses/${b.dataset.xup}/invoice`, f), 'Invoice saved'); }));
    $$('[data-delx]', el).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Remove this expense', 'It comes off the totals.', 'Remove')) act(() => BB.post(`/api/expenses/${b.dataset.delx}/delete`), 'Removed'); }));
  };
  // ---------- Summary: income against expenses, month by month ----------
  F.summary = async ({ el, actions, q }) => {
    const d = await BB.api(`/api/books?${BB.qs({ agency: q.agency, from: q.from, to: q.to })}`); const sum = (k) => d.months.reduce((t, r) => t + r[k], 0);
    actions.innerHTML = '<button class="btn" data-brev>+ Log other income</button>';
    const tile = (l, v) => `<div class="card pad"><div class="small muted">${l}</div><div class="kpi">${inr(v)}</div></div>`;
    el.innerHTML = `${d.agencies.length ? `<div class="filters"><select data-bag><option value="">All agencies and BrillBrains</option>${d.agencies.map((a) => `<option value="${a.id}" ${q.agency === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px">${tile('Income', sum('billed') + sum('other'))}${tile('Received', sum('received'))}${tile('Expenses', sum('expenses'))}${tile('Profit', sum('net'))}${tile('Yet to collect', d.dues)}</div>
      <div class="card" style="margin-bottom:14px"><div class="card-h"><h3>Month by month</h3></div>${BB.table([{ t: 'Month', f: (r) => esc(r.month) }, { t: 'Income', num: 1, f: (r) => inr(r.billed + r.other) }, { t: 'GST', num: 1, f: (r) => inr(r.gst) }, { t: 'Received', num: 1, f: (r) => inr(r.received) }, { t: 'Expenses', num: 1, f: (r) => inr(r.expenses) }, { t: 'Profit', num: 1, f: (r) => `<b>${inr(r.net)}</b>` }], d.months)}</div>
      <div class="card"><div class="card-h"><h3>Other income</h3></div>${BB.table([{ t: 'Date', f: (r) => fmtD(r.date) }, { t: 'What', f: (r) => `${esc(r.kind)}<div class="tiny muted">${esc(r.note)}</div>` }, { t: 'Amount', num: 1, f: (r) => inr(r.amount) }, { t: '', f: (r) => `<button class="btn sm ghost" data-delr="${r.id}">Remove</button>` }], d.revenue, { empty: 'Nothing logged. Client bills are counted by themselves.' })}</div>`;
    const ag = $('[data-bag]', el); if (ag) ag.onchange = () => BB.setQ({ agency: ag.value });
    $('[data-brev]', actions).onclick = () => BB.ask({ title: 'Log other income', fields: [`<div class="grid g2">${field({ name: 'date', label: 'Date', type: 'date', value: BB.istDay() })}${field({ name: 'amount', label: 'Amount (₹)', type: 'number' })}</div>`, { name: 'kind', label: 'Kind', type: 'select', options: d.kinds, placeholder: false }, { name: 'note', label: 'Note', opt: true }], ok: 'Save', submit: (v) => BB.post('/api/revenue', { ...v, agency_id: q.agency || undefined }) }).then((x) => x && done('Income logged'));
    $$('[data-delr]', el).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Remove this entry', 'It comes off the totals.', 'Remove')) act(() => BB.post(`/api/revenue/${b.dataset.delr}/delete`), 'Removed'); }));
  };

  // ---------- The candidate's other applications ----------
  F.appOthers = (a) => {
    const list = a.other_apps || []; if (!list.length) return ''; const live = list.filter((x) => x.result === 'open').length; const hired = list.filter((x) => x.result === 'Hired').length;
    return `<details class="sec card pad others"><summary><b>Other applications</b> <span class="muted">${list.length} · ${live} in progress${hired ? ` · ${hired} hired` : ''} · ${list.length - live - hired} closed</span></summary><div class="stack-sm" style="margin-top:8px">${list.map((x) => `<div class="row between small"><a href="#" data-open="application:${x.id}">${esc(x.job_title)}</a><span class="muted">${esc(x.client_name || '')}</span><span class="badge ${x.result === 'open' ? 'b-primary' : x.result === 'Hired' ? 'b-green' : 'b-outline'}">${esc(x.result === 'open' ? x.step : x.result)}</span></div>`).join('')}</div></details>`;
  };

  // ---------- Asking the client for a slot, and the reply ----------
  const SLOT_LABEL = { Waiting: ['Waiting for the client', 'b-amber'], 'Another time': ['Client wants another time', 'b-red'], Replied: ['Client replied', 'b-amber'], Suggested: ['Check the reply', 'b-amber'], Scheduled: ['Interview fixed', 'b-green'], Closed: ['Closed', 'b-outline'] };
  F.appSlotBtn = (a) => (['Sent to client', 'Client interview'].includes(a.step) ? '<button class="btn sm" data-fslots>Ask client for a slot</button>' : '');
  F.appSlots = (a) => {
    const x = a.slot_ask; if (!x) return ''; const [label, cls] = SLOT_LABEL[x.status] || [x.status, 'b-outline']; const open = ['Waiting', 'Another time', 'Replied', 'Suggested'].includes(x.status);
    return `<div class="sec card pad stack-sm"><div class="row between"><h3 style="margin:0">Interview slots</h3><span class="badge ${cls}">${esc(label)}</span></div>
      <ol class="slot-list">${x.slots.map((t) => `<li class="${x.picked_at === t ? 'on' : ''}">${fmtDT(t)}</li>`).join('')}</ol>
      <div class="small muted">${[x.place, `Sent by ${x.by}`, fmtDT(x.at)].filter(Boolean).map(esc).join(' · ')}</div>
      ${x.reply ? `<div class="slot-reply"><b>Client wrote:</b> ${esc(x.reply)}</div>` : ''}${x.reply_note ? `<div class="small muted">${esc(x.reply_note)}</div>` : ''}
      ${open ? `<div class="row">${x.suggested_at ? `<button class="btn sm primary" data-sfix="${x.id}">Schedule for ${fmtDT(x.suggested_at)}</button>` : ''}<button class="btn sm ghost" data-scancel="${x.id}">Cancel this request</button></div>` : ''}</div>`;
  };
  const askSlots = (a) => { const later = (h) => BB.toLocalInput(new Date(Date.now() + h * 3600000));
    return BB.ask({ title: 'Ask client for a slot', note: `Goes to ${esc(a.client.company)} on WhatsApp. When they tap a time, the interview is fixed and the candidate is told.`, fields: [`<div class="grid g3">${field({ name: 'slot1', label: 'Slot 1', type: 'datetime-local', value: later(24) })}${field({ name: 'slot2', label: 'Slot 2', type: 'datetime-local', opt: true })}${field({ name: 'slot3', label: 'Slot 3', type: 'datetime-local', opt: true })}</div>`, { name: 'place', label: 'Interview place', value: a.client.city || '', opt: true }], ok: 'Send to client', submit: (v) => BB.post(`/api/applications/${a.id}/ask-slots`, v) }); };

  // ---------- Interview questions from the job, the client's business and this resume ----------
  F.appQuestions = (a) => {
    const q = a.questions; const list = q ? q.questions : [];
    const rd = q && q.round ? q.round : 'phone'; const p = a.prep;
    return `<div class="sec card pad stack-sm"><div class="row between"><h3 style="margin:0">Interview questions</h3><span class="row"><select class="mini" data-fqround aria-label="For which round" style="width:auto">${[['phone', 'Phone round'], ['video', 'Video round'], ['', 'Any round']].map(([k, l]) => `<option value="${k}" ${(q ? q.round || '' : 'phone') === k ? 'selected' : ''}>${l}</option>`).join('')}</select><select class="mini" data-fqlang aria-label="Language" style="width:auto">${[['en', 'English'], ['hinglish', 'Hinglish'], ['hi', 'Hindi']].map(([k, l]) => `<option value="${k}" ${((q && q.lang) || 'en') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${q ? '<button class="btn sm" data-fqcopy>Copy</button>' : ''}<button class="btn sm ${q ? '' : 'primary'}" data-fqmake>${q ? 'Make again' : 'Make questions with AI'}</button></span></div>
      ${q ? `<div class="small muted">${q.round ? `For the ${q.round === 'phone' ? 'phone' : 'video'} round · ` : ''}${q.lang && q.lang !== 'en' ? `${q.lang === 'hi' ? 'Hindi' : 'Hinglish'} · ` : ''}Made by ${esc(q.by)} · ${fmtDT(q.at)}</div>${list.map((s, i) => `<details class="q-sec"><summary>${esc(s.title)} <span class="muted">${s.questions.length}</span></summary><ol>${s.questions.map((x) => `<li><b>${esc(x.q)}</b>${x.resume_ref ? `<div class="tiny q-ref">Resume: ${esc(x.resume_ref)}</div>` : ''}<div class="tiny muted">Listen for: ${esc(x.listen_for)}</div></li>`).join('')}</ol></details>`).join('')}` : ''}
      <details class="q-sec prep" ${p ? '' : ''}><summary>For the candidate: prepare for the face-to-face round ${p ? `<span class="muted">${p.questions.length}</span>` : ''}${p && p.shared_at ? ' <span class="badge b-green tiny">Shared</span>' : ''}</summary>
        <div class="small muted" style="margin:6px 0">Questions the client may ask, with a tip on each. Read them, then share: the candidate sees them in their profile${a.candidate && a.candidate.email ? ' and gets them by email' : ''}.</div>
        ${p ? `<ol>${p.questions.map((x) => `<li><b>${esc(x.q)}</b><div class="tiny muted">Tip: ${esc(x.tip)}</div></li>`).join('')}</ol>${p.know.length ? `<ul class="small">${p.know.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<div class="tiny muted">Made by ${esc(p.by)} · ${fmtDT(p.at)}${p.shared_at ? ` · shared ${fmtDT(p.shared_at)}` : ''}</div>` : ''}
        <div class="row" style="margin-top:8px"><button class="btn sm ${p ? '' : 'primary'}" data-fprep>${p ? 'Make again' : 'Make with AI'}</button>${p ? `<button class="btn sm ${p.shared_at ? '' : 'primary'}" data-fprepshare>${p.shared_at ? 'Share again' : 'Share with candidate'}</button>` : ''}</div></details></div>`;
  };

  // ---------- Settings → Messages on hold ----------
  F.holds = async (body, save) => {
    const d = await BB.api('/api/holds');
    body.innerHTML = `<div class="card pad stack-sm" style="margin-bottom:14px;max-width:780px"><h3 style="margin:0">Messages on hold</h3><p class="small muted" style="margin:0">Everything automatic is saved here and not sent. Login codes, team passwords and replies your team types by hand still go. Held messages are not sent later when you switch on; only new ones go.</p>
        <form class="stack-sm" data-hf>${field({ name: 'everyone', label: 'Hold all automatic WhatsApp', type: 'check', value: d.wa })}${field({ name: 'email', label: 'Hold all email', type: 'check', value: d.email })}<button class="btn primary" style="width:max-content">Save</button></form>
        <div class="small"><b>Before switching on:</b> ${[!d.smtp && 'set up outgoing email (SMTP) on the server', !d.accounts_email && 'add the Accounts email in Fees & limits', d.unapproved.length && `get ${d.unapproved.length} WhatsApp template(s) approved by Meta: ${d.unapproved.join(', ')}`].filter(Boolean).map(esc).join(' · ') || 'nothing left'}</div></div>
      <div class="card" style="margin-bottom:14px"><div class="card-h"><h3>WhatsApp</h3></div>${BB.table([{ t: 'Message', f: (r) => `<b>${esc(r.when)}</b><div class="tiny mono muted">${esc(r.format)}</div>` }, { t: 'To', f: (r) => esc(r.to) }, { t: 'State', f: (r) => `<span class="badge ${r.state === 'Held' ? 'b-amber' : 'b-green'}">${esc(r.state)}</span>` }, { t: 'Held', num: 1, f: (r) => r.held }, { t: 'Needs first', f: (r) => esc(r.need.join(', ') || '—') }], d.rows)}</div>
      <div class="card"><div class="card-h"><h3>Email</h3></div>${BB.table([{ t: 'Email', f: (r) => esc(r.label) }, { t: 'Held', num: 1, f: (r) => r.held }, { t: 'Latest', f: (r) => fmtDT(r.last) }, { t: 'Needs first', f: (r) => esc(r.need) }], d.mails)}</div>`;
    $('[data-hf]', body).onsubmit = async (e) => { e.preventDefault(); const f = e.target; const cur = (await BB.api('/api/settings')).wa_pause || {}; save('wa_pause', { ...cur, everyone: f.everyone.checked, email: f.email.checked }); };
  };
})();
