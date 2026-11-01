// Domain (the industry someone has worked in) and skills for every candidate, read from their CV or, without one,
// from what they told us. One background job does both the first pass over existing candidates and every new one,
// whichever door they came through: anyone not read yet, or with a CV newer than the last reading, is picked up.
const D = require('./db');
const F = require('./files');
const llm = require('./llm');
const RES = require('./resume');
const { all, get, update, now } = D;

const BATCH = 10; // candidates a minute
const MAX_SKILLS = 15;
const NOT_CLEAR = 'Not clear';
const domains = () => [...new Set([...(D.settings().industry_list || ['Jewellery']), 'Other'])];

// One skill: short, no commas (filters keep several values as "a,b"), no stray punctuation.
function cleanSkill(v) {
  const t = String(v || '').replace(/[,;|•·\n\r\t]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–.:]+|[\s\-–.:]+$/g, '').trim();
  return t.length >= 2 && t.length <= 40 ? t : '';
}
// What people already have stays; new skills are added after it; the same skill in another case counts once.
function mergeSkills(have, found) {
  const seen = new Set(); const out = [];
  for (const raw of [...(have || []), ...(found || [])]) { const s = cleanSkill(raw); const k = s.toLowerCase(); if (s && !seen.has(k)) { seen.add(k); out.push(s); } }
  return out.slice(0, MAX_SKILLS);
}

const SYSTEM = `You read Indian job seekers' resumes for a recruitment firm that mainly serves the jewellery trade. From the material given, work out two things.
domain: the industry this person has actually worked in, or mostly worked in if several. Judge it from their employers and work, not from the job they are applying for: an accountant at a bank applying to a jeweller is "Banking & Financial Services". A person who has worked for jewellers, gem or diamond businesses is "Jewellery". For a fresher, use the field they studied or trained for. Use "Other" for an industry not in the list, and "${NOT_CLEAR}" if the material does not show it.
skills: up to ${MAX_SKILLS} short, specific skills the person really shows: tools, software, trade skills and job abilities, 1 to 4 words each, such as "Matrix", "Rhino", "Diamond grading", "Tally", "Team handling". Leave out vague traits such as "hard working", and leave out languages, degrees and job titles. Use only what is in the material.`;

async function askAI(c, text, file) {
  const facts = { job_wanted: c.job_wanted, current_company: c.current_company, skills: c.skills, total_experience_years: c.exp_total, jewellery_experience_years: c.exp_jewellery };
  const schema = { type: 'object', additionalProperties: false, required: ['domain', 'skills'], properties: { domain: { type: 'string', enum: [...domains(), NOT_CLEAR] }, skills: { type: 'array', items: { type: 'string' } } } };
  return llm.json({ system: SYSTEM, schema, name: 'candidate_domain_skills', maxTokens: 700, files: file ? [file] : [], user: `Profile:\n${JSON.stringify(facts)}\n\nResume text:\n${text || '(none: use the attached file if there is one)'}` });
}

// Without AI (or when it keeps failing): words in the CV, and the skills list from the settings.
const WORDS = [['Jewellery', /jewel|diamond|gold ?smith|karigar|hallmark|gemolog|bullion|solitaire/i], ['Banking & Financial Services', /\bbank\b|nbfc|\bloan\b/i], ['Insurance', /insurance/i], ['IT & Software', /software|developer|programmer/i], ['Retail', /retail|showroom|\bmall\b/i], ['Healthcare & Pharma', /hospital|pharma/i], ['Hospitality & Travel', /\bhotel\b|hospitality/i]];
function byRules(c, text) {
  const hay = `${text} ${c.current_company || ''}`; const known = domains();
  const hit = WORDS.find(([d, re]) => known.includes(d) && re.test(hay));
  const skills = (D.settings().skills || []).filter((s) => s && new RegExp(`(^|[^A-Za-z])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i').test(text));
  return { domain: hit ? hit[0] : Number(c.exp_jewellery) > 0 ? 'Jewellery' : NOT_CLEAR, skills };
}

const keyOf = (c) => c.cv_file || 'profile';
const tries = new Map(); // how often the AI failed on a candidate since the server started

async function readOne(c) {
  const text = RES.cvTextOf(c);
  const f = c.cv_file ? get('SELECT * FROM files WHERE id=?', c.cv_file) : null;
  // A CV that is a photo or scan has no text: the AI reads the file itself.
  let file = null; if (f && text.length < 200) { try { file = { name: f.name, buf: F.readStored(f) }; } catch { /* the file is gone: use the profile */ } }
  const worthAsking = text.length >= 200 || file || c.current_company || (c.skills || []).length;
  let got;
  if (llm.available() && worthAsking && (tries.get(c.id) || 0) < 3) {
    try { got = await askAI(c, text, file); } catch (e) {
      tries.set(c.id, (tries.get(c.id) || 0) + 1);
      if (e.status === 429) throw e; // busy: stop for this minute and try again
      console.error(`Candidate reading failed for ${c.id}: ${e.message}`); return false;
    }
  } else got = byRules(c, text);
  const domain = [...domains(), NOT_CLEAR].includes(got.domain) ? got.domain : NOT_CLEAR;
  const skills = mergeSkills(c.skills, got.skills);
  update('candidates', c.id, { domain, skills, extract_for: keyOf(c) });
  D.history('CV reader', 'read domain and skills', c.id, 'domain', c.domain || null, `${domain}; ${skills.length} skills`);
  tries.delete(c.id);
  return true;
}

const waiting = () => all("SELECT * FROM candidates WHERE merged_into IS NULL AND removed=0 AND junk=0 AND (extract_for IS NULL OR extract_for != COALESCE(cv_file, 'profile')) ORDER BY created_at DESC LIMIT ?", BATCH);
let running = false;
async function sweep() {
  if (running) return 0; running = true; let done = 0;
  try { for (const c of waiting()) { try { if (await readOne(c)) done++; } catch { break; } } } catch (e) { console.error('Candidate reading:', e.message); } finally { running = false; }
  return done;
}
function start() { setTimeout(sweep, 15000); setInterval(sweep, 60000); }

module.exports = { sweep, start, mergeSkills, cleanSkill, NOT_CLEAR };
