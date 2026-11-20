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
      let hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      // Keep the app up to date: look for a new version when it comes back to the screen and every 30 minutes.
      const check = () => navigator.onLine && reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      setInterval(check, 30 * 60e3);
      // A new version took over: switch to it now, or as soon as running tasks finish.
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', async () => {
        if (!hadController) { hadController = true; return; } // first install, not an update
        if (reloading) return;
        const { tasks } = await import('./core/tasks.js');
        const go = () => { if (reloading) return; reloading = true; location.reload(); };
        if (!tasks.running().length) { go(); return; }
        const { toast } = await import('./core/ui.js');
        toast('A new version of Morph is ready. It will load when your tasks finish.', 'info', 8000, { action: { label: 'Update now', onClick: go } });
        const off = tasks.on(() => { if (!tasks.running().length) { off(); go(); } });
      });
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
