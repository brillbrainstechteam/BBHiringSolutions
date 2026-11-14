// Source codes: one short code per source a candidate can come from ("Ramesh Kumar - Agent" → AG-001,
// "Email - One Stop" → EM-002). Shown on candidates, used in links (?src=AG-001) so applications through them are
// tagged, and counted in reports. New sources get a code the first time they are seen.
const D = require('./db');
const { get, all, run, now } = D;

D.db.exec('CREATE TABLE IF NOT EXISTS source_codes (code TEXT PRIMARY KEY, source TEXT UNIQUE, kind TEXT, tieup_id INTEGER, created_at TEXT)');
try { D.db.exec('ALTER TABLE candidates ADD COLUMN source_code TEXT'); } catch { /* already there */ }

// The two letters say what kind of source it is.
const PREFIX = [[/- Agent$/i, 'AG'], [/^Email/i, 'EM'], [/^Google Drive/i, 'GD'], [/naukri/i, 'NK'], [/^WhatsApp/i, 'WA'], [/referral/i, 'RF'], [/excel|import/i, 'XL'], [/facebook|instagram|meta|\bads?\b/i, 'AD'], [/linkedin/i, 'LI'], [/website|job post|apply|job page/i, 'WB'], [/walk/i, 'WI'], [/college|institute|training|tie-?up|- Local agency$/i, 'TU'], [/apna|indeed|workindia|shine|foundit|monster|portal/i, 'JP'], [/agency/i, 'AY']];

function codeFor(source, tieupId) {
  const s = String(source || '').trim(); if (!s) return null;
  const have = get('SELECT code FROM source_codes WHERE source=?', s); if (have) return have.code;
  const p = (PREFIX.find(([re]) => re.test(s)) || [null, 'SR'])[1];
  let n = (get('SELECT COUNT(*) n FROM source_codes WHERE kind=?', p) || {}).n || 0; let code;
  do { n += 1; code = `${p}-${String(n).padStart(3, '0')}`; } while (get('SELECT 1 FROM source_codes WHERE code=?', code));
  run('INSERT INTO source_codes (code,source,kind,tieup_id,created_at) VALUES (?,?,?,?,?)', code, s, p, tieupId || null, now());
  return code;
}
const byCode = (code) => (code ? get('SELECT * FROM source_codes WHERE upper(code)=upper(?)', String(code).trim()) : null);

// Every candidate carries the code of its source (new sources get one); run at start and by the timer.
function tagAll() {
  for (const r of all("SELECT DISTINCT source FROM candidates WHERE source IS NOT NULL AND source != ''")) codeFor(r.source);
  run("UPDATE candidates SET source_code=(SELECT code FROM source_codes s WHERE s.source=candidates.source) WHERE source IS NOT NULL AND source != '' AND (source_code IS NULL OR source_code != (SELECT code FROM source_codes s WHERE s.source=candidates.source))");
}
try { tagAll(); } catch (e) { console.error('Source codes', e.message); }

const list = () => all('SELECT s.*, (SELECT COUNT(*) FROM candidates c WHERE c.source=s.source AND c.merged_into IS NULL AND c.removed=0) AS candidates FROM source_codes s ORDER BY s.kind, s.code');

module.exports = { codeFor, byCode, tagAll, list };
