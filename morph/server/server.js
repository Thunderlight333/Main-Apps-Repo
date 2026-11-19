#!/usr/bin/env node
// Morph companion server: serves the built app AND powers the link downloader with yt-dlp.
// Zero npm dependencies. Requires Node 18+. yt-dlp is auto-downloaded if missing; ffmpeg (optional)
// enables merging best video+audio and MP3 extraction.
//   node server/server.js            -> http://localhost:8787 (also reachable from phones on the same Wi-Fi)
//   PORT=9000 node server/server.js
import http from 'node:http';
import https from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../dist');
const BIN = path.join(here, 'bin');
const PORT = +process.env.PORT || 8787;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-dl-'));
const PREVIEW = path.join(TMP, 'preview'); fs.mkdirSync(PREVIEW, { recursive: true });
// Share links live next to the server so they survive restarts.
const SHARES = path.resolve(process.env.MORPH_SHARES || path.join(here, 'shared'));
fs.mkdirSync(SHARES, { recursive: true });
const lanAddrs = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);

const has = (cmd, arg = '--version') => spawnSync(cmd, [arg], { stdio: 'ignore' }).status === 0;
let YTDLP = process.env.YTDLP || (has('yt-dlp') ? 'yt-dlp' : null);
const FFMPEG = has('ffmpeg', '-version');

function fetchFile(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'morph-companion' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects) {
        res.resume(); return resolve(fetchFile(res.headers.location, dest, redirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const out = fs.createWriteStream(dest, { mode: 0o755 });
      res.pipe(out); out.on('finish', () => out.close(resolve)); out.on('error', reject);
    }).on('error', reject);
  });
}
async function ensureYtDlp() {
  if (YTDLP) return;
  const name = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: os.arch() === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux' }[process.platform] || 'yt-dlp';
  const dest = path.join(BIN, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(BIN, { recursive: true });
    console.log('Downloading yt-dlp…');
    await fetchFile(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${name}`, dest);
  }
  YTDLP = dest;
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, X-Morph-Trimmed' };
const json = (res, code, obj) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error((err.match(/ERROR: (.*)/) || [])[1] || 'yt-dlp failed'))));
  });
}
const validUrl = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };

const COMMON = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
async function info(req, res, url) {
  const j = JSON.parse(await run(['-J', '--no-playlist', '--no-warnings', url]));
  const fmts = (j.formats || []).filter((f) => f.protocol !== 'mhtml');
  const dur = j.duration || 0;
  const sizeOf = (f) => (f ? f.filesize || f.filesize_approx || (f.tbr && dur ? f.tbr * 125 * dur : 0) : 0);
  // Direct file links often carry no codec info: guess from the extension.
  const VEXT = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'flv', '3gp', 'avi'], AEXT = ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac'];
  const isV = (f) => (f.vcodec ? f.vcodec !== 'none' : VEXT.includes(f.ext));
  const isA = (f) => (f.acodec ? f.acodec !== 'none' : VEXT.includes(f.ext) || AEXT.includes(f.ext));
  const audioOnly = fmts.filter((f) => isA(f) && !isV(f)).sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  const bestA = audioOnly.find((f) => f.ext === 'm4a') || audioOnly[0];
  // Without ffmpeg, only files that already contain both picture and sound can be delivered.
  const usable = fmts.filter((f) => isV(f) && (FFMPEG || isA(f)));
  const heights = [...new Set(usable.map((f) => f.height).filter(Boolean))].sort((a, b) => b - a);
  const listed = heights.filter((h) => COMMON.includes(h)).length >= 2 ? heights.filter((h) => COMMON.includes(h)) : heights;
  const options = listed.map((h) => {
    const c = usable.filter((f) => f.height === h).sort((a, b) => (/^avc/.test(b.vcodec) - /^avc/.test(a.vcodec)) || (sizeOf(b) - sizeOf(a)));
    const v = c[0];
    return { id: `v${h}`, kind: 'video', label: h >= 2160 ? `${h === 2160 ? '4K' : h === 4320 ? '8K' : h + 'p'}` : `${h}p`, sub: h >= 1080 ? 'HD' : h <= 240 ? 'Low' : '', ext: 'mp4', size: Math.round(sizeOf(v) + (isA(v) ? 0 : sizeOf(bestA))) || null, height: h };
  });
  if (!options.length && fmts.some(isV)) options.push({ id: 'vbest', kind: 'video', label: 'Original quality', ext: j.ext || 'mp4', size: sizeOf(fmts[fmts.length - 1]) || null });
  if (audioOnly.length || fmts.some(isA)) {
    if (FFMPEG) for (const k of [320, 192, 128]) options.push({ id: `mp3-${k}`, kind: 'audio', label: `MP3 ${k}k`, ext: 'mp3', size: dur ? Math.round(k * 125 * dur) : null });
    if (bestA) options.push({ id: 'm4a', kind: 'audio', label: `${(bestA.ext === 'webm' ? 'opus' : bestA.ext).toUpperCase()} ${Math.round(bestA.abr || bestA.tbr || 128)}k`, sub: 'Original sound', ext: bestA.ext === 'webm' ? 'webm' : bestA.ext, size: Math.round(sizeOf(bestA)) || null });
  }
  json(res, 200, { title: j.title, thumbnail: j.thumbnail, duration: dur, uploader: j.uploader || j.channel, heights, extractor: j.extractor_key, options, ffmpeg: FFMPEG });
}

async function download(req, res, url, mode, quality, q2) {
  const opt = q2.get('option') || '';
  let q = parseInt(quality, 10) || 1080;
  const id = Math.random().toString(36).slice(2);
  const tpl = path.join(TMP, `${id}.%(ext)s`);
  const args = ['--no-playlist', '--no-warnings', '-o', tpl, '--print', 'after_move:filepath', '--print', 'before_dl:title'];
  // Trim on the server: only the chosen part is fetched (needs ffmpeg for exact cuts).
  const start = parseFloat(q2.get('start')), end = parseFloat(q2.get('end'));
  let trim = FFMPEG && isFinite(start) && isFinite(end) && end > start;
  const sectionArgs = trim ? ['--download-sections', `*${start.toFixed(2)}-${end.toFixed(2)}`, '--force-keyframes-at-cuts'] : [];
  if (/^v\d+$/.test(opt)) { q = +opt.slice(1); mode = 'video'; }
  if (opt === 'vbest') { mode = 'video'; q = 99999; }
  if (/^mp3-\d+$/.test(opt) || opt === 'm4a') mode = 'audio';
  if (mode === 'audio') {
    if (opt === 'm4a') args.push('-f', 'ba[ext=m4a]/ba/b', ...(FFMPEG ? ['-x'] : []));
    else {
      args.push('-f', 'ba/b');
      if (FFMPEG) args.push('-x', '--audio-format', 'mp3', '--audio-quality', /^mp3-\d+$/.test(opt) ? opt.slice(4) + 'K' : '0');
    }
  } else if (FFMPEG) {
    args.push('-f', `bv*[height<=${q}][vcodec^=avc]+ba[ext=m4a]/bv*[height<=${q}]+ba/b[height<=${q}]/bv*+ba/b`, '--merge-output-format', 'mp4');
  } else {
    args.push('-f', `b[height<=${q}][ext=mp4]/b[height<=${q}]/b`);
  }
  let out;
  try { out = (await run([...args, ...sectionArgs, url])).trim().split('\n'); }
  catch (e) {
    if (!trim) throw e;
    // Some hosts can't serve a section: fetch the whole video and let the app trim it.
    trim = false;
    out = (await run([...args, url])).trim().split('\n');
  }
  const file = out[out.length - 1];
  const title = (out[0] || 'video').replace(/[\\/:*?"<>|]+/g, '').slice(0, 120);
  const stat = fs.statSync(file);
  const ext = path.extname(file);
  res.writeHead(200, {
    ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'X-Morph-Trimmed': trim ? '1' : '0',
    'Content-Disposition': `attachment; filename="download${ext}"; filename*=UTF-8''${encodeURIComponent(title + ext)}`,
  });
  const s = fs.createReadStream(file);
  s.pipe(res);
  const cleanup = () => fs.rm(file, { force: true }, () => {});
  s.on('close', cleanup); res.on('close', cleanup);
}

/** Serve a file with HTTP range support, so videos can seek. */
function sendFile(req, res, file, type, extra = {}) {
  const size = fs.statSync(file).size;
  const base = { ...cors, 'Content-Type': type, 'Accept-Ranges': 'bytes', ...extra };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
    let end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { ...cors, 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---- Preview: a small (≤480p) copy of the video, cached for an hour, so the app can play it and pick a trim.
const previews = new Map(); // key -> Promise<file>
function previewFile(url) {
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  if (!previews.has(key)) {
    const p = (async () => {
      const tpl = path.join(PREVIEW, `${key}.%(ext)s`);
      const fmt = FFMPEG ? 'b[height<=480][ext=mp4]/bv*[height<=480][vcodec^=avc]+ba[ext=m4a]/b[height<=480]/bv*[height<=480]+ba/b' : 'b[height<=480][ext=mp4]/b[height<=480]/b';
      const out = (await run(['--no-playlist', '--no-warnings', '-f', fmt, ...(FFMPEG ? ['--merge-output-format', 'mp4'] : []), '-o', tpl, '--print', 'after_move:filepath', url])).trim().split('\n');
      return out[out.length - 1];
    })();
    p.catch(() => previews.delete(key));
    previews.set(key, p);
    setTimeout(() => { previews.delete(key); p.then((f) => fs.rm(f, { force: true }, () => {})).catch(() => {}); }, 60 * 60 * 1000).unref();
  }
  return previews.get(key);
}

// ---- Share links (Gyazo-style): /v/<id> is a viewing page, /v/<id>.<ext> the file itself.
const ID_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newId = () => Array.from(crypto.randomBytes(10), (b) => ID_CHARS[b % ID_CHARS.length]).join('');
const metaPath = (id) => path.join(SHARES, id + '.json');
function readMeta(id) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(id)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
    if (m.expires && Date.now() > m.expires) { removeShare(m); return null; }
    return m;
  } catch { return null; }
}
function removeShare(m) { fs.rm(path.join(SHARES, m.file), { force: true }, () => {}); fs.rm(metaPath(m.id), { force: true }, () => {}); }
function sweepShares() {
  for (const f of fs.readdirSync(SHARES)) if (f.endsWith('.json')) readMeta(f.slice(0, -5));
}
setInterval(sweepShares, 10 * 60 * 1000).unref();

function receiveShare(req, res, q) {
  const name = (decodeURIComponent(req.headers['x-name'] || 'video.mp4')).replace(/[\\/:*?"<>|\r\n]+/g, '').slice(0, 140) || 'video.mp4';
  const ext = (path.extname(name).slice(1) || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  const id = newId();
  const file = `${id}.${ext}`;
  const ttl = Math.max(0, parseFloat(q.get('ttl')) || 0); // hours, 0 = keep
  const tmp = path.join(SHARES, file + '.part');
  const out = fs.createWriteStream(tmp);
  let size = 0;
  req.on('data', (d) => (size += d.length));
  req.pipe(out);
  out.on('finish', () => {
    if (!size) { fs.rm(tmp, { force: true }, () => {}); return json(res, 400, { error: 'Empty file' }); }
    fs.renameSync(tmp, path.join(SHARES, file));
    const key = crypto.randomBytes(12).toString('hex');
    const meta = { id, file, name, ext, type: req.headers['content-type'] || 'application/octet-stream', size, created: Date.now(), expires: ttl ? Date.now() + ttl * 3600e3 : 0, key, views: 0 };
    fs.writeFileSync(metaPath(id), JSON.stringify(meta));
    json(res, 200, { id, page: `/v/${id}`, file: `/v/${file}`, key, size, expires: meta.expires, lan: lanAddrs() });
  });
  const fail = () => fs.rm(tmp, { force: true }, () => {});
  req.on('aborted', fail); out.on('error', (e) => { fail(); json(res, 500, { error: e.message }); });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
function sharePage(req, res, m) {
  m.views = (m.views || 0) + 1; fs.writeFile(metaPath(m.id), JSON.stringify(m), () => {});
  const isVideo = /^video\//.test(m.type) || ['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(m.ext);
  const isImage = /^image\//.test(m.type);
  const isAudio = /^audio\//.test(m.type);
  const src = `/v/${m.file}`;
  const media = isVideo ? `<video src="${src}" controls playsinline autoplay muted loop preload="metadata"></video>`
    : isImage ? `<img src="${src}" alt="${esc(m.name)}">` : isAudio ? `<audio src="${src}" controls></audio>` : `<div class="file">${esc(m.ext.toUpperCase())}</div>`;
  const exp = m.expires ? `Expires ${new Date(m.expires).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Kept until deleted';
  const host = req.headers.host || `localhost:${PORT}`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.name)} · Morph</title>
<meta property="og:title" content="${esc(m.name)}"><meta property="og:type" content="${isVideo ? 'video.other' : 'website'}">
${isVideo ? `<meta property="og:video" content="http://${esc(host)}${src}"><meta property="og:video:type" content="${esc(m.type)}">` : ''}${isImage ? `<meta property="og:image" content="http://${esc(host)}${src}">` : ''}
<style>
:root{color-scheme:dark;--bg:#0d0f14;--s:#15181f;--l:rgba(255,255,255,.08);--t:#e9ebf0;--t2:#a3a9b6;--a:#4f5bd5}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f6f7f9;--s:#fff;--l:rgba(16,24,40,.1);--t:#111827;--t2:#4b5565}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px max(16px,env(safe-area-inset-left)) 32px}
header{display:flex;align-items:center;gap:10px;padding:4px 0 14px;font-weight:700}
.logo{width:26px;height:26px;border-radius:7px;background:var(--a);display:grid;place-items:center;color:#fff;font-size:14px}
.stage{background:#000;border-radius:12px;overflow:hidden;display:grid;place-items:center;max-height:78vh}
video,img{display:block;max-width:100%;max-height:78vh;margin:auto}audio{width:100%;margin:24px}
.file{padding:80px;font-size:28px;font-weight:700;color:#fff}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:space-between;margin-top:14px;padding:14px 16px;background:var(--s);border:1px solid var(--l);border-radius:12px}
h1{font-size:1.05rem;margin:0;word-break:break-word}.meta{color:var(--t2);font-size:.88rem;margin-top:2px}
.act{display:flex;gap:8px;flex-wrap:wrap}a.b,button.b{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:9px;border:1px solid var(--l);background:var(--s);color:var(--t);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
a.b.p{background:var(--a);border-color:var(--a);color:#fff}
</style></head><body><main>
<header><span class="logo">M</span>Morph</header>
<div class="stage">${media}</div>
<div class="bar"><div><h1>${esc(m.name)}</h1><div class="meta">${fmtSize(m.size)} · Shared ${new Date(m.created).toLocaleDateString('en-GB', { dateStyle: 'medium' })} · ${exp}</div></div>
<div class="act"><button class="b" id="copy">Copy link</button><a class="b p" href="${src}" download="${esc(m.name)}">Download</a></div></div>
</main><script>
document.getElementById('copy').onclick=async function(){var b=this;try{await navigator.clipboard.writeText(location.href);b.textContent='Copied'}catch(e){prompt('Copy this link',location.href)}setTimeout(function(){b.textContent='Copy link'},1500)};
</script></body></html>`);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let p = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
  if (!p.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('Run "npm run build" first.'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  try {
    if (u.pathname === '/api/health') return json(res, 200, { ok: true, ytdlp: !!YTDLP, ffmpeg: FFMPEG, share: true, lan: lanAddrs() });
    if (u.pathname === '/api/share' && req.method === 'POST') return receiveShare(req, res, u.searchParams);
    let m;
    if ((m = u.pathname.match(/^\/api\/share\/([A-Za-z0-9]+)$/)) && req.method === 'DELETE') {
      const meta = readMeta(m[1]);
      if (!meta) return json(res, 404, { error: 'Link not found' });
      if (req.headers['x-morph-key'] !== meta.key) return json(res, 403, { error: 'Not your link' });
      removeShare(meta); return json(res, 200, { ok: true });
    }
    if ((m = u.pathname.match(/^\/api\/share\/([A-Za-z0-9]+)$/))) {
      const meta = readMeta(m[1]);
      return meta ? json(res, 200, { id: meta.id, name: meta.name, size: meta.size, views: meta.views, expires: meta.expires }) : json(res, 404, { error: 'Link not found' });
    }
    if ((m = u.pathname.match(/^\/v\/([A-Za-z0-9]+)(?:\.([a-z0-9]+))?$/))) {
      const meta = readMeta(m[1]);
      if (!meta) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Link not found</h1><p>It may have expired or been deleted.</p>'); }
      if (m[2]) return sendFile(req, res, path.join(SHARES, meta.file), meta.type, { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`, 'Cache-Control': 'public, max-age=3600' });
      return sharePage(req, res, meta);
    }
    if (u.pathname === '/api/preview') {
      const url = u.searchParams.get('url');
      if (!validUrl(url)) return json(res, 400, { error: 'Invalid link' });
      await ensureYtDlp();
      const file = await previewFile(url);
      return sendFile(req, res, file, 'video/mp4', { 'Cache-Control': 'no-store' });
    }
    if (u.pathname === '/api/info' || u.pathname === '/api/download') {
      const url = u.searchParams.get('url');
      if (!validUrl(url)) return json(res, 400, { error: 'Invalid link' });
      await ensureYtDlp();
      if (u.pathname === '/api/info') return await info(req, res, url);
      return await download(req, res, url, u.searchParams.get('mode'), u.searchParams.get('quality'), u.searchParams);
    }
    serveStatic(req, res, u.pathname);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end();
  }
}).listen(PORT, '0.0.0.0', () => {
  const lan = lanAddrs()[0];
  console.log(`Morph running:  http://localhost:${PORT}`);
  if (lan) console.log(`On your phone:  ${lan}  (same Wi-Fi)`);
  console.log(`Share links are stored in: ${SHARES}`);
  sweepShares();
  console.log(`ffmpeg: ${FFMPEG ? 'found' : 'not found (install it for best quality + MP3)'}`);
});
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
process.on('SIGINT', () => process.exit());
