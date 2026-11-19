# Morph: project rules and architecture

Everything-app: convert, compress, video editor, PDF toolkit, link downloader. A PWA that works on phones and PCs.
Vite + vanilla JS ES modules, with no UI framework. Entry is `src/main.js`, the shell and router are in `src/app.js`, and screens are in `src/views/*.js`.

## User's product rules (must keep)
- **Offline-first is the top priority.** Everything except the downloader must work with no internet, after the first visit, through the service worker in `src/sw.js`. Never add CDN or remote dependencies; bundle everything locally.
- **Downloader is strictly online.** It disables itself with a banner when offline (`navigator.onLine`).
- **Huge files (50–100 GB+):** read input in slices (Mediabunny `BlobSource`, ffmpeg `WORKERFS`). Stream output to disk (OPFS or a File System Access handle) through `core/save.js`. Never load whole files into memory.
- **Settings must NOT contain format choices or compression values.** Those go on each tool screen after files are added. Settings are app preferences only (appearance, saving, processing, power, offline, downloader, privacy).
- **Animations:** small and modern, transform/opacity only, never running off screen (containers clip with `overflow: hidden`). Respect the Animations setting (full/reduced/off) and Battery saver. Keep the app optimized: lazy-load heavy engines and throttle progress repaints.
- **Copy/paste and drag-and-drop work anywhere** (global handlers in `app.js`), plus the share target (`sw.js`) and file handlers.
- **Design:** professional, modern, eye-catching. Dark and light themes plus an accent color. Mobile has a bottom tab bar; desktop has a sidebar.
- **Phones:** Battery saver (auto on phones). A warning before big/4K jobs or on low battery (`core/power.js`).
- Word/Excel/PowerPoint ↔ PDF are intentionally NOT included. The PDF screen says so.
- Gemini's suggestion of Flutter/Tauri was considered; we kept the PWA (one codebase, no app-store ban). Tauri could wrap it later.

## Engines
- `engines/media.js`: Mediabunny (WebCodecs). Handles probe, transcode (crop/rotate/flip/trim/resize/bitrate), and filmstrip. It registers the mp3/aac/flac encoder extensions when the browser lacks them.
- `engines/ffmpeg.js`: ffmpeg.wasm fallback (AVI, GIF, speed changes, unknown formats). The core is copied to `public/ffmpeg/` by `scripts/copy-assets.mjs` and cached at runtime.
- `engines/process.js`: tries Mediabunny first, then falls back to ffmpeg.
- `engines/image.js`: canvas encode (jpg/png/webp/avif), custom BMP/ICO encoders, HEIC through `heic-to`, and target-size search.
- `engines/pdf.js`: `@cantoo/pdf-lib` (edit/encrypt) plus `pdfjs-dist` v6 (render/text). In v6, close documents with `closeView(doc)` (`doc.loadingTask.destroy()`); `doc.destroy` does not exist.
- `engines/downloader.js` plus `server/server.js`: a zero-dependency Node companion server that runs yt-dlp (auto-downloaded) and serves `dist/`. Cobalt is also supported.

## Commands
- `npm install`, then `npm run build` and `npm run serve` (port 8787), or `npm run dev`.
- Tests were done with Playwright scripts (not in the repo): convert, compress, editor, all PDF tools, offline reload, and a mobile Pixel 7 layout. All passed.
