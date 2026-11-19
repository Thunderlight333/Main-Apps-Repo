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
