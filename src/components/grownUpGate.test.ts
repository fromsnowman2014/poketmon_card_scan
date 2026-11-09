import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ExternalLink } from './ExternalLink';
import { confirmGrownUp, GROWN_UP_KEY, grownUpConfirmed, isWebUrl, openShop, resetGrownUpGate, shopTap } from './grownUpGate';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

afterEach(() => resetGrownUpGate());

describe('grown-up gate', () => {
  it('asks until a grown-up says OK, then remembers it in session storage', () => {
    const storage = memoryStorage();
    expect(grownUpConfirmed(storage)).toBe(false);
    confirmGrownUp(storage);
    expect(storage.data.get(GROWN_UP_KEY)).toBe('1');
    resetGrownUpGate(); // a reload: memory is gone, the session remembers
    expect(grownUpConfirmed(storage)).toBe(true);
  });

  it('reads an OK saved earlier in the session', () => {
    const storage = memoryStorage();
    storage.setItem(GROWN_UP_KEY, '1');
    expect(grownUpConfirmed(storage)).toBe(true);
  });

  it('never throws when storage is blocked and remembers the OK until reload', () => {
    expect(grownUpConfirmed(throwing)).toBe(false);
    expect(() => confirmGrownUp(throwing)).not.toThrow();
    expect(grownUpConfirmed(throwing)).toBe(true);
    resetGrownUpGate();
    expect(grownUpConfirmed(throwing)).toBe(false);
  });

  it('works without any storage (node)', () => {
    expect(grownUpConfirmed(undefined)).toBe(false);
    confirmGrownUp(undefined);
    expect(grownUpConfirmed(undefined)).toBe(true);
  });
});

describe('shop buttons', () => {
  const URL_EBAY = 'https://www.ebay.com/itm/1';

  function spy() {
    const calls: unknown[][] = [];
    return { calls, open: (...args: unknown[]) => void calls.push(args) };
  }

  it('only opens web pages', () => {
    expect(isWebUrl(URL_EBAY)).toBe(true);
    expect(isWebUrl('http://example.com/x')).toBe(true);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('JavaScript:alert(1)')).toBe(false);
    expect(isWebUrl('data:text/html,hi')).toBe(false);
    expect(isWebUrl('ebay://item/1')).toBe(false);
    expect(isWebUrl('/relative')).toBe(false);
    expect(isWebUrl('')).toBe(false);
  });

  it('opens a new tab without a handle on the app', () => {
    const w = spy();
    expect(openShop(URL_EBAY, w.open)).toBe(true);
    expect(w.calls).toEqual([[URL_EBAY, '_blank', 'noopener']]);
    expect(openShop('javascript:alert(1)', w.open)).toBe(false);
    expect(w.calls).toHaveLength(1);
  });

  it('asks first, and opens only after a grown-up said OK', () => {
    const storage = memoryStorage();
    const w = spy();
    let asked = 0;
    expect(shopTap(URL_EBAY, () => asked++, w.open, storage)).toBe('asked');
    expect(asked).toBe(1);
    expect(w.calls).toHaveLength(0);
    confirmGrownUp(storage);
    expect(shopTap(URL_EBAY, () => asked++, w.open, storage)).toBe('opened');
    expect(asked).toBe(1);
    expect(w.calls).toEqual([[URL_EBAY, '_blank', 'noopener']]);
  });

  it('does nothing for a non-web URL, even after OK', () => {
    const storage = memoryStorage();
    confirmGrownUp(storage);
    const w = spy();
    let asked = 0;
    expect(shopTap('javascript:alert(1)', () => asked++, w.open, storage)).toBe('blocked');
    expect(asked + w.calls.length).toBe(0);
  });
});

describe('ExternalLink markup', () => {
  it('is a button with link semantics and no href (iOS long-press "Open in New Tab" has nothing to open)', () => {
    const html = renderToStaticMarkup(
      createElement(ExternalLink, { href: 'https://www.ebay.com/itm/1', site: 'eBay', className: 'card-ebay-link' }, 'Auctions'),
    );
    const button = /<button[^>]*>/.exec(html)?.[0] ?? '';
    expect(button).toContain('type="button"');
    expect(button).toContain('role="link"');
    expect(button).toContain('class="ext-link card-ebay-link"');
    expect(html).not.toMatch(/href=|<a[\s>]/);
    expect(html).toMatch(/Auctions<span class="sr-only">\((새 탭|new tab)\)<\/span><\/button>/);
  });
});
