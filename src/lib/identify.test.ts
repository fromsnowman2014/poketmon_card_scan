import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identifyCard } from './identify';
import { readCodeStrip, type ReadCodeOptions } from './ocr';
import { mergeParses, parsePrintedCode, type ParsedCode } from './parseCode';
import { findByCode, getSets, resolveSets, type SetInfo } from './tcgdex';
import type { CardBrief, CardLang } from './types';

vi.mock('./ocr', () => ({ readCodeStrip: vi.fn(), preloadOcr: vi.fn(async () => undefined) }));
vi.mock('./tcgdex', () => ({ getSets: vi.fn(), resolveSets: vi.fn(), findByCode: vi.fn() }));

const card = {} as HTMLCanvasElement;
const set = (id: string, official: number): SetInfo => ({ id, name: id, official, total: official });
const brief = (id: string, lang: CardLang = 'ja'): CardBrief => ({ id, lang, localId: id.split('-').pop()!, name: id, setId: id.split('-')[0] });

/** Simulate the OCR passes: each text is one pass, parsed for real; honours shouldStop like ocr.ts does. */
function ocrReads(...texts: string[]) {
  vi.mocked(readCodeStrip).mockImplementation(async (_card, opts: ReadCodeOptions = {}) => {
    const passes: { text: string; parsed: ParsedCode }[] = [];
    for (const text of texts) {
      passes.push({ text, parsed: parsePrintedCode(text, opts.parse) });
      opts.onProgress?.('reading', passes.length / 6);
      const parsed = passes.map((p) => p.parsed);
      if (await opts.shouldStop?.(mergeParses(parsed), parsed)) break;
    }
    return { passes, merged: mergeParses(passes.map((p) => p.parsed)), status: 'done' as const };
  });
}

const passesRun = async () => (await vi.mocked(readCodeStrip).mock.results[0].value).passes.length;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSets).mockResolvedValue([set('SV8', 106), set('SV8a', 187)]);
  vi.mocked(resolveSets).mockResolvedValue([{ lang: 'ja', set: set('SV8a', 187), score: 1 }]);
  vi.mocked(findByCode).mockResolvedValue([brief('SV8a-084')]);
});

describe('identifyCard', () => {
  it('stops early once two passes agree and the set is unambiguous', async () => {
    ocrReads('G sv8a 084/187', 'Bsv8ag 084/187', 'never read', 'never read');
    const result = await identifyCard(card);
    expect(await passesRun()).toBe(2);
    expect(resolveSets).toHaveBeenCalledTimes(1); // not after the first pass: nothing to agree with yet
    expect(result.code).toMatchObject({ setCode: 'SV8a', number: '084', total: '187', lang: 'ja' });
    expect(result.candidates).toEqual([brief('SV8a-084')]);
    expect(result.rawText).toBe('G sv8a 084/187\nBsv8ag 084/187');
    expect(findByCode).toHaveBeenCalledWith(expect.objectContaining({ setCode: 'SV8a', number: '084' }), ['ja']);
  });

  it('keeps reading while the set is ambiguous', async () => {
    vi.mocked(resolveSets).mockResolvedValue([
      { lang: 'en', set: set('sv04', 182), score: 0.5 },
      { lang: 'en', set: set('sv10', 182), score: 0.5 },
    ]);
    ocrReads('123/182', '123/182', '123/182');
    await identifyCard(card);
    expect(await passesRun()).toBe(3);
  });

  it('keeps reading when the set lookup fails', async () => {
    vi.mocked(resolveSets).mockRejectedValue(new Error('offline'));
    ocrReads('G sv8a 084/187', 'G sv8a 084/187', 'G sv8a 084/187');
    const result = await identifyCard(card);
    expect(await passesRun()).toBe(3);
    expect(result.candidates).toHaveLength(1);
  });

  it('returns no candidates when no number was read', async () => {
    ocrReads('@ svéo | cvars', 'Bsv8a', '');
    const result = await identifyCard(card);
    expect(result.code.setCode).toBe('SV8a');
    expect(result.code.number).toBeUndefined();
    expect(result.candidates).toEqual([]);
    expect(findByCode).not.toHaveBeenCalled();
  });

  it('passes JA set ids and EN abbreviations to the parser', async () => {
    ocrReads('G SV8A 084/187');
    await identifyCard(card);
    const parse = vi.mocked(readCodeStrip).mock.calls[0][1]?.parse;
    expect(parse?.knownSetIds).toEqual(['SV8', 'SV8a']);
    expect(parse?.knownEnAbbrs).toEqual(expect.arrayContaining(['PAR', 'SVI', 'MEG']));
    expect(parse?.knownEnAbbrs).not.toContain('SHF:SV');
  });

  it('still scans when the set list cannot be loaded', async () => {
    vi.mocked(getSets).mockRejectedValue(new Error('offline'));
    ocrReads('G sv8a 084/187');
    const result = await identifyCard(card);
    expect(vi.mocked(readCodeStrip).mock.calls[0][1]?.parse?.knownSetIds).toEqual([]);
    expect(result.code.number).toBe('084');
  });

  it('returns no candidates when the card lookup fails', async () => {
    vi.mocked(findByCode).mockRejectedValue(new Error('503'));
    ocrReads('G sv8a 084/187');
    expect((await identifyCard(card)).candidates).toEqual([]);
  });

  it('reports progress in order: loading, reading, matching', async () => {
    ocrReads('G sv8a 084/187', 'G sv8a 084/187');
    const stages: string[] = [];
    await identifyCard(card, (stage, progress) => stages.push(`${stage}:${progress}`));
    expect(stages[0]).toBe('loading:0');
    const lastRead = stages.lastIndexOf(`reading:${2 / 6}`);
    expect(lastRead).toBeGreaterThan(0);
    expect(stages.findIndex((s) => s.startsWith('matching'))).toBeGreaterThan(lastRead);
    expect(stages.at(-1)).toBe('matching:1');
  });
});

describe('identifyCard language routing', () => {
  it('looks up EN codes in English first', async () => {
    ocrReads('G PAR EN 123/182');
    const result = await identifyCard(card);
    expect(result.code.lang).toBe('en');
    expect(findByCode).toHaveBeenCalledWith(expect.objectContaining({ setCode: 'PAR', lang: 'en' }), ['en']);
  });

  it('falls back to the other language when the first finds nothing', async () => {
    vi.mocked(findByCode).mockResolvedValueOnce([]).mockResolvedValueOnce([brief('sv08.5-084', 'en')]);
    ocrReads('G PAR EN 084/131');
    const result = await identifyCard(card);
    expect(vi.mocked(findByCode).mock.calls.map((c) => c[1])).toEqual([['en'], ['ja']]);
    expect(result.candidates[0].id).toBe('sv08.5-084');
  });

  it('searches both languages when only the number was read, hinted language first', async () => {
    ocrReads('58/102');
    await identifyCard(card);
    expect(findByCode).toHaveBeenLastCalledWith(expect.objectContaining({ number: '58', total: '102' }), ['ja', 'en']);

    vi.mocked(findByCode).mockClear();
    await identifyCard(card, undefined, { langHint: 'en' });
    expect(findByCode).toHaveBeenLastCalledWith(expect.anything(), ['en', 'ja']);
  });

  it('labels JA-style codes Korean on a ko hint but looks them up in Japanese', async () => {
    ocrReads('G sv8a 084/187', 'G sv8a 084/187');
    const result = await identifyCard(card, undefined, { langHint: 'ko' });
    expect(result.code.lang).toBe('ko');
    expect(resolveSets).toHaveBeenCalledWith(expect.objectContaining({ lang: 'ja' }), ['ja']);
    expect(findByCode).toHaveBeenCalledWith(expect.objectContaining({ setCode: 'SV8a', lang: 'ja' }), ['ja']);
  });

  it('trusts a detected EN code over a ko hint', async () => {
    ocrReads('G PAR EN 123/182');
    const result = await identifyCard(card, undefined, { langHint: 'ko' });
    expect(result.code.lang).toBe('en');
    expect(findByCode).toHaveBeenCalledWith(expect.anything(), ['en']);
  });
});

describe('identifyCard status and cancellation', () => {
  it('reports a ready engine as done', async () => {
    ocrReads('G sv8a 084/187', 'G sv8a 084/187');
    expect((await identifyCard(card)).status).toBe('done');
  });

  it('passes isStale and maxPasses to the OCR', async () => {
    ocrReads('G sv8a 084/187');
    const isStale = () => false;
    await identifyCard(card, undefined, { isStale, maxPasses: 3 });
    expect(vi.mocked(readCodeStrip).mock.calls[0][1]).toMatchObject({ isStale, maxPasses: 3 });
  });

  it('skips the lookups once the scan was stopped', async () => {
    let stale = false;
    vi.mocked(readCodeStrip).mockImplementation(async () => {
      stale = true; // the kid tapped X while the passes ran
      const parsed = parsePrintedCode('G sv8a 084/187');
      return { passes: [{ text: 'G sv8a 084/187', parsed }], merged: parsed, status: 'done' };
    });
    const result = await identifyCard(card, undefined, { isStale: () => stale });
    expect(result.status).toBe('stopped');
    expect(result.candidates).toEqual([]);
    expect(findByCode).not.toHaveBeenCalled();
  });

  it('says so when the OCR engine could not load', async () => {
    vi.mocked(readCodeStrip).mockResolvedValue({ passes: [], merged: mergeParses([]), status: 'unavailable' });
    const result = await identifyCard(card);
    expect(result).toMatchObject({ status: 'unavailable', candidates: [] });
    expect(findByCode).not.toHaveBeenCalled();
  });

  it('does not wait for the engine itself (readCodeStrip waits, and can be stopped)', async () => {
    const { preloadOcr } = await import('./ocr');
    vi.mocked(preloadOcr).mockReturnValueOnce(new Promise(() => undefined)); // a stalled download
    ocrReads('G sv8a 084/187', 'G sv8a 084/187');
    expect((await identifyCard(card)).candidates).toHaveLength(1);
  });
});
