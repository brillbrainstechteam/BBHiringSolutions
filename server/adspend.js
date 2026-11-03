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
// Meta Marketing API: spend per ad per day, read with a system-user token that has ads_read (META_ADS_TOKEN and
// META_AD_ACCOUNT in .env). It only reads figures. Each day fetched replaces that day's figures, and an uploaded Meta
// export for days the API already covers is left out of the report, so nothing is counted twice.
const API = 'META-API';
const metaCfg = () => { const token = String(process.env.META_ADS_TOKEN || '').trim(); let account = String(process.env.META_AD_ACCOUNT || '').trim(); if (account && !account.startsWith('act_')) account = `act_${account}`; return token && account ? { token, account } : null; };
const LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'offsite_conversion.fb_pixel_lead'];
const isoDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const istAgo = (n) => new Date(Date.now() + 5.5 * 3600000 - n * 86400000).toISOString().slice(0, 10);
async function fetchMeta(from, to, by) {
  const cfg = metaCfg(); if (!cfg) throw httpError(424, 'Meta is not connected: add META_ADS_TOKEN and META_AD_ACCOUNT to the server .env.');
  if (!isoDay(from) || !isoDay(to) || from > to) throw httpError(400, 'Pick the dates', 'from');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) throw httpError(400, 'Fetch at most 3 months at a time', 'from');
  const q = new URLSearchParams({ level: 'ad', time_increment: '1', time_range: JSON.stringify({ since: from, until: to }), fields: 'campaign_name,adset_name,ad_name,spend,impressions,inline_link_clicks,actions,account_currency', limit: '500', access_token: cfg.token });
  let url = `${process.env.META_GRAPH_URL || 'https://graph.facebook.com/v21.0'}/${cfg.account}/insights?${q}`; const got = [];
  for (let page = 0; url && page < 60; page++) {
    let res; try { res = await fetch(url, { signal: AbortSignal.timeout(30000) }); } catch (e) { throw httpError(424, `Meta could not be reached: ${e.message}`); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw httpError(424, `Meta said: ${(j.error && j.error.message) || `error ${res.status}`}`);
    for (const r of j.data || []) {
      const acts = Object.fromEntries((r.actions || []).map((x) => [x.action_type, Number(x.value) || 0])); const lead = LEAD_ACTIONS.find((k) => acts[k] !== undefined);
      got.push({ campaign: r.campaign_name || '', adset: r.adset_name || '', ad: r.ad_name || '', day: r.date_start, spend: num(r.spend), impressions: Math.round(num(r.impressions)), clicks: Math.round(num(r.inline_link_clicks)), results: lead ? acts[lead] : 0, currency: r.account_currency || 'INR' });
    }
    url = j.paging && j.paging.next;
  }
  // Replace those days, all at once.
  D.db.exec('BEGIN');
  try {
    D.run('DELETE FROM ad_spend WHERE upload_id=? AND day_from>=? AND day_from<=?', API, from, to);
    for (const r of got) if (r.spend || r.impressions) insert('ad_spend', { upload_id: API, platform: 'Meta', campaign: r.campaign, adset: r.adset, ad: r.ad, day_from: r.day, day_to: r.day, spend: r.spend, impressions: r.impressions, clicks: r.clicks, results: r.results, currency: r.currency });
    const t = get('SELECT COUNT(*) n, IFNULL(SUM(spend),0) total, MIN(day_from) a, MAX(day_from) b FROM ad_spend WHERE upload_id=?', API);
    D.run('DELETE FROM ad_spend_uploads WHERE id=?', API);
    if (t.n) insert('ad_spend_uploads', { id: API, name: `Fetched from Meta: ${t.a} to ${t.b}`, platform: 'Meta', rows: t.n, total: t.total, by: by.label, at: now() });
    D.db.exec('COMMIT');
  } catch (e) { D.db.exec('ROLLBACK'); throw e; }
  const spent = got.reduce((x, r) => x + r.spend, 0);
  D.setHealth('meta_spend_last', JSON.stringify({ at: now(), from, to, rows: got.length, spent: Math.round(spent), by: by.label })); D.setHealth('meta_spend_error', '');
  return { rows: got.length, spent: Math.round(spent), from, to };
}
// Once a day after 6 am IST, from the timer: the last three days (Meta keeps adjusting the latest figures).
function daily() {
  if (!metaCfg() || new Date(Date.now() + 5.5 * 3600000).getUTCHours() < 6) return;
  const today = istAgo(0); const h = get("SELECT value FROM health WHERE key='meta_spend_day'"); if (h && h.value === today) return;
  D.setHealth('meta_spend_day', today);
  fetchMeta(istAgo(3), istAgo(1), { label: 'Daily fetch' }).catch((e) => { D.setHealth('meta_spend_error', `${now()} ${e.message}`); require('./alerts').devAlert('Meta ad spend fetch failed', e.message); });
}
const health = (k) => (get('SELECT value FROM health WHERE key=?', k) || {}).value || '';
route('GET', '/api/adspend/meta', SUPER, () => {
  const cfg = metaCfg(); const v = health('meta_spend_last'); let last = typeof v === 'object' ? v : null; if (typeof v === 'string' && v) try { last = JSON.parse(v); } catch { /* none */ }
  return { connected: !!cfg, account: cfg ? `act_…${cfg.account.slice(-4)}` : '', last, error: health('meta_spend_error') };
});
route('POST', '/api/adspend/meta/fetch', { ...SUPER, rate: { key: 'metaspend', max: 30, minutes: 60 } }, async (ctx) => {
  const r = await fetchMeta(String(ctx.body.from || ''), String(ctx.body.to || ''), ctx.actor);
  D.history(ctx.actor.label, 'ad spend fetched', null, 'Meta', null, `${r.from} to ${r.to}: ${r.rows} rows, ${r.spent} spent`, null, ctx.ip);
  return r;
});
// The report: per job (spend, applications from ads, hires, cost per application and per hire) and per ad set.
route('GET', '/api/adspend/report', SUPER, () => {
  // An uploaded Meta export is left out for any ad set and day the API already fetched.
  const fetched = new Set(); for (const r of all('SELECT adset, day_from FROM ad_spend WHERE upload_id=?', API)) fetched.add(`${norm(r.adset)}|${r.day_from}`);
  const covered = (r) => { if (r.upload_id === API || r.platform !== 'Meta' || !fetched.size || !isoDay(r.day_from) || !isoDay(r.day_to)) return false; for (let d = new Date(`${r.day_from}T00:00:00Z`), k = 0; d.toISOString().slice(0, 10) <= r.day_to && k < 400; d.setUTCDate(d.getUTCDate() + 1), k++) if (fetched.has(`${norm(r.adset)}|${d.toISOString().slice(0, 10)}`)) return true; return false; };
  const every = all('SELECT * FROM ad_spend'); const rows = every.filter((r) => !covered(r)); const overlap = every.reduce((t, r) => t + r.spend, 0) - rows.reduce((t, r) => t + r.spend, 0);
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
    summary: { total: Math.round(total), overlap: Math.round(overlap), unmatched: Math.round(total - matched), ad_apps: adApps, hires, per_app: adApps ? Math.round(matched / adApps) : null, per_hire: hires ? Math.round(matched / hires) : null },
    jobs: out,
    sets: Object.values(sets).map((s) => ({ ...s, spend: Math.round(s.spend), portal_apps: apps.filter((a) => norm(a.ad_set) === norm(s.adset)).length, jobs: Object.keys(s.jobs) })).sort((a, b) => b.spend - a.spend),
    uploads: all('SELECT * FROM ad_spend_uploads ORDER BY at DESC'),
  };
});
module.exports = { parse, allocate, fetchMeta, daily };
