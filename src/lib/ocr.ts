// On-device OCR of the card's collector line with tesseract.js. The engine + English data (~4.5 MB from the
// jsDelivr CDN, cached by the service worker) load lazily into one long-lived worker.
import type { PSM, Worker as TesseractWorker } from 'tesseract.js';
import {
  CODE_STRIP,
  contrastStretch,
  cropRegion,
  grayscale,
  negate,
  pad,
  pixelsToCanvas,
  readPixels,
  releaseCanvas,
  shear,
  threshold,
  upscaleTo,
  type Pixels,
} from './imageProc';
import { mergeParses, parsePrintedCode, type ParseOptions, type ParsedCode } from './parseCode';
import type { ProgressFn } from './types';

export interface CodePass {
  name: string;
  threshold?: number;
  negate?: boolean;
  shear?: number;
  /** Tesseract page segmentation: 11 = sparse text, 6 = single block. */
  psm: '6' | '11';
}

/**
 * Tuned on a real JA photo and EN scans. The collector line mixes polarities (dark "G", white "sv8a" in a dark
 * box, dark italic number with a white outline on holo), so no single preprocessing reads all of it; each pass
 * catches a different part and the parses are voted together. Ordered best-first for early exit.
 */
export const CODE_PASSES: readonly CodePass[] = [
  { name: 'thr80', threshold: 80, psm: '11' }, // best single pass; never wrong in testing
  { name: 'thr70', threshold: 70, psm: '6' }, // most reliable for the set code
  { name: 'thr50-shear', threshold: 50, shear: 0.2, psm: '11' }, // straightens the italic number
  { name: 'thr128', threshold: 128, psm: '11' }, // light card borders
  { name: 'negate', negate: true, psm: '6' }, // white text on dark art
  { name: 'thr60', threshold: 60, psm: '11' },
];

const STRIP_WIDTH = 1400; // makes the code glyphs ~35–45 px tall
const QUIET_ZONE = 24;
// Tesseract takes literal characters, not ranges.
const WHITELIST = '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-';

/** Shared first step for every pass: grayscale + 1–99% contrast stretch of the upscaled code strip. */
function prepareStrip(strip: Pixels): Pixels {
  return contrastStretch(grayscale(strip));
}

/** One pass's image, from the output of `prepareStrip`. */
function preparePass(strip: Pixels, pass: CodePass): Pixels {
  let img = strip;
  if (pass.negate) img = negate(img);
  if (pass.threshold !== undefined) img = threshold(img, pass.threshold);
  if (pass.shear) img = shear(img, pass.shear);
  return pad(img, QUIET_ZONE);
}

// ---------- worker lifecycle ----------

interface Engine {
  worker: Promise<TesseractWorker>;
  ready: Promise<void>;
  warm: boolean;
}

let engine: Engine | undefined;

function getEngine(): Engine {
  if (!engine) {
    // Dynamic import keeps tesseract.js out of the main bundle.
    const worker = import('tesseract.js').then((t) => t.createWorker('eng', t.OEM.LSTM_ONLY));
    const e: Engine = { worker, warm: false, ready: Promise.resolve() };
    e.ready = worker.then(
      () => {
        e.warm = true;
      },
      () => {
        if (engine === e) engine = undefined; // let the next scan retry a failed download
      },
    );
    engine = e;
  }
  return engine;
}

/** Start loading the OCR engine (call when the Scan screen opens). Idempotent; never rejects. */
export function preloadOcr(): Promise<void> {
  return getEngine().ready;
}

// One worker: interleaving setParameters/recognize from two scans would mix up their page modes.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

// ---------- reading ----------

export interface CodeStripPass {
  text: string;
  parsed: ParsedCode;
}

export interface CodeStripResult {
  passes: CodeStripPass[];
  merged: ParsedCode;
}

export interface ReadCodeOptions {
  /** 'loading' while the engine loads (first scan only), then 'reading' i/6 after each pass. */
  onProgress?: ProgressFn;
  /** Checked after every pass with the merged parse so far; return true to skip the remaining passes. */
  shouldStop?: (merged: ParsedCode, parsed: ParsedCode[]) => boolean | Promise<boolean>;
  parse?: ParseOptions;
}

/** OCR the collector line of a cropped card (63:88) with up to 6 passes. Never throws: failures give empty results. */
export function readCodeStrip(card: HTMLCanvasElement, opts: ReadCodeOptions = {}): Promise<CodeStripResult> {
  return serial(() => runPasses(card, opts));
}

async function runPasses(card: HTMLCanvasElement, { onProgress, shouldStop, parse }: ReadCodeOptions): Promise<CodeStripResult> {
  const passes: CodeStripPass[] = [];
  const parsedSoFar = () => passes.map((p) => p.parsed);
  try {
    const { worker: workerP, warm } = getEngine();
    if (!warm) onProgress?.('loading', 0);
    const worker = await workerP;
    if (!warm) onProgress?.('loading', 1);

    const strip = prepareStrip(readStrip(card));
    onProgress?.('reading', 0);
    for (const pass of CODE_PASSES) {
      const text = await recognize(worker, preparePass(strip, pass), pass);
      passes.push({ text, parsed: parsePrintedCode(text, parse) });
      onProgress?.('reading', passes.length / CODE_PASSES.length);
      if (await shouldStop?.(mergeParses(parsedSoFar()), parsedSoFar())) break;
    }
  } catch {
    // OCR is best-effort: the UI falls back to typed search.
  }
  return { passes, merged: mergeParses(parsedSoFar()) };
}

function readStrip(card: HTMLCanvasElement): Pixels {
  const region = cropRegion(card, CODE_STRIP.x, CODE_STRIP.y, CODE_STRIP.w, CODE_STRIP.h);
  const big = upscaleTo(region, STRIP_WIDTH);
  const px = readPixels(big);
  releaseCanvas(region);
  releaseCanvas(big);
  return px;
}

async function recognize(worker: TesseractWorker, img: Pixels, pass: CodePass): Promise<string> {
  const canvas = pixelsToCanvas(img);
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: pass.psm as PSM,
      tessedit_char_whitelist: WHITELIST,
      // Tesseract writes notes like "Estimating resolution as 373" to stderr, which surface as console errors.
      debug_file: '/dev/null',
    });
    const { data } = await worker.recognize(canvas);
    return data.text;
  } catch {
    return '';
  } finally {
    releaseCanvas(canvas);
  }
}
