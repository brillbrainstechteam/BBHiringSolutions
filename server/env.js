// Reads .env (KEY=VALUE lines) from the project folder into process.env, then exposes
// the values the app uses. Secrets live here, never in the code or the database.
const fs = require('fs');
const path = require('path');

const file = process.env.BBHS_ENV_FILE || path.join(__dirname, '..', '.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
const e = process.env;
const flag = (v) => (v === undefined || v === '' ? undefined : /^(1|true|yes|on)$/i.test(v));

module.exports = {
  name: (e.BBHS_ENV || 'test').toLowerCase(), // "test" copy (sample data, banner) or "live"
  port: Number(e.PORT) || 4600,
  dataDir: e.BBHS_DATA || path.join(__dirname, '..', 'data'),
  baseUrl: e.BASE_URL || '',
  crm: { enabled: flag(e.CRM_ENABLED), sendUrl: e.CRM_SEND_URL || '', token: e.CRM_TOKEN || '', secret: e.CRM_WEBHOOK_SECRET || '' },
  imap: { host: e.IMAP_HOST || '', port: Number(e.IMAP_PORT) || 993, user: e.IMAP_USER || '', pass: e.IMAP_PASS || '', folder: e.IMAP_FOLDER || 'INBOX' },
  alertWebhook: e.ALERT_WEBHOOK_URL || '',
  clamd: { host: e.CLAMD_HOST || '', port: Number(e.CLAMD_PORT) || 3310 },
  backupDir: e.BACKUP_DIR || '',
};
