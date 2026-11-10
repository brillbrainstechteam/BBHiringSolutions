/* Vendors › Job portals: quotes, subscription, payments, and what each portal brought (from candidate sources). */
(() => {
  const { $, $$, esc, fmtD, field, inr } = BB;
  const ST = { Evaluating: 'b-outline', 'Quote received': 'b-amber', Active: 'b-green', Paused: 'b-outline', Ended: 'b-red' };
  const VERDICT = { Good: 'b-green', Average: 'b-amber', Poor: 'b-red' };
  const rs = (n) => (n === null || n === undefined ? '—' : inr(n));
  const x = (n) => (n === null || n === undefined ? '—' : `${n}×`);
  const pickFile = async () => { const f = await BB.pickFile('.pdf,.jpg,.jpeg,.png,.doc,.docx'); return f ? { name: f.name, base64: f.base64, mime: f.type || f.mime } : null; };
  const fileBtn = (id) => (id ? `<button type="button" class="btn sm ghost" data-file="${esc(id)}">File</button>` : '');
  const wireFiles = (root) => $$('[data-file]', root).forEach((b) => (b.onclick = () => BB.openFile(b.dataset.file)));

  const form = (p, meta) => BB.ask({ title: p ? `Edit ${esc(p.name)}` : 'Add job portal', ok: p ? 'Save' : 'Add', fields: [
    `<div class="grid g2">${field({ name: 'name', label: 'Portal', value: p ? p.name : '', placeholder: 'e.g. Naukri' })}${field({ name: 'website', label: 'Website', value: p ? p.website : '', opt: true, voice: false })}</div>`,
    `<div class="grid g2">${field({ name: 'kind', label: 'What it gives', type: 'select', options: meta.kinds, value: p ? p.kind : meta.kinds[0], placeholder: false })}${field({ name: 'status', label: 'Status', type: 'select', options: meta.statuses, value: p ? p.status : 'Evaluating', placeholder: false })}</div>`,
    `<div class="grid g2">${field({ name: 'source_name', label: 'Candidate source', value: p ? p.source_name : '', opt: true, list: 'pt-sources', hint: 'Candidates with this source count for this portal' })}${field({ name: 'login_holder', label: 'Login held by', value: p ? p.login_holder : '', opt: true })}</div><datalist id="pt-sources">${(meta.sources || []).map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`,
    { name: 'good_for', label: 'Good for (roles, cities)', value: p ? p.good_for : '', opt: true }, { name: 'note', label: 'Note', type: 'textarea', value: p ? p.note : '', opt: true }],
  submit: (v) => BB.post('/api/portals', { ...v, id: p ? p.id : undefined }) });

  BB.portals = async ({ el, actions, tabs }) => {
    const d = await BB.api('/api/portals');
    actions.innerHTML = '<button class="btn primary" data-padd>+ Add portal</button>';
    $('[data-padd]', actions).onclick = () => form(null, d).then((r) => r && (BB.toast('Portal added'), BB.refreshPage()));
    const max = Math.max(1, ...d.rows.map((p) => Math.max(p.results.spend, p.results.fees)));
    el.innerHTML = `${tabs}
      ${d.rows.some((p) => p.results.spend) ? `<section class="card pad pt-compare"><h3 class="dsec-h">Spend vs fees earned</h3><div class="pt-bars">${d.rows.filter((p) => p.results.spend || p.results.fees).sort((a, b) => (b.results.return_x || 0) - (a.results.return_x || 0)).map((p) => `<button type="button" class="pt-bar" data-popen="${p.id}"><span class="pt-bar-l">${esc(p.name)}</span><span class="pt-bar-t"><i class="sp" style="width:${(p.results.spend / max) * 100}%"></i><i class="fe" style="width:${(p.results.fees / max) * 100}%"></i></span><span class="pt-bar-v">${x(p.results.return_x)}</span></button>`).join('')}</div><div class="pt-key tiny muted"><span class="sw sp"></span>Spend <span class="sw fe"></span>Fees earned</div></section>` : ''}
      <div class="card">${BB.table([
        { t: 'Portal', f: (p) => `<b>${esc(p.name)}</b><div class="tiny muted">${esc(p.kind)}</div>` },
        { t: 'Status', f: (p) => `<span class="badge ${ST[p.status] || 'b-outline'} tiny">${esc(p.status)}</span>${p.idle ? ' <span class="badge b-red tiny" title="Under 3 candidates in 30 days">Low use</span>' : ''}` },
        { t: 'Plan', f: (p) => (p.sub ? `<div class="small">${esc(p.sub.plan)}</div><div class="tiny ${p.sub.days_left !== null && p.sub.days_left <= 15 && p.sub.days_left >= 0 ? 'v-due' : 'muted'}">${p.sub.days_left < 0 ? `Ended ${fmtD(p.sub.end)}` : `Renews ${fmtD(p.sub.end)}${p.sub.days_left <= 15 ? ` · ${p.sub.days_left}d` : ''}`}</div>` : '<span class="faint">—</span>') },
        { t: 'Paid this FY', num: 1, f: (p) => rs(p.paid_year) },
        { t: 'Candidates', num: 1, f: (p) => p.results.found },
        { t: 'Hired', num: 1, f: (p) => p.results.hired },
        { t: 'Cost / hire', num: 1, f: (p) => rs(p.results.per_hire) },
        { t: 'Return', num: 1, f: (p) => `${x(p.results.return_x)}${p.results.verdict ? ` <span class="badge ${VERDICT[p.results.verdict]} tiny">${p.results.verdict}</span>` : ''}` },
      ], d.rows, { open: (p) => `portal:${p.id}`, empty: 'No portals yet.' })}</div>
      <div class="tiny muted" style="margin-top:6px">Return = fees earned ÷ spend · Good from ${d.rating.good}× · Poor under ${d.rating.poor}×</div>`;
    $$('[data-popen]', el).forEach((b) => (b.onclick = () => BB.open('portal', b.dataset.popen)));
  };

  // ---------- one portal (side panel) ----------
  const TABS = [['results', 'Results'], ['quotes', 'Quotes'], ['pay', 'Subscription & payments'], ['details', 'Details']];
  BB.portalPanel = async (id) => {
    const tab = BB.portalTab || 'results'; const per = BB.portalPer || 'sub';
    const d = await BB.api(`/api/portals/${id}?period=${per === 'all' ? 'all' : 'sub'}`); const r = d.res; const s = d.sub;
    const funnel = [['Found', r.found], ['Put on a job', r.relevant], ['Sent to client', r.sent], ['Interviewed', r.interviewed], ['Hired', r.hired]]; const fmax = Math.max(1, r.found);
    const body = {
      results: `<div class="row between" style="margin-bottom:10px"><div class="seg">${[['sub', 'This subscription'], ['all', 'All time']].map(([k, l]) => `<button data-per="${k}" class="${d.period === k ? 'on' : ''}" ${k === 'sub' && !s ? 'disabled' : ''}>${l}</button>`).join('')}</div>${r.verdict ? `<span class="badge ${VERDICT[r.verdict]}">${r.verdict}</span>` : ''}</div>
        ${d.period === 'sub' && s ? `<div class="tiny muted" style="margin:-4px 0 10px">${fmtD(s.start)} – ${fmtD(s.end)}</div>` : ''}
        <div class="pt-funnel">${funnel.map(([l, n]) => `<div class="pt-f"><span class="pt-f-l">${l}</span><span class="pt-f-t"><i style="width:${n ? Math.max(3, (n / fmax) * 100) : 0}%"></i></span><b>${n}</b></div>`).join('')}</div>
        <dl class="kv pt-kv"><dt>Spend</dt><dd>${rs(r.spend)}</dd><dt>Fees earned</dt><dd>${rs(r.fees)}</dd><dt>Return</dt><dd>${x(r.return_x)}</dd><dt>Per candidate</dt><dd>${rs(r.per_candidate)}</dd><dt>Per interview</dt><dd>${rs(r.per_interview)}</dd><dt>Per hire</dt><dd>${rs(r.per_hire)}</dd>
        ${s && s.credits ? `<dt>Credits used</dt><dd>${s.credits_used} of ${s.credits} <button class="btn sm ghost" data-usage>+ Log</button></dd>` : ''}</dl>
        ${!r.found ? `<div class="small muted">No candidates with source “${esc(d.source_name || d.name)}” yet.</div>` : `<a class="small" href="/team/candidates?source=${encodeURIComponent(d.source_name || d.name)}" data-tlink>See the candidates →</a>`}`,
      quotes: `<div class="row between"><span></span><button class="btn sm primary" data-qadd>+ Add quote</button></div>
        <div class="pt-list">${d.quotes.map((q) => `<div class="pt-row ${q.taken ? 'taken' : ''}"><div class="grow"><b>${esc(q.plan)}</b> · ${rs(q.price)}${q.gst ? ` + GST ${rs(q.gst)}` : ''}${q.taken ? ' <span class="badge b-green tiny">Taken</span>' : ''}<div class="tiny muted">${fmtD(q.date)}${q.months ? ` · ${q.months} months` : ''}${q.credits ? ` · ${q.credits} credits` : ''}${q.valid_till ? ` · valid till ${fmtD(q.valid_till)}` : ''}${q.includes ? ` · ${esc(q.includes)}` : ''}</div></div>${fileBtn(q.file_id)}${q.taken ? '' : `<button class="btn sm" data-take="${q.id}">Take</button>`}<button class="btn sm ghost" data-rm="quote:${q.id}" aria-label="Remove">×</button></div>`).join('') || '<div class="small muted">No quotes yet.</div>'}</div>`,
      pay: `${s ? `<div class="pt-sub"><div class="grow"><b>${esc(s.plan)}</b> · ${rs(s.amount)} ${esc(s.frequency.toLowerCase())}${s.auto_renew ? ' · auto-renews' : ''}<div class="tiny muted">${fmtD(s.start)} – ${fmtD(s.end)}${s.credits ? ` · ${s.credits} credits` : ''}</div></div><button class="btn sm ghost" data-subedit>Edit</button></div>` : '<div class="small muted">No subscription yet. Take a quote, or add one.</div>'}
        <div class="row between" style="margin:12px 0 6px"><b class="small">Payments</b><span class="row" style="gap:6px">${s ? '' : '<button class="btn sm" data-subnew>+ Subscription</button>'}<button class="btn sm primary" data-payadd>+ Payment</button></span></div>
        <div class="pt-list">${d.payments.map((p) => `<div class="pt-row"><div class="grow"><b>${rs(p.amount)}</b><div class="tiny muted">${fmtD(p.date)}${p.ref ? ` · ${esc(p.ref)}` : ''}</div></div>${fileBtn(p.file_id)}<button class="btn sm ghost" data-rm="payment:${p.id}" aria-label="Remove">×</button></div>`).join('') || '<div class="small muted">No payments yet.</div>'}</div>`,
      details: `<dl class="kv"><dt>What it gives</dt><dd>${esc(d.kind)}</dd><dt>Candidate source</dt><dd>${esc(d.source_name || d.name)}</dd><dt>Website</dt><dd>${d.website ? `<a href="${esc(/^https?:/.test(d.website) ? d.website : `https://${d.website}`)}" target="_blank" rel="noopener">${esc(d.website)}</a>` : '—'}</dd><dt>Good for</dt><dd>${esc(d.good_for || '—')}</dd><dt>Login held by</dt><dd>${esc(d.login_holder || '—')}</dd><dt>Note</dt><dd>${esc(d.note || '—')}</dd></dl><button class="btn sm" data-pedit style="margin-top:10px">Edit</button>`,
    };
    return {
      head: `<div class="row"><h2>${esc(d.name)}</h2><span class="badge ${ST[d.status] || 'b-outline'}">${esc(d.status)}</span>${d.idle ? '<span class="badge b-red">Low use</span>' : ''}</div><div class="small muted">${esc(d.kind)}${s ? ` · ${esc(s.plan)} until ${fmtD(s.end)}` : ''}</div>`,
      body: `<div class="seg panel-tabs">${TABS.map(([k, l]) => `<button data-pt="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="card pad" style="margin-top:12px">${body[tab]}</div>`,
      mount: (el) => {
        const again = (msg) => { if (msg) BB.toast(msg); BB.refreshPanel(); if (BB.refreshPage) BB.refreshPage(); };
        const go = (p) => p.then((v) => v && again('Saved'));
        $$('[data-pt]', el).forEach((b) => (b.onclick = () => { BB.portalTab = b.dataset.pt; BB.refreshPanel(); }));
        $$('[data-per]', el).forEach((b) => (b.onclick = () => { BB.portalPer = b.dataset.per; BB.refreshPanel(); }));
        wireFiles(el);
        const subForm = (pre = {}, sub) => go(BB.ask({ title: sub ? 'Edit subscription' : 'Subscription', ok: 'Save', fields: [
          `<div class="grid g2">${field({ name: 'plan', label: 'Plan', value: pre.plan || '' })}${field({ name: 'amount', label: 'Amount (₹)', type: 'number', value: pre.amount ?? '' })}</div>`,
          `<div class="grid g3">${field({ name: 'start', label: 'Start', type: 'date', value: pre.start || BB.istDay() })}${field({ name: 'end', label: 'End', type: 'date', value: pre.end || '', opt: !!pre.months, hint: pre.months && !pre.end ? `Or leave it: ${pre.months} months from start` : '' })}${field({ name: 'frequency', label: 'Paid', type: 'select', options: d.freq, value: pre.frequency || 'Yearly', placeholder: false })}</div>`,
          `<div class="grid g2">${field({ name: 'credits', label: 'Credits (views / downloads)', type: 'number', value: pre.credits ?? '', opt: true })}${field({ name: 'auto_renew', label: 'Renews by itself', type: 'check', value: !!pre.auto_renew })}</div>`],
          submit: (v) => BB.post(`/api/portals/${d.id}/subs`, { ...v, id: sub ? sub.id : undefined, quote_id: pre.quote_id, months: pre.months }) }));
        const on = (sel, fn) => { const b = $(sel, el); if (b) b.onclick = fn; };
        on('[data-qadd]', async () => { let file = null; go(BB.ask({ title: 'Add quote', ok: 'Add', fields: [
          `<div class="grid g2">${field({ name: 'plan', label: 'Plan' })}${field({ name: 'date', label: 'Quote date', type: 'date', value: BB.istDay() })}</div>`,
          `<div class="grid g3">${field({ name: 'price', label: 'Price (₹)', type: 'number' })}${field({ name: 'gst', label: 'GST (₹)', type: 'number', opt: true })}${field({ name: 'months', label: 'Months', type: 'number', opt: true })}</div>`,
          `<div class="grid g2">${field({ name: 'credits', label: 'Credits', type: 'number', opt: true })}${field({ name: 'valid_till', label: 'Quote valid till', type: 'date', opt: true })}</div>`,
          { name: 'includes', label: 'Includes', opt: true, placeholder: 'e.g. 500 CV downloads, 10 job posts' }, '<button type="button" class="btn sm" data-qfile>Attach quote file</button> <span class="tiny muted" data-qfname></span>'],
          mount: (m) => { $('[data-qfile]', m).onclick = async () => { file = await pickFile(); if (file) $('[data-qfname]', m).textContent = file.name; }; },
          submit: (v) => BB.post(`/api/portals/${d.id}/quotes`, { ...v, file }) })); });
        $$('[data-take]', el).forEach((b) => (b.onclick = () => { const q = d.quotes.find((y) => String(y.id) === b.dataset.take); subForm({ plan: q.plan, amount: Math.round((q.price || 0) + (q.gst || 0)), credits: q.credits, months: q.months, quote_id: q.id }); }));
        on('[data-subnew]', () => subForm());
        on('[data-subedit]', () => subForm(s, s));
        on('[data-payadd]', () => { let file = null; go(BB.ask({ title: 'Add payment', ok: 'Add', fields: [
          `<div class="grid g2">${field({ name: 'amount', label: 'Amount (₹)', type: 'number', value: s ? s.amount : '' })}${field({ name: 'date', label: 'Paid on', type: 'date', value: BB.istDay() })}</div>`,
          { name: 'ref', label: 'Reference / invoice no.', opt: true }, '<button type="button" class="btn sm" data-pfile>Attach invoice</button> <span class="tiny muted" data-pfname></span>'],
          mount: (m) => { $('[data-pfile]', m).onclick = async () => { file = await pickFile(); if (file) $('[data-pfname]', m).textContent = file.name; }; },
          submit: (v) => BB.post(`/api/portals/${d.id}/payments`, { ...v, file }) })); });
        on('[data-usage]', () => go(BB.ask({ title: 'Credits used', ok: 'Add', fields: [`<div class="grid g2">${field({ name: 'credits', label: 'Credits', type: 'number' })}${field({ name: 'date', label: 'Date', type: 'date', value: BB.istDay() })}</div>`, { name: 'note', label: 'Note', opt: true }], submit: (v) => BB.post(`/api/portals/${d.id}/usage`, v) })));
        on('[data-pedit]', () => go(form(d, { ...d, sources: BB.boot.lead_sources })));
        $$('[data-rm]', el).forEach((b) => (b.onclick = async () => { const [kind, rid] = b.dataset.rm.split(':'); if (await BB.confirm('Remove?', '', 'Remove')) { try { await BB.post(`/api/portals/${d.id}/remove-row`, { kind, id: rid }); again('Removed'); } catch (e) { BB.fail(e); } } }));
      },
    };
  };
  BB.panels.portal = BB.portalPanel;
})();
