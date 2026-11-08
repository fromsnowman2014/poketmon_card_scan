import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Icon } from '../../components/Icon';
import { useStrings, type Strings } from '../../lib/i18n';
import type { Rect } from '../../lib/imageProc';
import { GuideFrame } from './GuideFrame';
import { clampView, frameToSource, initialView, zoomAt, type Size, type View } from './panZoom';

const STRINGS: Strings<'back' | 'title' | 'hint' | 'zoomIn' | 'zoomOut' | 'use' | 'skip'> = {
  ko: {
    back: '뒤로',
    title: '카드를 네모에 맞춰요',
    hint: '끌어서 옮기고, 두 손가락으로 키워요',
    zoomIn: '크게',
    zoomOut: '작게',
    use: '이걸로 찾기',
    skip: '그냥 찾기',
  },
  en: {
    back: 'Back',
    title: 'Line up the card',
    hint: 'Drag to move, pinch to zoom',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    use: 'Use this',
    skip: 'Just search',
  },
};

const BUTTON_ZOOM = 1.25;

export interface PhotoAdjustProps {
  file: Blob;
  /** Upright pixel size of the decoded photo (the crop is computed in these units). */
  photo: Size;
  /** The frame's area in photo px. */
  onUse: (rect: { x: number; y: number; width: number; height: number }) => void;
  /** Search without adjusting (centered crop). */
  onSkip: () => void;
  onBack: () => void;
}

type Point = { x: number; y: number };

/** A picked photo under the guide frame: drag to move, pinch / wheel / ± buttons to zoom. */
export function PhotoAdjust({ file, photo, onUse, onSkip, onBack }: PhotoAdjustProps) {
  const t = useStrings(STRINGS);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string>();
  const [view, setView] = useState<View>();
  const base = useRef<View>();
  const frame = useRef<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const pointers = useRef(new Map<number, Point>());

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Measure the frame (relative to the stage) and start from the centered-card view; again after rotation.
  useLayoutEffect(() => {
    const reset = () => {
      const f = frameRef.current?.getBoundingClientRect();
      const s = stageRef.current?.getBoundingClientRect();
      if (!f || !s || !f.width) return;
      frame.current = { x: f.x - s.x, y: f.y - s.y, w: f.width, h: f.height };
      base.current = initialView(photo, frame.current);
      setView(base.current);
    };
    reset();
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  }, [photo]);

  const update = useCallback(
    (fn: (v: View, b: View) => View) =>
      setView((v) => (v && base.current ? clampView(fn(v, base.current), photo, frame.current) : v)),
    [photo],
  );

  const local = (e: { clientX: number; clientY: number }): Point => {
    const s = stageRef.current?.getBoundingClientRect();
    return { x: e.clientX - (s?.x ?? 0), y: e.clientY - (s?.y ?? 0) };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const map = pointers.current;
    const before = map.get(e.pointerId);
    if (!before) return;
    const [a0, b0] = [...map.values()];
    map.set(e.pointerId, local(e));
    const [a1, b1] = [...map.values()];
    if (!b0 || !b1) {
      update((v) => ({ ...v, tx: v.tx + a1.x - a0.x, ty: v.ty + a1.y - a0.y }));
      return;
    }
    // Pinch: scale by the change in finger distance around the midpoint, and follow the midpoint.
    const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) || 1;
    const m0 = mid(a0, b0);
    const m1 = mid(a1, b1);
    update((v, b) => {
      const z = zoomAt(v, dist(a1, b1) / dist(a0, b0), m0.x, m0.y, b);
      return { ...z, tx: z.tx + m1.x - m0.x, ty: z.ty + m1.y - m0.y };
    });
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const p = local(e);
    update((v, b) => zoomAt(v, Math.exp(-e.deltaY * 0.002), p.x, p.y, b));
  };

  const zoomButton = (k: number) => {
    const f = frame.current;
    update((v, b) => zoomAt(v, k, f.x + f.w / 2, f.y + f.h / 2, b));
  };

  return (
    <div className="scan-stage">
      <div
        ref={stageRef}
        className="scan-media scan-pan"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onWheel={onWheel}
      >
        {url && view && (
          <img
            src={url}
            alt=""
            className="scan-photo"
            draggable={false}
            style={{
              width: photo.w * view.s,
              height: photo.h * view.s,
              transform: `translate3d(${view.tx}px, ${view.ty}px, 0)`,
            }}
          />
        )}
      </div>

      <div className="scan-ui">
        <header className="scan-top">
          <button type="button" className="scan-round" onClick={onBack} aria-label={t('back')}>
            <Icon name="chevron-left" size={26} />
          </button>
          <h1 className="scan-title">{t('title')}</h1>
          <span className="scan-top-spacer" />
        </header>

        <GuideFrame ref={frameRef} />

        <div className="scan-bottom">
          <p className="scan-hint">{t('hint')}</p>
          <div className="scan-adjust-row">
            <button
              type="button"
              className="scan-round"
              onClick={() => zoomButton(1 / BUTTON_ZOOM)}
              aria-label={t('zoomOut')}
            >
              <Icon name="minus" size={24} />
            </button>
            <button
              type="button"
              className="btn btn-primary btn-lg grow"
              disabled={!view}
              onClick={() => view && onUse(frameToSource(view, frame.current))}
            >
              <Icon name="search" />
              {t('use')}
            </button>
            <button
              type="button"
              className="scan-round"
              onClick={() => zoomButton(BUTTON_ZOOM)}
              aria-label={t('zoomIn')}
            >
              <Icon name="plus" size={24} />
            </button>
          </div>
          <button type="button" className="scan-text-btn" onClick={onSkip}>
            {t('skip')}
          </button>
        </div>
      </div>
    </div>
  );
}
