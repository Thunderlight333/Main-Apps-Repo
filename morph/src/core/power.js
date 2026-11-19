// Phone-friendly power handling: battery saver + a heads-up before huge jobs.
// (Browsers expose no temperature API, so we limit load instead of reading heat.)
import { h, fmtBytes } from './dom.js';
import { icon } from './icons.js';
import { settings } from './settings.js';
import { modal } from './ui.js';

export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820);

let battery = null;
navigator.getBattery?.().then((b) => { battery = b; }).catch(() => {});
export const batteryInfo = () => battery && { level: battery.level, charging: battery.charging };

/** Battery saver is on when chosen, or automatically on phones in "Auto". */
export function saver() {
  const m = settings.get('powerMode');
  return m === 'saver' || (m === 'auto' && isMobile);
}
export const effectiveParallel = () => (saver() ? 1 : Math.max(1, Math.min(4, settings.get('parallelJobs') | 0)));
// Hardware encoders use far less energy than CPU encoding.
export const effectiveHw = () => { const v = settings.get('hwAccel'); return saver() && v === 'no-preference' ? 'prefer-hardware' : v; };

/**
 * Calls proceed() right away for normal jobs. For big jobs on phones (or low battery) it asks first.
 * proceed() runs inside the button click, so file pickers still work.
 */
export function guardBigJob({ bytes = 0, heavy = false } = {}, proceed) {
  const b = batteryInfo();
  const big = bytes > 1.5 * 1024 ** 3 || heavy;
  const lowBat = b && !b.charging && b.level < 0.25;
  if (!settings.get('bigJobWarning') || !(isMobile || lowBat) || (!big && !lowBat)) return proceed();
  let dont = false;
  const tips = [
    big ? `This is a big job (${fmtBytes(bytes)}${heavy ? ', 4K/long video' : ''}). Phones can get warm and slow down to protect themselves.` : null,
    lowBat ? `Battery is at ${Math.round(b.level * 100)}% and not charging.` : null,
  ].filter(Boolean);
  modal({
    title: 'Heads-up before you start',
    body: h('div.prose',
      tips.map((t) => h('p', t)),
      h('ul.tips',
        h('li', icon('bolt', 16), 'Plug in your charger for long jobs.'),
        h('li', icon('sparkle', 16), 'Keep Morph open: the screen stays awake while it works.'),
        h('li', icon('compress', 16), 'For a faster job, pick a lower resolution (e.g. 1080p).'),
        saver() ? h('li', icon('gauge', 16), 'Battery saver is on: one file at a time, hardware encoding, fewer animations.') : null),
      h('label.check', h('input', { type: 'checkbox', onchange: (e) => (dont = e.target.checked) }), "Don't warn me again")),
    actions: [{ label: 'Cancel' }, { label: 'Start anyway', primary: true, onClick: () => { if (dont) settings.set('bigJobWarning', false); proceed(); } }],
  });
}
export const isHeavyMedia = (m) => !!m && ((Math.min(m.width || 0, m.height || 0) >= 2000) || m.duration > 20 * 60);
