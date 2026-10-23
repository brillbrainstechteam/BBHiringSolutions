/* Client account (#my-account, 6.3) + the shared WhatsApp-code login for clients and candidates. */
(() => {
  const { $, $$, esc, inr, fmtD, fmtDT, field, statusBadge, scoreBadge } = BB;

  // Login: WhatsApp number → 6-digit code on WhatsApp → in.
  const lastPhone = () => { try { return localStorage.getItem('bbhs.lastPhone') || ''; } catch { return ''; } };
  BB.otpLogin = (kind, title, after) => {
    const intro = kind === 'client'
      ? { eyebrow: 'For employers', title: 'Your hiring, <em>all in one place</em>', lead: 'Job openings, shortlisted candidates, interviews, offers and bills — always up to date.', perks: [['1', 'Review profiles', 'Share interview times in one step.'], ['2', 'Give feedback', 'Selected, another round or not selected.'], ['₹', 'Pay by UPI', 'Bills and receipts in one tab.']] }
      : { eyebrow: 'For candidates', title: 'Track every step <em>to your new job</em>', lead: 'See matching jobs, your interviews and your offers, and keep your profile up to date.', perks: [['★', 'Jobs for you', 'Matched on your city, skills and salary.'], ['✓', 'Confirm interviews', 'Or ask to move them — in one tap.'], ['✉', 'Accept your offer', 'Read the offer letter and upload joining papers.']] };
    $('#app').innerHTML = BB.split({ top: BB.publicTop(title), ...intro, card: `<div class="card-title">${esc(title)}</div><p class="muted" style="margin:4px 0 16px">Log in with your WhatsApp number. We send you a 6-digit code.</p><form class="stack" data-step1>${BB.field({ name: 'phone', label: 'WhatsApp number', type: 'tel', phone: true, value: lastPhone(), placeholder: '10 digits', attrs: 'inputmode="numeric" maxlength="14" autocomplete="tel"' })}<button class="btn gold block lg">Send code</button></form>
      <form class="stack hidden" data-step2><div class="muted small" data-sent></div>${BB.field({ name: 'code', label: '6-digit code', voice: false, attrs: 'inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="code-in"' })}<div data-dev></div><button class="btn gold block lg">Log in</button><div class="row small between"><a href="#" data-resend>Send the code again</a><span class="muted" data-wait></span><a href="#" data-again>Use another number</a></div></form>
      <p class="small muted" style="margin-top:16px">New here? ${kind === 'client' ? '<a href="#hire">Fill the hiring form</a>' : '<a href="#apply">Fill the job form</a>'}</p>` });
    BB.attachMics($('#app'));
    let phone = ''; let timer;
    const pretty = (p) => `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
    const wait = (sec) => { clearInterval(timer); const a = $('[data-resend]'); a.classList.add('disabled'); const w = $('[data-wait]');
      const tick = () => { w.textContent = sec > 0 ? `in ${sec} s` : ''; if (sec-- <= 0) { clearInterval(timer); a.classList.remove('disabled'); } }; tick(); timer = setInterval(tick, 1000); };
    const send = async (btn, f) => {
      if (btn.disabled || btn.classList.contains('disabled')) return; btn.disabled = true; const label = btn.textContent; if (btn.tagName === 'BUTTON') btn.textContent = 'Sending…';
      try {
        const r = await BB.post('/api/otp/request', { phone, kind }, { kind: null });
        try { localStorage.setItem('bbhs.lastPhone', phone); } catch { /* private window */ }
        $('[data-step1]').classList.add('hidden'); $('[data-step2]').classList.remove('hidden');
        $('[data-sent]').textContent = `Code sent on WhatsApp to ${pretty(phone)}. It is valid for 10 minutes.`;
        $('[data-dev]').innerHTML = r.dev_code ? `<div class="test-code">Test mode (WhatsApp not connected): your code is <b class="mono">${r.dev_code}</b></div>` : '';
        const c = $('[name=code]'); c.value = ''; c.focus(); wait(30);
      } catch (er) { BB.showErr(f, er); } finally { btn.disabled = false; if (btn.tagName === 'BUTTON') btn.textContent = label; }
    };
    $('[data-step1]').onsubmit = (e) => { e.preventDefault(); const f = e.target; phone = BB.spokenToDigits(BB.formValues(f).phone) || BB.formValues(f).phone.replace(/D/g, '').slice(-10); send($('button[type=submit], button:not([type=button])', f), f); };
    $('[data-resend]').onclick = (e) => { e.preventDefault(); send(e.currentTarget, $('[data-step2]')); };
    let busy = false;
    const verify = async () => {
      const f = $('[data-step2]'); if (busy) return; busy = true;
      try { const r = await BB.post('/api/otp/verify', { phone, kind, code: BB.formValues(f).code }, { kind: null }); clearInterval(timer); BB.setToken(kind, r.token); after(); } catch (er) { BB.showErr(f, er); } finally { busy = false; }
    };
    // The 6th digit logs in; no extra tap (phones fill the code from the WhatsApp message).
    $('[name=code]').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/D/g, '').slice(0, 6); if (e.target.value.length === 6) verify(); });
    $('[data-step2]').onsubmit = (e) => { e.preventDefault(); verify(); };
    $('[data-again]').onclick = (e) => { e.preventDefault(); BB.otpLogin(kind, title, after); };
  };
  BB.onLogout = (kind, msg) => { if (BB.portal === kind) { if (msg) BB.toast(msg, true); BB.route(); } };

  let D = null; let tab = 'home';
  BB.views.client = async (r) => {
    if (r.sub[0]) tab = r.sub[0];
    if (!BB.token('client')) return BB.otpLogin('client', 'Client account', () => BB.route());
    try { D = await BB.api('/api/client/me'); } catch (e) { return; }
    render();
  };
  const reload = async () => { D = await BB.api('/api/client/me'); render(); };
  // Coming back to the browser tab fetches the latest too (unless a dialog is open).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && BB.portal === 'client' && D && BB.token('client') && !document.querySelector('.modal')) reload().catch(() => {}); });
  const act = async (fn, ok) => { try { await fn(); ok && BB.toast(ok); await reload(); } catch (e) { BB.fail(e); } };

  function render() {
    const c = D.client; const p = D.perms;
    const tabs = [['home', 'Home'], ['jobs', 'Job openings'], ...(p.candidates ? [['candidates', 'Candidates', D.counts.to_review]] : []), ['interviews', 'Interviews'], ...(p.bills ? [['bills', 'Bills']] : []), ['company', 'Company & papers']];
    $('#app').innerHTML = `<div class="pub">${BB.publicTop('Client account')}
      <div class="acct-band"><div class="in"><div class="grow"><span class="eyebrow">Client account</span><h1 style="margin-top:8px">${esc(c.company)}</h1><div class="meta"><span class="mono">${esc(c.id)}</span> · ${esc(c.city || '')}${D.member ? ` · logged in as ${esc(D.member.name)} (${esc(D.member.role)})` : ''}</div></div>
        <div class="row"><button class="btn gold" data-raise>${BB.icon('plus', 'wa-ico')} Raise a job opening</button><button class="btn" data-out>Log out</button></div></div></div>
      <div class="acct">
        <div class="tabs">${tabs.map(([k, l, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}${n ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>
        <div data-body></div></div></div>`;
    // Every tab shows the latest: what the team did a minute ago (an interview, a profile) is there.
    $$('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', `#my-account/${tab}`); reload().catch(() => render()); }));
    $('[data-out]').onclick = async () => { await BB.post('/api/account/logout', {}).catch(() => {}); BB.setToken('client', null); BB.route(); };
    $('[data-raise]').onclick = raiseJob;
    const body = $('[data-body]');
    ({ home, jobs, candidates, interviews, bills, company }[tab] || home)(body);
    BB.attachMics(body);
  }

  function home(el) {
    const k = D.counts;
    el.innerHTML = `<div class="stack-lg">
      ${k.to_review ? `<div class="banner"><div class="ic">★</div><div class="grow"><b>${k.to_review} candidate${k.to_review > 1 ? 's are' : ' is'} waiting for you</b><div class="small muted">Review the profiles and choose who to interview.</div></div><button class="btn gold" data-go="candidates">Review now</button></div>` : ''}
      <div class="grid g4">${[['Open job openings', k.open_jobs, 'jobs'], ['Candidates to review', k.to_review, 'candidates'], ['Upcoming interviews', k.upcoming, 'interviews'], ['Bills due', k.bills_due, 'bills']].map(([l, v, t]) => `<div class="card stat click" data-go="${t}"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Getting set up</h3></div><div class="card-b checklist">${D.checklist.map((x) => `<div class="it"><span class="check ${x.done ? 'done' : ''}">✓</span><span class="grow">${esc(x.label)}</span><span class="faint small">${x.done && x.date ? fmtD(x.date) : ''}</span></div>`).join('')}
          ${!D.checklist.find((x) => x.key === 'kyc').done || !D.checklist.find((x) => x.key === 'contract').done ? '<button class="btn sm" data-go="company" style="margin-top:8px">Upload KYC / sign contract</button>' : ''}</div></div>
        <div class="card"><div class="card-h"><h3>Latest job openings</h3><button class="btn sm right" data-go="jobs">See all</button></div><div class="card-b stack-sm">${D.jobs.slice(0, 5).map((j) => `<div class="row between"><div><b>${esc(j.title)}</b> <span class="mono faint">${j.id}</span></div>${statusBadge(j.status)}</div>`).join('') || '<div class="muted">No job openings yet. <a href="#" data-raise2>Raise your first one</a>.</div>'}</div></div>
      </div></div>`;
    $$('[data-go]', el).forEach((b) => (b.onclick = () => { tab = b.dataset.go; render(); }));
    const r2 = $('[data-raise2]', el); if (r2) r2.onclick = (e) => { e.preventDefault(); raiseJob(); };
  }

  function jobs(el) {
    el.innerHTML = `<div class="stack">${D.jobs.map((j) => `<div class="card pad stack-sm">
      <div class="row between"><div><h3 style="font-size:16px">${esc(j.title)} <span class="mono faint small">${j.id}</span></h3><div class="small muted">${esc(j.city)} · ${j.openings} opening${j.openings > 1 ? 's' : ''}${j.sal_from || j.sal_to ? ` · ${esc(BB.inr((j.sal_from || j.sal_to) / 12))}–${esc(BB.inr((j.sal_to || j.sal_from) / 12))} a month` : ''}</div></div><div class="row">${statusBadge(j.status)}${j.reopened ? `<span class="badge b-gold">${esc(j.reopened)}</span>` : ''}</div></div>
      <div class="small muted">${esc(j.reason)}</div>
      <div class="row small"><span>Filled ${j.filled} of ${j.openings}</span><div class="bar grow" style="max-width:240px"><i style="width:${Math.min(100, (j.filled / j.openings) * 100)}%"></i></div></div>
      <div class="seats">${(j.seats || []).map((s) => s.app_id ? `<span class="seat on" title="${esc(s.app_id)}">Seat ${s.n}: <b>${esc(s.candidate || '')}</b> · ${esc(s.state)}${s.joining_date ? ` ${fmtD(s.joining_date)}` : ''}</span>` : `<span class="seat">Seat ${s.n}: open</span>`).join('')}</div>
      <div class="row small">${[['Being screened', j.counts.screening], ['Waiting for you', j.counts.waiting], ['Your interviews', j.counts.interviews], ['Offers', j.counts.offers]].map(([l, n]) => `<span class="badge ${n ? 'b-primary' : 'b-outline'}">${l}: ${n}</span>`).join('')}</div>
      ${j.jd_status === 'Waiting for client' ? `<div class="notice gold"><b>Job description waiting for your approval</b><div class="small" style="white-space:pre-wrap;margin:6px 0">${esc([j.jd.summary, j.jd.duties && 'Duties: ' + j.jd.duties, j.jd.must && 'Must have: ' + j.jd.must, j.jd.timings && 'Timings: ' + j.jd.timings, j.jd.benefits && 'Benefits: ' + j.jd.benefits].filter(Boolean).join('\n'))}</div><div class="row"><button class="btn primary sm" data-jd-ok="${j.id}">Approve</button><button class="btn sm" data-jd-chg="${j.id}">Ask for changes</button></div></div>` : ''}
      <div class="row">${['Filled', 'Closed'].includes(j.status) ? `<button class="btn sm" data-again="${j.id}">I need this role again</button>` : j.status === 'On hold' ? `<button class="btn sm" data-resume="${j.id}">Resume hiring</button>` : `<button class="btn sm" data-hold="${j.id}">Pause hiring</button><button class="btn sm" data-addseat="${j.id}">+ Add a seat</button>`}</div>
    </div>`).join('') || '<div class="card empty">No job openings yet.</div>'}</div>`;
    $$('[data-hold]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Pause hiring', fields: [{ name: 'reason', label: 'Why are you pausing?', opt: true }], ok: 'Pause', submit: (v) => BB.post(`/api/client/jobs/${b.dataset.hold}/hold`, v) }).then((x) => x && reload())));
    $$('[data-resume]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/client/jobs/${b.dataset.resume}/resume`), 'Hiring resumed')));
    $$('[data-addseat]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'More people for this job', note: 'Same job and job ID, with more seats. Candidates already in process stay as they are.', fields: [{ name: 'add', label: 'How many more people?', type: 'number', value: 1 }], ok: 'Add seats', submit: (v) => BB.post(`/api/client/jobs/${b.dataset.addseat}/add-seat`, v) }).then((x) => x && (BB.toast('Seats added'), reload()))));
    $$('[data-again]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'I need this role again', fields: [{ name: 'add', label: 'How many more people?', type: 'number', value: 1 }, { name: 'reason', label: 'Reason', type: 'select', options: BB.boot.reopen_reasons, value: BB.boot.reopen_reasons[0] }], ok: 'Reopen', submit: (v) => BB.post(`/api/client/jobs/${b.dataset.again}/reopen`, v) }).then((x) => x && reload())));
    $$('[data-jd-ok]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/client/jobs/${b.dataset.jdOk}/approve-jd`), 'Approved — the job is now open')));
    $$('[data-jd-chg]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Ask for changes', fields: [{ name: 'note', label: 'What should change?', type: 'textarea' }], ok: 'Send', submit: (v) => BB.post(`/api/client/jobs/${b.dataset.jdChg}/jd-changes`, v) }).then((x) => x && reload())));
  }

  // One row per position: each becomes its own job opening (own job ID) with its own number of people.
  // Two people for the same position = one row with 2, not two rows.
  function raiseJob() {
    const row = (i) => `<div class="card pad stack-sm raise-row" data-row="${i}"><div class="row between"><b>Position ${i + 1}</b>${i ? '<button type="button" class="btn sm ghost" data-rmrow>Remove</button>' : ''}</div>
      <div class="grid g2"><label class="field"><span class="lab">Job</span><select name="title_${i}">${BB.jobOptions('', true, D.client.industry)}</select></label>${field({ name: `openings_${i}`, label: 'How many people?', type: 'number', value: 1, voice: false })}</div>
      <div class="hidden" data-other>${field({ name: `other_${i}`, label: 'Type the job' })}</div>
      <div class="grid g2">${field({ name: `sal_from_${i}`, label: 'Salary from (per month)', type: 'number', voice: false })}${field({ name: `sal_to_${i}`, label: 'Salary to (per month)', type: 'number', voice: false })}</div>
      <div class="grid g2">${field({ name: `exp_from_${i}`, label: 'Experience from (years)', type: 'number', opt: true, voice: false })}${field({ name: `exp_to_${i}`, label: 'Experience to (years)', type: 'number', opt: true, voice: false })}</div></div>`;
    let rows = 1;
    BB.ask({ title: 'Raise job openings', wide: true, ok: 'Raise job openings', note: 'Add one row per position. For 2 people in the same position, put 2 in "How many people" — it stays one job opening.', fields: [
      `<div class="stack" data-rows>${row(0)}</div><button type="button" class="btn sm" data-addrow>+ Add another position</button>`,
      `<div class="grid g2">${field({ name: 'city', label: 'City', list: 'cities', value: D.client.city })}${field({ name: 'notice_days', label: 'Should join within (days)', type: 'number', opt: true, voice: false })}</div>`,
      { name: 'notes', label: 'Anything else we should know', type: 'textarea', opt: true },
    ], submit: async (v) => {
      const list = [];
      for (const r of $$('[data-row]', document.querySelector('.modal'))) {
        const i = r.dataset.row; const title = v[`title_${i}`];
        if (!title) { const e = new Error('Pick the job'); e.field = `title_${i}`; throw e; }
        if (title === 'Other' && !v[`other_${i}`]) { const e = new Error('Type the job'); e.field = `other_${i}`; throw e; }
        list.push({ title, title_other: v[`other_${i}`], openings: Number(v[`openings_${i}`]) || 1, sal_from: v[`sal_from_${i}`], sal_to: v[`sal_to_${i}`], exp_from: v[`exp_from_${i}`], exp_to: v[`exp_to_${i}`], city: v.city, notice_days: v.notice_days, notes: v.notes, salary_per: 'month' });
      }
      const made = []; for (const j of list) made.push(await BB.post('/api/client/jobs', j));
      return made;
    } }).then((made) => { if (made) { BB.toast(`${made.length === 1 ? 'Job opening' : made.length + ' job openings'} raised: ${made.map((x) => x.id).join(', ')}. We will write the job description${made.length === 1 ? '' : 's'} for you to approve.`); tab = 'jobs'; reload(); } });
    // Rows are added and removed inside the open dialog.
    setTimeout(() => {
      const m = document.querySelector('.modal'); if (!m) return; const box = $('[data-rows]', m);
      const wireRow = (r) => { const sel = $('select', r); sel.onchange = () => $('[data-other]', r).classList.toggle('hidden', sel.value !== 'Other'); const rm = $('[data-rmrow]', r); if (rm) rm.onclick = () => r.remove(); };
      wireRow($('[data-row]', box));
      $('[data-addrow]', m).onclick = () => { box.insertAdjacentHTML('beforeend', row(rows)); const r = box.lastElementChild; rows++; wireRow(r); BB.attachMics(r); $('select', r).focus(); };
    }, 30);
  }

  function candidates(el) {
    const list = D.candidates;
    el.innerHTML = list.length ? `<div class="stack">${list.map((a) => `<div class="card pad stack-sm">
      <div class="row between"><div><h3 style="font-size:16px">${esc(a.name)} ${scoreBadge(a.score)}</h3><div class="small muted">for <b>${esc(a.job_title)}</b> <span class="mono">${a.job_id}</span> · ${esc(a.city || '')}</div></div><div>${a.result !== 'open' && a.result !== 'Hired' ? BB.resultBadge(a.result) : `<span class="badge b-primary">${esc(a.step)}</span>`}</div></div>
      <div class="grid g4 small"><div><div class="muted">Experience</div><b>${a.exp_total ?? '—'} yrs</b>${a.exp_jewellery ? ` <span class="faint">(${a.exp_jewellery} in jewellery)</span>` : ''}</div><div><div class="muted">Current salary</div><b>${a.cur_salary ? inr(a.cur_salary / 12) + '/mo' : '—'}</b></div><div><div class="muted">Expected</div><b>${a.exp_salary ? inr(a.exp_salary / 12) + '/mo' : '—'}</b></div><div><div class="muted">Notice</div><b>${a.notice_days ?? '—'} days</b></div></div>
      <div class="row small">${a.skills.map((s) => `<span class="badge ${s.match ? 'b-green' : 'b-outline'}">${s.match ? '✓ ' : ''}${esc(s.s)}</span>`).join('') || '<span class="faint">No skills listed</span>'}</div>
      ${a.reasons.length ? `<div class="small muted">Why it matches: ${a.reasons.map(esc).join(' · ')}</div>` : ''}
      ${a.our_notes.length ? `<div class="notice small"><b>Our interview notes</b>${a.our_notes.map((n) => `<div>${n.rating ? '★'.repeat(n.rating) + ' ' : ''}${esc(n.remark || '')}</div>${(n.qa || []).map((q) => `<div class="faint">Q: ${esc(q.q)} — ${esc(q.a)}</div>`).join('')}`).join('')}</div>` : ''}
      ${a.short_cv ? `<div class="row small"><button class="btn sm" data-file="${a.short_cv}">Short CV</button><span class="faint">Contact details stay with our team, who arrange everything.</span></div>` : ''}
      ${a.result === 'open' && ['Sent to client', 'Client interview'].includes(a.step) ? (a.availability ? `<div class="notice small"><b>✓ Availability shared</b> · ${fmtD(a.availability.at)}<div>${esc(a.availability.text.replace(/^Interview availability from [^:]*: /, ''))}</div><a href="#" data-avail="${a.id}" data-name="${esc(a.name)}">Change times</a></div>` : `<div class="row"><button class="btn primary" data-avail="${a.id}" data-name="${esc(a.name)}">Share interview availability</button><span class="small muted">Our team fixes the interview with the candidate.</span></div>`) : ''}
      ${a.step === 'Offer made' || a.step === 'Offer accepted' || a.result === 'Hired' ? offerBox(a) : ''}
    </div>`).join('')}</div>` : '<div class="card empty">No profiles yet. When our team sends you profiles, they show here and on WhatsApp.</div>';
    $$('[data-file]', el).forEach((b) => (b.onclick = () => BB.openFile(b.dataset.file)));
    // Each option is a window on one day: date, from, to (e.g. 25 Oct, 11:00 am – 1:00 pm).
    $$('[data-avail]', el).forEach((b) => (b.onclick = (e) => { e.preventDefault(); BB.ask({ title: `When can you meet ${b.dataset.name}?`, wide: true,
      note: 'Give one to three time windows that suit you. Our recruiter confirms one with the candidate and lets you know.',
      fields: [...[1, 2, 3].map((k) => `<div class="avail-opt"><b class="small">Option ${k}${k > 1 ? ' <span class="opt">(optional)</span>' : ''}</b><div class="grid g3">${field({ name: `d${k}`, label: 'Date', type: 'date', voice: false, attrs: `min="${new Date().toISOString().slice(0, 10)}"` })}${field({ name: `f${k}`, label: 'From', type: 'time', voice: false })}${field({ name: `t${k}`, label: 'To', type: 'time', voice: false })}</div></div>`),
        { name: 'place', label: 'Place', value: D.client.city }, { name: 'interviewer', label: 'Who will meet them', value: D.member ? D.member.name : D.client.contact, opt: true }, { name: 'note', label: 'Anything else', type: 'textarea', opt: true }],
      ok: 'Share availability',
      submit: (v) => {
        const slots = [];
        for (const k of [1, 2, 3]) {
          const d = v[`d${k}`], f = v[`f${k}`], t = v[`t${k}`];
          if (!d && !f && !t) { if (k === 1) { const er = new Error('Give at least one date and time'); er.field = 'd1'; throw er; } continue; }
          if (!d) { const er = new Error('Pick the date'); er.field = `d${k}`; throw er; }
          if (!f) { const er = new Error('Pick the start time'); er.field = `f${k}`; throw er; }
          if (!t) { const er = new Error('Pick the end time'); er.field = `t${k}`; throw er; }
          if (t <= f) { const er = new Error('The end time must be after the start time'); er.field = `t${k}`; throw er; }
          slots.push({ from: new Date(`${d}T${f}`).toISOString(), to: new Date(`${d}T${t}`).toISOString() });
        }
        return BB.post(`/api/client/apps/${b.dataset.avail}/availability`, { slots, place: v.place, interviewer: v.interviewer, note: v.note });
      } }).then((x) => x && (BB.toast('Thank you — our team will confirm the interview time'), reload())); }));
    $$('[data-offer-send]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/client/apps/${b.dataset.offerSend}/offer-letter`, { send: true }), 'Offer letter sent to the candidate')));
    $$('[data-offer-make]', el).forEach((b) => (b.onclick = () => act(() => BB.post(`/api/client/apps/${b.dataset.offerMake}/offer-letter`, {}), 'Offer letter made — check it, then send')));
    $$('[data-ck]', el).forEach((b) => (b.onchange = () => act(() => BB.post(`/api/client/apps/${b.dataset.ck}/checklist`, { item: b.dataset.item, done: b.checked }))));
  }
  function offerBox(a) {
    const items = (D.standard_templates.joining_checklist || '').split('\n').filter(Boolean);
    return `<div class="notice gold small stack-sm"><div><b>Offer:</b> ${inr(a.offer_ctc)} a year · joining ${fmtD(a.joining_date)}</div>
      <div class="row">${a.offer_letter ? `<button class="btn sm" data-file="${a.offer_letter}">View offer letter</button>${a.offer_sent ? '<span class="badge b-green">Sent to candidate</span>' : `<button class="btn primary sm" data-offer-send="${a.id}">Send to candidate</button>`}` : `<button class="btn sm" data-offer-make="${a.id}">Make offer letter</button>`}</div>
      ${a.step === 'Offer accepted' || a.result === 'Hired' ? `<div><b>Joining checklist</b>${items.map((it) => `<label class="row"><input type="checkbox" data-ck="${a.id}" data-item="${esc(it)}" ${a.checklist && a.checklist[it] ? 'checked' : ''}> ${esc(it)}</label>`).join('')}${(a.joining_docs || []).length ? `<div class="row" style="margin-top:4px">${a.joining_docs.map((d) => `<button class="btn sm" data-file="${d.file}">${esc(d.label)}</button>`).join('')}</div>` : ''}</div>` : ''}</div>`;
  }

  function interviews(el) {
    const now = new Date().toISOString();
    el.innerHTML = `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Candidate</th><th>Job</th><th>Place</th><th>Status</th><th></th></tr></thead><tbody>${D.interviews.map((i) => `<tr>
      <td>${fmtDT(i.at)}</td><td><b>${esc(i.candidate)}</b></td><td>${esc(i.job)}</td><td>${esc(i.place)}</td><td>${i.view_status === 'Result pending' ? '<span class="badge b-amber">Waiting for your feedback</span>' : `<span class="badge b-outline">${esc(i.view_status)}</span>`}${i.result ? ` <span class="badge b-primary">${esc(i.result)}</span>` : ''}</td>
      <td>${i.status !== 'Completed' && i.status !== 'Cancelled' && D.perms.feedback ? `<button class="btn sm primary" data-fb="${i.id}">Give feedback</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No interviews yet.</td></tr>'}</tbody></table></div></div>`;
    $$('[data-fb]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Interview feedback', fields: [{ name: 'result', label: 'Result', type: 'choice', options: ['Selected', 'Another round', 'Not selected'] }, { name: 'remark', label: 'One line about the candidate', type: 'textarea' }], ok: 'Save feedback', submit: (v) => { if (!v.result) { const e = new Error('Pick a result'); e.field = 'result'; throw e; } return BB.post(`/api/client/interviews/${b.dataset.fb}/feedback`, v); } }).then((x) => x && (BB.toast('Thank you — our recruiter has been told'), reload()))));
  }

  function bills(el) {
    el.innerHTML = `<div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bill no.</th><th>Candidate</th><th>Joined</th><th class="num">CTC</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>${D.bills.map((b) => `<tr>
      <td class="mono">${esc(b.bill_no)}${b.is_replacement ? ' <span class="badge b-gold">Replacement</span>' : ''}</td><td>${esc(b.candidate)}<div class="small muted">${esc(b.job)}</div></td><td>${fmtD(b.joining_date)}</td><td class="num">${inr(b.ctc)}</td><td class="num"><b>${inr(b.total)}</b><div class="tiny muted">fee ${inr(b.fee)} + GST ${inr(b.gst)}</div></td>
      <td><span class="badge ${b.view_status === 'Paid' ? 'b-green' : b.view_status === 'Overdue' ? 'b-red' : 'b-amber'}">${esc(b.view_status)}</span>${b.balance && b.view_status !== 'Paid' ? `<div class="tiny muted">due ${fmtD(b.due_date)}</div>` : ''}</td>
      <td><div class="row">${b.balance > 0 ? `<a class="btn sm wa" href="${esc(b.upi)}">Pay by UPI</a>` : ''}<button class="btn sm" data-pdf="${b.id}">PDF</button>${b.can_replace ? `<button class="btn sm" data-rep="${b.id}">Ask for free replacement</button>` : b.replacement_requested ? '<span class="badge b-amber">Replacement asked</span>' : ''}</div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No bills yet. A bill is made when a candidate joins.</td></tr>'}</tbody></table></div></div>
      `;
    $$('[data-pdf]', el).forEach((b) => (b.onclick = () => BB.download(`/api/client/bills/${b.dataset.pdf}/pdf`, true)));
    $$('[data-rep]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Ask for a free replacement', fields: [{ name: 'date', label: 'Last working day', type: 'date' }, { name: 'reason', label: 'What happened?', type: 'textarea' }], ok: 'Send request', submit: (v) => BB.post(`/api/client/bills/${b.dataset.rep}/replacement`, v) }).then((x) => x && (BB.toast('Request sent — our team will check and reopen the job'), reload()))));
  }

  function company(el) {
    const c = D.client; const k = c.kyc || {}; const contract = c.contract ? JSON.parse(c.contract) : null; const t = c.templates; const ex = c.extra || {};
    el.innerHTML = `<div class="grid g2">
      <div class="card"><div class="card-h"><h3>Company details</h3></div><form class="card-b stack" data-co>
        ${field({ name: 'company', label: 'Company name', value: c.company })}${field({ name: 'contact', label: 'Main contact', value: c.contact })}
        <div class="grid g2">${field({ name: 'city', label: 'City', value: c.city, list: 'cities' })}${field({ name: 'business_type', label: 'Business', type: 'select', options: ['Showroom B2C', 'Manufacturer B2B', 'Both'], value: c.business_type })}</div>
        ${field({ name: 'email', label: 'Email', value: c.email, type: 'email' })}${field({ name: 'gstin', label: 'GSTIN (for invoices)', value: k.gstin || '' })}
        <div class="grid g2">${field({ name: 'branches', label: 'Branches', value: ex.branches || '' })}${field({ name: 'website', label: 'Website', value: ex.website || '' })}</div>
        <button class="btn primary">Save</button></form></div>
      <div class="stack">
        <div class="card"><div class="card-h"><h3>KYC</h3></div><div class="card-b checklist">${[['gst', 'GST certificate'], ['pan', 'Business PAN'], ['owner_id', 'Owner ID proof']].map(([key, l]) => `<div class="it"><span class="check ${k[key] ? 'done' : ''}">✓</span><span class="grow">${l}</span><button class="btn sm" data-kyc="${key}">${k[key] ? 'Replace' : 'Upload'}</button></div>`).join('')}</div></div>
        <div class="card"><div class="card-h"><h3>Contract</h3></div><div class="card-b">${contract ? `<div class="row"><span class="check done">✓</span> Signed by <b>${esc(contract.name || contract.by)}</b> on ${fmtD(contract.at)} <span class="faint small">(${esc(contract.method)})</span></div>` : `
          <form class="stack-sm" data-sign>${field({ name: 'name', label: 'Type your full name to sign' })}<label class="row small"><input type="checkbox" name="agree"> I agree to the BrillBrains hiring terms on behalf of ${esc(c.company)}</label><div class="row"><button class="btn primary">Sign contract</button><button type="button" class="btn" data-signed>Upload signed copy</button></div></form>`}</div></div>
      </div></div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>Paper templates</h3><span class="small muted">Included in the fee. Blanks: {candidate} {job} {ctc} {joining_date} {reporting_to} {company} {city} {date}</span></div><form class="card-b stack" data-tpl>
        ${field({ name: 'offer_letter', label: 'Offer letter', type: 'textarea', value: t.offer_letter, attrs: 'rows="8"' })}
        <div class="grid g2">${field({ name: 'joining_form', label: 'Joining form', type: 'textarea', value: t.joining_form, attrs: 'rows="7"' })}${field({ name: 'joining_checklist', label: 'Joining checklist (one item per line)', type: 'textarea', value: t.joining_checklist, attrs: 'rows="7"' })}</div>
        <div class="row"><button class="btn primary">Save templates</button><button type="button" class="btn" data-std>Back to standard</button></div></form></div>
      ${!D.member ? `<div class="card" style="margin-top:14px"><div class="card-h"><h3>People from your company</h3><button class="btn sm right" data-add-m>+ Add person</button></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>WhatsApp</th><th>Role</th><th>See candidates</th><th>Give feedback</th><th>Approve JD & offers</th><th>See bills</th><th></th></tr></thead><tbody>${D.members.map((m) => `<tr><td>${esc(m.name)}</td><td class="mono">${esc(m.whatsapp)}</td><td>${esc(m.role)}</td>${['candidates', 'feedback', 'approve', 'bills'].map((p) => `<td><input type="checkbox" data-perm="${m.id}" data-p="${p}" ${m.perms[p] ? 'checked' : ''}></td>`).join('')}<td><button class="btn sm danger" data-rm="${m.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Only you have access. Add your team here.</td></tr>'}</tbody></table></div></div>` : ''}
      <div class="card pad" style="margin-top:14px"><h3>Monthly summaries</h3><div class="row" style="margin-top:8px">${D.files.filter((f) => f.type.startsWith('monthly_summary')).sort((a, b) => (a.name < b.name ? 1 : -1)).map((f) => `<button class="btn sm" data-file="${f.id}">${esc(f.name.replace(/^Summary-|\.pdf$/g, ''))}</button>`).join('') || '<span class="muted small">Your first summary comes on the 1st of next month.</span>'}</div></div>`;
    $('[data-co]', el).onsubmit = (e) => { e.preventDefault(); const v = BB.formValues(e.target); act(() => BB.put('/api/client/company', { ...v, extra: { branches: v.branches, website: v.website } }), 'Saved'); };
    $$('[data-kyc]', el).forEach((b) => (b.onclick = async () => { const f = await BB.pickFile(); if (f) act(() => BB.post('/api/client/files', { type: b.dataset.kyc, ...f }), 'Uploaded'); }));
    const sign = $('[data-sign]', el); if (sign) sign.onsubmit = (e) => { e.preventDefault(); act(() => BB.post('/api/client/contract/sign', BB.formValues(e.target)), 'Contract signed'); };
    const sd = $('[data-signed]', el); if (sd) sd.onclick = async () => { const f = await BB.pickFile(); if (f) act(() => BB.post('/api/client/files', { type: 'contract_signed', ...f }), 'Signed copy uploaded'); };
    $('[data-tpl]', el).onsubmit = (e) => { e.preventDefault(); act(() => BB.put('/api/client/templates', BB.formValues(e.target)), 'Templates saved'); };
    $('[data-std]', el).onclick = () => act(() => BB.put('/api/client/templates', D.standard_templates), 'Standard templates restored');
    const am = $('[data-add-m]', el); if (am) am.onclick = () => BB.ask({ title: 'Add a person', fields: [{ name: 'name', label: 'Name' }, { name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true }, { name: 'role', label: 'Role', type: 'select', options: ['HR', 'Store manager', 'Owner', 'Accounts'], value: 'HR' }], ok: 'Add', submit: (v) => BB.post('/api/client/members', { ...v, whatsapp: BB.spokenToDigits(v.whatsapp) || v.whatsapp }) }).then((x) => x && reload());
    $$('[data-perm]', el).forEach((cb) => (cb.onchange = () => { const m = D.members.find((x) => String(x.id) === cb.dataset.perm); const perms = { ...m.perms, [cb.dataset.p]: cb.checked }; act(() => BB.patch(`/api/client/members/${m.id}`, { perms }), 'Saved'); }));
    $$('[data-rm]', el).forEach((b) => (b.onclick = async () => { if (await BB.confirm('Remove person', 'They will no longer be able to log in.', 'Remove')) act(() => BB.patch(`/api/client/members/${b.dataset.rm}`, { remove: true })); }));
    $$('[data-file]', el).forEach((b) => (b.onclick = () => BB.openFile(b.dataset.file)));
  }
})();
