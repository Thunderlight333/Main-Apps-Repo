// Share links: turn a video (or any file) into a short link, Gyazo-style.
import { h, fmtBytes } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, dropZone, friendly } from '../core/components.js';
import { segmented, field, toast, progressBar, modal, busy, feedback } from '../core/ui.js';
import { kindOf } from '../core/files.js';
import { shareStatus, upload, myLinks, removeLink, linkStats, qrSvg, updateLink, publicBase } from '../engines/share.js';
import { videoThumb } from '../engines/thumbs.js';
import { thumbOf } from '../engines/image.js';
import { app } from '../app.js';

const TTL = [{ value: 1, label: '1 hour' }, { value: 24, label: '1 day' }, { value: 168, label: '7 days' }, { value: 0, label: 'Never' }];
const PREF = 'morph.links.ttl';

export default function linksView({ files } = {}) {
  let health = null, ok = false;
  let ttl = 168;
  try { const v = localStorage.getItem(PREF); if (v !== null) ttl = +v; } catch { /* */ }
  const status = h('div.server-status');
  const uploads = h('div.link-list');
  const list = h('div.link-list');
  const empty = h('div.empty', h('div.empty-ic', icon('link', 26)), h('strong', 'No links yet'), h('p.muted', 'Add a video above. You get a short link and a QR code to open it on any phone or computer on your Wi-Fi.'));

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch { const r = document.createRange(); const n = btn.closest('.link-card')?.querySelector('.lc-url'); if (n) { r.selectNodeContents(n); getSelection().removeAllRanges(); getSelection().addRange(r); } toast('Press Ctrl/⌘+C to copy'); return; }
    toast('Link copied', 'success');
  }
  async function showQr(l) {
    const svg = await qrSvg(l.page);
    modal({ title: 'Scan to open', body: h('div.qr-box', h('div.qr', svg), h('code.qr-url', l.page), h('p.muted.small', 'Works on any phone on the same Wi-Fi as the computer running Morph. No internet needed.')) });
  }

  function card(l) {
    const meta = h('span.lc-meta', [fmtBytes(l.size), l.expires ? `expires ${relTime(l.expires)}` : 'kept until deleted'].join(' · '));
    const thumb = h('div.lc-thumb', l.thumb ? h('img', { src: l.thumb, alt: '' }) : icon(l.type?.startsWith('image') ? 'image' : l.type?.startsWith('audio') ? 'audio' : 'video', 22));
    const el = h('div.link-card',
      thumb,
      h('div.lc-body',
        h('strong.lc-name', { title: l.name }, l.name),
        h('a.lc-url', { href: l.page, target: '_blank', rel: 'noopener' }, l.page.replace(/^https?:\/\//, '')),
        meta),
      h('div.lc-actions',
        h('button.btn.primary.sm', { onclick: (e) => copy(l.page, e.currentTarget) }, icon('link', 15), 'Copy link'),
        navigator.share ? h('button.icon-btn.sm', { 'aria-label': 'Share link', title: 'Share', onclick: () => navigator.share({ title: l.name, url: l.page }).catch(() => {}) }, icon('sparkle', 16)) : null,
        h('button.icon-btn.sm', { 'aria-label': 'Show QR code', title: 'QR code', onclick: () => showQr(l) }, icon('grid', 16)),
        h('button.icon-btn.sm', { 'aria-label': 'Copy direct file link', title: 'Copy direct file link (for embedding)', onclick: (e) => copy(l.file, e.currentTarget) }, icon('file', 16)),
        h('button.icon-btn.sm', { 'aria-label': 'Delete link', title: 'Delete', onclick: async () => { await removeLink(l); el.classList.add('leaving'); setTimeout(() => { el.remove(); paintEmpty(); }, 180); } }, icon('trash', 16))));
    linkStats(l).then((s) => {
      if (s === null) { el.classList.add('gone'); meta.textContent = 'Expired or deleted on the server'; }
      else if (s) meta.textContent = [fmtBytes(l.size), `${s.views || 0} view${s.views === 1 ? '' : 's'}`, l.expires ? `expires ${relTime(l.expires)}` : 'kept until deleted'].join(' · ');
    });
    return el;
  }
  function renderList() {
    list.replaceChildren(...myLinks().map(card));
    paintEmpty();
  }
  function paintEmpty() { empty.hidden = list.children.length > 0 || uploads.children.length > 0; }

  async function add(newFiles) {
    if (!ok) { toast('Start the Morph server first (see below)', 'error'); return; }
    for (const f of newFiles) uploadOne(f);
  }
  function uploadOne(f) {
    const ac = new AbortController();
    const pb = progressBar();
    const row = h('div.link-card.uploading',
      h('div.lc-thumb', icon(kindOf(f) === 'image' ? 'image' : 'video', 22)),
      h('div.lc-body', h('strong.lc-name', f.name), h('span.lc-meta', `Uploading · ${fmtBytes(f.size)}`), pb),
      h('div.lc-actions', h('button.icon-btn.sm', { 'aria-label': 'Cancel', onclick: () => ac.abort() }, icon('x', 16))));
    uploads.prepend(row); paintEmpty();
    busy(true);
    const thumbP = kindOf(f) === 'video' ? videoThumb(f, 0.1, 200) : kindOf(f) === 'image' ? thumbOf(f, 200).then(toDataUrl) : Promise.resolve(null);
    upload(f, { ttl, health, signal: ac.signal, onProgress: (p) => pb.set(p) })
      .then(async (l) => {
        const thumb = await thumbP.catch(() => null);
        if (thumb) { updateLink(l.id, { thumb }); l.thumb = thumb; }
        row.remove();
        try { await navigator.clipboard.writeText(l.page); toast('Link ready and copied', 'success'); } catch { toast('Link ready', 'success'); }
        feedback('done');
        renderList();
      })
      .catch((e) => { if (e.cancelled) row.remove(); else { row.querySelector('.lc-meta').textContent = friendly(e); row.querySelector('.lc-meta').className = 'q-err'; pb.hidden = true; feedback('error'); } paintEmpty(); })
      .finally(() => busy(false));
  }

  async function refresh() {
    status.replaceChildren(h('span.spinner.sm'), 'Checking the Morph server…');
    const s = await shareStatus();
    health = s.health; ok = s.ok;
    drop.classList.toggle('disabled', !ok);
    if (ok) {
      const base = publicBase(health);
      const local = /localhost|127\.0\.0\.1/.test(base);
      status.replaceChildren(h('span.dot.ok'), h('span', 'Links will look like ', h('code', `${base.replace(/^https?:\/\//, '')}/v/aB3dE9xKpQ`)),
        h('span.muted', local ? ' (this computer only)' : ' · opens on any device on this Wi-Fi'));
    } else {
      status.replaceChildren(h('span.dot.off'), h('span', 'Share links need the Morph server running on a computer. '), h('button.link-btn', { onclick: help }, 'How to start it'));
    }
  }
  function help() {
    modal({
      title: 'How share links work', wide: true,
      body: h('div.prose',
        h('p', 'Like Gyazo, Morph turns a video into a short link. Instead of a company server, the file is kept by the Morph server on your own computer, so nothing is uploaded to the internet.'),
        h('ol', h('li', 'On your computer, in the Morph folder, run ', h('code', 'npm run serve'), '.'), h('li', 'Open Morph from the address it prints, or set it in Settings → Downloader → Server address.'), h('li', 'Add a video here. You get a link like ', h('code', 'http://192.168.1.20:8787/v/aB3dE9xKpQ'), ' and a QR code.')),
        h('p', 'Anyone on the same Wi-Fi can open the link: it plays in the browser, with a Download button. No internet or account needed.'),
        h('p.muted', 'To share outside your Wi-Fi, the computer must be reachable from the internet (for example with a tunnel such as Cloudflare Tunnel). Links stop working while the computer is off.')),
      actions: [{ label: 'Got it', primary: true }],
    });
  }

  const ttlSeg = segmented(TTL, ttl, (v) => { ttl = v; try { localStorage.setItem(PREF, String(v)); } catch { /* */ } }, { small: true });
  const drop = dropZone({ title: 'Drop a video to get a link', hint: 'or tap to choose · photos and other files work too', kinds: ['MP4', 'MOV', 'WebM', 'GIF', 'JPG', 'PNG'], onFiles: add });
  const el = h('div.tool.links',
    pageHeader('Share links', 'Turn a video into a short link and QR code, like Gyazo. Works on your Wi-Fi without internet.', 'link',
      h('button.btn.ghost.sm', { onclick: help }, icon('info', 16), 'How it works')),
    h('div.links-top', drop, h('div.card.links-opts', field('Link expires after', ttlSeg), status)),
    h('div.sec-head', h('h2', 'Your links')), uploads, list, empty);
  renderList();
  refresh();
  if (files?.length) setTimeout(() => (ok ? add(files) : refresh().then(() => ok && add(files))), 0);
  return { el, accept: (f) => { add(f); } };
}

function relTime(ts) {
  const d = ts - Date.now();
  if (d <= 0) return 'now';
  const hrs = d / 3600e3;
  return hrs < 1 ? `in ${Math.max(1, Math.round(d / 60e3))} min` : hrs < 48 ? `in ${Math.round(hrs)} h` : `in ${Math.round(hrs / 24)} days`;
}
async function toDataUrl(objUrl) {
  if (!objUrl) return null;
  const b = await (await fetch(objUrl)).blob();
  URL.revokeObjectURL(objUrl);
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
}
