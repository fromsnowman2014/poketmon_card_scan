import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './cache';
import { ebayLinks, ebayQuery, fetchEbaySummary, type EbayCard } from './ebay';

const lopunny: EbayCard = {
  name: 'Lopunny',
  lang: 'en',
  localId: '084',
  setId: 'sv08.5',
  dexIds: [428],
  setName: 'Prismatic Evolutions',
  setOfficialCount: 131,
};

const hawlucha: EbayCard = {
  name: 'ルチャブル',
  lang: 'ja',
  localId: '084',
  setId: 'SV8a',
  dexIds: [701],
  setName: 'テラスタルフェスex',
  setOfficialCount: 187,
};

describe('ebayQuery', () => {
  it('builds English keywords from name, number/total and set name', () => {
    expect(ebayQuery(lopunny)).toBe('Lopunny 084/131 Prismatic Evolutions');
  });

  it('translates Japanese names to English and adds the lowercased set code', () => {
    expect(ebayQuery(hawlucha)).toBe('Hawlucha sv8a 084/187 Japanese');
  });

  it('keeps card suffixes when translating', () => {
    expect(ebayQuery({ ...hawlucha, name: 'ブラッキーex', dexIds: [197], localId: '217' })).toBe('Umbreon ex sv8a 217/187 Japanese');
  });

  it('Japanese trainer cards (no Pokédex number) go by their printed code alone', () => {
    expect(ebayQuery({ ...hawlucha, name: 'ナンジャモ', dexIds: [], localId: '232' })).toBe('sv8a 232/187 Japanese');
    expect(ebayQuery({ ...hawlucha, lang: 'ko', name: 'ナンジャモ', dexIds: [], localId: '232', printedNumber: '232/187' })).toBe(
      'sv8a 232/187 Korean',
    );
    // A JA promo trainer/energy: "085/SV-P" is just as specific.
    expect(ebayQuery({ ...hawlucha, name: '基本悪エネルギー', dexIds: [], setId: 'SV-P', localId: '085', setOfficialCount: undefined, printedNumber: '085/SV-P' })).toBe(
      '085/SV-P Japanese',
    );
  });

  it('keeps "pokemon" only as a last resort, when neither a name nor a full code is known', () => {
    expect(ebayQuery({ ...hawlucha, name: 'ナンジャモ', dexIds: [], localId: '232', setOfficialCount: undefined })).toBe('pokemon sv8a 232 Japanese');
  });

  it('uses the printed number when known', () => {
    expect(ebayQuery({ ...lopunny, printedNumber: '084/131' })).toBe('Lopunny 084/131 Prismatic Evolutions');
    expect(ebayQuery({ ...hawlucha, printedNumber: '084/187' })).toBe('Hawlucha sv8a 084/187 Japanese');
  });

  it('EN promos: number + "promo", or the prefixed number alone; never the TCGdex "Black Star Promos" name', () => {
    const promo: EbayCard = { name: 'Pikachu with Grey Felt Hat', lang: 'en', localId: '085', setId: 'svp', dexIds: [25], setName: 'SVP Black Star Promos', printedNumber: '085' };
    expect(ebayQuery(promo)).toBe('Pikachu with Grey Felt Hat 085 promo');
    const swshp = { ...promo, name: 'Galarian Moltres', localId: 'SWSH284', setId: 'swshp', setName: 'SWSH Black Star Promos', printedNumber: 'SWSH284' };
    expect(ebayQuery(swshp)).toBe('Galarian Moltres SWSH284');
    expect(ebayQuery({ ...swshp, name: 'Charizard GX', localId: 'SM60', setId: 'smp', setName: 'SM Black Star Promos', printedNumber: 'SM60' })).toBe(
      'Charizard GX SM60',
    );
  });

  it('EN subsets: lettered number/total and the parent set name', () => {
    const tg: EbayCard = { name: 'Zekrom', lang: 'en', localId: 'TG05', setId: 'swsh9tg', dexIds: [644], setName: 'Brilliant Stars Trainer Gallery', setOfficialCount: 30, printedNumber: 'TG05/TG30' };
    expect(ebayQuery(tg)).toBe('Zekrom TG05/TG30 Brilliant Stars');
    expect(ebayQuery({ ...tg, name: 'Leafeon VSTAR', localId: 'GG35', setId: 'swsh12.5gg', setName: 'Crown Zenith Galarian Gallery', setOfficialCount: 70, printedNumber: 'GG35/GG70' })).toBe(
      'Leafeon VSTAR GG35/GG70 Crown Zenith',
    );
  });

  it('falls back to the species name when the card name does not contain it', () => {
    expect(ebayQuery({ ...hawlucha, name: '???', dexIds: [701] })).toBe('Hawlucha sv8a 084/187 Japanese');
  });

  it('omits the total when unknown and collapses whitespace', () => {
    expect(ebayQuery({ ...lopunny, name: '  Lopunny ', setOfficialCount: undefined, setName: 'Prismatic   Evolutions ' })).toBe(
      'Lopunny 084 Prismatic Evolutions',
    );
    expect(ebayQuery({ ...hawlucha, setOfficialCount: undefined })).toBe('Hawlucha sv8a 084 Japanese');
  });

  it('writes Japanese promos the way they are printed', () => {
    expect(ebayQuery({ ...hawlucha, name: 'ピカチュウ', dexIds: [25], setId: 'SV-P', localId: '085', setOfficialCount: undefined })).toBe(
      'Pikachu 085/SV-P Japanese',
    );
  });

  it('marks Korean cards as Korean', () => {
    expect(ebayQuery({ ...hawlucha, lang: 'ko' })).toBe('Hawlucha sv8a 084/187 Korean');
  });
});

describe('ebayLinks', () => {
  it('builds category-scoped search links for each listing type', () => {
    const base = 'https://www.ebay.com/sch/i.html?_nkw=Hawlucha%20sv8a%20084%2F187%20Japanese&_sacat=183454';
    expect(ebayLinks('Hawlucha sv8a 084/187 Japanese')).toEqual({
      all: base,
      auctions: `${base}&LH_Auction=1&_sop=1`,
      buyNow: `${base}&LH_BIN=1&_sop=15`,
      sold: `${base}&LH_Sold=1&LH_Complete=1&_sop=13`,
    });
  });

  it('encodes special characters', () => {
    expect(ebayLinks("Team Rocket's Mewtwo ex & co").all).toContain("_nkw=Team%20Rocket's%20Mewtwo%20ex%20%26%20co&");
  });
});

describe('fetchEbaySummary', () => {
  const summary = {
    query: 'Hawlucha sv8a 084/187 Japanese',
    fetchedAt: '2026-11-08T10:00:00.000Z',
    auctions: {
      count: 3,
      items: [
        {
          title: 'Hawlucha 084/187 sv8a Japanese',
          price: 2.5,
          currency: 'USD',
          bidCount: 3,
          endsAt: '2026-11-09T01:00:00.000Z',
          url: 'https://www.ebay.com/itm/1',
          image: 'https://i.ebayimg.com/a.jpg',
          shipping: null,
          condition: 'Ungraded',
          graded: false,
        },
      ],
    },
    buyNow: {
      count: 2,
      lowest: 0.99,
      median: 1.49,
      items: [{ title: 'Hawlucha sv8a 084/187 NM', price: 0.99, currency: 'USD', url: 'https://www.ebay.com/itm/2', shipping: 1.25, graded: false }],
    },
    searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=x&_sacat=183454',
    soldUrl: 'https://www.ebay.com/sch/i.html?_nkw=x&_sacat=183454&LH_Sold=1&LH_Complete=1&_sop=13',
  };

  const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
    const fn = vi.fn(impl);
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('calls <worker>/ebay?q= and returns the parsed summary', async () => {
    const fetchFn = stubFetch(async () => jsonResponse(summary));
    const out = await fetchEbaySummary('https://cardcheck-ebay.kid.workers.dev/', 'Hawlucha  sv8a 084/187 Japanese');
    expect(fetchFn.mock.calls[0][0]).toBe('https://cardcheck-ebay.kid.workers.dev/ebay?q=Hawlucha%20sv8a%20084%2F187%20Japanese');
    expect(out.buyNow.lowest).toBe(0.99);
    expect(out.auctions.items[0]).toMatchObject({ title: 'Hawlucha 084/187 sv8a Japanese', price: 2.5, bidCount: 3 });
    expect(out.buyNow.items[0]).toMatchObject({ shipping: 1.25, condition: null, image: undefined });
    expect(out.buyNow).not.toHaveProperty('lowestShipping'); // older workers don't send it
    expect(out.soldUrl).toBe(summary.soldUrl);
  });

  it('passes the shipping part of the lowest Buy It Now total through', async () => {
    stubFetch(async () => jsonResponse({ ...summary, buyNow: { ...summary.buyNow, lowest: 2.24, lowestShipping: 1.25 } }));
    expect((await fetchEbaySummary('https://w.example', 'q')).buyNow).toMatchObject({ lowest: 2.24, lowestShipping: 1.25 });
    stubFetch(async () => jsonResponse({ ...summary, buyNow: { ...summary.buyNow, lowestShipping: 'free' } }));
    expect((await fetchEbaySummary('https://w.example', 'q')).buyNow.lowestShipping).toBeNull();
  });

  it('asks for shipping to Korea with &country=KR; a kid in the US sends no country (old URLs and cache keys)', async () => {
    const fetchFn = stubFetch(async () => jsonResponse(summary));
    await fetchEbaySummary('https://w.example', 'Hawlucha 084/187', undefined, 'KR');
    await fetchEbaySummary('https://w.example/ebay/', 'Hawlucha 084/187', undefined, 'US');
    await fetchEbaySummary('https://w.example', 'Hawlucha 084/187');
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      'https://w.example/ebay?q=Hawlucha%20084%2F187&country=KR',
      'https://w.example/ebay?q=Hawlucha%20084%2F187',
      'https://w.example/ebay?q=Hawlucha%20084%2F187',
    ]);
  });

  it('reads where shipping goes; an older worker without shipTo priced it to the US', async () => {
    const shipToOf = async (shipTo: unknown) => {
      stubFetch(async () => jsonResponse(shipTo === undefined ? summary : { ...summary, shipTo }));
      return (await fetchEbaySummary('https://w.example', 'q', undefined, 'KR')).shipTo;
    };
    expect(await shipToOf('KR')).toBe('KR');
    expect(await shipToOf('US')).toBe('US');
    expect(await shipToOf(undefined)).toBe('US');
    for (const odd of ['kr', 'JP', 82, null, { country: 'KR' }]) expect(await shipToOf(odd)).toBe('US');
  });

  it('accepts a pasted URL without scheme or with the /ebay path', async () => {
    const fetchFn = stubFetch(async () => jsonResponse(summary));
    await fetchEbaySummary(' cardcheck-ebay.kid.workers.dev ', 'q1');
    await fetchEbaySummary('https://cardcheck-ebay.kid.workers.dev/ebay', 'q2');
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      'https://cardcheck-ebay.kid.workers.dev/ebay?q=q1',
      'https://cardcheck-ebay.kid.workers.dev/ebay?q=q2',
    ]);
  });

  it('drops malformed or non-https listings instead of failing', async () => {
    stubFetch(async () =>
      jsonResponse({
        ...summary,
        auctions: { count: 2, items: [{ title: 'no price', url: 'https://www.ebay.com/itm/9' }, { title: 'bad', price: 1, url: 'javascript:alert(1)' }] },
        buyNow: { ...summary.buyNow, lowest: 'cheap', items: 'nope' },
      }),
    );
    const out = await fetchEbaySummary('https://w.example', 'q');
    expect(out.auctions).toEqual({ count: 2, items: [] });
    expect(out.buyNow).toMatchObject({ lowest: null, median: 1.49, items: [] });
  });

  it('throws HttpError when the worker reports an error', async () => {
    stubFetch(async () => jsonResponse({ error: 'ebay_unavailable', searchUrl: summary.searchUrl }, 502));
    const err = await fetchEbaySummary('https://w.example', 'q').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(502);
  });

  it('throws on an unexpected response shape', async () => {
    stubFetch(async () => jsonResponse({ hello: 'world' }));
    await expect(fetchEbaySummary('https://w.example', 'q')).rejects.toThrow(/Unexpected response/);
  });

  const hangingFetch = () =>
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

  it('times out after 10 seconds', async () => {
    vi.useFakeTimers();
    hangingFetch();
    const pending = expect(fetchEbaySummary('https://w.example', 'q')).rejects.toThrow(/Abort/);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
  });

  it('aborts when the caller aborts', async () => {
    const fetchFn = hangingFetch();
    const ctrl = new AbortController();
    const pending = fetchEbaySummary('https://w.example', 'q', ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toThrow(/Abort/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
