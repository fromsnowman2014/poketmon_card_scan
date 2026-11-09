import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Canvas work is stubbed (Node has no canvas); the engine lifecycle and pass loop run for real.
/** Source px width of the band cropRegion returns (the low-resolution pass list is picked from it). */
const band = { width: 700 };
vi.mock('./imageProc', () => {
  const px = (height = 40) => ({ data: new Uint8ClampedArray(0), width: 100, height });
  return {
    CODE_STRIP: { x: 0, y: 0.84, w: 0.55, h: 0.16 },
    contrastStretch: (p: unknown) => p,
    grayscale: (p: unknown) => p,
    negate: (p: unknown) => p,
    threshold: (p: unknown) => p,
    shear: (p: unknown) => p,
    pad: (p: { height: number }, q: number) => px(p.height + 2 * q),
    cropRegion: () => ({ width: band.width }),
    upscaleTo: () => ({}),
    readPixels: () => px(),
    pixelsToCanvas: () => ({}),
    releaseCanvas: () => undefined,
  };
});

const createWorker = vi.fn();
vi.mock('tesseract.js', () => ({ createWorker: (...args: unknown[]) => createWorker(...args), OEM: { LSTM_ONLY: 1 } }));

type Options = { errorHandler: (e: unknown) => void; logger: (m: { status: string; progress: number }) => void };

interface FakeWorker {
  setParameters: ReturnType<typeof vi.fn>;
  recognize: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

function fakeWorker(texts: string[] = ['G sv8a 084/187']): FakeWorker {
  let i = 0;
  return {
    setParameters: vi.fn(async () => undefined),
    recognize: vi.fn(async () => ({ data: { text: texts[Math.min(i++, texts.length - 1)], tsv: null } })),
    terminate: vi.fn(async () => undefined),
  };
}

/** Each createWorker call: records its options and constructs a Web Worker synchronously, like tesseract.js. */
function workerFactory(behave: (opts: Options, call: number) => Promise<FakeWorker>) {
  const options: Options[] = [];
  createWorker.mockImplementation((_lang: string, _oem: number, opts: Options) => {
    options.push(opts);
    new (globalThis as unknown as { Worker: new (url: string) => unknown }).Worker('blob:tesseract');
    return behave(opts, options.length);
  });
  return options;
}

const spawned: { terminated: boolean }[] = [];
class FakeWebWorker {
  terminated = false;
  constructor() {
    spawned.push(this);
  }
  terminate() {
    this.terminated = true;
  }
}

const card = {} as HTMLCanvasElement;
const never = <T,>() => new Promise<T>(() => undefined);

/** A fresh ocr.ts (it keeps one engine per page). Fake timers leave setImmediate real: dynamic imports need it. */
async function load(fakeTimers = false) {
  vi.resetModules();
  const ocr = await import('./ocr');
  if (fakeTimers) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  return ocr;
}

/** Let ocr.ts's `import('tesseract.js')` resolve (real event-loop turns, fake clock standing still). */
async function untilCreated(n = 1) {
  while (createWorker.mock.calls.length < n) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  createWorker.mockReset();
  spawned.length = 0;
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWebWorker;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { Worker?: unknown }).Worker;
});

describe('interiorText', () => {
  const row = (line: number, top: number, height: number, text: string) =>
    ['5', '1', '1', '1', String(line), '1', '10', String(top), '50', String(height), '90', text].join('\t');

  it('drops words cut by the top or bottom edge of the strip', async () => {
    const { interiorText } = await load();
    const tsv = [
      '1\t1\t0\t0\t0\t0\t0\t0\t500\t200\t-1\t', // page row
      row(1, 24, 20, '053'), // touches the top edge (strip starts at row 24): the number cut in half
      row(2, 80, 30, 'sv8a'),
      row(2, 82, 30, '084/187'),
      row(3, 150, 27, 'Illus'), // ends at 177, the strip's last row is 176
    ].join('\n');
    expect(interiorText(tsv, 24, 176)).toBe('sv8a 084/187');
  });

  it('keeps lines apart and gives undefined without TSV', async () => {
    const { interiorText } = await load();
    expect(interiorText([row(1, 40, 20, 'G'), row(2, 90, 20, '084/187')].join('\n'), 24, 176)).toBe('G\n084/187');
    expect(interiorText(null, 24, 176)).toBeUndefined();
    expect(interiorText('', 24, 176)).toBeUndefined();
  });
});

describe('readCodeStrip engine lifecycle', () => {
  it('reads with a ready engine and votes the passes', async () => {
    const worker = fakeWorker();
    workerFactory(async () => worker);
    const { readCodeStrip } = await load();
    const r = await readCodeStrip(card, { shouldStop: (_merged, parsed) => parsed.length >= 2 });
    expect(r.status).toBe('done');
    expect(r.merged).toMatchObject({ setCode: 'SV8a', number: '084', total: '187' });
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    expect(worker.recognize.mock.calls[0][2]).toEqual({ text: true, tsv: true });
  });

  it('gives up on a failed language download and retries with a new worker next time', async () => {
    const good = fakeWorker();
    workerFactory((opts, call) => {
      if (call === 1) {
        // tesseract.js reports this through errorHandler and never settles createWorker
        setTimeout(() => opts.errorHandler('TypeError: Failed to fetch'), 0);
        return never();
      }
      return Promise.resolve(good);
    });
    const { readCodeStrip } = await load();
    expect((await readCodeStrip(card)).status).toBe('unavailable');
    expect(spawned[0].terminated).toBe(true);
    const again = await readCodeStrip(card, { maxPasses: 1 });
    expect(again.status).toBe('done');
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('stops waiting after 30 s of silence but keeps loading, so a slow download serves the next scan', async () => {
    const worker = fakeWorker();
    let finish: (w: FakeWorker) => void = () => undefined;
    workerFactory((opts) => {
      opts.logger({ status: 'loading language traineddata', progress: 0 });
      return new Promise<FakeWorker>((resolve) => {
        finish = resolve; // the 3 MB language file: no progress until it has all arrived
      });
    });
    const { readCodeStrip, ocrLoading } = await load(true);
    const first = readCodeStrip(card);
    await untilCreated();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(ocrLoading()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await first).status).toBe('unavailable'); // the kid gets the number form now
    expect(spawned[0].terminated).toBe(false);
    expect(ocrLoading()).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    finish(worker); // arrived after 40 s
    await vi.advanceTimersByTimeAsync(10);
    expect(ocrLoading()).toBe(false);
    const second = await readCodeStrip(card, { maxPasses: 1 });
    expect(second.status).toBe('done');
    expect(createWorker).toHaveBeenCalledTimes(1); // no second download
  });

  it('gives each waiting scan its own 30 s, counted from when it started waiting', async () => {
    workerFactory(() => never());
    const { readCodeStrip, preloadOcr } = await load(true);
    void preloadOcr();
    await untilCreated();
    await vi.advanceTimersByTimeAsync(20_000); // the kid looks at the viewfinder for a while
    const late = readCodeStrip(card);
    let settled = false;
    void late.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10_500);
    expect((await late).status).toBe('unavailable');
  });

  it('drops a load that stays silent for 150 s, and the next scan starts over', async () => {
    const good = fakeWorker();
    workerFactory((_o, call) => (call === 1 ? never() : Promise.resolve(good)));
    const { readCodeStrip, ocrLoading } = await load(true);
    const first = readCodeStrip(card);
    await untilCreated();
    await vi.advanceTimersByTimeAsync(31_000);
    expect((await first).status).toBe('unavailable');
    await vi.advanceTimersByTimeAsync(100_000);
    expect(spawned[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spawned[0].terminated).toBe(true);
    expect(ocrLoading()).toBe(false);
    const next = readCodeStrip(card, { maxPasses: 1 });
    await untilCreated(2);
    await vi.advanceTimersByTimeAsync(10);
    expect((await next).status).toBe('done');
  });

  it('a scan waiting on a load that dies gets unavailable right away', async () => {
    let die: (e: unknown) => void = () => undefined;
    workerFactory((opts) => {
      die = opts.errorHandler;
      return never();
    });
    const { readCodeStrip } = await load(true);
    const pending = readCodeStrip(card);
    await untilCreated();
    await vi.advanceTimersByTimeAsync(5_000);
    die('TypeError: Failed to fetch');
    await vi.advanceTimersByTimeAsync(10);
    expect((await pending).status).toBe('unavailable');
    expect(spawned[0].terminated).toBe(true);
  });

  it('lets a slow but progressing download finish, and reports its progress', async () => {
    const worker = fakeWorker();
    workerFactory(async (opts) => {
      await new Promise((r) => setTimeout(r, 20_000));
      opts.logger({ status: 'loading tesseract core', progress: 1 });
      await new Promise((r) => setTimeout(r, 25_000));
      opts.logger({ status: 'loading language traineddata', progress: 0.5 });
      await new Promise((r) => setTimeout(r, 25_000));
      opts.logger({ status: 'loading language traineddata', progress: 1 });
      return worker;
    });
    const { readCodeStrip } = await load(true);
    const loading: number[] = [];
    const pending = readCodeStrip(card, {
      maxPasses: 1,
      onProgress: (stage, p) => stage === 'loading' && loading.push(p),
    });
    await untilCreated();
    await vi.advanceTimersByTimeAsync(75_000);
    expect((await pending).status).toBe('done');
    expect(loading).toEqual([0, 0.45, 0.725, 0.95, 1]);
  });

  it('stops waiting for the engine as soon as the scan is stopped, and keeps the load for the next scan', async () => {
    const good = fakeWorker();
    let finish: (w: FakeWorker) => void = () => undefined;
    workerFactory(() => new Promise<FakeWorker>((resolve) => (finish = resolve)));
    const { readCodeStrip } = await load(true);
    let stale = false;
    const pending = readCodeStrip(card, { isStale: () => stale });
    await untilCreated();
    await vi.advanceTimersByTimeAsync(4_000);
    stale = true;
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).status).toBe('stopped');
    expect(spawned[0].terminated).toBe(false); // silent, but maybe just a slow download: keep it
    const next = readCodeStrip(card, { maxPasses: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    finish(good);
    await vi.advanceTimersByTimeAsync(10);
    expect((await next).status).toBe('done');
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('keeps a load that is making progress when a scan is stopped', async () => {
    workerFactory((opts) => {
      setTimeout(() => opts.logger({ status: 'loading tesseract core', progress: 1 }), 3_000);
      return never();
    });
    const { readCodeStrip } = await load(true);
    let stale = false;
    const pending = readCodeStrip(card, { isStale: () => stale });
    await untilCreated();
    await vi.advanceTimersByTimeAsync(4_000);
    stale = true;
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending).status).toBe('stopped');
    expect(spawned[0].terminated).toBe(false);
  });

  it('stops between passes once stale, and honours maxPasses', async () => {
    const worker = fakeWorker(['noise']);
    workerFactory(async () => worker);
    const { readCodeStrip } = await load();
    let stale = false;
    const r = await readCodeStrip(card, {
      onProgress: (stage) => {
        if (stage === 'reading') stale = worker.recognize.mock.calls.length >= 2;
      },
      isStale: () => stale,
    });
    expect(r.status).toBe('stopped');
    expect(worker.recognize).toHaveBeenCalledTimes(2);

    worker.recognize.mockClear();
    expect((await readCodeStrip(card, { maxPasses: 3 })).passes).toHaveLength(3);
    expect(worker.recognize).toHaveBeenCalledTimes(3);
  });

  it('reads a narrow band (a live camera frame) with the low-resolution passes', async () => {
    const worker = fakeWorker(['noise']);
    workerFactory(async () => worker);
    const { readCodeStrip, CODE_PASSES, LOW_RES_PASSES } = await load();
    const psm = () => worker.setParameters.mock.calls.map(([p]) => (p as { tessedit_pageseg_mode: string }).tessedit_pageseg_mode);
    await readCodeStrip(card);
    expect(psm()).toEqual(CODE_PASSES.map((p) => p.psm));
    worker.setParameters.mockClear();
    band.width = 400;
    try {
      await readCodeStrip(card);
    } finally {
      band.width = 700;
    }
    expect(psm()).toEqual(LOW_RES_PASSES.map((p) => p.psm));
    expect(LOW_RES_PASSES).toHaveLength(CODE_PASSES.length); // the progress label counts n/6
    expect(LOW_RES_PASSES.some((p) => p.negate)).toBe(false);
  });

  it('a stopped scan does not hold up the next one', async () => {
    const worker = fakeWorker(['noise']);
    workerFactory(async () => worker);
    const { readCodeStrip, preloadOcr } = await load();
    await preloadOcr();
    const stale = readCodeStrip(card, { isStale: () => true });
    const next = readCodeStrip(card, { maxPasses: 1 });
    expect((await stale).status).toBe('stopped');
    expect((await next).status).toBe('done');
    expect(worker.recognize).toHaveBeenCalledTimes(1);
  });

  it('resets a worker that hangs on a pass', async () => {
    const hung = fakeWorker();
    hung.recognize.mockImplementation(() => never());
    const fresh = fakeWorker();
    workerFactory(async (_o, call) => (call === 1 ? hung : fresh));
    const { readCodeStrip } = await load(true);
    const pending = readCodeStrip(card);
    await untilCreated();
    await vi.advanceTimersByTimeAsync(20_500);
    expect((await pending).status).toBe('unavailable');
    expect(hung.terminate).toHaveBeenCalled();
    const again = readCodeStrip(card, { maxPasses: 1 });
    await untilCreated(2);
    await vi.advanceTimersByTimeAsync(10);
    expect((await again).status).toBe('done');
    expect(createWorker).toHaveBeenCalledTimes(2);
  });
});
