import { describe, expect, it } from 'vitest';
import type { Rates } from '../../lib/fx';
import { formatMoney } from '../../lib/pricing';
import type { CollectionItem } from '../../lib/types';
import {
  bestItem,
  cardCount,
  milestones,
  oldestUpdate,
  sortItems,
  tierCounts,
  tierFloorUsd,
  unpricedCount,
} from './stats';

/** 1,359원 a dollar, the built-in fallback rate. */
const RATES: Rates = { EUR: 0.9, KRW: 1359, fetchedAt: '2026-11-08T00:00:00.000Z' };

function item(key: string, priceUsd: number | null, extra: Partial<CollectionItem> = {}): CollectionItem {
  return {
    key,
    id: key,
    lang: 'ja',
    name: key,
    setId: 'SV8a',
    setName: 'テラスタルフェスex',
    localId: '001',
    variant: 'normal',
    qty: 1,
    priceUsd,
    firstPriceUsd: priceUsd,
    priceUpdatedAt: '2026-11-01T00:00:00.000Z',
    addedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

const items = [
  item('a', 0.5, { qty: 3, addedAt: '2026-11-03T00:00:00.000Z', name: 'ピカチュウ' }),
  item('b', 7, { addedAt: '2026-11-05T00:00:00.000Z', name: 'Charizard', priceUpdatedAt: '2026-10-20T00:00:00.000Z' }),
  item('c', null, { qty: 2, addedAt: '2026-11-01T00:00:00.000Z', name: 'bulbasaur' }),
  item('d', 120, { addedAt: '2026-11-02T00:00:00.000Z', name: 'ルチャブル' }),
];

describe('counts', () => {
  it('counts quantities', () => {
    expect(cardCount(items)).toBe(7);
    expect(unpricedCount(items)).toBe(2);
  });

  it('groups priced cards by tier in dollars', () => {
    expect(tierCounts(items, 'USD', RATES)).toEqual({ common: 3, nice: 0, rare: 1, super: 0, treasure: 1 });
  });

  it('groups priced cards by tier in won, where the thresholds differ', () => {
    // $0.50 = 680원 (coins), $7 = 9,510원 (allowance), $120 = 163,100원 (treasure).
    expect(tierCounts(items, 'KRW', RATES)).toEqual({ common: 3, nice: 0, rare: 1, super: 0, treasure: 1 });
    // $0.80: pocket change in dollars, a snack (1,090원) in won. $4: a snack in dollars, an allowance (5,440원) in won.
    // $25: prized in both moneys ($25; 34,000원 ≥ 30,000원).
    const mixed = [item('x', 0.8, { qty: 2 }), item('y', 4), item('z', 25)];
    expect(tierCounts(mixed, 'USD', RATES)).toEqual({ common: 2, nice: 1, rare: 0, super: 1, treasure: 0 });
    expect(tierCounts(mixed, 'KRW', RATES)).toEqual({ common: 0, nice: 2, rare: 1, super: 1, treasure: 0 });
  });
});

describe('bestItem / oldestUpdate', () => {
  it('finds the most valuable priced card', () => {
    expect(bestItem(items)?.key).toBe('d');
    expect(bestItem([item('x', null)])).toBeUndefined();
  });

  it('finds the stalest price check', () => {
    expect(oldestUpdate(items)).toBe('2026-10-20T00:00:00.000Z');
    expect(oldestUpdate([])).toBeUndefined();
  });
});

describe('milestones', () => {
  const earnedOf = (list: ReturnType<typeof milestones>) => Object.fromEntries(list.map((m) => [m.id, m.earned]));

  it('locks everything for an empty collection, with the price each money badge needs', () => {
    const list = milestones([], 'USD', RATES);
    expect(list.map(({ goalUsd, ...m }) => m)).toEqual([
      { id: 'first', earned: false },
      { id: 'ten', earned: false, progress: { have: 0, need: 10 } },
      { id: 'rare', earned: false },
      { id: 'treasure', earned: false },
    ]);
    const goal = (id: string, l = list) => l.find((m) => m.id === id)?.goalUsd;
    expect(formatMoney(goal('rare'), 'USD', RATES)).toBe('$5.00');
    expect(formatMoney(goal('treasure'), 'USD', RATES)).toBe('$100.00');
    const won = milestones([], 'KRW', RATES);
    expect(formatMoney(goal('rare', won), 'KRW', RATES, { lang: 'ko' })).toBe('5,000원');
    expect(formatMoney(goal('treasure', won), 'KRW', RATES, { lang: 'ko' })).toBe('150,000원');
    expect(goal('first')).toBeUndefined();
  });

  it('earns badges from the cards', () => {
    expect(earnedOf(milestones(items, 'USD', RATES))).toEqual({ first: true, ten: false, rare: true, treasure: true });
    expect(milestones([item('x', 1, { qty: 10 })], 'USD', RATES).find((m) => m.id === 'ten')).toEqual({
      id: 'ten',
      earned: true,
    });
    expect(milestones(items, 'USD', RATES).find((m) => m.id === 'rare')).toEqual({ id: 'rare', earned: true });
  });

  it('earns the price badges by tier in the money shown', () => {
    // $4 is a snack in dollars but 5,440원 (an allowance) in won.
    const four = [item('x', 4)];
    expect(earnedOf(milestones(four, 'USD', RATES))).toMatchObject({ rare: false, treasure: false });
    expect(earnedOf(milestones(four, 'KRW', RATES))).toMatchObject({ rare: true, treasure: false });
    // $100 is treasure in dollars; 135,900원 is not yet treasure in won (150,000원).
    const hundred = [item('y', 100)];
    expect(earnedOf(milestones(hundred, 'USD', RATES))).toMatchObject({ rare: true, treasure: true });
    expect(earnedOf(milestones(hundred, 'KRW', RATES))).toMatchObject({ rare: true, treasure: false });
    // Shown as $5.00 → allowance; unpriced cards never earn a price badge.
    expect(earnedOf(milestones([item('z', 4.996)], 'USD', RATES)).rare).toBe(true);
    expect(earnedOf(milestones([item('n', null, { qty: 12 })], 'KRW', RATES))).toEqual({
      first: true,
      ten: true,
      rare: false,
      treasure: false,
    });
  });
});

describe('tierFloorUsd', () => {
  it('is the lowest price at that tier, matching the amount shown', () => {
    expect(tierFloorUsd('common', 'USD', RATES)).toBe(0);
    expect(tierFloorUsd('rare', 'USD', RATES)).toBeCloseTo(4.995, 6);
    expect(tierFloorUsd('treasure', 'KRW', { ...RATES, KRW: 1000 })).toBeCloseTo(149.95, 6);
    for (const currency of ['USD', 'KRW'] as const) {
      for (const tier of ['nice', 'rare', 'super', 'treasure'] as const) {
        const floor = tierFloorUsd(tier, currency, RATES);
        expect(tierCounts([item('a', floor)], currency, RATES)[tier]).toBe(1);
        expect(tierCounts([item('b', floor * (1 - 1e-6))], currency, RATES)[tier]).toBe(0);
      }
    }
    expect(formatMoney(tierFloorUsd('nice', 'KRW', RATES), 'KRW', RATES, { lang: 'ko' })).toBe('1,000원');
    expect(formatMoney(tierFloorUsd('super', 'KRW', RATES), 'KRW', RATES, { lang: 'en' })).toBe('₩30,000');
  });
});

describe('sortItems', () => {
  const keys = (list: CollectionItem[]) => list.map((i) => i.key);

  it('sorts by price with unpriced cards last', () => {
    expect(keys(sortItems(items, 'price', (i) => i.name, 'en'))).toEqual(['d', 'b', 'a', 'c']);
  });

  it('sorts by date added, newest first', () => {
    expect(keys(sortItems(items, 'newest', (i) => i.name, 'en'))).toEqual(['b', 'a', 'd', 'c']);
  });

  it('sorts by the shown name, ignoring case', () => {
    expect(keys(sortItems(items, 'name', (i) => i.name, 'en'))).toEqual(['c', 'b', 'a', 'd']);
  });

  it('does not change the input', () => {
    const copy = [...items];
    sortItems(items, 'price', (i) => i.name, 'en');
    expect(items).toEqual(copy);
  });
});
