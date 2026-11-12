import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardVariant, DisplayCurrency, PriceSummary, UiLang } from '../../lib/types';
import type { VariantPickerProps } from './VariantPicker';

const price = (market: number, over: Partial<PriceSummary> = {}): PriceSummary => ({
  market,
  low: market,
  high: market,
  changePct: null,
  source: 'tcgplayer',
  converted: false,
  ...over,
});

/** ja/SV8a-084 in the order pricing.ts gives it: most common first. */
const hawlucha: CardVariant[] = [
  { key: 'normal', type: 'normal', summary: price(0.18) },
  { key: 'reverse', type: 'reverse', summary: price(0.6) },
  { key: 'reverse-masterball', type: 'reverse', foil: 'masterball', summary: price(2.27) },
];
const labels = { cardLang: 'ja', siblings: hawlucha.map((v) => v.key) } as const;

async function render(props: Partial<VariantPickerProps>, uiLang: UiLang = 'en', currency: DisplayCurrency = 'USD'): Promise<string> {
  const settings = { uiLang, country: currency === 'KRW' ? 'KR' : 'US', currency, searchLang: 'en', ebayWorkerUrl: '', theme: 'system' };
  const data = new Map([['cc:settings', JSON.stringify({ v: 1, data: settings })]]);
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined });
  vi.resetModules();
  const { VariantPicker } = await import('./VariantPicker');
  return renderToStaticMarkup(
    createElement(VariantPicker, { variants: hawlucha, selected: 'normal', onSelect: () => undefined, labels, ...props }),
  );
}

/** What each tile says, sr-only text included: "Poké Ball mirror Poké Ball $0.60". */
const tiles = (html: string) =>
  [...html.matchAll(/<button[^>]*class="card-tile"[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

afterEach(() => vi.unstubAllGlobals());

describe('VariantPicker', () => {
  it('shows one tile per printing, in the order given, with its short name and price', async () => {
    const html = await render({});
    expect(tiles(html)).toEqual(['Normal $0.18', 'Poké Ball mirror Poké Ball $0.60', 'Master Ball mirror Master Ball $2.27']);
    expect(html).toContain('Which one is your card?');
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+"/);
    expect(html).not.toContain('scroll-x');
  });

  it('reads the full name to screen readers and hides the short one from them', async () => {
    const html = await render({});
    expect(html).toContain('<span class="sr-only">Master Ball mirror</span><span class="card-tile-name" aria-hidden="true">Master Ball</span>');
    // "Normal" is its own full name: said once.
    expect(html).toContain('<span class="card-tile-name">Normal</span>');
  });

  it('marks the picked tile with aria-pressed', async () => {
    const html = await render({ selected: 'reverse-masterball' });
    expect([...html.matchAll(/aria-pressed="(true|false)"/g)].map((m) => m[1])).toEqual(['false', 'false', 'true']);
  });

  it('speaks Korean and won', async () => {
    const html = await render({}, 'ko', 'KRW');
    expect(tiles(html)).toEqual(['기본 240원', '몬스터볼 미러 몬스터볼 820원', '마스터볼 미러 마스터볼 3,080원']);
    expect(html).toContain('내 카드는 어떤 거예요?');
  });

  it('says "No price" on an unpriced printing and marks approximate prices', async () => {
    const variants: CardVariant[] = [
      { ...hawlucha[0], summary: price(0.0335, { source: 'cardmarket', converted: true }) },
      { ...hawlucha[1], summary: price(12, { asking: true }) },
      { ...hawlucha[2], summary: null },
    ];
    expect(tiles(await render({ variants }))).toEqual(['Normal ≈ $0.03', 'Poké Ball mirror Poké Ball ≈ $12.00', 'Master Ball mirror Master Ball No price']);
    expect(tiles(await render({ variants }, 'ko', 'USD'))[2]).toBe('마스터볼 미러 마스터볼 가격 없음');
    // Korean-card route: every price is approximate.
    expect(tiles(await render({ approx: true }))[0]).toBe('Normal ≈ $0.18');
  });

  it('scrolls sideways from four printings, or with a long name', async () => {
    const four = [...hawlucha, { key: 'reverse-pokeball', type: 'reverse', foil: 'pokeball', summary: null }];
    expect(await render({ variants: four })).toContain('card-tiles scroll-x card-tiles-scroll');
    const old: CardVariant[] = [
      { key: 'holo', type: 'holo', summary: price(400) },
      { key: 'holo-shadowless', type: 'holo', subtype: 'shadowless', summary: price(3000) },
    ];
    const html = await render({ variants: old, selected: 'holo', labels: { cardLang: 'en', siblings: ['holo', 'holo-shadowless'] } });
    expect(html).toContain('scroll-x');
    expect(tiles(html)).toEqual(['Holo $400.00', 'Holo · Shadowless $3,000']);
  });
});
