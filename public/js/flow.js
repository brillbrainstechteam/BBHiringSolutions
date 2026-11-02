/* The working process on screen: client call, agreement, email, online lookup, WhatsApp group, screening with AI,
   offer stages, invoices, books, and the messages on hold. Panels and pages call into BB.flow. */
(() => {
  const { $, $$, esc, inr, fmtD, fmtDT, field, scoreBadge } = BB;
  const P = BB.pages;
  const me = () => BB.me.user;
  const canAdmin = () => me().level !== 'sub';
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
      <div class="ci-grid">${tile('Sells to', esc(o.customers || ''))}${tile('Products', esc(o.products || ''))}${tile('Locations', esc(o.branches || ''))}${tile('Team size', esc(o.team_size || ''))}${tile('Owners', esc(o.owners || ''))}${tile('Started', esc(o.est_year || ''))}${tile('Recent news', esc(o.news || ''))}${tile('Phone', phones.map((p) => `<a href="tel:${esc(p.replace(/[^\d+]/g, ''))}">${esc(p)}</a>`).join('<br>'))}${tile('Email', o.email ? `<a href="mailto:${esc(o.email)}">${esc(o.email)}</a>` : '')}${tile('Address', esc(o.address || ''))}${tile('Business', esc(o.kind || ''))}</div>
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
      ${(c.calls || []).length ? `<div class="sec"><h3>Client calls</h3><div class="stack-sm">${c.calls.map((x) => `<div class="card pad small"><div class="row between"><span class="faint">${fmtDT(x.at)} · ${esc(x.by)}</span>${x.call_roles ? (x.call_roles.filter((l) => !l.job_id).length ? `<button class="btn sm" data-fjobs="${x.id}">Open ${x.call_roles.filter((l) => !l.job_id).length > 1 ? 'all as draft jobs' : 'as a draft job'}</button>` : '') : `<button class="btn sm" data-fjob="${x.id}">Open a job from this</button>`}</div>${x.call_roles ? callRoleRows(x) : ''}<dl class="kv" style="margin-top:6px">${[...(x.call_roles ? [] : [['Openings', x.openings], ['Location', x.location], ['Department', x.department], ['Roles', x.roles]]), ['Skills', x.skills], ['Responsibilities', x.duties], ['Notes', x.notes]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`).join('')}</div></div>` : ''}
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
    on('[data-fuse]', () => { const o = c.extra.online; const ex = { ...c.extra }; for (const [k, s] of [['website', o.website], ['branches', o.branches], ['est_year', o.est_year], ['owner_name', o.owners], ['address', o.address], ['team_size', o.team_size]]) if (s && !ex[k]) ex[k] = s; act(() => BB.patch(`/api/clients/${c.id}`, { extra: ex, ...(!c.email && o.email ? { email: o.email } : {}) }), 'Saved on the client'); });
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
  F.appCv = (a) => `<button class="btn sm" data-fcv>CV for client</button>${a.step === 'Our interview' ? '' : '<button class="btn sm" data-fcvmail>Email CV to client</button>'}`;
  F.appMount = (el, a) => {
    $$('[data-ostage]', el).forEach((c) => (c.onchange = () => act(() => BB.post(`/api/applications/${a.id}/offer-stage`, { stage: c.dataset.ostage, on: c.checked }), 'Saved')));
    const tp = $('[data-ftpl]', el); if (tp) tp.onclick = () => BB.download('/api/offer-template/file');
    const ac = $('[data-faccounts]', el); if (ac) ac.onclick = () => act(() => BB.post(`/api/applications/${a.id}/ask-invoice`), (r) => (r.email === 'no address' ? 'Draft bill made. Add the Accounts email in Settings → Fees & limits' : r.email === 'held' ? 'Draft bill made. The email is saved: messages are off' : 'Accounts asked'));
    const cv = $('[data-fcv]', el); if (cv) cv.onclick = async () => { try { const f = await BB.post(`/api/applications/${a.id}/client-cv`); BB.openFile(f.id); BB.toast('CV made without phone and email'); } catch (e) { BB.fail(e); } };
    const sl = $('[data-fslots]', el); if (sl) sl.onclick = () => askSlots(a).then((x) => x && done('Sent to the client'));
    $$('[data-sfix]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/slot-asks/${b.dataset.sfix}/schedule`), (r) => r.effect)));
    $$('[data-scancel]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/slot-asks/${b.dataset.scancel}/cancel`), 'Request cancelled')));
    const qm = $('[data-fqmake]', el); if (qm) qm.onclick = async () => { qm.disabled = true; qm.textContent = 'Reading the resume…'; await act(() => BB.post(`/api/applications/${a.id}/questions`), 'Questions ready'); qm.disabled = false; qm.textContent = a.questions ? 'Make again' : 'Make questions with AI'; };
    const qc = $('[data-fqcopy]', el); if (qc) qc.onclick = async () => { const t = a.questions.questions.map((s) => `${s.title}\n${s.questions.map((x, i) => `${i + 1}. ${x.q}`).join('\n')}`).join('\n\n'); try { await navigator.clipboard.writeText(t); BB.toast('Questions copied'); } catch { BB.toast('Could not copy', true); } };
    const cvm = $('[data-fcvmail]', el); if (cvm) cvm.onclick = () => F.composeMail([a.client.id], 'cv', 'Email CV to client', a.id);
  };

  // ---------- bill: Accounts' invoice and payment follow-ups ----------
  F.bill = (b) => `<div class="sec"><h3>Invoice from Accounts</h3><div class="row small">${b.accounts_asked_at ? `<span class="muted">Accounts asked ${fmtDT(b.accounts_asked_at)}</span>` : '<span class="muted">Accounts not asked yet</span>'}${b.invoice_file ? `<button class="btn sm" data-file="${b.invoice_file}">Invoice file</button>` : ''}${canAdmin() ? `<button class="btn sm primary" data-finv>${b.bill_no ? 'Update invoice' : 'Record invoice'}</button><button class="btn sm" data-ffu>Log payment follow-up</button>` : ''}</div><div data-fus class="stack-sm" style="margin-top:8px"></div></div>`;
  F.billMount = async (el, b) => {
    const inv = $('[data-finv]', el);
    if (inv) inv.onclick = () => {
      let file = null;
      BB.ask({ title: 'Invoice from Accounts', note: 'Accounts send the invoice to the client and keep us in CC. Note its number here; nothing is sent from the portal.', fields: [{ name: 'invoice_no', label: 'Invoice number', value: b.bill_no || '' }, '<div class="row"><button type="button" class="btn sm" data-invf>Attach the invoice</button><span class="small muted" data-invn></span></div>'], ok: 'Save', submit: (x) => BB.post(`/api/bills/${b.id}/invoice`, { ...x, file }) }).then((v) => v && done('Invoice saved'));
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
      const b = $('[data-xfile]', m); b.onclick = async () => { const f = await BB.pickFile(INVOICE_TYPES); if (f) { file = f; $('[data-xname]', m).textContent = f.name; } };
    }, 0);
    return BB.ask({ title: x ? 'Edit expense' : 'Add expense', wide: true, fields: [
      `<div class="grid g3">${field({ name: 'date', label: 'Date', type: 'date', value: r.date ? String(r.date).slice(0, 10) : BB.istDay() })}${field({ name: 'amount', label: 'Amount (₹)', type: 'number', value: r.amount })}${field({ name: 'pay_status', label: 'Payment status', type: 'select', options: d.statuses, placeholder: false, value: r.pay_status || 'Paid' })}</div>`,
      `<div class="grid g2">${field({ name: 'category', label: 'Category', type: 'select', options: [...cats, [NEW_OPT, '+ Add a new category']], placeholder: false, value: first })}<label class="field" data-f="sub"><span class="lab">Subcategory <span class="opt">(optional)</span></span><select name="sub">${subOpts(first, r.sub)}</select></label></div>`,
      `<div class="grid g2">${field({ name: 'category_new', label: 'New category', opt: true, voice: false })}${field({ name: 'sub_new', label: 'New subcategory', opt: true, voice: false })}</div>`,
      `<div class="grid g2">${field({ name: 'vendor', label: 'Paid to', opt: true, placeholder: 'Naukri, Meta, Vi…', value: r.vendor })}${field({ name: 'invoice_no', label: 'Invoice number', opt: true, value: r.invoice_no })}</div>`,
      `<div class="grid g2">${field({ name: 'paid_via', label: 'Paid from', type: 'select', options: d.accounts, opt: true, value: r.paid_via })}${field({ name: 'paid_amount', label: 'Paid so far (₹)', type: 'number', opt: true, value: r.paid_amount })}</div>`,
      { name: 'note', label: 'Description', opt: true, value: r.note },
      `<details class="exp-more"><summary>Link to a client or job</summary><div class="grid g2">${field({ name: 'client_id', label: 'Client', type: 'select', options: d.tags.clients, opt: true, value: r.client_id })}${field({ name: 'job_id', label: 'Job opening', type: 'select', options: d.tags.jobs, opt: true, value: r.job_id })}</div></details>`,
      `<div class="row"><button type="button" class="btn sm" data-xfile>${r.file_id ? 'Replace invoice' : 'Attach invoice'}</button><span class="small muted" data-xname>${r.file_id ? 'Invoice on file' : 'PDF, Word or image'}</span></div>`,
    ], ok: 'Save expense', submit: (v) => BB.post(x ? `/api/expenses/${x.id}` : '/api/expenses', { ...v, file, agency_id: agency || undefined }) });
  };
  F.expenses = async ({ el, actions, q }) => {
    const d = await BB.api(`/api/expenses?${BB.qs({ q: q.q, category: q.category, status: q.status, month: q.month, agency: q.agency })}`); const t = d.totals;
    actions.innerHTML = '<button class="btn primary" data-xadd>+ Add expense</button>';
    const opt = (list, val) => list.map((x) => `<option ${x === val ? 'selected' : ''}>${esc(x)}</option>`).join('');
    el.innerHTML = `<div class="grid exp-tiles">${[['Total expenses', t.total], ['Paid', t.paid], ['Yet to pay', t.due]].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${inr(v)}</div></div>`).join('')}</div>
      <div class="filters exp-filters"><input placeholder="Search paid to, invoice, description…" value="${esc(q.q || '')}" data-xq><select data-xf="category"><option value="">All categories</option>${opt(d.tree.map((x) => x.name), q.category)}</select><select data-xf="status"><option value="">Any payment status</option>${opt(d.statuses, q.status)}</select><input type="month" aria-label="Month" value="${esc(q.month || '')}" data-xf="month">${d.agencies.length ? `<select data-xf="agency"><option value="">All agencies and BrillBrains</option>${d.agencies.map((a) => `<option value="${a.id}" ${q.agency === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}</div>
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
    const d = await BB.api(`/api/books?${BB.qs({ agency: q.agency })}`); const m = d.months[0] || { billed: 0, received: 0, other: 0, expenses: 0, net: 0 };
    actions.innerHTML = '<button class="btn" data-brev>+ Log other income</button>';
    const tile = (l, v) => `<div class="card pad"><div class="small muted">${l}</div><div class="kpi">${inr(v)}</div></div>`;
    el.innerHTML = `${d.agencies.length ? `<div class="filters"><select data-bag><option value="">All agencies and BrillBrains</option>${d.agencies.map((a) => `<option value="${a.id}" ${q.agency === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
      <div class="small muted" style="margin-bottom:8px">${esc(m.month || 'This month')}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px">${tile('Income', m.billed + m.other)}${tile('Received', m.received)}${tile('Expenses', m.expenses)}${tile('Profit', m.net)}${tile('Yet to collect', d.dues)}</div>
      <div class="card" style="margin-bottom:14px"><div class="card-h"><h3>Month by month</h3></div>${BB.table([{ t: 'Month', f: (r) => esc(r.month) }, { t: 'Income', num: 1, f: (r) => inr(r.billed + r.other) }, { t: 'Received', num: 1, f: (r) => inr(r.received) }, { t: 'Expenses', num: 1, f: (r) => inr(r.expenses) }, { t: 'Profit', num: 1, f: (r) => `<b>${inr(r.net)}</b>` }], d.months)}</div>
      <div class="card"><div class="card-h"><h3>Other income</h3></div>${BB.table([{ t: 'Date', f: (r) => fmtD(r.date) }, { t: 'What', f: (r) => `${esc(r.kind)}<div class="tiny muted">${esc(r.note)}</div>` }, { t: 'Amount', num: 1, f: (r) => inr(r.amount) }, { t: '', f: (r) => `<button class="btn sm ghost" data-delr="${r.id}">Remove</button>` }], d.revenue, { empty: 'Nothing logged. Client bills are counted by themselves.' })}</div>`;
    const ag = $('[data-bag]', el); if (ag) ag.onchange = () => BB.setQ({ agency: ag.value });
    $('[data-brev]', actions).onclick = () => BB.ask({ title: 'Log other income', fields: [`<div class="grid g2">${field({ name: 'date', label: 'Date', type: 'date', value: BB.istDay() })}${field({ name: 'amount', label: 'Amount (₹)', type: 'number' })}</div>`, { name: 'kind', label: 'Kind', type: 'select', options: d.kinds, placeholder: false }, { name: 'note', label: 'Note', opt: true }], ok: 'Save', submit: (v) => BB.post('/api/revenue', { ...v, agency_id: q.agency || undefined }) }).then((x) => x && done('Income logged'));
    $$('[data-delr]', el).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Remove this entry', 'It comes off the totals.', 'Remove')) act(() => BB.post(`/api/revenue/${b.dataset.delr}/delete`), 'Removed'); }));
  };
  P.books = () => location.replace('/team/bills?tab=summary');

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
    return `<div class="sec card pad stack-sm"><div class="row between"><h3 style="margin:0">Interview questions</h3><span class="row">${q ? '<button class="btn sm" data-fqcopy>Copy</button>' : ''}<button class="btn sm ${q ? '' : 'primary'}" data-fqmake>${q ? 'Make again' : 'Make questions with AI'}</button></span></div>
      ${q ? `<div class="small muted">Made by ${esc(q.by)} · ${fmtDT(q.at)}</div>${list.map((s, i) => `<details class="q-sec" ${i === 0 ? 'open' : ''}><summary>${esc(s.title)} <span class="muted">${s.questions.length}</span></summary><ol>${s.questions.map((x) => `<li><b>${esc(x.q)}</b>${x.resume_ref ? `<div class="tiny q-ref">Resume: ${esc(x.resume_ref)}</div>` : ''}<div class="tiny muted">Listen for: ${esc(x.listen_for)}</div></li>`).join('')}</ol></details>`).join('')}` : ''}</div>`;
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
