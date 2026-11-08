import { describe, expect, it } from 'vitest';
import type { CollectionItem } from '../../lib/types';
import { bestItem, cardCount, milestones, oldestUpdate, sortItems, tierCounts, unpricedCount } from './stats';

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

  it('groups priced cards by tier', () => {
    expect(tierCounts(items)).toEqual({ common: 3, nice: 0, rare: 1, super: 0, treasure: 1 });
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
  it('locks everything for an empty collection', () => {
    expect(milestones([])).toEqual([
      { id: 'first', earned: false },
      { id: 'ten', earned: false, progress: { have: 0, need: 10 } },
      { id: 'rare', earned: false },
      { id: 'treasure', earned: false },
    ]);
  });

  it('earns badges from the cards', () => {
    const earned = Object.fromEntries(milestones(items).map((m) => [m.id, m.earned]));
    expect(earned).toEqual({ first: true, ten: false, rare: true, treasure: true });
    expect(milestones([item('x', 1, { qty: 10 })]).find((m) => m.id === 'ten')).toEqual({ id: 'ten', earned: true });
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
