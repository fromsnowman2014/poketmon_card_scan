import { describe, expect, it } from 'vitest';
import { workerOutdated } from './EbayWorker';

describe('workerOutdated', () => {
  it('flags a worker that priced shipping to the US for a kid in Korea', () => {
    expect(workerOutdated('KR', { shipTo: 'US' })).toBe(true);
    expect(workerOutdated('KR', {})).toBe(true);
  });

  it('is happy with a worker that echoed Korea', () => {
    expect(workerOutdated('KR', { shipTo: 'KR' })).toBe(false);
  });

  it('never flags anything for a kid in the US', () => {
    expect(workerOutdated('US', { shipTo: 'US' })).toBe(false);
    expect(workerOutdated('US', {})).toBe(false);
  });
});
