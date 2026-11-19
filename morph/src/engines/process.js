// Picks the best engine for a media job: fast WebCodecs engine first, ffmpeg.wasm as a universal fallback.
import { transcode, MIME } from './media.js';
import { runFFmpeg, argsFromOpts } from './ffmpeg.js';

const FFMPEG_ONLY = ['gif', 'avi'];
export async function processMedia(file, opts, ctx) {
  const mime = MIME[opts.container] || 'application/octet-stream';
  const au = opts.audio || {};
  const viaFF = () => runFFmpeg(file, opts.container, argsFromOpts(opts), { ...ctx, mime, extraFiles: au.music ? [au.music.file] : [] });
  const soundFx = !au.discard && (au.music || (au.volume != null && au.volume !== 1) || au.fadeIn || au.fadeOut);
  if (FFMPEG_ONLY.includes(opts.container) || (opts.speed && opts.speed !== 1) || soundFx) return viaFF();
  try {
    return await transcode(file, opts, ctx);
  } catch (e) {
    if (e.cancelled || !e.fallback) throw e;
    console.warn('[morph] fast engine failed, falling back to ffmpeg:', e.message);
    ctx.onStatus?.('Switching to the universal engine…');
    return viaFF();
  }
}
