// App shell: navigation, routing, global paste / drag & drop, file hand-off between tools.
import { h, $, clear } from './core/dom.js';
import { icon } from './core/icons.js';
import { settings, applyAppearance } from './core/settings.js';
import { kindOf, filesFromDataTransfer, findUrl } from './core/files.js';
import { toast, modal } from './core/ui.js';

export const NAV = [
  { id: 'home', label: 'Home', icon: 'home', mobile: true },
  { id: 'convert', label: 'Convert', icon: 'convert', mobile: true },
  { id: 'compress', label: 'Compress', icon: 'compress', mobile: true },
  { id: 'edit', label: 'Video editor', short: 'Edit', icon: 'scissors', mobile: true },
  { id: 'pdf', label: 'PDF tools', short: 'PDF', icon: 'pdf', mobile: true },
  { id: 'download', label: 'Downloader', icon: 'download' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const loaders = {
  home: () => import('./views/home.js'),
  convert: () => import('./views/convert.js'),
  compress: () => import('./views/compress.js'),
  edit: () => import('./views/editor.js'),
  pdf: () => import('./views/pdf.js'),
  download: () => import('./views/downloader.js'),
  settings: () => import('./views/settings.js'),
};

let current = null; // { id, view: { el, accept?(files), acceptText?(t), destroy?() } }
let pending = null; // files handed to the next view
let navToken = 0;

export const app = {
  go(route, files) {
    if (files) pending = files;
    const target = '#/' + route;
    if (location.hash === target) render(); else location.hash = target;
  },
  takePending() { const p = pending; pending = null; return p; },
  /** Files arrived (drop/paste/share/open-with). */
  incoming(files) {
    if (!files.length) return;
    if (current?.view?.accept && current.view.accept(files) !== false) return;
    app.openActions(files);
  },
  /** "What do you want to do with these files?" sheet. */
  openActions(files) {
    const kinds = new Set(files.map(kindOf));
    const k = kinds.size === 1 ? [...kinds][0] : 'mixed';
    const opts = [];
    const add = (route, iconName, title, desc, sub) => opts.push({ route, iconName, title, desc, sub });
    if (k === 'video') {
      add('compress', 'compress', 'Compress video', 'Make it smaller, keep it sharp');
      add('convert', 'convert', 'Convert video', 'MP4, WebM, MOV, MKV, GIF, MP3…');
      add('edit', 'scissors', 'Edit video', 'Trim, crop, rotate, speed, mute');
    } else if (k === 'image') {
      add('compress', 'compress', 'Compress photos', 'Smaller files, same look');
      add('convert', 'convert', 'Convert photos', 'JPG, PNG, WebP, AVIF, ICO, PDF…');
      add('pdf', 'pdf', 'Photos → PDF', 'Combine into one PDF', 'img2pdf');
    } else if (k === 'audio') {
      add('convert', 'convert', 'Convert audio', 'MP3, M4A, WAV, OGG, FLAC');
      add('compress', 'compress', 'Compress audio', 'Lower bitrate, smaller file');
    } else if (k === 'pdf') {
      add('pdf', 'merge', 'Merge PDFs', 'Combine into one', 'merge');
      add('pdf', 'compress', 'Compress PDF', 'Reduce file size', 'compress');
      add('convert', 'image', 'PDF → Images', 'JPG, PNG or WebP');
      add('pdf', 'grid', 'More PDF tools', 'Split, rotate, sign, protect…');
    } else if (k === 'text') {
      add('convert', 'pdf', 'Text → PDF', 'Turn text into a PDF');
    } else {
      add('convert', 'convert', 'Convert', 'Pick an output format per file');
      add('compress', 'compress', 'Compress', 'Photos & videos');
      add('pdf', 'zip', 'Merge into PDF', 'Images & PDFs', 'merge');
    }
    const m = modal({
      title: `${files.length} file${files.length > 1 ? 's' : ''} ready`,
      body: h('div.action-list', opts.map((o) => h('button.action-item', {
        onclick: () => { m.close(); app.go(o.sub ? `${o.route}/${o.sub}` : o.route, files); },
      }, h('span.ai-ic', icon(o.iconName, 20)), h('span.ai-txt', h('strong', o.title), h('small', o.desc)), icon('chevron', 18)))),
    });
  },
};

function routeFromHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { id: loaders[parts[0]] ? parts[0] : 'home', sub: parts.slice(1) };
}

async function render() {
  const { id, sub } = routeFromHash();
  const token = ++navToken;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === id));
  const host = $('#view');
  if (current?.id === id && current.view?.route) { current.view.route(sub); return; }
  host.classList.add('loading');
  let mod;
  try { mod = await loaders[id](); } catch (e) {
    console.error(e); toast('Could not load this screen. If you are offline, open it once while online.', 'error'); host.classList.remove('loading'); return;
  }
  if (token !== navToken) return;
  current?.view?.destroy?.();
  const view = mod.default({ sub, files: app.takePending() });
  current = { id, view };
  host.classList.remove('loading');
  const page = h('div.page', view.el);
  clear(host).append(page);
  host.scrollTop = 0; window.scrollTo(0, 0);
  document.title = `${NAV.find((n) => n.id === id).label} · Morph`;
}

function navLink(n, cls) {
  return h('a', { class: cls, href: '#/' + n.id, 'data-nav': n.id, 'aria-label': n.label }, icon(n.icon, 20), h('span', cls === 'tab' ? n.short || n.label : n.label));
}

function buildShell() {
  const root = $('#app');
  const offline = h('span.net-pill', { hidden: navigator.onLine }, icon('wifiOff', 14), 'Offline');
  const installBtn = h('button.btn.ghost.sm#install', { hidden: true }, icon('download', 16), 'Install app');
  const side = h('aside.sidebar',
    h('a.brand', { href: '#/' }, logo(), h('span', 'Morph')),
    h('nav.side-nav', NAV.map((n) => navLink(n, 'side-link'))),
    h('div.side-foot', installBtn, h('div.side-note', icon('lock', 14), h('span', 'Files never leave your device'))));
  const top = h('header.topbar',
    h('a.brand.m-only', { href: '#/' }, logo(), h('span', 'Morph')),
    h('div.top-right', offline,
      h('a.icon-btn.m-only', { href: '#/download', 'data-nav': 'download', 'aria-label': 'Downloader' }, icon('download')),
      h('a.icon-btn.m-only', { href: '#/settings', 'data-nav': 'settings', 'aria-label': 'Settings' }, icon('settings'))));
  const tabs = h('nav.tabbar', NAV.filter((n) => n.mobile).map((n) => navLink(n, 'tab')));
  const drop = h('div.drop-overlay', { 'aria-hidden': 'true' }, h('div.do-box', icon('upload', 36), h('strong', 'Drop to add'), h('span', 'Videos, photos, audio, PDFs, folders')));
  root.append(side, h('div.main', top, h('main#view'), tabs), drop);

  addEventListener('online', () => { offline.hidden = true; });
  addEventListener('offline', () => { offline.hidden = false; toast('You are offline: everything except the link downloader still works.'); });
  const setNet = () => document.documentElement.classList.toggle('offline', !navigator.onLine);
  addEventListener('online', setNet); addEventListener('offline', setNet); setNet();
  let deferred;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; installBtn.hidden = false; });
  installBtn.onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; installBtn.hidden = true; };
  app.installAvailable = () => !!deferred;
  app.install = () => installBtn.onclick();

  // Global drag & drop
  let depth = 0;
  addEventListener('dragenter', (e) => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; e.preventDefault(); if (++depth === 1) drop.classList.add('on'); });
  addEventListener('dragleave', () => { if (depth && --depth === 0) drop.classList.remove('on'); });
  addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length && !e.dataTransfer?.items?.length) return;
    e.preventDefault(); depth = 0; drop.classList.remove('on');
    if (e.target.closest?.('[data-own-drop]')) return;
    app.incoming(await filesFromDataTransfer(e.dataTransfer));
  });

  // Global paste: files anywhere; links go to the downloader.
  addEventListener('paste', async (e) => {
    if (!settings.get('globalPaste')) return;
    const t = e.target;
    const typing = t.closest?.('input, textarea, [contenteditable]');
    const files = await filesFromDataTransfer(e.clipboardData);
    if (files.length) { e.preventDefault(); app.incoming(files); return; }
    if (typing) return;
    const text = e.clipboardData?.getData('text') || '';
    const url = findUrl(text);
    if (url && settings.get('detectLinks')) {
      if (!navigator.onLine) { toast('Link detected, but the downloader needs internet.'); return; }
      if (current?.view?.acceptText?.(url)) return;
      app.go('download'); setTimeout(() => current?.view?.acceptText?.(url), 60);
    }
  });
}

let logoN = 0;
function logo() {
  const id = 'lg' + ++logoN;
  return h('span.logo', { html: '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#' + id + ')"/><path d="M8 22V10l8 7 8-7v12" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
}

async function pickUpShared() {
  const q = new URLSearchParams(location.search);
  if (!q.has('shared')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  try {
    const cache = await caches.open('morph-share');
    const keys = await cache.keys();
    const files = [];
    for (const k of keys) {
      const r = await cache.match(k);
      files.push(new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') || 'shared'), { type: r.headers.get('content-type') }));
      await cache.delete(k);
    }
    if (files.length) app.incoming(files);
    else if (q.get('text') && findUrl(q.get('text'))) app.go('download'), setTimeout(() => current?.view?.acceptText?.(findUrl(q.get('text'))), 100);
  } catch { /* nothing shared */ }
}

function fileHandlers() {
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files = await Promise.all(params.files.map((fh) => fh.getFile()));
      app.incoming(files);
    });
  }
}

export function start() {
  applyAppearance();
  settings.on(() => applyAppearance());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
  buildShell();
  addEventListener('hashchange', render);
  render().then(() => { pickUpShared(); fileHandlers(); });
}
