# 04 · Site architecture and URL map

## Principles
- **One page per intent.** The hub covers the service and "agency" searches; one page per *family* of roles covers "hire X". There are no pages per role per city: they would be near-duplicates (Google's scaled-content policy), and demand isn't proven.
- **Employers and candidates take separate paths.** Employers: `/jewellery-recruitment` → role family → `/hire` form. Candidates: `/open-roles` → `/jd/JB-…` → `/apply`.
- **Every new page is reachable in one click** from the home page footer and from the hub.

## URL map

| URL | Purpose | Audience | Rendering | Indexable | Schema |
|---|---|---|---|---|---|
| `/` | Brand, both audiences | both | app + prerendered HTML | yes | Organization, WebSite |
| `/jewellery-recruitment` | Service hub: who, roles, process, fees, FAQ, live jobs | employer | server | yes | Organization, WebSite, WebPage, Service, BreadcrumbList |
| `/jewellery-recruitment/jewellery-sales-staff` | Retail sales roles | employer | server | yes | Service, BreadcrumbList |
| `/jewellery-recruitment/jewellery-store-managers` | Store managers, cashiers, operations | employer | server | yes | same |
| `/jewellery-recruitment/jewellery-cad-designers` | Designers, CAD, renderers | employer | server | yes | same |
| `/jewellery-recruitment/jewellery-karigars-and-production-staff` | Karigars, setters, polishers, casters | employer | server | yes | same |
| `/jewellery-recruitment/gemologists-and-quality-staff` | Gemology, grading, QC, hallmarking | employer | server | yes | same |
| `/jewellery-recruitment/jewellery-b2b-sales-and-business-development` | B2B, wholesale, export sales | employer | server | yes | same |
| `/jewellery-recruitment/jewellery-merchandising-purchase-and-inventory` | Merchandising, purchase, bullion, inventory | employer | server | yes | same |
| `/jewellery-recruitment/jewellery-corporate-and-support-roles` | Marketing, accounts, HR, IT, support | employer | server | yes | same |
| `/hire` | Hiring requirement form (existing) | employer | app | yes | Organization, Service |
| `/bulk-hiring` | Many roles / new showroom form (existing) | employer | app | yes | Organization |
| `/open-roles` | All open jobs | candidate | app + prerendered list | yes | Organization |
| `/jd/JB-…` | One job | candidate | server | open jobs yes; closed `noindex` | JobPosting |
| `/apply` | Candidate form | candidate | app | yes | — |
| `/partners` | Partner form | partners | app | yes | — |
| `/my-account`, `/my-profile`, `/team…` | Logins | private | app | **no** (`noindex`, robots) | — |
| `/u/`, `/agent/`, `/feedback/`, `/rate/`, `/unsubscribe/` | Private links | private | server | **no** | — |

## Internal linking
- **Hub →** every family page, `/bulk-hiring`, the live job table (`/jd/*`) and `/hire?src=seo-hub`.
- **Family page →** the hub (breadcrumb), the other 7 families, its matching open jobs and `/hire?src=seo-<slug>`.
- **Home (app footer and prerendered HTML) →** the hub and the families; **open roles →** the families and the hub.
- **Job page →** apply. To do later: link back to the matching family page.

## Next pages (only when content is ready)
1. **Employer guides** (`/jewellery-recruitment/guides/<slug>`), with a human-reviewed draft first: "Hiring jewellery sales staff: what to check", "Hiring a jewellery CAD designer: software, test, portfolio", "Staffing a new jewellery showroom".
2. **About and team page**, once the facts are confirmed: who runs it, since when, and how the screening works.
3. **City pages** only where we can show real local knowledge and current jobs. Mumbai first, then Surat and Jaipur.
