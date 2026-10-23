# What to fill in to switch everything on

All of these go in the `.env` file on the server (`/opt/bbhs-live/.env` after running the installer), except where it says "in the CRM" or "in Settings". After changing `.env`, restart: `sudo systemctl restart bbhs@live`.
Then open **Team portal → Settings → Health**: the **Setup (.env)** box shows what is connected, and there are buttons to send a test email and check the email inbox.

## 1. WhatsApp (welcome messages, login codes, interview and joining reminders, payment reminders)

Everything WhatsApp goes through the BrillBrains WhatsApp CRM (`whatsapp_crm` repository, branch `feat/bbhs-hiring-bridge`, which must be deployed first).

**In the CRM** → Settings → *Hiring Software (BBHS)*:
1. Tick **Hiring link on**.
2. **BBHS web address**: `https://<your hiring subdomain>`
3. **Webhook check word**: make up a long random word.
4. Press **Make a token** and copy it (shown once).

**In BBHS `.env`:**

| Setting | Value |
| --- | --- |
| `CRM_ENABLED` | `true` |
| `CRM_SEND_URL` | `https://<CRM address>/api/hiring/send` |
| `CRM_TOKEN` | the token from step 4 |
| `CRM_WEBHOOK_SECRET` | the check word from step 3 |

**Then, in the BBHS team portal** → Settings → Message formats → **Send all formats to Meta for approval**. After Meta reviews them (minutes to hours) press **Check approval status**. Messages only go out once their format shows *Approved*.

**In the CRM** → Bot: add a rule that asks *"Hiring or looking for a job?"* with the buttons **Hiring staff** and **Looking for a job**, so new WhatsApp chats become leads.

Reminders need nothing else: the timer checks every 10 minutes and sends interview reminders (day before and 2 hours before), joining reminders (3 days and 1 day before), day-30/60/90 check-ins, payment reminders (3 days before, due date, every 7 days overdue), daily-log reminders and the evening summary — all within quiet hours (9 pm–9 am) and the daily limit. Each can be turned off in Settings → Automatic messages.

## 2. Outgoing email (confirmations, team notices, and an email copy of every WhatsApp message)

When someone fills the hiring or job form, they get a confirmation email (if they typed their email), and the addresses in `NOTIFY_EMAILS` get a notice with the details. WhatsApp-bot and email-inbox leads also send the team notice.

Every WhatsApp message (welcome, interview fixed and reminders, offer, joining reminder, check-ins, profiles ready, JD approval, bill and payment reminders, task alerts, log reminder, day summary) also goes by email to the person's email address, at the same time and under the same rules: held to 9 am in quiet hours, never twice, not after STOP, and off when that automatic message is off in Settings. People with no WhatsApp number still get the email. Login codes and passwords never go by email. Team members get theirs at the email on their login (Team → Logins → Edit). `EMAIL_COPIES=off` stops the copies.

Settings → Automatic messages → **Send by**: *WhatsApp + email* (default for everything someone must act on or know at once) or *Email only* (default for the daily log reminder, evening day summary, monthly summary and the "still looking?" ping, to save WhatsApp charges). "Email only" still goes on WhatsApp to anyone without an email address, and to everyone until email is set up.

| Setting | Gmail / Google Workspace | Zoho | Microsoft 365 |
| --- | --- | --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` | `smtp.zoho.in` | `smtp.office365.com` |
| `SMTP_PORT` | `587` | `465` | `587` |
| `SMTP_SECURE` | `starttls` | `ssl` | `starttls` |
| `SMTP_USER` | the full address | the full address | the full address |
| `SMTP_PASS` | an **App Password** (Google account → Security → App passwords; needs 2-step verification) | the password or app password | the password (SMTP AUTH must be allowed for the mailbox) |
| `SMTP_FROM` | `BrillBrains Hiring <jobs@brillbrainsconsultants.com>` — must be the same mailbox or an allowed alias | | |
| `NOTIFY_EMAILS` | e.g. `preeti@…, hr@…` | | |

Test: Settings → Health → **Send test email**. Emails that fail are retried 3 times; the developer alert fires if they keep failing.

## 3. Email inbox door (CVs emailed to jobs@ become candidate leads)

| Setting | Gmail | Zoho | Microsoft 365 |
| --- | --- | --- | --- |
| `IMAP_HOST` | `imap.gmail.com` | `imap.zoho.in` | `outlook.office365.com` |
| `IMAP_PORT` | `993` | `993` | `993` |
| `IMAP_USER` / `IMAP_PASS` | the jobs@ address and its App Password (IMAP must be on in Gmail settings) | | |

Test: Settings → Health → **Check email inbox now**.

## 4. Other settings

| Setting | What it does |
| --- | --- |
| `ALERT_WEBHOOK_URL` | A Slack, Google Chat or Discord incoming-webhook link; the developer gets a message when something fails |
| `BACKUP_DIR` | A mounted or cloud-synced folder for the second daily backup copy |
| Settings → Business → **Support WhatsApp** | The number behind every "Need help?" button (currently a placeholder) |
| Settings → Business → address, GSTIN, PAN, bank, UPI | Printed on invoices |

## Summary — what I need from you

1. The server (IP and SSH user) and the hiring subdomain, with its DNS A record pointing at the server.
2. The CRM's web address (for `CRM_SEND_URL`) — and the CRM branch deployed.
3. The email account for sending (SMTP), and the addresses to notify.
4. Optional: the jobs@ inbox (IMAP), an alert webhook, a backup folder, the support WhatsApp number.
