import { h, fmtBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { dropZone } from '../core/components.js';
import { history } from '../core/history.js';
import { app } from '../app.js';
import { KIND_ICON } from '../core/files.js';

const TOOLS = [
  { route: 'convert', icon: 'convert', title: 'Convert', desc: 'Any photo, video, audio or PDF to the format you need', tone: 'a' },
  { route: 'compress', icon: 'compress', title: 'Compress', desc: 'Smart presets to shrink videos and photos', tone: 'b' },
  { route: 'edit', icon: 'scissors', title: 'Video editor', desc: 'Trim, crop, rotate, speed, mute, export', tone: 'c' },
  { route: 'pdf', icon: 'pdf', title: 'PDF tools', desc: 'Merge, split, compress, sign, protect & more', tone: 'd' },
  { route: 'download', icon: 'download', title: 'Downloader', desc: 'Save videos from YouTube, X, TikTok, Instagram…', tone: 'e', online: true },
];
const QUICK = [
  ['convert', 'Video → MP4'], ['convert', 'Video → MP3'], ['convert', 'HEIC → JPG'], ['convert', 'PNG → WebP'],
  ['pdf/merge', 'Merge PDF'], ['pdf/img2pdf', 'JPG → PDF'], ['pdf/pdf2img', 'PDF → JPG'], ['pdf/sign', 'Sign PDF'], ['convert', 'Video → GIF'],
];

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`;
}

export default function home() {
  const hr = new Date().getHours();
  const greet = hr < 5 ? 'Up late?' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const st = history.stats();
  const recent = history.list().slice(0, 6);

  const el = h('div.home',
    h('section.hero',
      h('div.hero-text',
        h('span.eyebrow', icon('lock', 14), 'Private · Offline · No size limits'),
        h('h1', greet, h('br'), h('span.grad', 'What are we making today?')),
        h('p.muted', 'Drop anything: videos, photos, audio, PDFs or whole folders. Everything is processed on your device.')),
      h('div.hero-drop', dropZone({ title: 'Drop anything here', kinds: ['MP4', 'MOV', 'HEIC', 'JPG', 'PNG', 'PDF', 'MP3', '+40 more'], onFiles: (f) => app.openActions(f) }))),
    h('section',
      h('div.sec-head', h('h2', 'Tools')),
      h('div.tool-grid', TOOLS.map((t, i) => h('a.tool-card', { href: '#/' + t.route, class: 'tone-' + t.tone, style: { '--i': i } },
        h('span.tc-ic', icon(t.icon, 24)), h('strong', t.title, t.online ? h('span.online-tag.xs', 'Online') : null), h('small', t.desc), h('span.tc-go', icon('chevron', 18)))))),
    h('section',
      h('div.sec-head', h('h2', 'Popular')),
      h('div.chips-row', QUICK.map(([r, l]) => h('a.chip', { href: '#/' + r }, l)))),
    h('section.split',
      h('div.card.stats',
        h('h3', 'Your stats'),
        h('div.stat-row',
          h('div.stat', h('strong', String(st.jobs)), h('small', 'files processed')),
          h('div.stat', h('strong', fmtBytes(st.saved)), h('small', 'space saved')))),
      h('div.card.recent',
        h('div.sec-head', h('h3', 'Recent activity'), recent.length ? h('button.link-btn', { onclick: () => { history.clear(); app.go('home'); } }, 'Clear') : null),
        recent.length ? h('ul.recent-list', recent.map((r) => h('li',
          h('span.r-ic', icon(KIND_ICON[r.kind] || 'file', 16)),
          h('span.r-name', r.name), h('span.r-tool', r.tool),
          h('span.r-meta', r.outSize < r.inSize ? `−${Math.round((1 - r.outSize / r.inSize) * 100)}%` : fmtBytes(r.outSize)),
          h('span.r-time', ago(r.at)))))
          : h('p.muted.small', 'Nothing yet. Your finished jobs will show up here (names only, never the files).'))));
  return { el };
}
