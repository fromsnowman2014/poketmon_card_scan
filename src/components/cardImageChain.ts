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

type SessionLike = Pick<Storage, 'getItem' | 'setItem'>;

/** sessionStorage key: Japanese TCGdex images only load without CORS in this browser. */
export const JA_PLAIN_KEY = 'cc:jaImgPlain';

/** Japanese TCGdex card images ("https://assets.tcgdex.net/ja/SV/SV8a/084/high.webp"). */
const TCGDEX_JA = /^https:\/\/assets\.tcgdex\.net\/ja\//i;

/** Remembered in memory too, for private mode / blocked storage (until the next reload). */
let jaPlainThisLoad = false;

function session(): SessionLike | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined; // Safari with blocked site data throws on access
  }
}

export function isTcgdexJa(url: string | undefined): boolean {
  return !!url && TCGDEX_JA.test(url);
}

/** True once a Japanese TCGdex image failed as a CORS request and then loaded as a plain one, this session. */
export function jaLoadsPlain(storage: SessionLike | undefined = session()): boolean {
  if (jaPlainThisLoad) return true;
  try {
    return storage?.getItem(JA_PLAIN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberJaPlain(storage: SessionLike | undefined): void {
  jaPlainThisLoad = true;
  try {
    storage?.setItem(JA_PLAIN_KEY, '1');
  } catch {
    // blocked storage: the in-memory flag still holds until reload
  }
}

/** Tests only: forget the in-memory flag. */
export function resetJaPlain(): void {
  jaPlainThisLoad = false;
}

/**
 * Where a chain starts: its first source, as a CORS request, except a Japanese TCGdex image once this session
 * learned those only load plain (then it skips the doomed CORS try and its round trip).
 */
export function startState(chain: string, firstSrc?: string, storage: SessionLike | undefined = session()): ImageState {
  return { chain, index: 0, cors: !(isTcgdexJa(firstSrc) && jaLoadsPlain(storage)), loaded: false };
}

/**
 * The next thing to try after an image fails. A TCGdex image that fails as a CORS request is tried once more as a
 * plain image first: some asset files (the Japanese ones) are served with a duplicated
 * "Access-Control-Allow-Origin: *, *" header, which browsers reject for CORS but which loads fine without it (the
 * service worker then keeps an opaque copy). Any other failure moves on to the next source.
 */
export function nextAfterError(state: ImageState, isTcgdex: boolean): ImageState {
  if (isTcgdex && state.cors) return { ...state, cors: false, loaded: false };
  return { ...state, index: state.index + 1, cors: true, loaded: false };
}

/**
 * Call when the image for `state` showed. When a Japanese TCGdex image loaded as the plain retry, the CORS failure
 * before it was the header problem (not a missing file, which fails both ways), so later Japanese images start
 * plain (startState). Other URLs keep the CORS try and its plain retry.
 */
export function noteLoaded(state: ImageState, src: string | undefined, storage: SessionLike | undefined = session()): void {
  if (!state.cors && state.index === 0 && isTcgdexJa(src)) rememberJaPlain(storage);
}
