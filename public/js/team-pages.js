/* Team portal pages (6.5). */
(() => {
  const { $, $$, esc, inr, fmtD, fmtDT, fmtT, field, statusBadge, scoreBadge, resultBadge, ticks, waIcon } = BB;
  const P = BB.pages;
  const isSuper = (me) => me.level === 'super';
  // Download buttons only for the super admin (the server refuses everyone else too).
  const dl = (path) => (BB.me && BB.me.user && BB.me.user.level === 'super' ? `<button class="btn sm" data-dl="${esc(path)}">Download</button>` : '');
  const wireDl = (root) => $$('[data-dl]', root).forEach((b) => (b.onclick = () => BB.download(b.dataset.dl)));
  const noId = (t) => String(t || '').replace(/\b(?:CL|CA|JB|AP|IV|BL)-\d+\s*/g, ''); // the ID stays behind the link, not in the words
  const STATUSES = ['Draft', 'Open', 'Sourcing', 'Interviewing', 'Offer stage', 'Filled', 'On hold', 'Closed'];
  const STATUS_KEY = { Closed: 'Team or client closed it', 'On hold': 'Paused by team or client', Filled: 'Accepted or joined ≥ openings — closes on its own', Draft: 'JD not approved and nobody on it', 'Offer stage': 'Someone is at Offer made', Interviewing: 'Someone at Our interview, Sent to client or Client interview', Sourcing: 'Candidates being screened', Open: 'Live, nobody in process right now' };

  // ---------- My day ----------
  P.myday = async ({ el }) => {
    const d = await BB.api('/api/myday');
    const ivRow = (i) => `<div class="attn"><span class="k">${fmtT(i.at)}</span><div class="grow"><a href="#" data-open="application:${i.app_id}">${esc(i.app.candidate_name)}</a> · ${esc(i.app.job_title)} <span class="badge ${i.round === 'ours' ? 'b-primary' : 'b-violet'}">${i.round === 'ours' ? 'our round' : 'client round'}</span> <span class="faint small">${esc(i.place)}</span></div>${BB.waBtn({ ptype: 'candidate', pid: i.app.candidate_id, ap: i.app_id, iv: i.id, format: 'bbhs_interview_reminder' }, 'Remind')}</div>`;
    el.innerHTML = `<div class="grid g2" style="align-items:start">
      <div class="card"><div class="card-h"><h3>My tasks</h3></div>${d.tasks.map((t) => `<div class="attn"><span class="k">${t.due_date ? fmtD(t.due_date) : esc(t.status)}</span><div class="grow"><a href="#" data-open="task:${t.id}">${esc(t.title)}</a></div></div>`).join('') || '<div class="empty">No tasks assigned to you.</div>'}</div>
      <div class="card"><div class="card-h"><h3>Today's interviews</h3></div>${d.interviews.map(ivRow).join('') || '<div class="empty">No interviews today.</div>'}</div>
      <div class="card"><div class="card-h"><h3>Results to record</h3></div>${d.pending.map((i) => `<div class="attn"><span class="k" style="color:var(--amber)">${fmtDT(i.at)}</span><div class="grow">${esc(i.app.candidate_name)} · ${esc(i.app.job_title)}</div><button class="btn sm primary" data-open="application:${i.app_id}">Record</button></div>`).join('') || '<div class="empty">All results recorded.</div>'}</div>
      <div class="card"><div class="card-h"><h3>Follow-ups due</h3></div>${d.followups.map((f) => `<div class="attn"><span class="k">${fmtDT(f.at)}</span><div class="grow">${esc(f.note)}</div><button class="btn sm" data-fdone="${f.id}">Done</button></div>`).join('') || '<div class="empty">No follow-ups.</div>'}</div>
      <div class="card"><div class="card-h"><h3>Stuck 7+ days</h3></div>${d.stuck.map((a) => `<div class="attn"><span class="k days late">${a.days_in_step} days</span><div class="grow"><a href="#" data-open="application:${a.id}">${esc(a.candidate_name)}</a> at ${esc(a.step)} · ${esc(a.job_title)}</div></div>`).join('') || '<div class="empty">Nothing stuck.</div>'}</div>
    </div>`;
    $$('[data-fdone]', el).forEach((b) => (b.onclick = async () => { await BB.post(`/api/followups/${b.dataset.fdone}/done`); BB.refreshPage(); }));
  };

  // ---------- Business health (super admin and admin dashboards) ----------
  // ₹ in lakh / crore so big sums stay readable; the exact figure on hover.
  const money = (n) => { n = Math.round(Number(n) || 0); const t = n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} L` : inr(n); return `<span title="${esc(inr(n))}">${t}</span>`; };
  const salRange = (j) => { if (j.no_salary) return '<span class="badge b-red tiny">Salary missing</span>'; const lo = Math.round((j.sal_from || j.sal_to) / 12); const hi = Math.round((j.sal_to || j.sal_from) / 12); return `${inr(lo)}${hi !== lo ? `–${inr(hi)}` : ''}/mo`; };
  const STAGE_LABEL = { Screening: 'Screening', Telephonic: 'Telephonic', Virtual: 'Virtual', Client: 'Client round', Offer: 'Offer' };
  const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const DASH_IC = {
    clients: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
    jobs: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>'),
    seats: svg('<path d="M7 11V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5"/><path d="M5 11h14v4H5z"/><path d="M7 15v5M17 15v5"/>'),
    apps: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
    closed: svg('<path d="m11 17 2 2a1.5 1.5 0 0 0 2-2"/><path d="m14 14 2.5 2.5a1.5 1.5 0 0 0 2-2l-3.9-3.9a2 2 0 0 0-2.8 0l-.9.9a1.5 1.5 0 0 1-2-2l2.8-2.8a3 3 0 0 1 3.6-.5l.6.3a3 3 0 0 0 2 .3L21 6"/><path d="m21 15-2 1"/><path d="M3 6l2.6.6a3 3 0 0 0 2-.3L9 5.5"/><path d="m3 15 6 5"/>'),
    received: svg('<path d="M6 4h12M6 9h12M9 4c6 0 6 9 0 9H6l8 8"/>'),
    pending: svg('<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 10 5 10 9s-10 4-10 9"/><path d="M17 3c0 5-10 5-10 9"/>'),
    growth: svg('<path d="M4 20h3v-5H4zM10.5 20h3v-8h-3zM17 20h3V9h-3z" fill="currentColor" stroke="none"/><path d="M4 11l6-5 4 3 6-6"/><path d="M15 3h5v5"/>', 2.4),
  };
  const PERIODS = [['', 'All time'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['fy', 'This financial year']];
  // ---------- Dashboard tables: search, filters, sorting, columns, selection, export and pages, all on the loaded data ----------
  const STAGE_IC = {
    Screening: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>'),
    Telephonic: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
    Virtual: svg('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>'),
    Client: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2c2.9.3 5 2.7 5 5.8"/>'),
    Offer: svg('<circle cx="12" cy="9" r="6"/><path d="m8.5 14 -1.5 7 5-3 5 3-1.5-7"/>'),
  };
  const tstore = { get: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } } };
  const csvDownload = (name, head, rows) => { const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const sortIc = (on, dir) => `<span class="dt-sort ${on ? 'on' : ''}">${on ? (dir > 0 ? '▲' : '▼') : '⇅'}</span>`;
  const pager = (st, total) => { const pages = Math.max(1, Math.ceil(total / st.per)); const from = total ? (st.page - 1) * st.per + 1 : 0; const to = Math.min(total, st.page * st.per);
    return `<div class="dt-foot"><label class="dt-per">Rows per page <select data-dtper>${[10, 25, 50].map((n) => `<option ${n === st.per ? 'selected' : ''}>${n}</option>`).join('')}</select></label><span class="dt-range">${from}–${to} of ${total}</span><span class="grow"></span>
      <button type="button" class="btn sm" data-dtpage="${st.page - 1}" ${st.page <= 1 ? 'disabled' : ''}>‹ Previous</button>${Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - st.page) <= 1).map((p, i, l) => `${i && p - l[i - 1] > 1 ? '<span class="dt-gap">…</span>' : ''}<button type="button" class="dt-pg ${p === st.page ? 'on' : ''}" data-dtpage="${p}">${p}</button>`).join('')}<button type="button" class="btn sm" data-dtpage="${st.page + 1}" ${st.page >= pages ? 'disabled' : ''}>Next ›</button></div>`; };
  const fitCtx = document.createElement('canvas').getContext('2d');
  const fitSelects = (root) => $$('.dt-sel select', root).forEach((sel) => { const cs = getComputedStyle(sel); fitCtx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const t = (sel.selectedOptions[0] || {}).text || ''; sel.style.width = `${Math.ceil(fitCtx.measureText(t).width) + 34}px`; });
  const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' }));

  // Agencies: search, agency filter, sort (menu or column), export, pages.
  const agencyTable = (box, h) => {
    const st = { q: '', ag: '', sort: 'name', dir: 1, page: 1, per: 10 };
    const cols = [['name', 'Agency'], ['clients', 'Clients', 1], ['open_jobs', 'Open jobs', 1], ['seats', 'Seats', 1], ['apps', 'Applications', 1], ['projected', 'Opportunity', 1], ['closed', 'Closed', 1], ['earned', 'Revenue', 1], ['received', 'Received', 1], ['pending', 'Pending', 1]];
    const SORTS = [['name:1', 'Agency (A–Z)'], ['name:-1', 'Agency (Z–A)'], ['projected:-1', 'Opportunity (high–low)'], ['open_jobs:-1', 'Open jobs (most)'], ['apps:-1', 'Applications (most)'], ['pending:-1', 'Pending (high–low)']];
    const rowsNow = () => h.agencies.filter((a) => (!st.ag || a.id === st.ag) && (!st.q || a.name.toLowerCase().includes(st.q.toLowerCase()))).sort((a, b) => cmp(a[st.sort], b[st.sort]) * st.dir);
    const draw = () => {
      const all = rowsNow(); const pages = Math.max(1, Math.ceil(all.length / st.per)); st.page = Math.min(st.page, pages); const rows = all.slice((st.page - 1) * st.per, st.page * st.per);
      box.innerHTML = `<div class="dt-bar"><label class="dt-search">${BB.icon('search')}<input placeholder="Search agencies…" value="${esc(st.q)}" data-dtq></label><span class="grow"></span>
        <label class="dt-sel">${svg('<path d="M3 5h18l-7 8v6l-4-2v-4z"/>')}<select data-dtag><option value="">All agencies</option>${h.agencies.map((a) => `<option value="${esc(a.id)}" ${st.ag === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <label class="dt-sel">${svg('<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>')}<select data-dtsort>${SORTS.map(([v, l]) => `<option value="${v}" ${`${st.sort}:${st.dir}` === v ? 'selected' : ''}>Sort: ${l}</option>`).join('')}${SORTS.some(([v]) => v === `${st.sort}:${st.dir}`) ? '' : `<option selected>Sort: column</option>`}</select></label>
        <span class="dt-vdiv"></span><button type="button" class="btn sm dt-btn" data-dtexport>${BB.icon('download')} Export</button></div>
        <div class="dt-wrap"><table class="tbl dt"><thead><tr>${cols.map(([k, t, num]) => `<th class="${num ? 'num' : ''}"><button type="button" class="dt-th" data-dtsortk="${k}">${t}${sortIc(st.sort === k, st.dir)}</button></th>`).join('')}</tr></thead>
        <tbody>${rows.map((a) => `<tr><td><a href="#" class="dt-link" data-hag="${esc(a.id)}">${esc(a.name)}</a></td><td class="num">${a.clients}</td><td class="num">${a.open_jobs}</td><td class="num">${a.seats}</td><td class="num">${a.apps}</td><td class="num"><b>${money(a.projected)}</b></td><td class="num">${a.closed}</td><td class="num">${money(a.earned)}</td><td class="num">${money(a.received)}</td><td class="num">${money(a.pending)}</td></tr>`).join('') || `<tr><td colspan="${cols.length}"><div class="dt-empty">No agencies match. <a href="#" data-dtreset>Reset filters</a></div></td></tr>`}</tbody></table></div>${pager(st, all.length)}`;
      const q = $('[data-dtq]', box); q.oninput = () => { st.q = q.value; st.page = 1; draw(); const n = $('[data-dtq]', box); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
      $('[data-dtag]', box).onchange = (e) => { st.ag = e.target.value; st.page = 1; draw(); };
      $('[data-dtsort]', box).onchange = (e) => { const [k, d] = e.target.value.split(':'); if (d) { st.sort = k; st.dir = Number(d); draw(); } };
      $$('[data-dtsortk]', box).forEach((b) => (b.onclick = () => { const k = b.dataset.dtsortk; st.dir = st.sort === k ? -st.dir : (k === 'name' ? 1 : -1); st.sort = k; draw(); }));
      $$('[data-dtpage]', box).forEach((b) => (b.onclick = () => { st.page = Number(b.dataset.dtpage); draw(); }));
      $('[data-dtper]', box).onchange = (e) => { st.per = Number(e.target.value); st.page = 1; draw(); };
      $('[data-dtexport]', box).onclick = () => csvDownload('agencies.csv', cols.map((c) => c[1]), rowsNow().map((a) => cols.map(([k]) => a[k])));
      const rs = $('[data-dtreset]', box); if (rs) rs.onclick = (e) => { e.preventDefault(); Object.assign(st, { q: '', ag: '', page: 1 }); draw(); };
      fitSelects(box);
      $$('[data-hag]', box).forEach((b) => (b.onclick = (e) => { e.preventDefault(); BB.setQ({ agency: b.dataset.hag }); }));
    };
    draw();
  };

  // Clients and their job openings: search, ticket and stage filters, sort, columns, ticks with bulk update, row menu, pages.
  const clientTable = (box, h, me, shared) => {
    const st = shared; // { q, ticket, stage, sort, dir, page, per, sel:Set, open:Set }
    const COLS = [['resp_days', 'Client response'], ['waiting', 'Waiting on client'], ['open_jobs', 'Open jobs'], ['seats', 'Seats'], ...h.stages.map((s) => [`st_${s}`, STAGE_LABEL[s] || s]), ['projected', 'Opportunity'], ['closed', 'Closed'], ['earned', 'Revenue'], ['received', 'Received'], ['pending', 'Pending']];
    const hidden = new Set(tstore.get('bb.dash.hidecols') || []);
    const val = (r, k) => (k === 'company' ? r.company : k === 'resp_days' ? (r.resp_days ?? 999) : k === 'waiting' ? r.waiting * 1000 + r.wait_oldest : k.startsWith('st_') ? r.stages[k.slice(3)] : r[k]);
    const SORTS = [['company:1', 'Client (A–Z)'], ['company:-1', 'Client (Z–A)'], ['resp_days:1', 'Fastest to respond'], ['resp_days:-1', 'Slowest to respond'], ['waiting:-1', 'Waiting on client (most)'], ['projected:-1', 'Opportunity (high–low)'], ['open_jobs:-1', 'Open jobs (most)'], ['seats:-1', 'Seats (most)'], ['pending:-1', 'Pending (high–low)']];
    const match = (r) => (!st.ticket || r.ticket === st.ticket) && (!st.stage || r.stages[st.stage] > 0) && (!st.resp || (st.resp === 'stuck' ? r.stuck : st.resp === 'waiting' ? r.waiting > 0 : r.response === st.resp))
      && (!st.q || [r.company, r.agency, ...r.jobs.map((j) => j.title)].join(' ').toLowerCase().includes(st.q.toLowerCase()));
    const rowsNow = () => h.clients.filter(match).sort((a, b) => cmp(val(a, st.sort), val(b, st.sort)) * st.dir);
    const n = (v, link) => (v ? `<a href="#" class="pipe-n" data-hgo="${esc(link)}"><b>${v}</b></a>` : '<span class="dt-zero">0</span>');
    const RESP_TIP = { Fast: 'Usually responds within 2 days', Average: 'Usually responds in 3–5 days', Slow: 'Usually takes more than 5 days', Waiting: 'No past replies yet; something is waiting on them' };
    const cell = (r, k) => {
      if (k === 'resp_days') return r.response ? `<span class="dt-resp ${r.response.toLowerCase()}" title="${esc(RESP_TIP[r.response] || '')}${r.resp_n ? ` · from ${r.resp_n} repl${r.resp_n === 1 ? 'y' : 'ies'} in the last 6 months` : ''}">${r.response}</span>${r.resp_days !== null ? `<div class="dt-sub">${r.resp_days < 1 ? 'same day' : `~${r.resp_days} day${r.resp_days === 1 ? '' : 's'}`}</div>` : ''}` : '<span class="dt-zero" title="Nothing sent to this client in the last 6 months">No data</span>';
      if (k === 'waiting') return r.waiting ? `<a href="#" class="pipe-n" data-hgo="${esc(BB.qs({ client: r.id, stage: 'Client' }))}"><b class="${r.stuck ? 'dt-stuck' : ''}">${r.waiting}</b></a><div class="dt-sub ${r.stuck ? 'dt-stuck' : ''}">oldest ${r.wait_oldest} day${r.wait_oldest === 1 ? '' : 's'}</div>` : '<span class="dt-zero">0</span>';
      if (k.startsWith('st_')) return n(r.stages[k.slice(3)], BB.qs({ client: r.id, stage: k.slice(3) }));
      if (['projected', 'earned', 'received'].includes(k)) return r[k] ? (k === 'projected' ? `<b>${money(r[k])}</b>` : money(r[k])) : '<span class="dt-zero">₹0</span>';
      if (k === 'pending') return r.pending ? `<span class="h-pend">${money(r.pending)}</span>` : '<span class="dt-zero">₹0</span>';
      if (k === 'open_jobs') return `${r.open_jobs || '<span class="dt-zero">0</span>'}${r.draft_jobs ? ` <span class="tiny muted">+${r.draft_jobs} draft</span>` : ''}`;
      return r[k] ? r[k] : '<span class="dt-zero">0</span>'; };
    const jcell = (j, k) => (k === 'resp_days' || k === 'waiting' ? '' : k.startsWith('st_') ? n(j.stages[k.slice(3)], BB.qs({ job: j.id, stage: k.slice(3) })) : k === 'projected' ? (j.projected ? `${money(j.projected)}<div class="tiny muted">${money(j.fee_each)} a seat</div>` : '<span class="dt-zero">—</span>') : k === 'open_jobs' ? `<span class="tiny muted">${j.openings} open${j.hired ? `, ${j.hired} joined` : ''}</span>` : k === 'seats' ? j.seats : '');
    const draw = () => {
      const cols = COLS.filter(([k]) => !hidden.has(k)); const all = rowsNow(); const pages = Math.max(1, Math.ceil(all.length / st.per)); st.page = Math.min(st.page, pages);
      const rows = all.slice((st.page - 1) * st.per, st.page * st.per); const allTicked = rows.length && rows.every((r) => st.sel.has(r.id));
      box.innerHTML = `<div class="dt-bar"><label class="dt-search">${BB.icon('search')}<input placeholder="Search clients or jobs…" value="${esc(st.q)}" data-dtq></label>
        <label class="dt-sel">${svg('<path d="M3 5h18l-7 8v6l-4-2v-4z"/>')}<select data-dtticket><option value="">Ticket type: All</option><option value="High" ${st.ticket === 'High' ? 'selected' : ''}>High ticket</option><option value="Low" ${st.ticket === 'Low' ? 'selected' : ''}>Low ticket</option></select></label>
        <label class="dt-sel">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}<select data-dtresp><option value="">Response: All</option>${[['Fast', 'Fast'], ['Average', 'Average'], ['Slow', 'Slow'], ['waiting', 'Waiting on client'], ['stuck', 'Stuck on client (5+ days)']].map(([v, l]) => `<option value="${v}" ${st.resp === v ? 'selected' : ''}>Response: ${l}</option>`).join('')}</select></label>
        <label class="dt-sel">${svg('<path d="M3 5h18l-7 8v6l-4-2v-4z"/>')}<select data-dtstage><option value="">Stage: All</option>${h.stages.map((s) => `<option value="${s}" ${st.stage === s ? 'selected' : ''}>${STAGE_LABEL[s] || s}</option>`).join('')}</select></label>
        <label class="dt-sel">${svg('<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>')}<select data-dtsort>${SORTS.map(([v, l]) => `<option value="${v}" ${`${st.sort}:${st.dir}` === v ? 'selected' : ''}>Sort: ${l}</option>`).join('')}${SORTS.some(([v]) => v === `${st.sort}:${st.dir}`) ? '' : '<option selected>Sort: column</option>'}</select></label>
        <span class="grow"></span>
        <details class="step-menu dt-cols"><summary class="btn sm dt-btn">${svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>')} Columns</summary><div class="step-pop right dt-colpop">${COLS.map(([k, t]) => `<label class="row small"><input type="checkbox" data-dtcol="${k}" ${hidden.has(k) ? '' : 'checked'}> ${esc(t)}</label>`).join('')}</div></details>
        <button type="button" class="btn sm dt-btn" data-dtexport>${BB.icon('download')} Export</button>
        <button type="button" class="btn sm dt-primary" data-dtbulk ${st.sel.size ? '' : 'disabled'}>${svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>')} Bulk update${st.sel.size ? ` (${st.sel.size})` : ''}</button></div>
        <div class="dt-wrap"><table class="tbl dt dt-cl"><thead><tr><th class="dt-ck"><input type="checkbox" data-dtall ${allTicked ? 'checked' : ''} aria-label="Tick all on this page"></th><th class="dt-tg"></th><th><button type="button" class="dt-th" data-dtsortk="company">Client${sortIc(st.sort === 'company', st.dir)}</button></th>${cols.map(([k, t]) => `<th class="num"><button type="button" class="dt-th" data-dtsortk="${k}">${esc(t)}${sortIc(st.sort === k, st.dir)}</button></th>`).join('')}<th class="dt-act">Actions</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="dt-row ${st.sel.has(r.id) ? 'ticked' : ''}"><td class="dt-ck"><input type="checkbox" data-dtck="${esc(r.id)}" ${st.sel.has(r.id) ? 'checked' : ''} aria-label="Tick ${esc(r.company)}"></td><td class="dt-tg"><button type="button" class="dt-tog ${st.open.has(r.id) ? 'open' : ''}" data-dttog="${esc(r.id)}" aria-label="Show job openings" ${r.jobs.length ? '' : 'disabled'}>▶</button></td>
          <td><div class="dt-client"><a href="#" class="dt-link" data-open="client:${esc(r.id)}">${esc(r.company)}</a><span class="dt-pill ${r.ticket === 'High' ? 'hi' : 'lo'}">${r.ticket} ticket</span></div>${isSuper(me) ? `<div class="dt-sub">${esc(r.agency)}</div>` : ''}</td>
          ${cols.map(([k]) => `<td class="num">${cell(r, k)}</td>`).join('')}
          <td class="dt-act"><details class="step-menu dt-more"><summary class="dt-dots" aria-label="Actions for ${esc(r.company)}" title="Actions">${svg('<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>', 0)}</summary><div class="step-pop right" role="menu"><button type="button" role="menuitem" data-open="client:${esc(r.id)}">Open client</button><button type="button" role="menuitem" data-dtnewjob="${esc(r.id)}">New job opening</button><button type="button" role="menuitem" data-hgo="${esc(BB.qs({ client: r.id }))}">See applications</button><button type="button" role="menuitem" data-dtjobs="${esc(r.id)}">See job openings</button></div></details></td></tr>
          ${st.open.has(r.id) ? r.jobs.map((j) => `<tr class="dt-job"><td></td><td></td><td><a href="#" data-open="job:${esc(j.id)}">${esc(j.title)}</a> <span class="tiny muted">${esc(j.city || '')} · ${esc(j.status || '')} · ${salRange(j)}</span></td>${cols.map(([k]) => `<td class="num">${jcell(j, k)}</td>`).join('')}<td class="dt-act"></td></tr>`).join('') : ''}`).join('')
          || `<tr><td colspan="${cols.length + 4}"><div class="dt-empty">No clients match these filters. <a href="#" data-dtreset>Reset filters</a></div></td></tr>`}</tbody></table></div>${pager(st, all.length)}`;
      const q = $('[data-dtq]', box); q.oninput = () => { st.q = q.value; st.page = 1; draw(); const x = $('[data-dtq]', box); x.focus(); x.setSelectionRange(x.value.length, x.value.length); };
      $('[data-dtticket]', box).onchange = (e) => { st.ticket = e.target.value; st.page = 1; draw(); };
      $('[data-dtresp]', box).onchange = (e) => { st.resp = e.target.value; st.page = 1; draw(); };
      $('[data-dtstage]', box).onchange = (e) => { st.stage = e.target.value; st.page = 1; st.onStage && st.onStage(); draw(); };
      $('[data-dtsort]', box).onchange = (e) => { const [k, d] = e.target.value.split(':'); if (d) { st.sort = k; st.dir = Number(d); draw(); } };
      $$('[data-dtsortk]', box).forEach((b) => (b.onclick = () => { const k = b.dataset.dtsortk; st.dir = st.sort === k ? -st.dir : (k === 'company' ? 1 : -1); st.sort = k; draw(); }));
      $$('[data-dtpage]', box).forEach((b) => (b.onclick = () => { st.page = Number(b.dataset.dtpage); draw(); }));
      $('[data-dtper]', box).onchange = (e) => { st.per = Number(e.target.value); st.page = 1; draw(); };
      $$('[data-dtcol]', box).forEach((c) => (c.onchange = () => { if (c.checked) hidden.delete(c.dataset.dtcol); else hidden.add(c.dataset.dtcol); tstore.set('bb.dash.hidecols', [...hidden]); draw(); $('.dt-cols', box).open = true; }));
      $$('[data-dtck]', box).forEach((c) => (c.onchange = () => { if (c.checked) st.sel.add(c.dataset.dtck); else st.sel.delete(c.dataset.dtck); draw(); }));
      $('[data-dtall]', box).onchange = (e) => { rows.forEach((r) => (e.target.checked ? st.sel.add(r.id) : st.sel.delete(r.id))); draw(); };
      $$('[data-dttog]', box).forEach((b) => (b.onclick = () => { const id = b.dataset.dttog; if (st.open.has(id)) st.open.delete(id); else st.open.add(id); draw(); }));
      $$('[data-dtjobs]', box).forEach((b) => (b.onclick = () => { st.open.add(b.dataset.dtjobs); draw(); }));
      $$('[data-dtnewjob]', box).forEach((b) => (b.onclick = () => BB.newJob(b.dataset.dtnewjob)));
      $$('[data-hgo]', box).forEach((b) => (b.onclick = (e) => { e.preventDefault(); BB.go(`team/applications?${b.dataset.hgo}`); }));
      const rs = $('[data-dtreset]', box); if (rs) rs.onclick = (e) => { e.preventDefault(); Object.assign(st, { q: '', ticket: '', stage: '', resp: '', page: 1 }); st.onStage && st.onStage(); draw(); };
      $('[data-dtexport]', box).onclick = () => csvDownload('clients-and-job-openings.csv', ['Client', 'Ticket', 'Agency', ...COLS.map((c) => c[1])], (st.sel.size ? rowsNow().filter((r) => st.sel.has(r.id)) : rowsNow()).map((r) => [r.company, r.ticket, r.agency, ...COLS.map(([k]) => val(r, k))]));
      $('[data-dtbulk]', box).onclick = () => bulk();
      fitSelects(box);
      box.onclick = (e) => $$('details.step-menu', box).forEach((d) => { if (!d.contains(e.target) || e.target.closest('[role=menuitem]')) d.open = false; });
    };
    const bulk = async () => {
      const ids = [...st.sel]; const people = await BB.api('/api/people').catch(() => []);
      const v = await BB.ask({ title: `Bulk update · ${ids.length} client${ids.length === 1 ? '' : 's'}`, fields: [
        { name: 'what', label: 'What to change', type: 'select', options: [['owner', 'Set the owner'], ...(isSuper(me) && h.agency_options ? [['agency', 'Assign to an agency']] : [])], value: 'owner', placeholder: false },
        { name: 'owner', label: 'Owner', type: 'select', options: people.map((p) => [p.id, p.name]), opt: true },
        ...(isSuper(me) && h.agency_options ? [{ name: 'agency_id', label: 'Agency', type: 'select', options: h.agency_options.map((a) => [a.id, a.name]), opt: true }] : [])], ok: 'Update',
        submit: async (x) => {
          if (x.what === 'agency') { if (!x.agency_id) { const e = new Error('Pick the agency'); e.field = 'agency_id'; throw e; } return BB.post('/api/leads/assign', { type: 'client', ids, agency_id: x.agency_id }); }
          if (!x.owner) { const e = new Error('Pick the owner'); e.field = 'owner'; throw e; }
          const fails = []; for (const id of ids) { try { await BB.post(`/api/clients/${id}/owners`, { owners: [x.owner] }); } catch (er) { fails.push(`${id}: ${er.message}`); } }
          return { fails };
        } });
      if (!v) return; if (v.fails && v.fails.length) BB.toast(`${ids.length - v.fails.length} updated · ${v.fails.length} not: ${v.fails[0]}`, true); else BB.toast(`${ids.length} client${ids.length === 1 ? '' : 's'} updated`);
      st.sel.clear(); BB.refreshPage();
    };
    st.redraw = draw; draw();
  };

  const healthView = (h, me, agq) => {
    const t = h.totals; const sc = (n, qs) => (n ? `<a href="#" class="pipe-n" data-hgo="${esc(qs)}">${n}</a>` : '<span class="faint">0</span>');
    const kpi = (ic, l, v, sub, tone, link) => `<a class="card kpi click t-${tone}" href="/team/${link}"><span class="kpi-ic">${DASH_IC[ic]}</span><span class="kpi-txt"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${sub ? `<span class="kpi-s">${sub}</span>` : ''}</span></a>`;
    const tick = (k, label, n, tone) => `<button type="button" class="h-tk ${tone || ''} ${h.ticket === k ? 'on' : ''}" data-hticket="${k}" aria-pressed="${h.ticket === k}">${label}${n !== undefined ? `<span class="h-tk-n">${n}</span>` : ''}</button>`;
    const mcard = (cls, ic, l, v, sub) => `<div class="card mcard ${cls}"><div class="m-head"><span class="m-ic">${DASH_IC[ic]}</span><span class="kpi-l">${l}</span></div><span class="m-v">${v}</span><span class="kpi-s">${sub}</span></div>`;
    const per = (PERIODS.find((p) => p[0] === (h.period || '')) || PERIODS[0])[1];
    const stTot = Math.max(1, ...h.stages.map((s) => t.stages[s]));
    const clientRow = (r) => `<tr class="h-cl" data-hcl="${esc(r.id)}"><td><button type="button" class="h-tog" aria-label="Show job openings">▸</button></td><td><a href="#" data-open="client:${esc(r.id)}"><b>${esc(r.company)}</b></a> <span class="badge ${r.ticket === 'High' ? 'b-gold' : 'b-outline'} tiny">${r.ticket} ticket</span>${h.agencies || isSuper(me) ? `<div class="tiny muted">${esc(r.agency)}</div>` : ''}</td>
      <td class="num">${r.open_jobs}${r.draft_jobs ? ` <span class="tiny muted">+${r.draft_jobs} draft</span>` : ''}</td><td class="num">${r.seats}</td>${h.stages.map((s) => `<td class="num">${sc(r.stages[s], BB.qs({ client: r.id, stage: s }))}</td>`).join('')}
      <td class="num"><b>${money(r.projected)}</b></td><td class="num">${r.closed}</td><td class="num">${money(r.earned)}</td><td class="num">${money(r.received)}</td><td class="num">${r.pending ? `<span class="h-pend">${money(r.pending)}</span>` : money(0)}</td></tr>
      ${r.jobs.map((j) => `<tr class="h-job" data-hof="${esc(r.id)}" hidden><td></td><td><a href="#" data-open="job:${esc(j.id)}">${esc(j.title)}</a> <span class="tiny muted">${esc(j.city || '')} · ${esc(j.status || '')} · ${salRange(j)}</span></td><td class="num tiny muted">${j.openings} open${j.hired ? `, ${j.hired} joined` : ''}</td><td class="num">${j.seats}</td>${h.stages.map((s) => `<td class="num">${sc(j.stages[s], BB.qs({ job: j.id, stage: s }))}</td>`).join('')}<td class="num">${j.projected ? money(j.projected) : '<span class="faint">—</span>'}${j.fee_each ? `<div class="tiny muted">${money(j.fee_each)} a seat</div>` : ''}</td><td colspan="4"></td></tr>`).join('')}`;
    return `<div class="health stack">
      <div class="card h-bar">
        <div class="h-group"><span class="h-lab">Clients</span><div class="h-tickets">${tick('', 'All', t.ticket_counts.High + t.ticket_counts.Low)}${tick('High', 'High ticket', t.ticket_counts.High, 'hi')}${tick('Low', 'Low ticket', t.ticket_counts.Low, 'lo')}</div></div>
        ${h.agency_options ? `<span class="h-div"></span><div class="h-group"><span class="h-lab">Agency</span><select data-dagency aria-label="Agency"><option value="">Overall</option><option value="none" ${agq === 'none' ? 'selected' : ''}>BrillBrains (own)</option>${h.agency_options.map((x) => `<option value="${esc(x.id)}" ${agq === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
        <span class="h-div"></span><div class="h-group h-rule"><span class="small muted">High ticket from ${money(h.high_from)}</span>${isSuper(me) ? '<a href="#" class="h-change" data-hfrom title="Clients whose fee (open opportunity plus earned) reaches this are High ticket">Change</a>' : ''}</div>
      </div>
      <div class="kpis">${kpi('clients', 'Clients with open requirements', t.clients_open, '', 'blue', 'clients')}${kpi('jobs', 'Open job openings', t.open_jobs, t.draft_jobs ? `${t.draft_jobs} more waiting for the JD` : '', 'violet', 'jobs?status=Active')}${kpi('seats', 'Seats to fill', t.seats, '', 'gold', 'jobs?status=Active')}${kpi('apps', 'Active applications', t.apps, '', 'green', 'applications')}</div>
      <div class="kpis money">
        <div class="card mcard m-opp"><span class="kpi-l">Revenue opportunity</span><span class="m-v">${money(t.projected)}</span><span class="m-split"><span>High ticket <b>${money(t.split.High)}</b></span><i></i><span>Low ticket <b>${money(t.split.Low)}</b></span></span><span class="m-art">${DASH_IC.growth}</span></div>
        ${mcard('m-won', 'closed', 'Positions closed', t.closed, `Revenue ${money(t.earned)}${h.period ? ` · ${per.toLowerCase()}` : ''}`)}
        ${mcard('m-got', 'received', 'Revenue received', money(t.received), t.earned ? `${Math.round((t.received / t.earned) * 100)}% of the revenue from closed positions` : 'Nothing closed yet')}
        ${mcard('m-pend', 'pending', 'Revenue pending', money(t.pending), 'Billed or to bill, not received yet')}
      </div>
      <section class="card dsec"><h3 class="dsec-h">Applications by stage</h3><div class="h-stages">${h.stages.map((s) => `<div role="button" tabindex="0" class="h-stage" data-hstage="${s}"><span class="h-stage-ic">${STAGE_IC[s] || ''}</span><span class="h-stage-t"><span>${STAGE_LABEL[s] || s}</span><b>${t.stages[s]}</b></span><a href="#" class="h-stage-go" data-hgo="${esc(BB.qs({ stage: s }))}" title="Open these applications" aria-label="Open ${STAGE_LABEL[s] || s} applications">↗</a></div>`).join('')}</div></section>
      ${h.no_salary.length ? `<div class="notice small">${h.no_salary.length} open job opening${h.no_salary.length === 1 ? ' has' : 's have'} no salary, so ${h.no_salary.length === 1 ? 'it is' : 'they are'} not in the revenue: ${h.no_salary.slice(0, 6).map((j) => `<a href="#" data-open="job:${esc(j.id)}">${esc(j.title)} (${esc(j.client)})</a>`).join(', ')}${h.no_salary.length > 6 ? ` and ${h.no_salary.length - 6} more` : ''}.</div>` : ''}
      ${h.agencies && h.agencies.length ? '<section class="card dsec"><h3 class="dsec-h">Agencies</h3><div data-agtbl></div></section>' : ''}
      <section class="card dsec"><h3 class="dsec-h">Clients and their job openings${(() => { const st2 = h.clients.filter((r) => r.stuck); const w = h.clients.reduce((n, r) => n + r.waiting, 0); return w ? `<span class="dsec-note ${st2.length ? 'warn' : ''}">${w} candidate${w === 1 ? '' : 's'} waiting on clients${st2.length ? ` · ${st2.length} client${st2.length === 1 ? '' : 's'} stuck 5+ days` : ''}</span>` : ''; })()}</h3>${h.clients.length ? '<div data-cltbl></div>' : '<div class="dt-empty">No clients with open requirements here.</div>'}</section>
      </div>`;
  };
  const healthQs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();
  const wireHealth = (el, h, me, agq) => {
    const box = $('.health', el);
    const load = async (ticket, agency, period) => {
      const u = new URL(location.href); for (const [k, v] of [['ticket', ticket], ['agency', agency], ['period', period]]) { if (v) u.searchParams.set(k, v); else u.searchParams.delete(k); } history.replaceState(history.state, '', u);
      box.classList.add('h-busy');
      try { const qs = healthQs({ agency, ticket, period }); const h2 = await BB.api(`/api/health${qs ? `?${qs}` : ''}`); const tmp = document.createElement('div'); tmp.innerHTML = healthView(h2, me, agency); box.replaceWith(tmp.firstElementChild); wireHealth(el, h2, me, agency); } catch (e) { box.classList.remove('h-busy'); BB.fail(e); }
    };
    BB.dashPeriod = (p) => load(h.ticket, agq, p);
    $$('[data-hticket]', el).forEach((b) => (b.onclick = () => { if (b.dataset.hticket !== h.ticket) load(b.dataset.hticket, agq, h.period); }));
    const dsel = $('[data-dagency]', box); if (dsel) dsel.onchange = () => BB.setQ({ agency: dsel.value });
    $$('[data-hag]', el).forEach((b) => (b.onclick = (e) => { e.preventDefault(); BB.setQ({ agency: b.dataset.hag }); }));
    $$('[data-hgo]', el).forEach((b) => (b.onclick = (e) => { e.preventDefault(); BB.go(`team/applications?${b.dataset.hgo}`); }));
    const cst = { q: '', ticket: '', stage: '', resp: '', sort: 'projected', dir: -1, page: 1, per: 10, sel: new Set(), open: new Set() };
    const markStage = () => $$('[data-hstage]', box).forEach((c) => c.classList.toggle('on', c.dataset.hstage === cst.stage));
    cst.onStage = markStage;
    const at = $('[data-agtbl]', box); if (at) agencyTable(at, h);
    const ct = $('[data-cltbl]', box); if (ct) clientTable(ct, h, me, cst);
    $$('[data-hstage]', box).forEach((c) => (c.onclick = (e) => { if (e.target.closest('[data-hgo]')) return; cst.stage = cst.stage === c.dataset.hstage ? '' : c.dataset.hstage; cst.page = 1; markStage(); if (cst.redraw) cst.redraw(); }));
    $$('.h-cl', el).forEach((tr) => { const tog = $('.h-tog', tr); tog.onclick = () => { const open = tr.classList.toggle('open'); tog.textContent = open ? '▾' : '▸'; $$(`[data-hof="${CSS.escape(tr.dataset.hcl)}"]`, el).forEach((x) => { x.hidden = !open; }); }; });
    const hf = $('[data-hfrom]', el); if (hf) hf.onclick = (e) => { e.preventDefault(); BB.ask({ title: 'High ticket clients', note: 'A client is High ticket when the fee they bring (open opportunity plus revenue from closed positions) reaches this amount.', fields: [{ name: 'high_from', label: 'High ticket from (₹ fee)', type: 'number', value: h.high_from, voice: false }], ok: 'Save', submit: (v) => BB.api('/api/settings/ticket', { method: 'PUT', body: { value: { high_from: Number(v.high_from) || 100000 } } }) }).then((x) => x && BB.refreshPage()); };
  };

  // ---------- Dashboard ----------
  // Super admin: the health of every agency's work. Admin: the same for their agency. Sub admin: their own day.
  P.dashboard = async ({ el, q, me, actions }) => {
    const agq = isSuper(me) && q.agency ? q.agency : ''; const sub = me.level === 'sub';
    const hq = healthQs({ agency: agq, ticket: q.ticket || '', period: q.period || '' });
    const [d, pl, td, h] = await Promise.all([BB.api(`/api/dashboard${agq ? `?agency=${encodeURIComponent(agq)}` : ''}`), sub ? BB.api('/api/pipeline?mine=1').catch(() => null) : null, BB.api('/api/today').catch(() => null), sub ? null : BB.api(`/api/health${hq ? `?${hq}` : ''}`)]); const c = d.counts;
    // Today: what to do now from everything I own, most urgent first; each line opens the record, the title the list.
    const tsec = td ? td.sections.filter((x) => x.count) : [];
    const today = td ? `<div class="card today"><div class="card-h"><h3>Today</h3><span class="small muted">${td.owned.clients} client${td.owned.clients === 1 ? '' : 's'} · ${td.owned.jobs} job${td.owned.jobs === 1 ? '' : 's'} · ${td.owned.applications} open application${td.owned.applications === 1 ? '' : 's'} owned by you</span></div>${tsec.length ? `<div class="today-grid">${tsec.map((x) => `<div class="today-sec"><div class="row between">${x.link ? `<a href="#" data-tlink="${esc(x.link)}"><b>${esc(x.title)}</b></a>` : `<b>${esc(x.title)}</b>`}<span class="badge b-primary">${x.count}</span></div>${x.items.map((i) => `<div class="today-item">${i.open ? `<a href="#" data-open="${i.open.type}:${esc(i.open.id)}">${esc(i.text)}</a>` : esc(i.text)}${i.when ? ` <span class="tiny muted">${fmtDT(i.when)}</span>` : ''}</div>`).join('')}${x.count > x.items.length ? `<div class="tiny muted">+${x.count - x.items.length} more</div>` : ''}</div>`).join('')}</div>` : '<div class="empty">Nothing waiting on you right now.</div>'}</div>` : '';
    const pcell = (n, job, st) => (n ? `<a href="#" class="pipe-n" data-pipe="${esc(BB.qs({ job, stage: st }))}">${n}</a>` : '<span class="faint">0</span>');
    const pipeline = pl && pl.rows.length ? `<div class="card"><div class="card-h"><h3>${me.level === 'super' ? 'Hiring pipeline' : 'My hiring pipeline'}</h3><span class="small muted">Open applications at each stage · click a number to work through them</span></div>${BB.table([{ t: 'Job', cls: 'pipe-job', f: (j) => `<b>${esc(j.title)}</b> ${j.priority === 'High' ? '<span class="badge b-red tiny">High</span>' : ''}<div class="tiny muted">${esc([j.client, j.city].filter(Boolean).join(' · '))}</div>` }, ...pl.stages.map((s) => ({ t: s, num: 1, f: (j) => pcell(j.counts[s], j.job_id, s) })), { t: 'All', num: 1, f: (j) => pcell(j.total, j.job_id, '') }], [{ title: 'All jobs', job_id: '', counts: pl.totals, total: Object.values(pl.totals).reduce((t, n) => t + n, 0), all: true }, ...pl.rows])}</div>` : '';
    const max = Math.max(1, ...Object.values(d.by_status));
    const kindColor = { 'Result not recorded': 'var(--amber)', 'Stuck 7+ days': 'var(--red)', 'At risk': 'var(--red)', 'No candidates': 'var(--blue)', 'Write job description': 'var(--violet)', 'Log missing': 'var(--amber)', 'Overdue bill': 'var(--red)', 'Bill to issue': 'var(--gold-600)', 'Leads to assign': 'var(--gold-600)', 'Data request': 'var(--slate)' };
    el.innerHTML = `<div class="stack-lg">
      ${h ? healthView(h, me, agq) : `<div class="kpis">${[['building', 'Clients with active enquiries', c.active_clients, 'clients', 'blue'], ['brief', 'Active job openings', c.open_jobs, 'jobs?status=Active', 'violet'], ['users', 'Seats to fill', c.seats_open, 'jobs?status=Active', 'gold'], ['flow', 'Active applications', c.active_apps, 'applications', 'blue'], ['cal', 'Interviews next 7 days', c.interviews_7, 'interviews', 'violet'], ['rupee', 'Offers waiting', c.offers_waiting, 'applications?stage=Offer', 'gold'], ['check', 'Joined last 30 days', c.joined_30, 'applications?closed=1', 'green'], isSuper(me) ? ['inbox', 'New leads', c.new_leads, 'leads', 'red'] : ['note', 'Feedback due', c.feedback_due, 'interviews', 'red']].map(([ic, l, v, h, tone]) => `<a class="card kpi click t-${tone}" href="/team/${h}"><span class="kpi-ic">${BB.icon(ic)}</span><span class="kpi-txt"><span class="kpi-v">${v || 0}</span><span class="kpi-l">${l}</span></span></a>`).join('')}</div>`}
      ${sub || (!isSuper(me) && tsec.length) ? today : ''}
      ${pipeline}
      <div class="grid ${h ? 'dash-side-only' : ''}" style="grid-template-columns:${h ? 'minmax(0,1fr)' : 'minmax(0,1.6fr) minmax(0,1fr)'};gap:14px">
        ${h ? '' : `<div class="card"><div class="card-h"><h3>Needs attention</h3><span class="badge b-outline">${d.attention.length}</span></div>${d.attention.map((a) => `<div class="attn"><span class="k" style="color:${kindColor[a.kind] || 'var(--muted)'}">${esc(a.kind)}</span><div class="grow small">${esc(a.kind === 'Data request' ? a.text : noId(a.text))}</div><button class="btn sm" data-go='${esc(JSON.stringify(a.open))}'>Open</button>${a.wa ? (a.wa.suggest ? `<button class="btn sm wa" data-open="application:${a.wa.ap}">${waIcon}</button>` : BB.waBtn(a.wa, '', 'btn sm wa')) : ''}</div>`).join('') || '<div class="empty">All clear. Nothing needs attention.</div>'}</div>`}
        <div class="stack">
          <div class="card"><div class="card-h"><h3>Job openings by status</h3></div><div class="card-b">${STATUSES.map((s) => `<div class="hbar" data-st="${s}"><span class="l">${statusBadge(s)}</span><div class="b bar"><i style="width:${((d.by_status[s] || 0) / max) * 100}%"></i></div><span class="v">${d.by_status[s] || 0}</span></div>`).join('')}</div></div>
          ${d.agencies && !h ? `<div class="card"><div class="card-h"><h3>Agencies at a glance</h3></div>${BB.table([{ t: 'Agency', f: (a) => esc(a.name) }, { t: 'Status', f: (a) => `<span class="badge ${a.status === 'On track' ? 'b-green' : a.status === 'Paused' ? 'b-outline' : 'b-amber'}">${esc(a.status)}</span>` }, { t: 'Open jobs', num: 1, f: (a) => a.open_jobs }, { t: 'Active apps', num: 1, f: (a) => a.active_apps }], d.agencies)}</div>` : ''}
          ${d.mine ? `<div class="card"><div class="card-h"><h3>My numbers · 30 days</h3></div><div class="card-b grid g3">${[['Added', d.mine.added], ['Screened', d.mine.screened], ['Interviews', d.mine.interviews], ['Sent', d.mine.sent], ['Offers', d.mine.offers], ['Joined', d.mine.joined]].map(([l, v]) => `<div><div class="small muted">${l}</div><b style="font-size:18px">${v}</b></div>`).join('')}<div style="grid-column:1/-1"><div class="small muted">Target</div><div class="bar gold"><i style="width:${d.mine.target}%"></i></div><b>${d.mine.target}%</b></div></div></div>` : ''}
        </div></div></div>`;
    $$('[data-go]', el).forEach((b) => (b.onclick = () => { const o = JSON.parse(b.dataset.go); if (o.type === 'page') BB.go(`team/${o.id}`); else BB.open(o.type, o.id); }));
    $$('[data-st]', el).forEach((b) => (b.onclick = () => BB.go(`team/jobs?status=${encodeURIComponent(b.dataset.st)}`)));
    $$('[data-pipe]', el).forEach((b) => (b.onclick = (e) => { e.preventDefault(); BB.go(`team/applications?${b.dataset.pipe}${me.level === 'super' ? '' : '&mine=1'}`); }));
    const dag = $('[data-dagency]', el); if (dag) dag.onchange = () => BB.setQ({ agency: dag.value });
    if (h) {
      wireHealth(el, h, me, agq);
      // The period (closed positions and their money) sits beside the heading.
      if (actions) { actions.innerHTML = `<label class="dash-period">${svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>')}<select data-dperiod aria-label="Period">${PERIODS.map(([v, l]) => `<option value="${v}" ${(q.period || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`; $('[data-dperiod]', actions).onchange = (e) => BB.dashPeriod(e.target.value); }
    }
    $$('[data-tlink]', el).forEach((b) => (b.onclick = (e) => { e.preventDefault(); BB.go(`team/${b.dataset.tlink}`); }));
  };

  // Candidate filters used on both Candidates and Candidate leads (the server applies the same rules, and the
  // download link carries the same address, so a download always matches what is on screen).
  const CAND_MORE = ['from', 'to', 'exp_min', 'exp_max', 'sal_min', 'sal_max'];
  // A drop-down of tick boxes (several values at once), saved as "a,b,c" in the address.
  // Options are values, or [value, label] pairs.
  // x: { counts: Map(value → how many), group: (value) → heading, add: 'domain' | 'dept' | 'job' | 'skill' (admins add new ones) }
  const multiSel = (k, all, plural, opts, val, x = {}) => { const on = String(val || '').split(',').filter(Boolean); const vOf = (o) => (Array.isArray(o) ? o[0] : o); const lOf = (o) => (Array.isArray(o) ? o[1] : o);
    // With counts, only values that still have candidates are offered (plus the ticked ones).
    let list = x.counts ? opts.filter((o) => on.includes(vOf(o)) || x.counts.get(vOf(o))) : [...opts];
    if (x.counts) for (const v of x.counts.keys()) if (!list.some((o) => vOf(o) === v)) list.push(v);
    list.sort((a, b) => Number(on.includes(vOf(b))) - Number(on.includes(vOf(a))) || (x.counts ? (x.counts.get(vOf(b)) || 0) - (x.counts.get(vOf(a)) || 0) : 0));
    const item = (o) => `<label class="row small"><input type="checkbox" value="${esc(vOf(o))}" ${on.includes(vOf(o)) ? 'checked' : ''}> <span class="grow">${esc(lOf(o))}</span>${x.counts ? `<span class="msel-n">${x.counts.get(vOf(o)) || 0}</span>` : ''}</label>`;
    let body;
    if (x.group) { const by = new Map(); for (const o of list) { const g = x.group(vOf(o)); if (!by.has(g)) by.set(g, []); by.get(g).push(o); } const order = BB.skillGroupNames(); body = [...by.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([g, l]) => `<div class="msel-grp" data-mgrp>${esc(g)}</div>${l.map(item).join('')}`).join(''); }
    else body = list.map(item).join('');
    const canAdd = x.add && BB.me && ['super', 'admin'].includes(BB.me.user.level);
    return `<details class="msel" data-msel="${k}"${canAdd ? ` data-madd="${x.add}"` : ''}><summary>${on.length === 0 ? all : on.length === 1 ? esc(lOf(opts.find((o) => vOf(o) === on[0]) || on[0])) : `${on.length} ${plural}`}</summary><div class="msel-pop">${list.length > 8 || canAdd ? `<input class="msel-find" placeholder="${canAdd ? 'Find or add…' : 'Find…'}" data-mfind>` : ''}${canAdd ? '<button type="button" class="msel-add" data-maddbtn hidden></button>' : ''}<div class="msel-list">${body || '<div class="msel-none small muted">Nothing here with these filters</div>'}</div><div class="row msel-foot"><button type="button" class="btn sm ghost" data-mclear>Clear</button><button type="button" class="btn sm primary" data-mapply>Apply</button></div></div></details>`; };
  // A click outside closes an open list (one list at a time).
  document.addEventListener('click', (e) => { document.querySelectorAll('.msel[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
  BB.wireMultiSel = (root) => $$('[data-msel]', root).forEach((d) => {
    const k = d.dataset.msel; const apply = (v) => BB.setQ({ [k]: v, page: 1 });
    const picked = () => $$('.msel-list input:checked', d).map((x) => x.value).join(',');
    const was = picked(); let done = false; const go = (v) => { done = true; apply(v); };
    $('[data-mapply]', d).onclick = () => go(picked());
    $('[data-mclear]', d).onclick = () => go('');
    // Closing the list keeps the ticks: no need to press Apply.
    // The list always opens fully on screen (Apply included), even near the edge or inside a scrolling panel.
    const pop = $('.msel-pop', d); const list = $('.msel-list', d);
    const place = () => { if (!d.open) return; const r = $('summary', d).getBoundingClientRect(); const W = innerWidth; const H = innerHeight;
      const w = Math.min(Math.max(pop.offsetWidth, 240), W - 16); const left = Math.max(8, Math.min(r.left, W - w - 8));
      const foot = pop.offsetHeight - list.offsetHeight; const below = H - r.bottom - 14; const above = r.top - 14; const up = below < 220 && above > below;
      const room = Math.max(120, (up ? above : below) - foot);
      Object.assign(pop.style, { position: 'fixed', left: `${left}px`, right: 'auto', maxWidth: `${W - 16}px`, top: up ? 'auto' : `${r.bottom + 6}px`, bottom: up ? `${H - r.top + 6}px` : 'auto' });
      list.style.maxHeight = `${Math.min(260, room)}px`; };
    const onMove = () => place();
    d.addEventListener('toggle', () => { if (d.open) { place(); addEventListener('resize', onMove); addEventListener('scroll', onMove, true); const f = $('[data-mfind]', d); if (f) f.focus(); } else { removeEventListener('resize', onMove); removeEventListener('scroll', onMove, true); if (!done && picked() !== was) go(picked()); } });
    const addBtn = $('[data-maddbtn]', d); const kind = d.dataset.madd; const KIND = { domain: 'domain', dept: 'department', job: 'designation', skill: 'skill' };
    const fd = $('[data-mfind]', d); if (fd) fd.oninput = () => { const w = fd.value.trim().toLowerCase(); $$('.msel-list label', d).forEach((l) => { l.hidden = !!w && !l.textContent.toLowerCase().includes(w); });
      $$('[data-mgrp]', d).forEach((h) => { let n = h.nextElementSibling; let any = false; while (n && !n.matches('[data-mgrp]')) { if (n.matches('label') && !n.hidden) any = true; n = n.nextElementSibling; } h.hidden = !any; });
      if (addBtn) { const exact = $$('.msel-list input', d).some((i) => i.value.toLowerCase() === w); addBtn.hidden = !w || exact || w.length < 2; addBtn.textContent = `+ Add “${fd.value.trim()}” as a new ${KIND[kind]}`; } };
    if (addBtn) addBtn.onclick = async () => {
      const name = fd.value.trim(); const extra = {};
      if (kind === 'job') { const v = await BB.ask({ title: `New designation: ${esc(name)}`, fields: [{ name: 'dept', label: 'Department', type: 'select', options: BB.boot.departments || [] }], ok: 'Add designation' }); if (!v) return; extra.dept = v.dept; }
      if (kind === 'skill') { const v = await BB.ask({ title: `New skill: ${esc(name)}`, fields: [{ name: 'group', label: 'Skill group', type: 'select', options: BB.skillGroupNames().slice(0, -1), value: BB.skillGroupOf(name), placeholder: false }], ok: 'Add skill' }); if (!v) return; extra.group = v.group; }
      try { await BB.post('/api/taxonomy', { kind, name, ...extra }); BB.boot = await (await fetch('/api/bootstrap')).json(); BB.toast(`${name} added as a ${KIND[kind]}`); BB.refreshPage(); } catch (e) { BB.fail(e); }
    };
  });
  function candFilters(q, desigs, skills, facets) {
    const cnt = (k) => (facets && facets[k] ? new Map(facets[k]) : null);
    const s = BB.boot;
    const sel = (k, label, opts) => `<select data-f="${k}"><option value="">${label}</option>${opts.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(q[k] || '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
    const states = [...new Set((s.places || []).map((x) => x.state).filter(Boolean))].sort();
    const n = (k, ph) => `<input type="number" min="0" placeholder="${ph}" data-f="${k}" value="${esc(q[k] || '')}">`;
    return {
      main: `${multiSel('domain', 'All domains', 'domains', [...(s.industry_list || []), 'Other', 'Not clear', 'Not read yet'], q.domain, { counts: cnt('domain'), add: 'domain' })}${multiSel('dept', 'All departments', 'departments', s.departments || [], q.dept, { counts: cnt('dept'), add: 'dept' })}${multiSel('job', 'All designations', 'designations', desigs, q.job, { counts: cnt('job'), add: 'job' })}${multiSel('skills', 'All skills', 'skills', skills || [], q.skills, { counts: cnt('skills'), group: BB.skillGroupOf, add: 'skill' })}${multiSel('company', 'All companies', 'companies', [], q.company, { counts: cnt('company') })}${multiSel('city', 'All cities', 'cities', s.cities || [], q.city, { counts: cnt('city') })}${multiSel('state', 'All states', 'states', states, q.state, { counts: cnt('state') })}${multiSel('source', 'All sources', 'sources', [...new Set([...(s.lead_sources || []), ...String(q.source || '').split(',').filter(Boolean)])], q.source, { counts: cnt('source') })}${sel('jewellery', 'Jewellery experience', [['0', 'Jewellery: no experience'], ['lt1', 'Jewellery: under 1 year'], ['1-3', 'Jewellery: 1–3 years'], ['3-5', 'Jewellery: 3–5 years'], ['5-10', 'Jewellery: 5–10 years'], ['10+', 'Jewellery: 10+ years']])}`,
      more: `<div class="grid g2"><label class="mf"><span>Applied from</span><input type="date" data-f="from" value="${esc(q.from || '')}"></label><label class="mf"><span>Applied up to</span><input type="date" data-f="to" value="${esc(q.to || '')}"></label></div>
        <div class="grid g4"><label class="mf"><span>Experience from (years)</span>${n('exp_min', 'Min')}</label><label class="mf"><span>Experience up to (years)</span>${n('exp_max', 'Max')}</label><label class="mf"><span>Expected salary from (₹/month)</span>${n('sal_min', 'Min')}</label><label class="mf"><span>Expected salary up to (₹/month)</span>${n('sal_max', 'Max')}</label></div>`,
      count: (extra = []) => [...CAND_MORE, ...extra].filter((k) => q[k]).length,
    };
  }
  // The filters in use, one chip per value, each with ✕ to take just that one off.
  const CHIP_LABEL = { q: 'Search', domain: 'Domain', dept: 'Department', job: 'Designation', skills: 'Skill', city: 'City', state: 'State', source: 'Source', jewellery: 'Jewellery', biz: 'B2B / B2C', worked: 'Worked at', company: 'Company', looking: 'Job status', status: 'Status', ad: 'Ad campaign', new: 'New', agency: 'Agency', from: 'Applied from', to: 'Applied up to', exp_min: 'Experience from', exp_max: 'Experience up to', sal_min: 'Expected salary from', sal_max: 'Expected salary up to', notice: 'Notice up to', updated: 'Updated in', stale: 'Not updated 90+ days', skillgroup: 'Skill group', cv: 'Resume' };
  const JEW_TXT = { 0: 'none', lt1: 'under 1 year', '1-3': '1–3 years', '3-5': '3–5 years', '5-10': '5–10 years', '10+': '10+ years' };
  const MULTI = ['domain', 'dept', 'job', 'skills', 'skillgroup', 'city', 'state', 'source', 'worked', 'looking', 'company'];
  const activeChips = (q) => { const chips = [];
    for (const k of Object.keys(CHIP_LABEL)) { const v = q[k]; if (!v) continue;
      if (MULTI.includes(k)) for (const one of String(v).split(',').filter(Boolean)) chips.push([k, one, `${CHIP_LABEL[k]}: ${one}`]);
      else chips.push([k, '', k === 'new' ? 'New only' : k === 'cv' ? (v === 'yes' ? 'Resume on file' : 'No resume') : k === 'agency' ? (v === 'none' ? 'Unassigned' : v === 'any' ? 'Assigned to an agency' : `Agency: ${v}`) : k === 'stale' ? CHIP_LABEL[k] : k === 'jewellery' ? `Jewellery: ${JEW_TXT[v] || v}` : k === 'updated' ? `Updated in the last ${v} days` : `${CHIP_LABEL[k]}: ${v}`]); }
    return chips.length ? `<div class="fchips" aria-label="Filters in use">${chips.map(([k, one, t]) => `<span class="fchip">${esc(t)}<button type="button" data-fx="${esc(k)}" data-fxv="${esc(one)}" aria-label="Remove ${esc(t)}">✕</button></span>`).join('')}</div>` : ''; };
  const wireChips = (el, q) => $$('[data-fx]', el).forEach((b) => (b.onclick = () => { const k = b.dataset.fx; const one = b.dataset.fxv; BB.setQ({ [k]: one ? String(q[k] || '').split(',').filter((x) => x && x !== one).join(',') : '', page: 1 }); }));
  const jewYrs = (y) => (y === null || y === undefined ? '—' : y === 0 ? 'None' : `${y} yrs`);
  const moreBtn = (n) => `More filters${n ? ` <span class="badge b-primary tiny">${n}</span>` : ''}`;
  const anyCandFilter = (q) => ['company', 'worked', 'looking', 'skillgroup', 'cv', 'domain', 'skills', 'source', 'new', 'agency', 'dept', 'job', 'city', 'state', 'jewellery', 'ad', ...CAND_MORE].some((k) => q[k]);
  const clearCandFilters = () => BB.setQ(Object.fromEntries(['company', 'worked', 'skillgroup', 'cv', 'domain', 'skills', 'new', 'agency', 'dept', 'job', 'city', 'state', 'jewellery', 'ad', ...CAND_MORE, 'q', 'source', 'looking', 'status', 'notice', 'updated', 'stale'].map((k) => [k, ''])));

  // Possible repeats and records with a problem, with a Merge button (Leads for clients, Candidates for candidates).
  const checkTable = (rows) => BB.table([{ t: 'Name', f: (r) => esc(r.label || '—') }, { t: 'Problem', f: (r) => `${r.needs_check ? `<span class="badge b-amber">${esc(r.needs_check)}</span>` : ''}${r.possible_repeat_of ? `<span class="badge b-amber">Possible repeat of ${esc(r.possible_repeat_of)}</span>` : ''}` }, { t: 'Source', f: (r) => esc(r.source) }, { t: '', f: (r) => `<div class="row nowrap" onclick="event.stopPropagation()">${r.possible_repeat_of ? `<button class="btn sm" data-merge="${r.type}:${r.possible_repeat_of}:${r.id}">Merge</button>` : ''}</div>` }], rows, { open: (r) => `${r.type}:${r.id}`, empty: 'Nothing to check.' });

  // ---------- Leads ----------
  P.leads = async ({ el, actions, q }) => {
    if (q.tab === 'candidate') return BB.go('team/candidates?new=1'); // candidate leads moved to Candidates
    const tab = q.tab || 'client';
    if (tab === 'partners') return BB.partners({ el, q, tabs: `<div class="tabs" style="margin-bottom:12px">${[['client', 'Client leads'], ['check', 'Needs checking'], ['partners', 'Partners']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>` });
    const d = await BB.api(`/api/leads?${BB.qs(q, { tab: undefined })}`); d.check = d.check.filter((r) => r.type === 'client');
    actions.innerHTML = `${d.can_download ? dl(`/api/leads?${BB.qs(q, { tab, format: 'xlsx' })}`) : ''}<button class="btn" data-lbulk>${BB.icon('upload')} Upload leads (Excel)</button><button class="btn primary" data-ladd>+ Add lead</button>`; if (d.can_download) wireDl(actions);
    $('[data-ladd]', actions).onclick = () => BB.quickLead();
    $('[data-lbulk]', actions).onclick = () => BB.importModal('clients', BB.me.user, 'Upload client leads from Excel');
    const agencyOpts = d.agencies.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    const assignCell = (type, r) => (r.agency_id ? `<span class="badge b-outline">${esc(r.agency_id)}</span>` : !d.can_allocate ? '<span class="tiny muted">Not allocated</span>' : `<select data-assign="${type}:${r.id}" class="mini"><option value="">Assign to agency…</option>${agencyOpts}</select>`);
    el.innerHTML = `${d.shared ? '<div class="small muted" style="margin-bottom:10px">One agency is active, so every client shows for the whole team. Allocation starts when a second agency is active.</div>' : ''}
      <div class="tabs">${[['client', 'Client leads', d.clients.length], ['check', 'Needs checking', d.check.length]].map(([k, l, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l} <span class="n">${n}</span></button>`).join('')}<button data-tab="partners">Partners</button></div>
      <div class="filters"><select data-f="source"><option value="">All sources</option>${BB.boot.lead_sources.map((s) => `<option ${q.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><label class="row small"><input type="checkbox" data-f="all" ${q.all ? 'checked' : ''}> Include assigned</label><label class="row small"><input type="checkbox" data-f="new" ${q.new ? 'checked' : ''}> New only</label></div>
      ${tab !== 'check' ? `<div class="card bulkbar bulk-card" data-leadbar>${BB.bulkHead('lead', 'data-selcount')}
        ${d.can_download ? '<button class="btn sm" data-lb="download">Download selected</button>' : ''}
        ${d.can_allocate ? `<select class="mini" data-lb-ag><option value="">Assign to agency…</option>${agencyOpts}</select>` : ''}
        ${tab === 'client' ? `<select class="mini" data-lb-stage><option value="">Move to stage…</option>${(d.stages || []).map((x) => `<option>${esc(x)}</option>`).join('')}</select>` : '<button class="btn sm" data-lb="add_to_job">Add to a job</button>'}
        <button class="btn sm" data-lb="welcome">${BB.icon('chat')} Send account link</button>
</div>` : ''}
      <div class="card" data-list></div>`;
    const list = $('[data-list]', el);
    if (tab === 'client') list.innerHTML = BB.table([{ t: '', f: (r) => (r.is_new ? '<span class="dot new" title="new"></span>' : '') }, { t: 'Company', f: (r) => `<b>${esc(r.company)}</b><div class="tiny muted">${esc(r.contact)}</div>` }, { t: 'City', f: (r) => esc(r.city) }, { t: 'Need', f: (r) => esc(r.need) }, { t: 'Source', f: (r) => esc(r.source) }, { t: 'Came', f: (r) => `<span class="nw">${BB.daysAgo(r.created_at)}</span>` }, { t: 'Agency', f: (r) => assignCell('client', r) }, { t: '', f: (r) => `<div class="row nowrap" onclick="event.stopPropagation()">${BB.waBtn({ ptype: 'client', pid: r.id, format: 'bbhs_client_welcome' }, '', 'btn sm icon wa')}</div>` }], d.clients, { open: (r) => `client:${r.id}`, select: true, empty: 'No new client leads.' });
    else list.innerHTML = checkTable(d.check);
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => BB.setQ({ tab: b.dataset.tab })));
    BB.wireMultiSel(el); $$('[data-f]', el).forEach((i) => (i.onchange = () => BB.setQ({ [i.dataset.f]: i.type === 'checkbox' ? (i.checked ? '1' : '') : i.value })));
    { const mf = $('.more-f', el); if (mf) mf.ontoggle = () => { BB.moreFiltersOpen = mf.open; }; const cl = $('[data-clear]', el); if (cl) cl.onclick = clearCandFilters; }
    $$('[data-assign]', el).forEach((s) => { s.onclick = (e) => e.stopPropagation(); s.onchange = async () => { const [type, id] = s.dataset.assign.split(':'); try { await BB.post('/api/leads/assign', { type, id, agency_id: s.value }); BB.toast(`${id} assigned — the agency admin got a task alert`); BB.refreshPage(); } catch (e) { BB.fail(e); } }; });
    $$('[data-junk]', el).forEach((b) => (b.onclick = async () => { const [type, id] = b.dataset.junk.split(':'); if (await BB.confirm('Mark as junk', `${id} will be hidden from lists (not deleted).`, 'Mark junk')) { await BB.post('/api/leads/junk', { type, id }); BB.refreshPage(); } }));
    $$('[data-merge]', el).forEach((b) => (b.onclick = () => { const [type, a, c] = b.dataset.merge.split(':'); BB.mergeScreen(type, a, c); }));
    // Bulk actions on the ticked rows (client and candidate leads).
    const bar = $('[data-leadbar]', el);
    if (bar) {
      const count = () => { const n = BB.selected(el).length; $('[data-selcount]', bar).textContent = BB.bulkCount('lead', n); bar.classList.toggle('has-sel', n > 0); };
      BB.wireSelect(el, count); $$('[data-sel]', el).forEach((x) => x.addEventListener('change', count));
      const ids = () => { const v = BB.selected(el); if (!v.length) BB.toast('Select some leads first', true); return v; };
      const word = tab === 'client' ? 'client lead' : 'candidate lead'; const many = (n) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const run = async (action, value, msg) => {
        const v = ids(); if (!v.length) return;
        try { const r = await BB.post('/api/leads/bulk', { type: tab, ids: v, action, value }); BB.toast(`${msg} — ${r.done} of ${v.length}${r.skipped.length ? ` (${r.skipped.length} skipped)` : ''}`); if (r.skipped.length) console.info('Skipped:', r.skipped); BB.refreshPage(); } catch (e) { BB.fail(e); }
      };
      $$('[data-lb]', bar).forEach((b) => (b.onclick = async () => {
        const a = b.dataset.lb; const v = BB.selected(el);
        if (a === 'download') { if (!ids().length) return; return BB.download(`/api/leads?${BB.qs(q, { tab, ids: v.join(','), format: 'xlsx' })}`); }
        if (a === 'add_to_job') { if (!ids().length) return; return BB.pickJob((jid) => run('add_to_job', jid, 'Added to the job')); }
        if (a === 'welcome') { if (!ids().length) return; if (await BB.confirm('Send account link on WhatsApp', `${many(v.length)} get their welcome message with the link to their ${tab === 'client' ? 'client account' : 'profile'}. People who said STOP are skipped.`, 'Send')) run('welcome', null, 'Sent'); return; }
      }));
      const ag = $('[data-lb-ag]', bar); if (ag) ag.onchange = async () => { const v = ids(); if (!v.length || !ag.value) { ag.value = ''; return; } try { await BB.post('/api/leads/assign', { type: tab, ids: v, agency_id: ag.value }); BB.toast(`${many(v.length)} assigned — the agency admin got a task alert`); BB.refreshPage(); } catch (e) { BB.fail(e); } };
      const st = $('[data-lb-stage]', bar); if (st) st.onchange = () => { const val = st.value; st.value = ''; if (val) run('stage', val, `Moved to ${val}`); };
    }
  };

  // ---------- Clients ----------
  P.clients = async ({ el, actions, q, me }) => {
    const r = await BB.api(`/api/clients?${BB.qs(q)}`);
    actions.innerHTML = `${dl(`/api/clients?${BB.qs(q, { format: 'xlsx' })}`)}<button class="btn" data-cbulk>${BB.icon('upload')} Upload clients (Excel)</button><button class="btn primary" data-new>+ Create client account</button>`;
    $('[data-cbulk]', actions).onclick = () => BB.importModal('clients', me, 'Upload clients from Excel');
    el.innerHTML = `<div class="filters"><input placeholder="Search name, ID, phone, city…" value="${esc(q.q || '')}" data-q><select data-stage><option value="">All stages</option>${BB.boot.stages.map((s) => `<option ${q.stage === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select><select data-life><option value="">Leads and active clients</option><option value="Lead" ${q.lifecycle === 'Lead' ? 'selected' : ''}>Leads</option><option value="Active" ${q.lifecycle === 'Active' ? 'selected' : ''}>Active clients</option></select><label class="row small"><input type="checkbox" data-arch ${q.archived ? 'checked' : ''}> Archived</label></div>
      <div class="card bulkbar bulk-card" data-cbar>${BB.bulkHead('client', 'data-ccount')}<button class="btn sm" data-cm="general">Email</button><button class="btn sm" data-cm="contract">Send agreement</button><button class="btn sm" data-cm="kyc">Ask for KYC</button><select class="mini" data-cstage aria-label="Update status"><option value="">Update status…</option>${BB.boot.stages.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
      <div class="card">${BB.table([{ t: 'Company', sort: 'company', f: (c) => `<b>${esc(c.company)}</b>${c.is_new ? ' <span class="dot new" title="New"></span>' : ''}<div class="tiny muted">${esc(c.contact)}</div>` }, { t: 'City', sort: 'city', f: (c) => esc(c.city) }, { t: 'Status', sort: 'lifecycle', f: (c) => `<span class="badge ${c.lifecycle === 'Lead' ? 'b-amber' : 'b-green'}">${esc(c.lifecycle)}</span>` }, { t: 'Stage', sort: 'stage', f: (c) => `<span class="badge b-outline">${esc(c.stage)}</span>` }, { t: 'Agency', sort: 'agency_name', f: (c) => esc(c.agency_name || '—'), hideSm: 1 }, { t: 'Jobs open / total', num: 1, f: (c) => `${c.jobs_open} / ${c.jobs_total}` }, { t: 'Login', f: (c) => `<span class="badge ${c.account_status === 'Opened' ? 'b-green' : 'b-outline'}">${esc(c.account_status)}</span>`, hideSm: 1 }], r.rows, { sorted: q, open: (c) => `client:${c.id}`, select: (c) => c.id })}${BB.pager(r)}</div>`;
    wireDl(actions); BB.wirePager(el); BB.flow.clientsMount(el);
    $('[data-life]', el).onchange = (e) => BB.setQ({ lifecycle: e.target.value, page: 1 });
    let t; $('[data-q]', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => BB.setQ({ q: e.target.value, page: 1 }), 350); };
    $('[data-stage]', el).onchange = (e) => BB.setQ({ stage: e.target.value, page: 1 });
    $('[data-arch]', el).onchange = (e) => BB.setQ({ archived: e.target.checked ? '1' : '' });
    $('[data-new]', actions).onclick = () => BB.ask({ title: 'Create client account', note: `The client goes to ${me.agency_id ? 'your agency' : 'the agency you assign'} and gets a welcome message with the account link.`, fields: [
      `<div class="grid g2">${field({ name: 'company', label: 'Company name' })}${field({ name: 'contact', label: 'Contact name' })}</div>`,
      `<div class="grid g2">${field({ name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true })}${field({ name: 'city', label: 'City', list: 'cities' })}</div>`,
      { name: 'business_type', label: 'Business', type: 'choice', options: ['Showroom B2C', 'Manufacturer B2B', 'Both'] }, { name: 'roles', label: 'Roles they need', opt: true },
      { name: 'source', label: 'Source', type: 'select', options: BB.boot.lead_sources },
    ], ok: 'Create', submit: (v) => BB.post('/api/clients', { ...v, whatsapp: BB.spokenToDigits(v.whatsapp) || v.whatsapp }) }).then((x) => { if (x) { BB.toast(x.isNew ? `${x.id} created` : `Already exists as ${x.id}`); BB.refreshPage(); BB.open('client', x.id); } });
  };

  // ---------- Job openings ----------
  const jobViews = (on) => `<div class="seg">${[['', 'Openings'], ['tracker', 'Digital Reach'], ...(isSuper(BB.me.user) ? [['spend', 'Ad spend']] : [])].map(([k, l]) => `<button data-jv="${k}" class="${on === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  BB.jobViews = jobViews;
  // Ad spend: upload what Meta Ads Manager / LinkedIn Campaign Manager exported; spend goes to the jobs each ad set
  // brought applications to. Shows spend, cost per application and per hire, per job and per ad set.
  async function adSpend(el, actions) {
    actions.innerHTML = `${jobViews('spend')}<button class="btn primary" data-spup>Upload spend report</button>`;
    $$('[data-jv]', actions).forEach((b) => (b.onclick = () => BB.setQ({ view: b.dataset.jv })));
    const [d, mt] = await Promise.all([BB.api('/api/adspend/report'), BB.api('/api/adspend/meta')]); const sm = d.summary; const money = (v) => (v === null || v === undefined ? '—' : inr(v));
    // Meta: fetched every morning by itself once the token is on the server; Fetch now for any dates.
    const meta = mt.connected
      ? `<div class="card pad row between" style="margin-bottom:14px"><div><b>Meta Ads</b> <span class="badge b-green">Connected</span> <span class="mono tiny faint">${esc(mt.account)}</span>${mt.error ? `<div class="small" style="color:var(--red)">Last try failed: ${esc(mt.error)}</div>` : ''}</div><button class="btn primary" data-spmeta>Fetch now</button></div>`
      : `<details class="card pad" style="margin-bottom:14px"><summary><b>Fetch spend from Meta by itself</b> <span class="badge b-outline">Not connected</span></summary><ol class="small" style="margin:8px 0 0;padding-left:18px;line-height:1.7"><li>Meta Business Settings → Accounts → Ad accounts: copy the ad account ID (act_…).</li><li>Business Settings → Users → System users: add one, give it the ad account with <b>View performance</b>, then Generate token with the <b>ads_read</b> permission.</li><li>On the server, add <span class="mono">META_AD_ACCOUNT</span> and <span class="mono">META_ADS_TOKEN</span> to the .env file and restart. The token only reads spend; it cannot change ads.</li></ol></details>`;
    el.innerHTML = `${meta}<div class="grid g4" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${[['Spent on ads', money(sm.total)], ['Applications from ads', sm.ad_apps], ['Cost per application', money(sm.per_app)], ['Hires from ads', sm.hires], ['Cost per hire', money(sm.per_hire)]].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
      ${sm.overlap >= 1 ? `<div class="small muted" style="margin-top:8px">${money(sm.overlap)} in uploaded Meta reports is left out: Meta already gave those days.</div>` : ''}
      ${sm.unmatched >= 10 ? `<div class="notice small" style="margin-top:12px">${money(sm.unmatched)} of spend matches no job yet. Add those ad set names to their jobs under <b>Ads for this job</b>, or open the job for that role.</div>` : ''}
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>By job opening</h3></div>${BB.table([{ t: 'Job', f: (j) => `<b>${esc(j.title)}</b><div class="tiny muted">${esc(j.code)} · ${esc(j.city || '')} · ${esc(j.client || '')}</div>` }, { t: 'Spent', num: 1, f: (j) => money(j.spend) }, { t: 'Applications from ads', num: 1, f: (j) => `${j.ad_apps}<div class="tiny faint">${j.all_apps} in all</div>` }, { t: 'Per application', num: 1, f: (j) => money(j.per_app) }, { t: 'Hires', num: 1, f: (j) => j.hires }, { t: 'Per hire', num: 1, f: (j) => money(j.per_hire) }, { t: 'Status', f: (j) => statusBadge(j.status) }], d.jobs, { open: (j) => `job:${j.job_id}`, empty: 'Upload a spend report to see this.' })}</div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>By ad set</h3><span class="small muted">LinkedIn: the campaign is the ad set</span></div>${BB.table([{ t: 'Ad set', f: (a) => `<b>${esc(a.adset || '—')}</b><div class="tiny muted">${esc(a.platform)}${a.campaign ? ` · ${esc(a.campaign)}` : ''}${a.start ? ` · ${fmtD(a.start)} – ${fmtD(a.end)}` : ''}</div>` }, { t: 'Spent', num: 1, f: (a) => money(a.spend) }, { t: 'Results (platform)', num: 1, f: (a) => a.results || '—' }, { t: 'In the portal', num: 1, f: (a) => a.portal_apps }, { t: 'Went to', f: (a) => (a.jobs.length ? `${a.jobs.map((x) => `<span class="mono tiny">${esc(x)}</span>`).join(' ')}<div class="tiny faint">${esc(a.how)}</div>` : '<span class="badge b-amber tiny">No job</span>') }], d.sets, { empty: 'No spend uploaded yet.' })}</div>
      `;
    const fm = $('[data-spmeta]', el); if (fm) fm.onclick = () => BB.ask({ title: 'Fetch spend from Meta', note: 'Days already fetched are replaced with the latest figures.', fields: [`<div class="grid g2">${BB.field({ name: 'from', label: 'From', type: 'date', value: BB.istDay(new Date(Date.now() - 30 * 86400000)) })}${BB.field({ name: 'to', label: 'To', type: 'date', value: BB.istDay(new Date(Date.now() - 86400000)) })}</div>`], ok: 'Fetch', submit: (v) => BB.post('/api/adspend/meta/fetch', v) }).then((x) => x && (BB.toast(`${x.rows} rows · ${inr(x.spent)} spent`), BB.refreshPage()));
    $$('[data-spdel]', el).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Remove report', 'Its spend figures come out of the report.', 'Remove')) { await BB.post(`/api/adspend/uploads/${b.dataset.spdel}/delete`).catch(BB.fail); BB.refreshPage(); } }));
    $('[data-spup]', actions).onclick = async () => {
      const file = await BB.pickFile('.csv,.xlsx'); if (!file) return;
      let p; try { p = await BB.post('/api/adspend/upload', { ...file, dry: true }); } catch (e) { return BB.fail(e); }
      BB.modal({ title: `${p.platform} spend report`, wide: true, body: `<p class="small" style="margin-top:0"><b>${p.rows.length}</b> rows · <b>${inr(Math.round(p.total))}</b> spent in all.</p><div class="card tbl-wrap" style="max-height:50vh;overflow:auto"><table class="tbl"><thead><tr><th>Ad set</th><th>Campaign</th><th>Ad</th><th>From – to</th><th class="num">Spent</th><th class="num">Results</th></tr></thead><tbody>${p.rows.map((r) => `<tr><td>${esc(r.adset)}</td><td class="small">${esc(r.campaign || '')}</td><td class="small">${esc(r.ad || '')}</td><td class="small">${esc(r.start || '')} – ${esc(r.end || '')}</td><td class="num">${inr(Math.round(r.spend))}</td><td class="num">${r.results || ''}</td></tr>`).join('')}</tbody></table></div>`,
        foot: '<button class="btn" data-spx>Cancel</button><button class="btn primary" data-spgo>Add to the report</button>',
        onMount: (m, close) => { $('[data-spx]', m).onclick = close; $('[data-spgo]', m).onclick = async () => { try { await BB.post('/api/adspend/upload', file); close(); BB.toast('Spend added'); BB.refreshPage(); } catch (e) { BB.fail(e); } }; } });
    };
  }
  P.jobs = async ({ el, actions, q, me }) => {
    if (q.view === 'tracker') return P.channels({ el, actions, q });
    if (q.view === 'spend' && isSuper(me)) return adSpend(el, actions);
    const r = await BB.api(`/api/jobs?${BB.qs(q)}`); const st = q.status || 'All';
    actions.innerHTML = `<div class="job-tb">${jobViews('')}<span class="tb-div"></span>${dl(`/api/jobs?${BB.qs(q, { format: 'xlsx' })}`).replace('>Download<', `>${BB.icon('download')} Download<`)}<button class="btn" data-jobxl>${BB.icon('upload')} Upload jobs (Excel)</button><button class="btn" data-fmass>${BB.icon('users')} Mass hiring</button><button class="btn gold tb-new" data-new>${BB.icon('plus')} New job opening</button></div>`; BB.flow.jobsActions(actions);
    el.innerHTML = `<section class="card job-filter"><div class="job-search">${BB.icon('search')}<input placeholder="Search job, client, ID, old code…" value="${esc(q.q || '')}" data-q aria-label="Search jobs"></div><div class="row job-prio">${(() => { const o = r.options || {}; const sel = (k, label, list) => list && list.length ? `<select data-jf="${k}" aria-label="${label}"><option value="">${label}</option>${list.map(([v, l]) => `<option value="${esc(v)}" ${q[k] === v ? 'selected' : ''}>${esc(l || v)}</option>`).join('')}</select>` : ''; return sel('client', 'All clients', o.clients) + `<select data-jf="opened" aria-label="Opened"><option value="">Any time</option>${[[7, 'Opened in the last 7 days'], [30, 'Opened in the last 30 days'], [90, 'Opened in the last 90 days']].map(([v, l]) => `<option value="${v}" ${Number(q.opened) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` + sel('city', 'All cities', o.cities) + sel('recruiter', 'All recruiters', o.recruiters); })()}<select data-ctcmin aria-label="Minimum CTC"><option value="">Any CTC</option>${[300000, 500000, 800000, 1200000, 2000000].map((v) => `<option value="${v}" ${Number(q.ctc_min) === v ? 'selected' : ''}>CTC ${v / 100000}L and above</option>`).join('')}</select><button class="btn sm ${q.sort === 'pscore' ? 'primary' : ''}" data-prio>Sort by priority</button></div><div class="job-chips">${['All', 'Active', ...STATUSES].map((s) => `<span class="chip ${st === s ? 'on' : ''}" data-st="${s}">${s} <span class="n">${r.counts[s] || 0}</span></span>`).join('')}</div></section>
      <section class="card bulk-card" data-jbar>${BB.bulkHead('job', 'data-jcount')}<div class="bulk-grid">${[['approve_jd', 'Approve JD'], ['hold', 'Put on hold'], ['resume', 'Resume'], ['close', 'Close'], ['reopen', 'Reopen'], ['priority', 'Priority'], ...(!me.accounts_only ? [['recruiter', 'Assign recruiter']] : []), ['client', 'Set client'], ...(!me.accounts_only ? [['delete', 'Delete']] : [])].map(([a, l]) => `<button class="bulk-btn ${a === 'delete' ? 'danger' : ''}" data-jb="${a}" disabled>${BB.icon('lock')}${l}</button>`).join('')}</div></section>
      <div class="card iv-list">${BB.table([{ t: 'Job', sort: 'title', f: (j) => `<div class="iv-job"><b class="ellipsis" title="${esc(j.title)}">${esc(j.title)}</b></div>${j.mass ? ' <span class="badge b-gold tiny">Mass hiring</span>' : ''}<div class="tiny muted nw">${[j.city, j.department].filter(Boolean).map(esc).join(' · ')}${j.priority === 'High' ? ' · <span style="color:var(--red)">High</span>' : ''}</div>` }, { t: 'Client', sort: 'client_name', f: (j) => (j.internal ? '<span class="badge b-violet tiny">Internal</span>' : j.client_tbc ? '<span class="badge b-amber tiny">Client to be confirmed</span>' : `<div class="iv-job" style="max-width:130px;min-width:90px"><span class="ellipsis" title="${esc(j.client_name)}">${esc(j.client_name)}</span></div>`) }, { t: 'CTC / yr', sort: 'ctc', num: 1, f: (j) => (j.ctc ? `<b class="nw">${inr(j.ctc)}</b>` : '<span class="faint">—</span>') }, { t: 'Priority', sort: 'pscore', f: (j) => `<span class="badge ${j.pscore >= 70 ? 'b-green' : j.pscore >= 40 ? 'b-amber' : 'b-outline'}" title="Half from how high the CTC is, half from how many openings this client has given us over time">${j.pscore}</span><div class="tiny muted nw" title="Openings this client has given us so far">${j.client_openings} opening${j.client_openings === 1 ? '' : 's'}</div>` }, { t: 'Filled', sort: 'filled', desc: 1, f: (j) => `<span class="nw">${j.filled}/${j.openings}</span><div class="bar" style="width:50px;margin-top:4px"><i style="width:${Math.min(100, (j.filled / j.openings) * 100)}%"></i></div>` }, { t: 'Apps', sort: 'apps_total', desc: 1, num: 1, f: (j) => j.apps_total }, { t: 'Reach', sort: 'reach_done', desc: 1, f: (j) => `<a href="#" data-open="reach:${j.id}" onclick="event.stopPropagation()">${j.reach_done}/${j.reach_total}</a><div class="tiny muted">${esc(j.creative || 'No creative')}</div>` }, { t: 'Status', sort: 'status', f: (j) => `${statusBadge(j.status)}${j.reopened ? `<div class="iv-job" style="max-width:110px;min-width:0;margin-top:4px"><span class="badge b-gold tiny ellipsis" style="display:inline-block;max-width:100%" title="${esc(j.reopened)}">${esc(j.reopened)}</span></div>` : ''}` }, { t: 'Recruiter', sort: 'days_open', desc: 1, f: (j) => `<span class="nw">${esc(j.recruiter_name || '—')}</span><div class="tiny muted nw">${j.days_open} day${j.days_open === 1 ? '' : 's'} open</div>`, hideSm: 1 }], r.rows, { sorted: q, open: (j) => `job:${j.id}`, select: true })}${BB.pager(r)}</div>
      <details class="card pad" style="margin-top:12px"><summary class="small" style="cursor:pointer"><b>What the statuses mean</b> — checked in this order; the first that is true is the status</summary><div class="grid g2 small" style="margin-top:10px">${STATUSES.slice().sort((a, b) => ['Closed', 'On hold', 'Filled', 'Draft', 'Offer stage', 'Interviewing', 'Sourcing', 'Open'].indexOf(a) - ['Closed', 'On hold', 'Filled', 'Draft', 'Offer stage', 'Interviewing', 'Sourcing', 'Open'].indexOf(b)).map((s) => `<div class="row">${statusBadge(s)} <span class="muted">${STATUS_KEY[s]}</span></div>`).join('')}</div></details>`;
    wireDl(actions); BB.wirePager(el);
    let t; $('[data-q]', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => BB.setQ({ q: e.target.value, page: 1 }), 350); };
    $$('[data-st]', el).forEach((c) => (c.onclick = () => BB.setQ({ status: c.dataset.st === 'All' ? '' : c.dataset.st, page: 1 })));
    $('[data-ctcmin]', el).onchange = (e) => BB.setQ({ ctc_min: e.target.value, page: 1 });
    $$('[data-jf]', el).forEach((x) => (x.onchange = () => BB.setQ({ [x.dataset.jf]: x.value, page: 1 })));
    $('[data-prio]', el).onclick = () => BB.setQ(q.sort === 'pscore' ? { sort: '', dir: '', page: 1 } : { sort: 'pscore', dir: 'desc', page: 1 });
    const n = $('[data-new]', actions); if (n) n.onclick = () => BB.newJob();
    $('[data-jobxl]', actions).onclick = () => uploadJobs();
    $$('[data-jv]', actions).forEach((b) => (b.onclick = () => BB.setQ({ view: b.dataset.jv })));
    // Selection bar: what is ticked, and bulk actions on those job openings.
    const jbar = $('[data-jbar]', el);
    const onJSel = () => { const k = BB.selected(el).length; $('[data-jcount]', jbar).textContent = BB.bulkCount('job', k); jbar.classList.toggle('has-sel', k > 0); $$('[data-jb]', jbar).forEach((b) => { b.disabled = !k; }); };
    BB.wireSelect(el, onJSel); $$('[data-sel]', el).forEach((x) => x.addEventListener('change', onJSel));
    const jobBulk = async (body) => { const ids = BB.selected(el); try { const res = await BB.post('/api/jobs/bulk', { ids, ...body }); BB.toast(`${res.done} updated${res.errors.length ? `, ${res.errors.length} not: ${res.errors[0]}` : ''}`, !!res.errors.length); BB.refreshPage(); } catch (e) { BB.fail(e); } };
    $$('[data-jb]', jbar).forEach((b) => (b.onclick = async () => {
      const ids = BB.selected(el); if (!ids.length) return; const a = b.dataset.jb; const n = `${ids.length} job opening${ids.length === 1 ? '' : 's'}`;
      if (a === 'delete') return BB.deleteRecords('job', ids);
      if (a === 'close') { const v = await BB.ask({ title: `Close ${n}`, note: 'Every open application on these jobs closes too, and interviews ahead are cancelled.', fields: [{ name: 'reason', label: 'Reason', type: 'select', options: BB.boot.job_close_reasons || ['Client stopped hiring'] }], ok: 'Close' }); if (v) jobBulk({ action: 'close', reason: v.reason }); return; }
      if (a === 'hold') { const v = await BB.ask({ title: `Put ${n} on hold`, fields: [{ name: 'reason', label: 'Reason', opt: true }], ok: 'Put on hold' }); if (v) jobBulk({ action: 'hold', reason: v.reason }); return; }
      if (a === 'priority') { const v = await BB.ask({ title: `Priority for ${n}`, fields: [{ name: 'priority', label: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'], placeholder: false }], ok: 'Save' }); if (v) jobBulk({ action: 'priority', priority: v.priority }); return; }
      if (a === 'recruiter') { const users = (await BB.api('/api/users')).users.filter((u) => u.status === 'On' && u.level !== 'super'); const v = await BB.ask({ title: `Recruiter for ${n}`, fields: [{ name: 'recruiter_id', label: 'Recruiter', type: 'select', options: users.map((u) => [u.id, `${u.name} · ${BB.levelName(u.level)}`]) }], ok: 'Assign' }); if (v) jobBulk({ action: 'recruiter', recruiter_id: v.recruiter_id }); return; }
      if (a === 'client') { const list = (await BB.api('/api/clients?all=1')).rows.filter((c) => !c.placeholder); const v = await BB.ask({ title: `Client for ${n}`, fields: [{ name: 'client_id', label: 'Client', type: 'select', options: list.map((c) => [c.id, c.company]) }], ok: 'Save' }); if (v) jobBulk({ action: 'client', client_id: v.client_id }); return; }
      const label = { approve_jd: 'Approve the job description of', resume: 'Resume', reopen: 'Reopen' }[a];
      if (await BB.confirm(b.textContent, `${label} ${n}?${a === 'approve_jd' ? ' Draft jobs go live, and their strong matches get a job alert.' : ''}`, b.textContent)) jobBulk({ action: a });
    }));
  };
  // Match candidates to jobs: preview which candidates go onto which open jobs (by their ad names or the job they
  // asked for), then make the applications. Running it again only adds what is new.
  async function autoMap(sameCity = false) {
    let d; try { d = await BB.post('/api/applications/auto-map', { dry: true, same_city: sameCity }); } catch (e) { return BB.fail(e); }
    const sm = d.summary;
    const list = d.jobs.map((j) => `<details class="card pad" style="margin-bottom:6px"><summary class="row between" style="cursor:pointer"><span><b>${esc(j.title)}</b> · ${esc(j.city || '')} <span class="faint">· ${esc(j.client || '')} · ${esc(j.job_id)}</span></span><span class="badge b-primary">${j.candidates.length}</span></summary><div class="small" style="margin-top:6px">${j.candidates.map((c) => `<div>${esc(c.id)} <b>${esc(c.name)}</b> <span class="faint">· ${esc(c.city || '')} · ${esc(c.by)}</span></div>`).join('')}</div></details>`).join('') || '<div class="faint small">Nothing new to match.</div>';
    BB.modal({ title: 'Match candidates to jobs', wide: true,
      body: `<p class="small" style="margin-top:0"><b>${sm.applications}</b> applications for <b>${sm.candidates}</b> candidates on <b>${sm.jobs}</b> open jobs. Each candidate goes onto every open job their ad set / ad name points to, or else the job they asked for. Candidates already on a job are skipped. ${sm.unmatched ? `${sm.unmatched} candidates match no open job.` : ''} Nothing is sent to anyone.</p>
        <label class="row small" style="margin-bottom:10px"><input type="checkbox" data-samecity ${sameCity ? 'checked' : ''}> Only jobs in the candidate's city</label>
        <div style="max-height:52vh;overflow:auto">${list}</div>`,
      foot: `<button class="btn" data-amx>Cancel</button><button class="btn primary" data-amgo ${sm.applications ? '' : 'disabled'}>Make ${sm.applications} applications</button>`,
      onMount: (m, close) => {
        $('[data-amx]', m).onclick = close;
        $('[data-samecity]', m).onchange = (e) => { close(); autoMap(e.target.checked); };
        $('[data-amgo]', m).onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Making…'; try { const r = await BB.post('/api/applications/auto-map', { same_city: sameCity }); close(); BB.toast(`${r.made} applications made${r.errors.length ? `, ${r.errors.length} not: ${r.errors[0]}` : ''}`, !!r.errors.length); BB.refreshPage(); } catch (er) { e.target.disabled = false; BB.fail(er); } };
      } });
  }
  // Candidates from resumes: pick CVs, the portal reads each one, you check and correct the details, then create.
  async function addFromResumes() {
    const files = await new Promise((resolve) => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = '.pdf,.docx,.txt'; i.onchange = () => resolve([...i.files]); i.click(); });
    if (!files.length) return;
    const toB64 = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, '')); fr.onerror = rej; fr.readAsDataURL(file); });
    BB.toast(`Reading ${files.length} resume${files.length === 1 ? '' : 's'}…`);
    const items = [];
    for (const file of files.slice(0, 50)) {
      if (file.size > 10 * 1024 * 1024) { items.push({ file, err: 'Bigger than 10 MB' }); continue; }
      try { const base64 = await toB64(file); const r = await BB.post('/api/candidates/cv-read', { name: file.name, base64 }); items.push({ file, base64, ...r }); } catch (e) { items.push({ file, err: e.message }); }
    }
    const jobs = (await BB.api('/api/jobs?status=Active&all=1')).rows;
    const s = BB.boot; const jobsList = s.jobs.map((j) => j.title);
    const row = (it, i) => {
      const v = it.fields || {}; const inp = (k, ph, w) => `<input data-f="${k}" data-i="${i}" value="${esc(v[k] ?? '')}" placeholder="${ph}" style="min-width:${w}px">`;
      return `<tr data-row="${i}"><td><label class="row small nowrap"><input type="checkbox" data-take="${i}" ${it.err ? 'disabled' : 'checked'}> <span class="tiny">${esc(it.file.name)}</span></label>${it.err ? `<div class="tiny" style="color:var(--red)">${esc(it.err)}</div>` : !it.readable ? `<div class="tiny muted">${esc(it.why || '')}</div>` : ''}${it.existing ? `<div class="tiny"><span class="badge b-amber tiny">Already in portal: ${esc(it.existing.id)} ${esc(it.existing.name)}</span> updates it</div>` : ''}</td>
        <td>${inp('name', 'Name', 140)}</td><td>${inp('whatsapp', 'WhatsApp', 110)}</td><td>${inp('email', 'Email', 160)}</td><td>${inp('city', 'City', 100)}</td>
        <td><input data-f="job_wanted" data-i="${i}" list="cv-jobs" value="${esc(v.job_wanted || '')}" placeholder="Job wanted" style="min-width:130px"></td><td>${inp('exp_total', 'Yrs', 50)}</td><td>${inp('current_company', 'Company', 130)}</td></tr>`;
    };
    BB.modal({ title: 'Add candidates from resumes', wide: true,
      body: `<p class="small" style="margin-top:0">Read from each resume. Check and correct, untick any you don't want, then add. The resume is kept on each candidate. Nothing is sent to them.</p>
        <datalist id="cv-jobs">${jobsList.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="card tbl-wrap" style="max-height:52vh;overflow:auto"><table class="tbl"><thead><tr><th>Resume</th><th>Name</th><th>WhatsApp</th><th>Email</th><th>City</th><th>Job wanted</th><th>Exp</th><th>Current company</th></tr></thead><tbody>${items.map(row).join('')}</tbody></table></div>
        <label class="field" style="margin-top:12px"><span class="lab">Also add them to a job opening (optional)</span><select data-cvjob><option value="">No, just add to the resume bank</option>${jobs.map((j) => `<option value="${j.id}">${esc(j.id)} · ${esc(j.title)} · ${esc(j.city || '')} · ${esc(j.client_name || '')}</option>`).join('')}</select></label>`,
      foot: `<button class="btn" data-cvx>Cancel</button><button class="btn primary" data-cvgo>Add candidates</button>`,
      onMount: (m, close) => {
        $('[data-cvx]', m).onclick = close;
        $('[data-cvgo]', m).onclick = async (e) => {
          const take = items.map((it, i) => ({ it, i })).filter(({ i }) => $(`[data-take="${i}"]`, m) && $(`[data-take="${i}"]`, m).checked);
          if (!take.length) return BB.toast('Select at least one resume', true);
          e.target.disabled = true; let ok = 0; const errs = []; let apps = 0; const job = $('[data-cvjob]', m).value;
          for (const { it, i } of take) {
            const fields = { ...(it.fields || {}) }; $$(`[data-i="${i}"]`, m).forEach((x) => { fields[x.dataset.f] = x.value.trim(); });
            e.target.textContent = `Adding ${ok + errs.length + 1} of ${take.length}…`;
            try { const r = await BB.post('/api/candidates/from-cv', { fields, cv: { name: it.file.name, base64: it.base64 }, job_id: job || undefined }); ok++; if (r.application) apps++; else if (r.appError) errs.push(`${fields.name}: ${r.appError}`); } catch (er) { errs.push(`${fields.name || it.file.name}: ${er.message}`); }
          }
          close(); BB.toast(`${ok} candidate${ok === 1 ? '' : 's'} added${job ? `, ${apps} added to ${job}` : ''}${errs.length ? `. Not done: ${errs.join('; ')}` : ''}`, !!errs.length); BB.refreshPage && BB.refreshPage();
        };
      } });
  }
  // Many job openings at once from an Excel in the Client Job Tracking Sheet layout: first a preview, then create.
  async function uploadJobs() {
    const file = await BB.pickFile('.xlsx,.csv'); if (!file) return;
    let d; try { d = await BB.post('/api/jobs/import', { ...file, dry: true }); } catch (e) { return BB.fail(e); }
    const sm = d.summary;
    const rows = d.rows.map((r) => `<tr class="${r.result === 'skip' ? 'faint' : ''}"><td class="mono tiny">${r.row}</td><td>${esc(r.client)}${r.client_new ? ' <span class="badge b-gold tiny">new</span>' : ''}</td><td>${r.title ? `<b>${esc(r.title)}</b>` : '<span class="faint">no job yet</span>'}${r.code ? ` <span class="mono tiny faint">${esc(r.code)}</span>` : ''}</td><td>${esc(r.city)}</td><td class="num">${r.openings ?? ''}</td><td class="small">${esc(r.salary || '—')}</td><td>${r.result === 'skip' ? `<span class="badge b-outline">Skip: ${esc(r.why)}</span>` : r.result === 'client' ? `<span class="badge b-violet">Client only · ${esc(r.status)}</span>` : `<span class="badge ${r.status === 'Open' ? 'b-green' : 'b-amber'}">${esc(r.status)}</span>`}</td><td class="small">${esc(r.recruiter || '')}</td></tr>`).join('');
    BB.modal({ title: 'Upload job openings', wide: true,
      body: `<p class="small" style="margin-top:0"><b>${sm.jobs}</b> job openings to create · <b>${sm.new_clients}</b> new clients${sm.clients_only ? ` (${sm.clients_only} of them from Client Master with no job yet)` : ''}${sm.existing_clients ? ` · ${sm.existing_clients} existing clients` : ''}${sm.skipped ? ` · ${sm.skipped} rows skipped` : ''}. New clients take their contact, phone and email from the Client Master sheet when it is in the file. Nothing is sent to clients or candidates.</p>
        <div class="card tbl-wrap" style="max-height:52vh;overflow:auto"><table class="tbl"><thead><tr><th>Row</th><th>Client</th><th>Job</th><th>City</th><th class="num">Seats</th><th>Salary</th><th>Status</th><th>Recruiter</th></tr></thead><tbody>${rows}</tbody></table></div>
        <label class="row small" style="margin-top:12px"><input type="checkbox" data-allcl checked> Also add the Client Master clients that have no job rows yet</label>
        <label class="row small" style="margin-top:4px"><input type="checkbox" data-approve checked> Job descriptions approved: jobs go live now and take applications (otherwise they start as Draft)</label>`,
      foot: `<button class="btn" data-x2>Cancel</button><button class="btn primary" data-go ${sm.jobs ? '' : 'disabled'}>Create ${sm.jobs} job openings</button>`,
      onMount: (m, close) => {
        $('[data-x2]', m.parentElement).onclick = close;
        $('[data-go]', m.parentElement).onclick = async (e) => {
          e.target.disabled = true; e.target.textContent = 'Creating…';
          try { const r = await BB.post('/api/jobs/import', { ...file, approve: $('[data-approve]', m).checked, all_clients: $('[data-allcl]', m).checked }); close(); BB.toast(`${r.created.length} job openings and ${r.summary.new_clients} new clients made`); BB.refreshPage && BB.refreshPage(); } catch (er) { e.target.disabled = false; e.target.textContent = 'Try again'; BB.fail(er); }
        };
      } });
  }

  // ---------- Segments: saved candidate filters, shared with the team, downloadable ----------
  const JEW_LABEL = { 0: 'no experience', lt1: 'under 1 year', '1-3': '1–3 years', '3-5': '3–5 years', '5-10': '5–10 years', '10+': '10+ years' };
  const SEG_LABEL = [['q', 'Search'], ['industry', 'Industry', (v) => (v === 'all' ? 'All industries' : v)], ['domain', 'Domain'], ['skills', 'Skills'], ['dept', 'Department'], ['job', 'Designation'], ['city', 'City'], ['state', 'State'], ['jewellery', 'Jewellery', (v) => JEW_LABEL[v] || v],
    ['from', 'Applied from'], ['to', 'Applied up to'], ['exp_min', 'Experience from', (v) => `${v} yrs`], ['exp_max', 'Experience up to', (v) => `${v} yrs`], ['sal_min', 'Expected salary from', (v) => `${inr(v)}/mo`], ['sal_max', 'Expected salary up to', (v) => `${inr(v)}/mo`],
    ['biz', 'B2B / B2C'], ['worked', 'Worked at'], ['company', 'Current company'], ['looking', 'Current job status'], ['status', 'Status'], ['source', 'Source'], ['ad', 'Ad campaign'], ['updated', 'Updated in last', (v) => `${v} days`], ['notice', 'Notice up to', (v) => `${v} days`], ['stale', 'Not updated in 90+ days', () => 'yes'], ['archived', 'Archived', () => 'yes']];
  const segChips = (q) => SEG_LABEL.filter(([k]) => q[k]).map(([k, l, f]) => `<span class="chip">${esc(l)}: <b>${esc(f ? f(q[k]) : q[k])}</b></span>`).join('') || '<span class="faint">All candidates</span>';

  // Share / rename / delete / copy link / download buttons, the same in the segment list and on an open segment.
  const wireSegButtons = (root, find) => {
    $$('[data-sdl]', root).forEach((b) => (b.onclick = () => BB.download(`/api/segments/${b.dataset.sdl}/candidates?format=xlsx`)));
    $$('[data-link]', root).forEach((b) => (b.onclick = () => BB.copy(`${location.origin}/team/candidates?tab=segments&seg=${b.dataset.link}`)));
    $$('[data-share]', root).forEach((b) => (b.onclick = async () => { const s = find(b.dataset.share); await BB.patch(`/api/segments/${s.id}`, { shared: !s.shared }).catch(BB.fail); BB.toast(s.shared ? 'Now only you can see it' : 'Shared with the whole team'); BB.refreshPage(); }));
    $$('[data-ren]', root).forEach((b) => (b.onclick = () => { const s = find(b.dataset.ren); BB.ask({ title: 'Rename segment', fields: [{ name: 'name', label: 'Name', value: s.name }], submit: (v) => BB.patch(`/api/segments/${s.id}`, { name: v.name }) }).then((x) => x && BB.refreshPage()); }));
    $$('[data-del]', root).forEach((b) => (b.onclick = async () => { const s = find(b.dataset.del); if (await BB.confirm('Delete segment', `"${s.name}" will be deleted${s.shared ? ' for the whole team' : ''}. The candidates are not touched.`, 'Delete')) { await BB.post(`/api/segments/${s.id}/delete`).catch(BB.fail); BB.setQ({ seg: '', page: '' }); } }));
    $$('[data-segedit]', root).forEach((b) => (b.onclick = () => { const s = find(b.dataset.segedit); BB.go(`team/candidates?${BB.qs({ ...s.query, editseg: s.id })}`); BB.toast('Change the filters, then tap "Update segment"'); }));
  };
  const segButtons = (s, canDl, withOpen) => `${withOpen ? `<button class="btn sm primary" data-segopen="${s.id}">Open</button>` : ''}<button class="btn sm gold" data-segsend="${s.id}" data-segname="${esc(s.name)}">Send campaign</button>${s.can_edit ? `<button class="btn sm" data-segedit="${s.id}">Edit filters</button>` : ''}${canDl ? `<button class="btn sm" data-sdl="${s.id}">Download</button>` : ''}<button class="btn sm" data-link="${s.id}">Copy link</button>${s.can_edit ? `<button class="btn sm" data-share="${s.id}">${s.shared ? 'Unshare' : 'Share with team'}</button><button class="btn sm" data-ren="${s.id}">Rename</button><button class="btn sm danger" data-del="${s.id}">Delete</button>` : ''}`;
  // Candidates → Segments: the list; ?seg=ID opens one with the full table and every bulk action.
  async function segmentsTab(el, actions, q, me) {
    const d = await BB.api('/api/segments');
    const find = (id) => d.segments.find((s) => String(s.id) === String(id));
    if (q.seg) { const s = find(q.seg); if (s) return bank(el, actions, q, me, { ...s, can_download: d.can_download }); BB.toast('That segment was deleted or is not shared with you', true); }
    actions.innerHTML = '<button class="btn primary" data-new>+ New segment</button>';
    $('[data-new]', actions).onclick = () => { BB.setQ({ tab: '', seg: '', page: '' }); BB.toast('Pick the filters, then tap "Save as segment"'); };
    el.innerHTML = `<p class="muted small" style="margin:0 0 12px">A segment is a saved set of candidate filters. Its list updates itself as candidates join or change. Open one to work on its candidates with the same actions as the resume bank. Shared segments are visible to the whole team.</p>
      <div class="card cand-table">${d.segments.length ? BB.table([
        { t: 'Segment', cls: 'wrap', f: (s) => `<b>${esc(s.name)}</b>${s.shared ? ' <span class="badge b-primary tiny">Shared</span>' : ''}<div class="row" style="gap:4px;margin-top:4px">${segChips(s.query)}</div>` },
        { t: 'Candidates', num: 1, f: (s) => `<b>${s.count}</b>` },
        { t: 'Made by', f: (s) => (s.mine ? 'You' : esc(s.owner)), hideSm: 1 },
        { t: 'Updated', f: (s) => (s.updated_at ? `<span class="nw">${BB.daysAgo(s.updated_at)}</span>` : '—'), hideSm: 1 },
        { t: '', f: (s) => `<div class="row nowrap" onclick="event.stopPropagation()">${segButtons(s, d.can_download, true)}</div>` },
      ], d.segments) : '<div class="pad muted">No segments yet. Tap <b>+ New segment</b>, pick filters in the resume bank, then <b>Save as segment</b>.</div>'}</div>`;
    $$('[data-segopen]', el).forEach((b) => (b.onclick = () => BB.setQ({ tab: 'segments', seg: b.dataset.segopen, page: '' })));
    $$('[data-segsend]', el).forEach((b) => (b.onclick = () => BB.flow.campaign({ segment: b.dataset.segsend, label: b.dataset.segname })));
    wireSegButtons(el, find);
  }

  // ---------- Departments & roles (a Settings tab): every team level can add; hiding stays in Settings → Job list ----------
  async function rolesView(el, q, me) {
    const d = await BB.api(`/api/roles${q.industry ? `?industry=${encodeURIComponent(q.industry)}` : ''}`);
    const reboot = async () => { BB.boot = await (await fetch('/api/bootstrap')).json(); BB.refreshPage(); };
    el.innerHTML = `<div class="row between" style="margin:0 0 12px;gap:12px"><p class="muted small" style="margin:0;max-width:720px">Roles added here show up straight away in job openings, the job-seeker form and the candidate filters.${isSuper(me) ? ' To hide or rename a role, use the Job list tab.' : ''}</p><button class="btn primary" data-adddept>+ Add department</button></div>
      ${d.industries.length > 1 ? `<div class="filters"><select data-ind>${d.industries.map((i) => `<option ${i === d.industry ? 'selected' : ''}>${esc(i)}</option>`).join('')}</select></div>` : ''}
      <div class="grid g2">${d.departments.map((x) => `<div class="card pad stack-sm"><div class="row between"><h3 style="margin:0">${esc(x.name)}</h3><span class="faint small">${x.roles.length} role${x.roles.length === 1 ? '' : 's'}</span></div>
        <div class="row" style="gap:6px">${x.roles.map((r) => `<span class="chip${r.hidden ? ' faint' : ''}" title="${r.candidates} candidate${r.candidates === 1 ? '' : 's'} want this${r.hidden ? ' · hidden in Settings' : ''}">${esc(r.title)}${r.candidates ? ` <span class="n">${r.candidates}</span>` : ''}</span>`).join('') || '<span class="faint small">No roles yet</span>'}</div>
        <form class="row" data-addrole="${esc(x.name)}" style="gap:6px"><input name="title" placeholder="New role in ${esc(x.name)}" style="flex:1 1 180px;width:auto"><button class="btn sm">Add role</button></form></div>`).join('')}</div>`;
    $('[data-adddept]', el).onclick = () => BB.ask({ title: 'Add department', fields: [{ name: 'name', label: 'Department name', placeholder: 'e.g. Visual Merchandising' }], ok: 'Add', submit: (v) => BB.post('/api/roles/department', v) }).then((x) => x && (BB.toast(`${x.name} added — now add its roles`), reboot()));
    const ind = $('[data-ind]', el); if (ind) ind.onchange = () => BB.setQ({ industry: ind.value });
    $$('[data-addrole]', el).forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault(); const title = $('[name=title]', f).value.trim(); if (!title) return;
      try { await BB.post('/api/roles/role', { department: f.dataset.addrole, title, industry: d.industry }); BB.toast(`${title} added to ${f.dataset.addrole}`); reboot(); } catch (er) { BB.showErr(f, er); }
    }));
  }

  // ---------- Candidates › Reports: charts on the resume bank (as filtered), every bar and slice opens those candidates ----------
  const REP_KEEP = ['company', 'worked', 'q', 'domain', 'dept', 'job', 'skills', 'skillgroup', 'city', 'state', 'source', 'jewellery', 'biz', 'looking', 'status', 'ad', 'new', 'agency', 'cv', 'from', 'to', 'exp_min', 'exp_max', 'sal_min', 'sal_max', 'notice', 'updated', 'stale'];
  const reportsTab = async (body, q) => {
    const base = Object.fromEntries(REP_KEEP.filter((k) => q[k]).map((k) => [k, q[k]]));
    body.innerHTML = '<div class="empty">Loading…</div>';
    let r; try { r = await BB.api(`/api/candidates/report?${BB.qs(base)}`); } catch (e) { body.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
    const go = (f) => { if (!f) return; const next = { ...base }; for (const k of ['exp_min', 'exp_max', 'from', 'to']) if (k in f) delete next[k]; BB.go(`team/candidates?${BB.qs({ ...next, ...f })}`); };
    const fmt = (n) => Number(n).toLocaleString('en-IN'); const pct = (n) => (r.total ? `${Math.round((n / r.total) * 100)}%` : '0%');
    const enc = (f) => (f ? esc(JSON.stringify(f)) : '');
    // Horizontal bars: label, bar, count (the count is always written, so no legend is needed)
    const hbars = (list, unit = 'candidates') => { const max = Math.max(1, ...list.map((x) => x.n)); return list.length ? `<div class="rep-hbars">${list.map((x) => `<button type="button" class="rep-hb ${x.f ? '' : 'flat'}" ${x.f ? `data-rgo="${enc(x.f)}"` : 'disabled'} data-tip="${esc(`${x.label}: ${fmt(x.n)} ${unit} (${pct(x.n)})`)}"><span class="rep-hb-l">${esc(x.label)}</span><span class="rep-hb-t"><i style="width:${Math.max(2, (x.n / max) * 100)}%"></i></span><span class="rep-hb-v">${fmt(x.n)}</span></button>`).join('')}</div>` : '<div class="rep-none">No candidates here</div>'; };
    // Columns for ordered bands (experience, weeks): value on top, label below
    const cols = (list, lab = (x) => x.label) => { const max = Math.max(1, ...list.map((x) => x.n)); return `<div class="rep-cols" style="--n:${list.length}">${list.map((x) => `<button type="button" class="rep-col ${x.f ? '' : 'flat'}" ${x.f ? `data-rgo="${enc(x.f)}"` : 'disabled'} data-tip="${esc(`${lab(x)}: ${fmt(x.n)} candidates`)}"><span class="rep-col-v">${x.n ? fmt(x.n) : ''}</span><span class="rep-col-b"><i style="height:${x.n ? Math.max(3, (x.n / max) * 100) : 0}%"></i></span><span class="rep-col-l">${esc(lab(x))}</span></button>`).join('')}</div>`; };
    // Donut for a small part-to-whole (2–6 parts): slices in the fixed palette order, 2px gaps, legend with counts
    const donut = (list, title) => { const parts = list.filter((x) => x.n); const tot = parts.reduce((t, x) => t + x.n, 0) || 1; const R = 42; const C = 2 * Math.PI * R; let off = 0;
      const segs = parts.map((x, i) => { const len = (x.n / tot) * C; const gap = parts.length > 1 ? Math.min(2, len / 2) : 0; const s = `<circle class="rep-seg s${i + 1} ${x.f ? '' : 'flat'}" r="${R}" cx="60" cy="60" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}" ${x.f ? `data-rgo="${enc(x.f)}"` : ''} data-tip="${esc(`${x.label}: ${fmt(x.n)} (${Math.round((x.n / tot) * 100)}%)`)}"></circle>`; off += len; return s; }).join('');
      return `<div class="rep-donut"><svg viewBox="0 0 120 120" role="img" aria-label="${esc(title)}"><circle class="rep-seg-bg" r="${R}" cx="60" cy="60"></circle><g transform="rotate(-90 60 60)">${segs}</g><text x="60" y="58" class="rep-dn-v">${fmt(tot)}</text><text x="60" y="74" class="rep-dn-l">candidates</text></svg>
        <ul class="rep-legend">${parts.map((x, i) => `<li><button type="button" ${x.f ? `data-rgo="${enc(x.f)}"` : 'disabled'}><span class="rep-sw s${i + 1}"></span><span class="grow">${esc(x.label)}</span><b>${fmt(x.n)}</b><span class="rep-pc">${Math.round((x.n / tot) * 100)}%</span></button></li>`).join('')}</ul></div>`; };
    const card = (title, sub, inner, wide) => `<section class="card rep-card ${wide ? 'wide' : ''}"><h3 class="dsec-h">${title}</h3>${sub ? `<div class="rep-sub">${sub}</div>` : ''}${inner}</section>`;
    const wk = (x) => { const d = new Date(`${x.label}T00:00:00Z`); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
    body.innerHTML = `<div class="rep stack">
      <div class="card rep-head"><div class="rep-total"><b>${fmt(r.total)}</b> candidates${Object.keys(base).length ? ' with these filters' : ''}</div>${activeChips(q)}<span class="grow"></span><button type="button" class="btn sm" data-rbank>Open in resume bank →</button></div>
      <div class="rep-tiles">${r.tiles.map((t) => `<button type="button" class="card rep-tile" data-rgo="${enc(t.f)}"><span class="rep-tile-l">${esc(t.label)}</span><span class="rep-tile-v">${fmt(t.n)}</span><span class="rep-tile-s">${pct(t.n)} of these candidates · open</span></button>`).join('')}</div>
      <div class="rep-grid">
        ${card('Current job status', 'Click a slice or a line to see those candidates', donut(r.looking, 'Current job status'))}
        ${card('Business type worked in', 'Candidates who worked at each kind of business', donut(r.worked, 'Business type worked in'))}
        ${card('Assignment and resumes', '', `<div class="rep-pair">${donut(r.assigned, 'Assigned to an agency')}${donut(r.resume, 'Resume on file')}</div>`, true)}
        ${card('Departments', 'Click a bar to see those candidates', hbars(r.dept))}
        ${card('Designations', 'Top 12 roles candidates want', hbars(r.job))}
        ${card('Skill groups', 'Candidates with at least one skill in the group', hbars(r.skill_group))}
        ${card('Top skills', 'The 15 most common skills', hbars(r.skills))}
        ${card('Total experience', '', cols(r.exp))}
        ${card('Jewellery industry experience', '', cols(r.jewellery))}
        ${card('Cities', 'Top 12 cities', hbars(r.city))}
        ${card('Sources', 'Where candidates came from', hbars(r.source))}
        ${card('Domains', '', hbars(r.domain))}
        ${card('Added per week', 'The last 12 weeks', cols(r.weeks, wk))}
      </div><div class="rep-tip" role="tooltip" hidden></div></div>`;
    $$('[data-rgo]', body).forEach((b) => (b.onclick = () => go(JSON.parse(b.dataset.rgo))));
    $('[data-rbank]', body).onclick = () => BB.go(`team/candidates?${BB.qs(base)}`);
    wireChips(body, q);
    const tip = $('.rep-tip', body);
    body.onmousemove = (e) => { const t = e.target.closest('[data-tip]'); if (!t) { tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8); tip.style.left = `${x}px`; tip.style.top = `${e.clientY + 16}px`; };
    body.onmouseleave = () => { tip.hidden = true; };
  };

  // ---------- Candidates › Verifications: what clients ordered, how far each is, the reports ----------
  const verificationsTab = async (body, q) => {
    const st = q.vst || 'open'; let d; try { d = await BB.api('/api/verify-orders'); } catch (e) { body.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
    const rows = d.rows.filter((o) => (st === 'open' ? ['Requested', 'In progress'].includes(o.status) : st === 'all' ? true : o.status === st));
    const cnt = (f) => d.rows.filter(f).length;
    body.innerHTML = `<div class="stack"><div class="card pad row between" style="gap:10px;flex-wrap:wrap"><div class="chips">${[['open', 'Open', cnt((o) => ['Requested', 'In progress'].includes(o.status))], ['Completed', 'Completed', cnt((o) => o.status === 'Completed')], ['Cancelled', 'Cancelled', cnt((o) => o.status === 'Cancelled')], ['all', 'All', d.rows.length]].map(([k, l, n]) => `<button class="chip ${st === k ? 'on' : ''}" data-vst="${k}">${l} <span>${n}</span></button>`).join('')}</div>
      <div class="small muted">Order from a candidate's page (Verification › Order verification), or clients order from their account. Prices: ${d.packages.map((p) => `${esc(p.name)} ₹${p.price}`).join(' · ')}</div></div>
      <div class="card">${BB.table([{ t: 'Order', f: (o) => `<b>${esc(o.no)}</b><div class="tiny muted">${fmtD(o.at)} · ${esc(o.by)}</div>` }, { t: 'Candidate', f: (o) => `<a href="#" data-open="candidate:${esc(o.candidate_id)}">${esc(o.candidate_name)}</a>` }, { t: 'Client', f: (o) => esc(o.client_name) }, { t: 'Package', f: (o) => esc(o.name) }, { t: 'Price', num: 1, f: (o) => `₹${Number(o.price).toLocaleString('en-IN')}` }, { t: 'Checks done', num: 1, f: (o) => esc(o.progress) },
        { t: 'Status', f: (o) => `<span class="badge ${o.status === 'Completed' ? (o.problem ? 'b-red' : 'b-green') : o.status === 'Cancelled' ? 'b-outline' : 'b-amber'}">${esc(o.status === 'Completed' ? (o.problem ? 'Problem found' : 'All clear') : o.status)}</span>` },
        { t: '', f: (o) => (o.status === 'Completed' ? `<button class="btn sm" data-vrep="${o.id}">Report</button>` : `<button class="btn sm" data-open="candidate:${esc(o.candidate_id)}">Do the checks</button>`) }], rows, { empty: st === 'open' ? 'No verification waiting.' : 'Nothing here.' })}</div></div>`;
    $$('[data-vst]', body).forEach((b) => (b.onclick = () => BB.setQ({ vst: b.dataset.vst === 'open' ? '' : b.dataset.vst })));
    $$('[data-vrep]', body).forEach((b) => (b.onclick = () => BB.download(`/api/verify-orders/${b.dataset.vrep}/report`)));
  };

  // ---------- Candidates: resume bank, gap view, tie-ups, Excel import ----------
  P.candidates = async (ctx) => {
    const { el, actions, q } = ctx; const tab = q.tab || 'bank';
    // Gap view is hidden for now (its page still works at ?tab=gap); put ['gap', 'Gap view'] back in this list to show it.
    el.innerHTML = `<div class="tabs">${[['bank', 'Resume bank'], ['reports', 'Reports'], ['verifications', 'Verifications'], ['segments', 'Segments'], ...(ctx.me.level === 'super' ? [['check', 'Needs checking']] : []), ['tieups', 'Tie-ups'], ['import', 'Upload Excel']].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div data-tabbody></div>`;
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => BB.setQ({ tab: b.dataset.tab === 'bank' ? '' : b.dataset.tab, page: '', seg: '' })));
    const body = $('[data-tabbody]', el); actions.innerHTML = '';
    if (tab === 'segments') return segmentsTab(body, actions, q, ctx.me);
    if (tab === 'reports') return reportsTab(body, q);
    if (tab === 'verifications') return verificationsTab(body, q);
    if (tab === 'campaigns') return BB.go('team/campaigns');
    if (tab === 'gap') return gapView(body);
    if (tab === 'check') { const d = await BB.api('/api/leads'); body.innerHTML = `<div class="card">${checkTable(d.check.filter((r) => r.type === 'candidate'))}</div>`; $$('[data-merge]', body).forEach((b) => (b.onclick = () => { const [type, a, c] = b.dataset.merge.split(':'); BB.mergeScreen(type, a, c); })); return; }
    if (tab === 'tieups') return tieups(body);
    if (tab === 'import') return importView(body, ctx.me);
    return bank(body, actions, q, ctx.me);
  };
  // The resume bank table with its selection bar and bulk actions. With seg (an open segment) the segment's own
  // filters are used and a segment card replaces the filter card; everything else is the same.
  async function bank(el, actions, pageQ, me, seg = null) {
    const q = seg ? { ...seg.query, page: pageQ.page || '' } : pageQ;
    const [r, saved] = await Promise.all([BB.api(`/api/candidates?${BB.qs(q, { tab: undefined, editseg: undefined })}`), BB.api('/api/saved-searches')]);
    const s = BB.boot;
    const superAdmin = me.level === 'super'; // candidate downloads are for the super admin only
    const editing = !seg && q.editseg ? saved.find((x) => String(x.id) === String(q.editseg)) : null;
    // Two menus (Upload, Download) and Create candidate on the right.
    const mItem = (attrs, label, tip = '') => `<button type="button" role="menuitem" ${attrs}${tip ? ` title="${tip}"` : ''}>${label}</button>`;
    const menu = (label, items) => `<details class="step-menu head-menu"><summary class="btn">${label}</summary><div class="step-pop right" role="menu">${items.join('')}</div></details>`;
    actions.innerHTML = seg ? '<button class="btn" data-backseg>← All segments</button>' : `${menu('Upload', [mItem('data-up', 'Upload Excel'), mItem('data-fromcv', 'Add from resumes'), superAdmin ? mItem('data-cvzip', 'Attach resumes (zip)', 'A zip of the Drive CV folder, or one resume: each goes to its candidate, or makes a new one') : '', superAdmin ? mItem('data-cvmissing', 'Missing resumes') : ''].filter(Boolean))}${superAdmin ? menu('Download', [mItem(`data-dl="${esc(`/api/candidates?${BB.qs(q, { format: 'xlsx', tab: undefined, editseg: undefined })}`)}"`, 'Download list', 'Every matching candidate as an Excel list'), mItem(`data-dl="/api/candidates/cvs.zip?${esc(BB.qs(q, { tab: undefined, editseg: undefined, page: undefined }))}"`, 'Download CVs (zip)', "Every matching candidate's CV in one zip, with the list")]) : ''}<button class="btn primary" data-new>+ Create candidate</button>`;
    actions.onclick = (e) => $$('details.head-menu', actions).forEach((d) => { if (!d.contains(e.target) || e.target.closest('[role=menuitem]')) d.open = false; });
    // Resumes from outside (a zip of the Google Drive CV folder): each to the candidate it belongs to
    const cz = $('[data-cvzip]', actions); if (cz) cz.onclick = async () => { const f = await BB.pickFile('.zip,.pdf,.doc,.docx,.jpg,.jpeg,.png'); if (!f) return; BB.toast('Reading the resumes… this can take a minute'); try { const r = await BB.post('/api/candidates/resume-files', { name: f.name, base64: f.base64 }); BB.modal({ title: 'Resumes attached', body: `<p><b>${r.attached}</b> attached to their candidate · <b>${r.created}</b> new candidates · ${r.skipped} skipped (already there, or not a resume) · <b>${r.unmatched.length}</b> not matched, of ${r.total} files.</p>${r.unmatched.length ? `<details><summary class="small">Not matched</summary><div class="small" style="max-height:40vh;overflow:auto">${r.unmatched.map((x) => `<div>${esc(x)}</div>`).join('')}</div></details>` : ''}`, onClose: () => BB.refreshPage() }); } catch (e) { BB.fail(e); } };
    // Candidates from email and Google Drive still without a resume: who, how far the mailbox re-read is, and Fetch now.
    const cm = $('[data-cvmissing]', actions); if (cm) cm.onclick = async () => {
      let d; try { d = await BB.api('/api/resumes/missing'); } catch (e) { return BB.fail(e); }
      const p = d.email.progress || {};
      BB.modal({ title: 'Candidates without a resume', wide: true, body: `<div class="stack"><div class="grid g3">${[['From email', d.counts.email], ['From Google Drive', d.counts.drive], ['Naukri exports (no file)', d.counts.naukri]].map(([l, n]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${n}</div></div>`).join('')}</div>
        <div class="small">${d.email.on ? `Email: the mailbox is read again for missed resumes, 150 emails every 10 minutes${p.total ? ` · <b>${p.total - p.left} of ${p.total}</b> emails read so far` : ''}${d.email.last ? ` · last run ${esc(String(d.email.last))}` : ''}.` : 'Email inbox is not set up on the server.'}</div>
        <div class="small muted">Google Drive: ${esc(String((d.drive.last) || 'not read yet'))}. Naukri export rows have no resume file to fetch.</div>
        ${(d.email.errors || []).length ? `<details><summary class="small"><b>${d.email.errors.length} files could not be saved</b></summary><div class="small" style="max-height:20vh;overflow:auto">${d.email.errors.map((x) => `<div>${esc(x)}</div>`).join('')}</div></details>` : ''}
        <div class="card tbl-wrap" style="max-height:40vh;overflow:auto"><table class="tbl"><tbody>${d.rows.filter((c) => c.source !== 'Google Drive - Naukri').map((c) => `<tr class="click" data-open="candidate:${esc(c.id)}"><td><b>${esc(c.name)}</b><div class="tiny muted mono">${esc(c.id)}</div></td><td class="small">${esc(c.source)}</td><td class="small">${esc(c.email || '—')}</td><td class="small muted">${fmtD(c.created_at)}</td><td onclick="event.stopPropagation()">${c.source === 'Email' ? `<button class="btn sm" data-findcv="${esc(c.id)}">Find resume</button>` : ''}</td></tr>`).join('') || '<tr><td class="empty">Every email and Drive candidate has a resume.</td></tr>'}</tbody></table></div></div>`,
        foot: `<button class="btn" data-mx>Close</button>${d.email.on ? '<button class="btn primary" data-mgo>Fetch now (300 emails)</button>' : ''}`,
        onMount: (m, close) => { $$('[data-findcv]', m).forEach((b) => (b.onclick = () => BB.findResume(b.dataset.findcv, b))); $('[data-mx]', m).onclick = close; const g = $('[data-mgo]', m); if (g) g.onclick = async () => { g.disabled = true; g.textContent = 'Reading the mailbox… (a few minutes)'; try { const r = await BB.post('/api/resumes/missing/fetch', {}); close(); BB.toast(r.skipped ? `Already running: ${r.skipped}` : `${r.read || 0} emails read · ${r.saved || 0} resumes added${(r.errors || []).length ? ` · ${r.errors.length} could not be saved` : ''}`); BB.refreshPage(); } catch (e) { BB.fail(e); g.disabled = false; g.textContent = 'Fetch now (300 emails)'; } }; } });
    };
    // Industry: Jewellery unless another (or "All industries") is picked; designations follow the industry.
    const desigs = [...new Set([...s.jobs.map((j) => j.title), ...(r.designations || [])])];
    const sel = (k, label, opts) => `<select data-f="${k}"><option value="">${label}</option>${opts.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(q[k] || '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
    const cf = candFilters(q, desigs, (r.quick || {}).skills, r.facets);
    const total = r.total ?? r.rows.length; const filtered = anyCandFilter(q) || q.q || q.biz || q.looking || q.status || q.updated || q.notice || q.stale;
    const LOOK_BADGE = { 'Actively looking': 'b-green', 'Open to offers': 'b-primary', 'Not reachable': 'b-amber', Placed: 'b-gold' };
    const bulkBtn = (a, label, cls = '') => `<button class="btn sm ${cls}" data-bulk="${a}" disabled>${label}</button>`;
    // An open segment: its name, live count and filters, with the segment's own buttons.
    const segHead = seg ? `<section class="card cand-panel seg-head"><div class="cand-result"><div class="stack-sm" style="min-width:0"><div class="cand-count"><b>${esc(seg.name)}</b>${seg.shared ? ' <span class="badge b-primary tiny">Shared</span>' : ''} <span class="faint">· ${total} candidate${total === 1 ? '' : 's'} now${seg.mine ? '' : ` · made by ${esc(seg.owner)}`}</span></div><div class="row" style="gap:4px">${segChips(seg.query)}</div></div>
      <div class="row cand-seg">${segButtons(seg, seg.can_download, false)}</div></div></section>` : '';
    // Filters and saved segments in one card; the selection bar; then the table in its own scroll box.
    const head = seg ? segHead : `<section class="card cand-panel">
      <div class="filters cand-filters"><input placeholder="Search name, ID, phone, job…" value="${esc(q.q || '')}" data-q aria-label="Search candidates">${cf.main}${multiSel('worked', 'Worked at: any business', 'business types', BB.boot.business_types || ['Manufacturer', 'Wholesaler', 'Retailer'], q.worked)}${multiSel('looking', 'Current job status', 'job statuses', BB.boot.job_statuses || [], q.looking)}${(r.ads || []).length || q.ad ? sel('ad', 'All ad campaigns', r.ads || [q.ad]) : ''}
      <details class="more-f" ${BB.moreFiltersOpen ? 'open' : ''}><summary class="btn sm">${moreBtn(cf.count(['notice', 'updated', 'stale']))}</summary><div class="card more-pop">
        ${cf.more}
        <div class="grid g2"><label class="mf"><span>Profile last updated</span>${sel('updated', 'Any time', [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']])}</label><label class="mf"><span>Notice period up to (days)</span><input type="number" min="0" placeholder="Days" data-f="notice" value="${esc(q.notice || '')}"></label></div>
        <label class="row small mf-check"><input type="checkbox" data-f="stale" ${q.stale ? 'checked' : ''}> Only profiles not updated in 90+ days</label></div></details></div>
      ${activeChips(q)}
      <div class="cand-result"><div class="cand-count"><b>${total}</b> candidate${total === 1 ? '' : 's'}</div>
        ${superAdmin && r.quick ? `<div class="chips cand-views"><button class="chip ${!q.new && !q.agency ? 'on' : ''}" data-view="">All <span>${r.quick.all ?? r.total ?? ''}</span></button><button class="chip ${q.new ? 'on' : ''}" data-view="new">New <span>${r.quick.new}</span></button><button class="chip ${q.agency === 'none' ? 'on' : ''}" data-view="none">Unassigned <span>${r.quick.unassigned}</span></button>${r.quick.check ? `<button class="chip" data-view="check">Needs checking <span>${r.quick.check}</span></button>` : ''}</div>` : ''}
        <div class="row cand-seg">${filtered ? '<button class="cand-clear" data-clear title="Clear all filters"><span aria-hidden="true">✕</span> Clear</button>' : ''}${saved.length ? sel('saved', 'Open a segment…', saved.map((x) => [x.id, x.name])) : ''}${editing ? `<button class="btn sm primary" data-updseg>Update “${esc(editing.name)}”</button>` : ''}<button class="btn sm" data-save>${editing ? 'Save as new segment' : 'Save as segment'}</button></div></div>
    </section>`;
    el.innerHTML = `${head}
    <div class="card bulkbar bulk-card cand-bulk" data-bulkbar>${BB.bulkHead('candidate', 'data-selcount')}
      ${bulkBtn('add_to_job', 'Add to a job')}${!me.accounts_only ? bulkBtn('alert', 'Send campaign', 'gold') : ''}${bulkBtn('ask_profile', 'Ask for resume & details')}${bulkBtn('ask_status', 'Ask job status')}${bulkBtn('set_looking', 'Set job status')}${bulkBtn('note', 'Add note')}${bulkBtn('followup', 'Follow-up')}${!me.accounts_only ? `${bulkBtn('assign', 'Assign recruiter')}${bulkBtn(q.archived ? 'unarchive' : 'archive', q.archived ? 'Unarchive' : 'Archive')}` : ''}${superAdmin ? `${bulkBtn('agency', 'Assign to agency')}${bulkBtn('welcome', 'Send account link')}${bulkBtn('download', 'Download selected')}` : ''}${!me.accounts_only ? bulkBtn('delete', 'Delete', 'danger') : ''}<button class="btn sm ghost" data-unsel hidden>Clear selection</button></div>
    <div class="card cand-table">${BB.table([
      { t: 'Candidate', sort: 'name', cls: 'name-col', f: (c) => `<b>${esc(c.name)}</b>${c.is_new ? ' <span class="dot new" title="New"></span>' : ''}${c.opted_out ? ' <span class="badge b-red tiny">STOP</span>' : ''}<div class="cand-phone ${c.phone_hidden ? 'faint' : 'muted'}">${esc(c.whatsapp)}</div>` },
      { t: 'Role and domain', sort: 'job_wanted', cls: 'wrap', f: (c) => `${esc(c.job_wanted) || '<span class="faint">—</span>'}<div class="tiny muted">${[(c.exp_business || []).length ? ((c.exp_business || []).includes('Retailer') ? 'B2C' : 'B2B') : '', c.domain && c.domain !== 'Not clear' ? c.domain : ''].filter(Boolean).map(esc).join(' · ')}</div>` },
      { t: 'Source', sort: 'source', cls: 'src-col', f: (c) => `<span class="src-cut" title="${esc(c.ad_name || c.ad_set || c.ad_campaign || c.source || '')}">${esc(c.source || '—')}</span>` },
      { t: 'Skills', cls: 'skills-col', f: (c) => { const sk = c.skills || []; return sk.length ? `<div class="sk-wrap">${sk.slice(0, 5).map((x) => `<span class="sk">${esc(x)}</span>`).join('')}${sk.length > 5 ? `<span class="sk more" title="${esc(sk.slice(5).join(', '))}">+${sk.length - 5}</span>` : ''}</div>` : '<span class="faint">—</span>'; } },
      { t: 'Experience', sort: 'exp_total', desc: 1, f: (c) => `${c.exp_total === null || c.exp_total === undefined ? '—' : `${c.exp_total} yrs`}<div class="tiny muted">Jewellery: ${jewYrs(c.exp_jewellery)}</div>${c.exp_salary ? `<div class="tiny muted">Expects ${inr(c.exp_salary / 12)}/mo</div>` : ''}` },
      { t: 'City', sort: 'city', cls: 'city-col', f: (c) => esc(c.city) },
      { t: 'Job status', sort: 'status', cls: 'stack-col', f: (c) => BB.jobStatusBadge(c.job_status || c.status) },
      { t: 'Applied', sort: 'created_at', desc: 1, f: (c) => fmtD(c.created_at), hideSm: 1 },
    ], r.rows, { sorted: q, open: (c) => `candidate:${c.id}`, select: true, scroll: true, empty: filtered ? 'No candidates match these filters.' : 'No candidates yet.' })}${BB.pager(r)}</div>`;
    // More filters stays open while filters in it are changed (each change redraws the list).
    const mf = $('.more-f', el); if (mf) mf.ontoggle = () => { BB.moreFiltersOpen = mf.open; };
    { const cl = $('[data-clear]', el); if (cl) cl.onclick = clearCandFilters; }
    wireDl(actions); BB.wirePager(el);
    // Selection bar: says how many are ticked; the actions switch on only when something is ticked.
    const bar = $('[data-bulkbar]', el);
    const onSel = () => { const n = BB.selected(el).length; $('[data-selcount]', bar).textContent = BB.bulkCount('candidate', n); bar.classList.toggle('has-sel', n > 0); $$('[data-bulk]', bar).forEach((b) => { b.disabled = !n; }); $('[data-unsel]', bar).hidden = !n; };
    BB.wireSelect(el, onSel);
    $('[data-unsel]', bar).onclick = () => { $$('[data-sel], [data-all]', el).forEach((x) => { x.checked = false; }); onSel(); };
    // A shadow on the fixed columns once the table is scrolled sideways, so it is clear more columns sit to the right.
    const box = $('.tbl-scroll', el); if (box) { const edge = () => { box.classList.toggle('scrolled-x', box.scrollLeft > 2); box.classList.toggle('more-x', box.scrollLeft + box.clientWidth < box.scrollWidth - 2); }; box.addEventListener('scroll', edge, { passive: true }); edge(); }
    $$('[data-view]', el).forEach((b) => (b.onclick = () => { const v = b.dataset.view; if (v === 'check') return BB.setQ({ tab: 'check', page: '' }); BB.setQ({ new: v === 'new' ? '1' : '', agency: v === 'none' ? 'none' : '', page: 1 }); }));
    const openSeg = (id) => BB.go(`team/candidates?tab=segments&seg=${id}`);
    if (seg) {
      $('[data-backseg]', actions).onclick = () => BB.setQ({ seg: '', page: '' });
      wireSegButtons(el, () => seg);
    } else {
      let t; $('[data-q]', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => BB.setQ({ q: e.target.value, page: 1 }), 350); };
      BB.wireMultiSel(el); wireChips(el, q); $$('[data-f]', el).forEach((i) => (i.onchange = () => { if (i.dataset.f === 'saved') { if (i.value) openSeg(i.value); return; } BB.setQ({ [i.dataset.f]: i.type === 'checkbox' ? (i.checked ? '1' : '') : i.value, ...(i.dataset.f === 'industry' ? { job: '' } : {}), page: 1 }); }));
      const filtersNow = { ...q, page: undefined, tab: undefined, editseg: undefined };
      $('[data-save]', el).onclick = () => BB.ask({ title: 'Save as segment', fields: [{ name: 'name', label: 'Segment name', placeholder: 'e.g. Jaipur sales, 3+ yrs jewellery' }], submit: (v) => BB.post('/api/saved-searches', { name: v.name, query: filtersNow }) }).then((x) => { if (x) { BB.toast('Segment saved'); openSeg(x.id); } });
      const upd = $('[data-updseg]', el); if (upd) upd.onclick = async () => { try { await BB.patch(`/api/segments/${editing.id}`, { query: filtersNow }); BB.toast(`“${editing.name}” updated`); openSeg(editing.id); } catch (e) { BB.fail(e); } };
      $('[data-up]', actions).onclick = () => BB.setQ({ tab: 'import' });
    }
    $$('[data-bulk]', el).forEach((b) => (b.onclick = () => {
      const ids = BB.selected(el); if (!ids.length) return BB.toast('Select some candidates first', true);
      if (b.dataset.bulk === 'download') { const rows = r.rows.filter((c) => ids.includes(c.id)); const csv = '﻿' + [['id', 'name', 'phone', 'job_wanted', 'city', 'experience', 'status'], ...rows.map((c) => [c.id, c.name, c.whatsapp, c.job_wanted, c.city, c.exp_total, c.status])].map((x) => x.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'candidates-selected.csv'; a.click(); return; }
      if (b.dataset.bulk === 'delete') return BB.deleteRecords('candidate', ids);
      // the resume & details request on WhatsApp (skips anyone who already has both)
      if (b.dataset.bulk === 'ask_status') return BB.confirm('Ask job status', `Send ${ids.length} candidate${ids.length === 1 ? '' : 's'} the WhatsApp question "Looking for a job / Not interested now"? Their tap sets the job status. Anyone placed through us or with an application in process is skipped.`, 'Send').then((ok) => ok && BB.post('/api/candidates/bulk', { ids, action: 'ask_status' }).then((x) => { BB.toast(`Asked ${x.done}${x.errors.length ? ` · ${x.errors.length} not sent (${x.errors[0].split(': ').slice(1).join(': ')})` : ''}`, !x.done); BB.refreshPage(); }).catch((e) => BB.fail(e)));
      if (b.dataset.bulk === 'ask_profile') return BB.confirm('Ask for resume & details', `Send ${ids.length} candidate${ids.length === 1 ? '' : 's'} the WhatsApp message asking for their resume, current and expected salary and notice period? Anyone who already has all of them is skipped.`, 'Send').then((ok) => ok && BB.post('/api/candidates/bulk', { ids, action: 'ask_profile' }).then((x) => { BB.toast(`Sent to ${x.done}${x.errors.length ? ` · ${x.errors.length} not sent (${x.errors[0].split(': ').slice(1).join(': ')})` : ''}`, !x.done); BB.refreshPage(); }).catch((e) => BB.fail(e)));
      const act = b.dataset.bulk; const n = `${ids.length} candidate${ids.length === 1 ? '' : 's'}`;
      // Shows what was done and, if some were skipped, why (e.g. another agency's candidate).
      const report = (res) => { if (!res) return; BB.toast(`${res.done} done${res.errors.length ? `, ${res.errors.length} skipped` : ''}`); if (res.errors.length) BB.modal({ title: `${res.errors.length} skipped`, body: `<div class="stack-sm small">${res.errors.slice(0, 30).map((x) => `<div>${esc(x)}</div>`).join('')}${res.errors.length > 30 ? `<div class="faint">…and ${res.errors.length - 30} more</div>` : ''}</div>` }); BB.refreshPage(); };
      const send = (extra) => BB.post('/api/candidates/bulk', { ids, action: act, ...extra });
      const lead = (action) => BB.post('/api/leads/bulk', { type: 'candidate', ids, action }).then((x) => ({ done: x.done, errors: x.skipped })).then(report).catch(BB.fail);
      if (act === 'welcome') return BB.confirm('Send account link on WhatsApp', `${n} get their welcome message with the link to their profile. People who said STOP are skipped.`, 'Send').then((ok) => ok && lead('welcome'));
      if (act === 'agency') return BB.api('/api/users').then((d) => BB.ask({ title: `Assign to agency · ${n}`, note: 'The agency admin gets a task alert.', fields: [{ name: 'agency_id', label: 'Agency', type: 'select', options: d.agencies.filter((a) => a.status === 'Active').map((a) => [a.id, a.name]) }], ok: 'Assign', submit: (v) => BB.post('/api/leads/assign', { type: 'candidate', ids, agency_id: v.agency_id }) })).then((x) => { if (x) { BB.toast(`${x.count} assigned`); BB.refreshPage(); } });
      if (act === 'alert') return BB.flow.campaign({ ids, label: n });
      if (act === 'set_looking') return BB.ask({ title: `Set job status · ${n}`, fields: [{ name: 'looking', label: 'Current job status', type: 'select', options: BB.boot.looking, placeholder: false }], ok: 'Update', submit: send }).then(report);
      if (act === 'note') return BB.ask({ title: `Add note · ${n}`, fields: [{ name: 'text', label: 'Note', type: 'textarea', placeholder: 'e.g. Called 29 Oct, no answer' }], ok: 'Add note', submit: send }).then(report);
      if (act === 'followup') return BB.ask({ title: `Follow-up · ${n}`, note: 'You get a reminder on My day and the bell at this time.', fields: [{ name: 'at', label: 'When', type: 'datetime-local' }, { name: 'note', label: 'What to do', opt: true, placeholder: 'e.g. Call back about the Jaipur showroom job' }], ok: 'Set follow-up', submit: (v) => send({ ...v, at: v.at ? BB.fromLocalInput(v.at) : '' }) }).then(report);
      if (act === 'archive' || act === 'unarchive') return BB.confirm(act === 'archive' ? 'Archive candidates' : 'Unarchive candidates', act === 'archive' ? `${n} will move to Archived. Nothing is deleted.` : `${n} will come back to the resume bank.`, act === 'archive' ? 'Archive' : 'Unarchive').then((ok) => ok && send({}).catch(BB.fail).then(report));
      if (act === 'assign') return BB.api('/api/users').then((d) => BB.ask({ title: `Assign recruiter · ${n}`, note: 'They get an alert. Candidates from another agency are skipped.', fields: [{ name: 'recruiter_id', label: 'Recruiter', type: 'select', options: d.users.filter((x) => x.level !== 'super' && x.status === 'On').map((x) => [x.id, `${x.name}${isSuper(me) ? ` · ${x.agency_name}` : ''}`]) }], ok: 'Assign', submit: send })).then(report);
      BB.pickJob(async (jid) => report(await send({ job_id: jid }).catch(BB.fail)));
    }));
    // Same questions and choices as the public "I want a job" form, plus the team-only salary, notice, industry and source.
    const fromCv = $('[data-fromcv]', actions); if (fromCv) fromCv.onclick = () => addFromResumes();
    const newBtn = $('[data-new]', actions); if (newBtn) newBtn.onclick = () => {
      const o = BB.seekerOptions; let cv = null;
      BB.ask({ title: 'Create candidate account', wide: true, fields: [
        `<div class="cv-first" data-cc-cv><div class="cv-ic" aria-hidden="true">CV</div><div class="grow"><b>CV</b> <span class="opt">(optional)</span><div class="muted small" data-cc-cvname>PDF or Word, max 10 MB</div></div><button type="button" class="btn sm" data-cc-pick>Attach CV</button></div>`,
        `<div class="grid g2">${field({ name: 'name', label: 'Name' })}${field({ name: 'email', label: 'Email', type: 'email', opt: true })}</div>`,
        `<div class="grid g2">${field({ name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true, placeholder: '10 digits' })}<label class="field" data-f="job_wanted"><span class="lab">Job wanted</span><select name="job_wanted" data-cc-job>${BB.jobOptions('')}</select></label></div>`,
        `<div class="hidden" data-cc-other>${field({ name: 'job_other', label: 'Type the job they want' })}</div>`,
        `<div class="grid g2">${field({ name: 'city', label: 'City they want to work in', list: 'cities' })}${field({ name: 'state', label: 'State', opt: true, placeholder: 'Fills in from the city' })}</div>`,
        field({ name: 'experience', label: 'Experience', type: 'choice', options: o.EXPERIENCE }),
        field({ name: 'exp_jewellery', label: 'Experience in the jewellery industry', type: 'select', opt: true, options: o.JEWEL_EXP, placeholder: 'Select years' }),
        `<div class="field hidden" data-f="exp_business" data-cc-biz><span class="lab">Where have they worked?</span><div class="row">${o.BUSINESS.map((x) => `<label class="row small"><input type="checkbox" name="biz_${x}"> ${x}</label>`).join('')}</div><span class="hint">Tick all that apply.</span></div>`,
        `<div class="grid g3">${field({ name: 'cur_salary_month', label: 'Current ₹/month', type: 'number', opt: true })}${field({ name: 'exp_salary_month', label: 'Expected ₹/month', type: 'number', opt: true })}${field({ name: 'notice_days', label: 'Notice (days)', type: 'number', opt: true })}</div>`,
        `<div class="grid g2">${field({ name: 'industry', label: 'Industry', type: 'select', options: s.industry_list || ['Jewellery'], value: s.default_industry || 'Jewellery' })}${field({ name: 'source', label: 'Source', type: 'select', options: s.lead_sources })}</div>`,
        { name: 'consent', label: 'The candidate agreed to be contacted on WhatsApp, phone and email, and to share their profile with employers', type: 'check' },
      ], ok: 'Create', submit: (v) => BB.post('/api/candidates', {
        name: v.name, email: v.email, whatsapp: BB.spokenToDigits(v.whatsapp) || v.whatsapp, job_wanted: v.job_wanted, job_other: v.job_other, city: v.city, state: v.state,
        experience: v.experience, exp_jewellery: v.exp_jewellery, exp_business: o.BUSINESS.filter((x) => v[`biz_${x}`]),
        cur_salary_month: v.cur_salary_month, exp_salary_month: v.exp_salary_month, notice_days: v.notice_days === '' ? null : Number(v.notice_days),
        industry: v.industry, source: v.source, consent: !!v.consent, cv,
      }) }).then((x) => { if (x) { BB.toast(x.isNew ? `${x.id} created` : `Already in the bank as ${x.id} — details added`); BB.refreshPage(); BB.open('candidate', x.id); } });
      // Wire the extra behaviour once the form is on screen: CV picker, "Other" job, and the work-history box for experienced people.
      setTimeout(() => {
        const pick = $('[data-cc-pick]'); if (!pick) return;
        pick.onclick = async () => { cv = await BB.pickFile(); $('[data-cc-cvname]').textContent = cv ? cv.name : 'PDF or Word, max 10 MB'; };
        const job = $('[data-cc-job]'); const other = () => $('[data-cc-other]').classList.toggle('hidden', job.value !== 'Other'); job.addEventListener('change', other); other();
        const biz = $('[data-cc-biz]');
        const showBiz = () => { const e = $('[name=experience]:checked'); const on = !!e && e.value !== 'Fresher'; biz.classList.toggle('hidden', !on); if (!on) $$('input', biz).forEach((x) => { x.checked = false; }); const jw = $('[name=exp_jewellery]'); if (e && e.value === 'Fresher' && !jw.value) jw.value = 'No experience'; };
        $$('[name=experience]').forEach((r) => r.addEventListener('change', showBiz));
      }, 60);
    };
  }
  async function gapView(el) {
    const d = await BB.api('/api/gap');
    const cls = (n) => (n >= 20 ? 'c-green' : n >= 5 ? 'c-amber' : 'c-red');
    const setting = BB.gapSetTargets; const canSet = !BB.me.user.accounts_only;
    el.innerHTML = `${canSet ? `<div class="row" style="margin-bottom:8px"><button class="btn sm ${setting ? 'primary' : ''}" data-settarget>${setting ? 'Done setting targets' : 'Set targets'}</button>${setting ? '<span class="small muted">Click a box to set its target count.</span>' : ''}</div>` : ''}<p class="small muted">Active candidates (actively looking or open to offers) by city and department. <span class="badge b-red">under 5</span> <span class="badge b-amber">under 20</span> <span class="badge b-green">20+</span>. Click a box to see them.</p>
      <div class="card tbl-wrap"><table class="tbl gap"><thead><tr><th>City</th>${d.depts.map((x) => `<th style="text-align:center">${esc(x)}</th>`).join('')}</tr></thead><tbody>${d.cities.map((c) => `<tr><td><b>${esc(c)}</b></td>${d.depts.map((dp) => { const n = d.grid[`${c}|${dp}`] || 0; const tgt = d.targets[`${c}|${dp}`]; return `<td class="cell ${cls(n)}" data-cell="${esc(c)}|${esc(dp)}" title="${tgt ? `Target ${tgt}` : ''}">${n}${tgt ? `<div class="tiny" style="font-weight:500">/ ${tgt}</div>` : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    $$('[data-cell]', el).forEach((td) => (td.onclick = () => {
      const [city, dept] = td.dataset.cell.split('|');
      if (!setting) return BB.setQ({ tab: '', city, dept, looking: '' });
      BB.ask({ title: `Target · ${city} × ${dept}`, fields: [{ name: 'target', label: 'Active candidates wanted (empty to clear)', type: 'number', value: d.targets[td.dataset.cell] || '' }], submit: (v) => BB.post('/api/gap/target', { cell: td.dataset.cell, target: v.target }) }).then((x) => x && gapView(el));
    }));
    const st = $('[data-settarget]', el); if (st) st.onclick = () => { BB.gapSetTargets = !setting; gapView(el); };
  }
  // The Excel importer in a pop-up, for Clients and Leads.
  BB.importModal = (kind, me, title) => { const m = BB.modal({ title, wide: true, body: '<div data-imp></div>', onClose: () => BB.refreshPage() }); importView($('[data-imp]', m.el), me, kind); };
  async function tieups(el) {
    const list = await BB.api('/api/tieups');
    el.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted small grow">Colleges, institutes and local agencies that send us candidate lists. Upload a list from the Upload Excel tab and pick the tie-up to link each candidate to it.</span><button class="btn primary sm" data-add>+ Add tie-up</button></div>
      <div class="card">${BB.table([{ t: 'Name', f: (t) => `<b>${esc(t.name)}</b>` }, { t: 'Type', f: (t) => esc(t.type) }, { t: 'City', f: (t) => esc(t.city) }, { t: 'Contact', f: (t) => `${esc(t.contact)} <span class="mono small">${esc(t.phone)}</span>` }, { t: 'Owner', f: (t) => esc(t.owner_name) }, { t: 'Last list', f: (t) => fmtD(t.last_list) }, { t: 'Candidates', num: 1, f: (t) => `<a href="/team/candidates?tieup=${t.id}">${t.candidates}</a>` }, { t: '', f: (t) => `<button class="btn sm" data-edit="${t.id}">Edit</button>` }], list)}</div>`;
    const form = (t = {}) => BB.ask({ title: t.id ? 'Edit tie-up' : 'Add tie-up', fields: [{ name: 'name', label: 'Name', value: t.name }, `<div class="grid g2">${field({ name: 'type', label: 'Type', type: 'select', options: ['College', 'Institute', 'Local agency'], value: t.type || 'College', placeholder: false })}${field({ name: 'city', label: 'City', value: t.city, list: 'cities' })}</div>`, `<div class="grid g2">${field({ name: 'contact', label: 'Contact person', value: t.contact })}${field({ name: 'phone', label: 'Phone', value: t.phone })}</div>`], submit: (v) => BB.post('/api/tieups', { ...v, id: t.id }) }).then((x) => x && BB.refreshPage());
    $('[data-add]', el).onclick = () => form();
    $$('[data-edit]', el).forEach((b) => (b.onclick = () => form(list.find((x) => String(x.id) === b.dataset.edit))));
  }
  async function importView(el, me, preset) {
    const ties = await BB.api('/api/tieups');
    el.innerHTML = `<div class="card pad stack" style="max-width:860px"><div class="grid g3">${field({ name: 'kind', label: 'What is in the file', type: 'select', options: [['candidates', 'Candidates (+ applications)'], ...(!me.accounts_only ? [['clients', 'Clients (Client Master)'], ['jobs', 'Job openings']] : [])], value: preset || 'candidates', placeholder: false })}${field({ name: 'source', label: 'Source', type: 'select', options: BB.boot.lead_sources, value: preset === 'clients' ? (BB.boot.lead_sources.includes('Excel import') ? 'Excel import' : BB.boot.lead_sources[0]) : 'Naukri' })}${field({ name: 'tieup', label: 'From tie-up', type: 'select', options: ties.map((t) => [t.id, t.name]), opt: true })}</div>
      <div class="row"><button class="btn primary" data-pick>Choose Excel (.xlsx) or CSV</button><span class="small muted">Columns are matched once and saved for next time. No WhatsApp messages are sent on import.</span></div><div data-step></div></div>`;
    $('[data-pick]', el).onclick = async () => {
      const f = await BB.pickFile('.xlsx,.csv'); if (!f) return;
      const opts = BB.formValues(el);
      let prev; try { prev = await BB.post('/api/import/preview', { kind: opts.kind, source: opts.source, name: f.name, base64: f.base64 }); } catch (e) { return BB.fail(e); }
      const step = $('[data-step]', el);
      step.innerHTML = `<hr class="sep"><h3>Match columns ${prev.saved ? '<span class="badge b-green">saved match used</span>' : ''}</h3><div class="grid g3" style="margin-top:8px">${prev.fields.map((fd) => `<label class="field"><span class="lab">${esc(fd.label)}</span><select data-map="${fd.key}"><option value="">— skip —</option>${prev.headers.map((h, i) => `<option value="${i}" ${String(prev.map[fd.key]) === String(i) ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>
        <h3 style="margin-top:14px">Preview (${prev.total} rows)</h3><div class="card tbl-wrap" style="max-height:300px;overflow:auto"><table class="tbl"><thead><tr>${prev.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${prev.sample.map((row) => `<tr>${prev.headers.map((_, i) => `<td class="small">${esc(row[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-run>Import ${prev.total} rows</button></div><div data-out></div>`;
      $('[data-run]', step).onclick = async (ev) => {
        ev.target.disabled = true; const map = {}; $$('[data-map]', step).forEach((s) => { if (s.value !== '') map[s.dataset.map] = Number(s.value); });
        try {
          const res = await BB.post('/api/import/run', { kind: opts.kind, source: opts.source, tieup_id: opts.tieup || null, name: f.name, base64: f.base64, map });
          $('[data-out]', step).innerHTML = `<div class="notice ${res.errors.length ? 'warn' : ''}" style="margin-top:12px"><b>${res.created} new, ${res.updated} updated${res.apps ? `, ${res.apps} applications` : ''}.</b>${res.errors.length ? `<div style="margin-top:6px">${res.errors.length} row(s) could not be loaded:</div><div class="small" style="max-height:200px;overflow:auto">${res.errors.map((er) => `<div>Row ${er.line}: ${esc(er.reason)}</div>`).join('')}</div>` : ''}</div>`;
        } catch (e) { BB.fail(e); } finally { ev.target.disabled = false; }
      };
    };
  }

  // ---------- Applications: board / list ----------
  P.applications = async ({ el, actions, q, me }) => {
    const view = q.view === 'board' ? 'board' : 'list'; // List first; Board when asked
    actions.innerHTML = `${['super', 'admin'].includes(me.level) ? '<button class="btn" data-adapps>Ad applicants</button>' : ''}<button class="btn" data-automap>Match candidates to jobs</button><div class="seg"><button data-v="board" class="${view === 'board' ? 'on' : ''}">Board</button><button data-v="list" class="${view === 'list' ? 'on' : ''}">List</button></div>${view === 'list' ? dl(`/api/applications?${BB.qs(q, { format: 'xlsx', view: undefined })}`) : ''}`;
    $$('[data-v]', actions).forEach((b) => (b.onclick = () => BB.setQ({ view: b.dataset.v === 'list' ? '' : b.dataset.v })));
    const adb = $('[data-adapps]', actions); if (adb) adb.onclick = async () => {
      let d; try { d = await BB.post('/api/applications/ad-applicants', { dry: true }); } catch (e) { return BB.fail(e); }
      const will = d.rows.filter((x) => x.jobs.length && !/^Hired/.test(x.result)).length;
      BB.modal({ title: 'Ad applicants without an open application', wide: true, body: `<p class="small muted" style="margin-top:0">Candidates from an ad or a job platform in the last 90 days. Each one goes onto the open job their ad (or the job they asked for) points to. This also runs by itself every 10 minutes.</p><div class="card tbl-wrap" style="max-height:55vh;overflow:auto"><table class="tbl"><thead><tr><th>Candidate</th><th>Ad / source</th><th>Wants</th><th>What happens</th></tr></thead><tbody>${d.rows.map((x) => `<tr><td><a href="#" data-open="candidate:${esc(x.id)}">${esc(x.name || x.id)}</a><div class="tiny muted mono">${esc(x.id)}</div></td><td class="small">${esc(x.ad || '—')}<div class="tiny muted">${esc(x.source || '')}</div></td><td class="small">${esc(x.job_wanted || '—')}</td><td class="small">${esc(x.result)}</td></tr>`).join('') || '<tr><td class="empty" colspan="4">Every ad applicant already has an open application.</td></tr>'}</tbody></table></div>`,
        foot: `<button class="btn" data-adx>Close</button>${will ? `<button class="btn primary" data-adgo>Open ${will} application${will === 1 ? '' : 's'} now</button>` : ''}`,
        onMount: (mm, close) => { $('[data-adx]', mm).onclick = close; const g = $('[data-adgo]', mm); if (g) g.onclick = async () => { g.disabled = true; try { const r = await BB.post('/api/applications/ad-applicants', {}); close(); BB.toast(`${r.made} application${r.made === 1 ? '' : 's'} opened`); BB.refreshPage(); } catch (e) { BB.fail(e); g.disabled = false; } }; } });
    };
    $('[data-automap]', actions).onclick = () => autoMap();
    wireDl(actions);
    if (view === 'board') {
      const d = await BB.api(`/api/board?${BB.qs({ job: q.job })}`);
      el.innerHTML = `<div class="filters"><select data-job><option value="">All job openings</option>${d.jobs.map((j) => `<option value="${j.id}" ${q.job === j.id ? 'selected' : ''}>${esc(j.title)} — ${esc(j.client)}</option>`).join('')}</select><span class="small muted">Grey cards are on hold. Days turn red after 7.</span></div>
        <div class="board">${d.steps.map((s) => { const cards = d.apps.filter((a) => a.step === s); return `<div class="col"><h4>${esc(s)} <span>${cards.length}</span></h4>${cards.map((a) => `<div class="acard ${a.on_hold ? 'hold' : ''}" data-open="application:${a.id}"><div class="t">${esc(a.candidate_name)}</div><div class="s">${esc(a.job_title)} · ${esc(a.client_name)}</div>${a.on_hold ? `<div class="tiny">⏸ ${esc(a.hold_reason || '')}</div>` : ''}<div class="foot"><span class="days ${a.days_in_step >= 7 ? 'late' : ''}">${a.days_in_step}d</span><span class="right row nowrap" onclick="event.stopPropagation()">${BB.waBtn({ ptype: ['Sent to client', 'Client interview'].includes(a.step) ? 'client' : 'candidate', pid: ['Sent to client', 'Client interview'].includes(a.step) ? a.client_id : a.candidate_id, ap: a.id }, '', 'btn sm icon wa')}${s !== 'Offer made' && s !== 'Offer accepted' && s !== 'Joined' ? `<button class="btn sm icon" title="Move to next step" data-next="${a.id}">→</button>` : ''}</span></div></div>`).join('')}</div>`; }).join('')}</div>`;
      $('[data-job]', el).onchange = (e) => BB.setQ({ job: e.target.value });
      $$('[data-next]', el).forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); try { await BB.post(`/api/applications/${b.dataset.next}/step`, { next: true }); BB.toast('Moved'); BB.refreshPage(); } catch (er) { BB.fail(er); } }));
      return;
    }
    const r = await BB.api(`/api/applications?${BB.qs(q, { view: undefined })}`);
    const owners = !me.accounts_only ? (await BB.api('/api/users')).users.filter((u) => u.status === 'On') : [];
    const waFormats = [['candidate:bbhs_details_request', 'Candidate · ask salary and notice'], ['candidate:bbhs_interview_reminder', 'Candidate · interview reminder'], ['candidate:bbhs_joining_reminder', 'Candidate · joining reminder'], ['candidate:bbhs_post_join_checkin', 'Candidate · check-in'], ['client:bbhs_shortlist_ready', 'Client · profiles ready'], ['client:bbhs_feedback_request', 'Client · ask for feedback']];
    const o = r.options || {}; const opt = (k, label, list) => `<select data-af="${k}" aria-label="${label}"><option value="">${label}</option>${list.map((x) => { const [v, t] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(q[k] || '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
    const AF = ['q', 'title', 'job', 'client', 'stage', 'exp', 'screen', 'source', 'ad', 'owner', 'from', 'to', 'score_min', 'score_max']; const filtered = AF.some((k) => q[k]);
    const EXP_BANDS = [['0-1', 'Under 1 year'], ['1-3', '1–3 years'], ['3-5', '3–5 years'], ['5-10', '5–10 years'], ['10+', '10+ years'], ['none', 'Not given']];
    // Where the open applications are (with the filters above): pick a stage to work through it.
    const sc = r.stage_counts || {}; const allOpen = Object.values(sc).reduce((t, n) => t + n, 0);
    const stageTabs = q.closed === '1' ? '' : `<div class="stage-tabs">${[['', 'All open', allOpen], ...['Screening', 'Telephonic', 'Virtual', 'Client', 'Offer'].map((s) => [s, BB.stageLabel(s), sc[s] || 0])].map(([k, l, n]) => `<button data-stage="${k}" class="${(q.stage || '') === k ? 'on' : ''}"><b>${n}</b><span>${esc(l)}</span></button>`).join('')}<label class="mine-tog small"><input type="checkbox" data-mine ${q.mine === '1' ? 'checked' : ''}> Only what I own</label></div>`;
    const stc = r.state_counts || {}; const STATE_ORDER = ['To screen', 'Eligible', 'Scheduled', 'Feedback due', 'Selected', 'On hold', 'No-show', 'Waiting for answer', 'Joining'];
    const stateLabel = (x) => (x === 'Eligible' ? `Awaiting the ${q.stage === 'Client' ? 'client round' : `${BB.stageLabel(q.stage).toLowerCase()}`}` : x);
    const stateChips = q.stage && Object.keys(stc).length ? `<div class="filters state-chips">${['', ...STATE_ORDER.filter((x) => stc[x])].map((x) => `<span class="chip ${(q.state || '') === x ? 'on' : ''}" data-state="${esc(x)}">${x ? esc(stateLabel(x)) : 'All in this stage'} <span class="faint">${x ? stc[x] : Object.values(stc).reduce((t, n) => t + n, 0)}</span></span>`).join('')}</div>` : '';
    const stageActs = (a) => BB.stageActs(a);
    // Filters in their own card (with the count); bulk actions in the selection bar below, only live once rows are ticked.
    const cn = r.counts || {};
    el.innerHTML = `<div class="tabs" style="margin-bottom:12px"><button data-apptab="" class="${q.closed === '1' ? '' : 'on'}">Open <span class="n">${cn.open ?? ''}</span></button><button data-apptab="1" class="${q.closed === '1' ? 'on' : ''}">Closed <span class="n">${cn.closed ?? ''}</span></button></div>${q.closed === '1' ? `<div class="small muted" style="margin:-4px 0 10px">Joined (${cn.joined ?? 0}), rejected, declined and every other closed application. Joined ones stay Joined.</div>` : ''}${stageTabs}${stateChips}<section class="card cand-panel"><div class="filters cand-filters"><input placeholder="Search candidate, job, ID…" value="${esc(q.q || '')}" data-q aria-label="Search applications">${multiSel('title', 'All designations', 'designations', o.titles || [], q.title)}${opt('job', 'All job openings', o.jobs || [])}${opt('client', 'All clients', o.clients || [])}${opt('stage', 'All stages', [['Screening', 'Screening'], ['Telephonic', 'Telephonic round'], ['Virtual', 'Virtual round'], ['Client', 'Client round'], ['Offer', 'Offer']])}${multiSel('exp', 'Any experience', 'ranges', EXP_BANDS, q.exp)}<input type="number" min="0" max="100" data-af="score_min" value="${esc(q.score_min || '')}" placeholder="Score from" aria-label="Score from"><input type="number" min="0" max="100" data-af="score_max" value="${esc(q.score_max || '')}" placeholder="Score up to" aria-label="Score up to">${opt('screen', 'Any screening', [['none', 'Not screened yet'], ...(r.screens || [])])}${opt('source', 'Any source', o.sources || [])}${(r.ads || []).length || q.ad ? opt('ad', 'Any ad', r.ads || [q.ad]) : ''}${!me.accounts_only ? opt('owner', 'Any owner', o.owners || []) : ''}<label class="mf-inline small">From <input type="date" data-af="from" value="${esc(q.from || '')}"></label><label class="mf-inline small">to <input type="date" data-af="to" value="${esc(q.to || '')}"></label></div>
      <div class="cand-result"><div class="cand-count"><b>${r.total ?? r.rows.length}</b> application${(r.total ?? r.rows.length) === 1 ? '' : 's'} <span class="faint">${filtered ? 'match these filters' : q.closed === '1' ? 'closed' : 'open'}</span></div><span class="row">${filtered ? '<button class="btn sm ghost" data-aclear>Clear filters</button>' : ''}<button class="btn sm" data-arej>Reject below a score</button></span></div></section>
      <div class="card bulkbar bulk-card cand-bulk" data-abar>${BB.bulkHead('application', 'data-acount')}<select data-bscreen class="mini" disabled><option value="">Screening…</option>${(r.screens || []).map((x) => `<option>${x}</option>`).join('')}</select><select data-bstep class="mini" disabled><option value="">Move to step…</option>${BB.boot.steps.slice(0, 5).map((s) => `<option>${s}</option>`).join('')}</select><select data-bclose class="mini" disabled><option value="">Close with reason…</option>${BB.boot.closing_reasons.map((s) => `<option>${s}</option>`).join('')}</select>${owners.length ? `<select data-bowner class="mini" disabled><option value="">Assign owner…</option>${owners.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>` : ''}<select data-bwa class="mini" disabled><option value="">Send a WhatsApp format…</option>${waFormats.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>${!me.accounts_only ? '<button class="btn sm danger" data-bdel disabled>Delete</button>' : ''}</div>
      <div class="card apps-table">${BB.table([{ t: 'Candidate', sort: 'candidate_name', f: (a) => `<b>${esc(a.candidate_name)}</b>${a.cand_placed ? ' <span class="badge b-green tiny" title="Hired through us">Hired</span>' : ''}${a.phone ? `<div class="tiny mono muted nw">${esc(a.phone)}</div>` : ''}` }, { t: 'Source', sort: 'source', cls: 'from-col', f: (a) => esc(a.source || '—') }, { t: 'Resume', f: (a) => (a.cv_file ? `<button class="btn sm" data-cvget="${esc(a.cv_file)}" aria-label="Open the resume of ${esc(a.candidate_name)} in a new tab" title="Opens in a new tab" onclick="event.stopPropagation()">${BB.icon('eye')} View CV</button>` : '<span class="faint small">None</span>') }, { t: 'Score', sort: 'score', desc: 1, f: (a) => `<span title="${esc([...(a.good || []).map((x) => `Good: ${x}`), ...(a.gaps || []).map((x) => `Not aligned: ${x}`)].join('\n'))}">${scoreBadge(a.score)}</span><div class="tiny muted nw">✓ ${(a.good || []).length} · ✗ ${(a.gaps || []).length}</div>` }, { t: 'Experience', f: (a) => (a.exp === null || a.exp === undefined ? '<span class="faint">—</span>' : `${a.exp} yr${a.exp === 1 ? '' : 's'}`) }, { t: 'Job', sort: 'job_title', f: (a) => `${esc(a.job_title)}<div class="tiny muted">${esc(a.client_name)}</div>` }, { t: 'Stage', sort: 'step', f: (a) => `${BB.stageBadge(a)}${a.on_hold ? ' <span class="badge b-outline">hold</span>' : ''}<div class="tiny muted">${esc(a.step)}</div>` }, { t: 'Next action', f: (a) => `<span class="row nowrap stage-acts" onclick="event.stopPropagation()">${stageActs(a)}</span>` }, { t: 'Days', sort: 'days_in_step', desc: 1, num: 1, f: (a) => `<span class="days ${a.days_in_step >= 7 && a.result === 'open' ? 'late' : ''}">${a.days_in_step}</span>` }, { t: 'Owner', f: (a) => esc(a.owner_name), hideSm: 1 }, { t: '', f: (a) => `<span onclick="event.stopPropagation()">${BB.waBtn({ ptype: 'candidate', pid: a.candidate_id, ap: a.id }, '', 'btn sm icon wa')}</span>` }], r.rows, { sorted: { sort: q.sort || 'score', dir: q.dir || (q.sort ? 'asc' : 'desc') }, open: (a) => `application:${a.id}`, select: true })}${BB.pager(r)}</div>`;
    BB.wirePager(el); BB.wireSelect(el); BB.wireQuickScreen(el);
    $$('[data-stage]', el).forEach((b) => (b.onclick = () => BB.setQ({ stage: b.dataset.stage, state: '', page: 1 })));
    $$('[data-state]', el).forEach((b) => (b.onclick = () => BB.setQ({ state: b.dataset.state, page: 1 })));
    const mt = $('[data-mine]', el); if (mt) mt.onchange = () => BB.setQ({ mine: mt.checked ? '1' : '', page: 1 });
    BB.wireStageActs(el, () => BB.refreshPage());
    $$('[data-cvget]', el).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); BB.openFile(b.dataset.cvget); }));
    let t; $('[data-q]', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => BB.setQ({ q: e.target.value, page: 1 }), 350); };
    BB.wireMultiSel(el); $$('[data-af]', el).forEach((x) => (x.onchange = () => BB.setQ({ [x.dataset.af]: x.value, page: 1 })));
    $('[data-arej]', el).onclick = async () => {
      const filters = Object.fromEntries(AF.filter((k) => q[k]).map((k) => [k, q[k]]));
      const v = await BB.ask({ title: 'Reject below a score', note: 'Applies to the applications shown by your filters that are still waiting at Applied or Screening.', fields: [{ name: 'score', label: 'Reject everyone scoring below', type: 'number', value: 40 }], ok: 'Check how many', submit: async (x) => { const n = Number(x.score); if (!(n > 0 && n <= 100)) { const e = new Error('Enter a score from 1 to 100'); e.field = 'score'; throw e; } return { n, ...(await BB.post('/api/applications/reject-below', { score: n, filters, dry: true })) }; } });
      if (!v) return; if (!v.count) return BB.toast(`No waiting application scores below ${v.n}`);
      if (await BB.confirm('Reject these applications?', `${v.count} application${v.count === 1 ? '' : 's'} scoring below ${v.n} will be rejected and closed.`, `Reject ${v.count}`)) { try { const r = await BB.post('/api/applications/reject-below', { score: v.n, filters }); BB.toast(`${r.done} rejected`); BB.refreshPage(); } catch (e) { BB.fail(e); } }
    };
    const ac = $('[data-aclear]', el); if (ac) ac.onclick = () => BB.setQ(Object.fromEntries(AF.map((k) => [k, ''])));
    // The selection bar comes alive when rows are ticked.
    const abar = $('[data-abar]', el); const onASel = () => { const k = BB.selected(el).length; $('[data-acount]', abar).textContent = BB.bulkCount('application', k); abar.classList.toggle('has-sel', k > 0); $$('select, button', abar).forEach((x) => { x.disabled = !k; }); };
    BB.wireSelect(el, onASel); $$('[data-sel]', el).forEach((x) => x.addEventListener('change', onASel));
    $$('[data-apptab]', el).forEach((b) => (b.onclick = () => BB.setQ({ closed: b.dataset.apptab, step: '', page: 1 })));
    const bulk = async (body) => { const ids = BB.selected(el); if (!ids.length) return BB.toast('Select some rows first', true); const res = await BB.post('/api/applications/bulk', { ids, ...body }).catch(BB.fail); if (res) { BB.toast(`${res.done} done${res.errors.length ? `, ${res.errors.length} failed: ${res.errors[0]}` : ''}`); BB.refreshPage(); } };
    $('[data-bstep]', el).onchange = async (e) => { const step = e.target.value; if (!step) return; const st = BB.boot.steps; let skip_reason; if (st.indexOf(step) >= st.indexOf('Sent to client')) { const v = await BB.ask({ title: `Move to ${step}`, fields: [{ name: 'reason', label: 'If any of our rounds are not done, why are they not needed?', type: 'textarea' }], ok: 'Move' }); if (!v) { e.target.value = ''; return; } skip_reason = v.reason; } bulk({ action: 'step', step, skip_reason }); };
    $('[data-bclose]', el).onchange = (e) => e.target.value && bulk({ action: 'close', reason: e.target.value });
    $('[data-bscreen]', el).onchange = (e) => e.target.value && bulk({ action: 'screen', verdict: e.target.value });
    const bd = $('[data-bdel]', el); if (bd) bd.onclick = () => { const ids = BB.selected(el); if (!ids.length) return BB.toast('Select some rows first', true); BB.deleteRecords('application', ids); };
    const bo = $('[data-bowner]', el); if (bo) bo.onchange = (e) => e.target.value && bulk({ action: 'owner', owner_id: e.target.value });
    $('[data-bwa]', el).onchange = async (e) => { if (!e.target.value) return; const [to, format] = e.target.value.split(':'); const n = BB.selected(el).length; if (n && !(await BB.confirm('Send in bulk', `Send ${format} to the ${to} of ${n} application(s)? People who replied STOP are left out.`, 'Send'))) { e.target.value = ''; return; } bulk({ action: 'wa', to, format }); };
  };

  // ---------- Interviews: list / calendar ----------
  P.interviews = async ({ el, actions, q, me }) => {
    const view = q.view || 'list'; const f = q.filter || 'In rounds';
    actions.innerHTML = `<div class="seg"><button data-v="list" class="${view === 'list' ? 'on' : ''}">List</button><button data-v="cal" class="${view === 'cal' ? 'on' : ''}">Calendar</button></div>${view === 'list' ? dl(`/api/interviews?${BB.qs({ filter: f, format: 'xlsx' })}`) : ''}`;
    $$('[data-v]', actions).forEach((b) => (b.onclick = () => BB.setQ({ view: b.dataset.v === 'list' ? '' : b.dataset.v }))); wireDl(actions);
    if (view === 'cal') {
      const scope = q.scope || (me.level === 'sub' ? 'me' : 'team');
      const start = new Date(); start.setHours(0, 0, 0, 0); const off = Number(q.week || 0) * 7; start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + off);
      const end = new Date(start.getTime() + 7 * 86400000);
      const rows = await BB.api(`/api/calendar?scope=${scope}&from=${start.toISOString()}&to=${end.toISOString()}`);
      const days = [...Array(7)].map((_, i) => new Date(start.getTime() + i * 86400000));
      el.innerHTML = `<div class="filters"><div class="seg">${[['me', 'Me'], ['team', 'My team'], ...(isSuper(me) ? [['all', 'Everyone']] : [])].map(([k, l]) => `<button data-scope="${k}" class="${scope === k ? 'on' : ''}">${l}</button>`).join('')}</div><button class="btn sm" data-wk="-1">‹ Week</button><b class="small">${fmtD(start.toISOString())} – ${fmtD(new Date(end - 1).toISOString())}</b><button class="btn sm" data-wk="1">Week ›</button>${rows.some((r) => r.clash) ? '<span class="badge b-red">Clash: same candidate or interviewer within an hour</span>' : ''}</div>
        <div class="cal">${days.map((d) => { const key = BB.istDay(d); const evs = rows.filter((r) => BB.istDay(r.at) === key); return `<div class="d ${key === BB.istDay() ? 'today' : ''}"><h5>${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</h5>${evs.map((e) => `<div class="ev ${e.round === 'client' ? 'client' : ''} ${e.clash ? 'clash' : ''}" data-open="application:${e.app_id}" title="${esc(e.place)}"><b>${fmtT(e.at)}</b> ${esc(e.candidate_name)}<div class="tiny muted">${esc(e.job_title)} · ${esc(e.interviewer || '')}</div></div>`).join('')}</div>`; }).join('')}</div>`;
      $$('[data-scope]', el).forEach((b) => (b.onclick = () => BB.setQ({ scope: b.dataset.scope })));
      $$('[data-wk]', el).forEach((b) => (b.onclick = () => BB.setQ({ week: Number(q.week || 0) + Number(b.dataset.wk) })));
      return;
    }
    const chips = `<div class="filters">${['In rounds', 'Upcoming', 'Result pending', 'Done', 'Cancelled / no-show', 'All'].map((x) => `<span class="chip ${f === x ? 'on' : ''}" data-fl="${x}">${x}</span>`).join('')}</div>`;
    // Compact cells: date over time, job over client (one line each, cut with …), names on one line.
    const dt2 = (d) => (d ? `<div class="nw">${new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}</div><div class="tiny muted nw">${fmtT(d)}</div>` : '—');
    const jobCell = (title, client) => `<div class="iv-job"><div class="ellipsis" title="${esc(title)}">${esc(title)}</div>${client ? `<div class="tiny muted ellipsis" title="${esc(client)}">${esc(client)}</div>` : ''}</div>`;
    if (f === 'In rounds') {
      // Everyone screened in, in the round they are in now. Telephonic, then virtual, then the client.
      const d = await BB.api(`/api/interviews/rounds?${BB.qs({ round: q.round })}`); const n = d.counts; const rd = q.round || '';
      const MODE = { phone: ['Telephonic', 'b-outline'], video: ['Virtual', 'b-primary'], in_person: ['Client', 'b-violet'], ready: ['Ready for client', 'b-green'], offer: ['Job offered', 'b-gold'] };
      const ST = { 'Result pending': 'b-amber', Scheduled: 'b-primary', 'To do': 'b-outline', 'No-show': 'b-red', 'On hold': 'b-amber', 'Next step': 'b-green' };
      const when = (x) => (x.at ? dt2(x.at) : x.mode === 'phone' ? (x.best ? `Best time: ${esc(x.best)}${x.task_at ? `<div class="tiny muted">Call task ${fmtDT(x.task_at)}</div>` : ''}` : x.asked ? '<span class="muted">Asked for their best time</span>' : '<span class="faint">No best time yet</span>') : '<span class="faint">Not fixed</span>');
      const stepSel = (id, cur) => `<select class="mini" data-ivstep="${id}" aria-label="Move to step"><option value="">Move to step…</option>${BB.stageOptions(cur)}</select>`;
      const next = (x) => (x.status === 'Result pending' || x.iv_id ? 'Record feedback' : x.mode === 'phone' ? 'Call and record' : x.mode === 'in_person' ? 'Fix with client' : x.mode === 'ready' ? 'Send to client' : 'Schedule');
      el.innerHTML = `${chips}<div class="tabs" style="margin:4px 0 12px">${[['', 'All', n.all], ['phone', 'Telephonic', n.phone], ['video', 'Virtual', n.video], ['ready', 'Ready for client', n.ready], ['in_person', 'Client round', n.in_person], ['offer', 'Job offered', n.offer || 0]].map(([k, l, c]) => `<button data-rd="${k}" class="${rd === k ? 'on' : ''}">${l} <span class="n">${c}</span></button>`).join('')}</div>
        <div class="card iv-list">${BB.table([{ t: 'Candidate', f: (x) => `<div class="nw"><b>${esc(x.candidate_name)}</b> <a href="#" class="mono tiny app-link" data-open="application:${x.id}">${esc(x.id)}</a></div><div class="iv-job tiny muted"><div class="ellipsis" title="${esc(x.job_title)} · ${esc(x.client_name || '')}">${esc(x.job_title)} · ${esc(x.client_name || '')}</div></div>` }, { t: 'Round', f: (x) => `<span class="badge ${(MODE[x.mode] || MODE.video)[1]}">${esc(x.round)}</span>` }, { t: 'Status', f: (x) => `<span class="badge ${ST[x.status] || 'b-outline'}">${esc(x.status === 'Result pending' ? 'Feedback due' : x.status)}</span>` }, { t: 'When', f: when }, { t: 'Owner', f: (x) => `<span class="nw">${esc(x.owner_name || '—')}</span>`, hideSm: 1 }, { t: '', f: (x) => `<div class="row nowrap iv-acts" onclick="event.stopPropagation()">${x.mode === 'offer' ? `<button class="btn sm" data-open="application:${x.id}">${x.status === 'Offer accepted' ? 'Joining' : 'Offer'}</button>` : x.mode === 'ready' ? `<button class="btn sm" data-open="application:${x.id}">Send to client</button>` : `${['To do', 'No-show'].includes(x.status) ? `<button class="btn sm primary" data-ivsched="${x.id}">Schedule</button>` : ''}<button class="btn sm ${x.status === 'Result pending' ? 'primary' : ''}" data-ivfb="${x.id}">${x.mode === 'in_person' ? 'Client feedback' : 'Interview feedback'}</button>`}${stepSel(x.id, x.step === 'Our interview' ? (x.mode === 'phone' ? 'Telephonic round' : 'Virtual round') : x.step)}</div>` }], d.rows, { open: (x) => `application:${x.id}`, empty: 'Nothing here.' })}</div>`;
      $$('[data-fl]', el).forEach((c) => (c.onclick = () => BB.setQ({ filter: c.dataset.fl === 'In rounds' ? '' : c.dataset.fl, page: 1, round: '' })));
      $$('[data-rd]', el).forEach((b) => (b.onclick = () => BB.setQ({ round: b.dataset.rd })));
      // The round is not booked yet: schedule it here (the same form as on the application).
      $$('[data-ivsched]', el).forEach((b) => (b.onclick = async () => { const x = d.rows.find((r) => r.id === b.dataset.ivsched); try { const a = await BB.api(`/api/applications/${x.id}`); const row = (a.rounds || []).find((r) => r.key === x.round_key) || (a.rounds || []).find((r) => r.mode === x.mode && r.status === 'To do'); BB.schedule(a, x.mode, row); } catch (e) { BB.fail(e); } }));
      $$('[data-ivfb]', el).forEach((b) => (b.onclick = () => BB.feedbackFor(b.dataset.ivfb)));
      $$('[data-ivstep]', el).forEach((sl) => (sl.onchange = () => { const v = sl.value; sl.value = ''; if (v) BB.stepFor(sl.dataset.ivstep, v); }));
      return;
    }
    const r = await BB.api(`/api/interviews?${BB.qs({ filter: f, page: q.page })}`);
    el.innerHTML = `${chips}
      <div class="card iv-list">${BB.table([{ t: 'Time', f: (i) => dt2(i.at) }, { t: 'Candidate', f: (i) => `<b class="nw">${esc(i.candidate_name)}</b><div><a href="#" class="mono tiny app-link" data-open="application:${i.app_id}">${esc(i.app_id)}</a></div>` }, { t: 'Job', f: (i) => jobCell(i.job_title, i.client_name) }, { t: 'Round', f: (i) => `<span class="badge ${i.round === 'ours' ? 'b-primary' : 'b-violet'}">${i.round === 'ours' ? 'Ours' : 'Client'}</span>` }, { t: 'Interviewer', f: (i) => `<span class="nw">${esc(i.interviewer || '—')}</span>`, hideSm: 1 }, { t: 'Status', f: (i) => `<span class="badge ${i.view_status === 'Result pending' ? 'b-amber' : 'b-outline'}">${esc(i.view_status)}</span>${i.confirmed ? '<div style="margin-top:4px"><span class="badge b-green tiny">confirmed</span></div>' : ''}${i.result ? `<div class="small nw" style="margin-top:4px">${esc(i.result)}</div>${i.rating ? `<div class="stars tiny nw">${'★'.repeat(i.rating)}</div>` : ''}` : ''}` },
        { t: 'WhatsApp', f: (i) => `<div class="row nowrap iv-wa" onclick="event.stopPropagation()">${i.view_status === 'Result pending' ? (i.round === 'client' ? BB.waBtn({ ptype: 'client', pid: i.client_id, ap: i.app_id, iv: i.id, format: 'bbhs_feedback_request' }, 'Client') : BB.waBtn({ ptype: 'user', pid: me.id, ap: i.app_id, iv: i.id, format: 'bbhs_team_task_alert', vars: { task: `Record result of ${i.id}`, record_id: i.id } }, 'Interviewer')) : ['Scheduled', 'Rescheduled'].includes(i.status) ? `${BB.waBtn({ ptype: 'candidate', pid: i.candidate_id, ap: i.app_id, iv: i.id, format: 'bbhs_interview_reminder' }, 'Candidate')}${i.round === 'client' ? BB.waBtn({ ptype: 'client', pid: i.client_id, ap: i.app_id, iv: i.id, format: 'bbhs_interview_reminder' }, 'Client', 'btn sm') : ''}` : ''}</div>` },
        { t: '', f: (i) => (['Scheduled', 'Rescheduled'].includes(i.status) ? `<div class="row nowrap iv-acts" onclick="event.stopPropagation()"><button class="btn sm primary" data-rec="${i.id}">${i.round === 'client' ? 'Client feedback' : 'Interview feedback'}</button><select class="mini" data-ivstep="${i.app_id}" aria-label="Move to step"><option value="">Move to step…</option>${BB.stageOptions('')}</select></div>` : '') }], r.rows, { open: (i) => `application:${i.app_id}` })}${BB.pager(r)}</div>`;
    BB.wirePager(el);
    $$('[data-fl]', el).forEach((c) => (c.onclick = () => BB.setQ({ filter: c.dataset.fl === 'In rounds' ? '' : c.dataset.fl, page: 1 })));
    $$('[data-ivstep]', el).forEach((sl) => (sl.onchange = () => { const v = sl.value; sl.value = ''; if (v) BB.stepFor(sl.dataset.ivstep, v); }));
    $$('[data-rec]', el).forEach((b) => (b.onclick = async () => { const i = r.rows.find((x) => x.id === b.dataset.rec); const a = await BB.api(`/api/applications/${i.app_id}`); BB.recordResult(a.interviews.find((x) => x.id === i.id), a); }));
  };

  // ---------- WhatsApp inbox (8.4) ----------
  P.whatsapp = async ({ el, actions, q, me }) => {
    const f = q.filter || 'All';
    const d = await BB.api(`/api/wa/threads?${BB.qs({ filter: f, q: q.q })}`);
    let cur = q.t ? q.t.split(':') : d.threads[0] ? [d.threads[0].person_type, d.threads[0].person_id] : null;
    actions.innerHTML = `<button class="btn" data-new>New message</button>${!me.accounts_only ? '<button class="btn gold" data-alert>Job alert to matches</button>' : ''}`;
    el.innerHTML = `${BB.boot.test_mode ? '<div class="notice gold small" style="margin-bottom:10px">Test mode: WhatsApp is not connected yet, so messages are saved as "would send". Use <b>Simulate reply</b> to act as the person replying (button replies update records just like the real CRM).</div>' : ''}
      <div class="filters">${['All', 'Clients', 'Candidates', 'Team', 'Unread', 'Failed'].map((x) => `<span class="chip ${f === x ? 'on' : ''}" data-fl="${x}">${x}</span>`).join('')}<input placeholder="Search…" value="${esc(q.q || '')}" data-q></div>
      <div class="card inbox"><div class="threads">${f === 'Failed' ? d.failed.map((m) => `<div class="th"><div class="nm">${esc(m.person_id)} <span class="badge b-red tiny">failed</span></div><div class="lm">${esc(m.error || '')}</div><button class="btn sm" data-retry="${m.id}">Retry</button></div>`).join('') || '<div class="empty">No failed messages.</div>' : d.threads.map((t) => `<div class="th ${cur && cur[0] === t.person_type && cur[1] === t.person_id ? 'on' : ''}" data-th="${t.person_type}:${t.person_id}"><div class="nm"><span class="ellipsis">${esc(t.name)}</span><span class="badge b-outline tiny">${t.person_type === 'user' ? 'team' : t.person_type}</span>${t.unread ? `<span class="badge b-green tiny">${t.unread}</span>` : ''}<span class="right tiny faint">${fmtT(t.last_at)}</span></div><div class="lm">${t.last && t.last.direction === 'in' ? '↩ ' : ''}${esc(t.last ? t.last.text : '')}</div></div>`).join('') || '<div class="empty">No chats yet.</div>'}</div>
        <div class="chat-col" data-chat><div class="empty">Choose a chat.</div></div><div class="side-info" data-info></div></div>`;
    $$('[data-fl]', el).forEach((c) => (c.onclick = () => BB.setQ({ filter: c.dataset.fl, t: '' })));
    let tq; $('[data-q]', el).oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => BB.setQ({ q: e.target.value }), 350); };
    $$('[data-th]', el).forEach((t) => (t.onclick = () => { $$('[data-th]', el).forEach((x) => x.classList.remove('on')); t.classList.add('on'); cur = t.dataset.th.split(':'); BB.setUrl(`team/whatsapp?${BB.qs({ ...q, t: t.dataset.th })}`); openThread(); }));
    $$('[data-retry]', el).forEach((b) => (b.onclick = async () => { await BB.post(`/api/wa/retry/${b.dataset.retry}`); BB.toast('Queued again'); BB.refreshPage(); }));
    $('[data-new]', actions).onclick = () => BB.pickCandidate((cid) => BB.wa({ ptype: 'candidate', pid: cid, after: () => BB.setQ({ t: `candidate:${cid}` }) }));
    const al = $('[data-alert]', actions); if (al) al.onclick = () => BB.pickJob(async (jid) => { const r = await BB.post(`/api/jobs/${jid}/alert`, {}).catch(BB.fail); if (r) BB.toast(`${r.sent} job alert(s) saved${r.skipped.length ? `, ${r.skipped.length} skipped (STOP, no consent, limits)` : ''}`); });
    async function openThread() {
      if (!cur) return;
      const t = await BB.api(`/api/wa/thread/${cur[0]}/${cur[1]}`).catch(BB.fail); if (!t) return;
      const chat = $('[data-chat]', el); const p = t.person;
      chat.innerHTML = `<div class="chat" data-scroll>${t.messages.map((m) => `<div class="msg ${m.direction === 'out' ? 'out' : ''}">${m.format ? `<div class="fmt">${esc(m.format)}</div>` : ''}${esc(m.text)}${BB.care.english(m)}${(m.buttons || []).length ? `<div class="btns">${m.buttons.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}<div class="meta">${m.direction === 'out' ? esc(m.sent_by) + ' · ' : ''}${fmtDT(m.at)} ${m.direction === 'out' ? ticks(m.status) : ''}${m.direction === 'out' && BB.boot.test_mode && m.status !== 'read' ? ` <a href="#" class="tiny" data-tick="${m.id}" title="Test: move the tick on">tick</a>` : ''}</div></div>`).join('') || '<div class="empty">No messages.</div>'}</div>
        <div class="composer">${p.window_until ? `<div class="inp-wrap grow"><textarea data-text placeholder="Type a reply (chat open until ${fmtT(p.window_until)})" data-voice style="min-height:40px"></textarea>${BB.care.translateBar(p.lang && p.lang !== 'en' ? p.lang : '')}</div><button class="btn wa" data-reply>Send</button>` : '<span class="small muted grow">Only an approved format can be sent (no reply in the last 24 hours).</span>'}<button class="btn" data-fmt>Choose a format</button></div>`;
      BB.attachMics(chat);
      const sc = $('[data-scroll]', chat); sc.scrollTop = sc.scrollHeight;
      const typeName = { client: 'Client', candidate: 'Candidate', user: 'Team' }[p.type];
      $('[data-info]', el).innerHTML = `<div class="stack-sm"><b>${esc(p.name)}</b><div class="small">${typeName} · <a href="#" data-open="${p.type === 'user' ? 'person' : p.type}:${p.id}" class="mono">${esc(p.id)}</a></div><div class="mono small">${esc(p.phone)}</div>${p.opted_out ? '<span class="badge b-red">Opted out (STOP)</span>' : ''}<div class="notice small ${p.window_until ? '' : 'warn'}">${p.window_until ? `Window open until ${fmtT(p.window_until)}` : 'Window closed'}</div>
        <b class="small" style="margin-top:8px;display:block">Quick formats</b>${t.quick.map((k) => `<button class="fmt-chip" data-quick="${k}"><span class="mono">${k}</span></button>`).join('')}
        ${BB.boot.test_mode && p.type !== 'user' ? `<hr class="sep"><b class="small">Simulate reply (test)</b><div class="row" style="margin-top:6px">${['Confirm', 'Reschedule', 'Accept offer', 'Decline', 'Interested', "I've joined", 'Need help', 'Selected', 'Not selected', 'STOP', 'START'].map((b) => `<button class="btn sm" data-sim="${esc(b)}">${esc(b)}</button>`).join('')}</div><div class="row" style="margin-top:6px"><input data-simtext placeholder="Or type their message"><button class="btn sm" data-simsend>Reply</button></div>` : ''}</div>`;
      const reload = () => openThread();
      BB.care.wireTranslate(chat, $('[data-text]', chat));
      const rp = $('[data-reply]', chat); if (rp) rp.onclick = async () => { const text = $('[data-text]', chat).value.trim(); if (!text) return; try { await BB.post('/api/wa/send', { ptype: p.type, pid: p.id, text }); reload(); } catch (e) { BB.fail(e); } };
      $('[data-fmt]', chat).onclick = () => BB.wa({ ptype: p.type, pid: p.id, after: reload });
      $$('[data-quick]', el).forEach((b) => (b.onclick = () => BB.wa({ ptype: p.type, pid: p.id, format: b.dataset.quick, after: reload })));
      $$('[data-tick]', chat).forEach((a) => (a.onclick = async (e) => { e.preventDefault(); await BB.post(`/api/wa/tick/${a.dataset.tick}`); reload(); }));
      const sim = async (body) => { try { const r = await BB.post('/api/wa/simulate', { ptype: p.type, pid: p.id, ...body }); BB.toast(`Reply saved · ${r.effect}`); reload(); BB.refreshCounts(); } catch (e) { BB.fail(e); } };
      $$('[data-sim]', el).forEach((b) => (b.onclick = () => sim({ button: b.dataset.sim, text: b.dataset.sim })));
      const ss = $('[data-simsend]', el); if (ss) ss.onclick = () => { const v = $('[data-simtext]', el).value.trim(); if (v) sim({ text: v }); };
    }
    openThread();
  };

  // ---------- Performance (9) ----------
  P.performance = async ({ el, actions, q, me }) => {
    const days = q.days || 30;
    const d = await BB.api(`/api/performance?${BB.qs({ days, from: q.from, to: q.to, agency: q.agency })}`);
    actions.innerHTML = `<div class="seg">${[7, 30].map((n) => `<button data-days="${n}" class="${String(days) === String(n) && !q.from ? 'on' : ''}">${n} days</button>`).join('')}</div><input type="date" data-from value="${esc(q.from || '')}" style="width:auto"><input type="date" data-to value="${esc(q.to || '')}" style="width:auto">`;
    $$('[data-days]', actions).forEach((b) => (b.onclick = () => BB.setQ({ days: b.dataset.days, from: '', to: '' })));
    $('[data-from]', actions).onchange = (e) => BB.setQ({ from: e.target.value }); $('[data-to]', actions).onchange = (e) => BB.setQ({ to: e.target.value });
    // Person filter: "Whole team" or one person (admins: themselves and their sub admins; super admin: anyone, after the agency).
    const personFilter = (people) => `<div class="filters"><select data-person aria-label="Show performance for"><option value="">${d.level === 'admin' ? 'Whole team' : 'Everyone'}</option>${people.map((p) => `<option value="${p.id}" ${q.person === p.id ? 'selected' : ''}>${esc(p.name)}${p.id === me.id ? ' (me)' : ''} · ${BB.levelName(p.level)}</option>`).join('')}</select></div>`;
    const wirePersonFilter = () => { const s = $('[data-person]', el); if (s) s.onchange = () => BB.setQ({ person: s.value }); };
    const dots = (l) => `<span class="dots7">${l.map((x) => `<i class="${x.status === 'Approved' ? 'ok' : x.status ? 'sub' : ''}" title="${x.day}: ${x.status || 'missing'}"></i>`).join('')}</span>`;
    const stBadge = (s) => `<span class="badge ${s === 'Active' ? 'b-green' : s.startsWith('Inactive') || s === 'Login off' || s === 'Paused' ? 'b-red' : 'b-amber'}">${esc(s)}</span>`;
    const peopleTable = (rows) => BB.table([{ t: 'Person', f: (p) => `<b>${esc(p.name)}</b><div class="tiny muted">${BB.levelName(p.level)} · ${esc(p.agency_name || '')}</div>` }, { t: 'Tasks done', num: 1, f: (p) => `${p.tasks_done ?? 0}<div class="tiny muted">${p.tasks_open ?? 0} open${p.tasks_overdue ? ` · <span style="color:var(--red)">${p.tasks_overdue} late</span>` : ''}</div>` }, { t: 'Status', f: (p) => stBadge(p.status) }, { t: 'Last login', f: (p) => BB.daysAgo(p.last_login), hideSm: 1 }, { t: 'Added', num: 1, f: (p) => p.added }, { t: 'Screened', num: 1, f: (p) => p.screened }, { t: 'Interviews', num: 1, f: (p) => p.interviews }, { t: 'Sent', num: 1, f: (p) => p.sent }, { t: 'Offers', num: 1, f: (p) => p.offers }, { t: 'Joined', num: 1, f: (p) => p.joined }, { t: 'Logs 7d', f: (p) => dots(p.logs) }, { t: 'Target', num: 1, f: (p) => (p.level === 'sub' ? `${p.target}%` : '—') }], rows, { open: (p) => `person:${p.id}` });
    if (d.level === 'sub') {
      const m = d.me; const max = Math.max(1, ...d.activity.map((x) => x.n));
      el.innerHTML = `<div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">${[['Added', m.added], ['Screened', m.screened], ['Interviews', m.interviews], ['Sent to client', m.sent], ['Offers', m.offers], ['Joined', m.joined], ['Tasks done', `${m.tasks_done ?? 0} · ${m.tasks_open ?? 0} open`], ['Target', m.target + '%']].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
        <div class="card pad" style="margin-top:14px"><h3 style="margin-bottom:24px">My activity, last 7 days</h3><div class="bars7">${d.activity.map((x) => `<div style="height:${(x.n / max) * 100}%" title="${x.n}"><span>${new Date(x.day).toLocaleDateString('en-IN', { weekday: 'short' })}</span></div>`).join('')}</div><div style="height:16px"></div></div>
        <p class="small muted">Target = average of screened vs ${BB.boot.match ? '' : ''}20, sent vs 6, joined vs 1 per 30 days (scaled for the period), each capped at 100%.</p>`;
    } else if (d.level === 'admin') {
      const t = d.team; const one = q.person ? d.people.find((p) => p.id === q.person) : null;
      const cards = one ? [['Added', one.added], ['Screened', one.screened], ['Interviews', one.interviews], ['Sent to client', one.sent], ['Offers', one.offers], ['Joined', one.joined], ...(one.level === 'sub' ? [['Target', one.target + '%']] : [])] : [['Members', t.members], ['Active today', t.active], ['Screened', t.screened], ['Sent to client', t.sent], ['Offers', t.offers], ['Joined', t.joined]];
      el.innerHTML = `${personFilter(d.people)}<div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">${cards.map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div><div class="card" style="margin-top:14px">${peopleTable(one ? [one] : d.people)}</div>`;
      wirePersonFilter();
    } else {
      // The selected agency's pipeline right now (not the date range above).
      const pl = d.pipeline; const agName = q.agency === 'own' ? 'BrillBrains (own)' : ((d.agency_options.find((a) => a.id === q.agency) || {}).name || '');
      const stat = (l, v, sub) => `<div class="card stat"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="tiny muted">${sub}</div>` : ''}</div>`;
      const pickAg = `<div class="filters"><select data-agpick aria-label="Agency"><option value="">Pick an agency to see its pipeline…</option>${d.own_jobs ? `<option value="own" ${q.agency === 'own' ? 'selected' : ''}>BrillBrains (own)</option>` : ''}${d.agency_options.map((a) => `<option value="${a.id}" ${q.agency === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>`;
      const STG = Object.keys(pl ? pl.stages : {}).filter((k) => k !== 'Joined'); // joined ones have their own count
      const plCard = pl ? `<div class="card pad" style="margin-bottom:14px"><div class="row between"><h3 style="margin:0">${esc(agName)}: pipeline right now</h3><span class="small muted">Live counts, not the date range</span></div>
        <div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:12px">${stat('Clients with active jobs', `${pl.clients_active} / ${pl.clients}`, 'of the clients assigned')}${stat('Active job openings', pl.active_jobs, `${pl.openings} position${pl.openings === 1 ? '' : 's'}${pl.on_hold ? ` · ${pl.on_hold} on hold` : ''}`)}${stat('Applications', pl.apps_total, `${pl.apps_open} in progress`)}${stat('Offers released', pl.offers)}${stat('Joined', pl.done.Joined)}${stat('Jobs closed with a joining', pl.closed_joined)}</div>
        <h4 style="margin:16px 0 6px">Applications by stage</h4><div class="row" style="flex-wrap:wrap;gap:6px">${STG.map((k) => `<span class="badge ${pl.stages[k] ? 'b-primary' : 'b-outline'}">${esc(k)}: ${pl.stages[k]}</span>`).join('')}<span class="badge b-green">Joined: ${pl.done.Joined}</span><span class="badge b-red">Rejected: ${pl.done.Rejected}</span>${pl.done.Withdrawn ? `<span class="badge b-outline">Other closed: ${pl.done.Withdrawn}</span>` : ''}</div>
        <h4 style="margin:16px 0 6px">Applications per job opening</h4>${pl.jobs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Job</th><th>Status</th><th class="num">Openings</th><th class="num">Applications</th>${STG.filter((k) => k !== 'Joined').map((k) => `<th class="num">${esc(k)}</th>`).join('')}<th class="num">Offers</th><th class="num">Joined</th></tr></thead><tbody>${pl.jobs.map((j) => `<tr class="click" data-open="job:${j.id}"><td><b>${esc(j.title)}</b><div class="tiny muted">${esc(j.id)} · ${esc(j.client_name || '')}</div></td><td><span class="badge b-outline">${esc(j.status)}</span></td><td class="num">${j.openings}</td><td class="num"><b>${j.total}</b></td>${STG.filter((k) => k !== 'Joined').map((k) => `<td class="num ${j.stages[k] ? '' : 'faint'}">${j.stages[k] || 0}</td>`).join('')}<td class="num">${j.offers}</td><td class="num">${j.joined}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">No jobs yet.</p>'}
        ${pl.clients ? `<details style="margin-top:12px"><summary class="small"><b>Clients</b> (${pl.clients})</summary><div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px">${pl.clients_list.map((c) => `<a href="#" class="badge ${c.active_jobs ? 'b-green' : 'b-outline'}" data-open="client:${c.id}">${esc(c.company)}${c.active_jobs ? ` · ${c.active_jobs} active` : ''}</a>`).join('')}</div></details>` : ''}</div>` : '';
      el.innerHTML = `${pickAg}${plCard}<div class="card"><div class="card-h"><h3>Agencies</h3>${q.agency ? '<button class="btn sm right" data-allag>Show all</button>' : ''}</div>${BB.table([{ t: 'Agency', f: (a) => `<b>${esc(a.name)}</b>` }, { t: 'Status', f: (a) => `<span class="badge ${a.view_status === 'On track' ? 'b-green' : a.view_status === 'Needs attention' ? 'b-amber' : 'b-red'}">${esc(a.view_status)}</span>` }, { t: 'Active today', num: 1, f: (a) => `${a.active_today}/${a.people}` }, { t: 'Open jobs', num: 1, f: (a) => a.open_jobs }, { t: 'Active apps', num: 1, f: (a) => a.active_apps }, { t: 'Sent', num: 1, f: (a) => a.sent }, { t: 'Joined', num: 1, f: (a) => a.joined }, { t: 'Fee billed', num: 1, f: (a) => inr(a.fee) }, { t: 'Agency share', num: 1, f: (a) => inr(a.share) }, { t: 'Log %', num: 1, f: (a) => `${a.log_pct}%` }], d.agencies)}</div>
        <div class="card" style="margin-top:14px"><div class="card-h"><h3>Admins and sub admins</h3>${personFilter(d.people.filter((p) => !q.agency || p.agency_id === q.agency))}</div>${peopleTable(d.people.filter((p) => (!q.agency || p.agency_id === q.agency) && (!q.person || p.id === q.person)))}</div>`;
      wirePersonFilter();
      const ap = $('[data-agpick]', el); if (ap) ap.onchange = () => BB.setQ({ agency: ap.value, person: '' });
      $$('.tbl', el)[pl ? 1 : 0].querySelectorAll('tbody tr').forEach((tr, i) => { tr.classList.add('click'); tr.onclick = () => BB.setQ({ agency: d.agencies[i].id, person: '' }); });
      const sa = $('[data-allag]', el); if (sa) sa.onclick = () => BB.setQ({ agency: '', person: '' });
    }
  };

  // ---------- Daily logs (9.3) ----------
  P.logs = async ({ el, me }) => {
    const d = await BB.api('/api/logs'); const m = d.mine; const c = d.counts;
    el.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:14px;align-items:start">
      ${me.level !== 'super' ? `<div class="card"><div class="card-h"><h3>My log for today</h3>${m ? `<span class="badge ${m.status === 'Approved' ? 'b-green' : 'b-amber'} right">${m.status}</span>` : `<span class="small muted right">deadline ${esc(d.deadline)}</span>`}</div><div class="card-b stack">
        <div class="row small">${[['Added', c.added], ['Screened', c.screened], ['Interviews', c.interviews], ['Sent', c.sent], ['Offers', c.offers], ['Joined', c.joined]].map(([l, v]) => `<span class="badge b-primary">${l}: ${v}</span>`).join('')}<span class="faint tiny">counted for you</span></div>
        <form class="stack" data-log>${field({ name: 'tasks', label: 'Tasks done today', type: 'textarea', value: m ? m.tasks : '' })}${field({ name: 'problems', label: 'Problems', type: 'textarea', value: m ? m.problems : '', opt: true })}${field({ name: 'plan', label: 'Plan for tomorrow', type: 'textarea', value: m ? m.plan : '' })}<button class="btn primary" ${m && m.status === 'Approved' ? 'disabled' : ''}>${m ? 'Update log' : 'Submit log'}</button></form>
        <div class="small muted">My last 7 days: <span class="dots7">${d.my_dots.map((x) => `<i class="${x.status === 'Approved' ? 'ok' : x.status ? 'sub' : ''}" title="${x.day}"></i>`).join('')}</span></div></div></div>` : ''}
      <div class="card"><div class="card-h"><h3>Team logs</h3><span class="small muted">● approved ● submitted ○ missing</span></div>${BB.table([{ t: 'Person', f: (p) => `<b>${esc(p.name)}</b><div class="tiny muted">${BB.levelName(p.level)} · ${esc(p.agency_name)}</div>` }, { t: 'Last 7 days', f: (p) => `<span class="dots7">${p.dots.map((x) => `<i class="${x.status === 'Approved' ? 'ok' : x.status ? 'sub' : ''}" title="${x.day}: ${x.status || 'missing'}"></i>`).join('')}</span>` }, { t: 'Today', f: (p) => (p.today ? `<span class="badge ${p.today.status === 'Approved' ? 'b-green' : 'b-amber'}">${p.today.status}</span>` : '<span class="badge b-red">Missing</span>') }, { t: '', f: (p) => `<div class="row nowrap">${p.today && p.today.status === 'Submitted' && p.can_approve ? `<button class="btn sm primary" data-approve="${p.today.id}">Approve</button>` : ''}${p.today ? `<button class="btn sm" data-view="${p.today.id}">View</button>` : BB.waBtn({ ptype: 'user', pid: p.id, format: 'bbhs_log_reminder' }, 'Send reminder')}</div>` }], d.team, { empty: 'No team members to review.' })}</div></div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>Recent logs</h3></div>${BB.table([{ t: 'Day', f: (l) => fmtD(l.day) }, { t: 'Person', f: (l) => esc(l.name) }, { t: 'Tasks', f: (l) => `<div class="small" style="max-width:420px">${esc(l.tasks)}</div>` }, { t: 'Plan', f: (l) => `<div class="small muted" style="max-width:300px">${esc(l.plan)}</div>`, hideSm: 1 }, { t: 'Status', f: (l) => `<span class="badge ${l.status === 'Approved' ? 'b-green' : 'b-amber'}">${l.status}</span>` }, { t: '', f: (l) => (l.status === 'Submitted' && l.user_id !== me.id && !me.accounts_only ? `<button class="btn sm" data-approve="${l.id}">Approve</button>` : '') }], d.recent)}</div>`;
    const lf = $('[data-log]', el); if (lf) lf.onsubmit = async (e) => { e.preventDefault(); try { await BB.post('/api/logs', BB.formValues(e.target)); BB.toast('Log saved'); BB.refreshPage(); } catch (er) { BB.showErr(e.target, er); } };
    $$('[data-approve]', el).forEach((b) => (b.onclick = async () => { try { await BB.post(`/api/logs/${b.dataset.approve}/approve`); BB.toast('Approved'); BB.refreshPage(); } catch (e) { BB.fail(e); } }));
    $$('[data-view]', el).forEach((b) => (b.onclick = () => { const l = d.recent.find((x) => x.id === b.dataset.view) || d.team.map((t) => t.today).find((x) => x && x.id === b.dataset.view); BB.modal({ title: `${esc(l.id)}`, foot: false, body: `<div class="stack"><div><b>Tasks</b><div style="white-space:pre-wrap">${esc(l.tasks)}</div></div><div><b>Problems</b><div style="white-space:pre-wrap">${esc(l.problems || '—')}</div></div><div><b>Plan</b><div style="white-space:pre-wrap">${esc(l.plan || '—')}</div></div></div>` }); }));
  };

  // ---------- Profit & Loss: expenses, client bills, summary ----------
  P.bills = async ({ el, actions, q, me }) => {
    const sup = isSuper(me); const lead = sup || me.level === 'admin'; const money = lead || me.accounts_only; const tab = q.tab || 'expenses';
    el.innerHTML = `<div class="tabs">${[['expenses', 'Expenses'], ['bills', 'Client bills'], ['summary', 'Summary'], ...(me.accounts_only ? [] : [['earnings', sup ? 'Agency earnings' : 'Earnings']])].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div data-tb></div>`;
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => BB.setQ({ tab: b.dataset.tab === 'expenses' ? '' : b.dataset.tab, q: '', status: '', stage: '', view: '', category: '', client: '', page: '', sort: '', dir: '' })));
    const body = $('[data-tb]', el);
    if (tab !== 'earnings') { const box = document.createElement('div'); box.innerHTML = BB.flow.periodBar(q); el.insertBefore(box.firstElementChild, body); BB.flow.wirePeriod(el); }
    if (tab === 'expenses') return BB.flow.expenses({ el: body, actions, q });
    if (tab === 'summary') return BB.flow.summary({ el: body, actions, q });
    if (tab === 'earnings') {
      const ags = sup ? (await BB.api('/api/users')).agencies : [];
      const ag = q.agency || (sup ? (ags[1] || ags[0] || {}).id : '');
      const e = await BB.api(`/api/earnings?${BB.qs({ agency: ag })}`);
      actions.innerHTML = dl(`/api/earnings?${BB.qs({ agency: ag, format: 'xlsx' })}`); wireDl(actions);
      body.innerHTML = `${sup ? `<div class="filters"><select data-ag>${ags.map((a) => `<option value="${a.id}" ${a.id === ag ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : ''}<div class="card"><div class="card-h"><h3>${esc(e.agency.name)} — statement by month</h3></div>${BB.table([{ t: 'Month', f: (m) => m.month }, { t: 'Bills', num: 1, f: (m) => m.bills }, { t: 'Fee billed', num: 1, f: (m) => inr(m.billed) }, { t: 'Agency share', num: 1, f: (m) => inr(m.shares) }, { t: 'Paid out', num: 1, f: (m) => inr(m.paid) }, { t: 'Due now', num: 1, f: (m) => `<b>${inr(m.due)}</b>` }, { t: 'Not due yet', num: 1, f: (m) => inr(m.not_due) }], e.months, { empty: 'No bills yet.' })}</div>`;
      const sa = $('[data-ag]', body); if (sa) sa.onchange = () => BB.setQ({ agency: sa.value });
      return;
    }
    const r = await BB.api(`/api/bills?${BB.qs(q, { tab: undefined, view: undefined, period: undefined })}`); const t = r.totals; const view = q.view || 'bills';
    actions.innerHTML = `${dl(`/api/bills?${BB.qs(q, { format: 'xlsx', tab: undefined, view: undefined, period: undefined })}`)}<button class="btn primary" data-badd>+ Add bill</button>`; wireDl(actions);
    const STAGE_CLS = { Billed: 'b-primary', Received: 'b-green', Outstanding: 'b-amber', Draft: 'b-outline', Cancelled: 'b-outline' };
    const seg = (key, list, val) => `<div class="seg fin-seg">${list.map(([v, l]) => `<button type="button" class="${(val || '') === v ? 'on' : ''}" data-seg="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const stageCell = (b) => (['Draft', 'Cancelled'].includes(b.stage) ? `<span class="badge ${STAGE_CLS[b.stage]}">${b.stage}</span>` : `<select class="mini stage-sel" data-bstage="${b.id}" aria-label="Stage of ${esc(b.bill_no || b.id)}" onclick="event.stopPropagation()">${['Billed', 'Received', 'Outstanding'].map((x) => `<option ${x === b.stage ? 'selected' : ''}>${x}</option>`).join('')}</select>`);
    const groupRows = view === 'client' ? r.by_client : r.by_agency;
    body.innerHTML = `<div class="grid exp-tiles">${[['Billed', t.billed], ['Received', t.received], ['Outstanding', t.outstanding]].map(([l, v]) => `<button type="button" class="card stat fin-tile ${q.stage === l ? 'on' : ''}" data-seg="stage" data-v="${q.stage === l ? '' : l}"><div class="l">${l}</div><div class="v">${inr(v)}</div></button>`).join('')}</div>
      <div class="filters exp-filters"><input placeholder="Search bill no., client, candidate…" value="${esc(q.q || '')}" data-q data-xq><select data-bf="client"><option value="">All clients</option>${r.clients.map(([id, n]) => `<option value="${id}" ${q.client === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>${r.agencies.length ? `<select data-bf="agency"><option value="">All agencies</option>${r.agencies.map(([id, n]) => `<option value="${id}" ${q.agency === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}</div>
      <div class="fin-row">${seg('stage', [['', 'All'], ['Billed', 'Billed'], ['Received', 'Received'], ['Outstanding', 'Outstanding']], q.stage)}${seg('view', [['', 'Bills'], ['client', 'By client'], ...(sup ? [['agency', 'By agency']] : [])], q.view)}</div>
      <div class="card bill-bulk hidden" data-bbar><b data-bcount></b><span class="grow"></span>${money ? '<button class="btn sm" data-bmark="Received">Mark received</button>' : ''}<button class="btn sm" data-bmark="Outstanding">Mark outstanding</button>${lead ? '<button class="btn sm" data-payouts>Mark payouts paid</button>' : ''}</div>
      ${view === 'bills' ? `<div class="card">${BB.table([{ t: 'Bill', sort: 'bill_no', f: (b) => `<b>${esc(b.bill_no || '—')}</b>${b.is_replacement ? ' <span class="badge b-gold tiny">Replacement</span>' : ''}<div class="tiny muted">${fmtD(b.bill_day)}</div>` }, { t: 'Client', sort: 'client_name', f: (b) => esc(b.client_name) }, { t: 'Candidate', sort: 'candidate_name', f: (b) => `${esc(b.candidate_name || '—')}${b.job_title ? `<div class="tiny muted">${esc(b.job_title)}${b.joining_date ? ` · joined ${fmtD(b.joining_date)}` : ''}</div>` : ''}` }, { t: 'Total', sort: 'total', desc: 1, num: 1, f: (b) => `<b>${inr(b.total)}</b>` }, { t: 'Stage', sort: 'stage', f: stageCell }, ...(lead ? [{ t: 'Payout', f: (b) => `<span class="badge ${b.payout_status === 'Paid' ? 'b-green' : b.payout_status === 'Due' ? 'b-amber' : 'b-outline'}">${b.payout_status}</span>` }] : []), { t: '', f: (b) => `<span onclick="event.stopPropagation()">${b.status === 'Issued' && b.balance > 0 ? `<button class="btn sm" data-bremind="${b.id}">Remind</button>` : ''}</span>` }], r.rows, { open: (b) => `bill:${b.id}`, select: true, sorted: q, empty: 'No bills for these filters.' })}${BB.pager(r)}</div>`
      : `<div class="card">${BB.table([{ t: view === 'client' ? 'Client' : 'Agency', f: (x) => (x.id ? `<a href="#" data-gpick="${esc(x.id)}">${esc(x.name)}</a>` : esc(x.name)) }, { t: 'Bills', num: 1, f: (x) => x.bills }, { t: 'Billed', num: 1, f: (x) => inr(x.billed) }, { t: 'Received', num: 1, f: (x) => inr(x.received) }, { t: 'Outstanding', num: 1, f: (x) => `<b>${inr(x.outstanding)}</b>` }], groupRows, { empty: 'No bills for these filters.' })}</div>`}`;
    BB.wirePager(body);
    const bar = $('[data-bbar]', body); const count = () => { const ids = BB.selected(body); bar.classList.toggle('hidden', !ids.length); $('[data-bcount]', bar).textContent = `${ids.length} bill${ids.length === 1 ? '' : 's'} · ${inr(r.rows.filter((x) => ids.includes(x.id)).reduce((a, x) => a + x.balance, 0))} still to come`; };
    BB.wireSelect(body, count);
    let tq; $('[data-q]', body).oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => BB.setQ({ q: e.target.value, page: 1 }), 350); };
    $$('[data-bf]', body).forEach((f) => (f.onchange = () => BB.setQ({ [f.dataset.bf]: f.value, page: 1 })));
    $$('[data-seg]', body).forEach((b) => (b.onclick = () => BB.setQ({ [b.dataset.seg]: b.dataset.v, page: 1 })));
    $$('[data-gpick]', body).forEach((b) => (b.onclick = (e) => { e.preventDefault(); BB.setQ({ [view]: b.dataset.gpick, view: '', page: 1 }); }));
    const stage = async (ids, st) => { try { const x = await BB.post('/api/bills/stage', { ids, stage: st }); BB.toast(`${x.done} bill${x.done === 1 ? '' : 's'} marked ${st.toLowerCase()}${x.skipped ? `, ${x.skipped} left as they were` : ''}`); } catch (e) { BB.fail(e); } BB.refreshPage(); };
    $$('[data-bremind]', body).forEach((b) => (b.onclick = () => BB.flow.sendBill(r.rows.find((x) => x.id === b.dataset.bremind), 'reminder')));
    $$('[data-bstage]', body).forEach((f) => (f.onchange = () => stage([f.dataset.bstage], f.value)));
    $$('[data-bmark]', body).forEach((b) => (b.onclick = () => stage(BB.selected(body), b.dataset.bmark)));
    $('[data-badd]', actions).onclick = () => BB.flow.billForm(r).then((x) => x && (BB.toast('Bill added'), BB.refreshPage()));
    const po = $('[data-payouts]', body); if (po) po.onclick = () => { const ids = BB.selected(body); BB.ask({ title: `Mark ${ids.length} payout(s) paid`, fields: [{ name: 'ref', label: 'Payment reference' }], submit: (v) => BB.post('/api/bills/payouts', { ids, ref: v.ref }) }).then((x) => x && (BB.toast(`${x.paid} payout(s) marked paid`), BB.refreshPage())); };
  };

  // Where a message format stands with Meta.
  const fmtStatus = (f) => { const st = Object.values(f.meta_status || {}); return f.approved ? 'Approved' : st.includes('REJECTED') ? 'Rejected' : st.length ? 'Pending' : 'Not sent'; };
  // One chip per language the format has text in: approved, waiting, rejected or not sent yet.
  const LCODE = { en: 'EN', hi: 'HI', gu: 'GU', mr: 'MR', bn: 'BN', ta: 'TA', te: 'TE', kn: 'KN', ml: 'ML', pa: 'PA' };
  const langChips = (f) => Object.keys(LCODE).filter((l) => f[l]).map((l) => { const ms = f.meta_status || {}; const st = ms[l] || (!Object.keys(ms).length && f.approved ? 'APPROVED' : ''); const [cls, word] = st === 'APPROVED' ? ['ok', 'approved'] : st === 'REJECTED' ? ['bad', 'rejected'] : st ? ['wait', 'waiting for Meta'] : ['none', 'not sent to Meta']; return `<span class="lchip ${cls}" title="${esc((BB.boot.lang_names || {})[l] || l)}: ${word}">${LCODE[l]}${cls === 'ok' ? ' ✓' : ''}</span>`; }).join('');

  // ---------- Reports (17) ----------
  const REPORTS = [['funnel', 'Hiring funnel'], ['clients', 'Per client'], ['jobs', 'Per job'], ['sources', 'Source report'], ['performance', 'Recruiter / agency performance'], ['money', 'Financials'], ['replacements', 'Replacements'], ['bank', 'Resume bank']];
  // Sub admins see only their own performance and daily logs; admins their agency; the super admin everything.
  P.reports = async ({ el, actions, q, me }) => {
    const sub = me.level === 'sub'; const list = sub ? [['performance', 'My performance']] : isSuper(me) ? [...REPORTS, ['logs', 'Daily logs'], ['whatsapp', 'WhatsApp clicks'], ['resumes', 'Resume access']] : REPORTS;
    const name = list.some(([k]) => k === q.r) ? q.r : list[0][0];
    const from = q.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10); const to = q.to || BB.istDay();
    const byPerson = !sub && ['performance', 'logs'].includes(name);
    const qs = BB.qs({ from, to, agency: q.agency, client: q.client, job: q.job, city: q.city, dept: q.dept, person: byPerson ? q.person : undefined });
    const [d, users] = await Promise.all([BB.api(`/api/reports/${name}?${qs}`), sub ? null : BB.api('/api/users')]);
    const ags = isSuper(me) ? users.agencies : [];
    const people = byPerson ? users.users.filter((x) => x.level !== 'super' && (!q.agency || x.agency_id === q.agency)) : [];
    actions.innerHTML = dl(`/api/reports/${name}?${qs}&format=xlsx`); wireDl(actions);
    const cols = Object.keys(d.rows[0] || {}); const label = (c) => c.replace(/_/g, ' ');
    // Sorting and filters work on what the server sent: a column with a few repeating values gets a dropdown.
    const picks = cols.filter((c) => typeof d.rows[0][c] === 'string').map((c) => [c, [...new Set(d.rows.map((x) => x[c]).filter(Boolean))].sort()]).filter(([, v]) => v.length > 1 && v.length <= 20 && v.length < d.rows.length);
    const find = String(q.find || '').toLowerCase(); let shown = d.rows.filter((x) => (!find || cols.some((c) => String(x[c] ?? '').toLowerCase().includes(find))) && picks.every(([c]) => !q[`c_${c}`] || x[c] === q[`c_${c}`]));
    if (cols.includes(q.sort)) { const dir = q.dir === 'desc' ? -1 : 1; shown = [...shown].sort((a, b) => { const x = a[q.sort]; const y = b[q.sort]; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'en', { sensitivity: 'base', numeric: true })) * dir; }); }
    el.innerHTML = `<div class="filters">${list.map(([k, l]) => `<span class="chip ${name === k ? 'on' : ''}" data-r="${k}">${l}</span>`).join('')}</div>
      <div class="filters"><label class="small">From <input type="date" data-f="from" value="${from}"></label><label class="small">To <input type="date" data-f="to" value="${to}"></label>${ags.length ? `<select data-f="agency"><option value="">All agencies</option>${ags.map((a) => `<option value="${a.id}" ${q.agency === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}${people.length ? `<select data-f="person"><option value="">${isSuper(me) ? 'Everyone' : 'Me and my team'}</option>${people.map((x) => `<option value="${x.id}" ${q.person === x.id ? 'selected' : ''}>${esc(x.name)}${x.id === me.id ? ' (me)' : ''} · ${BB.levelName(x.level)}</option>`).join('')}</select>` : ''}${name === 'bank' ? `<select data-f="city"><option value="">All cities</option>${BB.boot.cities.map((c) => `<option ${q.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}</div>
      ${name !== 'funnel' && d.rows.length ? `<div class="filters exp-filters"><input placeholder="Search this report…" value="${esc(q.find || '')}" data-q data-rfind>${picks.map(([c, v]) => `<select data-f="c_${c}"><option value="">Any ${esc(label(c))}</option>${v.map((x) => `<option ${q[`c_${c}`] === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`).join('')}</div>` : ''}
      ${name === 'funnel' ? `<div class="card pad">${d.rows.map((r) => { const max = Math.max(1, ...d.rows.map((x) => x.count)); return `<div class="hbar"><span class="l" style="width:150px">${esc(r.step)}</span><div class="b bar gold"><i style="width:${(r.count / max) * 100}%"></i></div><span class="v">${r.count}</span><span class="small muted" style="width:70px">${r.drop ? '−' + r.drop : ''}</span></div>`; }).join('')}</div>`
        : `<div class="card rep-tbl">${BB.table(cols.map((c) => ({ t: label(c), sort: c, desc: typeof d.rows[0][c] === 'number', num: typeof d.rows[0][c] === 'number', f: (r) => (typeof r[c] === 'number' && /fee|billed|paid|total|gst|balance|received|share|tds/.test(c) ? inr(r[c]) : esc(r[c])) })), shown, { sorted: q, empty: 'No data for these filters.' })}</div>`}`;
    $$('[data-r]', el).forEach((c) => (c.onclick = () => BB.setQ({ r: c.dataset.r, find: '', sort: '', dir: '', ...Object.fromEntries(Object.keys(q).filter((k) => k.startsWith('c_')).map((k) => [k, ''])) })));
    let tf; const rf = $('[data-rfind]', el); if (rf) rf.oninput = () => { clearTimeout(tf); tf = setTimeout(() => BB.setQ({ find: rf.value }), 350); };
    BB.wireMultiSel(el); $$('[data-f]', el).forEach((i) => (i.onchange = () => BB.setQ({ [i.dataset.f]: i.value })));
  };

  // ---------- Logins & team ----------
  P.logins = async ({ el, actions, me }) => {
    actions.innerHTML = '<button class="btn" data-mypw>Change my password</button>';
    $('[data-mypw]', actions).onclick = () => BB.changePassword(false);
    if (me.level === 'sub') { el.innerHTML = `<div class="card pad" style="max-width:520px"><dl class="kv"><dt>Name</dt><dd>${esc(me.name)}</dd><dt>Username</dt><dd class="mono">${esc(me.username)}</dd><dt>Level</dt><dd>Sub admin</dd><dt>Agency</dt><dd>${esc(BB.me.agency ? BB.me.agency.name : '')}</dd></dl><p class="small muted">Ask your admin to reset your password if you forget it.</p></div>`; return; }
    const d = await BB.api('/api/users'); const sup = isSuper(me);
    actions.insertAdjacentHTML('afterbegin', dl('/api/users?format=xlsx'));
    actions.innerHTML += `${sup ? '<button class="btn" data-addag>+ Add agency</button>' : ''}<button class="btn primary" data-add>+ Add login</button>`;
    // The login, shown once, with the message to share it: copy it, or open WhatsApp with it filled in.
    const showPw = (title, u, pw, who = {}) => { const msg = `Hello${who.name ? ` ${who.name.split(' ')[0]}` : ''},

Your login for the BrillBrains Hiring portal:
${location.origin}/team
Username: ${u}
Password: ${pw}

Please change the password after you log in.`;
      const wa = who.whatsapp ? `https://wa.me/91${String(who.whatsapp).replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(msg)}` : '';
      return BB.modal({ title, foot: `<span class="faint small grow">Shown once. Share it now.</span><button class="btn" data-cpmsg>Copy message</button>${wa ? `<a class="btn primary" href="${wa}" target="_blank" rel="noopener">Send on WhatsApp</a>` : ''}`, body: `<div class="stack"><div>Username: <b class="mono">${esc(u)}</b></div><div>Password: <b class="mono" style="font-size:18px">${esc(pw)}</b> <button class="btn sm" data-cp>Copy</button></div></div>`, onMount: (m) => { const cm = $('[data-cpmsg]', m); if (cm) cm.onclick = () => { BB.copy(msg); BB.toast('Message copied'); }; $('[data-cp]', m).onclick = () => BB.copy(pw); } }); };
    const credBox = (list) => `<div class="cred-box"><b class="small">Login details</b>${list.length ? list.map((u) => `<div class="cred-row"><div class="grow"><div class="small">${esc(u.name)} <span class="faint tiny">· ${esc(BB.levelName(u.level))}</span></div><div>Username: <b class="mono">${esc(u.username)}</b> <button type="button" class="btn sm" data-cpuser="${esc(u.username)}">Copy</button></div><div class="tiny muted">Password: stored locked, so it cannot be shown again. Make a new one to share it.</div></div><button type="button" class="btn sm" data-newpw="${u.id}">New password</button></div>`).join('') : '<div class="tiny muted">No login yet for this agency.</div>'}</div>`;
    const credWire = (m) => {
      $$('[data-cpuser]', m).forEach((b) => (b.onclick = () => BB.copy(b.dataset.cpuser)));
      $$('[data-newpw]', m).forEach((b) => (b.onclick = async () => { const u = d.users.find((x) => x.id === b.dataset.newpw); if (!(await BB.confirm('New password', `A new password is made for ${esc(u.name)} and shown here with Copy. The old one stops working and they are logged out.`, 'Make new password'))) return; const r = await BB.post(`/api/users/${u.id}/reset`).catch(BB.fail); if (r) showPw('New password', u.username, r.password, u); }));
    };
    const loginCols = [{ t: 'Name', f: (u) => `<b>${esc(u.name)}</b><div class="tiny mono muted">${esc(u.whatsapp)}</div>${u.email ? `<div class="tiny muted">${esc(u.email)}</div>` : ''}` }, { t: 'Username', f: (u) => `<span class="mono">${esc(u.username)}</span>` }, { t: 'Level', f: (u) => BB.levelName(u.level) }, { t: 'Agency', f: (u) => esc(u.agency_name || 'BrillBrains') }, { t: 'Role', f: (u) => esc(u.role), hideSm: 1 }, { t: 'Last login', f: (u) => fmtDT(u.last_login), hideSm: 1 }, { t: 'On/off', f: (u) => `<span class="badge ${u.status === 'On' ? 'b-green' : 'b-red'}">${u.status}</span>${u.locked ? ' <span class="badge b-amber">Locked</span>' : ''}` },
        { t: '', f: (u) => (u.id === me.id ? `<button class="btn sm" data-edituser="${u.id}">Edit</button>` : !sup && u.level !== 'sub' ? '' : `<div class="row nowrap">${u.locked ? `<button class="btn sm" data-unlock="${u.id}">Unlock</button>` : ''}<button class="btn sm" data-edituser="${u.id}">Edit</button><button class="btn sm" data-reset="${u.id}">Reset password</button><button class="btn sm ${u.status === 'On' ? 'danger' : ''}" data-toggle="${u.id}">${u.status === 'On' ? 'Turn off' : 'Turn on'}</button></div>`) }];
    // Who owns each hiring channel: a real login, or a shared label. Saved on the channel, so every job and the tracker follow.
    const cfg = sup ? await BB.api('/api/settings') : null; const chans = (cfg && cfg.hiring_channels) || [];
    const active = d.users.filter((u) => u.status === 'On');
    const linked = (c) => c.owner_id || (active.find((u) => u.name === c.owner) || {}).id; // an owner typed in the sheet who has a login counts as that login
    const ownerOpts = (c) => { const lid = linked(c); const known = lid || ['All BBHS Team', 'To be decided'].includes(c.owner); return `${known || !c.owner ? '' : `<option value="t:${esc(c.owner)}" selected>${esc(c.owner)} (no login)</option>`}<optgroup label="Logins">${active.map((u) => `<option value="u:${u.id}" ${lid === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</optgroup><optgroup label="Shared">${['All BBHS Team', 'To be decided'].map((t) => `<option value="t:${t}" ${!lid && c.owner === t ? 'selected' : ''}>${t}</option>`).join('')}</optgroup>`; };
    const ownersCard = () => { const secs = [...new Set(chans.map((c) => c.section))]; const noLogin = chans.filter((c) => !linked(c) && !['All BBHS Team', 'To be decided'].includes(c.owner)).length; const open = chans.filter((c) => c.owner === 'To be decided').length;
      return `<div class="card pad"><div class="row between"><h3 style="margin:0">Digital Reach owners</h3><span class="small muted">${noLogin ? `${noLogin} owned by someone with no login` : 'All linked to logins'}${open ? ` · ${open} to be decided` : ''}</span></div><p class="small muted" style="margin:6px 0 10px">Changes here apply to every job and to Digital Reach.</p>${secs.map((sc) => `<div class="own-sec"><div class="row between"><b class="small">${esc(sc)}</b><select class="mini" data-ownall="${esc(sc)}"><option value="">Set all in this section…</option><optgroup label="Logins">${active.map((u) => `<option value="u:${u.id}">${esc(u.name)}</option>`).join('')}</optgroup><optgroup label="Shared"><option value="t:All BBHS Team">All BBHS Team</option><option value="t:To be decided">To be decided</option></optgroup></select></div>${chans.filter((c) => c.section === sc).map((c) => `<div class="own-row"><span>${esc(c.channel)}</span><select class="mini" data-ownch="${esc(c.key)}">${ownerOpts(c)}</select></div>`).join('')}</div>`).join('')}</div>`; };
    el.innerHTML = `${sup ? `<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>Agencies</h3></div>${BB.table([{ t: 'Agency', f: (a) => `<b>${esc(a.name)}</b><div class="tiny muted">${esc(a.city)} · since ${fmtD(a.since)}</div>` }, { t: 'People', num: 1, f: (a) => a.people }, { t: 'Share', num: 1, f: (a) => (a.share_pct === null || a.share_pct === undefined ? `${BB.boot.agency_share_pct}% (standard)` : `${a.share_pct}%`) }, { t: 'Status', f: (a) => `<span class="badge ${a.status === 'Active' ? (a.view_status === 'On track' ? 'b-green' : 'b-amber') : 'b-red'}">${a.status === 'Active' ? esc(a.view_status) : 'Paused'}</span>` }, { t: '', f: (a) => `<div class="row nowrap"><button class="btn sm" data-agedit="${a.id}">Edit</button><button class="btn sm ${a.status === 'Active' ? 'danger' : ''}" data-agtoggle="${a.id}">${a.status === 'Active' ? 'Pause' : 'Turn on'}</button><button class="btn sm danger" data-agdel="${a.id}">Delete</button></div>` }], d.agencies)}</div>` : ''}
      ${(BB.boot.team_sections || ['Recruitment']).map((t) => { const rows = d.users.filter((u) => (u.team || 'Recruitment') === t); return rows.length ? `<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>${esc(t)}</h3><span class="small muted">${rows.length} login${rows.length === 1 ? '' : 's'}${t === 'Recruitment' ? '' : ' · Digital Reach only for sub admins'}</span></div>${BB.table(loginCols, rows)}</div>` : ''; }).join('')}
      ${sup ? ownersCard() : ''}`;
    wireDl(actions);
    const saveOwners = async (keys, val) => { const [kind, id] = [val.slice(0, 1), val.slice(2)]; const who = active.find((u) => u.id === id); const next = chans.map((c) => (keys.includes(c.key) ? { ...c, owner: kind === 'u' ? who.name : id, owner_id: kind === 'u' ? id : undefined } : c)); try { await BB.put('/api/settings/hiring_channels', { value: next }); BB.toast('Owner saved'); BB.refreshPage(); } catch (e) { BB.fail(e); } };
    $$('[data-ownch]', el).forEach((x) => (x.onchange = () => saveOwners([x.dataset.ownch], x.value)));
    $$('[data-ownall]', el).forEach((x) => (x.onchange = () => { if (x.value) saveOwners(chans.filter((c) => c.section === x.dataset.ownall).map((c) => c.key), x.value); }));
    $('[data-add]', actions).onclick = () => {
      BB.ask({ title: 'Add login', note: sup ? 'Username is filled in from the name and can be changed.' : 'New logins in your agency are sub admins.', fields: [
        `<div class="grid g2">${field({ name: 'name', label: 'Name', attrs: 'data-name' })}${field({ name: 'whatsapp', label: 'WhatsApp', type: 'tel', phone: true })}</div>`,
        field({ name: 'username', label: 'Username', voice: false, attrs: 'data-username' }),
        field({ name: 'email', label: 'Email', type: 'email', opt: true, placeholder: 'Reminders and task alerts also come here' }),
        ...(sup ? [field({ name: 'team', label: 'Team', type: 'select', options: BB.boot.team_sections, value: 'Recruitment', placeholder: false, voice: false, hint: 'Sub admins in Accounts see invoicing, clients, offers and Profit & Loss. In Social media & marketing or Tech they see only hiring channels. Neither needs an agency.' })] : []),
        ...(sup ? [`<div class="grid g2">${field({ name: 'level', label: 'Level', type: 'select', options: [['sub', 'Sub admin'], ['admin', 'Admin'], ['super', 'Super admin']], value: 'sub', placeholder: false })}${field({ name: 'agency_id', label: 'Agency', type: 'select', options: d.agencies.map((a) => [a.id, a.name]) })}</div>`] : []),
        { name: 'role', label: 'Role', value: 'Recruiter' },
      ], ok: 'Create login', submit: (v) => BB.post('/api/users', v) }).then((x) => { if (x) { showPw('Login created', x.username, x.password, x); BB.refreshPage(); } });
      setTimeout(() => { const n = $('[data-name]'); const u = $('[data-username]'); if (!n) return; let t; n.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { if (u.dataset.touched) return; const r = await BB.api(`/api/users/suggest?name=${encodeURIComponent(n.value)}`); u.value = r.username; }, 250); }); u.addEventListener('input', () => (u.dataset.touched = '1')); }, 60);
    };
    const aa = $('[data-addag]', actions); if (aa) aa.onclick = () => BB.ask({ title: 'Add agency', fields: [`<div class="grid g2">${field({ name: 'name', label: 'Agency name', placeholder: 'Partner Agency – Pune' })}${field({ name: 'city', label: 'City', list: 'cities' })}</div>`, { name: 'share_pct', label: 'Agency share % (empty = standard)', type: 'number', opt: true }, '<hr class="sep"><b class="small">Agency admin</b>', `<div class="grid g2">${field({ name: 'admin_name', label: 'Admin name' })}${field({ name: 'admin_whatsapp', label: 'Admin WhatsApp', type: 'tel', phone: true })}</div>`, field({ name: 'admin_email', label: 'Admin email', type: 'email', opt: true, placeholder: 'Reminders and task alerts also come here' })], ok: 'Add agency', submit: (v) => BB.post('/api/agencies', v) }).then((x) => { if (x) { if (x.admin) showPw(`${x.id} added with its admin`, x.admin.username, x.admin.password, x.admin); BB.refreshPage(); } });
    $$('[data-reset]', el).forEach((b) => (b.onclick = async () => { if (!(await BB.confirm('Reset password', 'A new password is made, shown once here and sent once on WhatsApp. They are logged out everywhere.', 'Reset'))) return; const r = await BB.post(`/api/users/${b.dataset.reset}/reset`).catch(BB.fail); if (r) showPw('New password', d.users.find((u) => u.id === b.dataset.reset).username, r.password, d.users.find((u) => u.id === b.dataset.reset)); }));
    $$('[data-toggle]', el).forEach((b) => (b.onclick = async () => { await BB.post(`/api/users/${b.dataset.toggle}/toggle`).catch(BB.fail); BB.refreshPage(); }));
    $$('[data-edituser]', el).forEach((b) => (b.onclick = () => { const u = d.users.find((x) => x.id === b.dataset.edituser); BB.ask({ title: `Edit ${u.id}`, fields: [{ name: 'name', label: 'Name', value: u.name }, field({ name: 'whatsapp', label: 'WhatsApp', type: 'tel', phone: true, value: u.whatsapp }), { name: 'email', label: 'Email (reminders and task alerts also come here)', value: u.email || '' }, { name: 'role', label: 'Role', value: u.role || '' }, ...(sup && u.id !== me.id ? [{ name: 'team', label: 'Team', type: 'select', options: BB.boot.team_sections, value: u.team || 'Recruitment', placeholder: false, voice: false }] : []), u.id !== me.id ? credBox([u]) : ''], ok: 'Save', submit: (v) => BB.patch(`/api/users/${u.id}`, v), mount: credWire }).then((x) => x && (BB.toast('Saved'), BB.refreshPage())); }));
    $$('[data-unlock]', el).forEach((b) => (b.onclick = async () => { await BB.post(`/api/users/${b.dataset.unlock}/unlock`).catch(BB.fail); BB.toast('Unlocked'); BB.refreshPage(); }));
    $$('[data-agtoggle]', el).forEach((b) => (b.onclick = async () => { const a = d.agencies.find((x) => x.id === b.dataset.agtoggle); if (a.status === 'Active' && !(await BB.confirm('Pause agency', `Nobody in ${esc(a.name)} can log in while it is paused. Their records stay.`, 'Pause'))) return; await BB.post(`/api/agencies/${a.id}/toggle`).catch(BB.fail); BB.refreshPage(); }));
    $$('[data-agdel]', el).forEach((b) => (b.onclick = async () => {
      const a = d.agencies.find((x) => x.id === b.dataset.agdel); const u = await BB.api(`/api/agencies/${a.id}/use`).catch(BB.fail); if (!u) return;
      const x = await BB.ask({ title: `Delete ${a.name}`, note: `This cannot be undone. ${u.logins} login${u.logins === 1 ? '' : 's'} will be turned off. ${u.clients} client${u.clients === 1 ? '' : 's'}, ${u.jobs} job${u.jobs === 1 ? '' : 's'} and ${u.candidates} candidate${u.candidates === 1 ? '' : 's'} stay in the portal under BrillBrains.${u.payouts_due ? ` ${u.payouts_due} payout(s) are still due, so this will be refused until they are paid.` : ''}`, fields: [{ name: 'name', label: `Type ${a.name} to confirm`, voice: false }], ok: 'Delete agency', submit: (v) => BB.post(`/api/agencies/${a.id}/delete`, v) });
      if (x) { BB.toast('Agency deleted'); BB.refreshPage(); }
    }));
    $$('[data-agedit]', el).forEach((b) => (b.onclick = () => { const a = d.agencies.find((x) => x.id === b.dataset.agedit); BB.ask({ title: `Edit ${a.id}`, fields: [{ name: 'name', label: 'Name', value: a.name }, { name: 'city', label: 'City', value: a.city }, { name: 'share_pct', label: 'Agency share % (empty = standard)', type: 'number', value: a.share_pct ?? '' }, credBox(d.users.filter((u) => u.agency_id === a.id).sort((x, y) => (x.level === 'admin' ? -1 : 0) - (y.level === 'admin' ? -1 : 0)))], submit: (v) => BB.patch(`/api/agencies/${a.id}`, v), mount: credWire }).then((x) => x && BB.refreshPage()); }));
  };

  // ---------- Settings (super admin, section 10) ----------
  // Settings: every tab for the super admin; admins and sub admins see only Departments & roles.
  // Deleted items: what was deleted (with everything that went with it), to restore or delete for good.
  // JD pool: a ready job description per role. Pick a role, edit its sections (with the jewellery-experience
  // section), write a first draft with AI, save. Writing a job's JD can start from here.
  async function jdPoolView(body, q, me) {
    const d = await BB.api('/api/jd-pool'); const roles = [...new Set([...BB.boot.jobs.map((x) => x.title), ...Object.keys(d.pool)])].sort();
    const role = q.role || ''; const jd = (role && d.pool[role]) || {};
    body.innerHTML = `<div class="jdp"><div class="card pad jdp-list">${!me.accounts_only ? '<button class="btn sm primary" data-jdup style="width:100%;justify-content:center;margin-bottom:8px">Upload JDs</button>' : ''}<input placeholder="Find a role…" data-jdfind><div class="stack-sm" style="margin-top:8px;max-height:60vh;overflow:auto">${roles.map((r) => `<a href="#" class="jdp-role ${r === role ? 'on' : ''}" data-role="${esc(r)}">${esc(r)}${d.pool[r] ? ' <span class="badge b-green tiny">JD</span>' : ''}</a>`).join('')}</div></div>
      <div class="card pad">${role ? `<div class="row between"><h3 style="margin:0">${esc(role)}</h3><div class="row">${d.ai ? '<button class="btn sm primary" data-ai>✦ Write with AI</button>' : '<span class="small muted">AI writing: add ANTHROPIC_API_KEY to the server .env</span>'}${d.pool[role] && !me.accounts_only ? '<button class="btn sm danger" data-rm>Remove</button>' : ''}</div></div>
        <form class="stack" data-jdform style="margin-top:12px">${BB.jdFields(jd).map((x) => (typeof x === 'string' ? x : BB.field(x))).join('')}${!me.accounts_only ? '<button class="btn primary">Save JD for this role</button>' : '<p class="small muted">Only admins can change the pool.</p>'}</form>` : '<p class="muted">Pick a role on the left to write or edit its job description. Roles with a <span class="badge b-green tiny">JD</span> have one already.</p>'}</div></div>`;
    $$('[data-role]', body).forEach((a) => (a.onclick = (e) => { e.preventDefault(); BB.setQ({ role: a.dataset.role }); }));
    const up = $('[data-jdup]', body); if (up) up.onclick = async () => {
      const files = await BB.pickFiles('.pdf,.docx'); if (!files || !files.length) return; up.disabled = true; let n = 0; const bad = [];
      for (const f of files) { up.textContent = `Reading ${n + bad.length + 1} of ${files.length}…`; try { const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); await BB.post('/api/jd-pool/upload', { name: f.name, base64 }); n++; } catch (e) { bad.push(f.name); } }
      BB.toast(`${n} JD${n === 1 ? '' : 's'} added to the pool${bad.length ? `. Not read: ${bad.slice(0, 2).join(', ')}` : ''}`, !!bad.length); BB.refreshPage();
    };
    $('[data-jdfind]', body).oninput = (e) => { const t = e.target.value.toLowerCase(); $$('[data-role]', body).forEach((a) => { a.hidden = !a.dataset.role.toLowerCase().includes(t); }); };
    const form = $('[data-jdform]', body); if (!form) return;
    form.onsubmit = async (e) => { e.preventDefault(); try { await BB.post('/api/jd-pool', { title: role, jd: BB.formValues(form) }); BB.toast(`JD for ${role} saved`); BB.refreshPage(); } catch (er) { BB.fail(er); } };
    const rm = $('[data-rm]', body); if (rm) rm.onclick = async () => { if (await BB.confirm('Remove JD', `Remove the pooled JD for ${role}?`, 'Remove')) { await BB.post('/api/jd-pool', { title: role, remove: true }); BB.refreshPage(); } };
    const ai = $('[data-ai]', body); if (ai) ai.onclick = async () => { ai.disabled = true; ai.textContent = 'Writing…'; const v = BB.formValues(form); try { const r = await BB.post('/api/jd/write', { title: role, jewel_need: v.jewel_need, jewel_years: v.jewel_years, jewel_note: v.jewel_note, notes: [v.summary, v.must].filter(Boolean).join('\n') }); BB.fillJd(form, { ...r.jd, jewel_need: v.jewel_need, jewel_years: v.jewel_years, jewel_note: v.jewel_note }); BB.toast('Written. Check and edit, then save.'); } catch (er) { BB.fail(er); } ai.disabled = false; ai.textContent = '✦ Write with AI'; };
  }
  async function trashView(body) {
    const r = await BB.api('/api/trash'); const KIND = { client: 'Client', job: 'Job opening', candidate: 'Candidate', application: 'Application' };
    const what = (c) => Object.entries(c || {}).filter(([k]) => ['clients', 'jobs', 'candidates', 'applications'].includes(k)).map(([k, n]) => `${n} ${k}`).join(', ');
    body.innerHTML = `<div class="card pad stack-sm"><p class="small muted" style="margin:0">Deleted clients, job openings, candidates and applications stay here with everything that went with them. Restore puts it all back as it was. Records with bills cannot be deleted.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Deleted</th><th>What</th><th>Name</th><th>Went with it</th><th>By</th><th></th></tr></thead><tbody>${r.rows.map((t) => `<tr><td class="small">${fmtDT(t.deleted_at)}</td><td>${KIND[t.kind] || t.kind} <span class="mono tiny faint">${esc(t.ref_id)}</span></td><td><b>${esc(t.label)}</b></td><td class="small">${esc(what(t.counts))}</td><td class="small">${esc(t.deleted_by)}</td><td class="nowrap"><button class="btn sm primary" data-restore="${t.id}">Restore</button> <button class="btn sm danger" data-purge="${t.id}">Delete for good</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing deleted.</td></tr>'}</tbody></table></div></div>`;
    $$('[data-restore]', body).forEach((b) => (b.onclick = async () => { try { const x = await BB.post(`/api/trash/${b.dataset.restore}/restore`); BB.toast(`Restored${x.skipped.length ? ` (${x.skipped.length} parts skipped)` : ''}`); trashView(body); } catch (e) { BB.fail(e); } }));
    $$('[data-purge]', body).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Delete for good', 'This cannot be undone.', 'Delete for good')) { try { await BB.post(`/api/trash/${b.dataset.purge}/purge`); BB.toast('Deleted for good'); trashView(body); } catch (e) { BB.fail(e); } } }));
  }
  P.settings = async ({ el, q, me }) => {
    const sup = isSuper(me); const tab = q.tab || 'holds';
    const tabs = [['holds', 'Messages on hold'], ...(sup ? [['whatsapp', 'WhatsApp']] : []), ['rules', 'Automatic messages'], ['formats', 'Message formats'], ['match', 'Matching'], ['money', 'Fees & limits'], ['lists', 'Lists'], ['roles', 'Departments & roles'], ['jdpool', 'JD pool'], ...(sup ? [['trash', 'Deleted items']] : []), ['jobs', 'Job list'], ['papers', 'Paper templates'], ['business', 'Business'], ...(sup ? [['privacy', 'Data requests'], ['health', 'Health']] : [])];
    el.innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div data-tb></div>`;
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => BB.setQ({ tab: b.dataset.tab })));
    if (tab === 'roles') return rolesView($('[data-tb]', el), q, me);
    if (tab === 'trash') return trashView($('[data-tb]', el));
    if (tab === 'jdpool') return jdPoolView($('[data-tb]', el), q, me);
    const s = await BB.api('/api/settings');
    const body = $('[data-tb]', el);
    const save = async (key, value, msg = 'Saved') => { try { await BB.put(`/api/settings/${key}`, { value }); BB.toast(msg); BB.boot = await (await fetch('/api/bootstrap')).json(); BB.refreshPage(); } catch (e) { BB.fail(e); } };
    const listEditor = (key, label, items) => `<div class="card pad stack-sm"><div class="row between"><h3>${label}</h3><button class="btn sm primary" data-savelist="${key}">Save</button></div><textarea data-list="${key}" rows="8">${esc(items.join('\n'))}</textarea><div class="faint tiny">One per line.</div></div>`;
    const chan = (r) => r.channel || (['log_reminder', 'day_summary', 'monthly_summary', 'still_looking'].includes(r.key) ? 'email' : 'both');
    if (tab === 'holds') return BB.flow.holds(body, save);
    if (tab === 'whatsapp') {
      const c = s.crm;
      body.innerHTML = `<div class="card pad stack" style="max-width:720px"><div class="notice small">Messages go from the BrillBrains business number through the BrillBrains WhatsApp CRM. The CRM sends replies (chats marked "Hiring") to <span class="mono">${esc(location.origin)}/api/crm/inbound</span> and status updates to <span class="mono">${esc(location.origin)}/api/crm/status</span>, with the header <span class="mono">x-bbhs-secret</span>.</div>
        <form class="stack" data-crm>${field({ name: 'enabled', label: 'Connected (send real messages through the CRM)', type: 'check', value: c.enabled })}${field({ name: 'send_url', label: 'CRM send link', value: c.send_url, voice: false, placeholder: 'https://crm.example.com/api/hiring/send' })}${field({ name: 'token', label: 'Permanent access token (kept in settings, never in the code)', type: 'password', value: c.token, voice: false })}${field({ name: 'webhook_secret', label: 'Webhook check word (change the one shared earlier)', value: c.webhook_secret, voice: false })}<button class="btn primary">Save connection</button></form></div>`;
      $('[data-crm]', body).onsubmit = (e) => { e.preventDefault(); const v = BB.formValues(e.target); save('crm', { ...c, ...v }); };
      // Testing pause: candidate WhatsApp is held except for the listed numbers (login codes and typed replies still go).
      const wp = s.wa_pause || { candidates: false, allow: [] };
      body.insertAdjacentHTML('afterbegin', `<div class="card pad stack-sm" style="max-width:720px;margin-bottom:14px;${wp.candidates ? 'border-color:var(--amber)' : ''}"><div class="row between"><h3>Pause WhatsApp to candidates (testing)</h3>${wp.candidates ? '<span class="badge b-amber">Paused</span>' : '<span class="badge b-green">Sending</span>'}</div>
        <p class="small muted" style="margin:0">While paused, messages to candidates are saved as "held" and not sent, except to the numbers below. Login codes and replies typed by the team still go. Held messages are not sent later.</p>
        <form class="stack-sm" data-wapause>${field({ name: 'candidates', label: 'Pause candidate WhatsApp', type: 'check', value: wp.candidates })}<label class="field"><span class="lab">Still send to these numbers (one per line)</span><textarea name="allow" rows="3">${esc((wp.allow || []).join('\n'))}</textarea></label><div><button class="btn primary sm">Save</button></div></form></div>`);
      $('[data-wapause]', body).onsubmit = (e) => { e.preventDefault(); const f = e.target; save('wa_pause', { candidates: f.candidates.checked, allow: f.allow.value.split(/[\s,]+/).map((x) => x.replace(/\D/g, '').slice(-10)).filter((x) => x.length === 10) }); };
      const fe = c.from_env || {}; for (const k of Object.keys(fe)) { const inp = $(`[name=${k}]`, body); if (inp) { inp.disabled = true; inp.closest('.field, label').insertAdjacentHTML('beforeend', '<div class="faint small">Set in the .env file on the server</div>'); } }
    } else if (tab === 'rules') {
      body.innerHTML = `<div class="card">${BB.table([{ t: 'On', f: (r) => `<input type="checkbox" data-rule="${r.key}" ${r.on ? 'checked' : ''}>` }, { t: 'When', f: (r) => esc(r.when) }, { t: 'To', f: (r) => esc(r.to) }, { t: 'Send by', f: (r) => (r.team_email ? '<span class="small muted">Email</span>' : `<select data-rulechan="${r.key}" style="width:auto"><option value="both" ${chan(r) === 'both' ? 'selected' : ''}>WhatsApp + email</option><option value="email" ${chan(r) === 'email' ? 'selected' : ''}>Email only</option></select>`) }, { t: 'Format', f: (r) => (r.team_email ? '<span class="small muted">—</span>' : `<select data-rulefmt="${r.key}" style="width:auto">${Object.keys(s.formats).map((k) => `<option ${k === r.format ? 'selected' : ''}>${k}</option>`).join('')}</select>`) }], s.auto_rules)}</div>
        `;
      const rules = s.auto_rules.map((r) => ({ ...r }));
      $$('[data-rulechan]', body).forEach((sl) => (sl.onchange = () => { rules.find((r) => r.key === sl.dataset.rulechan).channel = sl.value; save('auto_rules', rules); }));
      $$('[data-rule]', body).forEach((cb) => (cb.onchange = () => { rules.find((r) => r.key === cb.dataset.rule).on = cb.checked; save('auto_rules', rules); }));
      $$('[data-rulefmt]', body).forEach((sl) => (sl.onchange = () => { rules.find((r) => r.key === sl.dataset.rulefmt).format = sl.value; save('auto_rules', rules); }));
    } else if (tab === 'formats') {
      body.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn primary" data-push>Send selected to Meta</button><button class="btn" data-ftr>Translate selected</button><button class="btn" data-sync>Check approval status</button><select data-fst aria-label="Filter by status" class="fmt-filter"><option value="">All statuses</option>${['Approved', 'Pending', 'Rejected', 'Not sent'].map((x) => `<option ${q.fst === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="small muted" style="margin-bottom:10px">Select message formats and send them to Meta for approval. Each language is approved on its own: <span class="lchip ok">EN ✓</span> approved, <span class="lchip wait">GU</span> waiting for Meta, <span class="lchip bad">TA</span> rejected, <span class="lchip none">MR</span> not sent yet. A person gets their language once it is approved, English until then.</div><div class="card">${BB.table([{ t: 'On', f: (f) => `<label class="switch" title="${f.off ? 'Off: never sent to anyone' : 'On: can be sent'}"><input type="checkbox" data-fon="${f.k}" ${f.off ? '' : 'checked'}><span></span></label>` }, { t: 'Format', f: (f) => `<span class="mono">${f.k}</span> <span class="badge b-red tiny ${f.off ? '' : 'hidden'}" data-foff="${f.k}">Off</span>` }, { t: 'Type', f: (f) => `<span class="badge ${f.type === 'Marketing' ? 'b-gold' : 'b-outline'}">${f.type}</span>` }, { t: 'Approval', f: (f) => `<span class="badge ${f.st === 'Approved' ? 'b-green' : f.st === 'Rejected' ? 'b-red' : 'b-amber'}">${f.st}</span><div class="lchips">${langChips(f)}</div>` }, { t: 'English', f: (f) => `<div class="small" style="max-width:340px">${esc(f.en)}</div>` }, { t: 'Buttons', f: (f) => f.buttons.map((b) => `<span class="badge b-outline tiny">${esc(b)}</span>`).join(' ') }, { t: '', f: (f) => `<button class="btn sm" data-fedit="${f.k}">Edit</button>` }], Object.entries(s.formats).map(([k, f]) => ({ id: k, k, ...f, st: fmtStatus(f) })).filter((f) => !q.fst || f.st === q.fst), { select: true, empty: 'No formats with this status.' })}</div>`;
      BB.wireSelect(body); $('[data-fst]', body).onchange = (e) => BB.setQ({ fst: e.target.value });
      $('[data-ftr]', body).onclick = () => BB.care.translateFormats(BB.selected(body));
      $('[data-push]', body).onclick = async (e) => { const names = BB.selected(body); if (!names.length) return BB.toast('Select the formats to send', true); if (!(await BB.confirm('Send to Meta', `Each selected format goes in every language it has text for. Languages Meta already has are left out. Meta usually reviews them within minutes to hours; the portal checks their answer every 30 minutes.`, 'Send'))) return; e.target.disabled = true; try { const r = await BB.post('/api/settings/formats/push', { names }); const bad = r.results.filter((x) => !x.ok); BB.modal({ title: 'Sent to Meta', wide: true, foot: false, onClose: () => BB.refreshPage(), body: `<p>${r.results.length - bad.length} accepted for review${r.results.some((x) => x.skipped) ? `, ${r.results.filter((x) => x.skipped).length} already with Meta` : ''}${bad.some((x) => !x.skipped) ? `, ${bad.filter((x) => !x.skipped).length} refused` : ''}.</p>${bad.length ? `<div class="small stack-sm">${bad.map((x) => `<div><span class="mono">${esc(x.name)} (${esc(x.language)})</span>: <span class="${x.skipped ? 'muted' : ''}">${esc(x.error)}</span></div>`).join('')}</div>` : ''}` }); } catch (er) { BB.fail(er); } finally { e.target.disabled = false; } };
      $('[data-sync]', body).onclick = async () => { try { const r = await BB.post('/api/settings/formats/sync'); BB.toast(`Status updated${r.missing.length ? ` — not on Meta yet: ${r.missing.length}` : ''}`); BB.refreshPage(); } catch (er) { BB.fail(er); } };
      // On/off: an off format is never sent, automatically, in bulk or by hand.
      $$('[data-fon]', body).forEach((c) => (c.onchange = () => { const k = c.dataset.fon; s.formats[k] = { ...s.formats[k], off: !c.checked }; BB.put('/api/settings/formats', { value: s.formats }).then(() => { BB.toast(c.checked ? `${k} switched on` : `${k} switched off: it will not be sent to anyone`); const b = $(`[data-foff="${k}"]`, body); if (b) b.classList.toggle('hidden', c.checked); c.closest('.switch').title = c.checked ? 'On: can be sent' : 'Off: never sent to anyone'; }).catch((e) => { c.checked = !c.checked; s.formats[k] = { ...s.formats[k], off: !c.checked }; BB.toast(e.message, 'bad'); }); }));
      $$('[data-fedit]', body).forEach((b) => (b.onclick = () => { const k = b.dataset.fedit; const f = s.formats[k]; BB.ask({ title: k, wide: true, fields: [{ name: 'approved', label: 'Approved by Meta', type: 'check', value: f.approved }, { name: 'type', label: 'Type', type: 'select', options: ['Utility', 'Marketing', 'Authentication'], value: f.type, placeholder: false }, ...Object.entries(BB.boot.lang_names || { en: 'English', hi: 'Hindi' }).filter(([l]) => l === 'en' || f[l] || (BB.boot.languages || []).includes(l)).map(([l, n]) => ({ name: l, label: `${n}${(f.meta_status || {})[l] ? ` (Meta: ${f.meta_status[l].toLowerCase()})` : ''}`, type: 'textarea', value: f[l] || '', opt: l !== 'en' })), { name: 'buttons', label: 'Buttons (comma separated)', value: f.buttons.join(', ') }], submit: (v) => BB.put('/api/settings/formats', { value: { ...s.formats, [k]: { ...f, approved: v.approved, type: v.type, ...Object.fromEntries(Object.keys(BB.boot.lang_names || { en: 1, hi: 1 }).filter((l) => l in v).map((l) => [l, v[l]])), buttons: v.buttons.split(',').map((x) => x.trim()).filter(Boolean) } } }) }).then((x) => x && (BB.toast('Saved'), BB.refreshPage())); }));
    } else if (tab === 'match') {
      const w = s.match.weights;
      body.innerHTML = `<div class="card pad stack" style="max-width:640px"><p class="small muted" style="margin:0">Match score out of 100. Each part adds its weight when it fits fully. Total weight: <b data-total></b></p>${Object.entries(w).map(([k, v]) => `<div class="row"><span style="width:120px;text-transform:capitalize">${k === 'rating' ? 'Interview rating' : k}</span><input type="range" min="0" max="50" value="${v}" data-w="${k}" class="grow"><b data-wv="${k}" style="width:30px;text-align:right">${v}</b></div>`).join('')}
        <div class="grid g2">${field({ name: 'strong', label: 'Strong match (job alerts) at', type: 'number', value: s.match.strong })}${field({ name: 'show', label: 'Show in "Jobs for you" from', type: 'number', value: s.match.show })}</div><button class="btn primary" data-savem>Save matching</button></div>`;
      const tot = () => { $('[data-total]', body).textContent = $$('[data-w]', body).reduce((a, i) => a + Number(i.value), 0); }; tot();
      $$('[data-w]', body).forEach((i) => (i.oninput = () => { $(`[data-wv="${i.dataset.w}"]`, body).textContent = i.value; tot(); }));
      $('[data-savem]', body).onclick = () => { const weights = {}; $$('[data-w]', body).forEach((i) => (weights[i.dataset.w] = Number(i.value))); const v = BB.formValues(body); save('match', { weights, strong: Number(v.strong), show: Number(v.show) }); };
    } else if (tab === 'money') {
      const ac = s.aftercare || { candidate: [7, 14, 21, 30, 60, 90], client: [7, 30, 60, 90] }; const tl = s.team_login || { password: true, whatsapp: true, email: true };
      body.innerHTML = `<form class="card pad stack-sm" style="max-width:760px;margin-bottom:14px" data-care><b>After joining: check-in days</b><div class="small muted">Days after joining. Each one gives the recruiter a call task; the WhatsApp messages go when switched on in Automatic messages.</div><div class="grid g2">${field({ name: 'cand_days', label: 'With the candidate', value: ac.candidate.join(', '), voice: false })}${field({ name: 'client_days', label: 'With the client', value: ac.client.join(', '), voice: false })}</div><button class="btn primary" style="width:max-content">Save</button></form>${sup ? `<form class="card pad stack-sm" style="max-width:760px;margin-bottom:14px" data-tlogin><b>How the team logs in</b><div class="small muted">A code on WhatsApp costs a little for each login (an authentication message); a code by email is free. Super admins can always use their password.</div><div class="row">${field({ name: 'tl_password', label: 'Username and password', type: 'check', value: tl.password !== false })}${field({ name: 'tl_whatsapp', label: 'Code on WhatsApp', type: 'check', value: tl.whatsapp !== false })}${field({ name: 'tl_email', label: 'Code by email', type: 'check', value: tl.email !== false })}</div><button class="btn primary" style="width:max-content">Save</button></form>` : ''}<form class="card pad stack-sm" style="max-width:760px;margin-bottom:14px" data-accmail>${field({ name: 'accounts_email', label: 'Accounts email (asked to prepare invoices)', type: 'email', value: s.accounts_email || '', opt: true })}<button class="btn primary" style="width:max-content">Save</button></form>${sup ? `<form class="card pad stack-sm" style="max-width:760px;margin-bottom:14px" data-respct>${field({ name: 'resume_alert_pct', label: 'Alert me when one person opens this % of all resumes in 30 days', type: 'number', value: s.resume_alert_pct ?? 30 })}<button class="btn primary" style="width:max-content">Save</button></form>` : ''}<form class="card pad stack" style="max-width:760px" data-money>
        <div class="grid g3">${field({ name: 'fee_type', label: 'Fee type', type: 'select', options: [['percent', '% of yearly CTC'], ['fixed', 'Fixed per hire']], value: s.fee.type, placeholder: false })}${field({ name: 'fee_value', label: 'Fee value', type: 'number', value: s.fee.value })}${field({ name: 'agency_share_pct', label: 'Agency share % of fee', type: 'number', value: s.agency_share_pct })}</div>
        <div class="grid g3">${field({ name: 'gst_on', label: 'GST on', type: 'check', value: s.gst.on })}${field({ name: 'gst_rate', label: 'GST rate %', type: 'number', value: s.gst.rate })}${field({ name: 'bill_prefix', label: 'Bill number prefix', value: s.bill_prefix, hint: 'BB/26-27/001 — financial year changes on 1 April' })}</div>
        <div class="grid g3">${field({ name: 'replacement_days', label: 'Free replacement window (days)', type: 'number', value: s.replacement_days })}${field({ name: 'payment_days', label: 'Payment due in (days)', type: 'number', value: s.payment_days })}${field({ name: 'retention_years', label: 'Keep inactive candidates (years)', type: 'number', value: s.retention_years })}</div>
        <div class="grid g3">${field({ name: 't_screened', label: 'Target: screened / 30 days', type: 'number', value: s.targets.screened })}${field({ name: 't_sent', label: 'Target: sent / 30 days', type: 'number', value: s.targets.sent })}${field({ name: 't_joined', label: 'Target: joined / 30 days', type: 'number', value: s.targets.joined })}</div>
        ${field({ name: 'role_targets', label: 'Targets by role tag (Role | screened | sent | joined — one per line; other roles use the standard targets above)', type: 'textarea', voice: false, value: Object.entries(s.targets.roles || {}).map(([r, t]) => `${r} | ${t.screened} | ${t.sent} | ${t.joined}`).join('\n'), placeholder: 'Senior recruiter | 30 | 10 | 2' })}
        <div class="grid g3">${field({ name: 'log_deadline', label: 'Daily log deadline', type: 'time', value: s.log_deadline })}${field({ name: 'q_from', label: 'Quiet hours from (hour)', type: 'number', value: s.quiet.from })}${field({ name: 'q_to', label: 'Quiet hours to (hour)', type: 'number', value: s.quiet.to })}</div>
        <div class="grid g3">${field({ name: 'daily_limit', label: 'Max automatic messages a day per person', type: 'number', value: s.daily_limit })}${field({ name: 'bulk_budget', label: 'Bulk alert budget (messages per send)', type: 'number', value: s.bulk_budget })}${field({ name: 'team_idle_hours', label: 'Team logged out after idle (hours)', type: 'number', value: s.team_idle_hours })}</div>
        <div class="grid g3">${['CL', 'JB', 'CA', 'AP', 'IV', 'BL'].map((p) => field({ name: `id_${p}`, label: `${p} starts at`, type: 'number', value: s.id_start[p] })).join('')}</div>
        <button class="btn primary">Save</button></form>`;
      if (sup) $('[data-respct]', body).onsubmit = (e) => { e.preventDefault(); save('resume_alert_pct', Number(e.target.resume_alert_pct.value) || 30); };
      const days = (t) => [...new Set(String(t).split(/[^0-9]+/).map(Number).filter((n) => n > 0 && n <= 365))].sort((x, y) => x - y);
      $('[data-care]', body).onsubmit = (e) => { e.preventDefault(); const v = BB.formValues(e.target); const cand = days(v.cand_days); const client = days(v.client_days); if (!cand.length && !client.length) return BB.toast('Enter at least one day', true); save('aftercare', { candidate: cand, client }); };
      const tf = $('[data-tlogin]', body); if (tf) tf.onsubmit = (e) => { e.preventDefault(); const v = BB.formValues(e.target); if (!v.tl_password && !v.tl_whatsapp && !v.tl_email) return BB.toast('Keep at least one way to log in', true); save('team_login', { password: !!v.tl_password, whatsapp: !!v.tl_whatsapp, email: !!v.tl_email }); };
      $('[data-accmail]', body).onsubmit = (e) => { e.preventDefault(); save('accounts_email', e.target.accounts_email.value.trim()); };
      $('[data-money]', body).onsubmit = async (e) => {
        e.preventDefault(); const v = BB.formValues(e.target); const n = (x) => Number(x);
        try {
          for (const [k, val] of [['fee', { type: v.fee_type, value: n(v.fee_value) }], ['agency_share_pct', n(v.agency_share_pct)], ['gst', { on: v.gst_on, rate: n(v.gst_rate) }], ['bill_prefix', v.bill_prefix], ['replacement_days', n(v.replacement_days)], ['payment_days', n(v.payment_days)], ['retention_years', n(v.retention_years)], ['targets', { screened: n(v.t_screened), sent: n(v.t_sent), joined: n(v.t_joined), roles: Object.fromEntries(v.role_targets.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0] && p.length >= 4).map((p) => [p[0], { screened: n(p[1]), sent: n(p[2]), joined: n(p[3]) }])) }], ['log_deadline', v.log_deadline], ['quiet', { from: n(v.q_from), to: n(v.q_to) }], ['daily_limit', n(v.daily_limit)], ['bulk_budget', n(v.bulk_budget)], ['team_idle_hours', n(v.team_idle_hours)], ['id_start', Object.fromEntries(['CL', 'JB', 'CA', 'AP', 'IV', 'BL'].map((p) => [p, n(v[`id_${p}`])]))]]) await BB.put(`/api/settings/${k}`, { value: val });
          BB.toast('Saved'); BB.boot = await (await fetch('/api/bootstrap')).json(); BB.refreshPage();
        } catch (er) { BB.fail(er); }
      };
    } else if (tab === 'lists') {
      body.innerHTML = `<div class="grid g3">${listEditor('eval_criteria', 'Evaluation points (Group | Point)', s.eval_criteria || [])}${listEditor('departments', 'Departments', s.departments)}${listEditor('cities', 'Cities (City | State)', s.cities.map((c) => `${c.name} | ${c.state}`))}${listEditor('skills', 'Skills', s.skills)}${listEditor('client_stages', 'Client stages (in order)', s.client_stages)}${listEditor('closing_reasons', 'Closing reasons', s.closing_reasons)}${listEditor('lead_sources', 'Lead sources', s.lead_sources)}${listEditor('job_close_reasons', 'Job close reasons', s.job_close_reasons)}${listEditor('reopen_reasons', 'Reopen reasons', s.reopen_reasons)}${listEditor('src_tags', 'Link tags (tag = source)', Object.entries(s.src_tags).map(([k, v]) => `${k} = ${v}`))}</div>`;
      $$('[data-savelist]', body).forEach((b) => (b.onclick = () => {
        const k = b.dataset.savelist; const lines = $(`[data-list="${k}"]`, body).value.split('\n').map((x) => x.trim()).filter(Boolean);
        let val = lines;
        if (k === 'cities') val = lines.map((l) => { const [name, state] = l.split('|').map((x) => x.trim()); return { name, state: state || '' }; });
        if (k === 'src_tags') val = Object.fromEntries(lines.map((l) => l.split('=').map((x) => x.trim())));
        if (k === 'closing_reasons') for (const must of ['Not suitable', 'Client rejected', 'Candidate withdrew', 'Offer declined', 'Did not join']) if (!val.includes(must)) return BB.toast(`"${must}" is used by the software and must stay`, true);
        save(k, val);
      }));
    } else if (tab === 'jobs') {
      const ind = s.industries[s.default_industry]; const hidden = new Set(s.hidden_jobs);
      body.innerHTML = `<div class="filters"><label class="small">Industry <select data-ind style="width:auto">${Object.keys(s.industries).map((k) => `<option ${k === s.default_industry ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label><button class="btn sm" data-addind>+ Add industry</button><span class="small muted">Hide a job instead of deleting it. "Other" always stays.</span></div>
        <div class="grid g3">${Object.entries(ind.groups).map(([g, gr]) => `<div class="card pad stack-sm"><div class="row between"><b>${esc(g)}</b><span class="badge b-outline">${esc(gr.dept)}</span></div>${gr.jobs.map((j) => `<label class="row small"><input type="checkbox" data-hide="${esc(j)}" ${hidden.has(j) ? '' : 'checked'}> ${esc(j)}</label>`).join('')}<div class="row"><input placeholder="Add a job" data-newjob="${esc(g)}" class="small"><button class="btn sm" data-addjob="${esc(g)}">Add</button></div></div>`).join('')}</div>`;
      $('[data-ind]', body).onchange = (e) => save('default_industry', e.target.value);
      $$('[data-hide]', body).forEach((cb) => (cb.onchange = () => { const h = new Set(s.hidden_jobs); cb.checked ? h.delete(cb.dataset.hide) : h.add(cb.dataset.hide); save('hidden_jobs', [...h]); }));
      $$('[data-addjob]', body).forEach((b) => (b.onclick = () => { const g = b.dataset.addjob; const v = $(`[data-newjob="${g}"]`, body).value.trim(); if (!v) return; const inds = JSON.parse(JSON.stringify(s.industries)); inds[s.default_industry].groups[g].jobs.push(v); save('industries', inds, `${v} added`); }));
      $('[data-addind]', body).onclick = () => BB.ask({ title: 'Add industry', fields: [{ name: 'name', label: 'Industry name', placeholder: 'Garments' }, { name: 'groups', label: 'Groups and jobs (Group | Department: job, job, job — one group per line)', type: 'textarea', placeholder: 'Stitching | Production: Tailor, Cutting Master, Supervisor\nSales | Sales: Sales Executive, Store Manager' }], submit: (v) => { const groups = {}; for (const line of v.groups.split('\n').filter(Boolean)) { const [head, list] = line.split(':'); const [g, dept] = head.split('|').map((x) => x.trim()); groups[g] = { dept: dept || 'Other', jobs: (list || '').split(',').map((x) => x.trim()).filter(Boolean) }; } return BB.put('/api/settings/industries', { value: { ...s.industries, [v.name]: { groups } } }); } }).then((x) => x && BB.refreshPage());
    } else if (tab === 'papers') {
      const t = s.templates; const jdFor = q.jd || ''; const jd = (jdFor && (s.jd_templates || {})[jdFor]) || s.jd_template;
      body.innerHTML = `<form class="card pad stack" data-papers><b>Standard paper templates</b> <span class="small muted">Blanks: {candidate} {job} {ctc} {joining_date} {reporting_to} {company} {city} {date}</span>${field({ name: 'offer_letter', label: 'Offer letter', type: 'textarea', value: t.offer_letter, attrs: 'rows="8"' })}<div class="grid g2">${field({ name: 'joining_form', label: 'Joining form', type: 'textarea', value: t.joining_form, attrs: 'rows="7"' })}${field({ name: 'joining_checklist', label: 'Joining checklist (one per line)', type: 'textarea', value: t.joining_checklist, attrs: 'rows="7"' })}</div>
        <hr class="sep"><div class="row"><b>JD template</b><span class="small muted">Blanks: {job} {city}</span><label class="small right">For job <select data-jdfor style="width:auto"><option value="">Standard (all other jobs)</option>${BB.boot.jobs.map((x) => `<option ${q.jd === x.title ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label></div><div class="grid g2">${['summary', 'duties', 'must', 'good', 'timings', 'benefits', 'incentives', 'location'].map((k) => field({ name: `jd_${k}`, label: k, value: jd[k] || '' })).join('')}</div><button class="btn primary">Save templates</button></form>`;
      $('[data-papers]', body).onsubmit = async (e) => { e.preventDefault(); const v = BB.formValues(e.target); await BB.put('/api/settings/templates', { value: { offer_letter: v.offer_letter, joining_form: v.joining_form, joining_checklist: v.joining_checklist } }); const jdVal = Object.fromEntries(['summary', 'duties', 'must', 'good', 'timings', 'benefits', 'incentives', 'location'].map((k) => [k, v[`jd_${k}`]])); if (jdFor) save('jd_templates', { ...(s.jd_templates || {}), [jdFor]: jdVal }, `JD template for ${jdFor} saved`); else save('jd_template', jdVal); };
      $('[data-jdfor]', body).onchange = (e) => BB.setQ({ jd: e.target.value });
    } else if (tab === 'business') {
      const b = s.business;
      body.innerHTML = `<form class="card pad stack" style="max-width:760px" data-biz><div class="grid g2">${field({ name: 'name', label: 'Business name', value: b.name })}${field({ name: 'short', label: 'Short name', value: b.short })}</div><div class="grid g3">${field({ name: 'support_phone', label: 'Support WhatsApp', value: b.support_phone })}${field({ name: 'primary', label: 'Main colour', type: 'color', value: b.primary })}${field({ name: 'accent', label: 'Accent colour', type: 'color', value: b.accent })}</div>${field({ name: 'address', label: 'Address (on invoices)', value: b.address })}<div class="grid g3">${field({ name: 'state', label: 'State (for GST)', value: b.state })}${field({ name: 'gstin', label: 'GSTIN', value: b.gstin })}${field({ name: 'pan', label: 'PAN', value: b.pan })}</div><div class="grid g2">${field({ name: 'bank', label: 'Bank details', value: b.bank })}${field({ name: 'upi_id', label: 'UPI ID', value: b.upi_id })}</div>${field({ name: 'base_url', label: 'Web address used in WhatsApp links', value: b.base_url, voice: false })}<div class="row"><button class="btn primary">Save</button><button type="button" class="btn danger right" data-nosample>Remove sample data</button></div></form>`;
      $('[data-biz]', body).onsubmit = (e) => { e.preventDefault(); save('business', { ...b, ...BB.formValues(e.target) }); };
      $('[data-nosample]', body).onclick = async () => { if (await BB.confirm('Remove sample data', 'All sample clients, jobs, candidates, applications, interviews and bills are removed. Logins stay. Do this before going live.', 'Remove sample data')) { await BB.post('/api/settings/remove-sample').catch(BB.fail); BB.toast('Sample data removed'); BB.refreshPage(); } };
    } else if (tab === 'privacy') {
      const reqs = await BB.api('/api/data-requests');
      body.innerHTML = `<div class="card">${BB.table([{ t: 'When', f: (r) => fmtDT(r.at) }, { t: 'Person', f: (r) => `${esc(r.name)} <span class="mono faint">${esc(r.person_id)}</span>` }, { t: 'Asked', f: (r) => (r.kind === 'delete' ? 'Delete my data' : esc(r.kind)) }, { t: 'Status', f: (r) => `<span class="badge ${r.status === 'Waiting' ? 'b-amber' : r.status === 'Done' ? 'b-green' : 'b-outline'}">${r.status}</span>` }, { t: '', f: (r) => (r.status === 'Waiting' ? `<div class="row nowrap"><button class="btn sm danger" data-dr="${r.id}:approve">Approve & remove</button><button class="btn sm" data-dr="${r.id}:reject">Reject</button></div>` : esc(r.decided_by || '')) }], reqs, { empty: 'No requests.' })}</div><p class="small muted">Approving removes personal details and files. IDs, bills and counts stay with the name replaced by "Removed person".</p>`;
      $$('[data-dr]', body).forEach((b) => (b.onclick = async () => { const [id, dec] = b.dataset.dr.split(':'); if (dec === 'approve' && !(await BB.confirm('Remove personal data', 'This cannot be undone.', 'Remove'))) return; await BB.post(`/api/data-requests/${id}/${dec}`).catch(BB.fail); BB.refreshPage(); }));
    } else if (tab === 'health') {
      const h = await BB.api('/api/health');
      body.innerHTML = `<div class="grid g3" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${[['WhatsApp', h.crm_enabled ? 'Connected' : 'Test mode (would send)'], ['Last WhatsApp sent', fmtDT(h.last_wa_sent)], ['Last reply received', fmtDT(h.last_wa_received)], ['Timer last run', fmtDT(h.timer_last_run)], ['Messages waiting for 9 am', h.scheduled], ['Storage', `${h.files_mb} MB files · ${h.db_mb} MB database`], ['Last restore test', h.last_restore_test || '—'], ['Last failure', h.last_failure || '—'], ['Last backup', fmtDT(h.last_backup)], ['Last email check', h.last_mail_check || '—']].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div style="font-weight:600;margin-top:4px;overflow-wrap:anywhere">${esc(v)}</div></div>`).join('')}</div>
        <div class="card" style="margin-top:14px"><div class="card-h"><h3>Setup (.env)</h3><span class="badge ${h.setup.copy === 'live' ? 'b-green' : 'b-amber'}">${esc(h.setup.copy)} copy</span></div><div class="card-b"><dl class="kv">${[['WhatsApp', h.setup.whatsapp], ['Outgoing email', h.setup.outgoing_email], ['New-lead emails go to', h.setup.notify_emails], ['Email inbox (jobs@)', h.setup.email_inbox], ['Virus scanner', h.setup.virus_scanner], ['Error alerts', h.setup.alerts], ['Off-server backups', h.setup.offsite_backup]].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></div>
        <div class="row" style="margin:14px 0"><button class="btn" data-backup>Back up now</button><button class="btn" data-restore>Test restore</button><button class="btn" data-timer>Run timer now</button><button class="btn" data-mail>Check email inbox now</button><button class="btn" data-testmail>Send test email</button></div>
        <div class="grid g2" style="align-items:start"><div class="card"><div class="card-h"><h3>Failed messages</h3></div>${BB.table([{ t: 'To', f: (m) => esc(m.person_id) }, { t: 'Reason', f: (m) => esc(m.error) }, { t: '', f: (m) => `<button class="btn sm" data-retry="${m.id}">Retry</button>` }], h.failed, { empty: 'No failed messages.' })}</div>
        <div class="card"><div class="card-h"><h3>Backups (kept 30 days)</h3></div><div class="card-b small">${h.backups.map((b) => `<div class="mono">${esc(b)}</div>`).join('') || 'None yet.'}</div></div></div>`;
      $('[data-backup]', body).onclick = async () => { const r = await BB.post('/api/health/backup'); BB.toast(`Backup ${r.file}`); BB.refreshPage(); };
      $('[data-restore]', body).onclick = async () => { const r = await BB.post('/api/health/restore-test'); BB.toast(r.ok ? `Restore OK: ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}` : r.note); BB.refreshPage(); };
      $('[data-timer]', body).onclick = async () => { const r = await BB.post('/api/health/timer'); BB.toast(`Timer ran: ${Object.entries(r).filter(([k]) => k !== 'ran_at').map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing due'}`); BB.refreshPage(); };
      $('[data-testmail]', body).onclick = () => BB.ask({ title: 'Send test email', fields: [{ name: 'to', label: 'Send to', type: 'email', placeholder: 'you@company.com' }], ok: 'Send', submit: (v) => BB.post('/api/health/email', v) }).then((x) => x && BB.toast(`Test email queued to ${x.to} — check the inbox in a minute`));
      $('[data-mail]', body).onclick = async () => { try { const r = await BB.post('/api/health/mail'); BB.toast(r.skipped || `Email inbox: ${r.read} read, ${r.leads} lead(s)`); BB.refreshPage(); } catch (e) { BB.fail(e); } };
      $$('[data-retry]', body).forEach((b) => (b.onclick = async () => { await BB.post(`/api/wa/retry/${b.dataset.retry}`); BB.refreshPage(); }));
    }
  };
})();
