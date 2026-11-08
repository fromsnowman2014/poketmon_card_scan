// Pan/zoom math for lining a picked photo up with the guide frame. Pure, so it is unit-tested.
import { centerCardRect, type Rect } from '../../lib/imageProc';

/** Photo placement on the stage: source px (X, Y) is drawn at (tx + X·s, ty + Y·s) in stage CSS px. */
export interface View {
  s: number;
  tx: number;
  ty: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Zoom limits relative to the initial view. */
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 8;

/**
 * Starts where `cropToCard(photo)` without a frame would crop (the centered card guess), so "Use this"
 * without touching anything gives the same result as the no-adjustment path.
 */
export function initialView(photo: Size, frame: Rect): View {
  const card = centerCardRect(photo.w, photo.h);
  const s = frame.w / card.w;
  return { s, tx: frame.x - card.x * s, ty: frame.y - card.y * s };
}

/** Zoom by `k` around stage point (px, py), within the limits around `base` (the initial view). */
export function zoomAt(view: View, k: number, px: number, py: number, base: View): View {
  const s = Math.min(base.s * MAX_ZOOM, Math.max(base.s * MIN_ZOOM, view.s * k));
  const r = s / view.s;
  return { s, tx: px - (px - view.tx) * r, ty: py - (py - view.ty) * r };
}

/** Keeps the frame's center on the photo, so the photo can never be dragged out of reach. */
export function clampView(view: View, photo: Size, frame: Rect): View {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const clamp = (t: number, len: number, c: number) => Math.min(c, Math.max(c - len, t));
  return { s: view.s, tx: clamp(view.tx, photo.w * view.s, cx), ty: clamp(view.ty, photo.h * view.s, cy) };
}

/** The frame (stage CSS px) in photo source px, for `cropToCard(photo, rect)`. */
export function frameToSource(view: View, frame: Rect): { x: number; y: number; width: number; height: number } {
  return {
    x: (frame.x - view.tx) / view.s,
    y: (frame.y - view.ty) / view.s,
    width: frame.w / view.s,
    height: frame.h / view.s,
  };
}
