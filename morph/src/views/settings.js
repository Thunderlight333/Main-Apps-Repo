import { h, fmtBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader } from '../core/components.js';
import { segmented, toggle, select, toast, confirmDialog, progressBar } from '../core/ui.js';
import { settings, ACCENT_LIST, accentColor } from '../core/settings.js';
import { history } from '../core/history.js';
import { clearTemp, supportsStreamingSave } from '../core/save.js';
import { isFFmpegCached, cacheFFmpeg } from '../engines/ffmpeg.js';
import { hasWebCodecs, supportsHevc } from '../engines/media.js';
import { checkServer } from '../engines/downloader.js';
import { app } from '../app.js';

const S = (k) => settings.get(k);
const set = (k) => (v) => settings.set(k, v);

function row(title, desc, control, iconName) {
  return h('div.set-row', iconName ? h('span.sr-ic', icon(iconName, 18)) : null, h('div.sr-text', h('strong', title), desc ? h('small', desc) : null), h('div.sr-ctl', control));
}
function section(id, title, iconName, rows) {
  return h('section.set-sec', { id: 'set-' + id }, h('h2', icon(iconName, 18), title), h('div.card.set-card', rows));
}

export default function settingsView() {
  const accent = h('div.swatches', ACCENT_LIST.map((a) => h('button.swatch.lg', { style: { background: accentColor(a) }, 'aria-label': a, 'aria-pressed': S('accent') === a, onclick: (e) => {
    settings.set('accent', a); accent.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget));
  } })));

  const ffStatus = h('span.muted.small', 'Checking…');
  const ffBtn = h('button.btn.ghost.sm', { onclick: async () => {
    ffBtn.disabled = true; const pb = progressBar(); ffStatus.replaceChildren(pb);
    try { await cacheFFmpeg((p) => pb.set(p)); toast('Universal engine saved for offline use', 'success'); } catch { toast('Download failed: are you online?', 'error'); }
    refreshOffline(); ffBtn.disabled = false;
  } }, icon('download', 16), 'Download');
  const storage = h('span.muted.small', '…');
  const persistBtn = h('button.btn.ghost.sm', { onclick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Storage is now persistent' : 'The browser declined (install the app to improve this)', ok ? 'success' : 'info'); refreshOffline(); } }, 'Make persistent');
  async function refreshOffline() {
    const cached = await isFFmpegCached();
    ffStatus.textContent = cached ? 'Downloaded ✓ (32 MB)' : 'Not downloaded (32 MB)';
    ffBtn.hidden = cached;
    try {
      const e = await navigator.storage.estimate();
      const p = await navigator.storage.persisted?.();
      storage.textContent = `${fmtBytes(e.usage)} used · ${fmtBytes(e.quota)} available${p ? ' · persistent' : ''}`;
      persistBtn.hidden = !!p;
    } catch { storage.textContent = 'Unknown'; }
  }

  const caps = h('div.caps');
  (async () => {
    const items = [
      ['Hardware video engine (WebCodecs)', hasWebCodecs()],
      ['H.265 / HEVC encoding', await supportsHevc()],
      ['Stream huge outputs to disk', await supportsStreamingSave()],
      ['Save directly to folders', 'showDirectoryPicker' in window],
      ['Installed as an app', matchMedia('(display-mode: standalone)').matches],
      ['Works offline', 'serviceWorker' in navigator],
    ];
    caps.replaceChildren(...items.map(([l, ok]) => h('div.cap', h('span', { class: 'dot ' + (ok ? 'ok' : 'off') }), l)));
  })();

  const serverState = h('span.muted.small');
  const testServer = async () => { serverState.textContent = 'Testing…'; const s = await checkServer(); serverState.textContent = s.ok ? `Connected ✓${s.ffmpeg ? '' : ' (no ffmpeg)'}` : 'Not reachable'; };
  const dlBackendRows = h('div');
  function renderDl() {
    const b = S('dlBackend');
    dlBackendRows.replaceChildren(
      b === 'companion'
        ? row('Server address', 'Leave empty when Morph is opened from the companion server itself. On a phone, use the PC address it prints.', h('div.inline', h('input.input', { placeholder: 'http://192.168.1.20:8787', value: S('dlServer'), onchange: (e) => { settings.set('dlServer', e.target.value.trim()); testServer(); } }), serverState))
        : h('div', row('Instance URL', 'Any cobalt-compatible API endpoint', h('input.input', { placeholder: 'https://your-cobalt-instance', value: S('dlCobaltUrl'), onchange: (e) => settings.set('dlCobaltUrl', e.target.value.trim()) })),
          row('API key', 'Optional, if your instance requires one', h('input.input', { type: 'password', value: S('dlCobaltKey'), onchange: (e) => settings.set('dlCobaltKey', e.target.value.trim()) }))));
  }
  renderDl(); testServer();

  const notifyToggle = toggle(S('notify'), async (v) => {
    if (v && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { toast('Notifications were blocked by the browser', 'error'); notifyToggle.querySelector('input').checked = false; return; }
    }
    settings.set('notify', v);
  });
  const customSuffix = h('input.input.sm', { value: S('customSuffix'), hidden: S('namePattern') !== 'custom', onchange: (e) => settings.set('customSuffix', e.target.value) });

  const nav = [['appearance', 'Appearance', 'sparkle'], ['files', 'Files & saving', 'file'], ['processing', 'Processing', 'bolt'], ['smart', 'Smart features', 'star'], ['offline', 'Offline & storage', 'wifiOff'], ['download', 'Downloader', 'download'], ['privacy', 'Privacy', 'lock'], ['about', 'About', 'info']];

  const el = h('div.settings',
    pageHeader('Settings', 'Make Morph work the way you like.', 'settings'),
    h('div.set-layout',
      h('nav.set-nav', nav.map(([id, l, ic]) => h('a', { href: '#/settings', onclick: (e) => { e.preventDefault(); document.getElementById('set-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, icon(ic, 16), l))),
      h('div.set-main',
        section('appearance', 'Appearance', 'sparkle', [
          row('Theme', null, segmented([{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], S('theme'), set('theme'), { small: true })),
          row('Accent color', null, accent),
          row('Animations', 'Reduced keeps only subtle fades; Off disables all motion', segmented([{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }, { value: 'off', label: 'Off' }], S('motion'), set('motion'), { small: true })),
          row('Layout density', null, segmented([{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }], S('density'), set('density'), { small: true })),
          row('Text size', null, segmented([{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }], S('fontScale'), set('fontScale'), { small: true })),
        ]),
        section('files', 'Files & saving', 'file', [
          row('Where to save', 'Auto: saves to Downloads. Ask: you pick a file/folder and big videos stream straight to it (desktop Chrome/Edge).', segmented([{ value: 'auto', label: 'Auto' }, { value: 'ask', label: 'Ask every time' }], S('saveMethod'), set('saveMethod'), { small: true })),
          row('Output file names', 'e.g. holiday-compressed.mp4', h('div.inline', select([{ value: 'suffix', label: 'Name + tool (holiday-compressed)' }, { value: 'original', label: 'Keep original name' }, { value: 'custom', label: 'Name + custom suffix' }], S('namePattern'), (v) => { settings.set('namePattern', v); customSuffix.hidden = v !== 'custom'; }), customSuffix)),
          row('Save automatically', 'Download results as soon as they finish', toggle(S('autoSave'), set('autoSave'))),
          row('Zip multiple results', 'When saving many files at once', segmented([{ value: 'auto', label: 'Auto (4+)' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }], S('zipMultiple'), set('zipMultiple'), { small: true })),
        ]),
        section('processing', 'Processing', 'bolt', [
          row('Hardware acceleration', 'Use your GPU for video. Switch to software if you see glitches.', segmented([{ value: 'no-preference', label: 'Auto' }, { value: 'prefer-hardware', label: 'GPU' }, { value: 'prefer-software', label: 'CPU' }], S('hwAccel'), set('hwAccel'), { small: true })),
          row('Files processed at once', 'More is faster on strong devices but uses more memory (Battery saver uses 1)', segmented([1, 2, 3, 4].map((n) => ({ value: n, label: String(n) })), S('parallelJobs'), set('parallelJobs'), { small: true })),
          row('Keep metadata', 'Copy titles, dates and other tags from video/audio sources', toggle(S('keepMetadata'), set('keepMetadata'))),
          row('Universal engine fallback', 'Use ffmpeg for formats the fast engine can\'t handle (AVI, WMV, FLV, GIF…)', toggle(S('ffmpegFallback'), set('ffmpegFallback'))),
          row('Power mode', 'Auto turns on Battery saver on phones: one file at a time, hardware encoding, calmer UI while working.', segmented([{ value: 'auto', label: 'Auto' }, { value: 'saver', label: 'Battery saver' }, { value: 'performance', label: 'Performance' }], S('powerMode'), set('powerMode'), { small: true })),
          row('Warn before big jobs', 'On phones (or low battery): a heads-up before very large or 4K jobs', toggle(S('bigJobWarning'), set('bigJobWarning'))),
          row('Keep screen awake', 'While a job is running', toggle(S('wakeLock'), set('wakeLock'))),
          row('Warn before leaving', 'If you close the app while a job is running', toggle(S('warnOnLeave'), set('warnOnLeave'))),
        ]),
        section('smart', 'Smart features', 'star', [
          row('Show recommendations', 'Highlight the best preset for your file', toggle(S('showRecommendations'), set('showRecommendations'))),
          row('Paste to add files', 'Ctrl/⌘+V adds copied files on screens with a drop area', toggle(S('globalPaste'), set('globalPaste'))),
          row('Detect pasted links', 'Pasting a video link on Home or in the Downloader starts a download', toggle(S('detectLinks'), set('detectLinks'))),
          row('Completion sound', null, toggle(S('sound'), set('sound'))),
          row('Vibration', 'On phones that support it', toggle(S('haptics'), set('haptics'))),
          row('Notify when done', 'If Morph is in the background', notifyToggle),
        ]),
        section('offline', 'Offline & storage', 'wifiOff', [
          row('Universal engine for offline use', 'Needed offline only for rare formats (AVI, WMV, GIF, speed changes)', h('div.inline', ffStatus, ffBtn)),
          row('Download it automatically', 'Fetch the universal engine in the background on Wi-Fi', toggle(S('autoOfflinePack'), set('autoOfflinePack'))),
          row('Storage', null, h('div.inline', storage, persistBtn)),
          row('Clear temporary files', 'Removes leftovers of large jobs from the app\'s private storage', h('button.btn.ghost.sm', { onclick: async () => { await clearTemp(); toast('Temporary files cleared', 'success'); refreshOffline(); } }, icon('trash', 16), 'Clear')),
          app.installAvailable?.() ? row('Install Morph', 'Get an app icon and a full-screen window', h('button.btn.primary.sm', { onclick: () => app.install() }, 'Install')) : null,
          h('div.set-row.col', h('div.sr-text', h('strong', 'This device'), h('small', 'What your browser supports')), caps),
        ]),
        section('download', 'Downloader', 'download', [
          row('Backend', 'Companion server (bundled with Morph) or a cobalt instance', segmented([{ value: 'companion', label: 'Morph server' }, { value: 'cobalt', label: 'Cobalt' }], S('dlBackend'), (v) => { settings.set('dlBackend', v); renderDl(); }, { small: true })),
          dlBackendRows,
        ]),
        section('privacy', 'Privacy', 'lock', [
          row('Remember recent activity', 'Stores only file names & sizes on this device', toggle(S('history'), set('history'))),
          row('Clear activity', null, h('button.btn.ghost.sm', { onclick: () => { history.clear(); toast('Activity cleared', 'success'); } }, 'Clear')),
          h('div.set-row', h('span.sr-ic', icon('lock', 18)), h('div.sr-text', h('strong', 'Your files stay on your device'), h('small', 'Converting, compressing, editing and PDF tools never upload anything. Only the link downloader talks to a server.'))),
        ]),
        section('about', 'About', 'info', [
          row('Morph', 'Version 1.0 · Built with Mediabunny, ffmpeg.wasm, pdf.js and pdf-lib', null),
          row('Keyboard shortcuts', 'Ctrl/⌘+V paste files · Space play/pause · I / O set trim · ←/→ step frame', null),
          row('Reset all settings', null, h('button.btn.danger.sm', { onclick: async () => { if (await confirmDialog('Reset settings?', 'All settings go back to their defaults.', 'Reset', true)) { settings.reset(); app.go('settings'); toast('Settings reset'); } } }, 'Reset')),
        ]))));
  refreshOffline();
  return { el };
}
