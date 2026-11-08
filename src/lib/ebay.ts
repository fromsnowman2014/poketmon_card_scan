// eBay: search keywords for a card, deep links (always available) and the optional worker client.
import { HttpError } from './cache';
import { localizedName, translateCardName } from './names';
import type { CardDetail, EbayListing, EbaySummary } from './types';

export type EbayCard = Pick<CardDetail, 'name' | 'lang' | 'localId' | 'setId' | 'dexIds' | 'setName' | 'setOfficialCount'>;

export interface EbayLinks {
  all: string;
  auctions: string;
  buyNow: string;
  sold: string;
}

/** eBay US "CCG Individual Cards"; Pokémon is only an attribute inside it, so keywords must be specific. */
const CATEGORY = '183454';
const TIMEOUT_MS = 10_000;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Keywords that match how sellers title the card:
 * EN "Lopunny 084/131 Prismatic Evolutions"; JA "Hawlucha sv8a 084/187 Japanese".
 * Japanese titles on eBay US are written in English, and the printed code is the most unique token.
 */
export function ebayQuery(card: EbayCard): string {
  const numbered = card.setOfficialCount ? `${card.localId}/${card.setOfficialCount}` : card.localId;
  if (card.lang === 'en') return collapse(`${card.name} ${numbered} ${card.setName}`);

  const name = translateCardName(card.name, card.dexIds, 'en') ?? localizedName(card.dexIds, 'en') ?? 'pokemon';
  // JA promos print "085/SV-P" (no set total); sellers copy that form.
  const code =
    !card.setOfficialCount && /-P$/i.test(card.setId)
      ? `${card.localId}/${card.setId.toUpperCase()}`
      : `${card.setId.toLowerCase()} ${numbered}`;
  return collapse(`${name} ${code} ${card.lang === 'ko' ? 'Korean' : 'Japanese'}`);
}

export function ebayLinks(query: string): EbayLinks {
  const all = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(collapse(query))}&_sacat=${CATEGORY}`;
  return {
    all,
    auctions: `${all}&LH_Auction=1&_sop=1`, // ending soonest
    buyNow: `${all}&LH_BIN=1&_sop=15`, // lowest price + shipping
    sold: `${all}&LH_Sold=1&LH_Complete=1&_sop=13`, // most recently sold
  };
}

/** Accepts what a parent might paste: no scheme, trailing slash, or the full ".../ebay" endpoint. */
function workerBase(workerUrl: string): string {
  const url = workerUrl.trim().replace(/\/+$/, '').replace(/\/ebay$/i, '');
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * Live eBay summary from the optional proxy worker (see /worker). 10 s timeout; aborts with `signal`.
 * Throws on network errors, non-2xx (HttpError) and malformed responses — callers fall back to `ebayLinks`.
 */
export async function fetchEbaySummary(workerUrl: string, query: string, signal?: AbortSignal): Promise<EbaySummary> {
  const url = `${workerBase(workerUrl)}/ebay?q=${encodeURIComponent(collapse(query))}`;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  const timer = setTimeout(abort, TIMEOUT_MS);
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new HttpError(res.status, url);
    return parseSummary(await res.json());
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const numOrNull = (x: unknown): number | null => (isNum(x) ? x : null);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x ? x : undefined);
// The worker URL is user-supplied, so only https links may reach an <a href>/<img src>.
const httpsUrl = (x: unknown): string | undefined => (typeof x === 'string' && /^https:\/\//i.test(x) ? x : undefined);

function parseListing(x: unknown): EbayListing | null {
  if (!isObj(x)) return null;
  const title = str(x.title);
  const url = httpsUrl(x.url);
  if (!title || !url || !isNum(x.price)) return null;
  return {
    title,
    price: x.price,
    currency: str(x.currency) ?? 'USD',
    url,
    bidCount: isNum(x.bidCount) ? x.bidCount : undefined,
    endsAt: str(x.endsAt),
    image: httpsUrl(x.image),
    shipping: numOrNull(x.shipping),
    condition: str(x.condition) ?? null,
    graded: x.graded === true,
  };
}

const parseListings = (x: unknown): EbayListing[] =>
  Array.isArray(x) ? x.map(parseListing).filter((l): l is EbayListing => l !== null) : [];

function parseSummary(x: unknown): EbaySummary {
  const searchUrl = isObj(x) ? httpsUrl(x.searchUrl) : undefined;
  if (!isObj(x) || !searchUrl || !isObj(x.auctions) || !isObj(x.buyNow) || !isNum(x.auctions.count) || !isNum(x.buyNow.count)) {
    throw new Error('Unexpected response from the eBay worker');
  }
  return {
    query: str(x.query) ?? '',
    fetchedAt: str(x.fetchedAt) ?? new Date().toISOString(),
    auctions: { count: x.auctions.count, items: parseListings(x.auctions.items) },
    buyNow: {
      count: x.buyNow.count,
      lowest: numOrNull(x.buyNow.lowest),
      median: numOrNull(x.buyNow.median),
      items: parseListings(x.buyNow.items),
    },
    searchUrl,
    soldUrl: httpsUrl(x.soldUrl),
  };
}
