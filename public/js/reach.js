/* Digital Reach: what the social media person does for each job. A work list of jobs with the next action,
   one job's creative and channels in a side panel, and a view by channel. */
(() => {
  const { $, $$, esc, fmtD, fmtDT } = BB;
  const STATUS = [['Pending', 'To do'], ['Done', 'Done'], ['Not needed', 'Not needed']];
  const SHARED = ['All BBHS Team', 'Tech Team', 'To be decided'];
  const limited = () => !!BB.me.user.channel_only;
  const refresh = () => { BB.refreshPanel && BB.refreshPanel(); BB.refreshPage && BB.refreshPage(); };
  const say = async (fn, msg) => { try { await fn(); if (msg) BB.toast(msg); refresh(); } catch (e) { BB.fail(e); } };
  const setStatus = (job_id, ckey, status, post_link) => BB.post('/api/postings/tracker', { job_id, ckey, status, ...(post_link !== undefined ? { post_link } : {}) });

  const counted = (rows) => { const needed = rows.filter((s) => s !== 'Not needed').length; return { done: rows.filter((s) => s === 'Done').length, needed, left: rows.filter((s) => !s || s === 'Pending').length }; };
  const bar = (done, total) => `<div class="rs-bar" role="img" aria-label="${done} of ${total} done"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>`;
  const nextStep = (cr, left) => {
    const st = cr && cr.status;
    if (!st) return 'Share the creative brief';
    if (st === 'Brief shared') return 'Get the creative made';
    if (st === 'With designer') return 'Send the creative for approval';
    if (st === 'Sent for approval') return limited() ? 'Waiting for approval' : 'Approve the creative';
    if (left) return `Post on ${left} channel${left === 1 ? '' : 's'}`;
    return st === 'Posted' ? 'All done' : 'Mark the creative posted';
  };
  const stepper = (steps, cur, click) => { const at = steps.indexOf(cur); return `<div class="rs-steps">${steps.map((s, i) => { const locked = s === 'Approved' && limited(); const inner = `<span class="rs-dot">${i <= at ? '✓' : i + 1}</span><span class="rs-lab">${esc(s)}</span>`; return click && !locked ? `<button type="button" class="rs-step ${i <= at ? 'done' : ''} ${i === at ? 'cur' : ''}" data-rstep="${esc(s)}">${inner}</button>` : `<div class="rs-step ${i <= at ? 'done' : ''} ${i === at ? 'cur' : ''}">${inner}</div>`; }).join('')}</div>`; };
  const ownerPick = (c, people) => { const p = people.find((u) => u.id === c.owner_id) || people.find((u) => u.name === c.owner); const other = !p && !SHARED.includes(c.owner); return `<select class="rs-own" data-rown="${esc(c.key || c.ckey)}" aria-label="Owner of ${esc(c.channel)}">${!p ? `<option value="" selected disabled>${c.owner ? `${esc(c.owner)} · pick a person` : 'Pick a person'}</option>` : ''}${people.map((u) => `<option value="u:${u.id}" ${p && p.id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`; };
  const wireOwners = (el) => $$('[data-rown]', el).forEach((x) => (x.onchange = () => { const v = x.value; if (!v) return; say(() => BB.post('/api/channels/owner', v.startsWith('u:') ? { key: x.dataset.rown, owner_id: v.slice(2) } : { key: x.dataset.rown, owner: v.slice(2) }), 'Owner saved'); }));
  const statusSeg = (attr, st) => `<div class="rs-seg" role="group" aria-label="Status">${STATUS.map(([v, l]) => `<button type="button" class="${st === v ? `on s-${v === 'Not needed' ? 'na' : v.toLowerCase()}` : ''}" ${attr}="${esc(v)}">${l}</button>`).join('')}</div>`;

  // ---------- automatic posts: Facebook, Instagram, LinkedIn ----------
  const SOC = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn']];
  const SOC_BADGE = { Scheduled: 'b-gold', Posting: 'b-primary', Posted: 'b-green', Failed: 'b-red', Cancelled: 'b-outline' };
  const isAdm = () => ['super', 'admin'].includes(BB.me.user.level);
  const connChips = (st) => `<div class="soc-conn">${SOC.map(([k, l]) => { const x = st[k] || {}; return `<span class="soc-chip ${x.ready ? 'ok' : 'no'}" title="${esc(x.ready ? '' : x.why || '')}"><b>${l}</b> ${x.ready ? esc(x.name || 'connected') : 'not connected'}</span>`; }).join('')}${st.linkedin && !st.linkedin.ready && st.linkedin.can_connect && isAdm() ? '<button type="button" class="btn sm" data-liconn>Connect LinkedIn</button>' : ''}${st.linkedin && st.linkedin.ready && isAdm() ? '<button type="button" class="btn-link tiny" data-liconn>Reconnect LinkedIn</button>' : ''}</div>`;
  const wireConn = (el) => { const b = $('[data-liconn]', el); if (b) b.onclick = async () => { try { const r = await BB.post('/api/social/linkedin/connect'); location.href = r.url; } catch (e) { BB.fail(e); } }; };
  const postLine = (p, withJob) => `<div class="soc-post"><span class="badge b-outline tiny">${esc(p.label)}</span><span class="badge ${SOC_BADGE[p.status] || 'b-outline'} tiny">${esc(p.status)}</span>${withJob ? `<a href="#" data-open="reach:${esc(p.job_id)}" class="small"><b>${esc(p.title || p.job_id)}</b>${p.city ? `, ${esc(p.city)}` : ''}</a>` : ''}<span class="small muted">${p.status === 'Posted' ? 'posted ' : p.status === 'Scheduled' ? 'for ' : ''}${fmtDT(p.posted_at || p.run_at)} · ${esc(p.by || '')}</span><span class="grow"></span>${p.url ? `<a class="small" href="${esc(p.url)}" target="_blank" rel="noopener">see post ↗</a>` : ''}${p.status === 'Scheduled' ? `<button type="button" class="btn-link tiny" data-scancel="${p.id}">Cancel</button>` : ''}${p.status === 'Failed' ? `<button type="button" class="btn sm" data-sretry="${p.id}">Try again</button>` : ''}${p.error && p.status === 'Failed' ? `<div class="tiny soc-err">${esc(p.error)}</div>` : ''}</div>`;
  const wirePostActs = (el, after) => {
    $$('[data-scancel]', el).forEach((b) => (b.onclick = async () => { try { await BB.post(`/api/social/posts/${b.dataset.scancel}/cancel`); BB.toast('Cancelled'); after(); } catch (e) { BB.fail(e); } }));
    $$('[data-sretry]', el).forEach((b) => (b.onclick = async () => { b.disabled = true; b.textContent = 'Posting…'; try { const p = await BB.post(`/api/social/posts/${b.dataset.sretry}/retry`); BB.toast(p.status === 'Posted' ? `Posted on ${p.label}` : `Not posted: ${p.error}`, p.status !== 'Posted'); after(); } catch (e) { BB.fail(e); after(); } }));
  };
  // Any image becomes a JPG in Instagram's shape (between 4:5 portrait and 1.91:1 landscape, white edges added), max 1440 px.
  const toPostJpg = (file) => new Promise((resolve, reject) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => { let w = img.naturalWidth; let h = img.naturalHeight; let cw = w; let ch = h; if (w / h < 0.8) cw = Math.round(h * 0.8); else if (w / h > 1.91) ch = Math.round(w / 1.91);
      const k = Math.min(1, 1440 / Math.max(cw, ch)); const c = document.createElement('canvas'); c.width = Math.round(cw * k); c.height = Math.round(ch * k); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, Math.round(((cw - w) / 2) * k), Math.round(((ch - h) / 2) * k), Math.round(w * k), Math.round(h * k)); URL.revokeObjectURL(u); resolve(c.toDataURL('image/jpeg', 0.9)); };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('That file is not an image the browser can open. Use a JPG or PNG.')); };
    img.src = u;
  });
  const localDT = (d) => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 16); };
  // The Post automatically block on one job (filled after the panel opens: Meta is asked who is connected).
  const socialBlock = async (box, id) => {
    let st; let d; try { [st, d] = await Promise.all([BB.api('/api/social/status'), BB.api(`/api/social/job/${id}`)]); } catch (e) { box.innerHTML = `<div class="small muted">${esc(e.message)}</div>`; return; }
    let fmt = 'post'; let useVideo = !!d.video;
    // what each kind needs: a post (text, image for Instagram), a story (image or video, no text), a reel (video and text)
    const FMT = { post: ['Post', 'A normal feed post with the text and image.'], story: ['Story', 'Shows for 24 hours. No text goes with it, so put the job, city and "Apply: link" on the image or video.'], reel: ['Reel', 'A vertical video (MP4, 9:16, 3 to 90 seconds) with the text as its caption.'] };
    const needWhy = (k) => { if (fmt !== 'post' && k === 'linkedin') return 'LinkedIn has no stories or reels'; if (fmt === 'reel' && !d.video) return 'Upload the video first'; if (fmt === 'story' && !d.image && !d.video && !d.story) return 'Upload an image or a video first'; if (fmt === 'post' && k === 'instagram' && !d.image) return 'Instagram needs an image'; return ''; };
    const draw = (text) => {
      const plat = SOC.map(([k, l]) => { const x = st[k] || {}; const need = needWhy(k); const off = !x.ready || !!need; const why = !x.ready ? x.why : need; return `<label class="soc-plat ${off ? 'off' : ''}" title="${esc(why || '')}"><input type="checkbox" data-splat="${k}" ${off ? 'disabled' : 'checked'}> ${l}${why ? `<span class="tiny muted"> · ${esc(why.length > 60 ? 'not connected' : why)}</span>` : ''}</label>`; }).join('');
      box.innerHTML = `${connChips(st)}
        <div class="soc-kind"><span class="small"><b>Post as</b></span><div class="seg">${Object.entries(FMT).map(([k, [l]]) => `<button type="button" data-sfmt="${k}" class="${fmt === k ? 'on' : ''}">${l}</button>`).join('')}</div><span class="tiny muted">${esc(FMT[fmt][1])}</span></div>
        <div class="soc-grid"><div class="soc-img">${d.image ? `<img src="${esc(d.image.url)}" alt="Creative for this job">` : '<div class="soc-noimg small muted">No image yet</div>'}<button type="button" class="btn sm" data-simg>${d.image ? 'Change image' : 'Upload image'}</button>
          ${fmt !== 'post' ? `<div class="soc-vid">${d.video ? `<video src="${esc(d.video.url)}" controls muted playsinline preload="metadata"></video><div class="tiny muted">${esc(d.video.name || 'Video')} · ${(d.video.size / 1048576).toFixed(1)} MB</div>` : '<div class="soc-noimg small muted">No video yet</div>'}<button type="button" class="btn sm" data-svid>${d.video ? 'Change video' : 'Upload video (MP4)'}</button></div>` : ''}
          ${fmt === 'story' && d.image && d.video ? `<div class="soc-use small"><span>Story uses</span><label><input type="radio" name="suse" value="image" ${useVideo ? '' : 'checked'}> Image</label><label><input type="radio" name="suse" value="video" ${useVideo ? 'checked' : ''}> Video</label></div>` : ''}</div>
        <div class="soc-form">${fmt === 'story' ? `<div class="soc-storynote small muted">Stories carry no text. The job, the city and the apply link need to be on the ${useVideo && d.video ? 'video' : 'image'}. Apply link for this job: <span class="mono tiny">${esc(location.origin)}/apply?job=${esc(id)}</span></div><textarea data-stext hidden>${esc(text)}</textarea>` : `<textarea data-stext rows="9" aria-label="Post text">${esc(text)}</textarea><div class="tiny muted">{link} becomes this job's apply link, tagged for each channel.${fmt === 'reel' ? ' In a reel the link shows as text (not clickable).' : ''}</div>`}
          <div class="soc-plats">${plat}</div>
          <div class="soc-go"><button type="button" class="btn primary" data-snow>${fmt === 'post' ? 'Post now' : `Post ${FMT[fmt][0].toLowerCase()} now`}</button><span class="small muted">or</span><input type="datetime-local" data-sat value="${localDT(new Date(Date.now() + 3600000))}" aria-label="Post on"><button type="button" class="btn" data-ssched>Schedule</button></div></div></div>
        <div class="soc-list">${d.posts.length ? d.posts.map((p) => postLine(p)).join('') : '<div class="faint small">No posts yet from the portal.</div>'}</div>`;
      wireConn(box);
      const reload = async () => { const t = $('[data-stext]', box).value; try { d = await BB.api(`/api/social/job/${id}`); } catch (e) { BB.fail(e); } draw(t); };
      wirePostActs(box, reload);
      $$('[data-sfmt]', box).forEach((b) => (b.onclick = () => { fmt = b.dataset.sfmt; draw($('[data-stext]', box).value); }));
      $$('[name=suse]', box).forEach((r) => (r.onchange = () => { useVideo = r.value === 'video'; draw($('[data-stext]', box).value); }));
      const sv = $('[data-svid]', box); if (sv) sv.onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'video/mp4'; i.onchange = async () => { const file = i.files[0]; if (!file) return; if (file.size > 28 * 1048576) return BB.toast('Use a video up to 28 MB (MP4).', true); sv.disabled = true; sv.textContent = 'Uploading…'; try { const base64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); }); await BB.post('/api/social/video', { job_id: id, name: file.name, base64 }); BB.toast('Video saved'); useVideo = true; } catch (e) { BB.fail(e); } reload(); }; i.click(); };
      $('[data-simg]', box).onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const file = i.files[0]; if (!file) return; const b = $('[data-simg]', box); b.disabled = true; b.textContent = 'Uploading…'; try { const base64 = await toPostJpg(file); await BB.post('/api/social/image', { job_id: id, base64 }); BB.toast('Image saved'); } catch (e) { BB.fail(e); } reload(); }; i.click(); };
      const picked = () => $$('[data-splat]:checked', box).map((c) => c.dataset.splat);
      const go = async (btn, at) => {
        const platforms = picked(); if (!platforms.length) return BB.toast('Tick where to post', true);
        btn.disabled = true; const was = btn.textContent; btn.textContent = at ? 'Scheduling…' : fmt === 'post' ? 'Posting…' : 'Posting… (a video can take a minute or two)';
        try {
          const r = await BB.post('/api/social/posts', { job_id: id, platforms, text: $('[data-stext]', box).value, at, format: fmt, use_video: fmt === 'story' ? (useVideo && !!d.video) || !d.image : undefined });
          if (r.posted) { const ok = r.posted.filter((p) => p.status === 'Posted'); const bad = r.posted.filter((p) => p.status !== 'Posted'); BB.toast(bad.length ? `${bad.map((p) => `${p.label}: ${p.error}`).join(' · ')}` : `Posted on ${ok.map((p) => p.label).join(', ')}`, !!bad.length); refresh(); }
          else { BB.toast(r.warn || `Scheduled for ${fmtDT(r.at)}`, !!r.warn); }
        } catch (e) { BB.fail(e); }
        btn.disabled = false; btn.textContent = was; reload();
      };
      $('[data-snow]', box).onclick = (e) => go(e.currentTarget);
      $('[data-ssched]', box).onclick = (e) => { const v = $('[data-sat]', box).value; if (!v) return BB.toast('Pick the date and time', true); go(e.currentTarget, new Date(v).toISOString()); };
    };
    draw(d.text);
  };

  // ---------- one job: its creative and channels ----------
  BB.panels.reach = async (id) => {
    const d = await BB.api(`/api/reach/${id}`); const cr = await BB.api(`/api/creatives/${id}`); const rows = d.rows; const j = d.job;
    const groups = [...new Set(rows.map((r) => r.group))]; const all = counted(rows.map((r) => r.status));
    const mine = BB.me.user.name; const anyMine = rows.some((r) => r.owner === mine);
    const row = (r) => `<div class="rs-row" data-mine="${r.owner === mine ? 1 : 0}"><div class="rs-main"><b>${esc(r.channel)}</b><div class="tiny muted">${esc(r.how || '')}</div>${r.ckey === 'internal-db' && !limited() ? `<button type="button" class="btn sm primary rs-circ" data-rcirc>${r.status === 'Done' ? 'Send again to new matches' : 'Send to matching candidates'}</button>` : ''}</div><div class="rs-acts">${limited() ? `<span class="small muted">${esc(r.owner || '')}</span>` : ownerPick(r, d.people)}${statusSeg(`data-rst="${esc(r.ckey)}" data-v`, r.status)}<button type="button" class="btn sm" data-rcopy="${esc(r.apply_link)}">Copy link</button></div>${r.status === 'Done' ? `<div class="rs-done"><input data-rlink="${esc(r.ckey)}" value="${esc(r.post_link || '')}" placeholder="Paste the post link" aria-label="Post link for ${esc(r.channel)}"><span class="tiny muted">${esc(r.updated_by || r.done_by || '')}${r.updated_at ? `, ${fmtD(r.updated_at)}` : ''}</span></div>` : ''}</div>`;
    return {
      head: `<div class="row"><h2>${esc(j.title)}</h2></div><div class="small muted">${[j.client, j.city, `${j.openings} opening${j.openings === 1 ? '' : 's'}`].filter(Boolean).map(esc).join(' · ')}</div>`,
      body: `<div class="sec"><h3><span>Creative development</span>${cr.at ? `<span class="sec-act small muted">${esc(cr.by || '')}, ${fmtD(cr.at)}</span>` : ''}</h3>${stepper(cr.steps, cr.status, true)}
          <div class="rs-next">Next: <b>${esc(nextStep(cr.status ? cr : null, all.left))}</b></div>
          <div class="row" style="margin:8px 0"><button type="button" class="btn sm primary" data-aimake>✦ Make creatives with AI</button><span class="tiny muted">Square, portrait and story sizes, in the style of earlier creatives</span></div><div data-aigal></div>
          <div class="rs-link"><input data-rclink value="${esc(cr.link || '')}" placeholder="Paste the link to the creative" aria-label="Link to the creative"><button type="button" class="btn sm" data-rcsave>Save link</button>${/^https?:\/\//i.test(cr.link || '') ? `<a class="btn sm" href="${esc(cr.link)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div>
          <details class="rs-brief" open><summary>Creative brief — details pulled from this job</summary><textarea data-rbrief rows="10">${esc(cr.brief || '')}</textarea><div class="row"><button type="button" class="btn sm" data-rbsave>Save brief</button><button type="button" class="btn sm" data-rbcopy>Copy brief</button></div></details></div>
        <div class="sec"><h3><span>Post automatically</span><span class="sec-act small muted">Facebook · Instagram · LinkedIn</span></h3><div data-social><div class="faint small">Checking what is connected…</div></div></div>
        <div class="sec"><h3><span>Channels</span><span class="sec-act"><span class="small muted">${all.done} of ${all.needed} done</span>${anyMine ? '<label class="row small"><input type="checkbox" data-rmine> My channels</label>' : ''}</span></h3>${bar(all.done, all.needed)}
          ${groups.map((g) => { const gr = rows.filter((r) => r.group === g); const n = counted(gr.map((r) => r.status)); return `<details class="rs-group" ${n.left ? 'open' : ''}><summary><b>${esc(g)}</b>${n.left && !limited() ? `<button type="button" class="btn-link tiny" data-rgna="${esc(g)}" title="Every channel in ${esc(g)} still to do becomes Not needed">Skip the ${n.left} left</button>` : ''}<span class="small muted">${n.done} of ${n.needed} done</span><span class="ci-chev" aria-hidden="true"></span></summary>${gr.map(row).join('')}</details>`; }).join('')}</div>
        ${limited() ? '' : `<div class="row"><button class="btn sm" data-open="job:${j.id}">Open the job</button></div>`}`,
      mount: (el) => {
        $$('[data-rstep]', el).forEach((b) => (b.onclick = () => say(() => BB.post('/api/creatives', { ids: [id], status: b.dataset.rstep }), 'Saved')));
        $('[data-rcsave]', el).onclick = () => say(() => BB.post('/api/creatives', { ids: [id], status: cr.status || 'Brief shared', link: $('[data-rclink]', el).value.trim() }), 'Link saved');
        $('[data-rbsave]', el).onclick = () => say(() => BB.post('/api/creatives', { ids: [id], status: cr.status || 'Brief shared', brief: $('[data-rbrief]', el).value }), 'Brief saved');
        $('[data-rbcopy]', el).onclick = () => BB.copy($('[data-rbrief]', el).value);
        $$('[data-rst]', el).forEach((b) => (b.onclick = () => { const r = rows.find((x) => x.ckey === b.dataset.rst); say(() => setStatus(id, r.ckey, r.status === b.dataset.v ? '' : b.dataset.v)); }));
        $$('[data-rcopy]', el).forEach((b) => (b.onclick = () => BB.copy(b.dataset.rcopy)));
        $$('[data-rlink]', el).forEach((i) => (i.onchange = () => say(() => setStatus(id, i.dataset.rlink, 'Done', i.value.trim()), 'Link saved')));
        $$('[data-rgna]', el).forEach((b) => (b.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); const left = rows.filter((r) => r.group === b.dataset.rgna && (!r.status || r.status === 'Pending')); say(async () => { for (const r of left) await setStatus(id, r.ckey, 'Not needed'); }, `${left.length} marked not needed`); }));
        const m = $('[data-rmine]', el); if (m) m.onchange = () => $$('.rs-row[data-mine="0"]', el).forEach((r) => { r.hidden = m.checked; });
        wireOwners(el);
        const ci = $('[data-rcirc]', el); if (ci) ci.onclick = () => BB.circulate(id, ci);
        socialBlock($('[data-social]', el), id);
        BB.aiGallery($('[data-aigal]', el), id);
        $('[data-aimake]', el).onclick = () => BB.aiCreatives(id, () => { BB.aiGallery($('[data-aigal]', el), id); socialBlock($('[data-social]', el), id); });
      },
    };
  };
  // Internal DB circulation from a button: send now and say exactly what happened.
  BB.circulate = async (jobId, btn) => {
    if (!(await BB.confirm('Send to matching candidates', 'Everyone in the database who matches this job well and agreed to job alerts gets the job on WhatsApp, with Interested / Not interested. People already asked are skipped.', 'Send'))) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try { const r = await BB.post(`/api/jobs/${jobId}/circulate`); BB.askResult(r, `${r.matched} match${r.matched === 1 ? '' : 'es'} scoring ${r.strong}+ with consent`); refresh(); } catch (e) { BB.fail(e); if (btn) { btn.disabled = false; btn.textContent = 'Send to matching candidates'; } }
  };
  // The result of asking on WhatsApp: how many went, and why the rest did not (grouped).
  BB.askResult = (r, sub, names = {}) => {
    const by = {}; for (const x of r.skipped || []) { const i = x.indexOf(': '); const id = x.slice(0, i); const why = x.slice(i + 2); (by[why] = by[why] || []).push(names[id] || id); }
    BB.modal({ title: r.sent ? `Sent to ${r.sent}` : 'Nothing sent', body: `${sub ? `<p class="small muted" style="margin-top:0">${esc(sub)}</p>` : ''}<p><b>${r.sent}</b> asked on WhatsApp. Their Interested reply opens the application on this job.</p>${Object.keys(by).length ? `<div class="ask-skips">${Object.entries(by).map(([why, who]) => `<div><b>${who.length} not sent · ${esc(why)}</b><div class="small muted">${who.slice(0, 12).map(esc).join(', ')}${who.length > 12 ? ` and ${who.length - 12} more` : ''}</div></div>`).join('')}</div>${by['No consent for job alerts yet'] ? '<p class="small muted">People without consent can be called; mark them Interested or Not interested here.</p>' : ''}` : ''}` });
  };

  // ---------- what shows on the job itself ----------
  BB.reachSummary = (j) => {
    const rows = j.postings || []; const n = counted(rows.map((p) => p.status)); const cr = j.creative || {}; const steps = ['Brief shared', 'With designer', 'Sent for approval', 'Approved', 'Posted'];
    const groups = [...new Set(rows.map((p) => p.group))]; const done = rows.filter((p) => p.status === 'Done');
    return `<div class="sec" data-rsum><h3><span>Digital Reach</span><span class="sec-act"><span class="small muted">${n.done} of ${n.needed} done</span><button class="btn sm" data-open="reach:${j.id}">Open</button></span></h3>
      <div class="small muted" style="margin:8px 0 4px">Step 1 · Creative development <span class="faint">· tap a step to mark it</span></div>${stepper(steps, cr.status, true)}<div class="rs-next">Next: <b>${esc(nextStep(cr.status ? cr : null, n.left))}</b></div>
      <div class="rs-gsum">${groups.map((g) => { const c = counted(rows.filter((p) => p.group === g).map((p) => p.status)); return `<div><div class="row between small"><span>${esc(g)}</span><span class="muted">${c.done} of ${c.needed}</span></div>${bar(c.done, c.needed)}</div>`; }).join('')}</div>
      ${done.length ? `<div class="rs-posted">${done.map((p) => `<div class="hist-row"><span class="grow small"><b>${esc(p.channel)}</b>${p.post_link && /^https?:\/\//i.test(p.post_link) ? ` · <a href="${esc(p.post_link)}" target="_blank" rel="noopener">see post ↗</a>` : ''}</span><span class="small muted">${esc(p.updated_by || p.done_by || '')}, ${fmtD(p.updated_at || p.done_date)}</span></div>`).join('')}</div>` : ''}</div>`;
  };

  // Job view: tap a creative step to mark it.
  BB.wireReachSummary = (el, j) => $$('.job-reach [data-rstep], [data-rsum] [data-rstep]', el).forEach((b) => (b.onclick = () => say(() => BB.post('/api/creatives', { ids: [j.id], status: b.dataset.rstep }), `Creative: ${b.dataset.rstep}`)));
  // ---------- the page ----------
  BB.pages.channels = async ({ el, actions, q }) => {
    const d = await BB.api(`/api/postings/tracker?${BB.qs({ all: q.all })}`); const cr = await BB.api('/api/creatives'); const myName = BB.me.user.name;
    if (!limited() && q.view === 'tracker' && BB.jobViews) { actions.innerHTML = `<div class="job-tb">${BB.jobViews('tracker')}</div>`; $$('[data-jv]', actions).forEach((b) => (b.onclick = () => BB.setQ({ view: b.dataset.jv }))); }
    const owners = [...new Set(d.channels.map((c) => c.owner))]; const own = q.owner !== undefined ? q.owner : limited() && owners.includes(myName) ? myName : '';
    const chs = d.channels.filter((c) => !own || c.owner === own); const by = q.by === 'channel' ? 'channel' : 'job'; const show = q.show || 'todo';
    const cell = (j, c) => (d.cells[j.id] || {})[c.key] || {};
    const jobs = d.jobs.map((j) => { const st = chs.map((c) => cell(j, c).status || ''); const n = counted(st); const c = cr.rows[j.id]; return { ...j, n, cr: c, next: nextStep(c, n.left) }; });
    const week = Date.now() - 7 * 864e5; const tile = (l, v) => `<div class="ci-tile"><div class="ci-lab">${l}</div><div class="hist-num">${v}</div></div>`;
    const before = (j) => !j.cr || ['Brief shared', 'With designer'].includes(j.cr.status);
    const stats = `<div class="hist-grid rs-stats">${tile('Creatives to make', jobs.filter(before).length)}${tile('Waiting for approval', jobs.filter((j) => j.cr && j.cr.status === 'Sent for approval').length)}${tile('Channels to post', jobs.reduce((t, j) => t + j.n.left, 0))}${tile('Posted this week', jobs.reduce((t, j) => t + chs.filter((c) => { const x = cell(j, c); return x.status === 'Done' && new Date(x.done_date).getTime() > week; }).length, 0))}</div>`;
    const seg = (key, cur, list) => `<div class="seg">${list.map(([v, l]) => `<button data-rq="${key}" data-val="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const list = () => {
      const txt = ($('[data-rs]', el) || {}).value || ''; const t = txt.trim().toLowerCase();
      const rows = jobs.filter((j) => (show === 'all' || j.next !== 'All done') && (!t || `${j.title} ${j.city} ${j.client}`.toLowerCase().includes(t)));
      $('[data-rlist]', el).innerHTML = rows.map((j) => `<button type="button" class="rs-job" data-open="reach:${j.id}"><span class="rs-j1"><span class="rs-jt"><b>${esc(j.title)}</b>${j.priority === 'High' ? '<span class="badge b-red tiny">High</span>' : ''}</span><span class="tiny muted">${[j.client, j.city].filter(Boolean).map(esc).join(' · ')}</span></span><span class="rs-j2"><span class="tiny muted">Creative</span><span class="small">${esc((j.cr && j.cr.status) || 'Not started')}</span></span><span class="rs-j3">${bar(j.n.done, j.n.needed)}<span class="tiny muted">${j.n.done} of ${j.n.needed} channels</span></span><span class="rs-j4 ${j.next === 'All done' ? 'ok' : ''}">${esc(j.next)}</span><span class="rs-j5" aria-hidden="true">›</span></button>`).join('') || `<div class="empty">${show === 'all' ? 'No open jobs.' : 'Nothing to do. Every job is up to date.'}</div>`;
    };
    const channelTable = () => { let g = null; return chs.map((c) => { const n = counted(d.jobs.map((j) => cell(j, c).status || '')); const head = c.group !== g ? `<div class="rs-ghead">${esc((g = c.group))}</div>` : ''; return `${head}<div class="rs-chrow"><button type="button" class="rs-chname" data-rch="${esc(c.key)}"><b>${esc(c.channel)}</b><span class="tiny muted">${esc(c.how || '')}</span></button><span class="rs-chown">${limited() ? `<span class="small muted">${esc(c.owner)}</span>` : ownerPick(c, d.people)}</span><span class="rs-j3">${bar(n.done, n.needed)}<span class="tiny muted">${n.done} of ${n.needed} jobs</span></span></div>`; }).join(''); };
    el.innerHTML = `${stats}<section class="card pad rs-tools"><input data-rs placeholder="Search job, client or city" aria-label="Search jobs"><select data-own aria-label="Owner"><option value="">All owners</option>${owners.includes(myName) ? `<option value="${esc(myName)}" ${own === myName ? 'selected' : ''}>My channels</option>` : ''}${owners.filter((o) => o !== myName).map((o) => `<option ${own === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${seg('by', by, [['job', 'By job'], ['channel', 'By channel']])}${by === 'job' ? seg('show', show, [['todo', 'To do'], ['all', 'All']]) : ''}</section>
      ${by === 'job' ? '<div class="card" data-rlist></div>' : `<div class="card pad">${channelTable()}</div>`}
      <section class="card pad" data-socpage><div class="row between"><h3 style="margin:0">Automatic posts</h3><span class="small muted">scheduled and the last 14 days</span></div><div data-socbody><div class="faint small">Loading…</div></div></section>
      <details class="card pad rs-recent"><summary><b>Recent updates</b> <span class="small muted">${d.recent.length}</span></summary>${d.recent.map((r) => `<div class="trk-rec"><b>${esc(r.updated_by)}</b> marked ${esc(r.channel)} <span class="badge b-outline">${esc(r.status === 'Pending' ? 'To do' : r.status || 'cleared')}</span> for ${esc(r.job)} <span class="faint">${fmtDT(r.updated_at)}</span></div>`).join('') || '<div class="faint small">No updates yet.</div>'}</details>`;
    if (by === 'job') { list(); $('[data-rs]', el).oninput = list; } else $('[data-rs]', el).hidden = true;
    $$('[data-rq]', el).forEach((b) => (b.onclick = () => BB.setQ({ [b.dataset.rq]: b.dataset.val })));
    $('[data-own]', el).onchange = (e) => BB.setQ({ owner: e.target.value }); wireOwners(el);
    if (q.li) { BB.toast(q.li === 'connected' ? 'LinkedIn connected' : `LinkedIn: ${q.li}`, q.li !== 'connected'); BB.setQ({ li: '' }); }
    { const sb = $('[data-socbody]', el); const load = async () => { try { const [st, ps] = await Promise.all([BB.api('/api/social/status'), BB.api('/api/social/posts')]); const day = (p) => new Date(p.posted_at || p.run_at).toDateString(); const up = ps.rows.filter((p) => p.status === 'Scheduled'); const past = ps.rows.filter((p) => p.status !== 'Scheduled').reverse();
      const group = (rows) => { let g = null; return rows.map((p) => { const h = day(p) !== g ? `<div class="rs-ghead">${fmtD((g = day(p)) && (p.posted_at || p.run_at))}</div>` : ''; return h + postLine(p, true); }).join(''); };
      sb.innerHTML = `${connChips(st)}<div class="soc-list"><div class="small"><b>Scheduled</b> · ${up.length}</div>${group(up) || '<div class="faint small">Nothing scheduled. Open a job below and use Post automatically.</div>'}${past.length ? `<details><summary class="small"><b>Posted and failed</b> · ${past.length}</summary>${group(past)}</details>` : ''}</div>`; wireConn(sb); wirePostActs(sb, load); } catch (e) { sb.innerHTML = `<div class="small muted">${esc(e.message)}</div>`; } }; load(); }
    $$('[data-rch]', el).forEach((b) => (b.onclick = () => {
      const c = d.channels.find((x) => x.key === b.dataset.rch); const link = (j) => `${d.link_base}job=${j.id}&src=${d.tags[c.key]}`;
      BB.modal({ title: c.channel, wide: true, body: `${c.how ? `<p class="small muted" style="margin-top:0">${esc(c.how)}</p>` : ''}${d.jobs.map((j) => `<div class="rs-row"><div class="rs-main"><b>${esc(j.title)}</b><div class="tiny muted">${[j.client, j.city].filter(Boolean).map(esc).join(' · ')}</div></div><div class="rs-acts">${statusSeg(`data-mj="${j.id}" data-v`, cell(j, c).status || '')}<button type="button" class="btn sm" data-mcopy="${esc(link(j))}">Copy link</button></div></div>`).join('') || '<div class="empty">No open jobs.</div>'}`, foot: '<button class="btn" data-mclose>Close</button>',
        onMount: (m, close) => {
          $('[data-mclose]', m).onclick = close; $$('[data-mcopy]', m).forEach((x) => (x.onclick = () => BB.copy(x.dataset.mcopy)));
          $$('[data-mj]', m).forEach((x) => (x.onclick = async () => { const j = d.jobs.find((y) => y.id === x.dataset.mj); const st = cell(j, c).status === x.dataset.v ? '' : x.dataset.v; try { await setStatus(j.id, c.key, st); (d.cells[j.id] = d.cells[j.id] || {})[c.key] = { status: st }; $$(`[data-mj="${j.id}"]`, m).forEach((y) => { y.className = y.dataset.v === st ? `on s-${st === 'Not needed' ? 'na' : st.toLowerCase()}` : ''; }); } catch (e) { BB.fail(e); } }));
        } });
    }));
  };
})();

// ---------- AI creatives ----------
// A tuned prompt (saved as the standard one if wanted), up to 4 earlier creatives as the style to follow, and the sizes.
// Each picture comes back from OpenAI and is fitted here to the exact size: 1080×1080, 1080×1350 or 1080×1920.
(() => {
  const { $, $$, esc } = BB;
  const OUT = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920] };
  const fitJpg = (url, size) => new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => { const [W, H] = OUT[size]; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      const sw = img.naturalWidth; const sh = img.naturalHeight; const k = Math.max(W / sw, H / sh); const dw = sw * k; const dh = sh * k; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); resolve(c.toDataURL('image/jpeg', 0.92)); };
    img.onerror = () => reject(new Error('The picture could not be opened.')); img.src = url; });
  const toJpg = (file) => new Promise((resolve, reject) => { const u = URL.createObjectURL(file); const img = new Image(); img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); resolve(c.toDataURL('image/jpeg', 0.9)); }; img.onerror = () => reject(new Error('Use a JPG or PNG.')); img.src = u; });
  const use = async (jobId, c, where) => {
    try {
      if (where === 'story') { const base64 = await fitJpg(c.url, 'story'); await BB.post('/api/social/story-image', { job_id: jobId, base64 }); BB.toast('Set as the story picture'); }
      else { const base64 = await fitJpg(c.url, c.size === 'portrait' ? 'portrait' : 'square'); await BB.post('/api/social/image', { job_id: jobId, base64 }); BB.toast('Set as the post image'); }
      return true;
    } catch (e) { BB.fail(e); return false; }
  };
  const download = async (c) => { const base64 = await fitJpg(c.url, c.size); const a = document.createElement('a'); a.href = base64; a.download = `${c.job_id || 'creative'}-${c.size}.jpg`; a.click(); };
  const card = (c, jobId) => `<div class="ai-card"><img src="${esc(c.url)}" alt="${esc(c.label)}" class="ai-${esc(c.size)}"><div class="tiny muted">${esc(c.label)}</div><div class="row" style="gap:4px;flex-wrap:wrap">${c.size === 'story' ? `<button type="button" class="btn sm" data-aiuse="story" data-k="${esc(c.media_key || c.key)}">Use for story</button>` : `<button type="button" class="btn sm" data-aiuse="post" data-k="${esc(c.media_key || c.key)}">Use for posts</button>`}<button type="button" class="btn sm ghost" data-aidl="${esc(c.media_key || c.key)}">Download</button></div></div>`;
  const wireCards = (root, list, jobId, after) => {
    const find = (k) => list.find((c) => (c.media_key || c.key) === k);
    $$('[data-aiuse]', root).forEach((b) => (b.onclick = async () => { b.disabled = true; const ok = await use(jobId, { ...find(b.dataset.k), job_id: jobId }, b.dataset.aiuse); b.disabled = false; if (ok && after) after(); }));
    $$('[data-aidl]', root).forEach((b) => (b.onclick = () => download({ ...find(b.dataset.aidl), job_id: jobId })));
  };
  BB.aiGallery = async (box, jobId, after) => {
    if (!box) return; let d; try { d = await BB.api(`/api/social/ai/${jobId}`); } catch { box.innerHTML = ''; return; }
    box.innerHTML = d.made.length ? `<div class="small" style="margin:6px 0"><b>AI creatives</b></div><div class="ai-gal">${d.made.slice(0, 9).map((c) => card(c, jobId)).join('')}</div>` : '';
    wireCards(box, d.made, jobId, after);
  };
  // Three steps in one window: 1 What goes on it (from the job, and the JD if given) → 2 Look (sizes, style references,
  // advanced prompt) → 3 Results (retry any size with a note, use for posts or story, download). Back and forth keeps everything.
  BB.aiCreatives = async (jobId, after) => {
    const d = await BB.api(`/api/social/ai/${jobId}`).catch(BB.fail); if (!d) return;
    if (!d.ready) return BB.modal({ title: 'Make creatives with AI', body: '<p>This needs the OpenAI key on the server (OPENAI_API_KEY in .env).</p>' });
    const picked = new Set(); let step = 1; const made = [];
    const brief = { ...(d.last_brief || d.facts), highlights: [...((d.last_brief || d.facts).highlights || [])] };
    const STEPS = ['What goes on it', 'Look', 'Creatives'];
    const mm = BB.modal({ title: 'Make creatives with AI', wide: true,
      foot: '<span class="grow small muted" data-aist></span><button class="btn" data-aiback>Back</button><button class="btn primary" data-aigo>Next</button>',
      body: `<div class="ai-steps" role="tablist">${STEPS.map((l, i) => `<button type="button" class="ai-step" data-aistep="${i + 1}"><span>${i + 1}</span>${l}</button>`).join('')}</div>
        <section data-aipane="1" class="stack">
          <div class="grid g2"><label class="field"><span class="lab">Role</span><input data-bf="job"></label><label class="field"><span class="lab">Location</span><input data-bf="city"></label></div>
          <div class="grid g2"><label class="field"><span class="lab">Experience <span class="opt">(leave empty to leave it off)</span></span><input data-bf="experience" placeholder="e.g. 2–4 years"></label><label class="field"><span class="lab">Salary <span class="opt">(leave empty to leave it off)</span></span><input data-bf="salary" placeholder="e.g. ₹25,000–₹30,000 a month"></label></div>
          <div class="field"><span class="lab">Requirements to show <span class="opt">(up to 5: software, skills, gender, language, qualification…)</span></span><div class="ai-hl" data-aihl></div><div class="row" style="gap:6px"><input data-aihlnew placeholder="Add one, e.g. Matrix & Rhino 3D" style="flex:1"><button type="button" class="btn sm" data-aihladd>Add</button></div></div>
          <details class="ai-jd" ${d.has_jd ? '' : 'open'}><summary><b>Read a job description</b> <span class="opt small">(optional: picks up experience, salary and must-haves)</span></summary>
            <textarea data-aijd rows="6" placeholder="${d.has_jd ? 'Empty: the job\'s own JD is read. Or paste a different one here.' : 'Paste the job description here'}"></textarea>
            <button type="button" class="btn sm" data-aijdgo>${d.has_jd ? 'Read the JD' : 'Read this JD'}</button></details>
        </section>
        <section data-aipane="2" class="stack" hidden>
          <div class="field"><span class="lab">Sizes</span><div class="row" style="gap:14px">${d.sizes.map((s2) => `<label class="row small" style="gap:6px"><input type="checkbox" data-aisz="${s2.key}" checked> ${esc(s2.label)}</label>`).join('')}</div></div>
          <div class="field"><span class="lab">Style to follow <span class="opt">(tick up to 4)</span></span><div class="ai-refs">${d.refs.map((r) => `<label class="ai-ref" title="${esc(r.kind)}"><input type="checkbox" data-airef="${esc(r.key)}"><img src="${esc(r.url)}" alt=""></label>`).join('')}<button type="button" class="btn sm" data-airefup>+ Add a reference</button></div></div>
          <label class="field"><span class="lab">Anything else for this job <span class="opt">(optional)</span></span><input data-aiextra placeholder="e.g. show a diamond ring, mention walk-in on Saturday"></label>
          <details><summary class="small"><b>Advanced: the prompt</b></summary>
            <p class="tiny muted">{job}, {city}, {details} (experience, salary and requirements from step 1), {apply} and {format} fill in for each size.</p>
            <textarea data-aiprompt rows="9">${esc(d.prompt)}</textarea>
            <div class="row" style="gap:14px"><label class="row small" style="gap:6px"><input type="checkbox" data-aisave> Save as the standard prompt</label><button type="button" class="btn-link tiny" data-aireset>Use the original prompt</button></div></details>
        </section>
        <section data-aipane="3" hidden><div data-aires></div>${d.made.length ? `<details class="ai-old"><summary class="small"><b>Earlier creatives for this job</b> (${d.made.length})</summary><div class="ai-gal" data-aiold>${d.made.slice(0, 12).map((c) => card(c, jobId)).join('')}</div></details>` : ''}</section>` });
    const m = mm.el; const st = $('[data-aist]', m); const go = $('[data-aigo]', m); const back = $('[data-aiback]', m);
    // step 1: the brief
    $$('[data-bf]', m).forEach((x) => { x.value = brief[x.dataset.bf] || ''; x.oninput = () => { brief[x.dataset.bf] = x.value; }; });
    const drawHl = () => { $('[data-aihl]', m).innerHTML = brief.highlights.map((h, i) => `<span class="fchip">${esc(h)}<button type="button" data-aihlx="${i}" aria-label="Remove ${esc(h)}">✕</button></span>`).join('') || '<span class="small muted">None yet. Read the JD below, or add them here.</span>'; $$('[data-aihlx]', m).forEach((b) => (b.onclick = () => { brief.highlights.splice(Number(b.dataset.aihlx), 1); drawHl(); })); };
    drawHl();
    const addHl = () => { const v = $('[data-aihlnew]', m).value.trim(); if (!v) return; if (brief.highlights.length >= 5) return BB.toast('Up to 5 requirements', true); brief.highlights.push(v); $('[data-aihlnew]', m).value = ''; drawHl(); };
    $('[data-aihladd]', m).onclick = addHl; $('[data-aihlnew]', m).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addHl(); } };
    $('[data-aijdgo]', m).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Reading…';
      try { const r = await BB.post('/api/social/ai/brief', { job_id: jobId, jd: $('[data-aijd]', m).value }); for (const k of ['experience', 'salary']) if (r[k] && !brief[k]) brief[k] = r[k]; brief.highlights = [...new Set([...(r.highlights || []), ...brief.highlights])].slice(0, 5); // what the JD asks for first $$('[data-bf]', m).forEach((x) => { x.value = brief[x.dataset.bf] || ''; }); drawHl(); BB.toast(r.from_jd ? 'Read the JD: check the lines above' : 'No JD to read: filled in from the job'); } catch (er) { BB.fail(er); }
      b.disabled = false; b.textContent = 'Read again';
    };
    // step 2: look
    const wireRefs = () => $$('[data-airef]', m).forEach((x) => (x.onchange = () => { if (x.checked && picked.size >= 4) { x.checked = false; return BB.toast('Up to 4 references', true); } if (x.checked) picked.add(x.dataset.airef); else picked.delete(x.dataset.airef); }));
    wireRefs();
    $('[data-aireset]', m).onclick = () => { $('[data-aiprompt]', m).value = d.standard; };
    $('[data-airefup]', m).onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { if (!i.files[0]) return; try { const base64 = await toJpg(i.files[0]); const r = await BB.post('/api/social/ai/refs', { base64 }); const lab = document.createElement('label'); lab.className = 'ai-ref'; lab.innerHTML = `<input type="checkbox" data-airef="${esc(r.key)}"><img src="/api/public/studio-media/${esc(r.key)}" alt="">`; $('[data-airefup]', m).before(lab); wireRefs(); const cb = $('input', lab); if (picked.size < 4) { cb.checked = true; picked.add(r.key); } } catch (er) { BB.fail(er); } }; i.click(); };
    const oldBox = $('[data-aiold]', m); if (oldBox) wireCards(oldBox, d.made, jobId, after);
    // moving between steps
    const show = (n) => {
      step = n; $$('[data-aipane]', m).forEach((p) => { p.hidden = Number(p.dataset.aipane) !== n; });
      $$('[data-aistep]', m).forEach((b) => { const k = Number(b.dataset.aistep); b.classList.toggle('on', k === n); b.classList.toggle('done', k < n); });
      back.style.display = n === 1 ? 'none' : ''; go.textContent = n === 1 ? 'Next: look' : n === 2 ? 'Make creatives' : 'Make all again'; go.style.display = n === 3 && !made.length ? 'none' : '';
      st.textContent = n === 1 ? 'Check what goes on the creative.' : n === 2 ? 'About a minute. Each size is one picture.' : st.textContent;
    };
    $$('[data-aistep]', m).forEach((b) => (b.onclick = () => { const k = Number(b.dataset.aistep); if (k < 3 || made.length) show(k); }));
    back.onclick = () => show(Math.max(1, step - 1));
    // step 3: make, show, retry
    const res = $('[data-aires]', m);
    const drawMade = () => {
      res.innerHTML = made.length ? `<div class="ai-gal">${made.map((c) => (c.error ? `<div class="ai-card ai-fail"><div class="notice warn small">${esc(c.label)}: ${esc(c.error)}</div><button type="button" class="btn sm" data-airetry="${esc(c.size)}">Try again</button></div>` : c.making ? `<div class="ai-card ai-wait"><div class="ai-spin"></div><div class="tiny muted">${esc(c.label)}: making…</div></div>` : `<div class="ai-card-wrap">${card(c, jobId)}<button type="button" class="btn-link tiny" data-airetry="${esc(c.size)}">↻ Make this size again</button></div>`)).join('')}</div>` : '';
      wireCards(res, made.filter((c) => c.key || c.media_key), jobId, after);
      $$('[data-airetry]', res).forEach((b) => (b.onclick = async () => { const v = await BB.ask({ title: 'Make this size again', fields: [{ name: 'note', label: 'What should change? (optional)', opt: true, placeholder: 'e.g. bigger role name, less gold, add a ring' }], ok: 'Make again' }); if (v) run([b.dataset.airetry], v.note); }));
    };
    const run = async (sizes, note) => {
      const lab = Object.fromEntries(d.sizes.map((x) => [x.key, x.label]));
      for (const sz of sizes) { const i = made.findIndex((c) => c.size === sz); const row = { size: sz, label: lab[sz], making: true }; if (i >= 0) made[i] = row; else made.push(row); }
      show(3); drawMade(); go.disabled = true; st.textContent = 'Making the creatives… (about a minute)';
      const extra = [$('[data-aiextra]', m).value.trim(), note].filter(Boolean).join('. ');
      let r0; try { r0 = await BB.post('/api/social/ai/run', { job_id: jobId, sizes, refs: [...picked], prompt: $('[data-aiprompt]', m).value, save_prompt: $('[data-aisave]', m).checked, extra, brief }); } catch (er) { BB.fail(er); for (const sz of sizes) { const i = made.findIndex((c) => c.size === sz); made[i] = { ...made[i], making: false, error: er.message || 'Not made' }; } drawMade(); go.disabled = false; return; }
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 4000)); if (!document.body.contains(m)) return;
        let r; try { r = await BB.api(`/api/social/ai/run/${r0.id}`); } catch { continue; }
        for (const x of r.out) { const k = made.findIndex((c) => c.size === x.size); if (k >= 0) made[k] = x.key ? { ...x, media_key: x.key } : { ...x, making: false }; }
        drawMade();
        const ok = r.out.filter((x) => x.key).length;
        st.textContent = r.status === 'Making' ? `Made ${ok} of ${sizes.length}…` : r.status === 'Done' ? 'Done. Use them for posts and the story, download, or make any size again.' : `Not made: ${r.error || ''}`;
        if (r.status !== 'Making') { go.disabled = false; show(3); if (after) after(); return; }
      }
      st.textContent = 'Still making: close this and open the job again in a minute.'; go.disabled = false;
    };
    go.onclick = () => {
      if (step === 1) { if (!String(brief.job || '').trim()) return BB.toast('Enter the role', true); return show(2); }
      const sizes = $$('[data-aisz]:checked', m).map((x) => x.dataset.aisz); if (!sizes.length) { show(2); return BB.toast('Tick a size', true); }
      run(sizes);
    };
    show(1);
  };
})();
