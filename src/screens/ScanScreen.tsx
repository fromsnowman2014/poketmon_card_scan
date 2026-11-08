import { useEffect, useRef, useState } from 'react';
import { showToast } from '../components/Toast';
import { useStrings, type Strings } from '../lib/i18n';
import { canvasToDataUrl, CODE_STRIP, cropRegion, cropToCard, fileToBitmap, releaseCanvas } from '../lib/imageProc';
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
import { scanCard, type Stage } from './scan/scanCard';
import './ScanScreen.css';

const STRINGS: Strings<'photoError'> = {
  ko: { photoError: '이 사진은 열 수 없어요' },
  en: { photoError: "Couldn't open that photo" },
};

type Picture = ImageBitmap | HTMLImageElement;

/** What the scan produced so far: the card photo, its enlarged number strip and the code OCR read. */
interface Shot {
  photo: string;
  strip?: string;
  code: PrintedCode;
}

type Phase =
  | { kind: 'camera' }
  | { kind: 'adjust'; file: File; picture: Picture; size: Size }
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
  if ('close' in p) p.close(); // free the decoded photo now (iOS has a tight image memory budget)
}

/** The collector line of the photo, enlarged, so the kid can read the number off it when OCR could not. */
function stripPreview(card: HTMLCanvasElement): string {
  const strip = cropRegion(card, CODE_STRIP.x, CODE_STRIP.y, CODE_STRIP.w, CODE_STRIP.h);
  const url = canvasToDataUrl(strip, STRIP_WIDTH, 0.85);
  releaseCanvas(strip);
  return url;
}

const cardPath = (card: CardBrief) => `/card/${card.lang}/${encodeURIComponent(card.id)}?from=scan`;

export default function ScanScreen() {
  const t = useStrings(STRINGS);
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [progress, setProgress] = useState<{ stage: Stage; value: number; look: 1 | 2 }>({
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

  const analyze = async (card: HTMLCanvasElement) => {
    const id = ++run.current;
    const photo = canvasToDataUrl(card, PHOTO_WIDTH, 0.8);
    setProgress({ stage: 'loading', value: 0, look: 1 });
    setPhase({ kind: 'analyzing', photo });
    const { candidates, code, sure } = await scanCard(card, (stage, value, look) => {
      if (id === run.current) setProgress({ stage, value, look });
    });
    const current = id === run.current;
    const shot: Shot = { photo, code, strip: current && !sure ? stripPreview(card) : undefined };
    releaseCanvas(card);
    if (!current) return;
    if (candidates.length) found(candidates, shot, sure);
    else setPhase({ kind: 'manual', shot, reason: code.number ? 'notFound' : 'unread' });
  };

  const openPhoto = async (file: File) => {
    try {
      const picture = await fileToBitmap(file);
      setPhase({ kind: 'adjust', file, picture, size: pictureSize(picture) });
    } catch {
      showToast(t('photoError'), { icon: '🖼️' });
    }
  };

  const fromPicture = (picture: Picture, rect?: { x: number; y: number; width: number; height: number }) => {
    const card = cropToCard(picture, rect);
    closePicture(picture);
    void analyze(card);
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
            onBack={() => {
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
