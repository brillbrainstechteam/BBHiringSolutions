/* Digital Reach: what the social media person does for each job. A work list of jobs with the next action,
   one job's creative and channels in a side panel, and a view by channel. */
(() => {
  const { $, $$, esc, fmtD, fmtDT } = BB;
  const STATUS = [['Pending', 'To do'], ['Done', 'Done'], ['Not needed', 'Not needed']];
  const SHARED = ['All BBHS Team', 'Tech Team', 'To be decided'];
  const limited = () => !!BB.me.user.channel_only;
  const refresh = () => { BB.refreshPanel && BB.refreshPanel(); BB.refreshPage && BB.refreshPage(); };
  const say = async (fn, msg) => { try { await fn(); if (msg) BB.toast(msg); refresh(); } catch (e) { BB.fail(e); } };
  const setStatus = (job_id, ckey, status, post_link) => BB.post('/api/postings/tracker', { job_id, ckey, status, ...(post_link !== undefined ? { post_link } : {}) });

  const counted = (rows) => { const needed = rows.filter((s) => s !== 'Not needed').length; return { done: rows.filter((s) => s === 'Done').length, needed, left: rows.filter((s) => !s || s === 'Pending').length }; };
  const bar = (done, total) => `<div class="rs-bar" role="img" aria-label="${done} of ${total} done"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>`;
  const nextStep = (cr, left) => {
    const st = cr && cr.status;
    if (!st) return 'Share the creative brief';
    if (st === 'Brief shared') return 'Get the creative made';
    if (st === 'With designer') return 'Send the creative for approval';
    if (st === 'Sent for approval') return limited() ? 'Waiting for approval' : 'Approve the creative';
    if (left) return `Post on ${left} channel${left === 1 ? '' : 's'}`;
    return st === 'Posted' ? 'All done' : 'Mark the creative posted';
  };
  const stepper = (steps, cur, click) => { const at = steps.indexOf(cur); return `<div class="rs-steps">${steps.map((s, i) => { const locked = s === 'Approved' && limited(); const inner = `<span class="rs-dot">${i <= at ? '✓' : i + 1}</span><span class="rs-lab">${esc(s)}</span>`; return click && !locked ? `<button type="button" class="rs-step ${i <= at ? 'done' : ''} ${i === at ? 'cur' : ''}" data-rstep="${esc(s)}">${inner}</button>` : `<div class="rs-step ${i <= at ? 'done' : ''} ${i === at ? 'cur' : ''}">${inner}</div>`; }).join('')}</div>`; };
  const ownerPick = (c, people) => { const p = people.find((u) => u.id === c.owner_id) || people.find((u) => u.name === c.owner); const other = !p && !SHARED.includes(c.owner); return `<select class="rs-own" data-rown="${esc(c.key || c.ckey)}" aria-label="Owner of ${esc(c.channel)}">${other ? `<option value="t:${esc(c.owner)}" selected>${esc(c.owner)} (no login)</option>` : ''}<optgroup label="Logins">${people.map((u) => `<option value="u:${u.id}" ${p && p.id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</optgroup><optgroup label="Shared">${SHARED.map((t) => `<option value="t:${t}" ${!p && c.owner === t ? 'selected' : ''}>${t}</option>`).join('')}</optgroup></select>`; };
  const wireOwners = (el) => $$('[data-rown]', el).forEach((x) => (x.onchange = () => { const v = x.value; say(() => BB.post('/api/channels/owner', v.startsWith('u:') ? { key: x.dataset.rown, owner_id: v.slice(2) } : { key: x.dataset.rown, owner: v.slice(2) }), 'Owner saved'); }));
  const statusSeg = (attr, st) => `<div class="rs-seg" role="group" aria-label="Status">${STATUS.map(([v, l]) => `<button type="button" class="${st === v ? `on s-${v === 'Not needed' ? 'na' : v.toLowerCase()}` : ''}" ${attr}="${esc(v)}">${l}</button>`).join('')}</div>`;

  // ---------- one job: its creative and channels ----------
  BB.panels.reach = async (id) => {
    const d = await BB.api(`/api/reach/${id}`); const cr = await BB.api(`/api/creatives/${id}`); const rows = d.rows; const j = d.job;
    const groups = [...new Set(rows.map((r) => r.group))]; const all = counted(rows.map((r) => r.status));
    const mine = BB.me.user.name; const anyMine = rows.some((r) => r.owner === mine);
    const row = (r) => `<div class="rs-row" data-mine="${r.owner === mine ? 1 : 0}"><div class="rs-main"><b>${esc(r.channel)}</b><div class="tiny muted">${esc(r.how || '')}</div></div><div class="rs-acts">${limited() ? `<span class="small muted">${esc(r.owner || '')}</span>` : ownerPick(r, d.people)}${statusSeg(`data-rst="${esc(r.ckey)}" data-v`, r.status)}<button type="button" class="btn sm" data-rcopy="${esc(r.apply_link)}">Copy link</button></div>${r.status === 'Done' ? `<div class="rs-done"><input data-rlink="${esc(r.ckey)}" value="${esc(r.post_link || '')}" placeholder="Paste the post link" aria-label="Post link for ${esc(r.channel)}"><span class="tiny muted">${esc(r.updated_by || r.done_by || '')}${r.updated_at ? `, ${fmtD(r.updated_at)}` : ''}</span></div>` : ''}</div>`;
    return {
      head: `<div class="row"><h2>${esc(j.title)}</h2></div><div class="small muted">${[j.client, j.city, `${j.openings} opening${j.openings === 1 ? '' : 's'}`].filter(Boolean).map(esc).join(' · ')}</div>`,
      body: `<div class="sec"><h3><span>Creative</span>${cr.at ? `<span class="sec-act small muted">${esc(cr.by || '')}, ${fmtD(cr.at)}</span>` : ''}</h3>${stepper(cr.steps, cr.status, true)}
          <div class="rs-next">Next: <b>${esc(nextStep(cr.status ? cr : null, all.left))}</b></div>
          <div class="rs-link"><input data-rclink value="${esc(cr.link || '')}" placeholder="Paste the link to the creative" aria-label="Link to the creative"><button type="button" class="btn sm" data-rcsave>Save link</button>${/^https?:\/\//i.test(cr.link || '') ? `<a class="btn sm" href="${esc(cr.link)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div>
          <details class="rs-brief"><summary>Creative brief</summary><textarea data-rbrief rows="8">${esc(cr.brief || '')}</textarea><div class="row"><button type="button" class="btn sm" data-rbsave>Save brief</button><button type="button" class="btn sm" data-rbcopy>Copy brief</button></div></details></div>
        <div class="sec"><h3><span>Channels</span><span class="sec-act"><span class="small muted">${all.done} of ${all.needed} done</span>${anyMine ? '<label class="row small"><input type="checkbox" data-rmine> My channels</label>' : ''}</span></h3>${bar(all.done, all.needed)}
          ${groups.map((g) => { const gr = rows.filter((r) => r.group === g); const n = counted(gr.map((r) => r.status)); return `<details class="rs-group" ${n.left ? 'open' : ''}><summary><b>${esc(g)}</b><span class="small muted">${n.done} of ${n.needed} done</span><span class="ci-chev" aria-hidden="true"></span></summary>${gr.map(row).join('')}<div class="rs-gfoot"><button type="button" class="btn sm ghost" data-rgna="${esc(g)}">Mark the rest not needed</button></div></details>`; }).join('')}</div>
        ${limited() ? '' : `<div class="row"><button class="btn sm" data-open="job:${j.id}">Open the job</button></div>`}`,
      mount: (el) => {
        $$('[data-rstep]', el).forEach((b) => (b.onclick = () => say(() => BB.post('/api/creatives', { ids: [id], status: b.dataset.rstep }), 'Saved')));
        $('[data-rcsave]', el).onclick = () => say(() => BB.post('/api/creatives', { ids: [id], status: cr.status || 'Brief shared', link: $('[data-rclink]', el).value.trim() }), 'Link saved');
        $('[data-rbsave]', el).onclick = () => say(() => BB.post('/api/creatives', { ids: [id], status: cr.status || 'Brief shared', brief: $('[data-rbrief]', el).value }), 'Brief saved');
        $('[data-rbcopy]', el).onclick = () => BB.copy($('[data-rbrief]', el).value);
        $$('[data-rst]', el).forEach((b) => (b.onclick = () => { const r = rows.find((x) => x.ckey === b.dataset.rst); say(() => setStatus(id, r.ckey, r.status === b.dataset.v ? '' : b.dataset.v)); }));
        $$('[data-rcopy]', el).forEach((b) => (b.onclick = () => BB.copy(b.dataset.rcopy)));
        $$('[data-rlink]', el).forEach((i) => (i.onchange = () => say(() => setStatus(id, i.dataset.rlink, 'Done', i.value.trim()), 'Link saved')));
        $$('[data-rgna]', el).forEach((b) => (b.onclick = () => { const left = rows.filter((r) => r.group === b.dataset.rgna && (!r.status || r.status === 'Pending')); say(async () => { for (const r of left) await setStatus(id, r.ckey, 'Not needed'); }, `${left.length} marked not needed`); }));
        const m = $('[data-rmine]', el); if (m) m.onchange = () => $$('.rs-row[data-mine="0"]', el).forEach((r) => { r.hidden = m.checked; });
        wireOwners(el);
      },
    };
  };

  // ---------- what shows on the job itself ----------
  BB.reachSummary = (j) => {
    const rows = j.postings || []; const n = counted(rows.map((p) => p.status)); const cr = j.creative || {}; const steps = ['Brief shared', 'With designer', 'Sent for approval', 'Approved', 'Posted'];
    const groups = [...new Set(rows.map((p) => p.group))]; const done = rows.filter((p) => p.status === 'Done');
    return `<div class="sec"><h3><span>Digital Reach</span><span class="sec-act"><span class="small muted">${n.done} of ${n.needed} done</span><button class="btn sm" data-open="reach:${j.id}">Open</button></span></h3>
      ${stepper(steps, cr.status, false)}<div class="rs-next">Next: <b>${esc(nextStep(cr.status ? cr : null, n.left))}</b></div>
      <div class="rs-gsum">${groups.map((g) => { const c = counted(rows.filter((p) => p.group === g).map((p) => p.status)); return `<div><div class="row between small"><span>${esc(g)}</span><span class="muted">${c.done} of ${c.needed}</span></div>${bar(c.done, c.needed)}</div>`; }).join('')}</div>
      ${done.length ? `<div class="rs-posted">${done.map((p) => `<div class="hist-row"><span class="grow small"><b>${esc(p.channel)}</b>${p.post_link && /^https?:\/\//i.test(p.post_link) ? ` · <a href="${esc(p.post_link)}" target="_blank" rel="noopener">see post ↗</a>` : ''}</span><span class="small muted">${esc(p.updated_by || p.done_by || '')}, ${fmtD(p.updated_at || p.done_date)}</span></div>`).join('')}</div>` : ''}</div>`;
  };

  // ---------- the page ----------
  BB.pages.channels = async ({ el, actions, q }) => {
    const d = await BB.api(`/api/postings/tracker?${BB.qs({ all: q.all })}`); const cr = await BB.api('/api/creatives'); const myName = BB.me.user.name;
    if (!limited() && q.view === 'tracker' && BB.jobViews) { actions.innerHTML = `<div class="job-tb">${BB.jobViews('tracker')}</div>`; $$('[data-jv]', actions).forEach((b) => (b.onclick = () => BB.setQ({ view: b.dataset.jv }))); }
    const owners = [...new Set(d.channels.map((c) => c.owner))]; const own = q.owner !== undefined ? q.owner : limited() && owners.includes(myName) ? myName : '';
    const chs = d.channels.filter((c) => !own || c.owner === own); const by = q.by === 'channel' ? 'channel' : 'job'; const show = q.show || 'todo';
    const cell = (j, c) => (d.cells[j.id] || {})[c.key] || {};
    const jobs = d.jobs.map((j) => { const st = chs.map((c) => cell(j, c).status || ''); const n = counted(st); const c = cr.rows[j.id]; return { ...j, n, cr: c, next: nextStep(c, n.left) }; });
    const week = Date.now() - 7 * 864e5; const tile = (l, v) => `<div class="ci-tile"><div class="ci-lab">${l}</div><div class="hist-num">${v}</div></div>`;
    const before = (j) => !j.cr || ['Brief shared', 'With designer'].includes(j.cr.status);
    const stats = `<div class="hist-grid rs-stats">${tile('Creatives to make', jobs.filter(before).length)}${tile('Waiting for approval', jobs.filter((j) => j.cr && j.cr.status === 'Sent for approval').length)}${tile('Channels to post', jobs.reduce((t, j) => t + j.n.left, 0))}${tile('Posted this week', jobs.reduce((t, j) => t + chs.filter((c) => { const x = cell(j, c); return x.status === 'Done' && new Date(x.done_date).getTime() > week; }).length, 0))}</div>`;
    const seg = (key, cur, list) => `<div class="seg">${list.map(([v, l]) => `<button data-rq="${key}" data-val="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const list = () => {
      const txt = ($('[data-rs]', el) || {}).value || ''; const t = txt.trim().toLowerCase();
      const rows = jobs.filter((j) => (show === 'all' || j.next !== 'All done') && (!t || `${j.title} ${j.city} ${j.client}`.toLowerCase().includes(t)));
      $('[data-rlist]', el).innerHTML = rows.map((j) => `<button type="button" class="rs-job" data-open="reach:${j.id}"><span class="rs-j1"><span class="rs-jt"><b>${esc(j.title)}</b>${j.priority === 'High' ? '<span class="badge b-red tiny">High</span>' : ''}</span><span class="tiny muted">${[j.client, j.city].filter(Boolean).map(esc).join(' · ')}</span></span><span class="rs-j2"><span class="tiny muted">Creative</span><span class="small">${esc((j.cr && j.cr.status) || 'Not started')}</span></span><span class="rs-j3">${bar(j.n.done, j.n.needed)}<span class="tiny muted">${j.n.done} of ${j.n.needed} channels</span></span><span class="rs-j4 ${j.next === 'All done' ? 'ok' : ''}">${esc(j.next)}</span><span class="rs-j5" aria-hidden="true">›</span></button>`).join('') || `<div class="empty">${show === 'all' ? 'No open jobs.' : 'Nothing to do. Every job is up to date.'}</div>`;
    };
    const channelTable = () => { let g = null; return chs.map((c) => { const n = counted(d.jobs.map((j) => cell(j, c).status || '')); const head = c.group !== g ? `<div class="rs-ghead">${esc((g = c.group))}</div>` : ''; return `${head}<div class="rs-chrow"><button type="button" class="rs-chname" data-rch="${esc(c.key)}"><b>${esc(c.channel)}</b><span class="tiny muted">${esc(c.how || '')}</span></button><span class="rs-chown">${limited() ? `<span class="small muted">${esc(c.owner)}</span>` : ownerPick(c, d.people)}</span><span class="rs-j3">${bar(n.done, n.needed)}<span class="tiny muted">${n.done} of ${n.needed} jobs</span></span></div>`; }).join(''); };
    el.innerHTML = `${stats}<section class="card pad rs-tools"><input data-rs placeholder="Search job, client or city" aria-label="Search jobs"><select data-own aria-label="Owner"><option value="">All owners</option>${owners.includes(myName) ? `<option value="${esc(myName)}" ${own === myName ? 'selected' : ''}>My channels</option>` : ''}${owners.filter((o) => o !== myName).map((o) => `<option ${own === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${seg('by', by, [['job', 'By job'], ['channel', 'By channel']])}${by === 'job' ? seg('show', show, [['todo', 'To do'], ['all', 'All']]) : ''}</section>
      ${by === 'job' ? '<div class="card" data-rlist></div>' : `<div class="card pad">${channelTable()}</div>`}
      <details class="card pad rs-recent"><summary><b>Recent updates</b> <span class="small muted">${d.recent.length}</span></summary>${d.recent.map((r) => `<div class="trk-rec"><b>${esc(r.updated_by)}</b> marked ${esc(r.channel)} <span class="badge b-outline">${esc(r.status === 'Pending' ? 'To do' : r.status || 'cleared')}</span> for ${esc(r.job)} <span class="faint">${fmtDT(r.updated_at)}</span></div>`).join('') || '<div class="faint small">No updates yet.</div>'}</details>`;
    if (by === 'job') { list(); $('[data-rs]', el).oninput = list; } else $('[data-rs]', el).hidden = true;
    $$('[data-rq]', el).forEach((b) => (b.onclick = () => BB.setQ({ [b.dataset.rq]: b.dataset.val })));
    $('[data-own]', el).onchange = (e) => BB.setQ({ owner: e.target.value }); wireOwners(el);
    $$('[data-rch]', el).forEach((b) => (b.onclick = () => {
      const c = d.channels.find((x) => x.key === b.dataset.rch); const link = (j) => `${d.link_base}job=${j.id}&src=${d.tags[c.key]}`;
      BB.modal({ title: c.channel, wide: true, body: `${c.how ? `<p class="small muted" style="margin-top:0">${esc(c.how)}</p>` : ''}${d.jobs.map((j) => `<div class="rs-row"><div class="rs-main"><b>${esc(j.title)}</b><div class="tiny muted">${[j.client, j.city].filter(Boolean).map(esc).join(' · ')}</div></div><div class="rs-acts">${statusSeg(`data-mj="${j.id}" data-v`, cell(j, c).status || '')}<button type="button" class="btn sm" data-mcopy="${esc(link(j))}">Copy link</button></div></div>`).join('') || '<div class="empty">No open jobs.</div>'}`, foot: '<button class="btn" data-mclose>Close</button>',
        onMount: (m, close) => {
          $('[data-mclose]', m).onclick = close; $$('[data-mcopy]', m).forEach((x) => (x.onclick = () => BB.copy(x.dataset.mcopy)));
          $$('[data-mj]', m).forEach((x) => (x.onclick = async () => { const j = d.jobs.find((y) => y.id === x.dataset.mj); const st = cell(j, c).status === x.dataset.v ? '' : x.dataset.v; try { await setStatus(j.id, c.key, st); (d.cells[j.id] = d.cells[j.id] || {})[c.key] = { status: st }; $$(`[data-mj="${j.id}"]`, m).forEach((y) => { y.className = y.dataset.v === st ? `on s-${st === 'Not needed' ? 'na' : st.toLowerCase()}` : ''; }); } catch (e) { BB.fail(e); } }));
        } });
    }));
  };
})();
