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
- **Design:** professional, modern, eye-catching. Dark and light themes plus an accent color (default indigo). Calm neutrals, solid accents (no gradients or glows), Inter bundled locally via `@fontsource-variable/inter`. Mobile has a bottom tab bar; desktop has a sidebar, and the tool action bar docks at the bottom of the options panel (`dockBar`).
- **File order matters:** every multi-file list can be reordered (drag handle with mouse/touch, arrow keys, Name/Date/Reverse sorts) via `core/sortable.js`. Outputs follow that order: Convert photos → one PDF, Merge, Images to PDF, Organize pages, and "Number names" (01-, 02-…) for folders/ZIPs.
- **Phones:** Battery saver (auto on phones). A warning before big/4K jobs or on low battery (`core/power.js`).
- Word/Excel/PowerPoint ↔ PDF are intentionally NOT included. The PDF screen says so.
- Gemini's suggestion of Flutter/Tauri was considered; we kept the PWA (one codebase, no app-store ban). Tauri could wrap it later.

## Navigation, multitasking, Back button (app.js, core/tasks.js)
- **Screens stay alive:** Convert, Compress, Editor, PDF, Downloader and Links are kept (hidden) when you switch screens, so their jobs keep running. Home and Settings are rebuilt each visit. Views can expose `hide()` (pause media) and `busy`. Files sent to an idle tool start it fresh; a busy tool gets them added. The PDF view keeps each busy tool controller alive (`ctls` map) and tidies idle ones.
- **Tasks:** every job calls `tasks.start({ title, route, iconName, cancel })` and reports `progress/status/done/fail/cancelled` (this replaces direct `busy()` calls: tasks.js calls busy itself). Shown as a pill with a progress ring in the top bar, a thin line at the very top, and a Tasks sheet (Open / Cancel / Clear finished). A job finishing on another screen shows a toast with an Open button.
- **ffmpeg.wasm** has one instance, so `runFFmpeg` queues jobs ("Waiting for the universal engine…").
- **Back button:** switching screens uses `history.replaceState` (in-app `#/` links are intercepted), so history never piles up. After the first touch the app keeps a guard entry: Back closes a dialog, then goes up (PDF tool → PDF tools → Home), then on Home shows "Press back again to exit" (or a warning with a Stay button when tasks are running); a second Back leaves. Browsers only honour this after the user has touched the page.

## Updates
- `src/main.js` checks for a new service worker on resume and every 30 min, then reloads (after running tasks finish). If a lazily loaded screen file fails while online (an old open copy after an update), `app.js` reloads once into the new version. When publishing, keep the previous `assets/` files on `morph-app` so old open copies can still load them.

## Engines
- `engines/media.js`: Mediabunny (WebCodecs). Handles probe, transcode (crop/rotate/flip/trim/resize/bitrate), and filmstrip. It registers the mp3/aac/flac encoder extensions when the browser lacks them.
- `engines/ffmpeg.js`: ffmpeg.wasm fallback (AVI, GIF, speed changes, unknown formats). The core is copied to `public/ffmpeg/` by `scripts/copy-assets.mjs` and cached at runtime.
- `engines/process.js`: tries Mediabunny first, then falls back to ffmpeg.
- `engines/image.js`: canvas encode (jpg/png/webp/avif), custom BMP/ICO encoders, HEIC through `heic-to`, and target-size search.
- `engines/pdf.js`: `@cantoo/pdf-lib` (edit/encrypt) plus `pdfjs-dist` v6 (render/text). In v6, close documents with `closeView(doc)` (`doc.loadingTask.destroy()`); `doc.destroy` does not exist.
- `engines/downloader.js` plus `server/server.js`: a zero-dependency Node companion server that runs yt-dlp (auto-downloaded) and serves `dist/`. Cobalt is also supported.
  - `/api/info` returns `options` (SnapTube-style formats with sizes), `/api/preview` a ≤480p copy with range support, `/api/download?option=…&start=&end=` trims on the server (yt-dlp `--download-sections`, needs ffmpeg). Response header `X-Morph-Trimmed: 0` means the app must trim locally (done in `views/downloader.js`).
  - A link shared from another app arrives via the share target as `?shared=1&text=…` and opens the quick format sheet (`acceptText(u, { sheet: true })`).
- `engines/share.js` plus `views/links.js`: Gyazo-style share links. `POST /api/share` stores files in `server/shared/` (gitignored), `/v/<id>` is a server-rendered viewing page, `/v/<id>.<ext>` the file (ranges). Delete needs the per-link key kept in the app's localStorage. The service worker must not serve the app shell for `/v/` or `/api/`.
- Editor sound: volume, fades and music (`opts.audio.music`) go through ffmpeg (`argsFromOpts`, extra input mounted by `runFFmpeg`). Video is stream-copied when nothing visual changed.

## Commands
- `npm install`, then `npm run build` and `npm run serve` (port 8787), or `npm run dev`.
- Tests were done with Playwright scripts (not in the repo): convert, compress, editor, all PDF tools, offline reload, and a mobile Pixel 7 layout. All passed.
