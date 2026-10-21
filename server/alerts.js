// Error alerts for the developer (section 21): a form not saving, WhatsApp sends failing, the timer stopping.
// Posts to ALERT_WEBHOOK_URL (Slack, Google Chat or Discord incoming webhook) and shows in Settings → Health.
const D = require('./db');

const lastSent = new Map();
function devAlert(title, detail) {
  D.setHealth('last_failure', `${D.now()} ${title}${detail ? ': ' + detail : ''}`);
  const url = D.ENV.alertWebhook;
  if (!url) return;
  // The same alert at most once every 30 minutes.
  const key = title;
  if (lastSent.has(key) && Date.now() - lastSent.get(key) < 30 * 60000) return;
  lastSent.set(key, Date.now());
  const text = `BBHS (${D.ENV.name} copy): ${title}${detail ? '\n' + String(detail).slice(0, 800) : ''}`;
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }) })
    .catch((e) => console.error('Alert webhook failed:', e.message));
}
module.exports = { devAlert };
