// Tiny router + sessions + access rules (section 4), all checked on the server for every request.
const crypto = require('crypto');
const D = require('./db');
const L = require('./logic');

const routes = [];
function route(method, pattern, opts, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts: opts || {}, handler });
}

const IDLE = { client: 30 * 24, candidate: 30 * 24 };
function newSession(kind, subjectId, memberId, extra = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  D.insert('sessions', { token, kind, subject_id: subjectId, member_id: memberId || null, created_at: D.now(), last_seen: D.now(), pending_2fa: extra.pending_2fa ? 1 : 0, device: extra.device || null });
  return token;
}
function loadSession(req) {
  const token = req.headers['x-session'];
  if (!token) return null;
  const s = D.get('SELECT * FROM sessions WHERE token=?', token);
  if (!s) return null;
  const idleHours = s.kind === 'team' ? D.settings().team_idle_hours : IDLE[s.kind];
  if ((Date.now() - new Date(s.last_seen).getTime()) / 3600000 > idleHours) { D.run('DELETE FROM sessions WHERE token=?', token); return { expired: true }; }
  D.run('UPDATE sessions SET last_seen=? WHERE token=?', D.now(), token);
  return s;
}

function actorOf(u) { return { uid: u.id, name: u.name, label: u.name, level: u.level, agency_id: u.agency_id }; }

async function dispatch(req, res, url, body) {
  const fwd = D.ENV.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.socket.remoteAddress;
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname); if (!m) continue;
    const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), body: body || {}, ip };
    if (r.opts.rate) rateCheck(`${r.opts.rate.key}:${ip}`, r.opts.rate.max, r.opts.rate.minutes);
    const need = r.opts.auth;
    if (need) {
      const s = loadSession(req);
      if (!s || s.expired) throw D.httpError(401, s && s.expired ? 'You were logged out after being idle. Please log in again.' : 'Please log in.');
      if (s.kind !== need) throw D.httpError(403, 'Not allowed here.');
      if (s.pending_2fa && !r.opts.allow2fa) throw D.httpError(401, 'Enter the WhatsApp code first.');
      ctx.session = s;
      if (need === 'team') {
        const u = D.get('SELECT * FROM users WHERE id=?', s.subject_id);
        if (!u || u.status !== 'On') throw D.httpError(401, 'This login is turned off.');
        const ag = u.agency_id ? D.get('SELECT * FROM agencies WHERE id=?', u.agency_id) : null;
        if (ag && ag.status === 'Paused' && u.level !== 'super') throw D.httpError(401, 'This agency is paused.');
        if (r.opts.levels && !r.opts.levels.includes(u.level)) throw D.httpError(403, 'Your level cannot do this.');
        ctx.user = u; ctx.agency = ag; ctx.actor = actorOf(u);
        D.update('users', u.id, { last_action: D.now() });
      } else if (need === 'client') {
        ctx.client = D.get('SELECT * FROM clients WHERE id=?', L.resolveId(s.subject_id));
        if (!ctx.client || ctx.client.removed) throw D.httpError(401, 'Account not found.');
        ctx.member = s.member_id ? D.get('SELECT * FROM client_members WHERE id=?', s.member_id) : null;
        ctx.actor = { label: ctx.member ? `${ctx.member.name} (${ctx.member.role}) — client` : `${ctx.client.contact || ctx.client.company} — client` };
        if (r.opts.perm && ctx.member && !(ctx.member.perms || {})[r.opts.perm]) throw D.httpError(403, 'Your company login does not allow this. Ask the main contact.');
      } else if (need === 'candidate') {
        ctx.candidate = D.get('SELECT * FROM candidates WHERE id=?', L.resolveId(s.subject_id));
        if (!ctx.candidate || ctx.candidate.removed) throw D.httpError(401, 'Profile not found.');
        ctx.actor = { label: `${ctx.candidate.name} — candidate` };
      }
    }
    return r.handler(ctx);
  }
  throw D.httpError(404, 'Not found');
}

// Simple per-address limit for public endpoints (forms, codes, logins), kept in memory.
const hits = new Map();
function rateCheck(key, max, minutes) {
  const now = Date.now(); const since = now - minutes * 60000;
  const list = (hits.get(key) || []).filter((t) => t > since);
  if (list.length >= max) throw D.httpError(429, 'Too many tries from this connection. Please wait a few minutes and try again.');
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || v[v.length - 1] < since) hits.delete(k);
}

// ---------- access rules (section 4) ----------
const isSuper = (u) => u.level === 'super';
function seeClient(u, c) { return c && (isSuper(u) || (c.agency_id && c.agency_id === u.agency_id)); }
function seeJob(u, j) {
  if (!j) return false;
  if (isSuper(u)) return true;
  if (u.level === 'admin') return j.agency_id === u.agency_id;
  return j.recruiter_id === u.id;
}
function seeApp(u, a, j) {
  if (!a) return false;
  j = j || D.get('SELECT * FROM jobs WHERE id=?', a.job_id);
  if (isSuper(u)) return true;
  if (u.level === 'admin') return j && j.agency_id === u.agency_id;
  return a.owner_id === u.id || (j && j.recruiter_id === u.id);
}
const phoneVisible = (u, c) => isSuper(u) || (c.agency_id && c.agency_id === u.agency_id);
function seeBill(u, b) { return isSuper(u) || (u.level === 'admin' && b.agency_id === u.agency_id); }
function seeThread(u, ptype, pid) {
  if (isSuper(u)) return true;
  if (ptype === 'user') { const t = D.get('SELECT * FROM users WHERE id=?', pid); return t && (t.id === u.id || (u.level === 'admin' && t.agency_id === u.agency_id)); }
  if (ptype === 'client') { const c = D.get('SELECT * FROM clients WHERE id=?', pid); if (!c) return false; return u.level === 'admin' ? c.agency_id === u.agency_id : c.owner_id === u.id || !!D.get('SELECT 1 FROM jobs WHERE client_id=? AND recruiter_id=?', pid, u.id); }
  if (ptype === 'candidate') { const c = D.get('SELECT * FROM candidates WHERE id=?', pid); if (!c) return false; return u.level === 'admin' ? c.agency_id === u.agency_id || !!D.get('SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=? AND j.agency_id=?', pid, u.agency_id) : c.recruiter_id === u.id || !!D.get('SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.candidate_id=? AND (a.owner_id=? OR j.recruiter_id=?)', pid, u.id, u.id); }
  return false;
}
function maskPhone(p) { return p ? p.slice(0, 2) + '••••••' + p.slice(-2) : ''; }
function candidateOut(u, c) {
  if (!c) return c;
  const show = phoneVisible(u, c);
  return { ...c, whatsapp: show ? c.whatsapp : maskPhone(c.whatsapp), email: show ? c.email : '', phone_hidden: !show };
}

module.exports = { route, dispatch, newSession, loadSession, actorOf, isSuper, seeClient, seeJob, seeApp, seeBill, seeThread, phoneVisible, candidateOut, maskPhone };
