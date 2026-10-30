// Ad spend: upload the spend reports exported from Meta Ads Manager and LinkedIn Campaign Manager (CSV or Excel).
// Each row's spend goes to the jobs its ad set (LinkedIn: campaign) brought applications to, split by how many came
// to each job; an ad set with no applications yet goes to the jobs its saved ad names or its role name point to.
// The report shows spend, cost per application and cost per hire per job. Super admin only (money).
const D = require('./db');
const L = require('./logic');
const F = require('./files');
const V = require('./views');
const { route } = require('./router');
const { get, all, insert, now, httpError } = D;

const SUPER = { auth: 'team', levels: ['super'] };
D.db.exec('CREATE TABLE IF NOT EXISTS ad_spend (id INTEGER PRIMARY KEY AUTOINCREMENT, upload_id TEXT, platform TEXT, campaign TEXT, adset TEXT, ad TEXT, day_from TEXT, day_to TEXT, spend REAL, impressions INTEGER, clicks INTEGER, results INTEGER, currency TEXT)');
D.db.exec('CREATE TABLE IF NOT EXISTS ad_spend_uploads (id TEXT PRIMARY KEY, name TEXT, platform TEXT, rows INTEGER, total REAL, by TEXT, at TEXT)');

const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
const nh = (h) => String(h || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const day = (v) => { const t = String(v || '').trim(); if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10); if (/^\d{5}(\.\d+)?$/.test(t)) return new Date((Number(t) - 25569) * 86400000).toISOString().slice(0, 10); const d = Date.parse(t); return Number.isNaN(d) ? '' : new Date(d).toISOString().slice(0, 10); };
// Column names in each platform's export (lower case, punctuation and brackets dropped).
const COLS = {
  spend: ['amount spent', 'total spent', 'amount spent inr', 'spend', 'cost'],
  adset: ['ad set name', 'adset name', 'ad set'],
  li_campaign: ['campaign name'], li_group: ['campaign group name', 'campaign group'],
  campaign: ['campaign name', 'campaign'],
  ad: ['ad name', 'creative name', 'ad'],
  start: ['reporting starts', 'start date', 'starts', 'start'], end: ['reporting ends', 'end date', 'ends', 'end'],
  impressions: ['impressions'], clicks: ['link clicks', 'unique link clicks', 'clicks'], results: ['results', 'leads', 'conversions'],
  currency: ['currency'],
};
const col = (head, names) => { const hs = head.map(nh); for (const n of names) { const i = hs.indexOf(n); if (i >= 0) return i; } return -1; };

// Rows of one export: finds the header row (title lines above it are skipped), tells Meta from LinkedIn.
function parse(name, base64) {
  const rows = F.readSpreadsheet(name, base64) || [];
  const hi = rows.findIndex((r) => col(r, COLS.spend) >= 0 && (col(r, COLS.adset) >= 0 || col(r, COLS.campaign) >= 0));
  if (hi < 0) throw httpError(400, 'No spend column found. Upload the ad set report from Meta Ads Manager or the campaign report from LinkedIn Campaign Manager.');
  const head = rows[hi];
  const linkedin = col(head, COLS.li_group) >= 0 || (col(head, COLS.adset) < 0 && head.map(nh).some((h) => h === 'total spent'));
  const c = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, col(head, names)]));
  const cell = (r, k) => (c[k] >= 0 ? String(r[c[k]] ?? '').trim() : '');
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const spend = num(cell(r, 'spend'));
    // LinkedIn: campaign group = campaign, campaign = ad set (one per job), creative = ad. Meta: as named.
    const row = linkedin
      ? { platform: 'LinkedIn', campaign: cell(r, 'li_group'), adset: cell(r, 'li_campaign'), ad: cell(r, 'ad') }
      : { platform: 'Meta', campaign: c.campaign >= 0 && c.adset >= 0 && c.campaign !== c.adset ? cell(r, 'campaign') : '', adset: cell(r, 'adset'), ad: c.ad >= 0 && c.ad !== c.adset ? cell(r, 'ad') : '' };
    if (!row.adset && !row.campaign) continue;
    if (/^(total|grand total)/i.test(row.adset || row.campaign)) continue;
    out.push({ ...row, start: day(cell(r, 'start')), end: day(cell(r, 'end')), spend, impressions: Math.round(num(cell(r, 'impressions'))), clicks: Math.round(num(cell(r, 'clicks'))), results: Math.round(num(cell(r, 'results'))), currency: cell(r, 'currency') || 'INR' });
  }
  return { platform: linkedin ? 'LinkedIn' : 'Meta', rows: out };
}

// Where one spend row goes: { jobId: share } plus how it was matched.
function allocate(r, apps) {
  const set = norm(r.adset); const ad = norm(r.ad);
  let mine = apps.filter((a) => set && norm(a.ad_set) === set && (!ad || !a.ad_name || norm(a.ad_name) === ad));
  if (!mine.length && set) mine = apps.filter((a) => norm(a.ad_set) === set);
  if (mine.length) { const by = {}; for (const a of mine) by[a.job_id] = (by[a.job_id] || 0) + 1; return { shares: Object.fromEntries(Object.entries(by).map(([j, n]) => [j, n / mine.length])), how: 'applications from this ad set' }; }
  // No applications yet: the jobs it was saved on (Ads for this job), else the role in its name.
  const saved = all("SELECT id, ad_match FROM jobs WHERE ad_match IS NOT NULL AND ad_match != '[]'").filter((j) => (j.ad_match || []).some((m) => norm(m.adset) === set || (m.ad && norm(m.ad) === ad))).map((j) => j.id);
  const ids = saved.length ? saved : L.jobsForPerson({ ad_set: r.adset, ad_name: r.ad, ad_campaign: r.campaign }).jobs.map((j) => j.id);
  if (!ids.length) return { shares: {}, how: 'no matching job' };
  return { shares: Object.fromEntries(ids.map((j) => [j, 1 / ids.length])), how: saved.length ? 'ad names saved on the job' : 'role in the ad set name' };
}

route('POST', '/api/adspend/upload', SUPER, (ctx) => {
  const b = ctx.body || {}; if (!b.name || !b.base64) throw httpError(400, 'Pick the exported file');
  const p = parse(b.name, b.base64);
  if (!p.rows.length) throw httpError(400, 'The file has no ad rows.');
  const total = p.rows.reduce((t, r) => t + r.spend, 0);
  if (b.dry) return { platform: p.platform, rows: p.rows, total };
  const id = `UP-${Date.now()}`;
  // The same ad set and dates uploaded again replaces the earlier figures.
  for (const r of p.rows) {
    D.run('DELETE FROM ad_spend WHERE platform=? AND IFNULL(campaign,\'\')=? AND IFNULL(adset,\'\')=? AND IFNULL(ad,\'\')=? AND IFNULL(day_from,\'\')=? AND IFNULL(day_to,\'\')=?', r.platform, r.campaign || '', r.adset || '', r.ad || '', r.start || '', r.end || '');
    const { start, end, ...rest } = r; insert('ad_spend', { upload_id: id, ...rest, day_from: start || null, day_to: end || null });
  }
  insert('ad_spend_uploads', { id, name: b.name, platform: p.platform, rows: p.rows.length, total, by: ctx.actor.label, at: now() });
  D.history(ctx.actor.label, 'ad spend upload', null, p.platform, null, `${p.rows.length} rows, ${Math.round(total)} spent, from ${b.name}`, null, ctx.ip);
  return { ok: true, id, rows: p.rows.length, total };
});
route('POST', '/api/adspend/uploads/:id/delete', SUPER, (ctx) => {
  D.run('DELETE FROM ad_spend WHERE upload_id=?', ctx.params.id); D.run('DELETE FROM ad_spend_uploads WHERE id=?', ctx.params.id);
  D.history(ctx.actor.label, 'ad spend removed', null, ctx.params.id); return { ok: true };
});
// The report: per job (spend, applications from ads, hires, cost per application and per hire) and per ad set.
route('GET', '/api/adspend/report', SUPER, () => {
  const rows = all('SELECT * FROM ad_spend');
  const apps = all("SELECT id, job_id, ad_set, ad_name, ad_campaign, result FROM applications WHERE ad_set IS NOT NULL OR ad_name IS NOT NULL");
  const jobs = {}; const sets = {};
  for (const r of rows) {
    const k = `${r.platform}|${r.campaign || ''}|${r.adset || ''}`;
    const s = sets[k] = sets[k] || { platform: r.platform, campaign: r.campaign, adset: r.adset, spend: 0, results: 0, clicks: 0, start: r.day_from, end: r.day_to, jobs: {}, how: '' };
    r.start = r.day_from; r.end = r.day_to; s.spend += r.spend; s.results += r.results || 0; s.clicks += r.clicks || 0; if (r.start && (!s.start || r.start < s.start)) s.start = r.start; if (r.end && (!s.end || r.end > s.end)) s.end = r.end;
    const a = allocate(r, apps); s.how = a.how;
    for (const [jid, share] of Object.entries(a.shares)) { s.jobs[jid] = (s.jobs[jid] || 0) + r.spend * share; (jobs[jid] = jobs[jid] || { spend: 0 }).spend += r.spend * share; }
  }
  const out = Object.entries(jobs).map(([jid, j]) => {
    const job = get('SELECT * FROM jobs WHERE id=?', jid); if (!job) return null; const v = V.jobView(job);
    const fromAds = apps.filter((a) => a.job_id === jid); const hires = fromAds.filter((a) => a.result === 'Hired').length;
    const allApps = get('SELECT COUNT(*) n FROM applications WHERE job_id=?', jid).n;
    return { job_id: jid, code: job.old_code || jid, title: job.title, city: job.city, client: v.client_name, status: v.status, spend: Math.round(j.spend), ad_apps: fromAds.length, all_apps: allApps, hires, per_app: fromAds.length ? Math.round(j.spend / fromAds.length) : null, per_hire: hires ? Math.round(j.spend / hires) : null };
  }).filter(Boolean).sort((a, b) => b.spend - a.spend);
  const total = rows.reduce((t, r) => t + r.spend, 0); const matched = out.reduce((t, j) => t + j.spend, 0);
  const adApps = out.reduce((t, j) => t + j.ad_apps, 0); const hires = out.reduce((t, j) => t + j.hires, 0);
  return {
    summary: { total: Math.round(total), unmatched: Math.round(total - matched), ad_apps: adApps, hires, per_app: adApps ? Math.round(matched / adApps) : null, per_hire: hires ? Math.round(matched / hires) : null },
    jobs: out,
    sets: Object.values(sets).map((s) => ({ ...s, spend: Math.round(s.spend), portal_apps: apps.filter((a) => norm(a.ad_set) === norm(s.adset)).length, jobs: Object.keys(s.jobs) })).sort((a, b) => b.spend - a.spend),
    uploads: all('SELECT * FROM ad_spend_uploads ORDER BY at DESC'),
  };
});
module.exports = { parse, allocate };
