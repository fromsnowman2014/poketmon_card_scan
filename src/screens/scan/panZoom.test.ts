import { describe, expect, it } from 'vitest';
import { centerCardRect } from '../../lib/imageProc';
import { clampView, frameToSource, initialView, zoomAt } from './panZoom';

const photo = { w: 1512, h: 2016 };
const frame = { x: 43, y: 150, w: 304, h: 304 * (88 / 63) };

describe('initialView', () => {
  it('maps the frame onto the centered card guess', () => {
    const src = frameToSource(initialView(photo, frame), frame);
    const guess = centerCardRect(photo.w, photo.h);
    expect(src.x).toBeCloseTo(guess.x);
    expect(src.y).toBeCloseTo(guess.y);
    expect(src.width).toBeCloseTo(guess.w);
    expect(src.height).toBeCloseTo(guess.h);
  });
});

describe('zoomAt', () => {
  it('keeps the zoom point fixed on screen', () => {
    const base = initialView(photo, frame);
    const v = zoomAt(base, 2, 100, 300, base);
    expect(v.s).toBeCloseTo(base.s * 2);
    // The source point under (100, 300) is the same before and after.
    expect((100 - v.tx) / v.s).toBeCloseTo((100 - base.tx) / base.s);
    expect((300 - v.ty) / v.s).toBeCloseTo((300 - base.ty) / base.s);
  });

  it('stays within the zoom limits', () => {
    const base = initialView(photo, frame);
    expect(zoomAt(base, 100, 0, 0, base).s).toBeCloseTo(base.s * 8);
    expect(zoomAt(base, 0.01, 0, 0, base).s).toBeCloseTo(base.s * 0.4);
  });

  it('zooming in shrinks the cropped area around the point', () => {
    const base = initialView(photo, frame);
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    const before = frameToSource(base, frame);
    const after = frameToSource(zoomAt(base, 2, cx, cy, base), frame);
    expect(after.width).toBeCloseTo(before.width / 2);
    expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2);
    expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2);
  });
});

describe('clampView', () => {
  it('leaves a centered photo alone', () => {
    const v = initialView(photo, frame);
    expect(clampView(v, photo, frame)).toEqual(v);
  });

  it('stops the photo from leaving the frame center', () => {
    const v = initialView(photo, frame);
    const far = clampView({ ...v, tx: 5000, ty: -5000 }, photo, frame);
    const cx = frame.x + frame.w / 2;
    const cy = frame.y + frame.h / 2;
    expect(far.tx).toBeCloseTo(cx); // photo's left edge at the frame center
    expect(far.ty + photo.h * v.s).toBeCloseTo(cy); // photo's bottom edge at the frame center
  });
});
