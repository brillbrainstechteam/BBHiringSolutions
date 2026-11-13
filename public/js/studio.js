/* Campaign studio: WhatsApp templates with header media and buttons, email designs, Meta ads.
   Campaigns › tabs. The classic quick campaign (job alert, message, contact preferences) still opens from here. */
(() => {
  const { $, $$, esc, fmtD, fmtDT } = BB;
  const P = BB.pages; const F = BB.flow; const S = BB.studio = {};
  const classicPage = P.campaigns; const classicCampaign = F.campaign;

  // ---------- page tabs ----------
  const TABS = () => [['', 'Campaigns'], ['templates', 'WhatsApp templates'], ...(S.designs ? [['designs', 'Email designs']] : []), ...(S.ads ? [['ads', 'Meta ads']] : [])];
  P.campaigns = async (o) => {
    const { el, actions, q } = o; const tab = q.tab || '';
    el.innerHTML = `<div class="tabs">${TABS().map(([k, l]) => `<button data-stab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div data-stbody><div class="empty">Loading…</div></div>`;
    $$('[data-stab]', el).forEach((b) => (b.onclick = () => BB.go(`team/campaigns${b.dataset.stab ? `?tab=${b.dataset.stab}` : ''}`)));
    const body = $('[data-stbody]', el); actions.innerHTML = '';
    if (tab === 'templates') return S.templates(body, actions);
    if (tab === 'designs' && S.designs) return S.designs(body, actions);
    if (tab === 'ads' && S.ads) return S.ads(body, actions);
    await classicPage({ ...o, el: body });
    const nb = $('[data-cnew]', actions); if (nb) nb.onclick = () => S.start({});
  };

  // ---------- who gets it, and what ----------
  // aud: { ids, label } for ticked candidates, or { segment | segments, label } for saved segments.
  const WHAT = [['template', 'WhatsApp template', 'Any Meta-approved template: header image, video or PDF, buttons, blanks filled per person'], ['design', 'Email design', 'A designed HTML email with merge fields'], ['job', 'Job alert', 'The approved job alert, WhatsApp or plain email'], ['message', 'Message', 'A short message, WhatsApp or plain email'], ['prefs', 'Ask contact preferences', 'Best channel and time, on WhatsApp']];
  S.start = async (aud) => {
    const segs = (await BB.api('/api/campaigns?from=2999-01-01')).segments; const pre = new Set([...(aud.segments || []), ...(aud.segment ? [aud.segment] : [])].map(String));
    if (!aud.ids && !segs.length) return BB.toast('Save a segment first in Candidates, or tick candidates there and press Send campaign', true);
    const what = WHAT.filter(([k]) => k !== 'design' || S.designs);
    const v = await BB.ask({ title: 'New campaign', wide: true, ok: 'Next', fields: [
      aud.ids ? `<div class="notice">${esc(aud.label || `${aud.ids.length} ticked`)} candidates</div>` : `<div class="field" data-f="segments"><span class="lab">Send to (one or more segments; people in several get it once)</span><div class="st-segs">${segs.map(([id, n]) => `<label class="row small"><input type="checkbox" data-seg="${esc(id)}" ${pre.has(String(id)) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div><div class="small muted" data-segn></div></div>`,
      `<div class="field" data-f="what"><span class="lab">What to send</span><div class="st-what">${what.map(([k, l, h], i) => `<label class="st-what-o"><input type="radio" name="what" value="${k}" ${(aud.what || 'template') === k || (!aud.what && i === 0) ? 'checked' : ''}><span><b>${l}</b><span class="tiny muted">${h}</span></span></label>`).join('')}</div></div>`],
    mount: (m) => { const count = async () => { const ids = $$('[data-seg]:checked', m).map((x) => x.dataset.seg); const n = $('[data-segn]', m); if (!n) return; if (!ids.length) { n.textContent = ''; return; } try { const r = await BB.api(`/api/campaigns/audience?segments=${encodeURIComponent(ids.join(','))}`); n.textContent = `${r.total} people`; } catch (e) { n.textContent = e.message; } }; $$('[data-seg]', m).forEach((x) => (x.onchange = count)); count(); },
    submit: (x) => { const m = $('.modal'); const ids = $$('[data-seg]:checked', m).map((y) => y.dataset.seg); if (!aud.ids && !ids.length) throw Object.assign(new Error('Tick at least one segment'), { field: 'segments' }); return { ...x, segments: ids }; } });
    if (!v) return;
    const names = segs.filter(([id]) => v.segments.includes(String(id))).map(([, n]) => n);
    const a = aud.ids ? { ids: aud.ids, label: aud.label } : { segments: v.segments, segment: v.segments[0], label: names.join(', ') };
    if (v.what === 'template') return S.waBuilder(a, aud.tplKey);
    if (v.what === 'design' && S.sendDesign) return S.sendDesign(a, aud.designId);
    return classicCampaign({ ...a, kind: v.what });
  };
  // Ticked candidates, or a segment's Send campaign button, start here too.
  F.campaign = (aud) => S.start(aud || {});

  // ---------- WhatsApp: the message as the person sees it ----------
  const wa = (t) => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>').replace(/\n/g, '<br>');
  const mediaBox = (fmt, m) => (!fmt || fmt === 'TEXT' ? '' : `<div class="st-media">${m && fmt === 'IMAGE' ? `<img src="${esc(m.url)}" alt="">` : `<span class="small">${fmt === 'VIDEO' ? 'Video' : fmt === 'DOCUMENT' ? 'PDF' : 'Image'}${m ? `: ${esc(m.name)}` : ' (upload a file)'}</span>`}</div>`);
  S.phone = ({ header, text, footer, buttons, media, who }) => `<div class="st-phone">${who ? `<div class="st-who tiny">To ${esc(who)}</div>` : ''}<div class="st-bubble">${mediaBox(header && header.format, media)}${header && header.format === 'TEXT' && header.text ? `<div class="st-h">${wa(header.text)}</div>` : ''}<div>${wa(text || '')}</div>${footer ? `<div class="st-foot">${esc(footer)}</div>` : ''}</div>${(buttons || []).map((b) => `<div class="st-btn">${esc(typeof b === 'string' ? b : b.text)}</div>`).join('')}</div>`;
  const statusBadge = (s) => `<span class="badge tiny ${s === 'APPROVED' ? 'b-green' : s === 'REJECTED' ? 'b-red' : s === 'DRAFT' || s === 'NOT SENT' ? 'b-outline' : 'b-amber'}">${esc(s === 'APPROVED' ? 'Approved' : s === 'REJECTED' ? 'Rejected' : s === 'DRAFT' ? 'Draft' : s === 'PAUSED' ? 'Paused' : s === 'DISABLED' ? 'Disabled' : s === 'NOT SENT' ? 'Not sent' : 'Waiting for Meta')}</span>`;
  S.statusBadge = statusBadge;
  const btnLine = (t) => t.buttons.map((b) => `${b.text}${b.type === 'URL' ? ' (link)' : b.type === 'PHONE_NUMBER' ? ' (call)' : ''}`).join(', ');

  S.upload = async (accept) => {
    const f = await BB.pickFile(accept); if (!f) return null;
    try { return await BB.post('/api/studio/media', { name: f.name, base64: f.base64 }); } catch (e) { BB.fail(e); return null; }
  };

  // ---------- WhatsApp template campaign ----------
  S.waBuilder = async (aud, preKey) => {
    const [d, jobsR] = await Promise.all([BB.api('/api/studio/wa/templates'), BB.api('/api/jobs?size=200')]);
    const ok = d.templates.filter((t) => t.status === 'APPROVED');
    if (!ok.length) return BB.modal({ title: 'No approved templates', body: `<p>None of the WhatsApp templates on Meta is approved yet.${d.note ? ` ${esc(d.note)}` : ''}</p><p class="small muted">Make one in Campaigns › WhatsApp templates and send it to Meta. Approval usually takes minutes to a day.</p>`, foot: false });
    const jobs = jobsR.rows.filter((j) => ['Open', 'Sourcing', 'Interviewing'].includes(j.status));
    const qs = aud.ids ? `ids=${encodeURIComponent(aud.ids.join(','))}` : `segments=${encodeURIComponent((aud.segments || [aud.segment]).join(','))}`;
    const who = await BB.api(`/api/campaigns/audience?${qs}`).catch(() => ({ total: 0 }));
    const st = { key: (ok.find((t) => t.key === preKey) || ok[0]).key, map: {}, media: null };
    const tpl = () => ok.find((t) => t.key === st.key);
    const fieldOpts = (cur) => `<option value="">Choose…</option>${d.fields.map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}<option value="text" ${cur === 'text' ? 'selected' : ''}>Same text for everyone</option>`;
    const guess = (i, tok) => (/name/i.test(tok) || (i === 0 && /^\d+$/.test(tok)) ? { src: 'first_name', fallback: 'there' } : /city/i.test(tok) ? { src: 'job_city' } : /job|role|title/i.test(tok) ? { src: 'job_title' } : /link|url/i.test(tok) ? { src: 'job_apply' } : { src: '' });
    const reset = () => { const t = tpl(); st.map = { header: t.header && t.header.vars.length ? guess(1, t.header.vars[0]) : undefined, body: t.body_vars.map((tok, i) => guess(i, tok)), buttons: Object.fromEntries(t.buttons.filter((b) => b.dynamic).map((b) => [b.index, { src: '' }])) }; st.media = null; };
    reset();
    const row = (path, label, m) => `<div class="st-map"><span class="small"><b>${esc(label)}</b></span><select data-src="${path}">${fieldOpts(m.src)}</select><input data-txt="${path}" value="${esc(m.src === 'text' ? m.text || '' : m.fallback || '')}" placeholder="${m.src === 'text' ? 'The text' : 'If it is empty, use… (optional)'}"></div>`;
    const formHtml = () => {
      const t = tpl(); const media = t.header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(t.header.format);
      return `<label class="field"><span class="lab">Template</span><select data-tkey>${ok.map((x) => `<option value="${esc(x.key)}" ${x.key === st.key ? 'selected' : ''}>${esc(x.name)} · ${esc(x.language)} · ${esc(String(x.category || '').toLowerCase())}</option>`).join('')}</select></label>
        ${media ? `<div class="field" data-f="media"><span class="lab">Header ${t.header.format === 'DOCUMENT' ? 'PDF' : t.header.format.toLowerCase()}</span><div class="row"><button type="button" class="btn sm" data-up>${st.media ? 'Change file' : 'Upload file'}</button><span class="small muted">${st.media ? esc(st.media.name) : t.header.format === 'IMAGE' ? 'JPG or PNG, up to 5 MB' : t.header.format === 'VIDEO' ? 'MP4, up to 16 MB' : 'PDF, up to 16 MB'}</span></div></div>` : ''}
        ${t.header && t.header.vars.length ? row('header', 'Header {{1}}', st.map.header) : ''}
        ${t.body_vars.map((tok, i) => row(`body.${i}`, `{{${tok}}}`, st.map.body[i])).join('')}
        ${t.buttons.filter((b) => b.dynamic).map((b) => row(`buttons.${b.index}`, `${b.text} link`, st.map.buttons[b.index])).join('')}
        ${!(t.header && t.header.vars.length) && !t.body_vars.length && !t.buttons.some((b) => b.dynamic) ? '<div class="small muted">This template has no blanks.</div>' : ''}
        <label class="field"><span class="lab">Job opening for the job blanks <span class="opt">(optional)</span></span><select data-job><option value="">None</option>${jobs.map((j) => `<option value="${esc(j.id)}" ${st.job === j.id ? 'selected' : ''}>${esc(j.title)}, ${esc(j.city || '')} · ${esc(j.id)}</option>`).join('')}</select></label>
        <div class="field"><span class="lab">When</span><div class="choice"><label><input type="radio" name="st_when" value="now" ${(st.when || 'now') === 'now' ? 'checked' : ''}> Now</label><label><input type="radio" name="st_when" value="preferred" ${st.when === 'preferred' ? 'checked' : ''}> Each person's preferred time</label><label><input type="radio" name="st_when" value="at" ${st.when === 'at' ? 'checked' : ''}> At a set time</label></div><input type="datetime-local" data-at value="${esc(st.at || '')}" class="${st.when === 'at' ? '' : 'hidden'}" style="margin-top:6px;max-width:240px"></div>
        <label class="field"><span class="lab">Campaign name <span class="opt">(optional)</span></span><input data-cname value="${esc(st.name || '')}" placeholder="${esc(`WhatsApp: ${t.name}`)}"></label>`;
    };
    const m = BB.modal({ title: `WhatsApp campaign · ${esc(aud.label || '')}`, wide: true,
      body: `<div class="notice" style="margin-bottom:12px">${who.total} ${who.total === 1 ? 'person' : 'people'}. People who said STOP, gave no consent or have no WhatsApp number are left out.${d.live ? '' : ' WhatsApp is not connected here, so messages are saved as would send.'}</div><div class="st-grid"><form class="stack" data-stf onsubmit="return false"></form><div><div class="tiny muted" style="margin-bottom:6px">Preview</div><div data-prev></div><div class="tiny err-msg hidden" data-perr></div></div></div>`,
      foot: '<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-send>Send</button>' }).el;
    let tp;
    const preview = () => { clearTimeout(tp); tp = setTimeout(async () => { const t = tpl(); try { const r = await BB.post('/api/studio/wa/preview', { key: st.key, map: st.map, job_id: st.job, media_key: st.media && st.media.key, candidate_id: who.first }); $('[data-prev]', m).innerHTML = S.phone({ header: t.header, text: r.ok ? r.text.split('\n\n').filter((p) => !/^\[(image|video|document)/.test(p) && !(t.header && t.header.format === 'TEXT' && p.startsWith('*'))).join('\n\n').replace(/\n\n_[^\n]*_$/, '') : t.body, footer: t.footer, buttons: t.buttons, media: st.media, who: r.who }); const e = $('[data-perr]', m); e.classList.toggle('hidden', r.ok); e.textContent = r.ok ? '' : /^Choose/.test(r.error) ? r.error : `For ${r.who}: ${r.error}. People like this are left out unless you give an "If it is empty" text.`; } catch (e) { BB.fail(e); } }, 250); };
    const setPath = (path, patch) => { const [a, b] = path.split('.'); if (a === 'header') st.map.header = { ...st.map.header, ...patch }; else if (a === 'body') st.map.body[b] = { ...st.map.body[b], ...patch }; else st.map.buttons[b] = { ...st.map.buttons[b], ...patch }; };
    const getPath = (path) => { const [a, b] = path.split('.'); return a === 'header' ? st.map.header : a === 'body' ? st.map.body[b] : st.map.buttons[b]; };
    const draw = () => {
      const f = $('[data-stf]', m); f.innerHTML = formHtml();
      $('[data-tkey]', f).onchange = (e) => { st.key = e.target.value; reset(); draw(); };
      const up = $('[data-up]', f); if (up) up.onclick = async () => { const fmt = tpl().header.format; const r = await S.upload(fmt === 'IMAGE' ? '.jpg,.jpeg,.png' : fmt === 'VIDEO' ? '.mp4' : '.pdf'); if (r) { st.media = r; draw(); } };
      $$('[data-src]', f).forEach((s) => (s.onchange = () => { setPath(s.dataset.src, { src: s.value }); draw(); }));
      $$('[data-txt]', f).forEach((i) => (i.oninput = () => { const cur = getPath(i.dataset.txt); setPath(i.dataset.txt, cur.src === 'text' ? { text: i.value } : { fallback: i.value }); preview(); }));
      $('[data-job]', f).onchange = (e) => { st.job = e.target.value; preview(); };
      $$('[name=st_when]', f).forEach((r) => (r.onchange = () => { st.when = r.value; $('[data-at]', f).classList.toggle('hidden', r.value !== 'at'); }));
      $('[data-at]', f).oninput = (e) => { st.at = e.target.value; };
      $('[data-cname]', f).oninput = (e) => { st.name = e.target.value; };
      preview();
    };
    draw();
    $('[data-cancel]', m).onclick = () => m.closest('.modal-back').remove();
    $('[data-send]', m).onclick = async () => {
      const btn = $('[data-send]', m); const at = st.when === 'at' && st.at ? new Date(st.at) : null;
      if (st.when === 'at' && !at) return BB.toast('Pick the date and time', true);
      if (!(await BB.confirm('Send this campaign?', `${tpl().name} to ${who.total} ${who.total === 1 ? 'person' : 'people'}${at ? ` on ${fmtDT(at.toISOString())}` : st.when === 'preferred' ? ' in each person\'s preferred time' : ' now'}.`, 'Send'))) return;
      btn.disabled = true;
      try {
        const v = await BB.post('/api/campaigns', { kind: 'template', tpl: { key: st.key, map: st.map, media_key: st.media && st.media.key }, job_id: st.job || undefined, ids: aud.ids, segments: aud.segments || (aud.segment ? [aud.segment] : undefined), timing: st.when === 'preferred' ? 'preferred' : 'now', send_at: at ? at.toISOString() : undefined, name: st.name });
        m.closest('.modal-back').remove(); S.done(v);
      } catch (e) { BB.showErr(m, e); } finally { btn.disabled = false; }
    };
  };
  S.done = (v) => { BB.go('team/campaigns'); setTimeout(() => BB.open('campaign', v.id), 400); const sk = Object.entries(v.skipped || {}); BB.modal({ title: v.send_at ? 'Campaign scheduled' : 'Campaign sent', foot: false, body: `<p>${v.wa} on WhatsApp, ${v.email} by email, of ${v.total}${v.send_at ? `, going out ${fmtDT(v.send_at)}` : ''}.</p>${sk.length ? `<div class="small">${sk.map(([k, n]) => `<div>${esc(k)}: ${n}</div>`).join('')}</div>` : ''}` }); };

  // ---------- WhatsApp templates tab ----------
  S.templates = async (el, actions) => {
    const d = await BB.api('/api/studio/wa/templates');
    actions.innerHTML = `<button class="btn" data-tsync>Refresh from Meta</button>${S.newTemplate ? '<button class="btn primary" data-tnew>+ New template</button>' : ''}`;
    $('[data-tsync]', actions).onclick = async () => { try { const r = await BB.post('/api/studio/wa/sync'); BB.toast(`${r.count} templates read from Meta`); BB.refreshPage(); } catch (e) { BB.fail(e); } };
    if ($('[data-tnew]', actions)) $('[data-tnew]', actions).onclick = () => S.newTemplate();
    el.innerHTML = `${d.note ? `<div class="notice" style="margin-bottom:12px">${esc(d.note)}</div>` : ''}<div class="small muted" style="margin-bottom:8px">Every template on the WhatsApp account. Approved ones can be sent in a campaign. ${d.synced_at ? `Read from Meta ${fmtDT(d.synced_at)}.` : ''}</div>
      <div class="card">${BB.table([{ t: 'Template', f: (t) => `<b>${esc(t.name)}</b><div class="tiny muted">${esc(t.language)}${t.source === 'portal' ? ' · made here' : ''}</div>` }, { t: 'Category', f: (t) => esc(String(t.category || '').toLowerCase()) }, { t: 'Status', f: (t) => `${statusBadge(t.status)}${t.error ? `<div class="tiny muted">${esc(t.error)}</div>` : ''}` }, { t: 'Header', f: (t) => (t.header ? esc(t.header.format === 'DOCUMENT' ? 'PDF' : t.header.format.toLowerCase()) : '—') }, { t: 'Text', f: (t) => `<div class="small st-clip">${esc(t.body)}</div>` }, { t: 'Buttons', f: (t) => `<span class="small">${esc(btnLine(t)) || '—'}</span>` }], d.templates.map((t) => ({ ...t, id: t.key })), { open: (t) => `watpl:${encodeURIComponent(t.key)}`, empty: 'No templates read yet. Press Refresh from Meta.' })}</div>`;
  };
  BB.panels.watpl = async (k) => {
    const key = decodeURIComponent(k); const d = await BB.api('/api/studio/wa/templates'); const t = d.templates.find((x) => x.key === key); if (!t) throw new Error('Template not found');
    return { head: `<div class="row"><h2>${esc(t.name)}</h2>${statusBadge(t.status)}</div><div class="small muted">${esc(t.language)} · ${esc(String(t.category || '').toLowerCase())}${t.source === 'portal' ? ` · made here by ${esc(t.by)}` : ''}</div>`,
      body: `<div class="st-grid"><div class="stack">${t.error ? `<div class="notice">${esc(t.error)}</div>` : ''}<div class="kn-row"><span>Blanks</span><div>${t.body_vars.length ? t.body_vars.map((x) => `{{${esc(x)}}}`).join(' ') : 'None'}</div></div><div class="kn-row"><span>Buttons</span><div>${t.buttons.map((b) => `<div class="small">${esc(b.text)}${b.url ? ` · ${esc(b.url)}` : ''}${b.phone ? ` · ${esc(b.phone)}` : ''}</div>`).join('') || '—'}</div></div>
        <div class="row">${t.status === 'APPROVED' ? '<button class="btn primary" data-tuse>Use in a campaign</button>' : ''}${S.editTemplate && t.source === 'portal' && ['DRAFT', 'NOT SENT', 'REJECTED'].includes(t.status) ? '<button class="btn" data-tedit>Edit and send to Meta</button>' : ''}</div></div>
        <div>${S.phone({ header: t.header, text: t.body, footer: t.footer, buttons: t.buttons })}</div></div>`,
      mount: (root) => { const u = $('[data-tuse]', root); if (u) u.onclick = () => S.start({ tplKey: t.key, what: 'template' }); const e = $('[data-tedit]', root); if (e) e.onclick = () => S.editTemplate(t); } };
  };
  // ---------- a new WhatsApp template, sent to Meta for approval ----------
  S.newTemplate = () => S.editTemplate(null);
  S.editTemplate = async (from) => {
    const opt = await BB.api('/api/studio/wa/options'); const dr = (from && from.draft) || {};
    const st = { name: dr.name || '', category: dr.category || 'MARKETING', language: dr.language || 'en', header_type: dr.header_type || 'NONE', header_text: dr.header_text || '', header_example: dr.header_example || '', media: dr.media_key ? { key: dr.media_key, name: 'Sample file', url: `/api/public/studio-media/${dr.media_key}` } : null, body: dr.body || '', examples: dr.examples || [], footer: dr.footer || '', button_kind: dr.button_kind || 'none', buttons: dr.buttons || [] };
    if (from && from.status === 'REJECTED') st.name = `${st.name}_v2`;
    const blanks = () => [...new Set([...st.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((x) => x[1]))];
    const sel = (name, opts, cur) => `<select data-k="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const inp = (k, v, ph, attrs = '') => `<input data-k="${k}" value="${esc(v)}" placeholder="${esc(ph || '')}" ${attrs}>`;
    const btnRows = () => {
      if (st.button_kind === 'quick') { while (st.buttons.length < 3) st.buttons.push({ type: 'QUICK_REPLY', text: '' }); return st.buttons.slice(0, 3).map((b, i) => `<input data-b="${i}" data-bk="text" value="${esc(b.text || '')}" placeholder="Quick reply ${i + 1}${i ? ' (optional)' : ''}" maxlength="25">`).join(''); }
      if (st.button_kind === 'cta') { while (st.buttons.length < 2) st.buttons.push({ type: st.buttons.length ? 'PHONE_NUMBER' : 'URL', text: '', value: '' }); return st.buttons.slice(0, 2).map((b, i) => `<div class="st-cta"><select data-b="${i}" data-bk="type"><option value="URL" ${b.type === 'URL' ? 'selected' : ''}>Link</option><option value="PHONE_NUMBER" ${b.type === 'PHONE_NUMBER' ? 'selected' : ''}>Call</option></select><input data-b="${i}" data-bk="text" value="${esc(b.text || '')}" placeholder="Button words${i ? ' (optional)' : ''}" maxlength="25"><input data-b="${i}" data-bk="value" value="${esc(b.value || '')}" placeholder="${b.type === 'URL' ? 'https://… (end with {{1}} to change per person)' : '+91…'}">${b.type === 'URL' && /\{\{1\}\}$/.test(b.value || '') ? `<input data-b="${i}" data-bk="example" value="${esc(b.example || '')}" placeholder="Sample full link for Meta">` : ''}</div>`).join(''); }
      return '';
    };
    const formHtml = () => `<div class="grid g3"><label class="field" data-f="name"><span class="lab">Name</span>${inp('name', st.name, 'e.g. jewellery_walkin_drive')}<div class="faint tiny">Small letters, numbers and _</div></label><label class="field" data-f="category"><span class="lab">Category</span>${sel('category', [['MARKETING', 'Marketing (job alerts, offers)'], ['UTILITY', 'Utility (updates about their application)']], st.category)}</label><label class="field" data-f="language"><span class="lab">Language</span>${sel('language', opt.languages, st.language)}</label></div>
      <div class="field" data-f="header_text"><span class="lab">Header</span><div class="row">${sel('header_type', [['NONE', 'None'], ['TEXT', 'Text'], ['IMAGE', 'Image'], ['VIDEO', 'Video'], ['DOCUMENT', 'PDF']], st.header_type)}${st.header_type === 'TEXT' ? `${inp('header_text', st.header_text, 'Up to 60 letters; {{1}} for one blank', 'maxlength="60" style="flex:1"')}` : ''}${['IMAGE', 'VIDEO', 'DOCUMENT'].includes(st.header_type) ? `<button type="button" class="btn sm" data-tup>${st.media ? 'Change sample' : 'Upload sample'}</button><span class="small muted">${st.media ? esc(st.media.name) : 'Meta reviews with a sample; each campaign can use its own file'}</span>` : ''}</div>${st.header_type === 'TEXT' && /\{\{1\}\}/.test(st.header_text) ? `<div style="margin-top:6px">${inp('header_example', st.header_example, 'Sample for the header blank')}</div>` : ''}</div>
      <label class="field" data-f="body"><span class="lab">Message</span><textarea data-k="body" rows="5" maxlength="1024" placeholder="Hello {{1}}, we have a {{2}} opening in {{3}}. Reply Interested to know more.">${esc(st.body)}</textarea><div class="row" style="margin-top:4px"><button type="button" class="btn sm ghost" data-blank>+ Add blank</button><span class="faint tiny">*bold*  _italic_ · ${st.body.length}/1024</span></div></label>
      ${blanks().length ? `<div class="field" data-f="examples"><span class="lab">Samples for Meta's review</span><div class="grid g3">${blanks().map((n, i) => `<input data-ex="${i}" value="${esc(st.examples[i] || '')}" placeholder="{{${n}}} e.g. ${['Priya', 'Sales Executive', 'Mumbai'][i] || 'sample'}">`).join('')}</div></div>` : ''}
      <label class="field" data-f="footer"><span class="lab">Footer <span class="opt">(optional)</span></span>${inp('footer', st.footer, 'e.g. Reply STOP to stop these messages', 'maxlength="60"')}</label>
      <div class="field" data-f="buttons"><span class="lab">Buttons</span>${sel('button_kind', [['none', 'None'], ['quick', 'Quick replies (up to 3)'], ['cta', 'Link and call (up to 2)']], st.button_kind)}<div class="stack-sm" style="margin-top:6px">${btnRows()}</div></div>`;
    const sample = (t) => t.replace(/\{\{(\d+)\}\}/g, (m, n) => st.examples[blanks().indexOf(n)] || m);
    const prev = () => S.phone({ header: st.header_type === 'NONE' ? null : { format: st.header_type, text: st.header_type === 'TEXT' ? st.header_text.replace('{{1}}', st.header_example || '{{1}}') : '' }, text: sample(st.body), footer: st.footer, buttons: st.button_kind === 'none' ? [] : st.buttons.filter((b) => b.text), media: st.media });
    const m = BB.modal({ title: from ? `Template · ${esc(from.name)}` : 'New WhatsApp template', wide: true,
      body: `<div class="notice" style="margin-bottom:12px">Meta reviews every template, usually within minutes, sometimes a day. Approved ones show in Campaigns › New campaign.${from && from.error ? `<div class="small" style="margin-top:4px">Last try: ${esc(from.error)}</div>` : ''}</div><div class="st-grid"><form class="stack" data-tf onsubmit="return false"></form><div><div class="tiny muted" style="margin-bottom:6px">Preview (with the samples)</div><div data-tprev></div></div></div>`,
      foot: `${from && ['DRAFT', 'NOT SENT'].includes(from.status) ? '<button class="btn ghost" data-tdel style="margin-right:auto">Remove draft</button>' : ''}<button class="btn" data-tsave>Save draft</button><button class="btn primary" data-tsub>Send to Meta</button>` }).el;
    const draw = () => {
      const f = $('[data-tf]', m); f.innerHTML = formHtml(); $('[data-tprev]', m).innerHTML = prev();
      const redraw = ['header_type', 'button_kind', 'header_text', 'body'];
      $$('[data-k]', f).forEach((i) => { i.oninput = i.onchange = (e) => { st[i.dataset.k] = i.value; if (i.dataset.k === 'button_kind') st.buttons = []; if (e.type === 'change' && redraw.includes(i.dataset.k)) draw(); else $('[data-tprev]', m).innerHTML = prev(); }; });
      $$('[data-ex]', f).forEach((i) => (i.oninput = () => { st.examples[+i.dataset.ex] = i.value; $('[data-tprev]', m).innerHTML = prev(); }));
      $$('[data-b]', f).forEach((i) => { i.oninput = i.onchange = (e) => { st.buttons[+i.dataset.b][i.dataset.bk] = i.value; if (e.type === 'change' && i.dataset.bk !== 'text') draw(); else $('[data-tprev]', m).innerHTML = prev(); }; });
      $('[data-blank]', f).onclick = () => { const ta = $('[data-k=body]', f); const n = blanks().length + 1; const pos = ta.selectionStart ?? st.body.length; st.body = `${st.body.slice(0, pos)}{{${n}}}${st.body.slice(pos)}`; draw(); };
      const up = $('[data-tup]', f); if (up) up.onclick = async () => { const r = await S.upload(st.header_type === 'IMAGE' ? '.jpg,.jpeg,.png' : st.header_type === 'VIDEO' ? '.mp4' : '.pdf'); if (r) { st.media = r; draw(); } };
    };
    draw();
    const save = async (submit) => {
      const btns = $$('.modal-f .btn', m); btns.forEach((b) => (b.disabled = true));
      try {
        const r = await BB.post('/api/studio/wa/templates', { ...st, media_key: st.media && st.media.key, examples: blanks().map((_, i) => st.examples[i] || ''), key: from ? from.key : undefined, submit });
        m.closest('.modal-back').remove(); BB.toast(submit ? `Sent to Meta: ${r.status === 'APPROVED' ? 'approved' : 'waiting for review'}` : 'Draft saved'); BB.go('team/campaigns?tab=templates');
      } catch (e) { BB.showErr(m, e); if (/^Not sent to Meta|Saved as a draft/.test(e.message) && BB.refreshPage) BB.refreshPage(); } finally { btns.forEach((b) => (b.disabled = false)); }
    };
    $('[data-tsave]', m).onclick = () => save(false); $('[data-tsub]', m).onclick = () => save(true);
    const del = $('[data-tdel]', m); if (del) del.onclick = async () => { if (!(await BB.confirm('Remove this draft?', 'It was never sent to Meta.', 'Remove'))) return; try { await BB.post(`/api/studio/wa/templates/${encodeURIComponent(from.key)}/delete`); m.closest('.modal-back').remove(); BB.toast('Draft removed'); BB.refreshPage(); } catch (e) { BB.fail(e); } };
  };

  // ---------- email designs ----------
  const BLOCK_NAMES = [['heading', 'Heading'], ['text', 'Text'], ['image', 'Image'], ['button', 'Button'], ['job', 'Job card'], ['divider', 'Divider'], ['spacer', 'Space']];
  const newBlock = (type) => ({ heading: { type, text: 'Hello {first_name}', size: 'l', align: 'left' }, text: { type, text: 'Write your message. **Bold** with two stars; links work as they are.', align: 'left' }, image: { type, media_key: '', url: '', alt: '', width: 100, align: 'center' }, button: { type, label: 'See the jobs', url: '{apply_link}', color: 'gold', align: 'left' }, job: { type, job_id: '' }, divider: { type }, spacer: { type } }[type]);
  S.designs = async (el, actions) => {
    const d = await BB.api('/api/studio/designs');
    actions.innerHTML = '<button class="btn primary" data-dnew>+ New design</button>';
    $('[data-dnew]', actions).onclick = () => S.designer(null);
    el.innerHTML = `<div class="small muted" style="margin-bottom:8px">Designed emails for campaigns. {first_name}, {city}, {job_title} and the other merge fields fill in for each person.</div><div class="card">${BB.table([{ t: 'Design', f: (x) => `<b>${esc(x.name)}</b><div class="tiny muted">${esc(x.subject || 'No subject yet')}</div>` }, { t: 'Blocks', num: 1, f: (x) => x.blocks.length }, { t: 'Updated', f: (x) => `${fmtD(x.updated_at || x.at)}<div class="tiny muted">${esc(x.updated_by || x.by)}</div>` }, { t: '', f: (x) => `<span class="nowrap"><button class="btn sm" data-dedit="${x.id}">Edit</button> <button class="btn sm primary" data-dsend="${x.id}">Send</button></span>` }], d.rows, { empty: 'No designs yet. Press + New design.' })}</div>`;
    $$('[data-dedit]', el).forEach((b) => (b.onclick = () => S.designer(d.rows.find((x) => String(x.id) === b.dataset.dedit))));
    $$('[data-dsend]', el).forEach((b) => (b.onclick = () => S.start({ what: 'design', designId: b.dataset.dsend })));
  };
  S.designer = async (from) => {
    const d = await BB.api('/api/studio/designs');
    const st = { id: from ? from.id : null, name: from ? from.name : '', subject: from ? from.subject : '', preheader: from ? from.preheader : '', blocks: from ? JSON.parse(JSON.stringify(from.blocks)) : [newBlock('heading'), newBlock('text'), newBlock('button')], job: '' };
    let lastFocus = null;
    const sel = (i, k, opts, cur) => `<select data-bi="${i}" data-bk="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const inp = (i, k, v, ph) => `<input data-bi="${i}" data-bk="${k}" value="${esc(v ?? '')}" placeholder="${esc(ph || '')}">`;
    const align = (i, b) => sel(i, 'align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], b.align);
    const blockForm = (b, i) => {
      const body = {
        heading: () => `<div class="st-brow">${inp(i, 'text', b.text, 'Heading')}${sel(i, 'size', [['l', 'Large'], ['m', 'Medium']], b.size)}${align(i, b)}</div>`,
        text: () => `<textarea data-bi="${i}" data-bk="text" rows="4">${esc(b.text)}</textarea><div class="st-brow">${align(i, b)}</div>`,
        image: () => `<div class="st-brow"><button type="button" class="btn sm" data-bimg="${i}">${b.media_key ? 'Change image' : 'Upload image'}</button>${b.media_key ? '' : inp(i, 'url', b.url, 'or an https:// image link')}${sel(i, 'width', [[100, 'Full width'], [75, '3/4'], [50, 'Half'], [30, 'Small']], b.width)}${align(i, b)}</div><div class="st-brow">${inp(i, 'alt', b.alt, 'Words if the image does not load')}${b.media_key ? inp(i, 'url', b.url, 'Link when tapped (optional)') : ''}</div>`,
        button: () => `<div class="st-brow">${inp(i, 'label', b.label, 'Button words')}${inp(i, 'url', b.url, 'https://… or {apply_link}')}</div><div class="st-brow">${sel(i, 'color', [['gold', 'Gold'], ['navy', 'Navy'], ['green', 'Green']], b.color)}${align(i, b)}</div>`,
        job: () => `${sel(i, 'job_id', [['', 'Pick a job opening'], ...d.jobs], b.job_id)}<div class="tiny muted">Title, city, experience, with Apply and See the job links</div>`,
        divider: () => '<div class="tiny muted">A thin line</div>', spacer: () => '<div class="tiny muted">Empty space</div>',
      }[b.type]();
      return `<div class="st-block"><div class="row between"><b class="small">${esc((BLOCK_NAMES.find(([k]) => k === b.type) || [])[1])}</b><span class="nowrap"><button type="button" class="btn sm ghost" data-bmv="${i}:-1" ${i ? '' : 'disabled'} aria-label="Move up" title="Move up">↑</button><button type="button" class="btn sm ghost" data-bmv="${i}:1" ${i < st.blocks.length - 1 ? '' : 'disabled'} aria-label="Move down" title="Move down">↓</button><button type="button" class="btn sm ghost" data-bdel="${i}" aria-label="Remove" title="Remove">✕</button></span></div>${body}</div>`;
    };
    const m = BB.modal({ title: from ? `Email design · ${esc(from.name)}` : 'New email design', wide: true,
      body: `<div class="st-grid st-grid-mail"><form class="stack" data-df onsubmit="return false"></form><div><div class="row between" style="margin-bottom:6px"><span class="tiny muted" data-dwho>Preview</span><select data-djob class="sm" style="max-width:200px"><option value="">Sample job: none</option>${d.jobs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div><div class="tiny" data-dsub style="margin-bottom:4px"></div><iframe class="st-mail" data-dprev title="Email preview" sandbox="allow-same-origin"></iframe></div></div>`,
      foot: `${from ? '<button class="btn ghost" data-ddel style="margin-right:auto">Remove</button>' : ''}<button class="btn" data-dtest>Send a test</button><button class="btn" data-dsave>Save</button><button class="btn primary" data-dsend>Save and send</button>` }).el;
    let tp;
    const preview = () => { clearTimeout(tp); tp = setTimeout(async () => { try { const r = await BB.post('/api/studio/designs/preview', { subject: st.subject, preheader: st.preheader, blocks: st.blocks, job_id: st.job }); $('[data-dprev]', m).srcdoc = r.html.split('src="/api/').join(`src="${location.origin}/api/`); $('[data-dsub]', m).innerHTML = `<b>Subject:</b> ${esc(r.subject || '(none)')}`; $('[data-dwho]', m).textContent = `Preview for ${r.who}`; } catch (e) { BB.fail(e); } }, 300); };
    const draw = () => {
      const f = $('[data-df]', m);
      f.innerHTML = `<div class="grid g2">${BB.field({ name: 'name', label: 'Design name', value: st.name, voice: false })}${BB.field({ name: 'subject', label: 'Email subject', value: st.subject, voice: false, placeholder: 'e.g. {first_name}, jobs in {city} this week' })}</div>${BB.field({ name: 'preheader', label: 'Preview line in the inbox', opt: true, value: st.preheader, voice: false })}
        <div class="st-chips"><span class="tiny muted">Merge fields (click to add where you are typing):</span>${d.fields.map(([k, l]) => `<button type="button" class="badge b-outline tiny" data-mf="${k}" title="${esc(l)}">{${k}}</button>`).join('')}</div>
        <div class="stack-sm">${st.blocks.map(blockForm).join('') || '<div class="empty small">No blocks yet.</div>'}</div>
        <div class="row st-add"><span class="small muted">Add:</span>${BLOCK_NAMES.map(([k, l]) => `<button type="button" class="btn sm" data-badd="${k}">${l}</button>`).join('')}</div>`;
      $$('[name=name],[name=subject],[name=preheader]', f).forEach((i) => { i.onfocus = () => (lastFocus = i); i.oninput = () => { st[i.name] = i.value; preview(); }; });
      $$('[data-bi]', f).forEach((i) => { const blk = st.blocks[+i.dataset.bi]; i.onfocus = () => (lastFocus = i); i.oninput = i.onchange = (e) => { blk[i.dataset.bk] = i.dataset.bk === 'width' ? Number(i.value) : i.value; if (e.type === 'change' && i.tagName === 'SELECT' && i.dataset.bk === 'job_id') draw(); preview(); }; });
      $$('[data-badd]', f).forEach((b) => (b.onclick = () => { st.blocks.push(newBlock(b.dataset.badd)); draw(); }));
      $$('[data-bdel]', f).forEach((b) => (b.onclick = () => { st.blocks.splice(+b.dataset.bdel, 1); draw(); }));
      $$('[data-bmv]', f).forEach((b) => (b.onclick = () => { const [i, dir] = b.dataset.bmv.split(':').map(Number); const [x] = st.blocks.splice(i, 1); st.blocks.splice(i + dir, 0, x); draw(); }));
      $$('[data-bimg]', f).forEach((b) => (b.onclick = async () => { const r = await S.upload('.jpg,.jpeg,.png'); if (r) { st.blocks[+b.dataset.bimg].media_key = r.key; draw(); } }));
      $$('[data-mf]', f).forEach((b) => { b.onmousedown = (e) => e.preventDefault(); b.onclick = () => { const i = lastFocus && document.contains(lastFocus) ? lastFocus : null; if (!i) return BB.toast('Click in a text box first', true); const pos = i.selectionStart ?? i.value.length; i.value = `${i.value.slice(0, pos)}{${b.dataset.mf}}${i.value.slice(i.selectionEnd ?? pos)}`; i.dispatchEvent(new Event('input')); i.focus(); }; });
      preview();
    };
    draw();
    $('[data-djob]', m).onchange = (e) => { st.job = e.target.value; preview(); };
    const save = async () => { const r = await BB.post('/api/studio/designs', { id: st.id, name: st.name, subject: st.subject, preheader: st.preheader, blocks: st.blocks }); st.id = r.id; return r; };
    const guard = (fn) => async () => { const btns = $$('.modal-f .btn', m); btns.forEach((b) => (b.disabled = true)); try { await fn(); } catch (e) { BB.showErr(m, e); } finally { btns.forEach((b) => (b.disabled = false)); } };
    $('[data-dsave]', m).onclick = guard(async () => { await save(); BB.toast('Design saved'); if (BB.refreshPage) BB.refreshPage(); });
    $('[data-dtest]', m).onclick = guard(async () => { await save(); const v = await BB.ask({ title: 'Send a test', note: 'The test uses sample details (Priya Sharma, Mumbai). It goes even while emails are off.', fields: [{ name: 'to', label: 'Send to', type: 'email', value: BB.me.user.email || '', voice: false }], ok: 'Send test', submit: (x) => BB.post(`/api/studio/designs/${st.id}/test`, { ...x, job_id: st.job }) }); if (v) BB.toast(v.configured ? `Test sent to ${v.to}` : `Test saved for ${v.to}. Email sending is not set up on this copy.`, !v.configured); });
    $('[data-dsend]', m).onclick = guard(async () => { await save(); m.closest('.modal-back').remove(); S.start({ what: 'design', designId: st.id }); });
    const del = $('[data-ddel]', m); if (del) del.onclick = async () => { if (!(await BB.confirm('Remove this design?', 'Campaigns already sent keep what went.', 'Remove'))) return; try { await BB.post(`/api/studio/designs/${st.id}/delete`); m.closest('.modal-back').remove(); BB.toast('Design removed'); BB.refreshPage(); } catch (e) { BB.fail(e); } };
  };
  // Send a design to the people picked in New campaign.
  S.sendDesign = async (aud, designId) => {
    const d = await BB.api('/api/studio/designs'); if (!d.rows.length) { BB.toast('Make an email design first', true); return BB.go('team/campaigns?tab=designs'); }
    const qs = aud.ids ? `ids=${encodeURIComponent(aud.ids.join(','))}` : `segments=${encodeURIComponent((aud.segments || [aud.segment]).join(','))}`;
    const who = await BB.api(`/api/campaigns/audience?${qs}`).catch(() => ({ total: 0 }));
    const pick = d.rows.find((x) => String(x.id) === String(designId)) || d.rows[0];
    setTimeout(() => { const m = $('.modal'); if (!m) return; const at = $('[name=send_at]', m).closest('.field'); const show = () => at.classList.toggle('hidden', ($('[name=when]:checked', m) || {}).value !== 'at'); $$('[name=when]', m).forEach((r) => (r.onchange = show)); show(); const ds = $('[name=design_id]', m); ds.onchange = () => { const x = d.rows.find((y) => String(y.id) === ds.value); $('[name=subject]', m).placeholder = x ? x.subject : ''; }; }, 0);
    const v = await BB.ask({ title: `Email campaign · ${esc(aud.label || '')}`, wide: true, note: `${who.total} ${who.total === 1 ? 'person' : 'people'}. People who said STOP, gave no consent or have no email are left out. While emails are off, campaigns wait on hold.`, fields: [
      { name: 'design_id', label: 'Design', type: 'select', options: d.rows.map((x) => [x.id, x.name]), value: pick.id, placeholder: false },
      { name: 'subject', label: 'Subject', opt: true, voice: false, placeholder: pick.subject, hint: 'Empty uses the design\'s subject' },
      { name: 'job_id', label: 'Job opening for {job_title}, {job_city} and the job links', type: 'select', options: d.jobs, opt: true, placeholder: 'None' },
      { name: 'when', label: 'When', type: 'choice', options: [['now', 'Now'], ['preferred', 'Each person\'s preferred time'], ['at', 'At a set time']], value: 'now' },
      { name: 'send_at', label: 'Date and time', type: 'datetime-local', voice: false },
      { name: 'name', label: 'Campaign name', opt: true, voice: false }], ok: 'Send',
    submit: (x) => { if (x.when === 'at' && !x.send_at) throw Object.assign(new Error('Pick the date and time'), { field: 'send_at' }); return BB.post('/api/campaigns', { kind: 'design', design_id: x.design_id, subject: x.subject, job_id: x.job_id || undefined, ids: aud.ids, segments: aud.segments || (aud.segment ? [aud.segment] : undefined), timing: x.when === 'preferred' ? 'preferred' : 'now', send_at: x.when === 'at' ? new Date(x.send_at).toISOString() : undefined, name: x.name }); } });
    if (v) S.done(v);
  };

})();
