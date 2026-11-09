import { describe, expect, it } from 'vitest';
import type { Rates } from '../lib/fx';
import { formatMoney } from '../lib/pricing';
import { moneyChars } from './moneyChars';

const RATES: Rates = { EUR: 0.9, KRW: 1400, fetchedAt: '2026-11-08T00:00:00.000Z' };

describe('moneyChars', () => {
  it('counts the characters of the formatted amount', () => {
    expect(moneyChars('$842.50')).toBe(7);
    expect(moneyChars('₩1,234,500')).toBe(10);
    expect(moneyChars('₩12,345,600')).toBe(11);
  });

  it('adds one for the ≈ sign and never returns 0', () => {
    expect(moneyChars('$5.00', true)).toBe(6);
    expect(moneyChars('')).toBe(1);
  });

  it('grows with 7- and 8-digit won totals so CSS can shrink the font', () => {
    const small = moneyChars(formatMoney(5, 'KRW', RATES));
    const seven = moneyChars(formatMoney(900, 'KRW', RATES));
    const eight = moneyChars(formatMoney(9000, 'KRW', RATES));
    expect(seven).toBeGreaterThan(small);
    expect(eight).toBe(seven + 1);
  });
});
