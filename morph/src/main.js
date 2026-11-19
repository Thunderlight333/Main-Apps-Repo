import '@fontsource-variable/inter/wght.css';
import './styles/app.css';
import { start } from './app.js';
import { settings } from './core/settings.js';
import { clearTemp } from './core/save.js';

start();
clearTemp(); // leftovers from previous sessions in the private temp folder

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
      // Warm the ffmpeg core cache when idle so rare formats also work offline.
      if (settings.get('autoOfflinePack') && navigator.onLine) {
        const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 4000));
        idle(async () => {
          const { cacheFFmpeg, isFFmpegCached } = await import('./engines/ffmpeg.js');
          if (!(await isFFmpegCached()) && !navigator.connection?.saveData) cacheFFmpeg().catch(() => {});
        }, { timeout: 15000 });
      }
    } catch (e) { console.warn('SW registration failed', e); }
  });
}
