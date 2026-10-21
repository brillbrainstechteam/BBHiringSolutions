# Hand test list — every row of section 7

Run this on the **test copy** before go-live (section 21), and again after every bigger change.
Tick a row only when **everything** under "Check" is true. Sample logins are at the top of `server/seed.js`.

Tips: keep two browser windows open (team portal + client or candidate account). In test mode, WhatsApp messages show as "would send" on the record and in the inbox; use **WhatsApp → Simulate reply** to play the person replying.

## Rows 1–30

| # | ✓ | Do | Check |
|---|---|---|---|
| 1 | ☐ | Open `/hire`, fill all fields (try the mic on the phone number: "nine eight double two …"), send. Send again with the same number and different roles. | Thank-you shows `CL-xxxx`; second time the same ID. Super admin: Leads → Client leads has it with a new dot, menu Leads count up, Dashboard "New leads" up, Clients list shows it. Client's WhatsApp history: `bbhs_client_welcome`. Second request is a note "came again from …". |
| 2 | ☐ | Open `/apply?src=fb-ad`, fill, attach a PDF CV, send. Repeat with the same number. | `CA-xxxx` shown, source "Facebook ad", CV in Files. Leads → Candidate leads, Candidates list, menu count. `bbhs_candidate_welcome` saved. Second time: same ID, updated. |
| 3 | ☐ | Super admin: assign the client lead from row 1 to AG-02. | Leaves Leads count. Rohan (AG-02 admin) sees it in Clients and in his WhatsApp inbox; bell + `bbhs_team_task_alert` to Rohan. Client owner = Rohan. |
| 4 | ☐ | As Sneha (sub admin): Clients → Create client account; Candidates → Create candidate account. | New IDs, agency AG-02, panel opens, welcome message saved. |
| 5 | ☐ | In the client account (`/my-account`): Raise a job opening. | New `JB-xxxx` status **Draft** in client Job openings and team Job openings; Dashboard "Write job description" item; recruiter gets a bell alert. |
| 6 | ☐ | As Rohan: New job opening for a client, with "JD already approved" ticked; another without. | First is **Open**, second **Draft**; status history line; shows in client panel and client account; job panel shows best matches. |
| 7 | ☐ | Open the Draft job → "Job description approved". | Status Open everywhere; a matching candidate sees it in "Jobs for you". |
| 8 | ☐ | Add a match from the job panel; in the candidate account tap Apply on another job. | New `AP-xxxx` at Applied with a history line; job goes Open → **Sourcing**; card on the Applications board; candidate status "In process · n"; shows in candidate's My applications. |
| 9 | ☐ | On the board, press → on a card (Applied → Screening). | Card moves column; history line; job panel, client account counts, candidate tracker updated; Performance "Screened" +1 for the person. |
| 10 | ☐ | Application panel → Schedule our interview. | New `IV-xxxx`; application → Our interview; job → **Interviewing**; Interviews page, candidate Home (with Confirm), Dashboard "interviews next 7 days" +1; `bbhs_interview_scheduled` saved. |
| 11 | ☐ | Candidate account → Confirm. Also: Simulate reply "Confirm" on another interview. | Interview shows "confirmed" on the Interviews page and in the application panel. |
| 12 | ☐ | Schedule an interview 1 minute ahead; wait; Settings → Automatic messages → Run the timer now. | Shows **Result pending** on Interviews page, Dashboard Needs attention, menu count; interviewer gets a task alert. |
| 13 | ☐ | Record result: Completed, Move ahead, 2 questions, rating 4, remark. | Application → Sent to client; Q&A and rating on the panel; client sees "Our interview notes" on the profile; Performance "Interviews" +1. Repeat with Not selected → application closed (Not suitable). |
| 14 | ☐ | (From row 13.) | Client account: Candidates tab + count + Home banner; job "Waiting for you" count; `bbhs_shortlist_ready` saved. |
| 15 | ☐ | Client account → Interested, set up interview (pick a time). | Application → Client interview; phone number now visible to the client; client Interviews shows it; team board updated. |
| 16 | ☐ | Client taps Not suitable on another profile. | Application closed (Client rejected); job status recalculated; candidate sees "Closed". |
| 17 | ☐ | Client account → Interviews → Give feedback: Selected. | Interview Completed / Selected on the team side; recruiter bell "record the offer". Repeat with Not selected → application closed. |
| 18 | ☐ | Application panel → Record the offer (CTC, joining date). | Application → Offer made; job → **Offer stage**; candidate Home banner with Accept / Decline; Dashboard "Offers waiting" +1; `bbhs_offer` saved. |
| 19 | ☐ | Candidate account → Accept (or Simulate reply "Accept offer"). | Application → Offer accepted; filled bar up (team + client); if filled = openings → job **Filled**; joining note on candidate side. Timer 3 days / 1 day before joining → `bbhs_joining_reminder`. |
| 20 | ☐ | On another offer: Decline. | Application closed (Offer declined); job goes back to the right status. |
| 21 | ☐ | Application panel → Mark joined. | Closed as Hired; draft bill `BL-xxxx` in Bills (Dashboard "Bill to issue"); after Issue: client Bills shows it, `bbhs_bill_raised` with UPI link; Dashboard "Joined" +1; Performance "Joined" +1; agency earnings show it. |
| 22 | ☐ | On an Offer accepted application → Did not join. | Closed (Did not join); seat opens; job Filled → Sourcing with a history note; bill (if any) cancelled with a credit note. |
| 23 | ☐ | Job panel → Put on hold; Resume; Close (reason). Also from the client account: Pause hiring. | Status + reason + history line everywhere; on hold / closed jobs leave candidates' "Jobs for you". |
| 24 | ☐ | Reopen a Filled job (+1) and a Closed job; client "I need this role again". | Same JB ID; openings +n if Filled; "Reopened" tag for 30 days; history line; back in Jobs for you. |
| 25 | ☐ | Super admin → bill → Record payment (part, then full with TDS). | Part paid → Paid; agency payout → Due; client Bills Paid; Dashboard overdue item gone. |
| 26 | ☐ | Logins & team → Add login; Reset password on another. | New `U-xx`; password shown once; can log in at once (asked to set own password); `bbhs_team_login` saved with the password hidden. |
| 27 | ☐ | Turn a login off; pause an agency. | They cannot log in ("turned off" / "paused"); Performance shows Login off / Paused; records stay. |
| 28 | ☐ | As Sneha: Daily logs → Submit. As Rohan: Approve. | Dots turn amber then green; Performance logs %; Dashboard "Log missing" gone. Before the deadline, with no log: timer sends `bbhs_log_reminder`. |
| 29 | ☐ | Send any WhatsApp from a green button. In test mode press "tick" on it in the inbox (or real: wait for CRM). | Message saved on the person's panel, the application history, the inbox thread; ticks sent → delivered → read. |
| 30 | ☐ | Simulate reply with text, then with "Accept offer" on an offer message. | Inbox unread count in the menu; thread shows it; 24-hour window open (free typing allowed); the button reply moves the application to Offer accepted. |

## Rows 31–49

| # | ✓ | Do | Check |
|---|---|---|---|
| 31 | ☐ | (a) A new WhatsApp number taps "Looking for a job" in the CRM bot and answers the questions (name, city, job, experience, CV file). (b) Upload an Excel of candidates with one bad row. (c) Send an email with a CV to the jobs@ mailbox, then Settings → Health → Check email inbox now. | (a) New candidate with source "WhatsApp bot", answers filled, CV in Files. (b) Rows created; bad row listed with the reason; no messages sent. (c) Candidate with source "Email", phone/email from the CV, CV saved; if no phone, it is in Leads → Needs checking. Welcome only when consent is recorded (others get the consent request). |
| 32 | ☐ | Make two candidates with the same email, different numbers → Leads → Needs checking → Merge. | One record kept; the other ID opens the kept one; applications, interviews, messages, files moved; history line. |
| 33 | ☐ | Job panel → Write JD → tick "Send to client". | JD status "Waiting for client"; client Job openings shows Approve / Ask for changes; request saved for the client. |
| 34 | ☐ | Client: Approve (and on another job: Ask for changes). | Draft → Open everywhere; JD PDF saved on the job; recruiter bell. Changes: job stays Draft with the client's note; Dashboard "Write job description" shows "(client asked for changes)". |
| 35 | ☐ | Job panel → tick a posting channel done with a link; Copy link; open it. | Posting date shown; the tagged link (`?src=…&job=…`) fills the source; Apps count per channel in the job panel and the Per job report. |
| 36 | ☐ | Client panel → tick Intro call (with notes), Proposal; client uploads all 3 KYC files and signs the contract. | Checklist items with date and who; stage moves (Understanding needs → Proposal → Client activated); client Home checklist updated; Clients list stage. |
| 37 | ☐ | Application at Offer made → Make offer letter; client account → Send to candidate. | PDF filled from the client's template saved on the application; candidate sees "Read offer letter" in My applications. |
| 38 | ☐ | Candidate uploads PAN, Aadhaar etc.; client ticks the joining checklist. | Files on the application panel; ticks with who and when on both sides. |
| 39 | ☐ | On a joined application: Simulate reply "Need help". | "At risk" on the application; Dashboard Needs attention "At risk"; recruiter bell + task alert. |
| 40 | ☐ | Joined application → Left the job (Left on their own, within 90 days). | Left date + reason; candidate back "Actively looking"; job reopens +1 tagged "Replacement for AP-…"; payout on hold; Replacements report lists it; recruiter alert. Repeat with "Removed by client" → no free replacement. |
| 41 | ☐ | Fill the replacement seat and mark joined. | Bill at ₹0 marked "Replacement"; first hire's held agency share released. |
| 42 | ☐ | Issue a bill; record a part payment; add a credit note with "Make a new draft bill"; let a due date pass and run the timer. | Status Due → Part paid → Paid / Cancelled; Money view, Earnings, client Bills, Dashboard overdue all agree; payment reminder by rule (3 days before, due date, every 7 days overdue). |
| 43 | ☐ | Bills → tick bills with payout Due → Mark selected payouts paid. | Payout Paid with reference; agency Earnings statement shows it paid. |
| 44 | ☐ | Settings: change the fee to 10%, add a city, hide a job. | New bills use 10%, old ones unchanged; forms suggest the new city; hidden job gone from forms (still on old records). |
| 45 | ☐ | Simulate reply STOP, then START. | "Opted out" badge; left out of job alerts and bulk sends (shows as skipped); confirmation message; START turns it back on. |
| 46 | ☐ | Candidate account → Ask to delete my data; super admin → Settings → Data requests → Approve. | Name shows "Removed person" everywhere; files and messages text removed; IDs, bills and counts kept. |
| 47 | ☐ | Any panel → Remind me (2 minutes ahead); run the timer after. | Due in My day; bell alert; task alert saved. |
| 48 | ☐ | Log in with a wrong password 5 times. | Locked 15 minutes ("Locked until …"); admin gets a bell alert; Logins & team shows Locked with Unlock; failed logins in history. |
| 49 | ☐ | On the test copy, import the real trackers in order: Client Master → Job Tracking / Ref → Candidate Database + Sheet6 (Candidates → Upload Excel). | Counts match the sheets; old job codes searchable; the error list explains each row not loaded; no WhatsApp sent. |

## Also check

| ✓ | Check |
|---|---|
| ☐ | Every page works at phone width (390 px): no sideways scrolling, menu becomes a top bar. |
| ☐ | A sub admin cannot open another recruiter's job by typing its URL / ID in search (403). |
| ☐ | Downloads (Excel) contain only rows the person may see; the download is in history. |
| ☐ | Settings → Health: backup made today, test restore OK, timer ran in the last 10 minutes. |
| ☐ | Upload the EICAR test file as a CV → refused by the virus check. |
