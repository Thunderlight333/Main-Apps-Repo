// Picks the best engine for a media job: fast WebCodecs engine first, ffmpeg.wasm as a universal fallback.
import { transcode, MIME } from './media.js';
import { runFFmpeg, argsFromOpts } from './ffmpeg.js';

const FFMPEG_ONLY = ['gif', 'avi'];
export async function processMedia(file, opts, ctx) {
  const mime = MIME[opts.container] || 'application/octet-stream';
  const viaFF = () => runFFmpeg(file, opts.container, argsFromOpts(opts), { ...ctx, mime });
  if (FFMPEG_ONLY.includes(opts.container) || (opts.speed && opts.speed !== 1)) return viaFF();
  try {
    return await transcode(file, opts, ctx);
  } catch (e) {
    if (e.cancelled || !e.fallback) throw e;
    console.warn('[morph] fast engine failed, falling back to ffmpeg:', e.message);
    ctx.onStatus?.('Switching to the universal engine…');
    return viaFF();
  }
}
