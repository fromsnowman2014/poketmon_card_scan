import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardBrief, UiLang } from '../../lib/types';

const HAWLUCHA: CardBrief = { id: 'SV8a-084', lang: 'ja', localId: '084', name: 'ルチャブル', setId: 'SV8a', setName: 'テラスタルフェスex' };
const CHARIZARD: CardBrief = { id: 'sv03.5-199', lang: 'en', localId: '199', name: 'Charizard ex', setId: 'sv03.5', setName: '151' };

/** The picker in `uiLang` (fresh modules, so the store reads the settings). */
async function render(uiLang: UiLang, candidates: CardBrief[]): Promise<string> {
  const data = new Map([['cc:settings', JSON.stringify({ v: 1, data: { uiLang, country: 'KR', currency: 'KRW', searchLang: 'ja', ebayWorkerUrl: '', theme: 'system' } })]]);
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined });
  vi.resetModules();
  const { CandidatePicker } = await import('./CandidatePicker');
  const noop = () => undefined;
  return renderToStaticMarkup(createElement(CandidatePicker, { photo: 'data:image/jpeg;base64,', candidates, onPick: noop, onNotHere: noop, onRetake: noop }));
}

const names = (html: string) =>
  [...html.matchAll(/class="scan-cand-(name|sub)[^"]*">([^<]+)</g)].map(([, kind, text]) => `${kind}:${text}`);

describe('CandidatePicker names (same order as the Card screen title)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('JA cards lead with the UI-language name over the printed one', async () => {
    expect(names(await render('ko', [HAWLUCHA, CHARIZARD]))).toEqual(['name:루차불', 'sub:ルチャブル', 'name:Charizard ex', 'sub:리자몽 ex']);
    expect(names(await render('en', [HAWLUCHA, CHARIZARD]))).toEqual(['name:Hawlucha', 'sub:ルチャブル', 'name:Charizard ex']);
  });

  it('one candidate: the big title is the UI-language name', async () => {
    const html = await render('ko', [HAWLUCHA]);
    expect(html).toMatch(/<h2 class="h2">루차불<\/h2>/);
    expect(html).toContain('ルチャブル');
  });
});
