/* Candidate verification: masked Aadhaar, PAN, last employer reference.
   The team panel shows each check with how to do it for free; the candidate uploads their papers in their profile. */
(() => {
  const { $, $$, esc, fmtD } = BB;
  const V = (BB.verify = {});
  const SUM_CLS = { 'Fully checked': 'b-green', 'ID verified': 'b-green', 'Problem found': 'b-red', 'In progress': 'b-amber', 'Not started': 'b-outline' };
  V.badge = (s) => (s && s !== 'Not started' ? `<span class="badge ${SUM_CLS[s] || 'b-outline'}" title="Verification">${s === 'Fully checked' || s === 'ID verified' ? '✓ ' : ''}${esc(s)}</span>` : '');
  const stCls = (i) => (i.ok ? 'b-green' : i.bad ? 'b-red' : i.status === 'Uploaded' ? 'b-amber' : 'b-outline');

  // The document picked in the Record dialog, sent with the result.
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-vfile]'); if (!b) return;
    const f = await BB.pickFile('.pdf,.jpg,.jpeg,.png'); if (!f) return; V.picked = f; const n = $('[data-vname]'); if (n) n.textContent = f.name;
  });

  // ---------- team: the Verification section on the candidate ----------
  // Order a verification for a candidate (from the Verifications tab or an application). appId fixes the client.
  V.place = async (candId, appId, after) => {
    let c; let pk; try { [c, pk] = await Promise.all([BB.api(`/api/candidates/${encodeURIComponent(candId)}`), BB.api('/api/verify/packages')]); } catch (e) { return BB.fail(e); }
    const clients = [...new Map((c.apps || []).filter((a) => a.client_id && (!appId || a.id === appId)).map((a) => [a.client_id, [a.client_id, `${a.client_name || a.client_id} · ${a.job_title || ''}`, a.id]])).values()];
    if (!clients.length) return BB.toast(`${c.name} is on no client's job yet: add them to a job opening first (a verification is ordered for a client).`, true);
    const r = await BB.ask({ title: `Order verification · ${esc(c.name)}`, note: 'The candidate is asked on WhatsApp for the documents this package needs. Record each check; then make the report and email it to the client (it is also in their account).', fields: [
      { name: 'client', label: 'For client', type: 'select', options: clients.map(([id, l]) => [id, l]), value: clients[0][0], placeholder: false },
      { name: 'package', label: 'Package', type: 'select', options: pk.map((p) => [p.key, `${p.name} · ₹${p.price} — ${p.about}`]), placeholder: false, value: 'standard' },
      { name: 'price', label: 'Price (₹, before GST)', type: 'number', opt: true, placeholder: 'The package price', voice: false }], ok: 'Order',
      submit: (v) => BB.post('/api/verify-orders', { candidate_id: c.id, client_id: v.client, app_id: (clients.find((x) => x[0] === v.client) || [])[2], package: v.package, price: v.price === '' ? undefined : Number(v.price) }) });
    if (r) { BB.toast(`${r.no} ordered: documents asked from the candidate`); if (after) after(r); }
    return r;
  };
  V.sendReport = async (orderId, after) => { const r = await BB.ask({ title: 'Email the report to the client', fields: [{ name: 'to', label: 'To (leave empty for the client\'s email)', type: 'email', opt: true }], ok: 'Send', submit: (v) => BB.post(`/api/verify-orders/${orderId}/send`, v) }); if (r) { BB.toast(`Report sent to ${r.to}`); if (after) after(); } };
  V.block = (c) => `<div class="sec" data-verify="${esc(c.id)}"><h3><span>Verification</span></h3><div class="card pad small muted">Loading…</div></div>`;
  V.mount = async (el, c) => {
    const box = $('[data-verify]', el); if (!box) return;
    let d; let orders = []; try { [d, orders] = await Promise.all([BB.api(`/api/candidates/${c.id}/verify`), BB.api(`/api/verify-orders?candidate=${encodeURIComponent(c.id)}`).then((x) => x.rows).catch(() => [])]); } catch (e) { box.remove(); return; }
    const draw = () => {
      box.innerHTML = `<h3><span>Verification ${V.badge(d.summary) || '<span class="badge b-outline">Not started</span>'}</span><span class="sec-act"><button class="btn sm" data-vask>Ask for documents</button><button class="btn sm" data-vorder>Order verification</button></span></h3>
        ${orders.length ? `<div class="verify-orders">${orders.map((o) => `<div class="verify-order"><div class="grow"><b>${esc(o.no)} · ${esc(o.name)}</b> <span class="badge ${o.status === 'Completed' ? (o.problem ? 'b-red' : 'b-green') : o.status === 'Cancelled' ? 'b-outline' : 'b-amber'}">${esc(o.status === 'Completed' ? (o.problem ? 'Completed · problem found' : 'Completed · all clear') : o.status)}</span><div class="tiny muted">For ${esc(o.client_name)} · ₹${Number(o.price).toLocaleString('en-IN')} · checks done ${esc(o.progress)} · ordered ${fmtD(o.at)} by ${esc(o.by)}</div></div><div class="row" style="gap:6px">${o.status === 'Completed' ? `<button class="btn sm" data-vrep="${o.id}">Report</button>` : `${o.ready ? `<button class="btn sm primary" data-vdone="${o.id}">Complete &amp; make report</button>` : ''}${o.status !== 'Cancelled' ? `<button class="btn sm ghost" data-vcancel="${o.id}">Cancel</button>` : ''}`}</div></div>`).join('')}</div>` : ''}
        <div class="card verify-list">${d.items.map((i) => `<div class="verify-row"><div class="grow"><b>${esc(i.label)}</b> <span class="badge ${stCls(i)}">${esc(i.status)}</span>${i.note ? `<div class="tiny muted">${esc(i.note)}</div>` : ''}${i.by ? `<div class="tiny faint">${esc(i.by)} · ${fmtD(i.at)}</div>` : ''}</div><div class="row" style="gap:6px">${i.file ? `<button class="btn sm ghost" data-file="${esc(i.file)}">View</button>` : ''}<button class="btn sm" data-vrec="${i.kind}">${i.ok || i.bad ? 'Change' : 'Record'}</button></div></div>`).join('')}
        <div class="verify-row small ${d.declaration ? '' : 'muted'}">${d.declaration ? `✓ Candidate declared no criminal cases on ${fmtD(d.declaration.at)}` : 'No declaration from the candidate yet'}</div></div>`;
      $$('[data-vrec]', box).forEach((b) => (b.onclick = () => record(d.items.find((i) => i.kind === b.dataset.vrec))));
      $('[data-vask]', box).onclick = () => askDocs();
      $('[data-vorder]', box).onclick = () => order();
      $$('[data-vrep]', box).forEach((b) => { b.onclick = () => BB.download(`/api/verify-orders/${b.dataset.vrep}/report`); if (!b.nextElementSibling || !b.nextElementSibling.dataset.vsend) b.insertAdjacentHTML('afterend', `<button class="btn sm" data-vsend="${b.dataset.vrep}">Email to client</button>`); });
      $$('[data-vsend]', box).forEach((b) => (b.onclick = () => V.sendReport(b.dataset.vsend)));
      $$('[data-vdone]', box).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await BB.post(`/api/verify-orders/${b.dataset.vdone}/complete`); BB.toast('Report made: the client can download it from their account'); reload(); } catch (e) { b.disabled = false; BB.fail(e); } }));
      $$('[data-vcancel]', box).forEach((b) => (b.onclick = async () => { if (!(await BB.confirm('Cancel this verification order?', 'The client stops seeing it as in progress. Checks already recorded stay on the candidate.', 'Cancel order'))) return; try { await BB.post(`/api/verify-orders/${b.dataset.vcancel}/status`, { status: 'Cancelled' }); reload(); } catch (e) { BB.fail(e); } }));
    };
    const reload = async () => { [d, orders] = await Promise.all([BB.api(`/api/candidates/${c.id}/verify`), BB.api(`/api/verify-orders?candidate=${encodeURIComponent(c.id)}`).then((x) => x.rows).catch(() => [])]); draw(); };
    // Pick the documents; the candidate gets them on WhatsApp with the upload link (or the link is copied to send yourself).
    const askDocs = () => { const up = d.items.filter((i) => i.upload); const def = new Set(['aadhaar', 'pan']);
      return BB.ask({ title: `Ask ${esc(c.name)} for documents`, note: 'They get a WhatsApp with the list and the link to upload. Their upload page shows exactly these.', fields: [`<div class="field"><span class="lab">Documents</span><div class="vdocs">${up.map((i) => `<label class="row small"><input type="checkbox" data-vk="${i.kind}" ${def.has(i.kind) && !i.ok ? 'checked' : ''}> ${esc(i.label)} ${i.ok ? '<span class="badge b-green tiny">verified</span>' : i.file ? '<span class="badge b-amber tiny">uploaded</span>' : ''}</label>`).join('')}</div><div class="row small" style="gap:10px;margin-top:6px"><a href="#" data-vall>All</a><a href="#" data-vjoin>Joining set (BrillBrains openings)</a></div></div>`],
        ok: 'Send', mount: (m) => { $('[data-vall]', m).onclick = (e) => { e.preventDefault(); $$('[data-vk]', m).forEach((x) => { x.checked = true; }); }; $('[data-vjoin]', m).onclick = (e) => { e.preventDefault(); const j = ['aadhaar', 'pan', 'address', 'education', 'experience', 'salary', 'uan']; $$('[data-vk]', m).forEach((x) => { x.checked = j.includes(x.dataset.vk); }); }; },
        submit: () => BB.post(`/api/candidates/${c.id}/docs-request`, { kinds: $$('.modal [data-vk]:checked').map((x) => x.dataset.vk) }) })
        .then((r) => { if (!r) return; if (r.sent) BB.toast(`Asked on WhatsApp for ${r.missing.length} document${r.missing.length === 1 ? '' : 's'}`); else { BB.copy(r.link); BB.toast(r.missing.length ? `Not sent on WhatsApp (${r.why_not_sent}). Upload link copied: send it yourself.` : 'They already gave all of these', !!r.missing.length); } reload(); }); };
    // A client asked for (or will pay for) a verification: package, price, the client it is for.
    const order = async () => { const pk = await BB.api('/api/verify/packages'); const clients = [...new Map((c.apps || []).filter((a) => a.client_id).map((a) => [a.client_id, [a.client_id, `${a.client_name || a.client_id} · ${a.job_title || ''}`, a.id]])).values()];
      if (!clients.length) return BB.toast('Add them to a client\'s job opening first: a verification is ordered for a client.', true);
      return BB.ask({ title: `Order verification · ${esc(c.name)}`, note: 'The candidate is asked for the documents this package needs. When every check is recorded, make the report: the client downloads it from their account, and the amount goes to revenue.', fields: [
        { name: 'client', label: 'For client', type: 'select', options: clients.map(([id, l]) => [id, l]), value: clients[0][0], placeholder: false },
        { name: 'package', label: 'Package', type: 'select', options: pk.map((p) => [p.key, `${p.name} · ₹${p.price} — ${p.about}`]), placeholder: false, value: 'standard' },
        { name: 'price', label: 'Price (₹, before GST)', type: 'number', opt: true, placeholder: 'The package price', voice: false }], ok: 'Order',
        submit: (v) => BB.post('/api/verify-orders', { candidate_id: c.id, client_id: v.client, app_id: (clients.find((x) => x[0] === v.client) || [])[2], package: v.package, price: v.price === '' ? undefined : Number(v.price) }) })
        .then((r) => { if (r) { BB.toast(`${r.no} ordered: documents asked from the candidate`); reload(); } }); };
    const record = (i) => { V.picked = null; return BB.ask({ title: i.label, note: `${esc(i.how)}${i.link ? ` <a href="${esc(i.link)}" target="_blank" rel="noopener">Open the site</a>` : ''}${i.kind === 'aadhaar' ? '<br><b>Keep only a masked Aadhaar</b> (only the last 4 digits showing): the law does not allow us to store the full number.' : ''}`, fields: [
      i.upload ? `<div class="field"><span class="lab">Document ${i.file ? '<span class="faint">(one is already saved; add another only to replace it)</span>' : ''}</span><div class="row"><button type="button" class="btn sm" data-vfile>Choose file</button><span class="small muted" data-vname></span></div></div>` : '',
      { name: 'status', label: 'Result', type: 'choice', options: i.upload && !i.file ? ['Uploaded', ...i.results] : i.results, value: i.ok || i.bad ? i.status : '' },
      { name: 'note', label: i.kind === 'court' ? 'Districts searched and anything found' : 'Notes', type: 'textarea', opt: true, value: '' }],
      ok: 'Save', submit: (v) => BB.post(`/api/candidates/${c.id}/verify/${i.kind}`, { ...v, file: V.picked }) }).then((r) => { V.picked = null; if (r) { d = r; draw(); BB.toast('Saved'); } }); };
    draw();
  };

  // ---------- candidate: Verify your ID ----------
  V.cand = async (el) => {
    el.innerHTML = '<div class="card pad">Loading…</div>';
    let d; try { d = await BB.api('/api/cand/verify'); } catch (e) { el.innerHTML = `<div class="card pad">${esc(e.message)}</div>`; return; }
    const help = { aadhaar: 'Download a masked Aadhaar (only the last 4 digits show) from myaadhaar.uidai.gov.in and upload it here.', pan: 'A photo or scan of your PAN card.', address: 'Aadhaar, or a recent electricity / gas bill, rent agreement or bank statement with your address.', education: 'Your highest degree, diploma or 10th / 12th marksheet. From DigiLocker is best.', experience: 'Experience or relieving letters from your past employers.', salary: 'Your last 3 payslips, or Form 26AS from the income tax site.', uan: 'Log in at passbook.epfindia.gov.in with your UAN and download your service history.' };
    el.innerHTML = `<div class="stack"><div class="card pad stack-sm"><h3>${(d.asked || []).length ? 'Documents we need from you' : 'Verify your ID'}</h3><div class="small muted">${(d.asked || []).length ? 'Your recruiter asked for these. Upload a photo or PDF of each.' : 'Verified candidates are trusted more by jewellery companies and get offers faster.'} Only our team sees these papers; companies only see the result of the checks.</div>${d.summary === 'ID verified' || d.summary === 'Fully checked' ? '<div class="notice gold">✓ Your ID is verified</div>' : ''}</div>
      ${d.items.map((i) => `<div class="card pad row between verify-cand"><div class="grow"><b>${esc(i.label)}</b> ${i.status !== 'Not started' ? `<span class="badge ${stCls(i)}">${esc(i.status === 'Uploaded' ? 'Uploaded: being checked' : i.status)}</span>` : ''}<div class="small muted">${esc(help[i.kind] || '')}</div></div><button class="btn ${i.has_file ? '' : 'primary'} sm" data-vup="${i.kind}">${i.has_file ? 'Upload again' : 'Upload'}</button></div>`).join('')}
      <div class="card pad stack-sm">${d.declaration ? `<div class="small">✓ You declared on ${fmtD(d.declaration.at)} that you have no criminal case against you.</div>` : `<label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" data-vdecl style="margin-top:3px"> I declare that I have no criminal case against me, and that the documents I upload are mine and true.</label><button class="btn primary sm" style="width:max-content" data-vdgo>Save declaration</button>`}</div></div>`;
    $$('[data-vup]', el).forEach((b) => (b.onclick = async () => { const f = await BB.pickFile('.pdf,.jpg,.jpeg,.png'); if (!f) return; b.disabled = true; try { await BB.post('/api/cand/verify', { kind: b.dataset.vup, ...f }); BB.toast('Uploaded. Your recruiter will check it.'); V.cand(el); } catch (e) { BB.fail(e); b.disabled = false; } }));
    const dg = $('[data-vdgo]', el); if (dg) dg.onclick = async () => { if (!$('[data-vdecl]', el).checked) return BB.toast('Tick the box first', true); try { await BB.post('/api/cand/verify', { declare: true }); BB.toast('Saved'); V.cand(el); } catch (e) { BB.fail(e); } };
  };
})();
