// Compressor with smart presets (recommended per file), target-size mode and a full custom mode.
import { h, fmtBytes, fmtTime, extOf } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, dropZone, createQueue, queueBar } from '../core/components.js';
import { segmented, slider, select, field } from '../core/ui.js';
import { outName } from '../core/files.js';
import { startRun } from '../core/save.js';
import { settings } from '../core/settings.js';
import { processImage, imageInfo, canEncode } from '../engines/image.js';
import { processMedia } from '../engines/process.js';
import { probe, supportsHevc } from '../engines/media.js';
import { guardBigJob, isHeavyMedia } from '../core/power.js';

const REF = { 2160: 16e6, 1440: 9e6, 1080: 5e6, 720: 2.5e6, 480: 1.2e6, 360: 0.7e6 };
const ref = (hgt) => { const k = Object.keys(REF).map(Number).sort((a, b) => a - b).find((x) => hgt <= x) || 2160; return REF[k] * (hgt / k) ** 0.9; };
const codecGain = (c) => (c === 'hevc' || c === 'av1' ? 0.62 : c === 'vp9' ? 0.72 : 1);

const VIDEO_PRESETS = [
  { id: 'recommended', name: 'Recommended', desc: 'Best size/quality balance', icon: 'star' },
  { id: 'high', name: 'High quality', desc: 'Barely noticeable', icon: 'sparkle' },
  { id: 'small', name: 'Small', desc: '720p, great for sharing', icon: 'compress' },
  { id: 'tiny', name: 'Tiny', desc: '480p, smallest file', icon: 'gauge' },
  { id: 'target', name: 'Target size', desc: 'Fit a size limit', icon: 'bolt' },
  { id: 'custom', name: 'Custom', desc: 'Full control', icon: 'settings' },
];
const IMAGE_PRESETS = [
  { id: 'recommended', name: 'Recommended', desc: 'Looks the same, much smaller', icon: 'star' },
  { id: 'high', name: 'High quality', desc: 'Light compression', icon: 'sparkle' },
  { id: 'small', name: 'Small', desc: 'WebP · max 1920 px', icon: 'compress' },
  { id: 'tiny', name: 'Tiny', desc: 'WebP · max 1280 px', icon: 'gauge' },
  { id: 'target', name: 'Target size', desc: 'e.g. under 500 KB', icon: 'bolt' },
  { id: 'custom', name: 'Custom', desc: 'Format, quality, size', icon: 'settings' },
];
const TARGETS_MB = [{ v: 8, l: 'Discord' }, { v: 16, l: 'WhatsApp' }, { v: 25, l: 'Email' }, { v: 50, l: '50 MB' }, { v: 100, l: '100 MB' }];

export default function compressView({ files }) {
  const st = {
    v: { preset: 'recommended', targetMB: 25, qPct: 60, res: 0, fps: 0, codec: 'auto', container: 'mp4', audio: 128 },
    i: { preset: 'recommended', targetKB: 500, quality: 0.75, max: 0, format: 'keep' },
    a: { kbps: 96, format: 'm4a' },
  };
  let hevc = false;
  supportsHevc().then((x) => { hevc = x; renderOpts(); });

  const optsHost = h('div.opts');
  const queue = createQueue({
    accept: (f) => /^(video|image|audio)/.test(kindOfSafe(f)),
    onChange: () => { renderOpts(); bar.update(); body.classList.toggle('has-files', queue.items.length > 0); },
  });
  const summary = h('div.ab-summary');
  const bar = queueBar(queue, { startLabel: 'Compress', onStart: start, extra: summary });

  // ---------- planning ----------
  function videoPlan(info) {
    const s = st.v;
    const shortSide = Math.min(info.width, info.height);
    const srcV = Math.max(200e3, info.bitrate - (info.hasAudio ? 128e3 : 0));
    let codec = s.codec === 'auto' ? (hevc && s.container === 'mp4' ? 'hevc' : s.container === 'webm' ? 'vp9' : 'avc') : s.codec;
    let maxShort = shortSide, fps = 0, vbr, abr = 128e3;
    const p = s.preset;
    if (p === 'recommended') { maxShort = Math.min(shortSide, 1080); vbr = Math.min(srcV * 0.55, ref(maxShort) * codecGain(codec)); }
    else if (p === 'high') { vbr = srcV * 0.72; abr = 160e3; }
    else if (p === 'small') { maxShort = Math.min(shortSide, 720); vbr = Math.min(srcV * 0.4, ref(maxShort) * 0.8 * codecGain(codec)); abr = 96e3; }
    else if (p === 'tiny') { maxShort = Math.min(shortSide, 480); fps = info.fps > 30 ? 30 : 0; vbr = Math.min(srcV * 0.3, ref(maxShort) * 0.6 * codecGain(codec)); abr = 64e3; }
    else if (p === 'target') {
      const total = (s.targetMB * 1024 * 1024 * 8 * 0.95) / Math.max(1, info.duration);
      abr = total < 600e3 ? 48e3 : total < 1500e3 ? 64e3 : 96e3;
      vbr = Math.max(80e3, total - (info.hasAudio ? abr : 0));
      const fit = [2160, 1440, 1080, 720, 480, 360, 240].find((x) => x <= shortSide && ref(x) * codecGain(codec) * 0.55 <= vbr) || 240;
      maxShort = Math.min(shortSide, fit);
      if (vbr < 400e3 && info.fps > 30) fps = 24;
    } else {
      maxShort = s.res ? Math.min(shortSide, s.res) : shortSide; fps = s.fps; abr = s.audio * 1000;
      vbr = Math.max(100e3, srcV * (s.qPct / 100) * (maxShort / shortSide) ** 1.5);
    }
    vbr = Math.min(vbr, srcV);
    const scale = maxShort / shortSide;
    const w = Math.round((info.width * scale) / 2) * 2, hh = Math.round((info.height * scale) / 2) * 2;
    if (p !== 'custom') abr = info.hasAudio ? abr : 0;
    else if (!s.audio) abr = 0;
    const est = ((vbr + abr) * info.duration) / 8;
    return { codec, width: w, height: hh, vbr, abr, fps, est, label: `${Math.min(w, hh)}p` };
  }
  function imagePlan(it) {
    const s = st.i, e = extOf(it.file.name);
    const isPng = e === 'png' || it.file.type === 'image/png';
    const keep = isPng ? 'webp' : ['webp', 'avif'].includes(e) ? e : 'jpg';
    const P = {
      recommended: { format: isPng ? 'webp' : keep, quality: 0.78, max: 2560 },
      high: { format: keep, quality: 0.9, max: 0 },
      small: { format: 'webp', quality: 0.7, max: 1920 },
      tiny: { format: 'webp', quality: 0.55, max: 1280 },
      target: { format: isPng ? 'webp' : 'jpg', quality: 0.8, max: 0, targetBytes: s.targetKB * 1024 },
      custom: { format: s.format === 'keep' ? (isPng ? 'png' : keep) : s.format, quality: s.quality, max: s.max },
    }[s.preset];
    let est = null;
    if (it.dims) {
      const sc = P.max ? Math.min(1, P.max / Math.max(it.dims.width, it.dims.height)) : 1;
      const px = it.dims.width * it.dims.height * sc * sc;
      const bpp = P.format === 'png' ? 1.6 : (P.format === 'avif' ? 0.55 : P.format === 'webp' ? 0.75 : 1) * (0.06 + 0.9 * P.quality ** 3);
      est = P.targetBytes ? Math.min(P.targetBytes, it.file.size) : Math.min(it.file.size, px * bpp);
    }
    return { ...P, est };
  }
  function audioPlan(it) {
    const est = it.media ? (st.a.kbps * 1000 * it.media.duration) / 8 : null;
    return { est };
  }

  // ---------- options UI ----------
  function presetCards(list, cur, onPick, estFor) {
    return h('div.preset-grid', list.map((p) => {
      const est = estFor(p.id);
      return h('button.preset', { type: 'button', 'aria-pressed': cur === p.id, onclick: () => onPick(p.id) },
        p.id === 'recommended' && settings.get('showRecommendations') ? h('span.rec', 'Recommended') : null,
        h('span.pr-ic', icon(p.icon, 18)), h('strong', p.name), h('small', p.desc),
        est ? h('span.pr-est', est) : null);
    }));
  }
  function withPreset(obj, key, id, fn) { const old = obj[key]; obj[key] = id; try { return fn(); } finally { obj[key] = old; } }

  function renderOpts(summaryOnly = false) {
    const vids = queue.items.filter((i) => i.kind === 'video');
    const imgs = queue.items.filter((i) => i.kind === 'image');
    const auds = queue.items.filter((i) => i.kind === 'audio');
    const blocks = [];
    let totalIn = 0, totalEst = 0, estKnown = true;

    if (vids.length) {
      const ready = vids.filter((v) => v.media);
      const estFor = (id) => {
        if (!ready.length || id === 'custom') return null;
        const sum = withPreset(st.v, 'preset', id, () => ready.reduce((a, v) => a + Math.min(v.file.size, videoPlan(v.media).est), 0));
        const first = withPreset(st.v, 'preset', id, () => videoPlan(ready[0].media));
        return `≈ ${fmtBytes(sum)} · ${first.label}`;
      };
      const rows = [];
      if (st.v.preset === 'target') {
        rows.push(field('Target size per video', h('div.target-row',
          segmented(TARGETS_MB.map((t) => ({ value: t.v, label: t.l, title: `${t.v} MB` })), st.v.targetMB, (v) => { st.v.targetMB = v; renderOpts(); }, { small: true }),
          h('label.num', h('input.input', { type: 'number', min: 1, value: st.v.targetMB, onchange: (e) => { st.v.targetMB = Math.max(1, +e.target.value); renderOpts(); } }), h('span', 'MB')))));
      }
      if (st.v.preset === 'custom') {
        rows.push(field('Quality', slider({ min: 10, max: 100, step: 1, value: st.v.qPct, format: (v) => `${v}%`, onInput: (v) => { st.v.qPct = v; refreshEst(); }, onChange: () => renderOpts() }), 'Percentage of the original bitrate'));
        rows.push(field('Resolution', select([{ value: 0, label: 'Original' }, { value: 2160, label: '4K' }, { value: 1440, label: '1440p' }, { value: 1080, label: '1080p' }, { value: 720, label: '720p' }, { value: 480, label: '480p' }, { value: 360, label: '360p' }], st.v.res, (v) => { st.v.res = +v; renderOpts(); })));
        rows.push(field('Frame rate', segmented([{ value: 0, label: 'Original' }, { value: 60, label: '60' }, { value: 30, label: '30' }, { value: 24, label: '24' }], st.v.fps, (v) => { st.v.fps = v; }, { small: true })));
        rows.push(field('Codec', segmented([{ value: 'auto', label: 'Auto' }, { value: 'avc', label: 'H.264' }, { value: 'hevc', label: 'H.265', disabled: !hevc, title: hevc ? 'Up to 40% smaller' : 'Not supported by this device' }, { value: 'av1', label: 'AV1' }, { value: 'vp9', label: 'VP9' }], st.v.codec, (v) => { st.v.codec = v; if (v === 'vp9') st.v.container = 'webm'; renderOpts(); }, { small: true })));
        rows.push(field('Format', segmented(['mp4', 'webm', 'mov', 'mkv'].map((c) => ({ value: c, label: c.toUpperCase() })), st.v.container, (v) => { st.v.container = v; renderOpts(); }, { small: true })));
        rows.push(field('Audio', segmented([{ value: 192, label: '192k' }, { value: 128, label: '128k' }, { value: 96, label: '96k' }, { value: 64, label: '64k' }, { value: 0, label: 'Remove' }], st.v.audio, (v) => { st.v.audio = v; renderOpts(); }, { small: true })));
      }
      const first = ready[0] && videoPlan(ready[0].media);
      blocks.push(h('div.card.opt-block',
        h('div.ob-head', icon('video', 18), h('h3', `Video${vids.length > 1 ? 's' : ''}`), h('span.muted.small', `${vids.length} file${vids.length > 1 ? 's' : ''}`)),
        presetCards(VIDEO_PRESETS, st.v.preset, (id) => { st.v.preset = id; renderOpts(); }, estFor),
        rows.length ? h('div.ob-extra', rows) : null,
        first ? h('div.plan', icon('info', 16), h('span', `${first.width}×${first.height} · ${first.codec.toUpperCase()} · ${(first.vbr / 1e6).toFixed(2)} Mbps${first.fps ? ` · ${first.fps} fps` : ''}${first.abr ? ` · audio ${Math.round(first.abr / 1000)}k` : ' · no audio'}`)) : null));
      for (const v of vids) { totalIn += v.file.size; if (v.media) totalEst += Math.min(v.file.size, videoPlan(v.media).est); else estKnown = false; }
    }
    if (imgs.length) {
      const estFor = (id) => {
        if (id === 'custom' || !imgs.every((i) => i.dims)) return null;
        const sum = withPreset(st.i, 'preset', id, () => imgs.reduce((a, i) => a + imagePlan(i).est, 0));
        return `≈ ${fmtBytes(sum)}`;
      };
      const rows = [];
      if (st.i.preset === 'target') rows.push(field('Max size per photo', h('div.target-row',
        segmented([100, 250, 500, 1000, 2000].map((k) => ({ value: k, label: k >= 1000 ? `${k / 1000} MB` : `${k} KB` })), st.i.targetKB, (v) => { st.i.targetKB = v; renderOpts(); }, { small: true }),
        h('label.num', h('input.input', { type: 'number', min: 10, value: st.i.targetKB, onchange: (e) => { st.i.targetKB = Math.max(10, +e.target.value); renderOpts(); } }), h('span', 'KB')))));
      if (st.i.preset === 'custom') {
        rows.push(field('Format', segmented([{ value: 'keep', label: 'Keep' }, { value: 'jpg', label: 'JPG' }, { value: 'webp', label: 'WebP' }, { value: 'avif', label: 'AVIF' }, { value: 'png', label: 'PNG' }], st.i.format, (v) => { st.i.format = v; renderOpts(); }, { small: true })));
        rows.push(field('Quality', slider({ min: 0.3, max: 1, step: 0.01, value: st.i.quality, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { st.i.quality = v; refreshEst(); }, onChange: () => renderOpts() })));
        rows.push(field('Max dimension', select([{ value: 0, label: 'Original' }, { value: 3840, label: '3840 px' }, { value: 2560, label: '2560 px' }, { value: 1920, label: '1920 px' }, { value: 1280, label: '1280 px' }, { value: 800, label: '800 px' }], st.i.max, (v) => { st.i.max = +v; renderOpts(); })));
      }
      blocks.push(h('div.card.opt-block',
        h('div.ob-head', icon('image', 18), h('h3', 'Photos'), h('span.muted.small', `${imgs.length} file${imgs.length > 1 ? 's' : ''}`)),
        presetCards(IMAGE_PRESETS, st.i.preset, (id) => { st.i.preset = id; renderOpts(); }, estFor),
        rows.length ? h('div.ob-extra', rows) : null,
        h('div.plan', icon('lock', 16), h('span', settings.get('keepMetadata') ? 'Photo metadata is re-encoded; location data is not copied.' : 'Location & camera metadata are removed for privacy.'))));
      for (const i of imgs) { totalIn += i.file.size; const e = imagePlan(i).est; if (e != null) totalEst += e; else estKnown = false; }
    }
    if (auds.length) {
      blocks.push(h('div.card.opt-block',
        h('div.ob-head', icon('audio', 18), h('h3', 'Audio')),
        h('div.ob-extra',
          field('Bitrate', segmented([{ value: 160, label: '160k' }, { value: 128, label: '128k' }, { value: 96, label: '96k' }, { value: 64, label: '64k' }, { value: 48, label: '48k' }], st.a.kbps, (v) => { st.a.kbps = v; renderOpts(); }, { small: true }), 'Recommended: 96k is transparent for most music in AAC/Opus.'),
          field('Format', segmented([{ value: 'm4a', label: 'M4A (AAC)' }, { value: 'mp3', label: 'MP3' }, { value: 'ogg', label: 'OGG (Opus)' }], st.a.format, (v) => { st.a.format = v; renderOpts(); }, { small: true })))));
      for (const a of auds) { totalIn += a.file.size; const e = audioPlan(a).est; if (e != null) totalEst += Math.min(a.file.size, e); else estKnown = false; }
    }
    if (!summaryOnly) optsHost.replaceChildren(...blocks);
    summary.replaceChildren(queue.items.length ? h('div.sum',
      h('span.muted', 'Estimated'), h('strong', `${fmtBytes(totalIn)} → ${estKnown ? '≈ ' + fmtBytes(totalEst) : '…'}`),
      estKnown && totalIn ? h('span.badge.save', `−${Math.max(0, Math.round((1 - totalEst / totalIn) * 100))}%`) : null) : '');
  }
  let estT; const refreshEst = () => { clearTimeout(estT); estT = setTimeout(() => renderOpts(true), 60); };

  // ---------- run ----------
  function start() {
    const first = queue.items[0]; if (!first) return;
    guardBigJob({ bytes: queue.items.reduce((a, i) => a + i.file.size, 0), heavy: queue.items.some((i) => isHeavyMedia(i.media)) }, () => begin(first));
  }
  function begin(first) {
    const run = startRun(queue.items.length, outName(first.file.name, extOf(first.file.name) || 'mp4', 'compressed'));
    queue.run((it, ctx) => job(it, run, ctx), { label: 'Compressing', tool: 'compress' });
    bar.update();
  }
  async function job(it, run, ctx) {
    if (it.kind === 'image') {
      const p = imagePlan(it);
      const fmtOk = p.format === 'avif' && !(await canEncode('avif')) ? 'webp' : p.format;
      return processImage(it.file, { format: fmtOk, quality: p.quality, maxW: p.max || undefined, maxH: p.max || undefined, targetBytes: p.targetBytes },
        { run, name: outName(it.file.name, fmtOk, 'compressed'), onProgress: ctx.onProgress });
    }
    it.media ||= await probe(it.file);
    if (it.kind === 'audio') {
      const f = st.a.format;
      return processMedia(it.file, { container: f, audio: { bitrate: st.a.kbps * 1000 } }, { ...ctx, run, name: outName(it.file.name, f, 'compressed') });
    }
    const p = videoPlan(it.media);
    const container = st.v.preset === 'custom' ? st.v.container : p.codec === 'vp9' ? 'webm' : 'mp4';
    return processMedia(it.file, {
      container,
      video: { codec: p.codec, width: p.width, height: p.height, bitrate: p.vbr, fps: p.fps || undefined, forceTranscode: true },
      audio: p.abr ? { bitrate: p.abr } : { discard: true },
    }, { ...ctx, run, name: outName(it.file.name, container, 'compressed'), duration: it.media.duration });
  }

  async function annotate(added) {
    for (const it of added) {
      try {
        if (it.kind === 'image') { it.dims = await imageInfo(it.file); queue.setInfo(it, `${it.dims.width}×${it.dims.height}`); }
        else {
          it.media = await probe(it.file);
          const m = it.media;
          queue.setInfo(it, [m.width ? `${m.width}×${m.height}` : null, fmtTime(m.duration), `${(m.bitrate / 1e6).toFixed(1)} Mbps`, m.fps ? `${m.fps} fps` : null].filter(Boolean).join(' · '));
        }
      } catch { queue.setInfo(it, 'Could not read details'); }
      renderOpts();
    }
  }
  const addFiles = (f) => annotate(queue.add(f));

  const body = h('div.tool-body',
    h('div.tool-main', dropZone({ title: 'Add more', compact: true, accept: 'video/*,image/*,audio/*,.heic,.heif,.mkv,.mov', onFiles: addFiles }), queue.el),
    h('div.tool-side', optsHost));
  const el = h('div.tool',
    pageHeader('Compress', 'Shrink videos, photos and audio with smart presets. See the size before you start.', 'compress'),
    h('div.landing', dropZone({ title: 'Drop videos, photos or audio', accept: 'video/*,image/*,audio/*,.heic,.heif,.mkv,.mov', kinds: ['MP4', 'MOV', 'MKV', 'JPG', 'PNG', 'HEIC', 'MP3'], onFiles: addFiles })),
    body, bar);
  if (files?.length) addFiles(files);
  return { el, accept: (f) => { addFiles(f); }, destroy: () => queue.cancel() };
}
function kindOfSafe(f) {
  const t = f.type || '';
  if (t) return t;
  const e = extOf(f.name);
  if (['heic', 'heif', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'gif'].includes(e)) return 'image/' + e;
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', '3gp', 'wmv', 'flv'].includes(e)) return 'video/' + e;
  if (['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'opus'].includes(e)) return 'audio/' + e;
  return '';
}
