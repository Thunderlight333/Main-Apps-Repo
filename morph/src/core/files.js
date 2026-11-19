import { extOf, baseName } from './dom.js';
import { settings } from './settings.js';

const EXT = {
  video: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', '3gp', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'ogv', 'hevc'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'amr', 'weba'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'svg', 'ico', 'jfif'],
  pdf: ['pdf'],
  text: ['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm', 'xml', 'log', 'js', 'css', 'yml', 'yaml'],
};
export function kindOf(file) {
  const t = file.type || '', e = extOf(file.name || '');
  if (t === 'application/pdf' || e === 'pdf') return 'pdf';
  for (const k of ['video', 'audio', 'image']) if (t.startsWith(k + '/') || EXT[k].includes(e)) return k;
  if (t.startsWith('text/') || EXT.text.includes(e)) return 'text';
  return 'other';
}
export const KIND_ICON = { video: 'video', audio: 'audio', image: 'image', pdf: 'pdf', text: 'text', other: 'file' };

export function outName(inputName, newExt, tool = '') {
  const b = baseName(inputName || 'file');
  const p = settings.get('namePattern');
  const suffix = p === 'original' ? '' : p === 'custom' ? settings.get('customSuffix') || '' : tool ? `-${tool}` : '-morph';
  return `${b}${suffix}.${newExt}`;
}

/** Normalise anything (FileList, DataTransfer, ClipboardItems) into File[] */
export async function filesFromDataTransfer(dt) {
  const out = [];
  if (!dt) return out;
  if (dt.items && dt.items.length) {
    const entries = [];
    for (const it of dt.items) {
      if (it.kind !== 'file') continue;
      const en = it.webkitGetAsEntry?.();
      if (en && en.isDirectory) entries.push(en);
      else { const f = it.getAsFile(); if (f) out.push(f); }
    }
    for (const en of entries) out.push(...(await readDir(en)));
  } else if (dt.files) out.push(...dt.files);
  return out.map(named);
}
async function readDir(dirEntry) {
  const files = [];
  const reader = dirEntry.createReader();
  const readBatch = () => new Promise((res, rej) => reader.readEntries(res, rej));
  let batch;
  while ((batch = await readBatch()).length) {
    for (const en of batch) {
      if (en.isFile) files.push(await new Promise((res, rej) => en.file(res, rej)));
      else if (en.isDirectory) files.push(...(await readDir(en)));
    }
  }
  return files;
}
// Clipboard images arrive as "image.png" with no name variety; give them a stable unique name.
let pasteN = 0;
function named(f) {
  if (!f.name || f.name === 'image.png' || f.name === 'blob') {
    const ext = (f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    return new File([f], `pasted-${new Date().toISOString().slice(0, 10)}-${++pasteN}.${ext}`, { type: f.type, lastModified: Date.now() });
  }
  return f;
}
export async function readClipboardFiles() {
  const files = []; let text = '';
  if (!navigator.clipboard?.read) {
    text = (await navigator.clipboard?.readText?.().catch(() => '')) || '';
    return { files, text };
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => !t.startsWith('text/'));
    if (type) { const b = await item.getType(type); files.push(named(new File([b], 'image.png', { type }))); }
    else if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
  }
  return { files, text };
}
export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((res) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    inp.onchange = () => res([...inp.files]);
    inp.oncancel = () => res([]);
    inp.click();
  });
}
export const isUrl = (s) => /^https?:\/\/\S+$/i.test((s || '').trim());
export const findUrl = (s) => ((s || '').match(/https?:\/\/[^\s"'<>]+/i) || [])[0] || '';
