import { describe, expect, it } from 'vitest';
import { FALLBACK_RATES, type Rates } from './fx';
import { applyRates, buildVariants, formatMoney, isApproxPrice, summarize, valueTier } from './pricing';
import { setKey, type JaGroup, type JaSetFile } from './tcgplayerJa';
import type { CardmarketPrice, CardVariant, PriceSummary, TcgplayerPrice } from './types';
import jaCases from './__fixtures__/ja-tcgplayer.json';
import { fixtures } from './__fixtures__/mockFetch';

const rates: Rates = FALLBACK_RATES; // EUR 0.8957 / KRW 1359 per USD

/** Summaries keep exact USD (rounded only when shown); compare them in whole cents. */
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const inCents = (s: PriceSummary | null | undefined) => s && { ...s, market: r2(s.market), low: r2(s.low), high: r2(s.high) };

const byKey = (raw: unknown) => {
  const { variants, defaultVariant } = buildVariants(raw, rates);
  const centsVariants = variants.map((v) => ({ ...v, summary: inCents(v.summary) }));
  return { map: new Map(centsVariants.map((v) => [v.key, v])), keys: variants.map((v) => v.key), defaultVariant };
};

describe('buildVariants — real TCGdex cards', () => {
  it('ja SV8a-084: plain reverse borrows the top-level Cardmarket "-holo" price', () => {
    const { map, keys, defaultVariant } = byKey(fixtures.jaSv8a084);
    expect(keys).toEqual(['normal', 'reverse', 'reverse-masterball']); // most common first; the API lists Master Ball second
    expect(defaultVariant).toBe('normal');

    const reverse = map.get('reverse')!;
    expect(reverse.cardmarket).toMatchObject({ trend: 1.51, avg30: 1.83 });
    expect(reverse.summary).toMatchObject({
      market: 1.69, // 1.51 EUR / 0.8957
      low: 1.69,
      high: 2.04, // avg30-holo 1.83 EUR; avg1-holo 5.2 EUR is one day's lone sale, left out
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
    // The raw low is a lone 1-cent listing (under a third of the market price) and the middle listing ($0.15) is
    // above the market price: the range starts at the market price, not at "$0.01".
    expect(map.get('normal')!.summary).toMatchObject({ market: 0.1, low: 0.1, high: 0.15, changePct: null, source: 'tcgplayer', converted: false });
    // Same 1-cent listing; here the middle listing ($0.25) is the usual low.
    expect(map.get('reverse')!.summary).toMatchObject({ market: 0.26, low: 0.25, high: 0.26, changePct: null }); // −36% on 26¢: noise
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
    // Regular printings before the 1st edition (API order: holo, 1st edition shadowless, shadowless, 1999-2000).
    expect(keys).toEqual(['holo', 'holo-shadowless', 'holo-1999-2000-copyright', 'firstEdition-shadowless']);
    // 3499.1 > 3 × market → the cheapest Direct listing ($1,499.09), not the market price again.
    expect(map.get('holo')!.summary).toMatchObject({ market: 987.13, high: 1499.09, changePct: null });
    expect(map.get('firstEdition-shadowless')!).toMatchObject({ stamp: ['1st-edition'], subtype: 'shadowless' });
    expect(map.get('firstEdition-shadowless')!.summary).toMatchObject({ market: 3895.56, source: 'cardmarket', converted: true });
    // No own pricing and not a separate product → borrows the top-level (unlimited) price.
    expect(map.get('holo-1999-2000-copyright')!.summary?.market).toBe(987.13);
  });

  it('en sv01-189: a holo rare listed as [reverse, holo] comes out holo first and opens on the holo', () => {
    const { map, keys, defaultVariant } = byKey(fixtures.enSv01189);
    expect(keys).toEqual(['holo', 'reverse']);
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
    // API order: normal, 1st ed. shadowless, shadowless, red cheek, 1st ed. red cheek, 1999-2000, jumbo, Pokétour.
    expect(keys).toEqual([
      'normal',
      'normal-shadowless',
      'normal-shadowless-red-cheek',
      'normal-1999-2000-copyright',
      'firstEdition-shadowless',
      'firstEdition-shadowless-red-cheek',
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

  it('lists printings most common first, with keys given in API order (My Cards stores them)', () => {
    const list = [
      { type: 'normal', stamp: ['set-logo'] },
      { type: 'reverse', foil: 'masterball' },
      { type: 'reverse' },
      { type: 'holo', stamp: ['1st-edition'] },
      { type: 'holo', subtype: 'shadowless' },
      { type: 'holo', subtype: 'shadowless' },
      { type: 'holo' },
      { type: 'normal' },
      { type: 'reverse' },
    ];
    const { variants, defaultVariant } = buildVariants({ variants_detailed: list }, rates);
    expect(variants.map((v) => v.key)).toEqual([
      'normal',
      'holo',
      'holo-shadowless', // the first shadowless entry keeps the plain key…
      'holo-shadowless-2', // …and the second its "-2", whatever the order shown
      'firstEdition',
      'reverse',
      'reverse-2',
      'reverse-masterball',
      'normal-stamp-set-logo',
    ]);
    expect(defaultVariant).toBe('normal');
    // A price never moves a key or the order: only the default.
    const priced = list.map((v, i) => (i === 2 ? { ...v, pricing: { tcgplayer: { 'reverse-holofoil': { marketPrice: 3 } } } } : v));
    const again = buildVariants({ variants_detailed: priced }, rates);
    expect(again.variants.map((v) => v.key)).toEqual(variants.map((v) => v.key));
    expect(again.defaultVariant).toBe('reverse');
  });

  it('"1st edition" with a space (old Japanese sets) is the 1st-edition stamp too', () => {
    const tcgplayer = { normal: { marketPrice: 1 }, '1st-edition': { marketPrice: 9 } };
    const { variants } = buildVariants(
      { variants_detailed: [{ type: 'normal', stamp: ['1st edition'], pricing: { tcgplayer } }, { type: 'normal', subtype: 'unlimited', pricing: { tcgplayer } }] },
      rates,
    );
    expect(variants.map((v) => [v.key, v.summary?.market])).toEqual([
      ['normal', 1],
      ['firstEdition', 9],
    ]);
    expect(variants[1].stamp).toEqual(['1st edition']);
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
    expect(summarize(tcg, { ...cm, avg: 3.5, trend: 2 }, rates)?.high).toBeCloseTo(3.5 / rates.EUR, 9); // 3.5 EUR
  });

  it('caps every fallback candidate at 3× market: a lone Direct listing or a Cardmarket spike is not the highest price', () => {
    // smp-SM01: one $95.53 Direct copy of a $2.14 promo (raw high 114.64) → mid, not 45× the market price.
    const sm01 = { low: 1.5, mid: 2.16, high: 114.64, market: 2.14, directLow: 95.53 };
    expect(summarize(sm01, null, rates)?.high).toBe(2.16);
    // With its Cardmarket prices (≈ €4.2–4.6): the highest one that passes (trend €4.56 = $5.09, under 3 × 2.14).
    const sm01cm = { avg: 3.8, low: 0.5, trend: 4.56, avg1: 9, avg7: 4.47, avg30: 4.19 };
    expect(summarize(sm01, sm01cm, rates)?.high).toBeCloseTo(4.56 / rates.EUR, 9);
    // smp-SM60: directLow is the rejected raw high itself; Cardmarket is below market → the market price.
    const sm60 = { low: 25, mid: 50, high: 518.14, market: 53.93, directLow: 518.14 };
    const sm60cm = { avg: 22.75, low: 6.99, trend: 26.83, avg1: 14, avg7: 26.56, avg30: 22.68 };
    expect(summarize(sm60, sm60cm, rates)?.high).toBe(53.93);
    // smp-SM151: Cardmarket trend (€93.80 = $104.72) is above the cap, avg (€79.17 = $88.39) is not → it still counts.
    const sm151 = { low: 20, mid: 36.07, high: 498.7, market: 32.05, directLow: 34.61 };
    const sm151cm = { avg: 79.17, low: 30, trend: 93.8, avg1: 120, avg7: 99.4, avg30: 53.74 };
    expect(summarize(sm151, sm151cm, rates)?.high).toBeCloseTo(79.17 / rates.EUR, 9);
    // Exactly 3× still counts; just above does not.
    expect(summarize({ ...sm01, mid: null, directLow: 6.42 }, null, rates)?.high).toBe(6.42);
    expect(summarize({ ...sm01, mid: null, directLow: 6.43 }, null, rates)?.high).toBe(2.14);
  });

  it('clamps low ≤ market ≤ high', () => {
    expect(summarize({ low: 3, mid: null, high: 1, market: 2, directLow: null }, null, rates)).toMatchObject({ low: 2, market: 2, high: 2 });
  });

  describe('TCGplayer: the lowest price', () => {
    const low = (t: Partial<TcgplayerPrice>) => summarize({ low: null, mid: null, high: null, market: null, directLow: null, ...t }, null, rates)?.low;
    it('is the cheapest listing when that is at least a third of the market price', () => {
      expect(low({ low: 2.27, mid: 3.15, market: 2.27 })).toBe(2.27);
      expect(low({ low: 0.34, mid: 0.63, market: 0.6 })).toBe(0.34);
      expect(low({ low: 233.96, mid: 326.3, market: 295.26 })).toBe(233.96);
    });

    it('a lone 1-cent listing is not the usual low: the middle listing, else the market price', () => {
      expect(low({ low: 0.01, mid: 0.17, market: 0.18 })).toBe(0.17); // ja SV8a-084: was "$0.01 – $0.18"
      expect(low({ low: 0.01, mid: 0.15, market: 0.1 })).toBe(0.1); // en sv08.5-084: mid is above the market price
      expect(low({ low: 0.01, mid: 0.02, market: 0.1 })).toBe(0.1); // both under a third
      expect(low({ low: 0.01, market: 0.1 })).toBe(0.1);
    });

    it('exactly a third still counts, whatever the float rounding', () => {
      expect(low({ low: 0.15, mid: 0.5, market: 0.45 })).toBe(0.15); // 0.15 × 3 = 0.44999999999999996
      expect(low({ low: 0.3, mid: 0.8, market: 0.9 })).toBe(0.3);
      expect(low({ low: 0.03, mid: 0.08, market: 0.09 })).toBe(0.03);
      expect(low({ low: 0.14, mid: 0.5, market: 0.45 })).toBe(0.45);
    });

    it('never sits above the market price', () => {
      expect(low({ low: 12, mid: 14, market: 9.54 })).toBe(9.54); // ja SV8a-070 Master Ball
      expect(low({ low: 12, mid: 9, market: 9.54 })).toBe(9);
      expect(low({ mid: 0.5, market: 1 })).toBe(0.5); // no listing price at all: the middle one
      expect(low({ market: 1 })).toBe(1);
    });
  });

  describe('TCGplayer asking price (listings, no recent sales)', () => {
    const asking: TcgplayerPrice = { low: 3.49, mid: 4.99, high: 22, market: null, directLow: null, asking: true };
    it('shows the chosen asking price as an approximate TCGplayer price', () => {
      const s = summarize(asking, null, rates, '2026-11-11T20:05:27Z')!;
      // High: $22 is over 3× the asking price → the asking price itself. Low: the cheapest listing ($3.49).
      expect(s).toEqual({ market: 4.99, low: 3.49, high: 4.99, changePct: null, source: 'tcgplayer', converted: false, asking: true, updated: '2026-11-11T20:05:27Z' });
      expect(isApproxPrice(s)).toBe(true);
      expect(formatMoney(s.market, 'USD', rates, { approx: isApproxPrice(s) })).toBe('≈ $4.99');
      expect(formatMoney(s.market, 'KRW', rates, { approx: isApproxPrice(s), lang: 'ko' })).toBe('약 6,780원');
    });

    it('never gets an up/down badge, and the headline is `mid` even if a market price sneaks in', () => {
      const cm = { avg: 5, low: 4, trend: 5, avg1: 5, avg7: 6, avg30: 5 };
      expect(summarize({ ...asking, low: 4, mid: 5, high: 6 }, cm, rates)).toMatchObject({ market: 5, changePct: null, asking: true });
      expect(summarize({ ...asking, low: 4, mid: 5, high: 6, asking: undefined, market: 5 }, cm, rates)).toMatchObject({ market: 5, changePct: 20 });
      expect(summarize({ ...asking, market: 9 }, null, rates)).toMatchObject({ market: 4.99, asking: true });
      expect(summarize({ ...asking, mid: null }, null, rates)).toBeNull();
    });

    it('other summaries are not approximate because of it', () => {
      expect(isApproxPrice(summarize({ ...asking, asking: undefined, market: 5 }, null, rates))).toBe(false);
      expect(summarize({ ...asking, asking: undefined, market: 5 }, null, rates)).not.toHaveProperty('asking');
      expect(isApproxPrice(summarize(null, { avg: null, low: null, trend: 1, avg1: null, avg7: null, avg30: null }, rates))).toBe(true); // converted
      expect(isApproxPrice(null)).toBe(false);
    });
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
    // high = avg €4: one day's average (avg1 €5) is left out of the range.
    expect(inCents(s)).toEqual({ market: 3.35, low: 2.23, high: 4.47, changePct: 25, source: 'cardmarket', converted: true, updated: '2026-11-07' });
  });

  describe('Cardmarket only: the usual range', () => {
    const usd = (eur: number) => eur / rates.EUR;
    it('ja SV8a-031: one day\'s €5.39 sale is not the highest price of a €1.29 card', () => {
      // Was "약 1,960원 ~ 약 8,180원". Now €1.29 ~ €1.75 (avg7).
      const s = summarize(null, { avg: 1.34, low: 0.1, trend: 1.29, avg1: 5.39, avg7: 1.75, avg30: 1.51 }, rates)!;
      expect(s.market).toBeCloseTo(usd(1.29), 9);
      expect(s.low).toBeCloseTo(usd(1.29), 9);
      expect(s.high).toBeCloseTo(usd(1.75), 9);
      expect(formatMoney(s.high, 'KRW', rates, { lang: 'ko', approx: true })).toBe('약 2,660원');
    });

    it('caps every average at 3× the market price either way', () => {
      const range = (cm: Partial<CardmarketPrice>) => {
        const s = summarize(null, { avg: null, low: null, trend: 1, avg1: null, avg7: null, avg30: null, ...cm }, rates)!;
        return [s.low, s.high].map((x) => r2(x! * rates.EUR));
      };
      expect(range({ avg7: 0.34, avg30: 3 })).toEqual([0.34, 3]); // exactly 3× still counts
      expect(range({ avg7: 0.33, avg30: 3.01 })).toEqual([1, 1]);
      expect(range({ avg7: 1.2, avg30: 0.9, avg: 3.5 })).toEqual([0.9, 1.2]); // a spiky all-time average too
      expect(range({ avg7: 1.2, avg30: 0.9, avg: 2.5 })).toEqual([0.9, 2.5]);
      // One day's average never widens the range (the week's average already counts that day).
      expect(range({ avg1: 0.5, avg7: 1.2, avg30: 0.9 })).toEqual([0.9, 1.2]);
      expect(range({ avg1: 2.5, avg7: 1.2, avg30: 0.9 })).toEqual([0.9, 1.2]);
    });

    it('exactly 3× counts on both sides whatever the cents are (0.15 × 3 is 0.44999999999999996)', () => {
      const range = (cm: Partial<CardmarketPrice>) => {
        const s = summarize(null, { avg: null, low: null, trend: null, avg1: null, avg7: null, avg30: null, ...cm }, rates)!;
        return [s.market, s.low, s.high].map((x) => r2(x! * rates.EUR));
      };
      expect(range({ trend: 0.03, avg30: 0.09 })).toEqual([0.03, 0.03, 0.09]); // ja SV8a-084: always worked
      expect(range({ trend: 0.15, avg30: 0.45 })).toEqual([0.15, 0.15, 0.45]); // used to drop the €0.45
      expect(range({ trend: 0.45, avg30: 0.15 })).toEqual([0.45, 0.15, 0.45]); // and the €0.15 here
      expect(range({ trend: 0.15, avg: 0.46 })).toEqual([0.15, 0.15, 0.15]); // just over 3×: left out
      expect(range({ trend: 0.45, avg1: 0.45, avg7: 0.14, avg30: 0.45 })).toEqual([0.45, 0.45, 0.45]); // just under a third
      // The trend against recent sales: a third of their median, 3× the highest.
      expect(range({ trend: 0.15, avg1: 0.45, avg7: 0.45, avg30: 0.45 })[0]).toBe(0.15);
      expect(range({ trend: 0.45, avg1: 0.15, avg7: 0.15, avg30: 0.15 })[0]).toBe(0.45);
      // Placeholder averages against the cheapest copy: €1.05 is exactly 3 × €0.35, so the averages stay.
      expect(range({ trend: 0.35, avg1: 0.35, avg7: 0.35, avg30: 0.35, low: 1.05 })[0]).toBe(0.35);
      expect(range({ trend: 0.35, avg1: 0.35, avg7: 0.35, avg30: 0.35, low: 1.06 })[0]).toBe(1.06);
      // A TCGplayer high of exactly 3× the market price is still the highest price.
      expect(summarize({ low: 0.15, mid: 0.2, high: 0.45, market: 0.15, directLow: null }, null, rates)?.high).toBe(0.45);
      expect(summarize({ low: 0.15, mid: 0.2, high: 0.46, market: 0.15, directLow: null }, null, rates)?.high).toBe(0.2);
    });
  });

  describe('Cardmarket only: a junk trend is not the market price', () => {
    const usd = (eur: number) => eur / rates.EUR;
    it('ja SV8a-092: a €0.02 trend on a card that sells for €0.18–0.30 gives way to the week\'s average', () => {
      // Was "약 30원" (trend) with a high of €3.23 (an old avg30 spike).
      const cm = { avg: 2.71, low: 0.02, trend: 0.02, avg1: 0.3, avg7: 0.18, avg30: 3.23 };
      const s = summarize(null, cm, rates)!;
      expect(s.market).toBeCloseTo(usd(0.18), 9);
      expect(s.low).toBeCloseTo(usd(0.18), 9); // the junk trend is not the low either
      expect(s.high).toBeCloseTo(usd(0.18), 9); // avg30 €3.23 and avg €2.71 are more than 3× away
      expect(s.changePct).toBeNull();
      expect(formatMoney(s.market, 'KRW', rates, { lang: 'ko', approx: true })).toBe('약 270원');
      // Without the week's average, the month's.
      expect(summarize(null, { ...cm, avg7: null, avg30: 0.25 }, rates)!.market).toBeCloseTo(usd(0.25), 9);
    });

    it('ja SV2a-148: a €4.87 trend on a card that sells for €0.08–0.12 gives way too', () => {
      const s = summarize(null, { avg: 0.1, low: 0.02, trend: 4.87, avg1: 0.12, avg7: 0.08, avg30: 0.11 }, rates)!;
      expect(s.market).toBeCloseTo(usd(0.08), 9);
      expect(s.high).toBeCloseTo(usd(0.11), 9);
    });

    it('keeps a trend the recent sales back, or one there is nothing to judge by', () => {
      const market = (cm: Partial<CardmarketPrice>) =>
        r2(summarize(null, { avg: null, low: null, trend: null, avg1: null, avg7: null, avg30: null, ...cm }, rates)!.market! * rates.EUR);
      // ja SV8a-001: the price went up this week; the trend follows the week's average, not the month's.
      expect(market({ trend: 0.41, avg1: 0.02, avg7: 0.44, avg30: 0.09 })).toBe(0.41);
      // A third of the median still counts; 3× the highest recent average still counts.
      expect(market({ trend: 0.1, avg1: 0.3, avg7: 0.2, avg30: 0.4 })).toBe(0.1);
      expect(market({ trend: 0.09, avg1: 0.3, avg7: 0.2, avg30: 0.4 })).toBe(0.2);
      expect(market({ trend: 1.2, avg1: 0.3, avg7: 0.2, avg30: 0.4 })).toBe(1.2);
      expect(market({ trend: 1.21, avg1: 0.3, avg7: 0.2, avg30: 0.4 })).toBe(0.2);
      // Only one day's average to judge by: the trend stays.
      expect(market({ trend: 0.02, avg1: 0.3 })).toBe(0.02);
      expect(market({ trend: 0.5 })).toBe(0.5);
      // No trend: the averages, as before.
      expect(market({ avg30: 0.3, avg: 0.4, avg7: 0.5 })).toBe(0.3);
    });

    it('ja SV2a-104 Poké Ball reverse: placeholder averages nobody sells near give way to the cheapest copy', () => {
      // Was "약 340원" (€0.25 in every average) for a card whose cheapest copy is €40.
      const s = summarize(null, { avg: null, low: 40, trend: 0.25, avg1: 0.25, avg7: 0.25, avg30: 0.25 }, rates)!;
      expect(s.market).toBeCloseTo(usd(40), 9);
      expect([s.low, s.high]).toEqual([s.market, s.market]); // the €0.25 averages are not the usual range
      expect(s.changePct).toBeNull();
      // Below €1, or within 3×, the cheapest listing changes nothing.
      const placeholder = (eur: number) => ({ avg: null, trend: eur, avg1: eur, avg7: eur, avg30: eur });
      const market = (cm: Partial<CardmarketPrice>) =>
        r2(summarize(null, { avg: null, low: null, trend: null, avg1: null, avg7: null, avg30: null, ...cm }, rates)!.market! * rates.EUR);
      expect(market({ ...placeholder(0.1), low: 0.9 })).toBe(0.1);
      expect(market({ ...placeholder(0.5), low: 1.5 })).toBe(0.5);
      expect(market({ ...placeholder(0.5), low: 1.51 })).toBe(1.51);
      expect(market({ ...placeholder(0.5), avg1: null, low: 1.51 })).toBe(1.51);
      // Real averages (they differ, or there is an all-time average) are never replaced by one listing: a cheap card
      // whose cheap copies sold out keeps its price.
      expect(market({ trend: 0.2, avg1: 0.18, avg7: 0.22, avg30: 0.2, avg: 0.21, low: 1.5 })).toBe(0.2);
      expect(market({ ...placeholder(0.25), avg: 0.25, low: 40 })).toBe(0.25);
    });

    it('a junk Cardmarket trend is not a TCGplayer card\'s highest price either', () => {
      const tp = { low: 1.5, mid: null, high: 999, market: 2, directLow: null };
      expect(summarize(tp, { avg: null, low: null, trend: 5, avg1: 0.1, avg7: 0.1, avg30: 0.12 }, rates)?.high).toBe(2);
      expect(summarize(tp, { avg: null, low: null, trend: 5, avg1: 4, avg7: 4.5, avg30: 4.2 }, rates)?.high).toBeCloseTo(usd(5), 9);
    });
  });

  it('Cardmarket only: keeps exact USD so a penny card is not rounded twice (€0.04 → 60원, not 50원)', () => {
    const s = summarize(null, { avg: null, low: null, trend: 0.04, avg1: null, avg7: null, avg30: null }, rates)!;
    expect(s.market).toBeCloseTo(0.04 / rates.EUR, 12); // $0.0447, not $0.04
    expect(formatMoney(s.market, 'KRW', rates, { lang: 'ko', approx: true })).toBe('약 60원');
    expect(formatMoney(s.market, 'USD', rates, { approx: true })).toBe('≈ $0.04');
  });

  it('returns null without any usable number', () => {
    expect(summarize(null, null, rates)).toBeNull();
    expect(summarize({ low: 1, mid: null, high: null, market: null, directLow: null }, null, rates)).toBeNull();
  });
});

describe('buildVariants with a TCGplayer-Japan price file (real cards and products of 2026-11-11)', () => {
  type CaseId = keyof typeof jaCases;
  const UPDATED = '2026-11-11T20:05:27Z';
  const CASES = Object.keys(jaCases) as CaseId[];
  /** The set file in the format scripts/build-ja-prices.mjs writes, holding this card's products only. */
  const fileOf = (id: CaseId): JaSetFile => ({ v: 1, d: UPDATED, k: setKey(jaCases[id].card.set.id), g: jaCases[id].groups as unknown as JaGroup[] });
  const usd = (n: number | null) => formatMoney(n, 'USD', rates);
  /** A printing the way the card screen words it: "$0.18 ($0.17 – $0.18) tcgplayer". */
  const shown = (v: CardVariant) =>
    v.summary
      ? `${formatMoney(v.summary.market, 'USD', rates, { approx: isApproxPrice(v.summary) })} (${usd(v.summary.low)} – ${usd(v.summary.high)}) ${v.summary.source}`
      : 'No price';
  const build = (id: CaseId, file: JaSetFile | null = fileOf(id)) => {
    const { variants, defaultVariant } = buildVariants(jaCases[id].card, rates, file);
    return { variants, defaultVariant, map: new Map(variants.map((v) => [v.key, v])), lines: variants.map((v) => `${v.key}: ${shown(v)}`) };
  };

  it('ja SV8a-084 Hawlucha (the owner\'s card): Normal $0.18 · Poké Ball mirror $0.60 · Master Ball $2.27', () => {
    const { variants, defaultVariant, map, lines } = build('SV8a-084');
    expect(lines).toEqual([
      'normal: $0.18 ($0.17 – $0.18) tcgplayer',
      'reverse: $0.60 ($0.34 – $0.63) tcgplayer',
      'reverse-masterball: $2.27 ($2.27 – $3.15) tcgplayer',
    ]);
    expect(defaultVariant).toBe('normal');
    expect(variants.map((v) => v.summary)).toEqual([
      { market: 0.18, low: 0.17, high: 0.18, changePct: null, source: 'tcgplayer', converted: false, updated: UPDATED },
      { market: 0.6, low: 0.34, high: 0.63, changePct: null, source: 'tcgplayer', converted: false, updated: UPDATED },
      { market: 2.27, low: 2.27, high: 3.15, changePct: null, source: 'tcgplayer', converted: false, updated: UPDATED },
    ]);
    expect(variants.map((v) => v.tcgplayerId)).toEqual([602464, 602465, 604564]);
    // The product's own rows, as More prices shows them (the normal product has a Normal and a Holofoil row).
    expect(map.get('normal')!.tcgplayer).toEqual({ low: 0.01, mid: 0.17, high: 1, market: 0.18, directLow: null });
    expect(map.get('reverse-masterball')!.tcgplayer).toEqual({ low: 2.27, mid: 3.15, high: 7, market: 2.27, directLow: null });
    // The mirror no longer carries the card-level "-holo" numbers (all mirror patterns mixed, trend €1.51): they
    // would have made its range "$0.34 – $1.69". The normal printing keeps its own Cardmarket block.
    expect(map.get('reverse')!.cardmarket).toBeNull();
    expect(map.get('normal')!.cardmarket).toMatchObject({ trend: 0.03, avg30: 0.09 });
    // Korean kid: the same prices in won.
    expect(variants.map((v) => formatMoney(v.summary!.market, 'KRW', rates, { lang: 'ko', approx: isApproxPrice(v.summary) }))).toEqual(['240원', '820원', '3,080원']);
    expect(variants.map((v) => valueTier(v.summary!.market))).toEqual(['common', 'common', 'nice']);
  });

  it('ja SV8a-084 without a file: Cardmarket as before (Normal ≈ $0.03, Master Ball no price), most common first', () => {
    const { defaultVariant, map, lines } = build('SV8a-084', null);
    expect(lines).toEqual(['normal: ≈ $0.03 ($0.03 – $0.10) cardmarket', 'reverse: ≈ $1.69 ($1.69 – $2.04) cardmarket', 'reverse-masterball: No price']);
    expect(defaultVariant).toBe('normal');
    expect(map.get('reverse')!.cardmarket).toMatchObject({ trend: 1.51 });
    expect(map.get('reverse-masterball')!.tcgplayerId).toBe(604564);
  });

  it.each<[CaseId, string, string[]]>([
    ['M6a-061', 'a "normal" variant whose only row is Holofoil, found by card number', ['normal: $1.31 ($0.69 – $1.42) tcgplayer']],
    [
      'SV2a-094',
      'no TCGdex ids: holo, Poké Ball and Master Ball by number + name tag (Cardmarket said ≈ $893 for the Poké Ball)',
      ['holo: $2.56 ($1.95 – $3.07) tcgplayer', 'reverse-pokeball: $13.78 ($12.00 – $15.78) tcgplayer', 'reverse-masterball: $701.17 ($598.00 – $800.00) tcgplayer'],
    ],
    ['SV4a-347', 'an expensive ex', ['holo: $502.88 ($450.00 – $530.00) tcgplayer']],
    ['SV-P-001', 'a promo with a market price', ['normal: $21.18 ($17.99 – $30.00) tcgplayer']],
    ['CP2-018', 'a "1st Edition Holofoil" row on a plain holo variant; the one listing is above the market price', ['holo: $89.00 ($89.00 – $96.00) tcgplayer']],
    ['SV9a-022', 'Cardmarket has another card\'s product here (≈ $21.88)', ['normal: $0.47 ($0.46 – $0.79) tcgplayer']],
    [
      'M2a-001',
      'by number, and the third printing (TCGdex "reverse", TCGplayer "Poke Ball Pattern") by the leftover rule',
      ['normal: $0.10 ($0.10 – $0.15) tcgplayer', 'reverse: $0.93 ($0.45 – $0.98) tcgplayer', 'reverse-energy: $0.53 ($0.20 – $0.55) tcgplayer'],
    ],
  ])('ja %s: %s', (id, _, lines) => {
    const built = build(id);
    expect(built.lines).toEqual(lines);
    expect(built.defaultVariant).toBe(built.variants[0].key);
    for (const v of built.variants) expect(v.summary).toMatchObject({ converted: false, updated: UPDATED });
  });

  it('gives cards TCGdex has no product id for their TCGplayer id (link, picture)', () => {
    expect(build('SV2a-094', null).variants.map((v) => v.tcgplayerId)).toEqual([undefined, undefined, undefined]);
    expect(build('SV2a-094').variants.map((v) => v.tcgplayerId)).toEqual([566439, 566638, 566791]);
    expect(build('M2a-001').variants.map((v) => v.tcgplayerId)).toEqual([665672, 665922, 666088]);
    expect(build('M6a-061').variants[0].tcgplayerId).toBe(716863);
  });

  it('keeps a printing\'s own Cardmarket block next to the TCGplayer price (up/down badge, More prices)', () => {
    const mew = build('SV4a-347').map.get('holo')!;
    expect(mew.cardmarket).not.toBeNull();
    expect(mew.summary).toMatchObject({ market: 502.88, changePct: 10.6 }); // Cardmarket prices it similarly: its trend counts
    // M2a-001's mirror has its own Cardmarket product (not the card-level "-holo" block): kept.
    expect(build('M2a-001').map.get('reverse')!.cardmarket).not.toBeNull();
    // SV9a-022: Cardmarket's €19.60 is another market altogether: no badge, and it does not stretch the range.
    expect(build('SV9a-022').map.get('normal')!.summary).toMatchObject({ high: 0.79, changePct: null });
  });

  it('ja SV-P-017: TCGplayer only has asking prices ($120–133), so the Cardmarket sales price stays', () => {
    const { lines, variants } = build('SV-P-017');
    expect(lines).toEqual(['normal: ≈ $3.22 ($3.22 – $3.39) cardmarket']);
    expect(variants).toEqual(build('SV-P-017', null).variants);
    expect(variants[0]).toMatchObject({ tcgplayer: null, tcgplayerId: 587774, summary: { converted: true, updated: '2026-11-11T23:49:36.436Z' } });
  });

  it('ja PMCG1-001 (1996, products without a card number): regular by id; one $149.99 listing is no price', () => {
    const { lines, defaultVariant, map } = build('PMCG1-001');
    expect(lines).toEqual(['normal: $7.04 ($4.25 – $7.04) tcgplayer', 'normal-no-rarity: No price']);
    expect(defaultVariant).toBe('normal');
    expect(map.get('normal-no-rarity')).toMatchObject({ tcgplayer: null, tcgplayerId: 576998 });
    expect(build('PMCG1-001', null).lines).toEqual(['normal: No price', 'normal-no-rarity: No price']);
  });

  it('ja SV8a-121: the mirror\'s product has no price row, so it keeps the Cardmarket stand-in', () => {
    const { lines, map } = build('SV8a-121');
    expect(lines).toEqual([
      'normal: $0.17 ($0.17 – $0.20) tcgplayer',
      'reverse: ≈ $1.56 ($1.50 – $2.12) cardmarket',
      'reverse-masterball: $7.80 ($7.00 – $9.87) tcgplayer',
    ]);
    // What the UI labels "all mirror patterns together": a plain mirror on Cardmarket next to a special-foil sibling.
    expect(map.get('reverse')).toMatchObject({ type: 'reverse', tcgplayer: null, tcgplayerId: 602529, summary: { source: 'cardmarket', converted: true } });
    expect(map.get('reverse')!.foil).toBeUndefined();
    expect(map.get('reverse')!.summary).toEqual(build('SV8a-121', null).map.get('reverse')!.summary);
  });

  it('ja SV8a-185: a Master Ball product without a price row (and no Cardmarket) stays without a price', () => {
    const { lines, defaultVariant } = build('SV8a-185');
    expect(lines).toEqual(['normal: $0.13 ($0.13 – $0.14) tcgplayer', 'reverse: $0.33 ($0.20 – $0.40) tcgplayer', 'reverse-masterball: No price']);
    expect(defaultVariant).toBe('normal');
  });

  it('an asking-only product without a Cardmarket price: approximate TCGplayer asking price', () => {
    // SV-P-127 as the files have it: three listings, no sale.
    const card = { localId: '127', variants_detailed: [{ type: 'normal', thirdParty: { tcgplayer: 587877 }, pricing: { cardmarket: null, tcgplayer: null } }] };
    const file: JaSetFile = { v: 1, d: UPDATED, k: 'sv-p', g: [{ id: 23779, n: 'SV-P Promotional Cards', c: 1, p: { '587877': ['127/SV-P', '', { normal: [null, 3.49, 4.99, 22] }] } }] };
    const [v] = buildVariants(card, rates, file).variants;
    expect(v.tcgplayer).toEqual({ low: 3.49, mid: 4.99, high: 22, market: null, directLow: null, asking: true });
    expect(v.summary).toEqual({ market: 4.99, low: 3.49, high: 4.99, changePct: null, source: 'tcgplayer', converted: false, asking: true, updated: UPDATED });
    expect(shown(v)).toBe('≈ $4.99 ($3.49 – $4.99) tcgplayer');
    expect(buildVariants(card, rates).variants[0].summary).toBeNull();
    // A Cardmarket block that gives no price does not count as "own Cardmarket price".
    const noPrice = { ...card, variants_detailed: [{ ...card.variants_detailed[0], pricing: { cardmarket: { low: 2, trend: 0 }, tcgplayer: null } }] };
    expect(buildVariants(noPrice, rates, file).variants[0].summary).toMatchObject({ market: 4.99, asking: true });
    // With real Cardmarket sales, those win.
    const sold = { ...card, variants_detailed: [{ ...card.variants_detailed[0], pricing: { cardmarket: { trend: 2, avg7: 2, avg30: 2 }, tcgplayer: null } }] };
    expect(buildVariants(sold, rates, file).variants[0].summary).toMatchObject({ source: 'cardmarket', converted: true });
  });

  it('a card without variants_detailed: the flags\' mirror also drops the card-level "-holo" block when matched', () => {
    const card = {
      localId: '084',
      variants: { normal: true, reverse: true },
      pricing: { cardmarket: { trend: 0.03, avg30: 0.09, 'trend-holo': 1.51, 'avg30-holo': 1.83 } },
    };
    const before = buildVariants(card, rates);
    expect(before.variants.map((v) => [v.key, v.summary?.source, v.cardmarket?.trend])).toEqual([
      ['normal', 'cardmarket', 0.03],
      ['reverse', 'cardmarket', 1.51],
    ]);
    const after = buildVariants(card, rates, fileOf('SV8a-084'));
    expect(after.variants.map((v) => [v.key, v.summary?.market, v.cardmarket?.trend, v.tcgplayerId])).toEqual([
      ['normal', 0.18, 0.03, 602464],
      ['reverse', 0.6, undefined, 602465],
    ]);
  });

  it('without a file, with an empty one or with another card\'s products nothing changes', () => {
    for (const id of CASES) {
      const plain = buildVariants(jaCases[id].card, rates);
      expect(buildVariants(jaCases[id].card, rates, null)).toEqual(plain);
      expect(buildVariants(jaCases[id].card, rates, undefined)).toEqual(plain);
      expect(buildVariants(jaCases[id].card, rates, { ...fileOf(id), g: [] })).toEqual(plain);
      const other = id === 'SV4a-347' ? 'SV8a-084' : 'SV4a-347';
      expect(buildVariants(jaCases[id].card, rates, fileOf(other))).toEqual(plain);
    }
  });

  it('never moves a key or the order, and never takes a price away', () => {
    for (const id of CASES) {
      const before = buildVariants(jaCases[id].card, rates).variants;
      const after = build(id).variants;
      expect(after.map((v) => v.key)).toEqual(before.map((v) => v.key));
      after.forEach((v, i) => {
        if (before[i].summary) expect(v.summary?.market, `${id} ${v.key}`).toBeGreaterThan(0);
        if (v.summary?.source === 'tcgplayer') {
          expect(v.summary.low!).toBeLessThanOrEqual(v.summary.market!);
          expect(v.summary.high!).toBeGreaterThanOrEqual(v.summary.market!);
        }
      });
    }
  });

  it('survives applyRates: TCGplayer prices, asking marks and their time stay; Cardmarket ones are re-converted', () => {
    const other = { EUR: 0.86, KRW: 1400, fetchedAt: '' };
    for (const id of CASES) {
      const card = build(id);
      expect(applyRates(card, rates).variants).toEqual(card.variants);
      applyRates(card, other).variants.forEach((v, i) => {
        const was = card.variants[i];
        if (was.summary?.source === 'tcgplayer') expect(v.summary).toEqual({ ...was.summary, high: v.summary!.high, changePct: v.summary!.changePct });
        else if (was.summary) expect(v.summary).toMatchObject({ source: 'cardmarket', market: (was.summary.market! * rates.EUR) / other.EUR, updated: was.summary.updated });
        else expect(v.summary).toBeNull();
        expect({ ...v, summary: null }).toEqual({ ...was, summary: null });
      });
    }
    // The user's card, exactly.
    const again = applyRates(build('SV8a-084'), other);
    expect(again.variants.map((v) => [v.key, v.summary?.source, v.summary?.market, v.summary?.low, v.summary?.high, v.summary?.updated])).toEqual([
      ['normal', 'tcgplayer', 0.18, 0.17, 0.18, UPDATED],
      ['reverse', 'tcgplayer', 0.6, 0.34, 0.63, UPDATED],
      ['reverse-masterball', 'tcgplayer', 2.27, 2.27, 3.15, UPDATED],
    ]);
    // An asking price keeps its mark.
    const asking: CardVariant = { key: 'normal', type: 'normal', tcgplayer: { low: 3.49, mid: 4.99, high: 22, market: null, directLow: null, asking: true }, cardmarket: null, summary: null };
    expect(applyRates({ variants: [{ ...asking, summary: summarize(asking.tcgplayer, null, rates, UPDATED) }] }, other).variants[0].summary).toEqual({
      market: 4.99,
      low: 3.49,
      high: 4.99,
      changePct: null,
      source: 'tcgplayer',
      converted: false,
      asking: true,
      updated: UPDATED,
    });
  });
});

describe('applyRates', () => {
  it('re-converts Cardmarket summaries with newer rates and keeps the update time', () => {
    const { variants, defaultVariant } = buildVariants(fixtures.jaSv8a084, rates);
    const card = { id: 'SV8a-084', variants, defaultVariant };
    const next = applyRates(card, { EUR: 0.9, KRW: 1400, fetchedAt: '' });
    const reverse = next.variants.find((v) => v.key === 'reverse')!;
    expect(inCents(reverse.summary)).toMatchObject({ market: 1.68, updated: '2026-11-07T23:49:17.885Z' }); // 1.51 EUR / 0.9
    expect(next.id).toBe('SV8a-084');
    expect(r2(card.variants.find((v) => v.key === 'reverse')!.summary!.market)).toBe(1.69); // input untouched
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
    [0.996, 'nice'], // shown as $1.00
    [4.994, 'nice'], // shown as $4.99
  ] as const)('%s → %s', (usd, tier) => expect(valueTier(usd)).toBe(tier));

  it('uses won thresholds for Korean kids (1,000 / 5,000 / 30,000 / 150,000원)', () => {
    const won = { EUR: 0.9, KRW: 1000, fetchedAt: '2026-11-08T00:00:00.000Z' };
    const tier = (krw: number) => valueTier(krw / 1000, 'KRW', won);
    expect(tier(990)).toBe('common');
    expect(tier(1000)).toBe('nice');
    expect(tier(4990)).toBe('nice');
    expect(tier(5000)).toBe('rare');
    expect(tier(29_900)).toBe('rare');
    expect(tier(30_000)).toBe('super');
    expect(tier(149_900)).toBe('super');
    expect(tier(150_000)).toBe('treasure');
    expect(tier(995)).toBe('nice'); // shown as 1,000원
    expect(valueTier(null, 'KRW', won)).toBe('common');
    // The same $0.80 card: pocket change in dollars, a snack in won.
    expect(valueTier(0.8, 'USD', won)).toBe('common');
    expect(valueTier(0.8, 'KRW', { ...won, KRW: 1359 })).toBe('nice');
  });
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
    expect(formatMoney(NaN, 'KRW', rates, { lang: 'ko', approx: true })).toBe('—');
    expect(formatMoney(1.69, 'USD', rates, { approx: true })).toBe('≈ $1.69');
  });

  it('formats won Korean-style for the Korean UI', () => {
    const r = { ...rates, KRW: 1000 };
    expect(formatMoney(4.76, 'KRW', r, { lang: 'ko' })).toBe('4,760원');
    expect(formatMoney(4.76, 'KRW', r, { lang: 'ko', approx: true })).toBe('약 4,760원');
    expect(formatMoney(123.4, 'KRW', r, { lang: 'ko' })).toBe('123,400원');
    expect(formatMoney(1975.4, 'KRW', r, { lang: 'ko' })).toBe('198만 원');
    expect(formatMoney(120000, 'KRW', r, { lang: 'ko' })).toBe('1억 2,000만 원');
    expect(formatMoney(100000, 'KRW', r, { lang: 'ko' })).toBe('1억 원');
    expect(formatMoney(4.76, 'KRW', r, { lang: 'en', approx: true })).toBe('≈ ₩4,760');
    // One sign for "about" in the Korean UI, whatever the money.
    expect(formatMoney(4.76, 'USD', r, { lang: 'ko', approx: true })).toBe('약 $4.76');
    expect(formatMoney(0.0447, 'USD', r, { lang: 'ko', approx: true })).toBe('약 $0.04');
    expect(formatMoney(4.76, 'USD', r, { lang: 'en', approx: true })).toBe('≈ $4.76');
    expect(formatMoney(1975.4, 'USD', r, { lang: 'ko', approx: true })).toBe('약 $1,975');
    expect(formatMoney(4.76, 'USD', r, { lang: 'ko' })).toBe('$4.76');
  });

  it('rounds unrounded (converted) amounts only for display', () => {
    const r = { ...rates, KRW: 1000 };
    expect(formatMoney(0.0447, 'KRW', r, { lang: 'ko' })).toBe('40원'); // 44.7 → 40
    expect(formatMoney(0.0456, 'KRW', r, { lang: 'ko' })).toBe('50원');
    expect(formatMoney(0.0447, 'USD', r)).toBe('$0.04');
    expect(formatMoney(1975.44, 'KRW', r, { lang: 'ko', approx: true })).toBe('약 198만 원');
  });
});
