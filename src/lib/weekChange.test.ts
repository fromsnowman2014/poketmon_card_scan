import { describe, expect, it } from 'vitest';
import type { ValueSnapshot } from './types';
import { todayLocal, weekChange } from './weekChange';

type Cards = NonNullable<ValueSnapshot['cards']>;
const snap = (date: string, cards: Cards): ValueSnapshot => ({
  date,
  totalUsd: Object.values(cards).reduce((n, [usd, qty]) => n + usd * qty, 0),
  cards,
});
const item = (key: string, priceUsd: number | null, qty = 1) => ({ key, priceUsd, qty });

describe('weekChange', () => {
  it('compares prices with the snapshot from a week ago', () => {
    const list = [snap('2026-10-30', { a: [5, 1] }), snap('2026-11-01', { a: [10, 1] }), snap('2026-11-05', { a: [12, 1] }), snap('2026-11-08', { a: [99, 1] })];
    expect(weekChange(list, [item('a', 13.2)], '2026-11-08')).toEqual({ deltaUsd: 3.2, days: 7 });
  });

  it('does not count newly added or removed cards as a rise or drop', () => {
    const list = [snap('2026-11-01', { hawlucha: [0.04, 1], gone: [5, 1] })];
    // Same Hawlucha price, plus a new $458 card and minus a removed one: nothing moved.
    expect(weekChange(list, [item('hawlucha', 0.04), item('umbreon', 458.22)], '2026-11-08')).toEqual({ deltaUsd: 0, days: 7 });
    expect(weekChange(list, [item('hawlucha', 0.1), item('umbreon', 458.22)], '2026-11-08')).toEqual({ deltaUsd: 0.06, days: 7 });
  });

  it('counts only the copies saved both times', () => {
    const list = [snap('2026-11-01', { a: [2, 3] })];
    expect(weekChange(list, [item('a', 2.5, 5)], '2026-11-08')).toEqual({ deltaUsd: 1.5, days: 7 }); // 3 × +0.50
    expect(weekChange(list, [item('a', 1, 1)], '2026-11-08')).toEqual({ deltaUsd: -1, days: 7 }); // 1 × −1
  });

  it('null without a card in common, for unpriced cards, or when only old total-only snapshots exist', () => {
    const list = [snap('2026-11-01', { a: [2, 1] })];
    expect(weekChange(list, [item('b', 3)], '2026-11-08')).toBeNull();
    expect(weekChange(list, [item('a', null)], '2026-11-08')).toBeNull();
    expect(weekChange([{ date: '2026-11-01', totalUsd: 2 }], [item('a', 3)], '2026-11-08')).toBeNull();
  });

  it('skips total-only snapshots and uses the best one with per-card data', () => {
    const list = [{ date: '2026-11-01', totalUsd: 1 }, snap('2026-11-06', { a: [2, 1] })];
    expect(weekChange(list, [item('a', 3)], '2026-11-08')).toEqual({ deltaUsd: 1, days: 2 });
  });

  it('ignores today and future snapshots', () => {
    expect(weekChange([snap('2026-11-08', { a: [1, 1] }), snap('2026-11-09', { a: [2, 1] })], [item('a', 5)], '2026-11-08')).toBeNull();
    expect(weekChange([], [item('a', 5)], '2026-11-08')).toBeNull();
  });

  it('uses the oldest earlier day while the app is less than a week old', () => {
    const list = [snap('2026-11-06', { a: [4.5, 1] }), snap('2026-11-07', { a: [4, 1] })];
    expect(weekChange(list, [item('a', 4)], '2026-11-08')).toEqual({ deltaUsd: -0.5, days: 2 });
  });

  it('prefers the older snapshot on a tie around 7 days', () => {
    const list = [snap('2026-10-31', { a: [1, 1] }), snap('2026-11-02', { a: [2, 1] })];
    expect(weekChange(list, [item('a', 3)], '2026-11-08')).toEqual({ deltaUsd: 2, days: 8 });
  });

  it('rounds to cents and works across month ends', () => {
    expect(weekChange([snap('2026-02-24', { a: [0.1, 1] })], [item('a', 0.3)], '2026-03-03')).toEqual({ deltaUsd: 0.2, days: 7 });
  });
});

describe('todayLocal', () => {
  it('formats the local date', () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
