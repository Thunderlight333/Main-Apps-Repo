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

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../dist');
const BIN = path.join(here, 'bin');
const PORT = +process.env.PORT || 8787;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-dl-'));

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

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length' };
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

async function info(req, res, url) {
  const j = JSON.parse(await run(['-J', '--no-playlist', '--no-warnings', url]));
  const heights = [...new Set((j.formats || []).map((f) => f.height).filter(Boolean))].sort((a, b) => b - a);
  json(res, 200, { title: j.title, thumbnail: j.thumbnail, duration: j.duration, uploader: j.uploader || j.channel, heights, extractor: j.extractor_key });
}

async function download(req, res, url, mode, quality) {
  const q = parseInt(quality, 10) || 1080;
  const id = Math.random().toString(36).slice(2);
  const tpl = path.join(TMP, `${id}.%(ext)s`);
  const args = ['--no-playlist', '--no-warnings', '-o', tpl, '--print', 'after_move:filepath', '--print', 'before_dl:title'];
  if (mode === 'audio') {
    args.push('-f', 'ba/b');
    if (FFMPEG) args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else if (FFMPEG) {
    args.push('-f', `bv*[height<=${q}][vcodec^=avc]+ba[ext=m4a]/bv*[height<=${q}]+ba/b[height<=${q}]/bv*+ba/b`, '--merge-output-format', 'mp4');
  } else {
    args.push('-f', `b[height<=${q}][ext=mp4]/b[height<=${q}]/b`);
  }
  args.push(url);
  const out = (await run(args)).trim().split('\n');
  const file = out[out.length - 1];
  const title = (out[0] || 'video').replace(/[\\/:*?"<>|]+/g, '').slice(0, 120);
  const stat = fs.statSync(file);
  const ext = path.extname(file);
  res.writeHead(200, {
    ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="download${ext}"; filename*=UTF-8''${encodeURIComponent(title + ext)}`,
  });
  const s = fs.createReadStream(file);
  s.pipe(res);
  const cleanup = () => fs.rm(file, { force: true }, () => {});
  s.on('close', cleanup); res.on('close', cleanup);
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
    if (u.pathname === '/api/health') return json(res, 200, { ok: true, ytdlp: !!YTDLP, ffmpeg: FFMPEG });
    if (u.pathname === '/api/info' || u.pathname === '/api/download') {
      const url = u.searchParams.get('url');
      if (!validUrl(url)) return json(res, 400, { error: 'Invalid link' });
      await ensureYtDlp();
      if (u.pathname === '/api/info') return await info(req, res, url);
      return await download(req, res, url, u.searchParams.get('mode'), u.searchParams.get('quality'));
    }
    serveStatic(req, res, u.pathname);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end();
  }
}).listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  console.log(`Morph running:  http://localhost:${PORT}`);
  if (lan) console.log(`On your phone:  http://${lan.address}:${PORT}  (same Wi-Fi)`);
  console.log(`ffmpeg: ${FFMPEG ? 'found' : 'not found (install it for best quality + MP3)'}`);
});
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
process.on('SIGINT', () => process.exit());
