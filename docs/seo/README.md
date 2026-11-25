# SEO and AI search: summary, tracker, blockers, deploy checklist

**Branch:** `seo`, built on the live branch `feat/ui-refresh`. Nothing from it is deployed yet.

## What was built

| Stage | Task | Status | Files | How it was checked |
|---|---|---|---|---|
| 1 | Audit of the live site and code | done | `01-technical-audit.md` | curl and code reading; `seo-check` baseline on live: 29 pass / 22 fail |
| 2 | Competitors (first pass) | partial | `02-competitor-analysis.md` | web search; no paid tools |
| 3 | Keywords and AI prompts | done (volumes unknown) | `03-keyword-research.csv`, `03-ai-search-prompts.csv` | — |
| 4 | Architecture and URL map | done | `04-site-architecture.md` | — |
| 5 | robots.txt, sitemap.xml, canonicals, noindex on logins, favicon | done | `server/seo.js`, `server/server.js` | seo-check |
| 5 | Real content in the first HTML (home, open roles, hire) | done | `server/seo.js` `prerender` | seo-check; the app still starts and replaces it (browser check, no console errors) |
| 6 | Employer pages: hub plus 8 role families | done | `server/seo.js` | seo-check; viewed at desktop and 375 px (no sideways scroll) |
| 7 | JSON-LD: Organization, WebSite, WebPage, Service, BreadcrumbList, JobPosting | done | `server/seo.js`, `server/api-team.js` | parsed by seo-check; **Rich Results Test still to run on live** |
| 8 | AI crawler access and llms.txt | done | `server/seo.js`, `08-ai-seo-audit.md` | seo-check |
| 13 | Job pages indexable when open, `noindex` when closed, JobPosting | done | `server/api-team.js` | job page rendered with a sample job: robots `index,follow`, canonical, full description |
| 14 | SEO CTAs go to the existing `/hire` form with `src=seo-<page>` | done | `server/seo.js` | links checked; the lead keeps `src` |
| 17 | GA4 hook (only when `GA4_ID` is set) and named click events | done, needs an ID | `server/seo.js` | — |
| 19 | Automated SEO check | done | `deploy/seo-check.mjs` | **local: 91 / 91 pass** |
| 9–12, 15–18 | Local SEO, content, lead magnets, authority, monitoring | planned | `11-content-and-growth-plan.md` | — |

## Blockers: business information to confirm
1. **Office address.** The live value ("Office 4, Opera House, Mumbai 400004") is identical to the test placeholder. It is kept out of structured data until confirmed. It is also needed for a Google Business Profile.
2. **Home page claims:** "in the jewellery industry since 2011", "100+ jewellery brands", "10,000+ people trained", "30 businesses hiring", "12 cities". Confirm or edit them in Settings › Landing. The new pages don't use them.
3. **Client logos on the home page.** The client clean-up planned for the team portal does not change these (they are in the landing settings). Keep only clients who agreed to be shown.
4. **Official social profiles** to add to the Organization `sameAs`.
5. **Model-training bots** (GPTBot, ClaudeBot, Google-Extended, CCBot): allow (as now) or block?
6. **`hiringOrganization` on JobPosting** names BrillBrains Hiring Solutions, because client names are kept private. Google prefers the actual employer. Decide whether some clients can be named publicly.

## Blockers: credentials and production
- **Google Search Console and Bing Webmaster:** verify the domain, then submit `/sitemap.xml`.
- **GA4:** a measurement ID for `GA4_ID` in the server `.env`.
- **Rich Results Test, PageSpeed Insights and CrUX:** run on live after deploy.
- **A keyword tool** (Keyword Planner, Ahrefs, Semrush) for volumes.

## Deploy checklist
1. Review the 9 new pages on the local copy: `/jewellery-recruitment` and its 8 family pages.
2. Merge `seo` into `feat/ui-refresh` and push. This deploys to live.
3. Run `node deploy/seo-check.mjs https://hire.brillbrainsconsultants.com`. Expect all checks to pass; job pages must show JobPosting.
4. Run the Rich Results Test on `/jewellery-recruitment` and one `/jd/JB-…` page.
5. In Search Console: add the property, submit the sitemap, request indexing of `/jewellery-recruitment`.
6. Set `GA4_ID` when available and restart the service.

## Rollback
Everything is in `server/seo.js`, plus small hooks in `server/server.js` and in `jdHtml` in `server/api-team.js`. Reverting the `seo` commits restores today's behaviour. No data is changed.
