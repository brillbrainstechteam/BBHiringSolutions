/* Home page (hire.brillbrainsconsultants.com) and the partners page (/partners).
   Home, top to bottom: hero (role search + the lead form card the ads point to), the jewellery businesses we hire for,
   BrillBrains numbers, live openings, browse by field, how it works (two tracks), why us, cities, the two doors,
   partners, questions, footer. Trust content (numbers, clients, legal links) comes from settings.landing. */
(() => {
  const { $, $$, esc } = BB;
  const L = () => BB.boot.landing || { stats: [], clients: [], partners: [], legal: {}, contact: {} };
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sections fade up as they scroll into view; numbers count up once.
  function animate(root) {
    const els = $$('.rv', root);
    if (!('IntersectionObserver' in window) || reduced()) { els.forEach((e) => e.classList.add('in')); $$('[data-count]', root).forEach((e) => (e.textContent = e.dataset.count)); return; }
    const io = new IntersectionObserver((list) => list.forEach((x) => {
      if (!x.isIntersecting) return; io.unobserve(x.target); x.target.classList.add('in');
      $$('[data-count]', x.target).forEach(countUp);
    }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    els.forEach((e) => io.observe(e));
  }
  // "10,000+" counts 0 → 10,000 and keeps its "+"; a year like 2011 counts up from 1990.
  function countUp(el) {
    const m = String(el.dataset.count).match(/^(\D*)([\d,]+)(.*)$/); if (!m) { el.textContent = el.dataset.count; return; }
    const target = Number(m[2].replace(/,/g, '')); const from = target > 1900 && target < 2100 ? 1990 : 0; const t0 = performance.now(); const dur = 1400;
    const step = (t) => {
      const p = Math.max(0, Math.min(1, (t - t0) / dur)); const v = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      el.textContent = `${m[1]}${from ? v : v.toLocaleString('en-IN')}${m[3]}`;
      if (p < 1) requestAnimationFrame(step); else el.textContent = el.dataset.count;
    };
    requestAnimationFrame(step);
  }

  const initials = (n) => n.replace(/[^A-Za-z& ]/g, '').split(/\s+/).filter((w) => w && !['&', 'and', 'of', 'the'].includes(w.toLowerCase())).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  // A client: its logo when we have one, otherwise its name set like a wordmark with a monogram.
  const tile = ([name, city, kind, logo], i) => `<div class="lg-tile${logo ? ' has-logo' : ''}" data-no-i18n title="${esc(name)}${city ? ` · ${esc(city)}` : ''}">${logo
    ? `<img src="/img/clients/${esc(logo)}" alt="${esc(name)}" loading="lazy" decoding="async">`
    : `<span class="mono-chip h${i % 6}">${esc(initials(name))}</span><span class="lg-name">${esc(name)}</span>`}<span class="lg-city">${esc(city || '')}${kind ? ` · ${esc(kind)}` : ''}</span></div>`;
  const marquee = (list, reverse) => `<div class="mq${reverse ? ' rev' : ''}"><div class="mq-track">${[...list, ...list].map((c, i) => tile(c, i)).join('')}</div></div>`;

  const footer = () => {
    const l = L(); const c = l.contact || {}; const g = l.legal || {};
    return `<footer class="lp-foot"><div class="lp-foot-in">
      <div class="lp-foot-brand">${BB.brand('')}<p>Recruitment made only for the jewellery business. A BrillBrains Consultants company, in the industry since 2011.</p></div>
      <div><b>Job seekers</b><a href="/apply">Apply for a job</a><a href="/my-profile">Candidate login</a><a href="/#openings">Current openings</a></div>
      <div><b>Employers</b><a href="/hire">Hire with us</a><a href="/my-account">Client login</a><a href="/partners">Partner with us</a></div>
      <div><b>Talk to us</b>${(c.phones || []).map((p) => `<a href="tel:${esc(p.replace(/\s/g, ''))}" data-no-i18n>${esc(p)}</a>`).join('')}${c.email ? `<a href="mailto:${esc(c.email)}" data-no-i18n>${esc(c.email)}</a>` : ''}<a href="https://wa.me/91${esc(BB.boot.business.support_phone)}" target="_blank" rel="noopener">Chat on WhatsApp</a></div>
    </div><div class="lp-legal"><span>© ${new Date().getFullYear()} ${esc(BB.boot.business.name)}</span>${c.site ? `<a href="${esc(c.site)}" target="_blank" rel="noopener">brillbrainsconsultants.com</a>` : ''}${g.terms ? `<a href="${esc(g.terms)}" target="_blank" rel="noopener">Terms</a>` : ''}${g.privacy ? `<a href="${esc(g.privacy)}" target="_blank" rel="noopener">Privacy</a>` : ''}${g.refund ? `<a href="${esc(g.refund)}" target="_blank" rel="noopener">Refunds</a>` : ''}</div></footer>`;
  };
  const top = () => BB.publicTop('', true).replace('<a href="/my-account">Client login</a><a href="/my-profile">', '<a href="/partners">Partners</a><a href="/my-account">Client login</a><a href="/my-profile">').replace('<hr><a href="/my-account">', '<a href="/partners">Partners</a><hr><a href="/my-account">');
  const faq = (list) => `<div class="faq">${list.map(([q, a]) => `<details class="rv"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
  const head = (eyebrow, title, sub) => `<div class="sec-head rv"><span class="eyebrow">${esc(eyebrow)}</span><h2>${title}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>`;

  const groupIcon = { 'Sales & Showroom': '💎', 'B2B Sales & Business Development': '🤝', Design: '✏️', 'Production & Manufacturing': '🔥', 'Quality & Gemology': '🔍', 'Marketing & Digital': '📣', 'Purchase & Inventory': '📦', 'Dispatch & Logistics': '🚚', 'Accounts & Finance': '📒', 'Admin & HR': '🗂️', 'Support & Others': '🎧' };
  const iconFor = (g) => groupIcon[g] || ['💎', '✏️', '🔥', '🔍', '📒', '📣', '🗂️', '📦', '💠', '🧭', '🛠️'][[...g].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 11];

  BB.views.landing = (r) => {
    const q = (r && r.q) || {}; const l = L(); const clients = l.clients || [];
    const jobs = BB.boot.jobs || []; const groups = [...new Set(jobs.map((j) => j.group))];
    const popular = ['Sales Executive', 'CAD Designer', 'Store Manager', 'Goldsmith (Karigar)', 'Diamond Setter', 'Accountant', 'Gemologist', 'Digital Marketing Executive'].filter((t) => jobs.some((j) => j.title === t));
    const cities = [...new Set(clients.map((c) => c[1]).filter(Boolean))];
    const half = Math.ceil(clients.length / 2);
    const steps = {
      hire: [['Tell us who you need', 'Share the role, city and budget in a two-minute form, or on WhatsApp.'], ['We search and screen', 'Our jewellery recruiters call, check and interview every candidate first.'], ['Meet a shortlist', 'See profiles in your client account and pick interview times that suit you.'], ['Hire and relax', `Pay only when someone joins, with a free replacement for ${BB.boot.replacement_days || 90} days.`]],
      job: [['Share your details', 'Upload your CV or speak your details — in English or Hindi. It is free.'], ['Talk to a recruiter', 'We understand your skills and the job and salary you want.'], ['Interview with brands', 'Get interview dates, reminders and directions on WhatsApp.'], ['Join and grow', 'Accept your offer and start. We stay in touch after you join.']],
    };
    $('#app').innerHTML = `<div class="pub lp">${top()}
      <main>
        <section class="lp-hero">${BB.deco()}
          <div class="lp-hero-in">
            <div class="lp-hero-copy">
              <span class="eyebrow">Jewellery hiring · since 2011</span>
              <h1>Bringing the right <em>people</em> and companies together</h1>
              <p class="lead">Recruitment for the jewellery business — from the showroom floor to the karigar's bench. Tell us who you need, or the job you want, and our recruiters take it from there.</p>
              <form class="lp-search" data-search>
                <label class="ls-f"><span class="lab">Job</span><select name="want">${BB.jobOptions(q.want || '', false)}</select></label>
                <label class="ls-f"><span class="lab">City</span><input name="city" list="cities" placeholder="Any city" autocomplete="off" value="${esc(q.city || '')}"></label>
                <button class="btn gold" type="submit">${BB.icon('search')}<span>Find jobs</span></button>
              </form>
              ${popular.length ? `<div class="lp-chips"><span class="muted small">Popular:</span>${popular.map((t) => `<a class="chip-link" href="/apply?want=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}
              <div class="lp-proof"><div class="lp-faces" aria-hidden="true">${clients.filter((c) => c[3]).slice(0, 5).map((c) => `<span><img src="/img/clients/${esc(c[3])}" alt=""></span>`).join('')}</div><div><b data-no-i18n>${clients.length}+</b> <span>jewellery businesses hire with us across</span> <b data-no-i18n>${cities.length}</b> <span>cities</span></div></div>
            </div>
            <section class="card pub-card lp-card" data-leadcard></section>
          </div>
        </section>

        <section class="lp-sec lp-logos" aria-label="Businesses we hire for">
          <div class="sec-head rv"><span class="eyebrow">Trusted by jewellers</span><h2>Brands that <em>hire with us</em></h2><p>Manufacturers, wholesalers and showrooms across India.</p></div>
          <div class="rv">${marquee(clients.slice(0, half))}${marquee(clients.slice(half), true)}</div>
        </section>

        <section class="lp-stats rv" aria-label="BrillBrains in numbers"><div class="lp-stats-in">
          ${(l.stats || []).map(([n, t]) => `<div class="st"><b data-count="${esc(n)}" data-no-i18n>${esc(n)}</b><span>${esc(t)}</span></div>`).join('')}
        </div></section>

        <section class="lp-sec" id="openings">
          ${head('Hiring now', 'Open <em>jewellery jobs</em>', 'Real openings our recruiters are filling right now. Employer names are shared after your first call.')}
          <div class="jobs-grid" data-jobs><div class="job-card skel"></div><div class="job-card skel"></div><div class="job-card skel"></div></div>
          <div class="center rv"><a class="btn" href="/apply">See all jobs — apply once</a></div>
        </section>

        <section class="lp-sec lp-fields">
          ${head('Browse by field', 'Every role in the <em>jewellery trade</em>', 'From sales and design to karigars, quality and accounts.')}
          <div class="field-grid">${groups.map((g, i) => { const list = jobs.filter((j) => j.group === g); return `<a class="fg rv" style="--d:${(i % 4) * 70}ms" href="/apply?want=${encodeURIComponent(list[0].title)}"><span class="fg-ic" aria-hidden="true">${iconFor(g)}</span><b>${esc(g)}</b><span class="fg-roles">${list.slice(0, 3).map((j) => esc(j.title)).join(' · ')}</span><span class="fg-count" data-group="${esc(g)}">${list.length} roles</span></a>`; }).join('')}</div>
        </section>

        <section class="lp-sec lp-how">
          ${head('How it works', 'Simple for <em>both sides</em>')}
          <div class="seg how-seg rv" role="tablist"><button type="button" class="on" data-how="hire">For employers</button><button type="button" data-how="job">For job seekers</button></div>
          ${Object.entries(steps).map(([k, list]) => `<ol class="how-steps${k === 'hire' ? '' : ' hidden'}" data-steps="${k}">${list.map(([b, s], i) => `<li class="rv" style="--d:${i * 110}ms"><span class="hs-n" data-no-i18n>${i + 1}</span><b>${esc(b)}</b><span>${esc(s)}</span></li>`).join('')}</ol>`).join('')}
        </section>

        <section class="lp-sec lp-why">
          ${head('Why BrillBrains', 'Hiring that <em>understands jewellery</em>')}
          <div class="why-grid">
            ${[['💎', 'Only jewellery', 'We know karat, hallmarking, CAD and the showroom — so we ask candidates the right questions.'], ['✅', 'Screened first', 'Every candidate is called and interviewed before you see them.'], ['💬', 'All on WhatsApp', 'Shortlists, interview times, offers and reminders reach your phone.'], ['🤝', 'Pay on joining', `No upfront fee. Free replacement for ${BB.boot.replacement_days || 90} days if someone leaves.`], ['🗣️', 'English and Hindi', 'Forms, voice typing and accounts work in both languages.'], ['🔒', 'Your data is safe', 'Details are used only for hiring and never shared without consent.']].map(([ic, b, s], i) => `<div class="why rv" style="--d:${(i % 3) * 90}ms"><span class="why-ic" aria-hidden="true">${ic}</span><b>${esc(b)}</b><p>${esc(s)}</p></div>`).join('')}
          </div>
        </section>

        <section class="lp-sec lp-cities">
          ${head('Where we hire', `Across <em>${cities.length} cities</em>`, 'And remote searches anywhere in India.')}
          <div class="city-cloud rv">${cities.map((c, i) => `<a class="city" style="--d:${i * 60}ms" href="/apply?city=${encodeURIComponent(c)}" data-no-i18n><i aria-hidden="true"></i>${esc(c)}</a>`).join('')}</div>
        </section>

        <section class="lp-sec lp-doors">
          <a class="door door-hire rv" href="/hire"><span class="eyebrow">For employers</span><b>Need staff for your showroom or factory?</b><span>Tell us the role — we send screened candidates, usually within a week.</span><span class="btn gold">Start hiring →</span></a>
          <a class="door door-job rv" style="--d:120ms" href="/apply"><span class="eyebrow">For job seekers</span><b>Looking for your next jewellery job?</b><span>One form, free for you. Our recruiters match you to openings.</span><span class="btn">Apply now →</span></a>
        </section>

        <section class="lp-sec lp-partner rv"><div class="lp-partner-in">
          <div><span class="eyebrow">Partners</span><h2>Grow with <em>our network</em></h2><p>Placement agencies, training institutes and industry bodies work with us to place people in jewellery jobs.</p></div>
          <a class="btn gold" href="/partners">Become a partner →</a>
        </div></section>

        <section class="lp-sec">
          ${head('Questions', 'Good to <em>know</em>')}
          ${faq([['Is it free for job seekers?', 'Yes. Candidates never pay anything. Employers pay us only when someone joins.'], ['Which jobs do you hire for?', 'Every role in the jewellery business: sales, design and CAD, karigars and manufacturing, quality, merchandising, accounts, marketing, HR and management.'], ['How fast can you send candidates?', 'Most employers see their first screened profiles within a week of sharing the role.'], ['What if a new hire leaves?', `We find a replacement free of cost if they leave within ${BB.boot.replacement_days || 90} days.`], ['Can I fill the form in Hindi?', 'Yes. Switch to हिन्दी at the top, and type or speak your details.']])}
        </section>
      </main>
      ${footer()}</div>`;
    BB.leadFormCard($('[data-leadcard]'), q.mode === 'hire' ? 'hire' : 'job', q);
    $('[data-search]').onsubmit = (e) => {
      e.preventDefault(); const f = e.target; const p = new URLSearchParams();
      if (f.want.value) p.set('want', f.want.value); if (f.city.value.trim()) p.set('city', f.city.value.trim());
      BB.go(`apply${p.toString() ? `?${p}` : ''}`);
    };
    $$('[data-how]').forEach((b) => (b.onclick = () => {
      $$('[data-how]').forEach((x) => x.classList.toggle('on', x === b));
      $$('[data-steps]').forEach((o) => { const on = o.dataset.steps === b.dataset.how; o.classList.toggle('hidden', !on); if (on) $$('.rv', o).forEach((li) => { li.classList.remove('in'); requestAnimationFrame(() => li.classList.add('in')); }); });
    }));
    animate($('#app'));
    loadJobs();
    if (location.hash === '#openings') setTimeout(() => { const o = $('#openings'); if (o) o.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); }, 60);
  };

  async function loadJobs() {
    const box = $('[data-jobs]'); if (!box) return;
    let d; try { d = await (await fetch('/api/public/jobs')).json(); } catch { d = null; }
    if (!d || !d.jobs || !d.jobs.length) { box.innerHTML = `<div class="jobs-empty rv in"><b>New openings every week</b><span>Send your details once and our recruiters will call you when a matching job opens.</span><a class="btn gold" href="/apply">Send my details</a></div>`; return; }
    const ago = (t) => { const days = Math.floor((Date.now() - new Date(t)) / 864e5); return days <= 0 ? 'Posted today' : days === 1 ? 'Posted yesterday' : days < 30 ? `Posted ${days} days ago` : 'Posted over a month ago'; };
    box.innerHTML = d.jobs.map((j, i) => `<a class="job-card rv" style="--d:${(i % 3) * 80}ms" href="/apply?want=${encodeURIComponent(j.title)}${j.city ? `&city=${encodeURIComponent(j.city)}` : ''}">
      <div class="jc-top"><span class="jc-ic" aria-hidden="true">${iconFor(j.group)}</span><div class="grow"><b>${esc(j.title)}</b><span class="muted small">${esc(j.group)}</span></div>${j.seats > 1 ? `<span class="pill">${j.seats} openings</span>` : ''}</div>
      <div class="jc-meta"><span><i aria-hidden="true">📍</i> <span data-no-i18n>${esc(j.city || 'India')}</span></span><span><i aria-hidden="true">💰</i> <span>${esc(j.salary)}</span></span>${j.exp ? `<span><i aria-hidden="true">🧭</i> <span>${esc(j.exp)}</span></span>` : ''}</div>
      <div class="jc-foot"><span class="muted small">${ago(j.posted)}</span><span class="jc-go">Apply →</span></div></a>`).join('');
    for (const [g, n] of Object.entries(d.groups || {})) { const el = $(`[data-group="${CSS.escape(g)}"]`); if (el) { el.textContent = `${n} open now`; el.classList.add('live'); } }
    animate(box);
  }

  // ---------- partners ----------
  BB.views.partners = () => {
    const l = L(); const share = Math.round(Number(BB.boot.agency_share_pct || 0));
    const kinds = [['🏢', 'Placement agencies', 'Bring candidates for our open jewellery roles and earn on every person who joins.'], ['🎓', 'Training institutes', 'Place your trained students — jewellery design, CAD, gemology, retail sales — in real jobs.'], ['🏛️', 'Industry bodies', 'Associations and chambers: give your member jewellers a trusted hiring desk.'], ['🧑‍💼', 'Independent recruiters', 'Know people in the trade? Refer them and get paid when they are hired.']];
    $('#app').innerHTML = `<div class="pub lp">${top()}
      <main>
        <section class="lp-hero pt-hero">${BB.deco()}
          <div class="lp-hero-in">
            <div class="lp-hero-copy">
              <span class="eyebrow">Partner programme</span>
              <h1>Grow with India's <em>jewellery hiring</em> network</h1>
              <p class="lead">Work with BrillBrains to place people in jewellery jobs. You bring talent or reach, we bring the openings, screening and the employer relationship.</p>
              <ul class="pt-points">
                ${share ? `<li><b data-no-i18n>${share}%</b><span>of our fee shared with you on every hire</span></li>` : ''}
                <li><b data-no-i18n>${(l.clients || []).length}+</b><span>jewellery businesses hiring</span></li>
                <li><b data-no-i18n>${new Set((l.clients || []).map((c) => c[1]).filter(Boolean)).size}</b><span>cities</span></li>
              </ul>
            </div>
            <section class="card pub-card lp-card" data-pform></section>
          </div>
        </section>

        <section class="lp-sec">
          ${head('Who we work with', 'Partners who <em>move people forward</em>')}
          <div class="why-grid">${kinds.map(([ic, b, s], i) => `<div class="why rv" style="--d:${(i % 4) * 90}ms"><span class="why-ic" aria-hidden="true">${ic}</span><b>${esc(b)}</b><p>${esc(s)}</p></div>`).join('')}</div>
        </section>

        <section class="lp-sec lp-how">
          ${head('How it works', 'Three steps to <em>your first placement</em>')}
          <ol class="how-steps">${[['Apply to partner', 'Fill the form. We call you within two working days to understand your network.'], ['Get your partner login', 'See the open roles assigned to you and add candidates from your own login.'], ['Earn on every joining', share ? `When your candidate joins and stays, ${share}% of our fee is yours — paid monthly with a clear statement.` : 'When your candidate joins and stays, you earn your share — paid monthly with a clear statement.']].map(([b, s], i) => `<li class="rv" style="--d:${i * 110}ms"><span class="hs-n" data-no-i18n>${i + 1}</span><b>${esc(b)}</b><span>${esc(s)}</span></li>`).join('')}</ol>
        </section>

        <section class="lp-sec lp-why">
          ${head('What you get', 'Everything to <em>place with confidence</em>')}
          <div class="why-grid">${[['📋', 'Real, verified openings', 'Every role comes from a jewellery business we work with directly.'], ['📲', 'Your own partner login', 'Track each candidate from screening to joining, live.'], ['💬', 'WhatsApp updates', 'Interview times and results reach you and your candidates.'], ['🧾', 'Clear monthly statements', 'See what you earned, per candidate, every month.'], ['🛡️', 'Fair credit', 'The first partner to add a candidate gets the credit for them.'], ['🤝', 'A named contact', 'One person at BrillBrains who knows your account.']].map(([ic, b, s], i) => `<div class="why rv" style="--d:${(i % 3) * 90}ms"><span class="why-ic" aria-hidden="true">${ic}</span><b>${esc(b)}</b><p>${esc(s)}</p></div>`).join('')}</div>
        </section>

        ${(l.partners || []).length ? `<section class="lp-sec">${head('Our partners', 'In <em>good company</em>')}<div class="pt-logos rv">${l.partners.map(([n, t, logo]) => `<div class="pt-logo" data-no-i18n>${logo ? `<img src="/img/clients/${esc(logo)}" alt="${esc(n)}" loading="lazy">` : ''}<b>${esc(n)}</b><span>${esc(t)}</span></div>`).join('')}</div></section>` : ''}

        <section class="lp-sec lp-logos" aria-label="Businesses we hire for">
          <div class="sec-head rv"><span class="eyebrow">The openings come from</span><h2>Jewellers who <em>hire with us</em></h2></div>
          <div class="rv">${marquee(l.clients || [])}</div>
        </section>

        <section class="lp-sec">
          ${head('Questions', 'Partner <em>FAQ</em>')}
          ${faq([['Does it cost anything to become a partner?', 'No. There is no joining fee. You earn when a candidate you added joins.'], ['When do I get paid?', 'Once the candidate joins and the employer pays our fee, your share is paid in the next monthly statement.'], ['Can a training institute partner?', 'Yes. Many of our candidates come from jewellery design, CAD and gemology courses.'], ['What if two partners add the same person?', 'The first partner to add the candidate gets the credit.']])}
        </section>
      </main>
      ${footer()}</div>`;
    partnerForm($('[data-pform]'));
    animate($('#app'));
  };

  function partnerForm(el) {
    const { field } = BB;
    el.innerHTML = `<div class="card-title">Become a partner</div><p class="muted small" style="margin:0 0 14px">We reply within two working days.</p>
      <form class="stack" novalidate>
        <div class="grid g2">${field({ name: 'name', label: 'Your name', attrs: 'autocomplete="name"' })}${field({ name: 'organisation', label: 'Organisation', attrs: 'autocomplete="organization"' })}</div>
        ${field({ name: 'kind', label: 'You are a', type: 'select', options: ['Placement agency', 'Training institute', 'Industry body / association', 'Independent recruiter', 'Other'], voice: false })}
        <div class="grid g2">${field({ name: 'whatsapp', label: 'WhatsApp number', type: 'tel', phone: true, placeholder: '10 digits', attrs: 'inputmode="numeric" maxlength="14" autocomplete="tel"' })}${field({ name: 'email', label: 'Email', type: 'email', opt: true, attrs: 'autocomplete="email"' })}</div>
        ${field({ name: 'city', label: 'City', list: 'cities', placeholder: 'Start typing your city…' })}
        ${field({ name: 'message', label: 'Tell us about your network', type: 'textarea', opt: true, placeholder: 'For example: 40 CAD students a year, or 200 retail candidates' })}
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
        <button class="btn gold block" type="submit">Send partner request</button>
        <p class="muted small center">By sending, you agree that we may contact you on WhatsApp about the partnership.</p>
      </form>`;
    const form = $('form', el);
    form.onsubmit = async (e) => {
      e.preventDefault(); const b = Object.fromEntries(new FormData(form)); b.src = (BB.parseHash().q || {}).src || 'Website';
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        await BB.post('/api/public/partner', b, { kind: null });
        BB.track('Lead', { content_name: 'Partner request', content_category: 'Partner' });
        el.innerHTML = `<div class="pt-done"><span class="ty-check" aria-hidden="true">✓</span><div class="card-title">Thank you!</div><p>Your partner request has reached our team. We will call you on WhatsApp within two working days.</p><a class="btn" href="/">Back to home</a></div>`;
      } catch (err) { BB.showErr(form, err); btn.disabled = false; }
    };
  }
})();
