// Bridge to the BrillBrains WhatsApp CRM (8.1). The hiring software never talks to Meta directly.
// Until Settings → WhatsApp connection is turned on, every message is saved as "would send".
const D = require('./db');
const L = require('./logic');

async function post(msg, text, vars) {
  const s = D.settings().crm;
  // Meta templates take values by position ({{1}}, {{2}} …): the order the blanks
  // first appear in this format's text for the chosen language.
  let paramList;
  if (msg.format) {
    const f = D.settings().formats[msg.format] || {};
    const order = [...new Set(((f[msg.lang] || f.en || '').match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1)))];
    paramList = order.map((k) => String((vars || {})[k] ?? ''));
  }
  // preview is the saved text, so a password or login code stays hidden in the CRM inbox too.
  const body = { ref: msg.id, phone: `91${msg.phone}`, format: msg.format, language: msg.lang, params: vars || {}, param_list: paramList, text: msg.format ? undefined : text, preview: msg.text, buttons: msg.buttons, tag: 'Hiring' };
  const res = await fetch(s.send_url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`CRM answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json().catch(() => ({}));
}
// The real text and filled details are only kept in memory for the retries, never in the saved history.
const pending = new Map();
async function dispatch(msg, realText, vars) {
  pending.set(msg.id, { text: realText, vars });
  const tries = (D.get('SELECT tries FROM messages WHERE id=?', msg.id) || {}).tries || 0;
  try {
    await post(msg, realText, vars);
    D.update('messages', msg.id, { status: 'sent', tries: tries + 1, error: null });
    pending.delete(msg.id);
  } catch (e) {
    retryLater(msg.id, e.message, tries + 1);
  }
}
function retryLater(id, error, tries) {
  const m = D.get('SELECT * FROM messages WHERE id=?', id); if (!m) return;
  const n = tries ?? (m.tries || 0) + 1;
  if (n >= 3) {
    D.update('messages', id, { status: 'failed', tries: n, error: error || 'Failed' });
    require('./alerts').devAlert("WhatsApp messages failing", `${id}: ${error}`);
    for (const s of L.superAdmins()) D.insert('alerts', { user_id: s.id, text: `WhatsApp ${id} failed 3 times: ${error}`, record_id: id, read: 0, at: D.now() });
    return;
  }
  D.update('messages', id, { status: 'sending', tries: n, error });
  setTimeout(() => dispatchStored(id), 30000 * n);
}
function dispatchStored(id) {
  const m = D.get('SELECT * FROM messages WHERE id=?', id); if (!m || !D.settings().crm.enabled) return;
  const p = pending.get(id) || { text: m.text, vars: {} };
  dispatch(m, p.text, p.vars);
}
L.setDispatcher((msg, text, vars) => { dispatch(msg, text, vars); });

module.exports = { dispatchStored, retryLater };
