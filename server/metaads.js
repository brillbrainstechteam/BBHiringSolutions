// Meta ads from the portal: Facebook, Instagram and click-to-WhatsApp ads, made through the Marketing API with
// the system-user token in .env (META_ADS_TOKEN, META_AD_ACCOUNT). Everything is made PAUSED; spending starts only
// when someone presses Turn on here (or in Ads Manager). Super admin only (money).
const D = require('./db');
const L = require('./logic');
const F = require('./files');
const { route } = require('./router');
const { get, all, insert, update, now, httpError } = D;

const SUPER = { auth: 'team', levels: ['super'] };
D.db.exec('CREATE TABLE IF NOT EXISTS meta_ads (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, goal TEXT, job_id TEXT, platforms TEXT, daily_budget INTEGER, start_at TEXT, end_at TEXT, campaign_id TEXT, adset_id TEXT, creative_id TEXT, ad_id TEXT, status TEXT, error TEXT, spec TEXT, by TEXT, at TEXT, updated_at TEXT)');

const GRAPH = () => process.env.META_GRAPH_URL || 'https://graph.facebook.com/v21.0';
const cfg = () => { const token = String(process.env.META_ADS_TOKEN || '').trim(); let account = String(process.env.META_AD_ACCOUNT || '').trim(); if (account && !account.startsWith('act_')) account = `act_${account}`; return token && account ? { token, account } : null; };
const need = () => { const c = cfg(); if (!c) throw httpError(424, 'Meta is not connected: add META_ADS_TOKEN and META_AD_ACCOUNT to the server .env.'); return c; };
async function graph(path, { method = 'GET', params = {}, form } = {}) {
  const c = need(); const url = new URL(`${GRAPH()}/${path}`);
  let body;
  if (method === 'GET') { for (const [k, v] of Object.entries(params)) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); url.searchParams.set('access_token', c.token); }
  else if (form) { form.append('access_token', c.token); body = form; }
  else { const p = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); p.set('access_token', c.token); body = p; }
  let res; try { res = await fetch(url, { method, body, signal: AbortSignal.timeout(60000) }); } catch (e) { throw httpError(424, `Meta could not be reached: ${e.message}`); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) { const e = j.error || {}; throw httpError(424, `Meta said: ${e.error_user_msg || e.message || `error ${res.status}`}${e.error_user_title ? ` (${e.error_user_title})` : ''}`); }
  return j;
}

// What the token can do, and what to grant in Business Manager when something is missing.
const NEEDED = [
  ['ads_management', 'make and change ads'], ['pages_show_list', 'list the Facebook Pages the ads run from'],
  ['pages_read_engagement', 'read the Page for the ad'],
];
const OPTIONAL = [['pages_manage_ads', 'run ads from the Page if Meta refuses the Page without it'], ['instagram_basic', 'pick the Instagram account (without it Instagram ads use the Page)'], ['business_management', 'read the Business assets']];
route('GET', '/api/ads/meta/status', SUPER, async () => {
  const c = cfg(); if (!c) return { connected: false, note: 'Add META_ADS_TOKEN and META_AD_ACCOUNT to the server .env.' };
  const out = { connected: true, account_id: c.account };
  try { const d = await graph('debug_token', { params: { input_token: c.token } }); out.scopes = (d.data && d.data.scopes) || []; out.token_type = d.data && d.data.type; } catch (e) { out.scopes = []; out.scope_error = e.message; }
  if (!out.scopes.length) { try { out.scopes = ((await graph('me/permissions')).data || []).filter((x) => x.status === 'granted').map((x) => x.permission); } catch { /* keep empty */ } }
  out.missing = NEEDED.filter(([k]) => !out.scopes.includes(k)).map(([k, why]) => ({ scope: k, why }));
  out.optional_missing = OPTIONAL.filter(([k]) => !out.scopes.includes(k)).map(([k, why]) => ({ scope: k, why }));
  try { const a = await graph(c.account, { params: { fields: 'name,currency,account_status,timezone_name' } }); out.account = { name: a.name, currency: a.currency, active: a.account_status === 1 }; } catch (e) { out.account_error = e.message; }
  try { out.pages = ((await graph(`${c.account}/promote_pages`, { params: { fields: 'id,name' } })).data || []).map((p) => ({ id: p.id, name: p.name })); } catch (e) { out.pages = []; out.pages_error = e.message; }
  try { out.instagram = ((await graph(`${c.account}/instagram_accounts`, { params: { fields: 'id,username' } })).data || []).map((x) => ({ id: x.id, name: x.username })); } catch { out.instagram = []; }
  out.ready = !out.missing.length && out.pages.length > 0 && !!out.account;
  return out;
});
route('GET', '/api/ads/meta/geo', SUPER, async (ctx) => {
  const q = String(ctx.query.q || '').trim(); if (q.length < 2) return { rows: [] };
  const r = await graph('search', { params: { type: 'adgeolocation', location_types: ['city'], country_code: 'IN', q, limit: 10 } });
  return { rows: (r.data || []).map((x) => ({ key: x.key, name: x.name, region: x.region || '' })) };
});

const CTA = { apply: 'APPLY_NOW', learn: 'LEARN_MORE', signup: 'SIGN_UP' };
// One ad end to end: campaign → ad set (who, where, budget) → picture or video → creative → ad, all paused.
route('POST', '/api/ads/meta', SUPER, async (ctx) => {
  const b = ctx.body || {}; const c = need(); const bad = (m, f) => { throw httpError(400, m, f); };
  const goal = b.goal === 'whatsapp' ? 'whatsapp' : 'apply';
  const job = b.job_id ? get('SELECT * FROM jobs WHERE id=?', String(b.job_id)) : null; if (goal === 'apply' && !job) bad('Pick the job opening the ad is for', 'job_id');
  const platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter((p) => ['facebook', 'instagram'].includes(p)); if (!platforms.length) bad('Pick Facebook, Instagram or both', 'platforms');
  const page = String(b.page_id || '').trim(); if (!page) bad('Pick the Facebook Page the ad runs from', 'page_id');
  const budget = Math.round(Number(b.daily_budget)); if (!(budget >= 100)) bad('Daily budget: at least ₹100', 'daily_budget'); if (budget > 50000) bad('Daily budget: at most ₹50,000 from here', 'daily_budget');
  const start = b.start ? new Date(b.start) : new Date(Date.now() + 15 * 60000); if (Number.isNaN(start.getTime())) bad('Pick the start date', 'start');
  const end = b.end ? new Date(b.end) : null; if (end && (Number.isNaN(end.getTime()) || end <= start)) bad('The end must be after the start', 'end');
  const text = String(b.primary_text || '').trim(); if (!text) bad('Write the ad text', 'primary_text'); if (text.length > 2000) bad('Ad text: up to 2000 letters', 'primary_text');
  const headline = String(b.headline || '').trim().slice(0, 100); const desc = String(b.description || '').trim().slice(0, 100);
  const img = b.image_key ? get('SELECT * FROM studio_media WHERE key=?', String(b.image_key)) : null; if (!img || img.kind !== 'image') bad('Upload the ad picture (JPG or PNG)', 'image');
  const vid = b.video_key ? get('SELECT * FROM studio_media WHERE key=?', String(b.video_key)) : null; if (b.video_key && (!vid || vid.kind !== 'video')) bad('Upload the video again', 'video');
  const employment = b.employment !== false; // job ads: Meta's Employment category (fixed age range, no gender, wider areas)
  const ageMin = employment ? 18 : Math.max(18, Number(b.age_min) || 18); const ageMax = employment ? 65 : Math.min(65, Number(b.age_max) || 65); if (ageMin > ageMax) bad('Check the age range', 'age_min');
  const radius = Math.max(employment ? 25 : 1, Math.min(80, Number(b.radius_km) || 25));
  const cities = (Array.isArray(b.cities) ? b.cities : []).filter((x) => x && x.key).slice(0, 25);
  const tag = job ? `${job.id} ${job.title}` : 'WhatsApp chat';
  const name = String(b.name || '').trim().slice(0, 120) || `${tag} · ${L.istDay()}`;
  const geo = cities.length ? { cities: cities.map((x) => ({ key: String(x.key), radius, distance_unit: 'kilometer' })) } : { countries: ['IN'] };
  const targeting = { geo_locations: geo, age_min: ageMin, age_max: ageMax, publisher_platforms: platforms, ...(platforms.includes('facebook') ? { facebook_positions: ['feed', 'story', 'marketplace', 'video_feeds'] } : {}), ...(platforms.includes('instagram') ? { instagram_positions: ['stream', 'story', 'explore', 'reels'] } : {}), targeting_automation: { advantage_audience: 0 } };
  const link = job ? L.link('apply', `?job=${job.id}&src=meta-ad`) : L.link('apply', '?src=meta-ad');
  const row = { name, goal, job_id: job ? job.id : null, platforms: JSON.stringify(platforms), daily_budget: budget, start_at: start.toISOString(), end_at: end ? end.toISOString() : null, status: 'MAKING', spec: JSON.stringify({ ...b, cities }), by: ctx.actor.label, at: now() };
  const id = Number(D.run(`INSERT INTO meta_ads (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, ...Object.values(row)).lastInsertRowid);
  const made = {}; let step = 'campaign';
  try {
    made.campaign_id = (await graph(`${c.account}/campaigns`, { method: 'POST', params: { name, objective: goal === 'whatsapp' ? 'OUTCOME_ENGAGEMENT' : 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: employment ? ['EMPLOYMENT'] : [], ...(employment ? { special_ad_category_country: ['IN'] } : {}), is_adset_budget_sharing_enabled: false } })).id;
    update('meta_ads', id, made); step = 'ad set';
    made.adset_id = (await graph(`${c.account}/adsets`, { method: 'POST', params: { name, campaign_id: made.campaign_id, status: 'PAUSED', daily_budget: budget * 100, billing_event: 'IMPRESSIONS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', optimization_goal: goal === 'whatsapp' ? 'CONVERSATIONS' : 'LINK_CLICKS', destination_type: goal === 'whatsapp' ? 'WHATSAPP' : 'WEBSITE', ...(goal === 'whatsapp' ? { promoted_object: { page_id: page } } : {}), targeting, start_time: start.toISOString(), ...(end ? { end_time: end.toISOString() } : {}) } })).id;
    update('meta_ads', id, made); step = 'picture';
    const imgFile = get('SELECT * FROM files WHERE id=?', img.file_id);
    const up = await graph(`${c.account}/adimages`, { method: 'POST', params: { bytes: F.readStored(imgFile).toString('base64'), name: img.name } });
    const hash = Object.values(up.images || {})[0] && Object.values(up.images)[0].hash; if (!hash) throw new Error('Meta did not return the picture');
    let videoId = null;
    if (vid) { step = 'video'; const vf = get('SELECT * FROM files WHERE id=?', vid.file_id); const fd = new FormData(); fd.append('name', vid.name); fd.append('source', new Blob([F.readStored(vf)], { type: vid.mime }), vid.name); videoId = (await graph(`${c.account}/advideos`, { method: 'POST', form: fd })).id; }
    step = 'creative';
    const cta = goal === 'whatsapp' ? { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } } : { type: CTA[b.cta] || 'APPLY_NOW', value: { link } };
    const dest = goal === 'whatsapp' ? 'https://api.whatsapp.com/send' : link;
    const story = { page_id: page, ...(b.ig_id && platforms.includes('instagram') ? { instagram_user_id: String(b.ig_id) } : {}), ...(videoId ? { video_data: { video_id: videoId, image_hash: hash, message: text, title: headline || undefined, link_description: desc || undefined, call_to_action: cta } } : { link_data: { link: dest, message: text, name: headline || undefined, description: desc || undefined, image_hash: hash, call_to_action: cta } }) };
    made.creative_id = (await graph(`${c.account}/adcreatives`, { method: 'POST', params: { name, object_story_spec: story, ...(goal === 'apply' ? { url_tags: 'campaign={{campaign.name}}&adset={{adset.name}}&ad={{ad.name}}' } : {}) } })).id;
    update('meta_ads', id, made); step = 'ad';
    made.ad_id = (await graph(`${c.account}/ads`, { method: 'POST', params: { name, adset_id: made.adset_id, creative: { creative_id: made.creative_id }, status: 'PAUSED' } })).id;
    update('meta_ads', id, { ...made, status: 'PAUSED', error: null, updated_at: now() });
  } catch (e) {
    update('meta_ads', id, { ...made, status: 'FAILED', error: `At the ${step}: ${e.message}`, updated_at: now() });
    D.history(ctx.actor.label, 'Meta ad failed', `MA-${id}`, null, null, `${step}: ${e.message}`);
    throw httpError(424, `Not made (at the ${step}): ${e.message}${Object.keys(made).length ? ' What was made so far stays paused in Ads Manager.' : ''}`);
  }
  // Applicants from this ad land on the job: its ad set name is saved on the job's ads list.
  if (job) { let maps = []; try { maps = JSON.parse(job.ad_match || '[]'); } catch { /* none */ } if (!maps.some((m) => m.adset === name)) update('jobs', job.id, { ad_match: JSON.stringify([...maps, { platform: 'Meta', campaign: '', adset: name, ad: '' }]) }); }
  D.history(ctx.actor.label, 'Meta ad made (paused)', `MA-${id}`, null, null, `${name}, ₹${budget}/day`);
  return { id, status: 'PAUSED' };
});
const adOf = (ctx) => { const r = get('SELECT * FROM meta_ads WHERE id=?', Number(ctx.params.id) || 0); if (!r) throw httpError(404, 'Ad not found'); return r; };
route('POST', '/api/ads/meta/:id/status', SUPER, async (ctx) => {
  const r = adOf(ctx); const st = ctx.body.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED'; if (!r.ad_id) throw httpError(400, 'This ad was not finished. Make it again.');
  // On: campaign, then ad set, then ad. Off: the campaign alone stops all spending.
  for (const obj of st === 'ACTIVE' ? [r.campaign_id, r.adset_id, r.ad_id] : [r.campaign_id]) await graph(obj, { method: 'POST', params: { status: st } });
  update('meta_ads', r.id, { status: st, updated_at: now() }); D.history(ctx.actor.label, st === 'ACTIVE' ? 'Meta ad turned on' : 'Meta ad paused', `MA-${r.id}`, null, null, r.name);
  return { status: st };
});
route('GET', '/api/ads/meta', SUPER, async () => {
  const rows = all('SELECT * FROM meta_ads ORDER BY id DESC LIMIT 100');
  const live = cfg() ? await Promise.all(rows.map(async (r) => {
    if (!r.campaign_id || r.status === 'FAILED') return {};
    try {
      const [st, ins] = await Promise.all([graph(r.campaign_id, { params: { fields: 'effective_status' } }), graph(`${r.campaign_id}/insights`, { params: { fields: 'spend,impressions,clicks,actions', date_preset: 'maximum' } })]);
      const x = (ins.data || [])[0] || {}; const acts = Object.fromEntries((x.actions || []).map((a) => [a.action_type, Number(a.value) || 0]));
      return { effective: st.effective_status, spend: Number(x.spend) || 0, impressions: Number(x.impressions) || 0, clicks: Number(x.clicks) || 0, chats: acts['onsite_conversion.messaging_conversation_started_7d'] || 0 };
    } catch (e) { return { live_error: e.message }; }
  })) : rows.map(() => ({}));
  return { rows: rows.map((r, i) => ({ ...r, platforms: JSON.parse(r.platforms || '[]'), spec: undefined, ...live[i], applied: r.job_id ? (get("SELECT COUNT(*) n FROM applications WHERE job_id=? AND ad_set=?", r.job_id, r.name) || {}).n : null })), jobs: all("SELECT id, title, city FROM jobs WHERE status IN ('Open','Sourcing','Interviewing') ORDER BY id DESC").map((j) => [j.id, `${j.title}, ${j.city || ''} · ${j.id}`]), apply_base: L.link('apply') };
});
