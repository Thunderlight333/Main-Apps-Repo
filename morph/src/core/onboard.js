// First-time guide: 3 short swipeable screens, shown once on Home. "Skip" or finishing hides it for good.
import { h } from './dom.js';
import { icon } from './icons.js';

const KEY = 'morph.onboarded';
export function seenGuide() { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } }
function markSeen() { try { localStorage.setItem(KEY, '1'); } catch { /* */ } }

export function showGuide({ canInstall, install } = {}) {
  if (document.querySelector('.guide')) return;
  const slides = [
    { ic: 'sparkle', title: 'Everything for your files, in one app', text: 'Convert, compress and edit videos, photos, audio and PDFs. Make files ready for WhatsApp, Discord, Email or Instagram with one tap.' },
    { ic: 'lock', title: 'Your files never leave your device', text: 'Morph does the work right here, on your phone or computer. Nothing is uploaded, and it works without internet.' },
    { ic: 'download', title: 'Keep Morph one tap away', text: canInstall?.() ? 'Add Morph to your home screen. It opens like a normal app, full screen and offline.' : 'Tip: in your browser menu, choose “Add to Home screen” or “Install app” to open Morph like a normal app.', install: true },
  ];
  let i = 0;
  const track = h('div.guide-track', slides.map((s) => h('section.guide-slide',
    h('div.guide-ic', icon(s.ic, 34)), h('h2', s.title), h('p', s.text))));
  const dots = h('div.guide-dots', slides.map((_, k) => h('span', { 'data-k': k })));
  const next = h('button.btn.primary.lg', { type: 'button' });
  const installBtn = h('button.btn.ghost', { type: 'button', hidden: true, onclick: () => { install?.(); close(); } }, icon('download', 16), 'Install Morph');
  const skip = h('button.link-btn.guide-skip', { type: 'button', onclick: () => close() }, 'Skip');
  const box = h('div.guide-box', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Morph' }, skip, h('div.guide-view', track), dots, h('div.guide-actions', installBtn, next));
  const wrap = h('div.guide', box);
  function go(k) {
    i = Math.max(0, Math.min(slides.length - 1, k));
    track.style.transform = `translateX(${-i * 100}%)`;
    dots.querySelectorAll('span').forEach((d, n) => d.classList.toggle('on', n === i));
    const last = i === slides.length - 1;
    next.replaceChildren(last ? 'Get started' : 'Next', last ? '' : icon('chevron', 18));
    installBtn.hidden = !(last && canInstall?.());
  }
  function close() { markSeen(); wrap.classList.add('out'); document.removeEventListener('keydown', key); setTimeout(() => wrap.remove(), 220); }
  next.onclick = () => (i === slides.length - 1 ? close() : go(i + 1));
  const key = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); };
  document.addEventListener('keydown', key);
  // swipe
  let sx = null;
  box.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) sx = e.clientX; });
  box.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1)); });
  document.body.append(wrap);
  go(0);
  setTimeout(() => next.focus(), 50);
}
