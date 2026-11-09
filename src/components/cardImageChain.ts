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

export function startState(chain: string): ImageState {
  return { chain, index: 0, cors: true, loaded: false };
}

/**
 * The next thing to try after an image fails. A TCGdex image that fails as a CORS request is tried once more as a
 * plain image first: some asset files are served with a duplicated "Access-Control-Allow-Origin: *, *" header,
 * which browsers reject for CORS but which loads fine without it (it just can't be cached for offline use).
 */
export function nextAfterError(state: ImageState, isTcgdex: boolean): ImageState {
  if (isTcgdex && state.cors) return { ...state, cors: false, loaded: false };
  return { ...state, index: state.index + 1, cors: true, loaded: false };
}
