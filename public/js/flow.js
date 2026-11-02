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
  const callRoleRows = (x) => `<div class="flow-call-roles">${x.call_roles.map((l, i) => `<div class="row between"><span class="grow"><b>${esc(l.role)}</b> · ${l.openings} ${l.openings === 1 ? 'opening' : 'openings'}${l.location ? ` · ${esc(l.location)}` : ''}${l.department ? ` · ${esc(l.department)}` : ''}</span>${l.job_id ? `<button class="btn sm" data-fopen="${esc(l.job_id)}">${esc(l.job_id)}</button>` : `<button class="btn sm" data-fline="${x.id}:${i}">Open job</button>`}</div>`).join('')}</div>`;
  const roleRow = (l = {}) => `<div class="flow-role" data-frole><label class="field"><span class="lab">Role</span><input data-r="role" list="flow-roles" value="${esc(l.role || '')}"></label><label class="field"><span class="lab">Openings</span><input data-r="openings" type="number" min="1" inputmode="numeric"></label><label class="field"><span class="lab">Location</span><input data-r="location" value="${esc(l.location || '')}"></label><label class="field"><span class="lab">Department <span class="opt">(optional)</span></span><input data-r="department" value="${esc(l.department || '')}"></label><button type="button" class="btn sm" data-frm aria-label="Remove role">×</button></div>`;
  const readRoles = (box) => $$('[data-frole]', box).map((r) => Object.fromEntries($$('[data-r]', r).map((i) => [i.dataset.r, i.value.trim()])));
  const wireRoles = (box) => {
    const sum = () => { const t = readRoles(box).reduce((n, x) => n + (Number(x.openings) || 0), 0); $('[data-ftotal]', box).textContent = t ? `Total openings: ${t}` : ''; const rm = $$('[data-frm]', box); rm.forEach((b) => (b.disabled = rm.length === 1)); };
    box.oninput = sum;
    box.onclick = (e) => {
      if (e.target.closest('[data-frm]')) { e.target.closest('[data-frole]').remove(); sum(); }
      if (e.target.closest('[data-fadd]')) { const all = readRoles(box); const last = all[all.length - 1] || {}; $('[data-frows]', box).insertAdjacentHTML('beforeend', roleRow({ location: last.location, department: last.department })); const n = $$('[data-frole]', box).pop(); $('[data-r=role]', n).focus(); sum(); }
    };
    sum();
  };
  F.client = (c) => {
    const a = c.activation || {};
    return `      <div class="row" style="margin-bottom:14px"><button class="btn sm primary" data-fcall>Call notes</button><button class="btn sm" data-fmail="contract">Send agreement</button>${a.contract ? '' : '<button class="btn sm" data-fsigned>Upload signed agreement</button>'}<button class="btn sm" data-fmail="kyc">Ask for KYC</button><button class="btn sm" data-fmail="general">Email</button><button class="btn sm" data-fthanks>Thank-you message</button><button class="btn sm" data-fagree>Agreement</button><button class="btn sm" data-flook>Find online</button><button class="btn sm" data-fgroup>WhatsApp group</button></div>`;
  };
  F.clientMore = (c) => {
    const g = c.wa_group || {}; const o = (c.extra || {}).online;
    return `${(c.calls || []).length ? `<div class="sec"><h3>Client calls</h3><div class="stack-sm">${c.calls.map((x) => `<div class="card pad small"><div class="row between"><span class="faint">${fmtDT(x.at)} · ${esc(x.by)}</span>${x.call_roles ? (x.call_roles.filter((l) => !l.job_id).length ? `<button class="btn sm" data-fjobs="${x.id}">Open ${x.call_roles.filter((l) => !l.job_id).length > 1 ? 'all as draft jobs' : 'as a draft job'}</button>` : '') : `<button class="btn sm" data-fjob="${x.id}">Open a job from this</button>`}</div>${x.call_roles ? callRoleRows(x) : ''}<dl class="kv" style="margin-top:6px">${[...(x.call_roles ? [] : [['Openings', x.openings], ['Location', x.location], ['Department', x.department], ['Roles', x.roles]]), ['Skills', x.skills], ['Responsibilities', x.duties], ['Notes', x.notes]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`).join('')}</div></div>` : ''}
      ${o ? `<div class="sec"><h3>Found online <span class="faint small">· ${fmtD(o.at)}, please check</span></h3><div class="card pad small"><div>${esc(o.about)}</div><dl class="kv" style="margin-top:6px">${[['Website', o.website], ['Instagram', o.instagram], ['Facebook', o.facebook], ['LinkedIn', o.linkedin], ['Phone', o.phone], ['Email', o.email], ['Address', o.address], ['Branches', o.branches], ['Started', o.est_year], ['Owners', o.owners], ['Kind', o.kind]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><div class="row" style="margin-top:6px"><button class="btn sm" data-fuse>Use these details</button></div></div></div>` : ''}
      ${g.name ? `<div class="sec"><h3>WhatsApp group</h3><div class="small"><b>${esc(g.name)}</b> ${g.created ? '<span class="badge b-green">Created</span>' : '<span class="badge b-outline">To create</span>'}${g.link ? ` · <a href="${esc(g.link)}" target="_blank" rel="noopener">invite link</a>` : ''}</div></div>` : ''}
      ${(c.mails || []).length ? `<div class="sec"><h3>Emails</h3>${c.mails.map((m) => `<div class="small">${fmtDT(m.at)} · ${esc(m.subject)} <span class="badge b-outline">${esc(m.status)}</span></div>`).join('')}</div>` : ''}`;
  };
  const agreementView = async () => {
    const a = await BB.api('/api/agreement');
    BB.ask({ title: 'Recruitment Agreement', wide: true, fields: [`<div class="flow-doc">${esc(a.text || 'Open the file to read it.')}</div>`], ok: 'Download', submit: async () => BB.download('/api/agreement/file') });
  };
  F.composeMail = async (ids, kind, label) => {
    const t = await BB.api(`/api/email-templates?ids=${ids.join(',')}`); const tp = t.templates[kind] || t.templates.general;
    const contract = kind === 'contract'; const held = t.held && !contract; const one = t.recipients.length === 1 ? t.recipients[0] : null; const none = t.recipients.filter((x) => !x.email);
    const who = `<div class="small muted">${t.from ? `From: <b>${esc(t.from)}</b>` : ''}${one ? '' : `<div>To: each client's saved email (${t.recipients.length - none.length} of ${t.recipients.length})${none.length ? `. No email for ${none.slice(0, 3).map((x) => esc(x.company)).join(', ')}${none.length > 3 ? ` and ${none.length - 3} more` : ''}` : ''}</div>`}</div>`;
    const v = await BB.ask({ title: label, wide: true, fields: [who, ...(one ? [{ name: 'to', label: 'To', type: 'email', value: one.email }] : []), { name: 'subject', label: 'Subject', value: tp.subject }, { name: 'body', label: 'Message', type: 'textarea', value: tp.body, voice: false }, contract ? '<div class="small muted">Attached: Recruitment Agreement</div>' : { name: 'attach_agreement', label: 'Attach the Recruitment Agreement', type: 'check' }], ok: held ? 'Save for later' : 'Send', submit: (x) => BB.post('/api/clients/email', { ids, kind, ...x }) });
    if (v) done(`${v.done} of ${ids.length} ${v.held ? 'saved' : 'sent'}${v.skipped.length ? ` · ${v.skipped[0]}` : ''}`);
  };
  F.clientMount = (el, c) => {
    const on = (s, fn) => { const b = $(s, el); if (b) b.onclick = fn; };
    on('[data-fcall]', async () => {
      const { script } = await BB.api('/api/call-script');
      setTimeout(() => { const box = $('.modal [data-froles]'); if (box) wireRoles(box); }, 0);
      const v = await BB.ask({ title: 'Client call', wide: true, fields: [`<div class="notice small flow-script">${esc(script)}</div>`,
        `<div class="field" data-froles data-f="call_roles"><div data-frows>${roleRow({ location: c.city || '' })}</div><datalist id="flow-roles">${BB.boot.jobs.map((j) => `<option value="${esc(j.title)}"></option>`).join('')}</datalist><div class="row between" style="margin-top:8px"><button type="button" class="btn sm" data-fadd>Add another role</button><span class="small muted" data-ftotal></span></div></div>`,
        { name: 'skills', label: 'Skills required', opt: true }, { name: 'duties', label: 'Roles and responsibilities expected', type: 'textarea', opt: true }, { name: 'notes', label: 'Other notes', type: 'textarea', opt: true }], ok: 'Save call notes', submit: (x) => BB.post(`/api/clients/${c.id}/calls`, { ...x, call_roles: readRoles($('.modal [data-froles]')) }) });
      if (v) done('Call notes saved');
    });
    $$('[data-fmail]', el).forEach((b) => (b.onclick = () => F.composeMail([c.id], b.dataset.fmail, b.textContent)));
    on('[data-fthanks]', () => act(() => BB.post(`/api/clients/${c.id}/thanks`), (r) => (r.held ? 'Saved: messages are off for now' : 'Sent')));
    on('[data-fagree]', agreementView);
    on('[data-fsigned]', async () => { const f = await BB.pickFile(); if (f) act(() => BB.post('/api/files', { record_id: c.id, type: 'contract_signed', ...f }), 'Signed agreement saved'); });
    on('[data-flook]', async () => {
      const v = await BB.ask({ title: 'Find this business online', note: 'Optional. Searches the web and fills what it finds for you to check. Each search costs a few rupees.', fields: [{ name: 'name', label: 'Business name', value: c.company }, { name: 'city', label: 'City', value: c.city || '', opt: true }, { name: 'address', label: 'Address', opt: true }], ok: 'Search', submit: (x) => BB.post(`/api/clients/${c.id}/lookup`, x) });
      if (v) done('Details found: check them below');
    });
    on('[data-fuse]', () => { const o = c.extra.online; const ex = { ...c.extra }; for (const [k, s] of [['website', o.website], ['branches', o.branches], ['est_year', o.est_year], ['owner_name', o.owners]]) if (s && !ex[k]) ex[k] = s; act(() => BB.patch(`/api/clients/${c.id}`, { extra: ex }), 'Saved on the client'); });
    on('[data-fgroup]', () => groupDialog(c));
    $$('[data-fopen]', el).forEach((b) => (b.onclick = () => BB.open('job', b.dataset.fopen)));
    $$('[data-fjobs]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/clients/${c.id}/calls/${b.dataset.fjobs}/jobs`), (r) => `${r.jobs.length} draft ${r.jobs.length === 1 ? 'job' : 'jobs'} opened: add the salary on each`)));
    $$('[data-fline]', el).forEach((b) => (b.onclick = () => { const [id, i] = b.dataset.fline.split(':'); const x = c.calls.find((k) => String(k.id) === id); const l = x.call_roles[i]; BB.newJob(c.id, { title: l.role, city: l.location, openings: l.openings, skills: String(x.skills || '').split(',').map((s) => s.trim()).filter(Boolean), duties: x.duties, notes: [l.department && `Department: ${l.department}`, x.notes].filter(Boolean).join(' · '), call_id: x.id, call_line: Number(i) }); }));
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
  F.jobMount = (el, j) => { loadScreen(el, j); const c = $('[data-fcreative]', el); if (c) c.onclick = () => F.creative(j.id); };
  F.creative = async (id) => {
    const c = await BB.api(`/api/creatives/${id}`);
    const v = await BB.ask({ title: `Creative: ${c.title}`, wide: true, fields: [{ name: 'status', label: 'Step', type: 'select', options: c.steps.filter((s) => s !== 'Approved' || !me().channel_only), value: c.status || 'Brief shared', placeholder: false }, { name: 'brief', label: 'Creative requirement', type: 'textarea', value: c.brief, voice: false }, { name: 'link', label: 'Link to the creative', value: c.link || '', opt: true, voice: false }, { name: 'note', label: 'Note', opt: true, value: c.note || '' }], ok: 'Save' });
    if (v) act(() => BB.post('/api/creatives', { ids: [id], ...v }), 'Saved');
  };

  // ---------- application: what next, and the offer stages ----------
  F.appNext = (a) => (a.next ? `<div class="flow-next"><b>Next:</b> ${esc(a.next)}</div>` : '');
  F.appOffer = (a) => {
    if (!['Sent to client', 'Client interview', 'Offer made', 'Offer accepted', 'Joined'].includes(a.step) || (a.result !== 'open' && a.result !== 'Hired')) return '';
    const st = [['verbal', 'Client made a verbal offer', a.verbal_at], ['verbal_ok', 'Candidate accepted verbally', a.verbal_ok_at], ['letter', 'Client shared the offer letter', a.letter_at]];
    const asked = a.bill && a.bill.accounts_asked_at;
    return `<div class="sec card pad"><h3 style="margin-bottom:6px">Offer steps</h3>${st.map(([k, l, at]) => `<label class="row small"><input type="checkbox" data-ostage="${k}" ${at ? 'checked' : ''} ${a.result === 'open' ? '' : 'disabled'}> ${l}${at ? ` <span class="faint">${fmtDT(at)}</span>` : ''}</label>`).join('')}
      ${canAdmin() && a.offer_ctc ? `<div class="row" style="margin-top:8px">${asked ? `<span class="small muted">Accounts asked ${fmtDT(asked)}</span>` : ''}<button class="btn sm ${asked ? '' : 'primary'}" data-faccounts>${asked ? 'Ask again' : 'Ask Accounts for the invoice'}</button>${a.bill ? `<a href="#" class="small" data-open="bill:${a.bill.id}">Open bill</a>` : ''}</div>` : ''}</div>`;
  };
  F.appCv = (a) => `<button class="btn sm" data-fcv>CV for client</button>`;
  F.appMount = (el, a) => {
    $$('[data-ostage]', el).forEach((c) => (c.onchange = () => act(() => BB.post(`/api/applications/${a.id}/offer-stage`, { stage: c.dataset.ostage, on: c.checked }), 'Saved')));
    const ac = $('[data-faccounts]', el); if (ac) ac.onclick = () => act(() => BB.post(`/api/applications/${a.id}/ask-invoice`), (r) => (r.email === 'no address' ? 'Draft bill made. Add the Accounts email in Settings → Fees & limits' : r.email === 'held' ? 'Draft bill made. The email is saved: messages are off' : 'Accounts asked'));
    const cv = $('[data-fcv]', el); if (cv) cv.onclick = async () => { try { const f = await BB.post(`/api/applications/${a.id}/client-cv`); BB.openFile(f.id); BB.toast('CV made without phone and email'); } catch (e) { BB.fail(e); } };
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
    const a = $('[data-fnotes]', actions); if (a) a.onclick = F.fromNotes;
    const b = $('[data-fmass]', actions); if (b) b.onclick = F.mass;
  };
  F.fromNotes = async () => {
    const v = await BB.ask({ title: 'Paste your notes', note: 'Paste what the client said. It fills the job form for you to check.', wide: true, fields: [{ name: 'text', label: 'Notes', type: 'textarea', voice: false }], ok: 'Read notes', submit: (x) => BB.post('/api/jobs/from-notes', x) });
    if (!v) return; const j = v.job; BB.newJob('', { ...j, jewel_need: j.jewellery, sal_from: j.sal_from, sal_to: j.sal_to });
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
    const n = () => { const k = BB.selected(el).length; $('[data-ccount]', bar).textContent = k ? `${k} selected` : 'Tick clients to email them'; bar.classList.toggle('has-sel', k > 0); };
    BB.wireSelect(el, n); $$('[data-sel]', el).forEach((x) => x.addEventListener('change', n));
    $$('[data-cm]', bar).forEach((b) => (b.onclick = () => { const ids = BB.selected(el); if (!ids.length) return BB.toast('Tick some clients first', true); F.composeMail(ids, b.dataset.cm, b.textContent); }));
  };

  // ---------- hiring channels: creatives and many jobs at once ----------
  F.trackerTop = (d, chs) => `<div class="row small bulkbar" data-tbar><span class="muted" data-tcount>Tick jobs to update them together:</span><select class="mini" data-tcr><option value="">Creative step…</option>${d.creative_steps.filter((s) => s !== 'Approved' || !me().channel_only).map((s) => `<option>${s}</option>`).join('')}</select><select class="mini" data-tch><option value="">Channel…</option>${chs.map((c) => `<option value="${c.key}">${esc(c.channel)}</option>`).join('')}</select><select class="mini" data-tst><option value="">Mark as…</option>${['Pending', 'Done', 'Not needed'].map((s) => `<option>${s}</option>`).join('')}</select></div>`;
  F.trackerMount = (el, d) => {
    const ids = () => $$('[data-tj]:checked', el).map((x) => x.dataset.tj); const bar = $('[data-tbar]', el); if (!bar) return;
    $$('[data-tj]', el).forEach((x) => (x.onchange = () => { const n = ids().length; $('[data-tcount]', bar).textContent = n ? `${n} selected:` : 'Tick jobs to update them together:'; bar.classList.toggle('has-sel', n > 0); }));
    $$('[data-tcreative]', el).forEach((b) => (b.onclick = () => F.creative(b.dataset.tcreative)));
    const need = () => { const v = ids(); if (!v.length) BB.toast('Tick some jobs first', true); return v; };
    const cr = $('[data-tcr]', bar); cr.onchange = () => { const v = need(); const s = cr.value; cr.value = ''; if (v.length && s) act(() => BB.post('/api/creatives', { ids: v, status: s }), (r) => `${r.done} updated`); };
    const st = $('[data-tst]', bar); st.onchange = () => { const v = need(); const ch = $('[data-tch]', bar).value; const s = st.value; st.value = ''; if (!ch) return BB.toast('Pick the channel first', true); if (v.length && s) act(() => BB.post('/api/postings/tracker/bulk', { job_ids: v, ckey: ch, status: s }), (r) => `${r.done} updated`); };
  };

  // ---------- Recruitment Agreement page ----------
  P.agreement = async ({ el, actions }) => {
    const a = await BB.api('/api/agreement');
    actions.innerHTML = `<button class="btn" data-adl>Download</button>${me().level === 'super' ? '<button class="btn primary" data-aup>Replace the agreement</button>' : ''}`;
    el.innerHTML = `<div class="card pad flow-doc">${esc(a.text || 'Download the file to read it.')}</div>`;
    $('[data-adl]', actions).onclick = () => BB.download('/api/agreement/file');
    const up = $('[data-aup]', actions); if (up) up.onclick = async () => { const f = await BB.pickFile('.docx,.pdf'); if (f) act(() => BB.post('/api/agreement', f), 'Agreement replaced'); };
  };

  // ---------- Books: revenue, expenses, performance ----------
  P.books = async ({ el, actions, q }) => {
    const d = await BB.api(`/api/books?${BB.qs({ agency: q.agency })}`); const m = d.months[0] || { billed: 0, received: 0, other: 0, expenses: 0, net: 0 };
    actions.innerHTML = '<button class="btn" data-brev>+ Log revenue</button><button class="btn primary" data-bexp>+ Add expense</button>';
    const tile = (l, v) => `<div class="card pad"><div class="small muted">${l}</div><div class="kpi">${inr(v)}</div></div>`;
    el.innerHTML = `${d.agencies.length ? `<div class="filters"><select data-bag><option value="">All agencies and BrillBrains</option>${d.agencies.map((a) => `<option value="${a.id}" ${q.agency === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}
      <div class="small muted" style="margin-bottom:8px">${esc(m.month || 'This month')}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px">${tile('Billed (fees)', m.billed)}${tile('Other revenue', m.other)}${tile('Received', m.received)}${tile('Expenses', m.expenses)}${tile('Net', m.net)}${tile('Yet to collect', d.dues)}</div>
      <div class="card" style="margin-bottom:14px"><div class="card-h"><h3>Month by month</h3></div>${BB.table([{ t: 'Month', f: (r) => esc(r.month) }, { t: 'Billed', num: 1, f: (r) => inr(r.billed) }, { t: 'Other revenue', num: 1, f: (r) => inr(r.other) }, { t: 'Received', num: 1, f: (r) => inr(r.received) }, { t: 'Expenses', num: 1, f: (r) => inr(r.expenses) }, { t: 'Net', num: 1, f: (r) => `<b>${inr(r.net)}</b>` }], d.months)}</div>
      <div class="card" style="margin-bottom:14px"><div class="card-h"><h3>Team performance</h3></div>${BB.table([{ t: 'Person', f: (r) => esc(r.name) }, { t: 'Applications', num: 1, f: (r) => r.applications }, { t: 'Sent to client', num: 1, f: (r) => r.sent }, { t: 'Hires', num: 1, f: (r) => r.hires }, { t: 'Fees billed', num: 1, f: (r) => inr(r.fee) }], d.people)}</div>
      <div class="grid g2" style="align-items:start"><div class="card"><div class="card-h"><h3>Expenses</h3></div>${BB.table([{ t: 'Date', f: (r) => fmtD(r.date) }, { t: 'For', f: (r) => `${esc(r.category)}<div class="tiny muted">${esc(r.note)}</div>` }, { t: 'Amount', num: 1, f: (r) => inr(r.amount) }, { t: '', f: (r) => `<button class="btn sm ghost" data-delx="${r.id}">Remove</button>` }], d.expenses)}</div>
        <div class="card"><div class="card-h"><h3>Revenue logged</h3></div>${BB.table([{ t: 'Date', f: (r) => fmtD(r.date) }, { t: 'What', f: (r) => `${esc(r.kind)}<div class="tiny muted">${esc(r.note)}</div>` }, { t: 'Amount', num: 1, f: (r) => inr(r.amount) }, { t: '', f: (r) => `<button class="btn sm ghost" data-delr="${r.id}">Remove</button>` }], d.revenue)}</div></div>`;
    const ag = $('[data-bag]', el); if (ag) ag.onchange = () => BB.setQ({ agency: ag.value });
    const add = (title, url, extra, ok) => BB.ask({ title, fields: [`<div class="grid g2">${field({ name: 'date', label: 'Date', type: 'date', value: BB.istDay() })}${field({ name: 'amount', label: 'Amount (₹)', type: 'number' })}</div>`, extra, { name: 'note', label: 'Note', opt: true }], ok: 'Save', submit: (v) => BB.post(url, { ...v, agency_id: q.agency || undefined }) }).then((x) => x && done(ok));
    $('[data-bexp]', actions).onclick = () => add('Add expense', '/api/expenses', { name: 'category', label: 'Category', type: 'select', options: d.categories, placeholder: false }, 'Expense added');
    $('[data-brev]', actions).onclick = () => add('Log revenue', '/api/revenue', { name: 'kind', label: 'Kind', type: 'select', options: d.kinds, placeholder: false }, 'Revenue logged');
    $$('[data-delx]', el).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Remove this expense', 'It comes off the totals.', 'Remove')) act(() => BB.post(`/api/expenses/${b.dataset.delx}/delete`), 'Removed'); }));
    $$('[data-delr]', el).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Remove this entry', 'It comes off the totals.', 'Remove')) act(() => BB.post(`/api/revenue/${b.dataset.delr}/delete`), 'Removed'); }));
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
