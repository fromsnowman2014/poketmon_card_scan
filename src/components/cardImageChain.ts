/** Where CardImage is in its fallback chain (TCGdex image → fallback URL → user photo → card back). */
export interface ImageState {
  /** The sources this state belongs to, joined; a different chain starts over. */
  chain: string;
  /** Index of the source being shown; past the end means the card back. */
  index: number;
  /** Load the TCGdex image as a CORS request (so the service worker can cache it). */
  cors: boolean;
  loaded: boolean;
}

/** Japanese TCGdex card images ("https://assets.tcgdex.net/ja/SV/SV8a/084/high.webp"). */
const TCGDEX_JA = /^https:\/\/assets\.tcgdex\.net\/ja\//i;

export function isTcgdexJa(url: string | undefined): boolean {
  return !!url && TCGDEX_JA.test(url);
}

/**
 * Where a chain starts: its first source as a CORS request (the service worker then caches it normally), except a
 * Japanese TCGdex image. assets.tcgdex.net/ja sends "Access-Control-Allow-Origin: *" twice, which browsers reject
 * for CORS, so every one of them would fail first (a console error and a wasted round trip each, 7 on a search
 * grid): they start as plain images, which the service worker's card-images-opaque rule keeps for offline. Nothing
 * reads a card picture's pixels (My Cards thumbnails are made from the kid's own photo), so plain is enough.
 */
export function startState(chain: string, firstSrc?: string): ImageState {
  return { chain, index: 0, cors: !isTcgdexJa(firstSrc), loaded: false };
}

/**
 * The next thing to try after an image fails. A TCGdex image that fails as a CORS request is tried once more as a
 * plain image first: a few English asset files (e.g. sv03-125) have the same duplicated
 * "Access-Control-Allow-Origin: *, *" header as the Japanese ones, which loads fine without CORS (the service worker
 * then keeps an opaque copy). Any other failure, a plain one included, moves on to the next source.
 */
export function nextAfterError(state: ImageState, isTcgdex: boolean): ImageState {
  if (isTcgdex && state.cors) return { ...state, cors: false, loaded: false };
  return { ...state, index: state.index + 1, cors: true, loaded: false };
}
