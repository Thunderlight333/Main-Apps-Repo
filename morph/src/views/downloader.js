import { h, fmtBytes, fmtTime, clamp } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, resultActions, friendly, toFile } from '../core/components.js';
import { recent } from '../core/recent.js';
import { toast, progressBar, feedback, notify, modal, toggle } from '../core/ui.js';
import { tasks } from '../core/tasks.js';
import { findUrl, readClipboardFiles, outName } from '../core/files.js';
import { settings } from '../core/settings.js';
import { startRun } from '../core/save.js';
import { history } from '../core/history.js';
import { getInfo, downloadLink, detectSite, checkServer, serverBase, previewUrl, usesCobalt } from '../engines/downloader.js';
import { app } from '../app.js';
import { serverSteps } from '../core/serverHelp.js';

const SITES = ['YouTube', 'X / Twitter', 'Instagram', 'TikTok', 'Facebook', 'Reddit', 'Vimeo', 'Twitch', 'SoundCloud', '+1000 more'];

/** SnapTube-style list of formats: Video rows then Audio rows, each with its size. */
function formatList(options, selected, onPick) {
  const groups = [['video', 'Video', 'video'], ['audio', 'Audio', 'audio']];
  return h('div.fmt-list', groups.map(([kind, title, ic]) => {
    const rows = options.filter((o) => o.kind === kind);
    if (!rows.length) return null;
    return h('div.fl-group', h('div.fl-title', icon(ic, 15), title),
      rows.map((o) => h('button.fl-row', { type: 'button', role: 'radio', 'aria-checked': selected === o.id, 'data-id': o.id, onclick: () => onPick(o) },
        h('span.fl-radio'),
        h('span.fl-label', o.label, o.sub ? h('small.fl-sub', o.sub) : null),
        h('span.fl-ext', o.ext.toUpperCase()),
        h('span.fl-size', o.size ? fmtBytes(o.size) : '')))
    );
  }));
}

/** Two-handle trim bar with a playhead. */
function trimBar({ onChange, onSeek }) {
  let dur = 0, start = 0, end = 0;
  const sel = h('div.tb-sel');
  const hs = h('span.tb-h', { 'data-h': 's', role: 'slider', tabIndex: 0, 'aria-label': 'Trim start' });
  const he = h('span.tb-h', { 'data-h': 'e', role: 'slider', tabIndex: 0, 'aria-label': 'Trim end' });
  const head = h('span.tb-head');
  const track = h('div.tb-track', sel, hs, he, head);
  const lblS = h('strong'), lblE = h('strong'), lblL = h('span');
  const el = h('div.trim-bar', track, h('div.tb-labels', h('span', 'Start ', lblS), lblL, h('span', 'End ', lblE)));
  function paint() {
    if (!dur) return;
    const a = (start / dur) * 100, b = (end / dur) * 100;
    sel.style.left = a + '%'; sel.style.width = (b - a) + '%';
    hs.style.left = a + '%'; he.style.left = b + '%';
    lblS.textContent = fmtTime(start, true); lblE.textContent = fmtTime(end, true); lblL.textContent = `Length ${fmtTime(end - start, true)}`;
    hs.setAttribute('aria-valuetext', fmtTime(start)); he.setAttribute('aria-valuetext', fmtTime(end));
  }
  const tAt = (x) => { const r = track.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * dur; };
  let drag = null;
  track.addEventListener('pointerdown', (e) => {
    if (!dur) return;
    drag = e.target.dataset.h || null;
    track.setPointerCapture(e.pointerId);
    if (!drag) onSeek?.(tAt(e.clientX));
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = tAt(e.clientX);
    if (drag === 's') start = Math.min(t, end - 0.2); else end = Math.max(t, start + 0.2);
    paint(); onChange(start, end); onSeek?.(drag === 's' ? start : end);
  });
  const stop = () => { drag = null; };
  track.addEventListener('pointerup', stop); track.addEventListener('pointercancel', stop);
  [hs, he].forEach((hd) => hd.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 5 : 0.5;
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : 0;
    if (!d) return; e.preventDefault();
    if (hd === hs) start = clamp(start + d, 0, end - 0.2); else end = clamp(end + d, start + 0.2, dur);
    paint(); onChange(start, end);
  }));
  return {
    el,
    setDuration(d) { if (!d || dur) return; dur = d; start = 0; end = d; paint(); onChange(start, end); },
    set(s, e) { start = clamp(s, 0, dur); end = clamp(e, start + 0.2, dur); paint(); onChange(start, end); },
    head(t) { if (dur) head.style.transform = `translateX(${(t / dur) * track.clientWidth}px)`; },
    get range() { return { start, end, dur }; },
  };
}

export default function downloaderView() {
  let info = null, url = null, choice = null, infoReq = 0;
  const trim = { on: false, start: 0, end: 0 };
  const input = h('input.input.url-in', { type: 'url', placeholder: 'Paste a link: youtube.com/…, x.com/…, tiktok.com/…', autocomplete: 'off', inputmode: 'url', oninput: () => onUrl() });
  const pasteBtn = h('button.btn.ghost', { onclick: async () => {
    try { const { text } = await readClipboardFiles(); const u = findUrl(text) || text.trim(); if (u) { input.value = u; onUrl(); } else toast('No link on the clipboard'); }
    catch { toast('Clipboard blocked: long-press the box and choose Paste', 'error'); }
  } }, icon('paste', 18), 'Paste');
  const siteBadge = h('span.site-badge', { hidden: true });
  const sites = h('div.sites', SITES.map((s) => h('span.chip.xs', s)));
  const mediaHost = h('div.dl-media-host');
  const formatsHost = h('div');
  const goBtn = h('button.btn.primary.lg', { onclick: () => go() }, icon('download', 18), 'Download');
  const goRow = h('div.dl-go', { hidden: true }, goBtn);
  const status = h('div.server-status');
  const downloads = h('div.dl-list');

  let t;
  function onUrl() {
    const u = findUrl(input.value);
    siteBadge.hidden = !u; if (u) siteBadge.textContent = detectSite(u);
    clearTimeout(t);
    if (!u) { url = null; info = null; mediaHost.replaceChildren(); formatsHost.replaceChildren(); goRow.hidden = true; sites.hidden = false; return; }
    t = setTimeout(() => loadInfo(u), 450);
  }

  async function loadInfo(u) {
    if (u === url && info) return info;
    const id = ++infoReq;
    url = u; info = null; trim.on = false;
    sites.hidden = true;
    mediaHost.replaceChildren(h('div.loading-row', h('span.spinner'), 'Reading link…'));
    formatsHost.replaceChildren(); goRow.hidden = true;
    if (!usesCobalt() && !(await checkServer()).ok) { mediaHost.replaceChildren(); sites.hidden = false; return null; }
    try {
      const i = await getInfo(u);
      if (id !== infoReq) return null;
      info = i;
      renderMedia(); renderFormats();
      return i;
    } catch (e) {
      if (id === infoReq) mediaHost.replaceChildren(h('p.q-err', friendly(e)));
      return null;
    }
  }

  // ---------- media card: thumbnail → preview player, trim ----------
  let video = null, bar = null;
  function renderMedia() {
    const i = info;
    const canPreview = !!previewUrl(url);
    const thumb = i.thumbnail ? h('img', { src: i.thumbnail, alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' }) : h('div.dl-noimg', icon('video', 30));
    const player = h('div.dl-player', thumb,
      canPreview ? h('button.dl-play', { type: 'button', onclick: () => loadPreview(), 'aria-label': 'Preview video' }, icon('play', 22), h('span', 'Preview')) : null,
      i.duration ? h('span.dl-dur', fmtTime(i.duration)) : null);
    const trimHost = h('div.dl-trim', { hidden: true });
    const trimRow = canPreview && hasVideoOptions() ? h('label.check.dl-trim-toggle', toggle(trim.on, (v) => {
      trim.on = v; trimHost.hidden = !v;
      if (v && !video) loadPreview();
      updateGo();
    }, 'Trim before downloading'), h('span', 'Trim before downloading')) : null;
    mediaHost.replaceChildren(h('div.dl-media', player,
      h('div.dl-meta',
        h('strong.dl-title', i.title || 'Untitled'),
        h('span.muted', [i.site, i.uploader, i.duration ? fmtTime(i.duration) : null].filter(Boolean).join(' · ')),
        trimRow, trimHost)));

    function loadPreview() {
      if (video) { video.play().catch(() => {}); return; }
      const wait = h('div.dl-wait', h('span.spinner'), h('span', 'Preparing preview…'));
      player.append(wait);
      video = h('video', { src: previewUrl(url), controls: true, playsInline: true, preload: 'auto' });
      video.addEventListener('loadedmetadata', () => {
        wait.remove(); player.classList.add('playing'); player.replaceChildren(video);
        bar?.setDuration(video.duration || i.duration);
        video.play().catch(() => {});
      }, { once: true });
      video.addEventListener('error', () => { wait.replaceChildren(icon('info', 16), h('span', 'Preview not available for this link')); video = null; }, { once: true });
      video.addEventListener('timeupdate', () => {
        bar?.head(video.currentTime);
        if (trim.on && !video.paused && video.currentTime >= trim.end) { video.pause(); video.currentTime = trim.end; }
      });
      // Build the trim controls now so the duration lands as soon as it is known.
      bar = trimBar({ onChange: (s, e) => { trim.start = s; trim.end = e; updateGo(); }, onSeek: (tm) => { if (video) video.currentTime = tm; } });
      if (i.duration) bar.setDuration(i.duration);
      trimHost.replaceChildren(bar.el, h('div.btn-row',
        h('button.btn.ghost.sm', { onclick: () => video && bar.set(video.currentTime, trim.end) }, '[ Set start here'),
        h('button.btn.ghost.sm', { onclick: () => video && bar.set(trim.start, video.currentTime) }, 'Set end here ]'),
        h('button.btn.ghost.sm', { onclick: () => { if (!video) return; video.currentTime = trim.start; video.play().catch(() => {}); } }, icon('play', 14), 'Play selection')),
      h('p.hint', 'Only the selected part is saved. With ffmpeg on the server, only that part is downloaded.'));
    }
  }
  const hasVideoOptions = () => info?.options?.some((o) => o.kind === 'video');

  // ---------- formats ----------
  function defaultChoice() {
    const opts = info.options || [];
    const wantAudio = settings.get('dlMode') === 'audio';
    const q = +settings.get('dlQuality') || 1080;
    if (wantAudio) return opts.find((o) => o.kind === 'audio')?.id || opts[0]?.id;
    const vids = opts.filter((o) => o.kind === 'video');
    return (vids.find((o) => !o.height || o.height <= q) || vids[vids.length - 1] || opts[0])?.id;
  }
  function renderFormats() {
    const opts = info.options || [];
    if (!opts.length) { formatsHost.replaceChildren(h('p.muted', 'No downloadable formats were found for this link.')); return; }
    if (!opts.some((o) => o.id === choice)) choice = defaultChoice();
    formatsHost.replaceChildren(h('div.field', h('span.field-label', 'Choose a format'), formatList(opts, choice, (o) => {
      choice = o.id;
      settings.set('dlMode', o.kind); if (o.height) settings.set('dlQuality', String(o.height));
      renderFormats(); updateGo();
    })));
    goRow.hidden = false; updateGo();
  }
  function updateGo() {
    const o = info?.options?.find((x) => x.id === choice);
    if (!o) return;
    const part = trim.on && trim.end > trim.start ? ` · ${fmtTime(trim.end - trim.start)} clip` : '';
    goBtn.replaceChildren(icon('download', 18), `Download ${o.label}${part}`);
  }

  // ---------- downloads ----------
  function go() {
    const u = findUrl(input.value);
    if (!u) { toast('Paste a valid link first', 'error'); input.focus(); return; }
    if (!guard()) return;
    if (!info) { loadInfo(u).then((i) => i && go()); return; }
    const o = info.options.find((x) => x.id === choice);
    startDownload(u, info, o, trim.on && trim.end > trim.start ? { start: +trim.start.toFixed(2), end: +trim.end.toFixed(2) } : null);
  }
  function guard() {
    if (!navigator.onLine) { toast('The downloader needs internet. Connect and try again.', 'error'); return false; }
    if (!usesCobalt() && serverBase() === null) { helpModal(); return false; }
    return true;
  }

  function startDownload(u, i, o, cut) {
    const ac = new AbortController();
    const pb = progressBar();
    const msg = h('small.muted', 'Starting…');
    const cancel = h('button.icon-btn.sm', { 'aria-label': 'Cancel download', onclick: () => ac.abort() }, icon('x', 16));
    const thumb = i?.thumbnail ? h('img', { src: i.thumbnail, alt: '', referrerPolicy: 'no-referrer' }) : icon(o.kind === 'audio' ? 'audio' : 'video', 20);
    const body = h('div.dli-body', h('strong.dli-name', i?.title || detectSite(u)), h('span.dli-sub', `${o.label}${cut ? ` · ${fmtTime(cut.start)}–${fmtTime(cut.end)}` : ''}`), pb, msg);
    const item = h('div.dl-item', h('div.dli-thumb', thumb), body, cancel);
    downloads.prepend(item);
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const run = startRun(1, `${detectSite(u).replace(/\W+/g, '-')}-${Date.now()}.${o.ext}`);
    const tk = tasks.start({ title: `Download ${(i?.title || detectSite(u)).slice(0, 60)}`, route: 'download', iconName: 'download', cancel: () => ac.abort() });
    (async () => {
      try {
        let res = await downloadLink(u, {
          option: o.id, trim: cut, run, signal: ac.signal,
          onStatus: (m) => { msg.textContent = m; tk.status(m); },
          onProgress: (p, got) => { pb.indeterminate(p < 0); pb.set(Math.max(0, p), p < 0 ? (got ? fmtBytes(got) : '…') : undefined); tk.progress(p < 0 ? -1 : p, p < 0 && got ? `${fmtBytes(got)} downloaded` : undefined); },
        });
        if (cut && !res.trimmed) {
          // The server couldn't cut it (no ffmpeg, cobalt, or the host refused): trim here.
          msg.textContent = 'Trimming…'; pb.indeterminate(false); pb.set(0);
          const { processMedia } = await import('../engines/process.js');
          const src = toFile(res);
          const ext = res.name.split('.').pop().toLowerCase();
          res = await processMedia(src, { container: ext, trim: cut, duration: cut.end }, {
            run: startRun(1, outName(res.name, ext, 'clip')), name: outName(res.name, ext, 'clip'), signal: ac.signal,
            onProgress: (p) => { pb.set(p); tk.progress(p, 'Trimming…'); }, onStatus: (m) => (msg.textContent = m), duration: cut.end - cut.start,
          });
        }
        history.add({ tool: 'download', name: res.name, inSize: res.size, outSize: res.size, kind: o.kind });
        recent.add(res, { tool: 'download', local: false });
        const f = toFile(res);
        item.classList.add('done');
        cancel.remove();
        body.replaceChildren(h('strong.dli-name', { title: res.name }, res.name),
          h('span.dli-sub', h('span.badge.ok', icon('check', 12), 'Saved'), ` ${fmtBytes(res.size)}`),
          h('div.dli-actions', ...resultActions([res]),
            h('button.chip', { onclick: () => app.go('links', [f]) }, icon('link', 14), 'Share link'),
            o.kind === 'video' ? h('button.chip', { onclick: () => app.go('edit', [f]) }, 'Edit') : null,
            h('button.chip', { onclick: () => app.go('compress', [f]) }, 'Compress')));
        feedback('done'); notify('Morph: download finished', res.name);
        tk.done(`${res.name} · ${fmtBytes(res.size)}`);
      } catch (e) {
        if (e.name === 'AbortError' || e.cancelled) { item.classList.add('leaving'); setTimeout(() => item.remove(), 200); tk.cancelled(); }
        else { msg.textContent = friendly(e); msg.className = 'q-err'; pb.hidden = true; cancel.replaceChildren(icon('trash', 16)); cancel.onclick = () => item.remove(); feedback('error'); tk.fail(friendly(e)); }
      }
    })();
  }

  // ---------- quick sheet (opened when a link is shared to Morph) ----------
  async function openSheet(u) {
    if (!guard()) return;
    const head = h('div.qs-head', h('div.qs-thumb', icon('video', 22)), h('div.qs-text', h('strong', 'Reading link…'), h('span.muted', detectSite(u))));
    const list = h('div.qs-list', [1, 2, 3, 4].map(() => h('div.qs-skel')));
    const m = modal({ title: 'Download', sheet: true, body: h('div.qsheet', head, list) });
    const i = await loadInfo(u);
    if (!i) {
      list.replaceChildren(h('p.q-err', 'Could not read this link. Check the download server in Settings.'));
      return;
    }
    head.replaceChildren(
      h('div.qs-thumb', i.thumbnail ? h('img', { src: i.thumbnail, alt: '', referrerPolicy: 'no-referrer' }) : icon('video', 22)),
      h('div.qs-text', h('strong', i.title || 'Untitled'), h('span.muted', [i.site, i.duration ? fmtTime(i.duration) : null].filter(Boolean).join(' · '))));
    list.replaceChildren(formatList(i.options || [], null, (o) => { m.close(); startDownload(u, i, o, null); }),
      previewUrl(u) && hasVideoOptions() ? h('button.link-btn.qs-more', { onclick: () => m.close() }, icon('scissors', 14), 'Preview or trim first') : null);
  }

  // ---------- server status / help ----------
  async function refreshStatus() {
    if (usesCobalt()) {
      status.replaceChildren(h('span.dot', { class: settings.get('dlCobaltUrl') ? 'ok' : 'off' }), settings.get('dlCobaltUrl') ? `Using cobalt instance: ${settings.get('dlCobaltUrl')}` : 'No cobalt instance set', h('a.link-btn', { href: '#/settings' }, 'Change'));
      return;
    }
    status.replaceChildren(h('span.spinner.sm'), 'Checking download server…');
    const s = await checkServer();
    if (s.ok) status.replaceChildren(h('span.dot.ok'), `Download server connected${s.ffmpeg ? '' : ' (install ffmpeg on it for best quality and exact trims)'}`, h('a.link-btn', { href: '#/settings' }, 'Settings'));
    else status.replaceChildren(h('span.dot.off'), 'Download server not connected. ', h('button.link-btn', { onclick: helpModal }, 'How to set it up'));
  }
  function helpModal() {
    modal({
      title: 'Why does the downloader need a server?', wide: true,
      body: h('div.prose',
        h('p', 'YouTube, TikTok, Instagram and X block web pages from downloading their videos directly, so no browser app can do it alone. Morph comes with a tiny free companion server that does it for you (using the open-source yt-dlp).'),
        serverSteps(),
        h('h4', 'Alternative'),
        h('p', 'You can use any cobalt-compatible instance instead (Settings → Downloader → Backend).'),
        h('p.muted', 'Only download content you have the right to save. Everything else in Morph works 100% offline.')),
      actions: [{ label: 'Open settings', onClick: () => app.go('settings') }, { label: 'Got it', primary: true }],
    });
  }

  // Online-only feature: everything is disabled (with a clear message) when there is no internet.
  const offlineBanner = h('div.offline-banner', icon('wifiOff', 20),
    h('div', h('strong', "You're offline"), h('span', 'The downloader needs an internet connection. Everything else in Morph keeps working offline.')));
  const dlCard = h('div.card.dl-card',
    h('div.url-row', h('div.url-wrap', icon('link', 18), input, siteBadge), pasteBtn),
    sites, mediaHost, formatsHost, goRow, status);
  const el = h('div.tool.downloader',
    pageHeader('Downloader', 'Save videos and audio from your favourite sites. Requires internet.', 'download', h('span.online-tag', icon('link', 14), 'Online feature')),
    offlineBanner, dlCard, downloads);
  function applyNet() {
    const on = navigator.onLine;
    offlineBanner.hidden = on;
    dlCard.classList.toggle('disabled', !on);
    dlCard.inert = !on;
    if (on) refreshStatus();
  }
  addEventListener('online', applyNet); addEventListener('offline', applyNet);
  applyNet();
  setTimeout(() => input.focus({ preventScroll: true }), 50);
  return {
    el,
    acceptText: (u, { sheet = false } = {}) => { input.value = u; siteBadge.hidden = false; siteBadge.textContent = detectSite(u); if (sheet) openSheet(u); else loadInfo(u); return true; },
    destroy: () => { removeEventListener('online', applyNet); removeEventListener('offline', applyNet); video?.pause(); },
    hide: () => video?.pause(),
  };
}
