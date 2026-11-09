import { describe, expect, it } from 'vitest';
import { FALLBACK_RATES, type Rates } from './fx';
import { applyRates, buildVariants, formatMoney, summarize, valueTier } from './pricing';
import type { CardmarketPrice, TcgplayerPrice } from './types';
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
      changePct: null, // −8.2% on a $1.69 card: no up/down badge
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
    expect(map.get('normal')!.summary).toMatchObject({ market: 0.1, low: 0.01, high: 0.15, changePct: null, source: 'tcgplayer', converted: false });
    expect(map.get('reverse')!.summary).toMatchObject({ market: 0.26, high: 0.26, changePct: null }); // −36% on 26¢: noise
    expect(map.get('reverse-pokeball')!.summary?.market).toBe(0.35);
    const mb = map.get('reverse-masterball')!;
    // Placeholder high replaced by the highest real number: Cardmarket avg 9.79 EUR.
    expect(mb.summary).toMatchObject({ market: 7.18, low: 5.89, high: 10.93 });
    expect(mb.tcgplayerId).toBe(610698);
    expect(mb.cardmarketId).toBe(806529);
  });

  it('en sv03.5-199 (holo only): 10000 high replaced by the highest real price', () => {
    const { map, defaultVariant } = byKey(fixtures.enSv035199);
    expect(defaultVariant).toBe('holo');
    // max(mid 326.3, directLow 286.65, Cardmarket avg 336.32 EUR = $375.48); +6.6% is too small for a badge.
    expect(map.get('holo')!.summary).toMatchObject({ market: 295.26, low: 233.96, high: 375.48, changePct: null });
  });

  it('en base1-4: 1st edition and subtype keys stay unique and readable', () => {
    const { map, keys } = byKey(fixtures.enBase14);
    expect(keys).toEqual(['holo', 'firstEdition-shadowless', 'holo-shadowless', 'holo-1999-2000-copyright']);
    // 3499.1 > 3 × market → the cheapest Direct listing ($1,499.09), not the market price again.
    expect(map.get('holo')!.summary).toMatchObject({ market: 987.13, high: 1499.09, changePct: null });
    expect(map.get('firstEdition-shadowless')!).toMatchObject({ stamp: ['1st-edition'], subtype: 'shadowless' });
    expect(map.get('firstEdition-shadowless')!.summary).toMatchObject({ market: 3895.56, source: 'cardmarket', converted: true });
    // No own pricing and not a separate product → borrows the top-level (unlimited) price.
    expect(map.get('holo-1999-2000-copyright')!.summary?.market).toBe(987.13);
  });

  it('en sv01-189: a holo rare listed as [reverse, holo] opens on the holo', () => {
    const { map, keys, defaultVariant } = byKey(fixtures.enSv01189);
    expect(keys).toEqual(['reverse', 'holo']);
    expect(defaultVariant).toBe('holo');
    expect(map.get('holo')!.summary?.market).toBe(0.15);
  });

  it('en sv04-028: stamped printings get readable keys and keep their own prices', () => {
    const { map, keys, defaultVariant } = byKey(fixtures.enSv04028);
    expect(keys).toEqual(['holo', 'reverse', 'reverse-stamp-gamestop', 'reverse-stamp-set-logo', 'reverse-stamp-eb-games']);
    expect(defaultVariant).toBe('holo');
    expect(map.get('reverse-stamp-gamestop')).toMatchObject({ stamp: ['gamestop'], summary: { market: 9.68, source: 'cardmarket' } });
    expect(map.get('reverse')!.summary?.market).toBe(0.19);
  });

  it('en sv05-021: an unpriced stamped "normal" neither borrows the holo price nor becomes the default', () => {
    const { map, keys, defaultVariant } = byKey(fixtures.enSv05021);
    expect(keys).toEqual(['holo', 'reverse', 'normal-stamp-player-rewards-program']);
    expect(map.get('normal-stamp-player-rewards-program')!.summary).toBeNull();
    expect(defaultVariant).toBe('holo');
  });

  it('en base1-58: the Pokétour stamp is not "Unlimited"; jumbo is its own printing; unlimited is the default', () => {
    const { map, keys, defaultVariant } = byKey(fixtures.enBase158);
    expect(keys).toEqual([
      'normal',
      'firstEdition-shadowless',
      'normal-shadowless',
      'normal-shadowless-red-cheek',
      'firstEdition-shadowless-red-cheek',
      'normal-1999-2000-copyright',
      'normal-jumbo',
      'normal-stamp-poketour-99',
    ]);
    expect(defaultVariant).toBe('normal');
    expect(map.get('normal')!.summary?.market).toBe(11.34);
    expect(map.get('normal-jumbo')).toMatchObject({ size: 'jumbo', summary: { market: 14.44 } });
    expect(map.get('normal-stamp-poketour-99')).toMatchObject({ stamp: ['poketour-99'], subtype: 'unlimited' });
  });

  it('en swsh7-215: a rejected high falls back to the cheapest Direct listing, not the market price', () => {
    const holo = byKey(fixtures.enSwsh7215).map.get('holo')!;
    expect(holo.summary).toMatchObject({ market: 2324.94, low: 1804.99, high: 2750 });
  });

  it('en gym1-2: low never sits above the market price', () => {
    const first = byKey(fixtures.enGym12).map.get('firstEdition')!;
    expect(first.summary).toMatchObject({ market: 136.15, low: 136.15 }); // raw low 174.5
    expect(first.summary!.high!).toBeGreaterThanOrEqual(136.15);
  });

  it('ja SV8a-001: no up/down badge for a big swing on a penny card', () => {
    const normal = byKey(fixtures.jaSv8a001).map.get('normal')!;
    expect(normal.cardmarket).toMatchObject({ avg7: 0.44, avg30: 0.09 }); // +389%
    expect(normal.summary).toMatchObject({ market: 0.46, changePct: null });
  });

  it('default variant priority: normal > holo > other printings > 1st edition > reverse > foils > stamped', () => {
    const price = (marketPrice: number) => ({ marketPrice });
    const tp = (m: number) => ({ tcgplayer: { normal: price(m), holofoil: price(m), 'reverse-holofoil': price(m), '1st-edition-holofoil': price(m) } });
    const v = (x: object, market: number | null) => ({ size: 'standard', ...x, ...(market === null ? {} : { pricing: tp(market) }) });
    const def = (list: object[]) => buildVariants({ variants_detailed: list }, rates).defaultVariant;
    expect(def([v({ type: 'reverse' }, 1), v({ type: 'holo', stamp: ['1st-edition'] }, 5)])).toBe('firstEdition');
    expect(def([v({ type: 'reverse', foil: 'pokeball' }, 1), v({ type: 'reverse' }, 2)])).toBe('reverse');
    expect(def([v({ type: 'normal', stamp: ['set-logo'] }, 1), v({ type: 'reverse', foil: 'masterball' }, 9)])).toBe('reverse-masterball');
    expect(def([v({ type: 'holo', subtype: 'shadowless' }, 1), v({ type: 'holo', subtype: 'unlimited' }, 2)])).toBe('holo');
    // Only a stamped printing has a price: show it rather than an empty one.
    expect(def([v({ type: 'holo' }, null), v({ type: 'holo', stamp: ['pre-release'] }, 3)])).toBe('holo-stamp-pre-release');
    // Nothing priced: the most common printing.
    expect(def([v({ type: 'reverse' }, null), v({ type: 'holo' }, null)])).toBe('holo');
  });

  it('keeps keys unique without doubling the sub-type', () => {
    const keys = (list: object[]) => buildVariants({ variants_detailed: list }, rates).variants.map((v) => v.key);
    expect(keys([{ type: 'normal' }, { type: 'normal', subtype: 'unlimited' }])).toEqual(['normal', 'normal-unlimited']);
    expect(keys([{ type: 'holo', subtype: 'shadowless' }, { type: 'holo', subtype: 'shadowless' }])).toEqual(['holo-shadowless', 'holo-shadowless-2']);
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
  const cm: CardmarketPrice = { avg: null, low: null, trend: null, avg1: null, avg7: null, avg30: null };
  it('keeps a sane TCGplayer high, else max(mid, market, directLow, Cardmarket)', () => {
    expect(summarize({ ...tcg, high: 5.5 }, null, rates)?.high).toBe(5.5);
    expect(summarize(tcg, null, rates)?.high).toBe(2.5);
    expect(summarize({ ...tcg, directLow: 3 }, null, rates)?.high).toBe(3);
    expect(summarize(tcg, { ...cm, avg: 3.5, trend: 2 }, rates)?.high).toBe(3.91); // 3.5 EUR
  });

  it('clamps low ≤ market ≤ high', () => {
    expect(summarize({ low: 3, mid: null, high: 1, market: 2, directLow: null }, null, rates)).toMatchObject({ low: 2, market: 2, high: 2 });
  });

  describe('changePct (up/down badge)', () => {
    const trend = (c: Partial<CardmarketPrice>, t: TcgplayerPrice | null = null) => summarize(t, { ...cm, ...c }, rates)?.changePct;
    it('needs a card worth ≥ $2, avg30 ≥ €1 and a move of 10–100%', () => {
      expect(trend({ trend: 10, avg7: 12, avg30: 10 })).toBe(20);
      expect(trend({ trend: 10, avg7: 8.5, avg30: 10 })).toBe(-15);
      expect(trend({ trend: 10, avg7: 10.9, avg30: 10 })).toBeNull(); // +9%
      expect(trend({ trend: 10, avg7: 25, avg30: 10 })).toBeNull(); // +150%: a few odd sales
      expect(trend({ trend: 1.5, avg7: 1.8, avg30: 1.5 })).toBeNull(); // $1.67 card
      expect(trend({ trend: 3, avg7: 0.44, avg30: 0.09 })).toBeNull(); // avg30 below €1
      expect(trend({ trend: 10, avg7: 12 })).toBeNull(); // avg30 missing
    });

    it('with a TCGplayer headline, only when Cardmarket prices the card similarly', () => {
      const t = { low: null, mid: null, high: null, market: 10, directLow: null };
      expect(trend({ trend: 10, avg7: 12, avg30: 10 }, t)).toBe(20); // $11.16 vs $10
      // base1-4: $987 on TCGplayer vs €430 (≈ $480) on Cardmarket → a different market, no badge.
      expect(trend({ trend: 430.3, avg7: 312.04, avg30: 430.3 }, { ...t, market: 987.13 })).toBeNull();
    });
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

describe('applyRates', () => {
  it('re-converts Cardmarket summaries with newer rates and keeps the update time', () => {
    const { variants, defaultVariant } = buildVariants(fixtures.jaSv8a084, rates);
    const card = { id: 'SV8a-084', variants, defaultVariant };
    const next = applyRates(card, { EUR: 0.9, KRW: 1400, fetchedAt: '' });
    const reverse = next.variants.find((v) => v.key === 'reverse')!;
    expect(reverse.summary).toMatchObject({ market: 1.68, updated: '2026-11-07T23:49:17.885Z' }); // 1.51 EUR / 0.9
    expect(next.id).toBe('SV8a-084');
    expect(card.variants.find((v) => v.key === 'reverse')!.summary?.market).toBe(1.69); // input untouched
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
