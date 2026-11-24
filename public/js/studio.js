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
    if (tab === 'templates') return S.templates(body, actions, q);
    if (tab === 'designs' && S.designs) return S.designs(body, actions);
    if (tab === 'ads' && S.ads) return S.ads(body, actions);
    // Messages written in a campaign: their own template, waiting for Meta or sent
    const waits = await BB.api('/api/campaigns/waits').catch(() => []);
    const strip = document.createElement('div');
    if (waits.length) {
      const st = (w) => (w.status === 'Waiting' ? '<span class="badge b-amber tiny">Waiting for Meta approval</span>' : w.status === 'Sent' ? `<span class="badge b-green tiny">Approved · ${esc(w.note || 'sent')}</span>` : `<span class="badge b-red tiny">${esc(w.status)}</span>`);
      strip.innerHTML = `<section class="card pad mw-strip"><h3 class="dsec-h">Messages sent to Meta</h3><div class="mw-list">${waits.slice(0, 8).map((w) => `<div class="mw-row"><div class="grow"><b class="mono small">${esc(w.template)}</b><div class="tiny muted">${esc(w.by || '')} · ${BB.fmtDT ? BB.fmtDT(w.at) : esc(w.at)}${w.status === 'Rejected' && w.note ? ` · ${esc(w.note)}` : ''}</div></div>${st(w)}${w.campaign_id ? `<button class="btn sm" data-open="campaign:${esc(w.campaign_id)}">Open</button>` : ''}</div>`).join('')}</div>${waits.some((w) => w.status === 'Waiting') ? '<div class="tiny muted" style="margin-top:6px">Checked every 10 minutes; each one sends by itself once Meta approves.</div>' : ''}</section>`;
    }
    await classicPage({ ...o, el: body });
    // the "Messages sent to Meta" list is not shown: template status lives in the Templates tab
    const nb = $('[data-cnew]', actions); if (nb) nb.onclick = () => S.start({});
  };

  // ---------- who gets it, and what ----------
  // aud: { ids, label } for ticked candidates, or { segment | segments, label } for saved segments.
  const WHAT = [['newmsg', 'Write a new WhatsApp message', 'Type it now (with {{Name}}). It goes to Meta and sends by itself once approved, usually within minutes'], ['template', 'WhatsApp template', 'Any Meta-approved template: header image, video or PDF, buttons, blanks filled per person'], ['design', 'Email design', 'A designed HTML email with merge fields'], ['job', 'Job alert', 'The approved job alert, WhatsApp or plain email'], ['message', 'Message', 'A short message, WhatsApp or plain email'], ['prefs', 'Ask contact preferences', 'Best channel and time, on WhatsApp']];
  S.start = async (aud) => {
    const segs = (await BB.api('/api/campaigns?from=2999-01-01')).segments; const pre = new Set([...(aud.segments || []), ...(aud.segment ? [aud.segment] : [])].map(String));
    if (!aud.ids && !aud.filters && !segs.length) return BB.toast('Save a segment first in Candidates, or tick candidates there and press Send campaign', true);
    const what = WHAT.filter(([k]) => k !== 'design' || S.designs);
    const v = await BB.ask({ title: 'New campaign', wide: true, ok: 'Next', fields: [
      aud.ids || aud.filters ? `<div class="notice">${esc(aud.label || `${(aud.ids || []).length} ticked candidates`)}</div>` : `<div class="field" data-f="segments"><span class="lab">Send to</span>
        <div class="seg aud-mode" style="margin-bottom:10px"><button type="button" class="on" data-amode="seg">Segments</button><button type="button" data-amode="pick">Pick people</button><button type="button" data-amode="up">Upload a list</button></div>
        <div data-apane="seg"><div class="st-segs">${segs.map(([id, n]) => `<label class="row small"><input type="checkbox" data-seg="${esc(id)}" ${pre.has(String(id)) ? 'checked' : ''}> ${esc(n)}</label>`).join('') || '<span class="small muted">No saved segments yet.</span>'}</div><div class="small muted" data-segn></div><div class="tiny muted">People in several segments get it once.</div></div>
        <div data-apane="pick" hidden><input data-apq placeholder="Search name, phone, ID, job…"><div class="aud-res" data-apres></div><div class="small" data-apsel>Nobody picked yet.</div></div>
        <div data-apane="up" hidden><button type="button" class="btn" data-aup>Choose Excel or CSV</button><div class="tiny muted" style="margin-top:6px">First row names the columns: ID, WhatsApp (or Phone) or Email. Each row is matched to a candidate.</div><div class="small" data-aupres></div></div></div>`,
      `<div class="field" data-f="what"><span class="lab">What to send</span><div class="st-what">${what.map(([k, l, h], i) => `<label class="st-what-o"><input type="radio" name="what" value="${k}" ${(aud.what || 'template') === k || (!aud.what && i === 0) ? 'checked' : ''}><span><b>${l}</b><span class="tiny muted">${h}</span></span></label>`).join('')}</div></div>`],
    mount: (m) => {
      const picked = new Map(); let upIds = []; let mode = 'seg'; m.dataset.amode = 'seg';
      $$('[data-amode]', m).forEach((b) => (b.onclick = () => { mode = b.dataset.amode; m.dataset.amode = mode; $$('[data-amode]', m).forEach((x) => x.classList.toggle('on', x === b)); $$('[data-apane]', m).forEach((p) => (p.hidden = p.dataset.apane !== mode)); }));
      const selTxt = () => { const s2 = $('[data-apsel]', m); if (s2) s2.innerHTML = picked.size ? `<b>${picked.size}</b> picked: ${[...picked.values()].slice(0, 6).map(esc).join(', ')}${picked.size > 6 ? ' …' : ''}` : 'Nobody picked yet.'; m.dataset.apick = [...picked.keys()].join(','); };
      let tq; const apq = $('[data-apq]', m); if (apq) apq.oninput = () => { clearTimeout(tq); tq = setTimeout(async () => { const qv = apq.value.trim(); const box = $('[data-apres]', m); if (qv.length < 2) { box.innerHTML = ''; return; } const r = await BB.api(`/api/candidates?${BB.qs({ q: qv, size: 15 })}`).catch(() => ({ rows: [] })); box.innerHTML = (r.rows || []).map((c) => `<label class="aud-p"><input type="checkbox" data-apid="${esc(c.id)}" data-apnm="${esc(c.name)}" ${picked.has(c.id) ? 'checked' : ''}><span class="grow"><b>${esc(c.name)}</b> <span class="tiny muted">${esc(c.job_wanted || '')}${c.city ? ` · ${esc(c.city)}` : ''} · ${esc(c.id)}</span></span></label>`).join('') || '<div class="small muted">No match.</div>'; $$('[data-apid]', box).forEach((x) => (x.onchange = () => { if (x.checked) picked.set(x.dataset.apid, x.dataset.apnm); else picked.delete(x.dataset.apid); selTxt(); })); }, 300); };
      const up = $('[data-aup]', m); if (up) up.onclick = async () => { const fs2 = await BB.pickFiles('.xlsx,.csv'); if (!fs2 || !fs2.length) return; const f = fs2[0]; const res = $('[data-aupres]', m); res.textContent = 'Reading…'; try { const base64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); }); const r = await BB.post('/api/campaigns/audience/upload', { name: f.name, base64 }); upIds = r.ids; m.dataset.aup = upIds.join(','); res.innerHTML = `<b>${r.matched}</b> candidate${r.matched === 1 ? '' : 's'} matched${r.missed ? ` · ${r.missed} not found (${r.missed_sample.map(esc).join(', ')}${r.missed > 8 ? ' …' : ''}): add them in Candidates › Upload Excel first` : ''}`; } catch (e) { res.textContent = e.message; } };
      const count = async () => { const ids = $$('[data-seg]:checked', m).map((x) => x.dataset.seg); const n = $('[data-segn]', m); if (!n) return; if (!ids.length) { n.textContent = ''; return; } try { const r = await BB.api(`/api/campaigns/audience?segments=${encodeURIComponent(ids.join(','))}`); n.textContent = `${r.total} people`; } catch (e) { n.textContent = e.message; } }; $$('[data-seg]', m).forEach((x) => (x.onchange = count)); count(); },
    submit: (x) => { const m = $('.modal'); const mode = m.dataset.amode || 'seg';
      if (!aud.ids && !aud.filters && mode === 'pick') { const ids = String(m.dataset.apick || '').split(',').filter(Boolean); if (!ids.length) throw Object.assign(new Error('Pick at least one person'), { field: 'segments' }); return { ...x, segments: [], picked: ids, how: 'Picked' }; }
      if (!aud.ids && !aud.filters && mode === 'up') { const ids = String(m.dataset.aup || '').split(',').filter(Boolean); if (!ids.length) throw Object.assign(new Error('Upload a list with at least one candidate we have'), { field: 'segments' }); return { ...x, segments: [], picked: ids, how: 'Uploaded list' }; }
      const ids = $$('[data-seg]:checked', m).map((y) => y.dataset.seg); if (!aud.ids && !aud.filters && !ids.length) throw Object.assign(new Error('Tick at least one segment'), { field: 'segments' }); return { ...x, segments: ids }; } });
    if (!v) return;
    const names = segs.filter(([id]) => v.segments.includes(String(id))).map(([, n]) => n);
    const a = aud.filters ? { filters: aud.filters, label: aud.label } : aud.ids ? { ids: aud.ids, label: aud.label } : v.picked ? { ids: v.picked, label: `${v.how}: ${v.picked.length} ${v.picked.length === 1 ? 'person' : 'people'}` } : { segments: v.segments, segment: v.segments[0], label: names.join(', ') };
    if (v.what === 'newmsg') return S.newMessage(a);
    if (v.what === 'template') return S.waBuilder(a, aud.tplKey);
    if (v.what === 'design' && S.sendDesign) return S.sendDesign(a, aud.designId);
    return classicCampaign({ ...a, kind: v.what });
  };
  // A message written now: it becomes its own WhatsApp template; the campaign goes once Meta approves it.
  S.newMessage = async (a) => {
    const jobs = (await BB.api('/api/jobs?size=200')).rows.filter((j) => ['Open', 'Sourcing', 'Interviewing', 'Offer stage'].includes(j.status));
    const qs = a.filters ? `filters=${encodeURIComponent(JSON.stringify(a.filters))}` : a.ids ? `ids=${encodeURIComponent(a.ids.join(','))}` : `segments=${encodeURIComponent((a.segments || [a.segment]).join(','))}`;
    const who = await BB.api(`/api/campaigns/audience?${qs}`).catch(() => ({ total: 0 }));
    const m = BB.modal({ title: 'New WhatsApp message', wide: true, body: `<div class="st-grid"><form class="stack" data-nm onsubmit="return false">
        <div class="notice small">${esc(a.label || '')} · <b>${who.total}</b> people. Only those who agreed to WhatsApp job alerts get it.</div>
        <label class="field"><span class="lab">Message <span class="opt">· {{Name}} becomes each person's first name · *bold* and emojis work</span></span><textarea name="text" rows="14" placeholder="Hi {{Name}}, 👋&#10;&#10;Greetings from BrillBrains Hiring Solutions!"></textarea></label>
        <label class="field"><span class="lab">For which job <span class="opt">(optional: an Interested reply opens their application on it)</span></span><select name="job_id"><option value="">No job</option>${jobs.map((j) => `<option value="${esc(j.id)}">${esc(j.id)} · ${esc(j.title)} · ${esc(j.city || '')}</option>`).join('')}</select></label>
        <label class="row small"><input type="checkbox" name="buttons" checked> Add Interested / Not Interested buttons</label>
        <label class="field"><span class="lab">Campaign name <span class="opt">(optional)</span></span><input name="name" placeholder="e.g. CAD designers Surat"></label>
      </form><div><div class="tiny muted" style="margin-bottom:6px">Preview</div><div data-nmprev></div></div></div>`,
      foot: '<span class="small muted grow">Meta reviews it first (usually minutes, sometimes a few hours). It then sends by itself and you get a bell alert.</span><button class="btn" data-x2>Cancel</button><button class="btn primary" data-nmgo>Send for approval</button>' });
    const f = $('[data-nm]', m.el); const prev = () => { const v = BB.formValues(f); $('[data-nmprev]', m.el).innerHTML = S.phone({ text: String(v.text || 'Your message').replace(/\{\{\s*(first[ _]?)?name\s*\}\}/gi, 'Priya'), buttons: f.buttons.checked ? ['Interested', 'Not Interested'] : [] }); };
    f.oninput = prev; f.onchange = prev; prev(); $('[data-x2]', m.el).onclick = m.close;
    $('[data-nmgo]', m.el).onclick = async (e) => {
      const v = BB.formValues(f); const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Sending to Meta…';
      try {
        const r = await BB.post('/api/campaigns/new-message', { ...(a.filters ? { filters: a.filters } : a.ids ? { ids: a.ids } : { segments: a.segments }), text: v.text, job_id: v.job_id || null, buttons: f.buttons.checked, name: v.name });
        m.close(); BB.modal({ title: r.status === 'APPROVED' ? 'Approved and sending' : 'Sent to Meta for approval', body: `<p>Template <span class="mono">${esc(r.template)}</span> for <b>${r.total}</b> people (${esc(r.audience)}).</p><p class="small muted">${r.status === 'APPROVED' ? 'It is going out now.' : 'As soon as Meta approves it, the campaign sends by itself and you get a bell alert. The portal checks every 10 minutes. If Meta rejects it, you are told why.'}</p>` });
      } catch (er) { BB.fail(er); btn.disabled = false; btn.textContent = 'Send for approval'; }
    };
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
    const qs = aud.filters ? `filters=${encodeURIComponent(JSON.stringify(aud.filters))}` : aud.ids ? `ids=${encodeURIComponent(aud.ids.join(','))}` : `segments=${encodeURIComponent((aud.segments || [aud.segment]).join(','))}`;
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
  // What a template is for, from its name and text (for the Use case filter).
  const USES = [['Interviews', /interview|round|slot|reschedul/i], ['Job alerts and interest', /job_alert|job_interest|opening|still_looking|interested/i], ['Resume and details', /resume|profile|details|experience|contact_pref/i], ['Offers and joining', /offer|joining|joined|check.?in|document/i], ['Reminders', /reminder|follow/i], ['Clients', /client|shortlist|feedback|jd_|requirement|agreement/i], ['Payments and bills', /bill|payment|invoice|payout/i], ['Login and account', /login|code|otp|password|welcome|account/i], ['Agents and partners', /agent|partner|vendor|tie.?up/i]];
  const useOf = (t) => { const hay = `${t.name} ${t.body || ''}`; const hit = USES.find(([, re]) => re.test(hay)); return hit ? hit[0] : 'Other'; };
  const btnKind = (t) => { const k = new Set((t.buttons || []).map((b) => (b.url ? 'link' : b.phone ? 'call' : 'quick'))); return k.size ? [...k] : ['none']; };
  S.templates = async (el, actions, q = {}) => {
    const d = await BB.api('/api/studio/wa/templates');
    actions.innerHTML = `<button class="btn" data-tsync>Refresh from Meta</button>${S.newTemplate ? '<button class="btn primary" data-tnew>+ New template</button>' : ''}`;
    $('[data-tsync]', actions).onclick = async () => { try { const r = await BB.post('/api/studio/wa/sync'); BB.toast(`${r.count} templates read from Meta`); BB.refreshPage(); } catch (e) { BB.fail(e); } };
    if ($('[data-tnew]', actions)) $('[data-tnew]', actions).onclick = () => S.newTemplate();
    el.innerHTML = `${d.note ? `<div class="notice" style="margin-bottom:12px">${esc(d.note)}</div>` : ''}${(() => { const list = d.templates; const uniq = (fn) => [...new Set(list.map(fn).filter(Boolean))].sort(); const sel = (k, label, opts) => `<select data-tf="${k}" aria-label="${label}"><option value="">${label}</option>${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${q[k] === v ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`; return `<div class="filters tpl-filters"><input data-tq placeholder="Search name or text…" value="${esc(q.tq || '')}" aria-label="Search templates">${sel('tst', 'Any status', uniq((t) => t.status))}${sel('tcat', 'Any category', uniq((t) => String(t.category || '').toLowerCase()))}${sel('tuse', 'Any use case', [...USES.map((u) => u[0]), 'Other'])}${sel('tlang', 'Any language', uniq((t) => t.language))}${sel('thead', 'Any header', [['none', 'No header'], ['text', 'Text'], ['image', 'Image'], ['video', 'Video'], ['document', 'PDF']])}${sel('tbtn', 'Any buttons', [['none', 'No buttons'], ['quick', 'Quick reply'], ['link', 'Link'], ['call', 'Call']])}</div>`; })()}
      <div class="card">${BB.table([{ t: 'Template', f: (t) => `<b>${esc(t.name)}</b><div class="tiny muted">${esc(t.language)}${t.source === 'portal' ? ' · made here' : ''}</div>` }, { t: 'Category', f: (t) => esc(String(t.category || '').toLowerCase()) }, { t: 'Status', f: (t) => `${statusBadge(t.status)}${t.error ? `<div class="tiny muted">${esc(t.error)}</div>` : ''}` }, { t: 'Header', f: (t) => (t.header ? esc(t.header.format === 'DOCUMENT' ? 'PDF' : t.header.format.toLowerCase()) : '—') }, { t: 'Text', f: (t) => `<div class="small st-clip">${esc(t.body)}</div>` }, { t: 'Buttons', f: (t) => `<span class="small">${esc(btnLine(t)) || '—'}</span>` }], d.templates.filter((t) => (!q.tq || `${t.name} ${t.body || ''}`.toLowerCase().includes(String(q.tq).toLowerCase())) && (!q.tst || t.status === q.tst) && (!q.tcat || String(t.category || '').toLowerCase() === q.tcat) && (!q.tuse || useOf(t) === q.tuse) && (!q.tlang || t.language === q.tlang) && (!q.thead || (q.thead === 'none' ? !t.header : t.header && String(t.header.format).toLowerCase() === q.thead)) && (!q.tbtn || btnKind(t).includes(q.tbtn))).map((t) => ({ ...t, id: t.key })), { open: (t) => `watpl:${encodeURIComponent(t.key)}`, empty: d.templates.length ? 'No template matches these filters.' : 'No templates read yet. Press Refresh from Meta.' })}</div>`;
    $$('[data-tf]', el).forEach((x) => (x.onchange = () => BB.setQ({ [x.dataset.tf]: x.value })));
    { let tt; const tq = $('[data-tq]', el); if (tq) tq.oninput = () => { clearTimeout(tt); tt = setTimeout(() => BB.setQ({ tq: tq.value }), 350); }; }
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
    const st = { name: dr.name || '', category: dr.category || 'MARKETING', language: dr.language || 'en', header_type: dr.header_type || 'NONE', header_text: dr.header_text || '', header_example: dr.header_example || '', media: dr.media_key ? { key: dr.media_key, name: 'Sample file', url: `/api/public/studio-media/${dr.media_key}` } : null, body: dr.body || '', examples: dr.examples || [], footer: dr.footer || '', button_kind: dr.button_kind || 'none', buttons: dr.buttons || [], also: ['en', 'hi', 'gu', 'mr'].filter((l) => l !== (dr.language || 'en')) };
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
      ${!from ? `<div class="field"><span class="lab">Also make it in</span><div class="row" style="gap:14px">${[['en', 'English'], ['hi', 'Hindi'], ['gu', 'Gujarati'], ['mr', 'Marathi']].filter(([k]) => k !== st.language).map(([k, l]) => `<label class="row small" style="gap:6px"><input type="checkbox" data-also="${k}" ${st.also.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div><div class="faint tiny">Same name, translated by AI with the blanks kept. Each language goes to Meta for approval.</div></div>` : ''}
      <div class="field" data-f="header_text"><span class="lab">Header</span><div class="row">${sel('header_type', [['NONE', 'None'], ['TEXT', 'Text'], ['IMAGE', 'Image'], ['VIDEO', 'Video'], ['DOCUMENT', 'PDF']], st.header_type)}${st.header_type === 'TEXT' ? `${inp('header_text', st.header_text, 'Up to 60 letters; {{1}} for one blank', 'maxlength="60" style="flex:1"')}` : ''}${['IMAGE', 'VIDEO', 'DOCUMENT'].includes(st.header_type) ? `<button type="button" class="btn sm" data-tup>${st.media ? 'Change sample' : 'Upload sample'}</button><span class="small muted">${st.media ? esc(st.media.name) : 'Meta reviews with a sample; each campaign can use its own file'}</span>` : ''}</div>${st.header_type === 'TEXT' && /\{\{1\}\}/.test(st.header_text) ? `<div style="margin-top:6px">${inp('header_example', st.header_example, 'Sample for the header blank')}</div>` : ''}</div>
      <label class="field" data-f="body"><span class="lab">Message</span><textarea data-k="body" rows="5" maxlength="1024" placeholder="Hello {{1}}, we have a {{2}} opening in {{3}}. Reply Interested to know more.">${esc(st.body)}</textarea><div class="row" style="margin-top:4px"><button type="button" class="btn sm ghost" data-blank>+ Add blank</button><span class="faint tiny">*bold*  _italic_ · ${st.body.length}/1024</span></div></label>
      ${blanks().length ? `<div class="field" data-f="examples"><span class="lab">Example values</span><div class="grid g3">${blanks().map((n, i) => `<input data-ex="${i}" value="${esc(st.examples[i] || '')}" placeholder="{{${n}}} e.g. ${['Priya', 'Sales Executive', 'Mumbai'][i] || 'sample'}">`).join('')}</div></div>` : ''}
      <label class="field" data-f="footer"><span class="lab">Footer <span class="opt">(optional)</span></span>${inp('footer', st.footer, 'e.g. Reply STOP to stop these messages', 'maxlength="60"')}</label>
      <div class="field" data-f="buttons"><span class="lab">Buttons</span>${sel('button_kind', [['none', 'None'], ['quick', 'Quick replies (up to 3)'], ['cta', 'Link and call (up to 2)']], st.button_kind)}<div class="stack-sm" style="margin-top:6px">${btnRows()}</div></div>`;
    const sample = (t) => t.replace(/\{\{(\d+)\}\}/g, (m, n) => st.examples[blanks().indexOf(n)] || m);
    const prev = () => S.phone({ header: st.header_type === 'NONE' ? null : { format: st.header_type, text: st.header_type === 'TEXT' ? st.header_text.replace('{{1}}', st.header_example || '{{1}}') : '' }, text: sample(st.body), footer: st.footer, buttons: st.button_kind === 'none' ? [] : st.buttons.filter((b) => b.text), media: st.media });
    const m = BB.modal({ title: from ? `Template · ${esc(from.name)}` : 'New WhatsApp template', wide: true,
      body: `${from && from.error ? `<div class="notice" style="margin-bottom:12px"><div class="small">Last try: ${esc(from.error)}</div></div>` : ''}<div class="st-grid"><form class="stack" data-tf onsubmit="return false"></form><div><div class="tiny muted" style="margin-bottom:6px">Preview (with the samples)</div><div data-tprev></div></div></div>`,
      foot: `${from && ['DRAFT', 'NOT SENT'].includes(from.status) ? '<button class="btn ghost" data-tdel style="margin-right:auto">Remove draft</button>' : ''}<button class="btn" data-tsave>Save draft</button><button class="btn primary" data-tsub>Send to Meta</button>` }).el;
    const draw = () => {
      const f = $('[data-tf]', m); f.innerHTML = formHtml(); $('[data-tprev]', m).innerHTML = prev();
      const redraw = ['header_type', 'button_kind', 'header_text', 'body'];
      $$('[data-k]', f).forEach((i) => { i.oninput = i.onchange = (e) => { st[i.dataset.k] = i.value; if (i.dataset.k === 'button_kind') st.buttons = []; if (e.type === 'change' && redraw.includes(i.dataset.k)) draw(); else $('[data-tprev]', m).innerHTML = prev(); }; });
      $$('[data-also]', f).forEach((i) => (i.onchange = () => { st.also = $$('[data-also]:checked', f).map((x) => x.dataset.also); }));
      $$('[data-ex]', f).forEach((i) => (i.oninput = () => { st.examples[+i.dataset.ex] = i.value; $('[data-tprev]', m).innerHTML = prev(); }));
      $$('[data-b]', f).forEach((i) => { i.oninput = i.onchange = (e) => { st.buttons[+i.dataset.b][i.dataset.bk] = i.value; if (e.type === 'change' && i.dataset.bk !== 'text') draw(); else $('[data-tprev]', m).innerHTML = prev(); }; });
      $('[data-blank]', f).onclick = () => { const ta = $('[data-k=body]', f); const n = blanks().length + 1; const pos = ta.selectionStart ?? st.body.length; st.body = `${st.body.slice(0, pos)}{{${n}}}${st.body.slice(pos)}`; draw(); };
      const up = $('[data-tup]', f); if (up) up.onclick = async () => { const r = await S.upload(st.header_type === 'IMAGE' ? '.jpg,.jpeg,.png' : st.header_type === 'VIDEO' ? '.mp4' : '.pdf'); if (r) { st.media = r; draw(); } };
    };
    draw();
    const save = async (submit) => {
      const btns = $$('.modal-f .btn', m); btns.forEach((b) => (b.disabled = true));
      try {
        const r = await BB.post('/api/studio/wa/templates', { ...st, media_key: st.media && st.media.key, examples: blanks().map((_, i) => st.examples[i] || ''), key: from ? from.key : undefined, submit, also: from ? [] : st.also.filter((l) => l !== st.language) });
        m.closest('.modal-back').remove(); const LN = { en: 'English', hi: 'Hindi', gu: 'Gujarati', mr: 'Marathi' }; const more = (r.also || []).map((x) => `${LN[x.language] || x.language}: ${x.error ? `not sent (${x.error})` : x.status === 'DRAFT' ? 'draft' : 'sent'}`);
        BB.toast(`${submit ? (r.error ? `Not sent: ${r.error}` : `Sent to Meta: ${r.status === 'APPROVED' ? 'approved' : 'waiting for review'}`) : 'Draft saved'}${more.length ? ` · ${more.join(' · ')}` : ''}`, (r.also || []).some((x) => x.error) || !!r.error); BB.go('team/campaigns?tab=templates');
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
    if (!d.rows.length) { el.innerHTML = '<div class="card pad empty-cta"><h3 style="margin:0 0 6px">No email designs yet</h3><p class="small muted" style="margin:0 0 12px">Make a designed email once, then send it to any segment from a campaign.</p><button class="btn primary" data-dnew2>+ New design</button></div>'; $('[data-dnew2]', el).onclick = () => S.designer(null); return; }
    const used = (x) => (d.used || {})[x.id] || 0;
    el.innerHTML = `<div class="card">${BB.table([{ t: 'Design', f: (x) => `<b>${esc(x.name)}</b>` }, { t: 'Subject', f: (x) => (x.subject ? esc(x.subject) : '<span class="faint">No subject yet</span>') }, { t: 'Sent in', num: 1, f: (x) => (used(x) ? `${used(x)} campaign${used(x) === 1 ? '' : 's'}` : '<span class="faint">Not sent yet</span>') }, { t: 'Last changed', f: (x) => `${fmtD(x.updated_at || x.at)}<div class="tiny muted">${esc(x.updated_by || x.by)}</div>` }, { t: '', f: (x) => `<span class="nowrap"><button class="btn sm" data-dedit="${x.id}">Edit</button> <button class="btn sm primary" data-dsend="${x.id}">Send</button></span>` }], d.rows, { empty: '' })}</div>`;
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
    const qs = aud.filters ? `filters=${encodeURIComponent(JSON.stringify(aud.filters))}` : aud.ids ? `ids=${encodeURIComponent(aud.ids.join(','))}` : `segments=${encodeURIComponent((aud.segments || [aud.segment]).join(','))}`;
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

  // ---------- Meta ads (Facebook, Instagram, click to WhatsApp) ----------
  const inr = (n) => BB.inr(Math.round(n || 0));
  const AD_ST = { ACTIVE: 'b-green', PAUSED: 'b-outline', FAILED: 'b-red', MAKING: 'b-amber' };
  S.ads = async (el, actions) => {
    el.innerHTML = '<div class="empty">Checking the Meta connection…</div>';
    const [st, d] = await Promise.all([BB.api('/api/ads/meta/status'), BB.api('/api/ads/meta')]);
    actions.innerHTML = `<button class="btn" data-afresh title="${d.live_at ? `Numbers from ${BB.fmtDT ? BB.fmtDT(d.live_at) : d.live_at}` : ''}">Refresh from Meta</button>${BB.me.user.level === 'super' ? `<button class="btn primary" data-anew ${st.ready ? '' : 'disabled title="Finish the Meta setup first"'}>+ New ad</button>` : ''}`;
    if (BB.me.user.level !== 'super') el.classList.add('ads-view-only');
    $('[data-afresh]', actions).onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Refreshing…'; try { await Promise.all([BB.api('/api/ads/meta/status?fresh=1'), BB.api('/api/ads/meta?fresh=1')]); } catch (er) { BB.fail(er); } BB.refreshPage(); };
    const setup = !st.connected ? `<div class="notice">${esc(st.note)}</div>`
      : st.ready ? ''
      : `<div class="card pad stack-sm"><h3 style="margin:0">Meta setup needed before ads can be made here</h3>
        ${st.account ? `<div class="small">Ad account: <b>${esc(st.account.name)}</b>${st.account.active ? '' : ' <span class="badge b-red tiny">not active</span>'}</div>` : `<div class="small">Ad account not readable${st.account_error ? `: ${esc(st.account_error)}` : ''}</div>`}
        <div class="small">The token has: ${(st.scopes || []).map((x) => `<span class="badge b-outline tiny">${esc(x)}</span>`).join(' ') || 'nothing readable'}</div>
        ${st.missing.length ? `<div class="small"><b>Give the system user these permissions</b> (Business settings › Users › System users › the user › Generate new token, tick them, then put the new token in the server .env as META_ADS_TOKEN):<ul style="margin:4px 0 0 18px">${st.missing.map((x) => `<li><b>${esc(x.scope)}</b>: ${esc(x.why)}</li>`).join('')}</ul></div>` : ''}
        ${!st.pages.length ? '<div class="small"><b>Assign the Facebook Page</b> to the same system user (Business settings › Users › System users › Assign assets › Pages, with "Create ads").</div>' : ''}
        ${st.optional_missing.length ? `<div class="tiny muted">Also useful: ${st.optional_missing.map((x) => `${esc(x.scope)} (${esc(x.why)})`).join('; ')}.</div>` : ''}
        <div class="tiny muted">Click-to-WhatsApp ads also need the WhatsApp number linked to the Page (Page settings › Linked accounts › WhatsApp).</div></div>`;
    el.innerHTML = `${setup}<div class="card" style="margin-top:12px">${BB.table([
      { t: 'Ad', f: (a) => `<b>${esc(a.name)}</b><div class="tiny muted">${a.goal === 'whatsapp' ? 'Chat on WhatsApp' : 'Apply on the website'} · ${a.platforms.map((p) => (p === 'facebook' ? 'Facebook' : 'Instagram')).join(', ')}</div>${a.error ? `<div class="tiny" style="color:var(--red,#B42318)">${esc(a.error)}</div>` : ''}` },
      { t: 'Status', f: (a) => `<span class="badge tiny ${AD_ST[a.status] || 'b-outline'}">${esc(a.status === 'ACTIVE' ? 'On' : a.status === 'PAUSED' ? 'Paused' : a.status === 'FAILED' ? 'Not made' : 'Making')}</span>${a.effective && a.effective !== a.status ? `<div class="tiny muted">${esc(a.effective.toLowerCase().replace(/_/g, ' '))}</div>` : ''}` },
      { t: 'Budget', num: 1, f: (a) => `${inr(a.daily_budget)}/day<div class="tiny muted">${fmtD(a.start_at)}${a.end_at ? ` – ${fmtD(a.end_at)}` : ''}</div>` },
      { t: 'Spent', num: 1, f: (a) => (a.spend !== undefined ? inr(a.spend) : '—') },
      { t: 'Reach', num: 1, f: (a) => (a.impressions !== undefined ? `${a.impressions} seen<div class="tiny muted">${a.clicks} clicks${a.goal === 'whatsapp' ? ` · ${a.chats} chats` : ''}</div>` : '—') },
      { t: 'Applied', num: 1, f: (a) => (a.applied === null ? '—' : a.applied) },
      { t: '', f: (a) => (a.status === 'PAUSED' ? `<button class="btn sm primary" data-aon="${a.id}">Turn on</button>` : a.status === 'ACTIVE' ? `<button class="btn sm" data-aoff="${a.id}">Pause</button>` : '') }], d.rows, { empty: 'No ads made here yet.' })}</div>`;
    const flip = (id, status) => async () => { if (status === 'ACTIVE' && !(await BB.confirm('Turn this ad on?', 'Meta starts spending the daily budget once it approves the ad.', 'Turn on'))) return; try { await BB.post(`/api/ads/meta/${id}/status`, { status }); BB.toast(status === 'ACTIVE' ? 'Ad turned on' : 'Ad paused'); BB.refreshPage(); } catch (e) { BB.fail(e); } };
    $$('[data-aon]', el).forEach((b) => (b.onclick = flip(b.dataset.aon, 'ACTIVE'))); $$('[data-aoff]', el).forEach((b) => (b.onclick = flip(b.dataset.aoff, 'PAUSED')));
    const nb = $('[data-anew]', actions); if (nb && st.ready) nb.onclick = () => S.newAd(st, d);
  };
  S.newAd = async (st, d) => {
    const s = { goal: 'apply', job: '', platforms: ['facebook', 'instagram'], page: st.pages[0].id, ig: (st.instagram[0] || {}).id || '', cities: [], radius: 25, employment: true, age_min: 18, age_max: 65, budget: 500, start: '', end: '', text: '', headline: '', desc: '', cta: 'apply', image: null, video: null, name: '' };
    const m = BB.modal({ title: 'New Meta ad', wide: true, body: '<div class="notice" style="margin-bottom:12px">The ad is made paused. Nothing is spent until you press Turn on.</div><div class="st-grid"><form class="stack" data-af onsubmit="return false"></form><div><div class="tiny muted" style="margin-bottom:6px">Preview</div><div data-aprev></div></div></div>', foot: '<button class="btn" data-acancel>Cancel</button><button class="btn primary" data-amake>Make the ad (paused)</button>' }).el;
    const jobOf = () => d.jobs.find(([id]) => id === s.job);
    const prev = () => { $('[data-aprev]', m).innerHTML = `<div class="st-ad"><div class="st-ad-h"><b>${esc((st.pages.find((p) => p.id === s.page) || {}).name || 'Page')}</b><span class="tiny muted">Sponsored</span></div><div class="st-ad-t">${esc(s.text || 'Your ad text').replace(/\n/g, '<br>')}</div><div class="st-media" style="height:180px;border-radius:0;margin:0">${s.image ? `<img src="${esc(s.image.url)}" alt="">` : '<span class="small">Ad picture</span>'}</div><div class="st-ad-f"><div class="grow"><div class="tiny muted">${s.goal === 'whatsapp' ? 'WHATSAPP' : esc(location.host.toUpperCase())}</div><b class="small">${esc(s.headline || (jobOf() ? jobOf()[1].split(' · ')[0] : 'Headline'))}</b></div><span class="btn sm">${s.goal === 'whatsapp' ? 'Send message' : { apply: 'Apply now', learn: 'Learn more', signup: 'Sign up' }[s.cta]}</span></div></div>`; };
    const chk = (k, v, l) => `<label class="row small"><input type="checkbox" data-plat="${v}" ${s.platforms.includes(v) ? 'checked' : ''}> ${l}</label>`;
    const draw = () => {
      const f = $('[data-af]', m);
      f.innerHTML = `${BB.field({ name: 'goal', label: 'What should people do', type: 'choice', options: [['apply', 'Apply on the website'], ['whatsapp', 'Chat on WhatsApp']], value: s.goal })}
        ${BB.field({ name: 'job', label: s.goal === 'apply' ? 'Job opening' : 'Job opening (optional, for the name and to count applicants)', type: 'select', options: d.jobs, value: s.job, opt: s.goal !== 'apply' })}
        <div class="grid g2"><div class="field" data-f="platforms"><span class="lab">Where</span><div class="row">${chk('p', 'facebook', 'Facebook')}${chk('p', 'instagram', 'Instagram')}</div></div>${BB.field({ name: 'page', label: 'Facebook Page', type: 'select', options: st.pages.map((p) => [p.id, p.name]), value: s.page, placeholder: false })}</div>
        ${s.platforms.includes('instagram') && st.instagram.length ? BB.field({ name: 'ig', label: 'Instagram account', type: 'select', options: st.instagram.map((x) => [x.id, x.name]), value: s.ig, placeholder: 'Use the Page' }) : ''}
        <div class="field" data-f="cities"><span class="lab">Cities</span><div class="row"><input data-cityq placeholder="Type a city" style="flex:1"><button type="button" class="btn sm" data-cityfind>Find</button></div><div class="row" data-cityhits style="margin-top:4px"></div><div class="row" style="margin-top:4px">${s.cities.map((x, i) => `<span class="badge b-outline">${esc(x.name)}${x.region ? `, ${esc(x.region)}` : ''} <button type="button" class="link-sm" data-cityx="${i}" aria-label="Remove">×</button></span>`).join(' ')}</div></div>
        <div class="grid g3">${BB.field({ name: 'radius', label: 'Around each city (km)', type: 'number', value: s.radius, voice: false })}${BB.field({ name: 'age_min', label: 'Age from', type: 'number', value: s.age_min, voice: false, attrs: s.employment ? 'disabled' : '' })}${BB.field({ name: 'age_max', label: 'Age to', type: 'number', value: s.age_max, voice: false, attrs: s.employment ? 'disabled' : '' })}</div>
        ${BB.field({ name: 'employment', label: 'Job ad (Meta\'s Employment category: everyone 18 to 65, no gender choice, at least 25 km). Keep this on for job ads.', type: 'check', value: s.employment })}
        <div class="grid g3">${BB.field({ name: 'budget', label: 'Daily budget (₹)', type: 'number', value: s.budget, voice: false })}${BB.field({ name: 'start', label: 'Start', type: 'date', value: s.start, opt: true, voice: false })}${BB.field({ name: 'end', label: 'End', type: 'date', value: s.end, opt: true, voice: false })}</div>
        <div class="field" data-f="image"><span class="lab">Picture</span><div class="row"><button type="button" class="btn sm" data-aimg>${s.image ? 'Change picture' : 'Upload picture'}</button><span class="small muted">${s.image ? esc(s.image.name) : 'JPG or PNG, 1080 × 1080 works everywhere'}</span></div></div>
        <div class="field" data-f="video"><span class="lab">Video <span class="opt">(optional; the picture becomes its cover)</span></span><div class="row"><button type="button" class="btn sm" data-avid>${s.video ? 'Change video' : 'Upload video'}</button><span class="small muted">${s.video ? esc(s.video.name) : 'MP4 up to 16 MB'}</span>${s.video ? '<button type="button" class="btn sm ghost" data-avidx>Remove</button>' : ''}</div></div>
        ${BB.field({ name: 'text', label: 'Ad text', type: 'textarea', value: s.text, placeholder: 'e.g. Jewellery showroom in Mumbai hiring Sales Executives. 2+ years in jewellery sales. Apply in one minute.' })}
        <div class="grid g2">${BB.field({ name: 'headline', label: 'Headline', opt: true, value: s.headline })}${BB.field({ name: 'desc', label: 'Description', opt: true, value: s.desc })}</div>
        ${s.goal === 'apply' ? BB.field({ name: 'cta', label: 'Button', type: 'select', options: [['apply', 'Apply now'], ['learn', 'Learn more'], ['signup', 'Sign up']], value: s.cta, placeholder: false }) : ''}
        ${BB.field({ name: 'name', label: 'Ad name', opt: true, value: s.name, voice: false })}`;
      $$('input[name],select[name],textarea[name]', f).forEach((i) => { i.oninput = i.onchange = (e) => { s[i.name] = i.type === 'checkbox' ? i.checked : i.type === 'radio' ? (i.checked ? i.value : s[i.name]) : i.value; if (e.type === 'change' && ['goal', 'employment'].includes(i.name)) draw(); else prev(); }; });
      $$('[data-plat]', f).forEach((i) => (i.onchange = () => { s.platforms = $$('[data-plat]:checked', f).map((x) => x.dataset.plat); draw(); }));
      const find = async () => { const q = $('[data-cityq]', f).value.trim(); if (q.length < 2) return; try { const r = await BB.api(`/api/ads/meta/geo?q=${encodeURIComponent(q)}`); $('[data-cityhits]', f).innerHTML = r.rows.map((x, i) => `<button type="button" class="btn sm ghost" data-cityadd="${i}">${esc(x.name)}${x.region ? `, ${esc(x.region)}` : ''}</button>`).join('') || '<span class="small muted">No city found</span>'; $$('[data-cityadd]', f).forEach((b) => (b.onclick = () => { const x = r.rows[+b.dataset.cityadd]; if (!s.cities.some((y) => y.key === x.key)) s.cities.push(x); draw(); })); } catch (e) { BB.fail(e); } };
      $('[data-cityfind]', f).onclick = find; $('[data-cityq]', f).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } };
      $$('[data-cityx]', f).forEach((b) => (b.onclick = () => { s.cities.splice(+b.dataset.cityx, 1); draw(); }));
      $('[data-aimg]', f).onclick = async () => { const r = await S.upload('.jpg,.jpeg,.png'); if (r) { s.image = r; draw(); } };
      $('[data-avid]', f).onclick = async () => { const r = await S.upload('.mp4'); if (r) { s.video = r; draw(); } };
      const vx = $('[data-avidx]', f); if (vx) vx.onclick = () => { s.video = null; draw(); };
      prev();
    };
    draw();
    $('[data-acancel]', m).onclick = () => m.closest('.modal-back').remove();
    $('[data-amake]', m).onclick = async () => {
      const btn = $('[data-amake]', m); btn.disabled = true;
      try {
        await BB.post('/api/ads/meta', { goal: s.goal, job_id: s.job || undefined, platforms: s.platforms, page_id: s.page, ig_id: s.ig || undefined, cities: s.cities, radius_km: s.radius, employment: s.employment, age_min: s.age_min, age_max: s.age_max, daily_budget: s.budget, start: s.start || undefined, end: s.end || undefined, primary_text: s.text, headline: s.headline, description: s.desc, cta: s.cta, image_key: s.image && s.image.key, video_key: s.video && s.video.key, name: s.name });
        m.closest('.modal-back').remove(); BB.toast('Ad made, paused. Press Turn on to start.'); BB.refreshPage();
      } catch (e) { BB.showErr(m, e); if (BB.refreshPage) BB.refreshPage(); } finally { btn.disabled = false; }
    };
  };

})();
