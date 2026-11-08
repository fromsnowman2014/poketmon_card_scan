import { useState } from 'react';
import { cardImage } from '../lib/tcgdex';
import type { ValueTier } from '../lib/types';
import { cx } from './cx';
import './CardImage.css';

export interface CardImageProps {
  /** TCGdex asset base (CardBrief.image), without quality/extension. */
  image?: string;
  /** Full URL tried when the TCGdex image is missing (CardDetail.imageFallback). */
  fallback?: string;
  /** The user's own photo (data URL), tried last. */
  photo?: string;
  alt: string;
  /** 'thumb' loads TCGdex low.webp (lists/grids), 'full' loads high.webp (default). */
  size?: 'thumb' | 'full';
  /** Adds a glow in the tier color. */
  tier?: ValueTier | null;
  /** Load immediately instead of lazily (above-the-fold hero image). */
  eager?: boolean;
  className?: string;
}

// 4-point sparkle with concave sides.
const sparkle = (x: number, y: number, r: number) =>
  `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;

/** Original card-back art shown while nothing else can be displayed. */
function CardBack() {
  return (
    <svg className="card-back-art" viewBox="0 0 63 88" aria-hidden="true">
      <rect x="3.5" y="3.5" width="56" height="81" rx="3.2" fill="none" stroke="#93c5fd" strokeOpacity=".4" />
      <rect x="6" y="6" width="51" height="76" rx="2" fill="none" stroke="#93c5fd" strokeOpacity=".18" strokeDasharray="1 2" />
      <circle cx="31.5" cy="44" r="13.5" fill="none" stroke="#7dd3fc" strokeOpacity=".55" />
      <circle cx="31.5" cy="44" r="18.5" fill="none" stroke="#7dd3fc" strokeOpacity=".22" />
      <path d={sparkle(31.5, 44, 9.5)} fill="#e0f2fe" />
      <path d={sparkle(45, 28, 3)} fill="#a5f3fc" fillOpacity=".85" />
      <path d={sparkle(19, 61, 2.2)} fill="#a5f3fc" fillOpacity=".6" />
      <path d={sparkle(47, 65, 1.6)} fill="#a5f3fc" fillOpacity=".5" />
    </svg>
  );
}

/**
 * Card picture with a fallback chain: TCGdex image → fallback URL → user photo → card back.
 * Always 63:88 with card-like rounded corners.
 */
export function CardImage({ image, fallback, photo, alt, size = 'full', tier, eager, className }: CardImageProps) {
  const tcgdexSrc = cardImage(image, size === 'thumb' ? 'low' : 'high');
  const sources = [tcgdexSrc, fallback, photo].filter((s): s is string => !!s);
  const chain = sources.join('\n');
  const [state, setState] = useState({ chain, index: 0, loaded: false });
  // New sources (another card or variant): start over from the best one.
  if (state.chain !== chain) setState({ chain, index: 0, loaded: false });

  const src = state.chain === chain ? sources[state.index] : sources[0];
  const loading = !!src && !state.loaded;

  return (
    <div
      className={cx('card-image', loading && 'card-image-loading', tier && `tier-${tier} card-image-glow`, className)}
      role={src ? undefined : 'img'}
      aria-label={src ? undefined : alt}
    >
      {!src && <CardBack />}
      {src && (
        <img
          key={src}
          src={src}
          // TCGdex sends CORS headers: a CORS response can be cached by the service worker for offline use
          // (opaque ones are not). The TCGplayer fallback has no CORS headers, so it loads as a plain image.
          crossOrigin={src === tcgdexSrc ? 'anonymous' : undefined}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setState((s) => ({ ...s, loaded: true }))}
          onError={() => setState((s) => ({ ...s, index: s.index + 1, loaded: false }))}
        />
      )}
    </div>
  );
}
