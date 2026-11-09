import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardVariant, DisplayCurrency, UiLang } from '../../lib/types';
import { rateLine } from './MorePrices';

const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const rates = (KRW: number, fetchedAt: string) => ({ EUR: 0.9, KRW, fetchedAt });

describe('rateLine', () => {
  it('says today’s rate in whole won, with how old it is', () => {
    expect(rateLine(rates(1359.4, '2026-11-09T10:00:00.000Z'), 'ko', NOW)).toBe('오늘 환율: 1달러 = 1,359원 · 2시간 전 업데이트');
    expect(rateLine(rates(1359.6, '2026-11-09T10:00:00.000Z'), 'en', NOW)).toBe('Today’s rate: $1 = ₩1,360 · updated 2h ago');
  });

  it('drops "today" for a rate more than a day old, and the time when it is unknown', () => {
    expect(rateLine(rates(1359, '2026-11-06T12:00:00.000Z'), 'ko', NOW)).toBe('환율: 1달러 = 1,359원 · 3일 전 업데이트');
    expect(rateLine(rates(1359, 'not a date'), 'en', NOW)).toBe('Rate: $1 = ₩1,359');
  });
});

describe('MorePrices rate line', () => {
  const variant: CardVariant = {
    key: 'normal',
    type: 'normal',
    tcgplayer: { low: 1, mid: 2, high: 3, market: 2, directLow: null },
    summary: null,
  };

  async function render(uiLang: UiLang, currency: DisplayCurrency): Promise<string> {
    const settings = { uiLang, country: currency === 'KRW' ? 'KR' : 'US', currency, searchLang: 'en', ebayWorkerUrl: '', theme: 'system' };
    const data = new Map([['cc:settings', JSON.stringify({ v: 1, data: settings })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined });
    vi.resetModules();
    const { MorePrices } = await import('./MorePrices');
    const html = renderToStaticMarkup(createElement(MorePrices, { variant }));
    vi.unstubAllGlobals();
    return html;
  }

  it('shows the rate only with won prices; the source numbers stay in dollars', async () => {
    const ko = await render('ko', 'KRW');
    expect(ko).toContain('1달러 = 1,359원');
    expect(ko).toContain('$2.00');
    expect(await render('en', 'KRW')).toContain('$1 = ₩1,359');
    const us = await render('en', 'USD');
    expect(us).not.toMatch(/rate|₩/i);
    expect(us).toContain('$2.00');
  });
});
