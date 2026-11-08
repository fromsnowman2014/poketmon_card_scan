import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardBrief, IdentifyResult, PrintedCode } from '../../lib/types';

const identifyCard = vi.fn<(card: unknown) => Promise<IdentifyResult>>();
const resolveSets = vi.fn();

vi.mock('../../lib/identify', () => ({ identifyCard: (card: unknown) => identifyCard(card) }));
vi.mock('../../lib/tcgdex', () => ({ resolveSets: (...args: unknown[]) => resolveSets(...args) }));
vi.mock('../../lib/imageProc', () => ({
  upscaleTo: (card: { width: number }, width: number) => ({ ...card, width, resampled: true }),
  releaseCanvas: () => undefined,
}));

const { isSure, scanCard } = await import('./scanCard');

const card = (id: string, localId: string, setId: string): CardBrief => ({ id, lang: 'ja', localId, name: id, setId });
const hawlucha = card('SV8a-084', '084', 'SV8a');
const ruins = card('E3-083', '083', 'E3');
const result = (code: PrintedCode, candidates: CardBrief[]): IdentifyResult => ({ rawText: '', code, candidates });
const setScore = (id: string, score: number) => [{ lang: 'ja', set: { id }, score }];
const canvas = (width: number) => ({ width }) as unknown as HTMLCanvasElement;

beforeEach(() => {
  identifyCard.mockReset();
  resolveSets.mockReset();
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
    expect(await scanCard(canvas(692), () => undefined)).toEqual({ code: sure, candidates: [hawlucha], sure: true });
    expect(identifyCard).toHaveBeenCalledTimes(1);
  });

  it('takes a second look at an upscaled copy of a small crop', async () => {
    identifyCard.mockResolvedValueOnce(result(misread, [ruins])).mockResolvedValueOnce(result(sure, [hawlucha]));
    resolveSets.mockImplementation(async (code: PrintedCode) =>
      code.total === '187' ? setScore('SV8a', 1) : setScore('E3', 0.4),
    );
    expect(await scanCard(canvas(692), () => undefined)).toEqual({ code: sure, candidates: [hawlucha], sure: true });
    expect(identifyCard.mock.calls[1][0]).toMatchObject({ width: 1100, resampled: true });
  });

  it('shrinks a large crop for the second look', async () => {
    identifyCard.mockResolvedValue(result({}, []));
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
    });
  });

  it('keeps the read that has a number for the form', async () => {
    identifyCard
      .mockResolvedValueOnce(result({ setCode: 'SV8a' }, []))
      .mockResolvedValueOnce(result({ number: '084' }, []));
    expect((await scanCard(canvas(692), () => undefined)).code).toEqual({ number: '084' });
  });
});
