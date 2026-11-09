// Image helpers for the scan pipeline. The pixel functions are pure (ImageData-shaped buffers) so they unit-test
// in Node; the canvas helpers further down need a DOM.

/** RGBA pixels, the shape of canvas `ImageData`. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A rectangle: pixels, or fractions of the card for the region constants. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What `getBoundingClientRect()` returns (only the fields used here). */
export type BoxLike = Pick<DOMRectReadOnly, 'x' | 'y' | 'width' | 'height'>;

/** Pokémon cards are 63 × 88 mm. */
export const CARD_ASPECT = 63 / 88;
/**
 * Bottom-left collector line ("G sv8a 084/187"), at ~0.944–0.966 of the card height. The band holds the whole
 * line for a card filling ~85–105% of the frame (a little off-center too); a taller band reads more of the card's
 * other text and needs more passes on well-framed cards. ocr.ts ignores text cut by the band's top/bottom edge.
 */
export const CODE_STRIP: Rect = { x: 0, y: 0.86, w: 0.55, h: 0.14 };
/** Where the collector line sits when the card is held small (~70–88% of the frame): the scan's fallback band. */
export const SMALL_CODE_STRIP: Rect = { x: 0, y: 0.78, w: 0.55, h: 0.14 };
/** Card name at the top. */
export const NAME_STRIP: Rect = { x: 0.12, y: 0.03, w: 0.63, h: 0.07 };

// ---------- pure pixel operations ----------

export function grayscale(src: Pixels): Pixels {
  const out = new Uint8ClampedArray(src.data.length);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    out[i] = out[i + 1] = out[i + 2] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    out[i + 3] = 255;
  }
  return { data: out, width: src.width, height: src.height };
}

/** Apply `f` to the gray level of a grayscale image. */
function mapGray(src: Pixels, f: (v: number) => number): Pixels {
  const out = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = out[i + 1] = out[i + 2] = f(src.data[i]);
    out[i + 3] = 255;
  }
  return { data: out, width: src.width, height: src.height };
}

/** Stretch the lo..hi percentile range of a grayscale image to 0..255 (ignores glare and deep shadow). */
export function contrastStretch(src: Pixels, lo = 0.01, hi = 0.99): Pixels {
  const hist = new Uint32Array(256);
  for (let i = 0; i < src.data.length; i += 4) hist[src.data[i]]++;
  const n = src.width * src.height;
  let dark = 0;
  for (let v = 0, acc = 0; v < 256; v++) if ((acc += hist[v]) >= n * lo) { dark = v; break; }
  let light = 255;
  for (let v = 255, acc = 0; v >= 0; v--) if ((acc += hist[v]) >= n * (1 - hi)) { light = v; break; }
  const scale = 255 / Math.max(1, light - dark);
  return mapGray(src, (v) => (v - dark) * scale);
}

/** Binarize a grayscale image: ≥ t becomes white. */
export function threshold(src: Pixels, t: number): Pixels {
  return mapGray(src, (v) => (v >= t ? 255 : 0));
}

export function negate(src: Pixels): Pixels {
  return mapGray(src, (v) => 255 - v);
}

/** Horizontal shear x' = x + k·y with white fill; k ≈ 0.2 straightens the italic collector number. */
export function shear(src: Pixels, k: number): Pixels {
  const extra = Math.ceil(Math.abs(k) * src.height);
  const w = src.width + extra;
  const out = new Uint8ClampedArray(w * src.height * 4).fill(255);
  for (let y = 0; y < src.height; y++) {
    const offset = Math.round(k >= 0 ? k * y : extra + k * y);
    out.set(src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4), (y * w + offset) * 4);
  }
  return { data: out, width: w, height: src.height };
}

/** White border: Tesseract segments text much better with a quiet zone around it. */
export function pad(src: Pixels, px = 24): Pixels {
  const w = src.width + 2 * px;
  const out = new Uint8ClampedArray(w * (src.height + 2 * px) * 4).fill(255);
  for (let y = 0; y < src.height; y++) {
    out.set(src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4), ((y + px) * w + px) * 4);
  }
  return { data: out, width: w, height: src.height + 2 * px };
}

// ---------- pure geometry ----------

/** Map a rect in an element's CSS px to source px, for media drawn with `object-fit: cover` (centered). */
export function coverToSource(frame: Rect, viewW: number, viewH: number, srcW: number, srcH: number): Rect {
  const scale = Math.max(viewW / srcW, viewH / srcH);
  const ox = (viewW - srcW * scale) / 2; // ≤ 0: the overflow that cover crops away
  const oy = (viewH - srcH * scale) / 2;
  return { x: (frame.x - ox) / scale, y: (frame.y - oy) / scale, w: frame.w / scale, h: frame.h / scale };
}

/** Centered 63:88 rect filling `fill` of the limiting dimension: where a card held up to the camera usually is. */
export function centerCardRect(srcW: number, srcH: number, fill = 0.92): Rect {
  let h = srcH * fill;
  let w = h * CARD_ASPECT;
  if (w > srcW * fill) {
    w = srcW * fill;
    h = w / CARD_ASPECT;
  }
  return { x: (srcW - w) / 2, y: (srcH - h) / 2, w, h };
}

/**
 * The card's rect in source px. `frame` + `view`: the guide frame and the media element (both from
 * getBoundingClientRect) with object-fit: cover. `frame` alone: already in source px. Neither: centered guess.
 */
export function cardSourceRect(srcW: number, srcH: number, frame?: BoxLike, view?: BoxLike): Rect {
  if (!frame) return centerCardRect(srcW, srcH);
  if (!view) return { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
  const rel = { x: frame.x - view.x, y: frame.y - view.y, w: frame.width, h: frame.height };
  return coverToSource(rel, view.width, view.height, srcW, srcH);
}

/** Intersection of `r` with the 0..w × 0..h source, or null when they don't overlap. */
export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(w, r.x + r.w);
  const y1 = Math.min(h, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Clockwise quarter turns: 1 = 90°, 2 = 180°, 3 = 270° (90° counter-clockwise). */
export type QuarterTurns = 1 | 2 | 3;

/** Where source px (x, y) lands after turning a srcW × srcH picture clockwise by `q` quarter turns. */
export function turnPoint(x: number, y: number, srcW: number, srcH: number, q: QuarterTurns): { x: number; y: number } {
  if (q === 1) return { x: srcH - y, y: x };
  if (q === 2) return { x: srcW - x, y: srcH - y };
  return { x: y, y: srcW - x };
}

/**
 * The card rect to read on the picture turned by `q` (in turned px), for a photo whose card lies sideways.
 * Without a frame, or with the untouched centered frame: the centered guess on the turned picture (the
 * "Just search" crop). With a frame the kid placed: same center, turned, with the frame's width as the card's
 * height (a sideways card fitted inside the portrait frame spans its width).
 */
export function turnedCardRect(srcW: number, srcH: number, q: QuarterTurns, frame?: BoxLike): Rect {
  const sideways = q !== 2;
  const [tw, th] = sideways ? [srcH, srcW] : [srcW, srcH];
  const guess = centerCardRect(srcW, srcH);
  const tol = guess.w * 0.02;
  const untouched =
    !frame ||
    (Math.abs(frame.x - guess.x) < tol && Math.abs(frame.y - guess.y) < tol && Math.abs(frame.width - guess.w) < tol);
  if (untouched) return centerCardRect(tw, th);
  const c = turnPoint(frame.x + frame.width / 2, frame.y + frame.height / 2, srcW, srcH, q);
  const h = sideways ? frame.width : frame.height;
  const w = h * CARD_ASPECT;
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

// ---------- canvas helpers (DOM) ----------

export type CardSource = HTMLVideoElement | HTMLImageElement | ImageBitmap | HTMLCanvasElement;

// iOS Safari silently draws nothing once its canvas memory budget runs out, and OCR works fine on ~700 px cards.
const MAX_CARD_WIDTH = 1600;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

function sourceSize(source: CardSource): { w: number; h: number } {
  if ('videoWidth' in source) return { w: source.videoWidth, h: source.videoHeight };
  if ('naturalWidth' in source) return { w: source.naturalWidth, h: source.naturalHeight };
  return { w: source.width, h: source.height };
}

/** Cut the card (63:88) out of a camera frame or photo. See `cardSourceRect` for `frame` / `view`. */
export function cropToCard(source: CardSource, frame?: BoxLike, view?: BoxLike): HTMLCanvasElement {
  const { w: srcW, h: srcH } = sourceSize(source);
  const r = cardSourceRect(srcW, srcH, frame, view);
  const scale = Math.min(1, MAX_CARD_WIDTH / r.w);
  const canvas = makeCanvas(r.w * scale, r.h * scale);
  const ctx = context2d(canvas);
  ctx.fillStyle = '#fff'; // the frame may overhang the photo edge
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  // Clip by hand: older WebKit draws nothing when the source rect leaves the image.
  const src = clipRect(r, srcW, srcH);
  if (src) {
    ctx.drawImage(source, src.x, src.y, src.w, src.h, (src.x - r.x) * scale, (src.y - r.y) * scale, src.w * scale, src.h * scale);
  }
  return canvas;
}

/** Apply the clockwise turn by `q` to a context, so drawing the srcW × srcH source at (0, 0) lands turned. */
function applyTurn(ctx: CanvasRenderingContext2D, q: QuarterTurns, srcW: number, srcH: number): void {
  if (q === 1) ctx.translate(srcH, 0);
  else if (q === 2) ctx.translate(srcW, srcH);
  else ctx.translate(0, srcW);
  ctx.rotate((q * Math.PI) / 2);
}

/** `cropToCard` on the picture turned by `q` quarter turns, for `turnedCardRect`. Output ≤ 1600 px wide. */
export function cropTurnedCard(source: CardSource, q: QuarterTurns, frame?: BoxLike): HTMLCanvasElement {
  const { w: srcW, h: srcH } = sourceSize(source);
  const r = turnedCardRect(srcW, srcH, q, frame);
  const scale = Math.min(1, MAX_CARD_WIDTH / r.w);
  const canvas = makeCanvas(r.w * scale, r.h * scale);
  const ctx = context2d(canvas);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);
  ctx.translate(-r.x, -r.y);
  applyTurn(ctx, q, srcW, srcH);
  ctx.drawImage(source, 0, 0, srcW, srcH);
  return canvas;
}

// iOS keeps decoded photos and canvases in a tight memory budget: a turned photo is redrawn at most this big.
const MAX_TURNED_SIDE = 2400;

/** The whole picture turned clockwise by `q`, long side ≤ 2400 px (the Rotate button in the photo step). */
export function turnPicture(source: CardSource, q: QuarterTurns = 1): HTMLCanvasElement {
  const { w: srcW, h: srcH } = sourceSize(source);
  const scale = Math.min(1, MAX_TURNED_SIDE / Math.max(srcW, srcH));
  const [tw, th] = q === 2 ? [srcW, srcH] : [srcH, srcW];
  const canvas = makeCanvas(tw * scale, th * scale);
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(canvas.width / tw, canvas.height / th);
  applyTurn(ctx, q, srcW, srcH);
  ctx.drawImage(source, 0, 0, srcW, srcH);
  return canvas;
}

/** Copy a region given as fractions of the canvas size (e.g. `CODE_STRIP`) at native resolution. */
export function cropRegion(canvas: HTMLCanvasElement, fx: number, fy: number, fw: number, fh: number): HTMLCanvasElement {
  const r = clipRect({ x: fx * canvas.width, y: fy * canvas.height, w: fw * canvas.width, h: fh * canvas.height }, canvas.width, canvas.height);
  if (!r) throw new Error('Crop region is outside the canvas');
  const out = makeCanvas(r.w, r.h);
  context2d(out).drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  return out;
}

/** Resample to `targetWidth` (up or down) with high-quality smoothing, keeping the aspect ratio. */
export function upscaleTo(canvas: HTMLCanvasElement, targetWidth: number): HTMLCanvasElement {
  const out = makeCanvas(targetWidth, (canvas.height * targetWidth) / canvas.width);
  const ctx = context2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

export function readPixels(canvas: HTMLCanvasElement): Pixels {
  return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

export function pixelsToCanvas(px: Pixels): HTMLCanvasElement {
  const canvas = makeCanvas(px.width, px.height);
  context2d(canvas).putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
  return canvas;
}

/** Free a temporary canvas now instead of at GC time (iOS counts canvas memory against a hard budget). */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = canvas.height = 0;
}

/** Decode a picked/captured photo upright (EXIF orientation applied). */
export async function fileToBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older Safari rejects the options bag; an <img> decodes anything the browser can display, EXIF-rotated.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** JPEG data URL scaled down to at most `maxW` px wide, for thumbnails / history. */
export function canvasToDataUrl(canvas: HTMLCanvasElement, maxW = 320, quality = 0.8): string {
  if (canvas.width <= maxW) return canvas.toDataURL('image/jpeg', quality);
  const small = upscaleTo(canvas, maxW);
  const url = small.toDataURL('image/jpeg', quality);
  releaseCanvas(small);
  return url;
}
