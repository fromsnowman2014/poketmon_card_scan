import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardDetail, CollectionItem } from '../../lib/types';

const getCard = vi.fn();
const updateCollectionPrice = vi.fn();
/** Live rates: 2 dollars a euro, unlike whatever the card was fetched with. */
const LIVE = { EUR: 0.5, KRW: 1400, fetchedAt: '2026-11-08T11:00:00.000Z' };
vi.mock('../../lib/tcgdex', () => ({ getCard: (...args: unknown[]) => getCard(...args) }));
vi.mock('../../lib/store', () => ({ updateCollectionPrice: (...args: unknown[]) => updateCollectionPrice(...args) }));
vi.mock('../../lib/fx', async (original) => ({ ...(await original<typeof import('../../lib/fx')>()), getRates: async () => LIVE }));

let mod: typeof import('./useRefreshPrices');

const NOW = Date.parse('2026-11-08T12:00:00Z');
const HOUR = 3_600_000;

function item(id: string, variant: string, priceUsd: number | null, checkedHoursAgo: number): CollectionItem {
  const at = new Date(NOW - checkedHoursAgo * HOUR).toISOString();
  return {
    key: `ja:${id}:${variant}`,
    id,
    lang: 'ja',
    name: id,
    setId: 'SV8a',
    setName: 'x',
    localId: '001',
    variant,
    qty: 1,
    priceUsd,
    firstPriceUsd: priceUsd,
    priceUpdatedAt: at,
    addedAt: at,
  };
}

/**
 * A card as getCard returns it: each printing priced by TCGplayer (dollars) or, with `eur`, by Cardmarket (euros), and
 * a summary made with the rates of fetch time (here: a stale number the refresh must not store).
 */
const card = (prices: Record<string, number>, eur = false) =>
  ({
    variants: Object.entries(prices).map(([key, n]) => ({
      key,
      type: key,
      ...(eur
        ? { cardmarket: { avg: null, low: null, trend: n, avg1: null, avg7: null, avg30: null } }
        : { tcgplayer: { low: null, mid: null, high: null, market: n, directLow: null } }),
      summary: { market: eur ? 999 : n, low: null, high: null, changePct: null, source: eur ? 'cardmarket' : 'tcgplayer', converted: eur },
    })),
  }) as unknown as CardDetail;

beforeEach(async () => {
  vi.resetModules(); // fresh shared state (running refresh, last automatic refresh)
  getCard.mockReset();
  updateCollectionPrice.mockReset();
  mod = await import('./useRefreshPrices');
});

describe('refreshPrices', () => {
  it('fetches each card once for all its saved variants and writes nothing for a variant without a price', async () => {
    getCard.mockResolvedValue(card({ normal: 0.5 }));
    const r = await mod.refreshPrices([item('A', 'normal', 0.4, 1), item('A', 'reverse', 2, 1), item('A', 'holo', null, 1)]);
    expect(r).toEqual({ failed: 0 });
    expect(getCard).toHaveBeenCalledTimes(1);
    // The reverse keeps its saved $2 and the time it was checked; the unpriced holo stays unpriced.
    expect(updateCollectionPrice.mock.calls).toEqual([['ja:A:normal', 0.5, false]]);
  });

  it('converts euro prices with the live rates and marks them approximate (≈)', async () => {
    getCard.mockResolvedValue(card({ normal: 0.5 }, true));
    await mod.refreshPrices([item('A', 'normal', 0.4, 1)]);
    expect(updateCollectionPrice.mock.calls).toEqual([['ja:A:normal', 1, true]]); // €0.50 at 2 dollars a euro
  });

  it('marks an asking price (TCGplayer listings, no recent sales) approximate too', async () => {
    const asking = card({ normal: 1 });
    asking.variants[0].tcgplayer = { low: 5, mid: 6, high: 7, market: null, directLow: null, asking: true };
    getCard.mockResolvedValue(asking);
    await mod.refreshPrices([item('A', 'normal', 0.4, 1)]);
    expect(updateCollectionPrice.mock.calls).toEqual([['ja:A:normal', 6, true]]);
  });

  it('counts failures and lets concurrent manual calls share one run', async () => {
    getCard.mockImplementation(async (_lang: string, id: string) => {
      if (id === 'B') throw new Error('offline');
      return card({ normal: 1 });
    });
    const items = [item('A', 'normal', 1, 1), item('B', 'normal', 1, 1)];
    const [a, b] = await Promise.all([mod.refreshPrices(items), mod.refreshPrices(items)]);
    expect(a).toEqual({ failed: 1 });
    expect(b).toBe(a);
    expect(getCard).toHaveBeenCalledTimes(2);
  });
});

describe('automatic refresh', () => {
  it('staleItems: prices checked more than a day ago (or never readable)', () => {
    const fresh = item('A', 'normal', 1, 23);
    const stale = item('B', 'normal', 1, 25);
    const broken = { ...item('C', 'normal', 1, 0), priceUpdatedAt: 'nope' };
    expect(mod.staleItems([fresh, stale, broken], NOW)).toEqual([stale, broken]);
  });

  it('refreshes only stale cards, at most once an hour', async () => {
    getCard.mockResolvedValue(card({ normal: 2 }));
    const items = [item('A', 'normal', 1, 2), item('B', 'normal', 1, 30)];
    await mod.autoRefreshPrices(items, NOW);
    expect(getCard.mock.calls.map((c) => c[1])).toEqual(['B']);
    expect(mod.autoRefreshPrices(items, NOW + HOUR - 1)).toBeUndefined(); // B still looks stale here: throttled
    getCard.mockClear();
    await mod.autoRefreshPrices(items, NOW + HOUR);
    expect(getCard).toHaveBeenCalledTimes(1);
  });

  it('does not fetch a card again within a day after a lookup that found no price for it', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      getCard.mockResolvedValue(card({ normal: 2 }));
      const unpriced = item('A', 'reverse', null, 30);
      expect(mod.staleItems([unpriced], NOW)).toEqual([unpriced]);
      await mod.autoRefreshPrices([unpriced], NOW);
      expect(updateCollectionPrice).not.toHaveBeenCalled();
      expect(mod.staleItems([unpriced], NOW + 2 * HOUR)).toEqual([]);
      expect(mod.autoRefreshPrices([unpriced], NOW + 2 * HOUR)).toBeUndefined();
      expect(mod.staleItems([unpriced], NOW + 25 * HOUR)).toEqual([unpriced]);
    } finally {
      now.mockRestore();
    }
  });

  it('does nothing when every price is fresh', () => {
    expect(mod.autoRefreshPrices([item('A', 'normal', 1, 1)], NOW)).toBeUndefined();
    expect(getCard).not.toHaveBeenCalled();
  });

  it('a manual refresh during a background one waits for it, then checks every card', async () => {
    let release!: () => void;
    getCard.mockImplementationOnce(() => new Promise((r) => (release = () => r(card({ normal: 3 })))));
    getCard.mockResolvedValue(card({ normal: 4 }));
    const items = [item('A', 'normal', 1, 1), item('B', 'normal', 1, 30)];
    const background = mod.autoRefreshPrices(items, NOW)!;
    const manual = mod.refreshPrices(items);
    release();
    await background;
    await manual;
    expect(getCard.mock.calls.map((c) => c[1])).toEqual(['B', 'A', 'B']);
  });
});
