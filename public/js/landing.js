/* Home page (hire.brillbrainsconsultants.com) and the partners page (/partners).
   Home, top to bottom: hero (job search + the form the ads point to), proof band (numbers + client logos),
   open jobs (filter by field), how it works (both sides at once), why us, three doors (hire / job / partner),
   questions, footer. Trust content (numbers, clients, legal links) comes from settings.landing. */
(() => {
  const { $, $$, esc } = BB;
  const L = () => BB.boot.landing || { stats: [], clients: [], partners: [], legal: {}, contact: {} };
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const days = () => BB.boot.replacement_days || 90;

  // Sections fade up as they scroll into view; numbers count up once.
  function animate(root) {
    const els = $$('.rv:not(.in)', root);
    if (!('IntersectionObserver' in window) || reduced()) { els.forEach((e) => e.classList.add('in')); $$('[data-count]', root).forEach((e) => (e.textContent = e.dataset.count)); return; }
    const io = new IntersectionObserver((list) => list.forEach((x) => {
      if (!x.isIntersecting) return; io.unobserve(x.target); x.target.classList.add('in');
      $$('[data-count]', x.target).forEach(countUp);
    }), { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
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
  const tile = ([name, city, , logo]) => `<div class="lg-tile${logo ? ' has-logo' : ''}" data-no-i18n title="${esc(name)}${city ? ` · ${esc(city)}` : ''}">${logo
    ? `<img src="/img/clients/${esc(logo)}" alt="${esc(name)}" loading="lazy" decoding="async">`
    : `<span class="mono">${esc(initials(name))}</span><span class="lg-name">${esc(name)}</span>`}</div>`;
  const marquee = (list, reverse) => `<div class="mq${reverse ? ' rev' : ''}"><div class="mq-track">${[...list, ...list].map(tile).join('')}</div></div>`;

  const footer = () => {
    const l = L(); const c = l.contact || {}; const g = l.legal || {};
    return `<footer class="lp-foot"><div class="lp-foot-in">
      <div class="lp-foot-brand">${BB.brand('')}<p>Hiring for the jewellery trade, since 2011.</p></div>
      <div><b>Job seekers</b><a href="/apply">Apply</a><a href="/my-profile">Candidate login</a><a href="/#openings">Open jobs</a></div>
      <div><b>Employers</b><a href="/hire">Hire with us</a><a href="/my-account">Client login</a><a href="/partners">Partners</a></div>
      <div><b>Talk to us</b>${(c.phones || []).map((p) => `<a href="tel:${esc(p.replace(/\s/g, ''))}" data-no-i18n>${esc(p)}</a>`).join('')}${c.email ? `<a href="mailto:${esc(c.email)}" data-no-i18n>${esc(c.email)}</a>` : ''}<a href="https://wa.me/91${esc(BB.boot.business.support_phone)}" target="_blank" rel="noopener">WhatsApp</a></div>
    </div><div class="lp-legal"><span>© ${new Date().getFullYear()} ${esc(BB.boot.business.name)}</span>${c.site ? `<a href="${esc(c.site)}" target="_blank" rel="noopener">brillbrainsconsultants.com</a>` : ''}${g.terms ? `<a href="${esc(g.terms)}" target="_blank" rel="noopener">Terms</a>` : ''}${g.privacy ? `<a href="${esc(g.privacy)}" target="_blank" rel="noopener">Privacy</a>` : ''}${g.refund ? `<a href="${esc(g.refund)}" target="_blank" rel="noopener">Refunds</a>` : ''}</div></footer>`;
  };
  const MAIN = 'https://brillbrainsconsultants.com';
  const top = () => BB.publicTop('', true)
    .replace('<a href="/my-account">Client login</a><a href="/my-profile">', `<a href="/partners">Partners</a><a href="${MAIN}" target="_blank" rel="noopener">BrillBrains ↗</a><a href="/my-account">Client login</a><a href="/my-profile">`)
    .replace('<hr><a href="/my-account">', `<a href="/partners">Partners</a><a href="${MAIN}" target="_blank" rel="noopener">BrillBrains ↗</a><hr><a href="/my-account">`);
  const faq = (list) => `<div class="faq">${list.map(([q, a]) => `<details class="rv"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
  // Section heading: eyebrow and title on the left, a short line (or a link) on the right.
  const head = (eyebrow, title, side) => `<div class="sec-head rv"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${title}</h2></div>${side ? `<div class="sec-side">${side}</div>` : ''}</div>`;
  // Proof band: the numbers, then the businesses we hire for sliding past.
  const proof = (l, title) => {
    const list = l.clients || []; const half = Math.ceil(list.length / 2);
    return `<section class="lp-proof-band rv" aria-label="BrillBrains in numbers"><div class="pb-in">
      <div class="pb-top"><div class="pb-copy"><span class="eyebrow">BrillBrains group</span><h2>${title}</h2><p>A BrillBrains Consultants company. <a href="${MAIN}" target="_blank" rel="noopener">brillbrainsconsultants.com ↗</a></p></div>
        <div class="pb-stats">${(l.stats || []).filter(([, t]) => !/businesses/i.test(t)).map(([n, t]) => `<div class="st"><b data-count="${esc(n)}" data-no-i18n>${esc(n)}</b><span>${esc(t)}</span></div>`).join('')}</div></div>
      <div class="pb-logos">${marquee(list.slice(0, half))}${marquee(list.slice(half), true)}</div></div></section>`;
  };
  const steps = (list) => `<ol class="tl">${list.map(([b, s], i) => `<li class="rv" style="--d:${i * 90}ms"><span class="tl-n" data-no-i18n>${String(i + 1).padStart(2, '0')}</span><div><b>${esc(b)}</b><span>${esc(s)}</span></div></li>`).join('')}</ol>`;

  BB.views.landing = (r) => {
    const q = (r && r.q) || {}; const l = L(); const clients = l.clients || [];
    const jobs = BB.boot.jobs || [];
    const popular = ['Sales Executive', 'CAD Designer', 'Store Manager', 'Goldsmith (Karigar)', 'Accountant', 'Gemologist'].filter((t) => jobs.some((j) => j.title === t));
    const cities = [...new Set(clients.map((c) => c[1]).filter(Boolean))];
    $('#app').innerHTML = `<div class="pub lp">${top()}
      <main>
        <section class="lp-hero">${BB.deco()}
          <div class="lp-hero-in">
            <div class="lp-hero-copy">
              <span class="eyebrow">Jewellery hiring · since 2011</span>
              <h1>Bringing the right <em>people</em> and companies together</h1>
              <p class="lead">From the showroom floor to the karigar's bench.</p>
              <form class="lp-search" data-search>
                <label class="ls-f"><span class="lab">Job</span><select name="want">${BB.jobOptions(q.want || '', false)}</select></label>
                <label class="ls-f"><span class="lab">City</span><input name="city" list="cities" placeholder="Any city" autocomplete="off" value="${esc(q.city || '')}"></label>
                <button class="btn gold" type="submit">${BB.icon('search')}<span>Find jobs</span></button>
              </form>
              ${popular.length ? `<div class="lp-chips">${popular.map((t) => `<a class="chip-link" href="/?want=${encodeURIComponent(t)}#openings" data-want="${esc(t)}">${esc(t)}</a>`).join('')}</div>` : ''}
              <div class="lp-proof"><div class="lp-faces" aria-hidden="true">${clients.filter((c) => c[3]).slice(0, 5).map((c) => `<span><img src="/img/clients/${esc(c[3])}" alt=""></span>`).join('')}</div><div><b data-no-i18n>${clients.length}+</b> <span>jewellers in</span> <b data-no-i18n>${cities.length}</b> <span>cities hire with us</span></div></div>
            </div>
            <section class="card pub-card lp-card" data-leadcard></section>
          </div>
        </section>

        ${proof(l, 'Trusted by <em>leading jewellers</em>')}

        <section class="lp-sec" id="openings">
          ${head('Hiring now', 'Open <em>jobs</em>', '<span>Employer names are shared after your first call.</span>')}
          <div class="pills rv" data-pills></div>
          <div class="search-bar hidden" data-sbar></div>
          <div class="jobs-grid" data-jobs><div class="job-card skel"></div><div class="job-card skel"></div><div class="job-card skel"></div></div>
          <div data-similar></div>
        </section>

        <section class="lp-sec lp-how">
          ${head('How it works', 'Simple for <em>both sides</em>')}
          <div class="how-cols">
            <div class="how-col rv"><span class="how-tag">For employers</span>${steps([['Share the role', 'Two-minute form or WhatsApp.'], ['We screen', 'Every candidate is called and interviewed.'], ['Meet a shortlist', 'Pick interview times in your account.'], ['Pay on joining', `Free replacement for ${days()} days.`]])}<a class="btn gold" href="/hire">Start hiring →</a></div>
            <div class="how-col alt rv" style="--d:120ms"><span class="how-tag">For job seekers</span>${steps([['Send your details', 'CV or voice, English or Hindi.'], ['Talk to a recruiter', 'Tell us the job and salary you want.'], ['Interview', 'Dates and reminders on WhatsApp.'], ['Join', 'Free for you, always.']])}<a class="btn" href="/apply">Apply now →</a></div>
          </div>
        </section>

        <section class="lp-sec lp-why">
          ${head('Why BrillBrains', 'Hiring that <em>knows jewellery</em>')}
          <div class="why-row">${[['Only jewellery', 'Karat, hallmarking, CAD, showroom — we speak it.'], ['Screened first', 'You meet people we have already interviewed.'], ['Pay on joining', 'No upfront fee.'], ['On WhatsApp', 'Shortlists, interviews and offers on your phone.']].map(([b, s], i) => `<div class="why rv" style="--d:${i * 80}ms"><b>${esc(b)}</b><p>${esc(s)}</p></div>`).join('')}</div>
        </section>

        <section class="lp-sec lp-doors">
          <a class="door door-hire rv" href="/hire"><span class="eyebrow">Employers</span><b>Need staff?</b><span>Screened candidates, usually within a week.</span><span class="door-go">Start hiring →</span></a>
          <a class="door door-job rv" style="--d:90ms" href="/apply"><span class="eyebrow">Job seekers</span><b>Want a jewellery job?</b><span>One form. Free for you.</span><span class="door-go">Apply now →</span></a>
          <a class="door door-partner rv" style="--d:180ms" href="/partners"><span class="eyebrow">Partners</span><b>Place people with us</b><span>Agencies, institutes and recruiters.</span><span class="door-go">Become a partner →</span></a>
        </section>

        <section class="lp-sec lp-faq">
          ${head('Questions', 'Good to <em>know</em>')}
          ${faq([['Is it free for job seekers?', 'Yes. Employers pay only when someone joins.'], ['Which jobs do you hire for?', 'Every jewellery role — sales, design, CAD, karigars, quality, accounts, marketing and more.'], ['How fast are candidates sent?', 'Usually within a week.'], ['What if a new hire leaves?', `Free replacement within ${days()} days.`]])}
        </section>
      </main>
      ${footer()}</div>`;
    BB.leadFormCard($('[data-leadcard]'), q.mode === 'hire' ? 'hire' : 'job', q);
    // Searching shows the matching openings right here (the address keeps the search, so Back works).
    const search = (p) => {
      const sp = new URLSearchParams(); for (const [k, v] of Object.entries(p)) if (v) sp.set(k, v);
      const url = `/${sp.toString() ? `?${sp}` : ''}`; if (location.pathname + location.search !== url) history.pushState(null, '', url);
      const f = $('[data-search]'); f.want.value = p.want || ''; f.city.value = p.city || '';
      // The form beside the search picks up the same job and city, so nothing is typed twice.
      const lf = $('[data-leadcard] form');
      if (lf && p.want && lf.job_wanted && [...lf.job_wanted.options].some((o) => o.value === p.want)) lf.job_wanted.value = p.want;
      if (lf && p.city && lf.city && !lf.city.value) lf.city.value = p.city;
      loadJobs(p, true);
    };
    $('[data-search]').onsubmit = (e) => { e.preventDefault(); const f = e.target; search({ want: f.want.value, city: f.city.value.trim() }); };
    $$('[data-want]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); search({ want: a.dataset.want, city: $('[data-search]').city.value.trim() }); }));
    BB.landingSearch = search;
    animate($('#app'));
    const asked = q.want || q.city || q.group;
    loadJobs({ want: q.want, city: q.city, group: q.group }, !!asked);
    if (!asked && location.hash === '#openings') setTimeout(() => { const o = $('#openings'); if (o) o.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); }, 60);
  };

  const ago = (t) => { const d = Math.floor((Date.now() - new Date(t)) / 864e5); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 30 ? `${d} days ago` : 'Over a month ago'; };
  // One opening. Apply opens the form for this exact job, with the role and city already filled in.
  const jobCard = (j, i) => `<a class="job-card rv" style="--d:${(i % 3) * 70}ms" href="/apply?job=${encodeURIComponent(j.id)}&want=${encodeURIComponent(j.title)}${j.city ? `&city=${encodeURIComponent(j.city)}` : ''}">
      <div class="jc-top"><span class="jc-group">${esc(j.group)}</span>${j.seats > 1 ? `<span class="pill">${j.seats} openings</span>` : ''}</div>
      <b class="jc-title">${esc(j.title)}</b>
      <div class="jc-meta"><span data-no-i18n>${esc(j.city || 'India')}</span><span>${esc(j.salary)}</span>${j.exp ? `<span>${esc(j.exp)}</span>` : ''}</div>
      <div class="jc-foot"><span class="faint small">${ago(j.posted)}</span><span class="jc-go">Apply →</span></div></a>`;

  const groupOf = (t) => ((BB.boot.jobs || []).find((j) => j.title === t) || {}).group || 'Other roles';
  const featured = () => (BB.boot.landing_roles || []).map((t) => ({ title: t, group: groupOf(t) }));
  const featCard = (j, i) => `<a class="job-card feat rv" style="--d:${(i % 3) * 70}ms" href="/apply?want=${encodeURIComponent(j.title)}">
      <div class="jc-top"><span class="jc-group">${esc(j.group)}</span><span class="pill">Hiring now</span></div>
      <b class="jc-title">${esc(j.title)}</b>
      <div class="jc-meta"><span>Salary as per experience</span></div>
      <div class="jc-foot"><span class="faint small">Multiple openings</span><span class="jc-go">Apply →</span></div></a>`;

  // Openings: the latest ones, or what the search asked for (p: want, city, group). scroll: bring the results into view.
  async function loadJobs(p = {}, scroll) {
    const box = $('[data-jobs]'); if (!box) return;
    const bar = $('[data-sbar]'); const sim = $('[data-similar]'); const pills = $('[data-pills]');
    const searching = !!(p.want || p.city || p.group);
    const qs = new URLSearchParams(); if (p.want) qs.set('title', p.want); if (p.city) qs.set('city', p.city); if (p.group) qs.set('group', p.group);
    if (searching) box.innerHTML = '<div class="job-card skel"></div><div class="job-card skel"></div><div class="job-card skel"></div>';
    if (scroll) { const o = $('#openings'); if (o) o.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); }
    let d; try { d = await (await fetch(`/api/public/jobs${qs.toString() ? `?${qs}` : ''}`)).json(); } catch { d = null; }
    // Featured roles join the list unless a live opening already has that title.
    const liveTitles = new Set(((d && d.jobs) || []).map((j) => j.title));
    const want = String(p.want || '').toLowerCase();
    const feats = featured().filter((f) => !liveTitles.has(f.title) && (!p.group || f.group === p.group) && (!want || f.title.toLowerCase().includes(want) || want.includes(f.title.toLowerCase())));
    // Field pills: every field that has open jobs (or featured roles), with how many; the active one is highlighted.
    const counts = { ...((d && d.groups) || {}) }; for (const f of featured()) counts[f.group] = (counts[f.group] || 0) + 1;
    const groups = Object.entries(counts); const total = groups.reduce((n, [, c]) => n + c, 0);
    pills.innerHTML = groups.length ? `<button type="button" class="${!p.group && !p.want ? 'on' : ''}" data-g="">All <i data-no-i18n>${total}</i></button>${groups.map(([g, n]) => `<button type="button" class="${p.group === g ? 'on' : ''}" data-g="${esc(g)}">${esc(g)} <i data-no-i18n>${n}</i></button>`).join('')}` : '';
    $$('[data-g]', pills).forEach((b) => (b.onclick = () => BB.landingSearch(b.dataset.g ? { group: b.dataset.g } : {})));
    const what = p.want || p.group || 'jewellery'; const where = p.city ? ` in ${p.city}` : '';
    const applyLink = `/apply?${new URLSearchParams(Object.entries({ want: p.want || '', city: p.city || '' }).filter(([, v]) => v))}`;
    sim.innerHTML = '';
    if (searching && !(p.group && !p.want && !p.city)) {
      const n = (d && d.jobs ? d.jobs.length : 0) + feats.length;
      bar.classList.remove('hidden');
      bar.innerHTML = `<div class="sb-text">${n ? `<b data-no-i18n>${n}</b> <span>${n === 1 ? 'opening for' : 'openings for'}</span> <b data-no-i18n>${esc(what)}${esc(where)}</b>` : `<span>You searched for</span> <b data-no-i18n>${esc(what)}${esc(where)}</b>`}</div><button type="button" class="btn sm" data-clear>✕ Clear</button>`;
      $('[data-clear]', bar).onclick = () => BB.landingSearch({});
    } else { bar.classList.add('hidden'); bar.innerHTML = ''; }
    if ((d && d.jobs && d.jobs.length) || feats.length) box.innerHTML = [...((d && d.jobs) || []).map(jobCard), ...feats.map((f, i) => featCard(f, i))].join('');
    else {
      box.innerHTML = `<div class="jobs-empty rv in"><b>${searching ? 'No match right now' : 'New jobs every week'}</b><span>Send your details — we call when a match opens.</span><a class="btn gold" href="${searching ? applyLink : '/apply'}">Send my details</a></div>`;
    }
    if (searching && d && d.similar && d.similar.length) sim.innerHTML = `<h3 class="sim-head rv">Similar openings</h3><div class="jobs-grid">${d.similar.map(jobCard).join('')}</div>`;
    animate($('#openings'));
  }

  // ---------- partners ----------
  BB.views.partners = () => {
    const l = L(); const share = Math.round(Number(BB.boot.agency_share_pct || 0));
    const partnerLogos = (l.partners || []).filter((p) => p[2]);
    $('#app').innerHTML = `<div class="pub lp">${top()}
      <main>
        <section class="lp-hero pt-hero">${BB.deco()}
          <div class="lp-hero-in">
            <div class="lp-hero-copy">
              <span class="eyebrow">Partner programme</span>
              <h1>Grow with India's <em>jewellery hiring</em> network</h1>
              <p class="lead">You bring the people. We bring the jobs.</p>
              <ul class="pt-points">
                ${share ? `<li><b data-no-i18n>${share}%</b><span>of our fee is yours</span></li>` : ''}
                <li><b data-no-i18n>${(l.clients || []).length}+</b><span>jewellers hiring</span></li>
                <li><b>₹0</b><span>to join</span></li>
              </ul>
              ${partnerLogos.length ? `<div class="pt-with"><span class="faint small">Partnered with</span>${partnerLogos.map(([n, , logo]) => `<img src="/img/clients/${esc(logo)}" alt="${esc(n)}" title="${esc(n)}">`).join('')}</div>` : ''}
            </div>
            <section class="card pub-card lp-card" data-pform></section>
          </div>
        </section>

        <section class="lp-sec lp-why">
          ${head('Who can partner', 'Built for <em>people networks</em>')}
          <div class="why-row">${[['Placement agencies', 'Fill our open roles.'], ['Training institutes', 'Place your students.'], ['Industry bodies', 'A hiring desk for members.'], ['Independent recruiters', 'Refer and earn.']].map(([b, s], i) => `<div class="why rv" style="--d:${i * 80}ms"><b>${esc(b)}</b><p>${esc(s)}</p></div>`).join('')}</div>
        </section>

        <section class="lp-sec lp-how">
          ${head('How it works', 'Three steps to <em>your first placement</em>')}
          <div class="how-cols one"><div class="how-col rv">${steps([['Apply', 'We call within two working days.'], ['Get your login', 'See open roles and add candidates.'], ['Earn', share ? `${share}% of our fee on every joining, paid monthly.` : 'Your share on every joining, paid monthly.']])}</div></div>
        </section>

        ${proof(l, 'The jobs come from <em>leading jewellers</em>')}

        <section class="lp-sec lp-faq">
          ${head('Questions', 'Partner <em>FAQ</em>')}
          ${faq([['Is there a joining fee?', 'No. You earn when your candidate joins.'], ['When do I get paid?', 'In the monthly statement after the employer pays.'], ['Two partners, same person?', 'The first to add them gets the credit.']])}
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
        ${field({ name: 'message', label: 'Tell us about your network', type: 'textarea', opt: true, placeholder: 'For example: 40 CAD students a year' })}
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
        <button class="btn gold block" type="submit">Send partner request</button>
        <p class="muted small center">By sending, you agree to be contacted on WhatsApp.</p>
      </form>`;
    const form = $('form', el);
    form.onsubmit = async (e) => {
      e.preventDefault(); const b = Object.fromEntries(new FormData(form)); b.src = (BB.parseHash().q || {}).src || 'Website';
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        await BB.post('/api/public/partner', b, { kind: null });
        BB.track('Lead', { content_name: 'Partner request', content_category: 'Partner' });
        el.innerHTML = `<div class="pt-done"><span class="ty-check" aria-hidden="true">✓</span><div class="card-title">Thank you!</div><p>We will call you on WhatsApp within two working days.</p><a class="btn" href="/">Back to home</a></div>`;
      } catch (err) { BB.showErr(form, err); btn.disabled = false; }
    };
  }
})();
