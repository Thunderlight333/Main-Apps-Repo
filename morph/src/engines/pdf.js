// PDF engine: pdf-lib (edit/assemble/encrypt) + pdf.js (render/text). Everything runs locally.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { decode } from './image.js';

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
