// Lightweight recent-activity log (metadata only, never file contents).
import { settings } from './settings.js';
const KEY = 'morph.history.v1';
let items = [];
try { items = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { items = []; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 40))); } catch { /* ignore */ } };
export const history = {
  list: () => items,
  add(entry) {
    if (!settings.get('history')) return;
    items.unshift({ ...entry, at: Date.now() });
    items = items.slice(0, 40); save();
  },
  clear() { items = []; save(); },
  stats() {
    const saved = items.reduce((a, i) => a + Math.max(0, (i.inSize || 0) - (i.outSize || 0)), 0);
    return { jobs: items.length, saved };
  },
};
