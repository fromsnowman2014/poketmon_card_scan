import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Country, DisplayCurrency, UiLang } from '../lib/types';
import { secondaryCurrency, type MoneyProps } from './Money';

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed));
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
}

/** Renders <Money> for a kid with these settings (fresh modules, so the store reads them; rates: the built-in 1,359). */
async function render(uiLang: UiLang, country: Country, currency: DisplayCurrency, props: MoneyProps): Promise<string> {
  const settings = { uiLang, country, currency, searchLang: 'en', ebayWorkerUrl: '', theme: 'system' };
  vi.stubGlobal('localStorage', memoryStorage({ 'cc:settings': JSON.stringify({ v: 1, data: settings }) }));
  vi.resetModules();
  const { Money } = await import('./Money');
  return renderToStaticMarkup(createElement(Money, props));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('secondaryCurrency', () => {
  it('puts dollars under won, wherever the kid lives', () => {
    expect(secondaryCurrency('KRW', 'KR')).toBe('USD');
    expect(secondaryCurrency('KRW', 'US')).toBe('USD');
  });

  it('shows nothing under dollars for a kid in the US, and won for a kid in Korea who switched to dollars', () => {
    expect(secondaryCurrency('USD', 'US')).toBeNull();
    expect(secondaryCurrency('USD', 'KR')).toBe('KRW');
  });
});

describe('Money secondary line', () => {
  it('US kid with dollars: only dollars, no ₩ anywhere', async () => {
    for (const lang of ['en', 'ko'] as const) {
      const html = await render(lang, 'US', 'USD', { usd: 3.5, secondary: true });
      expect(html).toContain('$3.50');
      expect(html).not.toMatch(/₩|원|money-sub|money-stack/);
    }
  });

  it('Korean kid with won: won first, the dollar amount underneath', async () => {
    const html = await render('ko', 'KR', 'KRW', { usd: 3.5, secondary: true });
    expect(html).toContain('4,760원');
    expect(html).toMatch(/class="money-sub">[^<]*\$3\.50/);
    expect(html).toContain('money-stack');
  });

  it('Korean kid switched to dollars: the won amount underneath, always approximate', async () => {
    const html = await render('en', 'KR', 'USD', { usd: 3.5, secondary: true });
    expect(html).toContain('$3.50');
    expect(html).toMatch(/class="money-sub">[^<]*₩4,760/);
    expect(html).toMatch(/class="money-sub">≈/);
  });

  it('US kid switched to won: the dollar amount underneath', async () => {
    const html = await render('en', 'US', 'KRW', { usd: 3.5, secondary: true });
    expect(html).toContain('₩4,760');
    expect(html).toMatch(/class="money-sub">[^<]*\$3\.50/);
  });

  it('no second line without `secondary`, or without an amount', async () => {
    expect(await render('ko', 'KR', 'KRW', { usd: 3.5 })).not.toContain('money-sub');
    const none = await render('ko', 'KR', 'KRW', { usd: null, secondary: true });
    expect(none).toContain('—');
    expect(none).not.toMatch(/money-sub|money-stack/);
  });
});
