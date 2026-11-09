import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache, HttpError } from './cache';
import { ebayQuery } from './ebay';
import { getRates, getRatesSync } from './fx';
import { formatMoney } from './pricing';
import {
  cardImage,
  findByCode,
  getCard,
  getSets,
  listCards,
  parseQueryCode,
  printedNumber,
  resolveSets,
  searchCards,
  splitCardId,
} from './tcgdex';
import { calledUrls, mockFetch, tcgdexHandler } from './__fixtures__/mockFetch';

const LIVE = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE === '1';
const POCKET = /^(A\d+[ab]?|B\d+a?|P-A)-/;

describe.skipIf(LIVE)('tcgdex (mocked API)', () => {
  let fetchMock: ReturnType<typeof mockFetch>;
  beforeEach(() => {
    clearCache();
    fetchMock = mockFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('getSets', () => {
    it('drops TCG Pocket, merges EN abbreviations and sorts newest first', async () => {
      const sets = await getSets('en');
      expect(sets.some((s) => /^(A\d|B\d|P-A)/.test(s.id))).toBe(false);
      expect(sets.find((s) => s.id === 'sv04')).toMatchObject({ abbreviation: 'PAR', official: 182, releaseDate: '2023-11-03' });
      expect(sets.find((s) => s.id === 'sv08.5')?.logo).toBe('https://assets.tcgdex.net/en/sv/sv08.5/logo.webp');
      const dates = sets.map((s) => s.releaseDate ?? '');
      expect(dates).toEqual([...dates].sort().reverse());
    });

    it('de-duplicates JA ids and serves KO from JA', async () => {
      const ko = await getSets('ko');
      expect(ko.filter((s) => s.id === 'BW3a')).toHaveLength(1);
      expect(ko.find((s) => s.id === 'SV8a')).toMatchObject({ name: 'テラスタルフェスex', official: 187, releaseDate: '2024-12-06' });
      expect(await getSets('ja')).toBe(ko); // same cache entry
    });

    it('falls back to the REST list when GraphQL is unavailable', async () => {
      mockFetch((url) => {
        if (url.pathname === '/v2/graphql') return new Response('bad', { status: 400 });
        if (url.pathname === '/v2/ja/sets') return [{ id: 'SV8', name: '超電ブレイカー', cardCount: { official: 106, total: 136 } }, { id: 'SV8a', name: 'テラスタルフェスex', cardCount: { official: 187, total: 237 } }];
        return undefined;
      });
      expect((await getSets('ja')).map((s) => s.id)).toEqual(['SV8a', 'SV8']);
    });
  });

  describe('getCard', () => {
    it('builds a CardDetail for ja SV8a-084', async () => {
      await getRates(); // mocked 0.9 EUR per USD
      const card = await getCard('ja', 'SV8a-084');
      expect(card).toMatchObject({
        id: 'SV8a-084',
        lang: 'ja',
        localId: '084',
        name: 'ルチャブル',
        image: 'https://assets.tcgdex.net/ja/SV/SV8a/084',
        setId: 'SV8a',
        setName: 'テラスタルフェスex',
        setOfficialCount: 187,
        printedNumber: '084/187',
        setReleaseDate: '2024-12-06',
        hp: 70,
        types: ['Fighting'],
        dexIds: [701],
        illustrator: 'GOSSAN',
        imageFallback: 'https://tcgplayer-cdn.tcgplayer.com/product/602464_400w.jpg',
        defaultVariant: 'normal',
      });
      expect(card.rarity).toBeUndefined(); // literal "None"
      const reverse = card.variants.find((v) => v.key === 'reverse');
      expect(reverse?.summary?.market).toBe(1.68); // 1.51 EUR at the mocked 0.9 EUR/USD
    });

    it('reads Korean cards from the JA endpoint', async () => {
      const card = await getCard('ko', 'SV8a-084');
      expect(card.lang).toBe('ja');
      expect(calledUrls(fetchMock)).toContain('https://api.tcgdex.net/v2/ja/cards/SV8a-084');
    });

    it('rejects with status 404 for unknown cards', async () => {
      const err = await getCard('en', 'sv08.5-999').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(404);
    });

    it('keeps EN rarity and the TCGplayer headline', async () => {
      const card = await getCard('en', 'sv03.5-199');
      expect(card).toMatchObject({
        rarity: 'Special illustration rare',
        setName: '151',
        setOfficialCount: 165,
        printedNumber: '199/165',
        defaultVariant: 'holo',
      });
      // High: Cardmarket avg 336.32 EUR beats TCGplayer's mid (the 10000 high is a placeholder).
      const high = Math.round((336.32 / getRatesSync().EUR) * 100) / 100;
      expect(card.variants[0].summary).toMatchObject({ market: 295.26, high, source: 'tcgplayer' });
    });

    it.each([
      // EN promo sets report the number of promos as "official", but the cards print no total.
      ['en', 'svp-085', undefined, '085', 'Pikachu with Grey Felt Hat 085 promo'],
      ['en', 'swshp-SWSH284', undefined, 'SWSH284', 'Galarian Moltres SWSH284'],
      // Subset sets: lettered totals and the parent set's name.
      ['en', 'swsh9tg-TG05', 30, 'TG05/TG30', 'Zekrom TG05/TG30 Brilliant Stars'],
      ['en', 'swsh12.5gg-GG35', 70, 'GG35/GG70', 'Leafeon VSTAR GG35/GG70 Crown Zenith'],
      ['ja', 'SV-P-085', undefined, '085/SV-P', '085/SV-P Japanese'],
      ['ja', 'SV8a-084', 187, '084/187', 'Hawlucha sv8a 084/187 Japanese'],
    ] as const)('%s %s: printed number and eBay keywords', async (lang, id, official, printed, query) => {
      const card = await getCard(lang, id);
      expect(card.setOfficialCount).toBe(official);
      expect(card.printedNumber).toBe(printed);
      expect(ebayQuery(card)).toBe(query);
    });

    it('does not wait for exchange rates (last known / fallback rates, live ones load in the background)', async () => {
      vi.useFakeTimers();
      const fx = /er-api|frankfurter|currency-api/;
      const hang = (signal?: AbortSignal | null) =>
        new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (fx.test(url.host + url.pathname)) return hang(init?.signal);
        const out = tcgdexHandler(url, typeof init?.body === 'string' ? init.body : undefined);
        return out === undefined ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(out), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchFn);
      const rates = getRatesSync();
      const card = await getCard('ja', 'SV8a-084');
      expect(card.variants.find((v) => v.key === 'reverse')?.summary?.market).toBe(Math.round((1.51 / rates.EUR) * 100) / 100);
      expect(calledUrls(fetchFn).some((u) => u.includes('er-api'))).toBe(true);
      // Each provider gets at most 3.5 s, then the next one is tried.
      await vi.advanceTimersByTimeAsync(3500);
      expect(calledUrls(fetchFn).some((u) => u.includes('frankfurter'))).toBe(true);
      await vi.advanceTimersByTimeAsync(7000);
      expect(getRatesSync()).toEqual(rates);
      vi.useRealTimers();
    });
  });

  describe('resolveSets', () => {
    it('matches a JA code to its set id when the total agrees', async () => {
      const r = await resolveSets({ setCode: 'sv8a', number: '084', total: '187', lang: 'ja' }, ['ja']);
      expect(r.map((c) => [c.lang, c.set.id, c.score])).toEqual([['ja', 'SV8a', 1]]);
    });

    it('maps an EN abbreviation through en-sets.json', async () => {
      const r = await resolveSets({ setCode: 'PAR', number: '123', total: '182', lang: 'en' }, ['en']);
      expect(r.map((c) => c.set.id)).toEqual(['sv04']);
    });

    it('ranks same-size sets by code similarity, newest first among equals', async () => {
      const noisy = await resolveSets({ setCode: 'sv8', number: '084', total: '187' }, ['ja']);
      expect(noisy[0].set.id).toBe('SV8a');
      const noCode = await resolveSets({ number: '123', total: '182' }, ['en']);
      expect(noCode.map((c) => c.set.id)).toEqual(['sv10', 'sv04']);
    });
  });

  describe('findByCode', () => {
    it('"sv8a 084/187" → exact lookup of SV8a-084', async () => {
      const r = await findByCode({ setCode: 'sv8a', number: '084', total: '187', lang: 'ja' });
      expect(r).toEqual([
        { id: 'SV8a-084', lang: 'ja', localId: '084', name: 'ルチャブル', image: 'https://assets.tcgdex.net/ja/SV/SV8a/084', setId: 'SV8a', setName: 'テラスタルフェスex' },
      ]);
      expect(calledUrls(fetchMock).filter((u) => u.includes('/cards'))).toEqual(['https://api.tcgdex.net/v2/ja/cards/SV8a-084']);
    });

    it('number/total only → filtered list query with exact localId match', async () => {
      const r = await findByCode({ number: '084', total: '187' }, ['ja']);
      expect(r.map((c) => c.id)).toEqual(['SV8a-084']); // SV8a-184 also matched the contains filter
      expect(r[0].setName).toBe('テラスタルフェスex');
      expect(calledUrls(fetchMock)).toContain('https://api.tcgdex.net/v2/ja/cards?set.cardCount.official=187&localId=084');
    });

    it('does not trust a code whose set size contradicts the total ("sv8" for 187)', async () => {
      const r = await findByCode({ setCode: 'SV8', number: '084', total: '187', lang: 'ja' });
      expect(r.map((c) => c.id)).toEqual(['SV8a-084']);
      expect(calledUrls(fetchMock)).not.toContain('https://api.tcgdex.net/v2/ja/cards/SV8-084');
    });

    it('EN: abbreviation → set id, padded number first', async () => {
      const r = await findByCode({ setCode: 'MEW', number: '199', total: '165', lang: 'en' });
      expect(r.map((c) => c.id)).toEqual(['sv03.5-199']);
    });

    it('EN: older sets fall back to the unpadded number', async () => {
      const r = await findByCode({ setCode: 'BS', number: '4', total: '102', lang: 'en' });
      expect(r.map((c) => c.id)).toEqual(['base1-4']);
      expect(calledUrls(fetchMock)).toEqual(expect.arrayContaining(['https://api.tcgdex.net/v2/en/cards/base1-004', 'https://api.tcgdex.net/v2/en/cards/base1-4']));
    });

    it('JA promo "085/SV-P" → SV-P-085', async () => {
      await findByCode({ setCode: 'SV-P', number: '085', promo: true, lang: 'ja' });
      expect(calledUrls(fetchMock)).toContain('https://api.tcgdex.net/v2/ja/cards/SV-P-085');
    });

    it('returns nothing without a number', async () => {
      expect(await findByCode({ setCode: 'sv8a' })).toEqual([]);
    });

    it('subset numbers ("TG05/TG30") are listed by number, newest set first', async () => {
      const tg05 = ['swsh9tg-TG05', 'swsh11tg-TG05', 'swsh10tg-TG05', 'swsh12tg-TG05', 'swsh9tg-TG050'].map((id) => ({ id, localId: id.split('-')[1], name: 'x' }));
      mockFetch((url) => (url.pathname === '/v2/en/cards' && url.searchParams.get('localId') === 'TG05' ? tg05 : undefined));
      const r = await findByCode({ number: 'TG05', total: 'TG30' });
      expect(r.map((c) => c.id)).toEqual(['swsh12tg-TG05', 'swsh11tg-TG05', 'swsh10tg-TG05', 'swsh9tg-TG05']);
    });
  });

  describe('searchCards', () => {
    it('finds EN codes typed in any case or as one token', async () => {
      expect((await searchCards('svp 085', 'ko')).map((c) => c.id)).toEqual(['svp-085']);
      expect((await searchCards('Svp EN 085', 'en')).map((c) => c.id)).toEqual(['svp-085']);
      expect((await searchCards('swsh284', 'en')).map((c) => c.id)).toEqual(['swshp-SWSH284']);
      expect((await searchCards('SWSH 284', 'en')).map((c) => c.id)).toEqual(['swshp-SWSH284']);
    });

    it('a Korean name is translated to the JA name= query', async () => {
      const r = await searchCards('루차불', 'ko');
      expect(calledUrls(fetchMock)).toContain('https://api.tcgdex.net/v2/ja/cards?name=ルチャブル');
      expect(r).toHaveLength(16);
      expect(r.every((c) => c.lang === 'ja' && c.setName)).toBe(true);
      // newest set first: M3 (2026-01) before SV8a (2024-12) before CP2 (2015)
      const ids = r.map((c) => c.id);
      expect(ids.indexOf('M3-045')).toBeLessThan(ids.indexOf('SV8a-084'));
      expect(ids.at(-1)).toBe('CP2-015');
    });

    it('drops TCG Pocket cards', async () => {
      const r = await searchCards('Charizard ex', 'en');
      expect(r.length).toBeGreaterThan(20);
      expect(r.some((c) => POCKET.test(c.id))).toBe(false);
      expect(r[r.length - 1].setId).toBe('ex6'); // oldest
    });

    it('a typed printed code goes through findByCode', async () => {
      const r = await searchCards('sv8a 084/187', 'en');
      expect(r.map((c) => c.id)).toEqual(['SV8a-084']);
      const byId = await searchCards('SV8a-084', 'ja');
      expect(byId.map((c) => c.id)).toEqual(['SV8a-084']);
    });

    it('a one-letter trainer name ("N") is matched exactly, not as a substring or species prefix', async () => {
      await searchCards('n', 'en');
      const lists = calledUrls(fetchMock).filter((u) => u.includes('/cards?'));
      expect(lists).toEqual(['https://api.tcgdex.net/v2/en/cards?name=eq:N']);
    });

    it('respects the limit', async () => {
      expect(await searchCards('ルチャブル', 'ja', 3)).toHaveLength(3);
    });
  });

  it('listCards returns briefs with setName', async () => {
    const r = await listCards('ja', { name: 'ルチャブル' });
    expect(r.find((c) => c.id === 'SV-P-034')).toMatchObject({ setId: 'SV-P', localId: '034', lang: 'ja' });
  });

});

describe('parseQueryCode', () => {
  it.each([
    ['PAR 123', { setCode: 'PAR', number: '123' }],
    ['par 123', { setCode: 'PAR', number: '123' }],
    ['Par 123/182', { setCode: 'PAR', number: '123', total: '182' }],
    ['obf 125', { setCode: 'OBF', number: '125' }],
    ['svp en 085', { setCode: 'SVP', number: '085' }],
    ['Svp 085', { setCode: 'SVP', number: '085', lang: 'en' }],
    ['swsh 284', { setCode: 'SWSH', number: '284', lang: 'en' }],
    ['SWSH284', { setCode: 'SWSH', number: '284', lang: 'en' }],
    ['swsh284', { setCode: 'SWSH', number: '284', lang: 'en' }],
    ['sm60', { setCode: 'SM', number: '60', lang: 'en' }],
    ['tg05/tg30', { number: 'TG05', total: 'TG30' }],
    ['sv8a 084', { setCode: 'sv8a', number: '084' }],
    ['084/187', { number: '084', total: '187' }],
    ['085/SV-P', { setCode: 'SV-P', number: '085', promo: true, lang: 'ja' }],
  ])('%s', (q, code) => expect(parseQueryCode(q)).toEqual(code));

  it('keeps lowercase words that are not a known code (or with a one-digit number) as names', () => {
    expect(parseQueryCode('mew 2')).toBeUndefined(); // MEW is 151's code, but "mew 2" is a name
    expect(parseQueryCode('pikachu 25')).toBeUndefined();
    expect(parseQueryCode('MEW 2')).toEqual({ setCode: 'MEW', number: '2' });
  });
});

describe('printedNumber', () => {
  const card = (localId: string, setId: string, setName: string, lang: 'en' | 'ja' = 'en') => ({ localId, setId, setName, lang });
  it('writes the number the way the card prints it', () => {
    expect(printedNumber(card('084', 'sv08.5', 'Prismatic Evolutions'), 131)).toBe('084/131');
    expect(printedNumber(card('4', 'base1', 'Base Set'), 102)).toBe('4/102');
    expect(printedNumber(card('SV49', 'sma', 'Hidden Fates Shiny Vault'), 94)).toBe('SV49/SV94');
    expect(printedNumber(card('RC1', 'g1', 'Generations'), 83)).toBe('RC1'); // RC1/RC32: total unknown
    expect(printedNumber(card('XY01', 'xyp', 'XY Black Star Promos'), 211)).toBe('XY01');
    expect(printedNumber(card('001', 'mep', 'MEP Black Star Promos'), 0)).toBe('001');
    expect(printedNumber(card('001', 'M-P', 'メガ プロモカード', 'ja'), 0)).toBe('001/M-P');
  });
});

describe('cardImage / splitCardId', () => {
  it('builds image URLs', () => {
    expect(cardImage('https://assets.tcgdex.net/ja/SV/SV8a/084')).toBe('https://assets.tcgdex.net/ja/SV/SV8a/084/high.webp');
    expect(cardImage('https://assets.tcgdex.net/ja/SV/SV8a/084', 'low')).toBe('https://assets.tcgdex.net/ja/SV/SV8a/084/low.webp');
    expect(cardImage(undefined)).toBeUndefined();
  });

  it('splits ids whose set id contains dashes or dots', () => {
    expect(splitCardId('SV-P-085')).toEqual({ setId: 'SV-P', localId: '085' });
    expect(splitCardId('sv08.5-084')).toEqual({ setId: 'sv08.5', localId: '084' });
    expect(splitCardId('swsh9tg-TG01', 'TG01')).toEqual({ setId: 'swsh9tg', localId: 'TG01' });
  });
});

// LIVE=1 npx vitest run src/lib/tcgdex.test.ts — real API sanity check of headline prices.
describe.runIf(LIVE)('tcgdex (live API)', () => {
  it.each([
    ['ja', 'SV8a-084'],
    ['en', 'sv08.5-084'],
    ['en', 'sv03.5-199'],
  ] as const)('%s %s', async (lang, id) => {
    const card = await getCard(lang, id);
    const lines = card.variants.map((v) => {
      const s = v.summary;
      return `  ${v.key.padEnd(20)} ${s ? `${formatMoney(s.market, 'USD', undefined, { approx: s.converted })} (low ${formatMoney(s.low, 'USD')}, high ${formatMoney(s.high, 'USD')}, ${s.changePct ?? '–'}%, ${s.source}) ${formatMoney(s.market, 'KRW')}` : 'no price'}`;
    });
    console.log(`${card.id} ${card.name} · ${card.setName} ${card.localId}/${card.setOfficialCount} · default=${card.defaultVariant}\n${lines.join('\n')}`);
    expect(card.variants.some((v) => v.summary)).toBe(true);
  }, 30_000);

  it('finds SV8a-084 from its printed code and a Korean name', async () => {
    expect((await findByCode({ setCode: 'sv8a', number: '084', total: '187', lang: 'ja' })).map((c) => c.id)).toEqual(['SV8a-084']);
    expect((await searchCards('루차불', 'ko')).map((c) => c.id)).toContain('SV8a-084');
  }, 30_000);
});
