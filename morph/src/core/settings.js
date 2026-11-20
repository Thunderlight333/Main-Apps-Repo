// Persistent user settings (localStorage). Conversion/compression values are NOT here on purpose:
// those are chosen on each tool screen after a file is added.
const KEY = 'morph.settings.v1';
export const DEFAULTS = {
  // Appearance
  theme: 'system',          // system | dark | light
  accent: 'indigo',         // indigo | violet | blue | teal | green | orange | pink
  motion: 'full',           // full | reduced | off
  density: 'comfortable',   // comfortable | compact
  fontScale: 'm',           // s | m | l
  // Files & output
  saveMethod: 'auto',       // auto | ask | download
  namePattern: 'suffix',    // suffix | original | custom
  customSuffix: '-morph',
  autoSave: false,          // save automatically when a job finishes
  zipMultiple: 'auto',      // auto | always | never
  clearAfterSave: false,
  // Processing
  hwAccel: 'no-preference', // no-preference | prefer-hardware | prefer-software
  parallelJobs: 1,
  keepMetadata: false,
  ffmpegFallback: true,
  wakeLock: true,
  powerMode: 'auto',        // auto | saver | performance
  bigJobWarning: true,
  warnOnLeave: true,
  // Smart features
  showRecommendations: true,
  globalPaste: true,
  detectLinks: true,
  haptics: true,
  sound: true,
  notify: false,
  // Offline
  autoOfflinePack: true,
  // Downloader
  dlBackend: 'companion',   // companion | cobalt
  dlServer: '',
  dlCobaltUrl: '',
  dlCobaltKey: '',
  dlQuality: '1080',
  dlMode: 'video',          // video | audio
  // History
  history: true,
  recentKeep: true,         // keep copies of recent results on this device
  recentSpace: 1024,        // MB for recent results
};

const listeners = new Set();
let state = { ...DEFAULTS };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* private mode */ }

export const settings = {
  get: (k) => state[k],
  all: () => ({ ...state }),
  set(k, v) {
    if (state[k] === v) return;
    state[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    listeners.forEach((fn) => fn(k, v));
  },
  reset() {
    state = { ...DEFAULTS };
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    listeners.forEach((fn) => fn('*'));
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

const ACCENTS = {
  indigo: ['#4f5bd5', '#6d78e6'], violet: ['#8b5cf6', '#c084fc'], blue: ['#3b82f6', '#60a5fa'], teal: ['#14b8a6', '#2dd4bf'],
  green: ['#22c55e', '#4ade80'], orange: ['#f97316', '#fb923c'], pink: ['#ec4899', '#f472b6'],
};
export const ACCENT_LIST = Object.keys(ACCENTS);
export const accentColor = (k) => ACCENTS[k][0];

export function applyAppearance() {
  const r = document.documentElement;
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = state.theme === 'system' ? (sysDark ? 'dark' : 'light') : state.theme;
  r.dataset.theme = theme;
  const [a, b] = ACCENTS[state.accent] || ACCENTS.indigo;
  r.style.setProperty('--accent', a);
  r.style.setProperty('--accent-2', b);
  const sysReduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  r.dataset.motion = state.motion === 'full' && sysReduce ? 'reduced' : state.motion;
  r.dataset.density = state.density;
  r.style.fontSize = { s: '14px', m: '15px', l: '17px' }[state.fontScale] || '15px';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#0d0f14' : '#f6f7f9');
}
