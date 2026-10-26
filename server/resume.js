// Candidate resume: a score with tips (no AI needed), and a better resume written from the profile and CV.
// Errors use 4xx codes so the person sees the plain message (5xx shows a generic one).
// The resume writer uses Claude through the Anthropic SDK when it is installed (npm install) and
// ANTHROPIC_API_KEY is set in .env; otherwise it lays out the same resume from the profile, with no rewriting.
const D = require('./db');
const F = require('./files');
const CV = require('./cvparse');
const { get, httpError, now } = D;

const MODEL = 'claude-opus-5-5';
const DAILY_LIMIT = 5; // AI resumes per candidate per day (each one costs money)

// ---------- the score ----------
// Each check: points, whether it is met, and what to do when it is not. Total 100.
function check(c, cvTextLen) {
  const skills = c.skills || [];
  const social = c.social || {};
  const experienced = Number(c.exp_total || 0) > 0;
  const fresh = c.last_updated && (Date.now() - new Date(c.last_updated)) / 864e5 <= 90;
  const items = [
    [10, !!(c.name && c.whatsapp), 'Name and WhatsApp number', 'Add your full name and WhatsApp number.'],
    [5, !!c.email, 'Email', 'Add an email address — many employers expect one on a resume.'],
    [10, !!(c.job_wanted && c.city), 'Job you want and city', 'Say which job you want and the city you want to work in.'],
    [15, !!c.cv_file, 'CV uploaded', 'Upload your CV (PDF or Word), or create one below.'],
    [10, cvTextLen > 600, 'CV has enough detail', 'Your CV is very short. Describe what you did in each job, with numbers where you can (sales, pieces, customers).'],
    [15, skills.length >= 5 ? true : skills.length >= 2 ? 'half' : false, 'At least 5 skills', 'Add at least 5 skills, for example: gold knowledge, diamond grading, billing, customer handling, CAD.'],
    [10, experienced ? !!c.current_company : true, 'Current or last company', 'Add the company you work at now (or last worked at).'],
    [5, experienced ? (c.exp_business || []).length > 0 : true, 'Type of jewellery business', 'Say whether you worked with a wholesaler, manufacturer or retailer.'],
    [10, c.exp_salary != null && c.notice_days != null, 'Salary and notice period', 'Add your expected salary and notice period so we match you to the right jobs.'],
    [5, !!(social.linkedin || social.portfolio || social.instagram), 'A social or portfolio link', 'Add your LinkedIn, or a portfolio / Instagram link for design work.'],
    [5, !!fresh, 'Updated in the last 90 days', 'Review your profile — employers prefer recently updated profiles.'],
  ];
  let score = 0; const list = [];
  for (const [pts, ok, label, tip] of items) {
    const got = ok === true ? pts : ok === 'half' ? Math.round(pts / 2) : 0; score += got;
    list.push({ label, points: pts, got, ok: got === pts, tip: got === pts ? null : tip });
  }
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Needs work' : 'Weak';
  return { score, grade, items: list, checked_at: now() };
}

function cvTextOf(c) {
  if (!c.cv_file) return '';
  const f = get('SELECT * FROM files WHERE id=?', c.cv_file) || get("SELECT * FROM files WHERE record_id=? AND type='cv' AND replaced=0 ORDER BY version DESC LIMIT 1", c.id);
  if (!f) return '';
  try { return CV.cvText(f.name, F.readStored(f)).slice(0, 20000); } catch { return ''; }
}

// ---------- the resume itself ----------
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headline', 'summary', 'skills', 'experience', 'education', 'strengths', 'languages', 'suggestions'],
  properties: {
    headline: { type: 'string', description: 'One line, e.g. "Senior Sales Executive — Gold & Diamond Jewellery"' },
    summary: { type: 'string', description: '3-4 sentences, first person omitted, plain professional English' },
    skills: { type: 'array', items: { type: 'string' } },
    experience: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role', 'company', 'period', 'points'], properties: { role: { type: 'string' }, company: { type: 'string' }, period: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } } } },
    education: { type: 'array', items: { type: 'string' } },
    strengths: { type: 'array', items: { type: 'string' } },
    languages: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' }, description: 'Facts the candidate should add to make this resume stronger (missing years, numbers, education)' },
  },
};
const SYSTEM = `You write resumes for people looking for jobs in India's jewellery trade: showroom sales, karigars and manufacturing, CAD and design, quality and gemology, merchandising, accounts, HR and admin.
You are given a candidate's profile and the text of their current CV. Write the best honest resume from them.
Rules:
- Use only facts present in the profile or CV. Never invent employers, dates, numbers, certificates, education or achievements. If something important is missing, leave it out and list it under "suggestions".
- Rewrite weak wording into clear, specific, professional English. Use jewellery-trade terms correctly (karat, hallmarking, BIS, solitaires, CAD, casting, setting, gold rate, old-gold exchange) only where the facts support them.
- Experience: most recent first; 2-5 short points per job that start with an action word.
- Keep it to what fits on one or two pages. No photos, no personal details beyond those given.
- If the source text is in Hindi or Hinglish, write the resume in English.`;

let sdk; // the Anthropic SDK, loaded on first use (optional dependency)
function aiAvailable() {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  if (sdk === undefined) { try { const m = require('@anthropic-ai/sdk'); sdk = m.default || m; } catch { sdk = null; } }
  return !!sdk;
}

async function writeWithAI(c, cvText) {
  const client = new sdk();
  const profile = {
    name: c.name, city: c.city, job_wanted: c.job_wanted, department: c.department, total_experience_years: c.exp_total, jewellery_experience_years: c.exp_jewellery,
    business_types_worked_in: c.exp_business, current_company: c.current_company, skills: c.skills, notice_days: c.notice_days, work_cities: c.work_cities,
  };
  let res;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if the model declines, the API retries on a suitable fallback model
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Candidate profile (JSON):\n${JSON.stringify(profile, null, 2)}\n\nCurrent CV text:\n${cvText || '(no CV uploaded)'}` }],
    });
  } catch (e) {
    if (e instanceof sdk.RateLimitError) throw httpError(429, 'The resume writer is busy. Please try again in a minute.');
    if (e instanceof sdk.AuthenticationError) { console.error('Resume writer: API key rejected'); throw httpError(424, 'The resume writer is not available right now.'); }
    if (e instanceof sdk.APIError) { console.error('Resume writer API error', e.status, e.message); throw httpError(424, 'The resume writer could not finish. Please try again.'); }
    throw e;
  }
  if (res.stop_reason === 'refusal') throw httpError(422, 'The resume writer could not work with this profile. Please check your details.');
  if (res.stop_reason === 'max_tokens') throw httpError(424, 'The resume came out too long. Please try again.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw httpError(424, 'The resume writer gave an unreadable answer. Please try again.'); }
}

// Without AI: the same layout, filled straight from the profile.
function writeFromProfile(c) {
  const yrs = c.exp_total ? `${c.exp_total} year${Number(c.exp_total) === 1 ? '' : 's'}` : null;
  return {
    headline: [c.job_wanted, c.department].filter(Boolean).join(' — ') || 'Jewellery professional',
    summary: [yrs ? `${yrs} of experience${c.exp_jewellery ? `, ${c.exp_jewellery} in jewellery` : ''}.` : 'Looking for a first role in the jewellery business.', (c.exp_business || []).length ? `Worked with ${c.exp_business.join(', ').toLowerCase()} businesses.` : '', c.city ? `Based in ${c.city}.` : ''].filter(Boolean).join(' '),
    skills: c.skills || [], experience: c.current_company ? [{ role: c.job_wanted || '', company: c.current_company, period: 'Present', points: [] }] : [],
    education: [], strengths: [], languages: [], suggestions: ['Add what you did in each job, with numbers where you can.', 'Add your education.', 'Add the years you worked at each company.'],
  };
}

async function build(c, by) {
  const today = new Date().toISOString().slice(0, 10);
  const used = (c.resume_check && c.resume_check.ai_day === today) ? c.resume_check.ai_count || 0 : 0;
  const ai = aiAvailable();
  if (ai && used >= DAILY_LIMIT) throw httpError(429, `You can create ${DAILY_LIMIT} resumes a day. Please try again tomorrow.`);
  const cvText = cvTextOf(c);
  const out = ai ? await writeWithAI(c, cvText) : writeFromProfile(c);
  const resume = { name: c.name, phone: c.whatsapp, email: c.email || '', city: c.city || '', ...out, ai, made_at: now() };
  const rc = { ...(c.resume_check || {}), resume, ...(ai ? { ai_day: today, ai_count: used + 1 } : {}) };
  D.update('candidates', c.id, { resume_check: rc });
  D.history(by || 'Candidate', 'resume built', c.id, 'resume', null, ai ? 'AI' : 'template');
  return resume;
}

// PDF of the built resume, saved to the candidate's files (type "built_cv") so our team sees it too.
function savePdf(c, r, by) {
  const L = [];
  const add = (text, o = {}) => L.push({ text: String(text || ''), ...o });
  add(r.name, { size: 16, bold: true }); add(r.headline, { size: 11, bold: true });
  add([r.phone ? `+91 ${r.phone}` : '', r.email, r.city].filter(Boolean).join('  |  '));
  add('');
  if (r.summary) { add('PROFILE', { bold: true, size: 11 }); add(r.summary); add(''); }
  if ((r.skills || []).length) { add('SKILLS', { bold: true, size: 11 }); add(r.skills.join('  ·  ')); add(''); }
  if ((r.experience || []).length) {
    add('EXPERIENCE', { bold: true, size: 11 });
    for (const x of r.experience) { add(`${x.role}${x.company ? ` — ${x.company}` : ''}${x.period ? ` (${x.period})` : ''}`, { bold: true }); for (const pt of x.points || []) add(`•  ${pt}`); add(''); }
  }
  for (const [k, label] of [['education', 'EDUCATION'], ['strengths', 'STRENGTHS'], ['languages', 'LANGUAGES']]) if ((r[k] || []).length) { add(label, { bold: true, size: 11 }); for (const x of r[k]) add(`•  ${x}`); add(''); }
  const buf = F.makePdf(`Resume — ${r.name}`, L, { name: 'BrillBrains Hiring Solutions' });
  const f = F.storeBuffer({ recordId: c.id, type: 'built_cv', name: `${String(r.name || 'resume').replace(/[^\w ]+/g, '').trim() || 'resume'} - resume.pdf`, buf, mime: 'application/pdf', by: by || 'Candidate' });
  return f;
}

module.exports = { check, cvTextOf, build, savePdf, aiAvailable };
