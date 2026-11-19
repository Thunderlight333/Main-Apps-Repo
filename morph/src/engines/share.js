// Share links (Gyazo-style): upload a file to the Morph companion server and get a short link.
// /v/<id> is a viewing page, /v/<id>.<ext> the file itself. On the same Wi-Fi they open without internet.
import { serverBase, checkServer } from './downloader.js';

const KEY = 'morph.links.v1';
export function myLinks() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function saveLinks(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ } }

/** The address other devices should use. "localhost" only works on this computer, so swap in its Wi-Fi address. */
export function publicBase(health) {
  const base = serverBase();
  if (base === null) return null;
  const origin = base === '' ? location.origin : base;
  const host = new URL(origin).hostname;
  if (['localhost', '127.0.0.1', '[::1]'].includes(host) && health?.lan?.length) return health.lan[0];
  return origin;
}

export async function shareStatus() {
  const s = await checkServer();
  return { ok: !!(s.ok && s.share), health: s };
}

/** Upload with progress (XHR streams the file from disk, so very large videos work). */
export function upload(file, { ttl = 0, onProgress, signal, health }) {
  const api = serverBase();
  const pub = publicBase(health);
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${api}/api/share?ttl=${ttl}`);
    x.setRequestHeader('x-name', encodeURIComponent(file.name));
    x.setRequestHeader('content-type', file.type || 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let j = {}; try { j = JSON.parse(x.responseText); } catch { /* */ }
      if (x.status !== 200) return reject(new Error(j.error || `Upload failed (${x.status})`));
      const link = {
        id: j.id, name: file.name, size: j.size, type: file.type, created: Date.now(), expires: j.expires, key: j.key,
        api, page: pub + j.page, file: pub + j.file,
      };
      saveLinks([link, ...myLinks()]);
      resolve(link);
    };
    x.onerror = () => reject(new Error('Could not reach the Morph server'));
    x.onabort = () => reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
    signal?.addEventListener('abort', () => x.abort(), { once: true });
    x.send(file);
  });
}

export function updateLink(id, patch) { saveLinks(myLinks().map((l) => (l.id === id ? { ...l, ...patch } : l))); }

/** Views count, or null when the link is gone (expired or deleted). */
export async function linkStats(l) {
  try {
    const r = await fetch(`${l.api}/api/share/${l.id}`, { signal: AbortSignal.timeout(4000) });
    if (r.status === 404) return null;
    return r.ok ? await r.json() : undefined;
  } catch { return undefined; } // server offline: unknown
}

export async function removeLink(l) {
  try { await fetch(`${l.api}/api/share/${l.id}`, { method: 'DELETE', headers: { 'x-morph-key': l.key } }); } catch { /* server offline: forget locally */ }
  saveLinks(myLinks().filter((x) => x.id !== l.id));
}

/** QR code as an SVG element (generated on the device, no internet needed). */
export async function qrSvg(text) {
  const { default: qrcode } = await import('qrcode-generator');
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const wrap = document.createElement('div');
  wrap.innerHTML = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  const svg = wrap.firstElementChild;
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code for the link');
  return svg;
}
