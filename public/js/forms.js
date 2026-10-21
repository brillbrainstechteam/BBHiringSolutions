/* Client form (#hire) and candidate form (#apply). Each link opens only its form, no other menus. */
(() => {
  const { $, esc, field } = BB;

  // Split layout: heading and benefits on the left, the form card on the right. No menus (6.1).
  const feeText = () => (BB.boot.fee.type === 'percent' ? `${BB.boot.fee.value}% of the yearly salary` : `a fixed fee per hire`);
  const PAGES = {
    hire: { label: 'For Employers', eyebrow: 'For employers', title: 'Hire the <em>right people</em>, without the chase', lead: 'Tell us who you need. Our recruiters call you, screen candidates and send you profiles that fit — on WhatsApp and in your account.',
      perks: () => [['1', 'Screened profiles only', 'Every candidate is called and interviewed by us first.'], ['2', 'Interviews set up for you', 'Pick a time; we confirm it with the candidate on WhatsApp.'], ['₹', 'Pay only when they join', `${feeText()}, with a free replacement in the first 3 months.`]],
      cardTitle: 'Tell us what you need', cardSub: 'Takes under a minute. Tap the mic to speak instead of typing.' },
    apply: { label: 'For Candidates', eyebrow: 'For candidates', title: 'Your next <em>jewellery</em> job starts here', lead: 'Showrooms, workshops and offices across India are hiring sales staff, karigars, designers, accountants and more.',
      perks: () => [['✓', 'Free for you', 'You never pay to get a job through us.'], ['★', 'Jobs that fit you', 'Matched on your city, skills, experience and salary.'], ['✆', 'Updates on WhatsApp', 'Interview times and offers come straight to your phone.']],
      cardTitle: 'Share a few details', cardSub: 'Takes a minute. Tap the mic to speak in English or Hindi.' },
  };
  function shell(kind, inner) {
    const p = PAGES[kind];
    return BB.split({ top: BB.publicTop(p.label), eyebrow: p.eyebrow, title: p.title, lead: p.lead, perks: p.perks(), card: `<div class="card-title">${p.cardTitle}</div><p class="muted small" style="margin:0 0 14px">${p.cardSub}</p>${inner}` });
  }
  async function submit(form, url, body, done) {
    const btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = 'Sending…';
    try { const r = await BB.post(url, body, { kind: null }); done(r); } catch (e) { BB.showErr(form, e); } finally { btn.disabled = false; btn.textContent = btn.dataset.label; }
  }
  // Checks in the browser too, with the same plain words as the server.
  function check(form, rules) {
    for (const [name, ok, msg] of rules) if (!ok) { const e = new Error(msg); e.field = name; BB.showErr(form, e); return false; }
    return true;
  }
  const phoneOk = (v) => /^[6-9]\d{9}$/.test(BB.spokenToDigits(v) || v.replace(/\D/g, ''));

  // ---------- 6.1 client form ----------
  BB.views.hire = (r) => {
    const q = r.q;
    $('#app').innerHTML = shell('hire', `
      <form class="stack" novalidate data-label>
        ${BB.voiceSwitch()}
        <div class="grid g2">${field({ name: 'contact', label: 'Your name' })}${field({ name: 'company', label: 'Company name' })}</div>
        <div class="grid g2">${field({ name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true, placeholder: '10 digits', attrs: 'inputmode="numeric" maxlength="14"' })}${field({ name: 'city', label: 'City', list: 'cities', placeholder: 'Start typing…' })}</div>
        ${field({ name: 'business_type', label: 'Your business', type: 'choice', options: ['Showroom B2C', 'Manufacturer B2B', 'Both'] })}
        ${field({ name: 'need', label: 'When do you need staff?', type: 'choice', options: ['Hiring now', 'Hiring soon', 'Just exploring'] })}
        ${field({ name: 'roles', label: 'Which roles?', opt: true, placeholder: 'e.g. 2 sales executives, 1 cashier' })}
        <button type="submit" class="btn gold lg block" data-label="Send request">Send request</button>
        <div class="consent">${esc(BB.boot.consent)}</div>
      </form>`);
    const form = $('form');
    BB.attachMics(form);
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = BB.formValues(form); v.whatsapp = BB.spokenToDigits(v.whatsapp) || v.whatsapp.replace(/\D/g, '');
      if (!check(form, [['contact', v.contact, 'Please enter your name'], ['company', v.company, 'Please enter your company name'], ['whatsapp', phoneOk(v.whatsapp), 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9'], ['city', v.city, 'Please enter your city'], ['business_type', v.business_type, 'Pick your type of business'], ['need', v.need, 'Tell us when you need staff']])) return;
      submit(form, '/api/public/hire', { ...v, src: q.src }, (res) => {
        BB.setToken('client', res.token);
        $('.pub-card').innerHTML = `<div class="thanks"><h2>Thank you!${res.isNew ? '' : ' We added this to your request.'}</h2><div class="muted">Your client ID</div><div class="big-id">${esc(res.id)}</div>
          <ol class="steps-list"><li>Our team calls you within one working day to understand your needs.</li><li>We share a simple agreement and set up your first job opening.</li><li>You get matching profiles on WhatsApp and in your account.</li></ol>
          <div class="row" style="justify-content:center"><a class="btn primary lg" href="#my-account">Open my client account</a><a class="btn lg" href="#hire" onclick="setTimeout(()=>BB.route());">Send another request</a></div></div>`;
      });
    };
  };

  // ---------- 6.2 candidate form ----------
  BB.views.apply = (r) => {
    const q = r.q; let cv = null;
    $('#app').innerHTML = shell('apply', `
      <form class="stack" novalidate>
        ${BB.voiceSwitch()}
        ${q.job ? `<div class="notice gold small">You are applying for job <b>${esc(q.job.toUpperCase())}</b>. We will also show you other matching jobs.</div>` : ''}
        ${q.ref ? `<div class="notice small">Referred by a friend (${esc(q.ref.toUpperCase())}).</div>` : ''}
        <div class="grid g2">${field({ name: 'name', label: 'Your name' })}${field({ name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true, placeholder: '10 digits', attrs: 'inputmode="numeric" maxlength="14"' })}</div>
        ${field({ name: 'city', label: 'City you want to work in', list: 'cities', placeholder: 'Start typing…' })}
        <label class="field" data-f="job_wanted"><span class="lab">Job you want</span><select name="job_wanted">${BB.jobOptions('', true, q.ind)}</select></label>
        <div class="hidden" data-other>${field({ name: 'job_other', label: 'Type the job you want' })}</div>
        <label class="field" data-f="experience"><span class="lab">Experience <span class="opt">(optional)</span></span><div class="choice">${['Fresher', '1–3 years', '3–5 years', '5–10 years', '10+ years'].map((x) => `<label style="min-width:90px"><input type="radio" name="experience" value="${x}"> ${x}</label>`).join('')}</div></label>
        <div class="field" data-f="cv"><span class="lab" style="font-size:12px;font-weight:600;color:var(--muted)">CV <span class="opt">(optional — PDF, Word, JPG or PNG, up to 10 MB)</span></span><div class="row"><button type="button" class="btn" data-cv>Attach CV</button><span class="muted small" data-cv-name>No file chosen</span></div></div>
        <button type="submit" class="btn gold lg block" data-label="Send my details">Send my details</button>
        <div class="consent">${esc(BB.boot.consent)}</div>
      </form>`);
    const form = $('form'); BB.attachMics(form);
    $('select[name=job_wanted]', form).onchange = (e) => $('[data-other]').classList.toggle('hidden', e.target.value !== 'Other');
    $('[data-cv]', form).onclick = async () => { cv = await BB.pickFile(); $('[data-cv-name]').textContent = cv ? cv.name : 'No file chosen'; };
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = BB.formValues(form); v.whatsapp = BB.spokenToDigits(v.whatsapp) || v.whatsapp.replace(/\D/g, '');
      if (!check(form, [['name', v.name, 'Please enter your name'], ['whatsapp', phoneOk(v.whatsapp), 'Enter a 10-digit WhatsApp number starting with 6, 7, 8 or 9'], ['city', v.city, 'Please enter the city you want to work in'], ['job_wanted', v.job_wanted, 'Pick the job you want'], ['job_other', v.job_wanted !== 'Other' || v.job_other, 'Type the job you want']])) return;
      submit(form, '/api/public/apply', { ...v, cv, src: q.src, job: q.job, ref: q.ref }, (res) => {
        BB.setToken('candidate', res.token);
        $('.pub-card').innerHTML = `<div class="thanks"><h2>Thank you, ${esc(v.name.split(' ')[0])}!</h2><div class="muted">Your candidate ID</div><div class="big-id">${esc(res.id)}</div>
          <ol class="steps-list"><li>You get a WhatsApp message from us with your profile link.</li><li>Complete your profile — salary, notice period and skills help us match you.</li><li>When a job matches, we call you and set up the interview.</li></ol>
          <a class="btn primary lg" href="#my-profile/profile">Open my profile</a></div>`;
      });
    };
  };
})();
