// PDF toolkit (ILovePDF-style), fully local.
import { h, fmtBytes, baseName, clamp } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, dropZone, resultActions, friendly, emptyState, orderTools, sortItems } from '../core/components.js';
import { sortable, settle, reorderChildren } from '../core/sortable.js';
import { segmented, slider, field, toast, progressBar, busy, feedback, modal, select } from '../core/ui.js';
import { kindOf, outName } from '../core/files.js';
import { startRun, writeBlob } from '../core/save.js';
import { history } from '../core/history.js';
import * as P from '../engines/pdf.js';
import { thumbOf } from '../engines/image.js';
import { app } from '../app.js';

const TOOLS = [
  { id: 'merge', title: 'Merge PDF', desc: 'Combine PDFs (and images) in the order you want', icon: 'merge', group: 'Organize', accept: 'pdf+image', multi: true, reorder: true },
  { id: 'split', title: 'Split PDF', desc: 'Separate pages or ranges into new PDFs', icon: 'split', group: 'Organize', accept: 'pdf' },
  { id: 'organize', title: 'Organize pages', desc: 'Reorder, rotate and delete pages', icon: 'grid', group: 'Organize', accept: 'pdf', pages: 'organize' },
  { id: 'remove', title: 'Remove pages', desc: 'Delete the pages you don\'t need', icon: 'trash', group: 'Organize', accept: 'pdf', pages: 'select' },
  { id: 'extract', title: 'Extract pages', desc: 'Pull selected pages into a new PDF', icon: 'layers', group: 'Organize', accept: 'pdf', pages: 'select' },
  { id: 'rotate', title: 'Rotate PDF', desc: 'Rotate all or selected pages', icon: 'rotate', group: 'Organize', accept: 'pdf', pages: 'select' },
  { id: 'compress', title: 'Compress PDF', desc: 'Reduce file size with quality presets', icon: 'compress', group: 'Optimize', accept: 'pdf', multi: true },
  { id: 'repair', title: 'Repair PDF', desc: 'Rebuild a damaged or odd PDF', icon: 'wrench', group: 'Optimize', accept: 'pdf', multi: true },
  { id: 'pdf2img', title: 'PDF to JPG / PNG', desc: 'Every page as an image', icon: 'image', group: 'Convert', accept: 'pdf', multi: true },
  { id: 'img2pdf', title: 'Images to PDF', desc: 'JPG, PNG, HEIC, WebP… into one PDF', icon: 'pdf', group: 'Convert', accept: 'image', multi: true, reorder: true },
  { id: 'pdf2txt', title: 'PDF to Text', desc: 'Extract all text', icon: 'text', group: 'Convert', accept: 'pdf', multi: true },
  { id: 'txt2pdf', title: 'Text to PDF', desc: 'TXT, Markdown, CSV, code → PDF', icon: 'file', group: 'Convert', accept: 'text', multi: true },
  { id: 'sign', title: 'Sign PDF', desc: 'Draw or type your signature and place it', icon: 'pen', group: 'Edit', accept: 'pdf', canvas: 'sign' },
  { id: 'edit', title: 'Add text', desc: 'Type anywhere on any page', icon: 'text', group: 'Edit', accept: 'pdf', canvas: 'text' },
  { id: 'numbers', title: 'Page numbers', desc: 'Add numbers with position & style', icon: 'hash', group: 'Edit', accept: 'pdf', multi: true },
  { id: 'watermark', title: 'Watermark', desc: 'Stamp text over your pages', icon: 'stamp', group: 'Edit', accept: 'pdf', multi: true },
  { id: 'crop', title: 'Crop PDF', desc: 'Trim page margins', icon: 'crop', group: 'Edit', accept: 'pdf', multi: true },
  { id: 'protect', title: 'Protect PDF', desc: 'Encrypt with a password (AES-256)', icon: 'lock', group: 'Security', accept: 'pdf' },
  { id: 'unlock', title: 'Unlock PDF', desc: 'Remove a password you know', icon: 'unlock', group: 'Security', accept: 'pdf' },
];

export default function pdfView({ sub, files }) {
  const root = h('div.tool.pdf-tools');
  let toolCtl = null;
  function show(id, incoming) {
    toolCtl?.destroy?.();
    toolCtl = null;
    const t = TOOLS.find((x) => x.id === id);
    if (!t) { root.replaceChildren(grid()); return; }
    toolCtl = toolPage(t, incoming);
    root.replaceChildren(toolCtl.el);
  }
  function grid() {
    const groups = [...new Set(TOOLS.map((t) => t.group))];
    const search = h('input.input.search', { type: 'search', placeholder: 'Search PDF tools…', oninput: () => {
      const q = search.value.toLowerCase();
      el.querySelectorAll('.pdf-card').forEach((c) => (c.hidden = !c.dataset.k.includes(q)));
      el.querySelectorAll('.pdf-group').forEach((g) => (g.hidden = ![...g.querySelectorAll('.pdf-card')].some((c) => !c.hidden)));
    } });
    const el = h('div',
      pageHeader('PDF tools', 'Everything you need for PDFs. Private, offline, no page or size limits.', 'pdf', h('label.search-wrap', icon('search', 16), search)),
      groups.map((g) => h('section.pdf-group', h('h2.group-title', g),
        h('div.pdf-grid', TOOLS.filter((t) => t.group === g).map((t, i) => h('a.pdf-card', { href: `#/pdf/${t.id}`, 'data-k': (t.title + ' ' + t.desc).toLowerCase(), style: { '--i': i } },
          h('span.pc-ic', icon(t.icon, 22)), h('strong', t.title), h('small', t.desc)))))),
      h('div.note.office-note', icon('info', 16), h('span', 'Word, Excel and PowerPoint ↔ PDF are not included: doing them accurately offline needs a full office suite (hundreds of MB), and results are still unreliable. Export to PDF from your office app, then use these tools.')));
    return el;
  }
  show(sub[0], files);
  return {
    el: root,
    route: (s) => show(s[0], null),
    accept: (f) => { if (toolCtl?.accept) return toolCtl.accept(f); return false; },
    destroy: () => toolCtl?.destroy?.(),
  };
}

function acceptFn(kind) {
  return (f) => {
    const k = kindOf(f);
    if (kind === 'pdf+image') return k === 'pdf' || k === 'image';
    return k === kind;
  };
}
const ACCEPT_ATTR = { pdf: 'application/pdf,.pdf', image: 'image/*,.heic,.heif', 'pdf+image': 'application/pdf,.pdf,image/*,.heic', text: '.txt,.md,.csv,.json,.html,.xml,.log,text/*' };

function toolPage(t, incoming) {
  let files = [];
  const opts = {};
  const listHost = h('div.pdf-files');
  const rows = new Map(); // File -> row element (rows are reused so reordering doesn't rebuild them)
  const tools = t.reorder ? orderTools({ onSort: (kind) => { files = sortItems(files, kind); reorderChildren(listHost, files.map((f) => rows.get(f))); renumber(); }, hint: t.id === 'merge' ? 'Drag to set the page order' : 'Drag to set the page order' }) : null;
  if (t.reorder) sortable(listHost, { items: '.pdf-file', handle: '.pf-grip', onSort: (from, to) => { const [x] = files.splice(from, 1); files.splice(to, 0, x); renumber(); } });
  const optsHost = h('div.opts');
  const pagesHost = h('div.pages-host');
  const resultHost = h('div.pdf-results');
  const progress = progressBar(); progress.hidden = true;
  const goBtn = h('button.btn.primary.lg', { onclick: go }, icon('bolt', 18), t.title);
  const back = h('a.btn.ghost.sm', { href: '#/pdf' }, icon('back', 16), 'All PDF tools');
  const accepts = acceptFn(t.accept);
  let pageGrid = null, canvasEd = null;

  const dz = dropZone({ title: t.multi ? 'Add files' : 'Choose a file', compact: true, multiple: !!t.multi, accept: ACCEPT_ATTR[t.accept], onFiles: add });
  const landing = h('div.landing', dropZone({ title: `Drop ${t.accept === 'image' ? 'images' : t.accept === 'text' ? 'text files' : t.multi ? 'PDFs' : 'a PDF'} here`, multiple: !!t.multi, accept: ACCEPT_ATTR[t.accept], onFiles: add }));
  const work = h('div.tool-body.has-files',
    h('div.tool-main', dz, h('div.q-wrap', tools, listHost), pagesHost),
    h('div.tool-side', optsHost, h('div.card.go-card', progress, goBtn, resultHost)));
  work.hidden = true;
  const el = h('div', h('div.crumbs', back), pageHeader(t.title, t.desc, t.icon), landing, work);

  async function add(newFiles) {
    const ok = newFiles.filter(accepts);
    if (!ok.length) { toast('Those files are not supported in this tool', 'error'); return; }
    files = t.multi ? files.concat(ok) : [ok[0]];
    landing.hidden = true; work.hidden = false;
    resultHost.replaceChildren();
    renderList(); renderOpts();
    if (t.pages || t.canvas) await loadPages();
  }
  function row(f) {
    if (rows.has(f)) return rows.get(f);
    const k = kindOf(f);
    const thumb = h('span.pf-ic', icon(k === 'pdf' ? 'pdf' : k === 'image' ? 'image' : 'file', 18));
    if (k === 'image') thumbOf(f, 96).then((url) => { if (url) thumb.replaceChildren(h('img', { src: url, alt: '', decoding: 'async' })); thumb.classList.add('has-img'); }).catch(() => {});
    const el = settle(h('div.pdf-file',
      t.reorder ? h('button.pf-grip', { type: 'button', 'aria-label': `Move ${f.name}. Use the arrow keys to change its position.`, title: 'Drag to reorder' }, icon('drag', 18)) : null,
      t.reorder ? h('span.pf-num') : null,
      thumb,
      h('span.pf-name', { title: f.name }, f.name), h('span.pf-size', fmtBytes(f.size)),
      h('button.icon-btn.sm', { 'aria-label': 'Remove', onclick: () => { files.splice(files.indexOf(f), 1); rows.delete(f); el.remove(); if (!files.length) reset(); else renumber(); } }, icon('x', 16))));
    rows.set(f, el);
    return el;
  }
  function renderList() {
    listHost.replaceChildren(...files.map(row));
    renumber();
  }
  function renumber() {
    const w = String(files.length).length;
    files.forEach((f, i) => { const n = rows.get(f)?.querySelector('.pf-num'); if (n) n.textContent = String(i + 1).padStart(w, '0'); });
    listHost.classList.toggle('can-sort', !!t.reorder && files.length > 1);
    tools?.update(files);
  }
  function reset() { files = []; rows.clear(); landing.hidden = false; work.hidden = true; pagesHost.replaceChildren(); pageGrid?.destroy(); canvasEd?.destroy(); }

  async function loadPages() {
    pageGrid?.destroy(); canvasEd?.destroy();
    pagesHost.replaceChildren(h('div.loading-row', h('span.spinner'), 'Reading pages…'));
    let doc;
    try { doc = await P.openView(files[0]); } catch (e) {
      pagesHost.replaceChildren(emptyState('lock', e.needsPassword ? 'This PDF is password protected' : 'Could not open this PDF', e.needsPassword ? 'Unlock it first with the Unlock PDF tool.' : friendly(e)));
      return;
    }
    if (t.pages) { pageGrid = pageGridView(doc, t.pages, () => renderOpts()); pagesHost.replaceChildren(pageGrid.el); }
    else { canvasEd = canvasEditor(doc, t.canvas); pagesHost.replaceChildren(canvasEd.el); }
    renderOpts();
  }

  function renderOpts() {
    const rows = [];
    const set = (k, v) => { opts[k] = v; };
    const def = (k, v) => { if (!(k in opts)) opts[k] = v; return opts[k]; };
    switch (t.id) {
      case 'split':
        rows.push(field('Split mode', segmented([{ value: 'every', label: 'Every page' }, { value: 'ranges', label: 'Custom ranges' }, { value: 'fixed', label: 'Every N pages' }], def('mode', 'every'), (v) => { set('mode', v); renderOpts(); }, { small: true })));
        if (opts.mode === 'ranges') rows.push(field('Ranges', h('input.input', { value: def('ranges', '1-2, 3-'), placeholder: 'e.g. 1-3, 5, 8-', oninput: (e) => set('ranges', e.target.value) }), 'Each range becomes one PDF'));
        if (opts.mode === 'fixed') rows.push(field('Pages per file', h('input.input', { type: 'number', min: 1, value: def('n', 2), oninput: (e) => set('n', Math.max(1, +e.target.value)) })));
        break;
      case 'compress':
        rows.push(field('Compression level', h('div.level-list', [
          ['extreme', 'Extreme', 'Smallest file, lower quality'], ['recommended', 'Recommended', 'Good quality, good compression'], ['light', 'Less', 'High quality, less compression'], ['lossless', 'Lossless', 'Keeps text selectable; smaller savings'],
        ].map(([v, l, d]) => h('button.level', { 'aria-pressed': def('level', 'recommended') === v, onclick: () => { set('level', v); renderOpts(); } }, v === 'recommended' ? h('span.rec', 'Recommended') : null, h('strong', l), h('small', d))))));
        if (opts.level !== 'lossless') rows.push(h('label.check', h('input', { type: 'checkbox', checked: def('gray', false), onchange: (e) => set('gray', e.target.checked) }), 'Convert to grayscale (even smaller)'), h('p.hint', 'Pages are re-rendered as images, so text won\'t be selectable afterwards.'));
        break;
      case 'pdf2img':
        rows.push(field('Format', segmented(['jpg', 'png', 'webp'].map((v) => ({ value: v, label: v.toUpperCase() })), def('format', 'jpg'), (v) => set('format', v), { small: true })));
        rows.push(field('Quality', segmented([{ value: 72, label: 'Screen' }, { value: 150, label: 'Standard' }, { value: 220, label: 'High' }, { value: 300, label: 'Print' }], def('dpi', 150), (v) => set('dpi', v), { small: true })));
        break;
      case 'img2pdf':
        rows.push(field('Page size', segmented([{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'fit', label: 'Fit image' }], def('pageSize', 'a4'), (v) => set('pageSize', v), { small: true })));
        rows.push(field('Orientation', segmented([{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }], def('orientation', 'auto'), (v) => set('orientation', v), { small: true })));
        rows.push(field('Margin', segmented([{ value: 0, label: 'None' }, { value: 18, label: 'Small' }, { value: 40, label: 'Big' }], def('margin', 18), (v) => set('margin', v), { small: true })));
        break;
      case 'numbers':
        rows.push(field('Position', h('div.pos-grid', ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].map((p) => h('button.pos', { 'aria-pressed': def('position', 'bottom-center') === p, title: p, onclick: () => { set('position', p); renderOpts(); } }, h('span'))))));
        rows.push(field('Format', select([{ value: '{n}', label: '1, 2, 3…' }, { value: 'Page {n}', label: 'Page 1' }, { value: '{n} / {total}', label: '1 / 10' }, { value: 'Page {n} of {total}', label: 'Page 1 of 10' }], def('format', '{n}'), (v) => set('format', v))));
        rows.push(h('div.row2', field('Start at', h('input.input', { type: 'number', min: 1, value: def('start', 1), oninput: (e) => set('start', +e.target.value || 1) })), field('Size', h('input.input', { type: 'number', min: 6, max: 48, value: def('size', 11), oninput: (e) => set('size', +e.target.value || 11) }))));
        break;
      case 'watermark':
        rows.push(field('Text', h('input.input', { value: def('text', 'CONFIDENTIAL'), oninput: (e) => set('text', e.target.value) })));
        rows.push(field('Layout', segmented([{ value: 'center', label: 'Center' }, { value: 'tile', label: 'Tiled' }], def('mode', 'center'), (v) => set('mode', v), { small: true })));
        rows.push(field('Opacity', slider({ min: 0.05, max: 1, step: 0.05, value: def('opacity', 0.2), format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => set('opacity', v) })));
        rows.push(field('Angle', segmented([0, 30, 45, 90].map((v) => ({ value: v, label: `${v}°` })), def('rotation', 45), (v) => set('rotation', v), { small: true })));
        rows.push(h('div.row2', field('Size', h('input.input', { type: 'number', value: def('size', 48), oninput: (e) => set('size', +e.target.value || 48) })), field('Color', h('input.input.color', { type: 'color', value: def('color', '#e11d48'), oninput: (e) => set('color', e.target.value) }))));
        break;
      case 'crop':
        for (const s of ['top', 'right', 'bottom', 'left']) rows.push(field(`${s[0].toUpperCase() + s.slice(1)} margin`, slider({ min: 0, max: 40, step: 0.5, value: def(s, 5), format: (v) => `${v}%`, onInput: (v) => set(s, v) })));
        break;
      case 'rotate':
        rows.push(field('Rotate', segmented([{ value: 90, label: '90° right' }, { value: 180, label: '180°' }, { value: 270, label: '90° left' }], def('deg', 90), (v) => set('deg', v), { small: true }), pageGrid ? `${pageGrid.selected().length ? pageGrid.selected().length + ' selected pages' : 'All pages'} (tap pages to select)` : ''));
        break;
      case 'remove': case 'extract':
        rows.push(h('p.hint', pageGrid ? `${pageGrid.selected().length} page(s) selected. Tap pages to select.` : 'Tap pages to select.'));
        if (pageGrid) rows.push(h('div.btn-row', h('button.btn.ghost.sm', { onclick: () => pageGrid.selectAll(true) }, 'Select all'), h('button.btn.ghost.sm', { onclick: () => pageGrid.selectAll(false) }, 'Clear')));
        break;
      case 'organize':
        rows.push(h('p.hint', 'Drag pages to reorder. Use the buttons on each page to rotate or delete it.'));
        break;
      case 'protect':
        rows.push(field('Password', h('input.input', { type: 'password', autocomplete: 'new-password', oninput: (e) => set('pw', e.target.value) })));
        rows.push(field('Repeat password', h('input.input', { type: 'password', autocomplete: 'new-password', oninput: (e) => set('pw2', e.target.value) })));
        rows.push(h('label.check', h('input', { type: 'checkbox', checked: def('print', true), onchange: (e) => set('print', e.target.checked) }), 'Allow printing'));
        rows.push(h('label.check', h('input', { type: 'checkbox', checked: def('copy', false), onchange: (e) => set('copy', e.target.checked) }), 'Allow copying text'));
        break;
      case 'unlock':
        rows.push(field('Current password', h('input.input', { type: 'password', autocomplete: 'current-password', oninput: (e) => set('pw', e.target.value) }), 'Only works with a password you know.'));
        break;
      case 'sign': case 'edit':
        rows.push(h('p.hint', t.id === 'sign' ? 'Create your signature, then tap on the page to place it. Drag to move, use the corner to resize.' : 'Tap anywhere on the page to add text. Drag to move it.'));
        break;
      default: break;
    }
    optsHost.replaceChildren(rows.length ? h('div.card.opt-block', h('div.ob-head', icon('settings', 18), h('h3', 'Options')), h('div.ob-extra', rows)) : '');
  }

  async function go() {
    if (!files.length) return;
    const outFor = (suffix, ext = 'pdf') => outName(files[0].name, ext, suffix);
    let firstName = outFor(t.id);
    if (t.id === 'merge') firstName = 'merged.pdf';
    if (t.id === 'img2pdf') firstName = `${baseName(files[0].name)}${files.length > 1 ? '-and-more' : ''}.pdf`;
    const multiOut = ['split', 'pdf2img'].includes(t.id) || (t.multi && !['merge', 'img2pdf'].includes(t.id) && files.length > 1);
    if (t.id === 'protect' && (!opts.pw || opts.pw !== opts.pw2)) { toast(opts.pw ? 'Passwords don\'t match' : 'Enter a password', 'error'); return; }
    if (t.id === 'unlock' && !opts.pw) { toast('Enter the password', 'error'); return; }
    if ((t.id === 'remove' || t.id === 'extract') && !pageGrid?.selected().length) { toast('Select at least one page', 'error'); return; }
    const run = startRun(multiOut ? 2 : 1, firstName, 'application/pdf');
    progress.hidden = false; progress.set(0); goBtn.disabled = true; resultHost.replaceChildren();
    busy(true);
    const onP = (p) => progress.set(p);
    const results = [];
    const save = async (name, blob) => results.push(await writeBlob(run, name, blob));
    try {
      const f0 = files[0];
      switch (t.id) {
        case 'merge': await save('merged.pdf', await P.merge(files, onP)); break;
        case 'img2pdf': await save(firstName, await P.imagesToPdf(files, { pageSize: opts.pageSize, orientation: opts.orientation, margin: opts.margin }, onP)); break;
        case 'split': {
          const count = await P.pageCount(f0);
          let groups;
          if (opts.mode === 'ranges') groups = P.parseRanges(opts.ranges || '', count);
          else if (opts.mode === 'fixed') { groups = []; for (let i = 0; i < count; i += opts.n || 2) groups.push(Array.from({ length: Math.min(opts.n || 2, count - i) }, (_, k) => i + k)); }
          else groups = Array.from({ length: count }, (_, i) => [i]);
          if (!groups.length) throw new Error('No valid page ranges');
          const blobs = await P.split(f0, groups, onP);
          for (let i = 0; i < blobs.length; i++) await save(outFor(groups[i].length === 1 ? `page-${groups[i][0] + 1}` : `pages-${groups[i][0] + 1}-${groups[i].at(-1) + 1}`), blobs[i]);
          break;
        }
        case 'organize': await save(outFor('organized'), await P.pickPages(f0, pageGrid.plan())); break;
        case 'remove': { const sel = new Set(pageGrid.selected()); const keep = pageGrid.allIndices().filter((i) => !sel.has(i)); if (!keep.length) throw new Error('You can\'t remove every page'); await save(outFor('removed'), await P.pickPages(f0, keep.map((index) => ({ index })))); break; }
        case 'extract': await save(outFor('extract'), await P.pickPages(f0, pageGrid.selected().map((index) => ({ index })))); break;
        case 'rotate': { const sel = pageGrid?.selected(); await save(outFor('rotated'), await P.rotate(f0, opts.deg || 90, sel?.length ? sel : null)); break; }
        case 'sign': case 'edit': {
          const ov = canvasEd.overlays();
          if (!ov.length) throw new Error(t.id === 'sign' ? 'Place your signature on a page first' : 'Add some text first');
          await save(outFor(t.id === 'sign' ? 'signed' : 'edited'), await P.applyOverlays(f0, ov)); break;
        }
        case 'protect': await save(outFor('protected'), await P.protect(f0, { userPassword: opts.pw, allowPrint: opts.print !== false, allowCopy: !!opts.copy })); break;
        case 'unlock':
          try { await save(outFor('unlocked'), await P.unlock(f0, opts.pw)); } catch { throw new Error('Wrong password, or this PDF uses an unsupported encryption.'); }
          break;
        default:
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const sub = (p) => onP((i + p) / files.length);
            if (t.id === 'compress') await save(outName(f.name, 'pdf', 'compressed'), await P.compress(f, { level: opts.level || 'recommended', grayscale: !!opts.gray }, sub));
            else if (t.id === 'repair') await save(outName(f.name, 'pdf', 'repaired'), await P.repair(f));
            else if (t.id === 'pdf2txt') await save(outName(f.name, 'txt', ''), await P.toText(f, sub));
            else if (t.id === 'txt2pdf') await save(outName(f.name, 'pdf', ''), await P.textToPdf(await f.text()));
            else if (t.id === 'numbers') await save(outName(f.name, 'pdf', 'numbered'), await P.pageNumbers(f, opts));
            else if (t.id === 'watermark') await save(outName(f.name, 'pdf', 'watermarked'), await P.watermark(f, opts));
            else if (t.id === 'crop') await save(outName(f.name, 'pdf', 'cropped'), await P.crop(f, opts));
            else if (t.id === 'pdf2img') {
              const imgs = await P.toImages(f, { format: opts.format || 'jpg', dpi: opts.dpi || 150 }, sub);
              for (const im of imgs) await save(outName(f.name, opts.format || 'jpg', `p${im.page}`), im.blob);
            }
            sub(1);
          }
      }
      progress.set(1);
      const inSize = files.reduce((a, f) => a + f.size, 0), outSize = results.reduce((a, r) => a + r.size, 0);
      history.add({ tool: t.title, name: files.length > 1 ? `${files.length} files` : files[0].name, inSize, outSize, kind: 'pdf' });
      const diff = Math.round((1 - outSize / inSize) * 100);
      resultHost.replaceChildren(h('div.result-card',
        h('div.rc-info', icon('check', 18), h('strong', results.length > 1 ? `${results.length} files ready` : results[0].name),
          h('span.muted', `${fmtBytes(outSize)}${t.id === 'compress' && diff > 0 ? ` (−${diff}%)` : ''}`)),
        h('div.rc-actions', resultActions(results))));
      feedback('done');
    } catch (e) {
      console.error(e);
      toast(friendly(e), 'error', 6000); feedback('error');
    } finally { busy(false); goBtn.disabled = false; setTimeout(() => (progress.hidden = true), 600); }
  }

  if (incoming?.length) add(incoming);
  return { el, accept: (f) => { add(f); }, destroy: () => { pageGrid?.destroy(); canvasEd?.destroy(); } };
}

/** Page thumbnails. mode: 'select' | 'organize' */
function pageGridView(doc, mode, onChange) {
  const pages = Array.from({ length: doc.numPages }, (_, i) => ({ index: i, rotate: 0, selected: false }));
  const el = h('div.page-grid', { 'data-own-drop': '' });
  const thumbs = new Map();
  const io = new IntersectionObserver((ents) => ents.forEach(async (en) => {
    if (!en.isIntersecting) return;
    io.unobserve(en.target);
    const i = +en.target.dataset.page;
    if (thumbs.has(i)) return;
    thumbs.set(i, null);
    try {
      const c = await P.renderPage(doc, i + 1, { maxSide: 260 });
      c.className = 'pg-canvas';
      thumbs.set(i, c);
      en.target.isConnected ? en.target.querySelector('.pg-img').replaceChildren(c) : el.querySelector(`.pg[data-page="${i}"] .pg-img`)?.replaceChildren(c);
    } catch { thumbs.delete(i); }
  }), { rootMargin: '300px' });

  function render() {
    io.disconnect();
    el.replaceChildren(...pages.map((p, pos) => {
      const card = h('div.pg', { 'data-page': p.index, tabIndex: mode === 'organize' ? 0 : undefined, 'aria-label': mode === 'organize' ? `Page ${p.index + 1}. Drag, or use the arrow keys, to move it.` : undefined, 'aria-pressed': p.selected, onclick: (e) => {
        if (mode !== 'select' || e.target.closest('button')) return;
        p.selected = !p.selected; card.setAttribute('aria-pressed', p.selected); onChange();
      } },
      h('div.pg-img', { style: { transform: `rotate(${p.rotate}deg)` } }, thumbs.get(p.index) || h('span.spinner')),
      h('div.pg-foot', h('span', String(p.index + 1)),
        mode === 'organize' ? h('span.pg-tools',
          h('button.icon-btn.xs', { 'aria-label': 'Rotate page', onclick: () => { p.rotate = (p.rotate + 90) % 360; card.querySelector('.pg-img').style.transform = `rotate(${p.rotate}deg)`; } }, icon('rotate', 14)),
          h('button.icon-btn.xs', { 'aria-label': 'Delete page', onclick: () => { pages.splice(pages.indexOf(p), 1); render(); } }, icon('trash', 14))) : h('span.pg-check', icon('check', 14))));
      // keep already-rendered canvas
      return card;
    }));
    el.querySelectorAll('.pg').forEach((c) => { if (!thumbs.get(+c.dataset.page)) { thumbs.delete(+c.dataset.page); io.observe(c); } });
  }
  if (mode === 'organize') {
    el.classList.add('can-sort');
    sortable(el, { items: '.pg', onSort: (from, to) => { const [x] = pages.splice(from, 1); pages.splice(to, 0, x); } });
  }
  render();
  return {
    el,
    selected: () => pages.filter((p) => p.selected).map((p) => p.index),
    allIndices: () => pages.map((p) => p.index),
    plan: () => pages.map((p) => ({ index: p.index, rotate: p.rotate })),
    selectAll: (v) => { pages.forEach((p) => (p.selected = v)); el.querySelectorAll('.pg').forEach((c) => c.setAttribute('aria-pressed', v)); onChange(); },
    destroy: () => { io.disconnect(); P.closeView(doc); },
  };
}

/** Single-page canvas with draggable overlays (signatures or text). */
function canvasEditor(doc, kind) {
  let page = 1;
  const overlays = []; // { page(0-based), kind, x,y,w,h (fractions), text, size, color, png, url }
  let signature = null; // { png: Blob, url, ratio }
  const pageBox = h('div.pe-page', { 'data-own-drop': '' });
  const layer = h('div.pe-layer');
  const pageLbl = h('span.muted');
  const color = { v: '#111827' };
  const toolbar = h('div.pe-bar',
    h('div.btn-row',
      h('button.icon-btn', { 'aria-label': 'Previous page', onclick: () => goPage(page - 1) }, icon('back', 18)), pageLbl,
      h('button.icon-btn', { 'aria-label': 'Next page', onclick: () => goPage(page + 1) }, icon('chevron', 18))),
    kind === 'sign' ? h('button.btn.primary.sm', { onclick: makeSignature }, icon('pen', 16), 'Create signature')
      : h('label.color-pick', 'Color', h('input', { type: 'color', value: color.v, oninput: (e) => (color.v = e.target.value) })));
  const el = h('div.pe', toolbar, h('div.pe-stage', pageBox));
  let canvas = null;

  async function goPage(n) {
    if (n < 1 || n > doc.numPages) return;
    page = n; pageLbl.textContent = `Page ${n} / ${doc.numPages}`;
    const c = await P.renderPage(doc, n, { maxSide: 1400 });
    c.className = 'pe-canvas';
    canvas?.remove(); canvas = c;
    pageBox.replaceChildren(c, layer);
    paint();
  }
  function paint() {
    layer.replaceChildren(...overlays.filter((o) => o.page === page - 1).map(ovEl));
  }
  function ovEl(o) {
    const del = h('button.ov-del', { 'aria-label': 'Delete', onclick: (e) => { e.stopPropagation(); overlays.splice(overlays.indexOf(o), 1); paint(); } }, icon('x', 12));
    let content;
    if (o.kind === 'image') content = h('img', { src: o.url, alt: 'signature', draggable: false });
    else {
      content = h('div.ov-text', { contentEditable: 'true', spellcheck: false, style: { color: o.color, fontSize: `calc(var(--ph) * ${o.size})` } }, o.text);
      content.addEventListener('input', () => (o.text = content.innerText));
      content.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    const grip = o.kind === 'image' ? h('span.ov-grip') : null;
    const box = h('div.ov', { style: { left: o.x * 100 + '%', top: o.y * 100 + '%', width: o.kind === 'image' ? o.w * 100 + '%' : 'auto', height: o.kind === 'image' ? o.h * 100 + '%' : 'auto' } }, content, del, grip);
    box.addEventListener('pointerdown', (e) => {
      if (e.target === del || e.target.closest('.ov-del')) return;
      e.preventDefault();
      const r = layer.getBoundingClientRect();
      const resizing = e.target === grip;
      const sx = e.clientX, sy = e.clientY, st = { ...o };
      box.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height;
        if (resizing) { o.w = clamp(st.w + dx, 0.05, 1 - o.x); o.h = st.h * (o.w / st.w); }
        else { o.x = clamp(st.x + dx, 0, 0.98); o.y = clamp(st.y + dy, 0, 0.98); }
        Object.assign(box.style, { left: o.x * 100 + '%', top: o.y * 100 + '%', width: o.kind === 'image' ? o.w * 100 + '%' : 'auto', height: o.kind === 'image' ? o.h * 100 + '%' : 'auto' });
      };
      const up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up); };
      box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
    });
    return box;
  }
  layer.addEventListener('click', (e) => {
    if (e.target !== layer) return;
    const r = layer.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (kind === 'sign') {
      if (!signature) { makeSignature(); return; }
      const w = 0.28, hh = (w * r.width) / signature.ratio / r.height;
      overlays.push({ page: page - 1, kind: 'image', x: clamp(x - w / 2, 0, 1 - w), y: clamp(y - hh / 2, 0, 1 - hh), w, h: hh, png: signature.png, url: signature.url });
    } else {
      overlays.push({ page: page - 1, kind: 'text', x, y: Math.max(0, y - 0.012), text: 'Type here', size: 0.018, color: color.v });
    }
    paint();
    if (kind === 'text') { const last = layer.lastElementChild?.querySelector('.ov-text'); if (last) { last.focus(); document.getSelection().selectAllChildren(last); } }
  });
  new ResizeObserver(() => layer.style.setProperty('--ph', layer.clientHeight + 'px')).observe(layer);

  function makeSignature() {
    const pad = document.createElement('canvas'); pad.width = 900; pad.height = 300; pad.className = 'sig-pad';
    const ctx = pad.getContext('2d');
    let ink = '#111827', drawing = false, mode = 'draw', last = null, dirty = false;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)]; };
    pad.onpointerdown = (e) => { if (mode !== 'draw') return; drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); };
    pad.onpointermove = (e) => {
      if (!drawing) return;
      const p = pos(e); const pr = e.pressure && e.pointerType === 'pen' ? e.pressure : 0.6;
      ctx.strokeStyle = ink; ctx.lineWidth = 3 + pr * 5;
      ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; dirty = true;
    };
    pad.onpointerup = () => (drawing = false);
    const typed = h('input.input', { placeholder: 'Type your name', oninput: () => drawTyped() });
    function drawTyped() {
      ctx.clearRect(0, 0, pad.width, pad.height);
      ctx.fillStyle = ink; ctx.font = 'italic 110px "Segoe Script","Brush Script MT","Snell Roundhand",cursive';
      ctx.textBaseline = 'middle'; ctx.fillText(typed.value, 30, pad.height / 2, pad.width - 60); dirty = !!typed.value;
    }
    const typedRow = h('div', { hidden: true }, typed);
    const m = modal({
      title: 'Your signature',
      body: h('div.sig',
        segmented([{ value: 'draw', label: 'Draw' }, { value: 'type', label: 'Type' }], 'draw', (v) => { mode = v; typedRow.hidden = v !== 'type'; ctx.clearRect(0, 0, pad.width, pad.height); dirty = false; if (v === 'type') { drawTyped(); typed.focus(); } }, { small: true }),
        typedRow, pad,
        h('div.btn-row', ['#111827', '#1d4ed8', '#b91c1c'].map((c) => h('button.swatch', { style: { background: c }, 'aria-label': 'Ink color', onclick: () => { ink = c; if (mode === 'type') drawTyped(); } })),
          h('button.btn.ghost.sm', { onclick: () => { ctx.clearRect(0, 0, pad.width, pad.height); dirty = false; typed.value = ''; } }, 'Clear'))),
      actions: [{ label: 'Cancel' }, { label: 'Use signature', primary: true, onClick: () => {
        if (!dirty) { toast('Draw or type a signature first'); return false; }
        const t = trimCanvas(pad);
        t.toBlob((b) => { signature = { png: b, url: URL.createObjectURL(b), ratio: t.width / t.height }; toast('Now tap on the page to place it', 'success'); });
      } }],
    });
    void m;
  }
  goPage(1);
  return {
    el,
    overlays: () => overlays.map((o) => ({ ...o })),
    destroy: () => { P.closeView(doc); overlays.forEach((o) => o.url && URL.revokeObjectURL(o.url)); },
  };
}

function trimCanvas(c) {
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return c;
  const pad = 8, out = document.createElement('canvas');
  out.width = x1 - x0 + pad * 2; out.height = y1 - y0 + pad * 2;
  out.getContext('2d').drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export { TOOLS as PDF_TOOLS };
void app;
