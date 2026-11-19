# Morph

Convert, compress and edit videos, photos, audio and PDFs on your own device. It works offline on phones and PCs, and nothing is uploaded.

## Run it

```bash
cd morph
npm install
npm run serve      # builds, then serves the app + downloader at http://localhost:8787
```

The server also prints a LAN address, such as `http://192.168.1.20:8787`. Open it on your phone (same Wi-Fi), then use **Add to Home screen** or **Install app**. After the first visit everything except the downloader works with no internet.

For development use `npm run dev`. To host it as a static site, `npm run build` and put `dist/` on any HTTPS host. All the offline tools work there; only the downloader needs the companion server.

## What's inside

| Area | Features |
|---|---|
| Convert | Video → MP4/WebM/MOV/MKV/AVI/GIF/MP3/M4A/WAV/OGG/FLAC · Photos (incl. HEIC) → JPG/PNG/WebP/AVIF/BMP/ICO/GIF/PDF · Audio → MP3/M4A/WAV/OGG/FLAC/AAC · PDF → JPG/PNG/WebP/TXT · Text → PDF |
| Compress | Recommended / High / Small / Tiny / **Target size** (Discord, WhatsApp, Email…) / Custom (quality %, resolution, fps, H.264/H.265/AV1/VP9, audio). Shows the estimated size before you start. |
| Video editor | Trim (timeline with filmstrip), crop (aspect presets), rotate, mirror, resize, speed, mute, audio only, save frame, export |
| PDF tools | Merge, split, organize, remove, extract, rotate, compress, repair, PDF↔images, PDF→text, text→PDF, sign, add text, page numbers, watermark, crop, protect (AES-256), unlock |
| Downloader | YouTube, X, Instagram, TikTok and 1000+ sites through the companion server (yt-dlp) or a cobalt instance. **Online only.** |

## Design decisions

- **Engines:** Mediabunny (WebCodecs, GPU-accelerated) for video and audio. ffmpeg.wasm is the fallback for rare formats. pdf.js and pdf-lib handle PDFs. Everything is bundled locally with no CDN.
- **Huge files:** input is read in slices. Output streams to disk: either the browser's private storage, or straight to a file or folder you pick ("Ask every time" on desktop Chrome/Edge). On desktop, a 50–100 GB video is limited only by free disk space. Phones are limited by their own storage and memory.
- **Phones:** Auto power mode turns on Battery saver on phones: one file at a time, hardware encoding, calmer animations while working. Very large or 4K jobs, or running on low battery, show a warning with tips first. The screen is kept awake during jobs.
- **Install size:** about 9 MB of app, plus a 32 MB universal engine that downloads in the background. There is no 100–250 MB installer, because the browser already provides the video codecs.
- **Not included:** Word, Excel and PowerPoint ↔ PDF. Doing these accurately offline needs a full office suite (hundreds of MB).
- **Downloader caveats:** sites change often, so update yt-dlp now and then (delete `server/bin/` to fetch the latest). App stores ban YouTube downloaders, which is one more reason Morph ships as an installable web app.
