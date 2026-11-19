// Video/audio engine built on Mediabunny (WebCodecs, hardware accelerated).
// Reads the input in slices (never loads the whole file) and can stream output to disk,
// so file size is limited only by the device's disk, not RAM.
import {
  Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, StreamTarget, Quality,
  Mp4OutputFormat, MovOutputFormat, WebMOutputFormat, MkvOutputFormat, Mp3OutputFormat, WavOutputFormat,
  OggOutputFormat, FlacOutputFormat, AdtsOutputFormat, canEncodeAudio, getFirstEncodableVideoCodec,
  getFirstEncodableAudioCodec, canEncodeVideo,
} from 'mediabunny';
import { settings } from '../core/settings.js';
import { openSink } from '../core/save.js';
import { effectiveHw } from '../core/power.js';

export const VIDEO_CONTAINERS = ['mp4', 'webm', 'mov', 'mkv'];
export const AUDIO_CONTAINERS = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'];
export const MIME = {
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg',
  m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', gif: 'image/gif', avi: 'video/x-msvideo',
};

let encodersReady;
function ensureEncoders() {
  encodersReady ||= (async () => {
    const jobs = [];
    if (!(await canEncodeAudio('mp3'))) jobs.push(import('@mediabunny/mp3-encoder').then((m) => m.registerMp3Encoder()));
    if (!(await canEncodeAudio('aac'))) jobs.push(import('@mediabunny/aac-encoder').then((m) => m.registerAacEncoder()));
    if (!(await canEncodeAudio('flac'))) jobs.push(import('@mediabunny/flac-encoder').then((m) => m.registerFlacEncoder()));
    await Promise.allSettled(jobs);
  })();
  return encodersReady;
}

export const hasWebCodecs = () => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';

/** Inspect a media file. */
export async function probe(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [v, a] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const duration = await input.computeDuration();
    const info = {
      duration, size: file.size, bitrate: duration ? (file.size * 8) / duration : 0,
      hasVideo: !!v, hasAudio: !!a, format: (await input.getFormat()).name,
    };
    if (v) {
      info.width = await v.getDisplayWidth(); info.height = await v.getDisplayHeight();
      info.rotation = await v.getRotation();
      info.videoCodec = await v.getCodec();
      info.canDecodeVideo = await v.canDecode();
      try { const st = await v.computePacketStats(120); info.fps = Math.round(st.averagePacketRate); } catch { info.fps = 30; }
    }
    if (a) {
      info.audioCodec = await a.getCodec();
      info.channels = await a.getNumberOfChannels(); info.sampleRate = await a.getSampleRate();
      info.canDecodeAudio = await a.canDecode();
    }
    return info;
  } finally { input.dispose?.(); }
}

function outputFormat(container, streaming) {
  switch (container) {
    case 'mp4': case 'm4a': return new Mp4OutputFormat({ fastStart: streaming ? false : 'in-memory' });
    case 'mov': return new MovOutputFormat({ fastStart: streaming ? false : 'in-memory' });
    case 'webm': return new WebMOutputFormat();
    case 'mkv': return new MkvOutputFormat();
    case 'mp3': return new Mp3OutputFormat();
    case 'wav': return new WavOutputFormat();
    case 'ogg': return new OggOutputFormat();
    case 'flac': return new FlacOutputFormat();
    case 'aac': return new AdtsOutputFormat();
    default: throw new Error(`Unsupported container: ${container}`);
  }
}

const VIDEO_PREF = { mp4: ['avc', 'hevc', 'av1'], mov: ['avc', 'hevc'], webm: ['vp9', 'av1', 'vp8'], mkv: ['avc', 'hevc', 'vp9', 'av1'] };
const AUDIO_PREF = { mp4: ['aac', 'opus'], mov: ['aac'], m4a: ['aac'], webm: ['opus', 'vorbis'], mkv: ['aac', 'opus'], ogg: ['opus', 'vorbis'], mp3: ['mp3'], wav: ['pcm-s16'], flac: ['flac'], aac: ['aac'] };

export async function bestVideoCodec(container, wanted, dims) {
  const prefs = VIDEO_PREF[container] || ['avc'];
  const list = wanted && prefs.includes(wanted) ? [wanted, ...prefs.filter((c) => c !== wanted)] : prefs;
  return getFirstEncodableVideoCodec(list, dims);
}
export async function supportsHevc() { try { return await canEncodeVideo('hevc', { width: 1920, height: 1080 }); } catch { return false; } }

/**
 * Transcode / convert / compress / edit.
 * opts: { container, video:{discard,codec,width,height,bitrate,fps,crop,rotate,flip}, audio:{discard,codec,bitrate,channels,sampleRate}, trim:{start,end} }
 */
export async function transcode(file, opts, { run, name, onProgress, signal }) {
  if (!hasWebCodecs()) throw Object.assign(new Error('WebCodecs not available'), { fallback: true });
  await ensureEncoders();
  const sink = await openSink(run, name);
  const streaming = !!sink.writable;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = streaming ? new StreamTarget(sink.writable, { chunked: true, chunkSize: 8 * 1024 * 1024 }) : new BufferTarget();
  const output = new Output({ format: outputFormat(opts.container, streaming), target });
  const audioOnly = AUDIO_CONTAINERS.includes(opts.container);
  const v = opts.video || {}, a = opts.audio || {};
  let conv;
  try {
    const vt = await input.getPrimaryVideoTrack();
    let vCodec;
    if (vt && !audioOnly && !v.discard) {
      const w = v.width || (await vt.getDisplayWidth()), hgt = v.height || (await vt.getDisplayHeight());
      vCodec = await bestVideoCodec(opts.container, v.codec, { width: w, height: hgt });
      if (!vCodec) throw Object.assign(new Error('No video encoder available on this device'), { fallback: true });
    }
    const aCodec = audioOnly || !a.discard ? await getFirstEncodableAudioCodec(AUDIO_PREF[opts.container] || ['aac']) : null;
    const trim = opts.trim && (opts.trim.start > 0 || opts.trim.end) ? { start: opts.trim.start || 0, end: opts.trim.end } : undefined;
    conv = await Conversion.init({
      input, output, tracks: 'primary', showWarnings: false, trim,
      tags: settings.get('keepMetadata') ? undefined : {},
      video: audioOnly || v.discard ? { discard: true } : {
        codec: vCodec,
        width: v.width ? even(v.width) : undefined,
        height: v.height ? even(v.height) : undefined,
        fit: v.width && v.height ? 'contain' : undefined,
        frameRate: v.fps || undefined,
        crop: v.crop || undefined,
        rotate: v.rotate || undefined,
        flip: v.flip || undefined,
        quality: v.bitrate ? new Quality({ bitrate: Math.round(v.bitrate) }) : v.quality ? new Quality(v.quality) : undefined,
        forceTranscode: v.forceTranscode || undefined,
        hardwareAcceleration: effectiveHw(),
      },
      audio: a.discard && !audioOnly ? { discard: true } : {
        codec: aCodec || undefined,
        quality: a.bitrate ? new Quality({ bitrate: Math.round(a.bitrate) }) : undefined,
        numberOfChannels: a.channels || undefined,
        sampleRate: a.sampleRate || undefined,
      },
    });
    if (!conv.isValid) {
      const why = conv.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(', ');
      throw Object.assign(new Error(`Can't process this file in the fast engine (${why || 'unsupported'})`), { fallback: true });
    }
    conv.onProgress = (p) => onProgress?.(p);
    const onAbort = () => conv.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    await conv.execute();
    signal?.removeEventListener('abort', onAbort);
    if (streaming) return await sink.finish();
    return await sink.finish(new Blob([target.buffer], { type: MIME[opts.container] || 'application/octet-stream' }));
  } catch (e) {
    await sink.abort?.();
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    if (/unsupported|not supported|could not|decode/i.test(e.message) && e.fallback === undefined) e.fallback = true;
    throw e;
  } finally { input.dispose?.(); }
}
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export { videoThumb } from './thumbs.js';

/** Evenly spaced thumbnails for the editor timeline. Yields data URLs. */
export async function* filmstrip(file, count, height = 56) {
  const { CanvasSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt || !(await vt.canDecode())) return;
    const dur = await input.computeDuration();
    const w = Math.round((height * (await vt.getDisplayWidth())) / (await vt.getDisplayHeight()));
    const sink = new CanvasSink(vt, { width: w * 2, height: height * 2, fit: 'cover', poolSize: 2 });
    const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * dur);
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (!wc) { yield null; continue; }
      const c = wc.canvas;
      if (c.convertToBlob) yield URL.createObjectURL(await c.convertToBlob({ type: 'image/jpeg', quality: 0.6 }));
      else yield c.toDataURL('image/jpeg', 0.6);
    }
  } finally { input.dispose?.(); }
}
