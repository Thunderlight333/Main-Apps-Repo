# Morph

Convert, compress and edit videos, photos, audio and PDFs on your own device. It works offline on phones and PCs, and nothing is uploaded.

## Run it (the companion server, for the downloader and share links)

1. **Download Morph:** on https://github.com/Thunderlight333/Main-Apps-Repo click the green **Code** button → **Download ZIP**, then unzip it (Windows: right-click → **Extract All**). Inside is a folder named `morph` (it contains `package.json`, `server` and `src`), e.g. `Downloads\Main-Apps-Repo-main\morph`. That is the Morph folder; you can move it anywhere.
2. **Install Node.js** (LTS) from https://nodejs.org. Optional but recommended: ffmpeg (`winget install ffmpeg` on Windows, `brew install ffmpeg` on Mac).
3. **Open a terminal in the `morph` folder:** Windows: open it in File Explorer, click the address bar, type `cmd`, press Enter. Mac: right-click the folder → **New Terminal at Folder**.
4. Run:

```bash
npm install        # first time only
npm run serve      # builds, then serves the app + downloader + share links at http://localhost:8787
```

Leave that window open; Ctrl+C or closing it stops the server. Next time, just open the terminal in the folder and run `npm run serve`.

The server also prints a LAN address, such as `http://192.168.1.20:8787`. Open it on your phone (same Wi-Fi), then use **Add to Home screen** or **Install app**. After the first visit everything except the downloader works with no internet.

For development use `npm run dev`. To host it as a static site, `npm run build` and put `dist/` on any HTTPS host. All the offline tools work there; only the downloader needs the companion server.

## What's inside

| Area | Features |
|---|---|
| Convert | Video → MP4/WebM/MOV/MKV/AVI/GIF/MP3/M4A/WAV/OGG/FLAC · Photos (incl. HEIC) → JPG/PNG/WebP/AVIF/BMP/ICO/GIF/PDF · Audio → MP3/M4A/WAV/OGG/FLAC/AAC · PDF → JPG/PNG/WebP/TXT · Text → PDF |
| Compress | Recommended / High / Small / Tiny / **Target size** (Discord, WhatsApp, Email…) / Custom (quality %, resolution, fps, H.264/H.265/AV1/VP9, audio). Shows the estimated size before you start. |
| Video editor | Trim (timeline with filmstrip), crop (aspect presets), rotate, mirror, resize, speed, save frame, export. **Sound:** remove sound, volume 0–200%, add background music or replace the sound, fade in/out, audio only |
| PDF tools | Merge, split, organize, remove, extract, rotate, compress, repair, PDF↔images, PDF→text, text→PDF, sign, add text, page numbers, watermark, crop, protect (AES-256), unlock |
| Downloader | YouTube, X, Instagram, TikTok and 1000+ sites through the companion server (yt-dlp) or a cobalt instance. Preview the video, trim it before downloading, and pick a format from a list with sizes. Share a link from another app to Morph to get a quick quality picker. **Online only.** |
| Share links | Gyazo-style: turn a video into a short link (`/v/aB3dE9xKpQ`) and QR code, served by the companion server. Opens on any device on the same Wi-Fi without internet. Expiry: 1 hour, 1 day, 7 days or never. |

## Design decisions

- **Engines:** Mediabunny (WebCodecs, GPU-accelerated) for video and audio. ffmpeg.wasm is the fallback for rare formats. pdf.js and pdf-lib handle PDFs. Everything is bundled locally with no CDN.
- **Huge files:** input is read in slices. Output streams to disk: either the browser's private storage, or straight to a file or folder you pick ("Ask every time" on desktop Chrome/Edge). On desktop, a 50–100 GB video is limited only by free disk space. Phones are limited by their own storage and memory.
- **Phones:** Auto power mode turns on Battery saver on phones: one file at a time, hardware encoding, calmer animations while working. Very large or 4K jobs, or running on low battery, show a warning with tips first. The screen is kept awake during jobs.
- **Install size:** about 9 MB of app, plus a 32 MB universal engine that downloads in the background. There is no 100–250 MB installer, because the browser already provides the video codecs.
- **Not included:** Word, Excel and PowerPoint ↔ PDF. Doing these accurately offline needs a full office suite (hundreds of MB).
- **Downloader caveats:** sites change often, so update yt-dlp now and then (delete `server/bin/` to fetch the latest). App stores ban YouTube downloaders, which is one more reason Morph ships as an installable web app.
