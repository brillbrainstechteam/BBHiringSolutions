/* Team side panels (6.5): client, job, application, candidate, person, bill — plus the pop-ups they open. */
(() => {
  const { $, $$, esc, inr, fmtD, fmtDT, fmtT, field, statusBadge, scoreBadge, resultBadge, ticks, waIcon } = BB;
  const me = () => BB.me.user;
  const isSuper = () => me().level === 'super';
  const after = (msg) => { if (msg) BB.toast(msg); BB.refreshPanel(); BB.refreshPage && BB.refreshPage(); };
  // Delete a record (and what hangs off it) into Deleted items, after showing what goes with it.
  const NAMES = { applications: 'application', jobs: 'job opening', candidates: 'candidate', clients: 'client', app_history: 'history line', interviews: 'interview', notes: 'note', files: 'file', messages: 'WhatsApp message', calls: 'call', postings: 'posting', job_history: 'status line' };
  const plural = (k, n) => `${n} ${NAMES[k] || k.replace(/_/g, ' ')}${n === 1 ? '' : 's'}`;
  BB.deleteRecords = async (kind, ids, after) => {
    ids = [].concat(ids); let d;
    try { d = await BB.post('/api/delete', { kind, ids, dry: true }); } catch (e) { return BB.fail(e); }
    const counts = d.counts || {}; const main = ['clients', 'jobs', 'candidates', 'applications'].filter((k) => counts[k]).map((k) => plural(k, counts[k])).join(', ');
    const errs = (d.errors || []).length ? `<div class="notice small" style="margin-top:8px">Cannot delete: ${d.errors.map(esc).join('<br>')}</div>` : '';
    if ((d.done ?? 1) === 0) return BB.toast((d.errors || [])[0] || 'Nothing to delete', true);
    const ok = await BB.confirm('Delete', `This deletes ${main || 'the record'}${d.label ? ` (${esc(d.label)})` : ''} with their history, notes and files. The super admin can restore it from Settings → Deleted items.${errs}`, 'Delete');
    if (!ok) return;
    try { const r = await BB.post('/api/delete', { kind, ids }); BB.toast(r.done !== undefined ? `${r.done} deleted${r.errors.length ? `, ${r.errors.length} kept` : ''}` : 'Deleted'); BB.closePanels(); BB.refreshPage && BB.refreshPage(); after && after(); } catch (e) { BB.fail(e); }
  };
  const canDelete = () => ['super', 'admin'].includes(me().level);
  const run = async (fn, msg) => { try { const r = await fn(); after(msg); return r; } catch (e) { BB.fail(e); } };
  const waBtn = (o, label = 'WhatsApp', cls = 'btn sm wa') => `<button class="${cls}" data-wa='${esc(JSON.stringify(o))}'>${waIcon} ${esc(label)}</button>`;
  BB.waBtn = waBtn;
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-wa]'); if (!b || BB.portal !== 'team') return; e.preventDefault(); e.stopPropagation(); const o = JSON.parse(b.dataset.wa); BB.wa({ ...o, after: () => { BB.refreshPanel(); BB.refreshPage && BB.refreshPage(); } }); });
  const FMT_WORDS = (k) => (k ? String(k).replace(/^bbhs_/, '').replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()) : 'Message');
  const WA_STATUS = { scheduled: ['Scheduled', 'b-amber'], queued: ['Queued', 'b-amber'], 'would send': ['Not sent (test)', 'b-outline'], sent: ['Sent', 'b-primary'], delivered: ['Delivered', 'b-primary'], read: ['Read', 'b-green'], seen: ['Read', 'b-green'], failed: ['Failed', 'b-red'], received: ['Received', 'b-blue'] };
  const waBubble = (m) => { const st = WA_STATUS[m.status] || [m.status || '', 'b-outline']; const inn = m.direction === 'in';
    return `<div class="wa-msg ${inn ? 'in' : 'out'}"><div class="wa-meta"><b>${inn ? 'From them' : esc(FMT_WORDS(m.format))}</b>${st[0] ? `<span class="badge tiny ${st[1]}">${esc(st[0])}</span>` : ''}<span class="faint">${fmtDT(m.at)}${!inn && m.sent_by ? ` · ${esc(m.sent_by)}` : ''}</span></div><div class="wa-text" data-clamp title="Click to read it all">${esc(m.text)}</div></div>`; };
  const msgList_old = (ms) => (ms.length ? `<div class="stack-sm">${ms.map((m) => `<div class="row small nowrap" style="align-items:flex-start"><span class="badge ${m.direction === 'in' ? 'b-blue' : 'b-outline'} tiny">${m.direction === 'in' ? 'in' : 'out'}</span><div class="grow"><span class="mono tiny">${esc(m.format || 'text')}</span> ${ticks(m.status)} <span class="faint tiny">${fmtDT(m.at)} · ${esc(m.sent_by)}</span><div class="ellipsis muted">${esc(m.text)}</div></div></div>`).join('')}</div>` : '<div class="faint small">No messages yet.</div>');
  const msgList = (ms) => (ms.length ? `<div class="wa-list">${ms.map(waBubble).join('')}</div>` : '<div class="faint small">No messages yet.</div>');
  const notesBlock = (rid, notes) => `<div class="sec"><h3>Notes <button class="btn sm" data-note="${rid}">+ Note</button><button class="btn sm" data-remind="${rid}">Remind me</button><button class="btn sm ghost" data-hist="${rid}">History</button></h3>${notes.map((n) => `<div class="small" style="padding:4px 0;border-bottom:1px dashed var(--border)"><span class="faint">${fmtDT(n.at)} · ${esc(n.author)}</span><div>${esc(n.text)}</div></div>`).join('') || '<div class="faint small">No notes.</div>'}</div>`;
  // Calls to the candidate (telephonic round and follow-ups): who, when, what happened.
  const SOCIAL = [['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['portfolio', 'Portfolio'], ['youtube', 'YouTube']];
  const socialBlock = (c) => { const sl = SOCIAL.filter(([k]) => (c.social || {})[k]); return sl.length ? `<div class="sec"><h3>Social profiles</h3><div class="row">${sl.map(([k, l]) => `<a class="btn sm" href="${esc(c.social[k])}" target="_blank" rel="noopener">${l} ↗</a>`).join('')}</div></div>` : ''; };
  const CALL_BADGE = { Connected: 'b-green', 'Not interested': 'b-red', 'Wrong number': 'b-red', 'No answer': 'b-amber', Busy: 'b-amber', 'Switched off': 'b-amber', 'Call back later': 'b-primary' };
  const callCard = (k) => `<div class="call-card"><div class="call-when"><b>${fmtD(k.at)}</b><span>${fmtT(k.at)}</span></div><div class="grow"><div class="row small"><span class="badge ${CALL_BADGE[k.outcome] || 'b-outline'}">${esc(k.outcome)}</span>${k.minutes ? `<span>${k.minutes} min</span>` : ''}<span class="faint">by ${esc(k.by)}${k.app_id ? ` · <span class="mono">${esc(k.app_id)}</span>` : ''}</span></div>${k.note ? `<div class="small call-note">${esc(k.note)}</div>` : ''}</div></div>`;
  const callsBlock = (candId, appId, calls) => `<div class="sec"><h3>Calls <button class="btn sm" data-logcall="${candId}" data-app="${appId || ''}">+ Log a call</button></h3>${(calls || []).length ? `<div class="stack-sm">${calls.map(callCard).join('')}</div>` : '<div class="faint small">No calls logged yet.</div>'}</div>`;
  const ivNotes = (notes) => (notes || []).map((n) => `<div class="small iv-note ${n.author_kind === 'client' ? 'by-client' : ''}"><b>${esc(n.author)}</b> <span class="faint">${fmtDT(n.at)}</span><div>${esc(n.text)}</div></div>`).join('');
  const filesBlock = (rid, files, types) => `<div class="sec"><h3>Files ${types ? `<select data-up-type="${rid}" class="small" style="width:auto;padding:3px 30px 3px 10px;background-position:right 9px center">${types.map((t) => `<option value="${t[0]}">${t[1]}</option>`).join('')}</select><button class="btn sm" data-upload="${rid}">Upload</button>` : ''}</h3>${files.map((f) => `<div class="row small"><button class="btn sm" data-file="${f.id}">${esc(f.name)}</button><span class="faint">${esc(f.type)} · v${f.version} · ${fmtD(f.at)} · ${esc(f.uploaded_by)}</span></div>`).join('') || '<div class="faint small">No files.</div>'}</div>`;
  function wireCommon(el) {
    // Spam or test sign-ups: hidden from every list, never deleted.
    $$('[data-junkit]', el).forEach((b) => (b.onclick = async () => {
      const [type, rid] = b.dataset.junkit.split(':');
      if (!(await BB.confirm('Mark as junk', `${rid} will be hidden from all lists (not deleted).`, 'Mark as junk'))) return;
      try { await BB.post('/api/leads/junk', { type, id: rid }); BB.toast('Marked as junk'); BB.closePanels(); BB.refreshPage && BB.refreshPage(); } catch (e) { BB.fail(e); }
    }));
    $$('[data-note]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Add a note', fields: [{ name: 'text', label: 'Note (call notes, meeting notes…)', type: 'textarea' }], ok: 'Save note', submit: (v) => BB.post('/api/notes', { record_id: b.dataset.note, text: v.text }) }).then((x) => x && after('Note saved'))));
    $$('[data-remind]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Remind me', fields: [{ name: 'at', label: 'Date and time', type: 'datetime-local' }, { name: 'note', label: 'What to do', type: 'textarea' }], ok: 'Set reminder', submit: (v) => BB.post('/api/followups', { record_id: b.dataset.remind, at: BB.fromLocalInput(v.at), note: v.note }) }).then((x) => x && after('Reminder set — it shows in My day and the bell'))));
    $$('[data-hist]', el).forEach((b) => (b.onclick = async () => { const h = await BB.api(`/api/history/${b.dataset.hist}`); BB.modal({ title: `History · ${esc(b.dataset.hist)}`, wide: true, foot: false, body: `<div class="hist">${h.map((x) => `<div class="h"><span class="t">${fmtDT(x.at)}</span><span class="grow"><b>${esc(x.who)}</b> ${esc(x.action)}${x.field ? ` <span class="mono">${esc(x.field)}</span>` : ''}${x.old !== null || x.new !== null ? `: <span class="faint">${esc(x.old ?? '—')}</span> → ${esc(x.new ?? '—')}` : ''}</span></div>`).join('') || '<div class="faint">Nothing yet.</div>'}</div>` }); }));
    $$('[data-file]', el).forEach((b) => (b.onclick = () => BB.openFile(b.dataset.file)));
    $$('[data-clamp]', el).forEach((t) => (t.onclick = () => t.classList.toggle('open')));
    $$('[data-delrec]', el).forEach((b) => (b.onclick = () => BB.deleteRecords(b.dataset.delrec, b.dataset.id)));
    $$('[data-logcall]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Log a call', fields: [
      { name: 'outcome', label: 'What happened?', type: 'choice', options: BB.callOutcomes || ['Connected', 'No answer', 'Busy', 'Call back later', 'Switched off', 'Wrong number', 'Not interested'] },
      `<div class="grid g2">${BB.field({ name: 'at', label: 'When was the call', type: 'datetime-local', value: BB.toLocalInput(new Date()) })}${BB.field({ name: 'minutes', label: 'Minutes on the call', type: 'number', opt: true, voice: false })}</div>`, { name: 'note', label: 'Call notes', type: 'textarea', opt: true }], ok: 'Save call',
      submit: (v) => { if (!v.outcome) { const e = new Error('Pick what happened'); e.field = 'outcome'; throw e; } return BB.post('/api/calls', { candidate_id: b.dataset.logcall, app_id: b.dataset.app || null, ...v, at: v.at ? BB.fromLocalInput(v.at) : undefined }); } }).then((x) => x && after('Call logged'))));
    $$('[data-ivnote]', el).forEach((b) => (b.onclick = () => BB.ask({ title: `Note on ${b.dataset.ivnote}`, note: 'Our team and the client see interview notes. The candidate does not.', fields: [{ name: 'text', label: 'Note', type: 'textarea' }], ok: 'Save note', submit: (v) => BB.post(`/api/interviews/${b.dataset.ivnote}/notes`, v) }).then((x) => x && after('Note saved'))));
    $$('[data-upload]', el).forEach((b) => (b.onclick = async () => { const f = await BB.pickFile(); if (!f) return; const t = $(`[data-up-type="${b.dataset.upload}"]`, el); run(() => BB.post('/api/files', { record_id: b.dataset.upload, type: t ? t.value : 'file', ...f }).then((r) => { if (r && r.filled && r.filled.length) setTimeout(() => BB.toast(`Filled from the CV: ${r.filled.join(', ')}`), 700); return r; }), 'Uploaded'); }));
  }

  // ---------- Client ----------
  BB.panels.client = async (id) => {
    const c = await BB.api(`/api/clients/${id}`); const s = BB.boot;
    const ex = c.extra || {};
    return {
      head: `<div class="row"><h2>${esc(c.company || c.contact)}</h2><span class="mono faint">${esc(c.id)}</span>${c.is_new ? '<span class="badge b-gold">new</span>' : ''}${c.opted_out ? '<span class="badge b-red">Opted out</span>' : ''}${c.dnc ? '<span class="badge b-red">Do not contact</span>' : ''}${c.possible_repeat_of ? `<span class="badge b-amber">Possible repeat of ${esc(c.possible_repeat_of)}</span>` : ''}</div><div class="small muted">${esc(c.contact)} · ${esc(c.city)} · ${esc(c.business_type || '')} · source ${esc(c.source || '—')}</div>`,
      body: `<div class="row" style="margin-bottom:14px">${waBtn({ ptype: 'client', pid: c.id })}<button class="btn sm" data-go-chat>Open chat</button>${waBtn({ ptype: 'client', pid: c.id, format: 'bbhs_client_welcome' }, 'Send account link', 'btn sm')}<button class="btn sm primary" data-newjob>+ New job opening</button>${canDelete() ? `<button class="btn sm danger" data-delrec="client" data-id="${c.id}">Delete</button>` : ''}<button class="btn sm" data-edit>Edit</button><button class="btn sm" data-summary>Monthly summary</button>${c.junk ? '' : `<button class="btn sm ghost" data-junkit="client:${c.id}">Mark as junk</button>`}${c.possible_repeat_of ? `<button class="btn sm" data-merge>Merge…</button>` : ''}</div>
        <div class="grid g2" style="margin-bottom:14px">
          <label class="field"><span class="lab">Stage</span><select data-stage>${s.stages.map((x) => `<option ${x === c.stage ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          ${isSuper() ? `<label class="field"><span class="lab">Agency</span><select data-agency><option value="">— not assigned —</option>${c.agencies.map((a) => `<option value="${a.id}" ${a.id === c.agency_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : `<div><div class="small muted">Agency</div><b>${esc(c.agency_name || '—')}</b></div>`}
        </div>
        <div class="sec card pad"><dl class="kv"><dt>WhatsApp</dt><dd class="mono">${esc(c.whatsapp)}</dd><dt>Email</dt><dd>${esc(c.email || '—')}</dd><dt>Owner</dt><dd>${esc(c.owner_name || '—')}</dd><dt>Need</dt><dd>${esc(c.need || '—')} · ${esc(c.roles || '')}</dd><dt>Account</dt><dd>${esc(c.account_status)}</dd><dt>Fee</dt><dd>${c.fee_type ? (c.fee_type === 'fixed' ? `${inr(c.fee_value)} per hire` : `${c.fee_value}% of yearly CTC`) : `${s.fee.type === 'fixed' ? inr(s.fee.value) + ' per hire' : s.fee.value + '% of yearly CTC'} <span class="faint">(standard)</span>`}</dd><dt>Free replacement</dt><dd>within ${c.replacement_days || s.replacement_days} days of joining${c.replacement_days ? '' : ' <span class="faint">(standard)</span>'}</dd><dt>Payment due</dt><dd>${c.payment_days || s.payment_days} days after the bill${c.payment_days ? '' : ' <span class="faint">(standard)</span>'}</dd>
          ${['owner_name', 'owner_mobile', 'hr_name', 'hr_email', 'hr_mobile', 'est_year', 'team_size', 'branches', 'website', 'activation_date'].filter((k) => ex[k]).map((k) => `<dt>${k.replace(/_/g, ' ')}</dt><dd>${esc(k === 'activation_date' ? fmtD(ex[k]) : ex[k])}</dd>`).join('')}</dl></div>
        <div class="sec"><h3>Onboarding</h3><div class="card checklist" style="padding:6px 14px">${c.onboarding_items.map((it) => `<div class="it"><input type="checkbox" data-ob="${it.key}" ${it.done ? 'checked' : ''}><span class="grow">${esc(it.label)}${it.stage ? ` <span class="faint tiny">→ ${esc(it.stage)}</span>` : ''}${it.note ? `<div class="faint small">${esc(it.note)}</div>` : ''}</span><span class="faint small">${it.done && it.date ? `${fmtD(it.date)} · ${esc(it.by || '')}` : ''}</span></div>`).join('')}</div></div>
        <div class="sec"><h3>Job openings (${c.jobs.length})</h3>${c.jobs.map((j) => `<div class="row" style="padding:5px 0"><a href="#" data-open="job:${j.id}">${esc(j.id)} ${esc(j.title)}</a>${statusBadge(j.status)}<span class="faint small">${j.filled}/${j.openings} filled · ${j.apps_total} applications</span></div>`).join('') || '<div class="faint small">None yet.</div>'}</div>
        <div class="sec"><h3>Company logins</h3>${c.members.map((m) => `<div class="small">${esc(m.name)} (${esc(m.role)}) <span class="mono">${esc(m.whatsapp)}</span></div>`).join('') || '<div class="faint small">Only the main contact.</div>'}<button class="btn sm" data-member style="margin-top:6px">+ Add person</button></div>
        <div class="sec"><h3>WhatsApp history</h3>${msgList(c.messages)}</div>
        ${filesBlock(c.id, c.files, [['gst', 'GST certificate'], ['pan', 'Business PAN'], ['owner_id', 'Owner ID'], ['proposal', 'Proposal'], ['contract_signed', 'Signed contract'], ['file', 'Other']])}
        ${(c.iv_notes || []).length && false ? `<div class="sec"><h3>Interview notes</h3>${c.iv_notes.map((n) => `<div class="small iv-note ${n.author_kind === 'client' ? 'by-client' : ''}"><b>${esc(n.iv_name)}</b> <span class="mono faint">${esc(n.iv_id)}</span> · <b>${esc(n.author)}</b> <span class="faint">${fmtDT(n.at)}</span><div>${esc(n.text)}</div></div>`).join('')}</div>` : ''}
        ${notesBlock(c.id, c.notes)}
        <div class="sec"><h3>Consent</h3>${c.consents.map((x) => `<div class="small">${fmtDT(x.at)} · ${esc(x.what)} · <span class="faint">${esc(x.source)}</span></div>`).join('') || '<div class="faint small">No consent saved.</div>'}</div>`,
      mount: (el) => {
        wireCommon(el);
        $('[data-stage]', el).onchange = (e) => run(() => BB.patch(`/api/clients/${c.id}`, { stage: e.target.value }), 'Stage saved');
        const ag = $('[data-agency]', el); if (ag) ag.onchange = (e) => run(() => (c.agency_id ? BB.patch(`/api/clients/${c.id}`, { agency_id: e.target.value || null }) : BB.post('/api/leads/assign', { type: 'client', id: c.id, agency_id: e.target.value })), 'Agency saved');
        $$('[data-ob]', el).forEach((cb) => (cb.onchange = () => { const done = cb.checked; if (done && ['intro_call', 'background', 'meeting'].includes(cb.dataset.ob)) { BB.ask({ title: 'Add a note', fields: [{ name: 'note', label: 'Notes (optional)', type: 'textarea' }], ok: 'Tick', submit: (v) => BB.post(`/api/clients/${c.id}/onboarding`, { item: cb.dataset.ob, done, note: v.note }) }).then((x) => (x ? after('Ticked') : (cb.checked = false))); } else run(() => BB.post(`/api/clients/${c.id}/onboarding`, { item: cb.dataset.ob, done }), done ? 'Ticked' : 'Unticked'); }));
        $('[data-go-chat]', el).onclick = () => { BB.closePanels(); BB.go(`team/whatsapp?t=client:${c.id}`); };
        const nj = $('[data-newjob]', el); if (nj) nj.onclick = () => BB.newJob(c.id);
        $('[data-member]', el).onclick = () => BB.ask({ title: 'Add a person from the company', fields: [{ name: 'name', label: 'Name' }, { name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true }, { name: 'role', label: 'Role', type: 'select', options: ['HR', 'Store manager', 'Owner', 'Accounts'], value: 'HR' }], ok: 'Add', submit: (v) => BB.post(`/api/clients/${c.id}/members`, v) }).then((x) => x && after('Added'));
        const mg = $('[data-merge]', el); if (mg) mg.onclick = () => BB.mergeScreen('client', c.possible_repeat_of, c.id);
        $('[data-summary]', el).onclick = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); BB.ask({ title: 'Monthly summary', note: 'A PDF of the openings, hires and bills for the month, saved on the client. The client downloads it from Company & papers.', fields: [{ name: 'month', label: 'Month', type: 'month', value: d.toISOString().slice(0, 7) }, { name: 'send', label: 'Tell the client on WhatsApp (bbhs_monthly_summary)', type: 'check' }], ok: 'Make summary', submit: (v) => BB.post(`/api/clients/${c.id}/summary`, v) }).then((x) => { if (x) { after(`Summary for ${x.label} saved`); BB.openFile(x.file_id); } }); };
        $('[data-edit]', el).onclick = () => BB.ask({ title: `Edit ${c.id}`, wide: true, fields: [
          `<div class="grid g2">${field({ name: 'company', label: 'Company', value: c.company })}${field({ name: 'contact', label: 'Contact', value: c.contact })}</div>`,
          `<div class="grid g2">${field({ name: 'whatsapp', label: 'WhatsApp', value: c.whatsapp, phone: true })}${field({ name: 'email', label: 'Email', value: c.email })}</div>`,
          `<div class="grid g3">${field({ name: 'city', label: 'City', value: c.city, list: 'cities' })}${field({ name: 'state', label: 'State', value: c.state })}${field({ name: 'business_type', label: 'Business', type: 'select', options: ['Showroom B2C', 'Manufacturer B2B', 'Both'], value: c.business_type })}</div>`,
          `<div class="grid g3">${field({ name: 'fee_type', label: 'Fee type (this client)', type: 'select', options: [['', 'Standard'], ['percent', '% of CTC'], ['fixed', 'Fixed per hire']], value: c.fee_type || '', placeholder: false })}${field({ name: 'fee_value', label: 'Fee value', type: 'number', value: c.fee_value ?? '' })}${field({ name: 'replacement_days', label: 'Free replacement (days)', type: 'number', value: c.replacement_days ?? '' })}</div>`,
          field({ name: 'industry', label: 'Industry (job list for this client)', type: 'select', options: Object.keys(BB.boot.industries || { Jewellery: 1 }), value: c.industry, placeholder: false }),
          `<div class="grid g3">${field({ name: 'payment_days', label: 'Payment due in (days)', type: 'number', value: c.payment_days ?? '' })}${field({ name: 'language', label: 'Message language', type: 'select', options: [['en', 'English'], ['hi', 'Hindi']], value: c.language, placeholder: false })}${field({ name: 'hide_name_until', label: 'Hide name from candidates until', type: 'select', options: ['Client interview', 'Always show'], value: c.hide_name_until, placeholder: false })}</div>`,
          `<div class="grid g3">${field({ name: 'est_year', label: 'Year started', value: ex.est_year || '' })}${field({ name: 'team_size', label: 'Team size', value: ex.team_size || '' })}${field({ name: 'branches', label: 'Branches', value: ex.branches || '' })}</div>`,
          `<div class="grid g3">${field({ name: 'owner_name', label: 'Owner name', value: ex.owner_name || '' })}${field({ name: 'owner_mobile', label: 'Owner mobile', value: ex.owner_mobile || '' })}${field({ name: 'website', label: 'Website', value: ex.website || '' })}</div>`,
          `<div class="grid g3">${field({ name: 'hr_name', label: 'HR name', value: ex.hr_name || '' })}${field({ name: 'hr_email', label: 'HR email', value: ex.hr_email || '' })}${field({ name: 'hr_mobile', label: 'HR mobile', value: ex.hr_mobile || '' })}</div>`,
          { name: 'dnc', label: 'Do not contact', type: 'check', value: c.dnc }, { name: 'archived', label: 'Archive (hide from lists, keep history)', type: 'check', value: c.archived },
        ], submit: (v) => BB.patch(`/api/clients/${c.id}`, { company: v.company, contact: v.contact, whatsapp: v.whatsapp, email: v.email, city: v.city, state: v.state, business_type: v.business_type, fee_type: v.fee_type || null, fee_value: v.fee_value === '' ? null : Number(v.fee_value), replacement_days: v.replacement_days === '' ? null : Number(v.replacement_days), payment_days: v.payment_days === '' ? null : Number(v.payment_days), language: v.language, industry: v.industry, hide_name_until: v.hide_name_until, dnc: v.dnc ? 1 : 0, archived: v.archived ? 1 : 0, extra: { ...ex, est_year: v.est_year, team_size: v.team_size, branches: v.branches, owner_name: v.owner_name, owner_mobile: v.owner_mobile, website: v.website, hr_name: v.hr_name, hr_email: v.hr_email, hr_mobile: v.hr_mobile } }) }).then((x) => x && after('Saved'));
      },
    };
  };

  // ---------- Job opening ----------
  BB.panels.job = async (id) => {
    const j = await BB.api(`/api/jobs/${id}`); const s = BB.boot; const canAdmin = me().level !== 'sub';
    const open = j.apps.filter((a) => a.result === 'open'); const closed = j.apps.filter((a) => a.result !== 'open');
    const jd = j.jd || {};
    const appRow = (a) => `<tr class="click" data-open="application:${a.id}"><td class="mono">${a.id}</td><td>${esc(a.candidate_name)}</td><td><span class="badge b-primary">${esc(a.step)}</span>${a.on_hold ? ' <span class="badge b-outline">on hold</span>' : ''}</td><td>${resultBadge(a.result)}</td><td>${scoreBadge(a.score)}</td><td>${BB.quickScreen(a)}</td><td><span class="days ${a.days_in_step >= 7 && a.result === 'open' ? 'late' : ''}">${a.days_in_step}d</span></td></tr>`;
    // Links to paste into a Meta ad and a LinkedIn job or ad: each applicant becomes a candidate and an application
    // on this job, with the source and ad names. Applications open only once the job description is approved.
    // The ads this job runs under, and the links to paste: anyone applying from one of these ads becomes an application here.
    const adLinks = (j) => {
      const maps = j.ad_match || [];
      const liLink = (m) => `${location.origin}/apply?${['src=linkedin', ...[['campaign', m.campaign], ['adset', m.adset], ['ad', m.ad]].filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)].join('&')}`;
      const mapTable = `<div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Platform</th><th>Campaign</th><th>Ad set</th><th>Ad</th><th></th></tr></thead><tbody>${maps.map((m, i) => `<tr><td>${esc(m.platform)}</td><td>${esc(m.campaign || 'any')}</td><td>${esc(m.adset || 'any')}</td><td>${esc(m.ad || 'any')}</td><td class="nowrap">${m.platform === 'LinkedIn' ? `<button class="btn sm" data-copy="${esc(liLink(m))}">Copy apply link</button> ` : ''}<button class="btn sm ghost" data-admap-del="${i}" title="Remove">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No ads added yet. Add the Meta or LinkedIn names this job is advertised under.</td></tr>'}</tbody></table></div>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-admap-add="Meta">+ Meta ad</button><button class="btn sm" data-admap-add="LinkedIn">+ LinkedIn job or ad</button></div>`;
      return `<div class="sec"><h3>Ads for this job</h3>${mapTable}</div>${adLinksOld(j)}`;
    };
    const adLinksOld = (j) => {
      const base = `${location.origin}/apply`;
      const meta = 'src={{site_source_name}}&campaign={{campaign.name}}&adset={{adset.name}}&ad={{ad.name}}';
      const row = (label, v, note) => `<div class="ad-link"><div class="small"><b>${label}</b>${note ? ` <span class="faint">· ${note}</span>` : ''}</div><div class="row"><code class="mono tiny grow">${esc(v)}</code><button class="btn sm" data-copy="${esc(v)}">Copy</button></div></div>`;
      return `<div class="sec"><h3>Links to paste</h3><div class="card pad stack-sm">${j.jd_approved ? '' : '<div class="notice small">Approve the job description first. Until then applicants are saved as candidates but no application opens on this job.</div>'}
        ${row('Meta · Website URL', base, 'the same for every ad')}${row('Meta · URL parameters', meta, 'the same for every ad')}<div class="small"><b>LinkedIn</b> <span class="faint">· add the LinkedIn job or ad above, then use its <b>Copy apply link</b> as the apply URL on LinkedIn</span></div></div></div>`;
    };
    return {
      head: `<div class="row"><h2>${esc(j.title)}</h2><span class="mono faint">${esc(j.id)}</span>${statusBadge(j.status)}${j.reopened ? `<span class="badge b-gold">${esc(j.reopened)}</span>` : ''}<span class="badge b-outline">${esc(j.priority)}</span></div><div class="small muted">${j.internal ? '<span class="badge b-violet">Internal · BrillBrains hiring</span>' : j.client_tbc ? '<span class="badge b-amber">Client to be confirmed</span>' : `<a href="#" data-open="client:${j.client_id}">${esc(j.client_name)}</a>`} · ${esc(j.city)} · ${esc(j.reason)}</div>`,
      body: `<div class="row" style="margin-bottom:12px">
          ${['On hold'].includes(j.status) ? '<button class="btn sm" data-act="resume">Resume</button>' : !['Closed', 'Filled'].includes(j.status) ? '<button class="btn sm" data-act="hold">Put on hold</button>' : ''}
          ${!['Closed'].includes(j.status) ? '<button class="btn sm danger" data-act="close">Close</button>' : ''}
          ${['Filled', 'Closed'].includes(j.status) ? '<button class="btn sm primary" data-act="reopen">Reopen</button>' : ''}
          ${!j.jd_approved ? '<button class="btn sm" data-act="approve_jd">Job description approved</button>' : ''}
          <button class="btn sm" data-jd>Write JD</button>
          ${waBtn({ ptype: 'client', pid: j.client_id, jb: j.id, format: 'bbhs_shortlist_ready' }, 'Send profiles to client')}
          <button class="btn sm" data-addmatch>+ Add a match</button>
          ${canAdmin ? `<button class="btn sm gold" data-alert>Job alert to top matches</button>` : ''}
          <button class="btn sm" data-editjob>Edit</button>${canDelete() ? `<button class="btn sm danger" data-delrec="job" data-id="${j.id}">Delete</button>` : ''}<button class="btn sm ${j.client_tbc ? 'primary' : ''}" data-setclient>${j.client_tbc ? 'Set the client' : 'Change client'}</button></div>
        <div class="card pad sec"><div class="row small"><span>Filled <b>${j.filled}</b> of <b>${j.openings}</b></span><div class="bar grow"><i style="width:${Math.min(100, (j.filled / j.openings) * 100)}%"></i></div></div><div class="seats" style="margin-top:8px">${(j.seats || []).map((s) => s.app_id ? `<span class="seat on" title="${esc(s.app_id)}">Seat ${s.n}: <b>${esc(s.candidate || '')}</b> · ${esc(s.state)}${s.joining_date ? ` ${fmtD(s.joining_date)}` : ''}</span>` : `<span class="seat">Seat ${s.n}: open</span>`).join('')}</div>
          <dl class="kv" style="margin-top:10px"><dt>Salary</dt><dd>${esc(j.salary_text)} <span class="faint">(${inr(j.sal_from)}–${inr(j.sal_to)} a year)</span></dd><dt>Experience</dt><dd>${j.exp_from ?? '—'}–${j.exp_to ?? '—'} years</dd><dt>Join within</dt><dd>${j.notice_days ?? '—'} days</dd><dt>Skills</dt><dd>${(j.skills || []).map((x) => `<span class="badge b-outline">${esc(x)}</span>`).join(' ') || '—'}</dd><dt>Rounds</dt><dd>${(j.rounds || []).join(' → ')}</dd><dt>JD</dt><dd>${esc(j.jd_status)}${j.jd_note ? ` — <i>${esc(j.jd_note)}</i>` : ''}${jd.file ? ` <button class="btn sm" data-file="${jd.file}">JD file</button>` : ''} <button class="btn sm ghost" data-jdpdf>PDF</button></dd><dt>Old code</dt><dd>${esc(j.old_code || '—')}</dd><dt>Days open</dt><dd>${j.days_open}</dd>
          <dt>Recruiter</dt><dd>${canAdmin ? `<select data-rec style="width:auto">${j.recruiters.map((u) => `<option value="${u.id}" ${u.id === j.recruiter_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}<option value="" ${!j.recruiter_id ? 'selected' : ''}>— none —</option></select>` : esc(j.recruiter_name || '—')}</dd></dl>
          ${(j.screening_qs || []).length ? `<div class="small" style="margin-top:8px"><b>Screening questions:</b> ${j.screening_qs.map(esc).join(' · ')}</div>` : ''}${j.notes ? `<div class="small muted" style="margin-top:6px">${esc(j.notes)}</div>` : ''}</div>
        <div class="sec"><h3>Applications — open (${open.length})</h3><div class="card tbl-wrap"><table class="tbl"><tbody>${open.map(appRow).join('') || '<tr><td class="empty">Nobody in process. Add a match below.</td></tr>'}</tbody></table></div>
          ${closed.length ? `<details style="margin-top:8px"><summary class="small muted">Closed (${closed.length})</summary><div class="card tbl-wrap" style="margin-top:6px"><table class="tbl"><tbody>${closed.map(appRow).join('')}</tbody></table></div></details>` : ''}</div>
        <div class="sec"><h3>Best matches from the resume bank <span class="faint small">· found automatically</span></h3><div class="card tbl-wrap"><table class="tbl"><tbody>${j.matches.map((m) => `<tr><td>${scoreBadge(m.score)}</td><td><a href="#" data-open="candidate:${m.id}">${esc(m.name)}</a><div class="tiny muted">${esc(m.job_wanted || '')} · ${esc(m.city || '')} · ${m.exp_total ?? '—'} yrs · ${esc(m.status)}</div>${whyMatch(m)}</td><td><button class="btn sm" data-add="${m.id}">Add</button></td></tr>`).join('') || '<tr><td class="empty">No matches.</td></tr>'}</tbody></table></div></div>
        ${adLinks(j)}
        ${postingChecklist(j)}
          <div class="row small" style="margin-top:6px"><button class="btn sm" data-poster>Poster for this job</button><span class="faint">Private link (not on Google): <span class="mono">${esc(location.origin)}/apply?job=${esc(j.id)}</span></span></div></div>
        ${filesBlock(j.id, j.files, [['jd', 'Job description'], ['file', 'Other']])}
        ${notesBlock(j.id, j.notes)}
        <div class="sec"><h3>Status history</h3><div class="hist">${j.history.map((h) => `<div class="h"><span class="t">${fmtDT(h.at)}</span><span class="grow"><b>${esc(h.status)}</b> · ${esc(h.by)}${h.note ? ` — ${esc(h.note)}` : ''}</span></div>`).join('')}</div></div>`,
      mount: (el) => {
        wireCommon(el); BB.wireQuickScreen(el, () => BB.refreshPanel());
        $$('[data-act]', el).forEach((b) => (b.onclick = () => jobAct(j, b.dataset.act)));
        $$('[data-add]', el).forEach((b) => (b.onclick = () => run(() => BB.post('/api/applications', { candidate_id: b.dataset.add, job_id: j.id }), 'Added — new application at Applied')));
        $('[data-addmatch]', el).onclick = () => BB.pickCandidate((cid) => run(() => BB.post('/api/applications', { candidate_id: cid, job_id: j.id }), 'Added — a new application'), open.map((a) => a.candidate_id));
        const al = $('[data-alert]', el); if (al) al.onclick = async () => { if (!(await BB.confirm('Job alert', `Send bbhs_job_alert to candidates with a match score of ${s.match.strong}+ who have agreed to job alerts? People who replied STOP, are not looking or were placed in the last 6 months are left out.`, 'Send alert'))) return; const r = await BB.post(`/api/jobs/${j.id}/alert`, {}).catch(BB.fail); if (r) { BB.toast(`${r.sent} alert(s) saved${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`); after(); } };
        const rec = $('[data-rec]', el); if (rec) rec.onchange = (e) => run(() => BB.patch(`/api/jobs/${j.id}`, { recruiter_id: e.target.value || null }), 'Recruiter saved');
        $$('[data-pstat]', el).forEach((sl) => (sl.onchange = async () => {
          let link; if (sl.value === 'Done') { const v = await BB.ask({ title: 'Posted', fields: [{ name: 'post_link', label: 'Link to the post (optional)', opt: true }], ok: 'Save' }); if (!v) { BB.refreshPanel(); return; } link = v.post_link; }
          run(() => BB.post(`/api/jobs/${j.id}/posting`, { id: sl.dataset.pstat, status: sl.value, post_link: link }), 'Saved');
        }));
        const gt = $('[data-go-tracker]', el); if (gt) gt.onclick = (e) => { e.preventDefault(); BB.closePanels(); BB.go('team/jobs?view=tracker'); };
        $$('[data-post]', el).forEach((cb) => (cb.onchange = () => { if (cb.checked) BB.ask({ title: 'Posting done', fields: [{ name: 'post_link', label: 'Link to the post', opt: true }], ok: 'Save', submit: (v) => BB.post(`/api/jobs/${j.id}/posting`, { id: cb.dataset.post, done: true, post_link: v.post_link }) }).then((x) => (x ? after('Saved') : (cb.checked = false))); else run(() => BB.post(`/api/jobs/${j.id}/posting`, { id: cb.dataset.post, done: false })); }));
        $$('[data-copy]', el).forEach((b) => (b.onclick = () => BB.copy(b.dataset.copy)));
        $('[data-jd]', el).onclick = () => writeJD(j);
        $('[data-jdpdf]', el).onclick = () => BB.download(`/api/jobs/${j.id}/jd.pdf`, true);
        $('[data-editjob]', el).onclick = () => editJob(j);
        // Ads for this job: add or remove the Meta / LinkedIn names applicants arrive with.
        const saveMaps = (list) => run(() => BB.patch(`/api/jobs/${j.id}`, { ad_match: list }), 'Saved');
        $$('[data-admap-del]', el).forEach((b) => (b.onclick = () => saveMaps((j.ad_match || []).filter((_, i) => i !== Number(b.dataset.admapDel)))));
        $$('[data-admap-add]', el).forEach((b) => (b.onclick = async () => {
          const li = b.dataset.admapAdd === 'LinkedIn';
          const v = await BB.ask({ title: li ? 'LinkedIn job or ad for this job' : 'Meta ad for this job', fields: [
            `<p class="small muted" style="margin-top:0">${li ? 'For a LinkedIn job post, put its job ID (the number in linkedin.com/jobs/view/<b>4484922477</b>) in Ad. For a LinkedIn ad, use the campaign / ad names. Then use this row\'s Copy apply link as the apply URL on LinkedIn.' : 'Type the names exactly as in Ads Manager. Fill only what identifies this job: an ad set name alone is enough. Empty means any.'}</p>`,
            { name: 'campaign', label: 'Campaign name', opt: true }, { name: 'adset', label: li ? 'Ad set / campaign group (optional)' : 'Ad set name', opt: true }, { name: 'ad', label: li ? 'Ad name or LinkedIn job ID' : 'Ad name', opt: true },
          ], ok: 'Add' });
          if (!v) return; if (!v.campaign && !v.adset && !v.ad) return BB.toast('Fill at least one name', true);
          saveMaps([...(j.ad_match || []), { platform: li ? 'LinkedIn' : 'Meta', campaign: v.campaign, adset: v.adset, ad: v.ad }]);
        }));
        $('[data-setclient]', el).onclick = async (e) => {
          e.preventDefault(); const r = await BB.api('/api/clients?all=1'); const list = r.rows.filter((c) => !c.placeholder);
          const x = await BB.ask({ title: j.client_tbc ? 'Set the client' : 'Change client', fields: [{ name: 'client_id', label: 'Client', type: 'select', options: list.map((c) => [c.id, `${c.company} (${c.id})`]), value: j.client_tbc ? '' : j.client_id }], ok: 'Save', submit: (v) => BB.patch(`/api/jobs/${j.id}`, { client_id: v.client_id }) });
          if (x) { BB.toast('Client saved'); BB.refreshPanel ? BB.refreshPanel() : BB.open('job', j.id); BB.refreshPage && BB.refreshPage(); }
        };
        $('[data-poster]', el).onclick = () => poster(j);
      },
    };
  };
  function jobAct(j, action) {
    const s = BB.boot;
    if (action === 'hold') return BB.ask({ title: 'Put on hold', fields: [{ name: 'reason', label: 'Reason' }], ok: 'Put on hold', submit: (v) => BB.post(`/api/jobs/${j.id}/action`, { action, ...v }) }).then((x) => x && after('On hold'));
    if (action === 'close') return BB.ask({ title: 'Close job opening', fields: [{ name: 'reason', label: 'Reason', type: 'select', options: s.job_close_reasons }], ok: 'Close', submit: (v) => BB.post(`/api/jobs/${j.id}/action`, { action, ...v }) }).then((x) => x && after('Closed'));
    if (action === 'reopen') return BB.ask({ title: 'Reopen job opening', note: 'It keeps the same ID and history.', fields: [{ name: 'reason', label: 'Reason', type: 'select', options: s.reopen_reasons, value: s.reopen_reasons[0] }, ...(j.status === 'Filled' ? [{ name: 'add', label: 'New openings', type: 'number', value: 1 }] : [])], ok: 'Reopen', submit: (v) => BB.post(`/api/jobs/${j.id}/action`, { action, ...v }) }).then((x) => x && after('Reopened'));
    return run(() => BB.post(`/api/jobs/${j.id}/action`, { action }), action === 'approve_jd' ? 'Job description approved — job is live' : 'Done');
  }
  // Hiring channels for this job, grouped as in the sheet (Free / Paid / B2B / Offline), each with its status.
  const POST_CLS = { Done: 'b-green', Pending: 'b-amber', 'Not needed': 'b-outline' };
  function postingChecklist(j) {
    const rows = j.postings || []; const done = rows.filter((p) => p.status === 'Done').length; const needed = rows.filter((p) => p.status !== 'Not needed').length;
    let html = ''; let g = null; let sec = null;
    for (const p of rows) {
      if (p.group !== g) { if (g !== null) html += '</tbody></table></div>'; g = p.group; sec = null; html += `<div class="post-group"><div class="post-gh">${esc(g)}</div><table class="tbl post-tbl"><tbody>`; }
      if (p.section !== sec && p.section !== p.group) { sec = p.section; html += `<tr class="post-sec"><td colspan="5">${esc(sec)}</td></tr>`; }
      html += `<tr><td><b>${esc(p.channel)}</b><div class="tiny muted">${esc(p.how || '')}</div></td><td class="small nowrap">${esc(p.owner || '')}</td><td><select data-pstat="${p.id}" class="mini">${['', 'Pending', 'Done', 'Not needed'].map((v) => `<option value="${v}" ${(p.status || '') === v ? 'selected' : ''}>${v || '—'}</option>`).join('')}</select>${p.status === 'Done' ? `<div class="tiny faint">${fmtD(p.done_date)}${p.done_by ? ` · ${esc(p.done_by)}` : ''}${p.post_link ? ` · <a href="${esc(p.post_link)}" target="_blank" rel="noopener">post ↗</a>` : ''}</div>` : ''}</td><td class="nowrap"><button class="btn sm" data-copy="${esc(p.apply_link)}" title="Apply link that marks people as coming from ${esc(p.channel)}">Copy link</button></td><td class="num small" title="Applications from this channel">${p.apps || ''}</td></tr>`;
    }
    if (g !== null) html += '</tbody></table></div>';
    return `<div class="sec"><h3>Hiring channels <span class="badge b-primary">${done} of ${needed} done</span> <a href="#" class="small" data-go-tracker>All jobs ›</a></h3>${html || '<div class="faint small">No channels set.</div>'}`;
  }
  // The JD sections, shared by a job's JD and the JD pool. Jewellery industry experience is its own section.
  BB.jdFields = (jd, fillT = (t) => t || '') => [
    { name: 'summary', label: 'Role summary', type: 'textarea', value: fillT(jd.summary) },
    { name: 'duties', label: 'Duties (one per line)', type: 'textarea', value: jd.duties || '' },
    `<div class="jd-jewel"><b>Jewellery industry experience</b><div class="grid g3">${BB.field({ name: 'jewel_need', label: 'Needed?', type: 'select', options: ['Required', 'Preferred', 'Not required'], value: jd.jewel_need || 'Preferred', placeholder: false })}${BB.field({ name: 'jewel_years', label: 'Years (at least)', type: 'number', opt: true, value: jd.jewel_years || '' })}${BB.field({ name: 'jewel_note', label: 'Which part of the trade', opt: true, value: jd.jewel_note || '', placeholder: 'e.g. diamond retail, gold manufacturing' })}</div></div>`,
    `<div class="grid g2">${BB.field({ name: 'must', label: 'Must-have skills', type: 'textarea', value: jd.must || '' })}${BB.field({ name: 'good', label: 'Good to have', type: 'textarea', value: jd.good || '' })}</div>`,
    `<div class="grid g2">${BB.field({ name: 'education', label: 'Education', opt: true, value: jd.education || '' })}${BB.field({ name: 'languages', label: 'Languages', opt: true, value: jd.languages || '' })}</div>`,
    `<div class="grid g3">${BB.field({ name: 'timings', label: 'Timings', opt: true, value: jd.timings || '' })}${BB.field({ name: 'benefits', label: 'Benefits', opt: true, value: jd.benefits || '' })}${BB.field({ name: 'incentives', label: 'Incentives', opt: true, value: jd.incentives || '' })}</div>`,
  ];
  // Put a JD's sections into an open form (from the pool or from AI).
  BB.fillJd = (form, jd) => { for (const [k, v] of Object.entries(jd || {})) { const x = form.querySelector(`[name="${k}"]`); if (x && v !== undefined && v !== null && String(v) !== '') x.value = v; } };
  function writeJD(j) {
    const jd = { ...j.jd_template, ...(j.jd || {}) }; const fillT = (t) => String(t || '').replace(/\{job\}/g, j.title).replace(/\{city\}/g, j.city);
    BB.ask({ title: `Job description · ${j.id}`, wide: true, ok: 'Save draft', note: j.jd_note ? `Client asked: ${esc(j.jd_note)}` : `Starts from the JD pool for ${esc(j.title)} when there is one. <button type="button" class="btn sm" data-jdpool>Fill from JD pool</button> <button type="button" class="btn sm primary" data-jdai>✦ Write with AI</button>`,
      fields: [...BB.jdFields(jd, fillT), { name: 'save_pool', label: `Also save this as the JD for every ${j.title} job (JD pool)`, type: 'check', value: false },
        `<div class="grid g2">${field({ name: 'salary', label: 'Salary', value: jd.salary || j.salary_text })}${field({ name: 'location', label: 'Location', value: fillT(jd.location) })}</div>`,
        { name: 'send', label: 'Send to client for approval (they see Approve / Ask for changes)', type: 'check', value: true }],
      submit: async (v) => { const send = v.send; const pool = v.save_pool; delete v.send; delete v.save_pool; const r = await BB.post(`/api/jobs/${j.id}/jd`, { jd: v, send }); if (pool) await BB.post('/api/jd-pool', { title: j.title, jd: v }); return r; } }).then((x) => x && after('Job description saved'));
    // Buttons in the note: fill from the pool, or let AI write it from the job's facts.
    setTimeout(() => {
      const form = $('.modal form'); if (!form) return;
      const pb = $('[data-jdpool]'); if (pb) pb.onclick = async () => { const d = await BB.api('/api/jd-pool'); const t = d.pool[j.title]; if (!t) return BB.toast(`No JD in the pool for ${j.title} yet`, true); BB.fillJd(form, t); BB.toast('Filled from the JD pool'); };
      const ab = $('[data-jdai]'); if (ab) ab.onclick = async () => {
        ab.disabled = true; ab.textContent = 'Writing…';
        const v = BB.formValues(form);
        try { const r = await BB.post('/api/jd/write', { title: j.title, city: j.city, experience: j.exp_from !== null && j.exp_from !== undefined ? `${j.exp_from}–${j.exp_to ?? '+'} years` : '', salary: j.salary_text, jewel_need: v.jewel_need, jewel_years: v.jewel_years, jewel_note: v.jewel_note, notes: [v.summary, v.must].filter(Boolean).join('\n') }); BB.fillJd(form, { ...r.jd, jewel_need: v.jewel_need, jewel_years: v.jewel_years, jewel_note: v.jewel_note }); BB.toast('Written. Check and edit before saving.'); } catch (e) { BB.fail(e); }
        ab.disabled = false; ab.textContent = '✦ Write with AI';
      };
    }, 60);
  }
  function editJob(j) {
    BB.ask({ title: `Edit ${j.id}`, wide: true, fields: [
      `<div class="grid g3"><label class="field"><span class="lab">Job</span><select name="title">${BB.jobOptions(j.title)}</select></label>${field({ name: 'city', label: 'City', value: j.city, list: 'cities' })}${field({ name: 'openings', label: 'Openings', type: 'number', value: j.openings })}</div>`,
      `<div class="grid g4">${field({ name: 'sal_from', label: 'Salary from (per year)', type: 'number', value: j.sal_from ?? '' })}${field({ name: 'sal_to', label: 'Salary to (per year)', type: 'number', value: j.sal_to ?? '' })}${field({ name: 'exp_from', label: 'Exp from', type: 'number', value: j.exp_from ?? '' })}${field({ name: 'exp_to', label: 'Exp to', type: 'number', value: j.exp_to ?? '' })}</div>`,
      `<div class="grid g3">${field({ name: 'notice_days', label: 'Join within (days)', type: 'number', value: j.notice_days ?? '' })}${field({ name: 'priority', label: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'], value: j.priority, placeholder: false })}${field({ name: 'rounds', label: 'Interview rounds (comma separated)', value: (j.rounds || []).join(', ') })}</div>`,
      { name: 'skills', label: 'Skills (comma separated)', value: (j.skills || []).join(', '), hint: BB.boot.skills.join(', ') },
      { name: 'screening_qs', label: 'Screening questions (one per line)', type: 'textarea', value: (j.screening_qs || []).join('\n') },
      { name: 'notes', label: 'Notes', type: 'textarea', value: j.notes || '' },
    ], submit: (v) => BB.patch(`/api/jobs/${j.id}`, { ...v, openings: Number(v.openings) || 1, sal_from: v.sal_from === '' ? null : Number(v.sal_from), sal_to: v.sal_to === '' ? null : Number(v.sal_to), exp_from: v.exp_from === '' ? null : Number(v.exp_from), exp_to: v.exp_to === '' ? null : Number(v.exp_to), notice_days: v.notice_days === '' ? null : Number(v.notice_days), skills: v.skills.split(',').map((x) => x.trim()).filter(Boolean), rounds: v.rounds.split(',').map((x) => x.trim()).filter(Boolean), screening_qs: v.screening_qs.split('\n').map((x) => x.trim()).filter(Boolean) }) }).then((x) => x && after('Saved'));
  }
  function poster(j) {
    const link = `${location.origin}/apply?src=post&job=${j.id}`;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`;
    BB.modal({ title: 'Job poster', foot: '<span class="faint small grow">Right-click the poster to save, or print it.</span><button class="btn" onclick="window.print()">Print</button>', body: `<div style="background:linear-gradient(150deg,#101A3A,#1F2D5C);color:#fff;border-radius:14px;padding:28px;text-align:center"><img src="/img/logo.png" alt="BrillBrains Hiring Solutions" style="height:60px;max-width:100%"><div style="font:600 13px var(--font);letter-spacing:.2em;color:#EECB6B;margin-top:8px">WE ARE HIRING</div><h1 style="color:#fff;margin:8px 0">${esc(j.title)}</h1><div style="color:#DCE2F2">${esc(j.city)} · ${esc(j.salary_text)}</div>${j.jd && j.jd.summary ? `<p style="color:#DCE2F2;font-size:13px">${esc(j.jd.summary)}</p>` : ''}<img src="${qr}" alt="QR code" style="background:#fff;padding:8px;border-radius:10px;margin-top:12px;width:160px;height:160px"><div class="mono" style="color:#EECB6B;margin-top:8px;font-size:11px;word-break:break-all">${esc(link)}</div><div style="margin-top:6px;font-size:12px">${esc(BB.boot.business.name)}</div></div>` });
  }

  // ---------- Application ----------
  BB.panels.application = async (id) => {
    const a = await BB.api(`/api/applications/${id}`); const s = BB.boot; const open = a.result === 'open';
    const sug = a.suggest;
    const btns = [];
    if (open) {
      if (a.step !== 'Offer accepted' && a.step !== 'Offer made' && a.step !== 'Joined') btns.push(`<button class="btn sm primary" data-next>→ ${esc(s.steps[s.steps.indexOf(a.step) + 1])}</button>`);
      if (!['Offer made', 'Offer accepted', 'Joined'].includes(a.step)) btns.push('<button class="btn sm" data-sched="phone">📞 Telephonic round</button><button class="btn sm" data-sched="video">Virtual round</button><button class="btn sm" data-sched="in_person">Final round (in person)</button>');
      if (['Client interview', 'Sent to client'].includes(a.step)) btns.push('<button class="btn sm gold" data-offer>Record the offer</button>');
      if (a.step === 'Offer made') btns.push('<button class="btn sm gold" data-offer>Change offer</button><button class="btn sm primary" data-accept>Offer accepted</button><button class="btn sm danger" data-decline>Offer declined</button>');
      if (a.step === 'Offer accepted') btns.push('<button class="btn sm primary" data-joined>Mark joined</button><button class="btn sm danger" data-nojoin>Did not join</button>');
      if (a.offer_ctc) btns.push(`<button class="btn sm" data-letter>${a.offer_letter ? 'Remake' : 'Make'} offer letter</button>`);
      btns.push(`<button class="btn sm" data-hold>${a.on_hold ? 'Remove hold' : 'On hold'}</button><button class="btn sm danger" data-close>Close</button>`);
    } else if (a.result === 'Hired') {
      if (!a.left_date) btns.push('<button class="btn sm danger" data-left>Left the job</button>');
      btns.push(`<button class="btn sm" data-risk>${a.at_risk ? 'Clear at risk' : 'Mark at risk'}</button>`);
    } else btns.push('<button class="btn sm" data-reopen>Reopen</button>');
    if (canDelete()) btns.push(`<button class="btn sm danger" data-delrec="application" data-id="${a.id}">Delete</button>`);
    const iv = (i) => `<div class="card pad stack-sm"><div class="row between"><div><b>${esc(i.id)}</b> ${esc(i.name)} <span class="badge ${i.mode === 'phone' ? 'b-outline' : i.round === 'ours' ? 'b-primary' : 'b-violet'}">${esc(i.mode_label || (i.round === 'ours' ? 'Our interview' : 'Client interview'))}</span>${i.client_joins ? ' <span class="badge b-violet">client joins</span>' : ''}</div><span class="badge ${i.view_status === 'Result pending' ? 'b-amber' : 'b-outline'}">${esc(i.view_status)}</span></div>
      <div class="small">${fmtDT(i.at)} · ${esc(i.place)}${i.link ? ` · <a href="${esc(i.link)}" target="_blank" rel="noopener">join link</a>` : ''} · ${esc(i.interviewer || '—')} ${i.confirmed ? '<span class="badge b-green">Confirmed</span>' : '<span class="badge b-outline">Not confirmed</span>'} <a class="small" href="${BB.gcal(i, `Interview: ${a.candidate_name} — ${a.job_title} (${i.name})`, `${i.name} · ${a.id}`)}" target="_blank" rel="noopener">+ Google Calendar</a></div>
      ${ivNotes(i.notes)}<div><button class="btn sm ghost" data-ivnote="${i.id}">+ Interview note</button></div>
      ${i.result ? `<div class="small"><b>${esc(i.result)}</b>${i.rating ? ` · ${'★'.repeat(i.rating)}` : ''} — ${esc(i.remark || '')}</div>` : ''}${(i.qa || []).map((q) => `<div class="small faint">Q: ${esc(q.q)} — A: ${esc(q.a)}</div>`).join('')}
      ${['Scheduled', 'Rescheduled'].includes(i.status) ? `<div class="row"><button class="btn sm primary" data-result="${i.id}">Record result</button>${i.confirmed ? '' : `<button class="btn sm" data-confirm="${i.id}">Mark confirmed</button>`}${waBtn({ ptype: 'candidate', pid: a.candidate_id, ap: a.id, iv: i.id, format: 'bbhs_interview_reminder' }, 'Remind candidate')}${i.round === 'client' ? waBtn({ ptype: 'client', pid: a.client_id, ap: a.id, iv: i.id, format: i.view_status === 'Result pending' ? 'bbhs_feedback_request' : 'bbhs_interview_reminder' }, i.view_status === 'Result pending' ? 'Ask client for feedback' : 'Remind client') : ''}</div>` : ''}</div>`;
    // Screening: the decision on this application, and the candidate set against what the job needs.
    const SCREEN_BADGE = { 'Under consideration': 'b-primary', 'Requirement not met': 'b-amber', Rejected: 'b-red', Accepted: 'b-green' };
    const screenBlock = (a) => {
      const c = a.candidate || {}; const j = a.job || {}; const sc = a.score || {};
      const yrs = (v) => (v === null || v === undefined ? '—' : `${v} yrs`); const pm = (y) => (y ? inr(y / 12) : '—');
      const range = (x, y, fmt) => (x || y ? `${fmt(x || y)}${y && y !== x ? `–${fmt(y)}` : ''}` : '—');
      const line = (label, cand, job) => `<tr><td class="small muted">${label}</td><td>${cand}</td><td class="muted">${job}</td></tr>`;
      return `<div class="sec card pad stack-sm"><div class="row between"><h3 style="margin:0">Screening</h3>${a.screen ? `<span class="badge ${SCREEN_BADGE[a.screen] || 'b-outline'}">${esc(a.screen)}</span>` : '<span class="badge b-outline">Not screened yet</span>'}</div>
        ${a.screen_note ? `<div class="small muted">${esc(a.screen_note)} · ${esc(a.screen_by || '')} ${a.screen_at ? fmtDT(a.screen_at) : ''}</div>` : ''}
        <div class="row">${['Under consideration', 'Requirement not met', 'Rejected', 'Accepted'].map((v) => `<button class="btn sm ${a.screen === v ? 'primary' : ''}" data-screen="${v}">${v}</button>`).join('')}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Candidate</th><th>Job needs</th></tr></thead><tbody>
          ${line('Role', esc(c.job_wanted || '—'), esc(j.title || '—'))}
          ${line('City', esc([c.city, ...(c.work_cities || []).filter((x) => x !== c.city)].filter(Boolean).join(', ') || '—'), esc(j.city || '—'))}
          ${line('Experience', yrs(c.exp_total), j.exp_from !== null && j.exp_from !== undefined ? `${j.exp_from}–${j.exp_to ?? '+'} yrs` : '—')}
          ${line('In jewellery', c.exp_jewellery === 0 ? 'None' : yrs(c.exp_jewellery), '—')}
          ${line('Salary / month', `now ${pm(c.cur_salary)} · expects ${pm(c.exp_salary)}`, range(j.sal_from, j.sal_to, pm))}
          ${line('Notice', c.notice_days !== null && c.notice_days !== undefined ? `${c.notice_days} days` : '—', j.notice_days ? `within ${j.notice_days} days` : '—')}
          ${line('Worked with', esc((c.exp_business || []).join(', ') || '—'), '—')}
          ${line('Skills', esc((c.skills || []).join(', ') || '—'), esc((j.skills || []).join(', ') || '—'))}
        </tbody></table></div>
        <div class="row small">${sc.score !== undefined ? scoreBadge(sc.score) : ''}${(sc.reasons || []).map((r) => `<span class="badge b-green">✓ ${esc(r)}</span>`).join('')}${(sc.gaps || []).map((g) => `<span class="badge b-outline">✗ ${esc(g)}</span>`).join('')}${c.cv_file ? `<button class="btn sm" data-file="${esc(c.cv_file)}">Open CV</button>` : '<span class="faint">No CV uploaded</span>'}</div></div>`;
    };
    const items = a.checklist_items;
    return {
      head: `<div class="row"><h2>${esc(a.candidate_name)}</h2><span class="mono faint">${esc(a.id)}</span>${resultBadge(a.result)}${a.on_hold ? `<span class="badge b-outline">On hold: ${esc(a.hold_reason)}</span>` : ''}${a.at_risk ? '<span class="badge b-red">At risk</span>' : ''}${a.left_date ? `<span class="badge b-red">Left on ${fmtD(a.left_date)}</span>` : ''}${scoreBadge(a.score.score)}</div>
        <div class="app-meta"><div><span>Job</span><a href="#" data-open="job:${a.job_id}">${esc(a.job_title)} <span class="mono faint">${esc(a.job_id)}</span></a></div><div><span>Client</span>${esc(a.client_name || '—')}</div><div><span>Owner</span>${esc(a.owner_name || '—')}</div><div><span>Source</span>${esc(a.source || '—')}</div><div><span>In this step</span>${a.days_in_step} day${a.days_in_step === 1 ? '' : 's'}</div>
        ${a.ad_campaign || a.ad_set || a.ad_name ? `<div class="wide"><span>Ad</span><span class="ad-path">${[['Campaign', a.ad_campaign], ['Ad set', a.ad_set], ['Ad', a.ad_name]].filter(([, v]) => v).map(([l, v]) => `<i title="${l}">${esc(v)}</i>`).join('<b>›</b>')}</span></div>` : ''}</div>`,
      body: `${sug ? `<div class="notice small row" style="margin-bottom:12px">${waIcon}<span class="grow"><b>Suggested message:</b> ${esc(sug.label)} → ${sug.ptype}</span>${waBtn({ ptype: sug.ptype, pid: sug.ptype === 'client' ? a.client_id : a.candidate_id, ap: a.id, jb: a.job_id, iv: sug.iv, format: sug.format }, 'Send')}</div>` : ''}
        <div class="row" style="margin-bottom:6px">${waBtn({ ptype: 'candidate', pid: a.candidate_id, ap: a.id }, 'Candidate', 'btn sm')}${waBtn({ ptype: 'client', pid: a.client_id, ap: a.id, jb: a.job_id }, 'Client', 'btn sm')}<button class="btn sm ghost" data-open="candidate:${a.candidate_id}">Candidate profile</button></div>
        ${BB.tracker(a.step, a.result)}
        <div class="row" style="margin:10px 0 14px">${btns.join('')}${open ? `<select data-setstep style="width:auto;margin-left:auto" title="Set any step (corrections)"><option value="">Set step…</option>${s.steps.map((x) => `<option>${x}</option>`).join('')}</select>` : ''}</div>
        ${screenBlock(a)}
        ${a.offer_ctc ? `<div class="sec card pad"><h3 style="margin-bottom:6px">Offer</h3><dl class="kv"><dt>Yearly CTC</dt><dd><b>${inr(a.offer_ctc)}</b></dd><dt>Joining date</dt><dd>${fmtD(a.joining_date)}</dd><dt>Reporting to</dt><dd>${esc(a.reporting_to || '—')}</dd><dt>Offer letter</dt><dd>${a.offer_letter ? `<button class="btn sm" data-file="${a.offer_letter}">Open PDF</button> ${a.offer_sent ? '<span class="badge b-green">sent</span>' : '<span class="badge b-outline">client to check</span>'}` : '—'}</dd>${a.bill ? `<dt>Bill</dt><dd><a href="#" data-open="bill:${a.bill.id}">${esc(a.bill.bill_no || a.bill.id)}</a> · ${inr(a.bill.total)} · ${esc(a.bill.view_status)}</dd>` : ''}</dl></div>` : ''}
        ${a.step === 'Offer accepted' || a.result === 'Hired' ? `<div class="sec"><h3>Joining checklist</h3><div class="card pad">${items.map((it) => `<label class="row small"><input type="checkbox" data-ck="${esc(it)}" ${a.checklist && a.checklist[it] ? 'checked' : ''}> ${esc(it)} <span class="faint tiny">${a.checklist && a.checklist[it] ? esc(a.checklist[it].by) : ''}</span></label>`).join('')}${(a.joining_docs || []).length ? `<div class="row" style="margin-top:6px">${a.joining_docs.map((d) => `<button class="btn sm" data-file="${d.file}">${esc(d.label)}</button>`).join('')}</div>` : '<div class="faint small">No joining documents uploaded yet.</div>'}</div></div>` : ''}
        <div class="sec"><h3>Interviews</h3><div class="stack-sm">${a.interviews.map(iv).join('') || '<div class="faint small">No interviews yet. Usual order: telephonic → virtual → final in person with the client.</div>'}</div></div>
        ${callsBlock(a.candidate_id, a.id, a.calls)}
        <div class="sec"><h3>Why it matches</h3><div class="small">${a.score.reasons.map(esc).join(' · ') || '—'}</div></div>
        <div class="sec"><h3>WhatsApp on this application</h3>${msgList(a.messages)}</div>
        ${filesBlock(a.id, a.files, [['joining_doc', 'Joining document'], ['offer_signed', 'Signed offer letter'], ['file', 'Other']])}
        ${notesBlock(a.id, a.notes)}
        <div class="sec"><h3>History</h3><div class="hist">${a.history.map((h) => `<div class="h"><span class="t">${fmtDT(h.at)}</span><span class="grow"><b>${esc(h.step)}</b> · ${esc(h.by)}${h.note ? ` — ${esc(h.note)}` : ''}</span></div>`).join('')}</div></div>`,
      mount: (el) => {
        wireCommon(el);
        const on = (sel, fn) => { const b = $(sel, el); if (b) b.onclick = fn; };
        on('[data-next]', () => run(() => BB.post(`/api/applications/${a.id}/step`, { next: true }), 'Moved'));
        $$('[data-screen]', el).forEach((b) => (b.onclick = async () => {
          const v = b.dataset.screen; const closes = v === 'Requirement not met' || v === 'Rejected';
          const x = await BB.ask({ title: `Screening: ${v}`, fields: [{ name: 'note', label: closes ? 'Why (kept on the application)' : 'Note', type: 'textarea', opt: !closes }], ok: v, note: closes ? 'This closes the application. You can change the decision later.' : v === 'Accepted' ? 'The application moves to Our interview.' : '' });
          if (x) run(() => BB.post(`/api/applications/${a.id}/screen`, { verdict: v, note: x.note }), `Marked ${v}`);
        }));
        $$('[data-sched]', el).forEach((b) => (b.onclick = () => BB.schedule(a, b.dataset.sched)));
        BB.callOutcomes = a.call_outcomes;
        on('[data-offer]', () => BB.recordOffer(a));
        on('[data-accept]', () => run(() => BB.post(`/api/applications/${a.id}/accept`), 'Offer accepted'));
        on('[data-decline]', () => BB.ask({ title: 'Offer declined', fields: [{ name: 'note', label: 'Note', opt: true }], ok: 'Close as Offer declined', submit: (v) => BB.post(`/api/applications/${a.id}/decline`, v) }).then((x) => x && after('Closed')));
        on('[data-joined]', () => BB.ask({ title: 'Mark joined', note: 'This closes the application as Hired and makes a draft bill.', fields: [{ name: 'joining_date', label: 'Joining date', type: 'date', value: a.joining_date || BB.istDay() }], ok: 'Mark joined', submit: (v) => BB.post(`/api/applications/${a.id}/joined`, v) }).then((x) => x && after('Joined — draft bill made')));
        on('[data-nojoin]', () => BB.ask({ title: 'Did not join', note: 'The seat opens again and the job status goes back.', fields: [{ name: 'note', label: 'What happened?', type: 'textarea' }], ok: 'Close as Did not join', submit: (v) => BB.post(`/api/applications/${a.id}/no-join`, v) }).then((x) => x && after('Closed')));
        on('[data-letter]', () => BB.ask({ title: 'Offer letter', note: 'Made from the client\'s offer letter template.', fields: [{ name: 'send', label: 'Send to the candidate now (otherwise the client checks it first)', type: 'check', value: false }], ok: 'Make offer letter', submit: (v) => BB.post(`/api/applications/${a.id}/offer-letter`, v) }).then((x) => x && after('Offer letter made')));
        on('[data-hold]', () => (a.on_hold ? run(() => BB.post(`/api/applications/${a.id}/hold`, { on: false }), 'Hold removed') : BB.ask({ title: 'Put on hold', note: 'A flag, not a step: the card turns grey.', fields: [{ name: 'reason', label: 'Reason' }, { name: 'until', label: 'Come back on', type: 'date', opt: true }], ok: 'On hold', submit: (v) => BB.post(`/api/applications/${a.id}/hold`, { on: true, ...v }) }).then((x) => x && after('On hold'))));
        on('[data-close]', () => BB.ask({ title: 'Close application', fields: [{ name: 'reason', label: 'Reason', type: 'select', options: s.closing_reasons }, { name: 'note', label: 'Note', opt: true }], ok: 'Close', submit: (v) => BB.post(`/api/applications/${a.id}/close`, v) }).then((x) => x && after('Closed')));
        on('[data-reopen]', () => run(() => BB.post(`/api/applications/${a.id}/reopen`), 'Reopened'));
        on('[data-left]', () => BB.ask({ title: 'Left the job', note: `Free replacement applies if they left on their own or absconded within ${a.replacement_window} days of joining.`, fields: [{ name: 'date', label: 'Last working day', type: 'date' }, { name: 'reason', label: 'Reason', type: 'select', options: ['Left on their own', 'Removed by client', 'Absconded', 'Other'] }, { name: 'note', label: 'Note', type: 'textarea', opt: true }], ok: 'Save', submit: (v) => BB.post(`/api/applications/${a.id}/left`, v) }).then((x) => x && (BB.toast(x.outcome), after())));
        on('[data-risk]', () => run(() => BB.post(`/api/applications/${a.id}/risk`, { on: !a.at_risk })));
        const ss = $('[data-setstep]', el); if (ss) ss.onchange = () => ss.value && run(() => BB.post(`/api/applications/${a.id}/step`, { step: ss.value, note: 'Set by hand', force: true }), 'Step set');
        $$('[data-result]', el).forEach((b) => (b.onclick = () => BB.recordResult(a.interviews.find((i) => i.id === b.dataset.result), a)));
        $$('[data-confirm]', el).forEach((b) => (b.onclick = () => run(() => BB.post(`/api/interviews/${b.dataset.confirm}/confirm`), 'Confirmed')));
        $$('[data-ck]', el).forEach((cb) => (cb.onchange = () => run(() => BB.post(`/api/applications/${a.id}/checklist`, { item: cb.dataset.ck, done: cb.checked }))));
      },
    };
  };
  // Three rounds: telephonic (us), virtual (us, the client can join), final in person (the client).
  BB.schedule = (a, mode) => BB.ask({ title: `Schedule: ${BB.ivModes[mode] || 'interview'}`, note: mode === 'phone' ? 'Log each call to the candidate under Calls.' : mode === 'video' ? 'Tick "Client joins" if the client is on this call — it then shows in the client\'s account.' : 'The client meets the candidate. It shows in the client\'s account.', fields: [
    { name: 'name', label: 'Round name', value: BB.ivModes[mode] }, { name: 'at', label: 'Date and time', type: 'datetime-local' },
    ...(mode === 'video' ? [{ name: 'link', label: 'Meeting link (Google Meet / Zoom)', placeholder: 'https://meet.google.com/…', opt: true, voice: false }, { name: 'client_joins', label: 'Client joins this round', type: 'check', value: false }] : []),
    ...(mode === 'in_person' ? [{ name: 'place', label: 'Address', value: a.client_city || '', placeholder: 'Showroom / office address' }] : []),
    { name: 'interviewer', label: 'Interviewer', value: mode === 'in_person' ? (a.client && a.client.contact) || '' : me().name },
  ], ok: 'Schedule', submit: (v) => BB.post('/api/interviews', { app_id: a.id, mode, round: mode === 'in_person' ? 'client' : 'ours', ...v, at: BB.fromLocalInput(v.at) }) })
    .then((x) => { if (x) { BB.toast(x.clash && x.clash.length ? `Scheduled — clash warning with ${x.clash.join(', ')}` : 'Scheduled'); after(); } });
  BB.recordOffer = (a) => BB.ask({ title: 'Record the offer', note: 'The candidate gets the offer with Accept / Decline.', fields: [
    { name: 'ctc', label: 'Yearly CTC (₹)', type: 'number', value: a.offer_ctc || '' }, { name: 'joining_date', label: 'Joining date', type: 'date', value: a.joining_date || '' }, { name: 'reporting_to', label: 'Reporting to', value: a.reporting_to || '', opt: true },
  ], ok: 'Record offer', submit: (v) => BB.post(`/api/applications/${a.id}/offer`, v) }).then((x) => x && after('Offer recorded'));
  // Interview record pop-up.
  BB.recordResult = (i, a) => {
    const ours = i.round === 'ours';
    const results = ours ? ['Move ahead', 'On hold', 'Not selected'] : ['Selected', 'Another round', 'On hold', 'Not selected'];
    const nextText = { 'Move ahead': `This moves ${a.id} to Sent to client.`, 'Not selected': `This closes ${a.id} (${ours ? 'Not suitable' : 'Client rejected'}).`, 'On hold': `This puts ${a.id} on hold.`, Selected: 'Next you record the offer.', 'Another round': 'Schedule the next round after saving.' };
    let qa = (i.qa || []).length ? i.qa.slice() : [{ q: '', a: '' }]; let rating = i.rating || 0;
    const m = BB.modal({ title: `Interview record · ${esc(i.id)}`, wide: true, body: '<div data-b></div>', foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" data-s>Save</button>' });
    const el = m.el; const st = { status: 'Completed', result: '' };
    const draw = () => {
      $('[data-b]', el).innerHTML = `<div class="stack"><div class="small muted">${esc(a.candidate_name)} · ${esc(a.job_title)} · ${fmtDT(i.at)}</div>
        <label class="field" data-f="status"><span class="lab">What happened</span><div class="choice">${['Completed', 'No-show', 'Cancelled', 'Rescheduled'].map((x) => `<label><input type="radio" name="status" value="${x}" ${st.status === x ? 'checked' : ''}> ${x}</label>`).join('')}</div></label>
        ${st.status === 'Rescheduled' ? `<label class="field" data-f="new_at"><span class="lab">New time</span><input type="datetime-local" name="new_at"></label>` : ''}
        ${st.status === 'Completed' ? `<label class="field" data-f="result"><span class="lab">Result</span><div class="choice">${results.map((x) => `<label><input type="radio" name="result" value="${x}" ${st.result === x ? 'checked' : ''}> ${x}</label>`).join('')}</div></label>${st.result ? `<div class="notice small">${nextText[st.result]}</div>` : ''}
        <div><div class="row between"><b class="small">Questions and answers</b><button type="button" class="btn sm" data-addq>+ Add a question</button></div><div class="stack-sm" style="margin-top:6px">${qa.map((x, k) => `<div class="qa-row grid g2"><div class="inp-wrap"><input data-q="${k}" value="${esc(x.q)}" placeholder="Question" data-voice></div><div class="inp-wrap"><input data-a="${k}" value="${esc(x.a)}" placeholder="Answer" data-voice></div></div>`).join('')}</div></div>
        <div><b class="small">Rating</b> <span class="faint small">(optional, used in matching)</span><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= rating ? 'on' : ''}">★</button>`).join('')}</div></div>` : ''}
        <label class="field" data-f="remark"><span class="lab">Remark</span><div class="inp-wrap"><textarea name="remark" data-voice>${esc(st.remark || '')}</textarea></div></label></div>`;
      BB.attachMics(el);
      $$('[name=status]', el).forEach((r) => (r.onchange = () => { keep(); st.status = r.value; draw(); }));
      $$('[name=result]', el).forEach((r) => (r.onchange = () => { keep(); st.result = r.value; draw(); }));
      const aq = $('[data-addq]', el); if (aq) aq.onclick = () => { keep(); qa.push({ q: '', a: '' }); draw(); };
      $$('[data-star]', el).forEach((b) => (b.onclick = () => { keep(); rating = Number(b.dataset.star) === rating ? 0 : Number(b.dataset.star); draw(); }));
    };
    const keep = () => { qa = qa.map((x, k) => ({ q: ($(`[data-q="${k}"]`, el) || {}).value ?? x.q, a: ($(`[data-a="${k}"]`, el) || {}).value ?? x.a })); const r = $('[name=remark]', el); if (r) st.remark = r.value; };
    draw();
    $('[data-c]', el).onclick = m.close;
    $('[data-s]', el).onclick = async () => {
      keep(); const na = $('[name=new_at]', el);
      try {
        const r = await BB.post(`/api/interviews/${i.id}/result`, { status: st.status, result: st.result, remark: st.remark, rating: rating || null, qa: qa.filter((x) => x.q || x.a), new_at: na ? BB.fromLocalInput(na.value) : undefined });
        m.close(); BB.toast(r.next === 'OPEN_OFFER' ? 'Selected — record the offer' : r.next); after();
        if (r.next === 'OPEN_OFFER') BB.recordOffer(a);
      } catch (e) { BB.showErr(el, e); }
    };
  };

  // ---------- Candidate ----------
  // Why a candidate and a job match: what fits (✓) and what does not (✗), in a few words each.
  const whyMatch = (m) => `<div class="why">${(m.reasons || []).map((r) => `<span class="ok">✓ ${esc(r)}</span>`).join('')}${(m.gaps || []).map((g) => `<span class="no">✗ ${esc(g)}</span>`).join('')}</div>`;
  // History: every application this person has had (open or closed) with the screening decision, each interview's
  // result, rating, remarks and notes, the calls, and the steps it went through, so you can see how they did.
  const SCREEN_CLS = { Accepted: 'b-green', Rejected: 'b-red', 'Requirement not met': 'b-amber', 'Under consideration': 'b-primary' };
  const historyPane = (c) => {
    const t = c.track || []; if (!t.length) return '<div class="faint small" style="padding:10px 0">No applications yet. Add them to a job to start a history.</div>';
    return `<div class="stack">${t.map((a) => `<div class="card pad hist-app">
      <div class="row between"><div><a href="#" data-open="application:${a.id}"><b>${esc(a.job_title || a.job_id)}</b></a> <span class="faint small">${esc(a.client_name || '')} · <span class="mono">${esc(a.id)}</span> · applied ${fmtD(a.created_at)}</span></div><div class="row">${a.screen ? `<span class="badge ${SCREEN_CLS[a.screen] || 'b-outline'}">${esc(a.screen)}</span>` : ''}<span class="badge b-primary">${esc(a.step)}</span>${resultBadge(a.result)}</div></div>
      ${a.screen_note ? `<div class="small muted" style="margin-top:6px"><b>Screening:</b> ${esc(a.screen_note)}${a.screen_by ? ` · ${esc(a.screen_by)}` : ''}</div>` : ''}
      ${a.offer_ctc ? `<div class="small" style="margin-top:6px"><b>Offer:</b> ${inr(a.offer_ctc)} a year${a.joining_date ? ` · joining ${fmtD(a.joining_date)}` : ''}</div>` : ''}
      ${a.interviews.length ? `<div class="hist-sub"><h4>Interviews</h4>${a.interviews.map((i) => `<div class="hist-iv"><div class="row small"><b>${esc(i.mode_label || i.name || i.round)}</b><span class="faint">${fmtDT(i.at)}${i.interviewer ? ` · ${esc(i.interviewer)}` : ''}</span>${i.result ? `<span class="badge ${i.result === 'Selected' ? 'b-green' : i.result === 'Not selected' ? 'b-red' : 'b-primary'}">${esc(i.result)}</span>` : `<span class="badge b-outline">${esc(i.status)}</span>`}${i.rating ? `<span class="stars">${'★'.repeat(i.rating)}<i>${'★'.repeat(5 - i.rating)}</i></span>` : ''}</div>${i.remark ? `<div class="small">${esc(i.remark)}</div>` : ''}${i.notes.map((n) => `<div class="small iv-note ${n.author_kind === 'client' ? 'by-client' : ''}"><b>${esc(n.author)}</b> <span class="faint">${fmtDT(n.at)}</span><div>${esc(n.text)}</div></div>`).join('')}</div>`).join('')}</div>` : ''}
      ${a.calls.length ? `<div class="hist-sub"><h4>Calls</h4><div class="stack-sm">${a.calls.map(callCard).join('')}</div></div>` : ''}
      <details class="hist-sub"><summary class="small">All steps (${a.steps.length})</summary><div class="hist" style="margin-top:6px">${a.steps.map((h) => `<div class="h"><span class="t">${fmtDT(h.at)}</span><span class="grow"><b>${esc(h.step || '')}</b> · ${esc(h.by || '')}${h.note ? ` — ${esc(h.note)}` : ''}</span></div>`).join('')}</div></details>
    </div>`).join('')}</div>`;
  };
  BB.panels.candidate = async (id) => {
    const c = await BB.api(`/api/candidates/${id}`);
    return {
      head: `<div class="row"><h2>${esc(c.name)}</h2><span class="mono faint">${esc(c.id)}</span><span class="badge ${c.status === 'Hired' ? 'b-green' : c.status.startsWith('In process') ? 'b-primary' : 'b-outline'}">${esc(c.status)}</span><span class="badge b-outline">${esc(c.looking)}</span>${c.opted_out ? '<span class="badge b-red">Opted out</span>' : ''}${c.is_new ? '<span class="badge b-gold">new</span>' : ''}${c.possible_repeat_of ? `<span class="badge b-amber">Possible repeat of ${esc(c.possible_repeat_of)}</span>` : ''}${c.needs_check ? `<span class="badge b-amber">${esc(c.needs_check)}</span>` : ''}</div><div class="small muted">${esc(c.job_wanted || '')} · ${esc(c.city || '')} · source ${esc(c.source || '—')}${c.ad_campaign || c.ad_set || c.ad_name ? ` · ad <b>${esc([c.ad_campaign, c.ad_set, c.ad_name].filter(Boolean).join(' › '))}</b>` : ''}${c.tieup ? ` · tie-up ${esc(c.tieup.name)}` : ''}</div>`,
      body: `<div class="seg panel-tabs"><button data-ctab="profile" class="on">Profile</button><button data-ctab="history">History · ${(c.track || []).length} application${(c.track || []).length === 1 ? '' : 's'}</button></div><div data-cpane="profile"><div class="row" style="margin-bottom:12px">${c.can_message || !c.phone_hidden ? waBtn({ ptype: 'candidate', pid: c.id }) : waBtn({ ptype: 'candidate', pid: c.id }, 'WhatsApp (number hidden)')}<button class="btn sm" data-chat>Open chat</button><button class="btn sm" data-profilepdf>Download profile</button>${canDelete() ? `<button class="btn sm danger" data-delrec="candidate" data-id="${c.id}">Delete</button>` : ''}<button class="btn sm primary" data-addjob>Add to a job</button>${!c.phone_hidden ? '<button class="btn sm" data-edit>Edit</button>' : ''}<button class="btn sm" data-shortcv>Make short CV</button>${c.possible_repeat_of ? '<button class="btn sm" data-merge>Merge…</button>' : ''}</div>
        <div class="card pad sec"><dl class="kv"><dt>WhatsApp</dt><dd class="mono">${esc(c.whatsapp)} ${c.phone_hidden ? '<span class="badge b-outline tiny">hidden: another agency\'s candidate</span>' : ''}</dd><dt>Email</dt><dd>${esc(c.email || '—')}</dd><dt>Will work in</dt><dd>${esc((c.work_cities || []).join(', ') || c.city || '—')}</dd><dt>Experience</dt><dd>${c.exp_total ?? '—'} years (jewellery ${c.exp_jewellery ?? '—'})</dd><dt>Worked in</dt><dd>${esc((c.exp_business || []).join(', ') || '—')}</dd><dt>Salary</dt><dd>now ${c.cur_salary ? inr(c.cur_salary / 12) + '/mo' : '—'} · expects ${c.exp_salary ? inr(c.exp_salary / 12) + '/mo' : '—'}</dd><dt>Notice</dt><dd>${c.notice_days ?? '—'} days</dd><dt>Current company</dt><dd>${esc(c.current_company || '—')}</dd><dt>Skills</dt><dd>${(c.skills || []).map((x) => `<span class="badge b-outline">${esc(x)}</span>`).join(' ') || '—'}</dd><dt>Interview rating</dt><dd>${c.rating ? `${'★'.repeat(Math.round(c.rating))} ${c.rating.toFixed(1)}` : '—'}</dd><dt>Agency / recruiter</dt><dd>${esc(c.agency_name || '—')} · ${esc(c.recruiter_name || '—')}</dd><dt>Last updated</dt><dd>${BB.daysAgo(c.last_updated || c.created_at)}</dd><dt>Referral link</dt><dd class="mono tiny">${esc(c.referral_link)}</dd></dl></div>
        <div class="sec"><h3>Applications on all jobs (${c.apps.length})</h3><div class="card tbl-wrap"><table class="tbl"><tbody>${c.apps.map((a) => `<tr class="click" data-open="application:${a.id}"><td class="mono">${a.id}</td><td>${esc(a.job_title)}<div class="tiny muted">${esc(a.client_name)}</div></td><td><span class="badge b-primary">${esc(a.step)}</span></td><td>${resultBadge(a.result)}</td></tr>`).join('') || '<tr><td class="empty">Not on any job yet.</td></tr>'}</tbody></table></div></div>
        <div class="sec"><h3>Matching open jobs <span class="faint small">· found automatically</span></h3><div class="card tbl-wrap"><table class="tbl"><tbody>${(c.job_matches || []).map((m) => `<tr><td>${scoreBadge(m.score)}</td><td><a href="#" data-open="job:${m.id}">${esc(m.title)}</a> <span class="mono faint">${esc(m.id)}</span><div class="tiny muted">${esc(m.client_name || '')} · ${esc(m.city || '')}</div>${whyMatch(m)}</td><td><button class="btn sm" data-addto="${m.id}">Add</button></td></tr>`).join('') || '<tr><td class="empty">No open job fits well right now.</td></tr>'}</tbody></table></div></div>
        <div class="sec"><h3>WhatsApp history</h3>${c.messages.length || c.can_message ? msgList(c.messages) : '<div class="faint small">Only the candidate\'s own agency sees their chat.</div>'}</div>
        ${filesBlock(c.id, c.files, c.phone_hidden ? null : [['cv', 'Full CV'], ['short_cv', 'Short CV'], ['file', 'Other']])}
        ${callsBlock(c.id, null, c.calls)}
        ${socialBlock(c)}
        ${notesBlock(c.id, c.notes)}
        <div class="sec"><h3>Consent</h3>${c.consents.map((x) => `<div class="small">${fmtDT(x.at)} · ${esc(x.what)} · <span class="faint">${esc(x.source)}</span></div>`).join('') || '<div class="faint small">No consent saved — they get a consent request before any job alert.</div>'}</div></div><div data-cpane="history" hidden>${historyPane(c)}</div>`,
      mount: (el) => {
        wireCommon(el);
        $('[data-chat]', el).onclick = () => { BB.closePanels(); BB.go(`team/whatsapp?t=candidate:${c.id}`); };
        $('[data-profilepdf]', el).onclick = () => BB.download(`/api/candidates/${c.id}/profile.pdf`);
        $$('[data-ctab]', el).forEach((b) => (b.onclick = () => { $$('[data-ctab]', el).forEach((x) => x.classList.toggle('on', x === b)); $$('[data-cpane]', el).forEach((p) => { p.hidden = p.dataset.cpane !== b.dataset.ctab; }); }));
        $$('[data-addto]', el).forEach((b) => (b.onclick = () => run(() => BB.post('/api/applications', { candidate_id: c.id, job_id: b.dataset.addto }), 'Added to the job — a new application')));
        $('[data-addjob]', el).onclick = () => BB.pickJob((jid) => run(() => BB.post('/api/applications', { candidate_id: c.id, job_id: jid }), 'Added to the job — a new application'), c.apps.filter((a) => a.result === 'open').map((a) => a.job_id));
        $('[data-shortcv]', el).onclick = () => run(() => BB.post(`/api/candidates/${c.id}/short-cv`), 'Short CV made (no phone or email)');
        const mg = $('[data-merge]', el); if (mg) mg.onclick = () => BB.mergeScreen('candidate', c.possible_repeat_of, c.id);
        const ed = $('[data-edit]', el); if (ed) ed.onclick = () => BB.ask({ title: `Edit ${c.id}`, wide: true, fields: [
          `<div class="grid g2">${field({ name: 'name', label: 'Name', value: c.name })}${field({ name: 'whatsapp', label: 'WhatsApp', value: c.whatsapp, phone: true })}</div>`,
          `<div class="grid g3">${field({ name: 'email', label: 'Email', value: c.email })}${field({ name: 'city', label: 'City', value: c.city, list: 'cities' })}${field({ name: 'work_cities', label: 'Will work in (comma separated)', value: (c.work_cities || []).join(', ') })}</div>`,
          `<div class="grid g3"><label class="field"><span class="lab">Job wanted</span><select name="job_wanted">${BB.jobOptions(c.job_wanted)}</select></label>${field({ name: 'exp_total', label: 'Experience (years)', type: 'number', value: c.exp_total ?? '' })}${field({ name: 'exp_jewellery', label: 'In jewellery', type: 'number', value: c.exp_jewellery ?? '' })}</div>`,
          `<div class="grid g3">${field({ name: 'cur', label: 'Current salary / month', type: 'number', value: c.cur_salary ? Math.round(c.cur_salary / 12) : '' })}${field({ name: 'exp', label: 'Expected salary / month', type: 'number', value: c.exp_salary ? Math.round(c.exp_salary / 12) : '' })}${field({ name: 'notice_days', label: 'Notice (days)', type: 'number', value: c.notice_days ?? '' })}</div>`,
          `<div class="grid g2">${field({ name: 'current_company', label: 'Current company', value: c.current_company || '' })}${field({ name: 'looking', label: 'Looking', type: 'select', options: BB.boot.looking, value: c.looking, placeholder: false })}</div>`,
          `<div class="grid g2">${field({ name: 'industry', label: 'Industry', type: 'select', options: BB.boot.industry_list || ['Jewellery'], value: c.industry || 'Jewellery', placeholder: false })}<div class="field"><span class="lab">Worked in</span><div class="row">${['Wholesaler', 'Manufacturer', 'Retailer'].map((x) => `<label class="row small"><input type="checkbox" name="biz_${x}" ${(c.exp_business || []).includes(x) ? 'checked' : ''}> ${x}</label>`).join('')}</div></div></div>`,
          { name: 'skills', label: 'Skills (comma separated)', value: (c.skills || []).join(', ') }, { name: 'archived', label: 'Archive', type: 'check', value: c.archived },
        ], submit: (v) => BB.patch(`/api/candidates/${c.id}`, { exp_business: ['Wholesaler', 'Manufacturer', 'Retailer'].filter((x) => v[`biz_${x}`]), industry: v.industry, name: v.name, whatsapp: v.whatsapp, email: v.email, city: v.city, work_cities: v.work_cities.split(',').map((x) => x.trim()).filter(Boolean), job_wanted: v.job_wanted, exp_total: v.exp_total === '' ? null : Number(v.exp_total), exp_jewellery: v.exp_jewellery === '' ? null : Number(v.exp_jewellery), cur_salary: v.cur === '' ? null : Number(v.cur) * 12, exp_salary: v.exp === '' ? null : Number(v.exp) * 12, notice_days: v.notice_days === '' ? null : Number(v.notice_days), current_company: v.current_company, looking: v.looking, skills: v.skills.split(',').map((x) => x.trim()).filter(Boolean), archived: v.archived ? 1 : 0 }) }).then((x) => x && after('Saved'));
      },
    };
  };

  // ---------- Person ----------
  BB.panels.person = async (id) => {
    const p = await BB.api(`/api/person/${id}`); const max = Math.max(1, ...p.activity.map((x) => x.n));
    return {
      head: `<div class="row"><h2>${esc(p.name)}</h2><span class="mono faint">${esc(p.id)}</span><span class="badge ${p.status === 'Active' ? 'b-green' : 'b-amber'}">${esc(p.status)}</span></div><div class="small muted">${BB.levelName(p.level)} · ${esc(p.agency_name || 'BrillBrains')} · last login ${fmtDT(p.last_login)}</div>`,
      body: `<div class="row" style="margin-bottom:12px">${waBtn({ ptype: 'user', pid: p.id, format: 'bbhs_team_task_alert' })}</div>
        <div class="grid g3 sec">${[['Added', p.added], ['Screened', p.screened], ['Interviews', p.interviews], ['Sent to client', p.sent], ['Offers', p.offers], ['Joined', p.joined]].map(([l, v]) => `<div class="card stat"><div class="l">${l} · 30 days</div><div class="v">${v}</div></div>`).join('')}</div>
        <div class="sec card pad"><h3 style="margin-bottom:24px">Activity, last 7 days</h3><div class="bars7">${p.activity.map((x) => `<div style="height:${(x.n / max) * 100}%" title="${x.n}"><span>${new Date(x.day).toLocaleDateString('en-IN', { weekday: 'short' })}</span></div>`).join('')}</div><div style="height:16px"></div></div>
        <div class="sec"><h3>Daily logs</h3><span class="dots7">${p.logs.map((l) => `<i class="${l.status === 'Approved' ? 'ok' : l.status ? 'sub' : ''}" title="${l.day}: ${l.status || 'missing'}"></i>`).join('')}</span> <span class="small muted">Target ${p.target}%</span></div>
        <div class="sec"><h3>Open applications they own (${p.apps.length})</h3><div class="card tbl-wrap"><table class="tbl"><tbody>${p.apps.map((a) => `<tr class="click" data-open="application:${a.id}"><td class="mono">${a.id}</td><td>${esc(a.candidate_name)}</td><td>${esc(a.job_title)}</td><td><span class="badge b-primary">${esc(a.step)}</span></td><td><span class="days ${a.days_in_step >= 7 ? 'late' : ''}">${a.days_in_step}d</span></td></tr>`).join('') || '<tr><td class="empty">None.</td></tr>'}</tbody></table></div></div>`,
    };
  };

  // ---------- Bill ----------
  BB.panels.bill = async (id) => {
    const b = await BB.api(`/api/bills/${id}`); const sup = isSuper();
    return {
      head: `<div class="row"><h2>${esc(b.bill_no || 'Draft bill')}</h2><span class="mono faint">${esc(b.id)}</span><span class="badge ${b.view_status === 'Paid' ? 'b-green' : b.view_status === 'Overdue' ? 'b-red' : b.view_status === 'Draft' ? 'b-outline' : 'b-amber'}">${esc(b.view_status)}</span>${b.is_replacement ? '<span class="badge b-gold">Replacement</span>' : ''}</div><div class="small muted"><a href="#" data-open="client:${b.client_id}">${esc(b.client.company)}</a> · <a href="#" data-open="application:${b.app_id}">${esc(b.app.candidate_name)} · ${esc(b.app.job_title)}</a></div>`,
      body: `<div class="row" style="margin-bottom:12px"><button class="btn sm" data-pdf>Invoice PDF</button>${b.status === 'Draft' ? '<button class="btn sm" data-editb>Edit draft</button><button class="btn sm primary" data-issue>Issue</button>' : ''}${b.status === 'Issued' && b.balance > 0 ? `${sup ? '<button class="btn sm primary" data-pay>Record payment</button>' : ''}${waBtn({ ptype: 'client', pid: b.client_id, bl: b.id, format: 'bbhs_payment_reminder' }, 'Payment reminder')}` : ''}${b.status !== 'Draft' ? waBtn({ ptype: 'client', pid: b.client_id, bl: b.id, format: 'bbhs_bill_raised' }, 'Send bill', 'btn sm') : ''}${sup && b.status !== 'Draft' && b.status !== 'Cancelled' ? '<button class="btn sm danger" data-credit>Credit note</button>' : ''}${sup && b.payout_status === 'Due' ? '<button class="btn sm gold" data-payout>Mark agency payout paid</button>' : ''}</div>
        <div class="card pad sec"><dl class="kv"><dt>Yearly CTC</dt><dd>${inr(b.ctc)}</dd><dt>Fee</dt><dd>${inr(b.fee)} <span class="faint small">${esc(b.fee_note)}</span></dd><dt>GST</dt><dd>${b.igst ? `IGST ${inr(b.igst)}` : `CGST ${inr(b.cgst)} + SGST ${inr(b.sgst)}`}</dd><dt>Total</dt><dd><b>${inr(b.total)}</b></dd><dt>Paid / TDS / credit</dt><dd>${inr(b.paid)} / ${inr(b.tds)} / ${inr(b.credit)}</dd><dt>Balance</dt><dd><b>${inr(b.balance)}</b></dd><dt>Bill date / due</dt><dd>${fmtD(b.issued_at || b.date)} / ${fmtD(b.due_date)}</dd>
          <dt>Agency</dt><dd>${esc(b.agency_name)}</dd><dt>Agency share</dt><dd>${inr(b.agency_share)} (${b.share_pct}%) · payout <b>${esc(b.payout_status)}</b>${b.payout_ref ? ` · ref ${esc(b.payout_ref)}` : ''}</dd>${sup ? `<dt>BrillBrains share</dt><dd>${inr(b.fee - b.agency_share)}</dd>` : ''}<dt>UPI link</dt><dd class="mono tiny">${esc(b.upi)}</dd></dl></div>
        <div class="sec"><h3>Payments</h3>${b.payments.map((p) => `<div class="small">${fmtD(p.date)} · <b>${inr(p.amount)}</b> · ${esc(p.mode)} · ${esc(p.ref)}${p.tds ? ` · TDS ${inr(p.tds)}` : ''} <span class="faint">by ${esc(p.by)}</span></div>`).join('') || '<div class="faint small">No payments yet.</div>'}</div>
        <div class="sec"><h3>Credit notes</h3>${b.credits.map((p) => `<div class="small">${fmtD(p.at)} · <b>−${inr(p.amount)}</b> · ${esc(p.reason)} <span class="faint">by ${esc(p.by)}</span></div>`).join('') || '<div class="faint small">None.</div>'}</div>
        <div class="sec"><button class="btn sm ghost" data-hist="${b.id}">History</button></div>`,
      mount: (el) => {
        wireCommon(el);
        const on = (sel, fn) => { const x = $(sel, el); if (x) x.onclick = fn; };
        on('[data-pdf]', () => BB.download(`/api/bills/${b.id}/pdf`, true));
        on('[data-issue]', async () => { if (await BB.confirm('Issue bill', 'Issued bills cannot be edited. The client gets the bill with the UPI link.', 'Issue')) run(() => BB.post(`/api/bills/${b.id}/issue`), 'Bill issued'); });
        on('[data-editb]', () => BB.ask({ title: 'Edit draft bill', fields: [{ name: 'ctc', label: 'Yearly CTC', type: 'number', value: b.ctc }, { name: 'fee', label: 'Fee (leave empty to work it out)', type: 'number', opt: true }], submit: (v) => BB.patch(`/api/bills/${b.id}`, v) }).then((x) => x && after('Saved')));
        on('[data-pay]', () => BB.ask({ title: 'Record payment', fields: [{ name: 'date', label: 'Date', type: 'date', value: BB.istDay() }, { name: 'amount', label: 'Amount received', type: 'number', value: Math.round(b.balance) }, { name: 'mode', label: 'Mode', type: 'select', options: ['UPI', 'Bank transfer', 'Cheque', 'Cash'], value: 'UPI' }, { name: 'ref', label: 'Reference number' }, { name: 'tds', label: 'TDS deducted by client', type: 'number', opt: true }], ok: 'Save payment', submit: (v) => BB.post(`/api/bills/${b.id}/payment`, v) }).then((x) => x && after('Payment saved')));
        on('[data-credit]', () => BB.ask({ title: 'Credit note', note: 'A minus bill linked to this one. To fix a mistake, tick "Make a new draft bill".', fields: [{ name: 'amount', label: 'Amount', type: 'number', value: Math.round(b.total) }, { name: 'reason', label: 'Reason' }, { name: 'reissue', label: 'Make a new draft bill', type: 'check' }], ok: 'Save', submit: (v) => BB.post(`/api/bills/${b.id}/credit`, v) }).then((x) => x && after('Credit note saved')));
        on('[data-payout]', () => BB.ask({ title: 'Agency payout paid', fields: [{ name: 'ref', label: 'Payment reference' }], ok: 'Mark paid', submit: (v) => BB.post('/api/bills/payouts', { ids: [b.id], ref: v.ref }) }).then((x) => x && after('Payout marked paid')));
      },
    };
  };

  // ---------- pickers, merge, new records ----------
  BB.pickCandidate = (cb, already = []) => {
    const m = BB.modal({ title: 'Add a candidate', foot: false, body: '<input placeholder="Search name, ID, phone or job…" data-q autofocus><div data-r class="stack-sm" style="margin-top:10px;max-height:360px;overflow:auto"></div>' });
    let t; const q = $('[data-q]', m.el);
    const go = async () => { const r = await BB.api(`/api/candidates?q=${encodeURIComponent(q.value)}`); $('[data-r]', m.el).innerHTML = r.rows.slice(0, 20).map((c) => already.includes(c.id) ? `<div class="fmt-chip" style="opacity:.55;cursor:default"><b>${esc(c.name)}</b> <span class="mono faint">${c.id}</span> <span class="badge b-outline tiny">Already on this job</span></div>` : `<button class="fmt-chip" data-c="${c.id}"><b>${esc(c.name)}</b> <span class="mono faint">${c.id}</span> · ${esc(c.job_wanted || '')} · ${esc(c.city || '')} <span class="badge b-outline tiny">${esc(c.status)}</span></button>`).join('') || '<div class="faint">No match.</div>'; $$('[data-c]', m.el).forEach((b) => (b.onclick = () => { m.close(); cb(b.dataset.c); })); };
    q.oninput = () => { clearTimeout(t); t = setTimeout(go, 200); }; go(); setTimeout(() => q.focus(), 30);
  };
  BB.pickJob = (cb, already = []) => {
    const m = BB.modal({ title: 'Add to a job', foot: false, body: '<input placeholder="Search job, client or ID…" data-q><div data-r class="stack-sm" style="margin-top:10px;max-height:360px;overflow:auto"></div>' });
    let t; const q = $('[data-q]', m.el);
    const go = async () => { const r = await BB.api(`/api/jobs?status=All&q=${encodeURIComponent(q.value)}`); $('[data-r]', m.el).innerHTML = r.rows.filter((j) => !['Filled', 'Closed'].includes(j.status)).map((j) => already.includes(j.id) ? `<div class="fmt-chip" style="opacity:.55;cursor:default"><b>${esc(j.title)}</b> <span class="mono faint">${j.id}</span> · ${esc(j.client_name)} <span class="badge b-outline tiny">Already on this job</span></div>` : `<button class="fmt-chip" data-j="${j.id}"><b>${esc(j.title)}</b> <span class="mono faint">${j.id}</span> · ${esc(j.client_name)} · ${esc(j.city)} ${statusBadge(j.status)}</button>`).join('') || '<div class="faint">No job openings that are still hiring.</div>'; $$('[data-j]', m.el).forEach((b) => (b.onclick = () => { m.close(); cb(b.dataset.j); })); };
    q.oninput = () => { clearTimeout(t); t = setTimeout(go, 200); }; go(); setTimeout(() => q.focus(), 30);
  };
  BB.mergeScreen = async (type, a, b) => {
    const r = await BB.api(`/api/merge/${type}/${a}/${b}`).catch(BB.fail); if (!r) return;
    const keys = type === 'client' ? ['company', 'contact', 'whatsapp', 'email', 'city', 'business_type', 'stage'] : ['name', 'whatsapp', 'email', 'city', 'job_wanted', 'exp_total', 'exp_salary', 'notice_days', 'current_company'];
    BB.modal({ title: 'Merge two records', wide: true, body: `<p class="small muted" style="margin-top:0">The kept record keeps its ID. The other ID points to it forever. Applications, interviews, messages and files move to the kept record.</p>
      <div class="row" style="margin-bottom:10px"><b>Keep:</b><label class="row"><input type="radio" name="keep" value="a" checked> ${esc(r.a.id)}</label><label class="row"><input type="radio" name="keep" value="b"> ${esc(r.b.id)}</label></div>
      <table class="tbl"><thead><tr><th>Field</th><th>${esc(r.a.id)}</th><th>${esc(r.b.id)}</th></tr></thead><tbody>${keys.map((k) => `<tr><td class="muted">${k.replace(/_/g, ' ')}</td><td><label class="row"><input type="radio" name="f_${k}" value="a" checked> ${esc(r.a[k] ?? '—')}</label></td><td><label class="row"><input type="radio" name="f_${k}" value="b"> ${esc(r.b[k] ?? '—')}</label></td></tr>`).join('')}</tbody></table>`,
      foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" data-m>Merge</button>',
      onMount: (el, close) => { $('[data-c]', el).onclick = close; $('[data-m]', el).onclick = async () => {
        const keepA = $('[name=keep]:checked', el).value === 'a'; const keep = keepA ? r.a.id : r.b.id; const drop = keepA ? r.b.id : r.a.id;
        const chosen = {}; for (const k of keys) { const pick = $(`[name=f_${k}]:checked`, el).value; chosen[k] = (pick === 'a') === keepA ? 'keep' : 'drop'; }
        try { await BB.post('/api/merge', { type, keep, drop, chosen }); close(); BB.closePanels(); BB.toast(`Merged into ${keep}`); BB.open(type, keep); BB.refreshPage && BB.refreshPage(); } catch (e) { BB.fail(e); }
      }; } });
  };
  BB.newJob = (clientId) => BB.ask({ title: 'New job opening', wide: true, fields: [
    `<div class="grid g2"><label class="field" data-f="client_id"><span class="lab">Client</span><select name="client_id" data-clients><option value="${esc(clientId || '')}">${esc(clientId || 'Loading…')}</option></select></label><label class="field" data-f="title"><span class="lab">Job</span><select name="title">${BB.jobOptions('')}</select></label></div>`,
    `<div class="grid g3">${field({ name: 'city', label: 'City', list: 'cities' })}${field({ name: 'openings', label: 'Openings', type: 'number', value: 1 })}${field({ name: 'priority', label: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'], value: 'Medium', placeholder: false })}</div>`,
    `<div class="grid g4">${field({ name: 'sal_from', label: 'Salary from / month', type: 'number' })}${field({ name: 'sal_to', label: 'Salary to / month', type: 'number' })}${field({ name: 'exp_from', label: 'Exp from (yrs)', type: 'number' })}${field({ name: 'exp_to', label: 'Exp to (yrs)', type: 'number' })}</div>`,
    `<div class="grid g2">${field({ name: 'notice_days', label: 'Join within (days)', type: 'number' })}${field({ name: 'skills', label: 'Skills (comma separated)' })}</div>`,
    { name: 'jd_approved', label: 'Job description already approved (job goes Open; otherwise Draft)', type: 'check' },
  ], ok: 'Create job opening', submit: (v) => BB.post('/api/jobs', { ...v, salary_per: 'month', skills: v.skills.split(',').map((x) => x.trim()).filter(Boolean) }),
  extra: '' }).then((x) => { if (x) { BB.toast(`${x.id} made`); BB.refreshPage && BB.refreshPage(); BB.open('job', x.id); } }) && setTimeout(async () => {
    const sel = $('[data-clients]'); if (!sel) return; const r = await BB.api('/api/clients?all=1'); const all = r.rows;
    sel.innerHTML = `<option value="">Choose…</option><option value="INTERNAL">BrillBrains — internal hiring (our own team)</option><option value="TBC">Client not decided yet (fill in later)</option>${all.filter((c) => !c.placeholder).map((c) => `<option value="${c.id}" ${c.id === clientId ? 'selected' : ''}>${esc(c.company)} (${c.id})</option>`).join('')}`;
    const city = $('[name=city]'); const title = $('.modal [name=title]');
    sel.onchange = () => { const c = all.find((x) => x.id === sel.value); if (!c) return; if (city && !city.value) city.value = c.city; if (title) title.innerHTML = BB.jobOptions(title.value, true, c.industry); }; sel.onchange();
  }, 50);
})();
