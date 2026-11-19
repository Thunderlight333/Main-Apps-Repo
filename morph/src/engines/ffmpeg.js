// ffmpeg.wasm fallback: handles exotic inputs (AVI, WMV, FLV, ...) and special outputs (GIF, AVI, speed change).
// Loaded lazily from the app's own folder (no CDN), cached by the service worker for offline use.
import { settings } from '../core/settings.js';
import { writeBlob } from '../core/save.js';

let ff = null, loading = null;
const coreBase = () => new URL('ffmpeg/', document.baseURI).href;

export async function loadFFmpeg(onStatus) {
  if (ff) return ff;
  loading ||= (async () => {
    onStatus?.('Loading the universal engine (first time only)…');
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const inst = new FFmpeg();
    await inst.load({ coreURL: coreBase() + 'ffmpeg-core.js', wasmURL: coreBase() + 'ffmpeg-core.wasm' });
    ff = inst;
    return inst;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
export async function isFFmpegCached() {
  try { const c = await caches.open('morph-ffmpeg'); return !!(await c.match(coreBase() + 'ffmpeg-core.wasm')); } catch { return false; }
}
/** Pre-download the core so it works offline later. */
export async function cacheFFmpeg(onProgress) {
  const c = await caches.open('morph-ffmpeg');
  for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
    const url = coreBase() + f;
    if (await c.match(url)) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Download failed');
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader(); const parts = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress?.(f.endsWith('wasm') && total ? got / total : 0); }
    await c.put(url, new Response(new Blob(parts), { headers: { 'content-type': res.headers.get('content-type') || '' } }));
  }
}

function terminate() { try { ff?.terminate(); } catch { /* */ } ff = null; loading = null; }

/**
 * Run ffmpeg on one input file. buildArgs(inPath, outPath) => string[]
 * Input is mounted with WORKERFS (read lazily, not copied into memory).
 */
export async function runFFmpeg(file, outExt, buildArgs, { run, name, mime, onProgress, onStatus, signal, duration }) {
  if (!settings.get('ffmpegFallback')) throw new Error('This file needs the universal engine, which is turned off in Settings.');
  const inst = await loadFFmpeg(onStatus);
  onStatus?.('Processing with the universal engine…');
  const dir = '/in' + Math.random().toString(36).slice(2, 8);
  const safe = 'input.' + (file.name.split('.').pop() || 'bin').replace(/[^\w]/g, '');
  const inFile = new File([file], safe, { type: file.type });
  const outPath = `/out-${Date.now()}.${outExt}`;
  const onProg = ({ progress, time }) => {
    let p = progress;
    if ((!p || p < 0 || p > 1) && duration && time) p = time / 1e6 / duration;
    onProgress?.(Math.max(0, Math.min(1, p || 0)));
  };
  const onAbort = () => terminate();
  const logs = [];
  const onLog = ({ message }) => { logs.push(message); if (logs.length > 30) logs.shift(); };
  inst.on('progress', onProg);
  inst.on('log', onLog);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await inst.createDir(dir);
    await inst.mount('WORKERFS', { files: [inFile] }, dir);
    const code = await inst.exec(buildArgs(`${dir}/${safe}`, outPath));
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    if (code !== 0) { console.warn('[morph] ffmpeg log:\n' + logs.join('\n')); const all = logs.join('\n');
      if (/does not contain any stream|matches no streams/i.test(all)) throw new Error('This file has no track of the kind needed for that format (e.g. no audio for MP3).');
      throw new Error('The universal engine could not process this file.'); }
    const data = await inst.readFile(outPath);
    await inst.deleteFile(outPath).catch(() => {});
    return await writeBlob(run, name, new Blob([data.buffer], { type: mime }));
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    throw e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (ff) { ff.off('progress', onProg); ff.off('log', onLog); await ff.unmount(dir).catch(() => {}); await ff.deleteDir(dir).catch(() => {}); }
  }
}

/** Build generic ffmpeg args from the same option object used by the fast engine. */
export function argsFromOpts(opts) {
  return (inp, out) => {
    const a = [];
    if (opts.trim?.start) a.push('-ss', String(opts.trim.start));
    a.push('-i', inp);
    if (opts.trim?.end) a.push('-t', String(opts.trim.end - (opts.trim.start || 0)));
    const v = opts.video || {}, au = opts.audio || {};
    const c = opts.container;
    const vf = [];
    const af = [];
    if (v.rotate === 90) vf.push('transpose=1'); else if (v.rotate === 180) vf.push('hflip,vflip'); else if (v.rotate === 270) vf.push('transpose=2');
    if (v.flip) vf.push('hflip');
    if (v.crop) vf.push(`crop=${v.crop.width}:${v.crop.height}:${v.crop.left}:${v.crop.top}`);
    if (opts.speed && opts.speed !== 1) {
      vf.push(`setpts=${(1 / opts.speed).toFixed(4)}*PTS`);
      let s = opts.speed; const chain = [];
      while (s > 2) { chain.push('atempo=2'); s /= 2; } while (s < 0.5) { chain.push('atempo=0.5'); s /= 0.5; }
      chain.push(`atempo=${s.toFixed(4)}`); af.push(chain.join(','));
    }
    if (c === 'gif') {
      const fps = v.fps || 12, w = v.width || 480;
      vf.push(`fps=${fps},scale=${w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`);
      a.push('-filter_complex', `[0:v]${vf.join(',')}`, '-loop', '0', out);
      return a;
    }
    if (v.width || v.height) vf.push(`scale=${v.width ? Math.round(v.width / 2) * 2 : -2}:${v.height ? Math.round(v.height / 2) * 2 : -2}`);
    if (v.fps) a.push('-r', String(v.fps));
    const audioOnly = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'].includes(c);
    if (audioOnly || v.discard) a.push('-vn');
    else {
      if (vf.length) a.push('-vf', vf.join(','));
      const codec = c === 'webm' ? 'libvpx' : 'libx264';
      a.push('-c:v', codec);
      if (codec === 'libx264') a.push('-preset', 'veryfast', '-pix_fmt', 'yuv420p');
      if (v.bitrate) a.push('-b:v', String(Math.round(v.bitrate)));
      else a.push(...(codec === 'libx264' ? ['-crf', '23'] : ['-crf', '30', '-b:v', '0']));
    }
    if (au.discard && !audioOnly) a.push('-an');
    else {
      if (af.length) a.push('-af', af.join(','));
      const ac = { mp3: 'libmp3lame', wav: 'pcm_s16le', ogg: 'libvorbis', flac: 'flac', webm: 'libvorbis' }[c] || 'aac';
      a.push('-c:a', ac);
      if (au.bitrate && !['wav', 'flac'].includes(c)) a.push('-b:a', String(Math.round(au.bitrate)));
    }
    if (c === 'mp4' || c === 'mov' || c === 'm4a') a.push('-movflags', '+faststart');
    a.push(out);
    return a;
  };
}
