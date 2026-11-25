// SEO regression check: run against the local copy or the live site.
//   node deploy/seo-check.mjs                      (http://localhost:4600)
//   node deploy/seo-check.mjs https://hire.brillbrainsconsultants.com
// Checks status codes, titles, descriptions, canonicals, robots rules, the sitemap, structured data,
// that private areas are not indexable, and that real content is in the first HTML (no JavaScript run).
// Prints PASS / FAIL per check and exits 1 when anything fails. Read-only: it only sends GET requests.
const BASE = (process.argv[2] || 'http://localhost:4600').replace(/\/$/, '');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const get = async (p, opts = {}) => { const r = await fetch(BASE + p, { redirect: 'manual', headers: { 'User-Agent': 'BBHS-SEO-check/1.0' }, ...opts }); return { status: r.status, headers: r.headers, text: r.status === 200 ? await r.text() : '' }; };
const one = (re, s) => ((re.exec(s) || [])[1] || '').trim();
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return { __bad: true }; } });
const types = (blocks) => blocks.flatMap((b) => (b['@graph'] ? b['@graph'] : [b])).map((x) => x['@type']);

const PUBLIC = [
  ['/', ['Organization', 'WebSite']],
  ['/jewellery-recruitment', ['Organization', 'Service', 'BreadcrumbList']],
  ['/jewellery-recruitment/jewellery-cad-designers', ['Service', 'BreadcrumbList']],
  ['/jewellery-recruitment/jewellery-sales-staff', ['Service', 'BreadcrumbList']],
  ['/hire', ['Organization']],
  ['/open-roles', ['Organization']],
  ['/apply', []],
  ['/bulk-hiring', []],
];
const PRIVATE = ['/team', '/my-account', '/my-profile'];

const titles = new Map(); const descs = new Map();
for (const [p, need] of PUBLIC) {
  const r = await get(p);
  check(`${p} returns 200`, r.status === 200, String(r.status));
  if (r.status !== 200) continue;
  const title = one(/<title>([^<]*)<\/title>/, r.text); const desc = one(/<meta name="description" content="([^"]*)"/, r.text);
  const canon = one(/<link rel="canonical" href="([^"]*)"/, r.text); const robots = one(/<meta name="robots" content="([^"]*)"/, r.text);
  check(`${p} has a title`, title.length >= 15, title);
  check(`${p} has a description`, desc.length >= 50, `${desc.length} chars`);
  check(`${p} canonical is itself`, canon && new URL(canon).pathname === (p === '/' ? '/' : p), canon);
  check(`${p} is indexable`, !/noindex/.test(robots) && !/noindex/i.test(r.headers.get('x-robots-tag') || ''), robots || '(none)');
  const blocks = ld(r.text); const ts = types(blocks);
  check(`${p} structured data parses`, !blocks.some((b) => b.__bad), ts.join(', '));
  for (const t of need) check(`${p} has ${t}`, ts.includes(t));
  const text = r.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (['/', '/jewellery-recruitment', '/open-roles'].includes(p) || p.startsWith('/jewellery-recruitment/')) check(`${p} has real content in the first HTML`, text.length > 400 && /<h1/.test(r.text), `${text.length} chars of text`);
  if (title) { if (titles.has(title)) check(`${p} title is unique`, false, `same as ${titles.get(title)}`); titles.set(title, p); }
  if (desc) { if (descs.has(desc)) check(`${p} description is unique`, false, `same as ${descs.get(desc)}`); descs.set(desc, p); }
}
for (const p of PRIVATE) {
  const r = await get(p); const robots = one(/<meta name="robots" content="([^"]*)"/, r.text);
  check(`${p} is kept out of search`, /noindex/i.test(robots) || /noindex/i.test(r.headers.get('x-robots-tag') || ''), robots || r.headers.get('x-robots-tag') || '(none)');
}
const nf = await get('/jewellery-recruitment/not-a-page'); check('an unknown page returns 404', nf.status === 404, String(nf.status));

// robots.txt and the sitemap
const rb = await get('/robots.txt');
check('robots.txt returns 200', rb.status === 200, String(rb.status));
check('robots.txt names the sitemap', /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(rb.text));
check('robots.txt keeps out the team portal and API', /Disallow: \/team/.test(rb.text) && /Disallow: \/api\//.test(rb.text));
check('robots.txt does not block the whole site', !/^Disallow: \/\s*$/m.test(rb.text));
const sm = await get('/sitemap.xml');
check('sitemap.xml returns 200', sm.status === 200, String(sm.status));
const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check('sitemap lists the recruitment pages', locs.some((u) => u.endsWith('/jewellery-recruitment')), `${locs.length} URLs`);
check('sitemap has no private URLs', !locs.some((u) => /\/(team|api|my-account|my-profile|u|agent|feedback|rate)(\/|$)/.test(new URL(u).pathname)));
const sample = [...locs.filter((u) => !/\/jd\//.test(u)), ...locs.filter((u) => /\/jd\//.test(u)).slice(0, 5)];
for (const u of sample) { const p = new URL(u).pathname; const r = await get(p); check(`sitemap URL ${p} returns 200`, r.status === 200, String(r.status)); }

// job pages in the sitemap: indexable, with valid JobPosting
for (const u of locs.filter((x) => /\/jd\//.test(x)).slice(0, 5)) {
  const p = new URL(u).pathname; const r = await get(p); const jp = ld(r.text).find((b) => b['@type'] === 'JobPosting');
  check(`${p} has JobPosting`, !!jp);
  if (jp) for (const k of ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation', 'validThrough']) check(`${p} JobPosting has ${k}`, !!jp[k]);
  check(`${p} is indexable`, !/noindex/.test(one(/<meta name="robots" content="([^"]*)"/, r.text)));
}
const lt = await get('/llms.txt'); check('llms.txt returns 200', lt.status === 200, String(lt.status));

const failed = results.filter((x) => !x.ok);
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? `  (${x.detail})` : ''}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed · ${BASE} · ${new Date().toISOString()}`);
process.exit(failed.length ? 1 : 0);
