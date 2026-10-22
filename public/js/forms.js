/* One form for both doors: "I want to hire" (client, 6.1) and "I want a job" (candidate, 6.2).
   /hire and /apply open it already switched to the right side, with no other menus.
   After sending, the person verifies their WhatsApp number with a 6-digit code, which opens their account. */
(() => {
  const { $, $$, esc, field } = BB;

  const MODES = {
    hire: { kind: 'client', label: 'I want to hire', eyebrow: 'For employers', title: 'Hire the <em>right people</em>, without the chase', top: 'For Employers', send: 'Send request', account: 'client account', idLabel: 'Your client ID', go: 'my-account' },
    job: { kind: 'candidate', label: 'I want a job', eyebrow: 'For candidates', title: 'Your next <em>jewellery</em> job starts here', top: 'For Candidates', send: 'Send my details', account: 'profile', idLabel: 'Your candidate ID', go: 'my-profile/profile' },
  };
  const emailOk = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const phoneOk = (v) => /^[6-9]\d{9}$/.test(v);
  const digits = (v) => BB.spokenToDigits(v) || String(v || '').replace(/\D/g, '');
  function check(form, rules) {
    for (const [name, ok, msg] of rules) if (!ok) { const e = new Error(msg); e.field = name; BB.showErr(form, e); return false; }
    return true;
  }

  // The form card. Shared fields stay put when the toggle switches, so nothing typed is lost.
  // single: the separate client (/hire) or candidate (/apply) form, with no toggle.
  function formHtml(mode, q, single) {
    return `${single ? `<div class="card-title">${mode === 'hire' ? 'Tell us what you need' : 'Share a few details'}</div><p class="muted small" style="margin:0 0 14px">Takes a minute. Tap the mic to speak in English or Hindi.</p>` : `<div class="seg mode-seg" role="tablist" aria-label="What do you want to do?">${Object.entries(MODES).map(([k, m]) => `<button type="button" role="tab" data-mode="${k}" class="${k === mode ? 'on' : ''}" aria-selected="${k === mode}">${m.label}</button>`).join('')}</div>`}
      <form class="stack" novalidate${single ? '' : ' style="margin-top:18px"'}>
        ${BB.voiceSwitch()}
        ${q.job ? `<div class="notice gold small" data-only="job">You are applying for job <b>${esc(String(q.job).toUpperCase())}</b>. We will also show you other matching jobs.</div>` : ''}
        ${q.ref ? `<div class="notice small" data-only="job">Referred by a friend (${esc(String(q.ref).toUpperCase())}).</div>` : ''}
        <div class="grid g2">${field({ name: 'name', label: 'Your name' })}<div data-only="hire">${field({ name: 'company', label: 'Company name' })}</div><div data-only="job">${field({ name: 'email', label: 'Email', type: 'email', opt: true, placeholder: 'For a confirmation email', attrs: 'autocomplete="email"' })}</div></div>
        <div class="grid g2">${field({ name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true, placeholder: '10 digits', attrs: 'inputmode="numeric" maxlength="14" autocomplete="tel"' })}<div data-only="hire">${field({ name: 'email_hire', label: 'Email', type: 'email', opt: true, placeholder: 'For a confirmation email', attrs: 'autocomplete="email"' })}</div><div data-only="job"><label class="field" data-f="job_wanted"><span class="lab">Job you want</span><select name="job_wanted">${BB.jobOptions('', true, q.ind)}</select></label></div></div>
        <div class="hidden" data-other>${field({ name: 'job_other', label: 'Type the job you want' })}</div>
        <div class="grid g2">${field({ name: 'city', label: 'City', list: 'cities', placeholder: 'Start typing your city…' })}${field({ name: 'state', label: 'State', placeholder: 'Fills in from the city', voice: false })}</div>
        <div data-only="hire" class="stack">
          ${field({ name: 'business_type', label: 'Your business', type: 'choice', options: ['Showroom B2C', 'Manufacturer B2B', 'Both'] })}
          ${field({ name: 'need', label: 'When do you need staff?', type: 'choice', options: ['Hiring now', 'Hiring soon', 'Just exploring'] })}
          ${field({ name: 'roles', label: 'Which roles?', opt: true, placeholder: 'e.g. 2 sales executives, 1 cashier' })}
        </div>
        <div data-only="job" class="stack">
          <label class="field" data-f="experience"><span class="lab">Experience <span class="opt">(optional)</span></span><div class="choice">${['Fresher', '1–3 years', '3–5 years', '5–10 years', '10+ years'].map((x) => `<label style="min-width:96px"><input type="radio" name="experience" value="${x}"> ${x}</label>`).join('')}</div></label>
          <div class="field" data-f="cv"><span class="lab" style="font-size:12px;font-weight:600;color:var(--muted)">CV <span class="opt">(optional — PDF, Word, JPG or PNG, up to 10 MB)</span></span><div class="row"><button type="button" class="btn" data-cv>Attach CV</button><span class="muted small" data-cv-name>No file chosen</span></div></div>
        </div>
        <label class="hp" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>
        <button type="submit" class="btn gold lg block" data-send>${MODES[mode].send}</button>
        <div class="consent">${esc(BB.boot.consent)}</div>
      </form>`;
  }

  // Wires a rendered form card. onMode lets the page change its heading with the toggle.
  function mountForm(card, startMode, q, onMode, single) {
    let mode = startMode; let cv = null;
    const form = $('form', card);
    const apply = () => {
      $$('[data-only]', card).forEach((el) => el.classList.toggle('hidden', el.dataset.only !== mode));
      $$('[data-mode]', card).forEach((b) => { b.classList.toggle('on', b.dataset.mode === mode); b.setAttribute('aria-selected', b.dataset.mode === mode); });
      $('[data-send]', card).textContent = MODES[mode].send;
      $('[data-f="city"] .lab', card).textContent = mode === 'hire' ? 'City' : 'City you want to work in';
      $('[data-other]', card).classList.toggle('hidden', mode !== 'job' || $('[name=job_wanted]', card).value !== 'Other');
      $$('.err-msg', card).forEach((x) => x.remove()); $$('.has-err', card).forEach((x) => x.classList.remove('has-err'));
      onMode && onMode(mode);
    };
    $$('[data-mode]', card).forEach((b) => (b.onclick = () => { mode = b.dataset.mode; apply(); }));
    $('[name=job_wanted]', card).onchange = (e) => $('[data-other]', card).classList.toggle('hidden', e.target.value !== 'Other');
    $('[data-cv]', card).onclick = async () => { cv = await BB.pickFile(); $('[data-cv-name]', card).textContent = cv ? cv.name : 'No file chosen'; };
    BB.attachMics(card); apply();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = BB.formValues(form); v.whatsapp = digits(v.whatsapp);
      const email = mode === 'hire' ? v.email_hire : v.email;
      const common = [['name', v.name, 'Please enter your name'], ['whatsapp', phoneOk(v.whatsapp), 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9'], [mode === 'hire' ? 'email_hire' : 'email', emailOk(email), 'Enter a valid email, or leave it empty']];
      const rules = mode === 'hire'
        ? [...common, ['company', v.company, 'Please enter your company name'], ['city', v.city, 'Please enter your city'], ['business_type', v.business_type, 'Pick your type of business'], ['need', v.need, 'Tell us when you need staff']]
        : [...common, ['job_wanted', v.job_wanted, 'Pick the job you want'], ['job_other', v.job_wanted !== 'Other' || v.job_other, 'Type the job you want'], ['city', v.city, 'Please enter the city you want to work in']];
      if (!check(form, rules)) return;
      const body = mode === 'hire'
        ? { contact: v.name, company: v.company, whatsapp: v.whatsapp, email, city: v.city, state: v.state, business_type: v.business_type, need: v.need, roles: v.roles, website: v.website, src: q.src }
        : { name: v.name, whatsapp: v.whatsapp, email, city: v.city, state: v.state, job_wanted: v.job_wanted, job_other: v.job_other, experience: v.experience, cv, website: v.website, src: q.src, job: q.job, ref: q.ref };
      const btn = $('[data-send]', card); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const res = await BB.post(mode === 'hire' ? '/api/public/hire' : '/api/public/apply', body, { kind: null });
        showVerify(card, mode, res, v.name, () => { card.innerHTML = formHtml(mode, q, single); restore(card, v); mountForm(card, mode, q, onMode, single); });
      } catch (er) {
        // Server field names differ for the hiring side; point the error at the visible field.
        if (er.field === 'contact') er.field = 'name'; if (er.field === 'email' && mode === 'hire') er.field = 'email_hire';
        BB.showErr(form, er);
      } finally { btn.disabled = false; btn.textContent = MODES[mode].send; }
    };
  }
  function restore(card, v) { for (const [k, val] of Object.entries(v)) { const el = $(`[name="${k}"]`, card); if (!el || el.type === 'radio') continue; el.value = val; } for (const k of ['business_type', 'need', 'experience']) if (v[k]) { const r = $(`[name="${k}"][value="${v[k]}"]`, card); if (r) r.checked = true; } }

  // After sending: show the ID, then verify the number with a WhatsApp code to open the account.
  function showVerify(card, mode, res, name, editAgain) {
    const m = MODES[mode]; const first = String(name || '').trim().split(' ')[0];
    const next = mode === 'hire'
      ? ['Our team calls you within one working day to understand your needs.', 'We share a simple agreement and set up your first job opening.', 'You get matching profiles on WhatsApp and in your account.']
      : ['Complete your profile — salary, notice period and skills help us match you.', 'When a job matches, we call you and set up the interview.', 'Interview times and offers come on WhatsApp.'];
    card.innerHTML = `<div class="thanks"><h2>Thank you, ${esc(first)}!</h2><div class="muted">${m.idLabel}</div><div class="big-id">${esc(res.id)}</div></div>
      ${res.can_verify ? `<div class="verify stack" data-verify>
        <div><b>Open your ${m.account}</b><div class="muted small">We send a 6-digit code to your WhatsApp to check it is your number.</div></div>
        <div class="phone-line"><span class="muted small">WhatsApp</span><b class="mono" style="font-size:16px">+91 ${esc(res.phone.slice(0, 5))} ${esc(res.phone.slice(5))}</b><a href="#" class="small right" data-edit>Wrong number?</a></div>
        <button class="btn gold lg block" data-sendcode>Send code on WhatsApp</button>
        <form class="stack hidden" data-codeform novalidate>${field({ name: 'code', label: '6-digit code', voice: false, attrs: 'inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="code-in"' })}<div data-dev></div><button class="btn primary lg block">Verify and open my ${m.account}</button><a href="#" class="small" data-resend>Send the code again</a></form>
      </div>` : `<div class="notice small">We will message you on WhatsApp with a link to your ${m.account}.</div>`}
      <ol class="steps-list">${next.map((x) => `<li>${x}</li>`).join('')}</ol>`;
    if (!res.can_verify) return;
    const v = $('[data-verify]', card); const codeForm = $('[data-codeform]', v);
    $('[data-edit]', v).onclick = (e) => { e.preventDefault(); editAgain(); };
    const request = async (btn) => {
      btn.disabled = true;
      try {
        const r = await BB.post('/api/otp/request', { phone: res.phone, kind: m.kind }, { kind: null });
        $('[data-sendcode]', v).classList.add('hidden'); codeForm.classList.remove('hidden');
        $('[data-dev]', v).innerHTML = r.dev_code ? `<div class="test-code">Test copy (WhatsApp not connected): your code is <b class="mono">${r.dev_code}</b></div>` : '<div class="muted small">Code sent. It is valid for 10 minutes.</div>';
        $('[name=code]', v).focus();
      } catch (er) { BB.toast(er.message, true); } finally { btn.disabled = false; }
    };
    $('[data-sendcode]', v).onclick = (e) => request(e.currentTarget);
    $('[data-resend]', v).onclick = (e) => { e.preventDefault(); request(e.currentTarget); };
    codeForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await BB.post('/api/otp/verify', { phone: res.phone, kind: m.kind, code: BB.formValues(codeForm).code }, { kind: null });
        BB.setToken(m.kind, r.token); location.hash = m.go;
      } catch (er) { BB.showErr(codeForm, { message: er.message, field: 'code' }); }
    };
  }

  // /hire (clients) and /apply (candidates): two separate forms, each on its own link, no menus and no toggle.
  function page(mode, r) {
    const q = r.q; const m = MODES[mode];
    $('#app').innerHTML = BB.split({ top: BB.publicTop(m.top), eyebrow: m.eyebrow, title: m.title, centered: true, card: '<div data-leadcard></div>' });
    const card = $('[data-leadcard]'); card.innerHTML = formHtml(mode, q, true);
    mountForm(card, mode, q, null, true);
  }
  BB.views.hire = (r) => page('hire', r);
  BB.views.apply = (r) => page('job', r);
  // Used by the landing page.
  BB.leadFormCard = (el, mode = 'job', q = {}) => { el.innerHTML = formHtml(mode, q); mountForm(el, mode, q); };
})();
