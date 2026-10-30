// Writes a job description with Claude (Haiku 5.5: accurate for this and the cheapest), from the job's facts and the
// jewellery-experience setting. Returns the JD sections the portal uses. Needs ANTHROPIC_API_KEY in .env.
const { httpError } = require('./db');

const MODEL = 'claude-haiku-5-5';
const FIELDS = ['summary', 'duties', 'must', 'good', 'education', 'languages', 'timings', 'benefits', 'incentives'];
const SCHEMA = {
  type: 'object', additionalProperties: false, required: FIELDS,
  properties: {
    summary: { type: 'string', description: '2-3 sentences: the role, the employer type and what success looks like' },
    duties: { type: 'string', description: '5-8 duties, one per line, each starting with "• "' },
    must: { type: 'string', description: 'Must-have skills and experience, one per line, each starting with "• "' },
    good: { type: 'string', description: 'Good-to-have skills, one per line, each starting with "• "' },
    education: { type: 'string', description: 'Minimum education, short' },
    languages: { type: 'string', description: 'Languages needed, short' },
    timings: { type: 'string', description: 'Working days and hours, short; empty if unknown' },
    benefits: { type: 'string', description: 'Benefits, short; empty if unknown' },
    incentives: { type: 'string', description: 'Incentives, short; empty if not usual for the role' },
  },
};
const SYSTEM = `You write job descriptions for roles in India's jewellery trade (showrooms, manufacturers, wholesalers, exporters, online jewellery brands) and for a recruitment agency's own team.
Write clear, specific, professional English that a job seeker understands quickly. Use jewellery-trade terms correctly (karat, hallmarking, BIS, solitaires, CAD, casting, setting, gold rate, old-gold exchange) only where they fit the role.
Use only the facts given (title, city, experience, salary, jewellery-experience need, notes). Never invent the employer's name, numbers or benefits that were not given; leave a section empty if there is nothing true to say.
The jewellery-industry requirement must be reflected exactly: "Required" goes into must-have, "Preferred" into good-to-have, "Not required" means do not ask for it.`;

let sdk;
function available() {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  if (sdk === undefined) { try { const m = require('@anthropic-ai/sdk'); sdk = m.default || m; } catch { sdk = null; } }
  return !!sdk;
}

async function write(facts) {
  if (!available()) throw httpError(424, 'AI writing is not set up yet: add ANTHROPIC_API_KEY to the server .env.');
  const client = new sdk();
  let res;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Write the job description for this opening.\n${JSON.stringify(facts, null, 2)}` }],
    });
  } catch (e) {
    if (e instanceof sdk.RateLimitError) throw httpError(429, 'The JD writer is busy. Please try again in a minute.');
    if (e instanceof sdk.AuthenticationError) { console.error('JD writer: API key rejected'); throw httpError(424, 'The JD writer is not available right now.'); }
    if (e instanceof sdk.APIError) { console.error('JD writer API error', e.status, e.message); throw httpError(424, 'The JD writer could not finish. Please try again.'); }
    throw e;
  }
  if (res.stop_reason === 'refusal') throw httpError(422, 'The JD writer could not write this one. Please write it by hand.');
  if (res.stop_reason === 'max_tokens') throw httpError(424, 'The JD came out too long. Please try again.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw httpError(424, 'The JD writer gave an unreadable answer. Please try again.'); }
}

module.exports = { write, available, FIELDS };
