import { h, fmtBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { dropZone } from '../core/components.js';
import { history } from '../core/history.js';
import { app } from '../app.js';
import { KIND_ICON } from '../core/files.js';
import { recent } from '../core/recent.js';
import { download, shareResult } from '../core/save.js';
import { toast } from '../core/ui.js';
import { showLocalInfo } from '../core/components.js';

const TOOLS = [
  { route: 'ready', icon: 'target', title: 'Ready for…', desc: 'One tap for WhatsApp, Discord, Email, Instagram, TikTok', tone: 'b' },
  { route: 'convert', icon: 'convert', title: 'Convert', desc: 'Any photo, video, audio or PDF to the format you need', tone: 'a' },
  { route: 'compress', icon: 'compress', title: 'Compress', desc: 'Smart presets to shrink videos and photos', tone: 'b' },
  { route: 'edit', icon: 'scissors', title: 'Video editor', desc: 'Trim, crop, rotate, speed, mute, export', tone: 'c' },
  { route: 'photo', icon: 'image', title: 'Photo tools', desc: 'Resize, crop, watermark, blur faces, remove background', tone: 'f' },
  { route: 'pdf', icon: 'pdf', title: 'PDF tools', desc: 'Merge, split, compress, sign, scan, OCR & more', tone: 'd' },
  { route: 'recipes', icon: 'recipe', title: 'Recipes', desc: 'Several steps in one tap, saved for next time', tone: 'a' },
  { route: 'download', icon: 'download', title: 'Downloader', desc: 'Save videos from YouTube, X, TikTok, Instagram…', tone: 'e', online: true },
  { route: 'links', icon: 'link', title: 'Share links', desc: 'Turn a video into a short link and QR code', tone: 'f' },
];
const QUICK = [
  ['ready/discord', 'Discord (10 MB)'], ['ready/whatsapp', 'For WhatsApp'], ['ready/email', 'For Email'], ['ready/reels', 'Reels 9:16'],
  ['scan', 'Scan to PDF'], ['photo/removebg', 'Remove background'], ['photo/blur', 'Blur faces'], ['photo/clean', 'Remove location'],
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
  const urls = [];
  let paintRecent = () => {};
  const off = recent.on(() => paintRecent());

  const el = h('div.home',
    h('section.hero',
      h('div.hero-text',
        h('span.eyebrow', icon('lock', 14), 'Private · Offline · No size limits'),
        h('h1', greet, h('span.h1-sub', 'What are we making today?')),
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
      recentCard()));
  return { el, destroy: () => { off(); urls.forEach((u) => URL.revokeObjectURL(u)); } };

  // ---- Recent results: copies kept on this device, ready to share, save again, or use in another tool ----
  function recentCard() {
    const list = h('div.rr-list', h('p.muted.small', 'Loading…'));
    const clearBtn = h('button.link-btn', { hidden: true, onclick: async () => { await recent.clear(); history.clear(); toast('Recent results cleared', 'success'); } }, 'Clear');
    const card = h('div.card.recent',
      h('div.sec-head', h('h3', 'Recent results'), clearBtn),
      list);
    paintRecent = async () => {
      const items = (await recent.list()).slice(0, 8);
      urls.forEach((u) => URL.revokeObjectURL(u)); urls.length = 0;
      clearBtn.hidden = !items.length && !history.list().length;
      if (!items.length) {
        const old = history.list().slice(0, 5);
        list.replaceChildren(old.length
          ? h('ul.recent-list', old.map((r) => h('li',
            h('span.r-ic', icon(KIND_ICON[r.kind] || 'file', 16)), h('span.r-name', r.name), h('span.r-tool', r.tool),
            h('span.r-meta', r.outSize < r.inSize ? `−${Math.round((1 - r.outSize / r.inSize) * 100)}%` : fmtBytes(r.outSize)), h('span.r-time', ago(r.at)))))
          : h('p.muted.small', 'Nothing yet. Files you make show up here, so you can share them again or use them in another tool. They stay on this device.'));
        return;
      }
      list.replaceChildren(...items.map((r) => {
        const f = recent.file(r);
        let thumb = h('span.rr-ic', icon(KIND_ICON[r.kind] || 'file', 20));
        if (r.thumb) { const u = URL.createObjectURL(r.thumb); urls.push(u); thumb = h('img.rr-img', { src: u, alt: '', decoding: 'async' }); }
        const acts = f ? [
          h('button.icon-btn.sm', { 'aria-label': `Save ${r.name}`, title: 'Save', onclick: () => download({ name: r.name, blob: f, size: r.size }) }, icon('download', 16)),
          navigator.canShare ? h('button.icon-btn.sm', { 'aria-label': `Share ${r.name}`, title: 'Share', onclick: () => shareResult({ name: r.name, blob: f }) }, icon('send', 16)) : null,
          h('button.icon-btn.sm', { 'aria-label': `Use ${r.name} in another tool`, title: 'Use in another tool', onclick: () => app.openActions([f]) }, icon('sparkle', 16)),
        ] : [h('small.muted', 'Too big to keep')];
        return h('div.rr-item',
          h('div.rr-thumb', thumb),
          h('div.rr-body', h('strong.rr-name', { title: r.name }, r.name),
            h('small.rr-meta', `${fmtBytes(r.size)} · ${ago(r.at)}`, r.local ? h('button.rr-local', { type: 'button', title: 'Made on this device', 'aria-label': 'Made on this device: never uploaded', onclick: showLocalInfo }, icon('lock', 11)) : null)),
          h('div.rr-acts', ...acts.filter(Boolean)));
      }));
    };
    paintRecent();
    return card;
  }
}
