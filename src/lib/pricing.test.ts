import { describe, expect, it } from 'vitest';
import { FALLBACK_RATES, type Rates } from './fx';
import { buildVariants, formatMoney, summarize, valueTier } from './pricing';
import { fixtures } from './__fixtures__/mockFetch';

const rates: Rates = FALLBACK_RATES; // EUR 0.8957 / KRW 1359 per USD

const byKey = (raw: unknown) => {
  const { variants, defaultVariant } = buildVariants(raw, rates);
  return { map: new Map(variants.map((v) => [v.key, v])), keys: variants.map((v) => v.key), defaultVariant };
};

describe('buildVariants — real TCGdex cards', () => {
  it('ja SV8a-084: plain reverse borrows the top-level Cardmarket "-holo" price', () => {
    const { map, keys, defaultVariant } = byKey(fixtures.jaSv8a084);
    expect(keys).toEqual(['normal', 'reverse-masterball', 'reverse']);
    expect(defaultVariant).toBe('normal');

    const reverse = map.get('reverse')!;
    expect(reverse.cardmarket).toMatchObject({ trend: 1.51, avg30: 1.83 });
    expect(reverse.summary).toMatchObject({
      market: 1.69, // 1.51 EUR / 0.8957
      low: 1.69,
      high: 5.81, // avg1-holo 5.2 EUR
      changePct: -8.2,
      source: 'cardmarket',
      converted: true,
      updated: '2026-11-07T23:49:17.885Z',
    });
    expect(reverse.tcgplayerId).toBe(602465);
    expect(reverse.cardmarketId).toBe(803197);

    expect(map.get('normal')!.summary).toMatchObject({ market: 0.04, source: 'cardmarket' });
  });

  it('ja SV8a-084: special-foil reverse without own prices stays unpriced (separate product)', () => {
    const masterball = byKey(fixtures.jaSv8a084).map.get('reverse-masterball')!;
    expect(masterball.foil).toBe('masterball');
    expect(masterball.summary).toBeNull();
    expect(masterball.tcgplayerId).toBe(604564);
  });

  it('en sv08.5-084: TCGplayer keys per variant and the 999 placeholder high is dropped', () => {
    const { map, keys, defaultVariant } = byKey(fixtures.enSv085084);
    expect(keys).toEqual(['normal', 'reverse', 'reverse-pokeball', 'reverse-masterball']);
    expect(defaultVariant).toBe('normal');
    expect(map.get('normal')!.summary).toMatchObject({ market: 0.1, low: 0.01, high: 0.15, changePct: 0, source: 'tcgplayer', converted: false });
    expect(map.get('reverse')!.summary).toMatchObject({ market: 0.26, high: 0.26, changePct: -36.4 });
    expect(map.get('reverse-pokeball')!.summary?.market).toBe(0.35);
    const mb = map.get('reverse-masterball')!;
    expect(mb.summary).toMatchObject({ market: 7.18, low: 5.89, high: 8.57 });
    expect(mb.tcgplayerId).toBe(610698);
    expect(mb.cardmarketId).toBe(806529);
  });

  it('en sv03.5-199 (holo only): 10000 high replaced, default is the first priced variant', () => {
    const { map, defaultVariant } = byKey(fixtures.enSv035199);
    expect(defaultVariant).toBe('holo');
    expect(map.get('holo')!.summary).toMatchObject({ market: 295.26, low: 233.96, high: 326.3, changePct: 6.6 });
  });

  it('en base1-4: 1st edition and subtype keys stay unique', () => {
    const { map, keys } = byKey(fixtures.enBase14);
    expect(keys).toEqual(['holo', 'firstEdition', 'holo-shadowless', 'holo-1999-2000-copyright']);
    expect(map.get('holo')!.summary).toMatchObject({ market: 987.13, high: 987.13 }); // 3499.1 > 3 × market
    expect(map.get('firstEdition')!.summary).toMatchObject({ market: 3895.56, source: 'cardmarket', converted: true });
    // No own pricing and not a separate product → borrows the top-level (unlimited) price.
    expect(map.get('holo-1999-2000-copyright')!.summary?.market).toBe(987.13);
  });

  it('derives variants from flags when variants_detailed is missing', () => {
    const raw = {
      variants: { normal: true, reverse: true },
      pricing: {
        tcgplayer: { normal: { marketPrice: 0.2, lowPrice: 0.05 }, 'reverse-holofoil': { marketPrice: 0.9 } },
        cardmarket: { trend: 0.1, 'trend-holo': 0.7 },
      },
    };
    const { map, keys, defaultVariant } = byKey(raw);
    expect(keys).toEqual(['normal', 'reverse']);
    expect(defaultVariant).toBe('normal');
    expect(map.get('reverse')!.summary?.market).toBe(0.9);
    expect(map.get('reverse')!.cardmarket?.trend).toBe(0.7);
  });

  it('never returns an empty list', () => {
    expect(buildVariants(null, rates)).toEqual({
      variants: [expect.objectContaining({ key: 'normal', summary: null })],
      defaultVariant: 'normal',
    });
  });
});

describe('summarize', () => {
  const tcg = { low: 1, mid: 2.5, high: 999, market: 2, directLow: null };
  it('keeps a sane TCGplayer high, else max(mid, market)', () => {
    expect(summarize({ ...tcg, high: 5.5 }, null, rates)?.high).toBe(5.5);
    expect(summarize(tcg, null, rates)?.high).toBe(2.5);
  });

  it('falls back to mid when market is missing', () => {
    expect(summarize({ ...tcg, market: null }, null, rates)?.market).toBe(2.5);
  });

  it('Cardmarket only: converts EUR and uses the usual range, ignoring the junk low', () => {
    const s = summarize(null, { avg: 4, low: 0.02, trend: 3, avg1: 5, avg7: 2.5, avg30: 2, }, rates, '2026-11-07');
    expect(s).toEqual({ market: 3.35, low: 2.23, high: 5.58, changePct: 25, source: 'cardmarket', converted: true, updated: '2026-11-07' });
  });

  it('returns null without any usable number', () => {
    expect(summarize(null, null, rates)).toBeNull();
    expect(summarize({ low: 1, mid: null, high: null, market: null, directLow: null }, null, rates)).toBeNull();
  });
});

describe('valueTier', () => {
  it.each([
    [null, 'common'],
    [0.99, 'common'],
    [1, 'nice'],
    [4.99, 'nice'],
    [5, 'rare'],
    [25, 'super'],
    [99.99, 'super'],
    [100, 'treasure'],
  ] as const)('%s → %s', (usd, tier) => expect(valueTier(usd)).toBe(tier));
});

describe('formatMoney', () => {
  it('formats USD', () => {
    expect(formatMoney(0.45, 'USD', rates)).toBe('$0.45');
    expect(formatMoney(12.34, 'USD', rates)).toBe('$12.34');
    expect(formatMoney(1234.4, 'USD', rates)).toBe('$1,234');
    expect(formatMoney(999.996, 'USD', rates)).toBe('$1,000');
  });

  it('formats KRW rounded to 10 below ₩10,000 and to 100 above', () => {
    expect(formatMoney(12.14, 'KRW', rates)).toBe('₩16,500'); // 16,498
    expect(formatMoney(0.45, 'KRW', rates)).toBe('₩610'); // 611.55
    expect(formatMoney(7.35, 'KRW', rates)).toBe('₩9,990'); // 9,988.65
  });

  it('handles missing values and approx', () => {
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney(undefined, 'KRW')).toBe('—');
    expect(formatMoney(1.69, 'USD', rates, { approx: true })).toBe('≈ $1.69');
  });
});
