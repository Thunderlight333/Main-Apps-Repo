import { h, fmtBytes, fmtTime } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, resultActions, friendly, toFile } from '../core/components.js';
import { segmented, field, toast, progressBar, busy, feedback, notify } from '../core/ui.js';
import { findUrl, readClipboardFiles } from '../core/files.js';
import { settings } from '../core/settings.js';
import { startRun } from '../core/save.js';
import { history } from '../core/history.js';
import { getInfo, downloadLink, detectSite, checkServer, serverBase } from '../engines/downloader.js';
import { app } from '../app.js';

const SITES = ['YouTube', 'X / Twitter', 'Instagram', 'TikTok', 'Facebook', 'Reddit', 'Vimeo', 'Twitch', 'SoundCloud', '+1000 more'];

export default function downloaderView() {
  let mode = settings.get('dlMode'), quality = settings.get('dlQuality'), ac = null, infoReq = 0;
  const input = h('input.input.url-in', { type: 'url', placeholder: 'Paste a link: youtube.com/…, x.com/…, tiktok.com/…', autocomplete: 'off', inputmode: 'url', oninput: () => onUrl() });
  const pasteBtn = h('button.btn.ghost', { onclick: async () => {
    try { const { text } = await readClipboardFiles(); const u = findUrl(text) || text.trim(); if (u) { input.value = u; onUrl(); } else toast('No link on the clipboard'); }
    catch { toast('Clipboard blocked: long-press the box and choose Paste', 'error'); }
  } }, icon('paste', 18), 'Paste');
  const siteBadge = h('span.site-badge', { hidden: true });
  const infoHost = h('div.dl-info');
  const status = h('div.server-status');
  const progress = progressBar(); progress.hidden = true;
  const msg = h('small.muted');
  const goBtn = h('button.btn.primary.lg', { onclick: go }, icon('download', 18), 'Download');
  const resultHost = h('div.dl-results');

  const modeSeg = segmented([{ value: 'video', label: 'Video', icon: 'video' }, { value: 'audio', label: 'Audio (MP3)', icon: 'audio' }], mode, (v) => { mode = v; settings.set('dlMode', v); qualityRow.hidden = v === 'audio'; });
  const qualitySeg = segmented(['2160', '1440', '1080', '720', '480', '360'].map((q) => ({ value: q, label: q === '2160' ? '4K' : q + 'p' })), quality, (v) => { quality = v; settings.set('dlQuality', v); }, { small: true });
  const qualityRow = field('Max quality', qualitySeg); qualityRow.hidden = mode === 'audio';

  let t;
  function onUrl() {
    const u = findUrl(input.value);
    siteBadge.hidden = !u; if (u) siteBadge.textContent = detectSite(u);
    clearTimeout(t);
    if (!u) { infoHost.replaceChildren(); return; }
    t = setTimeout(() => loadInfo(u), 450);
  }
  async function loadInfo(u) {
    const id = ++infoReq;
    if (settings.get('dlBackend') === 'cobalt' || !(await checkServer()).ok) return;
    infoHost.replaceChildren(h('div.loading-row', h('span.spinner'), 'Reading link…'));
    try {
      const i = await getInfo(u);
      if (id !== infoReq) return;
      infoHost.replaceChildren(h('div.card.info-card',
        i.thumbnail ? h('img.ic-thumb', { src: i.thumbnail, alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' }) : h('div.ic-thumb', icon('video', 28)),
        h('div.ic-text', h('strong', i.title || 'Untitled'), h('span.muted', [i.uploader, i.duration ? fmtTime(i.duration) : null, i.heights?.length ? `up to ${i.heights[0]}p` : null].filter(Boolean).join(' · ')))));
    } catch (e) { if (id === infoReq) infoHost.replaceChildren(h('p.q-err', friendly(e))); }
  }

  async function refreshStatus() {
    const backend = settings.get('dlBackend');
    if (backend === 'cobalt') {
      status.replaceChildren(h('span.dot', { class: settings.get('dlCobaltUrl') ? 'ok' : 'off' }), settings.get('dlCobaltUrl') ? `Using cobalt instance: ${settings.get('dlCobaltUrl')}` : 'No cobalt instance set', h('a.link-btn', { href: '#/settings' }, 'Change'));
      return;
    }
    status.replaceChildren(h('span.spinner.sm'), 'Checking download server…');
    const s = await checkServer();
    if (s.ok) status.replaceChildren(h('span.dot.ok'), `Download server connected${s.ffmpeg ? '' : ' (install ffmpeg on it for best quality)'}`, h('a.link-btn', { href: '#/settings' }, 'Settings'));
    else status.replaceChildren(h('span.dot.off'), 'Download server not connected. ', h('button.link-btn', { onclick: helpModal }, 'How to set it up'));
  }
  function helpModal() {
    import('../core/ui.js').then(({ modal }) => modal({
      title: 'Why does the downloader need a server?', wide: true,
      body: h('div.prose',
        h('p', 'YouTube, TikTok, Instagram and X block web pages from downloading their videos directly, so no browser app can do it alone. Morph comes with a tiny free companion server that does it for you (using the open-source yt-dlp).'),
        h('h4', 'On your PC (recommended)'),
        h('ol', h('li', 'Install Node.js (nodejs.org) and optionally ffmpeg.'), h('li', 'In the Morph folder run: ', h('code', 'npm run serve')), h('li', 'Open ', h('code', 'http://localhost:8787'), '. The downloader connects automatically.')),
        h('h4', 'On your phone'),
        h('p', 'While the server runs on your PC, open the address it prints (e.g. ', h('code', 'http://192.168.1.20:8787'), ') on your phone on the same Wi-Fi. Or put that address in Settings → Downloader.'),
        h('h4', 'Alternative'),
        h('p', 'You can use any cobalt-compatible instance instead (Settings → Downloader → Backend).'),
        h('p.muted', 'Only download content you have the right to save. Everything else in Morph works 100% offline.')),
      actions: [{ label: 'Open settings', onClick: () => app.go('settings') }, { label: 'Got it', primary: true }],
    }));
  }

  async function go() {
    if (ac) { ac.abort(); return; }
    const u = findUrl(input.value);
    if (!u) { toast('Paste a valid link first', 'error'); input.focus(); return; }
    if (!navigator.onLine) { toast('The downloader needs internet. Connect and try again.', 'error'); return; }
    if (settings.get('dlBackend') !== 'cobalt' && serverBase() === null) { helpModal(); return; }
    const run = startRun(1, `${detectSite(u).replace(/\W+/g, '-')}-${Date.now()}.${mode === 'audio' ? 'mp3' : 'mp4'}`);
    ac = new AbortController();
    goBtn.classList.add('danger'); goBtn.replaceChildren(icon('x', 18), 'Cancel');
    progress.hidden = false; progress.set(0); busy(true);
    try {
      const res = await downloadLink(u, {
        mode, quality, run, signal: ac.signal,
        onStatus: (m) => (msg.textContent = m),
        onProgress: (p, got) => { progress.indeterminate(p < 0); progress.set(Math.max(0, p), p < 0 ? (got ? fmtBytes(got) : '…') : undefined); },
      });
      msg.textContent = '';
      history.add({ tool: 'download', name: res.name, inSize: res.size, outSize: res.size, kind: mode === 'audio' ? 'audio' : 'video' });
      const f = toFile(res);
      resultHost.prepend(h('div.result-card',
        h('div.rc-info', icon('check', 18), h('strong', res.name), h('span.muted', fmtBytes(res.size))),
        h('div.rc-actions', resultActions([res])),
        h('div.rc-next', h('span.muted.small', 'Next:'),
          h('button.chip', { onclick: () => app.go('compress', [f]) }, 'Compress'),
          h('button.chip', { onclick: () => app.go('convert', [f]) }, 'Convert'),
          mode === 'video' ? h('button.chip', { onclick: () => app.go('edit', [f]) }, 'Edit') : null)));
      feedback('done'); notify('Morph: download finished', res.name);
    } catch (e) {
      msg.textContent = '';
      if (e.name !== 'AbortError') { toast(friendly(e), 'error', 6000); feedback('error'); }
    } finally { ac = null; busy(false); progress.hidden = true; progress.indeterminate(false); goBtn.classList.remove('danger'); goBtn.replaceChildren(icon('download', 18), 'Download'); }
  }

  // Online-only feature: everything is disabled (with a clear message) when there is no internet.
  const offlineBanner = h('div.offline-banner', icon('wifiOff', 20),
    h('div', h('strong', "You're offline"), h('span', 'The downloader needs an internet connection. Everything else in Morph keeps working offline.')));
  const dlCard = h('div.card.dl-card',
      h('div.url-row', h('div.url-wrap', icon('link', 18), input, siteBadge), pasteBtn),
      h('div.sites', SITES.map((s) => h('span.chip.xs', s))),
      h('div.dl-opts', field('Download as', modeSeg), qualityRow),
      infoHost,
      h('div.dl-go', progress, msg, goBtn),
      status);
  const el = h('div.tool.downloader',
    pageHeader('Downloader', 'Save videos and audio from your favourite sites. Requires internet.', 'download', h('span.online-tag', icon('link', 14), 'Online feature')),
    offlineBanner, dlCard, resultHost);
  function applyNet() {
    const on = navigator.onLine;
    offlineBanner.hidden = on;
    dlCard.classList.toggle('disabled', !on);
    dlCard.inert = !on;
    if (on) refreshStatus();
    else if (ac) ac.abort();
  }
  addEventListener('online', applyNet); addEventListener('offline', applyNet);
  applyNet();
  setTimeout(() => input.focus({ preventScroll: true }), 50);
  return {
    el,
    acceptText: (u) => { input.value = u; onUrl(); return true; },
    destroy: () => { ac?.abort(); removeEventListener('online', applyNet); removeEventListener('offline', applyNet); },
  };
}
