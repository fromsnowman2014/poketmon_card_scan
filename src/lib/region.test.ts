import { describe, expect, it } from 'vitest';
import { COUNTRY_CURRENCY, countryDefaults, detectCountry, guessCountry } from './region';

describe('guessCountry', () => {
  it('trusts the time zone first (where the phone is)', () => {
    expect(guessCountry({ timeZone: 'Asia/Seoul', languages: ['en-US'] })).toEqual({ country: 'KR', confident: true, reason: 'timezone' });
    // A Korean-speaking kid in Los Angeles shops in dollars.
    expect(guessCountry({ timeZone: 'America/Los_Angeles', languages: ['ko-KR'] })).toEqual({
      country: 'US',
      confident: true,
      reason: 'timezone',
    });
    for (const zone of [
      'America/New_York',
      'America/Indiana/Indianapolis',
      'America/Kentucky/Louisville',
      'Pacific/Honolulu',
      'US/Eastern',
      'Pacific/Midway',
      'PST8PDT',
      'HST',
    ]) {
      expect(detectCountry({ timeZone: zone, languages: [] })).toBe('US');
    }
  });

  it('does not treat Canada, Mexico or Brazil as the US', () => {
    expect(guessCountry({ timeZone: 'America/Toronto', languages: ['en-CA'] })).toEqual({ country: 'US', confident: false, reason: 'fallback' });
    expect(guessCountry({ timeZone: 'America/Mexico_City', languages: ['ko-KR'] })).toMatchObject({ country: 'KR', reason: 'language-region' });
  });

  it('falls back to the language region, then a bare Korean language', () => {
    expect(guessCountry({ timeZone: 'Asia/Tokyo', languages: ['ja-JP', 'ko-KR'] })).toEqual({
      country: 'KR',
      confident: true,
      reason: 'language-region',
    });
    expect(guessCountry({ timeZone: 'UTC', languages: ['en_US'] })).toMatchObject({ country: 'US', confident: true });
    expect(guessCountry({ timeZone: 'Europe/Berlin', languages: ['ko'] })).toEqual({ country: 'KR', confident: false, reason: 'language' });
    expect(guessCountry({ timeZone: 'Europe/Berlin', languages: ['de-DE'] })).toEqual({ country: 'US', confident: false, reason: 'fallback' });
    expect(guessCountry({})).toEqual({ country: 'US', confident: false, reason: 'fallback' });
    // Two letters after a single-letter subtag are extension codes, not a region.
    expect(guessCountry({ timeZone: 'Europe/Berlin', languages: ['en-u-kr-latn'] })).toEqual({ country: 'US', confident: false, reason: 'fallback' });
    expect(guessCountry({ timeZone: 'Europe/Berlin', languages: ['x-us'] })).toMatchObject({ confident: false });
    expect(guessCountry({ timeZone: 'Europe/Berlin', languages: ['ko-Kore-KR-u-ca-dangi'] })).toMatchObject({ country: 'KR', confident: true });
  });

  it('maps each country to its money and search language', () => {
    expect(COUNTRY_CURRENCY).toEqual({ US: 'USD', KR: 'KRW' });
    expect(countryDefaults('KR')).toEqual({ currency: 'KRW', searchLang: 'ja' });
    expect(countryDefaults('US')).toEqual({ currency: 'USD', searchLang: 'en' });
  });
});
