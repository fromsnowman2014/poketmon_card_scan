import { describe, expect, it } from 'vitest';
import {
  CARD_ASPECT,
  CODE_STRIP,
  NAME_STRIP,
  cardSourceRect,
  centerCardRect,
  clipRect,
  contrastStretch,
  coverToSource,
  grayscale,
  negate,
  pad,
  shear,
  threshold,
  type Pixels,
} from './imageProc';

/** Grayscale test image from rows of gray levels. */
function gray(rows: number[][]): Pixels {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.flat().forEach((v, i) => data.set([v, v, v, 255], i * 4));
  return { data, width, height };
}

/** Gray levels (red channel) as rows. */
function levels(px: Pixels): number[][] {
  return Array.from({ length: px.height }, (_, y) => Array.from({ length: px.width }, (_, x) => px.data[(y * px.width + x) * 4]));
}

describe('pixel operations', () => {
  it('grayscale uses Rec.601 luma and forces opaque alpha', () => {
    const src: Pixels = { data: new Uint8ClampedArray([255, 0, 0, 10, 0, 255, 0, 10, 0, 0, 255, 10, 200, 200, 200, 0]), width: 4, height: 1 };
    const out = grayscale(src);
    expect(levels(out)).toEqual([[76, 150, 29, 200]]);
    expect([...out.data].filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255, 255]);
    expect(out.data[1]).toBe(out.data[0]);
    expect(out.data[2]).toBe(out.data[0]);
  });

  it('contrastStretch maps the 1st..99th percentile to 0..255', () => {
    const row = Array.from({ length: 100 }, (_, i) => 100 + i % 50); // 100..149
    const out = levels(contrastStretch(gray([row])))[0];
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBe(255);
    expect(out[25]).toBeGreaterThan(out[10]);
  });

  it('contrastStretch ignores a few outlier pixels', () => {
    const row = [0, ...Array.from({ length: 198 }, (_, i) => 100 + (i % 2) * 20), 255]; // 1 dark + 1 bright outlier
    const out = levels(contrastStretch(gray([row])))[0];
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(255);
  });

  it('contrastStretch leaves a flat image flat', () => {
    expect(levels(contrastStretch(gray([[90, 90, 90]])))).toEqual([[0, 0, 0]]);
  });

  it('threshold splits at t (inclusive white)', () => {
    expect(levels(threshold(gray([[0, 79, 80, 255]]), 80))).toEqual([[0, 0, 255, 255]]);
  });

  it('negate inverts gray levels', () => {
    expect(levels(negate(gray([[0, 100, 255]])))).toEqual([[255, 155, 0]]);
  });

  it('shear shifts lower rows right and fills with white', () => {
    const out = shear(gray([[0, 0], [0, 0], [0, 0]]), 0.5); // offsets 0, 0.5→1 (rounded), 1
    expect(out.width).toBe(2 + Math.ceil(0.5 * 3));
    expect(levels(out)).toEqual([
      [0, 0, 255, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
  });

  it('negative shear shifts upper rows right', () => {
    expect(levels(shear(gray([[0], [0]]), -1))).toEqual([[255, 255, 0], [255, 0, 255]]);
  });

  it('pad adds an opaque white border', () => {
    const out = pad(gray([[0, 10], [20, 30]]), 2);
    expect([out.width, out.height]).toEqual([6, 6]);
    const l = levels(out);
    expect(l[0]).toEqual([255, 255, 255, 255, 255, 255]);
    expect(l[2]).toEqual([255, 255, 0, 10, 255, 255]);
    expect(l[3]).toEqual([255, 255, 20, 30, 255, 255]);
    expect(out.data[3]).toBe(255);
  });

  it('does not mutate its input', () => {
    const src = gray([[10, 200]]);
    const copy = new Uint8ClampedArray(src.data);
    for (const op of [grayscale, contrastStretch, negate, (p: Pixels) => threshold(p, 100), (p: Pixels) => shear(p, 0.2), (p: Pixels) => pad(p)]) op(src);
    expect(src.data).toEqual(copy);
  });
});

describe('geometry', () => {
  it('region constants stay inside the card', () => {
    for (const r of [CODE_STRIP, NAME_STRIP]) {
      expect(r.x + r.w).toBeLessThanOrEqual(1);
      expect(r.y + r.h).toBeLessThanOrEqual(1);
    }
  });

  it('coverToSource maps a centered guide frame over portrait video to a 63:88 crop inside the frame', () => {
    const elW = 390, elH = 844, vw = 1080, vh = 1920;
    const w = elW * 0.8, h = w / CARD_ASPECT;
    const r = coverToSource({ x: (elW - w) / 2, y: (elH - h) / 2, w, h }, elW, elH, vw, vh);
    expect(r.w / r.h).toBeCloseTo(0.7159, 3);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(vw);
    expect(r.y + r.h).toBeLessThanOrEqual(vh);
    expect(r.x + r.w / 2).toBeCloseTo(vw / 2); // stays centered
    expect(r.y + r.h / 2).toBeCloseTo(vh / 2);
  });

  it('coverToSource accounts for the cropped overflow of landscape video', () => {
    // 1920x1080 video covering a 400x400 box: cover crops 420 source px off each side
    const r = coverToSource({ x: 0, y: 0, w: 400, h: 400 }, 400, 400, 1920, 1080);
    expect(r).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
  });

  it('centerCardRect fits 92% of the limiting dimension', () => {
    const tall = centerCardRect(1512, 2016); // the real test photo: height-limited
    expect(tall.h).toBeCloseTo(2016 * 0.92);
    expect(tall.w / tall.h).toBeCloseTo(CARD_ASPECT);
    expect(tall.x).toBeCloseTo((1512 - tall.w) / 2);

    const wide = centerCardRect(1920, 1080);
    expect(wide.h).toBeCloseTo(1080 * 0.92);

    const narrow = centerCardRect(600, 2000); // width-limited
    expect(narrow.w).toBeCloseTo(600 * 0.92);
    expect(narrow.w / narrow.h).toBeCloseTo(CARD_ASPECT);
  });

  it('cardSourceRect picks the mapping from its arguments', () => {
    expect(cardSourceRect(1512, 2016)).toEqual(centerCardRect(1512, 2016));
    expect(cardSourceRect(1000, 1000, { x: 10, y: 20, width: 300, height: 400 })).toEqual({ x: 10, y: 20, w: 300, h: 400 });
    const view = { x: 0, y: 100, width: 400, height: 400 };
    const frame = { x: 0, y: 100, width: 400, height: 400 };
    expect(cardSourceRect(1920, 1080, frame, view)).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
  });

  it('clipRect intersects with the source bounds', () => {
    expect(clipRect({ x: -10, y: 5, w: 50, h: 200 }, 30, 100)).toEqual({ x: 0, y: 5, w: 30, h: 95 });
    expect(clipRect({ x: 10, y: 10, w: 5, h: 5 }, 100, 100)).toEqual({ x: 10, y: 10, w: 5, h: 5 });
    expect(clipRect({ x: 200, y: 0, w: 5, h: 5 }, 100, 100)).toBeNull();
  });
});
