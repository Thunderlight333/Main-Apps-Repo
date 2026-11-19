// Output handling designed for HUGE files:
//  - "ask"  : File System Access API (desktop Chrome/Edge). Output streams straight to the file you pick.
//  - "auto" : streams into the browser's private disk (OPFS) when available, then hands you a disk-backed file.
//  - else   : in-memory buffer (mobile Safari etc.).
import { settings } from './settings.js';
import { toast } from './ui.js';

const TMP = 'morph-tmp';
const canPickFile = () => 'showSaveFilePicker' in window && window.isSecureContext;
const canPickDir = () => 'showDirectoryPicker' in window && window.isSecureContext;
let opfsOk = null;
async function opfsDir() {
  if (opfsOk === false) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(TMP, { create: true });
    if (opfsOk === null) {
      const fh = await dir.getFileHandle('.probe', { create: true });
      opfsOk = typeof fh.createWritable === 'function';
      await dir.removeEntry('.probe').catch(() => {});
    }
    return opfsOk ? dir : null;
  } catch { opfsOk = false; return null; }
}
export async function clearTemp() {
  try { const root = await navigator.storage.getDirectory(); await root.removeEntry(TMP, { recursive: true }); } catch { /* none */ }
}
export const supportsStreamingSave = async () => canPickFile() || !!(await opfsDir());

/**
 * Must be called synchronously inside a click handler (before other awaits) so pickers are allowed.
 * Returns a "run" object shared by all jobs of one batch.
 */
export function startRun(count, firstName, mime) {
  const method = settings.get('saveMethod');
  const run = { method, dir: null, file: null, ready: Promise.resolve() };
  if (method === 'ask') {
    if (count > 1 && canPickDir()) run.ready = window.showDirectoryPicker({ mode: 'readwrite' }).then((d) => { run.dir = d; });
    else if (count === 1 && canPickFile()) {
      const ext = firstName.split('.').pop();
      run.ready = window.showSaveFilePicker({
        suggestedName: firstName,
        types: mime ? [{ description: ext.toUpperCase(), accept: { [mime]: ['.' + ext] } }] : undefined,
      }).then((f) => { run.file = f; });
    }
    run.ready = run.ready.catch((e) => { if (e.name === 'AbortError') throw e; run.dir = run.file = null; });
  }
  return run;
}

async function handleFor(run, name) {
  if (run.file) { const f = run.file; run.file = null; return { handle: f, disk: true }; }
  if (run.dir) return { handle: await run.dir.getFileHandle(uniqueName(run, name), { create: true }), disk: true };
  const tmp = await opfsDir();
  if (tmp) return { handle: await tmp.getFileHandle(`${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`, { create: true }), disk: false };
  return null;
}
function uniqueName(run, name) {
  run.used ||= new Set();
  let n = name, i = 1;
  while (run.used.has(n)) n = name.replace(/(\.[^.]+)?$/, ` (${i++})$1`);
  run.used.add(n);
  return n;
}

/** Streaming sink for mediabunny/ffmpeg. Returns { writable|null, finish(blob?) => Result } */
export async function openSink(run, name) {
  await run.ready;
  const h = await handleFor(run, name);
  if (!h) return { writable: null, finish: async (blob) => result(name, blob, false) };
  const writable = await h.handle.createWritable();
  return {
    writable,
    abort: async () => { try { await writable.abort(); } catch { /* closed */ } },
    finish: async () => { const f = await h.handle.getFile(); return result(name, f, h.disk); },
  };
}

/** Write a finished Blob (images, PDFs, zips). */
export async function writeBlob(run, name, blob) {
  await run.ready;
  if (run.file || run.dir) {
    const h = await handleFor(run, name);
    const w = await h.handle.createWritable();
    await w.write(blob); await w.close();
    return result(name, await h.handle.getFile(), true);
  }
  return result(name, blob, false);
}

function result(name, blob, savedToDisk) {
  return { name, size: blob.size, blob, savedToDisk, saved: savedToDisk };
}

export function download(res) {
  if (res.savedToDisk) { toast(`Already saved: ${res.name}`, 'success'); return; }
  const url = URL.createObjectURL(res.blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: res.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  res.saved = true;
}

export async function saveAll(results, zipName = 'morph-files.zip') {
  const pending = results.filter((r) => !r.savedToDisk);
  if (!pending.length) { toast('All files are already saved to disk', 'success'); return; }
  const z = settings.get('zipMultiple');
  const total = pending.reduce((a, r) => a + r.size, 0);
  const useZip = pending.length > 1 && (z === 'always' || (z === 'auto' && pending.length > 3)) && total < 1.5 * 1024 ** 3;
  if (!useZip) {
    for (const r of pending) { download(r); await new Promise((res) => setTimeout(res, 350)); }
    return;
  }
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set();
  for (const r of pending) {
    let n = r.name, i = 1;
    while (used.has(n)) n = r.name.replace(/(\.[^.]+)?$/, ` (${i++})$1`);
    used.add(n); zip.file(n, r.blob);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
  download({ name: zipName, blob, size: blob.size });
  pending.forEach((r) => (r.saved = true));
}

export async function shareResult(res) {
  const file = res.blob instanceof File ? res.blob : new File([res.blob], res.name, { type: res.blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: res.name }); } catch { /* cancelled */ }
  } else toast('Sharing is not supported on this device', 'error');
}
