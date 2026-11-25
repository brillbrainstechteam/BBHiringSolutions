# 11 · Content, local SEO, lead magnets, analytics and authority (plan)

These are the stages that need business input, credentials or human review. Each item says what to do and what blocks it.

## Content: 90-day plan
**Workflow:** research → brief → draft → fact check → human review → approval → publish → request indexing → measure. AI drafts stay unpublished until a person approves them.

| Week | Piece | Primary question it answers | Links to | Needs |
|---|---|---|---|---|
| 1–2 | Guide: hiring jewellery sales staff | What to check in a jewellery sales candidate | sales-staff page | recruiter review |
| 3–4 | Guide: hiring a jewellery CAD designer | Software, design test, portfolio, production knowledge | CAD page | CAD lead review |
| 5–6 | Guide: staffing a new jewellery showroom | Which roles, how many, in what order | `/bulk-hiring`, hub | real examples (anonymised) |
| 7–8 | Interview question bank: showroom roles | Questions plus what a good answer shows | sales and store-manager pages | recruiter review |
| 9–10 | Guide: hiring karigars | Crafts, trials, piece-rate vs salary | karigar page | production review |
| 11–12 | Jewellery salary ranges by role (from our own data) | Typical offered CTC by role and city | hub | **Only with a method note**: sample size, dates, cities. Our own placements and job data only; never invented figures |

## Local SEO
- **Google Business Profile:** eligible only with a real, staffed office address that customers can contact. The address on file must be confirmed first (see the audit).
- **Profile checklist:**
  - Category: "Employment agency".
  - Exact business name.
  - Verified address or service area.
  - Phone +91 9093400444.
  - Website: `/jewellery-recruitment`.
  - Services: the 8 role families.
  - Real office photos.
  - Reviews asked from real clients only.
- **City pages:** Mumbai first, built only when we have local content and live jobs. Then Surat and Jaipur, which already have client history. No fake offices.

## Lead magnets (scored)

| Idea | Employer usefulness | Data we have | Effort | Verdict |
|---|---|---|---|---|
| JD generator for jewellery roles | high | yes: the app already writes JDs (`jdwriter`) | medium | **Build first.** A public, rate-limited version that ends with "Send this as a requirement" |
| Interview question bank | high | expertise, no data needed | low | Build as a content page |
| New-showroom staffing planner | high | role list | medium | Second |
| Salary benchmark explorer | high | partial: our own jobs and offers | high | Only after a data review and a method note |
| Hiring cost calculator | medium | the fee model | low | Simple; risk of looking like a quote. Later |

## Analytics
- **GA4:** set `GA4_ID=G-…` in the server `.env` on live. The new pages and the app's head tags load it only on live.
- **Events on the new pages:** `hiring_cta_click`, `whatsapp_click`, `employer_phone_click`. They are sent to GA4 and to the Meta Pixel by name, with no personal data.
- **Still to add in the app:** `hiring_form_start`, `hiring_form_submit`, `candidate_application_submit`. The forms already post `src`, so leads in the CRM keep the landing source (`seo-hub`, `seo-<role>`).
- **Search Console and Bing Webmaster:** verify `hire.brillbrainsconsultants.com` (DNS or HTML tag) and submit `/sitemap.xml`. Needs the owner's Google and Microsoft accounts.
- **IndexNow (Bing, Yandex):** optional. Needs a key file; can be added to the deploy step later.
- **Google Indexing API:** only for job pages, and only once Search Console is verified.

## Authority and digital PR
Ethical outreach only, and nothing is sent without approval.
- **Linkable assets:** the guides above and the salary method note, once they exist.
- **Targets to research:**
  - GJEPC and GJC member resources.
  - IIJS exhibitor ecosystem.
  - Jewellery institutes (placement cells): these are also candidate sources.
  - Trade media: guest articles on hiring.
- **Brand mentions:** set a monthly search for the brand name and log new mentions.

## Monitoring
- **Daily or on deploy:** `node deploy/seo-check.mjs https://hire.brillbrainsconsultants.com`. It fails on noindex mistakes, missing titles or canonicals, broken sitemap URLs, private URLs in the sitemap, and missing JobPosting fields. It could be added to the GitHub deploy action as a post-deploy step.
- **Weekly (once Search Console is on):** impressions and clicks for employer queries, the CTR of the hub and family pages, and leads with `src=seo-*` in the CRM.
- **Monthly:** the AI prompt benchmark, competitor check and content refresh.
