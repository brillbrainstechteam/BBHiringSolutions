/* One form for both doors: "I want to hire" (client, 6.1) and "I want a job" (candidate, 6.2).
   /hire and /apply open it already switched to the right side, with no other menus.
   After sending, the person verifies their WhatsApp number with a 6-digit code, which opens their account. */
(() => {
  const { $, $$, esc, field } = BB;

  const MODES = {
    hire: { kind: 'client', label: 'I want to hire', eyebrow: 'For Employers', title: 'Hire the <em>right people</em>, without the chase', top: 'For Employers', send: 'Send request', account: 'client account', idLabel: 'Your client ID', go: 'my-account' },
    job: { kind: 'candidate', label: 'I want a job', eyebrow: 'For Job Seekers', title: 'Your next <em>jewellery</em> job starts here', top: 'For Job Seekers', send: 'Send my details', account: 'profile', idLabel: 'Your candidate ID', go: 'my-profile/profile' },
  };
  // Years in the jewellery industry; the server turns the choice into a number (exp_jewellery).
  const JEWEL_EXP = ['No experience', 'Less than 1 year', '1–3 years', '3–5 years', '5–10 years', '10+ years'];
  const EXPERIENCE = ['Fresher', '1–3 years', '3–5 years', '5–10 years', '10+ years'];
  const BUSINESS = ['Wholesaler', 'Manufacturer', 'Retailer'];
  // The team portal's Create candidate form asks the same questions with the same choices.
  BB.seekerOptions = { EXPERIENCE, JEWEL_EXP, BUSINESS };
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
    return `${single ? `<div class="card-title">Fill in the below details</div><p class="muted small" style="margin:0 0 14px">For voice input, tap and allow the mic to speak</p>` : `<div class="seg mode-seg" role="tablist" aria-label="What do you want to do?">${Object.entries(MODES).map(([k, m]) => `<button type="button" role="tab" data-mode="${k}" class="${k === mode ? 'on' : ''}" aria-selected="${k === mode}">${m.label}</button>`).join('')}</div>`}
      <form class="stack" novalidate${single ? '' : ' style="margin-top:18px"'}>
        ${BB.voiceSwitch()}
        ${!q.job && (q.adjobs || []).length ? `<div class="notice gold small" data-only="job"><span>You are applying for</span> <b data-no-i18n>${esc([...new Set(q.adjobs.map((j) => j.title))].join(' / '))} · ${esc([...new Set(q.adjobs.map((j) => j.city).filter(Boolean))].join(' / '))}</b>. <span>We will also show you other matching jobs.</span></div>` : ''}
        ${q.job ? `<div class="notice gold small" data-only="job"><span>You are applying for</span> <b data-no-i18n>${q.want ? `${esc(q.want)}${q.city ? ` · ${esc(q.city)}` : ''} (${esc(String(q.job).toUpperCase())})` : esc(String(q.job).toUpperCase())}</b>. <span>We will also show you other matching jobs.</span></div>` : ''}
        ${q.ref ? `<div class="notice small" data-only="job">Referred by a friend (${esc(String(q.ref).toUpperCase())}).</div>` : ''}
        <div class="cv-first" data-only="job" data-f="cv"><div class="cv-ic" aria-hidden="true">CV</div><div class="grow"><b>Start with your CV</b> <span class="opt">(optional)</span><div class="muted small" data-cv-name>PDF or Word, max 10 MB</div><div class="small" data-cv-msg></div></div><button type="button" class="btn" data-cv>Attach CV</button></div>
        <div class="grid g2">${field({ name: 'name', label: 'Your name' })}<div data-only="hire">${field({ name: 'company', label: 'Company name' })}</div><div data-only="job">${field({ name: 'email', label: 'Email', type: 'email', opt: true, placeholder: 'For a confirmation email', attrs: 'autocomplete="email"' })}</div></div>
        <div class="grid g2">${field({ name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true, placeholder: '10 digits', attrs: 'inputmode="numeric" maxlength="14" autocomplete="tel"' })}<div data-only="hire">${field({ name: 'email_hire', label: 'Email', type: 'email', opt: true, placeholder: 'For a confirmation email', attrs: 'autocomplete="email"' })}</div><div data-only="job"><label class="field" data-f="job_wanted"><span class="lab">Job you want</span><select name="job_wanted">${BB.jobOptions(q.want || '', true, q.ind)}</select></label></div></div>
        <div class="hidden" data-other>${field({ name: 'job_other', label: 'Type the job you want' })}</div>
        <div class="grid g2">${field({ name: 'city', label: 'City', list: 'cities', value: q.city || '', placeholder: 'Start typing your city…' })}${field({ name: 'state', label: 'State', placeholder: 'Fills in from the city', voice: false })}</div>
        <div data-only="hire" class="stack">
          ${field({ name: 'business_type', label: 'Your business', type: 'choice', options: [['Showroom B2C', 'B2C'], ['Manufacturer B2B', 'B2B'], ['Both', 'Both']] })}
          ${field({ name: 'need', label: 'When do you want to hire?', type: 'choice', options: ['Hiring now', 'Hiring soon', 'Just exploring'] })}
          ${field({ name: 'roles', label: 'Which roles?', opt: true, placeholder: 'e.g. 2 sales executives, 1 cashier' })}
        </div>
        <div data-only="job" class="stack">
          <label class="field" data-f="experience"><span class="lab">Experience <span class="opt">(optional)</span></span><div class="choice">${EXPERIENCE.map((x) => `<label style="min-width:96px"><input type="radio" name="experience" value="${x}"> ${x}</label>`).join('')}</div></label>
          ${field({ name: 'exp_jewellery', label: 'Experience in the jewellery industry', type: 'select', opt: true, options: JEWEL_EXP, placeholder: 'Select years' })}
          <div class="field hidden" data-f="exp_business" data-expbiz><span class="lab">Where have you worked?</span><div class="choice biz-choice">${BUSINESS.map((x) => `<label><input type="checkbox" name="exp_business" value="${x}"> ${x}</label>`).join('')}</div><span class="hint">Tick all that apply.</span></div>
        </div>
        <label class="hp" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>
        <label class="consent-tick" data-f="consent"><input type="checkbox" name="consent"><span>${esc(BB.boot.consent)}</span></label>
        <button type="submit" class="btn gold lg block" data-send>${MODES[mode].send}</button>
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
    $('[data-cv]', card).onclick = async () => {
      cv = await BB.pickFile(); $('[data-cv-name]', card).textContent = cv ? cv.name : 'PDF or Word, max 10 MB';
      if (cv) fillFromCv(card, cv);
    };
    BB.attachMics(card); BB.romanizeFields(card); apply();
    const biz = $('[data-expbiz]', card);
    const showBiz = () => { const e = $('[name=experience]:checked', card); const on = !!e && e.value !== 'Fresher'; biz.classList.toggle('hidden', !on); if (!on) $$('[name=exp_business]', card).forEach((x) => { x.checked = false; }); const jw = $('[name=exp_jewellery]', card); if (e && e.value === 'Fresher' && !jw.value) jw.value = 'No experience'; };
    $$('[name=experience]', card).forEach((r) => r.addEventListener('change', showBiz)); showBiz();
    form.onsubmit = async (e) => {
      e.preventDefault(); BB.romanizeNow(form);
      const v = BB.formValues(form); v.whatsapp = digits(v.whatsapp);
      const email = mode === 'hire' ? v.email_hire : v.email;
      const common = [['name', v.name, 'Please enter your name'], ['whatsapp', phoneOk(v.whatsapp), 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9'], [mode === 'hire' ? 'email_hire' : 'email', emailOk(email), 'Enter a valid email, or leave it empty']];
      const rules = mode === 'hire'
        ? [...common, ['company', v.company, 'Please enter your company name'], ['city', v.city, 'Please enter your city'], ['business_type', v.business_type, 'Pick your type of business'], ['need', v.need, 'Tell us when you want to hire']]
        : [...common, ['job_wanted', v.job_wanted, 'Pick the job you want'], ['job_other', v.job_wanted !== 'Other' || v.job_other, 'Type the job you want'], ['city', v.city, 'Please enter the city you want to work in']];
      v.exp_business = $$('[name=exp_business]:checked', form).map((x) => x.value);
      if (mode === 'job' && v.experience && v.experience !== 'Fresher') rules.push(['exp_business', v.exp_business.length, 'Tick where you have worked: wholesaler, manufacturer or retailer']);
      rules.push(['consent', v.consent, 'Please tick to agree before sending']);
      if (!check(form, rules)) return;
      const body = mode === 'hire'
        ? { contact: v.name, company: v.company, whatsapp: v.whatsapp, email, city: v.city, state: v.state, business_type: v.business_type, need: v.need, roles: v.roles, website: v.website, src: q.src, lang: BB.lang }
        : { name: v.name, whatsapp: v.whatsapp, email, city: v.city, state: v.state, job_wanted: v.job_wanted, job_other: v.job_other, experience: v.experience, exp_business: v.exp_business, exp_jewellery: v.exp_jewellery, cv, website: v.website, lang: BB.lang, src: q.src || BB.adSource() || undefined, ...BB.adParams(), job: q.job, ref: q.ref };
      const btn = $('[data-send]', card); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const res = await BB.post(mode === 'hire' ? '/api/public/hire' : '/api/public/apply', body, { kind: null });
        // Meta Pixel: an employer's request is a Lead, a job seeker's form is a SubmitApplication (no personal data sent).
        if (mode === 'hire') BB.track('Lead', { content_name: 'Hiring request', content_category: 'Employer' });
        else BB.track('SubmitApplication', { content_name: body.job_wanted || 'Job application', content_category: 'Job seeker' });
        showVerify(card, mode, { ...res, email }, v.name, () => { card.innerHTML = formHtml(mode, q, single); restore(card, v); mountForm(card, mode, q, onMode, single); });
      } catch (er) {
        // Server field names differ for the hiring side; point the error at the visible field.
        if (er.field === 'contact') er.field = 'name'; if (er.field === 'email' && mode === 'hire') er.field = 'email_hire';
        BB.showErr(form, er);
      } finally { btn.disabled = false; btn.textContent = MODES[mode].send; }
    };
  }
  // Reads the chosen CV on the server and fills the fields that are still empty.
  async function fillFromCv(card, cv) {
    const msg = $('[data-cv-msg]', card);
    if (!/\.(pdf|docx|txt)$/i.test(cv.name)) { msg.innerHTML = '<span class="muted">Photos of a CV cannot be read — please fill in the form. We will still attach your CV.</span>'; return; }
    msg.innerHTML = '<span class="muted">Reading your CV…</span>';
    let f = {};
    try { f = (await BB.post('/api/public/cv-read', { name: cv.name, base64: cv.base64 }, { kind: null })).fields || {}; } catch { msg.textContent = ''; return; }
    const form = $('form', card); const done = [];
    const put = (name, val, label) => { const el = $(`[name="${name}"]`, form); if (!el || val === undefined || val === null || val === '' || String(el.value).trim()) return; el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); done.push(label); };
    put('name', f.name, 'name'); put('email', f.email, 'email'); put('whatsapp', f.whatsapp, 'WhatsApp'); put('city', f.city, 'city'); put('state', f.state, 'state');
    const sel = $('[name=job_wanted]', form);
    if (f.job_wanted && !sel.value) { sel.value = f.job_wanted; if (sel.value !== f.job_wanted) { sel.value = 'Other'; $('[name=job_other]', form).value = f.job_wanted; } sel.dispatchEvent(new Event('change')); done.push('job'); }
    if (f.exp_total !== undefined && !$('[name=experience]:checked', form)) {
      const y = f.exp_total; const pick = y < 1 ? 'Fresher' : y < 3 ? '1–3 years' : y < 5 ? '3–5 years' : y < 10 ? '5–10 years' : '10+ years';
      const r = $(`[name=experience][value="${pick}"]`, form); if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); done.push('experience'); }
    }
    msg.innerHTML = done.length ? '' : '<span class="muted">We could not read details from this file — please fill in the form.</span>';
  }
  function restore(card, v) { for (const [k, val] of Object.entries(v)) { const el = $(`[name="${k}"]`, card); if (!el || el.type === 'radio' || el.type === 'checkbox') continue; el.value = val; } for (const k of ['business_type', 'need', 'experience']) if (v[k]) { const r = $(`[name="${k}"][value="${v[k]}"]`, card); if (r) r.checked = true; } for (const b of v.exp_business || []) { const x = $(`[name="exp_business"][value="${b}"]`, card); if (x) x.checked = true; } const c = $('[name=consent]', card); if (c) c.checked = !!v.consent; }

  // ---------- after sending: thank-you page that also opens the account ----------
  const svg = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const TY_ICON = {
    doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
    users: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.4 5 2.8 5 5.8"/>'),
    chat: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-width="2.6"/>'),
    phone: svg('<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
    brief: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'),
    cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
    star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    grid: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2.2" fill="currentColor"/><rect x="13" y="3" width="8" height="8" rx="2.2" fill="currentColor"/><rect x="3" y="13" width="8" height="8" rx="2.2" fill="currentColor"/><rect x="13" y="13" width="8" height="8" rx="2.2" fill="currentColor"/></svg>`,
    headset: svg('<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20a3 3 0 0 1-3 2h-2"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2),
  };
  const TY = {
    hire: { head: 'Your hiring request has been submitted.', sub: 'Our team will connect with you within 1 working day.', access: 'Open your client dashboard', open: 'Open my dashboard',
      features: [['doc', 'Track requests'], ['users', 'View shortlisted profiles'], ['chat', 'Manage communication']],
      steps: [['doc', 'Request received'], ['phone', 'Team connects'], ['doc', 'Agreement & activation'], ['users', 'Receive candidates']] },
    job: { head: 'Your application has been submitted.', sub: '', access: 'Activate your profile', open: 'Open my profile',
      features: [['brief', 'See jobs that match you'], ['doc', 'Track your applications'], ['cal', 'Interview & offer updates']],
      steps: [['doc', 'Application received'], ['search', 'Profile check'], ['cal', 'Interview'], ['star', 'Offer & joining']] },
  };
  function showVerify(card, mode, res, name, editAgain) {
    const m = MODES[mode]; const t = TY[mode]; const first = String(name || '').trim().split(' ')[0];
    const support = BB.boot.business.support_phone;
    // The thank-you page uses the full width: the form's heading goes, the card widens.
    const main = card.closest('main'); if (main) main.classList.add('ty-mode');
    const pubCard = card.closest('.pub-card'); if (pubCard) pubCard.classList.add('ty-card');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    card.innerHTML = `<div class="ty">
      <div class="ty-top">
        <div class="ty-msg">
          <div class="ty-check"><span class="ty-burst" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>${svg('<path d="m6 12.5 4 4 8-9"/>', 3)}</div>
          <h1>Thank you${first ? `, ${esc(first)}` : ''}!</h1>
          <h2>${t.head}</h2>
          ${t.sub ? `<p>${t.sub}</p>` : ''}
          ${mode === 'hire' ? `<div class="ty-id"><span>${m.idLabel}</span><b class="mono">${esc(res.id)}</b><button type="button" class="btn sm" data-copyid>Copy</button></div>` : ''}
        </div>
      </div>
      <div class="ty-access">
        <div class="ty-access-main"><h3>${t.access}</h3><div class="ty-login" data-access></div></div>
        <ul class="ty-features">${t.features.map(([ic, l]) => `<li><span class="ty-ic">${TY_ICON[ic]}</span>${l}</li>`).join('')}</ul>
      </div>
      <h3 class="ty-next-h">What happens next?</h3>
      <ol class="ty-steps">${t.steps.map(([, l], i) => `<li><span class="ty-n">${i + 1}</span><span class="ty-l">${l}</span></li>`).join('')}</ol>
      <div class="ty-help"><span class="ty-help-ic">${TY_ICON.headset}</span><b class="grow">Need help with your ${mode === 'hire' ? 'request' : 'application'}?</b>
        <a class="btn" href="https://wa.me/91${esc(support)}" target="_blank" rel="noopener">Contact support ${TY_ICON.arrow}</a></div>
    </div>`;
    const cp = $('[data-copyid]', card); if (cp) cp.onclick = () => BB.copy(res.id);
    const acc = $('[data-access]', card);
    if (mode === 'job' && BB.boot.candidate_login === false) { if (acc) acc.remove(); return; } // candidate login is switched off

    const pretty = res.phone ? `+91 ${esc(res.phone.slice(0, 5))} ${esc(res.phone.slice(5))}` : '';
    const phoneLine = `<div class="phone-line"><span class="muted small">WhatsApp</span><b class="mono">${pretty}</b><a href="#" class="small right" data-edit>Wrong number?</a></div>`;
    const wireEdit = () => { $('[data-edit]', acc).onclick = (e) => { e.preventDefault(); if (main) main.classList.remove('ty-mode'); if (pubCard) pubCard.classList.remove('ty-card'); editAgain(); }; };
    // Email instead of WhatsApp: a new sign-up creates an account (email + password) and then logs in with it;
    // someone already known logs in, or creates one after a WhatsApp code. Forgot password lives in the same box.
    const emailSwitch = (isNew, start) => {
      const box = $('[data-byemail]', acc); let mounted = false;
      $('[data-switch]', acc).onclick = (e) => {
        e.preventDefault(); const toEmail = box.classList.contains('hidden');
        box.classList.toggle('hidden', !toEmail); $('[data-byphone]', acc).classList.toggle('hidden', toEmail);
        e.currentTarget.textContent = toEmail ? 'Use WhatsApp instead' : 'Use email and password instead';
        if (toEmail && !mounted) {
          mounted = true;
          BB.emailAuth(box, { kind: m.kind, email: res.email || '', phone: res.phone, session: isNew, start: start || (isNew ? 'register' : 'login'), onLogin: (tk) => { BB.setToken(m.kind, tk); BB.go(m.go); }, onView: (v) => $('.login-switch', acc).classList.toggle('hidden', !['login', 'register'].includes(v)) });
        }
        if (toEmail) { const i = $$('input', box).find((x) => !x.value) || $('input', box); if (i) i.focus(); }
      };
    };
    const shell = (phoneHtml) => `<div data-byphone class="stack-sm">${phoneLine}${phoneHtml}</div><div class="hidden" data-byemail></div>
      <div class="login-switch"><a href="#" data-switch>Use email and password instead</a></div>`;
    // 1) New sign-up: the account was made with the form; the number they just gave opens it in one tap.
    if (res.token) {
      BB.setToken(m.kind, res.token);
      acc.innerHTML = shell(`<a class="btn primary lg ty-go" href="/${m.go}">${t.open} ${TY_ICON.arrow}</a>`);
      wireEdit(); emailSwitch(true); return;
    }
    // 3) WhatsApp codes cannot go out yet.
    if (!res.can_verify) { acc.innerHTML = `<div class="notice small">We will message you on WhatsApp with a link to your ${m.account}.</div>`; return; }
    // 2) A number we already know: one WhatsApp code proves it is theirs, then the account opens.
    acc.innerHTML = shell(`
      <button class="btn primary lg ty-go" data-sendcode>Send code on WhatsApp</button>
      <form class="stack-sm hidden" data-codeform novalidate>
        ${field({ name: 'code', label: 'Enter 6 digit code received on WhatsApp', voice: false, attrs: 'inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="code-in"' })}
        <div data-dev class="small"></div>
        <button class="btn primary lg ty-go">Verify and ${t.open.toLowerCase()}</button>
        <div class="small"><a href="#" data-resend>Send the code again</a> <span class="muted" data-wait></span></div>
      </form>`);
    wireEdit(); emailSwitch(false, res.activate ? 'register' : null);
    if (res.activate) acc.insertAdjacentHTML('afterbegin', '<p class="small muted" style="margin:0 0 8px">To keep your profile safe, confirm it is your number: get a 6-digit code on WhatsApp, or create a login with your email and a password.</p>');
    const codeForm = $('[data-codeform]', acc); const code = $('[name=code]', acc); let timer;
    const wait = (s) => { clearInterval(timer); const a = $('[data-resend]', acc); a.classList.add('disabled'); const w = $('[data-wait]', acc);
      const tick = () => { w.textContent = s > 0 ? `(in ${s} s)` : ''; if (s-- <= 0) { clearInterval(timer); a.classList.remove('disabled'); } }; tick(); timer = setInterval(tick, 1000); };
    const request = async (btn) => {
      if (btn.classList.contains('disabled')) return;
      btn.disabled = true;
      try {
        const r = await BB.post('/api/otp/request', { phone: res.phone, kind: m.kind }, { kind: null });
        $('[data-sendcode]', acc).classList.add('hidden'); codeForm.classList.remove('hidden');
        $('[data-dev]', acc).innerHTML = r.dev_code ? `<div class="test-code">Test copy (WhatsApp not connected): your code is <b class="mono">${r.dev_code}</b></div>` : `<span class="muted">Code sent to ${pretty}. It is valid for 10 minutes.</span>`;
        code.value = ''; code.focus(); wait(30);
      } catch (er) { BB.toast(er.message, true); } finally { btn.disabled = false; }
    };
    $('[data-sendcode]', acc).onclick = (e) => request(e.currentTarget);
    $('[data-resend]', acc).onclick = (e) => { e.preventDefault(); request(e.currentTarget); };
    const verify = async () => {
      try {
        const r = await BB.post('/api/otp/verify', { phone: res.phone, kind: m.kind, code: code.value }, { kind: null });
        BB.setToken(m.kind, r.token); BB.go(m.go);
      } catch (er) { BB.showErr(codeForm, { message: er.message, field: 'code' }); }
    };
    // The 6th digit opens the account; no extra tap (phones fill it from the WhatsApp message).
    code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); if (code.value.length === 6) verify(); });
    codeForm.onsubmit = (e) => { e.preventDefault(); verify(); };
  }

  // /hire (clients) and /apply (candidates): two separate forms, each on its own link, no menus and no toggle.
  // A job ID in the ad's names (JB-2001 in the ad set, ad or campaign) counts like ?job=; the form then shows the job.
  async function page(mode, r) {
    let q = r.q; const m = MODES[mode];
    if (mode === 'job') {
      const ad = BB.adParams(); const hit = !q.job && [ad.ad_set, ad.ad_name, ad.ad_campaign].map((v) => /(?:^|[^A-Za-z0-9])JB[-\s_]?(\d{3,})(?!\d)/i.exec(v || '')).find(Boolean);
      if (hit) q = { ...q, job: `JB-${hit[1]}` };
      // Otherwise the job whose saved ad names match this link (set on the job page under "Ads for this job").
      if (!q.job && (ad.ad_set || ad.ad_name || ad.ad_campaign)) { try { const res = await fetch(`/api/public/ad-job?${new URLSearchParams({ src: BB.adSource(), ...ad })}`); if (res.ok) { const j = await res.json(); q = { ...q, want: j.title, city: q.city || j.city, adjobs: j.jobs }; } } catch { /* no match: the plain form */ } }
      if (q.job && !q.want) { try { const res = await fetch(`/api/public/job/${encodeURIComponent(q.job)}`); if (res.ok) { const j = await res.json(); q = { ...q, want: j.title, city: q.city || j.city }; } } catch { /* the form still works without the job line */ } }
    }
    $('#app').innerHTML = BB.split({ top: BB.publicTop(m.top), eyebrow: m.eyebrow, title: m.title, centered: true, card: '<div data-leadcard></div>' });
    const card = $('[data-leadcard]'); card.innerHTML = formHtml(mode, q, true);
    mountForm(card, mode, q, null, true);
  }
  BB.views.hire = (r) => page('hire', r);
  BB.views.apply = (r) => page('job', r);
  // Used by the landing page.
  BB.leadFormCard = (el, mode = 'job', q = {}) => { el.innerHTML = formHtml(mode, q); mountForm(el, mode, q); };
})();
