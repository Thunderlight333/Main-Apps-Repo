// Photo engine: decode anything the browser (or libheif for HEIC) can read, then encode with canvas.
import { writeBlob } from '../core/save.js';
import { extOf } from '../core/dom.js';

export const IMAGE_OUT = ['jpg', 'png', 'webp', 'avif', 'bmp', 'ico', 'gif'];
export const IMG_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', gif: 'image/gif' };

const encSupport = {};
export async function canEncode(fmt) {
  if (['bmp', 'ico', 'png', 'jpg'].includes(fmt)) return true;
  if (fmt === 'gif') return false; // handled by ffmpeg path
  if (fmt in encSupport) return encSupport[fmt];
  const c = OffscreenCanvasOr(2, 2);
  c.getContext('2d').fillRect(0, 0, 2, 2);
  const b = await toBlob(c, IMG_MIME[fmt], 0.8).catch(() => null);
  return (encSupport[fmt] = !!b && b.type === IMG_MIME[fmt]);
}
export function OffscreenCanvasOr(w, hgt) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, hgt);
  const c = document.createElement('canvas'); c.width = w; c.height = hgt; return c;
}
export function toBlob(c, type, q) {
  if (c.convertToBlob) return c.convertToBlob({ type, quality: q });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q));
}

const isHeic = (f) => /heic|heif/i.test(f.type) || ['heic', 'heif'].includes(extOf(f.name));
/** Decode to an ImageBitmap (EXIF orientation applied). */
export async function decode(file) {
  let src = file;
  if (isHeic(file)) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* Safari can, others need libheif */ }
    const { heicTo } = await import('heic-to');
    src = await heicTo({ blob: file, type: 'image/png' });
  }
  try { return await createImageBitmap(src, { imageOrientation: 'from-image' }); } catch {
    // SVG and a few others need an <img>
    const url = URL.createObjectURL(src);
    try {
      const img = new Image(); img.decoding = 'async'; img.src = url; await img.decode();
      const w = img.naturalWidth || 1024, hgt = img.naturalHeight || 1024;
      return await createImageBitmap(img, { resizeWidth: w, resizeHeight: hgt });
    } finally { URL.revokeObjectURL(url); }
  }
}

export async function imageInfo(file) {
  const bmp = await decode(file);
  const info = { width: bmp.width, height: bmp.height, size: file.size };
  bmp.close?.();
  return info;
}

/** Draw bitmap into canvas with optional resize/rotate/flip/background. */
export function render(bmp, { maxW, maxH, width, height, rotate = 0, flipH = false, flipV = false, background, crop }) {
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (crop) ({ left: sx, top: sy, width: sw, height: sh } = crop);
  let w = width || sw, hgt = height || (width ? Math.round((sh / sw) * width) : sh);
  if (!width && height) w = Math.round((sw / sh) * height);
  if (maxW || maxH) {
    const s = Math.min(1, (maxW || Infinity) / w, (maxH || Infinity) / hgt);
    w = Math.max(1, Math.round(w * s)); hgt = Math.max(1, Math.round(hgt * s));
  }
  const swap = rotate === 90 || rotate === 270;
  const c = OffscreenCanvasOr(swap ? hgt : w, swap ? w : hgt);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(bmp, sx, sy, sw, sh, -w / 2, -hgt / 2, w, hgt);
  return c;
}

export async function encode(canvas, fmt, quality) {
  if (fmt === 'bmp') return encodeBMP(canvas);
  if (fmt === 'ico') return encodeICO(canvas);
  return toBlob(canvas, IMG_MIME[fmt], quality);
}

/**
 * opts: { format, quality(0-1), maxW, maxH, width, height, targetBytes, rotate, flipH, flipV, crop }
 * Returns a Blob.
 */
export async function convertImage(file, opts, onProgress) {
  const bmp = await decode(file);
  try {
    let fmt = opts.format;
    if (!(await canEncode(fmt))) fmt = fmt === 'avif' ? 'webp' : 'png';
    const needsBg = fmt === 'jpg' || fmt === 'bmp';
    let scale = 1;
    const base = { ...opts, background: needsBg ? opts.background || '#ffffff' : undefined };
    if (fmt === 'ico') { base.maxW = Math.min(base.maxW || 256, 256); base.maxH = Math.min(base.maxH || 256, 256); }
    let canvas = render(bmp, base);
    onProgress?.(0.4);
    if (!opts.targetBytes || ['png', 'bmp', 'ico'].includes(fmt)) {
      const out = await encode(canvas, fmt, opts.quality ?? 0.85);
      onProgress?.(1);
      return { blob: out, format: fmt, width: canvas.width, height: canvas.height };
    }
    // Target size: binary search quality, then downscale if even the lowest quality is too big.
    let best = null;
    for (let pass = 0; pass < 6; pass++) {
      let lo = 0.05, hi = 0.95;
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2;
        const b = await encode(canvas, fmt, q);
        if (b.size <= opts.targetBytes) { best = b; lo = q; } else hi = q;
        onProgress?.(0.4 + ((pass * 7 + i) / 42) * 0.6);
      }
      if (best) break;
      scale *= 0.75;
      canvas = render(bmp, { ...base, maxW: Math.round(bmp.width * scale), maxH: Math.round(bmp.height * scale) });
    }
    best ||= await encode(canvas, fmt, 0.05);
    onProgress?.(1);
    return { blob: best, format: fmt, width: canvas.width, height: canvas.height };
  } finally { bmp.close?.(); }
}

export async function processImage(file, opts, { run, name, onProgress }) {
  const r = await convertImage(file, opts, onProgress);
  const finalName = name.replace(/\.[^.]+$/, '.' + r.format);
  return writeBlob(run, finalName, r.blob);
}

// ---- Tiny encoders for formats canvas can't produce ----
function getPixels(canvas) {
  const ctx = canvas.getContext('2d');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
function encodeBMP(canvas) {
  const { width: w, height: hgt, data } = getPixels(canvas);
  const row = Math.ceil((w * 3) / 4) * 4, size = 54 + row * hgt;
  const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4d42, true); dv.setUint32(2, size, true); dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, hgt, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, row * hgt, true);
  for (let y = 0; y < hgt; y++) {
    let o = 54 + (hgt - 1 - y) * row;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; u8[o++] = data[i + 2]; u8[o++] = data[i + 1]; u8[o++] = data[i]; }
  }
  return new Blob([buf], { type: 'image/bmp' });
}
async function encodeICO(canvas) {
  const png = new Uint8Array(await (await toBlob(canvas, 'image/png')).arrayBuffer());
  const head = new ArrayBuffer(22), dv = new DataView(head);
  dv.setUint16(2, 1, true); dv.setUint16(4, 1, true);
  dv.setUint8(6, canvas.width >= 256 ? 0 : canvas.width); dv.setUint8(7, canvas.height >= 256 ? 0 : canvas.height);
  dv.setUint16(10, 1, true); dv.setUint16(12, 32, true); dv.setUint32(14, png.length, true); dv.setUint32(18, 22, true);
  return new Blob([head, png], { type: 'image/x-icon' });
}

/** Images -> GIF needs ffmpeg; Image->PDF lives in pdf engine. */
export async function thumbOf(file, max = 240) {
  try {
    const bmp = await decode(file);
    const c = render(bmp, { maxW: max, maxH: max });
    bmp.close?.();
    const b = await toBlob(c, 'image/jpeg', 0.7);
    return URL.createObjectURL(b);
  } catch { return null; }
}
