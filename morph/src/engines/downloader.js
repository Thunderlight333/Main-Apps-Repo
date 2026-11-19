// Link downloader client. Browsers cannot fetch YouTube/TikTok/Instagram media directly (CORS + signed URLs),
// so this talks to either the bundled Morph companion server (yt-dlp) or any cobalt-compatible instance.
import { settings } from '../core/settings.js';
import { openSink } from '../core/save.js';

const trimSlash = (s) => (s || '').replace(/\/+$/, '');
export function serverBase() {
  const s = trimSlash(settings.get('dlServer'));
  if (s) return s;
  // When the app itself is served by the companion server, use the same origin automatically.
  return location.protocol.startsWith('http') && !/github\.io|pages\.dev|netlify|vercel/.test(location.host) ? '' : null;
}

export function detectSite(url) {
  const map = [
    [/youtu\.?be/, 'YouTube'], [/(twitter|x)\.com/, 'X / Twitter'], [/instagram\.com/, 'Instagram'], [/tiktok\.com/, 'TikTok'],
    [/facebook\.com|fb\.watch/, 'Facebook'], [/reddit\.com|redd\.it/, 'Reddit'], [/vimeo\.com/, 'Vimeo'], [/twitch\.tv/, 'Twitch'],
    [/soundcloud\.com/, 'SoundCloud'], [/pinterest\./, 'Pinterest'], [/dailymotion/, 'Dailymotion'], [/bsky\.app/, 'Bluesky'], [/snapchat/, 'Snapchat'],
  ];
  for (const [re, n] of map) if (re.test(url)) return n;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Link'; }
}

export async function checkServer() {
  const base = serverBase();
  if (base === null) return { ok: false };
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { ok: false };
    return { ok: true, ...(await r.json()) };
  } catch { return { ok: false }; }
}

export async function getInfo(url) {
  if (settings.get('dlBackend') === 'cobalt') return { title: detectSite(url) + ' media', site: detectSite(url), cobalt: true };
  const base = serverBase();
  const r = await fetch(`${base}/api/info?url=${encodeURIComponent(url)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not read this link');
  return { ...j, site: detectSite(url) };
}

/** Downloads straight to disk (OPFS / chosen folder) while reporting progress. */
export async function downloadLink(url, { mode, quality, run, onProgress, onStatus, signal }) {
  let fileUrl, name;
  if (settings.get('dlBackend') === 'cobalt') {
    const base = trimSlash(settings.get('dlCobaltUrl'));
    if (!base) throw new Error('Set your cobalt instance URL in Settings → Downloader.');
    onStatus?.('Asking the server for the media…');
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (settings.get('dlCobaltKey')) headers.Authorization = `Api-Key ${settings.get('dlCobaltKey')}`;
    const r = await fetch(base + '/', { method: 'POST', headers, signal, body: JSON.stringify({ url, videoQuality: String(quality), downloadMode: mode === 'audio' ? 'audio' : 'auto', audioFormat: 'mp3', filenameStyle: 'pretty' }) });
    const j = await r.json().catch(() => ({}));
    if (j.status === 'error' || !r.ok) throw new Error(j.error?.code ? `Server error: ${j.error.code}` : 'Server rejected the request');
    if (j.status === 'picker') { fileUrl = j.picker[0].url; name = `${detectSite(url)}-${Date.now()}.${j.picker[0].type === 'photo' ? 'jpg' : 'mp4'}`; }
    else { fileUrl = j.url; name = j.filename || `download-${Date.now()}.mp4`; }
  } else {
    const base = serverBase();
    fileUrl = `${base}/api/download?url=${encodeURIComponent(url)}&mode=${mode}&quality=${quality}`;
  }
  onStatus?.(settings.get('dlBackend') === 'cobalt' ? 'Downloading…' : 'Server is fetching the video (this can take a moment)…');
  onProgress?.(-1);
  const res = await fetch(fileUrl, { signal });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Download failed (${res.status})`); }
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  if (m) name = decodeURIComponent(m[1]);
  name ||= `download-${Date.now()}.${mode === 'audio' ? 'mp3' : 'mp4'}`;
  const total = +res.headers.get('content-length') || 0;
  onStatus?.('Downloading…');
  const sink = await openSink(run, name);
  const reader = res.body.getReader();
  let got = 0; const parts = []; const writer = sink.writable?.getWriter();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (writer) await writer.write({ type: 'write', data: value, position: got - value.length }); else parts.push(value);
      onProgress?.(total ? got / total : -1, got);
    }
    if (writer) { await writer.close(); return await sink.finish(); }
    return await sink.finish(new Blob(parts, { type: res.headers.get('content-type') || 'application/octet-stream' }));
  } catch (e) { try { await writer?.abort(); } catch { /* */ } throw e; }
}
