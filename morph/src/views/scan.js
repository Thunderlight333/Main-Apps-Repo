// Scan documents: take photos of paper (camera or gallery), Morph finds the page, straightens it,
// cleans it up, and makes one PDF, optionally searchable (OCR). All on this device.
import { h, fmtBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, resultActions, localBadge, friendly } from '../core/components.js';
import { segmented, field, toast, modal, progressBar, feedback } from '../core/ui.js';
import { pickFiles } from '../core/files.js';
import { startRun, writeBlob } from '../core/save.js';
import { sortable, settle } from '../core/sortable.js';
import { tasks } from '../core/tasks.js';
import { recent } from '../core/recent.js';
import { history } from '../core/history.js';
import { decode, toBlob, OffscreenCanvasOr } from '../engines/image.js';
import { findPageCorners, warpPage, scanFilter } from '../engines/photo.js';

const FILTERS = [{ value: 'enhance', label: 'Clean' }, { value: 'bw', label: 'Black & white' }, { value: 'gray', label: 'Gray' }, { value: 'original', label: 'Original' }];
const FULL = [[0, 0], [1, 0], [1, 1], [0, 1]];

export default function scanView() {
  const pages = []; // { id, file, bmp, corners, rotate, filter, blob, url, w, h }
  const st = { filter: 'enhance', size: 'a4', ocr: false, name: `Scan ${new Date().toISOString().slice(0, 10)}` };
  let working = false, uid = 0;

  const grid = h('div.scan-grid');
  sortable(grid, { items: '.scan-page', handle: '.sp-img', onSort: (from, to) => { const [x] = pages.splice(from, 1); pages.splice(to, 0, x); renumber(); } });
  const empty = h('div.scan-empty',
    h('div.dz-orb', icon('camera', 30)),
    h('strong', 'Scan paper into a clean PDF'),
    h('p.muted', 'Take photos of receipts, notes, forms or book pages. Morph finds each page, straightens it and makes it easy to read.'),
    h('div.btn-row.center',
      h('button.btn.primary', { type: 'button', onclick: () => openCamera() }, icon('camera', 18), 'Use camera'),
      h('button.btn.ghost', { type: 'button', onclick: () => choose() }, icon('image', 18), 'Choose photos')));
  const addBar = h('div.scan-add', { hidden: true },
    h('button.btn.ghost.sm', { type: 'button', onclick: () => openCamera() }, icon('camera', 16), 'Take more'),
    h('button.btn.ghost.sm', { type: 'button', onclick: () => choose() }, icon('plus', 16), 'Add photos'),
    h('span.muted.small.scan-count'));
  const optsHost = h('div.opts');
  const progress = progressBar(); progress.hidden = true;
  const goBtn = h('button.btn.primary.lg', { type: 'button', onclick: makePdf }, icon('pdf', 18), 'Make PDF');
  const imgBtn = h('button.btn.ghost', { type: 'button', onclick: saveImages }, icon('image', 16), 'Save as images');
  const resultHost = h('div.pdf-results');
  const side = h('div.tool-side', optsHost, h('div.card.go-card', progress, h('div.btn-row', imgBtn, goBtn), resultHost));
  const body = h('div.tool-body', h('div.tool-main', addBar, grid), side);
  const el = h('div.tool.scan',
    h('div.crumbs', h('a.btn.ghost.sm', { href: '#/pdf' }, icon('back', 16), 'PDF tools')),
    pageHeader('Scan to PDF', 'Photos of paper → straight, clean pages in one PDF. Optional: make the text searchable.', 'camera'),
    h('div.landing', empty), body);

  function choose() { pickFiles({ accept: 'image/*,.heic,.heif' }).then((f) => f.length && add(f)); }
  async function add(files) {
    const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (!imgs.length) { toast('Add photos of your pages', 'error'); return; }
    for (const file of imgs) {
      const pg = { id: ++uid, file, rotate: 0, filter: st.filter };
      pages.push(pg);
      grid.append(card(pg));
      update();
      try { await process(pg, true); } catch (e) { toast(friendly(e), 'error'); }
      paintCard(pg);
    }
  }
  async function bitmapOf(pg) {
    if (pg.bmp) return pg.bmp;
    const b = await decode(pg.file);
    const s = Math.min(1, 2800 / Math.max(b.width, b.height));
    if (s < 1) { const c = OffscreenCanvasOr(Math.round(b.width * s), Math.round(b.height * s)); c.getContext('2d').drawImage(b, 0, 0, c.width, c.height); b.close?.(); pg.bmp = await createImageBitmap(c); }
    else pg.bmp = b;
    return pg.bmp;
  }
  async function process(pg, detect) {
    const bmp = await bitmapOf(pg);
    if (detect || !pg.corners) pg.corners = findPageCorners(bmp) || FULL;
    let c = warpPage(bmp, pg.corners, 2200);
    if (pg.rotate) {
      const r = OffscreenCanvasOr(pg.rotate % 180 ? c.height : c.width, pg.rotate % 180 ? c.width : c.height), ctx = r.getContext('2d');
      ctx.translate(r.width / 2, r.height / 2); ctx.rotate((pg.rotate * Math.PI) / 180); ctx.drawImage(c, -c.width / 2, -c.height / 2); c = r;
    }
    scanFilter(c, pg.filter);
    pg.w = c.width; pg.h = c.height;
    pg.blob = await toBlob(c, 'image/jpeg', pg.filter === 'bw' ? 0.8 : 0.85);
    if (pg.url) URL.revokeObjectURL(pg.url);
    pg.url = URL.createObjectURL(pg.blob);
  }
  function card(pg) {
    const c = settle(h('div.scan-page', { 'data-id': pg.id },
      h('div.sp-img', h('span.spinner')),
      h('div.sp-foot', h('span.sp-num'),
        h('span.pg-tools',
          h('button.icon-btn.xs', { type: 'button', 'aria-label': 'Adjust page', title: 'Adjust corners & look', onclick: () => editPage(pg) }, icon('crop', 14)),
          h('button.icon-btn.xs', { type: 'button', 'aria-label': 'Rotate page', title: 'Rotate', onclick: async () => { pg.rotate = (pg.rotate + 90) % 360; await process(pg); paintCard(pg); } }, icon('rotate', 14)),
          h('button.icon-btn.xs', { type: 'button', 'aria-label': 'Delete page', title: 'Delete', onclick: () => { pages.splice(pages.indexOf(pg), 1); c.remove(); if (pg.url) URL.revokeObjectURL(pg.url); pg.bmp?.close?.(); update(); } }, icon('trash', 14))))));
    pg.el = c;
    return c;
  }
  function paintCard(pg) {
    if (!pg.el || !pg.url) return;
    pg.el.querySelector('.sp-img').replaceChildren(h('img', { src: pg.url, alt: 'Scanned page', draggable: false }));
    renumber();
  }
  function renumber() { pages.forEach((p, i) => { const n = p.el?.querySelector('.sp-num'); if (n) n.textContent = String(i + 1); }); }
  function update() {
    const has = pages.length > 0;
    el.querySelector('.landing').hidden = has;
    body.classList.toggle('has-files', has);
    addBar.hidden = !has;
    addBar.querySelector('.scan-count').textContent = `${pages.length} page${pages.length === 1 ? '' : 's'} · drag to reorder`;
    renumber(); renderOpts();
  }

  function renderOpts() {
    optsHost.replaceChildren(h('div.card.opt-block', h('div.ob-head', icon('settings', 18), h('h3', 'Options')), h('div.ob-extra',
      field('Look (all pages)', segmented(FILTERS, st.filter, async (v) => { st.filter = v; for (const p of pages) { p.filter = v; await process(p); paintCard(p); } }, { small: true })),
      field('Page size', segmented([{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Same as photo' }], st.size, (v) => (st.size = v), { small: true })),
      h('label.check', h('input', { type: 'checkbox', checked: st.ocr, onchange: (e) => (st.ocr = e.target.checked) }), 'Make text searchable (OCR)'),
      h('p.hint', 'Lets you search and copy the text in the PDF. English. The text reader (11 MB) downloads the first time.'),
      field('File name', h('input.input', { value: st.name, oninput: (e) => (st.name = e.target.value) })))));
  }

  // ---------- adjust one page ----------
  async function editPage(pg) {
    const bmp = await bitmapOf(pg);
    const url = URL.createObjectURL(pg.file.type && !/heic|heif/i.test(pg.file.type) ? pg.file : await toBlob((() => { const c = OffscreenCanvasOr(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); return c; })(), 'image/jpeg', 0.85));
    let corners = pg.corners.map((p) => p.slice());
    let filter = pg.filter;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.classList.add('sc-poly');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); svg.append(poly);
    const handles = corners.map((_, i) => h('button.sc-h', { type: 'button', 'aria-label': `Corner ${i + 1}` }));
    const stage = h('div.sc-stage', h('img', { src: url, alt: '', draggable: false }), svg, ...handles);
    const paint = () => {
      poly.setAttribute('points', corners.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
      handles.forEach((b, i) => Object.assign(b.style, { left: `${corners[i][0] * 100}%`, top: `${corners[i][1] * 100}%` }));
    };
    handles.forEach((b, i) => b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); b.setPointerCapture(e.pointerId);
      const r = stage.getBoundingClientRect();
      const mv = (ev) => { corners[i] = [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))]; paint(); };
      const up = () => { b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up); };
      b.addEventListener('pointermove', mv); b.addEventListener('pointerup', up);
    }));
    paint();
    modal({
      title: 'Adjust page', wide: true,
      body: h('div.sc-edit',
        h('div.btn-row',
          h('button.btn.ghost.sm', { type: 'button', onclick: () => { corners = (findPageCorners(bmp) || FULL).map((p) => p.slice()); paint(); } }, icon('sparkle', 16), 'Find page'),
          h('button.btn.ghost.sm', { type: 'button', onclick: () => { corners = FULL.map((p) => p.slice()); paint(); } }, icon('image', 16), 'Whole photo')),
        h('p.hint', 'Drag the 4 dots onto the corners of the paper.'),
        stage,
        field('Look', segmented(FILTERS, filter, (v) => (filter = v), { small: true }))),
      onClose: () => URL.revokeObjectURL(url),
      actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: () => { pg.corners = corners; pg.filter = filter; process(pg).then(() => paintCard(pg)); } }],
    });
  }

  // ---------- live camera ----------
  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { choose(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false }); }
    catch { toast('The camera is blocked or not available. Choose photos instead.', 'error'); choose(); return; }
    const video = h('video.cam-video', { autoplay: true, muted: true, playsInline: true });
    video.srcObject = stream;
    let taken = 0;
    const count = h('span.cam-count', '0 pages');
    const flash = h('div.cam-flash');
    const shoot = async () => {
      if (!video.videoWidth) return;
      const c = OffscreenCanvasOr(video.videoWidth, video.videoHeight);
      c.getContext('2d').drawImage(video, 0, 0);
      const blob = await toBlob(c, 'image/jpeg', 0.92);
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
      taken++; count.textContent = `${taken} page${taken === 1 ? '' : 's'}`;
      feedback('done');
      add([new File([blob], `page-${pages.length + 1}.jpg`, { type: 'image/jpeg' })]);
    };
    const m = modal({
      title: 'Camera', wide: true,
      body: h('div.cam', h('div.cam-view', video, flash),
        h('div.cam-bar', count, h('button.cam-shutter', { type: 'button', 'aria-label': 'Take photo', onclick: shoot }), h('span.muted.small', 'Hold the phone above the page'))),
      onClose: () => stream.getTracks().forEach((tr) => tr.stop()),
      actions: [{ label: 'Done', primary: true }],
    });
    void m;
  }

  // ---------- output ----------
  async function makePdf() {
    if (!pages.length || working) return;
    if (pages.some((p) => !p.blob)) { toast('Still preparing pages…'); return; }
    const name = `${(st.name || 'Scan').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Scan'}.pdf`;
    const run = startRun(1, name, 'application/pdf');
    working = true; goBtn.disabled = true; progress.hidden = false; progress.set(0); resultHost.replaceChildren();
    const tk = tasks.start({ title: `Scan: ${pages.length} page${pages.length > 1 ? 's' : ''}`, route: 'scan', iconName: 'camera' });
    const onP = (p) => { progress.set(p); tk.progress(p); };
    try {
      const { scansToPdf } = await import('../engines/pdf.js');
      const list = pages.map((p) => ({ blob: p.blob, width: p.w, height: p.h }));
      if (st.ocr) {
        const { ocrImage } = await import('../engines/ocr.js');
        for (let i = 0; i < list.length; i++) {
          tk.status(`Reading text on page ${i + 1}…`);
          const r = await ocrImage(list[i].blob, { textLayer: true, dpi: 200, onProgress: (p) => onP(((i + p) / list.length) * 0.85) });
          list[i].layer = r.pdf;
        }
      }
      const blob = await scansToPdf(list, { pageSize: st.size, dpi: 200, onProgress: (p) => onP((st.ocr ? 0.85 : 0) + p * (st.ocr ? 0.15 : 1)) });
      const res = await writeBlob(run, name, blob);
      history.add({ tool: 'scan', name, inSize: pages.reduce((a, p) => a + p.file.size, 0), outSize: res.size, kind: 'pdf' });
      recent.add(res, { tool: 'scan' });
      resultHost.replaceChildren(h('div.result-card', h('div.rc-info', icon('check', 18), h('strong', res.name), h('span.muted', fmtBytes(res.size)), localBadge()), h('div.rc-actions', resultActions([res]))));
      tk.done(`${res.name} · ${fmtBytes(res.size)}`); feedback('done');
    } catch (e) { console.error(e); toast(friendly(e), 'error', 6000); tk.fail(friendly(e)); feedback('error'); }
    finally { working = false; goBtn.disabled = false; setTimeout(() => (progress.hidden = true), 600); }
  }
  async function saveImages() {
    if (!pages.length) return;
    const run = startRun(pages.length, 'page-1.jpg', 'image/jpeg');
    const res = [];
    for (let i = 0; i < pages.length; i++) res.push(await writeBlob(run, `${st.name || 'Scan'}-${String(i + 1).padStart(2, '0')}.jpg`, pages[i].blob));
    resultHost.replaceChildren(h('div.result-card', h('div.rc-info', icon('check', 18), h('strong', `${res.length} images ready`), localBadge()), h('div.rc-actions', resultActions(res))));
  }

  update();
  return {
    el,
    accept: (f) => { add(f); },
    destroy: () => pages.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); p.bmp?.close?.(); }),
    get busy() { return working; },
  };
}
