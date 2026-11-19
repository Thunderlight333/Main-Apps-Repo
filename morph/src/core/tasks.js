// Background tasks: every running job (convert, compress, export, PDF, download, upload) registers here.
// Shows a progress pill at the top of every screen, a thin progress line, and a Tasks panel,
// so you can start a job, switch to another tool and start another one (like big apps do).
import { h } from './dom.js';
import { icon } from './icons.js';
import { busy, toast, modal } from './ui.js';

const list = []; // { id, title, route, iconName, p, msg, state: 'running'|'done'|'error'|'cancelled', cancel, seen }
const subs = new Set();
let uid = 0;
let ui = null; // { pill, ring, pct, count, line }
let panel = null; // { close, body }
let raf = 0;

export const tasks = {
  /** Start a task. Returns a handle: progress(p, msg?), status(msg), done(msg?), fail(msg?), cancelled(). */
  start({ title, route, iconName = 'bolt', cancel }) {
    const t = { id: ++uid, title, route, iconName, p: 0, msg: 'Starting…', state: 'running', cancel, seen: false, at: Date.now() };
    list.unshift(t);
    busy(true);
    changed();
    let ended = false;
    const end = (state, msg) => {
      if (ended) return; ended = true;
      t.state = state; if (msg) t.msg = msg; if (state === 'done') t.p = 1;
      t.end = Date.now();
      busy(false);
      // Finished on another screen: tell the user, with a shortcut back to it.
      const here = currentRoute?.() || '';
      const away = !!t.route && !onRoute(here, t.route) || document.visibilityState === 'hidden';
      if (state === 'done' && away) toast(`${t.title}: done`, 'success', 6000, { action: { label: 'Open', onClick: () => open(t) } });
      else if (state === 'error' && away) toast(`${t.title}: failed`, 'error', 7000, { action: { label: 'Open', onClick: () => open(t) } });
      if (!away) t.seen = true;
      if (state === 'cancelled') t.seen = true;
      changed();
      prune();
    };
    return {
      progress(p, msg) { t.p = p; if (msg) t.msg = msg; changed(true); },
      status(msg) { t.msg = msg; changed(true); },
      done: (msg) => end('done', msg || 'Done'),
      fail: (msg) => end('error', msg || 'Failed'),
      cancelled: () => end('cancelled', 'Cancelled'),
      get id() { return t.id; },
    };
  },
  running: () => list.filter((t) => t.state === 'running'),
  all: () => list.slice(),
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  /** Mark finished tasks for a screen as seen (called when that screen is shown). */
  seen(route) {
    let any = false;
    for (const t of list) if (t.state !== 'running' && !t.seen && t.route && onRoute(route, t.route)) { t.seen = true; any = true; }
    if (any) changed();
  },
  openPanel,
};

let currentRoute = null, navigate = null;
const onRoute = (here, r) => here === r || here.startsWith(r + '/');
/** Wire up the router (called by app.js). */
export function bindTasks({ route, go }) { currentRoute = route; navigate = go; }

function open(t) { panel?.close(); t.seen = true; changed(); if (t.route) navigate?.(t.route); }

function prune() {
  // Keep the 12 most recent finished tasks.
  const fin = list.filter((t) => t.state !== 'running');
  fin.slice(12).forEach((t) => list.splice(list.indexOf(t), 1));
}

function changed(progressOnly) {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(progressOnly); subs.forEach((f) => f()); });
}

function overall() {
  const run = list.filter((t) => t.state === 'running');
  if (!run.length) return null;
  const known = run.filter((t) => t.p >= 0);
  return { n: run.length, p: known.length ? known.reduce((a, t) => a + Math.min(1, t.p), 0) / run.length : -1 };
}

/** The top-bar pill (progress ring + count) and the thin line across the top of the screen. */
export function taskPill() {
  const R = 9, C = 2 * Math.PI * R;
  const ring = h('span.tp-ring', { html: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="${R}" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="3"/><circle class="tp-arc" cx="12" cy="12" r="${R}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 12 12)"/></svg>` });
  const label = h('span.tp-label');
  const pill = h('button.task-pill', { hidden: true, 'aria-label': 'Tasks', onclick: openPanel }, ring, label);
  const line = h('div.task-line', { hidden: true, 'aria-hidden': 'true' }, h('span.tl-fill'));
  ui = { pill, ring, label, line, C };
  paint();
  return { pill, line };
}

function paint() {
  if (!ui) return;
  const o = overall();
  const unseen = list.filter((t) => t.state !== 'running' && !t.seen);
  const show = !!o || unseen.length > 0;
  ui.pill.hidden = !show;
  ui.line.hidden = !o;
  document.documentElement.classList.toggle('has-tasks', show);
  const arc = ui.ring.querySelector('.tp-arc');
  ui.pill.classList.toggle('ind', !!o && o.p < 0);
  ui.pill.classList.toggle('fin', !o && unseen.length > 0);
  ui.pill.classList.toggle('err', !o && unseen.some((t) => t.state === 'error'));
  if (o) {
    const p = o.p < 0 ? 0.25 : o.p;
    arc.style.strokeDashoffset = String(ui.C * (1 - p));
    const one = o.n === 1 ? list.find((t) => t.state === 'running') : null;
    ui.label.textContent = (o.n > 1 ? `${o.n} tasks · ` : one ? `${short(one.title)} · ` : '') + (o.p < 0 ? '…' : `${Math.round(o.p * 100)}%`);
    ui.pill.setAttribute('aria-label', `${o.n} task${o.n > 1 ? 's' : ''} running, ${o.p < 0 ? '' : Math.round(o.p * 100) + '%'}. Show tasks`);
    ui.line.classList.toggle('ind', o.p < 0);
    ui.line.firstChild.style.transform = `scaleX(${o.p < 0 ? 0.3 : Math.max(0.02, o.p)})`;
  } else if (unseen.length) {
    arc.style.strokeDashoffset = '0';
    const err = unseen.some((t) => t.state === 'error');
    ui.label.textContent = err ? `${unseen.length} finished · check` : `${unseen.length} done`;
    ui.pill.setAttribute('aria-label', `${unseen.length} finished task${unseen.length > 1 ? 's' : ''}. Show tasks`);
  }
  if (panel) renderPanel();
}
const short = (s) => (s.length > 18 ? s.slice(0, 17) + '…' : s);

function openPanel() {
  if (panel) return;
  const body = h('div.task-panel');
  const m = modal({
    title: 'Tasks', body, sheet: true,
    onClose: () => { panel = null; list.forEach((t) => { if (t.state !== 'running') t.seen = true; }); changed(); },
  });
  panel = { close: m.close, body };
  renderPanel();
}

function renderPanel() {
  const { body } = panel;
  if (!list.length) { body.replaceChildren(h('p.muted', 'No tasks yet. Start a job in any tool and it shows up here while you keep working elsewhere.')); return; }
  const rows = list.map((t) => {
    let row = body.querySelector(`[data-task="${t.id}"]`);
    if (!row) {
      const fill = h('span.pb-fill');
      row = h('div.task-row', { 'data-task': t.id },
        h('span.tr-ic', icon(t.iconName, 18)),
        h('div.tr-body', h('div.tr-top', h('strong.tr-title', t.title), h('span.tr-pct')), h('div.pb-track.tr-bar', fill), h('small.tr-msg')),
        h('div.tr-acts'));
      row._fill = fill;
    }
    row.dataset.state = t.state;
    row.querySelector('.tr-pct').textContent = t.state === 'running' ? (t.p < 0 ? '' : `${Math.round(t.p * 100)}%`) : '';
    row._fill.style.transform = `scaleX(${t.state === 'running' ? (t.p < 0 ? 0.3 : t.p) : t.state === 'done' ? 1 : 0})`;
    row.querySelector('.tr-bar').classList.toggle('ind', t.state === 'running' && t.p < 0);
    row.querySelector('.tr-bar').hidden = t.state !== 'running';
    row.querySelector('.tr-msg').textContent = t.msg || '';
    const acts = row.querySelector('.tr-acts');
    const key = t.state + (t.cancel ? 'c' : '');
    if (acts.dataset.k !== key) {
      acts.dataset.k = key;
      acts.replaceChildren(...[
        t.route ? h('button.btn.ghost.sm', { onclick: () => open(t) }, 'Open') : null,
        t.state === 'running' && t.cancel ? h('button.icon-btn.sm', { 'aria-label': `Cancel ${t.title}`, title: 'Cancel', onclick: () => t.cancel() }, icon('x', 16)) : null,
        t.state !== 'running' ? h('span.tr-badge', { class: t.state }, icon(t.state === 'done' ? 'check' : t.state === 'error' ? 'info' : 'x', 14)) : null].filter(Boolean));
    }
    return row;
  });
  const fin = list.some((t) => t.state !== 'running');
  const foot = body.querySelector('.tp-foot') || h('div.tp-foot', h('button.link-btn', { onclick: () => { for (let i = list.length - 1; i >= 0; i--) if (list[i].state !== 'running') list.splice(i, 1); changed(); } }, 'Clear finished'));
  foot.hidden = !fin;
  body.replaceChildren(...rows, foot);
}
