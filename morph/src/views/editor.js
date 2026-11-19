// Simple video editor: trim, crop, rotate/flip, resize, speed, mute/extract audio, export, frame grab.
import { h, fmtTime, fmtBytes, clamp } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHeader, dropZone, resultActions, friendly } from '../core/components.js';
import { segmented, select, field, progressBar, toast, feedback, notify, slider, toggle, confirmDialog } from '../core/ui.js';
import { tasks } from '../core/tasks.js';
import { kindOf, outName, pickFiles } from '../core/files.js';
import { startRun, download } from '../core/save.js';
import { history } from '../core/history.js';
import { probe, filmstrip, MIME } from '../engines/media.js';
import { processMedia } from '../engines/process.js';
import { guardBigJob, isHeavyMedia } from '../core/power.js';

const ASPECTS = [{ value: 0, label: 'Free' }, { value: 1, label: '1:1' }, { value: 9 / 16, label: '9:16' }, { value: 16 / 9, label: '16:9' }, { value: 4 / 5, label: '4:5' }, { value: 4 / 3, label: '4:3' }];

export default function editorView({ files }) {
  const root = h('div.tool.editor');
  const header = pageHeader('Video editor', 'Trim, crop, rotate, resize, change speed and export: all on-device.', 'scissors');
  const landing = h('div.landing', dropZone({ title: 'Drop a video to edit', multiple: false, accept: 'video/*,.mkv,.mov,.avi', kinds: ['MP4', 'MOV', 'MKV', 'WebM', 'AVI'], onFiles: (f) => load(f[0]) }));
  root.append(header, landing);
  let ed = null;

  async function load(file) {
    if (!file) return;
    if (kindOf(file) !== 'video') { toast('Please choose a video file', 'error'); return; }
    if (ed?.busy && !(await confirmDialog('Replace the video?', 'An export is still running. Opening another video will stop it.', 'Stop and open', true))) return;
    ed?.destroy();
    landing.hidden = true;
    ed = createEditor(file, () => { ed?.destroy(); ed = null; landing.hidden = false; });
    root.append(ed.el);
  }
  if (files?.length) load(files.find((f) => kindOf(f) === 'video') || files[0]);
  return {
    el: root, accept: (f) => { const v = f.find((x) => kindOf(x) === 'video'); if (!v) return false; load(v); }, destroy: () => ed?.destroy(),
    hide: () => ed?.hide(), get busy() { return !!ed?.busy; },
  };
}

function createEditor(file, onClose) {
  const url = URL.createObjectURL(file);
  const S = { start: 0, end: 0, dur: 0, crop: null, aspect: 0, rotate: 0, flip: false, res: 0, speed: 1, audio: 'keep', format: 'mp4', quality: 'high', W: 0, H: 0,
    volume: 1, fadeIn: 0, fadeOut: 0, music: null, musicVol: 0.6, musicLoop: true };
  let musicEl = null, musicUrl = null;
  let info = null, destroyed = false, ac = null;
  const thumbUrls = [];

  // ---------- stage ----------
  const video = h('video', { src: url, playsInline: true, preload: 'auto', muted: false });
  const cropBox = h('div.crop-box', ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((d) => h('span.ch', { 'data-h': d })), h('div.crop-grid'));
  const shade = h('div.crop-shade');
  const vbox = h('div.vbox', video, shade, cropBox);
  const noPreview = h('div.no-preview', { hidden: true }, icon('info', 22), h('strong', 'Preview not available for this format'), h('span', 'Editing and export still work.'));
  const stage = h('div.stage', vbox, noPreview);

  // ---------- transport ----------
  const playBtn = h('button.icon-btn.play', { 'aria-label': 'Play', onclick: () => togglePlay() }, icon('play'));
  const timeLbl = h('span.time', '0:00 / 0:00');
  const transport = h('div.transport',
    playBtn, timeLbl,
    h('div.t-right',
      h('button.btn.ghost.sm', { onclick: () => { S.start = Math.min(video.currentTime, S.end - 0.1); paintTrim(); } }, '[ Set start'),
      h('button.btn.ghost.sm', { onclick: () => { S.end = Math.max(video.currentTime, S.start + 0.1); paintTrim(); } }, 'Set end ]'),
      h('button.icon-btn.sm', { title: 'Save current frame as PNG', 'aria-label': 'Save frame', onclick: grabFrame }, icon('camera', 18))));

  // ---------- timeline ----------
  const strip = h('div.strip');
  const selBox = h('div.tl-sel', h('span.tl-h.l', { 'data-t': 'start' }), h('span.tl-h.r', { 'data-t': 'end' }));
  const playhead = h('div.tl-head');
  const timeline = h('div.timeline', strip, h('div.tl-dim.l'), h('div.tl-dim.r'), selBox, playhead);
  const trimLbl = h('div.trim-lbl');

  // ---------- panels ----------
  const panelHost = h('div.panel');
  const tabs = [
    ['trim', 'Trim', 'scissors'], ['crop', 'Crop', 'crop'], ['rotate', 'Rotate', 'rotate'], ['resize', 'Resize', 'layers'],
    ['speed', 'Speed', 'speed'], ['audio', 'Audio', 'audio'], ['export', 'Export', 'download'],
  ];
  let tab = 'trim';
  const tabBar = h('div.ed-tabs', tabs.map(([id, label, ic]) => h('button.ed-tab', { 'data-tab': id, onclick: () => setTab(id) }, icon(ic, 18), h('span', label))));
  const exportBtn = h('button.btn.primary.lg', { onclick: () => (ac ? doExport() : guardBigJob({ bytes: file.size, heavy: isHeavyMedia(info) }, doExport)) }, icon('bolt', 18), 'Export video');
  const progress = progressBar(); progress.hidden = true;
  const status = h('small.muted');
  const resultHost = h('div.ed-result');
  const summary = h('div.ed-summary');

  const el = h('div.ed',
    h('div.ed-top', h('div.ed-file', icon('video', 18), h('strong', file.name), h('span.muted', fmtBytes(file.size))),
      h('button.btn.ghost.sm', { onclick: onClose }, icon('x', 16), 'Close')),
    h('div.ed-layout',
      h('div.ed-left', stage, transport, timeline, trimLbl),
      h('div.ed-right', tabBar, panelHost, h('div.ed-go', summary, progress, status, exportBtn, resultHost))));

  // ---------- behaviour ----------
  function togglePlay() { if (video.paused) { if (video.currentTime >= S.end - 0.05 || video.currentTime < S.start) video.currentTime = S.start; video.play(); } else video.pause(); }
  video.addEventListener('play', () => playBtn.replaceChildren(icon('pause')));
  video.addEventListener('pause', () => playBtn.replaceChildren(icon('play')));
  // Music preview follows the video: same play/pause/seek, starting at the trim start.
  function syncMusic() {
    if (!musicEl) return;
    const d = musicEl.duration || 0;
    let t = Math.max(0, (video.currentTime - S.start) * S.speed);
    if (d && S.musicLoop) t %= d;
    if (Math.abs(musicEl.currentTime - t) > 0.25) musicEl.currentTime = Math.min(t, d || t);
    musicEl.volume = Math.min(1, S.musicVol);
    if (!video.paused && (S.musicLoop || t < d)) musicEl.play().catch(() => {}); else musicEl.pause();
  }
  function applyPreviewSound() {
    video.muted = S.audio === 'mute';
    video.volume = Math.min(1, S.volume);
    syncMusic();
  }
  ['play', 'pause', 'seeked', 'ratechange'].forEach((ev) => video.addEventListener(ev, syncMusic));
  video.addEventListener('error', () => { noPreview.hidden = false; vbox.hidden = true; });
  let rafId = 0;
  const tick = () => {
    if (destroyed) return;
    if (!video.paused && video.currentTime >= S.end) { video.pause(); video.currentTime = S.end; }
    paintHead();
    rafId = video.paused ? 0 : requestAnimationFrame(tick);
  };
  video.addEventListener('play', () => { if (!rafId) rafId = requestAnimationFrame(tick); });
  video.addEventListener('seeked', paintHead);
  video.addEventListener('loadedmetadata', () => {
    S.W = video.videoWidth; S.H = video.videoHeight;
    if (!S.dur) { S.dur = video.duration; S.end = video.duration; }
    layout(); paintTrim(); paintHead();
  });

  function paintHead() {
    const t = video.currentTime || 0;
    playhead.style.transform = `translateX(${(t / (S.dur || 1)) * timeline.clientWidth}px)`;
    timeLbl.textContent = `${fmtTime(t, true)} / ${fmtTime(S.dur)}`;
  }
  function paintTrim() {
    const w = timeline.clientWidth, a = (S.start / (S.dur || 1)) * w, b = (S.end / (S.dur || 1)) * w;
    selBox.style.transform = `translateX(${a}px)`; selBox.style.width = `${Math.max(0, b - a)}px`;
    timeline.querySelector('.tl-dim.l').style.width = `${a}px`;
    timeline.querySelector('.tl-dim.r').style.width = `${Math.max(0, w - b)}px`;
    trimLbl.replaceChildren(h('span', `Start ${fmtTime(S.start, true)}`), h('strong', `Length ${fmtTime((S.end - S.start) / S.speed, true)}`), h('span', `End ${fmtTime(S.end, true)}`));
    if (tab === 'trim') renderPanel();
    paintSummary();
  }
  // timeline drag
  timeline.addEventListener('pointerdown', (e) => {
    const handle = e.target.dataset?.t;
    const rect = timeline.getBoundingClientRect();
    const toT = (x) => clamp(((x - rect.left) / rect.width) * S.dur, 0, S.dur);
    timeline.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const t = toT(ev.clientX);
      if (handle === 'start') { S.start = Math.min(t, S.end - 0.1); video.currentTime = S.start; paintTrim(); }
      else if (handle === 'end') { S.end = Math.max(t, S.start + 0.1); video.currentTime = S.end; paintTrim(); }
      else { video.currentTime = t; paintHead(); }
    };
    move(e);
    const up = () => { timeline.removeEventListener('pointermove', move); timeline.removeEventListener('pointerup', up); timeline.removeEventListener('pointercancel', up); };
    timeline.addEventListener('pointermove', move); timeline.addEventListener('pointerup', up); timeline.addEventListener('pointercancel', up);
  });

  // stage layout (rotation-aware fit)
  function layout() {
    if (!S.W) return;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const rot = S.rotate % 180 !== 0;
    const ew = rot ? S.H : S.W, eh = rot ? S.W : S.H;
    const s = Math.min(sw / ew, sh / eh);
    vbox.style.width = `${S.W * s}px`; vbox.style.height = `${S.H * s}px`;
    vbox.style.transform = `translate(-50%, -50%) ${S.flip ? 'scaleX(-1) ' : ''}rotate(${S.rotate}deg)`;
    vbox.dataset.scale = s;
    paintCrop();
  }
  const ro = new ResizeObserver(() => { layout(); paintTrim(); paintHead(); });
  ro.observe(stage); ro.observe(timeline);

  // crop
  function paintCrop() {
    const on = tab === 'crop' && !!S.crop;
    cropBox.hidden = shade.hidden = !on;
    if (!on) return;
    const { x, y, w, h: hh } = S.crop;
    Object.assign(cropBox.style, { left: x * 100 + '%', top: y * 100 + '%', width: w * 100 + '%', height: hh * 100 + '%' });
    shade.style.clipPath = `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${x * 100}% ${y * 100}%,${x * 100}% ${(y + hh) * 100}%,${(x + w) * 100}% ${(y + hh) * 100}%,${(x + w) * 100}% ${y * 100}%,${x * 100}% ${y * 100}%)`;
  }
  function setAspect(a) {
    S.aspect = a;
    if (!a) { S.crop ||= { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }; paintCrop(); renderPanel(); return; }
    const vr = S.W / S.H; // aspect in fractions: w_frac*W / (h_frac*H) = a
    let w = 1, hh = (w * vr) / a;
    if (hh > 1) { hh = 1; w = (a * hh) / vr; }
    S.crop = { x: (1 - w) / 2, y: (1 - hh) / 2, w, h: hh };
    paintCrop(); renderPanel();
  }
  cropBox.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const mode = e.target.dataset.h || 'move';
    const start = { ...S.crop }, sx = e.clientX, sy = e.clientY;
    const sc = +vbox.dataset.scale, bw = S.W * sc, bh = S.H * sc;
    cropBox.setPointerCapture(e.pointerId);
    const move = (ev) => {
      let dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (S.flip) dx = -dx;
      [dx, dy] = { 0: [dx, dy], 90: [dy, -dx], 180: [-dx, -dy], 270: [-dy, dx] }[S.rotate];
      dx /= bw; dy /= bh;
      let { x, y, w, h: hh } = start;
      const min = 0.05;
      if (mode === 'move') { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - hh); }
      else {
        if (mode.includes('e')) w = clamp(w + dx, min, 1 - x);
        if (mode.includes('s')) hh = clamp(hh + dy, min, 1 - y);
        if (mode.includes('w')) { const nx = clamp(x + dx, 0, x + w - min); w += x - nx; x = nx; }
        if (mode.includes('n')) { const ny = clamp(y + dy, 0, y + hh - min); hh += y - ny; y = ny; }
        if (S.aspect) {
          const vr = S.W / S.H;
          const wantH = (w * vr) / S.aspect;
          if (mode === 'n' || mode === 's') { w = (S.aspect * hh) / vr; if (x + w > 1) { w = 1 - x; hh = (w * vr) / S.aspect; } }
          else { hh = wantH; if (mode.includes('n')) y = start.y + start.h - hh; if (y < 0 || y + hh > 1) { hh = mode.includes('n') ? start.y + start.h : 1 - y; y = mode.includes('n') ? start.y + start.h - hh : y; w = (S.aspect * hh) / vr; if (mode.includes('w')) x = start.x + start.w - w; } }
        }
      }
      S.crop = { x, y, w, h: hh };
      paintCrop();
    };
    const up = () => { cropBox.removeEventListener('pointermove', move); cropBox.removeEventListener('pointerup', up); renderPanel(); paintSummary(); };
    cropBox.addEventListener('pointermove', move); cropBox.addEventListener('pointerup', up);
  });

  function cropPixels() {
    if (!S.crop) return null;
    const W = S.W, H = S.H;
    let x = Math.round(S.crop.x * W), y = Math.round(S.crop.y * H), w = Math.round(S.crop.w * W), hh = Math.round(S.crop.h * H);
    w -= w % 2; hh -= hh % 2;
    // map from pre-rotation display space to post-rotation space (mediabunny/ffmpeg crop after rotate+flip)
    let r = { left: x, top: y, width: w, height: hh }, FW = W, FH = H;
    if (S.rotate === 90) { r = { left: H - y - hh, top: x, width: hh, height: w }; FW = H; FH = W; }
    else if (S.rotate === 180) r = { left: W - x - w, top: H - y - hh, width: w, height: hh };
    else if (S.rotate === 270) { r = { left: y, top: W - x - w, width: hh, height: w }; FW = H; FH = W; }
    if (S.flip) r.left = FW - r.left - r.width;
    void FH;
    return r;
  }

  // ---------- panels ----------
  function setTab(id) {
    tab = id;
    tabBar.querySelectorAll('.ed-tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === id));
    if (id === 'crop' && !S.crop) setAspect(S.aspect);
    renderPanel(); paintCrop();
  }
  function timeInput(val, onSet) {
    const inp = h('input.input.time-in', { value: fmtTime(val, true), onchange: () => {
      const p = inp.value.split(':').map(Number); const t = p.reduce((a, b) => a * 60 + b, 0);
      if (isFinite(t)) onSet(clamp(t, 0, S.dur)); else inp.value = fmtTime(val, true);
    } });
    return inp;
  }
  function renderPanel() {
    let c;
    if (tab === 'trim') c = [
      h('div.row2', field('Start', timeInput(S.start, (t) => { S.start = Math.min(t, S.end - 0.1); paintTrim(); })), field('End', timeInput(S.end, (t) => { S.end = Math.max(t, S.start + 0.1); paintTrim(); }))),
      h('p.hint', 'Drag the handles on the timeline, or play and use [ Set start / Set end ].'),
      h('button.btn.ghost.sm', { onclick: () => { S.start = 0; S.end = S.dur; paintTrim(); } }, icon('rotate', 16), 'Reset trim')];
    else if (tab === 'crop') {
      const px = cropPixels();
      c = [field('Aspect ratio', segmented(ASPECTS, S.aspect, setAspect, { small: true })),
        h('p.hint', px ? `Crop area: ${px.width} × ${px.height} px. Drag the box or its corners.` : ''),
        h('button.btn.ghost.sm', { onclick: () => { S.crop = null; S.aspect = 0; paintCrop(); renderPanel(); paintSummary(); } }, icon('x', 16), 'Remove crop')];
    } else if (tab === 'rotate') c = [
      h('div.btn-row',
        h('button.btn.ghost', { onclick: () => { S.rotate = (S.rotate + 270) % 360; layout(); paintSummary(); } }, icon('rotate', 18), 'Left'),
        h('button.btn.ghost', { onclick: () => { S.rotate = (S.rotate + 90) % 360; layout(); paintSummary(); } }, icon('rotate', 18), 'Right'),
        h('button.btn.ghost', { 'aria-pressed': S.flip, onclick: () => { S.flip = !S.flip; layout(); renderPanel(); paintSummary(); } }, icon('flip', 18), 'Mirror')),
      h('p.hint', `Rotation: ${S.rotate}°${S.flip ? ' · mirrored' : ''}`)];
    else if (tab === 'resize') c = [field('Output resolution', segmented([{ value: 0, label: 'Original' }, { value: 1080, label: '1080p' }, { value: 720, label: '720p' }, { value: 480, label: '480p' }, { value: 360, label: '360p' }], S.res, (v) => { S.res = v; paintSummary(); }, { small: true }), 'Scales the shorter side; aspect ratio is kept.')];
    else if (tab === 'speed') c = [field('Playback speed', segmented([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4].map((v) => ({ value: v, label: `${v}×` })), S.speed, (v) => { S.speed = v; video.playbackRate = v; paintTrim(); }, { small: true }), 'Speed changes use the universal engine (slower).')];
    else if (tab === 'audio') c = audioPanel();
    else {
      const fmts = S.audio === 'extract' ? ['mp3', 'm4a', 'wav'] : ['mp4', 'webm', 'mov', 'mkv', 'gif'];
      c = [field('Format', segmented(fmts.map((f) => ({ value: f, label: f.toUpperCase() })), S.format, (v) => { S.format = v; paintSummary(); }, { small: true })),
        S.audio !== 'extract' ? field('Quality', segmented([{ value: 'very-high', label: 'Best' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Small' }], S.quality, (v) => { S.quality = v; }, { small: true })) : null];
    }
    panelHost.replaceChildren(...c.filter(Boolean));
  }
  function audioPanel() {
    const silent = info && info.hasAudio === false;
    const pct = (v) => Math.round(v * 100) + '%';
    const rows = [];
    if (silent) rows.push(h('div.note', icon('info', 16), h('span', 'This video has no sound. Add a music file below to give it one.')));
    else rows.push(field('Original sound', segmented([{ value: 'keep', label: 'Keep' }, { value: 'mute', label: 'Remove sound' }, { value: 'extract', label: 'Audio only' }], S.audio, (v) => {
      S.audio = v;
      if (v === 'extract') S.format = 'mp3'; else if (['mp3', 'm4a', 'wav'].includes(S.format)) S.format = 'mp4';
      applyPreviewSound(); renderPanel(); paintSummary();
    }, { small: true }), S.audio === 'mute' ? (S.music ? 'The music replaces the original sound.' : 'The video is saved with no sound track at all.') : S.audio === 'extract' ? 'Saves just the sound as an MP3, M4A or WAV file.' : null));
    if (!silent && S.audio !== 'mute') rows.push(field('Volume', slider({ min: 0, max: 2, step: 0.05, value: S.volume, format: pct, onInput: (v) => { S.volume = v; applyPreviewSound(); paintSummary(); } }),
      'Above 100% makes it louder. The preview plays at most 100%.'));
    // Music: added under the original sound, or replacing it.
    if (!S.music) rows.push(field(silent ? 'Add sound' : 'Background music', h('button.btn.ghost', { onclick: pickMusic }, icon('audio', 18), 'Choose a music file'),
      'MP3, M4A, WAV… or a video, whose sound is used.'));
    else rows.push(field(silent || S.audio === 'mute' ? 'Music (replaces the sound)' : 'Background music',
      h('div.music-row', icon('audio', 18), h('span.music-name', { title: S.music.name }, S.music.name),
        h('button.icon-btn.sm', { 'aria-label': 'Remove music', onclick: () => { S.music = null; musicEl?.pause(); musicEl = null; if (musicUrl) URL.revokeObjectURL(musicUrl); renderPanel(); paintSummary(); } }, icon('x', 16)))),
      field('Music volume', slider({ min: 0, max: 1.5, step: 0.05, value: S.musicVol, format: pct, onInput: (v) => { S.musicVol = v; syncMusic(); } })),
      h('label.check', toggle(S.musicLoop, (v) => { S.musicLoop = v; syncMusic(); }, 'Loop music'), 'Repeat the music if it is shorter than the video'));
    rows.push(h('div.fade-rows',
      field('Fade in', segmented([0, 1, 2, 3].map((v) => ({ value: v, label: v ? `${v}s` : 'Off' })), S.fadeIn, (v) => { S.fadeIn = v; paintSummary(); }, { small: true })),
      field('Fade out', segmented([0, 1, 2, 3].map((v) => ({ value: v, label: v ? `${v}s` : 'Off' })), S.fadeOut, (v) => { S.fadeOut = v; paintSummary(); }, { small: true }))));
    return rows;
  }
  async function pickMusic() {
    const [f] = await pickFiles({ accept: 'audio/*,video/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus', multiple: false });
    if (!f) return;
    S.music = f;
    if (musicUrl) URL.revokeObjectURL(musicUrl);
    musicUrl = URL.createObjectURL(f);
    musicEl = new Audio(musicUrl); musicEl.preload = 'auto'; musicEl.loop = false;
    musicEl.addEventListener('ended', () => { if (S.musicLoop && !video.paused) { musicEl.currentTime = 0; musicEl.play().catch(() => {}); } });
    applyPreviewSound(); renderPanel(); paintSummary();
  }
  function paintSummary() {
    const bits = [];
    if (S.start > 0.05 || S.end < S.dur - 0.05) bits.push(`Trim ${fmtTime(S.start)}–${fmtTime(S.end)}`);
    if (S.crop) { const p = cropPixels(); bits.push(`Crop ${p.width}×${p.height}`); }
    if (S.rotate) bits.push(`Rotate ${S.rotate}°`);
    if (S.flip) bits.push('Mirror');
    if (S.res) bits.push(`${S.res}p`);
    if (S.speed !== 1) bits.push(`${S.speed}×`);
    if (S.audio !== 'keep') bits.push(S.audio === 'mute' ? (S.music ? 'Sound replaced' : 'No sound') : 'Audio only');
    if (S.audio !== 'mute' && S.volume !== 1) bits.push(`Volume ${Math.round(S.volume * 100)}%`);
    if (S.music) bits.push('+ Music');
    if (S.fadeIn || S.fadeOut) bits.push('Fades');
    bits.push(S.format.toUpperCase());
    summary.replaceChildren(...bits.map((b) => h('span.chip.xs', b)));
    exportBtn.replaceChildren(icon('bolt', 18), S.audio === 'extract' ? 'Export audio' : S.format === 'gif' ? 'Export GIF' : 'Export video');
  }

  // ---------- export ----------
  async function doExport() {
    if (ac) { ac.abort(); return; }
    const container = S.format;
    const name = outName(file.name, container, 'edit');
    const run = startRun(1, name, MIME[container]);
    ac = new AbortController();
    exportBtn.classList.add('danger'); exportBtn.replaceChildren(icon('x', 18), 'Cancel');
    progress.hidden = false; progress.set(0); resultHost.replaceChildren();
    const ctl = ac;
    const tk = tasks.start({ title: `Export ${file.name}`, route: 'edit', iconName: 'scissors', cancel: () => ctl.abort() });
    video.pause();
    try {
      info ||= await probe(file).catch(() => null);
      const crop = cropPixels();
      const shortSide = crop ? Math.min(crop.width, crop.height) : Math.min(S.W, S.H);
      const scale = S.res && S.res < shortSide ? S.res / shortSide : 1;
      const outW = scale !== 1 ? Math.round(((crop ? crop.width : S.rotate % 180 ? S.H : S.W) * scale) / 2) * 2 : undefined;
      const trimmed = S.start > 0.01 || S.end < S.dur - 0.01;
      const opts = {
        container, speed: S.speed,
        trim: trimmed ? { start: S.start, end: S.end } : undefined,
        video: container === 'gif' ? { width: outW || Math.min(480, S.W), fps: 12, crop, rotate: S.rotate, flip: S.flip }
          : { crop: crop || undefined, rotate: S.rotate || undefined, flip: S.flip || undefined, width: outW, quality: S.quality, discard: S.audio === 'extract', forceTranscode: !!(crop || S.rotate || S.flip || outW) || undefined,
            copy: !trimmed && !crop && !S.rotate && !S.flip && !outW },
        duration: S.dur,
        audio: audioOpts(),
      };
      const res = await processMedia(file, opts, {
        run, name, signal: ac.signal, duration: (S.end - S.start) / S.speed,
        onProgress: (p) => { progress.set(p); tk.progress(p); }, onStatus: (m) => { status.textContent = m; tk.status(m); },
      });
      status.textContent = `Done: ${fmtBytes(res.size)}`;
      tk.done(`${res.name} · ${fmtBytes(res.size)}`);
      resultHost.replaceChildren(h('div.result-card', h('div.rc-info', icon('check', 18), h('strong', res.name), h('span.muted', fmtBytes(res.size))), h('div.rc-actions', resultActions([res]))));
      history.add({ tool: 'edit', name: file.name, inSize: file.size, outSize: res.size, kind: 'video' });
      feedback('done'); notify('Morph: export finished', res.name);
    } catch (e) {
      if (!e.cancelled && e.name !== 'AbortError') { status.textContent = ''; toast(friendly(e), 'error', 6000); feedback('error'); tk.fail(friendly(e)); }
      else { status.textContent = 'Cancelled'; tk.cancelled(); }
    } finally {
      ac = null; progress.hidden = true;
      exportBtn.classList.remove('danger'); paintSummary();
    }
  }

  function audioOpts() {
    const silent = info && info.hasAudio === false;
    const music = S.music ? { file: S.music, volume: S.musicVol, loop: S.musicLoop, mode: S.audio === 'mute' || silent ? 'replace' : 'mix' } : null;
    if (S.audio === 'mute' && !music) return { discard: true };
    if (silent && !music) return {};
    return { volume: S.audio === 'mute' ? undefined : S.volume, fadeIn: S.fadeIn || undefined, fadeOut: S.fadeOut || undefined, music };
  }

  async function grabFrame() {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    download({ name: outName(file.name, 'png', `frame-${Math.floor(video.currentTime)}s`), blob, size: blob.size });
  }

  // keyboard shortcuts
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (!el.isConnected || el.closest('[hidden]') || document.querySelector('.modal-wrap')) return; // another screen is showing
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'i' || e.key === '[') { S.start = Math.min(video.currentTime, S.end - 0.1); paintTrim(); }
    else if (e.key === 'o' || e.key === ']') { S.end = Math.max(video.currentTime, S.start + 0.1); paintTrim(); }
    else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 1 : 1 / 30));
    else if (e.key === 'ArrowRight') video.currentTime = Math.min(S.dur, video.currentTime + (e.shiftKey ? 1 : 1 / 30));
  };
  addEventListener('keydown', onKey);

  // async init: duration + filmstrip
  (async () => {
    try {
      info = await probe(file);
      if (!S.dur || !isFinite(S.dur)) { S.dur = info.duration; S.end = info.duration; }
      if (!S.W && info.width) { S.W = info.width; S.H = info.height; layout(); }
      paintTrim();
      if (tab === 'audio') renderPanel();
    } catch { /* video element may still work */ }
    const n = Math.max(6, Math.min(16, Math.round(timeline.clientWidth / 64)));
    const cells = Array.from({ length: n }, () => h('div.cell'));
    strip.replaceChildren(...cells);
    let i = 0;
    try {
      for await (const u of filmstrip(file, n)) {
        if (destroyed) return;
        if (u) { thumbUrls.push(u); cells[i].style.backgroundImage = `url("${u}")`; cells[i].classList.add('in'); }
        i++;
      }
    } catch { /* filmstrip is cosmetic */ }
  })();

  setTab('trim'); paintSummary();
  return {
    el,
    get busy() { return !!ac; },
    hide() { video.pause(); musicEl?.pause(); },
    destroy() {
      destroyed = true; ac?.abort(); ro.disconnect(); cancelAnimationFrame(rafId);
      removeEventListener('keydown', onKey);
      video.pause(); video.removeAttribute('src'); video.load();
      musicEl?.pause(); if (musicUrl) URL.revokeObjectURL(musicUrl);
      URL.revokeObjectURL(url); thumbUrls.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u));
      el.remove();
    },
  };
}
