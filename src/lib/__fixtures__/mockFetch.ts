// Test helper: a fetch stub routing URLs to real API responses saved in this folder (curl, 2026-11-08).
import { vi } from 'vitest';
import enBase14 from './en-base1-4.json';
import enCharizardEx from './en-list-name-charizard-ex.json';
import enSets from './en-sets-graphql.json';
import enSv035199 from './en-sv03.5-199.json';
import enSv085084 from './en-sv08.5-084.json';
import jaList187084 from './ja-list-187-084.json';
import jaHawlucha from './ja-list-name-hawlucha.json';
import jaSets from './ja-sets-graphql.json';
import jaSv8a084 from './ja-SV8a-084.json';

export const fixtures = { enBase14, enSv035199, enSv085084, jaSv8a084 };

/** What a route returns: JSON body (200), a Response as-is, or undefined for a TCGdex-style 404. */
export type Handler = (url: URL, body: string | undefined) => unknown;

const CARDS: Record<string, unknown> = {
  'ja/sv8a-084': jaSv8a084,
  'en/sv08.5-084': enSv085084,
  'en/sv03.5-199': enSv035199,
  'en/base1-4': enBase14,
};

const LISTS: Record<string, unknown> = {
  'ja?set.cardCount.official=187&localId=084': jaList187084,
  'ja?name=ルチャブル': jaHawlucha,
  'en?name=Charizard ex': enCharizardEx,
};

export const RATES = { result: 'success', base_code: 'USD', rates: { USD: 1, EUR: 0.9, KRW: 1400 } };

/** Default routes: TCGdex GraphQL sets, card details, list queries and open.er-api rates. */
export const tcgdexHandler: Handler = (url, body) => {
  if (url.host === 'open.er-api.com') return RATES;
  if (url.pathname === '/v2/graphql') return String(JSON.parse(body ?? '{}').query).includes('lang:"ja"') ? jaSets : enSets;
  const card = /^\/v2\/(en|ja)\/cards\/(.+)$/.exec(url.pathname);
  if (card) return CARDS[`${card[1]}/${decodeURIComponent(card[2]).toLowerCase()}`];
  const list = /^\/v2\/(en|ja)\/cards$/.exec(url.pathname);
  if (list) return LISTS[`${list[1]}?${[...url.searchParams].map(([k, v]) => `${k}=${v}`).join('&')}`] ?? [];
  return undefined;
};

/** Stubs global fetch with `handler` (falls back to `tcgdexHandler` when it returns undefined). */
export function mockFetch(handler: Handler = tcgdexHandler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const out = handler(url, body) ?? (handler === tcgdexHandler ? undefined : tcgdexHandler(url, body));
    if (out instanceof Response) return out;
    if (out === undefined) return new Response(JSON.stringify({ status: 404 }), { status: 404 });
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** URLs fetch was called with. */
export const calledUrls = (fn: ReturnType<typeof mockFetch>) => fn.mock.calls.map(([u]) => decodeURIComponent(String(u)));
