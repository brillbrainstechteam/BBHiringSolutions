/* After joining (check-ins for 90 days and replacements), recruiter reviews for the super admin, and the language
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

  P.aftercare = async ({ el, q }) => {
    const tab = q.tab === 'replacements' ? 'replacements' : 'active';
    const d = await BB.api(`/api/aftercare?${BB.qs({ q: q.q })}`); const n = d.counts;
    const tabs = `<div class="tabs"><button data-ctab="active" class="${tab === 'active' ? 'on' : ''}">First 90 days <span class="n">${n.active}</span></button><button data-ctab="replacements" class="${tab === 'replacements' ? 'on' : ''}">Replacements <span class="n">${n.to_find + n.in_progress}</span></button></div>`;
    const tiles = `<div class="grid camp-tiles">${[['In first 90 days', n.active], ['Check-ins to do', n.todo], ['At risk', n.at_risk], ['Replacements to find', n.to_find], ['Replacements in progress', n.in_progress]].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>`;
    const plan = `<div class="small muted" style="margin:-4px 0 10px">Candidate on days ${d.plan.candidate.join(', ')} · client on days ${d.plan.client.join(', ')}. Each check-in gives the recruiter a call task; the WhatsApp messages go only when switched on in Automatic messages.</div>`;
    const who = (x) => `<a href="#" data-open="application:${x.id}"><b>${esc(x.candidate_name)}</b></a><div class="tiny muted">${esc(x.job_title)} · ${esc(x.client_name)}</div>`;
    const body = tab === 'active'
      ? BB.table([{ t: 'Candidate', f: who }, { t: 'Joined', f: (x) => `${fmtD(x.joined_at)}<div class="tiny muted">day ${x.since}</div>` }, { t: 'Check-ins', f: (x) => dots(x.schedule) }, { t: 'Last answer', f: (x) => (x.last ? `<span class="badge ${CLS[x.last.outcome] || 'b-outline'}">${esc(x.last.outcome)}</span><div class="tiny muted">day ${x.last.day} · ${party(x.last.party).toLowerCase()}${x.last.note ? ` · ${esc(x.last.note)}` : ''}</div>` : '<span class="faint">—</span>') }, { t: 'Next', f: (x) => (x.todo.length ? `<span class="badge b-amber">Day ${x.todo.join(', ')} due</span>` : x.next ? `Day ${x.next.day}<div class="tiny muted">${fmtD(x.next.date)}</div>` : '<span class="faint">All done</span>') }, { t: 'Window left', num: 1, f: (x) => `${x.window_left} days` }, { t: 'Owner', f: (x) => esc(x.owner_name || '—') }, { t: '', f: (x) => `${x.at_risk ? '<span class="badge b-amber">At risk</span> ' : ''}<button class="btn sm" data-clog="${x.id}">Log check-in</button>` }], d.active, { empty: 'Nobody is in their first 90 days right now.' })
      : BB.table([{ t: 'Candidate who left', f: who }, { t: 'Joined', f: (x) => fmtD(x.joined_at) }, { t: 'Left', f: (x) => (x.left_date ? `${fmtD(x.left_date)}<div class="tiny muted">after ${x.stay} days${x.left_reason ? ` · ${esc(x.left_reason)}` : ''}</div>` : '<span class="faint">Not yet</span>') }, { t: 'Free replacement', f: (x) => (x.free ? 'Yes' : `No<div class="tiny muted">${esc(x.why)}</div>`) }, { t: 'Status', f: (x) => `<span class="badge ${x.status === 'Replaced' ? 'b-green' : x.status === 'Not covered' ? 'b-outline' : 'b-amber'}">${esc(x.status)}</span>${x.status === 'Client asked' ? `<div class="tiny muted">${esc(x.why)}</div>` : ''}` }, { t: 'Replacement', f: (x) => (x.by ? `<a href="#" data-open="application:${x.by.id}">${esc(x.by.name)}</a><div class="tiny muted">${esc(x.by.result === 'Hired' ? 'Joined' : x.by.step)}</div>` : x.free ? `<a href="#" data-open="job:${x.job_id}">Find on the job</a>` : '—') }, { t: 'Owner', f: (x) => esc(x.owner_name || '—') }], d.replacements, { empty: 'No replacements.' });
    el.innerHTML = `${tiles}${tabs}<div class="filters exp-filters"><input placeholder="Search candidate, client or job…" value="${esc(q.q || '')}" data-q data-xq></div>${tab === 'active' ? plan : ''}<div class="card">${body}</div>`;
    $$('[data-ctab]', el).forEach((b) => (b.onclick = () => BB.setQ({ tab: b.dataset.ctab === 'active' ? '' : b.dataset.ctab })));
    let t; $('[data-q]', el).oninput = (e) => { clearTimeout(t); t = setTimeout(() => BB.setQ({ q: e.target.value }), 350); };
    $$('[data-clog]', el).forEach((b) => (b.onclick = () => C.logCheckin(b.dataset.clog, { outcomes: d.outcomes })));
  };

  // ---------- recruiter reviews (super admin only) ----------
  const stars = (n) => `<span class="stars" title="${n} of 5">${'★'.repeat(Math.round(n))}<span class="faint">${'★'.repeat(5 - Math.round(n))}</span></span>`;
  P.reviews = async ({ el, q, actions }) => {
    const d = await BB.api(`/api/reviews?${BB.qs({ user: q.user })}`);
    actions.innerHTML = '<button class="btn" data-gurl>Google review link</button>';
    el.innerHTML = `<div class="notice small" style="margin-bottom:12px">Only super admins see this page. Candidates rate the recruiters they worked with in their profile (and on WhatsApp 14 days after joining, once switched on). After 4 or 5 stars they are asked to post on Google too${d.google_url ? '' : ': add your Google review link to switch this on'}.</div>
      <div class="card" style="margin-bottom:14px"><div class="card-h"><h3>By recruiter</h3></div>${BB.table([{ t: 'Recruiter', f: (r) => `<a href="#" data-ruser="${r.id}"><b>${esc(r.name)}</b></a><div class="tiny muted">${BB.levelName(r.level)}</div>` }, { t: 'Rating', f: (r) => `${stars(r.avg)} <b>${r.avg}</b>` }, { t: 'Reviews', num: 1, f: (r) => r.count }, { t: '1–2 stars', num: 1, f: (r) => r.low }, { t: 'Went to Google', num: 1, f: (r) => r.google }], d.recruiters, { empty: 'No reviews yet.' })}</div>
      <div class="card"><div class="card-h"><h3>${q.user ? `Reviews of ${esc((d.recruiters.find((r) => r.id === q.user) || {}).name || '')} <a href="#" class="small" data-rall>Show all</a>` : 'All reviews'}</h3></div>${BB.table([{ t: 'Date', f: (r) => fmtD(r.at) }, { t: 'Recruiter', f: (r) => esc(r.user_name) }, { t: 'Candidate', f: (r) => `<a href="#" data-open="candidate:${r.candidate_id}">${esc(r.candidate_name)}</a>` }, { t: 'Stars', f: (r) => stars(r.stars) }, { t: 'Review', f: (r) => esc(r.text || '—') }, { t: 'Google', f: (r) => (r.google ? 'Opened' : '—') }], d.reviews, { empty: 'No reviews yet.' })}</div>`;
    $$('[data-ruser]', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); BB.setQ({ user: a.dataset.ruser }); }));
    const all = $('[data-rall]', el); if (all) all.onclick = (e) => { e.preventDefault(); BB.setQ({ user: '' }); };
    $('[data-gurl]', actions).onclick = async () => { const v = await BB.ask({ title: 'Google review link', note: 'From your Google Business Profile: "Ask for reviews" gives a link like https://g.page/r/…/review. Leave empty to stop asking.', fields: [{ name: 'url', label: 'Link', value: d.google_url, opt: true, voice: false }], ok: 'Save', submit: (v) => { const u = String(v.url || '').trim(); if (u && !/^https:\/\//.test(u)) throw Object.assign(new Error('The link must start with https://'), { field: 'url' }); return BB.put('/api/settings/google_review_url', { value: u }); } }); if (v) done('Saved'); };
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
    const v = await BB.ask({ title: `Translate ${names.length} format${names.length === 1 ? '' : 's'}`, note: 'The English text is put into each language you tick. Buttons stay in English, so replies keep working. Check the text, then send the formats to Meta again for approval: until a language is approved, those people get the English one.', fields: [`<div class="chips-pick">${opts.map(([k, l]) => `<label class="chip-pick"><input type="checkbox" data-tl value="${k}" ${(BB.boot.languages || []).includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>`], ok: 'Translate', submit: () => { const langs = $$('.modal [data-tl]:checked').map((i) => i.value); if (!langs.length) throw new Error('Tick at least one language'); return BB.post('/api/settings/formats/translate', { names, langs }); } });
    if (!v) return;
    BB.toast(`${v.done.length} translated${v.failed.length ? `, ${v.failed.length} failed` : ''}${v.added.length ? `. Now messaging in ${v.added.join(', ')} too` : ''}`, !!v.failed.length);
    if (v.added.length) { try { BB.boot = await (await fetch('/api/bootstrap')).json(); } catch { /* next load */ } }
    done();
  };
})();
