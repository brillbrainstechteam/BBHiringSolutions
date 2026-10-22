/* Candidate account (#my-profile, 6.4). */
(() => {
  const { $, $$, esc, inr, fmtD, fmtDT, field, scoreBadge } = BB;
  let D = null; let tab = 'home';

  BB.views.candidate = async (r) => {
    if (r.sub[0]) tab = r.sub[0];
    if (!BB.token('candidate')) return BB.otpLogin('candidate', 'My profile', () => BB.route());
    try { D = await BB.api('/api/cand/me'); } catch (e) { return; }
    render();
  };
  const reload = async () => { D = await BB.api('/api/cand/me'); render(); };
  const act = async (fn, ok) => { try { await fn(); ok && BB.toast(ok); await reload(); } catch (e) { BB.fail(e); } };

  function render() {
    const p = D.profile;
    const tabs = [['home', 'Home'], ['jobs', 'Jobs for you', D.jobs.length], ['apps', 'My applications'], ['profile', 'My profile']];
    $('#app').innerHTML = `<div class="pub">${BB.publicTop('My profile')}<div class="acct-band"><div class="in"><div class="grow"><span class="eyebrow">Candidate profile</span><h1 style="margin-top:8px">Hello, <span class="hl">${esc(p.name.split(' ')[0])}</span></h1><div class="meta"><span class="mono">${esc(p.id)}</span> · ${esc(p.job_wanted || '')} · ${esc(p.city || '')}</div></div><button class="btn" data-out>Log out</button></div></div><div class="acct">
      <div class="tabs">${tabs.map(([k, l, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}${n ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div><div data-body></div></div></div>`;
    $$('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', `#my-profile/${tab}`); render(); }));
    $('[data-out]').onclick = async () => { await BB.post('/api/account/logout', {}).catch(() => {}); BB.setToken('candidate', null); BB.route(); };
    const el = $('[data-body]');
    ({ home, jobs, apps, profile }[tab] || home)(el);
    BB.attachMics(el); wire(el);
  }
  function wire(el) {
    $$('[data-confirm]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/cand/interviews/${b.dataset.confirm}/confirm`), 'Interview confirmed')));
    $$('[data-resch]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Ask to reschedule', fields: [{ name: 'note', label: 'Which days or times suit you?', type: 'textarea' }], ok: 'Send', submit: (v) => BB.post(`/api/cand/interviews/${b.dataset.resch}/reschedule`, v) }).then((x) => x && BB.toast('Your recruiter will call you'))));
    $$('[data-accept]', el).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Accept the offer', 'Great news! Your recruiter and the company will be told at once.', 'Accept offer')) act(() => BB.post(`/api/cand/apps/${b.dataset.accept}/accept`), 'Offer accepted — congratulations!'); }));
    $$('[data-decline]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Decline the offer', fields: [{ name: 'note', label: 'Tell us why (optional)', type: 'textarea' }], ok: 'Decline', submit: (v) => BB.post(`/api/cand/apps/${b.dataset.decline}/decline`, v) }).then((x) => x && reload())));
    $$('[data-apply]', el).forEach((b) => (b.onclick = () => act(() => BB.post('/api/cand/apply', { job_id: b.dataset.apply }), 'Applied! See it in My applications')));
    $$('[data-file]', el).forEach((b) => (b.onclick = () => BB.openFile(b.dataset.file)));
    $$('[data-doc]', el).forEach((b) => (b.onclick = async () => { const f = await BB.pickFile(); if (f) act(() => BB.post('/api/cand/files', { app_id: b.dataset.doc, type: b.dataset.type || 'joining_doc', label: b.dataset.label, ...f }), 'Uploaded'); }));
  }
  const ivLine = (i) => `<div class="row small"><b>${fmtDT(i.at)}</b> · ${esc(i.place)} ${i.confirmed ? '<span class="badge b-green">Confirmed</span>' : ''}${['Scheduled', 'Rescheduled'].includes(i.status) && i.at > new Date().toISOString() ? `${i.confirmed ? '' : `<button class="btn sm primary" data-confirm="${i.id}">Confirm</button>`}<button class="btn sm" data-resch="${i.id}">Ask to reschedule</button>` : `<span class="badge b-outline">${esc(i.view_status)}</span>`}</div>`;

  function home(el) {
    const o = D.offer; const n = D.next;
    el.innerHTML = `<div class="stack-lg">
      ${o ? `<div class="banner"><div class="ic">🎉</div><div class="grow"><b>You have an offer: ${esc(o.job_title)} at ${esc(o.company)}</b><div class="small">${inr(o.offer_ctc)} a year · joining ${fmtD(o.joining_date)}</div></div><div class="row"><button class="btn gold" data-accept="${o.id}">Accept</button><button class="btn" data-decline="${o.id}">Decline</button></div></div>` : ''}
      ${n ? `<div class="card pad stack-sm"><div class="row between"><h3>Your next interview</h3><span class="badge b-primary">${esc(n.job_title)}</span></div><div class="small muted">${esc(n.company)}</div>${ivLine(n)}</div>` : ''}
      <div class="grid g2">
        <div class="card pad stack-sm"><div class="row between"><h3>Profile complete</h3><b>${D.pct}%</b></div><div class="bar gold"><i style="width:${D.pct}%"></i></div><div class="small muted">A full profile — salary, notice period, skills and CV — gets you better matches.</div><button class="btn sm" data-go="profile">Complete my profile</button></div>
        <div class="card pad stack-sm"><h3>Refer a friend</h3><div class="small muted">Share your link. When your friend fills the form, we know you referred them.</div><div class="row"><input readonly value="${esc(D.referral)}" class="mono small grow"><button class="btn sm" data-copy>Copy link</button></div></div>
      </div>
      <div class="card"><div class="card-h"><h3>Active applications</h3></div><div class="card-b stack">${D.apps.filter((a) => a.result === 'open').map((a) => `<div><div class="row between"><b>${esc(a.job_title)}</b><span class="small muted">${esc(a.company)}</span></div>${BB.tracker(a.step, a.result)}</div>`).join('') || `<div class="muted">No active applications. <a href="#" data-go="jobs">See jobs for you</a>.</div>`}</div></div></div>`;
    $$('[data-go]', el).forEach((b) => (b.onclick = (e) => { e.preventDefault(); tab = b.dataset.go; render(); }));
    $('[data-copy]', el).onclick = () => BB.copy(D.referral);
  }
  function jobs(el) {
    el.innerHTML = D.jobs.length ? `<div class="stack">${D.jobs.map((j) => `<div class="card pad row between"><div class="grow"><div class="row"><h3 style="font-size:16px">${esc(j.title)}</h3>${scoreBadge(j.score)}</div><div class="small muted">${esc(j.company)} · ${esc(j.city)} · ${esc(j.salary)}${j.exp ? ` · ${esc(j.exp)}` : ''}</div>${j.reasons.length ? `<div class="small" style="margin-top:4px">${j.reasons.map((r) => `<span class="badge b-green" style="margin:2px 4px 0 0">✓ ${esc(r)}</span>`).join('')}</div>` : ''}</div><button class="btn primary" data-apply="${j.id}">Apply</button></div>`).join('')}</div>`
      : '<div class="card empty">No matching open jobs right now. Keep your profile updated — we send new jobs on WhatsApp.</div>';
  }
  function apps(el) {
    el.innerHTML = D.apps.length ? `<div class="stack">${D.apps.map((a) => `<div class="card pad stack-sm">
      <div class="row between"><div><h3 style="font-size:16px">${esc(a.job_title)}</h3><div class="small muted">${esc(a.company)} · ${esc(a.city)} <span class="mono faint">${a.id}</span></div></div>${a.result === 'open' ? '<span class="badge b-primary">In process</span>' : a.result === 'Hired' ? '<span class="badge b-green">Hired</span>' : '<span class="badge b-red">Closed</span>'}</div>
      ${BB.tracker(a.step, a.result)}
      ${a.interviews.length ? `<div class="stack-sm"><b class="small">Interviews</b>${a.interviews.map(ivLine).join('')}</div>` : ''}
      ${a.step === 'Offer made' && a.result === 'open' ? `<div class="notice gold"><b>Offer: ${inr(a.offer_ctc)} a year, joining ${fmtD(a.joining_date)}</b><div class="row" style="margin-top:8px">${a.offer_letter ? `<button class="btn sm" data-file="${a.offer_letter}">Read offer letter</button>` : ''}<button class="btn gold" data-accept="${a.id}">Accept</button><button class="btn" data-decline="${a.id}">Decline</button></div></div>` : ''}
      ${a.step === 'Offer accepted' && a.result === 'open' ? `<div class="notice"><b>You join on ${fmtD(a.joining_date)}.</b> Upload your joining documents so the company is ready for you.<div class="row" style="margin-top:8px">${a.offer_letter ? `<button class="btn sm" data-file="${a.offer_letter}">Offer letter</button><button class="btn sm" data-doc="${a.id}" data-type="offer_signed" data-label="Signed offer letter">Upload signed offer</button>` : ''}${['PAN card', 'Aadhaar', 'Bank details', 'Relieving letter', 'Photo'].map((d) => `<button class="btn sm" data-doc="${a.id}" data-label="${d}">${a.joining_docs.some((x) => x.label === d) ? '✓ ' : '+ '}${d}</button>`).join('')}</div></div>` : ''}
      ${a.result === 'Hired' ? `<div class="small muted">Joined ${fmtD(a.joining_date)}${a.left_date ? ` · left ${fmtD(a.left_date)}` : ''}</div>` : ''}
      ${a.result !== 'open' && a.result !== 'Hired' ? `<div class="small muted">This application is closed (${esc(a.result)}).</div>` : ''}
    </div>`).join('')}</div>` : '<div class="card empty">No applications yet.</div>';
  }
  function profile(el) {
    const p = D.profile;
    el.innerHTML = `<div class="grid g2" style="align-items:start"><form class="card pad stack" data-prof>${BB.voiceSwitch()}
      ${field({ name: 'name', label: 'Name', value: p.name })}
      <div class="grid g2">${field({ name: 'city', label: 'City', value: p.city, list: 'cities' })}${field({ name: 'email', label: 'Email', value: p.email, type: 'email', opt: true })}</div>
      <label class="field"><span class="lab">Job you want</span><select name="job_wanted">${BB.jobOptions(p.job_wanted)}${p.job_wanted && !BB.boot.jobs.some((j) => j.title === p.job_wanted) ? `<option selected>${esc(p.job_wanted)}</option>` : ''}</select></label>
      <div class="grid g2">${field({ name: 'exp_total', label: 'Total experience (years)', type: 'number', value: p.exp_total ?? '' })}${field({ name: 'exp_jewellery', label: 'In jewellery (years)', type: 'number', value: p.exp_jewellery ?? '' })}</div>
      <div class="grid g2">${field({ name: 'cur_month', label: 'Current salary (per month)', type: 'number', value: p.cur_month ?? '' })}${field({ name: 'exp_month', label: 'Expected salary (per month)', type: 'number', value: p.exp_month ?? '' })}</div>
      <div class="grid g2">${field({ name: 'notice_days', label: 'Notice period (days)', type: 'number', value: p.notice_days ?? '' })}${field({ name: 'current_company', label: 'Current company', value: p.current_company || '', opt: true })}</div>
      ${field({ name: 'skills', label: 'Skills (comma separated)', value: (p.skills || []).join(', '), hint: `e.g. ${BB.boot.skills.slice(0, 5).join(', ')}` })}
      ${field({ name: 'looking', label: 'Are you looking?', type: 'select', options: ['Actively looking', 'Open to offers', 'Not looking'], value: p.looking === 'Placed' ? 'Not looking' : p.looking, placeholder: false })}
      <button class="btn primary">Save</button></form>
      <div class="stack"><div class="card pad stack-sm"><h3>CV</h3>${D.files.filter((f) => f.type === 'cv').map((f) => `<div class="row"><button class="btn sm" data-file="${f.id}">${esc(f.name)}</button><span class="faint small">v${f.version} · ${fmtD(f.at)}</span></div>`).join('') || '<div class="muted small">No CV yet.</div>'}<button class="btn sm" data-cv>Upload CV</button></div>
      <div class="card pad stack-sm"><h3>Your data</h3><div class="small muted">Download everything we hold about you, or ask us to delete it.</div><div class="row"><button class="btn sm" data-export>Download my data</button><button class="btn sm danger" data-del>Ask to delete my data</button></div></div></div></div>`;
    $('[data-prof]', el).onsubmit = (e) => { e.preventDefault(); const v = BB.formValues(e.target); v.skills = v.skills.split(',').map((s) => s.trim()).filter(Boolean); for (const k of ['exp_total', 'exp_jewellery', 'notice_days']) v[k] = v[k] === '' ? '' : Number(v[k]); act(() => BB.put('/api/cand/profile', v), 'Profile saved').catch(() => {}); };
    $('[data-cv]', el).onclick = async () => { const f = await BB.pickFile(); if (!f) return; act(async () => { const r = await BB.post('/api/cand/files', { type: 'cv', ...f }); BB.toast(r.filled && r.filled.length ? `CV uploaded — we filled in your ${r.filled.join(', ')} from it. Please check.` : 'CV uploaded'); }); };
    $('[data-export]', el).onclick = () => BB.download('/api/cand/export');
    $('[data-del]', el).onclick = async () => { if (await BB.confirm('Delete my data', 'BrillBrains will remove your personal details and files after checking.', 'Send request')) act(() => BB.post('/api/cand/delete-request'), 'Request sent'); };
  }
})();
