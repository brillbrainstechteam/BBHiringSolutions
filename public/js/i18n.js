/* English / हिन्दी for everything clients and job seekers see: forms, logins, thank-you pages, both accounts.
   Screens are written in English; when Hindi is on, each piece of text is swapped for its Hindi line from
   BB.HI (i18n-hi.js) as it appears — exact lines first, then patterns for lines with a number or name in them.
   Names, IDs, amounts and dates are data and stay as they are. The team portal stays in English. */
(() => {
  const { $$ } = BB;
  const KEY = 'bbhs.lang';
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  // A link can open in a language: …/apply?lang=hi (handy for Hindi ads and WhatsApp shares).
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'hi' || fromUrl === 'en') { try { localStorage.setItem(KEY, fromUrl); } catch { /* private window */ } }
  BB.lang = (fromUrl || read()) === 'hi' ? 'hi' : 'en';
  const HI = () => BB.HI || { exact: {}, patterns: [] };
  const exact = new Map();
  const loadExact = () => { exact.clear(); for (const [en, hi] of Object.entries(HI().exact)) exact.set(norm(en), hi); };
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  BB.i18nMissing = new Set(); // filled while testing (BB.i18nDebug = true): English left on a Hindi screen

  // One line of English → Hindi (or the same line when we have none).
  BB.tr = (text) => {
    if (BB.lang !== 'hi' || !text) return text;
    const key = norm(String(text)); if (!key || !/[A-Za-z]/.test(key)) return text;
    if (!exact.size) loadExact();
    if (exact.has(key)) return exact.get(key);
    for (const [re, to] of HI().patterns) { const m = key.match(re); if (m) return typeof to === 'function' ? to(key, ...m.slice(1)) : key.replace(re, to); }
    if (BB.i18nDebug && !/[ऀ-ॿ]/.test(key)) BB.i18nMissing.add(key);
    return text;
  };
  const active = () => BB.lang === 'hi' && document.body && document.body.dataset.view !== 'team';
  // Never translated: what people typed (inputs, text areas), chat messages, IDs, and anything marked data-no-i18n.
  const SKIP = 'script, style, textarea, .mono, [data-no-i18n], .env-ribbon, .msg';
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const doText = (n) => {
    const p = n.parentElement; if (!p || p.closest(SKIP)) return;
    const raw = n.nodeValue; if (!/[A-Za-z]/.test(raw)) return;
    const out = BB.tr(raw); if (out === raw) return;
    const lead = raw.match(/^\s*/)[0]; const trail = raw.match(/\s*$/)[0];
    const next = lead + out.trim() + trail;
    if (next !== raw) n.nodeValue = next; // writing the same text again would wake the observer forever
  };
  const doEl = (el) => { if (el.closest(SKIP)) return; for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && /[A-Za-z]/.test(v)) { const t = BB.tr(v); if (t !== v) el.setAttribute(a, t); } } };
  BB.translate = (root) => {
    if (!active() || !root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    doEl(root); for (const el of root.querySelectorAll('[placeholder], [title], [aria-label]')) doEl(el);
    // Headings with a highlighted word are swapped whole, so the Hindi word order is right.
    const html = HI().html || {};
    for (const em of [...root.querySelectorAll('em'), ...(root.tagName === 'EM' ? [root] : [])]) {
      const h = em.parentElement; if (!h || h.dataset.tr || h.closest(SKIP)) continue;
      const hi = html[norm(h.textContent)]; if (hi) { h.dataset.tr = '1'; h.innerHTML = hi; }
    }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; const list = [];
    while ((n = w.nextNode())) list.push(n);
    list.forEach(doText);
  };
  // Anything drawn later (tabs, dialogs, messages, errors) is translated as it appears.
  // Safety stop: if translating ever keeps re-triggering itself, switch it off (the page stays usable in English).
  let burst = 0; let burstAt = 0; const recent = [];
  const mo = new MutationObserver((recs) => {
    if (!active()) return;
    const t = Date.now(); if (t - burstAt > 1000) { burst = 0; burstAt = t; }
    if ((burst += recs.length) > 5000) { mo.disconnect(); console.warn('translator stopped: it kept re-running on', recent.slice(-5)); return; }
    for (const r of recs) if (r.type === 'characterData') { recent.push(r.target.nodeValue); if (recent.length > 20) recent.shift(); }
    for (const r of recs) {
      if (r.type === 'characterData') doText(r.target);
      else for (const n of r.addedNodes) BB.translate(n);
    }
  });
  const origTitle = document.title;
  BB.startTranslator = () => { mo.observe(document.body, { childList: true, subtree: true, characterData: true }); BB.translate(document.body); if (active()) document.title = BB.tr(origTitle); };

  // The switch in the top bar. The choice is kept on this device, and on the account when logged in,
  // so WhatsApp messages come in the same language.
  BB.langSwitch = () => `<div class="seg lang-seg" data-lang-seg role="group" aria-label="Language" data-no-i18n><button type="button" data-ui="en" class="${BB.lang === 'en' ? 'on' : ''}" aria-label="English"><span class="long">English</span><span class="short">EN</span></button><button type="button" data-ui="hi" class="${BB.lang === 'hi' ? 'on' : ''}" aria-label="हिन्दी"><span class="long">हिन्दी</span><span class="short">हि</span></button></div>`;
  BB.setLang = async (l, save = true) => {
    BB.lang = l === 'hi' ? 'hi' : 'en';
    try { localStorage.setItem(KEY, BB.lang); } catch { /* private window */ }
    document.documentElement.lang = BB.lang;
    BB.voiceLang = BB.lang === 'hi' ? 'hi-IN' : 'en-IN'; try { localStorage.setItem('bbhs.voice', BB.voiceLang); } catch { /* ok */ }
    if (save) {
      const kind = BB.portal === 'client' || BB.portal === 'candidate' ? BB.portal : null;
      if (kind && BB.token(kind)) BB.post(kind === 'client' ? '/api/client/language' : '/api/cand/language', { language: BB.lang }).catch(() => {});
    }
    BB.route(); // draw the screen again in the new language
  };
  // Logging in on a new phone: the account's language is used until the person picks one on this device.
  BB.adoptLang = (l) => { if (!read() && (l === 'hi' || l === 'en') && l !== BB.lang) BB.setLang(l, false); };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-lang-seg] button'); if (b && b.dataset.ui !== BB.lang) BB.setLang(b.dataset.ui); });
  document.documentElement.lang = BB.lang;
})();
