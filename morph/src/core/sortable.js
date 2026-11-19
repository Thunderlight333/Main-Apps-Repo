// Reordering for lists and grids. Works with mouse, touch and pen, plus the keyboard (arrow keys on the handle).
// Motion is transform-only (FLIP) and follows the Animations setting.

const motion = () => document.documentElement.dataset.motion || 'full';
const ms = () => (motion() === 'off' ? 0 : motion() === 'reduced' ? 90 : 180);

/** Stop an element's entry animation from replaying when it is moved in the DOM. */
export function settle(el) {
  el.addEventListener('animationend', () => { el.style.animation = 'none'; }, { once: true });
  return el;
}

/** Put `ordered` (existing children) into `container` in that order, animating the moves. */
export function reorderChildren(container, ordered) {
  const before = new Map(ordered.map((el) => [el, el.getBoundingClientRect()]));
  ordered.forEach((el) => { el.style.animation = 'none'; container.append(el); });
  flip(before);
}

/** An element's layout box, ignoring any slide animation that is still running on it. */
function layoutRect(el) {
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return r;
  const m = new DOMMatrixReadOnly(t);
  return { left: r.left - m.e, right: r.right - m.e, top: r.top - m.f, bottom: r.bottom - m.f };
}

function flip(before) {
  const d = ms(); if (!d) return;
  for (const [el, r] of before) {
    const n = el.getBoundingClientRect();
    const dx = r.left - n.left, dy = r.top - n.top;
    if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: d, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

/**
 * sortable(container, { items, handle, onSort })
 * items: selector for the direct children that can move.
 * handle: selector inside an item that starts a drag. Without one, the whole item drags
 *         (mouse: after a small move; touch: after a long press, so normal scrolling still works).
 * onSort(from, to): called after the DOM order changed.
 */
export function sortable(container, { items, handle = null, onSort, disabled = () => false }) {
  let drag = null, pending = null, suppressClick = false, raf = 0;
  const kids = () => [...container.children].filter((c) => c.matches(items));

  const down = (e) => {
    if (disabled() || e.button > 0) return;
    const item = e.target.closest(items);
    if (!item || item.parentElement !== container) return;
    if (handle && !e.target.closest(handle)) return;
    if (!handle && e.target.closest('button, input, select, textarea, a')) return;
    const p = { item, id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType };
    if (handle && e.pointerType !== 'mouse') { e.preventDefault(); begin(p, e); return; }
    pending = p;
    if (!handle && e.pointerType !== 'mouse') p.timer = setTimeout(() => { if (pending === p) { pending = null; navigator.vibrate?.(10); begin(p, e); } }, 320);
    if (handle) e.preventDefault();
  };

  function begin(p, e) {
    const els = kids();
    els.forEach((el) => (el.style.animation = 'none'));
    const r = p.item.getBoundingClientRect();
    drag = { item: p.item, from: els.indexOf(p.item), ox: p.x - r.left, oy: p.y - r.top, x: e.clientX, y: e.clientY, tx: 0, ty: 0 };
    p.item.classList.add('sorting'); container.classList.add('is-sorting');
    document.documentElement.classList.add('no-select');
    try { container.setPointerCapture(p.id); } catch { /* */ }
    place(); tick();
  }

  const move = (e) => {
    if (pending && !drag) {
      const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (pending.type === 'mouse' && dist > 5) { const p = pending; pending = null; begin(p, e); }
      else if (pending.type !== 'mouse' && dist > 8) { clearTimeout(pending.timer); pending = null; }
      if (!drag) return;
    }
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    swap(); place();
  };

  // Keep the dragged item under the pointer (transform only).
  function place() {
    const { item } = drag;
    const r = item.getBoundingClientRect();
    const baseX = r.left - drag.tx, baseY = r.top - drag.ty;
    drag.tx = drag.x - drag.ox - baseX; drag.ty = drag.y - drag.oy - baseY;
    item.style.transform = `translate(${drag.tx}px, ${drag.ty}px)`;
  }

  function swap() {
    const els = kids();
    const cur = els.indexOf(drag.item);
    let target = -1;
    for (let i = 0; i < els.length; i++) {
      if (els[i] === drag.item) continue;
      const r = layoutRect(els[i]);
      if (drag.x >= r.left && drag.x <= r.right && drag.y >= r.top && drag.y <= r.bottom) { target = i; break; }
    }
    if (target < 0) {
      // Past the ends of the list.
      const first = layoutRect(els[0]), last = layoutRect(els[els.length - 1]);
      if (drag.y < first.top) target = 0; else if (drag.y > last.bottom) target = els.length - 1; else return;
    }
    if (target === cur) return;
    const before = new Map(els.filter((el) => el !== drag.item).map((el) => [el, el.getBoundingClientRect()]));
    const ref = els[target];
    container.insertBefore(drag.item, target > cur ? ref.nextSibling : ref);
    flip(before);
  }

  // Scroll the page while dragging near the top or bottom edge.
  function tick() {
    cancelAnimationFrame(raf);
    if (!drag) return;
    const edge = 70, vh = innerHeight;
    const bottomInset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabbar')) || 0;
    let dy = 0;
    if (drag.y < edge) dy = -Math.ceil((edge - drag.y) / 6);
    else if (drag.y > vh - edge - (matchMedia('(max-width: 860px)').matches ? bottomInset : 0)) dy = Math.ceil((drag.y - (vh - edge)) / 6) || 4;
    if (dy) { scrollBy(0, dy); swap(); place(); }
    raf = requestAnimationFrame(tick);
  }

  const up = () => {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    if (!drag) return;
    cancelAnimationFrame(raf);
    const { item, from } = drag;
    const { tx, ty } = drag;
    drag = null;
    item.classList.remove('sorting'); container.classList.remove('is-sorting');
    document.documentElement.classList.remove('no-select');
    item.style.transform = '';
    const d = ms();
    if (d && (tx || ty)) item.animate([{ transform: `translate(${tx}px, ${ty}px)` }, { transform: 'none' }], { duration: d, easing: 'cubic-bezier(.2,.8,.2,1)' });
    suppressClick = true; setTimeout(() => (suppressClick = false), 0);
    const to = kids().indexOf(item);
    if (to !== from) onSort(from, to);
  };

  // Arrow keys on the handle (or the item, when there is no handle) move it by one.
  const key = (e) => {
    if (disabled()) return;
    const k = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
    const item = e.target.closest(items);
    if (!item || item.parentElement !== container) return;
    if (handle ? !e.target.closest(handle) : e.target !== item) return;
    const els = kids(); const from = els.indexOf(item);
    const to = from + (k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1);
    if (to < 0 || to >= els.length) return;
    e.preventDefault();
    const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
    els.forEach((el) => (el.style.animation = 'none'));
    container.insertBefore(item, to > from ? els[to].nextSibling : els[to]);
    flip(before);
    onSort(from, to);
    (handle ? kids()[to]?.querySelector(handle) : kids()[to])?.focus();
  };

  container.addEventListener('pointerdown', down);
  container.addEventListener('pointermove', move);
  container.addEventListener('pointerup', up);
  container.addEventListener('pointercancel', up);
  container.addEventListener('lostpointercapture', up);
  container.addEventListener('keydown', key);
  container.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  container.addEventListener('contextmenu', (e) => { if (drag || pending) e.preventDefault(); });
  // Block page scrolling while a touch drag is active.
  container.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
  // A pointer that never moved (mouse click without drag) is not a drag.
  container.addEventListener('pointerleave', () => { if (pending && pending.type === 'mouse') pending = null; });
  return { destroy: () => cancelAnimationFrame(raf) };
}

/** Sort helpers shared by every reorderable list. */
export const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  date: (a, b) => (a.lastModified || 0) - (b.lastModified || 0),
};
