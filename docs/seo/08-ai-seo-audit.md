# 08 · AI search (GEO / AEO)

AI search optimisation sits on top of normal SEO: the same crawlable HTML, clear facts and structured data.

## Crawler access (robots.txt as built)
Vendors rename and add bots, so check their current docs before changing anything.

| Bot | Owner | Purpose | Our rule |
|---|---|---|---|
| Googlebot | Google | Search and AI Overviews | allowed |
| Bingbot | Microsoft | Bing and Copilot | allowed |
| OAI-SearchBot | OpenAI | ChatGPT search | allowed (the `*` rules) |
| ChatGPT-User | OpenAI | Fetches a page when a user asks | allowed. OpenAI says robots.txt may not apply to it |
| Claude-SearchBot / Claude-User | Anthropic | Claude search and user fetches | allowed |
| PerplexityBot | Perplexity | Perplexity search index | allowed |
| GPTBot, ClaudeBot, Google-Extended, CCBot | various | **Model training** | not named, so allowed by `*` as before. **Owner decision:** add `Disallow: /` blocks for these if you don't want the content used for training. Blocking them does not affect search visibility |

- No bot firewall or rate limit for crawlers was seen. The public API has its own rate limits (`/api/public/jobs` allows 240 an hour per address), and robots.txt keeps crawlers off `/api/` except the public data the app needs to render.

## What an AI system can now read without running JavaScript
- **Who:** "BrillBrains Hiring Solutions is a recruitment service that works only with jewellery businesses…", in the hub, the home prerender and llms.txt.
- **What, who for and which roles:** hub sections, family pages and the role lists from the real role taxonomy.
- **How:** a 4-step process with the fee model (paid on joining, a percentage of yearly CTC, free replacement window).
- **Where:** "across India; most current openings in Mumbai…". This must be kept true.
- **How to start:** `/hire`, WhatsApp, phone.
- `/llms.txt`: a short index of these pages. It is optional and not a ranking factor.

## Entity consistency
- Organization schema names **BrillBrains Consultants** (brillbrainsconsultants.com) as the parent organisation.
- Still to do: the parent site should describe and link "BrillBrains Hiring Solutions" the same way, and the official social profiles should be added to `sameAs` once confirmed.

## Monitoring (manual until a tool is chosen)
- Use `03-ai-search-prompts.csv`. Once a month, ask each prompt in ChatGPT search, Perplexity, Gemini and Copilot, then record platform, date, whether BrillBrains is mentioned or cited, the URL cited and competitors cited. Answers vary, so run each prompt twice.
- **Do not fill in results without actually running the queries.**
- AI referral traffic: once GA4 is on, watch referrers `chatgpt.com`, `perplexity.ai`, `gemini.google.com` and `copilot.microsoft.com`. Leads arriving from them already keep `src` when they land with a tagged link.
