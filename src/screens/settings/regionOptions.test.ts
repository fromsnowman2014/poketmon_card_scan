import { describe, expect, it } from 'vitest';
import { countryOptions, currencyOptions, moneyOverridden } from './regionOptions';

const labels = (options: { label: string }[]) => options.map((o) => o.label);

describe('settings region options', () => {
  it('lists the countries with flags in a stable order per UI language', () => {
    expect(labels(countryOptions('ko'))).toEqual(['한국', '미국']);
    expect(labels(countryOptions('en'))).toEqual(['USA', 'Korea']);
    expect(countryOptions('ko').map((o) => o.value)).toEqual(['KR', 'US']);
    // The flag is shown but kept out of the label screen readers announce.
    expect(countryOptions('en').map((o) => o.emoji)).toEqual(['🇺🇸', '🇰🇷']);
  });

  it('puts the money of the kid’s country first, in words a kid knows', () => {
    expect(currencyOptions('ko', 'KR')).toEqual([
      { value: 'KRW', label: '원 (₩)' },
      { value: 'USD', label: '달러 ($)' },
    ]);
    expect(labels(currencyOptions('ko', 'US'))).toEqual(['달러 ($)', '원 (₩)']);
    expect(labels(currencyOptions('en', 'US'))).toEqual(['$ Dollars', '₩ Won']);
    expect(labels(currencyOptions('en', 'KR'))).toEqual(['₩ Won', '$ Dollars']);
  });

  it('notices when the money is not the country’s own', () => {
    expect(moneyOverridden('KR', 'KRW')).toBe(false);
    expect(moneyOverridden('US', 'USD')).toBe(false);
    expect(moneyOverridden('KR', 'USD')).toBe(true);
    expect(moneyOverridden('US', 'KRW')).toBe(true);
  });
});
