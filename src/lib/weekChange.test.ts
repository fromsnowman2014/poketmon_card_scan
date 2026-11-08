import { describe, expect, it } from 'vitest';
import { todayLocal, weekChange } from './weekChange';

const snap = (date: string, totalUsd: number) => ({ date, totalUsd });

describe('weekChange', () => {
  it('compares with the snapshot from a week ago', () => {
    const list = [snap('2026-10-30', 5), snap('2026-11-01', 10), snap('2026-11-05', 12), snap('2026-11-08', 99)];
    expect(weekChange(list, 13.2, '2026-11-08')).toEqual({ deltaUsd: 3.2, days: 7 });
  });

  it('ignores today and future snapshots', () => {
    expect(weekChange([snap('2026-11-08', 1), snap('2026-11-09', 2)], 5, '2026-11-08')).toBeNull();
    expect(weekChange([], 5, '2026-11-08')).toBeNull();
  });

  it('uses the oldest earlier day while the app is less than a week old', () => {
    expect(weekChange([snap('2026-11-06', 4.5), snap('2026-11-07', 4)], 4, '2026-11-08')).toEqual({ deltaUsd: -0.5, days: 2 });
  });

  it('prefers the older snapshot on a tie around 7 days', () => {
    expect(weekChange([snap('2026-10-31', 1), snap('2026-11-02', 2)], 3, '2026-11-08')).toEqual({ deltaUsd: 2, days: 8 });
  });

  it('rounds to cents and works across month ends', () => {
    expect(weekChange([snap('2026-02-24', 0.1)], 0.3, '2026-03-03')).toEqual({ deltaUsd: 0.2, days: 7 });
  });
});

describe('todayLocal', () => {
  it('formats the local date', () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
