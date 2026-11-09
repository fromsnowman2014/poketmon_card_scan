import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Country, DisplayCurrency, EbaySummary, UiLang } from '../../lib/types';
import { hasLivePrices, shipNote, statChars } from './EbayPanel';

const summary = (over: Partial<EbaySummary> = {}): EbaySummary => ({
  query: 'Charizard ex 199/165 151',
  fetchedAt: '2026-11-09T10:00:00.000Z',
  auctions: { count: 0, items: [] },
  buyNow: { count: 12, lowest: 9.99, median: 1234.5, lowestShipping: 3.99, items: [] },
  searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=x&_sacat=183454',
  shipTo: 'US',
  ...over,
});

describe('shipNote', () => {
  it('says nothing to a kid in the US, worker or not', () => {
    expect(shipNote('US', null)).toBeNull();
    expect(shipNote('US', { shipTo: 'US' })).toBeNull();
    expect(shipNote('US', { shipTo: 'KR' })).toBeNull();
  });

  it('a kid in Korea: shipping to Korea when the worker priced it there, else the eBay US caveat', () => {
    expect(shipNote('KR', { shipTo: 'KR' })).toBe('toKorea');
    expect(shipNote('KR', { shipTo: 'US' })).toBe('fromUs'); // an older worker
    expect(shipNote('KR', {})).toBe('fromUs');
    expect(shipNote('KR', null)).toBe('fromUs'); // links only, or the worker failed
  });
});

describe('hasLivePrices', () => {
  it('needs a Buy It Now price or an auction the worker kept', () => {
    expect(hasLivePrices(summary())).toBe(true);
    expect(hasLivePrices(summary({ buyNow: { count: 3, lowest: null, median: null, items: [] } }))).toBe(false);
    const auction = { title: 'x', price: 1, currency: 'USD', url: 'https://www.ebay.com/itm/1' };
    expect(hasLivePrices(summary({ buyNow: { count: 0, lowest: null, median: null, items: [] }, auctions: { count: 9, items: [auction] } }))).toBe(true);
    // eBay counted auctions, but the worker dropped them all (lots, slabs): nothing to show.
    expect(hasLivePrices(summary({ buyNow: { count: 0, lowest: null, median: null, items: [] }, auctions: { count: 9, items: [] } }))).toBe(false);
  });
});

describe('statChars', () => {
  it('is the wider of the two amounts as shown, so both get one size', () => {
    const won = (usd: number) => (usd < 100 ? '13,600원' : '168만 원');
    expect(statChars([9.99, 1234.5], won)).toBe(7.4); // "13,600원" 6 + 1.4 = 7.4 vs "168만 원" 3 + 1.4 + 1 + 1.4 = 6.8
    expect(statChars([9.99, 1234.5], (usd) => (usd < 100 ? '$9.99' : '$1,235'))).toBe(6);
    expect(statChars([1234.5, 9.99], (usd) => (usd < 100 ? '₩13,600' : '₩1,680,600'))).toBe(10);
  });

  it('skips a missing median and falls back to 8 with no amount', () => {
    expect(statChars([9.99, null], () => '$9.99')).toBe(5);
    expect(statChars([null, null], () => '$9.99')).toBe(8);
  });
});

/** Renders with these settings (fresh modules, so the store reads them). Effects don't run: no fetch happens. */
async function render(
  settings: { uiLang: UiLang; country: Country; currency: DisplayCurrency; ebayWorkerUrl?: string },
  live?: EbaySummary,
): Promise<string> {
  const data = new Map([['cc:settings', JSON.stringify({ v: 1, data: { searchLang: 'en', ebayWorkerUrl: '', theme: 'system', ...settings } })]]);
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined });
  vi.resetModules();
  const { EbayPanel, LiveSummary } = await import('./EbayPanel');
  return renderToStaticMarkup(live ? createElement(LiveSummary, { summary: live }) : createElement(EbayPanel, { query: 'Charizard ex 199/165 151' }));
}

describe('EbayPanel by country', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('links only: a kid in Korea reads that these are eBay US prices; a kid in the US reads no caveat', async () => {
    const ko = await render({ uiLang: 'ko', country: 'KR', currency: 'KRW' });
    expect(ko).toContain('미국 eBay 가격이에요 ·</span>');
    expect(ko).toContain('한국으로 받으면 배송비가 더 들어요');
    const en = await render({ uiLang: 'en', country: 'KR', currency: 'USD' });
    expect(en).toContain('Prices from eBay US ·');
    expect(en).toContain('Shipping to Korea costs extra');
    for (const uiLang of ['ko', 'en'] as const) {
      const us = await render({ uiLang, country: 'US', currency: 'USD' });
      expect(us).not.toContain('card-ebay-ship');
      expect(us).not.toMatch(/한국|Korea/);
      expect(us).toContain('card-ebay-link'); // the three tiles are still there
    }
  });

  it('while the worker answers: the skeleton, and no caveat yet', async () => {
    const html = await render({ uiLang: 'ko', country: 'KR', currency: 'KRW', ebayWorkerUrl: 'https://w.example' });
    expect(html).toContain('skeleton');
    expect(html).not.toContain('card-ebay-ship');
  });

  it('live prices: both numbers in one grid with one --ebay-chars, the second column marked', async () => {
    const html = await render({ uiLang: 'ko', country: 'KR', currency: 'KRW' }, summary({ shipTo: 'KR' }));
    expect(html).toMatch(/class="card-ebay-stats" style="--ebay-chars:\d+(\.\d+)?"/);
    expect(html.match(/card-ebay-big/g)).toHaveLength(2);
    expect(html).toContain('card-ebay-label card-ebay-c2');
    expect(html).toContain('보통 가격');
    expect(html).toContain('배송비 포함');
    const noMedian = await render({ uiLang: 'en', country: 'US', currency: 'USD' }, summary({ buyNow: { count: 1, lowest: 9.99, median: null, lowestShipping: 0, items: [] } }));
    expect(noMedian).toContain('--ebay-chars:5"');
    expect(noMedian).not.toContain('card-ebay-c2');
    expect(noMedian).toContain('Free shipping');
  });
});
