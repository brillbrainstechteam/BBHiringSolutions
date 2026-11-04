/* Offer page: offers, after joining (check-ins for 90 days and replacements), recruiter reviews for the super admin, and the language
   tools: translate a message before sending, read a reply in English, write out a call recording. */
(() => {
  const { $, $$, esc, fmtD, fmtDT, field } = BB;
  const P = BB.pages;
  const C = BB.care = {};
  const done = (msg) => { if (msg) BB.toast(msg); if (BB.refreshPanel) BB.refreshPanel(); if (BB.refreshPage) BB.refreshPage(); };
  const act = async (fn, msg) => { try { const r = await fn(); done(typeof msg === 'function' ? msg(r) : msg); return r; } catch (e) { BB.fail(e); return null; } };
  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: f.name, type: f.type, base64: String(r.result).split(',')[1] }); r.onerror = rej; r.readAsDataURL(f); });
  const pick = (accept) => new Promise((resolve) => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => resolve(i.files[0] || null); i.click(); });

  // ---------- check-ins after joining ----------
  const CLS = { 'Doing well': 'b-green', 'Some concerns': 'b-amber', 'Has left': 'b-red', 'No answer': 'b-outline', 'Waiting for answer': 'b-primary', 'To do': 'b-amber', Missed: 'b-red', Upcoming: 'b-outline faint' };
  const party = (p) => (p === 'client' ? 'Client' : 'Candidate');
  const dots = (sch) => `<span class="care-dots">${sch.map((x) => { const st = x.parties.map((p) => p.status); const cls = st.some((s) => ['Some concerns', 'Has left', 'Missed'].includes(s)) ? 'bad' : st.length && st.every((s) => ['Doing well', 'No answer'].includes(s)) ? 'ok' : st.some((s) => ['To do', 'Waiting for answer'].includes(s)) ? 'due' : ''; return `<span class="care-dot ${cls}" title="Day ${x.day}: ${esc(x.parties.map((p) => `${party(p.party)} ${p.status}`).join(', '))}">${x.day}</span>`; }).join('')}</span>`;
  C.logCheckin = (appId, care, preset = {}) => BB.ask({ title: 'Log a check-in', note: 'Who you spoke to and how it is going. Concerns mark the placement at risk; "Has left" reminds you to mark Left the job.', fields: [
    `<div class="grid g2">${field({ name: 'party', label: 'Spoke to', type: 'select', options: Object.entries(care.parties || { candidate: 'Candidate', client: 'Client' }), value: preset.party || 'candidate', placeholder: false })}${field({ name: 'outcome', label: 'How it is going', type: 'select', options: care.outcomes || ['Doing well', 'Some concerns', 'Has left', 'No answer'], value: preset.outcome || 'Doing well', placeholder: false })}</div>`,
    { name: 'note', label: 'Notes', type: 'textarea', opt: true }], ok: 'Save check-in', submit: (v) => BB.post(`/api/applications/${appId}/checkin`, v) }).then((x) => x && done('Check-in saved'));
  // On the application: the check-in plan with each answer, and one button to log the next.
  C.appBlock = (a) => {
    const c = a.care; if (!c) return '';
    return `<div class="sec card pad stack-sm" data-careblock><div class="row between"><h3 style="margin:0">After joining</h3>${!a.left_date ? '<button class="btn sm primary" data-carelog>Log check-in</button>' : ''}</div>
      <div class="small muted">Day ${c.since} since joining${!a.left_date ? ` · free replacement window ${c.window} days${c.since <= c.window ? ` (${c.window - c.since} left)` : ' (over)'}` : ''}${a.at_risk ? ' · <span class="badge b-amber">At risk</span>' : ''}</div>
      <div class="care-plan">${c.schedule.map((x) => `<div class="care-step"><div class="care-day"><b>Day ${x.day}</b><span class="tiny muted">${fmtD(x.date)}</span></div><div class="grow">${x.parties.map((p) => `<div class="row" style="gap:6px"><span class="small">${party(p.party)}</span><span class="badge ${CLS[p.status] || 'b-outline'}">${esc(p.status)}</span>${p.note ? `<span class="tiny muted">${esc(p.note)}</span>` : ''}${p.by ? `<span class="tiny faint">${esc(p.by)}</span>` : ''}</div>`).join('')}</div></div>`).join('')}</div>
      ${c.extra.length ? `<div class="tiny muted">Other check-ins: ${c.extra.map((x) => `day ${x.day} ${party(x.party).toLowerCase()} ${esc(x.outcome)}`).join(' · ')}</div>` : ''}</div>`;
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-carelog]'); if (!b) return;
    const a = BB.care.current; if (a) C.logCheckin(a.id, a.care);
  });

  P.aftercare = async ({ el, q, actions }) => {
    // Offers: every offer made and what came of it (joined, or not joined and why). First 90 days: everyone who
    // joined lately, retained or left within 90 days. Replacements: for those who left.
    const tab = ['active', 'replacements'].includes(q.tab) ? q.tab : 'offers';
    const d = await BB.api(`/api/aftercare?${BB.qs({ q: q.q })}`); const n = d.counts;
    const tabs = `<div class="tabs"><button data-ctab="offers" class="${tab === 'offers' ? 'on' : ''}">Offers <span class="n">${n.offered}</span></button><button data-ctab="active" class="${tab === 'active' ? 'on' : ''}">First 90 days <span class="n">${d.active.length}</span></button><button data-ctab="replacements" class="${tab === 'replacements' ? 'on' : ''}">Replacements <span class="n">${n.to_find + n.in_progress}</span></button></div>`;
    const tiles = `<div class="grid camp-tiles">${[['Offers waiting', n.waiting, 'offers', 'Waiting'], ['Joined', n.joined, 'offers', 'Joined'], ['Not joined', n.not_joined, 'offers', 'Not joined'], ['Left within 90 days', n.left90, 'active', 'Left']].map(([l, v, t, k]) => `<button type="button" class="card stat fin-tile" data-tile="${t}:${k}"><div class="l">${l}</div><div class="v">${v}</div></button>`).join('')}</div>`;
    const money = (v) => (v ? `₹${Number(v).toLocaleString('en-IN')}` : '<span class="faint">—</span>');
    const inv = (x) => (x.invoice ? `<a href="#" class="nw" data-open="bill:${x.invoice.id}">${esc(x.invoice.no || 'To raise')}</a><div class="tiny muted nw">${esc(x.invoice.status)} · ${money(x.invoice.total)}</div>` : '<span class="faint">Not raised</span>');
    const who = (x) => `<a href="#" class="nw" data-open="application:${x.id}"><b>${esc(x.candidate_name)}</b></a><div class="iv-job tiny muted"><div class="ellipsis" title="${esc(x.job_title)} · ${esc(x.client_name)}">${esc(x.job_title)} · ${esc(x.client_name)}</div></div>${x.owner_name ? `<div class="tiny muted nw">Owner: ${esc(x.owner_name)}</div>` : ''}`;
    const chips = (key, list) => `<div class="filters">${list.map(([v, l, c]) => `<span class="chip ${(q[key] || '') === v ? 'on' : ''}" data-chip="${key}:${v}">${l}${c != null ? ` <b>${c}</b>` : ''}</span>`).join('')}</div>`;
    // Offers: joined (and the CTC they joined at), not joined (and why), or still waiting
    const OST = { Joined: 'b-green', 'Not joined': 'b-red', Accepted: 'b-primary', 'Waiting for answer': 'b-amber' };
    const ostCell = (x) => `<span class="badge ${OST[x.status] || 'b-outline'}">${esc(x.status)}</span>${x.status === 'Not joined' ? `<div class="tiny muted" style="max-width:220px">${esc(x.reason)}${x.reason_note ? `: ${esc(x.reason_note)}` : ''}</div>` : x.status === 'Joined' ? `<div class="tiny muted nw">on ${fmtD(x.joined_at)} · ${x.left_date ? 'left later' : `day ${x.since}`}</div>` : x.late ? '<div class="tiny"><span class="badge b-amber tiny">Joining date passed</span></div>' : ''}`;
    const oAct = (x) => `<div class="row nowrap" onclick="event.stopPropagation()">${['Waiting for answer', 'Accepted'].includes(x.status) ? `<button class="btn sm" data-notjoin="${x.id}">Update status</button>` : ''}${x.status === 'Joined' && !x.ctc ? `<button class="btn sm primary" data-ctc="${x.id}">Record CTC</button>` : ''}${x.status === 'Joined' && !x.left_date ? `<button class="btn sm" data-leftjob="${x.id}">Update status</button>` : ''}</div>`;
    const OKEY = { Waiting: ['Waiting for answer', 'Accepted'], Joined: ['Joined'], 'Not joined': ['Not joined'] };
    const offersBody = `${chips('os', [['', 'All', n.offered], ['Waiting', 'Waiting', n.waiting], ['Joined', 'Joined', n.joined], ['Not joined', 'Not joined', n.not_joined]])}<div class="card iv-list">${BB.table([{ t: 'Candidate', f: who }, { t: 'Offered on', f: (x) => (x.offered_at ? `<span class="nw">${fmtD(x.offered_at)}</span>` : '<span class="faint">—</span>') }, { t: 'Status', f: ostCell }, { t: 'Yearly CTC', num: 1, f: (x) => money(x.ctc) }, { t: 'Joining date', f: (x) => (x.joining_date ? `<span class="nw">${fmtD(x.joining_date)}</span>` : '<span class="faint">—</span>') }, { t: '', f: oAct }], d.offered.filter((x) => !q.os || OKEY[q.os].includes(x.status)), { open: (x) => `application:${x.id}`, empty: 'No offers here.' })}</div>`;
    // First 90 days: retained or left
    const S90 = { Left: 'b-red', Retained: 'b-green', 'In 90 days': 'b-primary' };
    const st90 = (x) => `<span class="badge ${S90[x.status90]}">${x.status90 === 'In 90 days' ? 'Retained so far' : esc(x.status90)}</span>${x.retained_at && !x.left_date && x.since < 90 ? '<div class="tiny muted nw">confirmed</div>' : ''}${x.left_date ? `<div class="tiny muted" style="max-width:200px">left ${fmtD(x.left_date)}, day ${x.stay}${x.left_reason ? ` · ${esc(x.left_reason)}` : ''}</div>` : ''}`;
    const activeBody = `${chips('s90', [['', 'All', d.active.length], ['In 90 days', 'In first 90 days', n.in90], ['Retained', 'Retained', n.retained], ['Left', 'Left within 90 days', n.left90]])}<div class="card iv-list">${BB.table([{ t: 'Candidate', f: who }, { t: 'Joined · days', f: (x) => `<span class="nw">${fmtD(x.joining_date || x.joined_at)}</span><div style="margin-top:4px">${x.left_date ? `<span class="badge b-outline tiny nw">Stayed ${x.stay} days</span>` : `<span class="badge ${x.since <= 90 ? 'b-primary' : 'b-green'} tiny nw" title="Days since joining">Day ${x.since}${x.since <= 90 ? ' of 90' : ''}</span>`}</div>` }, { t: '90-day status', f: st90 }, { t: 'Yearly CTC', num: 1, f: (x) => (x.ctc ? money(x.ctc) : `<button class="btn sm" data-ctc="${x.id}" onclick="event.stopPropagation()">Record CTC</button>`) }, { t: 'Invoice', f: inv }, { t: 'Check-ins', f: (x) => (x.left_date || x.since > 90 ? '<span class="faint">—</span>' : `${dots(x.schedule)}${x.todo.length ? `<div class="tiny nw" style="margin-top:4px"><span class="badge b-amber tiny">${x.todo.length} due</span></div>` : ''}`) }, { t: '', f: (x) => (x.left_date ? '' : `<div class="row nowrap iv-acts" onclick="event.stopPropagation()">${x.since > 90 ? '' : `<button class="btn sm" data-clog="${x.id}">Log check-in</button>`}<button class="btn sm" data-leftjob="${x.id}">Update status</button></div>`) }], d.active.filter((x) => !q.s90 || x.status90 === q.s90), { open: (x) => `application:${x.id}`, empty: 'Nobody here.' })}</div>`;
    const body = tab === 'offers' ? offersBody : tab === 'active' ? activeBody : `<div class="card iv-list">${BB.table([{ t: 'Candidate who left', f: who }, { t: 'Joined', f: (x) => fmtD(x.joined_at) }, { t: 'Left', f: (x) => (x.left_date ? `${fmtD(x.left_date)}<div class="tiny muted">after ${x.stay} days${x.left_reason ? ` · ${esc(x.left_reason)}` : ''}</div>` : '<span class="faint">Not yet</span>') }, { t: 'Free replacement', f: (x) => (x.free ? 'Yes' : `No<div class="tiny muted">${esc(x.why)}</div>`) }, { t: 'Status', f: (x) => `<span class="badge ${x.status === 'Replaced' ? 'b-green' : x.status === 'Not covered' ? 'b-outline' : 'b-amber'}">${esc(x.status)}</span>${x.status === 'Client asked' ? `<div class="tiny muted">${esc(x.why)}</div>` : ''}` }, { t: 'Replacement', f: (x) => (x.by ? `<a href="#" data-open="application:${x.by.id}">${esc(x.by.name)}</a><div class="tiny muted">${esc(x.by.result === 'Hired' ? 'Joined' : x.by.step)}</div>` : x.free ? `<a href="#" data-open="job:${x.job_id}">Find on the job</a>` : '—') }], d.replacements, { empty: 'No replacements.' })}</div>`;
    if (actions) { actions.innerHTML = '<button class="btn gold" data-offnew>Record an offer</button>'; $('[data-offnew]', actions).onclick = async () => {
      if (!d.can_offer.length) return BB.toast('Nobody is in an interview round to make an offer to', true);
      const v = await BB.ask({ title: 'Record an offer', fields: [{ name: 'app', label: 'Candidate and job', type: 'select', options: d.can_offer.map((x) => [x.id, x.label]) }], ok: 'Next' });
      if (v && v.app) BB.recordOffer(await BB.api(`/api/applications/${v.app}`));
    }; }
    el.innerHTML = `${tiles}${tabs}<div class="filters exp-filters"><input placeholder="Search candidate, client or job…" value="${esc(q.q || '')}" data-q data-xq></div>${body}`;
    $$('[data-ctab]', el).forEach((b) => (b.onclick = () => BB.setQ({ tab: b.dataset.ctab === 'offers' ? '' : b.dataset.ctab, os: '', s90: '' })));
    $$('[data-tile]', el).forEach((b) => (b.onclick = () => { const [t, k] = b.dataset.tile.split(':'); BB.setQ(t === 'offers' ? { tab: '', os: k, s90: '' } : { tab: t, s90: k, os: '' }); }));
    $$('[data-chip]', el).forEach((c) => (c.onclick = () => { const [k, v] = c.dataset.chip.split(':'); BB.setQ({ [k]: v }); }));
    let t; $('[data-q]', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => BB.setQ({ q: e.target.value }), 350); };
    $$('[data-clog]', el).forEach((b) => (b.onclick = () => C.logCheckin(b.dataset.clog, { outcomes: d.outcomes })));
    // an offer that did not turn into a joining, and why
    $$('[data-notjoin]', el).forEach((b) => (b.onclick = () => { const x = d.offered.find((o) => o.id === b.dataset.notjoin) || {}; BB.ask({ title: `Update status · ${esc(x.candidate_name || '')}`, fields: [{ name: 'status', label: 'Status', type: 'select', options: [['Accepted', 'Accepted the offer'], ['Joined', 'Joined'], ['Did not join', 'Did not join'], ['Offer declined', 'Declined the offer'], ['Candidate withdrew', 'Withdrew']], value: x.status === 'Accepted' ? 'Joined' : 'Accepted', placeholder: false }, `<div class="grid g2">${field({ name: 'date', label: 'Joining date', type: 'date', value: x.joining_date || '', opt: true })}${field({ name: 'ctc', label: 'Yearly CTC (₹)', type: 'number', value: x.ctc || '', opt: true })}</div>`, { name: 'note', label: 'Reason / note', type: 'textarea', opt: true, placeholder: 'Needed if they did not join, declined or withdrew: e.g. counter-offer, family reasons…' }], ok: 'Save', submit: (v) => BB.post(`/api/aftercare/${b.dataset.notjoin}/status`, v) }).then((r) => r && (BB.toast(r.outcome || 'Saved'), BB.refreshPage())); }));
    // someone who joined has left: when and why, and whether the job opens again as a replacement (tagged, searchable)
    $$('[data-leftjob]', el).forEach((b) => (b.onclick = () => { const x = d.active.find((o) => o.id === b.dataset.leftjob) || d.offered.find((o) => o.id === b.dataset.leftjob) || {}; BB.ask({ title: `Update status · ${esc(x.candidate_name || '')}`, note: 'Left, removed or absconded: give the last working day.', fields: [{ name: 'status', label: 'Status', type: 'select', options: [['Retained', 'Retained (still working)'], ['Left on their own', 'Left on their own'], ['Removed by company', 'Removed by the company'], ['Absconded', 'Absconded'], ['Other', 'Other']], value: 'Retained', placeholder: false }, { name: 'date', label: 'Last working day', type: 'date', opt: true }, { name: 'note', label: 'Reason / note', type: 'textarea', opt: true }, { name: 'reopen', label: 'If they left: reopen the job for a replacement (tagged "Replacement" on Job openings)', type: 'check', value: true }], ok: 'Save', submit: (v) => BB.post(`/api/aftercare/${b.dataset.leftjob}/status`, v) }).then((r) => r && (BB.toast(r.outcome || 'Saved'), BB.refreshPage())); }));
    // the exact yearly CTC they joined at
    $$('[data-ctc]', el).forEach((b) => (b.onclick = () => BB.ask({ title: 'Joining CTC', fields: [{ name: 'ctc', label: 'Yearly CTC they joined at (₹)', type: 'number' }], ok: 'Save', submit: (v) => BB.post(`/api/aftercare/${b.dataset.ctc}/ctc`, v) }).then((x) => x && (BB.toast('CTC saved'), BB.refreshPage()))));
  };

  // ---------- recruiter reviews (super admin only) ----------
  const stars = (n) => `<span class="stars" title="${n} of 5">${'★'.repeat(Math.round(n))}<span class="faint">${'★'.repeat(5 - Math.round(n))}</span></span>`;
  P.reviews = async ({ el, q, actions }) => {
    const d = await BB.api(`/api/reviews?${BB.qs({ user: q.user })}`);
    actions.innerHTML = (d.askable || []).length ? '<button class="btn" data-askc>Ask a client to rate</button>' : '';
    el.innerHTML = `<div class="notice small" style="margin-bottom:12px">Only super admins see this page. Candidates rate the recruiters they worked with, in their profile and on WhatsApp 14 days after joining (when that message is switched on). Clients rate them after interviewing our candidates. Only the senior team reads it.</div>
      <div class="card" style="margin-bottom:14px"><div class="card-h"><h3>By recruiter</h3></div>${BB.table([{ t: 'Recruiter', f: (r) => `<a href="#" data-ruser="${r.id}"><b>${esc(r.name)}</b></a><div class="tiny muted">${BB.levelName(r.level)}</div>` }, { t: 'Rating', f: (r) => `${stars(r.avg)} <b>${r.avg}</b>` }, { t: 'Reviews', num: 1, f: (r) => r.count }, { t: '1–2 stars', num: 1, f: (r) => r.low }, { t: 'Went to Google', num: 1, f: (r) => r.google }], d.recruiters, { empty: 'No reviews yet.' })}</div>
      <div class="card"><div class="card-h"><h3>${q.user ? `Reviews of ${esc((d.recruiters.find((r) => r.id === q.user) || {}).name || '')} <a href="#" class="small" data-rall>Show all</a>` : 'All reviews'}</h3></div>${BB.table([{ t: 'Date', f: (r) => fmtD(r.at) }, { t: 'Recruiter', f: (r) => esc(r.user_name) }, { t: 'Candidate', f: (r) => `<a href="#" data-open="candidate:${r.candidate_id}">${esc(r.candidate_name)}</a>` }, { t: 'Stars', f: (r) => stars(r.stars) }, { t: 'Review', f: (r) => esc(r.text || '—') }], d.reviews, { empty: 'No reviews yet.' })}</div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>From clients</h3><span class="small muted">Asked on WhatsApp once a client has interviewed our candidates for a job</span></div>${BB.table([{ t: 'Date', f: (r) => fmtD(r.at) }, { t: 'Recruiter', f: (r) => esc(r.user_name) }, { t: 'Client', f: (r) => `<a href="#" data-open="client:${r.client_id}">${esc(r.company || r.client_id)}</a>${r.by_name ? `<div class="tiny muted">${esc(r.by_name)}</div>` : ''}` }, { t: 'Job', f: (r) => esc(r.job_title || r.job_id) }, { t: 'Stars', f: (r) => stars(r.stars) }, { t: 'Review', f: (r) => esc(r.text || '—') }], d.client_reviews || [], { empty: 'No client reviews yet.' })}</div>`;
    $$('[data-ruser]', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); BB.setQ({ user: a.dataset.ruser }); }));
    // A client asked by hand: the jobs whose client has interviewed our candidates.
    const ak = $('[data-askc]', actions); if (ak) ak.onclick = () => BB.ask({ title: 'Ask a client to rate the recruiter', note: 'The client gets the rating link on WhatsApp (and email). Only you see this message and the answer.', fields: [{ name: 'job_id', label: 'Job', type: 'select', options: d.askable.map((j) => [j.id, `${j.title} · ${j.company}${j.answered ? ' (answered)' : j.asked ? ' (asked)' : ''}`]), placeholder: false }], ok: 'Send', submit: (v) => BB.post('/api/reviews/ask-client', v) }).then((r) => { if (!r) return; if (!r.skipped) return BB.toast('Sent to the client');
      // not sent by the portal (e.g. the message waits for Meta's approval): the link to send yourself
      const msg = `Hello${r.contact ? ` ${r.contact.split(' ')[0]}` : ''},

Thank you for meeting our candidates for your ${r.job} opening. How did our recruiter do? Please rate them, it takes 30 seconds: ${r.link}

Only our senior team reads it. Thank you.`;
      const wa = r.whatsapp ? `https://wa.me/91${String(r.whatsapp).replace(/D/g, '').slice(-10)}?text=${encodeURIComponent(msg)}` : '';
      BB.modal({ title: 'Send the rating link yourself', body: `<p class="small muted">Not sent by the portal: ${esc(r.skipped)}</p><div class="mono small" style="word-break:break-all">${esc(r.link)}</div>`, foot: `<span class="grow"></span><button class="btn" data-cplink>Copy message</button>${wa ? `<a class="btn primary" href="${wa}" target="_blank" rel="noopener">Send on WhatsApp</a>` : ''}`, onMount: (m) => { $('[data-cplink]', m).onclick = () => { BB.copy(msg); BB.toast('Message copied'); }; } });
    });
    const all = $('[data-rall]', el); if (all) all.onclick = (e) => { e.preventDefault(); BB.setQ({ user: '' }); };
  };

  // ---------- languages ----------
  const LN = () => BB.boot.lang_names || { en: 'English', hi: 'Hindi' };
  BB.langOptions = (all) => Object.entries(LN()).filter(([k]) => all || (BB.boot.languages || ['en', 'hi']).includes(k));
  // A typed WhatsApp message, put into the person's language before it goes.
  C.translateInto = async (ta, lang) => {
    const text = ta.value.trim(); if (!text) return BB.toast('Type the message first', true);
    try { const r = await BB.post('/api/translate', { text, to: lang }); ta.dataset.english = text; ta.value = r.text; ta.dispatchEvent(new Event('input')); BB.toast(`Put into ${LN()[lang]}. Check it before sending.`); } catch (e) { BB.fail(e); }
  };
  C.translateBar = (lang) => `<div class="row small tr-bar" style="gap:6px;margin:4px 0">Translate into <select class="mini" data-trlang>${BB.langOptions(true).filter(([k]) => k !== 'en').map(([k, l]) => `<option value="${k}" ${k === lang ? 'selected' : ''}>${l}</option>`).join('')}</select><button type="button" class="btn sm ghost" data-trgo>Translate</button><button type="button" class="btn sm ghost hidden" data-trback>Back to English</button></div>`;
  C.wireTranslate = (root, ta) => {
    const go = $('[data-trgo]', root); if (!go || !ta) return;
    go.onclick = async () => { go.disabled = true; await C.translateInto(ta, $('[data-trlang]', root).value); go.disabled = false; if (ta.dataset.english) $('[data-trback]', root).classList.remove('hidden'); };
    $('[data-trback]', root).onclick = () => { if (ta.dataset.english) { ta.value = ta.dataset.english; delete ta.dataset.english; $('[data-trback]', root).classList.add('hidden'); } };
  };
  // Replies: the English under the person's own words, or a button to get it.
  C.english = (m) => (m.direction !== 'in' ? '' : m.text_en ? `<div class="msg-en"><span class="tiny muted">In English${m.lang_in ? ` (from ${esc(m.lang_in)})` : ''}:</span> ${esc(m.text_en)}</div>` : m.text && !m.lang_in ? `<button type="button" class="link-btn tiny" data-msgen="${esc(m.id)}">Show in English</button>` : '');
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-msgen]'); if (!b) return; e.preventDefault(); b.disabled = true; b.textContent = 'Translating…';
    try { const r = await BB.post(`/api/messages/${b.dataset.msgen}/english`); b.outerHTML = r.english ? `<div class="msg-en"><span class="tiny muted">In English (from ${esc(r.language)}):</span> ${esc(r.english)}</div>` : '<span class="tiny muted">Already in English.</span>'; } catch (er) { BB.fail(er); b.disabled = false; b.textContent = 'Show in English'; }
  });
  // A call recording: written out, in English too, into the notes of the call form.
  C.recordingBtn = () => '<button type="button" class="btn sm ghost" data-recording>Upload call recording</button>';
  C.wireRecording = (root) => {
    const b = $('[data-recording]', root); if (!b) return;
    b.onclick = async () => {
      const f = await pick('audio/*,.mp3,.m4a,.wav,.ogg,.opus,.aac,.amr,.webm'); if (!f) return;
      if (f.size > 24 * 1024 * 1024) return BB.toast('The recording is too long. Keep it under 25 MB.', true);
      b.disabled = true; b.textContent = 'Listening to the recording…';
      try {
        const r = await BB.post('/api/transcribe', { file: await readFile(f) }); const ta = $('[name=note]', root.closest('.modal') || root);
        const add = r.english ? `${r.english}\n\n(${r.language}) ${r.text}` : r.text;
        if (ta) { ta.value = ta.value.trim() ? `${ta.value.trim()}\n\n${add}` : add; ta.dispatchEvent(new Event('input')); }
        BB.toast('Recording written into the summary. Check and shorten it.');
      } catch (e) { BB.fail(e); } finally { b.disabled = false; b.textContent = 'Upload call recording'; }
    };
  };
  // Settings → Message formats: translate the ticked formats into the chosen languages.
  C.translateFormats = async (names) => {
    if (!names.length) return BB.toast('Select the formats to translate', true);
    const opts = BB.langOptions(true).filter(([k]) => k !== 'en');
    const v = await BB.ask({ title: 'Translate the selected formats', note: 'The English text is put into each language you tick. A language a format already has is left as it is, so approved text is never lost. Buttons stay in English, so replies keep working. Then send the formats to Meta: until a language is approved, those people get the English one.', fields: [`<div class="chips-pick">${opts.map(([k, l]) => `<label class="chip-pick"><input type="checkbox" data-tl value="${k}"> ${l}</label>`).join('')}</div>`, `<label class="row small" style="gap:6px;margin-top:8px"><input type="checkbox" data-trep> Also redo languages that already have text (they need Meta approval again)</label>`], ok: 'Translate', submit: () => { const langs = $$('.modal [data-tl]:checked').map((i) => i.value); if (!langs.length) throw new Error('Tick at least one language'); return BB.post('/api/settings/formats/translate', { names, replace: !!($('[data-trep]') || {}).checked, langs }); } });
    if (!v) return;
    BB.toast(`${v.done.length} translated${v.skipped && v.skipped.length ? `, ${v.skipped.length} already had text` : ''}${v.failed.length ? `, ${v.failed.length} failed` : ''}${v.added.length ? `. Now messaging in ${v.added.join(', ')} too` : ''}`, !!v.failed.length);
    if (v.added.length) { try { BB.boot = await (await fetch('/api/bootstrap')).json(); } catch { /* next load */ } }
    done();
  };
})();
