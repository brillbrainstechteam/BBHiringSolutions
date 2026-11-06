/* Team portal shell (#team): login with lockout + super admin WhatsApp code, menu by level, search, bell, quick "Add lead". */
(() => {
  const { $, $$, esc, fmtDT, icon, field } = BB;
  BB.pages = {};
  const device = () => { let d = BB.store.get('bbhs.device'); if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); BB.store.set('bbhs.device', d); } return d; };

  function loginView(msg) {
    $('#app').innerHTML = BB.split({ top: BB.publicTop('Team portal'), eyebrow: 'Team portal', title: 'Good to see you <em>again</em>', lead: 'Pick up where you left off — today’s interviews, new candidates and the next step on every job opening.', perks: [['1', 'Needs attention first', 'Your dashboard lists what to do next.'], ['2', 'Numbers count themselves', 'Performance comes from the work you record.']],
      card: `<div class="card-title">Log in</div>${(() => { const w = BB.boot.team_login || { password: true }; const codes = [w.whatsapp && ['whatsapp', 'Code on WhatsApp'], w.email && ['email', 'Code by email']].filter(Boolean); return codes.length ? `<div class="seg login-ways" data-ways>${w.password ? '<button type="button" data-way="password" class="on">Password</button>' : ''}${codes.map(([k, l], i) => `<button type="button" data-way="${k}" class="${!w.password && !i ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''; })()}
        <form class="stack hidden" data-codeform><p class="muted small" style="margin:0" data-codehint></p>${field({ name: 'who', label: 'Username, WhatsApp number or email', voice: false, attrs: 'autocomplete="username" autocapitalize="off"' })}<button class="btn gold block lg">Send code</button></form>
        <form class="stack hidden" data-codeform2><p class="small muted" style="margin:0" data-codesent></p><div data-codedev></div>${field({ name: 'code', label: 'Enter the 6 digit code', voice: false, attrs: 'inputmode="numeric" maxlength="6" class="code-in" autocomplete="one-time-code"' })}<button class="btn gold block lg">Log in</button><a href="#" class="small" data-codeback>Use another way</a></form>
        <p class="muted small" style="margin:0 0 16px" data-pwhint>Use the username and password from your admin.</p><form class="stack" data-login>${msg ? `<div class="notice warn small">${esc(msg)}</div>` : ''}
        ${field({ name: 'username', label: 'Username', voice: false, attrs: 'autocomplete="username" autocapitalize="off"' })}
        <label class="field" data-f="password"><span class="lab">Password</span><div class="inp-wrap"><input name="password" type="password" autocomplete="current-password"><button type="button" class="mic" data-eye title="Show or hide" style="font-size:12px;width:44px">Show</button></div></label>
        <button class="btn gold block lg">Log in</button><p class="small faint" style="margin:0">5 wrong tries lock the login for 15 minutes.</p></form>
        <form class="stack hidden" data-2fa><h3>Check on a new device</h3><p class="small muted">We sent a 6-digit code to your WhatsApp.</p><div data-dev></div>${field({ name: 'code', label: 'Enter 6 digit code received on WhatsApp', voice: false, attrs: 'inputmode="numeric" maxlength="6" class="code-in" autocomplete="one-time-code"' })}<button class="btn gold block lg">Verify</button></form>` });
    $('[data-eye]').onclick = (e) => { const i = $('[name=password]'); i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'Show' : 'Hide'; };
    $('[data-login]').onsubmit = async (e) => {
      e.preventDefault(); const v = BB.formValues(e.target);
      try {
        const r = await BB.post('/api/team/login', { ...v, device: device() }, { kind: null });
        BB.setToken('team', r.token); BB.mustChange = r.must_change;
        if (r.need2fa) { e.target.classList.add('hidden'); $('[data-2fa]').classList.remove('hidden'); if (r.dev_code) $('[data-dev]').innerHTML = `<div class="test-code">Test mode (WhatsApp not connected): code <b class="mono">${r.dev_code}</b></div>`; $('[name=code]').focus(); }
        else BB.route();
      } catch (er) { BB.showErr(e.target, { ...er, field: er.field || 'password', message: er.message }); }
    };
    // Codes instead of the password: the person picks WhatsApp or email.
    let way = 'password'; let who = '';
    const showWay = (w) => { way = w; $$('[data-way]').forEach((b) => b.classList.toggle('on', b.dataset.way === w)); const pw = w === 'password'; $('[data-login]').classList.toggle('hidden', !pw); $('[data-pwhint]').classList.toggle('hidden', !pw); $('[data-codeform]').classList.toggle('hidden', pw); $('[data-codeform2]').classList.add('hidden'); $('[data-2fa]').classList.add('hidden'); if (!pw) $('[data-codehint]').textContent = w === 'email' ? 'We email you a 6-digit code. No password needed.' : 'We send a 6-digit code to your WhatsApp. No password needed.'; };
    $$('[data-way]').forEach((b) => (b.onclick = () => showWay(b.dataset.way)));
    const bw = BB.boot.team_login || { password: true }; if (!bw.password && (bw.whatsapp || bw.email)) showWay(bw.whatsapp ? 'whatsapp' : 'email');
    $('[data-codeform]').onsubmit = async (e) => {
      e.preventDefault(); const btn = $('button', e.target); btn.disabled = true; who = BB.formValues(e.target).who;
      try { const r = await BB.post('/api/team/code', { who, via: way }, { kind: null }); e.target.classList.add('hidden'); $('[data-codeform2]').classList.remove('hidden'); $('[data-codesent]').textContent = `If this login exists, a code is on its way to ${r.to}. It is valid for 10 minutes.`; $('[data-codedev]').innerHTML = r.dev_code ? `<div class="test-code">Test copy: the code is <b class="mono">${r.dev_code}</b></div>` : ''; $('[data-codeform2] [name=code]').focus(); } catch (er) { BB.showErr(e.target, { ...er, field: er.field || 'who', message: er.message }); } finally { btn.disabled = false; }
    };
    $('[data-codeform2]').onsubmit = async (e) => { e.preventDefault(); try { const r = await BB.post('/api/team/code/verify', { who, via: way, code: BB.formValues(e.target).code, device: device() }, { kind: null }); BB.setToken('team', r.token); BB.route(); } catch (er) { BB.showErr(e.target, { message: er.message, field: 'code' }); } };
    $('[data-codeback]').onclick = (e) => { e.preventDefault(); showWay(way); };
    $('[data-2fa]').onsubmit = async (e) => { e.preventDefault(); try { await BB.post('/api/team/2fa', BB.formValues(e.target)); BB.route(); } catch (er) { BB.showErr(e.target, { message: er.message, field: 'code' }); } };
  }

  // Social media and tech logins see only their hiring channels and their own login page.
  const ACCOUNTS_MENU = ['accounts', 'acclients', 'accandidates', 'bills', 'logins'];
  const menuFor = (u) => (u.accounts_only ? MENU.filter((m) => ACCOUNTS_MENU.includes(m[0])) : u.channel_only ? MENU.filter((m) => ['channels', 'agreement', 'logins'].includes(m[0])) : MENU.filter((m) => m[0] !== 'channels' && !['acclients', 'accandidates'].includes(m[0]) && (m[0] !== 'leads' || u.leads) && (!m[3] || m[3].includes(u.level))));
  const MENU = [
    ['myday', 'My day', 'sun', ['sub']], ['dashboard', 'Dashboard', 'grid'], ['leads', 'Leads', 'inbox', null, 'leads'],
    ['clients', 'Clients', 'building'], ['candidates', 'Candidates', 'users', null, 'cand_new'], ['jobs', 'Job openings', 'brief'], ['channels', 'Digital Reach', 'flow'], ['applications', 'Applications', 'flow'],
    ['interviews', 'Interviews', 'cal', null, 'pending'], ['aftercare', 'Offer', 'check'], ['whatsapp', 'WhatsApp', 'chat', null, 'unread'], ['campaigns', 'Campaigns', 'flow'],
    ['performance', 'Performance', 'chart'], ['tasks', 'Tasks', 'note'], ['reviews', 'Recruiter reviews', 'star', ['super']], ['logs', 'Daily logs', 'note', ['super']], ['accounts', 'Invoicing', 'note'], ['acclients', 'Clients', 'building'], ['accandidates', 'Offers & joinings', 'users'], ['bills', 'Profit & Loss', 'rupee'],
    ['reports', 'Reports', 'report'], ['agreement', 'Recruitment Agreement', 'note'], ['logins', 'Logins & team', 'key'], ['settings', 'Settings', 'cog'],
  ];
  const GROUP = { agreement: 'Admin', channels: 'Hiring', myday: 'Overview', dashboard: 'Overview', leads: 'Hiring', clients: 'Hiring', jobs: 'Hiring', candidates: 'Hiring', applications: 'Hiring', interviews: 'Hiring', aftercare: 'Hiring', reviews: 'Team', whatsapp: 'Messages', campaigns: 'Messages', performance: 'Team', tasks: 'Team', logs: 'Team', accounts: 'Financials', acclients: 'Financials', accandidates: 'Financials', bills: 'Financials', reports: 'Financials', logins: 'Admin', settings: 'Admin' };
  const HELP = {
    agreement: 'The standard Recruitment Agreement. Clients see the same copy in their account.',
    channels: 'Every channel for every open job. Change the owner in the Owner column. Copy a job\'s link, post it, then click the cell to update it. Everyone sees the same page.',
    myday: 'Everything you need to do today: interviews, results to record, follow-ups and stuck applications.',
    dashboard: 'Counts and the Needs attention list. Every item has a WhatsApp button to nudge the right person.',
    clients: 'Jewellery businesses that hire through us. Open one to see onboarding, job openings and chats.',
    jobs: 'Each role a client wants to fill. The status is worked out from its applications — never typed by hand (except On hold and Closed).',
    candidates: 'Every candidate from every door lands here, with New and Unassigned views. Domain and skills are read from each CV automatically. The resume bank is shared by all agencies. Segments are saved groups of candidates that stay up to date. Phone numbers show only for your own agency\'s candidates.',
    applications: 'One candidate on one job. Move cards step by step; days in this step turn red after 7.',
    interviews: 'Everyone screened in, in the round they are in now: telephonic, then virtual, then the client. Open one to record the feedback or log the call. The other tabs list each interview by time.',
    leads: 'New clients from every door (forms, WhatsApp bot, email, Excel), and Partners: institutes and colleges whose students make good candidates.',
    aftercare: 'From the offer to the end of the replacement window: offers waiting to be accepted or joined, weekly then monthly check-ins for 90 days after joining, and every replacement after someone leaves.',
    reviews: 'What candidates and clients say about each recruiter. Only super admins see this.',
    whatsapp: 'One shared inbox. Replies open a 24-hour window for free typing; otherwise only approved formats can be sent.',
    performance: 'Counted from the history lines every action saves. Nobody types these numbers.',
    logs: 'One log a day: tasks done, problems, plan for tomorrow. Admins approve their sub admins\' logs.',
    bills: 'A bill is made when a candidate is marked Joined. Fee = % of yearly CTC; the agency share is a % of the fee.',
    money: 'Billed, received, overdue and agency shares due, by week and month.',
    reports: 'Super admin: every report, downloadable. Admins: their agency, including each sub admin. Sub admins: their own performance and daily logs.',
    logins: 'Agencies, admins and sub admins. New or reset passwords are shown once and sent once on WhatsApp.',
    settings: 'Lists, fees, WhatsApp rules and limits (super admin), and departments & roles (everyone).',
  };

  let pageName = 'dashboard'; let pageQ = {};
  BB.views.team = async (r) => {
    if (!BB.token('team')) return loginView();
    try { BB.me = await BB.api('/api/me'); } catch (e) { return loginView(e.message); }
    BB.guard(BB.me.user); // no printing / copying / screenshot keys for admins and sub admins
    if (BB.me.user.must_change || BB.mustChange) return changePassword(true);
    // Pages that moved: Segments is a Candidates tab, Departments & roles a Settings tab.
    const MOVED = { segments: 'team/candidates?tab=segments', 'candidates?tab=campaigns': 'team/campaigns', roles: 'team/settings?tab=roles', books: 'team/bills?tab=summary', money: 'team/bills?tab=bills' };
    if (MOVED[r.sub[0]]) return BB.go(MOVED[r.sub[0]]);
    const allowed = menuFor(BB.me.user).map((m) => m[0]);
    pageName = allowed.includes(r.sub[0]) ? r.sub[0] : BB.me.user.accounts_only ? 'accounts' : BB.me.user.channel_only ? 'channels' : BB.me.user.level === 'sub' ? 'myday' : 'dashboard';
    pageQ = r.q;
    if (!$('.shell')) shell(); else updateNav();
    renderPage();
  };
  BB.onLogout = ((prev) => (kind, msg) => { if (kind === 'team' && BB.portal === 'team') { BB.closePanels(); loginView(msg); } else prev && prev(kind, msg); })(BB.onLogout);

  function shell() {
    const u = BB.me.user; const ag = BB.me.agency;
    $('#app').innerHTML = `<div class="shell"><aside class="side">${BB.brand('Team portal', '#team')}<nav class="nav" data-nav></nav>
      <div class="me"><b>${esc(u.name)}</b>${BB.levelName(u.level)}${ag ? ` · ${esc(ag.name)}` : ' · BrillBrains'}<div style="margin-top:6px"><a href="/guides/${{ super: 'super-admin', admin: 'admin', sub: 'sub-admin' }[u.level]}.html" target="_blank" rel="noopener" style="color:var(--gold)">1-page guide ↗</a></div></div></aside>
      <div class="main"><header class="topbar"><div class="search"${u.channel_only || u.accounts_only ? ' hidden' : ''}>${icon('search')}<input placeholder="Search ID, name, phone or company…" data-search><div class="search-res hidden" data-res></div></div>
        ${u.channel_only || u.accounts_only ? '' : `<button class="btn sm" data-addlead>${icon('plus', 'wa-ico')} Add lead</button>`}
        <div class="bell" style="position:relative"><button class="btn icon ghost" data-bell title="Alerts">${icon('bell', 'wa-ico')}</button><span class="n hidden" data-bell-n></span><div class="drop hidden" data-bell-drop></div></div>
        <span class="who-chip"><span class="av">${esc(u.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span><span><b>${esc(u.name)}</b><span>${BB.levelName(u.level)}${ag ? ' · ' + esc(ag.name) : ''}</span></span></span>
        <button class="btn sm ghost" data-out>Log out</button></header><div class="page" data-page></div></div></div>`;
    updateNav();
    $('[data-out]').onclick = async () => { await BB.post('/api/team/logout').catch(() => {}); BB.setToken('team', null); BB.closePanels(); BB.unguard(); BB.me = null; if (BB.setUrl) BB.setUrl('team'); BB.toast('You have logged out'); loginView(); };
    if (!u.channel_only && !u.accounts_only) { $('[data-addlead]').onclick = quickLead; wireSearch(); }
    wireBell();
  }
  function updateNav() {
    const u = BB.me.user; const c = BB.me.counts;
    let lastGroup = '';
    $('[data-nav]').innerHTML = menuFor(u).map(([k, l, ic, , cnt]) => { const g = GROUP[k]; const head = g !== lastGroup ? `<div class="grp">${g}</div>` : ''; lastGroup = g; return `${head}<a href="/team/${k}" class="${k === pageName ? 'on' : ''}">${icon(ic)}<span>${l}</span>${cnt && c[cnt] ? `<span class="n">${c[cnt]}</span>` : ''}</a>`; }).join('');
    const n = $('[data-bell-n]'); if (n) { n.textContent = c.alerts; n.classList.toggle('hidden', !c.alerts); }
    if (BB.flow && BB.flow.callBar) BB.flow.callBar();
  }
  BB.refreshCounts = async () => { try { BB.me = await BB.api('/api/me'); updateNav(); } catch { /* logged out */ } };

  async function renderPage() {
    const el = $('[data-page]'); const page = BB.pages[pageName];
    const m = MENU.find((x) => x[0] === pageName);
    el.innerHTML = `<div class="page-h ${pageName === 'jobs' ? 'stacked' : ''}"><div class="grow">${GROUP[pageName] === 'Financials' ? '' : `<span class="eyebrow">${GROUP[pageName]}</span>`}<div class="row"><h1>${m[1]}</h1>${['logs', 'candidates'].includes(pageName) ? '' : '<button class="help-btn" data-help title="What is this page?">?</button>'}</div><div class="help hidden" data-help-t>${HELP[pageName] || ''}</div></div><div class="row" data-actions></div></div><div data-content><div class="empty">Loading…</div></div>`;
    if ($('[data-help]')) $('[data-help]').onclick = () => $('[data-help-t]').classList.toggle('hidden');
    // A redraw while someone is typing in a list's search box keeps what they typed since (the old box still holds
    // it), the cursor in the box, and searches again for the newer text.
    BB.refreshPage = async () => {
      const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-q]') ? document.activeElement : null;
      try { await page({ el: $('[data-content]'), actions: $('[data-actions]'), q: pageQ, me: BB.me.user }); } catch (e) { $('[data-content]').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
      const box = typing && $('[data-content] [data-q]');
      if (box && box !== typing) {
        const later = typing.value; box.focus();
        if (box.value !== later) { box.value = later; box.dispatchEvent(new Event('input')); }
        try { box.setSelectionRange(later.length, later.length); } catch { /* not a text box */ }
      }
      BB.refreshCounts();
    };
    await BB.refreshPage();
    window.scrollTo(0, 0);
  }
  BB.setQ = (q) => { pageQ = { ...pageQ, ...q }; const qs = new URLSearchParams(Object.entries(pageQ).filter(([, v]) => v !== '' && v !== undefined && v !== null)).toString(); BB.setUrl(`team/${pageName}${qs ? '?' + qs : ''}`); BB.refreshPage(); };

  function wireSearch() {
    const inp = $('[data-search]'); const res = $('[data-res]'); let t;
    inp.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
      if (inp.value.trim().length < 2) return res.classList.add('hidden');
      const r = await BB.api(`/api/search?q=${encodeURIComponent(inp.value.trim())}`).catch(() => ({ groups: [] }));
      res.innerHTML = r.groups.map((g) => `<div class="g">${g.title}</div>${g.items.map((i) => `<div class="i" data-open="${g.type}:${i.id}"><span class="mono faint">${esc(i.id)}</span><b>${esc(i.label)}</b><span class="small muted ellipsis">${esc(i.sub || '')}</span></div>`).join('')}`).join('') || '<div class="empty">Nothing found.</div>';
      res.classList.remove('hidden');
    }, 220); };
    inp.onkeydown = (e) => { if (e.key === 'Escape') { res.classList.add('hidden'); inp.blur(); } };
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) res.classList.add('hidden'); else if (e.target.closest('[data-open]')) { res.classList.add('hidden'); inp.value = ''; } });
  }
  function wireBell() {
    const drop = $('[data-bell-drop]');
    $('[data-bell]').onclick = async (e) => {
      e.stopPropagation(); if (!drop.classList.contains('hidden')) return drop.classList.add('hidden');
      const list = await BB.api('/api/alerts');
      drop.innerHTML = `<div class="row between" style="padding:10px 14px;border-bottom:1px solid var(--border)"><b>Alerts</b><button class="btn sm ghost" data-readall>Mark all read</button></div>${list.map((a) => `<div class="it ${a.read ? '' : 'unread'}" data-alert="${a.id}" data-rec="${esc(a.record_id || '')}"><div>${esc(a.text)}</div><div class="tiny faint">${fmtDT(a.at)}</div></div>`).join('') || '<div class="empty">No alerts.</div>'}`;
      drop.classList.remove('hidden');
      $('[data-readall]', drop).onclick = async (ev) => { ev.stopPropagation(); await BB.post('/api/alerts/read'); drop.classList.add('hidden'); BB.refreshCounts(); };
      $$('[data-alert]', drop).forEach((it) => (it.onclick = async () => {
        await BB.post('/api/alerts/read', { id: Number(it.dataset.alert) }); drop.classList.add('hidden'); BB.refreshCounts();
        const r = it.dataset.rec; const type = { CL: 'client', JB: 'job', CA: 'candidate', AP: 'application', BL: 'bill', U: 'person', IV: null }[r.split('-')[0]];
        if (type) BB.open(type, r); else if (r.startsWith('IV-')) BB.go('team/interviews');
      }));
    };
    document.addEventListener('click', (e) => { if (!e.target.closest('.bell')) drop.classList.add('hidden'); });
  }
  BB.quickLead = () => quickLead();
  function quickLead() {
    BB.ask({ title: 'Quick add lead', ok: 'Add lead', fields: [
      { name: 'type', label: 'This is a', type: 'choice', options: [['candidate', 'Candidate'], ['client', 'Client']], value: 'candidate' },
      `<div class="grid g2">${field({ name: 'name', label: 'Name' })}${field({ name: 'phone', label: 'WhatsApp number', type: 'tel', phone: true })}</div>`,
      `<div class="grid g2">${field({ name: 'company', label: 'Company (clients)', opt: true })}${field({ name: 'city', label: 'City', list: 'cities', opt: true })}</div>`,
      { name: 'source', label: 'Source', type: 'select', options: BB.boot.lead_sources, value: 'Walk-in' }, { name: 'note', label: 'Note', type: 'textarea', opt: true },
    ], submit: (v) => BB.post('/api/leads/quick', { ...v, phone: BB.spokenToDigits(v.phone) || v.phone }) }).then((r) => { if (r) { BB.toast(r.isNew ? `${r.id} added` : `Already in the system as ${r.id} — details added`); BB.open(r.id.startsWith('CL') ? 'client' : 'candidate', r.id); BB.refreshPage && BB.refreshPage(); } });
  }
  function changePassword(forced) {
    const html = `<div class="stack">${forced ? '<div class="notice small">Please set your own password before you start (at least 8 characters).</div>' : ''}${field({ name: 'old', label: 'Current password', type: 'password', voice: false })}${field({ name: 'password', label: 'New password', type: 'password', voice: false, hint: 'At least 8 characters' })}</div>`;
    if (forced) {
      $('#app').innerHTML = `<div class="pub"><div class="card login-box"><h2>Set your password</h2><form data-cp style="margin-top:12px">${html}<button class="btn primary block" style="margin-top:12px">Save password</button></form></div></div>`;
      $('[data-cp]').onsubmit = async (e) => { e.preventDefault(); try { await BB.post('/api/team/password', BB.formValues(e.target)); BB.mustChange = false; BB.toast('Password saved'); BB.route(); } catch (er) { BB.showErr(e.target, er); } };
    } else BB.ask({ title: 'Change my password', fields: [html], ok: 'Save password', submit: (v) => BB.post('/api/team/password', v) }).then((x) => x && BB.toast('Password changed'));
  }
  BB.changePassword = changePassword;

  // Shared list helpers for pages
  // opts.scroll: the table gets its own scroll box (header and the tick-box column stay put); c.cls adds classes to a column.
  BB.table = (cols, rows, opts = {}) => `<div class="tbl-wrap${opts.scroll ? ' tbl-scroll' : ''}"><table class="tbl"><thead><tr>${opts.select ? `<th class="sel-col" style="width:28px"><input type="checkbox" data-all aria-label="Tick all"></th>` : ''}${cols.map((c) => `<th class="${c.num ? 'num' : ''} ${c.hideSm ? 'hide-sm' : ''} ${c.cls || ''}">${c.sort && opts.sorted ? BB.sortHead(c, opts.sorted) : c.t}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr class="${opts.open ? 'click' : ''}" ${opts.open ? `data-open="${opts.open(r)}"` : ''}>${opts.select ? `<td class="sel-col" onclick="event.stopPropagation()"><input type="checkbox" data-sel="${esc(r.id)}" aria-label="Tick ${esc(r.id)}"></td>` : ''}${cols.map((c) => `<td class="${c.num ? 'num' : ''} ${c.hideSm ? 'hide-sm' : ''} ${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length + (opts.select ? 1 : 0)}" class="empty">${opts.empty || 'Nothing here yet.'}</td></tr>`}</tbody></table></div>`;
  // A column with sort: 'key' sorts on the server, so every page follows. Numbers and dates start highest first.
  BB.sortHead = (c, q) => { const on = q.sort === c.sort; const next = on ? (q.dir === 'desc' ? 'asc' : 'desc') : c.desc ? 'desc' : 'asc'; return `<button type="button" class="th-sort ${on ? 'on' : ''}" data-sort="${c.sort}" data-dir="${next}" aria-label="Sort by ${esc(c.t)}">${esc(c.t)}<span class="th-arrow" aria-hidden="true">${on ? (q.dir === 'desc' ? '↓' : '↑') : '↕'}</span></button>`; };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-sort]'); if (b) BB.setQ({ sort: b.dataset.sort, dir: b.dataset.dir, page: 1 }); });
  // The heading of a bulk actions card, the same on every table. noun: what the table lists.
  BB.bulkHead = (noun, attr) => `<div class="bulk-head"><span class="bulk-ico">${BB.icon('layers')}</span><b class="bulk-t">Bulk actions</b><span class="bulk-count" ${attr}></span></div>`;
  BB.bulkCount = (noun, n) => (n ? `${n} ${noun}${n === 1 ? '' : 's'} selected` : '');
  BB.pager = (r, onPage) => `<div class="pager"><span>${r.total} total · page ${r.page} of ${r.pages}</span><button class="btn sm" data-pg="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>‹ Prev</button><button class="btn sm" data-pg="${r.page + 1}" ${r.page >= r.pages ? 'disabled' : ''}>Next ›</button></div>`;
  BB.wirePager = (el) => $$('[data-pg]', el).forEach((b) => (b.onclick = () => BB.setQ({ page: b.dataset.pg })));
  BB.selected = (el) => $$('[data-sel]:checked', el).map((x) => x.dataset.sel);
  BB.wireSelect = (el, onChange) => { const all = $('[data-all]', el); if (all) all.onchange = () => { $$('[data-sel]', el).forEach((x) => (x.checked = all.checked)); onChange && onChange(); }; $$('[data-sel]', el).forEach((x) => (x.onchange = () => onChange && onChange())); };
  BB.qs = (q, extra = {}) => new URLSearchParams(Object.entries({ ...q, ...extra }).filter(([, v]) => v !== '' && v !== undefined && v !== null)).toString();
})();
