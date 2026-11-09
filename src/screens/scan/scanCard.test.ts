import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentifyOutcome } from '../../lib/identify';
import type { CodeStripStatus } from '../../lib/ocr';
import type { CardBrief, PrintedCode } from '../../lib/types';

const identifyCard = vi.fn<(card: unknown, onProgress?: unknown, opts?: unknown) => Promise<IdentifyOutcome>>();
const findCards = vi.fn<(code: PrintedCode) => Promise<CardBrief[]>>();
const resolveSets = vi.fn();
const released: unknown[] = [];

vi.mock('../../lib/identify', () => ({
  identifyCard: (card: unknown, onProgress: unknown, opts: unknown) => identifyCard(card, onProgress, opts),
  findCards: (code: PrintedCode) => findCards(code),
}));
vi.mock('../../lib/tcgdex', () => ({ resolveSets: (...args: unknown[]) => resolveSets(...args) }));
vi.mock('../../lib/imageProc', () => ({
  CODE_STRIP: { x: 0, y: 0.86, w: 0.55, h: 0.14 },
  SMALL_CODE_STRIP: { x: 0, y: 0.78, w: 0.55, h: 0.14 },
  upscaleTo: (card: { width: number }, width: number) => ({ ...card, width, resampled: true }),
  cropRegion: (card: { width: number }, _x: number, _y: number, w: number) => ({ ...card, width: card.width * w, zoom: w }),
  releaseCanvas: (c: unknown) => released.push(c),
}));

type Look = 'first' | 'small' | 'turn1' | 'turn3' | 'zoom88' | 'zoom80' | 'second';
/** Which look a call is, from what scanCard passed: the crop (turned / zoomed / resampled) and the band. */
function lookOf(card: unknown, opts: unknown): Look {
  const c = card as { turned?: number; resampled?: boolean; zoom?: number };
  if (c.resampled) return 'second';
  if (c.turned) return c.turned === 1 ? 'turn1' : 'turn3';
  if (c.zoom) return c.zoom > 0.85 ? 'zoom88' : 'zoom80';
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

const { isSure, scanCard, sameNumber, unzoom, looksSideways, LIVE_ZOOMS } = await import('./scanCard');

const card = (id: string, localId: string, setId: string): CardBrief => ({ id, lang: 'ja', localId, name: id, setId });
const hawlucha = card('SV8a-084', '084', 'SV8a');
const ruins = card('E3-083', '083', 'E3');
const result = (code: PrintedCode, candidates: CardBrief[], status: CodeStripStatus = 'done', rawText = ''): IdentifyOutcome => ({
  rawText,
  code,
  candidates,
  status,
});
/** A first look that saw some digits but no collector number (an upright card, held small). */
const digitsOnly = () => result({}, [], 'done', 'Illus 12 | 2O24');
const setScore = (id: string, score: number) => [{ lang: 'ja', set: { id }, score }];
const canvas = (width: number) => ({ width }) as unknown as HTMLCanvasElement;
/** A photo crop big enough that one sure look is trusted (CONFIRM_BELOW_PX). */
const BIG = 1200;
/** A live 1080p camera crop: a sure look needs another that agrees. */
const SMALL = 722;
const sureCode: PrintedCode = { setCode: 'SV8a', number: '084', total: '187', lang: 'ja' };

beforeEach(() => {
  identifyCard.mockReset();
  findCards.mockReset();
  findCards.mockResolvedValue([]);
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
  });

  it('needs the zeros a card prints: a lost "08" may be another card', async () => {
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    expect(await isSure(result({ ...full, number: '84' }, [hawlucha]))).toBe(false);
    expect(await isSure(result({ ...full, number: '4' }, [card('SV8a-004', '004', 'SV8a')]))).toBe(false);
    expect(await isSure(result({ ...full, number: '004' }, [card('SV8a-004', '004', 'SV8a')]))).toBe(true);
    expect(await isSure(result({ ...full, number: 'tg05' }, [card('SV8a-TG05', 'TG05', 'SV8a')]))).toBe(true);
    // A card printed without zeros ("4/102") still matches a read with a stray zero.
    expect(await isSure(result({ ...full, number: '04' }, [card('SV8a-4', '4', 'SV8a')]))).toBe(true);
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
    expect(await scanCard(canvas(BIG), () => undefined)).toEqual({ code: sure, candidates: [hawlucha], sure: true, status: 'done' });
    expect(identifyCard).toHaveBeenCalledTimes(1);
  });

  it('takes a second look at a resampled copy, and trusts it on a big crop', async () => {
    identifyCard.mockResolvedValueOnce(result(misread, [ruins])).mockResolvedValueOnce(result(sure, [hawlucha]));
    resolveSets.mockImplementation(async (code: PrintedCode) =>
      code.total === '187' ? setScore('SV8a', 1) : setScore('E3', 0.4),
    );
    expect(await scanCard(canvas(BIG), () => undefined)).toEqual({ code: sure, candidates: [hawlucha], sure: true, status: 'done' });
    expect(identifyCard.mock.calls[1][0]).toMatchObject({ width: 840, resampled: true });
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
    expect(await scanCard(canvas(BIG), () => undefined)).toEqual({
      code: misread,
      candidates: [ruins, other],
      sure: false,
      status: 'done',
    });
  });

  it('keeps the read that has a number for the form', async () => {
    reads({ first: result({ setCode: 'SV8a' }, []), second: result({ number: '084' }, []) });
    expect((await scanCard(canvas(BIG), () => undefined)).code).toEqual({ number: '084' });
  });
});

describe('scanCard on a card held small in the frame', () => {
  it('reads the band above the usual one when the first look read no number', async () => {
    reads({ first: digitsOnly(), small: result(sureCode, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const looks: unknown[] = [];
    const outcome = await scanCard(canvas(BIG), (_s, _p, look) => looks.push(look), { turned: vi.fn() });
    expect(outcome).toMatchObject({ sure: true, candidates: [hawlucha], band: { y: 0.78 } });
    expect(looksRun()).toEqual(['first', 'small']);
    expect(identifyCard.mock.calls[1][2]).toMatchObject({ maxPasses: 3 });
    expect(looks).toContain(2);
  });

  it('takes the second look in that band too', async () => {
    reads({ small: result({ number: '084', total: '187' }, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const outcome = await scanCard(canvas(BIG), () => undefined);
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
    const outcome = await scanCard(canvas(BIG), () => undefined, { isStale });
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
    const outcome = await scanCard(canvas(BIG), () => undefined, { isStale: () => stale });
    expect(outcome).toMatchObject({ status: 'stopped', candidates: [] });
    expect(identifyCard).toHaveBeenCalledTimes(1);
  });

  it('reports an OCR engine that could not load, without more looks', async () => {
    identifyCard.mockResolvedValue(result({}, [], 'unavailable'));
    const turned = vi.fn();
    const outcome = await scanCard(canvas(BIG), () => undefined, { turned });
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
    const outcome = await scanCard(canvas(BIG), (_s, _p, look) => looks.push(look), { turned });
    expect(outcome).toMatchObject({ sure: true, status: 'done', candidates: [hawlucha] });
    expect(outcome.card).toMatchObject({ turned: 1 });
    expect(outcome.band).toBeUndefined();
    expect(turned.mock.calls).toEqual([[1]]);
    // No digit at all upright: turning comes before the higher band.
    expect(looksRun()).toEqual(['first', 'turn1']);
    expect(identifyCard.mock.calls[1][2]).toMatchObject({ maxPasses: 2 });
    expect(looks).toContain('turn');
  });

  it('tries the higher band before turning when the first look saw digits', async () => {
    reads({ first: digitsOnly(), turn3: result(sureCode, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const outcome = await scanCard(canvas(BIG), () => undefined, { turned: turnedCanvas });
    expect(looksRun()).toEqual(['first', 'small', 'turn1', 'turn3']);
    expect(outcome).toMatchObject({ sure: true, card: { turned: 3 } });
  });

  it('tries the higher band after both turns when no digit was read anywhere', async () => {
    reads({});
    const outcome = await scanCard(canvas(BIG), () => undefined, { turned: turnedCanvas });
    expect(looksRun()).toEqual(['first', 'turn1', 'turn3', 'small', 'second']);
    expect(outcome).toMatchObject({ sure: false, candidates: [], status: 'done' });
  });

  it('tries 270° after 90°, and frees the turned crop that read nothing', async () => {
    reads({ turn3: result(sureCode, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const turned = vi.fn(turnedCanvas);
    const outcome = await scanCard(canvas(BIG), () => undefined, { turned });
    expect(turned.mock.calls).toEqual([[1], [3]]);
    expect(outcome.card).toMatchObject({ turned: 3 });
    expect(released).toContainEqual(expect.objectContaining({ turned: 1 }));
    expect(released).not.toContainEqual(expect.objectContaining({ turned: 3 }));
  });

  it('takes the second look at the turned crop when the turned read is not sure', async () => {
    reads({ turn1: result({ number: '084', total: '187' }, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const outcome = await scanCard(canvas(BIG), () => undefined, { turned: turnedCanvas });
    expect(looksRun()).toEqual(['first', 'turn1', 'second']);
    expect(identifyCard.mock.calls[2][0]).toMatchObject({ turned: 1, resampled: true });
    expect(outcome).toMatchObject({ sure: false, candidates: [hawlucha], code: { number: '084' } });
    expect(outcome.card).toMatchObject({ turned: 1 });
  });

  it('does not turn a photo whose number was read', async () => {
    reads({ first: result({ number: '083', total: '087' }, [ruins]) });
    resolveSets.mockResolvedValue(setScore('E3', 0.4));
    const turned = vi.fn(turnedCanvas);
    await scanCard(canvas(BIG), () => undefined, { turned });
    expect(turned).not.toHaveBeenCalled();
    expect(looksRun()).toEqual(['first', 'second']);
  });

  it('does not turn a photo whose number was found in the higher band', async () => {
    reads({ first: digitsOnly(), small: result({ number: '084', total: '187' }, [hawlucha]) });
    resolveSets.mockResolvedValue(setScore('SV8a', 1));
    const turned = vi.fn(turnedCanvas);
    await scanCard(canvas(BIG), () => undefined, { turned });
    expect(turned).not.toHaveBeenCalled();
  });

  it('gives the extra looks their own time budget, counted after the first look', async () => {
    let clock = 0;
    identifyCard.mockImplementation(async (c) => {
      clock += (c as { turned?: number }).turned ? 4000 : 9000; // a slow phone: a 9 s first look
      return result({}, []);
    });
    const turned = vi.fn(turnedCanvas);
    const outcome = await scanCard(canvas(BIG), () => undefined, { turned, now: () => clock });
    // 9 s: first look done, budget starts. 13 s and 17 s: both turns (4 s, 8 s in). 26 s: the higher band started at
    // 8 s in; afterwards (17 s in) out of budget, so no second look.
    expect(looksRun()).toEqual(['first', 'turn1', 'turn3', 'small']);
    expect(outcome).toMatchObject({ status: 'done', candidates: [], sure: false });
  });

  it('stops starting extra looks once the budget is used up', async () => {
    let clock = 0;
    identifyCard.mockImplementation(async () => {
      clock += 6000;
      return result({}, []);
    });
    const turned = vi.fn(turnedCanvas);
    await scanCard(canvas(BIG), () => undefined, { turned, now: () => clock });
    expect(looksRun()).toEqual(['first', 'turn1', 'turn3']); // 6 s, then 12 s in: no higher band
  });

  it('keeps going when the photo is gone', async () => {
    identifyCard.mockResolvedValue(result({}, []));
    const outcome = await scanCard(canvas(BIG), () => undefined, {
      turned: () => {
        throw new Error('closed');
      },
    });
    expect(outcome.status).toBe('done');
    expect(looksRun()).toEqual(['first', 'small', 'second']);
  });
});

describe('sameNumber', () => {
  it('lets a stray zero pass only on cards printed without zeros', () => {
    expect(sameNumber('084', '084')).toBe(true);
    expect(sameNumber('084', '84')).toBe(false);
    expect(sameNumber('004', '4')).toBe(false);
    expect(sameNumber('4', '04')).toBe(true);
    expect(sameNumber('TG05', 'tg05')).toBe(true);
    expect(sameNumber('SWSH050', 'SWSH050')).toBe(true);
  });
});

describe('scanCard on a small crop (a live camera frame)', () => {
  const misread054: PrintedCode = { setCode: 'SV8a', number: '054', total: '187', lang: 'ja' };
  const iron = card('SV8a-054', '054', 'SV8a');
  const sureFor = (code: PrintedCode) => (code.setCode === 'SV8a' && code.total === '187' ? setScore('SV8a', 1) : []);

  it('does not open a sure first look until another look agrees', async () => {
    reads({ first: result(sureCode, [hawlucha]), second: result({ number: '084', total: '187' }, [hawlucha]) });
    resolveSets.mockImplementation(async (code: PrintedCode) => sureFor(code));
    const outcome = await scanCard(canvas(SMALL), () => undefined);
    expect(outcome).toMatchObject({ sure: true, candidates: [hawlucha], code: sureCode });
    expect(looksRun()).toEqual(['first', 'second']);
    expect(identifyCard.mock.calls[1][0]).toMatchObject({ width: 1100, resampled: true });
  });

  it('asks instead of opening when two looks read different numbers on the same line', async () => {
    // Two OCR passes can agree on a misread: "054/187" is sure by itself.
    reads({ first: result(misread054, [iron]), second: result(sureCode, [hawlucha]) });
    resolveSets.mockImplementation(async (code: PrintedCode) => sureFor(code));
    const outcome = await scanCard(canvas(SMALL), () => undefined);
    expect(outcome.sure).toBe(false);
    expect(outcome.candidates).toEqual([iron, hawlucha]);
  });

  it('asks when no other look read a number', async () => {
    reads({ first: result(sureCode, [hawlucha]) });
    resolveSets.mockImplementation(async (code: PrintedCode) => sureFor(code));
    expect(await scanCard(canvas(SMALL), () => undefined)).toMatchObject({ sure: false, candidates: [hawlucha] });
  });

  it('accepts a confirming read that lost a zero or the last digit of the total', async () => {
    reads({ first: result(sureCode, [hawlucha]), second: result({ setCode: 'SV8a', number: '84', total: '18' }, []) });
    resolveSets.mockImplementation(async (code: PrintedCode) => sureFor(code));
    expect(await scanCard(canvas(SMALL), () => undefined)).toMatchObject({ sure: true, candidates: [hawlucha] });
  });

  it('ignores a read of other text, which neither confirms nor blocks', async () => {
    reads({ first: result(sureCode, [hawlucha]), second: result({ number: '1', total: '260' }, []) });
    resolveSets.mockImplementation(async (code: PrintedCode) => sureFor(code));
    expect(await scanCard(canvas(SMALL), () => undefined)).toMatchObject({ sure: false, candidates: [hawlucha] });
  });

  it('looks at the crop zoomed in twice on a live frame, then a resampled copy', async () => {
    reads({ zoom80: result({ number: '084', total: '187' }, [hawlucha]) });
    const looks: unknown[] = [];
    const outcome = await scanCard(canvas(SMALL), (_s, _p, look) => looks.push(look), { live: true });
    expect(looksRun()).toEqual(['first', 'zoom88', 'zoom80', 'second']);
    // No higher band on a live frame (the zoomed crops read that part of the card); the second look resamples the zoom.
    expect(identifyCard.mock.calls[3][0]).toMatchObject({ zoom: 0.8, resampled: true });
    expect(outcome).toMatchObject({ sure: false, candidates: [hawlucha], band: unzoom({ x: 0, y: 0.86, w: 0.55, h: 0.14 }, 0.8) });
    expect(outcome.band?.y).toBeCloseTo(0.788);
    expect(looks).toContain(2);
    expect(released).toEqual(expect.arrayContaining([expect.objectContaining({ zoom: 0.88 }), expect.objectContaining({ zoom: 0.8 })]));
    expect(LIVE_ZOOMS).toEqual([0.88, 0.8]);
  });

  it('stops looking once a zoomed look confirms the first', async () => {
    reads({ first: result(sureCode, [hawlucha]), zoom88: result(sureCode, [hawlucha]) });
    resolveSets.mockImplementation(async (code: PrintedCode) => sureFor(code));
    const outcome = await scanCard(canvas(SMALL), () => undefined, { live: true });
    expect(outcome).toMatchObject({ sure: true, candidates: [hawlucha] });
    expect(outcome.band).toBeUndefined(); // the first look's band: the usual one
    expect(looksRun()).toEqual(['first', 'zoom88']);
  });

  it('puts the card most looks found first in the picker and pre-fills its number', async () => {
    reads({
      first: result(misread054, [iron]),
      zoom88: result({ number: '084', total: '187' }, [hawlucha]),
      second: result({ setCode: 'SV8a', number: '084', total: '167' }, [hawlucha]),
    });
    resolveSets.mockImplementation(async (code: PrintedCode) => sureFor(code));
    const outcome = await scanCard(canvas(SMALL), () => undefined, { live: true });
    expect(outcome.sure).toBe(false);
    expect(outcome.candidates).toEqual([hawlucha, iron]);
    expect(outcome.code).toMatchObject({ number: '084', total: '187' });
  });

  it('counts a read that lost the leading digits ("4") for the full number ("084")', async () => {
    const four = card('SV8a-004', '004', 'SV8a');
    reads({
      first: result({ number: '084', total: '187' }, [hawlucha]),
      zoom88: result({ number: '4', total: '187' }, [four]),
      zoom80: result({ number: '4', total: '187' }, [four]),
    });
    const outcome = await scanCard(canvas(SMALL), () => undefined, { live: true });
    expect(outcome.sure).toBe(false);
    expect(outcome.candidates).toEqual([hawlucha, four]);
    expect(outcome.code).toMatchObject({ number: '084' });
  });

  it('looks a short total up again with the longer one another look read', async () => {
    reads({ first: result({ number: '084', total: '18' }, []), zoom88: result(misread054, [iron]) });
    findCards.mockResolvedValue([hawlucha]);
    const outcome = await scanCard(canvas(SMALL), () => undefined, { live: true });
    expect(findCards).toHaveBeenCalledWith({ number: '084', total: '187' });
    expect(outcome.candidates).toEqual([hawlucha, iron]);
    expect(outcome.code).toEqual({ number: '084', total: '187' });
  });
});

describe('scanCard ends the extra looks early', () => {
  /** A read with no set code: never sure by itself, so it goes to the picker. */
  const noSet: PrintedCode = { number: '084', total: '187', lang: 'ja' };
  const misread054: PrintedCode = { setCode: 'SV8a', number: '054', total: '187', lang: 'ja' };
  const iron = card('SV8a-054', '054', 'SV8a');
  const four = card('SV8a-004', '004', 'SV8a');
  const sureFor = (code: PrintedCode) => (code.setCode === 'SV8a' && code.total === '187' ? setScore('SV8a', 1) : []);
  beforeEach(() => {
    resolveSets.mockImplementation(async (code: PrintedCode) => sureFor(code));
  });

  // An English "189/198" is in several sets: two looks that find the same few cards end the scan.
  const svi = { ...card('sv01-189', '189', 'sv01'), lang: 'en' as const };
  const chilling = { ...card('swsh6-189', '189', 'swsh6'), lang: 'en' as const };
  const en189: PrintedCode = { number: '189', total: '198', lang: 'en' };

  it('stops once two looks read the same number and total and found the same few cards', async () => {
    reads({
      first: result(en189, [svi, chilling]),
      zoom88: result({ ...en189 }, [chilling, svi]),
      zoom80: result(en189, [svi, chilling]),
      second: result(en189, [svi, chilling]),
    });
    const outcome = await scanCard(canvas(SMALL), () => undefined, { live: true });
    expect(looksRun()).toEqual(['first', 'zoom88']); // 12 passes instead of 24
    expect(outcome).toMatchObject({ sure: false, status: 'done', candidates: [svi, chilling], code: en189 });
  });

  it('takes a read that lost a zero or the last digit of the total as the same', async () => {
    reads({ first: result(noSet, [hawlucha, ruins]), zoom88: result({ number: '84', total: '18' }, [ruins, hawlucha]) });
    await scanCard(canvas(SMALL), () => undefined, { live: true });
    expect(looksRun()).toEqual(['first', 'zoom88']);
  });

  it('keeps looking when the cards differ, the totals or numbers do not fit, or no card was found', async () => {
    const run = async (a: [PrintedCode, CardBrief[]], b: [PrintedCode, CardBrief[]]) => {
      identifyCard.mockReset();
      reads({ first: result(...a), zoom88: result(...b) });
      await scanCard(canvas(SMALL), () => undefined, { live: true });
      return looksRun();
    };
    const all = ['first', 'zoom88', 'zoom80', 'second'];
    const two = [svi, chilling];
    expect(await run([en189, two], [en189, [svi]])).toEqual(all);
    expect(await run([en189, two], [en189, [svi, card('sv02-189', '189', 'sv02')]])).toEqual(all);
    expect(await run([en189, two], [{ ...en189, total: '195' }, two])).toEqual(all);
    expect(await run([en189, two], [{ ...en189, number: '188' }, two])).toEqual(all);
    expect(await run([{ number: '084', total: '18' }, []], [{ number: '084', total: '18' }, []])).toEqual(all);
  });

  it('keeps looking when two looks found one card: a later look may read its set code and open it', async () => {
    // Camera test f85: the first look read only the set code, two more read "084/187" (one with "SV1a"), and the
    // fourth read "SV8a 084/187": a direct open that stopping at the agreement would have turned into a question.
    reads({
      first: result({ setCode: 'SV8a', lang: 'ja' }, []),
      zoom88: result(noSet, [hawlucha]),
      zoom80: result({ ...sureCode, setCode: 'SV1a' }, [hawlucha]),
      second: result(sureCode, [hawlucha]),
    });
    const outcome = await scanCard(canvas(SMALL), () => undefined, { live: true });
    expect(looksRun()).toEqual(['first', 'zoom88', 'zoom80', 'second']);
    expect(outcome).toMatchObject({ sure: true, candidates: [hawlucha], code: sureCode });
  });

  it('never opens a card because the looks stopped early', async () => {
    // A sure misread first ("054"), then two looks that agree on "084": they end the scan, and it asks.
    reads({ first: result(misread054, [iron]), zoom88: result(noSet, [hawlucha, ruins]), zoom80: result(noSet, [hawlucha, ruins]) });
    const outcome = await scanCard(canvas(SMALL), () => undefined, { live: true });
    expect(looksRun()).toEqual(['first', 'zoom88', 'zoom80']);
    expect(outcome).toMatchObject({ sure: false, candidates: [hawlucha, ruins, iron], code: noSet });

    // Looks that all lost the leading zeros ("4" for #004): the zeros a card prints are still needed.
    identifyCard.mockReset();
    const lost = result({ ...sureCode, number: '4' }, [four]);
    reads({ first: lost, zoom88: lost, zoom80: lost, second: lost });
    expect(await scanCard(canvas(SMALL), () => undefined, { live: true })).toMatchObject({ sure: false, candidates: [four] });
  });

  it('stops starting extra looks 8 s after the first look once a number was read', async () => {
    let clock = 0;
    identifyCard.mockImplementation(async (c, _p, o) => {
      const look = lookOf(c, o);
      clock += look === 'first' ? 2000 : 5000;
      return look === 'zoom88' ? result(noSet, [hawlucha]) : result({}, []);
    });
    const outcome = await scanCard(canvas(SMALL), () => undefined, { live: true, now: () => clock });
    // First look done at 2 s. zoom88 (0–5 s in) reads 084; zoom80 starts 5 s in; the second look would start 10 s in.
    expect(looksRun()).toEqual(['first', 'zoom88', 'zoom80']);
    expect(outcome).toMatchObject({ sure: false, candidates: [hawlucha] });
  });

  it('still confirms a number read late on a sideways photo, within the 10 s budget', async () => {
    let clock = 0;
    identifyCard.mockImplementation(async (c, _p, o) => {
      const look = lookOf(c, o);
      clock += look === 'first' ? 9000 : 4500;
      return look === 'turn3' ? result(noSet, [hawlucha]) : result({}, []);
    });
    const turned = vi.fn((q: number) => ({ width: 700, turned: q }) as unknown as HTMLCanvasElement);
    const outcome = await scanCard(canvas(BIG), () => undefined, { turned, now: () => clock });
    // 9 s: first look done. turn1 (0–4.5 s in), turn3 (4.5–9 s in) reads 084: past 8 s, but the confirming second look
    // starts until 10 s in (a slow phone still opens a sideways card directly when the looks agree).
    expect(looksRun()).toEqual(['first', 'turn1', 'turn3', 'second']);
    expect(outcome).toMatchObject({ sure: false, candidates: [hawlucha], card: { turned: 3 } });
  });

  it('keeps the worst case: a number read after 10 s gets no extra look', async () => {
    let clock = 0;
    identifyCard.mockImplementation(async (c, _p, o) => {
      const look = lookOf(c, o);
      clock += look === 'first' ? 9000 : 5000;
      return look === 'turn3' ? result(noSet, [hawlucha]) : result({}, []);
    });
    const turned = vi.fn((q: number) => ({ width: 700, turned: q }) as unknown as HTMLCanvasElement);
    const outcome = await scanCard(canvas(BIG), () => undefined, { turned, now: () => clock });
    // 9 s: first look done. turn1 (0–5 s in), turn3 (5–10 s in) reads 084: 10 s in, no second look.
    expect(looksRun()).toEqual(['first', 'turn1', 'turn3']);
    expect(outcome).toMatchObject({ sure: false, candidates: [hawlucha], card: { turned: 3 } });
  });
});

describe('looksSideways', () => {
  it('takes no digit at all, or text chopped into bits, as a card lying sideways', () => {
    expect(looksSideways('')).toBe(true);
    expect(looksSideways('Illus GOSSAN\nPokemon/Nintendo')).toBe(true);
    const bits = ['la', 'Pa', 'o', 'Xd', '0', '48', 'ANCE', 'od 04', 'PARAL', '1', 'rd', 'Y', '4p', '7', 'Sv', 'x', 'Ta'];
    expect(looksSideways(bits.join('\n'))).toBe(true);
    // An upright card held small: words and a few bits (real first look on a table photo at 80%).
    const upright = ['ROtidanil', 'Yorre', 'FRSAPFWPY', 'INInterel', 'bPoRBMoOn/Nintendo/Cre', 'be BRITE End il had', 'Pig',
      'Cw oma PokemoniNimandoiCie', 'a', '-', 'e', 'a', 'BE', '02024Pokemon/Nintendo/Cre', 'Osoomrm', 'fF J Bn Daald', '435'];
    expect(looksSideways(upright.join('\n'))).toBe(false);
    expect(looksSideways('3 |\n12')).toBe(false); // too little text to tell
  });
});
