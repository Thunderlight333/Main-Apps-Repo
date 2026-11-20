// Small on-device AI models (onnxruntime-web, WebAssembly). Nothing is uploaded.
//  - Background removal: U²-Net small (u2netp, 4.5 MB, Apache-2.0)
//  - Face finding: Ultra-Light face detector RFB-320 (1.3 MB, MIT)
// The runtime and models live in /ort and /models, are downloaded the first time and cached for offline use.
import { decode, OffscreenCanvasOr } from './image.js';

const base = () => new URL('./', location.href).href;
let ortP = null;
const sessions = new Map();

async function ort() {
  return (ortP ||= import('onnxruntime-web/wasm').then((m) => {
    m.env.wasm.wasmPaths = base() + 'ort/';
    m.env.wasm.numThreads = 1; // threads need special server headers; one thread works everywhere
    m.env.wasm.proxy = false;
    m.env.logLevel = 'error'; // the face model prints harmless optimisation notes otherwise
    return m;
  }).catch((e) => { ortP = null; throw e; }));
}
async function session(name, onStatus) {
  if (sessions.has(name)) return sessions.get(name);
  const p = (async () => {
    onStatus?.('Loading the AI model (first time only)…');
    const o = await ort();
    const res = await fetch(base() + 'models/' + name);
    if (!res.ok) throw new Error('Could not load the AI model. Open Morph once while online to download it.');
    const buf = new Uint8Array(await res.arrayBuffer());
    return o.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
  })();
  sessions.set(name, p);
  p.catch(() => sessions.delete(name));
  return p;
}
/** Download the models + runtime ahead of time (for offline use). */
export async function prefetchAI() { await Promise.all([session('u2netp.onnx'), session('face-rfb-320.onnx')]); }

function canvasOf(w, hgt) { return OffscreenCanvasOr(w, hgt); }
async function toBitmap(src) { return src instanceof Blob ? decode(src) : src; }

// ---------------- Background removal ----------------
/**
 * Returns a canvas (same size as the photo, capped at maxSide) with the background made transparent,
 * or filled with `background` (a CSS color) when given.
 */
export async function removeBackground(src, { maxSide = 4096, background = null, onStatus } = {}) {
  const bmp = await toBitmap(src);
  const S = 320;
  const sess = await session('u2netp.onnx', onStatus);
  const o = await ort();
  onStatus?.('Finding the subject…');
  const small = canvasOf(S, S);
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0, S, S);
  const px = sctx.getImageData(0, 0, S, S).data;
  const input = new Float32Array(3 * S * S);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) input[c * S * S + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
  const feeds = { [sess.inputNames[0]]: new o.Tensor('float32', input, [1, 3, S, S]) };
  const out = await sess.run(feeds);
  const m = out[sess.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < S * S; i++) { if (m[i] < lo) lo = m[i]; if (m[i] > hi) hi = m[i]; }
  const mask = canvasOf(S, S), mctx = mask.getContext('2d');
  const md = mctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    let a = (m[i] - lo) / (hi - lo || 1);
    a = Math.min(1, Math.max(0, (a - 0.08) / 0.84)); // firm up the edges a little
    md.data[i * 4 + 3] = Math.round(a * 255);
  }
  mctx.putImageData(md, 0, 0);
  const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * sc), hgt = Math.round(bmp.height * sc);
  const outC = canvasOf(w, hgt), ctx = outC.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, hgt);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, w, hgt);
  if (background) { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = background; ctx.fillRect(0, 0, w, hgt); }
  ctx.globalCompositeOperation = 'source-over';
  if (src instanceof Blob) bmp.close?.();
  return outC;
}

// ---------------- Face finding ----------------
const FW = 320, FH = 240;
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};
function nms(boxes, thr = 0.35) {
  boxes.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const b of boxes) if (!keep.some((k) => iou(k, b) > thr)) keep.push(b);
  return keep;
}
async function detectIn(bmp, sx, sy, sw, sh, sess, o, minScore) {
  const c = canvasOf(FW, FH), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, FW, FH);
  const px = ctx.getImageData(0, 0, FW, FH).data;
  const input = new Float32Array(3 * FW * FH);
  for (let i = 0; i < FW * FH; i++) for (let ch = 0; ch < 3; ch++) input[ch * FW * FH + i] = (px[i * 4 + ch] - 127) / 128;
  const out = await sess.run({ [sess.inputNames[0]]: new o.Tensor('float32', input, [1, 3, FH, FW]) });
  const names = sess.outputNames;
  const scores = out[names.find((n) => /score/i.test(n)) || names[0]].data;
  // The model outputs ready-made corner boxes (x1, y1, x2, y2), 0..1 of the input.
  const boxes = out[names.find((n) => /box/i.test(n)) || names[1]].data;
  const n = scores.length / 2;
  const res = [];
  for (let i = 0; i < n; i++) {
    const s = scores[i * 2 + 1];
    if (s < minScore) continue;
    const x1 = boxes[i * 4], y1 = boxes[i * 4 + 1], x2 = boxes[i * 4 + 2], y2 = boxes[i * 4 + 3];
    res.push({ x: sx + x1 * sw, y: sy + y1 * sh, w: (x2 - x1) * sw, h: (y2 - y1) * sh, score: s });
  }
  return res.filter((b) => b.w > 2 && b.h > 2);
}
/** Find faces. Returns [{ x, y, w, h, score }] in photo pixels. Big photos are also scanned in tiles to catch small faces. */
export async function detectFaces(src, { minScore = 0.7, onStatus } = {}) {
  const bmp = await toBitmap(src);
  const sess = await session('face-rfb-320.onnx', onStatus);
  const o = await ort();
  onStatus?.('Looking for faces…');
  const W = bmp.width, H = bmp.height;
  let all = await detectIn(bmp, 0, 0, W, H, sess, o, minScore);
  if (Math.max(W, H) > 900) {
    // 3×3 overlapping tiles for small faces (group photos, crowds).
    const tw = W / 2, th = H / 2;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      all = all.concat(await detectIn(bmp, (i * W) / 4, (j * H) / 4, tw, th, sess, o, minScore + 0.05));
    }
  }
  if (src instanceof Blob) bmp.close?.();
  return nms(all);
}

/**
 * Blur or pixelate areas of a canvas. areas: [{ x, y, w, h, shape?: 'ellipse'|'rect' }] in canvas pixels.
 * strength 1..3. Works in every browser (no ctx.filter needed).
 */
export function blurAreas(canvas, areas, { mode = 'blur', strength = 2, pad = 0.18 } = {}) {
  const ctx = canvas.getContext('2d');
  for (const a of areas) {
    const px = a.w * pad, py = a.h * pad;
    const x = Math.max(0, Math.floor(a.x - px)), y = Math.max(0, Math.floor(a.y - py));
    const w = Math.min(canvas.width - x, Math.ceil(a.w + px * 2)), hgt = Math.min(canvas.height - y, Math.ceil(a.h + py * 2));
    if (w < 2 || hgt < 2) continue;
    const blocks = mode === 'pixelate' ? [10, 7, 5][strength - 1] || 7 : [8, 5, 3][strength - 1] || 5;
    const sw = Math.max(1, Math.round(blocks * (w / Math.max(w, hgt)))), sh = Math.max(1, Math.round(blocks * (hgt / Math.max(w, hgt))));
    const tmp = canvasOf(sw, sh), tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(canvas, x, y, w, hgt, 0, 0, sw, sh);
    ctx.save();
    ctx.beginPath();
    if ((a.shape || 'ellipse') === 'ellipse') ctx.ellipse(x + w / 2, y + hgt / 2, w / 2, hgt / 2, 0, 0, Math.PI * 2);
    else ctx.rect(x, y, w, hgt);
    ctx.clip();
    if (mode === 'pixelate') { ctx.imageSmoothingEnabled = false; ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, hgt); }
    else {
      // two passes of down/up-scaling give a soft blur
      const mid = canvasOf(sw * 4, sh * 4), mctx = mid.getContext('2d');
      mctx.imageSmoothingQuality = 'high'; mctx.drawImage(tmp, 0, 0, sw * 4, sh * 4);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(mid, 0, 0, sw * 4, sh * 4, x, y, w, hgt);
    }
    ctx.restore();
  }
  return canvas;
}
