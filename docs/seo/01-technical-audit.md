# 01 · Technical SEO audit (baseline 25 Nov 2026)

How it was checked: `curl` of the live site (raw HTML, no JavaScript), a reading of `server/server.js`, `server/api-team.js` (`jdHtml`) and `public/js/landing.js`, and `deploy/seo-check.mjs` run against live.
**Baseline on live: 29 checks pass, 22 fail.** The full output is in `ui-review/.tmp/seo-check-live-before.txt`, which is not in git; re-run it with `node deploy/seo-check.mjs https://hire.brillbrainsconsultants.com`.

## Stack and rendering
- **App:** Node 22, plain `http` server (`server/server.js`) and SQLite. The front end is a vanilla-JS single-page app: `public/index.html`, with every public and private view drawn by `public/js/*.js`.
- **Public pages:** `/`, `/hire`, `/apply`, `/open-roles`, `/bulk-hiring` and `/partners` are the same `index.html`. The server fills in `<title>`, description and OG tags; the body is drawn by JavaScript.
- **Server-rendered pages:** job pages (`/jd/JB-…`), feedback, profile and unsubscribe pages.
- **Private areas:** `/team`, `/my-account`, `/my-profile`, plus private link pages (`/u/`, `/agent/`, `/feedback/`, `/rate/`). All are protected by login or by unguessable codes.
- **Deploy:** a push to `feat/ui-refresh` → GitHub Action → VPS (nginx → 127.0.0.1:4600).

## Findings

| # | Issue | URL | Evidence | Sev | Business impact | Fix (status) | Files | Validation |
|---|---|---|---|---|---|---|---|---|
| 1 | Every job page tells search engines not to index it | `/jd/*` | `<meta name="robots" content="noindex">` on every job page | **P0** | No job can appear in Google or Google for Jobs | Open jobs: `index,follow`, canonical, JobPosting. Closed jobs keep `noindex` (**done**) | `server/api-team.js`, `server/seo.js` | seo-check: job pages indexable, JobPosting fields |
| 2 | The home page HTML has no content | `/` | Body is `<div class="boot">Loading…</div>` | **P0** | Crawlers that don't run JavaScript (most AI search bots) see an empty page | Prerendered home content inside `#app`; the app replaces it on load (**done**) | `server/seo.js` `prerender`, `server/server.js` | seo-check: "real content in the first HTML" |
| 3 | No robots.txt | `/robots.txt` | 404 | P1 | No sitemap hint; private paths not marked | Added: allows public pages and AI search bots, keeps out `/team`, `/api/` (except public data), private link pages (**done**) | `server/seo.js` `robots` | seo-check robots rules |
| 4 | No XML sitemap | `/sitemap.xml` | 404 | P1 | Slower discovery of jobs and new pages | Dynamic sitemap: public pages plus open jobs, `lastmod` from the job's date (**done**) | `server/seo.js` `sitemap` | seo-check: every sitemap URL returns 200, none private |
| 5 | No pages that target employer searches | — | The only employer page is the `/hire` form, drawn by JavaScript | **P0** (business) | Nothing can rank for "jewellery recruitment agency" or "hire CAD designer" | `/jewellery-recruitment` hub plus 8 role-family pages, server-rendered (**done**) | `server/seo.js` | seo-check; manual read |
| 6 | No canonical tags | all | none in HTML | P2 | Query-string duplicates (`?src=`, `?job=`) can split signals | Canonical on every indexable page (**done**) | `server/seo.js` `headTags`, `server/server.js` | seo-check canonical |
| 7 | No structured data | all | no JSON-LD | P1 | No entity data for Google and AI search; no job rich results | Organization, WebSite, Service, BreadcrumbList, JobPosting (**done**) | `server/seo.js` | seo-check parses JSON-LD; still to do: Google Rich Results Test on live (needs production) |
| 8 | The home title is only the brand name | `/` | `<title>BrillBrains Hiring Solutions</title>` | P2 | Weak relevance for non-brand searches | Keyword titles and descriptions for `/`, `/hire`, `/apply`, `/open-roles`, `/bulk-hiring` (**done**) | `server/server.js` `META` | seo-check titles unique |
| 9 | `og:title` is the brand name on every page | all | the same OG title everywhere | P3 | Weak link previews | OG and Twitter titles now carry the page title (**done**) | `server/server.js` | view source |
| 10 | Client and job-seeker login pages have no `noindex` | `/my-account`, `/my-profile` | no robots meta | P2 | Login pages could show in search | `noindex` (**done**) | `server/seo.js` `headTags` | seo-check private pages |
| 11 | `/favicon.ico` is 404 | `/favicon.ico` | 404 | P3 | Error noise in crawls | 301 to `/img/favicon.png` (**done**) | `server/server.js` | curl |
| 12 | `/jobs` uses a 302 to `/open-roles` | `/jobs` | 302 | P3 | A temporary redirect for a permanent move | Leave until confirmed permanent, then 301 (**open**) | `server/server.js` | curl |
| 13 | Three hostnames | hire., hiring., root | `hiring.` → 301 to `hire.` (good); `brillbrainsconsultants.com` is a separate parent-company site | P2 | Entity confusion between parent and hiring brand | Keep `hire.` as the canonical hiring domain. Organization schema names BrillBrains Consultants as `parentOrganization`. The parent site should link to `hire.` with the words "BrillBrains Hiring Solutions" (**open**: needs access to the parent site) | — | manual |
| 14 | Business address unverified | — | The live address matches the test-data placeholder ("Office 4, Opera House, Mumbai 400004") | P1 (trust) | A wrong NAP hurts local SEO and trust | Address left out of all structured data until verified (**blocked**: business info) | — | — |
| 15 | Home claims unverified | `/` | "since 2011", "100+ brands", "10,000+ trained" in the landing settings | P2 (trust) | Unverifiable claims weaken E-E-A-T and may mislead | Not used on the new pages. Confirm or edit them in Settings (**blocked**: business info) | — | — |
| 16 | No analytics beyond the Meta Pixel | all | only the Meta Pixel in `<head>` | P1 | Organic and AI referral leads can't be measured | GA4 loads when `GA4_ID` is set; CTA, WhatsApp and phone click events are named (**done**, needs an ID). Leads already store `src`; SEO CTAs pass `src=seo-<page>` | `server/seo.js` | needs GA4 ID |
| 17 | Fonts: 4 families from Google Fonts on every page | all | one large CSS request | P3 | Slower LCP on mobile | New pages load 2 families. Trim the app's set later (**open**) | `public/index.html` | Lighthouse (needs a production run) |

## Checks that need production or credentials
Not run here, so not passed:
- Google Rich Results Test and Schema validator on the live URLs.
- PageSpeed Insights and CrUX field data (LCP, INP, CLS).
- Search Console coverage and indexing stats.
- Bing Webmaster crawl data.
- CDN or firewall rules affecting bots: the VPS sits behind nginx with no bot firewall seen; to be confirmed on live after deploy.
