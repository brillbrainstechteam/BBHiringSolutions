/**
 * BrillBrains Hiring: send new resumes from the Google Drive CV folder to the portal, every 30 minutes.
 * Runs inside your Google account (script.google.com). No Google key leaves Google; the portal only receives files.
 *
 * Folders: any shape and any depth. Every folder under FOLDER_ID is read with a loop (a queue of folders still to
 * open), shortcuts to folders and files are followed, and no folder is read twice. Each resume goes with its folder
 * path ("B2B/Designer/CAD Designer/x.pdf"); the portal reads B2B/B2C, the department and the role from it, and
 * a path it does not recognise (e.g. "Pending Seggregatetion/Naukri") is fine: the resume is still matched.
 *
 * Set up once:
 *   1. Fill in SECRET below (DRIVE_PUSH_SECRET from the server .env). FOLDER_ID is already the Resume / CV folder.
 *   2. Project Settings (gear) -> tick "Show appsscript.json manifest file in editor", and replace that file's
 *      contents with the manifest at the bottom of this file (keeps Drive access read-only).
 *   3. Pick "setUp" in the function list at the top and click Run. Approve the access Google asks for.
 *   From then on it runs by itself every 30 minutes. To stop it: Triggers (clock icon) -> delete the trigger.
 *   To see what is in the folder without sending anything: pick "listOnly" and click Run.
 */
const PORTAL = 'https://hire.brillbrainsconsultants.com';
const FOLDER_ID = '1u_Y5VbSCNvPUDJJY1dUYdwhKmGBZZeNx'; // Candidate Management > Resume / CV
const SECRET = 'PASTE_DRIVE_PUSH_SECRET_HERE';           // the same code as DRIVE_PUSH_SECRET in the server .env
const RESUME = /\.(pdf|docx?|jpe?g|png)$/i;              // the files that are resumes (plus Google Docs)
const MAX_BYTES = 25 * 1024 * 1024;                      // the portal takes resumes up to 25 MB

// Every resume under the folder, at any depth: [{ id, v (last changed), path }]
function listResumes() {
  const out = []; const seenFolders = {}; const seenFiles = {}; const viaShortcut = [];
  const queue = [{ folder: DriveApp.getFolderById(FOLDER_ID), path: '' }]; // folders still to open
  while (queue.length) {
    const { folder, path } = queue.shift();
    const fid = folder.getId(); if (seenFolders[fid]) continue; seenFolders[fid] = true;
    // the files in this folder (a shortcut counts as the file or folder it points to)
    const files = folder.getFiles();
    while (files.hasNext()) {
      let f = files.next();
      if (f.getMimeType() === MimeType.SHORTCUT) {
        const target = f.getTargetId(); if (!target) continue;
        if (f.getTargetMimeType() === MimeType.FOLDER) { queue.push({ folder: DriveApp.getFolderById(target), path: `${path}${f.getName()}/` }); continue; }
        // a shortcut to a file: kept for the end, so a file that also sits in its own folder keeps that folder's path
        viaShortcut.push({ target, path }); continue;
      }
      const name = f.getName(); const isDoc = f.getMimeType() === MimeType.GOOGLE_DOCS;
      if (!isDoc && !RESUME.test(name)) continue;
      if (seenFiles[f.getId()]) continue; seenFiles[f.getId()] = true;
      out.push({ id: f.getId(), v: String(f.getLastUpdated().getTime()), path: path + name, isDoc });
    }
    // the folders inside it go to the back of the queue
    const subs = folder.getFolders();
    while (subs.hasNext()) { const d = subs.next(); queue.push({ folder: d, path: `${path}${d.getName()}/` }); }
  }
  // files reached only through a shortcut
  for (const s of viaShortcut) {
    if (seenFiles[s.target]) continue;
    let f; try { f = DriveApp.getFileById(s.target); } catch (e) { continue; } // no access to what it points to
    const name = f.getName(); const isDoc = f.getMimeType() === MimeType.GOOGLE_DOCS;
    if (!isDoc && !RESUME.test(name)) continue;
    seenFiles[s.target] = true; out.push({ id: s.target, v: String(f.getLastUpdated().getTime()), path: s.path + name, isDoc });
  }
  return out;
}

// Asks the portal which resumes are new or changed, and sends only those.
function sendNewResumes() {
  const files = listResumes();
  const want = new Set(post('/api/hooks/drive/new', { files: files.map((f) => ({ id: f.id, v: f.v })) }).ids || []);
  const started = Date.now(); let sent = 0; let left = 0;
  for (const f of files) {
    if (!want.has(f.id)) continue;
    if (Date.now() - started > 5 * 60 * 1000) { left++; continue; } // Google stops a run at 6 minutes: the rest go next run
    try {
      const file = DriveApp.getFileById(f.id);
      const blob = f.isDoc ? file.getAs(MimeType.PDF) : file.getBlob(); const bytes = blob.getBytes();
      if (bytes.length > MAX_BYTES) { console.log(`${f.path}: skipped (over 25 MB)`); continue; }
      const r = post('/api/hooks/drive/file', { id: f.id, v: f.v, path: f.isDoc ? `${f.path}.pdf` : f.path, base64: Utilities.base64Encode(bytes) });
      sent++; console.log(`${f.path}: ${r.status}${r.why ? ` (${r.why})` : ''}`);
    } catch (e) { console.log(`${f.path}: not sent (${e.message})`); }
  }
  console.log(`${files.length} resumes in the folder · ${want.size} new or changed · ${sent} sent${left ? ` · ${left} go in the next run` : ''}`);
}

// Shows what the script sees in the folder, grouped by folder. Sends nothing.
function listOnly() {
  const files = listResumes(); const byFolder = {};
  for (const f of files) { const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '(top)'; byFolder[dir] = (byFolder[dir] || 0) + 1; }
  Object.keys(byFolder).sort().forEach((d) => console.log(`${d}: ${byFolder[d]}`));
  console.log(`${files.length} resumes in ${Object.keys(byFolder).length} folders`);
}

function post(path, body) {
  const r = UrlFetchApp.fetch(PORTAL + path, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), headers: { 'X-Drive-Secret': SECRET }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error(`${path} said ${r.getResponseCode()}: ${r.getContentText().slice(0, 200)}`);
  return JSON.parse(r.getContentText() || '{}');
}

// Run once: sends what is there now, then every 30 minutes.
function setUp() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendNewResumes').timeBased().everyMinutes(30).create();
  sendNewResumes();
}

/* appsscript.json (manifest): read-only Drive, sending to the portal, and the 30-minute timer.
{
  "timeZone": "Asia/Kolkata",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]
}
*/
