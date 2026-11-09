/* Partner institutes and colleges whose students make good candidates.
   Leads → Partners: search the web for them by type, course, place and distance (each search costs a few rupees).
   Every institute found is saved in Vendors (left menu, below Clients): the database where the team reaches out on
   WhatsApp, runs the follow-up sequence and keeps each vendor's status. */
(() => {
  const { $, $$, esc, fmtD, field } = BB;
  const ST_CLS = { New: 'b-outline', Contacted: 'b-primary', Interested: 'b-teal', 'Meeting fixed': 'b-amber', Partner: 'b-green', 'Not interested': 'b-red', 'Not relevant': 'b-red' };
  const waIcon = () => (BB.icon ? BB.icon('chat') : '');

  // ---------- shared bits ----------
  const contactCell = (p) => `${p.contact_name ? `<div class="small"><b>${esc(p.contact_name)}</b></div>` : ''}${p.wa ? `<div class="small mono">${esc(p.wa)} <span class="badge b-green tiny">WhatsApp</span></div>` : p.phone ? `<div class="small mono">${esc(p.phone)}</div>` : ''}${p.email ? `<div class="tiny muted">${esc(p.email)}</div>` : ''}${!p.wa && !p.phone && !p.email ? '<span class="faint">—</span>' : ''}`;
  const whereCell = (p) => `${esc([p.area, p.city].filter(Boolean).join(', ') || '—')}${p.distance_km != null ? `<div class="tiny muted">~${Math.round(p.distance_km)} km</div>` : ''}`;
  const nameCell = (p) => `<b>${esc(p.name)}</b><div class="tiny muted">${esc(p.type || '')}</div>${p.website ? `<a class="tiny" href="${esc(p.website)}" target="_blank" rel="noopener">Website</a>` : ''}`;
  const followCell = (p) => {
    if (!p.seq_on) return p.last_contact_at ? `<span class="tiny muted">Last contact ${BB.daysAgo(p.last_contact_at)}</span>` : '<span class="faint">—</span>';
    const due = p.next_at && new Date(p.next_at) <= new Date();
    return `<div class="small">${esc(p.next_step || 'Next step')}</div><div class="tiny ${due ? 'v-due' : 'muted'}">${due ? 'Due now' : `On ${fmtD(p.next_at)}`}</div>`;
  };

  async function whatsapp(p, statuses, opts = {}) {
    if (!p.wa) {
      const v = await BB.ask({ title: `WhatsApp number · ${p.name}`, note: 'The 10-digit mobile number the institute uses on WhatsApp.', fields: [{ name: 'contact_name', label: 'Contact person', opt: true, value: p.contact_name || '' }, { name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true }], ok: 'Save', submit: (x) => BB.patch(`/api/partners/${p.id}`, x) });
      if (!v) return; p = { ...p, wa: true };
    }
    try {
      const r = await BB.post(`/api/partners/${p.id}/whatsapp`, opts);
      if (r.link) { window.open(r.link, '_blank', 'noopener'); BB.toast('WhatsApp opened with the message ready — press Send there. Follow-ups are set.'); } else BB.toast('WhatsApp sent from the business number. Follow-ups are set.');
      BB.refreshPage();
    } catch (e) { BB.fail(e); }
  }
  function edit(p) {
    BB.ask({ title: p.name, fields: [
      `<div class="grid g2">${field({ name: 'contact_name', label: 'Contact person', value: p.contact_name || '', opt: true })}${field({ name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true, value: p.whatsapp || '', opt: true })}</div>`,
      `<div class="grid g2">${field({ name: 'phone', label: 'Other phone', value: p.phone || '', opt: true, voice: false })}${field({ name: 'email', label: 'Email', value: p.email || '', opt: true, voice: false })}</div>`,
      { name: 'website', label: 'Website', value: p.website || '', opt: true, voice: false },
      { name: 'note', label: 'Note (who you spoke to, what was agreed)', type: 'textarea', value: p.note || '', opt: true }], ok: 'Save',
    submit: (v) => BB.patch(`/api/partners/${p.id}`, v) }).then((x) => x && (BB.toast('Saved'), BB.refreshPage()));
  }
  async function activity(p) {
    const d = await BB.api(`/api/partners/${p.id}/activity`);
    const ICON = { whatsapp: 'chat', status: 'flow', note: 'note', sequence: 'cal', task: 'check', skipped: 'eye', error: 'eye' };
    BB.modal({ title: `${p.name} · activity`, body: `${p.note ? `<div class="notice small" style="margin-bottom:10px"><b>Note:</b> ${esc(p.note)}</div>` : ''}<div class="v-acts">${d.rows.map((a) => `<div class="v-act"><span class="v-act-i">${BB.icon ? BB.icon(ICON[a.kind] || 'note') : ''}</span><div><div class="small">${esc(a.text)}</div><div class="tiny muted">${BB.fmtDT ? BB.fmtDT(a.at) : fmtD(a.at)} · ${esc(a.by || '')}</div></div></div>`).join('') || '<p class="small muted">Nothing yet. WhatsApp them or start follow-ups.</p>'}</div>` });
  }
  const addByHand = (types) => BB.ask({ title: 'Add a vendor', fields: [{ name: 'name', label: 'Name of the institute or college' }, { name: 'type', label: 'Type of institute', opt: true, list: 'ptypes2' }, `<datalist id="ptypes2">${(types || []).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`, { name: 'courses', label: 'Courses', opt: true }, `<div class="grid g3">${field({ name: 'area', label: 'Area', opt: true, voice: false })}${field({ name: 'city', label: 'City', opt: true, voice: false, list: 'cities' })}${field({ name: 'state', label: 'State', opt: true, voice: false })}</div>`, `<div class="grid g2">${field({ name: 'phone', label: 'Phone', opt: true, voice: false })}${field({ name: 'email', label: 'Email', opt: true, voice: false })}</div>`, { name: 'website', label: 'Website', opt: true, voice: false }], ok: 'Add', submit: (v) => BB.post('/api/partners', v) }).then((x) => x && (BB.toast('Added to Vendors'), BB.refreshPage()));

  // ---------- Leads → Partners: search, and what the last search found ----------
  BB.partners = async ({ el, q, tabs }) => {
    const sid = q.search || 'last';
    const d = await BB.api(`/api/partners?${BB.qs({ search: sid })}`);
    const search = d.can_search ? `<form class="card pad stack-sm" data-psearch style="margin-bottom:14px"><div class="row between"><h3 style="margin:0">Find institutes and colleges</h3><span class="small muted">About ₹${d.estimate.low}–${d.estimate.high} a search${d.spent_inr ? ` · ₹${d.spent_inr} spent so far` : ''}</span></div>
      <div class="grid g3"><label class="field"><span class="lab">Type of institute</span><input name="type" list="ptypes" placeholder="e.g. CAD / jewellery design institute"><datalist id="ptypes">${d.types.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label>${field({ name: 'course', label: 'Course or job they train for', opt: true, voice: false, placeholder: 'e.g. Jewellery CAD (Rhino, Matrix), gemmology' })}${field({ name: 'industry', label: 'Industry', value: 'Jewellery', voice: false })}</div>
      <div class="grid g4">${field({ name: 'state', label: 'State', voice: false, placeholder: 'e.g. Maharashtra' })}${field({ name: 'city', label: 'City', voice: false, list: 'cities', placeholder: 'e.g. Mumbai' })}${field({ name: 'area', label: 'Area', opt: true, voice: false, placeholder: 'e.g. Andheri' })}${field({ name: 'km', label: 'Within (km)', type: 'number', opt: true, voice: false, value: 25 })}</div>
      ${d.ai ? '' : '<div class="notice small">Search needs the OpenAI key on the server.</div>'}<div class="row"><button class="btn primary" ${d.ai ? '' : 'disabled'}>Search</button><span class="small muted">Everything found is saved in <a href="/team/vendors" data-tlink>Vendors</a>, ready for WhatsApp outreach and follow-ups.</span></div></form>`
      : '<div class="notice small" style="margin-bottom:14px">Searching for new institutes is for admins (each search is paid). The saved list is in <a href="/team/vendors" data-tlink>Vendors</a>.</div>';
    const cur = d.searches.find((x) => String(x.id) === String(sid === 'last' ? d.last_search : sid));
    const label = (x) => `${esc([x.query.type, x.query.course].filter(Boolean).join(', ') || 'Search')} · ${esc([x.query.area, x.query.city, x.query.state].filter(Boolean).join(', '))}${x.query.km ? ` · ${x.query.km} km` : ''}`;
    el.innerHTML = `${tabs}${search}
      <section class="card pad"><div class="row between" style="margin-bottom:8px"><h3 style="margin:0">${cur ? `Found in: ${label(cur)}` : 'Search results'} <span class="small muted">${cur ? `${fmtD(cur.at)} · ${cur.found} found, ${cur.added} new` : ''}</span></h3><a class="btn sm" href="/team/vendors" data-tlink>Open Vendors (${d.total})</a></div>
      ${BB.table([{ t: 'Institute', f: nameCell }, { t: 'Courses', f: (p) => `<div class="small" style="max-width:300px">${esc(p.courses || '—')}</div>${p.why ? `<div class="tiny muted">${esc(p.why)}</div>` : ''}` }, { t: 'Where', f: whereCell }, { t: 'Contact', f: contactCell }, { t: 'Status', f: (p) => `<span class="badge ${ST_CLS[p.status] || 'b-outline'}">${esc(p.status)}</span>` }, { t: '', f: (p) => `<button class="btn sm" data-pwa="${p.id}">${waIcon()} WhatsApp</button>` }], d.rows, { empty: cur ? 'Nothing new came back from this search (places already saved are not repeated).' : 'Run a search above. Results are saved in Vendors.' })}</section>
      ${d.searches.length ? `<details class="sec card pad" style="margin-top:14px"><summary><b>Past searches</b> <span class="muted">${d.searches.length}</span></summary><div class="stack-sm" style="margin-top:8px">${d.searches.map((x) => `<div class="small"><a href="#" data-psid="${x.id}">${fmtD(x.at)} · ${label(x)}</a> · ${x.found} found, ${x.added} new · <b>₹${x.cost_inr}</b> · ${esc(x.by)}</div>`).join('')}</div></details>` : ''}`;
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => BB.setQ({ tab: b.dataset.tab, status: '', pq: '', search: '' })));
    $$('[data-psid]', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); BB.setQ({ search: a.dataset.psid }); }));
    $$('[data-pwa]', el).forEach((b) => (b.onclick = () => whatsapp(d.rows.find((x) => String(x.id) === b.dataset.pwa), d.statuses)));
    const f = $('[data-psearch]', el); if (f) f.onsubmit = async (e) => {
      e.preventDefault(); const v = BB.formValues(f); const btn = $('button.primary', f);
      if (!(await BB.confirm('Search the web', `This search costs about ₹${d.estimate.low}–${d.estimate.high} on the OpenAI account. The exact amount shows when it finishes.`, 'Search'))) return;
      btn.disabled = true; btn.textContent = 'Searching… (up to a minute)';
      try { const r = await BB.post('/api/partners/search', v); BB.toast(`${r.found} found, ${r.added} new saved to Vendors · cost ₹${r.cost_inr}`); BB.setQ({ search: '' }); BB.refreshPage(); } catch (er) { BB.fail(er); btn.disabled = false; btn.textContent = 'Search'; }
    };
  };

  // ---------- Vendors page: the database ----------
  BB.vendors = async ({ el, actions, q }) => {
    const d = await BB.api(`/api/partners?${BB.qs({ status: q.status, q: q.pq, city: q.city, type: q.type, due: q.due, seq: q.seq })}`);
    actions.innerHTML = `<a class="btn" href="/team/leads?tab=partners" data-tlink>${BB.icon ? BB.icon('search') : ''} Find more</a><button class="btn primary" data-padd>+ Add vendor</button>`;
    $('[data-padd]', actions).onclick = () => addByHand(d.types);
    const st = q.status || '';
    const seqHow = d.sequence.map((s, i) => `<li><b>Day ${s.day}</b> · ${esc(s.label)}${s.kind === 'whatsapp' ? ` <span class="tiny ${d.wa_ready[s.format === 'bbhs_partner_followup' ? 'followup' : 'outreach'] ? 'v-ok' : 'muted'}">${d.wa_ready[s.format === 'bbhs_partner_followup' ? 'followup' : 'outreach'] ? 'goes from the business number' : 'a task for you to send (until Meta approves the message)'}</span>` : ' <span class="tiny muted">a task for the owner</span>'}${i === 0 ? '' : ''}</li>`).join('');
    el.innerHTML = `<div class="v-chips">${['', ...d.statuses].map((x) => `<button class="chip ${st === x && !q.due ? 'on' : ''}" data-pst="${esc(x)}">${x || 'All'} <span class="faint">${x ? d.counts[x] : d.total}</span></button>`).join('')}<button class="chip ${q.due ? 'on' : ''} ${d.due ? 'v-duechip' : ''}" data-pdue>Follow-up due <span class="faint">${d.due}</span></button></div>
      <div class="filters"><input placeholder="Search name, course, city, contact…" value="${esc(q.pq || '')}" data-pq>
        <select data-f="city"><option value="">All cities</option>${d.cities.map((c) => `<option ${q.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select data-f="type"><option value="">All types</option>${d.types_in.map((c) => `<option ${q.type === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select data-f="seq"><option value="">Follow-ups: any</option><option value="on" ${q.seq === 'on' ? 'selected' : ''}>Follow-ups running</option><option value="off" ${q.seq === 'off' ? 'selected' : ''}>Not running</option></select></div>
      <details class="card pad v-seq"><summary><b>Follow-up sequence</b> <span class="small muted">· starts when you WhatsApp a vendor or press Start follow-ups; stops when the status is Interested, Meeting fixed, Partner, Not interested or Not relevant</span></summary><ol class="small">${seqHow}</ol></details>
      <div class="card bulkbar bulk-card" data-vbar>${BB.bulkHead('vendor', 'data-selcount')}
        <button class="btn sm" data-vb="sequence">${waIcon()} Start follow-ups</button><button class="btn sm" data-vb="stop">Stop follow-ups</button>
        <select class="mini" data-vb-status><option value="">Set status…</option>${d.statuses.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
      <div class="card">${BB.table([{ t: 'Vendor', f: nameCell }, { t: 'Where', f: whereCell }, { t: 'Contact', f: contactCell },
        { t: 'Status', f: (p) => `<select class="mini v-st ${ST_CLS[p.status] || ''}" data-pstatus="${p.id}" onclick="event.stopPropagation()">${d.statuses.map((x) => `<option ${p.status === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` },
        { t: 'Follow-ups', f: followCell }, { t: 'Added', f: (p) => `<span class="tiny muted nw">${fmtD(p.at)}</span>` },
        { t: '', cls: 'v-actions', f: (p) => `<div class="row nowrap" style="gap:6px"><button class="btn sm" data-pwa="${p.id}" title="${p.last_contact_at ? 'Send the follow-up message' : 'Send the introduction message'}">${waIcon()} WhatsApp</button><button class="btn sm ghost" data-pedit="${p.id}">Edit</button><button class="btn sm ghost" data-pact="${p.id}">Activity</button></div>` }],
        d.rows, { select: true, scroll: true, empty: d.total ? 'No vendors match these filters.' : 'No vendors yet. Run a search in Leads → Partners, or add one by hand.' })}</div>`;
    const byId = (id) => d.rows.find((x) => String(x.id) === String(id));
    $$('[data-pst]', el).forEach((c) => (c.onclick = () => BB.setQ({ status: c.dataset.pst, due: '' })));
    $('[data-pdue]', el).onclick = () => BB.setQ({ due: q.due ? '' : '1', status: '' });
    let t; $('[data-pq]', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => BB.setQ({ pq: e.target.value }), 400); };
    $$('[data-f]', el).forEach((s) => (s.onchange = () => BB.setQ({ [s.dataset.f]: s.value })));
    $$('[data-pstatus]', el).forEach((s) => (s.onchange = () => BB.patch(`/api/partners/${s.dataset.pstatus}`, { status: s.value }).then(() => { BB.toast('Status saved'); BB.refreshPage(); }, (e) => BB.fail(e))));
    $$('[data-pwa]', el).forEach((b) => (b.onclick = () => whatsapp(byId(b.dataset.pwa), d.statuses)));
    $$('[data-pedit]', el).forEach((b) => (b.onclick = () => edit(byId(b.dataset.pedit))));
    $$('[data-pact]', el).forEach((b) => (b.onclick = () => activity(byId(b.dataset.pact))));
    const bar = $('[data-vbar]', el);
    const count = () => { const n = BB.selected(el).length; $('[data-selcount]', bar).textContent = BB.bulkCount('vendor', n); bar.classList.toggle('has-sel', n > 0); };
    BB.wireSelect(el, count);
    const run = async (action, value, msg) => {
      const ids = BB.selected(el); if (!ids.length) return BB.toast('Select some vendors first', true);
      try { const r = await BB.post('/api/partners/bulk', { ids, action, value }); BB.toast(`${msg} — ${r.done} of ${ids.length}${r.skipped.length ? ` (${r.skipped.length} skipped: ${[...new Set(r.skipped.map((x) => x.reason))].join(', ')})` : ''}`); BB.refreshPage(); } catch (e) { BB.fail(e); }
    };
    $$('[data-vb]', bar).forEach((b) => (b.onclick = async () => {
      const n = BB.selected(el).length; if (!n) return BB.toast('Select some vendors first', true);
      if (b.dataset.vb === 'sequence') { if (await BB.confirm('Start follow-ups', `${n} vendor${n === 1 ? '' : 's'}: the WhatsApp introduction goes now${d.wa_ready.outreach ? ' from the business number' : ' (as a task for you, until Meta approves the message)'}, then the calls and follow-up message on their days.`, 'Start')) run('sequence', null, 'Follow-ups started'); }
      else run('stop', null, 'Follow-ups stopped');
    }));
    const ss = $('[data-vb-status]', bar); ss.onchange = () => { const v = ss.value; ss.value = ''; if (v) run('status', v, `Marked ${v}`); };
  };
})();
