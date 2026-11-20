// Text reading (OCR) on this device with tesseract.js. English language data (11 MB) and the engine are
// served from /ocr, downloaded the first time and cached for offline use. One worker, jobs take turns.
import { toBlob } from './image.js';

const base = () => new URL('./', location.href).href;
let workerP = null;
let logger = null;
let line = Promise.resolve();

async function worker(onStatus) {
  if (!workerP) {
    onStatus?.('Loading the text reader (first time only)…');
    workerP = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, {
        workerPath: base() + 'ocr/worker.min.js',
        corePath: base() + 'ocr/core',
        langPath: base() + 'ocr/lang',
        workerBlobURL: false,
        logger: (m) => logger?.(m),
      });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}
/** Run jobs one after another on the single worker. */
function queued(fn) {
  const next = line.then(fn, fn);
  line = next.catch(() => {});
  return next;
}
/** Download the OCR engine ahead of time (for offline use). */
export const prefetchOCR = () => worker();

/**
 * Read text from an image (Blob or canvas).
 * Returns { text, pdf?: Uint8Array (text-only PDF layer, same size as the image at `dpi`), confidence }.
 */
export function ocrImage(img, { onProgress, onStatus, textLayer = false, dpi = 200 } = {}) {
  return queued(async () => {
    const w = await worker(onStatus);
    onStatus?.('Reading text…');
    logger = (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); };
    try {
      await w.setParameters({ user_defined_dpi: String(dpi) });
      const src = img instanceof Blob ? img : await toBlob(img, 'image/png');
      const { data } = await w.recognize(src, textLayer ? { pdfTextOnly: true, pdfTitle: 'Morph' } : {}, { text: true, pdf: textLayer });
      return { text: data.text || '', pdf: data.pdf ? new Uint8Array(data.pdf) : null, confidence: data.confidence };
    } finally { logger = null; }
  });
}
