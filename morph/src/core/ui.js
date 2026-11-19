import { h, clamp } from './dom.js';
import { icon } from './icons.js';
import { settings } from './settings.js';

// ---------- Toasts ----------
export function toast(msg, type = 'info', ms = 3200) {
  const host = document.getElementById('toasts');
  const t = h('div.toast', { class: `t-${type}`, role: 'status' },
    icon(type === 'error' ? 'info' : type === 'success' ? 'check' : 'info', 18), h('span', msg));
  host.append(t);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
}

// ---------- Modal ----------
export function modal({ title, body, actions = [], wide = false, sheet = false, onClose }) {
  const host = document.getElementById('modals');
  let closed = false;
  const close = (v) => {
    if (closed) return; closed = true;
    wrap.classList.add('out'); setTimeout(() => wrap.remove(), 200);
    document.removeEventListener('keydown', esc);
    onClose && onClose(v);
  };
  const esc = (e) => e.key === 'Escape' && close();
  const box = h('div.modal', { class: wide ? 'wide' : '', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', h('h3', title), h('button.icon-btn', { 'aria-label': 'Close', onclick: () => close() }, icon('x'))),
    h('div.modal-body', body),
    actions.length ? h('div.modal-actions', actions.map((a) =>
      h('button.btn', { class: a.primary ? 'primary' : a.danger ? 'danger' : 'ghost', onclick: () => { const r = a.onClick?.(); if (r !== false) close(a.value); } }, a.label))) : null);
  const wrap = h('div.modal-wrap', { class: sheet ? 'sheet' : '', onclick: (e) => e.target === wrap && close() }, box);
  host.append(wrap);
  document.addEventListener('keydown', esc);
  return { close, el: box };
}
export function confirmDialog(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((res) => modal({
    title, body: h('p.muted', text), onClose: (v) => res(v === true),
    actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  }));
}
export function prompt(title, { label = '', value = '', type = 'text', placeholder = '' } = {}) {
  return new Promise((res) => {
    const inp = h('input.input', { type, value, placeholder });
    const m = modal({
      title, body: h('label.field', h('span', label), inp), onClose: (v) => res(v === true ? inp.value : null),
      actions: [{ label: 'Cancel', value: false }, { label: 'OK', value: true, primary: true }],
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { m.close(true); } });
    setTimeout(() => inp.focus(), 50);
  });
}

// ---------- Form controls ----------
export function segmented(options, value, onChange, { small = false } = {}) {
  const el = h('div.seg', { class: small ? 'small' : '', role: 'radiogroup' });
  const ind = h('span.seg-ind');
  el.append(ind);
  const btns = options.map((o) => {
    const opt = typeof o === 'object' ? o : { value: o, label: String(o) };
    const b = h('button', { type: 'button', role: 'radio', title: opt.title || '', disabled: opt.disabled, onclick: () => set(opt.value, true) },
      opt.icon ? icon(opt.icon, 16) : null, opt.label);
    b.dataset.v = String(opt.value);
    el.append(b);
    return b;
  });
  function place() {
    const act = btns.find((b) => b.dataset.v === String(value));
    if (!act || !act.offsetWidth) { ind.style.opacity = 0; return; }
    ind.style.opacity = 1;
    ind.style.width = act.offsetWidth + 'px';
    ind.style.height = act.offsetHeight + 'px';
    ind.style.transform = `translate(${act.offsetLeft}px, ${act.offsetTop}px)`;
  }
  function set(v, user) {
    value = v;
    btns.forEach((b) => b.setAttribute('aria-checked', b.dataset.v === String(v)));
    place();
    if (user) onChange(v);
  }
  set(value);
  new ResizeObserver(place).observe(el);
  el.setValue = (v) => set(v);
  return el;
}

export function slider({ min = 0, max = 100, step = 1, value, format = (v) => v, onInput, onChange }) {
  const out = h('output', format(value));
  const inp = h('input.range', { type: 'range', min, max, step, value });
  const paint = () => inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%');
  inp.addEventListener('input', () => { paint(); out.textContent = format(+inp.value); onInput(+inp.value); });
  if (onChange) inp.addEventListener('change', () => onChange(+inp.value));
  paint();
  const el = h('div.slider', inp, out);
  el.setValue = (v) => { inp.value = v; paint(); out.textContent = format(+v); };
  return el;
}

export function toggle(checked, onChange, label) {
  const inp = h('input', { type: 'checkbox', checked, onchange: () => onChange(inp.checked) });
  return h('label.switch', { 'aria-label': label || '' }, inp, h('span.track', h('span.knob')));
}

export function select(options, value, onChange) {
  const s = h('select.input', { onchange: () => onChange(s.value) },
    options.map((o) => { const opt = typeof o === 'object' ? o : { value: o, label: o }; return h('option', { value: opt.value, selected: String(opt.value) === String(value) }, opt.label); }));
  return s;
}

export function field(label, control, hint) {
  return h('div.field', h('span.field-label', label), control, hint ? h('small.hint', hint) : null);
}

// ---------- Progress ----------
export function progressBar() {
  const fill = h('span.pb-fill');
  const label = h('span.pb-label', '0%');
  const el = h('div.pb', h('div.pb-track', fill), label);
  el.set = (p, text) => {
    p = clamp(p, 0, 1);
    fill.style.transform = `scaleX(${p})`;
    label.textContent = text || `${Math.round(p * 100)}%`;
  };
  el.indeterminate = (on) => el.classList.toggle('ind', on);
  return el;
}

export function spinner(size = 20) { return h('span.spinner', { style: { width: size + 'px', height: size + 'px' } }); }

// ---------- Feedback ----------
let actx;
export function feedback(kind = 'done') {
  if (settings.get('haptics') && navigator.vibrate) navigator.vibrate(kind === 'error' ? [40, 60, 40] : 30);
  if (settings.get('sound')) {
    try {
      actx ||= new AudioContext();
      const now = actx.currentTime;
      const notes = kind === 'error' ? [330, 220] : [660, 880];
      notes.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.08, now + i * 0.09 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.2);
        o.connect(g).connect(actx.destination); o.start(now + i * 0.09); o.stop(now + i * 0.09 + 0.22);
      });
    } catch { /* no audio */ }
  }
}
export function notify(title, body) {
  if (!settings.get('notify') || document.visibilityState === 'visible') return;
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icons/icon-192.png' }); } catch { /* ignore */ }
  }
}

// ---------- Busy state: wake lock + leave warning ----------
let busyCount = 0, wake = null;
const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
export async function busy(on) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  const active = busyCount > 0;
  document.documentElement.classList.toggle('is-busy', active);
  const { saver } = await import('./power.js');
  document.documentElement.classList.toggle('saver-busy', active && saver());
  if (active && settings.get('warnOnLeave')) addEventListener('beforeunload', beforeUnload);
  else removeEventListener('beforeunload', beforeUnload);
  try {
    if (active && settings.get('wakeLock') && 'wakeLock' in navigator && !wake) wake = await navigator.wakeLock.request('screen');
    else if (!active && wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}
