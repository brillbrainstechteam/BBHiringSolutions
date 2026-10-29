/* Screen protection for admin and sub admin logins in the team portal (the super admin is not limited).
   A web page cannot fully stop screenshots or a phone camera; this makes copying hard and every attempt traceable:
   - printing shows a blank page; Ctrl/⌘+P and Ctrl/⌘+S do nothing
   - the Print Screen key clears what it copied; the Windows key (Snipping Tool) and ⌘⇧3/4/5 blur the screen first
   - the portal blurs while another window or app is in front
   - no selecting, copying or right-click menu outside the boxes people type in
   - each blocked attempt is written to the history (who, when, what). */
(() => {
  let on = false; let veilTimer = null;
  const log = (what) => { try { BB.post('/api/security-event', { what }).catch(() => {}); } catch { /* never in the way */ } };
  const typing = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]');

  const veil = (ms) => {
    document.body.classList.add('guard-veil');
    clearTimeout(veilTimer); if (ms) veilTimer = setTimeout(() => { if (document.hasFocus()) document.body.classList.remove('guard-veil'); }, ms);
  };
  const unveil = () => { clearTimeout(veilTimer); document.body.classList.remove('guard-veil'); };

  const onKeyDown = (e) => {
    if (!on) return;
    const k = (e.key || '').toLowerCase(); const mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'p' || k === 's')) { e.preventDefault(); e.stopPropagation(); BB.toast(k === 'p' ? 'Printing is turned off for this login.' : 'Saving the page is turned off for this login.', true); log(k === 'p' ? 'print key' : 'save key'); return; }
    if (k === 'meta' || k === 'os' || (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(k))) { veil(2500); return; } // Snipping Tool (Win+Shift+S) / Mac screenshot keys
    if (mod && (k === 'c' || k === 'x') && !typing(e.target)) { e.preventDefault(); log('copy key'); }
  };
  const onKeyUp = (e) => {
    if (!on) return;
    if (e.key === 'PrintScreen') {
      try { navigator.clipboard && navigator.clipboard.writeText(''); } catch { /* not allowed here */ }
      veil(2500); BB.toast('Screenshots are not allowed for this login.', true); log('print screen key');
    }
  };
  const onCopy = (e) => { if (on && !typing(e.target)) { e.preventDefault(); log('copy'); } };
  const onMenu = (e) => { if (on && !typing(e.target)) e.preventDefault(); };
  const onBlur = () => { if (on) veil(0); };
  const onFocus = () => { if (on) unveil(); };
  const onVis = () => { if (!on) return; if (document.visibilityState === 'hidden') veil(0); else if (document.hasFocus()) unveil(); };
  const onPrint = () => { if (on) log('print'); };

  BB.guard = (u) => {
    if (!u || u.level === 'super') return BB.unguard();
    if (on) return;
    on = true; document.body.classList.add('guarded');
    window.addEventListener('keydown', onKeyDown, true); window.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('copy', onCopy, true); document.addEventListener('cut', onCopy, true); document.addEventListener('contextmenu', onMenu, true);
    window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeprint', onPrint);
  };
  BB.unguard = () => {
    if (!on) return; on = false; unveil(); document.body.classList.remove('guarded');
    window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('copy', onCopy, true); document.removeEventListener('cut', onCopy, true); document.removeEventListener('contextmenu', onMenu, true);
    window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('beforeprint', onPrint);
  };
})();
