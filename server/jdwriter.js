// Writes job descriptions with AI (server/llm.js: OpenAI's OPENAI_MODEL, default gpt-5.4-nano; Claude when only the
// Anthropic key is set). Two uses: the whole JD for a role from what the client said on the call, or one section again.
// The sections and their order come from Settings (jd_sections).
const { httpError } = require('./db');
const LLM = require('./llm');

const SYSTEM = `You are a senior recruiter at BrillBrains Hiring Solutions, a recruitment firm for India's jewellery trade (showrooms, manufacturers, wholesalers, exporters, online jewellery brands). You write the job description (JD) that the client approves and candidates then read.

How to write:
1. Use only the facts given: CLIENT, ROLE, CALL (what the client told us) and CURRENT DRAFT. Turn what the client said into specific duties and requirements, keeping their exact words for products, metals, software, counters and targets.
2. Never invent facts: no salary, incentive, benefit, timing, headcount, year or number that is not given. Leave a section as "" when nothing true can be said. Only Role summary and Key responsibilities may draw on the usual duties of this role in the jewellery trade when the call says little.
3. Never name the employer, its owners or its brands anywhere: candidates see this JD before the client is revealed. Describe it instead, e.g. "A well-established jewellery showroom in Mumbai, in business since 1998".
4. Salary goes only in the Salary section, exactly as given, written like "₹25,000 to ₹35,000 a month". Do not mention it elsewhere.
5. Jewellery-industry experience must match the setting exactly: "Required" goes into Must-have, "Preferred" into Good to have, "Not required" means do not ask for it.
6. A section marked "bullets" has one point per line, each starting with "• ". Other sections are one to three short sentences.
7. Keep everything the team already wrote in CURRENT DRAFT unless told to rewrite it: improve the wording, never drop a fact.
8. Plain, professional Indian English. Short sentences. Use trade terms (karat, hallmarking, BIS, solitaires, CAD, casting, setting, gold rate, old-gold exchange) only where they fit the role.`;

const sectionSchema = (secs) => ({ type: 'object', additionalProperties: false, required: secs.map((s) => s.key), properties: Object.fromEntries(secs.map((s) => [s.key, { type: 'string', description: `${s.label}${s.bullets ? ' (bullets)' : ''}: ${s.hint || ''}` }])) });
const available = () => LLM.available();

// facts: { client, role, call, current, jewellery }  only: a section key to rewrite alone  instruction: what to change
async function write(facts, sections, o = {}) {
  if (!available()) throw httpError(424, 'AI writing is not set up yet: add OPENAI_API_KEY to the server .env.');
  const secs = o.only ? sections.filter((s) => s.key === o.only) : sections; if (!secs.length) throw httpError(400, 'Unknown section');
  const ask = o.only
    ? `Rewrite only the "${secs[0].label}" section of this JD.${o.instruction ? ` The team asks: ${o.instruction}` : ''} Return it alone.`
    : `Write the full job description, section by section.${o.instruction ? ` The team asks: ${o.instruction}` : ''}`;
  const user = `${ask}\n\nSECTIONS:\n${secs.map((s) => `- ${s.label}${s.bullets ? ' (bullets)' : ''}: ${s.hint || ''}`).join('\n')}\n\nFACTS:\n${JSON.stringify(facts, null, 2)}`;
  const r = await LLM.json({ system: SYSTEM, user, schema: sectionSchema(secs), name: 'job_description', maxTokens: o.only ? 1200 : 3500 });
  const out = r.answer || r;
  return Object.fromEntries(secs.map((s) => [s.key, String(out[s.key] || '').trim()]));
}
// The older one-shot writer (job panel, JD pool): same prompt, the standard sections.
async function writeSimple(facts) { return write({ role: facts }, require('./api-team').jdSections()); }

module.exports = { write, writeSimple, available, SYSTEM, FIELDS: ['summary', 'duties', 'must', 'good', 'education', 'languages', 'timings', 'benefits', 'incentives'] };
