# Going live (section 21)

BBHS runs as **two copies** on one server: a **test** copy (sample data, test WhatsApp, a "TEST COPY" marker on every page) and the **live** copy. New work is checked on the test copy first.

| Copy | Web address (example) | Port | Folder for data | Settings file |
| --- | --- | --- | --- | --- |
| live | `https://hire.brillbrainsconsultants.com` | 4600 | `/var/lib/bbhs-live` | `/opt/bbhs-live/.env` |
| test | `https://test-hire.brillbrainsconsultants.com` | 4601 | `/var/lib/bbhs-test` | `/opt/bbhs-test/.env` |

Both web addresses open the five parts at `/hire`, `/apply`, `/my-account`, `/my-profile` and `/team`.

## 1. Server

A small Linux server (Ubuntu 22.04+, 1 GB RAM is enough to start), the same one as the WhatsApp CRM or a separate one.

```bash
# Node 22 or newer
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs
# Virus scanner for uploads
sudo apt-get install -y clamav-daemon && sudo systemctl enable --now clamav-daemon
# HTTPS in front of the app
sudo apt-get install -y caddy
```

ClamAV listens on a Unix socket by default. Make it also listen on TCP for BBHS: in `/etc/clamav/clamd.conf` add `TCPSocket 3310` and `TCPAddr 127.0.0.1`, then `sudo systemctl restart clamav-daemon`.

## 2. The two copies

```bash
sudo useradd --system --home /opt/bbhs bbhs
for c in live test; do
  sudo git clone https://github.com/brillbrainstechteam/BBHiringSolutions.git /opt/bbhs-$c
  sudo mkdir -p /var/lib/bbhs-$c && sudo chown bbhs: /var/lib/bbhs-$c
  sudo cp /opt/bbhs-$c/.env.example /opt/bbhs-$c/.env   # then fill it in (see below)
done
sudo cp /opt/bbhs-live/deploy/bbhs@.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bbhs@live bbhs@test
```

In each `.env`:

| Setting | live | test |
| --- | --- | --- |
| `BBHS_ENV` | `live` | `test` |
| `PORT` | `4600` | `4601` |
| `BBHS_DATA` | `/var/lib/bbhs-live` | `/var/lib/bbhs-test` |
| `BASE_URL` | `https://hire.brillbrainsconsultants.com` | `https://test-hire.brillbrainsconsultants.com` |
| `CRM_*` | the live CRM link | the CRM link with a test number, or `CRM_ENABLED=false` |
| `IMAP_*` | the jobs@ mailbox | a separate test mailbox (or empty) |
| `ALERT_WEBHOOK_URL`, `CLAMD_HOST=127.0.0.1`, `BACKUP_DIR` | set | set |

The live copy starts empty. Make the first super admin (the password is shown once):

```bash
cd /opt/bbhs-live && sudo -u bbhs BBHS_DATA=/var/lib/bbhs-live npm run make-admin -- "Preeti" preeti 98XXXXXXXX
```

## 3. HTTPS

Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, put in the real addresses, point the DNS of both names at the server, and `sudo systemctl reload caddy`. Caddy gets and renews the certificates by itself.

## 4. WhatsApp through the CRM

1. CRM → Settings → **Hiring Software (BBHS)**: turn on, BBHS address = the copy's `BASE_URL`, type a check word, **Make a token**.
2. BBHS `.env`: `CRM_ENABLED=true`, `CRM_SEND_URL=<CRM address>/api/hiring/send`, `CRM_TOKEN=<token>`, `CRM_WEBHOOK_SECRET=<check word>`. Restart: `sudo systemctl restart bbhs@live`.
3. BBHS → Settings → Message formats → **Send all formats to Meta for approval**. After Meta reviews them (minutes to hours): **Check approval status**.
4. CRM → Bot: add a rule that asks *"Hiring or looking for a job?"* with the buttons **Hiring staff** and **Looking for a job**.

## 5. Backups

Every night a full copy of the database goes to `<BBHS_DATA>/backups` (kept 30 days) and, when `BACKUP_DIR` is set, a second copy goes there (a mounted drive or a cloud-synced folder). Uploaded files are in `<BBHS_DATA>/files` — include that folder in the server's own backup.
Once a month: Settings → Health → **Test restore** (it opens the newest backup and counts the records).

## 6. Before go-live (checklist)

- [ ] All 18 formats show **Approved** in Settings → Message formats.
- [ ] Excel trackers moved in on the **test** copy, counts checked, error list cleared — then on the live copy (Candidates → Upload Excel, in the order of section 20).
- [ ] Live copy: no sample data (it never adds any); ID start numbers set in Settings → Fees & limits.
- [ ] Super admin, agency and admin logins made.
- [ ] Every row of `docs/TEST-LIST.md` ticked on the test copy by a person.
- [ ] Settings → Health shows: virus scanner set, alerts set, off-server backup set, email inbox set, timer ran in the last 10 minutes.
- [ ] Training: the 1-page guides are linked in the app (`/guides/super-admin.html`, `admin.html`, `sub-admin.html`, `client.html`).

## 7. After go-live

Watch Settings → Health daily for two weeks. Once a month: test restore, failed messages, and the data-removal reminders (inactive candidates older than the retention setting).

## Updating

```bash
cd /opt/bbhs-test && sudo git pull && sudo systemctl restart bbhs@test   # check on the test copy first
cd /opt/bbhs-live && sudo git pull && sudo systemctl restart bbhs@live
```
