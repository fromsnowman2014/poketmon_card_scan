import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardVariant, DisplayCurrency, PriceSummary, UiLang } from '../../lib/types';
import type { PriceHeroProps } from './PriceHero';

type Variant = Pick<CardVariant, 'summary' | 'tcgplayer'>;

const HOUR = 3_600_000;
const updated = new Date(Date.now() - 5 * HOUR - 60_000).toISOString();

const tcgSummary = (over: Partial<PriceSummary> = {}): PriceSummary => ({
  market: 0.6,
  low: 0.34,
  high: 0.63,
  changePct: null,
  source: 'tcgplayer',
  converted: false,
  updated,
  ...over,
});

/** ja/SV8a-084 Poké Ball mirror: the $1.84 top listing is left out of the range, so its high is the middle listing. */
const mirror: Variant = { tcgplayer: { low: 0.34, mid: 0.63, high: 1.84, market: 0.6, directLow: null }, summary: tcgSummary() };
/** Both ends are TCGplayer's own listings. */
const listed: Variant = { tcgplayer: { low: 1.5, mid: 2.2, high: 4, market: 2, directLow: null }, summary: tcgSummary({ market: 2, low: 1.5, high: 4 }) };
const asking: Variant = {
  tcgplayer: { low: 10, mid: 12, high: 15, market: null, directLow: null, asking: true },
  summary: tcgSummary({ market: 12, low: 10, high: 15, asking: true }),
};
const cardmarket: Variant = {
  tcgplayer: null,
  summary: { market: 1.69, low: 1.5, high: 2.04, changePct: null, source: 'cardmarket', converted: true, updated },
};
const unpriced: Variant = { tcgplayer: null, summary: null };

async function render(props: Omit<PriceHeroProps, 'tier'>, uiLang: UiLang = 'en', currency: DisplayCurrency = 'USD'): Promise<string> {
  const settings = { uiLang, country: currency === 'KRW' ? 'KR' : 'US', currency, searchLang: 'en', ebayWorkerUrl: '', theme: 'system' };
  const data = new Map([['cc:settings', JSON.stringify({ v: 1, data: settings })]]);
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined });
  vi.resetModules();
  const { PriceHero } = await import('./PriceHero');
  return renderToStaticMarkup(createElement(PriceHero, { tier: null, ...props }));
}

/** Visible text, tags dropped. The big amount counts up from zero, so a static render shows it as $0.00. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

afterEach(() => vi.unstubAllGlobals());

describe('PriceHero', () => {
  it('shows a market price with the printing, exact dollars and when it was checked', async () => {
    const t = text(await render({ variant: mirror, variantName: 'Poké Ball mirror' }));
    expect(t).toContain('Market price · Poké Ball mirror');
    expect(t).toContain('$0.34');
    expect(t).not.toContain('≈');
    expect(t).toContain('TCGplayer · checked 5h ago');
    expect(t).not.toContain('updated');
    expect(text(await render({ variant: mirror }, 'ko', 'KRW'))).toContain('5시간 전 확인 · TCGplayer');
  });

  it('says "Usual prices" once when an end is not TCGplayer’s own cheapest or dearest listing', async () => {
    const en = text(await render({ variant: mirror }));
    expect(en).toContain('Usual prices');
    expect(en).not.toMatch(/Lowest for sale now|Highest/);
    expect(text(await render({ variant: mirror }, 'ko', 'KRW'))).toContain('보통 가격');
    // Cardmarket's averages too (was "Recent prices").
    const cm = text(await render({ variant: cardmarket }));
    expect(cm).toContain('Usual prices');
    expect(cm).not.toContain('Recent prices');
    expect(cm).toContain('≈ $1.50');
  });

  it('labels the two ends when both are real listings', async () => {
    const en = text(await render({ variant: listed }));
    expect(en).toContain('Lowest for sale now');
    expect(en).toContain('Highest');
    expect(en).not.toContain('Usual prices');
    const ko = text(await render({ variant: listed }, 'ko', 'KRW'));
    expect(ko).toContain('지금 파는 최저가');
    expect(ko).toContain('최고가');
  });

  it('calls an asking price what it is: approximate, with no recent sales', async () => {
    const en = text(await render({ variant: asking, variantName: 'Master Ball mirror' }));
    expect(en).toContain('Asking price · Master Ball mirror ≈ $');
    expect(en).not.toContain('Market price');
    // The ends are real listings: exact.
    expect(en).toContain('Lowest for sale now Highest $10.00 Asking $15.00');
    expect(en).toContain('TCGplayer · no recent sales · checked 5h ago');
    const ko = text(await render({ variant: asking }, 'ko', 'USD'));
    expect(ko).toContain('파는 사람이 부른 가격 약 $');
    expect(ko).toContain('부른 가격 $15.00');
    expect(ko).toContain('5시간 전 확인 · TCGplayer · 최근 거래 없음');
  });

  it('says when a mirror’s price is for every pattern together', async () => {
    expect(text(await render({ variant: cardmarket, mixedMirror: true }))).toContain(
      'Cardmarket (€ → $) · all mirror patterns together · checked 5h ago',
    );
    expect(text(await render({ variant: cardmarket, mixedMirror: true }, 'ko', 'KRW'))).toContain(
      '5시간 전 확인 · Cardmarket (유로 → 원 환산) · 미러 무늬 전체 평균',
    );
    expect(text(await render({ variant: cardmarket }))).not.toContain('mirror patterns');
  });

  it('shows every amount as approximate on request (Korean-card route)', async () => {
    const en = text(await render({ variant: mirror, approx: true }));
    expect(en).toContain('Market price ≈ $');
    expect(en).toContain('≈ $0.34');
    expect(en).toContain('≈ $0.63');
    expect(text(await render({ variant: mirror, approx: true }, 'ko', 'KRW'))).toMatch(/시세 약 \d/);
  });

  it('without a price: the mystery panel, and the way down to eBay as the last thing in the first view', async () => {
    const html = await render({ variant: unpriced, ebayTarget: 'ebay' });
    const t = text(html);
    expect(t).toContain('No price yet');
    expect(t).toContain('This card is still a mystery! Try eBay below.');
    expect(t).toContain('See eBay prices below');
    expect(html.match(/data-card-fold/g)).toHaveLength(1);
    expect(html).toMatch(/card-ebay-jump-text" data-card-fold/);
    // Without the eBay panel the text is the last thing to fit.
    const alone = await render({ variant: unpriced });
    expect(text(alone)).not.toContain('See eBay prices below');
    expect(alone).toMatch(/card-mystery-text" data-card-fold/);
    // A summary without a market price is no price either.
    expect(text(await render({ variant: { summary: tcgSummary({ market: null }) } }))).toContain('No price yet');
  });

  it('tells a kid that an unpriced Master Ball pattern is the rare one', async () => {
    const en = text(await render({ variant: unpriced, rarePattern: true, ebayTarget: 'ebay' }));
    expect(en).toContain('This pattern is rare. It’s usually worth more than the others.');
    expect(en).not.toContain('mystery');
    const ko = text(await render({ variant: unpriced, rarePattern: true, ebayTarget: 'ebay' }, 'ko', 'KRW'));
    expect(ko).toContain('아직 가격이 없어요');
    expect(ko).toContain('드문 무늬예요. 보통 다른 무늬보다 비싸요.');
    expect(ko).toContain('아래에서 eBay 가격 보기');
  });
});
