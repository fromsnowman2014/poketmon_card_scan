import { describe, expect, it } from 'vitest';
import { gateCopy } from './ExternalLink';

describe('ExternalLink grown-up question', () => {
  it('calls a shop a real shop', () => {
    expect(gateCopy('ko', { site: 'Cardmarket' })).toEqual({
      title: 'Cardmarket 웹사이트로 가요',
      body: 'Cardmarket은 진짜로 카드를 사고파는 곳이에요. 어른과 함께 볼까요?',
    });
    expect(gateCopy('en', { site: 'eBay', kind: 'shop' }).body).toBe('eBay is a real shop. Look together with a grown‑up!');
  });

  it('says only "a website outside the app" for other sites', () => {
    expect(gateCopy('ko', { site: 'GitHub', kind: 'site' })).toEqual({
      title: 'GitHub 웹사이트로 가요',
      body: '앱 밖의 웹사이트가 열려요. 어른과 함께 볼까요?',
    });
    const en = gateCopy('en', { site: 'TCGdex', kind: 'site' });
    expect(en.title).toBe('Opening TCGdex');
    expect(en.body).not.toMatch(/shop/i);
  });
});
