import { h, fmtTime, extOf } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, dropZone, createQueue, queueBar, dockBar } from '../core/components.js';
import { segmented, slider, select, field, toast } from '../core/ui.js';
import { kindOf, outName } from '../core/files.js';
import { startRun, writeBlob } from '../core/save.js';
import { processImage, canEncode, IMG_MIME } from '../engines/image.js';
import { processMedia } from '../engines/process.js';
import { probe, MIME } from '../engines/media.js';
import { runFFmpeg } from '../engines/ffmpeg.js';
import * as pdf from '../engines/pdf.js';
import { app } from '../app.js';
import { guardBigJob, isHeavyMedia } from '../core/power.js';

const FORMATS = {
  image: ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'ico', 'pdf'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif', 'mp3', 'm4a', 'wav', 'ogg', 'flac'],
  audio: ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'],
  pdf: ['jpg', 'png', 'webp', 'txt'],
  text: ['pdf'],
  other: ['zip'],
};
const DEFAULT = { image: 'jpg', video: 'mp4', audio: 'mp3', pdf: 'jpg', text: 'pdf', other: 'zip' };
const KIND_LABEL = { image: 'Photos', video: 'Videos', audio: 'Audio', pdf: 'PDFs', text: 'Text files', other: 'Other files' };
const AUDIO_OUT = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac'];

export default function convertView({ files }) {
  const opt = {
    target: { ...DEFAULT },
    imgQuality: 0.88, imgMax: 0,
    vidQuality: 'high', vidRes: 0,
    abr: 192, gifW: 480, gifFps: 12, dpi: 150,
    pdfMode: 'one', pdfPage: 'a4',
  };
  const optsHost = h('div.opts');
  const queue = createQueue({ onChange: () => { renderOpts(); bar.update(); body.classList.toggle('has-files', queue.items.length > 0); } });
  const bar = queueBar(queue, { startLabel: 'Convert', onStart: start });

  function kindsPresent() { return [...new Set(queue.items.map((i) => i.kind))]; }

  async function renderOpts() {
    const kinds = kindsPresent();
    const blocks = [];
    for (const k of kinds) {
      const fmts = FORMATS[k];
      const avif = await canEncode('avif');
      const seg = h('div.fmt-grid', fmts.map((f) => {
        const b = h('button.fmt', { type: 'button', 'aria-pressed': opt.target[k] === f, onclick: () => { opt.target[k] = f; renderOpts(); } },
          h('strong', f.toUpperCase()), h('small', fmtHint(k, f)));
        if (f === 'avif' && !avif) { b.title = 'Your browser cannot encode AVIF; WebP will be used'; }
        return b;
      }));
      const extras = extraControls(k, opt.target[k]);
      blocks.push(h('div.card.opt-block',
        h('div.ob-head', icon(k === 'pdf' ? 'pdf' : k, 18), h('h3', `${KIND_LABEL[k]} → ${opt.target[k].toUpperCase()}`)),
        seg, extras));
    }
    optsHost.replaceChildren(...blocks);
  }
  function fmtHint(k, f) {
    return ({ jpg: 'Universal', png: 'Lossless', webp: 'Small & sharp', avif: 'Smallest', gif: 'Animated', bmp: 'Raw', ico: 'Icon', pdf: 'Document',
      mp4: 'Plays everywhere', webm: 'Web', mov: 'Apple', mkv: 'Flexible', avi: 'Legacy', mp3: 'Audio only', m4a: 'AAC audio', wav: 'Lossless', ogg: 'Opus', flac: 'Lossless', aac: 'Raw AAC',
      txt: 'Extract text', zip: 'Archive' })[f] || '';
  }
  function extraControls(k, f) {
    const rows = [];
    if (k === 'image' && ['jpg', 'webp', 'avif'].includes(f)) rows.push(field('Quality', slider({ min: 0.4, max: 1, step: 0.01, value: opt.imgQuality, format: (v) => Math.round(v * 100) + '%', onInput: (v) => (opt.imgQuality = v) })));
    if (k === 'image' && f !== 'ico' && f !== 'pdf') rows.push(field('Size', select([{ value: 0, label: 'Original size' }, { value: 3840, label: 'Max 3840 px (4K)' }, { value: 2560, label: 'Max 2560 px' }, { value: 1920, label: 'Max 1920 px' }, { value: 1280, label: 'Max 1280 px' }, { value: 800, label: 'Max 800 px' }, { value: 512, label: 'Max 512 px' }], opt.imgMax, (v) => (opt.imgMax = +v))));
    if (k === 'image' && f === 'pdf') {
      const n = queue.items.filter((i) => i.kind === 'image').length;
      if (n > 1) rows.push(field('Output', segmented([{ value: 'one', label: 'One PDF' }, { value: 'each', label: 'One PDF per photo' }], opt.pdfMode, (v) => { opt.pdfMode = v; renderOpts(); }, { small: true }),
        opt.pdfMode === 'one' ? `${n} pages, in the order of the list. Drag photos to change it.` : null));
      rows.push(field('Page size', segmented([{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Fit photo' }], opt.pdfPage, (v) => (opt.pdfPage = v), { small: true })));
    }
    if (k === 'video' && ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(f)) {
      rows.push(field('Quality', segmented([{ value: 'very-high', label: 'Original', title: 'Copies the original video stream when possible (no quality loss)' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }], opt.vidQuality, (v) => (opt.vidQuality = v), { small: true })));
      rows.push(field('Resolution', select([{ value: 0, label: 'Same as source' }, { value: 2160, label: '4K (2160p)' }, { value: 1440, label: '1440p' }, { value: 1080, label: '1080p' }, { value: 720, label: '720p' }, { value: 480, label: '480p' }], opt.vidRes, (v) => (opt.vidRes = +v))));
    }
    if ((k === 'video' || k === 'audio') && ['mp3', 'm4a', 'ogg', 'aac'].includes(f)) rows.push(field('Audio bitrate', segmented([320, 256, 192, 128, 96].map((b) => ({ value: b, label: `${b}k` })), opt.abr, (v) => (opt.abr = v), { small: true })));
    if (k === 'video' && f === 'gif') {
      rows.push(field('Width', segmented([320, 480, 640, 800].map((w) => ({ value: w, label: `${w}px` })), opt.gifW, (v) => (opt.gifW = v), { small: true })));
      rows.push(field('Frame rate', segmented([8, 12, 15, 20, 24].map((w) => ({ value: w, label: `${w}` })), opt.gifFps, (v) => (opt.gifFps = v), { small: true }), 'Tip: trim the clip in the Video editor first; GIFs get big fast.'));
    }
    if (k === 'pdf' && f !== 'txt') rows.push(field('Resolution', segmented([{ value: 72, label: 'Screen' }, { value: 150, label: 'Standard' }, { value: 220, label: 'High' }, { value: 300, label: 'Print' }], opt.dpi, (v) => (opt.dpi = v), { small: true })));
    if (k === 'video' && f === 'avi' || f === 'gif' && k !== 'image') rows.push(h('div.note', icon('info', 16), 'Uses the universal engine (slower, runs on CPU).'));
    return rows.length ? h('div.ob-extra', rows) : null;
  }

  function start() {
    const first = queue.items.find((i) => i.status !== 'working');
    if (!first) return;
    guardBigJob({ bytes: queue.items.reduce((a, i) => a + i.file.size, 0), heavy: queue.items.some((i) => isHeavyMedia(i.media)) }, () => begin(first));
  }
  function begin(first) {
    const f0 = opt.target[first.kind];
    // Photos → one PDF: the first photo in the list builds the whole document (in list order); the rest join it.
    const imgs = queue.items.filter((i) => i.kind === 'image' && i.status !== 'working');
    const group = opt.target.image === 'pdf' && opt.pdfMode === 'one' && imgs.length > 1 ? { imgs, ...deferred() } : null;
    group?.promise.catch(() => {});
    const count = queue.items.length - (group ? imgs.length - 1 : 0);
    const run = startRun(count, outName(first.file.name, f0 === 'jpg' && first.kind === 'pdf' ? 'zip' : f0), MIME[f0] || IMG_MIME[f0]);
    queue.run((it, ctx) => job(it, run, ctx, group), { label: 'Converting', tool: 'convert', task: { icon: 'convert' } });
    bar.update();
  }
  function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

  async function job(it, run, ctx, group) {
    const f = opt.target[it.kind];
    const name = queue.nameFor(it, outName(it.file.name, f));
    const base = { run, name, ...ctx };
    if (it.kind === 'image') {
      if (f === 'pdf' && group && group.imgs.includes(it)) {
        const page = group.imgs.indexOf(it) + 1;
        const docName = outName(group.imgs[0].file.name, 'pdf');
        if (page > 1) { ctx.onProgress(-1); ctx.onStatus('Adding to the PDF…'); await group.promise; it.note = `Page ${page} of ${docName}`; return null; }
        try {
          const res = await writeBlob(run, docName, await pdf.imagesToPdf(group.imgs.map((x) => x.file), { pageSize: opt.pdfPage, margin: opt.pdfPage === 'fit' ? 0 : 18 }, ctx.onProgress));
          group.resolve(); it.note = `PDF with ${group.imgs.length} pages`; return res;
        } catch (e) { group.reject(e); throw e; }
      }
      if (f === 'pdf') return writeBlob(run, name, await pdf.imagesToPdf([it.file], { pageSize: opt.pdfPage, margin: opt.pdfPage === 'fit' ? 0 : 18 }, ctx.onProgress));
      if (f === 'gif') return runFFmpeg(it.file, 'gif', (i, o) => ['-i', i, o], { ...base, mime: 'image/gif' });
      return processImage(it.file, { format: f, quality: opt.imgQuality, maxW: opt.imgMax || undefined, maxH: opt.imgMax || undefined }, base);
    }
    if (it.kind === 'video' || it.kind === 'audio') {
      const isAudio = AUDIO_OUT.includes(f);
      let duration;
      if (f === 'gif') { try { duration = (await probe(it.file)).duration; } catch { /* */ } }
      return processMedia(it.file, {
        container: f,
        video: isAudio ? { discard: true } : f === 'gif' ? { width: opt.gifW, fps: opt.gifFps } : await videoOpts(it, f),
        audio: { bitrate: isAudio && !['wav', 'flac'].includes(f) ? opt.abr * 1000 : undefined },
      }, { ...base, duration });
    }
    if (it.kind === 'pdf') {
      if (f === 'txt') return writeBlob(run, name, await pdf.toText(it.file, ctx.onProgress));
      const pages = await pdf.toImages(it.file, { format: f, dpi: opt.dpi }, ctx.onProgress);
      const out = [];
      for (const p of pages) out.push(await writeBlob(run, name.replace(/(\.[^.]+)$/, `-p${p.page}$1`), p.blob));
      return out;
    }
    if (it.kind === 'text') return writeBlob(run, name, await pdf.textToPdf(await it.file.text(), { mono: !['txt', 'md'].includes(extOf(it.file.name)) }));
    const { default: JSZip } = await import('jszip');
    const z = new JSZip(); z.file(it.file.name, it.file);
    return writeBlob(run, name, await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (m) => ctx.onProgress(m.percent / 100)));
  }

  // Keep the original stream when the target container supports it (lossless + fast);
  // otherwise re-encode at a bitrate derived from the source so files don't balloon.
  async function videoOpts(it, container) {
    it.media ||= await probe(it.file).catch(() => null);
    const m = it.media;
    const natural = { mp4: ['avc', 'hevc', 'av1', 'vp9'], mov: ['avc', 'hevc'], mkv: ['avc', 'hevc', 'vp9', 'av1', 'vp8'], webm: ['vp9', 'vp8', 'av1'] }[container] || [];
    const short = m?.width ? Math.min(m.width, m.height) : 0;
    const res = opt.vidRes && short > opt.vidRes ? opt.vidRes : 0;
    if (m && !res && natural.includes(m.videoCodec) && opt.vidQuality === 'very-high') return {};
    if (!m || !m.bitrate) return { quality: opt.vidQuality, height: res || undefined };
    const factor = { 'very-high': 1, high: 0.8, medium: 0.55, low: 0.35 }[opt.vidQuality];
    const gain = container === 'webm' ? 0.8 : 1;
    const srcV = Math.max(300e3, m.bitrate - (m.hasAudio ? 128e3 : 0));
    const scale = res ? (res / short) ** 1.5 : 1;
    const out = { bitrate: srcV * factor * gain * scale, forceTranscode: true };
    if (res) { if (m.width < m.height) out.width = res; else out.height = res; }
    return out;
  }

  async function annotate(added) {
    for (const it of added) {
      if (it.kind === 'video' || it.kind === 'audio') {
        try { const p = await probe(it.file); it.media = p; queue.setInfo(it, [p.width ? `${p.width}×${p.height}` : null, fmtTime(p.duration), p.videoCodec?.toUpperCase(), p.audioCodec?.toUpperCase()].filter(Boolean).join(' · ')); } catch { queue.setInfo(it, 'Will use the universal engine'); }
      } else if (it.kind === 'pdf') {
        try { const n = await pdf.pageCount(it.file); queue.setInfo(it, n < 0 ? 'Password protected: unlock it in PDF tools first' : `${n} page${n > 1 ? 's' : ''}`); } catch { /* */ }
      }
    }
  }
  const addFiles = (f) => { const added = queue.add(f); annotate(added); };

  const body = h('div.tool-body',
    h('div.tool-main', dropZone({ title: 'Add files to convert', compact: true, onFiles: addFiles }), queue.el),
    h('div.tool-side', optsHost));
  const side = body.querySelector('.tool-side');
  const el = h('div.tool',
    pageHeader('Convert', 'Photos, videos, audio and PDFs to any format: right here, offline.', 'convert'),
    h('div.landing', dropZone({ title: 'Drop files to convert', kinds: ['Video', 'Photo', 'HEIC', 'Audio', 'PDF', 'Text'], onFiles: addFiles })),
    body);
  dockBar(bar, side, el);
  if (files?.length) addFiles(files);
  return { el, accept: (f) => { addFiles(f); }, destroy: () => queue.cancel(), get busy() { return queue.running; } };
}
