// Search and AI discovery for the public site: robots.txt, sitemap.xml, llms.txt, canonical and structured data
// for the app's public pages, server-rendered employer pages (/jewellery-recruitment and one page per role family),
// prerendered home and open-roles content, and JobPosting data for open jobs. Nothing here touches the team portal.
// Facts come from the business settings and the role list; nothing is invented (no ratings, reviews or numbers).
const D = require('./db');
const L = require('./logic');

const e = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const biz = () => D.settings().business || {};
const base = () => String(biz().base_url || 'https://hire.brillbrainsconsultants.com').replace(/\/$/, '');
const OPEN = ['Open', 'Sourcing', 'Interviewing', 'Offer stage'];
const openJobs = () => D.all('SELECT * FROM jobs WHERE archived=0 AND is_sample=0 ORDER BY created_at DESC').map((j) => ({ j, v: require('./views').jobView(j) })).filter((x) => OPEN.includes(x.v.status));
const replacementDays = () => D.settings().replacement_days || 90;
const phone = () => String(biz().support_phone || '').replace(/\D/g, '').slice(-10);
const cta = (src, label = 'Submit a hiring requirement') => `<a class="btn" href="/hire?src=${e(src)}" data-ev="hiring_cta_click">${e(label)}</a>`;

// ---------- the employer pages: one hub and one page per family of roles ----------
// Each family lists the real role titles from the portal's role list (Settings › Departments & roles).
const FAMILIES = [
  { slug: 'jewellery-sales-staff', groups: ['Retail Sales'], name: 'Jewellery sales staff',
    h1: 'Hire jewellery sales staff for your showroom',
    intro: 'Sales executives, diamond and bridal consultants and counter staff who already know how jewellery is sold: purity and hallmarks, making charges, old-gold exchange and the long conversations a bridal purchase takes.',
    know: ['Gold purity (22K, 18K), BIS hallmarking and HUID, and how to explain them to a customer', 'Making charges, wastage and old-gold exchange', 'Diamond basics (the 4Cs, certificates) for diamond counters', 'Handling high-value stock on the counter, and showroom security routines', 'Following up with walk-ins and repeat customers on WhatsApp'],
    ask: ['Which counters (gold, diamond, silver, bridal) and the price range you sell', 'Languages your customers speak', 'Salary range, incentives and working hours, including weekends and festive season', 'Showroom location, so we look for people who can travel to it'] },
  { slug: 'jewellery-store-managers', groups: ['Retail Operations'], extra: ['Store Manager', 'Showroom Manager', 'Assistant Store Manager'], name: 'Store managers and showroom operations staff',
    h1: 'Hire jewellery store managers and showroom staff',
    intro: 'Store managers, cashiers, billing and store operations staff for jewellery showrooms: people who can run the floor, the stock and the cash with the controls a jewellery store needs.',
    know: ['Daily stock tally and the opening and closing routine', 'Billing with GST, old-gold and scheme accounts', 'Leading a sales team and meeting monthly targets', 'Customer complaints, repairs and after-sales', 'Store opening for a new showroom: hiring and training the first team'],
    ask: ['Showroom size and how many people the manager will lead', 'Billing or ERP software you use', 'Targets and incentive structure', 'Whether this is a new showroom (and its opening date)'] },
  { slug: 'jewellery-cad-designers', groups: ['Design & CAD'], name: 'Jewellery designers and CAD designers',
    h1: 'Hire jewellery CAD designers and jewellery designers',
    intro: 'CAD designers (Matrix, Rhino and similar), 3D renderers, hand-sketch artists and senior designers who design pieces that can actually be made: weights, stone settings and production limits in mind.',
    know: ['CAD software you work in: Matrix, Rhino, ZBrush, JewelCAD or others', 'Designing for casting: wall thickness, prongs and settings, metal weight', 'Rendering for catalogues and e-commerce', 'Hand sketching for customer and bridal orders', 'Working with the production floor and karigars on samples'],
    ask: ['The software your team uses', 'Product type: bridal, daily wear, diamond, temple, kundan, silver', 'Whether a design test is part of your selection', 'Portfolio expectations and experience level'] },
  { slug: 'jewellery-karigars-and-production-staff', groups: ['Production & Manufacturing'], name: 'Karigars and production staff',
    h1: 'Hire karigars and jewellery production staff',
    intro: 'Goldsmiths (karigars), setters, polishers, casters, wax model makers, filers and production supervisors for jewellery manufacturing units and workshops.',
    know: ['The craft: handmade, casting, CNC or machine-made', 'Setting styles: prong, pave, micro-pave, kundan and others', 'Metal loss control and job-card discipline', 'Working to timelines for B2B and export orders', 'Workshop safety and handling of gold and stones'],
    ask: ['The exact craft and product type', 'Piece-rate or monthly salary, and stay or travel arrangements', 'Workshop location and shift timings', 'Whether a practical trial is part of your selection'] },
  { slug: 'gemologists-and-quality-staff', groups: ['Quality, Gemology & Hallmarking'], name: 'Gemologists, diamond graders and quality staff',
    h1: 'Hire gemologists, diamond graders and quality control staff',
    intro: 'Gemologists, diamond graders and assorters, quality checkers, hallmarking and assaying staff for manufacturers, wholesalers, labs and retailers.',
    know: ['Diamond grading and assorting (natural and lab-grown)', 'Coloured stone identification', 'Quality checks on finished jewellery: finish, setting, weight and purity', 'BIS hallmarking process and HUID', 'Certificates and lab reports (for example from GIA, IGI or SGL)'],
    ask: ['Natural, lab-grown or coloured stones', 'Certifications you require (for example a GIA or IIG qualification)', 'Lot sizes and grading parameters you work with', 'Whether this role signs off on hallmarking or customer certificates'] },
  { slug: 'jewellery-b2b-sales-and-business-development', groups: ['B2B Sales & Business Development'], name: 'B2B sales and business development',
    h1: 'Hire B2B and wholesale sales staff for your jewellery business',
    intro: 'Wholesale and B2B sales executives, export sales, business development and key account managers who sell to retailers, chains and overseas buyers.',
    know: ['Selling to jewellery retailers and chains, and the trade terms that go with it', 'Showing collections and taking orders on the road or at trade shows', 'Export documentation and buyer follow-up, for export roles', 'Collecting payments and managing credit', 'Territory planning across cities'],
    ask: ['Territories and the retailers or markets you sell to', 'Travel expected', 'Targets, incentives and whether a vehicle or allowance is provided', 'Domestic or export'] },
  { slug: 'jewellery-merchandising-purchase-and-inventory', groups: ['Merchandising & Product Development', 'Purchase & Sourcing', 'Inventory & Vault'], name: 'Merchandising, purchase and inventory',
    h1: 'Hire jewellery merchandisers, purchase and inventory staff',
    intro: 'Merchandisers, product developers, purchase and bullion staff, inventory executives, stock controllers and vault keepers: the people who decide what stock you carry and keep track of every gram.',
    know: ['Planning collections and stock by category, weight and price band', 'Buying from manufacturers and karigars; bullion purchase for bullion roles', 'Stock and inventory software, tagging and audits', 'Vault procedures and stock reconciliation', 'Tracking what sells and what does not'],
    ask: ['The inventory or ERP software you use', 'Stock value and number of stores or warehouses', 'Whether bullion buying is part of the role', 'Who the person reports to'] },
  { slug: 'jewellery-corporate-and-support-roles', groups: ['Marketing, Digital & E-commerce', 'Visual Merchandising', 'Accounts & Finance', 'HR & Admin', 'IT & Technology', 'Customer Service', 'Logistics & Dispatch'], name: 'Marketing, accounts, HR, IT and support roles',
    h1: 'Hire marketing, accounts, HR and IT staff who know jewellery',
    intro: 'Marketing and e-commerce, visual merchandising, accounts and GST, HR and admin, IT and ERP support, customer care and dispatch: roles every jewellery business needs, filled by people who understand how the trade works.',
    know: ['Jewellery marketing: festive and wedding seasons, catalogues, social media and e-commerce listings', 'Accounts for jewellery: GST on gold and making charges, stock valuation, schemes', 'HR for showrooms and workshops: shifts, incentives, attrition', 'ERP and billing systems used by jewellers', 'Insured dispatch and courier of high-value goods'],
    ask: ['The exact role and team size', 'Software and tools used (Tally, ERP, e-commerce platform)', 'Office or showroom location', 'Salary range and experience level'] },
];
const rolesOf = (f) => { const list = L.jobList(); const t = list.filter((x) => f.groups.includes(x.group)).map((x) => x.title); return [...new Set([...t, ...(f.extra || []).filter((x) => list.some((y) => y.title === x))])]; };
const familyOfTitle = (title) => { const g = (L.jobList().find((x) => x.title === title) || {}).group; return FAMILIES.find((f) => f.groups.includes(g)); };

const BUSINESSES = [['Jewellery retailers and showrooms', 'single showrooms, chains and franchise stores'], ['Manufacturers and workshops', 'handmade, casting and machine-made units'], ['Wholesalers and B2B suppliers', 'selling to retailers across India'], ['Exporters', 'export houses and their sales and production teams'], ['Diamond and gemstone businesses', 'natural and lab-grown diamonds, coloured stones'], ['D2C and e-commerce jewellery brands', 'online-first brands and their marketing and operations teams']];
const STEPS = () => [['Share the role', 'Fill a two-minute form or send it on WhatsApp: role, city, number of people, salary range.'], ['We search and screen', 'We look through our jewellery candidate database and advertise the role. Every candidate is called and interviewed before you see them.'], ['Meet a shortlist', 'You get screened profiles and choose interview times in your client account.'], ['Pay when they join', `The fee is a percentage of the candidate's yearly CTC, agreed before we start, and paid only once the person joins. If they leave within ${replacementDays()} days we find a replacement free.`]];
const FAQ = () => [
  ['Which jewellery roles do you hire for?', 'Every role in a jewellery business: sales, store management, design and CAD, karigars and production, quality and gemology, purchase and inventory, B2B sales, marketing, accounts, HR, IT and support. The full list is on this page.'],
  ['How much does it cost?', `You pay only when a candidate joins. The fee is a percentage of the candidate's yearly CTC and is agreed in writing before we start. There is no upfront fee, and a free replacement if the person leaves within ${replacementDays()} days.`],
  ['How fast will I see candidates?', 'Usually within a week for common roles such as sales, accounts and CAD. Senior and very specialised roles can take longer; we tell you what to expect when you share the role.'],
  ['Which cities do you hire in?', 'We hire across India. Most of our current openings are in Mumbai, and we also hire for jewellery businesses in Surat, Jaipur, Delhi NCR and other cities.'],
  ['Do candidates pay anything?', 'No. It is free for job seekers, always.'],
  ['How do I share a requirement?', 'Use the hiring form on this site, or message us on WhatsApp. You need the role, city, number of people and salary range; a job description helps but is not required.'],
];

// ---------- page shell for the server-rendered pages ----------
const CSS = `:root{--navy:#101A3A;--gold:#D19B12;--ink:#1d2433;--muted:#5d6577;--line:#e6e8ef;--bg:#f6f7fb}*{box-sizing:border-box}body{margin:0;font:16px/1.65 'Plus Jakarta Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--navy)}header.top{background:var(--navy);color:#fff}header.top .in{max-width:1040px;margin:0 auto;padding:14px 16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}header.top a{color:#fff;text-decoration:none}header.top .brand{font-weight:800;letter-spacing:.01em;margin-right:auto}header.top nav{display:flex;gap:14px;flex-wrap:wrap;font-size:14px}
main{max-width:1040px;margin:0 auto;padding:24px 16px 48px}.crumbs{font-size:13px;color:var(--muted);margin-bottom:10px}.crumbs a{color:var(--muted)}
h1{font:800 clamp(28px,4vw,40px)/1.15 Outfit,system-ui,sans-serif;margin:0 0 12px;color:var(--navy)}h2{font:700 22px/1.3 Outfit,system-ui,sans-serif;margin:36px 0 12px;color:var(--navy)}h3{font-size:17px;margin:0 0 6px}
.lead{font-size:18px;color:#39415a;max-width:760px}.btn{display:inline-block;background:var(--gold);color:var(--navy);font-weight:700;text-decoration:none;padding:12px 18px;border-radius:10px}.btn.alt{background:#fff;border:1px solid var(--line)}
.ctas{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px}
.card p{margin:0;color:var(--muted);font-size:15px}ul{padding-left:20px}li{margin:4px 0}.chips{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}.chips li{background:#fff;border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:14px;margin:0}
ol.steps{padding-left:20px}ol.steps li{margin:8px 0}details{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:8px 0}summary{font-weight:700;cursor:pointer}details p{margin:8px 0 0;color:#39415a}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);font-size:15px}th{background:#fafbfd}
.band{background:var(--navy);color:#fff;border-radius:16px;padding:22px;margin-top:36px}.band h2{color:#fff;margin-top:0}.band p{color:#d8dbe6}
footer.site{border-top:1px solid var(--line);background:#fff}footer.site .in{max-width:1040px;margin:0 auto;padding:22px 16px;display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));font-size:14px}footer.site b{display:block;margin-bottom:6px}footer.site a{display:block;color:var(--muted);text-decoration:none;margin:3px 0}`;
const nav = () => `<nav aria-label="Main"><a href="/jewellery-recruitment">Recruitment services</a><a href="/open-roles">Open jobs</a><a href="/apply">Find a job</a><a href="/hire?src=seo-nav">Hire staff</a></nav>`;
const foot = () => `<footer class="site"><div class="in">
<div><b>${e(biz().name || 'BrillBrains Hiring Solutions')}</b><span style="color:var(--muted)">Recruitment for India's jewellery industry. Part of BrillBrains Consultants.</span></div>
<div><b>Employers</b><a href="/jewellery-recruitment">Jewellery recruitment</a>${FAMILIES.slice(0, 5).map((f) => `<a href="/jewellery-recruitment/${f.slug}">${e(f.name)}</a>`).join('')}<a href="/bulk-hiring">Bulk hiring and new showrooms</a><a href="/my-account">Client login</a></div>
<div><b>Job seekers</b><a href="/open-roles">Open jewellery jobs</a><a href="/apply">Apply</a><a href="/my-profile">Job seeker login</a></div>
<div><b>Contact</b>${phone() ? `<a href="tel:+91${phone()}" data-ev="employer_phone_click">+91 ${phone()}</a><a href="https://wa.me/91${phone()}" data-ev="whatsapp_click" rel="noopener">WhatsApp</a>` : ''}<a href="https://brillbrainsconsultants.com" rel="noopener">brillbrainsconsultants.com</a><a href="/partners">Partners</a></div>
</div></footer>`;
// Small click counter for the CTAs: page views and clicks go to the Meta pixel when it is on, by name only.
const evScript = `<script>document.addEventListener('click',function(ev){var a=ev.target.closest&&ev.target.closest('[data-ev]');if(!a)return;try{if(window.fbq)fbq('trackCustom',a.getAttribute('data-ev'),{page:location.pathname});if(window.gtag)gtag('event',a.getAttribute('data-ev'),{page_path:location.pathname})}catch(e){}});</script>`;
function shell({ path, title, desc, body, ld, pixel = '' }) {
  const url = base() + path;
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title><meta name="description" content="${e(desc)}"><link rel="canonical" href="${e(url)}"><meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:site_name" content="${e(biz().name || 'BrillBrains Hiring Solutions')}"><meta property="og:type" content="website"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${e(url)}"><meta property="og:image" content="${e(base())}/img/logo.png"><meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${e(title)}"><meta name="twitter:description" content="${e(desc)}">
<link rel="icon" href="/img/favicon.png" type="image/png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}${analyticsHead()}${pixel}</head>
<body><header class="top"><div class="in"><a class="brand" href="/">${e(biz().name || 'BrillBrains Hiring Solutions')}</a>${nav()}</div></header><main id="main">${body}</main>${foot()}${evScript}</body></html>`;
}
// Google Analytics 4, only when GA4_ID is set in the server .env (G-XXXXXXX). No personal data is sent.
function analyticsHead() {
  const id = String(process.env.GA4_ID || '').trim(); if (!/^G-[A-Z0-9]{4,20}$/.test(id) || D.ENV.name !== 'live') return '';
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${id}');</script>`;
}

// ---------- structured data ----------
const org = () => ({ '@type': 'Organization', '@id': `${base()}/#org`, name: biz().name || 'BrillBrains Hiring Solutions', url: `${base()}/`, logo: `${base()}/img/logo.png`,
  description: 'Recruitment and hiring services for jewellery businesses in India: retailers, manufacturers, wholesalers, exporters and diamond businesses.',
  parentOrganization: { '@type': 'Organization', name: 'BrillBrains Consultants', url: 'https://brillbrainsconsultants.com/' },
  areaServed: { '@type': 'Country', name: 'India' }, knowsAbout: ['Jewellery industry recruitment', 'Jewellery retail hiring', 'Jewellery manufacturing hiring', 'Jewellery CAD designers', 'Gemologists'],
  ...(phone() ? { contactPoint: [{ '@type': 'ContactPoint', telephone: `+91-${phone()}`, contactType: 'sales', areaServed: 'IN', availableLanguage: ['English', 'Hindi'] }] } : {}) });
const website = () => ({ '@type': 'WebSite', '@id': `${base()}/#site`, url: `${base()}/`, name: biz().name || 'BrillBrains Hiring Solutions', publisher: { '@id': `${base()}/#org` }, inLanguage: 'en-IN' });
const crumbs = (list) => ({ '@type': 'BreadcrumbList', itemListElement: list.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base() + p })) });
const service = (name, desc, p) => ({ '@type': 'Service', name, description: desc, serviceType: 'Recruitment', provider: { '@id': `${base()}/#org` }, areaServed: { '@type': 'Country', name: 'India' }, url: base() + p });

// ---------- the pages ----------
const faqHtml = () => `<h2 id="faq">Questions employers ask</h2>${FAQ().map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}`;
const stepsHtml = () => `<ol class="steps">${STEPS().map(([t, d]) => `<li><b>${e(t)}.</b> ${e(d)}</li>`).join('')}</ol>`;
const jobsTable = (rows, n = 12) => (rows.length ? `<table><thead><tr><th scope="col">Role</th><th scope="col">City</th><th scope="col">Experience</th></tr></thead><tbody>${rows.slice(0, n).map(({ j }) => `<tr><td><a href="/jd/${e(j.id)}">${e(j.title)}</a></td><td>${e(j.city || 'India')}</td><td>${j.exp_from != null ? `${e(j.exp_from)}${j.exp_to != null ? `–${e(j.exp_to)}` : '+'} yrs` : '—'}</td></tr>`).join('')}</tbody></table>` : '<p>No openings in this area right now. <a href="/open-roles">See all open jobs</a>.</p>');

function hubPage() {
  const p = '/jewellery-recruitment'; const title = 'Jewellery Recruitment Agency in India | BrillBrains Hiring Solutions';
  const desc = 'Recruitment for jewellery retailers, manufacturers, wholesalers and exporters across India. Screened candidates for sales, CAD, karigar, gemology and corporate roles. Pay only on joining.';
  const body = `<div class="crumbs"><a href="/">Home</a> › Jewellery recruitment</div>
<h1>Jewellery recruitment for India's jewellery businesses</h1>
<p class="lead">BrillBrains Hiring Solutions is a recruitment service that works only with jewellery businesses. We find, call and interview candidates for your role, send you a screened shortlist, and you pay only when the person joins.</p>
<div class="ctas">${cta('seo-hub')}<a class="btn alt" href="https://wa.me/91${phone()}" data-ev="whatsapp_click" rel="noopener">Send the role on WhatsApp</a></div>
<h2>Who we hire for</h2><div class="grid">${BUSINESSES.map(([t, d]) => `<div class="card"><h3>${e(t)}</h3><p>${e(d)}</p></div>`).join('')}</div>
<h2>Roles we recruit</h2><div class="grid">${FAMILIES.map((f) => `<div class="card"><h3><a href="${p}/${f.slug}">${e(f.name)}</a></h3><p>${e(rolesOf(f).slice(0, 6).join(', '))}${rolesOf(f).length > 6 ? ' and more' : ''}</p></div>`).join('')}</div>
<h2>How it works</h2>${stepsHtml()}
<h2>Why a jewellery-only recruiter</h2><ul><li><b>We speak the trade.</b> Karat and hallmarking, making charges, CAD software, setting styles and showroom routines are part of how we screen.</li><li><b>You meet people we have already interviewed.</b> Every candidate is called and assessed before their profile reaches you.</li><li><b>No upfront fee.</b> You pay when someone joins, with a free replacement for ${replacementDays()} days.</li><li><b>Everything on WhatsApp.</b> Shortlists, interview times and offers reach you on your phone, and in your client account.</li></ul>
<h2>Hiring many people, or opening a new showroom?</h2><p>For several roles at once (a new store, a new workshop line, or festive-season staffing) use the <a href="/bulk-hiring">bulk hiring form</a> and tell us the roles, how many people and the salary range.</p>
<h2>Open jobs we are hiring for now</h2>${jobsTable(openJobs())}
${faqHtml()}
<div class="band"><h2>Tell us who you need</h2><p>Role, city, number of people and salary range is enough to start. A job description helps, but we can write one with you.</p><div class="ctas">${cta('seo-hub-bottom')}</div></div>`;
  const ld = { '@context': 'https://schema.org', '@graph': [org(), website(), { '@type': 'WebPage', '@id': base() + p, url: base() + p, name: title, description: desc, isPartOf: { '@id': `${base()}/#site` }, about: { '@id': `${base()}/#org` } }, crumbs([['Home', '/'], ['Jewellery recruitment', p]]), service('Jewellery industry recruitment', desc, p)] };
  return shell({ path: p, title, desc, body, ld });
}
function familyPage(f) {
  const p = `/jewellery-recruitment/${f.slug}`; const roles = rolesOf(f); const title = `${f.h1.replace(/^Hire /, 'Hire ')} | BrillBrains Hiring Solutions`;
  const desc = `${f.intro.split(':')[0].slice(0, 120)}. Screened candidates for jewellery businesses across India; pay only on joining.`.slice(0, 158);
  const jobs = openJobs().filter(({ j }) => roles.includes(j.title) || (familyOfTitle(j.title) === f));
  const body = `<div class="crumbs"><a href="/">Home</a> › <a href="/jewellery-recruitment">Jewellery recruitment</a> › ${e(f.name)}</div>
<h1>${e(f.h1)}</h1><p class="lead">${e(f.intro)}</p><div class="ctas">${cta(`seo-${f.slug}`, `Hire ${f.name.toLowerCase()}`)}</div>
<h2>Roles we fill</h2><ul class="chips">${roles.map((r) => `<li>${e(r)}</li>`).join('')}</ul>
<h2>What we check before you meet a candidate</h2><ul>${f.know.map((x) => `<li>${e(x)}</li>`).join('')}</ul>
<h2>What to tell us when you share the role</h2><ul>${f.ask.map((x) => `<li>${e(x)}</li>`).join('')}</ul><p>Role, city, number of people and salary range is enough to start.</p>
<h2>How hiring works</h2>${stepsHtml()}
<h2>Open ${e(f.name.toLowerCase())} jobs</h2>${jobsTable(jobs, 8)}
<h2>Other roles we recruit</h2><ul>${FAMILIES.filter((x) => x !== f).map((x) => `<li><a href="/jewellery-recruitment/${x.slug}">${e(x.name)}</a></li>`).join('')}</ul>
<div class="band"><h2>Share your requirement</h2><p>We call you back, confirm the details and start the search. You pay only when someone joins.</p><div class="ctas">${cta(`seo-${f.slug}-bottom`)}</div></div>`;
  const ld = { '@context': 'https://schema.org', '@graph': [org(), { '@type': 'WebPage', '@id': base() + p, url: base() + p, name: title, description: desc, isPartOf: { '@id': `${base()}/#site` } }, crumbs([['Home', '/'], ['Jewellery recruitment', '/jewellery-recruitment'], [f.name, p]]), service(`Recruitment of ${f.name.toLowerCase()} for jewellery businesses`, f.intro, p)] };
  return shell({ path: p, title, desc, body, ld });
}
// /jewellery-recruitment and /jewellery-recruitment/<family>: HTML, or null when not one of ours.
function landing(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/jewellery-recruitment') return hubPage();
  const m = /^\/jewellery-recruitment\/([a-z0-9-]+)$/.exec(p); if (!m) return null;
  const f = FAMILIES.find((x) => x.slug === m[1]); return f ? familyPage(f) : null;
}

// ---------- the app's own public pages: canonical, robots and structured data in <head>, content in the first HTML ----------
const INDEX = ['/', '/hire', '/apply', '/open-roles', '/bulk-hiring', '/partners'];
function headTags(page) {
  const url = base() + (page === '/' ? '/' : page);
  if (!INDEX.includes(page)) return '<meta name="robots" content="noindex">';
  const graph = [org(), website()];
  if (page === '/hire') graph.push(service('Jewellery industry recruitment', 'Share a role and get screened, interviewed candidates for your jewellery business. Pay only on joining.', '/hire'));
  return [`<link rel="canonical" href="${e(url)}">`, '<meta property="og:locale" content="en_IN">', `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`, analyticsHead()].filter(Boolean).join('\n  ');
}
// What a crawler that does not run JavaScript sees inside <div id="app"> (the app replaces it when it starts).
function prerender(page) {
  if (page === '/') {
    return `<main class="seo-pre"><h1>Jewellery hiring: bringing the right people and companies together</h1>
<p>${e(biz().name || 'BrillBrains Hiring Solutions')} is a recruitment service for India's jewellery industry, from the showroom floor to the karigar's bench. Employers get screened, interviewed candidates and pay only when someone joins. Job seekers apply free.</p>
<p><a href="/hire?src=seo-home">Hire jewellery staff</a> · <a href="/jewellery-recruitment">Jewellery recruitment services</a> · <a href="/apply">Apply for a jewellery job</a> · <a href="/open-roles">See all open jobs</a></p>
<h2>How it works for employers</h2>${stepsHtml()}
<h2>Roles we recruit</h2><ul>${FAMILIES.map((f) => `<li><a href="/jewellery-recruitment/${f.slug}">${e(f.name)}</a></li>`).join('')}</ul>
<h2>Open jobs</h2>${jobsTable(openJobs(), 15)}
${faqHtml()}</main>`;
  }
  if (page === '/open-roles') return `<main class="seo-pre"><h1>All open jewellery jobs</h1><p>Every jewellery job we are hiring for right now: sales, design and CAD, karigars, quality and gemology, purchase, accounts, marketing and more. Free for job seekers. <a href="/apply">Apply in a minute</a>; if your role is not listed, apply anyway and we will match you to new openings.</p>${jobsTable(openJobs(), 300)}<h2>Jobs by area</h2><ul>${FAMILIES.map((f) => `<li>${e(f.name)}: ${e(rolesOf(f).slice(0, 5).join(', '))}</li>`).join('')}</ul><p>Employers: <a href="/jewellery-recruitment">see our jewellery recruitment services</a>.</p></main>`;
  if (page === '/hire') return `<main class="seo-pre"><h1>Hire jewellery staff</h1><p>Tell us who you need: role, city, number of people and salary range. We send screened, interviewed candidates and you pay only when someone joins.</p><p><a href="/jewellery-recruitment">See the roles we recruit and how it works</a></p></main>`;
  return '';
}

// ---------- JobPosting for an open job page ----------
function jobPosting(j, v, jd, html) {
  const desc = String(html || '').replace(/<\/?section[^>]*>/g, '').trim() || ['summary', 'duties', 'must', 'good', 'education'].map((k) => String(jd[k] || '').trim()).filter(Boolean).map((t) => `<p>${e(t).replace(/\n/g, '<br>')}</p>`).join('') || `<p>${e(j.title)} job in ${e(j.city)}.</p>`;
  const posted = String(j.reopened_at || j.created_at || '').slice(0, 10);
  const until = new Date(new Date(j.reopened_at || j.created_at || Date.now()).getTime() + 60 * 86400000);
  const valid = until > new Date() ? until : new Date(Date.now() + 30 * 86400000); // open jobs stay listed while open
  const months = j.exp_from != null ? Math.round(Number(j.exp_from) * 12) : null;
  return { '@context': 'https://schema.org', '@type': 'JobPosting', title: j.title, description: desc, datePosted: posted, validThrough: valid.toISOString().slice(0, 10), identifier: { '@type': 'PropertyValue', name: biz().name || 'BrillBrains Hiring Solutions', value: j.id },
    hiringOrganization: { '@type': 'Organization', name: biz().name || 'BrillBrains Hiring Solutions', sameAs: `${base()}/`, logo: `${base()}/img/logo.png` },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: j.city || '', addressRegion: L.stateOf ? L.stateOf(j.city) || undefined : undefined, addressCountry: 'IN' } },
    ...(months ? { experienceRequirements: { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: months } } : {}),
    totalJobOpenings: Math.max(1, (j.openings || 1) - (v.filled || 0)), industry: 'Jewellery', directApply: true };
}

// ---------- robots.txt, sitemap.xml, llms.txt ----------
function robots() {
  return `# ${biz().name || 'BrillBrains Hiring Solutions'}
# Public pages are open to search engines and AI search crawlers. Private areas are login-protected;
# these rules only keep crawlers out of them.
User-agent: *
Allow: /
Allow: /api/bootstrap
Allow: /api/public/
Disallow: /api/
Disallow: /team
Disallow: /my-account
Disallow: /my-profile
Disallow: /u/
Disallow: /agent/
Disallow: /feedback/
Disallow: /rate/
Disallow: /unsubscribe/
Disallow: /guides/

Sitemap: ${base()}/sitemap.xml
`;
}
function sitemap() {
  const day = (t) => String(t || '').slice(0, 10) || L.istDay();
  const jobs = openJobs(); const newest = jobs.length ? jobs.map(({ j }) => day(j.reopened_at || j.created_at)).sort().pop() : L.istDay();
  const urls = [['/', newest], ['/jewellery-recruitment', newest], ...FAMILIES.map((f) => [`/jewellery-recruitment/${f.slug}`, newest]), ['/hire', null], ['/bulk-hiring', null], ['/open-roles', newest], ['/apply', null], ['/partners', null],
    ...jobs.map(({ j }) => [`/jd/${j.id}`, day(j.reopened_at || j.created_at)])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, d]) => `  <url><loc>${e(base() + p)}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}
function llms() {
  const n = biz().name || 'BrillBrains Hiring Solutions';
  return `# ${n}

> Recruitment and hiring services for jewellery businesses in India: retailers and showrooms, manufacturers, wholesalers, exporters, diamond and gemstone businesses and D2C brands. Part of BrillBrains Consultants (https://brillbrainsconsultants.com).

Employers share a role; the team searches its jewellery candidate database, calls and interviews candidates, and sends a screened shortlist. The fee is a percentage of the candidate's yearly CTC, paid only when the candidate joins, with a free replacement within ${replacementDays()} days. Job seekers apply free.

## For employers
- [Jewellery recruitment services](${base()}/jewellery-recruitment): who we hire for, roles, process, fees and FAQs
${FAMILIES.map((f) => `- [${f.name}](${base()}/jewellery-recruitment/${f.slug}): ${f.intro.split(':')[0]}`).join('\n')}
- [Submit a hiring requirement](${base()}/hire)
- [Bulk hiring and new showrooms](${base()}/bulk-hiring)

## For job seekers
- [Open jewellery jobs](${base()}/open-roles)
- [Apply for a jewellery job](${base()}/apply)

## Contact
${phone() ? `- Phone and WhatsApp: +91 ${phone()}\n` : ''}- Website: ${base()}/
`;
}

module.exports = { landing, headTags, prerender, jobPosting, robots, sitemap, llms, FAMILIES, familyOfTitle };
