// Photo tools: resize, crop, rotate & flip, watermark, remove hidden info, blur faces & areas,
// remove background (AI) and photo to text (OCR). Batches of any size, all on this device.
import { h, fmtBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, dropZone, createQueue, queueBar, dockBar } from '../core/components.js';
import { segmented, slider, field, select, toast, modal } from '../core/ui.js';
import { outName, kindOf } from '../core/files.js';
import { startRun, writeBlob } from '../core/save.js';
import { imageInfo } from '../engines/image.js';
import { editPhoto, readMeta, stripMeta, outFormat, ASPECTS } from '../engines/photo.js';
import { app } from '../app.js';

const ACCEPT = 'image/*,.heic,.heif';
const POS = ['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br'];

export const PHOTO_TOOLS = [
  { id: 'resize', title: 'Resize photos', desc: 'Make photos smaller or an exact size, many at once', icon: 'compress', group: 'Edit', action: 'Resize', suffix: 'resized',
    defaults: { mode: 'max', max: 1920, percent: 50, width: 1080, height: 1080, fit: 'contain', format: 'keep', quality: 0.9 } },
  { id: 'crop', title: 'Crop photos', desc: 'Square, 4:5, 16:9, 9:16… for every photo', icon: 'crop', group: 'Edit', action: 'Crop', suffix: 'cropped', preview: true,
    defaults: { aspect: '1:1', anchor: 'center', format: 'keep', quality: 0.92 } },
  { id: 'rotate', title: 'Rotate & flip', desc: 'Turn or mirror photos', icon: 'rotate', group: 'Edit', action: 'Rotate', suffix: 'rotated', preview: true,
    defaults: { rotate: 90, flipH: false, flipV: false, format: 'keep', quality: 0.92 } },
  { id: 'watermark', title: 'Watermark photos', desc: 'Add your name or © to every photo', icon: 'stamp', group: 'Edit', action: 'Add watermark', suffix: 'watermarked', preview: true,
    defaults: { text: '© Your name', position: 'br', size: 5, opacity: 0.6, color: '#ffffff', angle: 0, format: 'keep', quality: 0.92 } },
  { id: 'clean', title: 'Remove hidden info', desc: 'Delete location, camera and date before sharing', icon: 'lock', group: 'Privacy', action: 'Remove info', suffix: 'clean', defaults: {} },
  { id: 'blur', title: 'Blur faces & areas', desc: 'Hide faces automatically, or blur any area (like number plates)', icon: 'portrait', group: 'Privacy', action: 'Blur', suffix: 'blurred',
    defaults: { auto: true, mode: 'blur', strength: 2, format: 'keep', quality: 0.92 } },
  { id: 'removebg', title: 'Remove background', desc: 'Cut out people and objects (AI, on this device)', icon: 'sparkle', group: 'Smart', action: 'Remove background', suffix: 'cutout',
    defaults: { bg: 'transparent', color: '#ffffff', format: 'png' } },
  { id: 'ocr', title: 'Photo to text', desc: 'Copy the text from a photo or screenshot', icon: 'text', group: 'Smart', action: 'Read text', suffix: 'text', defaults: {} },
];
const LINKS = [
  { href: '#/scan', title: 'Scan documents', desc: 'Camera → straight, clean PDF', icon: 'camera', group: 'Smart' },
  { href: '#/compress', title: 'Compress photos', desc: 'Smaller files, same look', icon: 'compress', group: 'More' },
  { href: '#/convert', title: 'Convert photos', desc: 'JPG, PNG, WebP, HEIC, AVIF…', icon: 'convert', group: 'More' },
  { href: '#/ready', title: 'Ready for…', desc: 'Instagram, WhatsApp, Email…', icon: 'target', group: 'More' },
];

export default function photoView({ sub, files }) {
  const root = h('div.tool.photo-tools');
  const ctls = new Map();
  let cur = null, gridEl = null;
  function show(id, incoming) {
    const t = PHOTO_TOOLS.find((x) => x.id === id);
    for (const [k, c] of ctls) if (k !== id && !c.busy) { c.destroy?.(); c.el.remove(); ctls.delete(k); }
    if (!t) {
      cur = null; gridEl ||= grid();
      [...root.children].forEach((c) => { c.hidden = c !== gridEl; });
      if (!gridEl.isConnected) root.append(gridEl);
      if (incoming?.length) app.openActions(incoming);
      return;
    }
    let c = ctls.get(id);
    if (c && incoming?.length && !c.busy) { c.destroy?.(); c.el.remove(); ctls.delete(id); c = null; }
    if (!c) { c = toolPage(t, incoming); ctls.set(id, c); root.append(c.el); }
    else if (incoming?.length) c.accept(incoming);
    cur = c;
    [...root.children].forEach((x) => { x.hidden = x !== c.el; });
  }
  function grid() {
    const groups = [['Edit', 'Edit'], ['Privacy', 'Privacy'], ['Smart', 'Smart (on this device)'], ['More', 'More for photos']];
    const card = (href, t, i) => h('a.pdf-card', { href, style: { '--i': i } }, h('span.pc-ic', icon(t.icon, 22)), h('strong', t.title), h('small', t.desc));
    return h('div',
      pageHeader('Photo tools', 'Resize, crop, watermark, blur faces, remove backgrounds and more. Many photos at once, all on your device.', 'image'),
      groups.map(([g, label]) => h('section.pdf-group', h('h2.group-title', label),
        h('div.pdf-grid',
          ...PHOTO_TOOLS.filter((t) => t.group === g).map((t, i) => card(`#/photo/${t.id}`, t, i)),
          ...LINKS.filter((l) => l.group === g).map((l, i) => card(l.href, l, i + 4))))));
  }
  show(sub?.[0], files);
  return {
    el: root,
    route: (s, f) => show(s?.[0], f),
    accept: (f) => (cur ? cur.accept(f) : false),
    destroy: () => ctls.forEach((c) => c.destroy?.()),
    get busy() { return [...ctls.values()].some((c) => c.busy); },
  };
}

function toolPage(t, incoming) {
  const st = { ...t.defaults };
  const optsHost = h('div.opts');
  let texts = [];
  const queue = createQueue({
    accept: (f) => kindOf(f) === 'image',
    onChange: (_items, added) => { renderOpts(); bar.update(); body.classList.toggle('has-files', queue.items.length > 0); if (added?.length) annotate(added); refreshPreview(); },
  });
  const summary = h('div.ab-summary');
  const bar = queueBar(queue, { startLabel: t.action, onStart: start, extra: summary });

  // ---------- preview (first photo, small copy) ----------
  let pvSrc = null, pvFor = null, pvTimer = 0;
  const pvImg = h('img.pv-img', { alt: 'Preview' });
  const preview = h('div.card.pv-card', h('div.ob-head', icon('image', 18), h('h3', 'Preview'), h('span.muted.small', 'first photo')), h('div.pv-box', pvImg));
  async function refreshPreview() {
    if (!t.preview) return;
    const first = queue.items[0]?.file;
    preview.hidden = !first;
    if (!first) return;
    clearTimeout(pvTimer);
    pvTimer = setTimeout(async () => {
      try {
        if (pvFor !== first) { pvFor = first; const r = await editPhoto(first, { resize: { mode: 'max', max: 900 }, format: 'jpg', quality: 0.85 }); pvSrc = new File([r.blob], 'preview.jpg', { type: 'image/jpeg' }); }
        const r = await editPhoto(pvSrc, { ...opsFor(st), format: 'jpg', quality: 0.85, resize: undefined });
        const u = URL.createObjectURL(r.blob); const old = pvImg.src; pvImg.src = u; if (old.startsWith('blob:')) URL.revokeObjectURL(old);
      } catch (e) { console.warn(e); }
    }, 120);
  }

  // ---------- options ----------
  const set = (k, again = true) => (v) => { st[k] = v; if (again) renderOpts(); refreshPreview(); };
  const fmtRow = (opts = ['keep', 'jpg', 'png', 'webp']) => field('Save as', segmented(opts.map((v) => ({ value: v, label: v === 'keep' ? 'Same as original' : v.toUpperCase() })), st.format, set('format'), { small: true }));
  function renderOpts() {
    const rows = [];
    switch (t.id) {
      case 'resize':
        rows.push(field('How', segmented([{ value: 'max', label: 'Longest side' }, { value: 'percent', label: 'Percentage' }, { value: 'exact', label: 'Exact size' }], st.mode, set('mode'), { small: true })));
        if (st.mode === 'max') rows.push(field('Longest side', h('div.target-row',
          segmented([3840, 2560, 1920, 1280, 1080, 800].map((v) => ({ value: v, label: `${v}` })), st.max, set('max'), { small: true }),
          h('label.num', h('input.input', { type: 'number', min: 16, value: st.max, onchange: (e) => set('max')(Math.max(16, +e.target.value || 1920)) }), h('span', 'px'))), 'Photos already smaller stay the same size.'));
        if (st.mode === 'percent') rows.push(field('Size', slider({ min: 5, max: 100, step: 5, value: st.percent, format: (v) => `${v}%`, onInput: (v) => { st.percent = v; }, onChange: () => renderOpts() })));
        if (st.mode === 'exact') rows.push(h('div.row2',
          field('Width', h('label.num', h('input.input', { type: 'number', min: 1, value: st.width, onchange: (e) => set('width', false)(+e.target.value || 0) }), h('span', 'px'))),
          field('Height', h('label.num', h('input.input', { type: 'number', min: 1, value: st.height, onchange: (e) => set('height', false)(+e.target.value || 0) }), h('span', 'px')))),
        field('If the shape is different', segmented([{ value: 'contain', label: 'Keep proportions' }, { value: 'stretch', label: 'Stretch to fit' }], st.fit, set('fit'), { small: true }), 'To fill an exact shape without stretching, use Crop first.'));
        rows.push(fmtRow());
        break;
      case 'crop':
        rows.push(field('Shape', h('div.chip-row', Object.keys(ASPECTS).map((k) => h('button.chip', { type: 'button', 'aria-pressed': st.aspect === k, onclick: () => set('aspect')(k) }, k)))));
        rows.push(field('Keep', segmented([{ value: 'top', label: 'Top' }, { value: 'center', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }], st.anchor, set('anchor'), { small: true }), 'Which part of tall photos to keep.'));
        rows.push(fmtRow());
        break;
      case 'rotate':
        rows.push(field('Turn', segmented([{ value: 0, label: 'No' }, { value: 270, label: '↺ Left' }, { value: 90, label: '↻ Right' }, { value: 180, label: 'Upside down' }], st.rotate, set('rotate'), { small: true })));
        rows.push(h('div.btn-row',
          h('button.btn.ghost.sm', { type: 'button', 'aria-pressed': st.flipH, onclick: () => set('flipH')(!st.flipH) }, icon('flip', 16), 'Mirror'),
          h('button.btn.ghost.sm', { type: 'button', 'aria-pressed': st.flipV, onclick: () => set('flipV')(!st.flipV) }, icon('flip', 16), 'Flip upside down')));
        rows.push(fmtRow());
        break;
      case 'watermark':
        rows.push(field('Text', h('input.input', { value: st.text, maxLength: 80, oninput: (e) => { st.text = e.target.value; refreshPreview(); } })));
        rows.push(field('Where', h('div.wm-pos',
          ...POS.map((p) => h('button.pos', { type: 'button', title: p, 'aria-pressed': st.position === p, onclick: () => set('position')(p) }, h('span'))),
          h('button.chip.wm-tile', { type: 'button', 'aria-pressed': st.position === 'tile', onclick: () => set('position')('tile') }, icon('grid', 14), 'Repeat all over'))));
        rows.push(field('Size', slider({ min: 2, max: 20, step: 0.5, value: st.size, format: (v) => `${v}%`, onInput: (v) => { st.size = v; refreshPreview(); } })));
        rows.push(field('See-through', slider({ min: 0.1, max: 1, step: 0.05, value: st.opacity, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { st.opacity = v; refreshPreview(); } })));
        rows.push(h('div.row2',
          field('Color', h('div.btn-row', ['#ffffff', '#000000', '#e11d48'].map((c) => h('button.swatch', { type: 'button', style: { background: c }, 'aria-pressed': st.color === c, 'aria-label': c, onclick: () => set('color')(c) })),
            h('input.input.color', { type: 'color', value: st.color, oninput: (e) => { st.color = e.target.value; refreshPreview(); } }))),
          field('Angle', segmented([0, 30, 45].map((v) => ({ value: v, label: `${v}°` })), st.angle, set('angle'), { small: true }))));
        rows.push(fmtRow());
        break;
      case 'clean':
        rows.push(h('div.plan', icon('lock', 16), h('span', 'Removes location (GPS), camera model, date and other hidden details. JPG, PNG and WebP keep exactly the same picture quality.')));
        break;
      case 'blur':
        rows.push(h('label.check', h('input', { type: 'checkbox', checked: st.auto, onchange: (e) => set('auto')(e.target.checked) }), 'Find and blur faces automatically'));
        rows.push(field('Style', segmented([{ value: 'blur', label: 'Blur' }, { value: 'pixelate', label: 'Pixelate' }], st.mode, set('mode'), { small: true })));
        rows.push(field('Strength', segmented([{ value: 1, label: 'Light' }, { value: 2, label: 'Medium' }, { value: 3, label: 'Strong' }], st.strength, set('strength'), { small: true })));
        rows.push(h('p.hint', 'Tap “Areas” on a photo to check the faces found, or draw your own boxes (number plates, screens, addresses).'));
        rows.push(fmtRow());
        break;
      case 'removebg':
        rows.push(field('Background', segmented([{ value: 'transparent', label: 'See-through' }, { value: 'white', label: 'White' }, { value: 'color', label: 'Color' }], st.bg, (v) => { st.bg = v; if (v === 'transparent' && st.format === 'jpg') st.format = 'png'; renderOpts(); }, { small: true })));
        if (st.bg === 'color') rows.push(field('Color', h('input.input.color', { type: 'color', value: st.color, oninput: (e) => (st.color = e.target.value) })));
        rows.push(field('Save as', segmented([{ value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }, { value: 'jpg', label: 'JPG', disabled: st.bg === 'transparent' }], st.format, set('format'), { small: true })));
        rows.push(h('div.plan', icon('sparkle', 16), h('span', 'Works best with a clear subject (people, products, pets). A small AI model (5 MB) downloads the first time, then it works offline.')));
        break;
      case 'ocr':
        rows.push(h('div.plan', icon('text', 16), h('span', 'Reads English text. The text reader (about 11 MB) downloads the first time, then it works offline.')));
        if (texts.length) rows.push(h('div.btn-row',
          h('button.btn.primary.sm', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(texts.join('\n\n')); toast('Text copied', 'success'); } catch { toast('Could not copy. Save the .txt instead.', 'error'); } } }, icon('paste', 16), 'Copy all text'),
          h('button.btn.ghost.sm', { type: 'button', onclick: () => modal({ title: 'Text found', wide: true, body: h('textarea.input.ocr-out', { readOnly: true, value: texts.join('\n\n') }) }) }, icon('text', 16), 'Show text')));
        break;
      default: break;
    }
    optsHost.replaceChildren(h('div.card.opt-block', h('div.ob-head', icon(t.icon, 18), h('h3', 'Options')), h('div.ob-extra', rows)), t.preview ? preview : '');
    summary.replaceChildren(queue.items.length ? h('div.sum', h('span.muted', `${queue.items.length} photo${queue.items.length > 1 ? 's' : ''}`), h('strong', fmtBytes(queue.items.reduce((a, i) => a + i.file.size, 0)))) : '');
  }
  function opsFor(s, it) {
    switch (t.id) {
      case 'resize': return { resize: { mode: s.mode, max: s.max, percent: s.percent, width: s.width, height: s.height, fit: s.fit }, format: s.format, quality: s.quality };
      case 'crop': return { crop: { aspect: s.aspect, anchor: s.anchor }, format: s.format, quality: s.quality };
      case 'rotate': return { rotate: s.rotate, flipH: s.flipH, flipV: s.flipV, format: s.format, quality: s.quality };
      case 'watermark': return { watermark: { text: s.text, position: s.position, size: s.size, opacity: s.opacity, color: s.color, angle: s.angle }, format: s.format, quality: s.quality };
      case 'blur': return { blur: it?.areas || [], blurMode: s.mode, blurStrength: s.strength, format: s.format, quality: s.quality };
      default: return {};
    }
  }

  // ---------- per-photo info ----------
  async function annotate(added) {
    for (const it of added) {
      try {
        const d = await imageInfo(it.file); it.dims = d;
        let info = `${d.width}×${d.height}`;
        if (t.id === 'clean') {
          const m = await readMeta(it.file);
          const has = [m.location && 'location', m.camera && 'camera', m.date && 'date'].filter(Boolean);
          info += has.length ? ` · has ${has.join(', ')}` : ' · no location found';
        }
        queue.setInfo(it, info);
        if (t.id === 'blur') addAreasButton(it);
      } catch { queue.setInfo(it, 'Could not read this photo'); }
    }
  }
  function addAreasButton(it) {
    const btn = h('button.btn.ghost.sm', { type: 'button', onclick: () => editAreas(it) }, icon('portrait', 14), 'Areas');
    it.dom?.actions.replaceChildren(btn);
  }
  async function editAreas(it) {
    const { detectFaces } = await import('../engines/ai.js');
    const { width: W, height: H } = it.dims;
    const url = URL.createObjectURL(it.file);
    const layer = h('div.ba-layer');
    const stage = h('div.ba-stage', h('img', { src: url, alt: '', draggable: false }), layer);
    const status = h('span.muted.small');
    let areas = it.areas ? it.areas.map((a) => ({ ...a })) : null;
    const paint = () => {
      layer.replaceChildren(...(areas || []).map((a, i) => h('div.ba-box', { style: { left: `${(a.x / W) * 100}%`, top: `${(a.y / H) * 100}%`, width: `${(a.w / W) * 100}%`, height: `${(a.h / H) * 100}%` } },
        h('button.ov-del', { type: 'button', 'aria-label': 'Remove this area', onclick: (e) => { e.stopPropagation(); areas.splice(i, 1); paint(); } }, icon('x', 12)))));
      status.textContent = areas ? `${areas.length} area${areas.length === 1 ? '' : 's'}` : '';
    };
    const find = async () => {
      status.textContent = 'Looking for faces…';
      try { const f = await detectFaces(it.file, { onStatus: (m) => (status.textContent = m) }); areas = (areas || []).filter((a) => a.manual).concat(f.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))); paint(); }
      catch (e) { status.textContent = e.message; }
    };
    // Draw new boxes by dragging.
    layer.addEventListener('pointerdown', (e) => {
      if (e.target !== layer) return;
      e.preventDefault();
      const r = layer.getBoundingClientRect();
      const x0 = (e.clientX - r.left) / r.width, y0 = (e.clientY - r.top) / r.height;
      const ghost = h('div.ba-box.drawing'); layer.append(ghost);
      layer.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const x1 = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y1 = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
        Object.assign(ghost.style, { left: `${Math.min(x0, x1) * 100}%`, top: `${Math.min(y0, y1) * 100}%`, width: `${Math.abs(x1 - x0) * 100}%`, height: `${Math.abs(y1 - y0) * 100}%` });
        ghost._r = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
      };
      const up = () => {
        layer.removeEventListener('pointermove', mv); layer.removeEventListener('pointerup', up); ghost.remove();
        if (ghost._r && ghost._r[2] > 0.01 && ghost._r[3] > 0.01) { areas ||= []; areas.push({ x: ghost._r[0] * W, y: ghost._r[1] * H, w: ghost._r[2] * W, h: ghost._r[3] * H, shape: 'rect', manual: true }); paint(); }
      };
      layer.addEventListener('pointermove', mv); layer.addEventListener('pointerup', up);
    });
    modal({
      title: 'Areas to blur', wide: true,
      body: h('div.ba', h('div.btn-row', h('button.btn.ghost.sm', { type: 'button', onclick: find }, icon('portrait', 16), 'Find faces'),
        h('button.btn.ghost.sm', { type: 'button', onclick: () => { areas = []; paint(); } }, icon('trash', 16), 'Clear'), status),
      h('p.hint', 'Drag on the photo to add a box. Tap × to remove one.'), stage),
      onClose: () => URL.revokeObjectURL(url),
      actions: [{ label: 'Cancel' }, { label: 'Use these areas', primary: true, onClick: () => { it.areas = areas || []; queue.setInfo(it, `${W}×${H} · ${it.areas.length} area${it.areas.length === 1 ? '' : 's'}`); addAreasButton(it); } }],
    });
    if (it.areas) paint(); else find();
  }

  // ---------- run ----------
  function start() {
    if (!queue.items.length) return;
    if (t.id === 'watermark' && !st.text.trim()) { toast('Type the watermark text first', 'error'); return; }
    const first = queue.items[0];
    const run = startRun(queue.items.length, outName(first.file.name, 'jpg', t.suffix));
    if (t.id === 'ocr') texts = [];
    queue.run((it, ctx) => job(it, run, ctx), { label: t.action, tool: `photo/${t.id}`, task: { icon: t.icon, route: `photo/${t.id}`, title: `${t.title}: ${queue.items.length} photo${queue.items.length > 1 ? 's' : ''}` } })
      .then(() => { if (t.id === 'ocr') renderOpts(); });
    bar.update();
  }
  async function job(it, run, ctx) {
    const name = (ext) => queue.nameFor(it, outName(it.file.name, ext, t.suffix));
    ctx.onProgress(0.1);
    if (t.id === 'clean') {
      const r = await stripMeta(it.file);
      it.note = r.lossless ? 'Hidden info removed · picture untouched' : 'Hidden info removed';
      return writeBlob(run, name(r.format), r.blob);
    }
    if (t.id === 'ocr') {
      const { ocrImage } = await import('../engines/ocr.js');
      const r = await ocrImage(it.file, { onProgress: ctx.onProgress, onStatus: ctx.onStatus });
      texts.push(r.text.trim());
      if (!r.text.trim()) it.warn = 'No text found in this photo.';
      return writeBlob(run, name('txt'), new Blob([r.text], { type: 'text/plain' }));
    }
    if (t.id === 'removebg') {
      const { removeBackground } = await import('../engines/ai.js');
      const bg = st.bg === 'white' ? '#ffffff' : st.bg === 'color' ? st.color : null;
      const c = await removeBackground(it.file, { background: bg, onStatus: ctx.onStatus });
      const { encode } = await import('../engines/image.js');
      const fmt = !bg && st.format === 'jpg' ? 'png' : st.format;
      return writeBlob(run, name(fmt), await encode(c, fmt, 0.92));
    }
    if (t.id === 'blur' && st.auto && !it.areas) {
      const { detectFaces } = await import('../engines/ai.js');
      const f = await detectFaces(it.file, { onStatus: ctx.onStatus });
      it.areas = f.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
      if (!f.length) it.warn = 'No faces found. Tap “Areas” to draw boxes yourself.';
    }
    ctx.onStatus?.(t.action + '…');
    const r = await editPhoto(it.file, opsFor(st, it));
    if (t.id === 'blur') it.note = `${it.areas?.length || 0} area${it.areas?.length === 1 ? '' : 's'} blurred`;
    return writeBlob(run, name(r.format), r.blob);
  }

  const body = h('div.tool-body',
    h('div.tool-main', dropZone({ title: 'Add more photos', compact: true, accept: ACCEPT, onFiles: (f) => queue.add(f) }), queue.el),
    h('div.tool-side', optsHost));
  const el = h('div.tool',
    h('div.crumbs', h('a.btn.ghost.sm', { href: '#/photo' }, icon('back', 16), 'All photo tools')),
    pageHeader(t.title, t.desc, t.icon),
    h('div.landing', dropZone({ title: 'Drop photos here', accept: ACCEPT, kinds: ['JPG', 'PNG', 'HEIC', 'WebP'], onFiles: (f) => queue.add(f) })),
    body);
  dockBar(bar, body.querySelector('.tool-side'), el);
  renderOpts();
  if (incoming?.length) queue.add(incoming);
  return { el, accept: (f) => { queue.add(f); }, destroy: () => queue.cancel(), get busy() { return queue.running; } };
}

// Used by Recipes.
export { outFormat };
