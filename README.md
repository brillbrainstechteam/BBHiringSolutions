# BBHS Hiring Software

Hiring software for the jewellery trade (and any other industry set up in Settings), built from *BBHS Hiring Software — Build Guide*.
One web app holds the five parts:

| Part | Address |
| --- | --- |
| Client form | `/hire` (tags: `?src=fb-ad`) |
| Candidate form | `/apply` (tags: `?src=naukri&job=JB-2004`, `?ref=CA-3001`) |
| Client account | `/my-account` |
| Candidate account | `/my-profile` |
| Team portal | `/team` |

## Run it

Needs Node.js 22.5 or newer. There are no packages to install: the app uses Node's built-in SQLite, HTTP and crypto.

```bash
npm start
```

Open http://localhost:4600. The first start creates `data/bbhs.db` with **sample data** (marked so it can be removed in Settings → Business → *Remove sample data*).
`npm run reset` deletes `data/` and starts fresh.

**Test logins** are listed at the top of [server/seed.js](server/seed.js). WhatsApp is not connected yet ("test mode"), so login codes for clients, candidates and the super admin's new-device check are shown on screen.

## How it is built

| Folder | What is in it |
| --- | --- |
| `server/db.js` | Tables, ID counters (CL-1001, JB-2001 … never reused), settings, append-only history (triggers block edits), backups |
| `server/logic.js` | Steps and job statuses (5), matching, fees/GST/bill numbers, WhatsApp rules (8), lead intake and merge (11), after joining (15), button replies (8.7) |
| `server/router.js` | Sessions and the access rules of section 4, checked on the server for every request |
| `server/api-team.js` | Team portal API: dashboard, leads, clients, jobs, candidates, applications, interviews, inbox, performance, logs, bills, logins, settings, reports |
| `server/api-public.js` | Logins (lockout, codes), forms, client and candidate accounts, file access, CRM webhooks |
| `server/importer.js` | Excel/CSV import with saved column matching and the cleaning rules of section 20 |
| `server/timer.js` | Every 10 minutes: reminders, result pending, check-ins, payment reminders, log reminders, day summary, quiet-hour release, backups |
| `server/files.js` | File store (type, size and content checks, versions), `.xlsx` reader, CSV downloads, PDF papers (offer letter, invoice, JD, short CV) |
| `public/` | The single-page UI: `forms.js`, `client.js`, `candidate.js`, `team.js` + `team-pages.js`, `panels.js` (side panels and pop-ups), `core.js` (message window, voice typing) |

Every number on screen (job status, filled seats, days in step, match score, candidate status, performance, fees) is worked out from the records and history lines — none is typed.

## WhatsApp through the CRM (phase 6)

Until Settings → WhatsApp is turned on, every message is saved on its record as **"would send"**, with the same rules as live: approved formats only, 24-hour window for free text, quiet hours (held until 9 am), 3 automatic messages a day per person, never the same reminder twice, STOP respected. The inbox has a **Simulate reply** box so button replies (Confirm, Accept offer, Interested, STOP …) can be tested end to end.

The CRM side is on the `feat/bbhs-hiring-bridge` branch of BB_WHATSAPP_CRM (see its README, "Hiring software (BBHS) link"). To connect: in the CRM, Settings → Hiring Software (BBHS) → turn on, enter this app's address and a check word, make an API token. Here, Settings → WhatsApp → tick Connected, send link `<CRM address>/api/hiring/send`, paste the token and the same check word.

The contract:

1. **Send link**: `POST <send_url>` with `Authorization: Bearer <token>` and body
   `{ ref, phone: "91XXXXXXXXXX", format, language, param_list: [values in {{1}}, {{2}} order], params: {name, job, …}, text, preview, buttons, tag: "Hiring" }`. Answers 2xx `{ id }` when Meta accepted it. `preview` is the saved text, with passwords and login codes hidden.
2. **Replies** for chats marked "Hiring": `POST /api/crm/inbound` with header `x-bbhs-secret: <webhook check word>` and body
   `{ phone, text, button, reply_to: "<ref of our message>", bot: "client" | "candidate", name, company, city, job, roles }`.
   Email-inbox leads use the same link with `{ kind: "email", name, phone, email, city, job, cv: {name, base64} }`.
3. **Status**: `POST /api/crm/status` (same header) with `{ ref, status: "sent" | "delivered" | "read" | "failed", error }`.

Failed sends retry 3 times, then show in Inbox → Failed and Settings → Health with a Retry button.

## Settings file (.env), going live, testing

- Copy `.env.example` to `.env` and fill it in: copy name (test / live), web address, CRM link and token, email inbox (IMAP), error-alert webhook, ClamAV virus scanner, off-server backup folder. Values in `.env` win over Settings and show there as "Set in the .env file". Settings → Health shows what is set.
- The **test** copy adds sample data and shows a TEST COPY marker; the **live** copy starts empty — make the first super admin with `npm run make-admin -- "Name" username 98XXXXXXXX`.
- [docs/DEPLOY.md](docs/DEPLOY.md): server, two copies, HTTPS (Caddy), ClamAV, backups, connecting the CRM, the go-live checklist. Server files are in [deploy/](deploy/).
- [docs/TEST-LIST.md](docs/TEST-LIST.md): the hand test list for all 49 rows of section 7.
- 1-page guides per level open from the app: `/guides/super-admin.html`, `admin.html`, `sub-admin.html`, `client.html`.

## Notes

- **Voice typing** uses the browser's speech recognition (Chrome). Spoken numbers like "nine eight double two…" or Hindi digits become 10 digits.
- **Offer letter / contract signing** is the simple in-app "I agree" with name, time and IP (open decision in section 23).
- The poster QR code is drawn by api.qrserver.com from the apply link.
- **Email inbox**: CVs are read for name, phone, email, city and job. PDF reading works for normal text PDFs; scanned (photo) CVs have no text, so those leads land in Leads → Needs checking.
- Open decisions from section 23 use the suggested starting values (18% GST in one state, in-house team = AG-01 with 0% share, quiet hours 9 pm–9 am, 3 messages a day, 7 pm log deadline).
