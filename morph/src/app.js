// App shell: navigation, routing, global paste / drag & drop, file hand-off between tools.
import { h, $, clear } from './core/dom.js';
import { icon } from './core/icons.js';
import { settings, applyAppearance } from './core/settings.js';
import { kindOf, filesFromDataTransfer, findUrl } from './core/files.js';
import { toast, modal, closeTopModal } from './core/ui.js';
import { tasks, taskPill, bindTasks } from './core/tasks.js';
import { seenGuide, showGuide } from './core/onboard.js';

export const NAV = [
  { id: 'home', label: 'Home', icon: 'home', mobile: true },
  { id: 'convert', label: 'Convert', icon: 'convert', mobile: true },
  { id: 'compress', label: 'Compress', icon: 'compress', mobile: true },
  { id: 'ready', label: 'Ready for…', icon: 'target' },
  { id: 'photo', label: 'Photo tools', icon: 'image' },
  { id: 'edit', label: 'Video editor', short: 'Edit', icon: 'scissors', mobile: true },
  { id: 'pdf', label: 'PDF tools', short: 'PDF', icon: 'pdf', mobile: true },
  { id: 'scan', label: 'Scan to PDF', icon: 'camera', hidden: true },
  { id: 'recipes', label: 'Recipes', icon: 'recipe' },
  { id: 'download', label: 'Downloader', icon: 'download' },
  { id: 'links', label: 'Share links', icon: 'link' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

const loaders = {
  home: () => import('./views/home.js'),
  convert: () => import('./views/convert.js'),
  compress: () => import('./views/compress.js'),
  ready: () => import('./views/ready.js'),
  photo: () => import('./views/photo.js'),
  scan: () => import('./views/scan.js'),
  recipes: () => import('./views/recipes.js'),
  edit: () => import('./views/editor.js'),
  pdf: () => import('./views/pdf.js'),
  download: () => import('./views/downloader.js'),
  links: () => import('./views/links.js'),
  settings: () => import('./views/settings.js'),
};

let current = null; // { id, view: { el, accept?(files), acceptText?(t), destroy?(), hide?(), route?(sub, files), busy? }, page }
let pending = null; // files handed to the next view
let navToken = 0;
let shown = ''; // route on screen, e.g. "convert" or "pdf/merge"
// Tool screens stay alive in the background (hidden), so their jobs keep running while you use other tools.
const KEEP = new Set(['ready', 'photo', 'scan', 'recipes', 'convert', 'compress', 'edit', 'pdf', 'download', 'links']);
const alive = new Map(); // id -> { id, view, page, scroll }

export const app = {
  /** Switch screens. Never adds Back-button history: Back is handled by the app (see backButton()). */
  go(route, files) {
    if (files) pending = files;
    disarmExit();
    const target = '#/' + route;
    if (location.hash !== target) history.replaceState(history.state, '', target);
    render();
  },
  route: () => shown,
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
    if (['video', 'image', 'audio', 'pdf'].includes(k) || (k === 'mixed' && [...kinds].every((x) => ['video', 'image', 'audio', 'pdf'].includes(x)))) {
      add('ready', 'target', 'Make it ready for…', 'WhatsApp, Discord, Email, Instagram, TikTok, or your own');
    }
    if (k === 'video') {
      add('compress', 'compress', 'Compress video', 'Make it smaller, keep it sharp');
      add('convert', 'convert', 'Convert video', 'MP4, WebM, MOV, MKV, GIF, MP3…');
      add('edit', 'scissors', 'Edit video', 'Trim, crop, rotate, speed, sound & music');
      add('links', 'link', 'Get a share link', 'A short link and QR code, like Gyazo');
    } else if (k === 'image') {
      add('photo', 'image', 'Photo tools', 'Resize, crop, watermark, blur faces, remove background…');
      add('compress', 'compress', 'Compress photos', 'Smaller files, same look');
      add('convert', 'convert', 'Convert photos', 'JPG, PNG, WebP, AVIF, ICO, PDF…');
      add('pdf', 'pdf', 'Photos → PDF', 'Combine into one PDF', 'img2pdf');
      add('scan', 'camera', 'Scan documents', 'Photos of paper → straight, clean PDF');
      add('photo', 'text', 'Copy text from photo', 'Read the words in a photo or screenshot', 'ocr');
    } else if (k === 'audio') {
      add('convert', 'convert', 'Convert audio', 'MP3, M4A, WAV, OGG, FLAC');
      add('compress', 'compress', 'Compress audio', 'Lower bitrate, smaller file');
    } else if (k === 'pdf') {
      add('pdf', 'merge', 'Merge PDFs', 'Combine into one', 'merge');
      add('pdf', 'compress', 'Compress PDF', 'Reduce file size', 'compress');
      add('pdf', 'search', 'Make searchable (OCR)', 'Scanned PDF → text you can search and copy', 'ocr');
      add('convert', 'image', 'PDF → Images', 'JPG, PNG or WebP');
      add('pdf', 'grid', 'More PDF tools', 'Split, rotate, sign, protect…');
    } else if (k === 'text') {
      add('convert', 'pdf', 'Text → PDF', 'Turn text into a PDF');
    } else {
      add('convert', 'convert', 'Convert', 'Pick an output format per file');
      add('compress', 'compress', 'Compress', 'Photos & videos');
      add('pdf', 'zip', 'Merge into PDF', 'Images & PDFs', 'merge');
    }
    add('recipes', 'recipe', 'Run a recipe', 'Several steps in one go (your own or ready-made)');
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
  const files = app.takePending();
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === id));
  document.documentElement.dataset.section = id; // the active tab and screen icons take this section's colour
  const host = $('#view');
  let entry = alive.get(id) || (current?.id === id ? current : null);
  // Files sent to a tool that is idle: start it fresh with just those files (a busy tool gets them added).
  if (entry && files?.length && !entry.view.route && !entry.view.busy && !['download', 'links'].includes(id)) {
    if (entry === current) current = null;
    dispose(entry); entry = null;
  }
  if (!entry) {
    host.classList.add('loading');
    let mod;
    try { mod = await loaders[id](); } catch (e) {
      console.error(e); host.classList.remove('loading');
      // Usually means Morph was just updated and this open copy is the old one: reload into the new version (once).
      let last = 0; try { last = +sessionStorage.getItem('morph.reloaded') || 0; } catch { /* */ }
      if (navigator.onLine && Date.now() - last > 30e3) {
        try { sessionStorage.setItem('morph.reloaded', String(Date.now())); } catch { /* */ }
        toast('Morph was updated. Loading the new version…', 'info', 4000, { key: 'upd' });
        setTimeout(() => location.reload(), 300);
        return;
      }
      toast(navigator.onLine ? 'Could not load this screen. Close Morph and open it again.' : 'Could not load this screen. If you are offline, open it once while online.', 'error', 4000, { key: 'loadfail' });
      return;
    }
    host.classList.remove('loading');
    if (token !== navToken) return;
    const view = mod.default({ sub, files });
    entry = { id, view, page: h('div.page', view.el), scroll: 0 };
    if (KEEP.has(id)) alive.set(id, entry);
    host.append(entry.page);
  } else if (entry.view.route) entry.view.route(sub, files);
  else if (files?.length) entry.view.accept?.(files);
  if (current && current !== entry) {
    current.scroll = window.scrollY;
    if (alive.get(current.id) === current) { current.page.hidden = true; current.view.hide?.(); }
    else dispose(current); // Home and Settings are rebuilt each time
  }
  const fresh = current !== entry;
  current = entry;
  entry.page.hidden = false;
  shown = [id, ...sub].join('/');
  if (fresh) { entry.page.classList.remove('page'); void entry.page.offsetWidth; entry.page.classList.add('page'); window.scrollTo(0, entry.scroll || 0); }
  else if (sub.length || files) window.scrollTo(0, 0);
  tasks.seen(shown);
  document.title = `${NAV.find((n) => n.id === id).label} · Morph`;
}
function dispose(e) { e.view?.destroy?.(); e.page?.remove(); if (alive.get(e.id) === e) alive.delete(e.id); }

// ----- Back button (phones, browsers): like big apps -----
// Back closes a dialog, then goes up (PDF tool → PDF tools → Home). On Home, the first Back shows
// "Press back again to exit" (or a warning when tasks are still running); a second Back leaves.
// Switching screens never adds history, so Back never walks through every screen you visited.
let guarded = false, armed = false, armTimer = 0, exitMsg = null;
function installGuard() {
  if (guarded) return;
  guarded = true;
  removeEventListener('pointerdown', installGuard, true); removeEventListener('keydown', installGuard, true);
  history.replaceState({ morph: 'base' }, '', location.href);
  history.pushState({ morph: 'top' }, '', location.href);
}
function pushTop() { history.pushState({ morph: 'top' }, '', '#/' + shown); }
function disarmExit() {
  if (!armed) return;
  armed = false; clearTimeout(armTimer); exitMsg?.close(); exitMsg = null;
  pushTop();
}
function onBack(e) {
  if (!guarded || armed || e.state?.morph !== 'base') return; // not our Back (e.g. a typed address)
  // We are on the "base" entry now; keep its address in step with the screen.
  history.replaceState({ morph: 'base' }, '', '#/' + shown);
  const guide = document.querySelector('.guide:not(.out) .guide-skip');
  if (guide) { guide.click(); pushTop(); return; }
  if (closeTopModal()) { pushTop(); return; }
  const [id, ...sub] = shown.split('/');
  if (sub.length) { pushTop(); app.go(id); return; }
  if (id === 'scan') { pushTop(); app.go('pdf'); return; }
  if (id !== 'home') {
    pushTop();
    const working = tasks.running().length;
    if (working) toast(`${working === 1 ? 'Your task keeps' : `${working} tasks keep`} running. Progress is shown at the top.`, 'info', 3000, { key: 'bg' });
    app.go('home');
    return;
  }
  // Home: arm "press again to exit".
  armed = true;
  document.querySelector('#toasts [data-key="bg"]')?.remove();
  const n = tasks.running().length;
  const ms = n ? 5000 : 2200;
  exitMsg = n
    ? toast(`${n === 1 ? 'A task is' : `${n} tasks are`} still running. Press back again to exit and stop ${n === 1 ? 'it' : 'them'}.`, 'error', ms, { key: 'exit', action: { label: 'Stay', onClick: disarmExit } })
    : toast('Press back again to exit', 'info', ms, { key: 'exit' });
  armTimer = setTimeout(disarmExit, ms);
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
    h('nav.side-nav', NAV.filter((n) => !n.hidden).map((n) => navLink(n, 'side-link'))),
    h('div.side-foot', installBtn, h('div.side-note', icon('lock', 14), h('span', 'Files never leave your device'))));
  const tp = taskPill();
  const top = h('header.topbar',
    h('a.brand.m-only', { href: '#/' }, logo(), h('span', 'Morph')),
    h('div.top-right', offline, tp.pill,
      h('a.icon-btn.m-only', { href: '#/download', 'data-nav': 'download', 'aria-label': 'Downloader' }, icon('download')),
      h('a.icon-btn.m-only', { href: '#/settings', 'data-nav': 'settings', 'aria-label': 'Settings' }, icon('settings'))));
  const tabs = h('nav.tabbar', NAV.filter((n) => n.mobile).map((n) => navLink(n, 'tab')));
  const drop = h('div.drop-overlay', { 'aria-hidden': 'true' }, h('div.do-box', icon('upload', 36), h('strong', 'Drop to add'), h('span', 'Videos, photos, audio, PDFs, folders')));
  root.append(side, h('div.main', top, h('main#view'), tabs), drop, tp.line);

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

  // Paste (Ctrl/⌘+V) only acts on screens that show a place to drop or paste:
  // files go to that screen's drop area, links to the downloader's link box. Elsewhere (e.g. Settings) nothing happens.
  addEventListener('paste', async (e) => {
    if (!settings.get('globalPaste') || !current) return;
    if (document.querySelector('.modal-wrap')) return; // a dialog is open
    const typing = e.target.closest?.('input, textarea, [contenteditable]');
    const zone = visibleDropZone();
    const hasFiles = [...(e.clipboardData?.items || [])].some((i) => i.kind === 'file');
    if (hasFiles) {
      if (!zone) return;
      e.preventDefault();
      const files = await filesFromDataTransfer(e.clipboardData);
      if (!files.length) return;
      if (current.view?.accept && current.view.accept(files) !== false) return;
      if (current.id === 'home') app.openActions(files);
      else toast("Those files can't be used on this screen", 'error');
      return;
    }
    if (typing) return; // normal text paste into a box
    const url = findUrl(e.clipboardData?.getData('text') || '');
    if (!url || !settings.get('detectLinks')) return;
    // The downloader's link box, or the Home drop area ("drop anything") which hands links to the downloader.
    if (current.view?.acceptText) { e.preventDefault(); current.view.acceptText(url); return; }
    if (current.id === 'home' && zone) {
      e.preventDefault();
      if (!navigator.onLine) { toast('Link detected, but the downloader needs internet.'); return; }
      app.go('download'); setTimeout(() => current?.view?.acceptText?.(url), 60);
    }
  });
}

/** The current screen's drop area, if one is actually showing. */
function visibleDropZone() {
  const view = document.getElementById('view');
  return [...(view?.querySelectorAll('.dropzone') || [])].find((z) => !z.closest('[hidden]') && z.getClientRects().length > 0 && !z.classList.contains('disabled')) || null;
}

let logoN = 0;
function logo() {
  const id = 'lg' + ++logoN;
  return h('span.logo', { html: '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#' + id + ')"/><path d="M8 22V10l8 7 8-7v12" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
}

async function pickUpShared() {
  const q = new URLSearchParams(location.search);
  if (!q.has('shared')) return;
  history.replaceState(history.state, '', location.pathname + location.hash);
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
    else if (q.get('text') && findUrl(q.get('text'))) {
      // A link shared from another app (YouTube, TikTok…): open the quick download sheet, SnapTube-style.
      const u = findUrl(q.get('text'));
      app.go('download');
      const wait = (n) => (current?.id === 'download' && current.view?.acceptText ? current.view.acceptText(u, { sheet: true }) : n && setTimeout(() => wait(n - 1), 100));
      wait(50);
    }
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
  bindTasks({ route: () => shown, go: (r) => app.go(r) });
  // In-app links switch screens without adding Back history.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    app.go(a.getAttribute('href').slice(2));
  });
  addEventListener('hashchange', () => { if (location.hash.replace(/^#\/?/, '') !== shown) render(); });
  addEventListener('popstate', onBack);
  // Browsers only honour an app's Back handling after the user has touched the page.
  addEventListener('pointerdown', installGuard, true); addEventListener('keydown', installGuard, true);
  render().then(() => {
    pickUpShared(); fileHandlers();
    // First visit: a short welcome guide (only on Home, never over a shared file or a deep link).
    if (shown === 'home' && !location.search.includes('shared=') && !seenGuide()) showGuide({ canInstall: () => app.installAvailable?.(), install: () => app.install?.() });
  });
}
