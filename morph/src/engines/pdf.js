// PDF engine: pdf-lib (edit/assemble/encrypt) + pdf.js (render/text). Everything runs locally.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { decode } from './image.js';
import { baseName } from '../core/dom.js';

let _lib, _pdfjs;
export const lib = () => (_lib ||= import('@cantoo/pdf-lib'));
export async function pdfjs() {
  if (!_pdfjs) {
    _pdfjs = await import('pdfjs-dist');
    _pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return _pdfjs;
}
const bytes = async (f) => new Uint8Array(await f.arrayBuffer());
const pdfBlob = (u8) => new Blob([u8], { type: 'application/pdf' });

export async function load(file, password) {
  const { PDFDocument } = await lib();
  try {
    return await PDFDocument.load(await bytes(file), { password, updateMetadata: false });
  } catch (e) {
    if (/encrypt|password/i.test(e.message)) throw Object.assign(new Error('This PDF is password protected'), { needsPassword: true });
    return PDFDocument.load(await bytes(file), { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
  }
}
export async function openView(file, password) {
  const pj = await pdfjs();
  const task = pj.getDocument({ data: await bytes(file), password, isEvalSupported: false });
  try { return await task.promise; } catch (e) {
    if (e?.name === 'PasswordException') throw Object.assign(new Error('Password required'), { needsPassword: true });
    throw e;
  }
}
export async function renderPage(doc, n, { scale = 1, maxSide } = {}) {
  const page = await doc.getPage(n);
  let vp = page.getViewport({ scale });
  if (maxSide) vp = page.getViewport({ scale: (scale * maxSide) / Math.max(vp.width, vp.height) });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
  page.cleanup();
  return c;
}
export const closeView = (doc) => { try { (doc.loadingTask || doc).destroy?.(); } catch { /* already closed */ } };
const canvasBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

/** Parse "1-3, 5, 8-" style ranges into 0-based index groups. */
export function parseRanges(str, count) {
  const groups = [];
  for (const part of String(str).split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : count; } else { a = b = +part; }
    if (!a || !b) continue;
    a = Math.max(1, Math.min(count, a)); b = Math.max(1, Math.min(count, b));
    const g = []; for (let i = Math.min(a, b); i <= Math.max(a, b); i++) g.push(i - 1);
    groups.push(g);
  }
  return groups;
}

export async function merge(files, onProgress) {
  const { PDFDocument } = await lib();
  const out = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|avif|bmp|gif)$/i.test(f.name)) {
      await addImagePage(out, f, { pageSize: 'fit', margin: 0 });
    } else {
      const src = await load(f);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    onProgress?.((i + 1) / files.length);
  }
  return pdfBlob(await out.save());
}

export async function pickPages(file, plan, password) {
  // plan: [{ index, rotate? }]
  const { PDFDocument, degrees } = await lib();
  const src = await load(file, password);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, plan.map((p) => p.index));
  pages.forEach((p, i) => {
    if (plan[i].rotate) p.setRotation(degrees((p.getRotation().angle + plan[i].rotate) % 360));
    out.addPage(p);
  });
  return pdfBlob(await out.save());
}

export async function split(file, groups, onProgress) {
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    out.push(await pickPages(file, groups[i].map((index) => ({ index }))));
    onProgress?.((i + 1) / groups.length);
  }
  return out;
}

export async function rotate(file, deg, which) {
  const { degrees } = await lib();
  const doc = await load(file);
  doc.getPages().forEach((p, i) => { if (!which || which.includes(i)) p.setRotation(degrees((p.getRotation().angle + deg + 360) % 360)); });
  return pdfBlob(await doc.save());
}

export async function toImages(file, { format = 'jpg', dpi = 150, quality = 0.9, pages, password }, onProgress) {
  const doc = await openView(file, password);
  const list = pages || Array.from({ length: doc.numPages }, (_, i) => i);
  const out = [];
  const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[format];
  for (let k = 0; k < list.length; k++) {
    const c = await renderPage(doc, list[k] + 1, { scale: dpi / 72 });
    out.push({ page: list[k] + 1, blob: await canvasBlob(c, type, quality) });
    c.width = c.height = 0;
    onProgress?.((k + 1) / list.length);
  }
  closeView(doc);
  return out;
}

/** Compress. 'lossless' rewrites with object streams; other levels rasterize pages to JPEG. */
export async function compress(file, { level = 'recommended', grayscale = false } = {}, onProgress) {
  if (level === 'lossless') {
    const doc = await load(file);
    onProgress?.(0.5);
    const out = await doc.save({ useObjectStreams: true });
    onProgress?.(1);
    return pdfBlob(out);
  }
  const { dpi, q } = { extreme: { dpi: 72, q: 0.45 }, recommended: { dpi: 110, q: 0.62 }, light: { dpi: 150, q: 0.8 } }[level];
  const view = await openView(file);
  const { PDFDocument } = await lib();
  const out = await PDFDocument.create();
  for (let i = 1; i <= view.numPages; i++) {
    const page = await view.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const c = await renderPage(view, i, { scale: dpi / 72 });
    if (grayscale) {
      const ctx = c.getContext('2d'); ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    }
    const jpg = await out.embedJpg(new Uint8Array(await (await canvasBlob(c, 'image/jpeg', q)).arrayBuffer()));
    const p = out.addPage([vp1.width, vp1.height]);
    p.drawImage(jpg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    c.width = c.height = 0;
    onProgress?.(i / view.numPages);
  }
  closeView(view);
  return pdfBlob(await out.save({ useObjectStreams: true }));
}

const SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a5: [419.53, 595.28] };
async function addImagePage(doc, file, { pageSize = 'a4', orientation = 'auto', margin = 24, fit = 'contain' }) {
  const bmp = await decode(file);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.();
  const isPng = /png|gif|webp/i.test(file.type);
  const data = new Uint8Array(await (await canvasBlob(c, isPng ? 'image/png' : 'image/jpeg', 0.92)).arrayBuffer());
  const img = isPng ? await doc.embedPng(data) : await doc.embedJpg(data);
  let [pw, ph] = pageSize === 'fit' ? [img.width * 0.75, img.height * 0.75] : SIZES[pageSize];
  const land = orientation === 'landscape' || (orientation === 'auto' && img.width > img.height);
  if (pageSize !== 'fit' && land) [pw, ph] = [ph, pw];
  const m = pageSize === 'fit' ? 0 : margin;
  const page = doc.addPage([pw, ph]);
  const bw = pw - m * 2, bh = ph - m * 2;
  const s = fit === 'cover' ? Math.max(bw / img.width, bh / img.height) : Math.min(bw / img.width, bh / img.height);
  const w = img.width * s, hgt = img.height * s;
  page.drawImage(img, { x: (pw - w) / 2, y: (ph - hgt) / 2, width: w, height: hgt });
}
export async function imagesToPdf(files, opts, onProgress) {
  const { PDFDocument } = await lib();
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) { await addImagePage(doc, files[i], opts); onProgress?.((i + 1) / files.length); }
  return pdfBlob(await doc.save());
}

function hexRgb(hex, rgb) { const n = parseInt(hex.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }

export async function pageNumbers(file, { position = 'bottom-center', start = 1, size = 11, format = '{n}', color = '#333333', margin = 24 }) {
  const { StandardFonts, rgb } = await lib();
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages(); const total = pages.length;
  pages.forEach((p, i) => {
    const txt = format.replace('{n}', i + start).replace('{total}', total + start - 1);
    const { width, height } = p.getSize();
    const tw = font.widthOfTextAtSize(txt, size);
    const [v, hz] = position.split('-');
    const x = hz === 'left' ? margin : hz === 'right' ? width - margin - tw : (width - tw) / 2;
    const y = v === 'top' ? height - margin - size : margin;
    p.drawText(txt, { x, y, size, font, color: hexRgb(color, rgb) });
  });
  return pdfBlob(await doc.save());
}

export async function watermark(file, { text = 'CONFIDENTIAL', size = 48, opacity = 0.2, rotation = 45, color = '#ff0000', mode = 'center' }) {
  const { StandardFonts, rgb, degrees } = await lib();
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    const tw = font.widthOfTextAtSize(text, size);
    const draw = (cx, cy) => {
      const r = (rotation * Math.PI) / 180;
      p.drawText(text, { x: cx - (tw / 2) * Math.cos(r) + (size / 3) * Math.sin(r), y: cy - (tw / 2) * Math.sin(r) - (size / 3) * Math.cos(r), size, font, color: hexRgb(color, rgb), opacity, rotate: degrees(rotation) });
    };
    if (mode === 'tile') {
      for (let y = size; y < height + tw; y += tw * 0.9) for (let x = 0; x < width + tw; x += tw * 1.2) draw(x, y);
    } else draw(width / 2, height / 2);
  }
  return pdfBlob(await doc.save());
}

/** Overlays for Sign / Edit: [{ page, kind:'text'|'image', x, y, w, h (fractions of page, top-left origin), text, size, color, png:Blob }] */
export async function applyOverlays(file, overlays) {
  const { StandardFonts, rgb } = await lib();
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const o of overlays) {
    const p = pages[o.page]; if (!p) continue;
    const { width, height } = p.getSize();
    if (o.kind === 'text') {
      const size = o.size * height; // size stored as fraction of page height
      const lines = o.text.split('\n');
      lines.forEach((ln, i) => p.drawText(ln, { x: o.x * width, y: height - o.y * height - size * (i + 1) * 1.05 + size * 0.2, size, font, color: hexRgb(o.color || '#000000', rgb) }));
    } else {
      const img = await doc.embedPng(new Uint8Array(await o.png.arrayBuffer()));
      p.drawImage(img, { x: o.x * width, y: height - (o.y + o.h) * height, width: o.w * width, height: o.h * height });
    }
  }
  return pdfBlob(await doc.save());
}

export async function crop(file, { top = 0, right = 0, bottom = 0, left = 0 }) {
  const doc = await load(file);
  for (const p of doc.getPages()) {
    const { x, y, width, height } = p.getMediaBox();
    const box = [x + (width * left) / 100, y + (height * bottom) / 100, width * (1 - (left + right) / 100), height * (1 - (top + bottom) / 100)];
    p.setCropBox(...box); p.setMediaBox(...box);
  }
  return pdfBlob(await doc.save());
}

export async function protect(file, { userPassword, ownerPassword, allowPrint = true, allowCopy = false }) {
  const doc = await load(file);
  doc.encrypt({ userPassword, ownerPassword: ownerPassword || userPassword, permissions: { printing: allowPrint ? 'highResolution' : false, copying: allowCopy, modifying: false, annotating: allowCopy } });
  return pdfBlob(await doc.save());
}

export async function unlock(file, password) {
  const { PDFDocument } = await lib();
  const doc = await PDFDocument.load(await bytes(file), { password, updateMetadata: false });
  return pdfBlob(await doc.save());
}

export async function toText(file, onProgress) {
  const doc = await openView(file);
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '', lastY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { out += line.trimEnd() + '\n'; line = ''; }
      line += it.str + (it.hasEOL ? '\n' : ''); lastY = y;
    }
    out += line + `\n\n--- Page ${i} ---\n\n`;
    onProgress?.(i / doc.numPages);
  }
  closeView(doc);
  return new Blob([out], { type: 'text/plain' });
}

export async function textToPdf(text, { size = 11, pageSize = 'a4', mono = false } = {}) {
  const { PDFDocument, StandardFonts } = await lib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(mono ? StandardFonts.Courier : StandardFonts.Helvetica);
  const [pw, ph] = SIZES[pageSize]; const m = 50, lh = size * 1.4, maxW = pw - m * 2;
  // WinAnsi fonts can't draw every glyph; replace unsupported chars.
  const safe = (s) => [...s].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  const lines = [];
  for (const raw of text.replace(/\t/g, '    ').split(/\r?\n/)) {
    const words = safe(raw).split(/(\s+)/); let cur = '';
    for (const w of words) {
      if (font.widthOfTextAtSize(cur + w, size) > maxW && cur) { lines.push(cur); cur = w.trimStart(); } else cur += w;
    }
    lines.push(cur);
  }
  let page = doc.addPage([pw, ph]), y = ph - m;
  for (const ln of lines) {
    if (y < m) { page = doc.addPage([pw, ph]); y = ph - m; }
    page.drawText(ln, { x: m, y: y - size, size, font }); y -= lh;
  }
  return pdfBlob(await doc.save());
}

export async function repair(file) {
  const { PDFDocument } = await lib();
  const doc = await PDFDocument.load(await bytes(file), { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, doc.getPageIndices());
  pages.forEach((p) => out.addPage(p));
  return pdfBlob(await out.save());
}

export async function pageCount(file) {
  try { const d = await load(file); return d.getPageCount(); } catch (e) { if (e.needsPassword) return -1; throw e; }
}

// ---------------------------------------------------------------------------------------------
// OCR: add an invisible, searchable text layer. Pages keep their original look (nothing is re-rendered).
// ---------------------------------------------------------------------------------------------
/** Place a 1-page, text-only PDF (from OCR, made in "displayed" orientation) on top of a page. */
async function overlayLayer(doc, page, layerBytes, box) {
  const { degrees } = await lib();
  const [emb] = await doc.embedPdf(layerBytes);
  if (box) { page.drawPage(emb, box); return; }
  const { width: W, height: H } = page.getSize();
  const a = ((page.getRotation().angle % 360) + 360) % 360;
  if (a === 90) page.drawPage(emb, { x: W, y: 0, rotate: degrees(90), width: H, height: W });
  else if (a === 180) page.drawPage(emb, { x: W, y: H, rotate: degrees(180), width: W, height: H });
  else if (a === 270) page.drawPage(emb, { x: 0, y: H, rotate: degrees(270), width: H, height: W });
  else page.drawPage(emb, { x: 0, y: 0, width: W, height: H });
}
async function pageHasText(view, n) {
  const tc = await (await view.getPage(n)).getTextContent();
  return tc.items.reduce((a, it) => a + (it.str?.trim().length || 0), 0) > 25;
}
/** Make a PDF searchable. Returns { blob, text, done (pages read), skipped (already had text) }. */
export async function ocrPdf(file, { dpi = 200, skipText = true, onProgress, onStatus } = {}) {
  const { ocrImage } = await import('./ocr.js');
  const view = await openView(file);
  const doc = await load(file);
  const pages = doc.getPages();
  let text = '', done = 0, skipped = 0;
  try {
    for (let i = 0; i < pages.length; i++) {
      const sub = (p) => onProgress?.((i + p) / pages.length);
      if (skipText && await pageHasText(view, i + 1)) { skipped++; sub(1); continue; }
      onStatus?.(`Reading page ${i + 1} of ${pages.length}…`);
      const c = await renderPage(view, i + 1, { scale: dpi / 72 });
      const r = await ocrImage(c, { textLayer: true, dpi, onProgress: sub });
      c.width = c.height = 0;
      if (r.pdf) await overlayLayer(doc, pages[i], r.pdf);
      text += r.text + `\n\n--- Page ${i + 1} ---\n\n`;
      done++;
    }
  } finally { closeView(view); }
  return { blob: pdfBlob(await doc.save()), text, done, skipped };
}

/**
 * Scanned pages (JPEG/PNG blobs with pixel size) → PDF, optionally with OCR text layers.
 * pages: [{ blob, width, height, layer?: Uint8Array }]  pageSize: 'a4' | 'letter' | 'fit'
 */
export async function scansToPdf(pages, { pageSize = 'a4', dpi = 200, margin = 0, onProgress } = {}) {
  const { PDFDocument } = await lib();
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const data = new Uint8Array(await pg.blob.arrayBuffer());
    const img = pg.blob.type === 'image/png' ? await doc.embedPng(data) : await doc.embedJpg(data);
    const iw = (pg.width / dpi) * 72, ih = (pg.height / dpi) * 72;
    let pw = iw, ph = ih;
    if (pageSize !== 'fit') { [pw, ph] = SIZES[pageSize]; if (iw > ih) [pw, ph] = [ph, pw]; }
    const page = doc.addPage([pw, ph]);
    const s = pageSize === 'fit' ? 1 : Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih);
    const box = { x: (pw - iw * s) / 2, y: (ph - ih * s) / 2, width: iw * s, height: ih * s };
    page.drawImage(img, box);
    if (pg.layer) await overlayLayer(doc, page, pg.layer, box);
    onProgress?.((i + 1) / pages.length);
  }
  return pdfBlob(await doc.save());
}

// ---------------------------------------------------------------------------------------------
// Redact: black boxes that really remove what is underneath (those pages are flattened to images).
// ---------------------------------------------------------------------------------------------
/** Find text on every page. Returns boxes [{ page (0-based), x, y, w, h (fractions of the page) , text }]. */
export async function findText(view, matcher) {
  const pj = await pdfjs();
  const out = [];
  for (let n = 1; n <= view.numPages; n++) {
    const page = await view.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const str = it.str || '';
      if (!str.trim()) continue;
      const tx = pj.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(tx[2], tx[3]) || 10;
      const width = (it.width || 0) * vp.scale;
      const x = tx[4], base = tx[5];
      for (const [idx, len] of matcher(str)) {
        const x0 = x + width * (idx / str.length), w = width * (len / str.length);
        out.push({ page: n - 1, x: x0 / vp.width - 0.002, y: (base - fh * 0.95) / vp.height, w: w / vp.width + 0.004, h: (fh * 1.25) / vp.height, text: str.substr(idx, len) });
      }
    }
  }
  return out;
}
/** Make a matcher for findText: plain words (case-insensitive) or a RegExp. */
export function textMatcher(q) {
  const re = q instanceof RegExp ? new RegExp(q.source, q.flags.includes('g') ? q.flags : q.flags + 'g') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return (s) => { const r = []; let m; re.lastIndex = 0; while ((m = re.exec(s))) { if (!m[0].length) { re.lastIndex++; continue; } r.push([m.index, m[0].length]); } return r; };
}
export const PATTERNS = {
  email: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g,
  phone: /(\+?\d[\d ()-]{7,}\d)/g,
  number: /\b\d[\d -]{5,}\d\b/g,
};
/** boxes: [{ page, x, y, w, h }] fractions. Returns { blob, pages: number of redacted pages }. */
export async function redact(file, boxes, { dpi = 200, color = '#000000', onProgress } = {}) {
  const { PDFDocument } = await lib();
  const src = await load(file);
  const view = await openView(file);
  const out = await PDFDocument.create();
  const byPage = new Map();
  for (const b of boxes) { if (!byPage.has(b.page)) byPage.set(b.page, []); byPage.get(b.page).push(b); }
  const n = src.getPageCount();
  try {
    for (let i = 0; i < n; i++) {
      const list = byPage.get(i);
      if (!list) { const [p] = await out.copyPages(src, [i]); out.addPage(p); }
      else {
        const c = await renderPage(view, i + 1, { scale: dpi / 72 });
        const ctx = c.getContext('2d'); ctx.fillStyle = color;
        for (const b of list) ctx.fillRect(Math.floor(b.x * c.width) - 1, Math.floor(b.y * c.height) - 1, Math.ceil(b.w * c.width) + 2, Math.ceil(b.h * c.height) + 2);
        const vp = (await view.getPage(i + 1)).getViewport({ scale: 1 });
        const jpg = await out.embedJpg(new Uint8Array(await (await canvasBlob(c, 'image/jpeg', 0.9)).arrayBuffer()));
        const p = out.addPage([vp.width, vp.height]);
        p.drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
        c.width = c.height = 0;
      }
      onProgress?.((i + 1) / n);
    }
  } finally { closeView(view); }
  // Hidden info could also give things away: clear it.
  out.setTitle(''); out.setAuthor(''); out.setSubject(''); out.setKeywords([]); out.setProducer('Morph'); out.setCreator('Morph');
  return { blob: pdfBlob(await out.save()), pages: byPage.size };
}

// ---------------------------------------------------------------------------------------------
// PDF/A (archive): XMP "PDF/A-2b" tags, an sRGB colour profile (output intent), no JavaScript.
// ---------------------------------------------------------------------------------------------
function srgbIcc() {
  // A small ICC v2 display profile for sRGB (D50-adapted primaries, gamma 2.2).
  const tags = [];
  const enc = new TextEncoder();
  const xyz = (x, y, z) => { const b = new DataView(new ArrayBuffer(20)); b.setUint32(0, 0x58595a20); [x, y, z].forEach((v, i) => b.setInt32(8 + i * 4, Math.round(v * 65536))); return new Uint8Array(b.buffer); };
  const curv = () => { const b = new DataView(new ArrayBuffer(14)); b.setUint32(0, 0x63757276); b.setUint32(8, 1); b.setUint16(12, 0x0233); return new Uint8Array(b.buffer); };
  const desc = (s) => { const a = enc.encode(s + '\0'); const b = new Uint8Array(12 + a.length + 12 + 67); const d = new DataView(b.buffer); d.setUint32(0, 0x64657363); d.setUint32(8, a.length); b.set(a, 12); return b; };
  const text = (s) => { const a = enc.encode(s + '\0'); const b = new Uint8Array(8 + a.length); new DataView(b.buffer).setUint32(0, 0x74657874); b.set(a, 8); return b; };
  tags.push(['desc', desc('sRGB IEC61966-2.1')], ['cprt', text('No copyright, use freely')], ['wtpt', xyz(0.9642, 1, 0.8249)],
    ['rXYZ', xyz(0.4361, 0.2225, 0.0139)], ['gXYZ', xyz(0.3851, 0.7169, 0.0971)], ['bXYZ', xyz(0.1431, 0.0606, 0.7141)],
    ['rTRC', curv()], ['gTRC', curv()], ['bTRC', curv()]);
  const pad = (n) => (n + 3) & ~3;
  let off = 128 + 4 + tags.length * 12;
  const table = tags.map(([sig, data]) => { const e = { sig, data, off }; off = pad(off + data.length); return e; });
  const buf = new Uint8Array(off), dv = new DataView(buf.buffer);
  dv.setUint32(0, off); dv.setUint32(8, 0x02100000);
  buf.set(enc.encode('mntrRGB XYZ '), 12);
  const now = new Date(); [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), 0, 0, 0].forEach((v, i) => dv.setUint16(24 + i * 2, v));
  buf.set(enc.encode('acsp'), 36);
  dv.setInt32(68, Math.round(0.9642 * 65536)); dv.setInt32(72, 65536); dv.setInt32(76, Math.round(0.8249 * 65536));
  dv.setUint32(128, tags.length);
  table.forEach((e, i) => { buf.set(enc.encode(e.sig), 132 + i * 12); dv.setUint32(136 + i * 12, e.off); dv.setUint32(140 + i * 12, e.data.length); buf.set(e.data, e.off); });
  return buf;
}
const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
/** Returns { blob, unembeddedFonts }. */
export async function toPdfA(file) {
  const { PDFName, PDFString, PDFDict, PDFRawStream } = await lib();
  const doc = await load(file);
  const ctx = doc.context, cat = doc.catalog;
  // No JavaScript or auto-actions (not allowed in PDF/A).
  const names = cat.lookup(PDFName.of('Names'));
  if (names instanceof PDFDict) names.delete(PDFName.of('JavaScript'));
  cat.delete(PDFName.of('OpenAction')); cat.delete(PDFName.of('AA'));
  let unembedded = 0;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const d = obj instanceof PDFRawStream ? obj.dict : obj;
    if (!(d instanceof PDFDict)) continue;
    if (d.get(PDFName.of('S'))?.toString() === '/JavaScript') d.delete(PDFName.of('JS'));
    if (d.get(PDFName.of('Type'))?.toString() === '/FontDescriptor' && !d.get(PDFName.of('FontFile')) && !d.get(PDFName.of('FontFile2')) && !d.get(PDFName.of('FontFile3'))) unembedded++;
  }
  const title = doc.getTitle() || baseName(file.name || 'document');
  const now = new Date(), iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
  doc.setTitle(title); doc.setProducer('Morph'); doc.setCreator('Morph'); doc.setModificationDate(now);
  if (!doc.getCreationDate()) doc.setCreationDate(now);
  const created = (doc.getCreationDate() || now).toISOString().replace(/\.\d+Z$/, 'Z');
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(title)}</rdf:li></rdf:Alt></dc:title></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreateDate>${created}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate><xmp:CreatorTool>Morph</xmp:CreatorTool></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>Morph</pdf:Producer></rdf:Description>
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
  const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  cat.set(PDFName.of('Metadata'), ctx.register(meta));
  const iccRef = ctx.register(ctx.stream(srgbIcc(), { N: 3 }));
  const intent = ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: iccRef });
  cat.set(PDFName.of('OutputIntents'), ctx.obj([intent]));
  return { blob: pdfBlob(await doc.save({ useObjectStreams: false })), unembeddedFonts: unembedded };
}

// ---------------------------------------------------------------------------------------------
// Compare: words per page (for a text diff) and small page pictures (for a visual diff).
// ---------------------------------------------------------------------------------------------
export async function pageWords(view) {
  const out = [];
  for (let n = 1; n <= view.numPages; n++) {
    const tc = await (await view.getPage(n)).getTextContent();
    out.push(tc.items.map((it) => it.str || '').join(' ').split(/\s+/).filter(Boolean));
  }
  return out;
}
