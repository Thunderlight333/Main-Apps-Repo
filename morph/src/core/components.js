// Shared UI building blocks: page header, drop zone, job queue with per-item progress, result actions.
import { h, fmtBytes, uid } from './dom.js';
import { icon } from './icons.js';
import { kindOf, KIND_ICON, pickFiles, readClipboardFiles } from './files.js';
import { progressBar, toast, feedback, notify } from './ui.js';
import { download, shareResult, saveAll } from './save.js';
import { settings } from './settings.js';
import { history } from './history.js';
import { thumbOf } from '../engines/image.js';
import { videoThumb } from '../engines/thumbs.js';
import { app } from '../app.js';
import { saver, effectiveParallel } from './power.js';
import { sortable, settle, reorderChildren, SORTS } from './sortable.js';
import { tasks } from './tasks.js';
import { recent } from './recent.js';
import { modal } from './ui.js';

export function pageHeader(title, sub, iconName, extra) {
  return h('header.page-head',
    h('div.ph-icon', icon(iconName, 22)),
    h('div.ph-text', h('h1', title), sub ? h('p', sub) : null),
    extra ? h('div.ph-extra', extra) : null);
}

/** Big drop target. Drag&drop and paste are also handled globally; this adds click/tap + paste button. */
export function dropZone({ accept = '', multiple = true, title = 'Drop files here', hint, onFiles, compact = false, kinds = [] }) {
  const browse = async () => { const f = await pickFiles({ accept, multiple }); if (f.length) onFiles(f); };
  const pasteBtn = h('button.btn.ghost.sm', {
    type: 'button',
    onclick: async (e) => {
      e.stopPropagation();
      try { const { files } = await readClipboardFiles(); files.length ? onFiles(files) : toast('No files on the clipboard. Copy a file, then try again (or press Ctrl/⌘+V).'); }
      catch { toast('Clipboard access was blocked. Press Ctrl/⌘+V instead.', 'error'); }
    },
  }, icon('paste', 16), 'Paste');
  return h('div.dropzone', {
    class: compact ? 'compact' : '', tabIndex: 0, role: 'button', 'aria-label': title,
    onclick: browse, onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && browse(),
  },
  h('div.dz-orb', icon('upload', compact ? 22 : 30)),
  h('div.dz-text',
    h('strong', title),
    h('span.muted', hint || (multiple ? 'or tap to browse · Ctrl/⌘+V to paste' : 'or tap to browse')),
    kinds.length ? h('div.dz-kinds', kinds.map((k) => h('span.chip.xs', k))) : null),
  h('div.dz-actions', h('button.btn.primary.sm', { type: 'button' }, icon('plus', 16), 'Choose files'), pasteBtn));
}

/**
 * Toolbar for lists whose order matters: count + total size, quick sorts, and (optionally) numbered names.
 * onSort(kind) with kind in 'name' | 'date' | 'reverse'.
 */
export function orderTools({ onSort, numbered, hint = 'Drag to change the order' }) {
  const summary = h('span.ot-sum');
  const sortBtn = (kind, ic, label, title) => h('button.ot-btn', { type: 'button', title, 'aria-label': title, onclick: () => onSort(kind) }, icon(ic, 15), h('span', label));
  const num = numbered ? h('button.ot-btn.ot-toggle', {
    type: 'button', 'aria-pressed': numbered.get(), title: 'Start each file name with its position (01, 02, 03…) so folders and ZIPs keep this order',
    onclick: () => { numbered.set(!numbered.get()); num.setAttribute('aria-pressed', numbered.get()); },
  }, icon('listNum', 15), h('span', 'Number names')) : null;
  const el = h('div.order-tools',
    h('div.ot-left', summary, h('span.ot-hint', icon('drag', 14), hint)),
    h('div.ot-right',
      sortBtn('name', 'sortAz', 'Name', 'Sort by file name (A to Z)'),
      sortBtn('date', 'clock', 'Date', 'Sort by date, oldest first'),
      sortBtn('reverse', 'swap', 'Reverse', 'Reverse the current order'),
      num));
  el.update = (files) => {
    el.hidden = files.length < 2;
    summary.textContent = `${files.length} files · ${fmtBytes(files.reduce((a, f) => a + f.size, 0))}`;
  };
  return el;
}

/** Apply a quick sort to an array of items, using get(item) → File. Returns a new array. */
export function sortItems(arr, kind, get = (x) => x) {
  if (kind === 'reverse') return arr.slice().reverse();
  const cmp = SORTS[kind];
  return arr.slice().sort((a, b) => cmp(get(a), get(b)));
}

/** A list of files with status/progress. Files can be reordered by dragging; outputs follow that order. */
export function createQueue({ accept = () => true, onChange, local = true } = {}) {
  const items = [];
  const list = h('div.queue');
  let running = null;
  let numbered = false;
  const tools = orderTools({
    onSort: (kind) => api.sortBy(kind),
    numbered: { get: () => numbered, set: (v) => { numbered = v; } },
  });
  const wrap = h('div.q-wrap', tools, list);

  function itemEl(it) {
    const pb = progressBar();
    const thumb = h('div.q-thumb', icon(KIND_ICON[it.kind], 22));
    const meta = h('div.q-meta', h('span.q-name', { title: it.file.name }, it.file.name), h('span.q-sub', fmtBytes(it.file.size)));
    const status = h('div.q-status');
    const actions = h('div.q-actions');
    const remove = h('button.icon-btn.sm', { 'aria-label': 'Remove', onclick: () => api.remove(it.id) }, icon('x', 16));
    const num = h('span.q-num');
    const grip = h('button.q-grip', { type: 'button', 'aria-label': `Move ${it.file.name}. Use the arrow keys to change its position.`, title: 'Drag to reorder' }, icon('drag', 18));
    const el = settle(h('div.q-item', { 'data-id': it.id }, grip, h('div.q-thumb-wrap', thumb, num), h('div.q-body', meta, status), actions, remove));
    it.dom = { el, thumb, meta, status, actions, pb, remove, num };
    loadThumb(it);
    return el;
  }
  function renumber() {
    const w = String(items.length).length;
    items.forEach((it, i) => { if (it.dom) it.dom.num.textContent = String(i + 1).padStart(w, '0'); });
    list.classList.toggle('can-sort', items.length > 1 && !running);
    tools.update(items.map((x) => x.file));
  }
  sortable(list, {
    items: '.q-item', handle: '.q-grip', disabled: () => !!running || items.length < 2,
    onSort: (from, to) => { const [x] = items.splice(from, 1); items.splice(to, 0, x); renumber(); },
  });
  async function loadThumb(it) {
    let url = null;
    if (it.kind === 'image') url = await thumbOf(it.file, 120);
    else if (it.kind === 'video') url = await videoThumb(it.file, 0.1, 160);
    if (url && it.dom) {
      const img = h('img', { src: url, alt: '', decoding: 'async' });
      img.onload = () => it.dom.thumb.classList.add('has-img');
      it.dom.thumb.replaceChildren(img);
    }
  }
  function paint(it) {
    const d = it.dom; if (!d) return;
    d.el.dataset.state = it.status;
    d.remove.hidden = it.status === 'working';
    if (it.status === 'working') {
      if (!d.status.contains(d.pb)) d.status.replaceChildren(d.pb, h('small.q-msg'));
      d.pb.indeterminate(it.progress < 0);
      d.pb.set(Math.max(0, it.progress), it.progress < 0 ? '…' : undefined);
      const msg = d.status.querySelector('.q-msg'); if (msg) msg.textContent = it.msg || '';
    } else if (it.status === 'done' && !it.results.length) {
      d.status.replaceChildren(h('div.q-done', h('span.badge.ok', icon('check', 14), 'Added'), it.note ? h('span.q-sizes', it.note) : null, local ? localBadge() : null));
      d.actions.replaceChildren();
    } else if (it.status === 'done') {
      const r = it.results;
      const total = r.reduce((a, x) => a + x.size, 0);
      const diff = it.file.size ? Math.round((1 - total / it.file.size) * 100) : 0;
      d.status.replaceChildren(h('div.q-done',
        h('span.badge.ok', icon('check', 14), r.length > 1 ? `${r.length} files` : 'Done'),
        it.note ? h('span.q-sizes', `${it.note} · ${fmtBytes(total)}`) : h('span.q-sizes', `${fmtBytes(it.file.size)} → ${fmtBytes(total)}`),
        it.note ? null : diff > 0 ? h('span.badge.save', `−${diff}%`) : diff < 0 ? h('span.badge.grow', `+${-diff}%`) : null,
        local ? localBadge() : null),
        ...(it.warn ? [h('small.q-warn', icon('info', 14), it.warn)] : []));
      d.actions.replaceChildren(...resultActions(r));
    } else if (it.status === 'error') {
      d.status.replaceChildren(h('small.q-err', it.error));
      d.actions.replaceChildren();
    } else if (it.status === 'cancelled') {
      d.status.replaceChildren(h('small.muted', 'Cancelled'));
    } else {
      d.status.replaceChildren(it.info ? h('small.muted', it.info) : '');
      d.actions.replaceChildren();
    }
  }
  const api = {
    el: wrap, items,
    /** Output name with an order prefix (01-, 02-…) when "Number names" is on. */
    nameFor(it, name) {
      if (!numbered || items.length < 2) return name;
      const i = items.indexOf(it); if (i < 0) return name;
      return `${String(i + 1).padStart(Math.max(2, String(items.length).length), '0')}-${name}`;
    },
    sortBy(kind) {
      if (running || items.length < 2) return;
      const sorted = sortItems(items, kind, (x) => x.file);
      items.splice(0, items.length, ...sorted);
      reorderChildren(list, items.map((x) => x.dom.el));
      renumber();
    },
    add(files) {
      const added = [];
      for (const file of files) {
        if (!accept(file)) continue;
        const it = { id: uid('q'), file, kind: kindOf(file), status: 'ready', progress: 0 };
        items.push(it); list.append(itemEl(it)); paint(it); added.push(it);
      }
      if (files.length && !added.length) toast('Those files are not supported in this tool', 'error');
      renumber();
      onChange?.(items, added);
      return added;
    },
    remove(id) {
      const i = items.findIndex((x) => x.id === id); if (i < 0) return;
      const [it] = items.splice(i, 1);
      it.dom.el.classList.add('leaving'); setTimeout(() => it.dom.el.remove(), 180);
      renumber();
      onChange?.(items, []);
    },
    clear() { items.splice(0).forEach((it) => it.dom.el.remove()); renumber(); onChange?.(items, []); },
    setInfo(it, info) { it.info = info; paint(it); },
    paint,
    get running() { return !!running; },
    cancel() { running?.abort(); },
    /** Run job(it, ctx) for every ready item. ctx: { onProgress, onStatus, signal } */
    async run(job, { label = 'Processing', tool = '', task: taskInfo } = {}) {
      if (running) return;
      const todo = items.filter((x) => x.status !== 'working');
      if (!todo.length) return;
      running = new AbortController();
      const signal = running.signal;
      renumber();
      const all = todo.slice();
      const ctl = running;
      const tk = tasks.start({ title: taskInfo?.title || `${label} ${all.length} file${all.length > 1 ? 's' : ''}`, route: taskInfo?.route || tool, iconName: taskInfo?.icon, cancel: () => ctl.abort() });
      const report = () => {
        const p = all.reduce((a, x) => a + (x.status === 'done' || x.status === 'error' || x.status === 'cancelled' ? 1 : x.status === 'working' ? Math.max(0, Math.min(1, x.progress || 0)) : 0), 0) / all.length;
        const fin = all.filter((x) => x.status === 'done').length;
        tk.progress(p, all.length > 1 ? `${fin} of ${all.length} done` : (all[0].msg || label));
      };
      const throttle = saver() ? 250 : 80;
      const t0 = performance.now();
      let ok = 0, fail = 0;
      const worker = async () => {
        for (;;) {
          const it = todo.shift(); if (!it || signal.aborted) return;
          it.status = 'working'; it.progress = 0; it.msg = label + '…'; it.warn = ''; paint(it);
          let last = 0;
          try {
            const res = await job(it, {
              signal,
              onProgress: (p) => { it.progress = p; const now = performance.now(); if (now - last > throttle || p >= 1) { last = now; paint(it); report(); } },
              onStatus: (m) => { it.msg = m; paint(it); report(); },
            });
            it.results = res == null ? [] : Array.isArray(res) ? res : [res];
            it.status = 'done'; ok++;
            if (it.results.length) history.add({ tool, name: it.file.name, inSize: it.file.size, outSize: it.results.reduce((a, r) => a + r.size, 0), kind: it.kind });
            it.results.forEach((r) => recent.add(r, { tool, local }));
            if (settings.get('autoSave')) it.results.forEach((r) => !r.savedToDisk && download(r));
          } catch (e) {
            console.error(e);
            if (e.cancelled || signal.aborted) it.status = 'cancelled';
            else { it.status = 'error'; it.error = friendly(e); fail++; }
          }
          paint(it); report();
        }
      };
      const n = effectiveParallel();
      await Promise.all(Array.from({ length: n }, worker));
      running = null; renumber();
      if (signal.aborted && !ok) tk.cancelled();
      else if (fail && !ok) tk.fail(`${fail} failed`);
      else tk.done(fail ? `${ok} done, ${fail} failed` : `${ok} file${ok > 1 ? 's' : ''} ready`);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (ok) { feedback('done'); notify('Morph: done', `${ok} file(s) finished in ${secs}s`); }
      if (fail) feedback('error');
      onChange?.(items, []);
      return { ok, fail };
    },
    results() { return items.filter((x) => x.status === 'done').flatMap((x) => x.results); },
  };
  return api;
}

/** "On this device" badge: shows the file was processed locally and never uploaded. Tap for details. */
export function localBadge() {
  return h('button.badge.local', {
    type: 'button', title: 'Done on this device: your file never left it',
    onclick: (e) => { e.stopPropagation(); showLocalInfo(); },
  }, icon('lock', 12), 'On this device');
}
export function showLocalInfo() {
  modal({
    title: 'Done on this device', sheet: true,
    body: h('div.local-info',
      h('div.li-hero', icon('lock', 26)),
      h('p', h('strong', 'Your file never left this device.'), ' Morph did all the work right here, on your phone or computer. Nothing was uploaded to a server.'),
      h('ul.li-list',
        h('li', icon('check', 16), 'Private: nobody else can see your files'),
        h('li', icon('check', 16), 'Works without internet'),
        h('li', icon('check', 16), 'No upload or download waiting, even for huge files')),
      h('p.muted.small', 'Online features (Downloader, Share links) are clearly marked “Online”.')),
    actions: [{ label: 'Got it', primary: true }],
  });
}

export function friendly(e) {
  const m = e?.message || String(e);
  if (/memory|allocation|RangeError/i.test(m)) return 'Ran out of memory on this device. Try a smaller output, or use a desktop browser.';
  if (/AbortError/i.test(m)) return 'Cancelled.';
  if (/fetch|network/i.test(m)) return 'Network error. Check the connection or server address.';
  return m.length > 180 ? m.slice(0, 180) + '…' : m;
}

export function resultActions(results) {
  const r = results[0];
  const btns = [];
  if (results.length === 1) {
    btns.push(h('button.btn.primary.sm', { onclick: () => download(r) }, icon(r.savedToDisk ? 'check' : 'download', 16), r.savedToDisk ? 'Saved' : 'Save'));
  } else {
    btns.push(h('button.btn.primary.sm', { onclick: () => saveAll(results, r.name.replace(/[-_ ]?\d*\.[^.]+$/, '') + '.zip') }, icon('download', 16), 'Save all'));
  }
  if (navigator.canShare && results.length === 1) btns.push(h('button.icon-btn.sm', { 'aria-label': 'Share', title: 'Share', onclick: () => shareResult(r) }, icon('link', 16)));
  btns.push(h('button.icon-btn.sm', { 'aria-label': 'More actions', title: 'Use result in another tool', onclick: (e) => app.openActions(results.map((x) => toFile(x)), e.currentTarget) }, icon('sparkle', 16)));
  return btns;
}
export const toFile = (r) => (r.blob instanceof File && r.blob.name === r.name ? r.blob : new File([r.blob], r.name, { type: r.blob.type }));

/** Bottom action bar for a queue: start/cancel/save-all/clear. */
export function queueBar(queue, { startLabel, onStart, extra }) {
  const start = h('button.btn.primary.lg', { onclick: () => (queue.running ? queue.cancel() : onStart()) });
  const saveAllBtn = h('button.btn.ghost', { onclick: () => saveAll(queue.results()) }, icon('download', 16), 'Save all');
  const clearBtn = h('button.btn.ghost', { onclick: () => queue.clear() }, icon('trash', 16), 'Clear');
  const el = h('div.action-bar', extra || null, h('div.ab-right', clearBtn, saveAllBtn, start));
  el.update = () => {
    const n = queue.items.length, done = queue.results().length;
    start.replaceChildren(icon(queue.running ? 'x' : 'bolt', 18), queue.running ? 'Cancel' : `${startLabel}${n > 1 ? ` (${n})` : ''}`);
    start.classList.toggle('danger', queue.running);
    start.disabled = !n;
    saveAllBtn.hidden = done < 2 || queue.running;
    clearBtn.hidden = !n || queue.running;
  };
  el.update();
  return el;
}

export function emptyState(iconName, title, text) {
  return h('div.empty', h('div.empty-ic', icon(iconName, 28)), h('strong', title), h('p.muted', text));
}

/** Desktop: dock the action bar at the bottom of the options panel. Phones: keep it as a sticky bar under the list. */
export function dockBar(bar, side, tool) {
  const mq = matchMedia('(min-width: 1101px)');
  let seen = false;
  const apply = () => {
    if (seen && !tool.isConnected) { mq.removeEventListener('change', apply); return; }
    const docked = mq.matches;
    bar.classList.toggle('docked', docked);
    (docked ? side : tool).append(bar);
  };
  apply();
  requestAnimationFrame(() => { seen = true; });
  mq.addEventListener('change', apply);
}
