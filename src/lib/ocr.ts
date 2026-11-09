// On-device OCR of the card's collector line with tesseract.js. The engine + English data (~4.5 MB from the
// jsDelivr CDN, cached by the service worker) load lazily into one long-lived worker.
import type { LoggerMessage, PSM, Worker as TesseractWorker } from 'tesseract.js';
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
  type Rect,
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

/**
 * The passes for a low-resolution band (a live 1080p camera frame gives a ~400 px wide band: the number is ~14 px tall
 * and soft, and the card's surroundings flatten the contrast). Lower thresholds in sparse-text mode read those best:
 * over 112 test reads of fake-camera frames of a real card at 75–95% of the guide, this list voted 52 right and 5 wrong
 * numbers, CODE_PASSES 38 right and 24 wrong (its thr70 and negate passes almost never read them right).
 */
export const LOW_RES_PASSES: readonly CodePass[] = [
  { name: 'lo-thr50', threshold: 50, psm: '11' },
  { name: 'lo-thr80', threshold: 80, psm: '11' },
  { name: 'lo-thr60', threshold: 60, psm: '11' },
  { name: 'lo-thr128', threshold: 128, psm: '11' },
  { name: 'lo-thr100', threshold: 100, psm: '11' },
  { name: 'lo-thr60-shear', threshold: 60, shear: 0.2, psm: '11' },
];
/** A band narrower than this many source px is read with LOW_RES_PASSES (photo crops give ~700 px). */
const LOW_RES_BAND_PX = 520;

const STRIP_WIDTH = 1400; // makes the code glyphs ~35–45 px tall
const QUIET_ZONE = 24;
// Tesseract takes literal characters, not ranges.
const WHITELIST = '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-';

/** Shared first step for every pass: grayscale + 1–99% contrast stretch of the resampled code strip. */
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

/**
 * A scan waiting for the engine gives up after the engine has been silent this long (since the scan started waiting or
 * the last load progress) and offers typing instead. The load itself goes on, and the next scan picks it up.
 */
const WAIT_STALL_MS = 30_000;
/**
 * A load step (worker script, engine core, language data) silent this long counts as dead: the worker is terminated and
 * forgotten, so the next scan starts a fresh download. tesseract.js reports progress only at the start and end of each
 * download, so this has to cover the ~3 MB language file on a slow link (~200 kbps).
 */
const LOAD_STALL_MS = 150_000;
/** One recognize call on a code strip takes well under a second on desktop and a few on old phones. */
const PASS_TIMEOUT_MS = 20_000;
/** How often a waiting scan checks whether it was stopped or has waited long enough. */
const WAIT_POLL_MS = 150;

/** tesseract.js load statuses → their share of the 'loading' stage (0..1). */
const LOAD_STEPS: Record<string, readonly [number, number]> = {
  'loading tesseract core': [0, 0.45],
  'initializing tesseract': [0.45, 0.5],
  'loading language traineddata': [0.5, 0.95],
  'initializing api': [0.95, 1],
};

interface Engine {
  worker: Promise<TesseractWorker>;
  /** true once the worker is ready, false when loading failed or was dead for LOAD_STALL_MS. Never rejects. */
  ready: Promise<boolean>;
  warm: boolean;
  /** Load progress 0..1 so far, and the scans waiting to hear about it. */
  progress: number;
  listeners: Set<(progress: number) => void>;
  /** Date.now() of the last load progress (or the start). */
  lastProgressAt: number;
  /** Stop the worker and forget it, so the next scan starts a fresh one. */
  kill: () => void;
}

let engine: Engine | undefined;

/**
 * Run `create` while noting the Web Worker it constructs. tesseract.js spawns its worker synchronously but
 * hands it out only once fully loaded, so without this a stuck load could never be terminated.
 */
function withSpawnedWorker<T>(create: () => T): { result: T; spawned?: Worker } {
  const g = globalThis as { Worker?: typeof Worker };
  const Native = g.Worker;
  let spawned: Worker | undefined;
  try {
    if (Native) g.Worker = new Proxy(Native, { construct: (target, args) => (spawned = Reflect.construct(target, args)) });
  } catch {
    // read-only global: a stuck worker just idles
  }
  try {
    const result = create();
    return { result, spawned };
  } finally {
    if (Native) g.Worker = Native;
  }
}

function getEngine(): Engine {
  if (engine) return engine;
  let spawned: Worker | undefined;
  let fail: (reason: unknown) => void = () => undefined;
  // tesseract.js rejects createWorker only when its first step fails; a failed language download or
  // initialization goes to errorHandler and leaves the promise pending forever, so race it against that.
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(new Error('OCR engine load stalled')), LOAD_STALL_MS);
    e.lastProgressAt = Date.now();
  };
  const e: Engine = {
    worker: failed,
    ready: Promise.resolve(false),
    warm: false,
    progress: 0,
    listeners: new Set(),
    lastProgressAt: Date.now(),
    kill: () => undefined,
  };
  const onLog = (m: LoggerMessage) => {
    const step = LOAD_STEPS[m.status];
    if (!step || e.warm) return;
    arm();
    e.progress = Math.max(e.progress, step[0] + (step[1] - step[0]) * (m.progress || 0));
    e.listeners.forEach((l) => l(e.progress));
  };
  arm();
  // Dynamic import keeps tesseract.js out of the main bundle.
  const created = import('tesseract.js').then((t) => {
    const made = withSpawnedWorker(() =>
      t.createWorker('eng', t.OEM.LSTM_ONLY, {
        // Also called for failed jobs after loading; `fail` is a no-op once the race below settled.
        errorHandler: (err: unknown) => fail(err),
        logger: onLog,
      }),
    );
    spawned = made.spawned;
    return made.result;
  });
  created.catch(() => undefined);
  e.kill = () => {
    clearTimeout(timer);
    if (engine === e) engine = undefined;
    spawned?.terminate();
    created.then((w) => w.terminate(), () => undefined);
  };
  e.worker = Promise.race([created, failed]);
  e.ready = e.worker.then(
    () => {
      clearTimeout(timer);
      e.warm = true;
      return true;
    },
    () => {
      e.kill(); // let the next scan retry with a fresh worker and download
      return false;
    },
  );
  engine = e;
  return e;
}

/** Start loading the OCR engine (call when the Scan screen opens). Idempotent; never rejects. */
export function preloadOcr(): Promise<void> {
  return getEngine().ready.then(() => undefined);
}

/** True while the engine is still downloading (a scan that gave up on it can say "try again in a minute"). */
export function ocrLoading(): boolean {
  return !!engine && !engine.warm;
}

/**
 * The ready worker, or why there is none: 'stopped' within WAIT_POLL_MS of isStale, 'unavailable' when loading failed
 * or the engine stayed silent for WAIT_STALL_MS while this scan waited. Giving up never stops the load: a slow
 * download finishes in the background for the next scan.
 */
async function waitForEngine(
  onProgress: ProgressFn | undefined,
  isStale: (() => boolean) | undefined,
): Promise<{ e: Engine; worker: TesseractWorker } | 'stopped' | 'unavailable'> {
  const e = getEngine();
  if (e.warm) return { e, worker: await e.worker };
  const report = (p: number) => onProgress?.('loading', p);
  report(e.progress);
  e.listeners.add(report);
  const since = Date.now();
  let poll: ReturnType<typeof setInterval> | undefined;
  try {
    const gaveUp = new Promise<'stopped' | 'unavailable'>((resolve) => {
      poll = setInterval(() => {
        if (isStale?.()) resolve('stopped');
        else if (Date.now() - Math.max(since, e.lastProgressAt) >= WAIT_STALL_MS) resolve('unavailable');
      }, WAIT_POLL_MS);
    });
    const ok = await Promise.race([e.ready, gaveUp]);
    if (typeof ok === 'string') return ok;
    if (!ok) return 'unavailable';
    report(1);
    return { e, worker: await e.worker };
  } finally {
    clearInterval(poll);
    e.listeners.delete(report);
  }
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

/** 'done': the passes ran (maybe stopped early by shouldStop). 'stopped': isStale said so. 'unavailable': no engine. */
export type CodeStripStatus = 'done' | 'stopped' | 'unavailable';

export interface CodeStripResult {
  passes: CodeStripPass[];
  merged: ParsedCode;
  status: CodeStripStatus;
}

export interface ReadCodeOptions {
  /** 'loading' 0..1 while the engine loads (first scan only), then 'reading' i/n after each pass. */
  onProgress?: ProgressFn;
  /** Checked after every pass with the merged parse so far; return true to skip the remaining passes. */
  shouldStop?: (merged: ParsedCode, parsed: ParsedCode[]) => boolean | Promise<boolean>;
  /** True once nobody wants this result any more (the kid stopped): checked while waiting and before every pass. */
  isStale?: () => boolean;
  /** Run at most this many passes (the best ones of CODE_PASSES, or LOW_RES_PASSES for a small band), for cheap extra tries. */
  maxPasses?: number;
  /** The part of the card to read, as fractions (default CODE_STRIP). */
  band?: Rect;
  parse?: ParseOptions;
}

const empty = (status: CodeStripStatus): CodeStripResult => ({ passes: [], merged: mergeParses([]), status });

/**
 * OCR the collector line of a cropped card (63:88) with up to 6 passes. Never throws: failures give empty
 * results, with status 'unavailable' when the engine could not load (or died) and 'stopped' when isStale.
 */
export async function readCodeStrip(card: HTMLCanvasElement, opts: ReadCodeOptions = {}): Promise<CodeStripResult> {
  if (opts.isStale?.()) return empty('stopped');
  const ready = await waitForEngine(opts.onProgress, opts.isStale);
  if (typeof ready === 'string') return empty(ready);
  return serial(() => (opts.isStale?.() ? Promise.resolve(empty('stopped')) : runPasses(ready, card, opts)));
}

async function runPasses(
  { e, worker }: { e: Engine; worker: TesseractWorker },
  card: HTMLCanvasElement,
  { onProgress, shouldStop, isStale, maxPasses, band, parse }: ReadCodeOptions,
): Promise<CodeStripResult> {
  const passes: CodeStripPass[] = [];
  const parsedSoFar = () => passes.map((p) => p.parsed);
  let status: CodeStripStatus = 'done';
  try {
    const { px, sourceWidth } = readStrip(card, band ?? CODE_STRIP);
    const strip = prepareStrip(px);
    const list = sourceWidth < LOW_RES_BAND_PX ? LOW_RES_PASSES : CODE_PASSES;
    const todo = list.slice(0, Math.max(1, maxPasses ?? list.length));
    onProgress?.('reading', 0);
    for (const pass of todo) {
      if (isStale?.()) {
        status = 'stopped';
        break;
      }
      const text = await recognize(e, worker, preparePass(strip, pass), pass);
      if (text === null) {
        status = 'unavailable'; // the worker hung or died: it was reset, the next scan gets a new one
        break;
      }
      passes.push({ text, parsed: parsePrintedCode(text, parse) });
      onProgress?.('reading', passes.length / todo.length);
      if (isStale?.()) {
        status = 'stopped';
        break;
      }
      if (await shouldStop?.(mergeParses(parsedSoFar()), parsedSoFar())) break;
    }
  } catch {
    // OCR is best-effort: the UI falls back to typed search.
  }
  return { passes, merged: mergeParses(parsedSoFar()), status };
}

/** The band resampled to STRIP_WIDTH, and how many source px wide it was. */
function readStrip(card: HTMLCanvasElement, band: Rect): { px: Pixels; sourceWidth: number } {
  const region = cropRegion(card, band.x, band.y, band.w, band.h);
  const sourceWidth = region.width;
  const big = upscaleTo(region, STRIP_WIDTH);
  const px = readPixels(big);
  releaseCanvas(region);
  releaseCanvas(big);
  return { px, sourceWidth };
}

/** Words whose box comes this close (px) to the band's top or bottom edge were cut by it. */
const EDGE_MARGIN = 3;

/**
 * Text from Tesseract's TSV output without the words touching the top or bottom edge of the strip: a number
 * cut in half by the band edge reads as another number ("084" → "053") and must not be voted for.
 * `top`/`bottom` are the strip's rows inside the padded image. Undefined when the TSV is missing or malformed.
 */
export function interiorText(tsv: string | null | undefined, top: number, bottom: number): string | undefined {
  if (!tsv) return undefined;
  const lines = new Map<string, string[]>();
  for (const row of tsv.split('\n')) {
    const f = row.split('\t');
    // level page block par line word left top width height conf text
    if (f.length < 12 || f[0] !== '5') continue;
    const y0 = Number(f[7]);
    const y1 = y0 + Number(f[9]);
    const text = f.slice(11).join('\t').trim();
    if (!text || !Number.isFinite(y0) || !Number.isFinite(y1)) continue;
    if (y0 <= top + EDGE_MARGIN || y1 >= bottom - EDGE_MARGIN) continue;
    const key = `${f[2]}.${f[3]}.${f[4]}`;
    const words = lines.get(key) ?? [];
    words.push(text);
    lines.set(key, words);
  }
  return [...lines.values()].map((w) => w.join(' ')).join('\n');
}

/** Resolves undefined after `ms`, and clears its timer when `p` settles first. */
function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** One pass's text; '' when Tesseract failed on it, null when the worker hung (it is then reset). */
async function recognize(e: Engine, worker: TesseractWorker, img: Pixels, pass: CodePass): Promise<string | null> {
  const canvas = pixelsToCanvas(img);
  try {
    const job = (async () => {
      await worker.setParameters({
        tessedit_pageseg_mode: pass.psm as PSM,
        tessedit_char_whitelist: WHITELIST,
        // Tesseract writes notes like "Estimating resolution as 373" to stderr, which surface as console errors.
        debug_file: '/dev/null',
      });
      const { data } = await worker.recognize(canvas, {}, { text: true, tsv: true });
      return interiorText(data.tsv, QUIET_ZONE, img.height - QUIET_ZONE) ?? data.text;
    })();
    const text = await within(
      job.catch(() => ''),
      PASS_TIMEOUT_MS,
    );
    if (text === undefined) {
      e.kill();
      return null;
    }
    return text;
  } finally {
    releaseCanvas(canvas);
  }
}
