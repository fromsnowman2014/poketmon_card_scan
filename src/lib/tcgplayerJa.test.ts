import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache } from './cache';
import { getJaSetPrices, matchJaVariants, setKey, type JaGroup, type JaProduct, type JaRow, type JaSetFile, type JaVariantRef } from './tcgplayerJa';

const D = '2026-11-11T20:05:27Z';

const file = (products: Record<string, JaProduct>, more: JaGroup[] = []): JaSetFile => ({
  v: 1,
  d: D,
  k: 'sv8a',
  g: [{ id: 23909, n: 'SV8a: Terastal Fest ex', c: 1, p: products }, ...more],
});
const holo = (market: number | null, low = 1, mid = 1, high = 1): Record<string, JaRow> => ({ holofoil: [market, low, mid, high] });
const ref = (v: Partial<JaVariantRef> = {}): JaVariantRef => ({ type: 'normal', firstEdition: false, ownCardmarket: false, ...v });
const ids = (out: ReturnType<typeof matchJaVariants>) => out.map((m) => m?.productId ?? null);

describe('setKey', () => {
  it('makes the file name the build script makes', () => {
    expect(setKey('SV8a')).toBe('sv8a');
    expect(setKey('SV-P')).toBe('sv-p');
    expect(setKey('SM1+')).toBe('sm1p'); // TCGplayer's abbreviation
    expect(setKey('SM1p')).toBe('sm1p'); // TCGdex's id for the same set
    expect(setKey(' L1: HG ')).toBe('l1-hg');
    expect(setKey('PMCG1')).toBe('pmcg1');
    expect(setKey('---')).toBe('');
  });
});

describe('matchJaVariants — which product', () => {
  // The user's card: SV8a-084 as the real set file has it.
  const hawlucha = file({
    '602464': ['084/187', '', { normal: [0.18, 0.01, 0.17, 1], holofoil: [0.17, 0.01, 0.2, 0.99] }],
    '602465': ['084/187', 'Mirror Foil', { holofoil: [0.6, 0.34, 0.63, 1.84] }],
    '604564': ['084/187', 'Master Ball Pattern', { holofoil: [2.27, 2.27, 3.15, 7] }],
    '602466': ['085/187', '', { normal: [0.5, 0.4, 0.5, 2] }],
  });
  const three = [ref({ tcgplayerId: 602464 }), ref({ type: 'reverse', foil: 'masterball', tcgplayerId: 604564 }), ref({ type: 'reverse', tcgplayerId: 602465 })];

  it('a. TCGdex\'s product id, one entry per variant in the same order', () => {
    expect(matchJaVariants('084', three, hawlucha)).toEqual([
      { productId: 602464, price: { low: 0.01, mid: 0.17, high: 1, market: 0.18, directLow: null }, updated: D, kind: 'base' },
      { productId: 604564, price: { low: 2.27, mid: 3.15, high: 7, market: 2.27, directLow: null }, updated: D, kind: 'masterball' },
      { productId: 602465, price: { low: 0.34, mid: 0.63, high: 1.84, market: 0.6, directLow: null }, updated: D, kind: 'reverse' },
    ]);
  });

  it('b. card number + name tag when TCGdex has no id', () => {
    const noIds = three.map(({ tcgplayerId: _, ...v }) => v);
    expect(ids(matchJaVariants('084', noIds, hawlucha))).toEqual([602464, 604564, 602465]);
    // Numbers compare without leading zeros or case; the part after the slash is not looked at.
    expect(ids(matchJaVariants('84', noIds, hawlucha))).toEqual([602464, 604564, 602465]);
    expect(ids(matchJaVariants('0084', noIds, hawlucha))).toEqual([602464, 604564, 602465]);
    expect(ids(matchJaVariants('184', noIds, hawlucha))).toEqual([null, null, null]);
    const lettered = file({ '1': ['tg05/TG30', '', holo(3)], '2': ['057/SV-P', '', holo(4)] });
    expect(ids(matchJaVariants('TG05', [ref()], lettered))).toEqual([1]);
    expect(ids(matchJaVariants('057', [ref()], lettered))).toEqual([2]);
  });

  it('b. a product without a number is never found by number (1996 sets)', () => {
    const old = file({ '575571': ['', '', { normal: [7.04, 4.25, 6.5, 20] }] });
    expect(ids(matchJaVariants('', [ref()], old))).toEqual([null]);
    expect(ids(matchJaVariants('001', [ref()], old))).toEqual([null]);
    expect(ids(matchJaVariants('001', [ref({ tcgplayerId: 575571 })], old))).toEqual([575571]);
  });

  it('b. reads every pattern TCGplayer names, and leaves other brackets to the card name', () => {
    const tagged = (tags: string) => file({ '10': ['001/100', '', { normal: [1, 1, 1, 1] }], '11': ['001/100', tags, holo(2)] });
    const foilOf = (tags: string, foil?: string) => ids(matchJaVariants('001', [ref(), ref({ type: 'reverse', ...(foil ? { foil } : {}) })], tagged(tags)))[1];
    expect(foilOf('Mirror Foil')).toBe(11);
    expect(foilOf('Mirror Holofoil')).toBe(11);
    expect(foilOf('Mirror Holo')).toBe(11);
    expect(foilOf('Master Ball Pattern', 'masterball')).toBe(11);
    expect(foilOf('Poke Ball Pattern', 'pokeball')).toBe(11);
    expect(foilOf('Poké Ball Pattern', 'pokeball')).toBe(11);
    expect(foilOf('Energy Symbol Pattern', 'energy')).toBe(11);
    expect(foilOf('Love Ball Pattern', 'loveball')).toBe(11);
    expect(foilOf('Quick Ball Pattern', 'quickball')).toBe(11);
    expect(foilOf('Dusk Ball Pattern', 'duskball')).toBe(11);
    expect(foilOf('Friend Ball Pattern', 'friendball')).toBe(11);
    expect(foilOf('Team Rocket Pattern', 'team-rocket')).toBe(11);
    expect(foilOf('Team Plasma|Mirror Foil')).toBe(11);
    // A Master Ball product is not the Poké Ball printing.
    expect(foilOf('Master Ball Pattern', 'pokeball')).toBeNull();
    // "(Team Plasma)", "(GYM)" are part of the name: two base products under one number → neither.
    expect(ids(matchJaVariants('001', [ref()], tagged('Team Plasma')))).toEqual([null]);
    expect(ids(matchJaVariants('001', [ref()], tagged('Championship Series 2025')))).toEqual([null]);
  });

  it('b. only when exactly one product fits and the card has one variant of that kind', () => {
    // SV-P 057 is two cards on TCGplayer ("Penny" and "Taipei's Pikachu"): no guess.
    const twoCards = file({ '587814': ['057/SV-P', '', {}], '587815': ['057/SV-P', '', holo(111.37, 114.5, 134.9, 150)] });
    expect(ids(matchJaVariants('057', [ref()], twoCards))).toEqual([null]);
    // Normal + stamped normal are both "the base card": the one base product can't be told apart.
    const one = file({ '1': ['010/100', '', { normal: [1, 1, 1, 1] }] });
    expect(ids(matchJaVariants('010', [ref(), ref({ type: 'holo' })], one))).toEqual([null, null]);
    expect(ids(matchJaVariants('010', [ref()], one))).toEqual([1]);
  });

  it('a. an id that is not in the file is a product without prices: no other product is tried', () => {
    // SV8a-121: the Mirror Foil product 602529 has no price row; the Master Ball one must not become "the mirror".
    const f = file({ '602528': ['121/187', '', { normal: [0.17, 0.17, 0.2, 1] }], '604591': ['121/187', 'Master Ball Pattern', holo(7.8, 7, 9.87, 30)] });
    const variants = [ref({ tcgplayerId: 602528 }), ref({ type: 'reverse', tcgplayerId: 602529 })];
    expect(ids(matchJaVariants('121', variants, f))).toEqual([602528, null]);
    // Nor a second product that carries the same number and kind.
    const g = file({ '1': ['057/SV-P', '', holo(111)] });
    expect(ids(matchJaVariants('057', [ref({ tcgplayerId: 587814 })], g))).toEqual([null]);
  });

  it('c. a plain mirror takes the one product that is left and not the base card (M2a)', () => {
    // M2a-001: TCGdex lists normal + energy + a plain "reverse"; TCGplayer sells that one as "Poke Ball Pattern".
    const m2a = file({
      '665672': ['001/193', '', { normal: [0.1, 0.02, 0.15, 1] }],
      '665922': ['001/193', 'Poke Ball Pattern', holo(0.93, 0.45, 0.98, 3)],
      '666088': ['001/193', 'Energy Symbol Pattern', holo(0.53, 0.2, 0.55, 2)],
    });
    const variants = [ref(), ref({ type: 'reverse', foil: 'energy' }), ref({ type: 'reverse' })];
    expect(ids(matchJaVariants('001', variants, m2a))).toEqual([665672, 666088, 665922]);
    // The match says which pattern it is, so the screen can name it (M2a-034: a Team Rocket one).
    expect(matchJaVariants('001', variants, m2a).map((m) => m?.kind)).toEqual(['base', 'energy', 'pokeball']);
    const rocket = file({ '1': ['034/193', '', { normal: [0.15, 0.1, 0.2, 1] }], '2': ['034/193', 'Team Rocket Pattern', holo(2.21)] });
    expect(matchJaVariants('034', [ref(), ref({ type: 'reverse' })], rocket)[1]?.kind).toBe('team-rocket');
    // A Mirror Foil product in the file, even one without a price (the build keeps those), is the plain mirror:
    // no price for it today, and the Poké Ball product is not taken instead.
    const unpricedMirror = file({ ...m2a.g[0].p, '9': ['001/193', 'Mirror Foil', {}] });
    expect(ids(matchJaVariants('001', [ref(), ref({ type: 'reverse', foil: 'energy' }), ref({ type: 'reverse' })], unpricedMirror))).toEqual([665672, 666088, null]);
    // Two products left: no guess.
    expect(ids(matchJaVariants('001', [ref(), ref({ type: 'reverse' })], m2a))).toEqual([665672, null]);
    // Only a plain mirror may take a leftover: a Master Ball variant never gets another pattern's price.
    expect(ids(matchJaVariants('001', [ref(), ref({ type: 'reverse', foil: 'energy' }), ref({ type: 'reverse', foil: 'masterball' })], m2a))).toEqual([665672, 666088, null]);
    // The leftover is never the base card.
    expect(ids(matchJaVariants('001', [ref({ type: 'reverse' })], file({ '665672': ['001/193', '', { normal: [0.1, 0.02, 0.15, 1] }] })))).toEqual([null]);
  });

  it('ignores a market price that is an old sale: every listing and the Cardmarket price on the other side', () => {
    // S5I-085: market $4.99, listed $275–$320, Cardmarket ≈ $104 → the card keeps its Cardmarket price.
    const s5i = file({ '569034': ['085/070', '', holo(4.99, 275, 297.5, 320)] });
    expect(ids(matchJaVariants('085', [ref({ tcgplayerId: 569034, ownCardmarket: true, cardmarketUsd: 104.63 })], s5i))).toEqual([null]);
    // The other way round: sold at $4.95, the only listings well under it, Cardmarket $0.54.
    const high = file({ '1': ['006/050', '', holo(4.95, 1.2, 1.4, 1.5)] });
    expect(ids(matchJaVariants('006', [ref({ tcgplayerId: 1, ownCardmarket: true, cardmarketUsd: 0.54 })], high))).toEqual([null]);
    // One signal alone is not enough: no Cardmarket price, or Cardmarket agreeing with the market price.
    expect(ids(matchJaVariants('085', [ref({ tcgplayerId: 569034 })], s5i))).toEqual([569034]);
    expect(ids(matchJaVariants('085', [ref({ tcgplayerId: 569034, ownCardmarket: true, cardmarketUsd: 6 })], s5i))).toEqual([569034]);
    // Listings within 3× of the market price: a normal spread, kept.
    const normal = file({ '1': ['010/100', '', holo(10, 25, 30, 40)] });
    expect(ids(matchJaVariants('010', [ref({ tcgplayerId: 1, ownCardmarket: true, cardmarketUsd: 40 })], normal))).toEqual([1]);
  });

  it('never gives one product to two variants', () => {
    const f = file({ '1': ['001/100', '', { normal: [1, 1, 1, 1] }], '2': ['001/100', 'Mirror Foil', holo(2)] });
    expect(ids(matchJaVariants('001', [ref({ tcgplayerId: 1 }), ref({ type: 'holo', tcgplayerId: 1 })], f))).toEqual([1, null]);
    // TCGdex's id of the base variant points at the mirror product (M-P-069): the mirror variant can't have it too.
    expect(ids(matchJaVariants('001', [ref({ tcgplayerId: 2 }), ref({ type: 'reverse' })], f))).toEqual([2, null]);
    const all = matchJaVariants('001', [ref(), ref({ type: 'reverse' }), ref({ type: 'reverse', foil: 'masterball' })], f);
    expect(ids(all)).toEqual([1, 2, null]);
  });

  it('searches every group of the file (PMCG1: regular + No Rarity groups)', () => {
    const pmcg = file({ '575571': ['', '', { normal: [7.04, 4.25, 6.5, 20] }] }, [
      { id: 23740, n: 'Expansion Pack (No Rarity)', c: 1, p: { '576998': ['', '', { normal: [null, 149.99, 149.99, 149.99] }], '577000': ['', '', { normal: [null, 20, 20, 20] }] } },
    ]);
    const out = matchJaVariants('001', [ref({ tcgplayerId: 575571 }), ref({ tcgplayerId: 577000 })], pmcg);
    expect(out[0]).toMatchObject({ productId: 575571, price: { market: 7.04 } });
    expect(out[1]).toMatchObject({ productId: 577000, price: { market: null, mid: 20, asking: true } });
  });

  it('survives a file with odd entries', () => {
    const odd = { v: 1, d: D, k: 'x', g: [{ id: 1, n: '', c: 1, p: { '1': null, '2': ['001/100'], '3': ['001/100', '', { normal: 'x', holofoil: [0, -1, 'a', null] }], abc: ['001/100', '', holo(1)] } }] } as unknown as JaSetFile;
    expect(matchJaVariants('001', [ref({ tcgplayerId: 1 }), ref({ tcgplayerId: 2 }), ref({ tcgplayerId: 3 })], odd)).toEqual([null, null, null]);
    expect(matchJaVariants('001', [], odd)).toEqual([]);
  });
});

describe('matchJaVariants — which price row', () => {
  const rows = (r: Record<string, number>): Record<string, JaRow> => Object.fromEntries(Object.entries(r).map(([k, m]) => [k, [m, m, m, m] as JaRow]));
  const market = (v: Partial<JaVariantRef>, r: Record<string, number>) =>
    matchJaVariants('001', [ref({ tcgplayerId: 1, ...v })], file({ '1': ['001/100', '', rows(r)] }))[0]?.price.market;
  const all = { normal: 1, holofoil: 2, '1st-edition': 3, '1st-edition-holofoil': 4, unlimited: 5, 'unlimited-holofoil': 6 };

  it('prefers the row named like the printing', () => {
    expect(market({}, all)).toBe(1);
    expect(market({ type: 'holo' }, all)).toBe(2);
    expect(market({ type: 'reverse' }, all)).toBe(2);
    expect(market({ type: 'reverse', foil: 'masterball' }, all)).toBe(2);
    expect(market({ firstEdition: true }, all)).toBe(3);
    expect(market({ type: 'holo', firstEdition: true }, all)).toBe(4);
  });

  it('1st Edition against Unlimited is the one real split', () => {
    const old = { '1st-edition': 3, unlimited: 5 };
    expect(market({}, old)).toBe(5);
    expect(market({ type: 'holo' }, old)).toBe(5);
    expect(market({ firstEdition: true }, old)).toBe(3);
    expect(market({ type: 'holo', firstEdition: true }, old)).toBe(3);
    const oldHolo = { '1st-edition-holofoil': 4, 'unlimited-holofoil': 6 };
    expect(market({ type: 'holo' }, oldHolo)).toBe(6);
    expect(market({}, oldHolo)).toBe(6);
    expect(market({ type: 'holo', firstEdition: true }, oldHolo)).toBe(4);
    expect(market({ firstEdition: true }, { unlimited: 5, normal: 1 })).toBe(5);
  });

  it('any row beats no price: the product is one printing whatever the row is called', () => {
    expect(market({}, { holofoil: 2 })).toBe(2); // M6a: every card is foil, TCGdex says "normal"
    expect(market({ type: 'holo' }, { normal: 1 })).toBe(1);
    expect(market({ type: 'holo' }, { '1st-edition-holofoil': 4 })).toBe(4); // CP2: only 1st Edition rows
    expect(market({}, { '1st-edition': 3 })).toBe(3);
    expect(market({ type: 'reverse' }, { 'reverse-holofoil': 9 })).toBe(9); // a sub-type TCGplayer might add
    expect(market({}, {})).toBeUndefined();
  });

  it('takes the Normal / Holofoil twin when the preferred row has no sales', () => {
    const price = (v: Partial<JaVariantRef>, r: Record<string, JaRow>) =>
      matchJaVariants('001', [ref({ tcgplayerId: 1, ...v })], file({ '1': ['001/100', '', r] }))[0]?.price;
    expect(price({}, { normal: [null, 1, 2, 3], holofoil: [0.5, 0.4, 0.6, 1] })).toEqual({ low: 0.4, mid: 0.6, high: 1, market: 0.5, directLow: null });
    expect(price({ type: 'holo' }, { normal: [0.3, 0.2, 0.3, 1], holofoil: [null, 0.4, 0.6, 1] })).toMatchObject({ market: 0.3 });
    // Neither sold: the preferred row's asking price.
    expect(price({}, { normal: [null, 1, 2, 3], holofoil: [null, 4, 5, 6] })).toMatchObject({ market: null, mid: 2, asking: true });
    // 1st Edition and Unlimited are different cards: no twin.
    expect(price({ firstEdition: true }, { '1st-edition': [null, 1, 2, 3], unlimited: [0.5, 0.4, 0.6, 1] })).toMatchObject({ market: null, mid: 2, asking: true });
  });
});

describe('matchJaVariants — asking prices (listings, no recent sales)', () => {
  const price = (row: JaRow, v: Partial<JaVariantRef> = {}) =>
    matchJaVariants('001', [ref({ tcgplayerId: 1, ...v })], file({ '1': ['001/100', '', { normal: row }] }))[0]?.price ?? null;

  it('keeps the Cardmarket sales price when the variant has its own (SV-P-017: $127 asked, sells for about €3)', () => {
    expect(price([null, 120, 126.68, 133.35], { ownCardmarket: true })).toBeNull();
    // With a market price, TCGplayer wins whatever Cardmarket says.
    expect(price([3, 2, 3, 4], { ownCardmarket: true })).toMatchObject({ market: 3 });
  });

  it('one listing: its price under $100, nothing from $100 up', () => {
    expect(price([null, 9.99, 9.99, 9.99])).toEqual({ low: 9.99, mid: 9.99, high: 9.99, market: null, directLow: null, asking: true });
    expect(price([null, 99.99, 99.99, 99.99])).toMatchObject({ mid: 99.99, asking: true });
    expect(price([null, 100, 100, 100])).toBeNull();
    expect(price([null, 149.99, 149.99, 149.99])).toBeNull(); // PMCG1-001 No Rarity
  });

  it('several listings: the middle one, or the cheapest when they are far apart and it is a real offer', () => {
    expect(price([null, 3.49, 4.99, 22])).toEqual({ low: 3.49, mid: 4.99, high: 22, market: null, directLow: null, asking: true }); // SV-P-127
    expect(price([null, 90, 107.5, 125])).toMatchObject({ mid: 107.5 }); // not a lone listing: $100+ is fine
    expect(price([null, 10, 31, 60])).toMatchObject({ low: 10, mid: 10, high: 60, asking: true }); // mid over 3× low
    expect(price([null, 10, 30, 60])).toMatchObject({ mid: 30 }); // exactly 3× is not "far apart"
    expect(price([null, 0.15, 0.45, 0.6])).toMatchObject({ mid: 0.45 }); // 0.15 × 3 in floating point is below 0.45
    expect(price([null, 5, 15.01, 60])).toMatchObject({ mid: 5 });
    // A cent listing next to wish prices is no offer: the middle one stays (PMCG1-086: $2 and $60).
    expect(price([null, 2, 31, 60])).toMatchObject({ mid: 31 });
    expect(price([null, 4.99, 31, 60])).toMatchObject({ mid: 31 });
  });

  it('gives nothing for a row without any usable number', () => {
    expect(price([null, null, null, null])).toBeNull();
    expect(price([null, 5, null, 9])).toBeNull();
  });
});

describe('getJaSetPrices', () => {
  const fresh = (daysOld = 0.5): JaSetFile => ({ v: 1, d: new Date(Date.now() - daysOld * 86_400_000).toISOString(), k: 'sv8a', g: [{ id: 23909, n: 'SV8a', c: 1, p: {} }] });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let fetchFn: ReturnType<typeof vi.fn>;
  const answer = (make: () => Response | Promise<Response>) => {
    fetchFn = vi.fn(async () => make());
    vi.stubGlobal('fetch', fetchFn);
  };

  beforeEach(() => {
    clearCache();
    vi.stubGlobal('location', { href: 'https://example.test/app/', origin: 'https://example.test' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads data/tcgplayer-ja/s/<key>.json under the app\'s base path and keeps it in memory', async () => {
    const body = fresh();
    answer(() => json(body));
    expect(await getJaSetPrices('SV8a')).toEqual(body);
    expect(await getJaSetPrices('sv8a')).toEqual(body);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe(`${import.meta.env.BASE_URL}data/tcgplayer-ja/s/sv8a.json`);
    await getJaSetPrices('SM1+');
    expect(String(fetchFn.mock.calls[1][0])).toBe(`${import.meta.env.BASE_URL}data/tcgplayer-ja/s/sm1p.json`);
  });

  it('gives null at once without a page address (node, tests) and never calls fetch', async () => {
    vi.unstubAllGlobals();
    answer(() => json(fresh()));
    expect(await getJaSetPrices('SV8a')).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    vi.stubGlobal('location', { href: 'https://example.test/' });
    expect(await getJaSetPrices('')).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('remembers "no file": a 404', async () => {
    answer(() => new Response('Not Found', { status: 404 }));
    expect(await getJaSetPrices('E1')).toBeNull();
    expect(await getJaSetPrices('E1')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('remembers "no file": the app\'s HTML page with status 200 (SPA hosts, vite dev)', async () => {
    answer(() => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await getJaSetPrices('SV8a')).toBeNull();
    expect(await getJaSetPrices('SV8a')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another format version', { ...fresh(), v: 2 }],
    ['no date', { v: 1, k: 'sv8a', g: [] }],
    ['no groups', { v: 1, d: new Date().toISOString(), k: 'sv8a' }],
    ['a group without products', { v: 1, d: new Date().toISOString(), k: 'sv8a', g: [{ id: 1 }] }],
    ['an array', [1, 2]],
    ['null', null],
  ])('ignores JSON of the wrong shape: %s', async (_, body) => {
    answer(() => json(body));
    expect(await getJaSetPrices('SV8a')).toBeNull();
    expect(await getJaSetPrices('SV8a')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('ignores a file older than 7 days, or with a date that is none', async () => {
    answer(() => json(fresh(7.01)));
    expect(await getJaSetPrices('SV8a')).toBeNull();
    clearCache();
    answer(() => json(fresh(6.9)));
    expect(await getJaSetPrices('SV8a')).not.toBeNull();
    clearCache();
    answer(() => json({ ...fresh(), d: 'yesterday' }));
    expect(await getJaSetPrices('SV8a')).toBeNull();
  });

  it('a file loaded while fresh stops counting once it turns 7 days old', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-12T00:00:00Z') });
    answer(() => json({ ...fresh(), d: '2026-11-05T02:00:00Z' })); // 6 days 22 hours old
    expect(await getJaSetPrices('SV8a')).not.toBeNull();
    vi.setSystemTime(new Date('2026-11-12T03:00:00Z')); // still in the 6 h memory cache
    expect(await getJaSetPrices('SV8a')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('asks again after 6 hours', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-12T00:00:00Z') });
    answer(() => json({ ...fresh(), d: '2026-11-11T20:05:27Z' }));
    await getJaSetPrices('SV8a');
    vi.setSystemTime(new Date('2026-11-12T05:59:00Z'));
    await getJaSetPrices('SV8a');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-12T06:01:00Z'));
    await getJaSetPrices('SV8a');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('a network error gives null, is not remembered and is not retried', async () => {
    fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchFn);
    expect(await getJaSetPrices('SV8a')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = fresh();
    answer(() => json(body));
    expect(await getJaSetPrices('SV8a')).toEqual(body);
  });

  it('a server error gives null, is not remembered and is not retried', async () => {
    answer(() => new Response('oops', { status: 503 }));
    expect(await getJaSetPrices('SV8a')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await getJaSetPrices('SV8a')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up after 4 seconds', async () => {
    vi.useFakeTimers();
    fetchFn = vi.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    );
    vi.stubGlobal('fetch', fetchFn);
    let settled: JaSetFile | null | undefined;
    void getJaSetPrices('SV8a').then((f) => (settled = f));
    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('shares one request between cards of the same set opened together', async () => {
    const body = fresh();
    answer(() => json(body));
    const [a, b] = await Promise.all([getJaSetPrices('SV8a'), getJaSetPrices('SV8a')]);
    expect(a).toEqual(body);
    expect(b).toEqual(body);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
