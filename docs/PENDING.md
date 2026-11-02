# Pending list

Last updated 2 Nov 2026. The live list of messages is in the portal: Settings → Messages on hold.

## Needed from you

| # | What | Why it matters |
|---|---|---|
| 1 | In the `transform@dgtrainings.com` Gmail: add `hiringsolutions@brillbrainsconsultants.com` under Settings → Accounts → Send mail as | Until then, Gmail is likely to show the sender as `transform@dgtrainings.com`. |
| 3 | Add the Accounts email: Settings → Fees & limits | Invoice requests have nowhere to go without it. |
| 4 | Create Dhanvi's login: Logins & team → + Add login (team: Social media) | They run the creative and channel steps. Needs their WhatsApp number. |
| 5 | Pick owners for the 6 channels marked "To be decided" in Digital Reach | Admins and sub-admins can set them too. College Placement Cell, Training Institutes, Training Institutes (partnership), College Placement Cell (tie-up), Local Hiring Agencies, Job Fairs. |
| 6 | Settings → Message formats: press Send all formats to Meta for approval, then Check approval status after a day | `bbhs_client_thanks`, `bbhs_jd_approval` and `bbhs_team_login` are not approved. |
| 7 | Check WhatsApp Manager → Account tools → Phone numbers | Shows whether `9093400444`, `9093400222` and any new number are on this account. It decides the two WhatsApp items below. |
| 8 | Copy the resumes off the phones with `9093400444` and `9093400222` | See "Old WhatsApp resumes". |
| 9 | Give the Meta ad account ID and a Marketing API token | Needed to fetch ad spend by itself. Upload works today. Paste the token on the server, never in chat. |
| 9a | Give the right dates for 4 LinkedIn candidates | Their Excel upload gave Applied dates in June and July 2028. |
| 9b | Finish your sentence: "once the application status changes to offer" | It was cut off. |
| 10 | Confirm the two numbers still allowed | `9093400666` and `9986950695` still get automatic messages while everything else is held. |

## Messages to switch on later

Everything automatic is held. Held messages are not sent later; only new ones go after switching on. Login codes, team passwords, replies typed by hand and the Recruitment Agreement still go. Decided 2 Nov 2026: KYC and other emails written in the portal stay held. On live: 644 old emails are held.

**Clients from before the portal (28):** they get no automatic WhatsApp or email, even after messages are switched on, until a new job opening is added for them. Added clients get messages as usual.

| Message | To | Goes by |
|---|---|---|
| Thank-you after the first call | Client | WhatsApp |
| KYC request and other portal emails | Client | Email |
| Invoice request | Accounts | Email |
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
| WhatsApp group created automatically | The portal records the group and makes the picture. Creating it is manual. | Official Business Account (blue tick) on the number. Meta's groups hold at most 8 people. Then changes to the WhatsApp CRM and your OK to deploy them. |
| A second number sending messages | The CRM runs one number only. | Which number, and what it sends. It must be added to the Meta account and registered, then the CRM needs changes and your OK to deploy them. |
| Old WhatsApp resumes | New CVs sent on the connected number save automatically. | Item 8. Meta has no way to list past chats on a number. |
| Ad spend fetched by itself | Upload from Meta and LinkedIn works, with spend per job, for the super admin. | Item 9. |

## Done on 2 Nov 2026

- OpenAI credit works. One Client info search used 8,906 tokens in, 133 out and one web search, roughly ₹1. The charge shows on each search.
- Historical import: 97 resumes and 473 people from three Naukri exports, all from the Drive folder and all with source Google Drive. No message went to anyone. 14 have no phone and show "No phone found". A copy of the database from before the import is at `/var/lib/bbhs-live/before-import-2026-11-02.db`, the new IDs are in `/var/lib/bbhs-live/imported-ids-2026-11-02.txt`, and the Naukri ones in `/var/lib/bbhs-live/was-naukri-ids-2026-11-02.txt`.
- Invoice number stays typed in by hand, by decision.
- Vaibhav Kanpur's share is 35%, and a client with no agency now bills through the one active agency.
- The "Date & Location" blank stays in the standard agreement: fill it per client in the Agreement box.

## Good to know

- The CV for clients is rebuilt as a clean BrillBrains PDF, so it does not keep the candidate's own layout. A scanned or photo CV gives a profile summary only, with no resume text.
- AI ranking runs when someone presses Rank with AI on a job. It does not run by itself, to control cost.
- Replies are found by the client's saved email address, so it must match the address they write from. Checked every 10 minutes from 2 Nov 2026 on.
- Candidate phone numbers keep their existing protection.
- Imported candidates gave no consent to messages from the portal, so job alerts do not go to them.
