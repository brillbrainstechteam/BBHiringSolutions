// Outgoing email over SMTP (no outside packages). Settings come from .env:
// SMTP_HOST, SMTP_PORT, SMTP_SECURE (ssl | starttls | none), SMTP_USER, SMTP_PASS, SMTP_FROM, NOTIFY_EMAILS.
// Every email is logged in the emails table first, then sent; failures are retried by the timer (3 tries).
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const D = require('./db');

const cfg = () => D.ENV.smtp;
const configured = () => !!(cfg().host && cfg().from);
const secureMode = () => cfg().secure || (cfg().port === 465 ? 'ssl' : cfg().port === 25 ? 'none' : 'starttls');

// One SMTP conversation: EHLO, STARTTLS when asked, AUTH, MAIL/RCPT/DATA, QUIT.
function smtpSend({ to, subject, text, html }) {
  const c = cfg();
  return new Promise((resolve, reject) => {
    let sock; let buf = ''; let waiting = null;
    const fail = (e) => { try { sock && sock.destroy(); } catch { /* closed */ } reject(e); };
    const onData = (d) => {
      buf += d.toString('utf8');
      // A reply is complete when its last line is "NNN text" (not "NNN-text").
      const lines = buf.split('\r\n'); if (lines[lines.length - 1] !== '') return;
      const last = lines[lines.length - 2] || '';
      if (!/^\d{3} /.test(last) && !/^\d{3}$/.test(last)) return;
      const reply = buf; buf = '';
      if (waiting) { const w = waiting; waiting = null; w(reply); }
    };
    const attach = (s) => { s.setTimeout(30000, () => fail(new Error('Email server timed out'))); s.on('data', onData); s.on('error', fail); };
    const read = () => new Promise((res) => { waiting = res; });
    const cmd = async (line, expect) => {
      sock.write(line + '\r\n');
      const r = await read();
      if (expect && !expect.test(r)) throw new Error(`Email server said: ${r.trim().split('\r\n').pop()}`);
      return r;
    };
    const mode = secureMode();
    const open = () => (mode === 'ssl' ? tls.connect({ host: c.host, port: c.port, servername: c.host }) : net.connect({ host: c.host, port: c.port }));
    sock = open(); attach(sock);
    (async () => {
      const hello = await read(); if (!/^220/.test(hello)) throw new Error(`Email server said: ${hello.trim()}`);
      let ehlo = await cmd('EHLO bbhs.local', /^250/m);
      if (mode === 'starttls') {
        if (!/STARTTLS/i.test(ehlo)) throw new Error('The email server does not offer STARTTLS (set SMTP_SECURE=ssl with port 465, or none for a local relay).');
        await cmd('STARTTLS', /^220/);
        sock.removeListener('data', onData);
        sock = tls.connect({ socket: sock, servername: c.host }); attach(sock);
        await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
        ehlo = await cmd('EHLO bbhs.local', /^250/m);
      }
      if (c.user) {
        if (/AUTH[ =][^\r\n]*PLAIN/i.test(ehlo)) await cmd(`AUTH PLAIN ${Buffer.from(`\0${c.user}\0${c.pass}`).toString('base64')}`, /^235/);
        else { await cmd('AUTH LOGIN', /^334/); await cmd(Buffer.from(c.user).toString('base64'), /^334/); await cmd(Buffer.from(c.pass).toString('base64'), /^235/); }
      }
      const fromAddr = (/<([^>]+)>/.exec(c.from) || [null, c.from])[1];
      await cmd(`MAIL FROM:<${fromAddr}>`, /^250/);
      for (const r of to) await cmd(`RCPT TO:<${r}>`, /^25[01]/);
      await cmd('DATA', /^354/);
      sock.write(buildMessage({ from: c.from, to, subject, text, html }) + '\r\n.\r\n');
      const done = await read(); if (!/^250/.test(done)) throw new Error(`Email server said: ${done.trim()}`);
      try { sock.write('QUIT\r\n'); } catch { /* closing */ }
      sock.end(); resolve(true);
    })().catch(fail);
  });
}
const b64lines = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
const encHeader = (s) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
function buildMessage({ from, to, subject, text, html }) {
  const boundary = 'bbhs-' + crypto.randomBytes(8).toString('hex');
  const domain = (/@([^>\s]+)/.exec(from) || [null, 'bbhs.local'])[1];
  const msg = [
    `From: ${from}`, `To: ${to.join(', ')}`, `Subject: ${encHeader(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(text), '',
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(html), '',
    `--${boundary}--`,
  ].join('\r\n');
  return msg.replace(/^\./gm, '..'); // dot-stuffing (base64 lines never start with a dot, but headers might)
}

// ---------- templates ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function layout(title, bodyHtml, cta) {
  const b = D.settings().business;
  return `<!doctype html><html><body style="margin:0;background:#F6F7FB;font-family:Arial,Helvetica,sans-serif;color:#101A3A">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7FB;padding:24px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E5E8F1">
<tr><td style="background:#101A3A;padding:18px 24px;border-bottom:4px solid #D19B12">${/^https:\/\//.test(D.ENV.baseUrl) ? `<img src="${esc(D.ENV.baseUrl)}/img/logo.png" alt="${esc(b.name)}" height="52" style="height:52px;width:auto;display:block;border:0;color:#fff;font-size:18px;font-weight:bold">` : `<span style="color:#fff;font-size:18px;font-weight:bold">${esc(b.name)}</span><br><span style="color:#8D97B8;font-size:11px">Effective Recruitment Services</span>`}</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px;color:#101A3A">${esc(title)}</h1>${bodyHtml}
${cta ? `<p style="margin:22px 0 4px"><a href="${esc(cta.url)}" style="background:#D19B12;color:#1A1404;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:999px;display:inline-block">${esc(cta.label)}</a></p>` : ''}</td></tr>
<tr><td style="padding:14px 24px;background:#F9FAFD;color:#959DB5;font-size:11px">${esc(b.name)}${b.support_phone ? ` · WhatsApp ${esc(b.support_phone)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}
const rows = (pairs) => `<table cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6">${pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<tr><td style="color:#5A6482;padding:2px 16px 2px 0;vertical-align:top">${esc(k)}</td><td style="padding:2px 0"><b>${esc(v)}</b></td></tr>`).join('')}</table>`;
const textRows = (pairs) => pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');

// Queue one email (saved first, so nothing is lost if sending fails).
// sendAfter: hold it until then (quiet hours); dedupe: never send the same one twice.
function queue({ to, subject, text, html, kind, recordId, sendAfter, dedupe }) {
  const list = (Array.isArray(to) ? to : [to]).map((x) => String(x || '').trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x));
  if (!list.length) return null;
  if (dedupe && D.get('SELECT 1 FROM emails WHERE dedupe=?', dedupe)) return null;
  if (sendAfter && sendAfter > D.now()) {
    const r = D.run('INSERT INTO emails (to_addr,subject,kind,record_id,text,html,status,tries,at,send_after,dedupe) VALUES (?,?,?,?,?,?,?,?,?,?,?)', list.join(', '), subject, kind || null, recordId || null, text, html, 'scheduled', 0, D.now(), sendAfter, dedupe || null);
    return Number(r.lastInsertRowid);
  }
  const r = D.run('INSERT INTO emails (to_addr,subject,kind,record_id,text,html,status,tries,at,dedupe) VALUES (?,?,?,?,?,?,?,?,?,?)', list.join(', '), subject, kind || null, recordId || null, text, html, configured() ? 'queued' : 'not sent (email not set up)', 0, D.now(), dedupe || null);
  const id = Number(r.lastInsertRowid);
  if (configured()) setImmediate(() => deliver(id));
  return id;
}
async function deliver(id) {
  const e = D.get('SELECT * FROM emails WHERE id=?', id); if (!e || e.status === 'sent') return;
  try {
    await smtpSend({ to: e.to_addr.split(',').map((x) => x.trim()), subject: e.subject, text: e.text, html: e.html });
    D.update('emails', id, { status: 'sent', tries: e.tries + 1, error: null, sent_at: D.now() });
    D.setHealth('last_email_sent', D.now());
  } catch (err) {
    const tries = e.tries + 1;
    D.update('emails', id, { status: tries >= 3 ? 'failed' : 'queued', tries, error: err.message });
    if (tries >= 3) require('./alerts').devAlert('Emails failing', `${e.subject} → ${e.to_addr}: ${err.message}`);
  }
}
// Timer: retry queued emails (and ones saved before SMTP was set up, once it is).
function retryQueued() {
  // Held for quiet hours: due now → queued (or marked not sent while email is not set up).
  D.run("UPDATE emails SET status=? WHERE status='scheduled' AND send_after<=?", configured() ? 'queued' : 'not sent (email not set up)', D.now());
  if (!configured()) return 0;
  const list = D.all("SELECT id FROM emails WHERE status IN ('queued','not sent (email not set up)') AND tries < 3 ORDER BY id LIMIT 50");
  for (const e of list) deliver(e.id);
  return list.length;
}

// ---------- notifications ----------
function newLead(type, rec) {
  const to = D.ENV.notifyEmails; if (!to.length) return;
  const base = D.settings().business.base_url;
  const isClient = type === 'client';
  const pairs = isClient
    ? [['Client ID', rec.id], ['Company', rec.company], ['Contact', rec.contact], ['WhatsApp', rec.whatsapp], ['Email', rec.email], ['City', [rec.city, rec.state].filter(Boolean).join(', ')], ['Business', rec.business_type], ['When', rec.need], ['Roles', rec.roles], ['Source', rec.source]]
    : [['Candidate ID', rec.id], ['Name', rec.name], ['WhatsApp', rec.whatsapp], ['Email', rec.email], ['City', [rec.city, rec.state].filter(Boolean).join(', ')], ['Job wanted', rec.job_wanted], ['Experience', rec.exp_total !== null && rec.exp_total !== undefined ? `${rec.exp_total} years` : ''], ['Source', rec.source]];
  const subject = isClient ? `New hiring request: ${rec.company || rec.contact} (${rec.id})` : `New job application: ${rec.name} — ${rec.job_wanted || 'job'} (${rec.id})`;
  queue({ to, subject, kind: `new_${type}`, recordId: rec.id,
    text: `${subject}\n\n${textRows(pairs)}\n\nOpen in the team portal: ${base}/team`,
    html: layout(isClient ? 'New hiring request' : 'New job application', rows(pairs), { label: 'Open the team portal', url: `${base}/team` }) });
}
function confirmToPerson(type, rec) {
  if (!rec.email) return;
  const base = D.settings().business.base_url; const name = D.settings().business.name;
  if (type === 'client') {
    queue({ to: rec.email, kind: 'client_confirmation', recordId: rec.id, subject: `We received your hiring request — ${rec.id}`,
      text: `Hello ${rec.contact},\n\nThank you for choosing ${name}. Your client ID is ${rec.id}.\n\nWhat happens next:\n1. Our team calls you within one working day to understand your needs.\n2. We share a simple agreement and set up your first job opening.\n3. You get matching profiles on WhatsApp and in your account.\n\nYour account: ${base}/my-account`,
      html: layout(`Thank you, ${rec.contact}`, `<p style="font-size:14px;line-height:1.6">We received your hiring request. Your client ID is <b>${esc(rec.id)}</b>.</p><ol style="font-size:14px;line-height:1.7;padding-left:18px"><li>Our team calls you within one working day to understand your needs.</li><li>We share a simple agreement and set up your first job opening.</li><li>You get matching profiles on WhatsApp and in your account.</li></ol>`, { label: 'Open my client account', url: `${base}/my-account` }) });
  } else {
    queue({ to: rec.email, kind: 'candidate_confirmation', recordId: rec.id, subject: `Your application is in — ${rec.id}`,
      text: `Hello ${rec.name},\n\nThank you for applying with ${name}. Your candidate ID is ${rec.id}.\n\nWhat happens next:\n1. Complete your profile — salary, notice period and skills help us match you.\n2. When a job matches, we call you and set up the interview.\n3. Interview times and offers come on WhatsApp.\n\nYour profile: ${base}/my-profile`,
      html: layout(`Thank you, ${rec.name}`, `<p style="font-size:14px;line-height:1.6">Your application is in. Your candidate ID is <b>${esc(rec.id)}</b>.</p><ol style="font-size:14px;line-height:1.7;padding-left:18px"><li>Complete your profile — salary, notice period and skills help us match you.</li><li>When a job matches, we call you and set up the interview.</li><li>Interview times and offers come on WhatsApp.</li></ol>`, { label: 'Open my profile', url: `${base}/my-profile` }) });
  }
}
// ---------- the email copy of a WhatsApp message ----------
// Every WhatsApp format message also goes by email to anyone with an email address, at the same time.
// Email costs nothing per message, and reaches people whose WhatsApp is off or who have no number on file.
const SUBJECTS = {
  bbhs_client_welcome: 'Welcome to BrillBrains Hiring Solutions', bbhs_candidate_welcome: 'Welcome to BrillBrains Hiring Solutions',
  bbhs_details_request: 'A few details for your job application', bbhs_shortlist_ready: 'New candidate profiles are ready for you',
  bbhs_interview_scheduled: 'Your interview is fixed', bbhs_interview_reminder: 'Interview reminder', bbhs_feedback_request: 'How did the interview go?',
  bbhs_offer: 'Congratulations, you have a job offer', bbhs_joining_reminder: 'Your joining date is coming up', bbhs_post_join_checkin: 'How is the new job going?',
  bbhs_bill_raised: 'Your invoice from BrillBrains Hiring', bbhs_payment_reminder: 'Payment reminder', bbhs_job_alert: 'A new job that matches your profile',
  bbhs_team_task_alert: 'New task for you', bbhs_jd_approval: 'Your job description is ready to approve', bbhs_log_reminder: "Please submit today's daily log", bbhs_day_summary: 'Your daily hiring summary',
  bbhs_still_looking: 'Are you still looking for a job?', bbhs_monthly_summary: 'Your monthly hiring summary', bbhs_consent_request: 'Job updates from BrillBrains Hiring',
};
// What the WhatsApp buttons become in an email: one button to the place where that answer is given.
const ACCOUNT = { client: ['my-account', 'Open your account'], candidate: ['my-profile', 'Open your profile'], user: ['team', 'Open the team portal'] };
function copyOfWhatsApp({ to, personType, format, text, recordId, sendAfter, dedupe }) {
  if (!to || D.ENV.emailCopies === false) return null;
  const base = D.settings().business.base_url || D.ENV.baseUrl;
  const [path, label] = ACCOUNT[personType] || ACCOUNT.candidate;
  const subject = SUBJECTS[format] || 'A message from BrillBrains Hiring';
  // "Tap Confirm…" refers to WhatsApp buttons; in an email the same answers are given in their account.
  const tapped = /\s*(?:please\s+)?tap\s[^.!?]*[.!?]/gi;
  if (tapped.test(text)) text = `${text.replace(/,?\s+(?:and|or)\s+tap\s[^.!?]*([.!?])/gi, '$1').replace(tapped, '').trim()}\nUse the button below to reply.`;
  const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:)])/g, '<a href="$1" style="color:#1E3A8A">$1</a>');
  const body = String(text).split(/\n+/).map((p) => `<p style="font-size:14px;line-height:1.65;margin:0 0 12px">${linkify(p)}</p>`).join('');
  return queue({ to, subject, kind: `copy:${format}`, recordId, sendAfter, dedupe,
    text: `${text}\n\n${label}: ${base}/${path}`, html: layout(subject, body, { label, url: `${base}/${path}` }) });
}

// Account codes by email (the same code also goes on WhatsApp): 'signup' confirms a new email account,
// 'reset' sets a new password.
function accountCode(to, code, recordId, why) {
  const b = D.settings().business;
  const w = why === 'signup'
    ? { subject: `Confirm your email: ${code}`, title: 'Confirm your email', line: 'Use this code to finish creating your account.', after: 'If you did not ask for an account, ignore this email.' }
    : { subject: `Your password reset code: ${code}`, title: 'Reset your password', line: 'Use this code to set a new password.', after: 'If you did not ask for it, ignore this email. Your password stays the same.' };
  const text = `${b.name}: ${w.line} Code: ${code} (valid for 10 minutes). ${w.after}`;
  return queue({ to, subject: w.subject, text, html: layout(w.title, `<p style="font-size:14px;line-height:1.6">${w.line} It is valid for 10 minutes.</p><p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:12px 0">${esc(code)}</p><p style="font-size:12px;color:#5A6482">${w.after}</p>`), kind: `account_${why}`, recordId });
}
function testEmail(to) {
  return queue({ to, kind: 'test', subject: 'BBHS test email', text: 'This is a test email from BBHS. If you can read this, outgoing email works.', html: layout('Outgoing email works', '<p style="font-size:14px">This is a test email from BBHS. If you can read this, outgoing email works.</p>') });
}

module.exports = { accountCode, configured, queue, deliver, retryQueued, newLead, confirmToPerson, copyOfWhatsApp, testEmail, smtpSend };
