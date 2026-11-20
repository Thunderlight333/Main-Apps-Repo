// Recent results: keeps copies of the latest finished files ON THIS DEVICE (IndexedDB), so they can be
// shared, saved again or opened in another tool from Home. Nothing is uploaded. Space is capped
// (Settings → Privacy) and the oldest results are removed first. Very large files are listed, not kept.
import { settings } from './settings.js';
import { kindOf } from './files.js';

const DB = 'morph-recent', STORE = 'items', MAX_ITEMS = 30;
let dbp = null;
const subs = new Set();

function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch((e) => { dbp = null; throw e; }));
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const changed = () => subs.forEach((f) => { try { f(); } catch { /* */ } });

/** Small JPEG preview (Blob) for photos, videos and PDFs. */
async function makeThumb(file, kind) {
  try {
    let url = null;
    if (kind === 'image') { const { thumbOf } = await import('../engines/image.js'); url = await thumbOf(file, 160); }
    else if (kind === 'video') { const { videoThumb } = await import('../engines/thumbs.js'); url = await videoThumb(file, 0.1, 200); }
    else if (kind === 'pdf') {
      const { openView, renderPage, closeView } = await import('../engines/pdf.js');
      const doc = await openView(file);
      const c = await renderPage(doc, 1, { maxSide: 200 });
      closeView(doc);
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
    }
    if (!url) return null;
    const b = await (await fetch(url)).blob();
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    return b;
  } catch { return null; }
}

export const recent = {
  /** Remember a finished result. res: { name, size, blob }. local=false for online tools (downloader). */
  async add(res, { tool = '', local = true } = {}) {
    if (!settings.get('recentKeep') || !res?.blob) return;
    try {
      const limit = (settings.get('recentSpace') || 1024) * 1024 * 1024;
      const file = res.blob instanceof File && res.blob.name === res.name ? res.blob : new File([res.blob], res.name, { type: res.blob.type });
      const kind = kindOf(file);
      const keep = file.size <= limit / 2;
      const rec = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: res.name, size: file.size, type: file.type, kind, tool, local, at: Date.now(),
        blob: keep ? file : null, thumb: await makeThumb(file, kind),
      };
      await tx('readwrite', (s) => s.put(rec));
      await recent.trim();
      changed();
    } catch (e) { console.warn('[morph] recent results not saved', e); }
  },
  /** Newest first. */
  async list() {
    try { const all = await tx('readonly', (s) => s.getAll()); return (all || []).sort((a, b) => b.at - a.at); }
    catch { return []; }
  },
  file: (rec) => (rec.blob ? (rec.blob instanceof File ? rec.blob : new File([rec.blob], rec.name, { type: rec.type })) : null),
  async remove(id) { try { await tx('readwrite', (s) => s.delete(id)); changed(); } catch { /* */ } },
  async clear() { try { await tx('readwrite', (s) => s.clear()); changed(); } catch { /* */ } },
  /** Drop the oldest results beyond the space limit or the item limit. */
  async trim() {
    const limit = (settings.get('recentSpace') || 1024) * 1024 * 1024;
    const all = await recent.list();
    let used = 0;
    const drop = [];
    all.forEach((r, i) => {
      used += r.blob ? r.size : 0;
      if (i >= MAX_ITEMS || used > limit) drop.push(r.id);
    });
    if (drop.length) await tx('readwrite', (s) => drop.forEach((id) => s.delete(id)));
    return drop.length;
  },
  async usage() { return (await recent.list()).reduce((a, r) => a + (r.blob ? r.size : 0), 0); },
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
};
