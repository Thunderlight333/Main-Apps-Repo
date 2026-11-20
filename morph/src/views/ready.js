// "Ready for…": one tap makes files fit where they are going (WhatsApp, Discord, Email, Instagram…).
// Two sections: Presets (ready-made, plus "Your presets") and Custom (choose everything yourself,
// then save it as your own preset). Everything is processed on this device.
import { h, fmtBytes, fmtTime, extOf } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, dropZone, createQueue, queueBar, dockBar } from '../core/components.js';
import { segmented, select, field, toast, prompt, confirmDialog } from '../core/ui.js';
import { outName, pickFiles, kindOf } from '../core/files.js';
import { startRun, writeBlob } from '../core/save.js';
import { convertImage, imageInfo, canEncode } from '../engines/image.js';
import { processMedia } from '../engines/process.js';
import { probe } from '../engines/media.js';
import { guardBigJob, isHeavyMedia } from '../core/power.js';
import { app } from '../app.js';

const MB = 1024 * 1024;
const ACCEPT = 'video/*,image/*,audio/*,application/pdf,.pdf,.heic,.heif,.mkv,.mov';

/**
 * A "spec" says what the output must look like:
 * { limitMB, total (limit is for all files together), aspect: [w,h] | null,
 *   video: { maxShort, fps, maxVbr, mute, format }, image: { format, maxW, maxH, q, limitMB },
 *   audio: { format, kbps }, pdf: { level } }
 */
export const PRESETS = [
  { id: 'whatsapp', name: 'WhatsApp', icon: 'chat', tag: 'Plays on every phone, stays sharp',
    spec: { video: { maxShort: 720, fps: 30, maxVbr: 2.5e6 }, image: { format: 'jpg', maxW: 2048, maxH: 2048, q: 0.85 }, audio: { format: 'm4a', kbps: 128 } } },
  { id: 'discord', name: 'Discord', icon: 'game', tag: 'Under 10 MB each (free limit)',
    spec: { limitMB: 10, video: { maxShort: 1080, fps: 30 }, image: { format: 'keep', q: 0.9 }, audio: { format: 'm4a', kbps: 128 } } },
  { id: 'email', name: 'Email', icon: 'mail', tag: 'All files together under 25 MB',
    spec: { limitMB: 25, total: true, video: { maxShort: 720, fps: 30 }, image: { format: 'jpg', maxW: 2048, maxH: 2048, q: 0.82 }, audio: { format: 'm4a', kbps: 96 } } },
  { id: 'reels', name: 'Reels & Stories', icon: 'phone', tag: 'Instagram · 9:16 · 1080×1920', aspect: true,
    spec: { aspect: [9, 16], video: { maxShort: 1080, fps: 30, maxVbr: 6e6 }, image: { format: 'jpg', maxW: 1080, maxH: 1920, q: 0.9 } } },
  { id: 'instagram', name: 'Instagram post', icon: 'portrait', tag: '4:5 · 1080×1350', aspect: true,
    spec: { aspect: [4, 5], video: { maxShort: 1080, fps: 30, maxVbr: 5e6 }, image: { format: 'jpg', maxW: 1080, maxH: 1350, q: 0.9 } } },
  { id: 'tiktok', name: 'TikTok', icon: 'music', tag: '9:16 · 1080×1920', aspect: true,
    spec: { aspect: [9, 16], video: { maxShort: 1080, fps: 30, maxVbr: 8e6 }, image: { format: 'jpg', maxW: 1080, maxH: 1920, q: 0.9 } } },
  { id: 'x', name: 'X (Twitter)', icon: 'bird', tag: 'MP4 1080p · photos under 5 MB',
    spec: { video: { maxShort: 1080, fps: 60, maxVbr: 8e6 }, image: { format: 'jpg', maxW: 4096, maxH: 4096, q: 0.88, limitMB: 5 } } },
  { id: 'upload', name: 'School / work upload', icon: 'school', tag: 'You choose the size limit', ask: true,
    spec: { video: { maxShort: 720, fps: 30 }, image: { format: 'jpg', maxW: 2560, maxH: 2560, q: 0.85 }, audio: { format: 'm4a', kbps: 96 } } },
];

const CUSTOM_DEFAULT = { limitMB: 0, total: false, aspect: 'original', res: 0, fps: 0, vformat: 'mp4', sound: 'keep', iformat: 'keep', imax: 0, aformat: 'm4a', akbps: 128, pdf: 'auto' };
const ASPECTS = { original: null, '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '16:9': [16, 9] };
const KEY = 'morph.ready.v1';

function loadState() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* private mode */ }
  return { mode: s.mode === 'custom' ? 'custom' : 'presets', preset: s.preset || 'whatsapp', uploadMB: s.uploadMB || 2,
    custom: { ...CUSTOM_DEFAULT, ...(s.custom || {}) }, mine: Array.isArray(s.mine) ? s.mine : [] };
}

/** Custom choices → spec. */
function customSpec(c) {
  return {
    limitMB: c.limitMB || 0, total: !!c.total && c.limitMB > 0, aspect: ASPECTS[c.aspect] || null,
    video: { maxShort: c.res || 0, fps: c.fps || 0, mute: c.sound === 'remove', format: c.vformat },
    image: { format: c.iformat, maxW: c.imax || 0, maxH: c.imax || 0, q: 0.85 },
    audio: { format: c.aformat, kbps: c.akbps },
    pdf: { level: c.pdf },
  };
}
/** Short description of custom choices, e.g. "Under 10 MB · 9:16 · 720p". */
function describeCustom(c) {
  const p = [];
  if (c.limitMB) p.push(`${c.total ? 'All under' : 'Under'} ${c.limitMB} MB`);
  if (c.aspect !== 'original') p.push(c.aspect);
  if (c.res) p.push(`${c.res}p`);
  if (c.vformat !== 'mp4') p.push(c.vformat.toUpperCase());
  if (c.sound === 'remove') p.push('no sound');
  if (c.iformat !== 'keep') p.push(`photos ${c.iformat.toUpperCase()}`);
  return p.join(' · ') || 'Your own settings';
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'ready';

// ---------- planning ----------
const REF = { 2160: 16e6, 1440: 9e6, 1080: 5e6, 720: 2.5e6, 480: 1.2e6, 360: 0.7e6, 240: 0.4e6 };
const ref = (hgt) => { const k = Object.keys(REF).map(Number).sort((a, b) => a - b).find((x) => hgt <= x) || 2160; return REF[k] * (hgt / k) ** 0.9; };
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Centre crop of a w×h picture to the aspect a = [aw, ah]. Null when it already fits. */
export function centerCrop(w, hgt, a) {
  if (!a || !w || !hgt) return null;
  const want = a[0] / a[1];
  if (Math.abs(w / hgt - want) < 0.01) return null;
  let cw = w, ch = hgt;
  if (w / hgt > want) cw = even(hgt * want); else ch = even(w / want);
  cw = Math.min(cw, w - (w % 2)); ch = Math.min(ch, hgt - (hgt % 2));
  return { left: Math.floor((w - cw) / 4) * 2, top: Math.floor((hgt - ch) / 4) * 2, width: cw, height: ch };
}

export function videoPlan(info, spec, target) {
  const v = spec.video || {};
  const crop = centerCrop(info.width, info.height, spec.aspect);
  const cw = crop ? crop.width : info.width, ch = crop ? crop.height : info.height;
  const short = Math.min(cw, ch);
  let maxShort = v.maxShort ? Math.min(short, v.maxShort) : short;
  const area = crop ? (cw * ch) / (info.width * info.height) : 1;
  const srcV = Math.max(200e3, (info.bitrate || 4e6) - (info.hasAudio ? 128e3 : 0)) * area;
  let abr = v.mute || !info.hasAudio ? 0 : ((spec.audio?.kbps || 128) * 1000);
  let fps = v.fps && info.fps > v.fps + 1 ? v.fps : 0;
  let vbr, tight = false;
  if (target) {
    const total = (target * 8 * 0.93) / Math.max(1, info.duration);
    if (abr) abr = total < 600e3 ? 48e3 : total < 1500e3 ? 64e3 : Math.min(abr, 128e3);
    vbr = Math.max(60e3, total - abr);
    tight = total < 250e3;
    const fit = [2160, 1440, 1080, 720, 480, 360, 240].find((x) => x <= maxShort && ref(x) * 0.5 <= vbr) || 240;
    maxShort = Math.min(maxShort, fit);
    if (vbr < 400e3 && info.fps > 30) fps = 24;
    vbr = Math.min(vbr, ref(maxShort) * 1.3);
  } else vbr = Math.min(srcV * 0.85, ref(maxShort));
  if (v.maxVbr) vbr = Math.min(vbr, v.maxVbr);
  vbr = Math.max(50e3, Math.min(vbr, srcV * 0.9));
  const scale = maxShort / short;
  const width = even(cw * scale), height = even(ch * scale);
  const codec = v.format === 'webm' ? 'vp9' : 'avc';
  return { crop, width, height, vbr, abr, fps, codec, tight, est: ((vbr + abr) * info.duration) / 8 };
}

export default function readyView({ files, sub } = {}) {
  const st = loadState();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* */ } };

  /** The spec + a short label/tag for output names, for what is selected now. */
  function current() {
    if (st.mode === 'custom') return { spec: customSpec(st.custom), name: 'Custom', tag: 'ready' };
    if (st.preset.startsWith('mine:')) {
      const m = st.mine.find((x) => 'mine:' + x.id === st.preset);
      if (m) return { spec: customSpec({ ...CUSTOM_DEFAULT, ...m.c }), name: m.name, tag: slug(m.name) };
      st.preset = 'whatsapp';
    }
    const p = PRESETS.find((x) => x.id === st.preset) || PRESETS[0];
    const spec = p.ask ? { ...p.spec, limitMB: st.uploadMB } : p.spec;
    return { spec, name: p.name, tag: p.id };
  }

  const optsHost = h('div.opts');
  const queue = createQueue({
    accept: (f) => ['video', 'image', 'audio', 'pdf'].includes(kindOf(f)),
    onChange: () => { renderOpts(); bar.update(); body.classList.toggle('has-files', queue.items.length > 0); },
  });
  const summary = h('div.ab-summary');
  const bar = queueBar(queue, { startLabel: 'Make ready', onStart: start, extra: summary });

  // ---------- sizes ----------
  const sumSize = () => queue.items.reduce((a, i) => a + i.file.size, 0);
  function targetFor(it, spec, total) {
    let t = spec.limitMB ? spec.limitMB * MB : 0;
    if (t && spec.total) t = Math.floor(t * 0.97 * (it.file.size / Math.max(1, total)));
    if (it.kind === 'image' && spec.image?.limitMB) t = t ? Math.min(t, spec.image.limitMB * MB) : spec.image.limitMB * MB;
    // Already small enough? Then the limit doesn't force anything.
    return t;
  }
  function estimate(it, spec, total) {
    const t = targetFor(it, spec, total);
    if (it.kind === 'video') {
      if (!it.media) return null;
      const p = videoPlan(it.media, spec, t);
      return t ? Math.min(p.est, t) : p.est;
    }
    if (it.kind === 'audio') {
      if (!it.media) return null;
      const est = ((spec.audio?.kbps || 128) * 1000 * it.media.duration) / 8;
      return Math.min(it.file.size * 1.05, t ? Math.min(est, t) : est);
    }
    if (it.kind === 'pdf') return t ? Math.min(it.file.size, t) : it.file.size;
    if (!it.dims) return null;
    const im = spec.image || {};
    const crop = centerCrop(it.dims.width, it.dims.height, spec.aspect);
    const w = crop ? crop.width : it.dims.width, hh = crop ? crop.height : it.dims.height;
    const sc = Math.min(1, (im.maxW || Infinity) / w, (im.maxH || Infinity) / hh);
    const px = w * hh * sc * sc;
    const fmt = im.format === 'keep' ? extOf(it.file.name) : im.format;
    const bpp = fmt === 'png' ? 1.6 : (fmt === 'webp' ? 0.75 : 1) * (0.06 + 0.9 * (im.q ?? 0.85) ** 3);
    const est = Math.min(it.file.size, px * bpp);
    return t ? Math.min(est, t) : est;
  }
  function totalEstimate(spec) {
    const total = sumSize();
    let sum = 0;
    for (const it of queue.items) { const e = estimate(it, spec, total); if (e == null) return null; sum += e; }
    return sum;
  }

  // ---------- options UI ----------
  function presetCard(p, { onPick, est, del, edit, landing } = {}) {
    const pressed = !landing && st.mode === 'presets' && st.preset === p.key;
    return h('div.rp-wrap',
      h('button.preset.rp', { type: 'button', 'aria-pressed': pressed, onclick: onPick },
        h('span.pr-ic', icon(p.icon, 18)), h('strong', p.name), h('small', p.tag),
        est ? h('span.pr-est', est) : null),
      edit ? h('button.rp-mini.rp-edit', { type: 'button', 'aria-label': `Edit ${p.name}`, title: 'Edit', onclick: edit }, icon('sliders', 14)) : null,
      del ? h('button.rp-mini.rp-del', { type: 'button', 'aria-label': `Delete ${p.name}`, title: 'Delete', onclick: del }, icon('x', 14)) : null);
  }
  function allCards() {
    const builtIn = PRESETS.map((p) => ({ key: p.id, name: p.name, icon: p.icon, tag: p.ask ? `Under ${st.uploadMB} MB each` : p.tag, spec: p.ask ? { ...p.spec, limitMB: st.uploadMB } : p.spec }));
    const mine = st.mine.map((m) => { const c = { ...CUSTOM_DEFAULT, ...m.c }; return { key: 'mine:' + m.id, id: m.id, name: m.name, icon: 'star', tag: describeCustom(c), spec: customSpec(c), mine: true, c }; });
    return { builtIn, mine };
  }
  const estLabel = (spec) => { if (!queue.items.length) return null; const e = totalEstimate(spec); return e == null ? null : `≈ ${fmtBytes(e)}`; };

  function presetsSection() {
    const { builtIn, mine } = allCards();
    const pick = (key) => () => { st.mode = 'presets'; st.preset = key; persist(); renderOpts(); };
    const out = [];
    if (mine.length) {
      out.push(h('div.rp-head', h('h4', 'Your presets')),
        h('div.preset-grid.rp-grid', mine.map((p) => presetCard(p, {
          onPick: pick(p.key), est: estLabel(p.spec),
          edit: () => { st.custom = { ...CUSTOM_DEFAULT, ...p.c }; st.mode = 'custom'; st.editing = p.id; persist(); renderOpts(); },
          del: async () => {
            if (!(await confirmDialog(`Delete “${p.name}”?`, 'This removes your saved preset. Your files are not affected.', 'Delete', true))) return;
            st.mine = st.mine.filter((x) => x.id !== p.id); if (st.preset === p.key) st.preset = 'whatsapp'; persist(); renderOpts();
          },
        }))));
    }
    out.push(h('div.rp-head', h('h4', mine.length ? 'Ready-made' : 'Where is it going?')),
      h('div.preset-grid.rp-grid', builtIn.map((p) => presetCard(p, { onPick: pick(p.key), est: estLabel(p.spec) }))));
    const sel = PRESETS.find((p) => p.id === st.preset);
    if (sel?.ask) {
      out.push(field('Size limit per file', h('div.target-row',
        segmented([1, 2, 5, 10, 20].map((v) => ({ value: v, label: `${v} MB` })), st.uploadMB, (v) => { st.uploadMB = v; persist(); renderOpts(); }, { small: true }),
        h('label.num', h('input.input', { type: 'number', min: 0.1, step: 0.1, value: st.uploadMB, onchange: (e) => { st.uploadMB = Math.max(0.1, +e.target.value || 2); persist(); renderOpts(); } }), h('span', 'MB'))),
      'Check the limit on the upload page (for example “max 2 MB”).'));
    }
    return out;
  }

  function customSection(kinds) {
    const c = st.custom;
    const set = (k, rerender = true) => (v) => { c[k] = v; persist(); if (rerender) renderOpts(); };
    const rows = [
      field('Size limit', h('div.target-row',
        segmented([{ value: 0, label: 'None' }, { value: 5, label: '5 MB' }, { value: 10, label: '10 MB' }, { value: 25, label: '25 MB' }, { value: 100, label: '100 MB' }], c.limitMB, set('limitMB'), { small: true }),
        h('label.num', h('input.input', { type: 'number', min: 0, step: 0.1, value: c.limitMB || '', placeholder: 'Any', onchange: (e) => set('limitMB')(Math.max(0, +e.target.value || 0)) }), h('span', 'MB')))),
      c.limitMB ? field('The limit is for', segmented([{ value: false, label: 'Each file' }, { value: true, label: 'All files together' }], c.total, set('total'), { small: true })) : null,
      field('Shape', segmented(Object.keys(ASPECTS).map((k) => ({ value: k, label: k === 'original' ? 'Original' : k })), c.aspect, set('aspect'), { small: true }),
        c.aspect !== 'original' ? 'Photos and videos are cropped from the centre to this shape.' : null),
    ];
    const show = (k) => !kinds.size || kinds.has(k);
    if (show('video')) rows.push(h('div.rc-group', h('h4', icon('video', 16), 'Videos'),
      field('Quality', select([{ value: 0, label: 'Original' }, { value: 2160, label: '4K' }, { value: 1080, label: '1080p (Full HD)' }, { value: 720, label: '720p (HD)' }, { value: 480, label: '480p' }, { value: 360, label: '360p' }], c.res, (v) => set('res')(+v))),
      field('Smoothness (frames per second)', segmented([{ value: 0, label: 'Original' }, { value: 60, label: '60' }, { value: 30, label: '30' }, { value: 24, label: '24' }], c.fps, set('fps'), { small: true })),
      field('Format', segmented([{ value: 'mp4', label: 'MP4 (plays everywhere)' }, { value: 'webm', label: 'WebM' }], c.vformat, set('vformat'), { small: true })),
      field('Sound', segmented([{ value: 'keep', label: 'Keep' }, { value: 'remove', label: 'Remove' }], c.sound, set('sound'), { small: true }))));
    if (show('image')) rows.push(h('div.rc-group', h('h4', icon('image', 16), 'Photos'),
      field('Format', segmented([{ value: 'keep', label: 'Keep' }, { value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }], c.iformat, set('iformat'), { small: true })),
      field('Max size in pixels', select([{ value: 0, label: 'Original' }, { value: 3840, label: '3840 px (4K)' }, { value: 2048, label: '2048 px' }, { value: 1920, label: '1920 px' }, { value: 1080, label: '1080 px' }, { value: 800, label: '800 px' }], c.imax, (v) => set('imax')(+v)))));
    if (show('audio')) rows.push(h('div.rc-group', h('h4', icon('audio', 16), 'Audio'),
      field('Format', segmented([{ value: 'm4a', label: 'M4A' }, { value: 'mp3', label: 'MP3' }, { value: 'ogg', label: 'OGG' }], c.aformat, set('aformat'), { small: true })),
      field('Quality', segmented([{ value: 192, label: 'High' }, { value: 128, label: 'Good' }, { value: 64, label: 'Small' }], c.akbps, set('akbps'), { small: true }))));
    if (show('pdf')) rows.push(h('div.rc-group', h('h4', icon('pdf', 16), 'PDFs'),
      field('Compression', segmented([{ value: 'auto', label: 'Auto' }, { value: 'lossless', label: 'Light' }, { value: 'recommended', label: 'Medium' }, { value: 'extreme', label: 'Strong' }], c.pdf, set('pdf'), { small: true }),
        'Auto: keeps text sharp and only squeezes harder when needed to fit the size limit.')));
    const editing = st.editing && st.mine.find((m) => m.id === st.editing);
    rows.push(h('div.rc-save',
      editing ? h('button.btn.primary.sm', { type: 'button', onclick: () => { editing.c = { ...c }; persist(); toast(`“${editing.name}” updated`, 'success'); st.editing = null; renderOpts(); } }, icon('check', 16), `Update “${editing.name}”`) : null,
      h('button.btn.ghost.sm', { type: 'button', onclick: async () => {
        const name = (await prompt('Name your preset', { label: 'Shown in Presets so you can use it again', placeholder: 'e.g. Class uploads' }))?.trim();
        if (!name) return;
        const id = Date.now().toString(36);
        st.mine.unshift({ id, name: name.slice(0, 32), c: { ...c } });
        st.editing = null; st.mode = 'presets'; st.preset = 'mine:' + id; persist(); renderOpts();
        toast(`Saved “${name}” to your presets`, 'success');
      } }, icon('save', 16), editing ? 'Save as new' : 'Save as my preset'),
      editing ? h('button.link-btn', { type: 'button', onclick: () => { st.editing = null; renderOpts(); } }, 'Cancel editing') : null));
    return rows;
  }

  /** "What will happen" line for the current choice. */
  function planLine(spec) {
    const bits = [];
    const vids = queue.items.filter((i) => i.kind === 'video' && i.media);
    if (vids.length) {
      const total = sumSize();
      const p = videoPlan(vids[0].media, spec, targetFor(vids[0], spec, total));
      bits.push(`Video ${p.width}×${p.height} · ${(spec.video?.format || 'mp4').toUpperCase()}${p.abr ? '' : ' · no sound'}`);
      if (vids.some((v) => videoPlan(v.media, spec, targetFor(v, spec, total)).tight)) {
        return [h('div.plan', icon('video', 16), h('span', bits.join(' · '))),
          h('div.plan.warn', icon('info', 16), h('span', 'A video is long for this size limit, so it will look blurry. For better quality, trim it in the Video editor first.'))];
      }
    }
    if (spec.limitMB) bits.push(spec.total ? `all files under ${spec.limitMB} MB` : `each file under ${spec.limitMB} MB`);
    if (spec.aspect) bits.push(`cropped to ${spec.aspect.join(':')}`);
    return bits.length ? [h('div.plan', icon('target', 16), h('span', bits.join(' · ')))] : [];
  }

  function renderOpts() {
    const kinds = new Set(queue.items.map((i) => i.kind));
    const cur = current();
    const modeSeg = h('div.ready-mode', segmented([{ value: 'presets', label: 'Presets', icon: 'star' }, { value: 'custom', label: 'Custom', icon: 'sliders' }], st.mode, (v) => { st.mode = v; persist(); renderOpts(); }));
    const blocks = [h('div.card.opt-block.ready-block',
      h('div.ob-head', icon('target', 18), h('h3', 'Make it ready for…'), queue.items.length ? h('span.muted.small', `${queue.items.length} file${queue.items.length > 1 ? 's' : ''}`) : null),
      modeSeg,
      h('div.ready-sec', st.mode === 'presets' ? presetsSection() : customSection(kinds)),
      ...planLine(cur.spec))];
    optsHost.replaceChildren(...blocks);
    renderSummary();
  }
  function renderSummary() {
    if (!queue.items.length) { summary.replaceChildren(); return; }
    const { spec } = current();
    const tin = sumSize(), est = totalEstimate(spec);
    summary.replaceChildren(h('div.sum', h('span.muted', 'Estimated'), h('strong', `${fmtBytes(tin)} → ${est == null ? '…' : '≈ ' + fmtBytes(est)}`),
      est != null && tin && est < tin ? h('span.badge.save', `−${Math.round((1 - est / tin) * 100)}%`) : null));
  }

  // ---------- run ----------
  function start() {
    if (!queue.items.length) return;
    guardBigJob({ bytes: sumSize(), heavy: queue.items.some((i) => isHeavyMedia(i.media)) }, begin);
  }
  function begin() {
    const first = queue.items[0];
    const cur = current();
    const total = sumSize();
    const run = startRun(queue.items.length, outName(first.file.name, extOf(first.file.name) || 'mp4', cur.tag));
    const n = queue.items.filter((i) => i.status !== 'done').length || queue.items.length;
    queue.run((it, ctx) => job(it, run, ctx, cur, total), { label: 'Making ready', tool: 'ready', task: { icon: 'target', title: `${cur.name}: ${n} file${n > 1 ? 's' : ''}` } });
    bar.update();
  }
  async function job(it, run, ctx, { spec, tag }, total) {
    const target = targetFor(it, spec, total);
    if (it.kind === 'image') return imageJob(it, run, ctx, spec, tag, target);
    if (it.kind === 'pdf') return pdfJob(it, run, ctx, spec, tag, target);
    it.media ||= await probe(it.file);
    const dur = it.media.duration || 1;
    if (it.kind === 'audio') {
      const fmt = spec.audio?.format || 'm4a';
      let kbps = spec.audio?.kbps || 128;
      if (target) kbps = Math.max(24, Math.min(kbps, Math.floor((target * 8 * 0.93) / dur / 1000)));
      return processMedia(it.file, { container: fmt, audio: { bitrate: kbps * 1000 } }, { ...ctx, run, name: queue.nameFor(it, outName(it.file.name, fmt, tag)) });
    }
    const p = videoPlan(it.media, spec, target);
    const container = spec.video?.format === 'webm' ? 'webm' : 'mp4';
    const opts = {
      container,
      video: { codec: p.codec, width: p.width, height: p.height, bitrate: p.vbr, fps: p.fps || undefined, crop: p.crop || undefined, forceTranscode: true },
      audio: p.abr ? { bitrate: p.abr } : { discard: true },
      duration: dur,
    };
    const name = queue.nameFor(it, outName(it.file.name, container, tag));
    let res = await processMedia(it.file, opts, { ...ctx, run, name, duration: dur });
    // Encoders don't always hit the bitrate exactly: if it came out too big, try once more a bit smaller.
    if (target && res.size > target && !res.savedToDisk) {
      ctx.onStatus?.('Slightly too big. Making it smaller…');
      opts.video.bitrate = Math.max(40e3, p.vbr * ((target * 0.9) / res.size));
      res = await processMedia(it.file, opts, { ...ctx, run: { method: 'auto', ready: Promise.resolve() }, name, duration: dur });
    }
    if (target && res.size > target) it.warn = `It is ${fmtBytes(res.size)}, over the ${fmtBytes(target)} limit. Trim the video in the Video editor first, then try again.`;
    return res;
  }
  async function imageJob(it, run, ctx, spec, tag, target) {
    it.dims ||= await imageInfo(it.file);
    const im = spec.image || {};
    let e = extOf(it.file.name); if (e === 'jpeg') e = 'jpg';
    let fmt = im.format === 'keep' || !im.format ? (['jpg', 'png', 'webp'].includes(e) ? e : 'jpg') : im.format;
    if (target && fmt === 'png') fmt = 'jpg'; // PNG can't be squeezed to a size limit
    if (fmt === 'avif' && !(await canEncode('avif'))) fmt = 'webp';
    const crop = centerCrop(it.dims.width, it.dims.height, spec.aspect);
    const r = await convertImage(it.file, { format: fmt, quality: im.q ?? 0.85, maxW: im.maxW || undefined, maxH: im.maxH || undefined, crop: crop || undefined, targetBytes: target || undefined }, ctx.onProgress);
    let blob = r.blob, ext = r.format;
    // Simple graphics (screenshots, logos) are often smaller as PNG: use that when it wins and no size limit forces JPG.
    if (!target && e === 'png' && ext === 'jpg' && blob.size > it.file.size) {
      const alt = await convertImage(it.file, { format: 'png', maxW: im.maxW || undefined, maxH: im.maxH || undefined, crop: crop || undefined });
      if (alt.blob.size < blob.size) { blob = alt.blob; ext = 'png'; }
    }
    // Nothing needed changing and the original is smaller: keep the original.
    const same = !crop && r.width === it.dims.width && r.height === it.dims.height && ext === e;
    if (same && it.file.size <= blob.size && (!target || it.file.size <= target)) blob = it.file;
    if (target && blob.size > target) it.warn = `Could only get it to ${fmtBytes(blob.size)}.`;
    return writeBlob(run, queue.nameFor(it, outName(it.file.name, ext, tag)), blob);
  }
  async function pdfJob(it, run, ctx, spec, tag, target) {
    const { compress } = await import('../engines/pdf.js');
    const name = queue.nameFor(it, outName(it.file.name, 'pdf', tag));
    const level = spec.pdf?.level || 'auto';
    let best = it.file;
    if (level !== 'auto') {
      const b = await compress(it.file, { level }, ctx.onProgress);
      if (b.size < best.size) best = b;
    } else {
      const levels = target && it.file.size > target ? ['lossless', 'light', 'recommended', 'extreme'] : ['lossless'];
      for (let i = 0; i < levels.length; i++) {
        ctx.onStatus?.(i ? 'Squeezing harder to fit the limit…' : 'Optimising…');
        const b = await compress(it.file, { level: levels[i] }, (p) => ctx.onProgress((i + p) / levels.length));
        if (b.size < best.size) best = b;
        if (!target || best.size <= target) break;
      }
    }
    if (target && best.size > target) it.warn = `Could only get it to ${fmtBytes(best.size)}. Try “Split” in PDF tools to send it in parts.`;
    return writeBlob(run, name, best);
  }

  // ---------- files ----------
  async function annotate(added) {
    for (const it of added) {
      try {
        if (it.kind === 'image') { it.dims = await imageInfo(it.file); queue.setInfo(it, `${it.dims.width}×${it.dims.height}`); }
        else if (it.kind === 'pdf') queue.setInfo(it, 'PDF');
        else {
          it.media = await probe(it.file);
          const m = it.media;
          queue.setInfo(it, [m.width ? `${m.width}×${m.height}` : null, fmtTime(m.duration)].filter(Boolean).join(' · '));
        }
      } catch { queue.setInfo(it, 'Could not read details'); }
      renderOpts();
    }
  }
  const addFiles = (f) => annotate(queue.add(f));
  function pickPreset(key) { if (PRESETS.some((p) => p.id === key) || st.mine.some((m) => 'mine:' + m.id === key)) { st.mode = 'presets'; st.preset = key; persist(); renderOpts(); } }

  // Landing: choose where it's going first, then pick files.
  const landingGrid = h('div.preset-grid.rp-grid.ready-landing', PRESETS.map((p) => presetCard({ key: p.id, name: p.name, icon: p.icon, tag: p.ask ? 'You choose the size limit' : p.tag }, {
    landing: true,
    onPick: async () => { pickPreset(p.id); const f = await pickFiles({ accept: ACCEPT }); if (f.length) addFiles(f); },
  })));
  const body = h('div.tool-body',
    h('div.tool-main', dropZone({ title: 'Add more', compact: true, accept: ACCEPT, onFiles: addFiles }), queue.el),
    h('div.tool-side', optsHost));
  const el = h('div.tool',
    pageHeader('Ready for…', 'Pick where your file is going. Morph makes it the right size, shape and format.', 'target'),
    h('div.landing',
      dropZone({ title: 'Drop videos, photos, audio or PDFs', accept: ACCEPT, kinds: ['WhatsApp', 'Discord', 'Email', 'Instagram', 'TikTok'], onFiles: addFiles }),
      h('div.ready-intro', h('h3', 'Or start with where it’s going'), landingGrid,
        h('p.muted.small', icon('sliders', 14), ' Want full control? Add files, then open “Custom”. You can save your own presets.'))),
    body);
  dockBar(bar, body.querySelector('.tool-side'), el);
  if (sub?.[0]) { pickPreset(sub[0]); queueMicrotask(() => app.go('ready')); }
  renderOpts();
  if (files?.length) addFiles(files);
  return {
    el,
    accept: (f) => { addFiles(f); },
    route(s, f) {
      if (s?.[0]) { pickPreset(s[0]); queueMicrotask(() => app.go('ready')); }
      if (f?.length) { if (!queue.running) queue.clear(); addFiles(f); }
    },
    destroy: () => queue.cancel(),
    get busy() { return queue.running; },
  };
}
