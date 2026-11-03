/* Candidate verification: masked Aadhaar, PAN, court record search, last employer reference.
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
  V.block = (c) => `<div class="sec" data-verify="${esc(c.id)}"><h3><span>Verification</span></h3><div class="card pad small muted">Loading…</div></div>`;
  V.mount = async (el, c) => {
    const box = $('[data-verify]', el); if (!box) return;
    let d; try { d = await BB.api(`/api/candidates/${c.id}/verify`); } catch (e) { box.remove(); return; }
    const draw = () => {
      box.innerHTML = `<h3><span>Verification ${V.badge(d.summary) || '<span class="badge b-outline">Not started</span>'}</span><span class="sec-act"><button class="btn sm" data-vask>Ask candidate to upload</button></span></h3>
        <div class="card verify-list">${d.items.map((i) => `<div class="verify-row"><div class="grow"><b>${esc(i.label)}</b> <span class="badge ${stCls(i)}">${esc(i.status)}</span>${i.note ? `<div class="tiny muted">${esc(i.note)}</div>` : ''}${i.by ? `<div class="tiny faint">${esc(i.by)} · ${fmtD(i.at)}</div>` : ''}</div><div class="row" style="gap:6px">${i.file ? `<button class="btn sm ghost" data-file="${esc(i.file)}">View</button>` : ''}<button class="btn sm" data-vrec="${i.kind}">${i.ok || i.bad ? 'Change' : 'Record'}</button></div></div>`).join('')}
        <div class="verify-row small ${d.declaration ? '' : 'muted'}">${d.declaration ? `✓ Candidate declared no criminal cases on ${fmtD(d.declaration.at)}` : 'No declaration from the candidate yet'}</div></div>`;
      $$('[data-vrec]', box).forEach((b) => (b.onclick = () => record(d.items.find((i) => i.kind === b.dataset.vrec))));
      $('[data-vask]', box).onclick = () => { BB.copy(`${location.origin}/my-profile/verify`); BB.toast('Link copied: send it to the candidate. They upload masked Aadhaar and PAN there.'); };
    };
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
    const help = { aadhaar: 'Download a masked Aadhaar (only the last 4 digits show) from myaadhaar.uidai.gov.in and upload it here.', pan: 'A photo or scan of your PAN card.' };
    el.innerHTML = `<div class="stack"><div class="card pad stack-sm"><h3>Verify your ID</h3><div class="small muted">Verified candidates are trusted more by jewellery companies and get offers faster. Only your recruiter sees these papers; companies only see that you are verified.</div>${d.summary === 'ID verified' || d.summary === 'Fully checked' ? '<div class="notice gold">✓ Your ID is verified</div>' : ''}</div>
      ${d.items.map((i) => `<div class="card pad row between verify-cand"><div class="grow"><b>${esc(i.label)}</b> ${i.status !== 'Not started' ? `<span class="badge ${stCls(i)}">${esc(i.status === 'Uploaded' ? 'Uploaded: being checked' : i.status)}</span>` : ''}<div class="small muted">${esc(help[i.kind] || '')}</div></div><button class="btn ${i.has_file ? '' : 'primary'} sm" data-vup="${i.kind}">${i.has_file ? 'Upload again' : 'Upload'}</button></div>`).join('')}
      <div class="card pad stack-sm">${d.declaration ? `<div class="small">✓ You declared on ${fmtD(d.declaration.at)} that you have no criminal case against you.</div>` : `<label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" data-vdecl style="margin-top:3px"> I declare that I have no criminal case against me, and that the documents I upload are mine and true.</label><button class="btn primary sm" style="width:max-content" data-vdgo>Save declaration</button>`}</div></div>`;
    $$('[data-vup]', el).forEach((b) => (b.onclick = async () => { const f = await BB.pickFile('.pdf,.jpg,.jpeg,.png'); if (!f) return; b.disabled = true; try { await BB.post('/api/cand/verify', { kind: b.dataset.vup, ...f }); BB.toast('Uploaded. Your recruiter will check it.'); V.cand(el); } catch (e) { BB.fail(e); b.disabled = false; } }));
    const dg = $('[data-vdgo]', el); if (dg) dg.onclick = async () => { if (!$('[data-vdecl]', el).checked) return BB.toast('Tick the box first', true); try { await BB.post('/api/cand/verify', { declare: true }); BB.toast('Saved'); V.cand(el); } catch (e) { BB.fail(e); } };
  };
})();
