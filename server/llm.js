// One door for every AI call in the portal: JSON answers that follow a schema. Uses OpenAI when OPENAI_API_KEY is
// set (model: OPENAI_MODEL, default gpt-4o-mini, cheap and accurate for extraction and writing), else Anthropic when
// ANTHROPIC_API_KEY is set. No outside packages: OpenAI is called over HTTPS with Node's fetch.
const { httpError } = require('./db');

const provider = () => (process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : null);
const available = () => !!provider();

async function viaOpenAI({ system, user, schema, name, maxTokens }) {
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } } }),
    });
  } catch (e) { throw httpError(424, `The AI service could not be reached (${e.name === 'TimeoutError' ? 'timed out' : e.message}).`); }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { console.error('OpenAI: API key rejected'); throw httpError(424, 'The AI key was rejected. Check OPENAI_API_KEY in the server .env.'); }
  if (res.status === 429) throw httpError(429, 'The AI service is busy or out of credit. Please try again later.');
  if (!res.ok) { console.error('OpenAI error', res.status, body.error && body.error.message); throw httpError(424, 'The AI service could not finish. Please try again.'); }
  const msg = body.choices && body.choices[0] && body.choices[0].message;
  if (!msg || msg.refusal) throw httpError(422, 'The AI declined this one. Please do it by hand.');
  if (body.choices[0].finish_reason === 'length') throw httpError(424, 'The AI answer came out too long. Please try again.');
  try { return JSON.parse(msg.content); } catch { throw httpError(424, 'The AI gave an unreadable answer. Please try again.'); }
}

let sdk;
async function viaAnthropic({ system, user, schema, maxTokens }) {
  if (sdk === undefined) { try { const m = require('@anthropic-ai/sdk'); sdk = m.default || m; } catch { sdk = null; } }
  if (!sdk) throw httpError(424, 'AI is not set up on this server.');
  const client = new sdk(); let res;
  try {
    res = await client.messages.create({ model: 'claude-haiku-5-5', max_tokens: maxTokens, output_config: { effort: 'low', format: { type: 'json_schema', schema } }, system, messages: [{ role: 'user', content: user }] });
  } catch (e) {
    if (e instanceof sdk.RateLimitError) throw httpError(429, 'The AI service is busy. Please try again in a minute.');
    if (e instanceof sdk.AuthenticationError) { console.error('Anthropic: API key rejected'); throw httpError(424, 'The AI key was rejected.'); }
    if (e instanceof sdk.APIError) { console.error('Anthropic error', e.status, e.message); throw httpError(424, 'The AI service could not finish. Please try again.'); }
    throw e;
  }
  if (res.stop_reason === 'refusal') throw httpError(422, 'The AI declined this one. Please do it by hand.');
  if (res.stop_reason === 'max_tokens') throw httpError(424, 'The AI answer came out too long. Please try again.');
  try { return JSON.parse(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch { throw httpError(424, 'The AI gave an unreadable answer. Please try again.'); }
}

// system + user text in, an object matching schema out. The schema must list every property in "required" and set
// additionalProperties: false (OpenAI's strict mode needs both).
async function json({ system, user, schema, name = 'answer', maxTokens = 3000 }) {
  const p = provider(); if (!p) throw httpError(424, 'AI is not set up yet: add OPENAI_API_KEY to the server .env.');
  return p === 'openai' ? viaOpenAI({ system, user, schema, name, maxTokens }) : viaAnthropic({ system, user, schema, maxTokens });
}

// ---------- candidate details from an email and/or a resume ----------
const S = (d) => ({ type: 'string', description: d }); const N = (d) => ({ type: ['number', 'null'], description: d });
const CAND_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'whatsapp', 'email', 'city', 'state', 'job_wanted', 'role_applied_for', 'job_id_mentioned', 'exp_total', 'exp_jewellery', 'current_company', 'current_salary_month', 'expected_salary_month', 'notice_days', 'skills', 'education', 'languages', 'is_job_application'],
  properties: {
    name: S("The candidate's full name, title case; empty if not found"),
    whatsapp: S('Their Indian mobile number, 10 digits only, no +91; empty if none'),
    email: S("The candidate's own email (not a job portal's no-reply address); empty if none"),
    city: S('City they live in or want to work in'), state: S('Indian state of that city'),
    job_wanted: S('The job they do or want, as a short job title (e.g. "CAD Designer", "Sales Executive")'),
    role_applied_for: S('The specific role this email applies for, only if the email clearly says so; else empty'),
    job_id_mentioned: S('A job code written in the email like JB-2031; else empty'),
    exp_total: N('Total work experience in years'), exp_jewellery: N('Years of experience in the jewellery industry; 0 if clearly none, null if unknown'),
    current_company: S('Current or most recent employer'),
    current_salary_month: N('Current monthly salary in rupees'), expected_salary_month: N('Expected monthly salary in rupees'),
    notice_days: N('Notice period in days'),
    skills: { type: 'array', items: { type: 'string' }, description: 'Up to 12 short skills' },
    education: S('Highest education, short'), languages: { type: 'array', items: { type: 'string' } },
    is_job_application: { type: 'boolean', description: 'True if this is a person sending their own job application or CV' },
  },
};
const CAND_SYSTEM = `You read job applications sent by email to an Indian recruitment agency that hires for the jewellery trade and other businesses. From the email and the resume text, pull out the candidate's details.
Use only what is written. Never guess a phone number, email, salary or experience that is not there: leave it empty or null. Salaries written as LPA or per year become per month (yearly / 12). "Immediate" notice is 0 days; months become days (x30).
Emails from job portals (Naukri, Indeed, Apna, WorkIndia, LinkedIn) describe the applicant: use the applicant's details, not the portal's.`;
async function extractCandidate({ subject = '', from = '', body = '', resume = '' }) {
  const user = `Email from: ${from}\nSubject: ${subject}\n\nEmail text:\n${String(body).slice(0, 6000)}\n\nResume text:\n${String(resume).slice(0, 14000) || '(no readable resume)'}`;
  return json({ system: CAND_SYSTEM, user, schema: CAND_SCHEMA, name: 'candidate', maxTokens: 1500 });
}

module.exports = { json, available, provider, extractCandidate };
