// Recipes: chain several steps (resize → PDF → compress…) and run them on your files with one tap.
// Ready-made recipes + your own (saved on this device). Everything runs on this device.
import { h, fmtBytes, baseName, extOf } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, dropZone, resultActions, localBadge, friendly, toFile } from '../core/components.js';
import { segmented, field, select, toast, prompt, confirmDialog, progressBar, feedback } from '../core/ui.js';
import { kindOf, KIND_ICON } from '../core/files.js';
import { writeBlob } from '../core/save.js';
import { sortable, settle } from '../core/sortable.js';
import { tasks } from '../core/tasks.js';
import { recent } from '../core/recent.js';
import { history } from '../core/history.js';
import { PRESETS, fitFile } from './ready.js';
import { app } from '../app.js';

const KEY = 'morph.recipes.v1';
const ALL = ['video', 'image', 'audio', 'pdf'];

export const STEPS = {
  ready: { title: 'Make ready for…', icon: 'target', kinds: ALL, defaults: { preset: 'whatsapp', limitMB: 2 } },
  resize: { title: 'Resize photos', icon: 'compress', kinds: ['image'], defaults: { max: 1920 } },
  crop: { title: 'Crop photos', icon: 'crop', kinds: ['image'], defaults: { aspect: '1:1' } },
  watermark: { title: 'Watermark photos', icon: 'stamp', kinds: ['image'], defaults: { text: '© Your name', position: 'br' } },
  clean: { title: 'Remove hidden info', icon: 'lock', kinds: ['image'], defaults: {} },
  blur: { title: 'Blur faces', icon: 'portrait', kinds: ['image'], defaults: {} },
  removebg: { title: 'Remove background', icon: 'sparkle', kinds: ['image'], defaults: {} },
  format: { title: 'Change photo format', icon: 'convert', kinds: ['image'], defaults: { format: 'jpg' } },
  topdf: { title: 'Combine into one PDF', icon: 'merge', kinds: ['image', 'pdf'], defaults: {} },
  ocr: { title: 'Make PDFs searchable', icon: 'search', kinds: ['pdf'], defaults: {} },
  numbers: { title: 'Add page numbers', icon: 'hash', kinds: ['pdf'], defaults: { format: '{n}' } },
  pdfcompress: { title: 'Compress PDFs', icon: 'compress', kinds: ['pdf'], defaults: { level: 'recommended' } },
  rename: { title: 'Rename files', icon: 'text', kinds: ALL, defaults: { pattern: '{name}' } },
  zip: { title: 'Put everything in one ZIP', icon: 'zip', kinds: ALL, defaults: {} },
};
const BUILT_IN = [
  { id: 'b-photos-pdf', name: 'Photos → small PDF', icon: 'pdf', desc: 'Turn phone photos into one light PDF', steps: [{ type: 'resize', opts: { max: 2000 } }, { type: 'topdf', opts: {} }, { type: 'pdfcompress', opts: { level: 'recommended' } }] },
  { id: 'b-clean-share', name: 'Clean photos for sharing', icon: 'lock', desc: 'No location, smaller, plays everywhere', steps: [{ type: 'clean', opts: {} }, { type: 'resize', opts: { max: 1920 } }, { type: 'format', opts: { format: 'jpg' } }] },
  { id: 'b-discord', name: 'Video → Discord', icon: 'game', desc: 'Under 10 MB, ready to post', steps: [{ type: 'ready', opts: { preset: 'discord' } }] },
  { id: 'b-scans', name: 'Scans → searchable PDF', icon: 'search', desc: 'Photos of pages → one PDF you can search', steps: [{ type: 'topdf', opts: {} }, { type: 'ocr', opts: {} }, { type: 'numbers', opts: { format: '{n}' } }] },
  { id: 'b-brand', name: 'Brand my photos', icon: 'stamp', desc: 'Add your name, resize for the web', steps: [{ type: 'watermark', opts: { text: '© Your name', position: 'br' } }, { type: 'resize', opts: { max: 2048 } }] },
];

function loadMine() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function saveMine(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* */ } }
const clone = (x) => JSON.parse(JSON.stringify(x));
const stepLabel = (s) => STEPS[s.type]?.title || s.type;

export default function recipesView({ sub, files }) {
  const root = h('div.tool.recipes');
  let mine = loadMine();
  let page = null; // current recipe page controller
  let pending = files?.length ? files : null;

  function show(id, incoming) {
    if (incoming?.length) pending = incoming;
    if (page && !page.busy) { page.el.remove(); page = null; }
    if (!id) { root.replaceChildren(list()); if (pending) toast(`Pick a recipe for your ${pending.length} file${pending.length > 1 ? 's' : ''}`); return; }
    const r = id === 'new' ? { id: 'new', name: 'New recipe', icon: 'recipe', steps: [] } : mine.find((x) => x.id === id) || BUILT_IN.find((x) => x.id === id);
    if (!r) { app.go('recipes'); return; }
    if (page?.busy && page.id === id) { root.replaceChildren(page.el); if (pending) { page.add(pending); pending = null; } return; }
    page = recipePage(r);
    root.replaceChildren(page.el);
    if (pending) { page.add(pending); pending = null; }
  }
  function card(r, i, isMine) {
    return h('a.pdf-card.rcp-card', { href: `#/recipes/${r.id}`, style: { '--i': i } },
      h('span.pc-ic', icon(r.icon || 'recipe', 22)), h('strong', r.name),
      h('small', r.desc || `${r.steps.length} step${r.steps.length === 1 ? '' : 's'}`),
      h('span.rcp-steps', r.steps.map((s, k) => h('span.rcp-chip', k ? '→ ' : '', stepLabel(s)))),
      isMine ? h('span.rcp-mine', 'Yours') : null);
  }
  function list() {
    mine = loadMine();
    return h('div',
      pageHeader('Recipes', 'Save a chain of steps once, then run it on any files with one tap. Everything runs on your device.', 'recipe'),
      mine.length ? h('section.pdf-group', h('h2.group-title', 'Your recipes'), h('div.pdf-grid', mine.map((r, i) => card(r, i, true)))) : null,
      h('section.pdf-group', h('h2.group-title', 'Ready-made'), h('div.pdf-grid',
        ...BUILT_IN.map((r, i) => card(r, i)),
        h('a.pdf-card.rcp-new', { href: '#/recipes/new' }, h('span.pc-ic', icon('plus', 22)), h('strong', 'New recipe'), h('small', 'Pick your own steps')))));
  }

  function recipePage(src) {
    const r = clone(src);
    const isMine = mine.some((x) => x.id === r.id);
    let items = []; // File[]
    let working = false;
    const stepsHost = h('div.rcp-step-list');
    const filesHost = h('div.rcp-files');
    const resultHost = h('div.pdf-results');
    const progress = progressBar(); progress.hidden = true;
    const goBtn = h('button.btn.primary.lg', { type: 'button', onclick: runRecipe }, icon('bolt', 18), 'Run recipe');
    const nameIn = h('input.input.rcp-name', { value: r.name, 'aria-label': 'Recipe name', oninput: () => { r.name = nameIn.value; autosave(); } });
    const saveBtn = h('button.btn.ghost.sm', { type: 'button', onclick: saveAsMine }, icon('save', 16), isMine ? 'Saved' : 'Save as my recipe');
    const delBtn = isMine ? h('button.btn.ghost.sm', { type: 'button', onclick: async () => {
      if (!(await confirmDialog(`Delete “${r.name}”?`, 'This removes the recipe. Your files are not affected.', 'Delete', true))) return;
      mine = loadMine().filter((x) => x.id !== r.id); saveMine(mine); app.go('recipes');
    } }, icon('trash', 16), 'Delete') : null;

    function autosave() {
      if (!isMine) { saveBtn.replaceChildren(icon('save', 16), 'Save as my recipe'); return; }
      mine = loadMine().map((x) => (x.id === r.id ? clone(r) : x)); saveMine(mine);
    }
    async function saveAsMine() {
      if (isMine) { autosave(); toast('Saved', 'success'); return; }
      const name = (await prompt('Name your recipe', { value: r.id === 'new' ? '' : `${r.name} (mine)`, placeholder: 'e.g. Weekly report' }))?.trim();
      if (!name) return;
      const copy = { ...clone(r), id: 'm' + Date.now().toString(36), name: name.slice(0, 40), desc: undefined, icon: r.icon === 'recipe' || !r.icon ? 'recipe' : r.icon };
      mine = [copy, ...loadMine()]; saveMine(mine);
      toast(`Saved “${copy.name}”`, 'success');
      app.go(`recipes/${copy.id}`);
    }

    // ---------- steps editor ----------
    sortable(stepsHost, { items: '.rcp-step', handle: '.pf-grip', onSort: (from, to) => { const [x] = r.steps.splice(from, 1); r.steps.splice(to, 0, x); autosave(); renderSteps(); } });
    function stepOptions(s) {
      const o = s.opts;
      const set = (k) => (v) => { o[k] = v; autosave(); };
      switch (s.type) {
        case 'ready': return h('div.rcp-opts', select(PRESETS.map((p) => ({ value: p.id, label: p.name })), o.preset || 'whatsapp', (v) => { o.preset = v; autosave(); renderSteps(); }),
          o.preset === 'upload' ? h('label.num', h('input.input', { type: 'number', min: 0.1, step: 0.1, value: o.limitMB || 2, onchange: (e) => set('limitMB')(Math.max(0.1, +e.target.value || 2)) }), h('span', 'MB')) : null);
        case 'resize': return h('div.rcp-opts', h('span.muted.small', 'Longest side'), select([3840, 2560, 2048, 2000, 1920, 1280, 1080, 800].map((v) => ({ value: v, label: `${v} px` })), o.max || 1920, (v) => set('max')(+v)));
        case 'crop': return h('div.rcp-opts', select(['1:1', '4:5', '3:4', '9:16', '16:9', '4:3', '3:2'].map((v) => ({ value: v, label: v })), o.aspect || '1:1', set('aspect')));
        case 'watermark': return h('div.rcp-opts', h('input.input', { value: o.text || '', placeholder: 'Your text', oninput: (e) => set('text')(e.target.value) }),
          select([{ value: 'br', label: 'Bottom right' }, { value: 'bl', label: 'Bottom left' }, { value: 'c', label: 'Middle' }, { value: 'tile', label: 'Repeat all over' }], o.position || 'br', set('position')));
        case 'format': return h('div.rcp-opts', segmented(['jpg', 'png', 'webp'].map((v) => ({ value: v, label: v.toUpperCase() })), o.format || 'jpg', set('format'), { small: true }));
        case 'pdfcompress': return h('div.rcp-opts', select([{ value: 'lossless', label: 'Light (keeps text)' }, { value: 'light', label: 'Less' }, { value: 'recommended', label: 'Recommended' }, { value: 'extreme', label: 'Extreme' }], o.level || 'recommended', set('level')));
        case 'numbers': return h('div.rcp-opts', select([{ value: '{n}', label: '1, 2, 3…' }, { value: 'Page {n}', label: 'Page 1' }, { value: '{n} / {total}', label: '1 / 10' }], o.format || '{n}', set('format')));
        case 'rename': return h('div.rcp-opts', h('input.input', { value: o.pattern || '{name}', oninput: (e) => set('pattern')(e.target.value) }), h('small.muted', '{name} = old name · {n} = 1, 2, 3 · {date} = today'));
        default: return null;
      }
    }
    function renderSteps() {
      stepsHost.replaceChildren(...r.steps.map((s, i) => settle(h('div.rcp-step',
        h('button.pf-grip', { type: 'button', 'aria-label': `Move step ${i + 1}`, title: 'Drag to reorder' }, icon('drag', 18)),
        h('span.rcp-n', String(i + 1)),
        h('span.rcp-ic', icon(STEPS[s.type]?.icon || 'bolt', 18)),
        h('div.rcp-body', h('strong', stepLabel(s)), stepOptions(s)),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove step ${i + 1}`, onclick: () => { r.steps.splice(i, 1); autosave(); renderSteps(); } }, icon('x', 16))))),
      r.steps.length ? '' : h('p.muted.small', 'No steps yet. Add the first one below.'));
      stepsHost.classList.toggle('can-sort', r.steps.length > 1);
    }
    const addSel = select([{ value: '', label: '+ Add a step…' }, ...Object.entries(STEPS).map(([k, v]) => ({ value: k, label: v.title }))], '', (v) => {
      if (!v) return;
      r.steps.push({ type: v, opts: clone(STEPS[v].defaults) }); addSel.value = ''; autosave(); renderSteps();
    });
    addSel.classList.add('rcp-add');

    // ---------- files ----------
    function add(f) {
      items = items.concat(f.filter((x) => ALL.includes(kindOf(x))));
      if (f.length && !items.length) toast('Add videos, photos, audio or PDFs', 'error');
      renderFiles(); resultHost.replaceChildren();
    }
    function renderFiles() {
      filesHost.replaceChildren(...items.map((f, i) => h('div.pdf-file',
        h('span.pf-ic', icon(KIND_ICON[kindOf(f)] || 'file', 18)), h('span.pf-name', { title: f.name }, f.name), h('span.pf-size', fmtBytes(f.size)),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${f.name}`, onclick: () => { items.splice(i, 1); renderFiles(); } }, icon('x', 16)))));
      goBtn.disabled = !items.length || !r.steps.length;
      goBtn.replaceChildren(icon('bolt', 18), items.length ? `Run on ${items.length} file${items.length > 1 ? 's' : ''}` : 'Run recipe');
    }

    async function runRecipe() {
      if (working || !items.length || !r.steps.length) return;
      working = true; goBtn.disabled = true; progress.hidden = false; progress.set(0); resultHost.replaceChildren();
      const ac = new AbortController();
      const tk = tasks.start({ title: `${r.name}: ${items.length} file${items.length > 1 ? 's' : ''}`, route: `recipes/${r.id}`, iconName: 'recipe', cancel: () => ac.abort() });
      const warns = [];
      let files = items.slice();
      const inSize = files.reduce((a, f) => a + f.size, 0);
      try {
        for (let i = 0; i < r.steps.length; i++) {
          if (ac.signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
          const s = r.steps[i];
          const onP = (p) => { const v = (i + Math.min(1, Math.max(0, p))) / r.steps.length; progress.set(v); tk.progress(v, `Step ${i + 1} of ${r.steps.length}: ${stepLabel(s)}`); };
          onP(0);
          files = await runStep(s, files, { onProgress: onP, onStatus: (m) => tk.status(`Step ${i + 1}: ${m}`), signal: ac.signal, warns, recipe: r });
        }
        const run = { method: 'auto', ready: Promise.resolve() };
        const results = [];
        for (const f of files) results.push(f.__res || await writeBlob(run, f.name, f));
        results.forEach((x) => recent.add(x, { tool: 'recipe' }));
        history.add({ tool: 'recipe', name: r.name, inSize, outSize: results.reduce((a, x) => a + x.size, 0), kind: kindOf(files[0]) });
        progress.set(1);
        resultHost.replaceChildren(h('div.result-card',
          h('div.rc-info', icon('check', 18), h('strong', results.length > 1 ? `${results.length} files ready` : results[0].name), h('span.muted', fmtBytes(results.reduce((a, x) => a + x.size, 0))), localBadge()),
          warns.length ? h('div.rcp-warns', warns.map((w) => h('small.q-warn', icon('info', 14), w))) : null,
          h('div.rc-actions', resultActions(results))));
        tk.done(results.length > 1 ? `${results.length} files ready` : results[0].name); feedback('done');
      } catch (e) {
        if (e.cancelled || ac.signal.aborted) tk.cancelled();
        else { console.error(e); toast(friendly(e), 'error', 6000); tk.fail(friendly(e)); feedback('error'); }
      } finally { working = false; renderFiles(); setTimeout(() => (progress.hidden = true), 600); }
    }

    const el = h('div',
      h('div.crumbs', h('a.btn.ghost.sm', { href: '#/recipes' }, icon('back', 16), 'All recipes')),
      h('header.page-head', h('div.ph-icon', icon(r.icon || 'recipe', 22)), h('div.ph-text', nameIn, h('p', r.desc || 'Runs the steps in order, top to bottom. Drag to reorder.')), h('div.ph-extra.btn-row', saveBtn, delBtn)),
      h('div.tool-body.has-files',
        h('div.tool-main',
          dropZone({ title: 'Add files for this recipe', compact: true, onFiles: add }),
          filesHost),
        h('div.tool-side',
          h('div.card.opt-block', h('div.ob-head', icon('recipe', 18), h('h3', 'Steps')), stepsHost, addSel),
          h('div.card.go-card', progress, goBtn, resultHost))));
    renderSteps(); renderFiles();
    return { id: r.id, el, add, get busy() { return working; } };
  }

  show(sub?.[0], files);
  return {
    el: root,
    route: (s, f) => show(s?.[0], f),
    accept: (f) => { if (page) { page.add(f); return; } pending = f; toast(`Pick a recipe for your ${f.length} file${f.length > 1 ? 's' : ''}`); },
    get busy() { return !!page?.busy; },
  };
}

// ---------------------------------------------------------------------------------------------
// Running steps. Each step takes File[] and returns File[]; files a step can't handle pass through.
// ---------------------------------------------------------------------------------------------
const TMP = () => ({ method: 'auto', ready: Promise.resolve() });
const asFile = (res) => { const f = toFile(res); f.__res = res; return f; };
const renamed = (f, ext) => `${baseName(f.name)}.${ext}`;

async function eachApplicable(step, files, ctx, fn) {
  const kinds = STEPS[step.type].kinds;
  const todo = files.filter((f) => kinds.includes(kindOf(f)));
  if (!todo.length) { ctx.warns.push(`“${stepLabel(step)}” was skipped: none of the files fit it.`); return files; }
  const out = [];
  let k = 0;
  for (const f of files) {
    if (!kinds.includes(kindOf(f))) { out.push(f); continue; }
    if (ctx.signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
    const sub = (p) => ctx.onProgress((k + p) / todo.length);
    const r = await fn(f, sub);
    out.push(...(Array.isArray(r) ? r : [r]));
    k++; sub(0);
  }
  return out;
}

export async function runStep(step, files, ctx) {
  const o = step.opts || {};
  switch (step.type) {
    case 'ready': {
      const p = PRESETS.find((x) => x.id === o.preset) || PRESETS[0];
      const spec = p.ask ? { ...p.spec, limitMB: o.limitMB || 2 } : p.spec;
      const kinds = STEPS.ready.kinds;
      const total = files.filter((f) => kinds.includes(kindOf(f))).reduce((a, f) => a + f.size, 0);
      return eachApplicable(step, files, ctx, async (f, sub) => {
        let t = spec.limitMB ? spec.limitMB * 1048576 : 0;
        if (t && spec.total) t = Math.floor(t * 0.97 * (f.size / Math.max(1, total)));
        if (kindOf(f) === 'image' && spec.image?.limitMB) t = t ? Math.min(t, spec.image.limitMB * 1048576) : spec.image.limitMB * 1048576;
        const r = await fitFile(f, spec, t, { run: TMP(), name: (ext) => renamed(f, ext), onProgress: sub, onStatus: ctx.onStatus, signal: ctx.signal });
        if (r.warn) ctx.warns.push(`${f.name}: ${r.warn}`);
        return asFile(r.res);
      });
    }
    case 'resize': case 'crop': case 'watermark': case 'format': {
      const { editPhoto } = await import('../engines/photo.js');
      const ops = step.type === 'resize' ? { resize: { mode: 'max', max: o.max || 1920 } }
        : step.type === 'crop' ? { crop: { aspect: o.aspect || '1:1' } }
          : step.type === 'watermark' ? { watermark: { text: o.text || '', position: o.position || 'br', size: 5, opacity: 0.6, color: '#ffffff' } }
            : { format: o.format || 'jpg' };
      return eachApplicable(step, files, ctx, async (f, sub) => {
        const r = await editPhoto(f, { quality: 0.9, format: 'keep', ...ops });
        sub(1);
        return asFile(await writeBlob(TMP(), renamed(f, r.format), r.blob));
      });
    }
    case 'clean': {
      const { stripMeta } = await import('../engines/photo.js');
      return eachApplicable(step, files, ctx, async (f) => { const r = await stripMeta(f); return asFile(await writeBlob(TMP(), renamed(f, r.format), r.blob)); });
    }
    case 'blur': {
      const { detectFaces } = await import('../engines/ai.js');
      const { editPhoto } = await import('../engines/photo.js');
      return eachApplicable(step, files, ctx, async (f) => {
        const faces = await detectFaces(f, { onStatus: ctx.onStatus });
        if (!faces.length) { ctx.warns.push(`${f.name}: no faces found.`); return f; }
        const r = await editPhoto(f, { blur: faces, format: 'keep', quality: 0.92 });
        return asFile(await writeBlob(TMP(), renamed(f, r.format), r.blob));
      });
    }
    case 'removebg': {
      const { removeBackground } = await import('../engines/ai.js');
      const { encode } = await import('../engines/image.js');
      return eachApplicable(step, files, ctx, async (f) => {
        const c = await removeBackground(f, { onStatus: ctx.onStatus });
        return asFile(await writeBlob(TMP(), renamed(f, 'png'), await encode(c, 'png')));
      });
    }
    case 'topdf': {
      const kinds = STEPS.topdf.kinds;
      const parts = files.filter((f) => kinds.includes(kindOf(f)));
      if (!parts.length) { ctx.warns.push('“Combine into one PDF” was skipped: no photos or PDFs.'); return files; }
      const P = await import('../engines/pdf.js');
      const blob = await P.merge(parts, ctx.onProgress);
      const name = `${(ctx.recipe?.name || baseName(parts[0].name)).replace(/[\\/:*?"<>|→]+/g, '-').replace(/\s+/g, ' ').trim()}.pdf`;
      const res = asFile(await writeBlob(TMP(), name, blob));
      return [res, ...files.filter((f) => !kinds.includes(kindOf(f)))];
    }
    case 'ocr': {
      const P = await import('../engines/pdf.js');
      return eachApplicable(step, files, ctx, async (f, sub) => { const r = await P.ocrPdf(f, { onProgress: sub, onStatus: ctx.onStatus }); return asFile(await writeBlob(TMP(), f.name, r.blob)); });
    }
    case 'numbers': {
      const P = await import('../engines/pdf.js');
      return eachApplicable(step, files, ctx, async (f) => asFile(await writeBlob(TMP(), f.name, await P.pageNumbers(f, { format: o.format || '{n}' }))));
    }
    case 'pdfcompress': {
      const P = await import('../engines/pdf.js');
      return eachApplicable(step, files, ctx, async (f, sub) => {
        const b = await P.compress(f, { level: o.level || 'recommended' }, sub);
        return b.size < f.size ? asFile(await writeBlob(TMP(), f.name, b)) : f;
      });
    }
    case 'rename': {
      const date = new Date().toISOString().slice(0, 10);
      const w = Math.max(2, String(files.length).length);
      return files.map((f, i) => {
        const nm = (o.pattern || '{name}').replaceAll('{name}', baseName(f.name)).replaceAll('{n}', String(i + 1).padStart(w, '0')).replaceAll('{date}', date).replace(/[\\/:*?"<>|]+/g, '-').trim() || baseName(f.name);
        const nf = new File([f], `${nm}.${extOf(f.name)}`, { type: f.type });
        return nf;
      });
    }
    case 'zip': {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const used = new Set();
      for (const f of files) { let n = f.name, i = 1; while (used.has(n)) n = f.name.replace(/(\.[^.]+)?$/, ` (${i++})$1`); used.add(n); zip.file(n, f); }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (m) => ctx.onProgress(m.percent / 100));
      return [asFile(await writeBlob(TMP(), `${(ctx.recipe?.name || 'files').replace(/[\\/:*?"<>|→]+/g, '-').trim()}.zip`, blob))];
    }
    default: return files;
  }
}
