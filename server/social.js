// Free (organic) posts from Digital Reach: Facebook Page, Instagram and LinkedIn company page. Post now or schedule;
// a runner checks every minute, posts what is due, saves the post link and marks the channel Done in Digital Reach.
// Meta: the system-user token in .env (META_SOCIAL_TOKEN, else META_ADS_TOKEN), optional META_PAGE_ID.
// LinkedIn: LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET in .env (app with the Community Management API), then a
// page admin presses Connect LinkedIn once; optional LINKEDIN_ORG_ID when the login runs more than one page.
const crypto = require('crypto');
const D = require('./db');
const L = require('./logic');
const V = require('./views');
const F = require('./files');
const R = require('./router');
const { route } = R;
const { get, all, insert, update, now, httpError } = D;

const CH = { auth: 'team', channels: true };
const PLATFORMS = { facebook: { label: 'Facebook', ckey: 'fb' }, instagram: { label: 'Instagram', ckey: 'ig' }, linkedin: { label: 'LinkedIn', ckey: 'li-post' } };
D.db.exec(`CREATE TABLE IF NOT EXISTS social_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, platform TEXT, text TEXT, media_key TEXT, run_at TEXT, status TEXT, remote_id TEXT, url TEXT, error TEXT, by TEXT, by_id TEXT, created_at TEXT, posted_at TEXT);
CREATE INDEX IF NOT EXISTS social_posts_due ON social_posts(status, run_at);
CREATE TABLE IF NOT EXISTS social_job_image (job_id TEXT PRIMARY KEY, media_key TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS social_job_video (job_id TEXT PRIMARY KEY, media_key TEXT, name TEXT, size INTEGER, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS social_auth (provider TEXT PRIMARY KEY, access_token TEXT, refresh_token TEXT, expires_at TEXT, refresh_expires_at TEXT, org_id TEXT, org_name TEXT, by TEXT, at TEXT, state TEXT, state_at TEXT);`);

for (const col of ['format TEXT', 'video_key TEXT']) { try { D.db.exec(`ALTER TABLE social_posts ADD COLUMN ${col}`); } catch { /* already there */ } }
const FORMATS = { post: 'Post', story: 'Story', reel: 'Reel' };
const loadJob = (id) => { const j = get('SELECT * FROM jobs WHERE id=?', id); if (!j) throw httpError(404, 'Job not found'); return j; };
const mediaUrl = (key) => L.link(`api/public/studio-media/${key}`);
const isAdmin = (u) => ['super', 'admin'].includes(u.level);

// ---------- Meta: Facebook Page and its Instagram account ----------
const GRAPH = () => process.env.META_GRAPH_URL || 'https://graph.facebook.com/v21.0';
const metaToken = () => String(process.env.META_SOCIAL_TOKEN || process.env.META_ADS_TOKEN || '').trim();
async function graph(path, { method = 'GET', params = {}, token } = {}) {
  const url = new URL(`${GRAPH()}/${path}`); let body;
  const p = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) p.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); p.set('access_token', token || metaToken());
  if (method === 'GET') url.search = p.toString(); else body = p;
  let res; try { res = await fetch(url, { method, body, signal: AbortSignal.timeout(60000) }); } catch (e) { throw httpError(424, `Meta could not be reached: ${e.message}`); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) { const e = j.error || {}; throw httpError(424, `Meta said: ${e.error_user_msg || e.message || `error ${res.status}`}`); }
  return j;
}
let pageCache = null;
// The Page to post on (and its own token) and the Instagram account linked to it.
async function metaPage(fresh) {
  if (!metaToken()) return { why: 'Add META_SOCIAL_TOKEN (or META_ADS_TOKEN) to the server .env.' };
  if (!fresh && pageCache && Date.now() - pageCache.t < 10 * 60000) return pageCache.v;
  let v;
  try {
    const want = String(process.env.META_PAGE_ID || '').trim();
    let pages = [];
    try { pages = (await graph('me/accounts', { params: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: 100 } })).data || []; } catch { /* a Page token itself */ }
    if (!pages.length) { const me = await graph('me', { params: { fields: 'id,name,instagram_business_account{id,username}' } }); if (me && me.id) pages = [{ ...me, access_token: metaToken() }]; }
    const p = want ? pages.find((x) => x.id === want) : pages[0];
    if (!p) v = { why: want ? `The token cannot post on Page ${want}. Give the system user that Page in Business Settings.` : 'The token has no Facebook Page. In Business Settings give the system user your Page (full control), then make the token again.' };
    else v = { page_id: p.id, page_name: p.name, page_token: p.access_token || metaToken(), ig_id: p.instagram_business_account && p.instagram_business_account.id, ig_name: p.instagram_business_account && p.instagram_business_account.username, pages: pages.length };
  } catch (e) { v = { why: e.message }; }
  pageCache = { t: Date.now(), v }; return v;
}
async function postFacebook(text, media) {
  const pg = await metaPage(); if (!pg.page_id) throw httpError(424, pg.why);
  if (media) { const r = await graph(`${pg.page_id}/photos`, { method: 'POST', token: pg.page_token, params: { url: mediaUrl(media), caption: text } }); const id = r.post_id || r.id; return { id, url: `https://www.facebook.com/${id}` }; }
  const link = (/(https?:\/\/\S+)/.exec(text) || [])[1];
  const r = await graph(`${pg.page_id}/feed`, { method: 'POST', token: pg.page_token, params: { message: text, link } });
  return { id: r.id, url: `https://www.facebook.com/${r.id}` };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Meta's upload for Page reels and video stories: Meta fetches the video from its link.
async function rupload(uploadUrl, token, fileUrl) {
  let res; try { res = await fetch(uploadUrl, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: fileUrl }, signal: AbortSignal.timeout(120000) }); } catch (e) { throw httpError(424, `Meta could not take the video: ${e.message}`); }
  const j = await res.json().catch(() => ({})); if (!res.ok || j.success === false || j.error) throw httpError(424, `Meta could not take the video: ${(j.error && (j.error.message || j.error.error_user_msg)) || j.debug_info && j.debug_info.message || `error ${res.status}`}`);
  return j;
}
// Facebook Page story: an image (photo story) or a video (video story). Stories take no text.
async function storyFacebook(text, media, video) {
  const pg = await metaPage(); if (!pg.page_id) throw httpError(424, pg.why);
  if (video) {
    const s = await graph(`${pg.page_id}/video_stories`, { method: 'POST', token: pg.page_token, params: { upload_phase: 'start' } });
    await rupload(s.upload_url, pg.page_token, mediaUrl(video));
    const r = await graph(`${pg.page_id}/video_stories`, { method: 'POST', token: pg.page_token, params: { upload_phase: 'finish', video_id: s.video_id } });
    return { id: r.post_id || s.video_id, url: `https://www.facebook.com/stories/${pg.page_id}` };
  }
  if (!media) throw httpError(400, 'A story needs an image or a video.');
  const ph = await graph(`${pg.page_id}/photos`, { method: 'POST', token: pg.page_token, params: { url: mediaUrl(media), published: false } });
  const r = await graph(`${pg.page_id}/photo_stories`, { method: 'POST', token: pg.page_token, params: { photo_id: ph.id } });
  return { id: r.post_id || ph.id, url: `https://www.facebook.com/stories/${pg.page_id}` };
}
// Facebook Page reel: a vertical video with the text as its description.
async function reelFacebook(text, media, video) {
  const pg = await metaPage(); if (!pg.page_id) throw httpError(424, pg.why); if (!video) throw httpError(400, 'A reel needs a video. Upload the video first.');
  const s = await graph(`${pg.page_id}/video_reels`, { method: 'POST', token: pg.page_token, params: { upload_phase: 'start' } });
  await rupload(s.upload_url, pg.page_token, mediaUrl(video));
  await graph(`${pg.page_id}/video_reels`, { method: 'POST', token: pg.page_token, params: { upload_phase: 'finish', video_id: s.video_id, video_state: 'PUBLISHED', description: text.slice(0, 2200) } });
  return { id: s.video_id, url: `https://www.facebook.com/reel/${s.video_id}` };
}
// Instagram story or reel: a container, wait until Instagram has processed it, then publish.
async function igPublish(params, slow) {
  const pg = await metaPage(); if (!pg.ig_id) throw httpError(424, pg.page_id ? 'No Instagram account is linked to the Facebook Page. Switch Instagram to a Business account and link it to the Page.' : pg.why);
  const c = await graph(`${pg.ig_id}/media`, { method: 'POST', token: pg.page_token, params });
  for (let i = 0; i < (slow ? 60 : 20); i++) { const s = await graph(c.id, { token: pg.page_token, params: { fields: 'status_code,status' } }); if (s.status_code === 'FINISHED') break; if (s.status_code === 'ERROR') throw httpError(424, `Instagram could not use the ${slow ? 'video: use an MP4 (H.264), 9:16, 3 to 90 seconds' : 'image'}${s.status ? ` (${s.status})` : ''}.`); if (i === (slow ? 59 : 19)) throw httpError(424, 'Instagram is still processing it. Try again in a few minutes.'); await wait(slow ? 5000 : 3000); }
  const r = await graph(`${pg.ig_id}/media_publish`, { method: 'POST', token: pg.page_token, params: { creation_id: c.id } });
  let url = ''; try { url = (await graph(r.id, { token: pg.page_token, params: { fields: 'permalink' } })).permalink || ''; } catch { /* up all the same */ }
  return { id: r.id, url };
}
const storyInstagram = (text, media, video) => { if (!media && !video) throw httpError(400, 'A story needs an image or a video.'); return igPublish(video ? { media_type: 'STORIES', video_url: mediaUrl(video) } : { media_type: 'STORIES', image_url: mediaUrl(media) }, !!video); };
const reelInstagram = (text, media, video) => { if (!video) throw httpError(400, 'A reel needs a video. Upload the video first.'); return igPublish({ media_type: 'REELS', video_url: mediaUrl(video), caption: text.slice(0, 2200), share_to_feed: true }, true); };
async function postInstagram(text, media) {
  const pg = await metaPage(); if (!pg.ig_id) throw httpError(424, pg.page_id ? 'No Instagram account is linked to the Facebook Page. Switch Instagram to a Business account and link it to the Page.' : pg.why);
  if (!media) throw httpError(400, 'Instagram needs an image. Upload the creative first.');
  const c = await graph(`${pg.ig_id}/media`, { method: 'POST', token: pg.page_token, params: { image_url: mediaUrl(media), caption: text.slice(0, 2200) } });
  for (let i = 0; i < 20; i++) { const s = await graph(c.id, { token: pg.page_token, params: { fields: 'status_code' } }); if (s.status_code === 'FINISHED') break; if (s.status_code === 'ERROR') throw httpError(424, 'Instagram could not use the image. Use a JPG between square and landscape.'); await wait(3000); }
  const r = await graph(`${pg.ig_id}/media_publish`, { method: 'POST', token: pg.page_token, params: { creation_id: c.id } });
  let url = ''; try { url = (await graph(r.id, { token: pg.page_token, params: { fields: 'permalink' } })).permalink || ''; } catch { /* the post is up all the same */ }
  return { id: r.id, url };
}

// ---------- LinkedIn company page ----------
const LI = () => ({ id: String(process.env.LINKEDIN_CLIENT_ID || '').trim(), secret: String(process.env.LINKEDIN_CLIENT_SECRET || '').trim(), org: String(process.env.LINKEDIN_ORG_ID || '').trim() });
const liVersion = () => { if (process.env.LINKEDIN_VERSION) return process.env.LINKEDIN_VERSION; const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 2); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const liRedirect = () => L.link('api/social/linkedin/callback');
const liAuth = () => get("SELECT * FROM social_auth WHERE provider='linkedin'");
async function liToken(params) {
  const c = LI(); const body = new URLSearchParams({ ...params, client_id: c.id, client_secret: c.secret });
  let res; try { res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', body, signal: AbortSignal.timeout(30000) }); } catch (e) { throw httpError(424, `LinkedIn could not be reached: ${e.message}`); }
  const j = await res.json().catch(() => ({})); if (!res.ok || !j.access_token) throw httpError(424, `LinkedIn said: ${j.error_description || j.error || `error ${res.status}`}`);
  const at = (s) => (s ? new Date(Date.now() + s * 1000).toISOString() : null);
  return { access_token: j.access_token, refresh_token: j.refresh_token || null, expires_at: at(j.expires_in), refresh_expires_at: at(j.refresh_token_expires_in) };
}
async function liAccess() {
  const a = liAuth(); if (!a || !a.access_token) throw httpError(424, 'LinkedIn is not connected. Press Connect LinkedIn in Digital Reach.');
  if (a.expires_at && new Date(a.expires_at).getTime() - Date.now() < 5 * 60000) {
    if (!a.refresh_token) throw httpError(424, 'The LinkedIn login has expired. Press Connect LinkedIn again.');
    const t = await liToken({ grant_type: 'refresh_token', refresh_token: a.refresh_token });
    D.run("UPDATE social_auth SET access_token=?, refresh_token=COALESCE(?, refresh_token), expires_at=?, refresh_expires_at=COALESCE(?, refresh_expires_at) WHERE provider='linkedin'", t.access_token, t.refresh_token, t.expires_at, t.refresh_expires_at);
    return { ...a, ...t };
  }
  return a;
}
async function li(path, { method = 'GET', json, token, raw } = {}) {
  const headers = { Authorization: `Bearer ${token}`, 'LinkedIn-Version': liVersion(), 'X-Restli-Protocol-Version': '2.0.0' };
  if (json) headers['Content-Type'] = 'application/json';
  let res; try { res = await fetch(path.startsWith('http') ? path : `https://api.linkedin.com/rest/${path}`, { method, headers, body: json ? JSON.stringify(json) : raw, signal: AbortSignal.timeout(60000) }); } catch (e) { throw httpError(424, `LinkedIn could not be reached: ${e.message}`); }
  const text = await res.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { /* empty */ }
  if (!res.ok) throw httpError(424, `LinkedIn said: ${j.message || `error ${res.status}`}`);
  return { body: j, id: res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || j.id };
}
// LinkedIn's text format: these characters are written with a backslash; links stay as they are; #word is a hashtag.
const liText = (t) => String(t).split(/(https?:\/\/\S+)/).map((part, i) => (i % 2 ? part : part.replace(/([\\|{}@[\]()<>*_~])/g, '\\$1').replace(/#(\w+)/g, '{hashtag|\\#|$1}'))).join('');
async function postLinkedIn(text, media) {
  const a = await liAccess(); const owner = `urn:li:organization:${a.org_id}`;
  let content;
  if (media) {
    const m = get('SELECT * FROM studio_media WHERE key=?', media); const f = m && get('SELECT * FROM files WHERE id=?', m.file_id);
    if (f) {
      const init = await li('images?action=initializeUpload', { method: 'POST', token: a.access_token, json: { initializeUploadRequest: { owner } } });
      const v = init.body.value || {};
      let up; try { up = await fetch(v.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${a.access_token}` }, body: F.readStored(f), signal: AbortSignal.timeout(120000) }); } catch (e) { throw httpError(424, `LinkedIn image upload failed: ${e.message}`); }
      if (!up.ok) throw httpError(424, `LinkedIn image upload failed (${up.status})`);
      content = { media: { id: v.image, altText: 'Job opening' } };
    }
  }
  const r = await li('posts', { method: 'POST', token: a.access_token, json: { author: owner, commentary: liText(text).slice(0, 3000), visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false, ...(content ? { content } : {}) } });
  return { id: r.id, url: r.id ? `https://www.linkedin.com/feed/update/${r.id}` : '' };
}

// ---------- what each platform can do right now ----------
async function status(fresh) {
  const pg = await metaPage(fresh); const c = LI(); const a = liAuth();
  const liReady = !!(a && a.access_token && a.org_id && (!a.refresh_expires_at || new Date(a.refresh_expires_at) > new Date() || !a.expires_at || new Date(a.expires_at) > new Date()));
  return {
    facebook: pg.page_id ? { ready: true, name: pg.page_name } : { ready: false, why: pg.why },
    instagram: pg.ig_id ? { ready: true, name: `@${pg.ig_name || pg.ig_id}` } : { ready: false, why: pg.page_id ? 'No Instagram Business account is linked to the Facebook Page.' : pg.why },
    linkedin: liReady ? { ready: true, name: a.org_name || `Page ${a.org_id}`, expires: a.refresh_expires_at || a.expires_at, can_connect: true } : { ready: false, can_connect: !!(c.id && c.secret), why: c.id && c.secret ? 'Press Connect LinkedIn and sign in as a page admin.' : 'Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to the server .env (a LinkedIn app with the Community Management API).' },
  };
}

// ---------- the post text from the job ----------
function draftText(j) {
  const v = V.jobView(j); const sal = v.salary_text && !/hidden|not shown/i.test(v.salary_text) ? v.salary_text : '';
  const exp = j.exp_from !== null && j.exp_from !== undefined ? `${j.exp_from}${j.exp_to !== null && j.exp_to !== undefined ? `–${j.exp_to}` : '+'} years` : '';
  const seats = Math.max(1, (j.openings || 1) - (v.filled || 0)); const cityTag = String(j.city || '').replace(/[^A-Za-z]/g, '');
  return [`We're hiring: ${j.title}${j.city ? ` in ${j.city}` : ''}`, '', ...[exp && `• Experience: ${exp}`, sal && `• Salary: ${sal}`, `• ${seats} opening${seats === 1 ? '' : 's'}`].filter(Boolean), '', 'Apply in 2 minutes: {link}', '', `#hiring #jewellery #jobs${cityTag ? ` #${cityTag}Jobs` : ''}`].join('\n');
}
const applyLink = (j, platform) => { const c = (D.settings().hiring_channels || []).find((x) => x.key === PLATFORMS[platform].ckey); return L.link('apply', `?job=${j.id}&src=${(c && c.tag) || PLATFORMS[platform].ckey}`); };

// ---------- posting one row ----------
const SENDERS = { facebook: postFacebook, instagram: postInstagram, linkedin: postLinkedIn };
const SENDERS_BY = { story: { facebook: storyFacebook, instagram: storyInstagram }, reel: { facebook: reelFacebook, instagram: reelInstagram } };
async function runPost(id) {
  if (D.run("UPDATE social_posts SET status='Posting' WHERE id=? AND status='Scheduled'", id).changes !== 1) return get('SELECT * FROM social_posts WHERE id=?', id);
  const p = get('SELECT * FROM social_posts WHERE id=?', id); const j = get('SELECT * FROM jobs WHERE id=?', p.job_id);
  try {
    if (!j) throw httpError(404, 'The job was removed.');
    const text = String(p.text || '').split('{link}').join(applyLink(j, p.platform));
    const fmt = FORMATS[p.format] ? p.format : 'post'; const send = fmt === 'post' ? SENDERS[p.platform] : (SENDERS_BY[fmt] || {})[p.platform];
    if (!send) throw httpError(400, `${PLATFORMS[p.platform].label} does not take a ${fmt} from here.`);
    const r = await send(text, p.media_key, p.video_key);
    update('social_posts', p.id, { status: 'Posted', remote_id: r.id || null, url: r.url || null, error: null, posted_at: now() });
    const row = get('SELECT * FROM postings WHERE job_id=? AND ckey=?', p.job_id, PLATFORMS[p.platform].ckey);
    if (row) { update('postings', row.id, { status: 'Done', done_date: row.done_date || now(), done_by: p.by, post_link: r.url || row.post_link, updated_by: `${p.by} (auto post)`, updated_at: now() }); D.history(p.by, 'posting', p.job_id, row.channel, row.status || 'not started', 'Done (auto post)'); }
  } catch (e) {
    update('social_posts', p.id, { status: 'Failed', error: String(e.message || e).slice(0, 400) });
    const msg = `${PLATFORMS[p.platform].label} post for ${p.job_id} failed: ${String(e.message || e).slice(0, 140)}`;
    for (const uid of [...new Set([p.by_id, ...L.superAdmins().map((u) => u.id)].filter(Boolean))]) L.alertUser(uid, msg, p.job_id, false);
  }
  return get('SELECT * FROM social_posts WHERE id=?', id);
}
let running = false;
async function runDue() {
  if (running) return; running = true;
  try {
    // A post stuck half way (the server restarted while posting): not tried again on its own, to avoid posting twice.
    D.run("UPDATE social_posts SET status='Failed', error='Stopped while posting. Check the page before trying again.' WHERE status='Posting' AND run_at < ?", new Date(Date.now() - 20 * 60000).toISOString());
    for (const p of all("SELECT id FROM social_posts WHERE status='Scheduled' AND run_at <= ? ORDER BY run_at LIMIT 20", now())) await runPost(p.id);
  } catch (e) { console.error('social posts', e.message); } finally { running = false; }
}
function start() { setInterval(runDue, 60 * 1000); setTimeout(runDue, 20 * 1000); }

const postRow = (p) => ({ ...p, format: p.format || 'post', label: `${PLATFORMS[p.platform] ? PLATFORMS[p.platform].label : p.platform}${p.format && p.format !== 'post' ? ` ${FORMATS[p.format].toLowerCase()}` : ''}`, image: p.media_key ? `/api/public/studio-media/${p.media_key}` : null });

// ---------- routes ----------
route('GET', '/api/social/status', CH, async (ctx) => status(!!ctx.query.fresh));
route('GET', '/api/social/job/:id', CH, (ctx) => {
  const j = loadJob(ctx.params.id); const im = get('SELECT * FROM social_job_image WHERE job_id=?', j.id); const vd = get('SELECT * FROM social_job_video WHERE job_id=?', j.id);
  const sp = get('SELECT * FROM social_job_story WHERE job_id=?', j.id);
  return { story: sp ? { key: sp.media_key, url: `/api/public/studio-media/${sp.media_key}` } : null, video: vd ? { key: vd.media_key, url: `/api/public/studio-media/${vd.media_key}`, name: vd.name, size: vd.size, by: vd.by, at: vd.at } : null, text: draftText(j), image: im ? { key: im.media_key, url: `/api/public/studio-media/${im.media_key}`, by: im.by, at: im.at } : null, posts: all('SELECT * FROM social_posts WHERE job_id=? ORDER BY COALESCE(posted_at, run_at) DESC LIMIT 50', j.id).map(postRow) };
});
// The creative for the posts: sent as a JPG from the browser (fitted to Instagram's shape there).
route('POST', '/api/social/image', CH, (ctx) => {
  const b = ctx.body || {}; const j = loadJob(b.job_id);
  const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw httpError(400, 'The image is empty.'); if (buf.length > 8 * 1024 * 1024) throw httpError(400, 'Use an image up to 8 MB.');
  if (buf.slice(0, 2).toString('hex') !== 'ffd8') throw httpError(400, 'Send the image as a JPG.');
  const key = crypto.randomBytes(12).toString('hex'); const name = `${j.id}-creative.jpg`;
  const f = F.storeBuffer({ recordId: j.id, type: 'studio', name, buf, mime: 'image/jpeg', by: ctx.actor.label });
  insert('studio_media', { key, file_id: f.id, kind: 'image', name, mime: 'image/jpeg', size: buf.length, by: ctx.actor.label, at: now() });
  D.run('INSERT INTO social_job_image (job_id, media_key, by, at) VALUES (?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET media_key=excluded.media_key, by=excluded.by, at=excluded.at', j.id, key, ctx.actor.label, now());
  D.history(ctx.actor.label, 'creative image', j.id, null, null, 'uploaded for posts');
  return { key, url: `/api/public/studio-media/${key}` };
});
// The video for stories and reels: an MP4, kept for the job (the link Meta fetches it from).
route('POST', '/api/social/video', CH, (ctx) => {
  const b = ctx.body || {}; const j = loadJob(b.job_id);
  const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw httpError(400, 'The video is empty.'); if (buf.length > 28 * 1024 * 1024) throw httpError(400, 'Use a video up to 28 MB (a 60-second 1080p reel is usually 15 to 25 MB).');
  if (buf.slice(4, 8).toString('latin1') !== 'ftyp') throw httpError(400, 'Send the video as an MP4.');
  const key = crypto.randomBytes(12).toString('hex'); const name = `${j.id}-video.mp4`;
  const f = F.storeBuffer({ recordId: j.id, type: 'studio', name, buf, mime: 'video/mp4', by: ctx.actor.label });
  insert('studio_media', { key, file_id: f.id, kind: 'video', name, mime: 'video/mp4', size: buf.length, by: ctx.actor.label, at: now() });
  D.run('INSERT INTO social_job_video (job_id, media_key, name, size, by, at) VALUES (?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET media_key=excluded.media_key, name=excluded.name, size=excluded.size, by=excluded.by, at=excluded.at', j.id, key, String(b.name || name).slice(0, 120), buf.length, ctx.actor.label, now());
  D.history(ctx.actor.label, 'creative video', j.id, null, null, 'uploaded for stories and reels');
  return { key, url: `/api/public/studio-media/${key}` };
});
route('POST', '/api/social/posts', CH, async (ctx) => {
  const b = ctx.body || {}; const j = loadJob(b.job_id);
  const plats = [...new Set([].concat(b.platforms || []))].filter((p) => PLATFORMS[p]); if (!plats.length) throw httpError(400, 'Tick Facebook, Instagram or LinkedIn.');
  const text = String(b.text || '').trim(); if (!text && b.format !== 'story') throw httpError(400, 'Write the post.');
  const im = get('SELECT media_key FROM social_job_image WHERE job_id=?', j.id); let media = b.no_image ? null : im && im.media_key;
  const fmt = FORMATS[b.format] ? b.format : 'post'; const vd = get('SELECT media_key FROM social_job_video WHERE job_id=?', j.id);
  const sp = fmt === 'story' ? get('SELECT media_key FROM social_job_story WHERE job_id=?', j.id) : null; const media0 = media; if (sp) media = sp.media_key;
  // a story uses the video when one is uploaded and picked, else the image; a reel always needs the video
  const video = fmt === 'reel' || (fmt === 'story' && b.use_video) ? vd && vd.media_key : null;
  if (fmt !== 'post' && plats.includes('linkedin')) throw httpError(400, 'LinkedIn has no stories or reels: untick LinkedIn, or post it as a Post.');
  if (fmt === 'reel' && !video) throw httpError(400, 'A reel needs a video. Upload the video first.');
  if (fmt === 'story' && !video && !media) throw httpError(400, 'A story needs an image or a video. Upload one first.');
  if (fmt === 'post' && plats.includes('instagram') && !media) throw httpError(400, 'Instagram needs an image. Upload the creative first.');
  let at = new Date(); if (b.at) { at = new Date(b.at); if (Number.isNaN(at.getTime())) throw httpError(400, 'Pick a date and time.'); if (at.getTime() < Date.now() - 60000) throw httpError(400, 'Pick a time in the future.'); if (at.getTime() > Date.now() + 90 * 864e5) throw httpError(400, 'Schedule up to 90 days ahead.'); }
  const st = await status(); const notReady = plats.filter((p) => !st[p].ready);
  if (notReady.length && !b.at) throw httpError(424, `${notReady.map((p) => PLATFORMS[p].label).join(', ')} not connected: ${st[notReady[0]].why}`);
  const ids = plats.map((p) => Number(D.run('INSERT INTO social_posts (job_id, platform, text, media_key, video_key, format, run_at, status, by, by_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', j.id, p, text.slice(0, 5000), video ? null : media || null, video || null, fmt, at.toISOString(), 'Scheduled', ctx.actor.label, ctx.user.id, now()).lastInsertRowid));
  if (!b.at) { const out = []; for (const id of ids) out.push(postRow(await runPost(id))); return { posted: out }; }
  return { scheduled: ids.length, at: at.toISOString(), warn: notReady.length ? `${notReady.map((p) => PLATFORMS[p].label).join(', ')} is not connected yet; connect it before ${L.istFmt(at.toISOString())} or that post fails.` : null };
});
route('POST', '/api/social/posts/:id/cancel', CH, (ctx) => {
  const p = get('SELECT * FROM social_posts WHERE id=?', ctx.params.id); if (!p) throw httpError(404, 'Post not found');
  if (p.status !== 'Scheduled') throw httpError(400, `This post is ${p.status.toLowerCase()}; only scheduled posts can be cancelled.`);
  update('social_posts', p.id, { status: 'Cancelled', error: `Cancelled by ${ctx.actor.label}` }); return { ok: true };
});
route('POST', '/api/social/posts/:id/retry', CH, async (ctx) => {
  const p = get('SELECT * FROM social_posts WHERE id=?', ctx.params.id); if (!p) throw httpError(404, 'Post not found');
  if (p.status !== 'Failed') throw httpError(400, 'Only a failed post can be tried again.');
  update('social_posts', p.id, { status: 'Scheduled', run_at: now(), error: null }); return postRow(await runPost(p.id));
});
// Every scheduled and recent post, for the Digital Reach calendar.
route('GET', '/api/social/posts', CH, (ctx) => {
  const from = new Date(Date.now() - (Number(ctx.query.days_back) || 14) * 864e5).toISOString();
  const rows = all("SELECT p.*, j.title, j.city FROM social_posts p LEFT JOIN jobs j ON j.id=p.job_id WHERE p.status='Scheduled' OR COALESCE(p.posted_at, p.run_at) >= ? ORDER BY p.run_at LIMIT 400", from);
  return { rows: rows.map(postRow) };
});

// LinkedIn: the page admin signs in once; the token renews itself while LinkedIn allows (about a year).
route('POST', '/api/social/linkedin/connect', CH, (ctx) => {
  if (!isAdmin(ctx.user)) throw httpError(403, 'An admin connects LinkedIn.');
  const c = LI(); if (!c.id || !c.secret) throw httpError(424, 'Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to the server .env first.');
  const state = crypto.randomBytes(16).toString('hex');
  D.run("INSERT INTO social_auth (provider, state, state_at, by) VALUES ('linkedin', ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET state=excluded.state, state_at=excluded.state_at", state, now(), ctx.actor.label);
  const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
  u.search = new URLSearchParams({ response_type: 'code', client_id: c.id, redirect_uri: liRedirect(), state, scope: 'w_organization_social r_organization_social rw_organization_admin' }).toString();
  return { url: u.toString() };
});
route('GET', '/api/social/linkedin/callback', {}, async (ctx) => {
  const back = (msg) => ({ __redirect: `/team/jobs?view=tracker&li=${encodeURIComponent(msg)}` });
  const a = liAuth(); const q = ctx.query || {};
  if (q.error) return back(q.error_description || q.error);
  if (!a || !a.state || q.state !== a.state || Date.now() - new Date(a.state_at).getTime() > 15 * 60000) return back('The sign-in link expired. Press Connect LinkedIn again.');
  try {
    const t = await liToken({ grant_type: 'authorization_code', code: String(q.code || ''), redirect_uri: liRedirect() });
    let org = LI().org; let name = '';
    if (!org) { const r = await li('organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', { token: t.access_token }); const el = (r.body.elements || [])[0]; if (!el) return back('This LinkedIn login is not an admin of a company page.'); org = String(el.organization).split(':').pop(); }
    try { name = (await li(`organizations/${org}`, { token: t.access_token })).body.localizedName || ''; } catch { /* the id is enough */ }
    D.run("UPDATE social_auth SET access_token=?, refresh_token=?, expires_at=?, refresh_expires_at=?, org_id=?, org_name=?, state=NULL, at=? WHERE provider='linkedin'", t.access_token, t.refresh_token, t.expires_at, t.refresh_expires_at, org, name, now());
    D.history(a.by || 'LinkedIn', 'linkedin connected', null, null, null, name || org);
    return back('connected');
  } catch (e) { return back(e.message); }
});
route('POST', '/api/social/linkedin/disconnect', CH, (ctx) => { if (!isAdmin(ctx.user)) throw httpError(403, 'An admin does this.'); D.run("DELETE FROM social_auth WHERE provider='linkedin'"); return { ok: true }; });

// ---------- AI creatives: three sizes from a tuned prompt, in the style of earlier creatives (OpenAI images) ----------
D.db.exec(`CREATE TABLE IF NOT EXISTS social_creatives (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, size TEXT, media_key TEXT, prompt TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS creative_runs (id TEXT PRIMARY KEY, job_id TEXT, status TEXT, sizes TEXT, out TEXT, error TEXT, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS creative_refs (media_key TEXT PRIMARY KEY, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS social_job_story (job_id TEXT PRIMARY KEY, media_key TEXT, by TEXT, at TEXT);`);
const SIZES = { square: { label: 'Square 1:1', ai: '1024x1024', what: 'a square 1:1 Instagram and Facebook feed post' }, portrait: { label: 'Portrait 4:5', ai: '1024x1536', what: 'a portrait Instagram feed post (it will be trimmed to 4:5, so keep about 9% empty at the top and bottom)' }, story: { label: 'Story 9:16', ai: '1024x1536', what: 'a vertical 9:16 Instagram, Facebook and WhatsApp story (the sides will be trimmed, so keep everything in the middle 80% of the width, and the top and bottom 12% free of text)' } };
const DEFAULT_PROMPT = `Design {format} for a job opening, for BrillBrains Hiring Solutions (recruitment for India's jewellery industry).
Big headline: "We're Hiring". Role: "{job}". Location: "{city}".{experience}{salary}
Call to action: "Apply now" and the line "{apply}".
Look: premium and clean, deep navy with gold accents, subtle jewellery motifs, bold modern type, strong contrast, easy to read on a phone. No people's faces, no made-up logos, no extra text.
Spell every word exactly as given above. Keep all text inside a 10% margin from every edge.`;
const creativePrompt = () => D.settings().creative_ai_prompt || DEFAULT_PROMPT;
const aiReady = () => !!process.env.OPENAI_API_KEY;
function fillPrompt(tpl, j, size, refs, extra) {
  const v = V.jobView(j); const sal = v.salary_text && !/hidden|not shown/i.test(v.salary_text) ? v.salary_text : '';
  const exp = j.exp_from !== null && j.exp_from !== undefined ? `${j.exp_from}${j.exp_to !== null && j.exp_to !== undefined ? `–${j.exp_to}` : '+'} years` : '';
  const site = String(D.settings().business.base_url || 'hire.brillbrainsconsultants.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const vars = { format: SIZES[size].what, job: j.title, city: j.city || 'India', experience: exp ? ` Experience: "${exp}".` : '', salary: sal ? ` Salary: "${sal}".` : '', apply: `${site}/apply · Job ${j.id}`, company: 'BrillBrains Hiring Solutions' };
  let p = String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  if (refs) p += '\nMatch the style of the reference creatives: their colours, layout, type and overall feel. Do not copy their wording; use the text above.';
  if (extra) p += `\nAlso: ${String(extra).slice(0, 600)}`;
  return p.slice(0, 3800);
}
// The image model: OPENAI_IMAGE_MODEL if set, else the newest full gpt-image model this key can use (asked once a day).
let imgModel = null;
async function imageModel() {
  if (process.env.OPENAI_IMAGE_MODEL) return process.env.OPENAI_IMAGE_MODEL;
  if (imgModel && Date.now() - imgModel.t < 86400000) return imgModel.id;
  let ids = [];
  try { const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(20000) }); const j = await r.json(); ids = (j.data || []).map((m) => m.id).filter((id) => /^gpt-image/.test(id)); } catch { /* fall back below */ }
  const score = (id) => { const v = (/gpt-image-(\d+(?:\.\d+)?)/.exec(id) || [])[1]; return (v ? Number(v) * 100 : 0) - (/mini/.test(id) ? 50 : 0) - (/\d{4}-\d{2}-\d{2}/.test(id) ? 1 : 0); };
  const id = ids.sort((x, y) => score(y) - score(x))[0] || 'gpt-image-1';
  imgModel = { id, t: Date.now() }; return id;
}
async function openaiImage(prompt, size, refKeys) {
  const key = process.env.OPENAI_API_KEY; const model = await imageModel();
  let res;
  try {
    if (refKeys.length) {
      const fd = new FormData(); fd.append('model', model); fd.append('prompt', prompt); fd.append('size', SIZES[size].ai); fd.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'high'); fd.append('n', '1');
      for (const k of refKeys) { const m = get('SELECT * FROM studio_media WHERE key=?', k); const f = m && get('SELECT * FROM files WHERE id=?', m.file_id); if (f) fd.append('image[]', new Blob([F.readStored(f)], { type: m.mime || 'image/jpeg' }), m.name || `${k}.jpg`); }
      res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(240000) });
    } else {
      res = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt, size: SIZES[size].ai, quality: process.env.OPENAI_IMAGE_QUALITY || 'high', n: 1 }), signal: AbortSignal.timeout(240000) });
    }
  } catch (e) { throw new Error(`OpenAI could not be reached: ${e.message}`); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.data || !j.data[0] || !j.data[0].b64_json) { imgModel = null; throw new Error(`OpenAI said (${model}): ${(j.error && j.error.message) || `error ${res.status}`}`); }
  return Buffer.from(j.data[0].b64_json, 'base64');
}
const keepImage = (buf, name, by, recordId) => { const key = crypto.randomBytes(12).toString('hex'); const f = F.storeBuffer({ recordId, type: 'studio', name, buf, mime: 'image/png', by }); insert('studio_media', { key, file_id: f.id, kind: 'image', name, mime: 'image/png', size: buf.length, by, at: now() }); return key; };
async function makeCreatives(runId) {
  const r = get('SELECT * FROM creative_runs WHERE id=?', runId); const j = get('SELECT * FROM jobs WHERE id=?', r.job_id); const o = JSON.parse(r.sizes || '{}'); const out = [];
  await Promise.all(o.sizes.map(async (size) => {
    try {
      const prompt = fillPrompt(o.prompt, j, size, o.refs.length, o.extra); const buf = await openaiImage(prompt, size, o.refs);
      const key = keepImage(buf, `${j.id}-${size}.png`, r.by, j.id);
      insert('social_creatives', { job_id: j.id, size, media_key: key, prompt, by: r.by, at: now() }); out.push({ size, key });
    } catch (e) { out.push({ size, error: e.message }); }
    update('creative_runs', runId, { out: JSON.stringify(out) });
  }));
  update('creative_runs', runId, { status: out.every((x) => x.error) ? 'Failed' : 'Done', out: JSON.stringify(out), error: out.every((x) => x.error) ? out[0].error : null });
  D.history(r.by, 'AI creatives', j.id, null, null, `${out.filter((x) => !x.error).length} made`);
}
const creativeRow = (c) => ({ ...c, label: (SIZES[c.size] || {}).label || c.size, url: `/api/public/studio-media/${c.media_key}` });
route('GET', '/api/social/ai/:job', CH, (ctx) => {
  const j = loadJob(ctx.params.job);
  const refs = all('SELECT media_key FROM creative_refs ORDER BY at DESC LIMIT 30').map((x) => ({ key: x.media_key, url: `/api/public/studio-media/${x.media_key}`, kind: 'reference' }));
  const past = all("SELECT media_key, job_id FROM social_job_image WHERE job_id != ? ORDER BY at DESC LIMIT 12", j.id).map((x) => ({ key: x.media_key, url: `/api/public/studio-media/${x.media_key}`, kind: `used for ${x.job_id}` }));
  const st = get('SELECT * FROM social_job_story WHERE job_id=?', j.id);
  return { ready: aiReady(), sizes: Object.entries(SIZES).map(([k, v]) => ({ key: k, label: v.label })), prompt: creativePrompt(), standard: DEFAULT_PROMPT, refs: [...refs, ...past], made: all('SELECT * FROM social_creatives WHERE job_id=? ORDER BY id DESC LIMIT 24', j.id).map(creativeRow), story_key: st ? st.media_key : null };
});
route('POST', '/api/social/ai/run', CH, (ctx) => {
  const b = ctx.body || {}; const j = loadJob(b.job_id);
  if (!aiReady()) throw httpError(424, 'Making creatives needs OPENAI_API_KEY in the server .env.');
  const sizes = [...new Set([].concat(b.sizes || []))].filter((x) => SIZES[x]); if (!sizes.length) throw httpError(400, 'Tick at least one size.');
  const refs = [...new Set([].concat(b.refs || []))].filter((k) => get('SELECT 1 FROM studio_media WHERE key=?', k)).slice(0, 4);
  const prompt = String(b.prompt || '').trim() || creativePrompt(); if (b.save_prompt) D.setSetting('creative_ai_prompt', prompt);
  if (get("SELECT 1 FROM creative_runs WHERE job_id=? AND status='Making' AND at > ?", j.id, new Date(Date.now() - 6 * 60000).toISOString())) throw httpError(409, 'Creatives for this job are being made already. Wait a minute.');
  const id = crypto.randomBytes(8).toString('hex');
  insert('creative_runs', { id, job_id: j.id, status: 'Making', sizes: JSON.stringify({ sizes, refs, prompt, extra: String(b.extra || '').trim() }), out: '[]', by: ctx.actor.label, at: now() });
  setImmediate(() => makeCreatives(id).catch((e) => update('creative_runs', id, { status: 'Failed', error: e.message })));
  return { id, sizes };
});
route('GET', '/api/social/ai/run/:id', CH, (ctx) => { const r = get('SELECT * FROM creative_runs WHERE id=?', ctx.params.id); if (!r) throw httpError(404, 'Not found'); return { status: r.status, error: r.error, out: JSON.parse(r.out || '[]').map((x) => (x.key ? { ...x, url: `/api/public/studio-media/${x.key}`, label: SIZES[x.size].label } : { ...x, label: SIZES[x.size].label })) }; });
// An earlier creative kept as a style reference (any job's creative, or one uploaded here).
route('POST', '/api/social/ai/refs', CH, (ctx) => {
  const b = ctx.body || {};
  if (b.remove) { D.run('DELETE FROM creative_refs WHERE media_key=?', String(b.remove)); return { ok: true }; }
  const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64'); if (!buf.length) throw httpError(400, 'The image is empty.'); if (buf.length > 8 * 1024 * 1024) throw httpError(400, 'Use an image up to 8 MB.');
  if (buf.slice(0, 2).toString('hex') !== 'ffd8') throw httpError(400, 'Send the image as a JPG.');
  const key = crypto.randomBytes(12).toString('hex'); const f = F.storeBuffer({ recordId: 'CREATIVE-REFS', type: 'studio', name: `reference-${key.slice(0, 6)}.jpg`, buf, mime: 'image/jpeg', by: ctx.actor.label });
  insert('studio_media', { key, file_id: f.id, kind: 'image', name: `reference-${key.slice(0, 6)}.jpg`, mime: 'image/jpeg', size: buf.length, by: ctx.actor.label, at: now() });
  insert('creative_refs', { media_key: key, by: ctx.actor.label, at: now() }); return { key };
});
// The story picture for a job (a 9:16 creative): stories use it before the post image.
route('POST', '/api/social/story-image', CH, (ctx) => {
  const b = ctx.body || {}; const j = loadJob(b.job_id);
  const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]*,/, ''), 'base64'); if (!buf.length || buf.slice(0, 2).toString('hex') !== 'ffd8') throw httpError(400, 'Send the image as a JPG.');
  const key = crypto.randomBytes(12).toString('hex'); const name = `${j.id}-story.jpg`; const f = F.storeBuffer({ recordId: j.id, type: 'studio', name, buf, mime: 'image/jpeg', by: ctx.actor.label });
  insert('studio_media', { key, file_id: f.id, kind: 'image', name, mime: 'image/jpeg', size: buf.length, by: ctx.actor.label, at: now() });
  D.run('INSERT INTO social_job_story (job_id, media_key, by, at) VALUES (?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET media_key=excluded.media_key, by=excluded.by, at=excluded.at', j.id, key, ctx.actor.label, now());
  return { key, url: `/api/public/studio-media/${key}` };
});

module.exports = { start, runDue, status, draftText, liText };
