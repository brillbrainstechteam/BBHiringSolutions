/* Candidate account (#my-profile, 6.4). */
(() => {
  const { $, $$, esc, inr, fmtD, fmtDT, field, icon } = BB;
  let D = null; let tab = 'home'; let focusField = null;

  BB.views.candidate = async (r) => {
    if (r.sub[0]) tab = r.sub[0];
    if (!BB.token('candidate')) return BB.otpLogin('candidate', 'My profile', () => BB.route());
    try { D = await BB.api('/api/cand/me'); } catch (e) { return; }
    render();
  };
  const reload = async () => { D = await BB.api('/api/cand/me'); render(); };
  const act = async (fn, ok) => { try { await fn(); ok && BB.toast(ok); await reload(); } catch (e) { BB.fail(e); } };
  const go = (t, f) => { tab = t; focusField = f || null; history.replaceState(null, '', `#my-profile/${t}`); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const ring = (pct, size = 64) => `<div class="cp-ring" style="--p:${pct};width:${size}px;height:${size}px"><span>${pct}<small>%</small></span></div>`;
  const dateTile = (iso) => { const d = new Date(iso); return `<div class="cp-date"><b>${d.toLocaleDateString('en-IN', { day: 'numeric', timeZone: 'Asia/Kolkata' })}</b><span>${d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })}</span></div>`; };
  const active = () => D.apps.filter((a) => a.result === 'open');

  function render() {
    const p = D.profile; const first = esc(String(p.name || '').split(' ')[0]);
    const tabs = [['home', 'Home', 'home'], ['jobs', 'Jobs for you', 'brief', D.jobs.length], ['apps', 'Applications', 'flow', active().length], ['profile', 'Profile', 'users']];
    $('#app').innerHTML = `<div class="pub">${BB.publicTop('My profile')}
      <div class="acct-band cp-hero"><div class="in">
        <div class="cp-avatar">${esc(initials(p.name))}</div>
        <div class="grow"><span class="eyebrow">Candidate profile</span><h1>Hello, <span class="hl">${first}</span></h1>
          <div class="cp-chips"><span class="mono">${esc(p.id)}</span>${p.job_wanted ? `<span>${esc(p.job_wanted)}</span>` : ''}${p.city ? `<span>${esc(p.city)}</span>` : ''}<button class="cp-status ${p.looking === 'Not looking' ? 'off' : ''}" data-goto="profile" data-f="looking">${esc(p.looking || 'Actively looking')}</button></div></div>
        <button class="cp-strength" data-goto="profile" title="Profile strength">${ring(D.pct, 58)}<span>Profile<br>strength</span></button>
        <button class="btn sm" data-out>Log out</button>
      </div></div>
      <div class="acct"><div class="tabs cp-tabs">${tabs.map(([k, l, ic, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${icon(ic)}<span>${l}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div><div data-body></div></div></div>`;
    $$('[data-tab]').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
    $$('[data-goto]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); go(b.dataset.goto, b.dataset.f); }));
    $('[data-out]').onclick = async () => { await BB.post('/api/account/logout', {}).catch(() => {}); BB.setToken('candidate', null); BB.route(); };
    const el = $('[data-body]');
    ({ home, jobs, apps, profile }[tab] || home)(el);
    BB.attachMics(el); wire(el);
    $$('[data-goto]', el).forEach((b) => (b.onclick = (e) => { e.preventDefault(); go(b.dataset.goto, b.dataset.f); }));
  }
  function wire(el) {
    $$('[data-confirm]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/cand/interviews/${b.dataset.confirm}/confirm`), 'Interview confirmed')));
    $$('[data-resch]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Ask to reschedule', fields: [{ name: 'note', label: 'Which days or times suit you?', type: 'textarea' }], ok: 'Send', submit: (v) => BB.post(`/api/cand/interviews/${b.dataset.resch}/reschedule`, v) }).then((x) => x && BB.toast('Your recruiter will call you'))));
    $$('[data-accept]', el).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Accept the offer', 'Great news! Your recruiter and the company will be told at once.', 'Accept offer')) act(() => BB.post(`/api/cand/apps/${b.dataset.accept}/accept`), 'Offer accepted — congratulations!'); }));
    $$('[data-decline]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Decline the offer', fields: [{ name: 'note', label: 'Tell us why (optional)', type: 'textarea' }], ok: 'Decline', submit: (v) => BB.post(`/api/cand/apps/${b.dataset.decline}/decline`, v) }).then((x) => x && reload())));
    $$('[data-apply]', el).forEach((b) => (b.onclick = () => act(() => BB.post('/api/cand/apply', { job_id: b.dataset.apply }), 'Applied! Follow it under Applications')));
    $$('[data-file]', el).forEach((b) => (b.onclick = () => BB.openFile(b.dataset.file)));
    $$('[data-doc]', el).forEach((b) => (b.onclick = async () => { const f = await BB.pickFile(); if (f) act(() => BB.post('/api/cand/files', { app_id: b.dataset.doc, type: b.dataset.type || 'joining_doc', label: b.dataset.label, ...f }), 'Uploaded'); }));
    $$('[data-cv]', el).forEach((b) => (b.onclick = async () => { const f = await BB.pickFile(); if (!f) return; act(async () => { const r = await BB.post('/api/cand/files', { type: 'cv', ...f }); BB.toast(r.filled && r.filled.length ? `CV uploaded — we filled in your ${r.filled.join(', ')} from it. Please check.` : 'CV uploaded'); }); }));
    $$('[data-copy]', el).forEach((b) => (b.onclick = () => BB.copy(D.referral)));
  }

  // ---------- shared pieces ----------
  const ivCard = (i, title) => {
    const upcoming = ['Scheduled', 'Rescheduled'].includes(i.status) && i.at > new Date().toISOString();
    return `<div class="cp-iv">${dateTile(i.at)}<div class="grow"><div class="cp-iv-t">${title ? `${esc(title)} · ` : ''}${esc(i.name || 'Interview')}</div><div class="small muted">${fmtDT(i.at)} · ${esc(i.place || '')}</div>
      <div class="row" style="margin-top:8px">${upcoming ? `${i.confirmed ? '<span class="badge b-green">✓ Confirmed</span>' : `<button class="btn sm primary" data-confirm="${i.id}">I'll be there</button>`}<button class="btn sm" data-resch="${i.id}">Ask to reschedule</button>` : `<span class="badge b-outline">${esc(i.view_status)}</span>`}</div></div></div>`;
  };
  const jobCard = (j) => `<div class="cp-job"><div class="cp-match" style="--p:${j.score}" title="How well this job matches your profile"><b>${j.score}%</b><span>match</span></div>
    <div class="grow"><h3>${esc(j.title)}</h3><div class="small muted">${[j.company, j.city, j.salary, j.exp].filter(Boolean).map(esc).join(' · ')}</div>
    ${j.reasons.length ? `<div class="cp-reasons">${j.reasons.map((r) => `<span>✓ ${esc(r)}</span>`).join('')}</div>` : ''}</div>
    <button class="btn primary" data-apply="${j.id}">Apply</button></div>`;
  const step = (a) => `<div class="cp-app-mini"><div class="row between"><b>${esc(a.job_title)}</b><span class="small muted">${esc(a.company)}</span></div>${BB.tracker(a.step, a.result)}</div>`;

  // ---------- Home ----------
  function home(el) {
    const o = D.offer; const n = D.next; const missing = D.missing || [];
    const cv = D.files.filter((f) => f.type === 'cv').sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const share = `https://wa.me/?text=${encodeURIComponent(`Looking for a jewellery job? Apply through BrillBrains Hiring: ${D.referral}`)}`;
    el.innerHTML = `<div class="cp-grid">
      <div class="stack-lg">
        ${o ? `<div class="cp-offer"><div class="cp-offer-ic">🎉</div><div class="grow"><span class="eyebrow">You have an offer</span><h2>${esc(o.job_title)} at ${esc(o.company)}</h2><div>${inr(o.offer_ctc)} a year · joining ${fmtD(o.joining_date)}</div></div><div class="row">${o.offer_letter ? `<button class="btn" data-file="${o.offer_letter}">Read offer letter</button>` : ''}<button class="btn gold" data-accept="${o.id}">Accept offer</button><button class="btn ghost" data-decline="${o.id}">Decline</button></div></div>` : ''}
        ${n ? `<div class="card pad stack-sm"><div class="cp-h">${icon('cal')}<h3>Your next interview</h3></div>${ivCard(n, n.job_title)}<div class="small muted">With ${esc(n.company)}. Carry a printed CV and reach 10 minutes early.</div></div>` : ''}
        <div class="card pad stack-sm"><div class="cp-h">${icon('flow')}<h3>Your applications</h3>${active().length ? `<a href="#" class="small right" data-goto="apps">See all</a>` : ''}</div>
          ${active().map(step).join('') || `<div class="cp-empty">${icon('brief')}<div><b>No applications yet</b><div class="small muted">Apply to a matching job below, or wait for your recruiter's call.</div></div></div>`}</div>
        <div class="card pad stack-sm"><div class="cp-h">${icon('brief')}<h3>Top matches for you</h3>${D.jobs.length > 3 ? `<a href="#" class="small right" data-goto="jobs">See all ${D.jobs.length}</a>` : ''}</div>
          ${D.jobs.slice(0, 3).map(jobCard).join('') || '<div class="small muted">No matching jobs right now. We send new ones on WhatsApp as soon as they open.</div>'}</div>
      </div>
      <div class="stack-lg">
        <div class="card pad stack-sm cp-strength-card"><div class="row" style="gap:14px">${ring(D.pct, 72)}<div><h3>${D.pct >= 100 ? 'Your profile is complete' : 'Make your profile stand out'}</h3><div class="small muted">${D.pct >= 100 ? 'Recruiters see everything they need.' : 'Complete profiles get matched and called first.'}</div></div></div>
          ${missing.length ? `<div class="cp-todo">${missing.map((m) => `<button ${m.key === 'cv_file' ? 'data-cv' : `data-goto="profile" data-f="${m.key}"`}>${icon('plus')} Add ${esc(m.label === 'CV' ? 'CV' : m.label.toLowerCase())}</button>`).join('')}</div>` : ''}</div>
        <div class="card pad stack-sm"><div class="cp-h">${icon('note')}<h3>Your CV</h3></div>
          ${cv ? `<button class="cp-file" data-file="${cv.id}"><span class="cp-file-ic">PDF</span><span class="grow"><b>${esc(cv.name)}</b><span class="small muted">Updated ${fmtD(cv.at)}</span></span></button>` : '<div class="small muted">No CV yet. Add one — we read it and fill in your details.</div>'}
          <button class="btn sm" data-cv>${cv ? 'Replace CV' : 'Upload CV'}</button></div>
        <div class="card pad stack-sm cp-refer"><div class="cp-h">${icon('users')}<h3>Refer a friend</h3></div><div class="small muted">Know someone looking for a jewellery job? Share your link.</div>
          <div class="row"><a class="btn sm wa" href="${share}" target="_blank" rel="noopener">${BB.waIcon} Share on WhatsApp</a><button class="btn sm" data-copy>Copy link</button></div></div>
      </div></div>`;
  }

  // ---------- Jobs ----------
  function jobs(el) {
    el.innerHTML = D.jobs.length ? `<div class="stack"><div class="small muted">${D.jobs.length} open job${D.jobs.length === 1 ? '' : 's'} match your profile, best first. The company name is shared when your interview is fixed.</div>${D.jobs.map((j) => `<div class="card pad">${jobCard(j)}</div>`).join('')}</div>`
      : `<div class="card pad cp-empty big">${icon('brief')}<div><b>No matching jobs right now</b><div class="small muted">Keep your profile up to date — we send new jobs on WhatsApp as soon as they open.</div><button class="btn sm" data-goto="profile" style="margin-top:10px">Update my profile</button></div></div>`;
  }

  // ---------- Applications ----------
  function apps(el) {
    const badge = (a) => (a.result === 'open' ? '<span class="badge b-primary">In process</span>' : a.result === 'Hired' ? '<span class="badge b-green">Hired</span>' : '<span class="badge b-red">Closed</span>');
    el.innerHTML = D.apps.length ? `<div class="stack">${D.apps.map((a) => `<div class="card pad stack-sm cp-app ${a.result === 'open' ? '' : 'done'}">
      <div class="row between"><div><h3>${esc(a.job_title)}</h3><div class="small muted">${esc(a.company)} · ${esc(a.city)} <span class="mono faint">${a.id}</span></div></div>${badge(a)}</div>
      ${BB.tracker(a.step, a.result)}
      ${a.interviews.length ? `<div class="stack-sm">${a.interviews.map((i) => ivCard(i)).join('')}</div>` : ''}
      ${a.step === 'Offer made' && a.result === 'open' ? `<div class="notice gold"><b>Offer: ${inr(a.offer_ctc)} a year, joining ${fmtD(a.joining_date)}</b><div class="row" style="margin-top:8px">${a.offer_letter ? `<button class="btn sm" data-file="${a.offer_letter}">Read offer letter</button>` : ''}<button class="btn gold" data-accept="${a.id}">Accept</button><button class="btn" data-decline="${a.id}">Decline</button></div></div>` : ''}
      ${a.step === 'Offer accepted' && a.result === 'open' ? `<div class="notice"><b>You join on ${fmtD(a.joining_date)}.</b> Upload your joining papers so the company is ready for you.
        <div class="cp-docs">${a.offer_letter ? `<button class="btn sm" data-file="${a.offer_letter}">Offer letter</button><button class="cp-doc ${a.joining_docs.some((x) => x.label === 'Signed offer letter') ? 'ok' : ''}" data-doc="${a.id}" data-type="offer_signed" data-label="Signed offer letter">Signed offer</button>` : ''}${['PAN card', 'Aadhaar', 'Bank details', 'Relieving letter', 'Photo'].map((d) => `<button class="cp-doc ${a.joining_docs.some((x) => x.label === d) ? 'ok' : ''}" data-doc="${a.id}" data-label="${d}">${d}</button>`).join('')}</div></div>` : ''}
      ${a.result === 'Hired' ? `<div class="small muted">Joined ${fmtD(a.joining_date)}${a.left_date ? ` · left ${fmtD(a.left_date)}` : ''}</div>` : ''}
      ${a.result !== 'open' && a.result !== 'Hired' ? `<div class="small muted">This application is closed (${esc(a.result)}).</div>` : ''}
    </div>`).join('')}</div>` : `<div class="card pad cp-empty big">${icon('flow')}<div><b>No applications yet</b><div class="small muted">When you apply or your recruiter puts you forward, every step shows here.</div><button class="btn sm primary" data-goto="jobs" style="margin-top:10px">See jobs for you</button></div></div>`;
  }

  // ---------- Profile ----------
  function profile(el) {
    const p = D.profile; const fresher = p.exp_total === 0;
    const skills = new Set(p.skills || []);
    el.innerHTML = `<form class="cp-form" data-prof novalidate><div class="cp-grid">
      <div class="stack-lg">
        <div class="card pad stack"><div class="cp-h">${icon('users')}<h3>About you</h3><div class="right">${BB.voiceSwitch()}</div></div>
          ${field({ name: 'name', label: 'Name', value: p.name })}
          <div class="grid g2"><label class="field"><span class="lab">WhatsApp number</span><div class="inp-wrap has-cc"><span class="cc">+91</span><input value="${esc(String(p.whatsapp || '').replace(/(\d{5})(\d{5})/, '$1 $2'))}" readonly class="cp-locked" aria-label="WhatsApp number"></div><div class="faint small" style="margin-top:3px">Your login number. To change it, <a href="https://wa.me/91${esc(BB.boot.business.support_phone)}" target="_blank" rel="noopener">message us</a>.</div></label>
            ${field({ name: 'email', label: 'Email', value: p.email, type: 'email', opt: true })}</div>
          ${field({ name: 'city', label: 'City', value: p.city, list: 'cities' })}
        </div>
        <div class="card pad stack"><div class="cp-h">${icon('brief')}<h3>Work</h3></div>
          <label class="field"><span class="lab">Job you want</span><select name="job_wanted">${BB.jobOptions(p.job_wanted)}${p.job_wanted && !BB.boot.jobs.some((j) => j.title === p.job_wanted) ? `<option selected>${esc(p.job_wanted)}</option>` : ''}</select></label>
          <div class="field"><span class="lab">Are you a fresher?</span><div class="seg cp-seg" data-fresher><button type="button" data-v="no" class="${fresher ? '' : 'on'}">No, I have experience</button><button type="button" data-v="yes" class="${fresher ? 'on' : ''}">Yes, I'm a fresher</button></div></div>
          <div class="stack" data-exp ${fresher ? 'hidden' : ''}>
            <div class="grid g2">${field({ name: 'exp_total', label: 'Total experience (years)', type: 'number', value: p.exp_total ?? '', attrs: 'min="0" max="45" step="0.5"' })}${field({ name: 'exp_jewellery', label: 'In jewellery (years)', type: 'number', value: p.exp_jewellery ?? '', opt: true, attrs: 'min="0" max="45" step="0.5"' })}</div>
            <div class="grid g2">${field({ name: 'current_company', label: 'Current company', value: p.current_company || '', opt: true })}${field({ name: 'notice_days', label: 'Notice period (days)', type: 'number', value: p.notice_days ?? '', attrs: 'min="0" max="180"' })}</div>
            ${field({ name: 'cur_month', label: 'Current salary (₹ per month)', type: 'number', value: p.cur_month ?? '', attrs: 'min="0"' })}
          </div>
          ${field({ name: 'exp_month', label: 'Expected salary (₹ per month)', type: 'number', value: p.exp_month ?? '', attrs: 'min="0"' })}
        </div>
        <div class="card pad stack-sm"><div class="cp-h">${icon('chart')}<h3>Skills</h3></div><div class="small muted">Tap the ones you have.</div>
          <div class="cp-skills" data-skills>${[...new Set([...BB.boot.skills, ...skills])].map((s) => `<button type="button" class="${skills.has(s) ? 'on' : ''}" data-skill="${esc(s)}">${esc(s)}</button>`).join('')}</div>
          <div class="row"><input class="grow" data-skill-new placeholder="Add another skill"><button type="button" class="btn sm" data-skill-add>${icon('plus')} Add</button></div>
        </div>
      </div>
      <div class="stack-lg">
        <div class="card pad stack-sm"><div class="cp-h">${icon('search')}<h3>Job search</h3></div>
          <div class="cp-looking" data-looking>${['Actively looking', 'Open to offers', 'Not looking'].map((v) => `<label><input type="radio" name="looking" value="${v}" ${(p.looking === 'Placed' ? 'Not looking' : p.looking || 'Actively looking') === v ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></div>
        <div class="card pad stack-sm"><div class="cp-h">${icon('note')}<h3>Your CV</h3></div>${D.files.filter((f) => f.type === 'cv').map((f) => `<button type="button" class="cp-file" data-file="${f.id}"><span class="cp-file-ic">CV</span><span class="grow"><b>${esc(f.name)}</b><span class="small muted">Version ${f.version} · ${fmtD(f.at)}</span></span></button>`).join('') || '<div class="small muted">No CV yet. Upload one and we fill in your details from it.</div>'}<button type="button" class="btn sm" data-cv>Upload CV</button></div>
      </div></div>
      <div class="cp-save"><span class="small muted" data-dirty>All changes saved</span><button class="btn primary">Save profile</button></div></form>`;
    const form = $('[data-prof]', el);
    const dirty = () => { $('[data-dirty]', el).textContent = 'You have unsaved changes'; form.classList.add('dirty'); };
    form.addEventListener('input', dirty); form.addEventListener('change', dirty);
    let isFresher = fresher;
    $$('[data-fresher] button', el).forEach((b) => (b.onclick = () => { isFresher = b.dataset.v === 'yes'; $$('[data-fresher] button', el).forEach((x) => x.classList.toggle('on', x === b)); $('[data-exp]', el).hidden = isFresher; dirty(); }));
    $$('[data-skill]', el).forEach((b) => (b.onclick = () => { b.classList.toggle('on'); dirty(); }));
    $('[data-skill-add]', el).onclick = () => {
      const inp = $('[data-skill-new]', el); const v = inp.value.trim(); if (!v) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'on'; b.dataset.skill = v; b.textContent = v; b.onclick = () => { b.classList.toggle('on'); dirty(); };
      $('[data-skills]', el).appendChild(b); inp.value = ''; dirty();
    };
    $('[data-skill-new]', el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-skill-add]', el).click(); } };
    form.onsubmit = (e) => {
      e.preventDefault(); const v = BB.formValues(form);
      v.skills = $$('[data-skill].on', el).map((b) => b.dataset.skill);
      // A fresher has no experience, current salary, notice period or current company.
      if (isFresher) Object.assign(v, { exp_total: 0, exp_jewellery: 0, notice_days: 0, cur_month: '', current_company: '' });
      else for (const k of ['exp_total', 'exp_jewellery', 'notice_days']) v[k] = v[k] === '' ? '' : Number(v[k]);
      if (!isFresher && v.exp_total === 0) v.exp_total = ''; // "No, I have experience" with 0 years would read as a fresher
      act(() => BB.put('/api/cand/profile', v), 'Profile saved').catch(() => {});
    };
    const FIELD = { cur_salary: 'cur_month', exp_salary: 'exp_month', skills: 'skill-new', looking: 'looking' };
    if (focusField) { const k = FIELD[focusField] || focusField; const f = k === 'skill-new' ? $('[data-skill-new]', el) : $(`[name="${k}"]`, el); if (f) { f.scrollIntoView({ block: 'center' }); if (f.focus) f.focus(); } focusField = null; }
  }
})();
