// Lightweight video thumbnail via <video> (kept separate so pages load without the media engine).
/** Grab a still frame (for thumbnails / "save frame") using a <video> element. */
export function videoThumb(file, at = 0.1, max = 320) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.src = url;
    const done = (r) => { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); res(r); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(v.duration * at || 0, 3); };
    v.onseeked = () => {
      const s = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas'); c.width = v.videoWidth * s; c.height = v.videoHeight * s;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      done(c.toDataURL('image/jpeg', 0.7));
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
}

