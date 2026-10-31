// Writes a job description with AI (server/llm.js: OpenAI when OPENAI_API_KEY is set), from the job's facts and the
// jewellery-experience setting. Returns the JD sections the portal uses.
const { httpError } = require('./db');

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

const LLM = require('./llm');
const available = () => LLM.available();
async function write(facts) {
  if (!available()) throw httpError(424, 'AI writing is not set up yet: add OPENAI_API_KEY to the server .env.');
  return LLM.json({ system: SYSTEM, user: `Write the job description for this opening.\n${JSON.stringify(facts, null, 2)}`, schema: SCHEMA, name: 'job_description', maxTokens: 3000 });
}

module.exports = { write, available, FIELDS };
