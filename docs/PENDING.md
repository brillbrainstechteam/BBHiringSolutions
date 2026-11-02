# Pending list

Last updated 2 Nov 2026. The live list of messages is in the portal: Settings → Messages on hold.

## Needed from you

| # | What | Why it matters |
|---|---|---|
| 1 | Add credit to the OpenAI account | The key has run out. Until then Find online and Rank with AI show an error, Paste notes uses simple rules, and new CVs are read by rules only. |
| 2 | Put the SMTP details in the server `.env` (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) | No email can leave until this is done. |
| 3 | Add the Accounts email: Settings → Fees & limits | Invoice requests have nowhere to go without it. |
| 4 | Decide: should Vaibhav Kanpur earn a share on the clients with no agency? | Today those bills carry no agency share. |
| 5 | Upload signed contracts for the 17 clients marked Lead | Each one becomes an active client as soon as its contract is uploaded. The team can work on them in the meantime. |
| 6 | Fill "Date & Location" in the Recruitment Agreement, then replace it from the Recruitment Agreement page | It is still a blank in the standard copy that clients read. |
| 7 | Create Dhanvi's login in Logins & team (team: Social media) | They run the creative and channel steps. |
| 8 | Name owners for the channels marked "To be decided" | Colleges, institutes, agencies and job fairs have no owner. |
| 9 | Share the Google Drive folder link and access | Needed to import resumes (see below). |
| 10 | Give the Meta ad account ID and a Marketing API token | Needed to fetch ad spend by itself. Report upload works today. |
| 11 | Confirm the two numbers still allowed | `9093400666` and `9986950695` still get automatic messages. `8368372836` is no longer on the list; it was not removed by this work. |
| 12 | Finish your last sentence | "admin will be able to add expenses ... see their performance and" was cut off. |

## Messages to switch on later

Everything automatic is held. Held messages are not sent later; only new ones go after switching on. Login codes, team passwords and replies typed by hand still go. On live: 644 old emails and 68 WhatsApp messages are held.

**Before switching on:** items 2 and 3 above, and Meta approval for these templates: `bbhs_client_thanks` (new), `bbhs_jd_approval`, `bbhs_team_login`.

| Message | To | Goes by |
|---|---|---|
| Thank-you after the first call (new) | Client | WhatsApp |
| Recruitment Agreement, KYC request and other portal emails (new) | Client | Email |
| Invoice request (new) | Accounts | Email |
| Welcome with account link | Client, candidate | WhatsApp, email |
| "We received your request", "Your application is in" | Client, candidate | Email |
| Job description for approval | Client | WhatsApp, email |
| Profiles ready | Client | WhatsApp, email |
| Interview fixed, interview reminders | Candidate, client | WhatsApp, email |
| Interview feedback request | Client | WhatsApp, email |
| Offer, joining reminders, post-joining check-ins | Candidate | WhatsApp, email |
| Job alerts, "still looking?" | Candidate | WhatsApp, email |
| Bill raised, payment reminders, monthly summary | Client | WhatsApp, email |
| Task alerts, log reminders, day summary | Team | WhatsApp or email |
| New lead alerts | Team | Email |
| WhatsApp bot auto-replies | Anyone writing in | WhatsApp |

## Not finished

| What | State | What it needs |
|---|---|---|
| WhatsApp group created automatically, and all client messages through it | The portal records the group and makes the picture. Creating it is manual. | Changes to the separate WhatsApp CRM, your OK to deploy it, and Meta group API access. |
| Old resumes from WhatsApp | New CVs sent on WhatsApp save automatically. Old ones are not imported. | Same CRM work: it would have to fetch past files from Meta, which keeps media only for a limited time. |
| Resumes from Google Drive | Upload CVs works for files you download. Direct import is not built. | Item 9, plus: resumes only or sub-folders, what to do when a CV has no phone number, and the source label. |
| Ad spend fetched by itself | Upload from Meta and LinkedIn works, with spend per job, for the super admin. | Item 10. |
| Invoice number read from the CC email | Typed in on the bill. | Tell us the Accounts sender and invoice format. |
| Online lookup cost | Could not be measured with no credit. Estimated ₹1 to ₹3 per lookup. | Item 1, then one test. |

## Good to know

- The CV for clients is rebuilt as a clean BrillBrains PDF, so it does not keep the candidate's own layout. A scanned or photo CV gives a profile summary only, with no resume text.
- AI ranking runs when someone presses Rank with AI on a job. It does not run by itself, to control cost.
- Client emails reach the client's record only if they land in the inbox label the portal reads.
- Candidate phone numbers keep their existing protection.
