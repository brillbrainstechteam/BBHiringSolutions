// WhatsApp bot conversation (11.1). After someone taps "Hiring staff" or "Looking for a job" in the CRM bot,
// BBHS asks a few questions in the open 24-hour chat window, with tap buttons where it helps,
// and fills the new lead as the answers come in.
const D = require('./db');
const { get, run, now } = D;

const EXPERIENCE = ['Fresher', '1–3 years', '3–5 years', '5–10 years', '10+ years'];
const EXP_YEARS = { Fresher: 0, '1–3 years': 2, '3–5 years': 4, '5–10 years': 7, '10+ years': 12 };
const NEED = ['Hiring now', 'Hiring soon', 'Just exploring'];

const STEPS = {
  candidate: [
    { key: 'name', ask: 'Welcome to BrillBrains Hiring! What is your full name?\nआपका पूरा नाम क्या है?' },
    { key: 'city', ask: 'Which city do you want to work in?\nआप किस शहर में काम करना चाहते हैं?' },
    { key: 'job', ask: 'Which job do you want? For example: Sales Executive, Goldsmith, CAD Designer, Accountant.\nआप कौन सी नौकरी चाहते हैं?' },
    { key: 'experience', ask: 'How much experience do you have?\nआपका कितना अनुभव है?', buttons: EXPERIENCE },
    { key: 'cv', ask: 'Please send your CV as a PDF, Word file or photo. Or tap Skip.\nअपना CV भेजें, या Skip दबाएं।', buttons: ['Skip'] },
  ],
  client: [
    { key: 'name', ask: 'Welcome to BrillBrains Hiring! What is your name?\nआपका नाम क्या है?' },
    { key: 'company', ask: 'What is your company name?\nआपकी कंपनी का नाम क्या है?' },
    { key: 'city', ask: 'Which city is your business in?\nआपका व्यवसाय किस शहर में है?' },
    { key: 'roles', ask: 'Which roles do you need? For example: 2 sales executives, 1 cashier.\nआपको कौन से स्टाफ चाहिए?' },
    { key: 'need', ask: 'When do you need staff?\nआपको स्टाफ कब चाहिए?', buttons: NEED },
  ],
};

const L = () => require('./logic');
const say = (ptype, pid, text, buttons) => {
  try { L().sendWA({ ptype, pid, text, buttons: buttons || [], by: { label: 'Bot' } }); } catch (e) { console.error('Bot reply not sent:', e.message); }
};
function session(phone) {
  const s = get('SELECT * FROM bot_sessions WHERE phone=?', phone);
  if (!s) return null;
  if (Date.now() - new Date(s.updated_at) > 24 * 3600000) { run('DELETE FROM bot_sessions WHERE phone=?', phone); return null; }
  return { ...s, data: JSON.parse(s.data || '{}') };
}
function save(phone, kind, personId, step, data) {
  run('INSERT INTO bot_sessions (phone,kind,person_id,step,data,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET kind=excluded.kind, person_id=excluded.person_id, step=excluded.step, data=excluded.data, updated_at=excluded.updated_at',
    phone, kind, personId, step, JSON.stringify(data || {}), now());
}

// Called when someone taps one of the two bot buttons.
function start(phone, kind, personId, isNew) {
  const ptype = kind;
  if (!isNew) {
    const rec = get(`SELECT * FROM ${kind === 'client' ? 'clients' : 'candidates'} WHERE id=?`, personId);
    say(ptype, personId, `Welcome back! Your ${kind} ID is ${personId}. Open your ${kind === 'client' ? 'account' : 'profile'}: ${L().link(kind === 'client' ? 'my-account' : 'my-profile')}`);
    return rec;
  }
  const first = STEPS[kind][0];
  save(phone, kind, personId, first.key, {});
  say(ptype, personId, first.ask, first.buttons);
  return null;
}

// Called for every message while a conversation is open. Returns a short effect line, or null if no conversation.
function answer(phone, text, hasMedia) {
  const s = session(phone); if (!s) return null;
  const steps = STEPS[s.kind]; const i = steps.findIndex((x) => x.key === s.step); const step = steps[i];
  const t = String(text || '').trim();
  const table = s.kind === 'client' ? 'clients' : 'candidates';
  const patch = {};
  if (step.key === 'cv') {
    if (!hasMedia && t.toLowerCase() !== 'skip') { say(s.kind, s.person_id, 'Please send the CV as a file, or tap Skip.', ['Skip']); return 'Waiting for CV'; }
  } else if (step.buttons && !step.buttons.includes(t)) {
    say(s.kind, s.person_id, `Please tap one of the options.\n${step.ask}`, step.buttons); return 'Waiting for a tap';
  } else if (!t) {
    say(s.kind, s.person_id, step.ask, step.buttons); return 'Asked again';
  }
  if (step.key === 'name') { if (s.kind === 'client') patch.contact = t; else patch.name = t; }
  if (step.key === 'company') patch.company = t;
  if (step.key === 'city') { patch.city = t; patch.state = L().stateOf(t) || undefined; if (s.kind === 'candidate') patch.work_cities = [t]; }
  if (step.key === 'roles') patch.roles = t;
  if (step.key === 'need') patch.need = t;
  if (step.key === 'experience') patch.exp_total = EXP_YEARS[t];
  if (step.key === 'job') {
    const title = require('./importer').matchJobTitle(t);
    patch.job_wanted = title; patch.department = L().deptOf(title);
  }
  if (Object.keys(patch).length) {
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    if (table === 'candidates') patch.last_updated = now(); else patch.updated_at = now();
    D.edit(table, s.person_id, patch, 'WhatsApp bot');
  }
  const next = steps[i + 1];
  if (next) { save(phone, s.kind, s.person_id, next.key, s.data); say(s.kind, s.person_id, next.ask, next.buttons); return `Bot: ${step.key} saved`; }
  run('DELETE FROM bot_sessions WHERE phone=?', phone);
  D.update(table, s.person_id, { needs_check: null });
  const rec = get(`SELECT * FROM ${table} WHERE id=?`, s.person_id);
  if (s.kind === 'client') say('client', s.person_id, `Thank you, ${rec.contact}! Your client ID is ${rec.id}. Our team will call you soon. Your account: ${L().link('my-account')}`);
  else say('candidate', s.person_id, `Thank you, ${rec.name}! Your candidate ID is ${rec.id}. See matching jobs and your profile: ${L().link('my-profile')}`);
  return 'Bot: all details saved';
}

module.exports = { start, answer, session, STEPS };
