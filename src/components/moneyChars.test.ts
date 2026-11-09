import { describe, expect, it } from 'vitest';
import type { Rates } from '../lib/fx';
import { formatMoney } from '../lib/pricing';
import { HANGUL, moneyChars, moneyParts } from './moneyChars';

const RATES: Rates = { EUR: 0.9, KRW: 1400, fetchedAt: '2026-11-08T00:00:00.000Z' };
const R1000: Rates = { ...RATES, KRW: 1000 };

describe('moneyChars', () => {
  it('counts the characters of the formatted amount', () => {
    expect(moneyChars('$842.50')).toBe(7);
    expect(moneyChars('₩1,234,500')).toBe(10);
    expect(moneyChars('₩12,345,600')).toBe(11);
    expect(moneyChars('≈ $3.50')).toBe(7);
  });

  it('counts Hangul wider (~0.86em each, against 0.64em per character)', () => {
    expect(moneyChars('4,760원')).toBe(6.4);
    expect(moneyChars('123,400원')).toBe(8.4);
    expect(moneyChars('198만 원')).toBe(6.8);
    expect(moneyChars('약 4,760원')).toBe(8.8);
    expect(moneyChars('1억 2,000만 원')).toBe(12.2);
    // Measured in bold Pretendard (weight 800): every string fits in moneyChars × 0.64em.
    const measuredEm: [string, number][] = [
      ['4,760원', 3.828],
      ['약 4,760원', 4.917],
      ['123,400원', 5.164],
      ['198만 원', 3.957],
      ['1억 2,000만 원', 6.673],
      ['₩12,345,600', 6.844],
      ['$842.50', 4.269],
    ];
    for (const [text, em] of measuredEm) expect(moneyChars(text) * 0.64).toBeGreaterThanOrEqual(em);
  });

  it('adds one for a separate ≈ sign and never returns 0', () => {
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

  it('Korean won stays short for big amounts (compact 만 원)', () => {
    const ko = (usd: number) => moneyChars(formatMoney(usd, 'KRW', R1000, { lang: 'ko' }));
    expect(ko(999.9)).toBe(8.4); // "999,900원"
    expect(ko(999.99)).toBe(6.8); // rounds to 1,000,000 → "100만 원"
    expect(ko(1975.4)).toBe(6.8); // "198만 원"
    expect(ko(12_345.6)).toBe(8.8); // "1,235만 원"
    expect(ko(1975.4)).toBeLessThan(moneyChars(formatMoney(1975.4, 'KRW', R1000))); // "₩1,975,400" is 10
  });
});

describe('moneyParts', () => {
  it('splits the Korean "약" from won', () => {
    expect(moneyParts(4.76, 'KRW', R1000, { approx: true, lang: 'ko' })).toEqual({ prefix: '약 ', amount: '4,760원', text: '약 4,760원' });
    expect(moneyParts(1975.4, 'KRW', R1000, { approx: true, lang: 'ko' })).toEqual({ prefix: '약 ', amount: '198만 원', text: '약 198만 원' });
  });

  it('uses the same "약" before dollars in the Korean UI (one sign for "about")', () => {
    expect(moneyParts(3.5, 'USD', R1000, { approx: true, lang: 'ko' })).toEqual({ prefix: '약 ', amount: '$3.50', text: '약 $3.50' });
    expect(moneyParts(22.3, 'USD', R1000, { approx: true, lang: 'ko' })).toEqual({ prefix: '약 ', amount: '$22.30', text: '약 $22.30' });
    // Money draws a Hangul prefix as a word (money-approx-word), so it is counted Hangul-wide.
    expect(HANGUL.test(moneyParts(3.5, 'USD', R1000, { approx: true, lang: 'ko' }).prefix)).toBe(true);
    expect(moneyChars('약 $3.50')).toBe(7.4);
  });

  it('splits "≈" from dollars and from won in the English UI', () => {
    expect(moneyParts(3.5, 'USD', R1000, { approx: true, lang: 'en' })).toEqual({ prefix: '≈ ', amount: '$3.50', text: '≈ $3.50' });
    expect(moneyParts(3.5, 'USD', R1000, { approx: true })).toEqual({ prefix: '≈ ', amount: '$3.50', text: '≈ $3.50' });
    expect(moneyParts(4.76, 'KRW', R1000, { approx: true, lang: 'en' })).toEqual({ prefix: '≈ ', amount: '₩4,760', text: '≈ ₩4,760' });
    expect(HANGUL.test('≈ ')).toBe(false);
  });

  it('has no prefix for exact or missing amounts', () => {
    expect(moneyParts(4.76, 'KRW', R1000, { lang: 'ko' })).toEqual({ prefix: '', amount: '4,760원', text: '4,760원' });
    expect(moneyParts(null, 'KRW', R1000, { approx: true, lang: 'ko' })).toEqual({ prefix: '', amount: '—', text: '—' });
    expect(moneyParts(undefined, 'USD', R1000, { approx: true })).toEqual({ prefix: '', amount: '—', text: '—' });
  });
});
