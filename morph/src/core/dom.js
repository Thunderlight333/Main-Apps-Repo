// Tiny DOM helpers. h('div.cls#id', {props}, ...children)
export function h(tag, props, ...kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    if (props != null) kids.unshift(props);
    props = {};
  }
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) for (const p of m[2].match(/[.#][\w-]+/g)) p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1));
  for (const [k, v] of Object.entries(props)) {
    if (v == null || (v === false && !k.startsWith('aria-'))) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && !k.includes('-')) el[k] = v;
    else el.setAttribute(k, k.startsWith('aria-') ? String(v) : v === true ? '' : v); // aria-pressed etc. need "true"/"false"
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clear = (el) => { el.replaceChildren(); return el; };

export function fmtBytes(n) {
  if (!isFinite(n) || n < 0) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i ? n.toFixed(2) : n < 100 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}
export function fmtTime(s, ms = false) {
  if (!isFinite(s)) return '0:00';
  const neg = s < 0; s = Math.abs(s);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  const frac = ms ? '.' + String(Math.floor((s % 1) * 10)) : '';
  return (neg ? '-' : '') + (hh ? `${hh}:${String(mm).padStart(2, '0')}` : mm) + ':' + String(ss).padStart(2, '0') + frac;
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const baseName = (n) => n.replace(/\.[^.]+$/, '');
export const extOf = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const raf = () => new Promise((r) => requestAnimationFrame(r));
let _uid = 0;
export const uid = (p = 'id') => `${p}${++_uid}${Math.random().toString(36).slice(2, 6)}`;
