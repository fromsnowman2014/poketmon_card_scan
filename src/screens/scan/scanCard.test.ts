import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentifyOutcome } from '../../lib/identify';
import type { CodeStripStatus } from '../../lib/ocr';
import type { CardBrief, PrintedCode } from '../../lib/types';

const identifyCard = vi.fn<(card: unknown, onProgress?: unknown, opts?: unknown) => Promise<IdentifyOutcome>>();
const resolveSets = vi.fn();
const released: unknown[] = [];

vi.mock('../../lib/identify', () => ({
  identifyCard: (card: unknown, onProgress: unknown, opts: unknown) => identifyCard(card, onProgress, opts),
}));
vi.mock('../../lib/tcgdex', () => ({ resolveSets: (...args: unknown[]) => resolveSets(...args) }));
vi.mock('../../lib/imageProc', () => ({
  SMALL_CODE_STRIP: { x: 0, y: 0.78, w: 0.55, h: 0.14 },
  upscaleTo: (card: { width: number }, width: number) => ({ ...card, width, resampled: true }),
  releaseCanvas: (c: unknown) => released.push(c),
}));

type Look = 'first' | 'small' | 'turn1' | 'turn3' | 'second';
/** Which look a call is, from what scanCard passed: the crop (turned / resampled) and the band. */
function lookOf(card: unknown, opts: unknown): Look {
  const c = card as { turned?: number; resampled?: boolean };
  if (c.resampled) return 'second';
  if (c.turned) return c.turned === 1 ? 'turn1' : 'turn3';
  return (opts as { band?: unknown } | undefined)?.band ? 'small' : 'first';
}
/** identifyCard answers per look; looks not listed read nothing. */
function reads(answers: Partial<Record<Look, IdentifyOutcome>>) {
  identifyCard.mockImplementation(async (card, onProgress, opts) => {
    (onProgress as (stage: string, p: number) => void)('reading', 0.5);
    return answers[lookOf(card, opts)] ?? result({}, []);
  });
}
const looksRun = () => identifyCard.mock.calls.map(([c, , o]) => lookOf(c, o));

const { isSure, scanCard } = await import('./scanCard');

const card = (id: string, localId: string, setId: string): CardBrief => ({ id, lang: 'ja', localId, name: id, setId });
const hawlucha = card('SV8a-084', '084', 'SV8a');
const ruins = card('E3-083', '083', 'E3');
const result = (code: PrintedCode, candidates: CardBrief[], status: CodeStripStatus = 'done'): IdentifyOutcome => ({
  rawText: '',
  code,
  candidates,
  status,
});
const setScore = (id: string, score: number) => [{ lang: 'ja', set: { id }, score }];
const canvas = (width: number) => ({ width }) as unknown as HTMLCanvasElement;
const sureCode: PrintedCode = { setCode: 'SV8a', number: '084', total: '187', lang: 'ja' };

beforeEach(() => {
  identifyCard.mockReset();
  resolveSets.mockReset();
  released.length = 0;
});

describe('isSure', () => {
  const full: PrintedCode = { setCode: 'SV8a', number: '084', total: '187', lang: 'ja' };

  it('trusts one candidate whose set code and total name its set', async () => {
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    expect(await isSure(result(full, [hawlucha]))).toBe(true);
    expect(resolveSets).toHaveBeenCalledWith(full, ['ja']);
  });

  it('doubts a fuzzy set match (misread total or set code)', async () => {
    resolveSets.mockResolvedValue([...setScore('CP6', 0.4), ...setScore('E3', 0.4)]);
    expect(await isSure(result({ setCode: 'SV8a', number: '083', total: '087', lang: 'ja' }, [ruins]))).toBe(false);
  });

  it('doubts a candidate from another set than the one read', async () => {
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    expect(await isSure(result(full, [card('S8b-084', '084', 'S8b')]))).toBe(false);
  });

  it('needs the set code, the total and a matching number', async () => {
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    expect(await isSure(result({ number: '084', total: '187' }, [hawlucha]))).toBe(false);
    expect(await isSure(result({ setCode: 'SV8a', number: '084' }, [hawlucha]))).toBe(false);
    expect(await isSure(result({ ...full, number: '085' }, [hawlucha]))).toBe(false);
    expect(await isSure(result({ ...full, number: '84' }, [hawlucha]))).toBe(true); // leading zeros don't matter
  });

  it('doubts several candidates, or a failed set lookup', async () => {
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    expect(await isSure(result(full, [hawlucha, ruins]))).toBe(false);
    resolveSets.mockRejectedValue(new Error('offline'));
    expect(await isSure(result(full, [hawlucha]))).toBe(false);
  });
});

describe('scanCard', () => {
  const sure: PrintedCode = { setCode: 'SV8a', number: '084', total: '187', lang: 'ja' };
  const misread: PrintedCode = { setCode: 'SV8a', number: '083', total: '087', lang: 'ja' };

  it('stops after one look when it is sure', async () => {
    identifyCard.mockResolvedValueOnce(result(sure, [hawlucha]));
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    expect(await scanCard(canvas(692), () => undefined)).toEqual({ code: sure, candidates: [hawlucha], sure: true, status: 'done' });
    expect(identifyCard).toHaveBeenCalledTimes(1);
  });

  it('takes a second look at an upscaled copy of a small crop', async () => {
    identifyCard.mockResolvedValueOnce(result(misread, [ruins])).mockResolvedValueOnce(result(sure, [hawlucha]));
    resolveSets.mockImplementation(async (code: PrintedCode) =>
      code.total === '187' ? setScore('SV8a', 1) : setScore('E3', 0.4),
    );
    expect(await scanCard(canvas(692), () => undefined)).toEqual({ code: sure, candidates: [hawlucha], sure: true, status: 'done' });
    expect(identifyCard.mock.calls[1][0]).toMatchObject({ width: 1100, resampled: true });
  });

  it('shrinks a large crop for the second look', async () => {
    reads({ first: result(misread, [ruins]) });
    resolveSets.mockResolvedValue(setScore('E3', 0.4));
    await scanCard(canvas(1600), () => undefined);
    expect(identifyCard.mock.calls[1][0]).toMatchObject({ width: 1120 });
  });

  it('offers every candidate from both looks when neither is sure', async () => {
    const other = card('SV8a-064', '064', 'SV8a');
    identifyCard
      .mockResolvedValueOnce(result(misread, [ruins]))
      .mockResolvedValueOnce(result({ number: '064', total: '187' }, [other, ruins]));
    resolveSets.mockResolvedValue(setScore('E3', 0.4));
    expect(await scanCard(canvas(692), () => undefined)).toEqual({
      code: misread,
      candidates: [ruins, other],
      sure: false,
      status: 'done',
    });
  });

  it('keeps the read that has a number for the form', async () => {
    reads({ first: result({ setCode: 'SV8a' }, []), second: result({ number: '084' }, []) });
    expect((await scanCard(canvas(692), () => undefined)).code).toEqual({ number: '084' });
  });
});

describe('scanCard on a card held small in the frame', () => {
  it('reads the band above the usual one when the first look read no number', async () => {
    reads({ small: result(sureCode, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const looks: unknown[] = [];
    const outcome = await scanCard(canvas(692), (_s, _p, look) => looks.push(look), { turned: vi.fn() });
    expect(outcome).toMatchObject({ sure: true, candidates: [hawlucha], band: { y: 0.78 } });
    expect(looksRun()).toEqual(['first', 'small']);
    expect(identifyCard.mock.calls[1][2]).toMatchObject({ maxPasses: 3 });
    expect(looks).toContain(2);
  });

  it('takes the second look in that band too', async () => {
    reads({ small: result({ number: '084', total: '187' }, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const outcome = await scanCard(canvas(692), () => undefined);
    expect(looksRun()).toEqual(['first', 'small', 'second']);
    expect(identifyCard.mock.calls[2][2]).toMatchObject({ band: { y: 0.78 } });
    expect(outcome).toMatchObject({ sure: false, candidates: [hawlucha], band: { y: 0.78 } });
  });
});

describe('scanCard cancellation and engine failures', () => {
  it('passes isStale down and stops without a second look once stale', async () => {
    let stale = false;
    const isStale = () => stale;
    identifyCard.mockImplementationOnce(async () => {
      stale = true;
      return result({ number: '084' }, [], 'stopped');
    });
    const outcome = await scanCard(canvas(692), () => undefined, { isStale });
    expect(outcome.status).toBe('stopped');
    expect(identifyCard).toHaveBeenCalledTimes(1);
    expect(identifyCard.mock.calls[0][2]).toMatchObject({ isStale });
  });

  it('skips the second look when the kid stopped after the first', async () => {
    let stale = false;
    identifyCard.mockImplementationOnce(async () => {
      stale = true;
      return result(sureCode, [ruins]);
    });
    resolveSets.mockResolvedValue(setScore('E3', 0.4));
    const outcome = await scanCard(canvas(692), () => undefined, { isStale: () => stale });
    expect(outcome).toMatchObject({ status: 'stopped', candidates: [] });
    expect(identifyCard).toHaveBeenCalledTimes(1);
  });

  it('reports an OCR engine that could not load, without more looks', async () => {
    identifyCard.mockResolvedValue(result({}, [], 'unavailable'));
    const turned = vi.fn();
    const outcome = await scanCard(canvas(692), () => undefined, { turned });
    expect(outcome).toMatchObject({ status: 'unavailable', candidates: [], sure: false });
    expect(identifyCard).toHaveBeenCalledTimes(1);
    expect(turned).not.toHaveBeenCalled();
  });
});

describe('scanCard on a sideways photo', () => {
  const turnedCanvas = (q: number) => ({ width: 700, turned: q }) as unknown as HTMLCanvasElement;

  it('reads the photo turned 90° when nothing was read upright', async () => {
    reads({ turn1: result(sureCode, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const turned = vi.fn(turnedCanvas);
    const looks: unknown[] = [];
    const outcome = await scanCard(canvas(692), (_s, _p, look) => looks.push(look), { turned });
    expect(outcome).toMatchObject({ sure: true, status: 'done', candidates: [hawlucha] });
    expect(outcome.card).toMatchObject({ turned: 1 });
    expect(outcome.band).toBeUndefined();
    expect(turned.mock.calls).toEqual([[1]]);
    expect(looksRun()).toEqual(['first', 'small', 'turn1']);
    expect(identifyCard.mock.calls[2][2]).toMatchObject({ maxPasses: 2 });
    expect(looks).toContain('turn');
  });

  it('tries 270° after 90°, and frees the turned crop that read nothing', async () => {
    reads({ turn3: result(sureCode, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const turned = vi.fn(turnedCanvas);
    const outcome = await scanCard(canvas(692), () => undefined, { turned });
    expect(turned.mock.calls).toEqual([[1], [3]]);
    expect(outcome.card).toMatchObject({ turned: 3 });
    expect(released).toContainEqual(expect.objectContaining({ turned: 1 }));
    expect(released).not.toContainEqual(expect.objectContaining({ turned: 3 }));
  });

  it('takes the second look at the turned crop when the turned read is not sure', async () => {
    reads({ turn1: result({ number: '084', total: '187' }, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const outcome = await scanCard(canvas(692), () => undefined, { turned: turnedCanvas });
    expect(identifyCard.mock.calls[3][0]).toMatchObject({ turned: 1, resampled: true });
    expect(outcome).toMatchObject({ sure: false, candidates: [hawlucha], code: { number: '084' } });
    expect(outcome.card).toMatchObject({ turned: 1 });
  });

  it('does not turn a photo whose number was read', async () => {
    reads({ first: result({ number: '083', total: '087' }, [ruins]) });
    resolveSets.mockResolvedValue(setScore('E3', 0.4));
    const turned = vi.fn(turnedCanvas);
    await scanCard(canvas(692), () => undefined, { turned });
    expect(turned).not.toHaveBeenCalled();
    expect(looksRun()).toEqual(['first', 'second']);
  });

  it('does not turn a photo whose number was found in the higher band', async () => {
    reads({ small: result({ number: '084', total: '187' }, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const turned = vi.fn(turnedCanvas);
    await scanCard(canvas(692), () => undefined, { turned });
    expect(turned).not.toHaveBeenCalled();
  });

  it('gives up on extra looks after the time budget when nothing was read', async () => {
    let clock = 0;
    identifyCard.mockImplementation(async () => {
      clock += 5000; // a slow phone
      return result({}, []);
    });
    const turned = vi.fn(turnedCanvas);
    const outcome = await scanCard(canvas(692), () => undefined, { turned, now: () => clock });
    // 5 s: the higher band; 10 s: out of budget, so no turning and no second look
    expect(looksRun()).toEqual(['first', 'small']);
    expect(turned).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'done', candidates: [], sure: false });
  });

  it('keeps going when the photo is gone', async () => {
    identifyCard.mockResolvedValue(result({}, []));
    const outcome = await scanCard(canvas(692), () => undefined, {
      turned: () => {
        throw new Error('closed');
      },
    });
    expect(outcome.status).toBe('done');
    expect(looksRun()).toEqual(['first', 'small', 'second']);
  });
});
