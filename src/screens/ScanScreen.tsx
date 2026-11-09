import { useEffect, useRef, useState } from 'react';
import { showToast } from '../components/Toast';
import { useStrings, type Strings } from '../lib/i18n';
import {
  canvasToDataUrl,
  CODE_STRIP,
  cropRegion,
  cropToCard,
  cropTurnedCard,
  fileToBitmap,
  releaseCanvas,
  SMALL_CODE_STRIP,
  turnPicture,
  type Rect,
} from '../lib/imageProc';
import { preloadOcr } from '../lib/ocr';
import { goBack, navigate } from '../lib/router';
import { rememberScanPhoto } from '../lib/store';
import type { CardBrief, PrintedCode } from '../lib/types';
import { Analyzing } from './scan/Analyzing';
import { CameraView } from './scan/CameraView';
import { CandidatePicker } from './scan/CandidatePicker';
import { ManualEntry, type ManualReason } from './scan/ManualEntry';
import type { Size } from './scan/panZoom';
import { PhotoAdjust } from './scan/PhotoAdjust';
import { scanCard, type Look, type ScanOptions, type ScanOutcome, type Stage } from './scan/scanCard';
import './ScanScreen.css';

const STRINGS: Strings<'photoError'> = {
  ko: { photoError: '이 사진은 열 수 없어요' },
  en: { photoError: "Couldn't open that photo" },
};

/** A decoded photo; a canvas once it was turned with the Rotate button. */
type Picture = ImageBitmap | HTMLImageElement | HTMLCanvasElement;
type FrameRect = { x: number; y: number; width: number; height: number };

/** What the scan produced so far: the card photo, its enlarged number strip and the code OCR read. */
interface Shot {
  photo: string;
  strip?: string;
  code: PrintedCode;
}

type Phase =
  | { kind: 'camera' }
  | { kind: 'adjust'; file: Blob; picture: Picture; size: Size }
  | { kind: 'analyzing'; photo: string }
  | { kind: 'pick'; shot: Shot; candidates: CardBrief[] }
  | { kind: 'manual'; shot: Shot; reason: ManualReason };

// Shown on the card screen and in the picker; small enough for the in-memory scan photo store.
const PHOTO_WIDTH = 480;
const STRIP_WIDTH = 720;

function pictureSize(p: Picture): Size {
  return 'naturalWidth' in p ? { w: p.naturalWidth, h: p.naturalHeight } : { w: p.width, h: p.height };
}

function closePicture(p: Picture): void {
  // Free the decoded photo now (iOS has a tight image memory budget).
  if (p instanceof HTMLCanvasElement) releaseCanvas(p);
  else if ('close' in p) p.close();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.9),
  );
}

/** The collector line of the photo, enlarged, so the kid can read the number off it when OCR could not. */
function stripPreview(card: HTMLCanvasElement, band: Rect = CODE_STRIP): string {
  const strip = cropRegion(card, band.x, band.y, band.w, band.h);
  const url = canvasToDataUrl(strip, STRIP_WIDTH, 0.85);
  releaseCanvas(strip);
  return url;
}

/** Where the number was read; with nothing read, both bands, so the number shows whatever the card's size. */
function previewBand({ band, code }: ScanOutcome): Rect {
  if (band) return band;
  if (code.number) return CODE_STRIP;
  return { ...CODE_STRIP, y: SMALL_CODE_STRIP.y, h: 1 - SMALL_CODE_STRIP.y };
}

const cardPath = (card: CardBrief) => `/card/${card.lang}/${encodeURIComponent(card.id)}?from=scan`;

export default function ScanScreen() {
  const t = useStrings(STRINGS);
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [progress, setProgress] = useState<{ stage: Stage; value: number; look: Look }>({
    stage: 'loading',
    value: 0,
    look: 1,
  });
  // Each analysis gets a number; a result for an older one (stopped, or the screen left) is ignored.
  const run = useRef(0);

  useEffect(() => {
    void preloadOcr();
    return () => {
      run.current++;
    };
  }, []);

  const retake = () => setPhase({ kind: 'camera' });

  /** `sure`: open the only card right away; otherwise ask "Is this your card?". */
  const found = (cards: CardBrief[], shot: Shot, sure: boolean) => {
    cards.forEach((c) => rememberScanPhoto(c.id, shot.photo));
    // The camera is already off (only the camera phase runs it), so changing the route is safe now.
    if (sure && cards.length === 1) navigate(cardPath(cards[0]), { replace: true });
    else setPhase({ kind: 'pick', shot, candidates: cards });
  };

  /** `turned`: the photo path's sideways retries; `done` runs when the scan is over (frees the photo). */
  const analyze = async (card: HTMLCanvasElement, opts: Pick<ScanOptions, 'turned'> & { done?: () => void } = {}) => {
    const id = ++run.current;
    const isStale = () => id !== run.current;
    const photo = canvasToDataUrl(card, PHOTO_WIDTH, 0.8);
    setProgress({ stage: 'loading', value: 0, look: 1 });
    setPhase({ kind: 'analyzing', photo });
    const outcome = await scanCard(
      card,
      (stage, value, look) => {
        if (!isStale()) setProgress({ stage, value, look });
      },
      { isStale, turned: opts.turned },
    ).finally(opts.done);
    const { candidates, code, sure, status } = outcome;
    // A number read from the photo turned sideways: show that crop from now on.
    const read = outcome.card ?? card;
    const current = !isStale();
    const shot: Shot = {
      photo: outcome.card && current ? canvasToDataUrl(read, PHOTO_WIDTH, 0.8) : photo,
      code,
      strip: current && !sure ? stripPreview(read, previewBand(outcome)) : undefined,
    };
    releaseCanvas(card);
    if (outcome.card) releaseCanvas(outcome.card);
    if (!current) return;
    if (candidates.length) found(candidates, shot, sure);
    else setPhase({ kind: 'manual', shot, reason: status === 'unavailable' ? 'ocrUnavailable' : code.number ? 'notFound' : 'unread' });
  };

  const openPhoto = async (file: File) => {
    try {
      const picture = await fileToBitmap(file);
      setPhase({ kind: 'adjust', file, picture, size: pictureSize(picture) });
    } catch {
      showToast(t('photoError'), { icon: '🖼️' });
    }
  };

  const fromPicture = (picture: Picture, rect?: FrameRect) => {
    const card = cropToCard(picture, rect);
    // Keep the photo until the scan ends: a sideways photo is retried turned ±90°.
    void analyze(card, { turned: (q) => cropTurnedCard(picture, q, rect), done: () => closePicture(picture) });
  };

  /** Rotate button: turn the photo 90° clockwise (redrawn at most 2400 px, for iOS memory). */
  const rotating = useRef(false);
  const rotate = async (picture: Picture) => {
    if (rotating.current) return; // a second tap would turn the photo that is being closed
    rotating.current = true;
    const id = run.current;
    try {
      const turned = turnPicture(picture, 1);
      const file = await canvasToBlob(turned);
      if (id !== run.current) {
        releaseCanvas(turned); // "Use this" was tapped meanwhile: that scan owns the photo now
        return;
      }
      closePicture(picture);
      setPhase({ kind: 'adjust', file, picture: turned, size: pictureSize(turned) });
    } catch {
      showToast(t('photoError'), { icon: '🖼️' });
    } finally {
      rotating.current = false;
    }
  };

  switch (phase.kind) {
    case 'camera':
      return (
        <main className="scan">
          <CameraView
            onCapture={(card) => void analyze(card)}
            onPhoto={(file) => void openPhoto(file)}
            onLeave={(path) => (path ? navigate(path) : goBack('/'))}
          />
        </main>
      );
    case 'adjust':
      return (
        <main className="scan">
          <PhotoAdjust
            file={phase.file}
            photo={phase.size}
            onUse={(rect) => fromPicture(phase.picture, rect)}
            onSkip={() => fromPicture(phase.picture)}
            onRotate={() => void rotate(phase.picture)}
            onBack={() => {
              run.current++; // a rotation still in flight must not reopen this step
              closePicture(phase.picture);
              retake();
            }}
          />
        </main>
      );
    case 'analyzing':
      return (
        <main className="scan">
          <Analyzing
            photo={phase.photo}
            stage={progress.stage}
            progress={progress.value}
            look={progress.look}
            onStop={() => {
              run.current++;
              retake();
            }}
          />
        </main>
      );
    case 'pick':
      return (
        <CandidatePicker
          photo={phase.shot.photo}
          candidates={phase.candidates}
          onPick={(card) => navigate(cardPath(card), { replace: true })}
          onNotHere={() => setPhase({ kind: 'manual', shot: phase.shot, reason: 'notHere' })}
          onRetake={retake}
        />
      );
    case 'manual':
      return (
        <ManualEntry
          key={phase.reason}
          reason={phase.reason}
          code={phase.shot.code}
          photo={phase.shot.photo}
          strip={phase.shot.strip}
          onFound={(cards) => found(cards, phase.shot, true)}
          onRetake={retake}
          onByName={() => navigate('/search')}
        />
      );
  }
}
