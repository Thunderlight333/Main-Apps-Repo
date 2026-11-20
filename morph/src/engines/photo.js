// Photo tools engine: resize, crop, rotate/flip, watermark, remove hidden info (EXIF/GPS), and the
// document-scanner helpers (find the page, straighten it, clean it up). Everything runs on this device.
import { decode, render, encode, OffscreenCanvasOr, canEncode } from './image.js';
import { extOf } from '../core/dom.js';

export const ASPECTS = { '1:1': [1, 1], '4:5': [4, 5], '3:4': [3, 4], '2:3': [2, 3], '9:16': [9, 16], '16:9': [16, 9], '4:3': [4, 3], '3:2': [3, 2] };

/** Pick the output format: keep JPG/PNG/WebP, everything else becomes JPG. */
export async function outFormat(file, want = 'keep') {
  let e = extOf(file.name); if (e === 'jpeg' || e === 'jfif') e = 'jpg';
  let f = want === 'keep' ? (['jpg', 'png', 'webp'].includes(e) ? e : 'jpg') : want;
  if (f === 'avif' && !(await canEncode('avif'))) f = 'webp';
  return f;
}

/**
 * Apply photo operations to one photo and return { blob, format, width, height }.
 * ops: { resize?: { mode:'max'|'percent'|'exact', max, percent, width, height },
 *        crop?: { aspect:'1:1'…, anchor:'center'|'top'|'bottom' } | { rect: {x,y,w,h} (0..1) },
 *        rotate?: 0|90|180|270, flipH?, flipV?, watermark?: {...}, blur?: [areas], background?: '#fff',
 *        format: 'keep'|'jpg'|'png'|'webp', quality }
 */
export async function editPhoto(file, ops = {}, { canvasHook } = {}) {
  const bmp = await decode(file);
  try {
    const W = bmp.width, H = bmp.height;
    let crop;
    if (ops.crop?.rect) {
      const r = ops.crop.rect;
      crop = { left: Math.round(r.x * W), top: Math.round(r.y * H), width: Math.max(1, Math.round(r.w * W)), height: Math.max(1, Math.round(r.h * H)) };
    } else if (ops.crop?.aspect && ASPECTS[ops.crop.aspect]) {
      const [aw, ah] = ASPECTS[ops.crop.aspect];
      let cw = W, ch = H;
      if (W / H > aw / ah) cw = Math.round(H * aw / ah); else ch = Math.round(W * ah / aw);
      const anchor = ops.crop.anchor || 'center';
      const top = anchor === 'top' ? 0 : anchor === 'bottom' ? H - ch : Math.round((H - ch) / 2);
      crop = { left: Math.round((W - cw) / 2), top, width: cw, height: ch };
    }
    const cw = crop ? crop.width : W, ch = crop ? crop.height : H;
    let width, height, maxW, maxH;
    const r = ops.resize;
    if (r?.mode === 'percent' && r.percent) { width = Math.max(1, Math.round(cw * r.percent / 100)); height = Math.max(1, Math.round(ch * r.percent / 100)); }
    else if (r?.mode === 'exact' && (r.width || r.height)) {
      width = r.width || Math.round(cw * (r.height / ch)); height = r.height || Math.round(ch * (r.width / cw));
      if (r.width && r.height && r.fit === 'contain') { const s = Math.min(r.width / cw, r.height / ch); width = Math.round(cw * s); height = Math.round(ch * s); }
    } else if (r?.mode === 'max' && r.max) { maxW = r.max; maxH = r.max; }
    const format = await outFormat(file, ops.format || 'keep');
    const needsBg = format === 'jpg' || format === 'bmp';
    const canvas = render(bmp, { crop, width, height, maxW, maxH, rotate: ops.rotate || 0, flipH: !!ops.flipH, flipV: !!ops.flipV, background: needsBg ? ops.background || '#ffffff' : ops.background });
    if (ops.blur?.length) {
      const { blurAreas } = await import('./ai.js');
      // areas are in original-photo pixels; map them into the output canvas (no crop/rotate in the blur tool)
      const sx = canvas.width / cw, sy = canvas.height / ch;
      blurAreas(canvas, ops.blur.map((a) => ({ ...a, x: a.x * sx, y: a.y * sy, w: a.w * sx, h: a.h * sy })), { mode: ops.blurMode, strength: ops.blurStrength });
    }
    if (ops.watermark?.text) drawWatermark(canvas, ops.watermark);
    canvasHook?.(canvas);
    const blob = await encode(canvas, format, ops.quality ?? 0.9);
    return { blob, format, width: canvas.width, height: canvas.height, canvas };
  } finally { bmp.close?.(); }
}

/** wm: { text, size (% of the shorter side), opacity, color, position: 'tl'|'tc'|'tr'|'ml'|'c'|'mr'|'bl'|'bc'|'br'|'tile', angle, shadow } */
export function drawWatermark(canvas, wm) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const px = Math.max(8, Math.round(Math.min(W, H) * (wm.size || 5) / 100));
  ctx.save();
  ctx.globalAlpha = wm.opacity ?? 0.5;
  ctx.fillStyle = wm.color || '#ffffff';
  ctx.font = `700 ${px}px "Inter Variable", Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  if (wm.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = px * 0.15; ctx.shadowOffsetY = px * 0.04; }
  const tw = ctx.measureText(wm.text).width;
  const ang = ((wm.angle || 0) * Math.PI) / 180;
  const draw = (x, y) => { ctx.save(); ctx.translate(x, y); ctx.rotate(-ang); ctx.textAlign = 'center'; ctx.fillText(wm.text, 0, 0); ctx.restore(); };
  if (wm.position === 'tile') {
    const gx = tw + px * 3, gy = px * 4;
    for (let y = -H; y < H * 2; y += gy) for (let x = -W + ((y / gy) % 2) * gx / 2; x < W * 2; x += gx) draw(x, y);
  } else {
    const m = px * 0.9, p = wm.position || 'br';
    const x = p[1] === 'l' || p === 'ml' ? m + tw / 2 : p[1] === 'r' || p === 'mr' ? W - m - tw / 2 : W / 2;
    const y = p[0] === 't' ? m + px / 2 : p[0] === 'b' ? H - m - px / 2 : H / 2;
    draw(x, y);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Hidden info (metadata): read what a photo carries, and remove it without losing quality.
// ---------------------------------------------------------------------------------------------
const u8 = async (f) => new Uint8Array(await f.arrayBuffer());
/** What hidden info does this photo carry? { location, camera, date, orientation, other } */
export async function readMeta(file) {
  const info = { location: false, camera: '', date: '', orientation: 1, other: false };
  try {
    const b = await u8(file.slice(0, Math.min(file.size, 512 * 1024)));
    const exif = findExif(b);
    if (exif) parseExif(exif, info);
    if (b[0] === 0x89 && b[1] === 0x50) info.other = /tEXt|iTXt|zTXt|eXIf/.test(String.fromCharCode(...b.slice(0, 4096)));
  } catch { /* unreadable: treat as none */ }
  return info;
}
function findExif(b) {
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG: APP1 "Exif"
    let i = 2;
    while (i + 4 < b.length && b[i] === 0xff) {
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) return b.subarray(i + 10, i + 2 + len);
      if (m === 0xda) break;
      i += 2 + len;
    }
  } else if (b[0] === 0x52 && b[1] === 0x49) { // WebP: "EXIF" chunk
    let i = 12;
    while (i + 8 < b.length) {
      const id = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]), len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
      if (id === 'EXIF') { let s = b.subarray(i + 8, i + 8 + len); if (s[0] === 0x45 && s[1] === 0x78) s = s.subarray(6); return s; }
      i += 8 + len + (len & 1);
    }
  }
  return null;
}
function parseExif(t, info) {
  const le = t[0] === 0x49;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const str = (o, n) => { let s = ''; for (let k = 0; k < n && t[o + k]; k++) s += String.fromCharCode(t[o + k]); return s.trim(); };
  const ifd = u32(4);
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12, tag = u16(e), cnt = u32(e + 4), val = cnt > 4 ? u32(e + 8) : e + 8;
    if (tag === 0x8825) info.location = gpsHasCoords(dv, u32(e + 8), le);
    else if (tag === 0x0112) info.orientation = u16(e + 8);
    else if (tag === 0x010f || tag === 0x0110) info.camera = (info.camera + ' ' + str(val, cnt)).trim();
    else if (tag === 0x0132) info.date = str(val, cnt);
    else info.other = true;
  }
}
function gpsHasCoords(dv, off, le) {
  try { const n = dv.getUint16(off, le); for (let k = 0; k < n; k++) if ([2, 4].includes(dv.getUint16(off + 2 + k * 12, le))) return true; } catch { /* */ }
  return false;
}
/**
 * Remove hidden info. JPEG/PNG/WebP are cleaned losslessly (the picture is untouched) unless the photo is
 * rotated by its EXIF tag (then it's re-saved upright at high quality). Other formats become JPG.
 */
export async function stripMeta(file) {
  const e = extOf(file.name);
  const b = await u8(file);
  if (b[0] === 0xff && b[1] === 0xd8) {
    const meta = await readMeta(file);
    if (meta.orientation === 1 || !meta.orientation) return { blob: new Blob([stripJpeg(b)], { type: 'image/jpeg' }), format: 'jpg', lossless: true };
  } else if (b[0] === 0x89 && b[1] === 0x50) return { blob: new Blob([stripPng(b)], { type: 'image/png' }), format: 'png', lossless: true };
  else if (b[0] === 0x52 && b[1] === 0x49 && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return { blob: new Blob([stripWebp(b)], { type: 'image/webp' }), format: 'webp', lossless: true };
  const r = await editPhoto(file, { format: ['png', 'webp'].includes(e) ? e : 'jpg', quality: 0.93 });
  return { blob: r.blob, format: r.format, lossless: false };
}
function stripJpeg(b) {
  const parts = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const m = b[i + 1];
    if (m === 0xda) { parts.push(b.subarray(i)); break; } // image data starts: keep everything
    const len = (b[i + 2] << 8) | b[i + 3];
    const seg = b.subarray(i, i + 2 + len);
    // Drop EXIF/XMP (APP1), Photoshop/IPTC (APP13), comments, and other APPn except JFIF (APP0), ICC colour (APP2) and Adobe (APP14).
    const keep = !(m >= 0xe1 && m <= 0xef) || m === 0xe2 || m === 0xee;
    if (keep && m !== 0xfe) parts.push(seg);
    i += 2 + len;
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function stripPng(b) {
  const parts = [b.subarray(0, 8)];
  let i = 8;
  while (i + 8 <= b.length) {
    const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (!['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function stripWebp(b) {
  const parts = [];
  let i = 12, hasVP8X = false;
  while (i + 8 <= b.length) {
    const id = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const len = (b[i + 4] | b[i + 5] << 8 | b[i + 6] << 16 | b[i + 7] << 24) >>> 0;
    const end = i + 8 + len + (len & 1);
    if (id === 'VP8X') { hasVP8X = true; const c = b.slice(i, end); c[8] &= ~(0x08 | 0x04); parts.push(c); } // clear EXIF/XMP flags
    else if (id !== 'EXIF' && id !== 'XMP ') parts.push(b.subarray(i, end));
    i = end;
  }
  void hasVP8X;
  const size = 4 + parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(8 + size);
  out.set(b.subarray(0, 4), 0);
  new DataView(out.buffer).setUint32(4, size, true);
  out.set(b.subarray(8, 12), 8);
  let o = 12; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Document scanner helpers
// ---------------------------------------------------------------------------------------------
/** Guess the corners of a sheet of paper. Returns [[x,y] ×4] (TL, TR, BR, BL) in 0..1, or null. */
export function findPageCorners(bmp) {
  const S = 220;
  const sc = S / Math.max(bmp.width, bmp.height);
  const w = Math.max(8, Math.round(bmp.width * sc)), hgt = Math.max(8, Math.round(bmp.height * sc));
  const c = OffscreenCanvasOr(w, hgt), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, hgt);
  const d = ctx.getImageData(0, 0, w, hgt).data;
  const g = new Uint8Array(w * hgt);
  const hist = new Uint32Array(256);
  for (let i = 0; i < w * hgt; i++) { const v = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0; g[i] = v; hist[v]++; }
  // Otsu threshold: paper is usually brighter than what it lies on.
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = w * hgt - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = t; } }
  // Largest bright blob (flood fill).
  const seen = new Uint8Array(w * hgt);
  let bestBlob = null;
  const stack = new Int32Array(w * hgt);
  for (let s = 0; s < w * hgt; s++) {
    if (seen[s] || g[s] <= thr) continue;
    let top = 0, n = 0, tl = [0, 0], tr = [0, 0], br = [0, 0], bl = [0, 0], mtl = Infinity, mtr = -Infinity, mbr = -Infinity, mbl = Infinity;
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const p = stack[--top], x = p % w, y = (p / w) | 0; n++;
      if (x + y < mtl) { mtl = x + y; tl = [x, y]; } if (x - y > mtr) { mtr = x - y; tr = [x, y]; }
      if (x + y > mbr) { mbr = x + y; br = [x, y]; } if (x - y < mbl) { mbl = x - y; bl = [x, y]; }
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * hgt || seen[q] || g[q] <= thr) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        seen[q] = 1; stack[top++] = q;
      }
    }
    if (!bestBlob || n > bestBlob.n) bestBlob = { n, pts: [tl, tr, br, bl] };
  }
  if (!bestBlob || bestBlob.n < w * hgt * 0.12 || bestBlob.n > w * hgt * 0.985) return null;
  return bestBlob.pts.map(([x, y]) => [x / (w - 1), y / (hgt - 1)]);
}

/** Solve the 3×3 homography mapping 4 points (src) to 4 points (dst). */
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const hm = b.map((v, i) => v / A[i][i]);
  return [...hm, 1];
}
/**
 * Straighten the page inside 4 corners (0..1 of the photo, TL TR BR BL) into a flat rectangle.
 * Returns a canvas, at most maxSide pixels on the long side.
 */
export function warpPage(bmp, corners, maxSide = 2200) {
  const W = bmp.width, H = bmp.height;
  const P = corners.map(([x, y]) => [x * W, y * H]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let ow = Math.max(dist(P[0], P[1]), dist(P[3], P[2])), oh = Math.max(dist(P[0], P[3]), dist(P[1], P[2]));
  const s = Math.min(1, maxSide / Math.max(ow, oh)); ow = Math.max(8, Math.round(ow * s)); oh = Math.max(8, Math.round(oh * s));
  const src = OffscreenCanvasOr(W, H), sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0);
  const sd = sctx.getImageData(0, 0, W, H).data;
  const out = OffscreenCanvasOr(ow, oh), octx = out.getContext('2d');
  const od = octx.createImageData(ow, oh);
  const m = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], P); // output pixel → photo pixel
  const o = od.data;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const z = m[6] * x + m[7] * y + 1;
      const sx = (m[0] * x + m[1] * y + m[2]) / z, sy = (m[3] * x + m[4] * y + m[5]) / z;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const k = (y * ow + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) { o[k] = o[k + 1] = o[k + 2] = 255; o[k + 3] = 255; continue; }
      const fx = sx - x0, fy = sy - y0, i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) o[k + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
      o[k + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/** Scan look: 'original' | 'enhance' (brighter paper, stronger ink) | 'gray' | 'bw' (crisp black & white). */
export function scanFilter(canvas, mode) {
  if (!mode || mode === 'original') return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  if (mode === 'gray' || mode === 'enhance') {
    // per-channel auto levels (1% / 99%)
    const lo = [0, 0, 0], hi = [255, 255, 255];
    for (let c = 0; c < 3; c++) {
      const hist = new Uint32Array(256); for (let i = c; i < d.length; i += 4) hist[d[i]]++;
      let acc = 0; const n = W * H;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.01) { lo[c] = v; break; } }
      acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.04) { hi[c] = v; break; } }
    }
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, ((d[i + c] - lo[c]) * 255) / Math.max(1, hi[c] - lo[c])));
      if (mode === 'gray') { const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; d[i] = d[i + 1] = d[i + 2] = v; }
    }
  } else if (mode === 'bw') {
    // adaptive threshold (local mean over a window) via an integral image
    const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 1; y <= H; y++) { let row = 0; for (let x = 1; x <= W; x++) { row += g[(y - 1) * W + x - 1]; I[y * (W + 1) + x] = I[(y - 1) * (W + 1) + x] + row; } }
    const r = Math.max(8, Math.round(Math.min(W, H) / 40));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x1 = Math.max(0, x - r), y1 = Math.max(0, y - r), x2 = Math.min(W, x + r + 1), y2 = Math.min(H, y + r + 1);
      const sum = I[y2 * (W + 1) + x2] - I[y1 * (W + 1) + x2] - I[y2 * (W + 1) + x1] + I[y1 * (W + 1) + x1];
      const mean = sum / ((x2 - x1) * (y2 - y1));
      const v = g[y * W + x] < mean * 0.86 ? 0 : 255;
      const k = (y * W + x) * 4; d[k] = d[k + 1] = d[k + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
