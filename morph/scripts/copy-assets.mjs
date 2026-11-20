// Copies the ffmpeg.wasm core into /public so it is served locally (no CDN => works offline).
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@ffmpeg/core/dist/esm');
const dst = join(root, 'public/ffmpeg');
mkdirSync(dst, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const a = join(src, f), b = join(dst, f);
  if (!existsSync(b) || statSync(a).size !== statSync(b).size) copyFileSync(a, b);
}
console.log('ffmpeg core ready in public/ffmpeg');

// OCR (tesseract.js) and the AI runtime (onnxruntime-web): also served locally, cached on first use.
const copies = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']
    .map((f) => [`node_modules/tesseract.js-core/${f}`, `public/ocr/core/${f}`]),
  ['node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'public/ocr/lang/eng.traineddata.gz'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'public/ort/ort-wasm-simd-threaded.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'public/ort/ort-wasm-simd-threaded.mjs'],
];
for (const [a0, b0] of copies) {
  const a = join(root, a0), b = join(root, b0);
  mkdirSync(dirname(b), { recursive: true });
  if (!existsSync(b) || statSync(a).size !== statSync(b).size) copyFileSync(a, b);
}
console.log('OCR + AI runtime ready in public/ocr, public/ort');
