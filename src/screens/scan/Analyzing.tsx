import { Icon } from '../../components/Icon';
import { useStrings, type Strings } from '../../lib/i18n';
import { CODE_PASSES } from '../../lib/ocr';
import { GuideFrame } from './GuideFrame';
import type { Stage } from './scanCard';

const STRINGS: Strings<'loading' | 'reading' | 'again' | 'matching' | 'hint' | 'stop'> = {
  ko: {
    loading: '준비 중…',
    reading: '카드 읽는 중… ({n}/{total})',
    again: '한 번 더 자세히 볼게요…',
    matching: '카드 찾는 중…',
    hint: '아래쪽 작은 번호를 읽고 있어요',
    stop: '그만하고 다시 찍기',
  },
  en: {
    loading: 'Getting ready…',
    reading: 'Reading your card… ({n}/{total})',
    again: 'Taking a closer look…',
    matching: 'Finding your card…',
    hint: 'Reading the small number at the bottom',
    stop: 'Stop and scan again',
  },
};

/** 'reading' progress arrives as OCR passes done / PASSES. */
const PASSES = CODE_PASSES.length;

/** Where the overall bar sits for each stage: loading is short after the first scan, matching is one lookup. */
function overall(stage: Stage, progress: number): number {
  if (stage === 'loading') return 0.05 + progress * 0.1;
  if (stage === 'reading') return 0.15 + progress * 0.65;
  return 0.8 + progress * 0.2;
}

export interface AnalyzingProps {
  /** The captured card (data URL), shown frozen in the frame. */
  photo: string;
  stage: Stage;
  progress: number;
  /** 2 while taking a second look at a resampled copy (the first read was not sure). */
  look: 1 | 2;
  onStop: () => void;
}

export function Analyzing({ photo, stage, progress, look, onStop }: AnalyzingProps) {
  const t = useStrings(STRINGS);
  // Count the pass in progress, so the first one reads "1/6" rather than "0/6".
  const pass = Math.min(PASSES, Math.floor(progress * PASSES) + 1);
  const label =
    stage === 'matching'
      ? t('matching')
      : look === 2
        ? t('again')
        : stage === 'reading'
          ? t('reading', { n: pass, total: PASSES })
          : t('loading');

  return (
    <div className="scan-stage">
      <div className="scan-media scan-media-dim" />
      <div className="scan-ui">
        <header className="scan-top">
          <button type="button" className="scan-round" onClick={onStop} aria-label={t('stop')}>
            <Icon name="x" size={24} />
          </button>
          <span className="scan-top-spacer" />
        </header>

        <GuideFrame scanning>
          <img src={photo} alt="" className="scan-frozen" />
        </GuideFrame>

        <div className="scan-bottom scan-progress" role="status" aria-live="polite">
          <p className="scan-progress-label">{label}</p>
          <div className="scan-progress-track" aria-hidden="true">
            <span className="scan-progress-bar" style={{ transform: `scaleX(${overall(stage, progress)})` }} />
          </div>
          <p className="scan-hint">{t('hint')}</p>
        </div>
      </div>
    </div>
  );
}
