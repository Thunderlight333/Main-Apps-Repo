import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  // AI runtime: use the build that loads its WebAssembly from /ort (cached for offline), not a second bundled copy.
  resolve: { alias: { 'onnxruntime-web/wasm': fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url)) } },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'onnxruntime-web'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { host: true },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: {
        // Everything the app needs is precached, so it works fully offline after the first visit.
        // The 32 MB ffmpeg core (only used for rare formats) is cached on first use / via Settings.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest,woff2}'],
        globIgnores: ['ffmpeg/**', 'ocr/**', 'ort/**', 'models/**'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
      manifest: {
        name: 'Morph: Convert, Compress, Edit',
        short_name: 'Morph',
        description: 'Convert, compress and edit videos, photos, audio and PDFs. Works offline.',
        theme_color: '#0d0f14',
        background_color: '#0d0f14',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        // Phones: "Share" any file to Morph from the gallery / file manager.
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'files', accept: ['*/*'] }] },
        },
        // Desktop: "Open with Morph" from the file explorer.
        file_handlers: [{
          action: './',
          accept: {
            'video/*': ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'],
            'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.avif', '.gif', '.bmp'],
            'audio/*': ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac'],
            'application/pdf': ['.pdf'],
          },
        }],
        launch_handler: { client_mode: 'focus-existing' },
      },
    }),
  ],
});
