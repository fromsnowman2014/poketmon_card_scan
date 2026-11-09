import { useMemo } from 'react';
import { CardImage } from '../../components/CardImage';
import { Icon } from '../../components/Icon';
import { TopBar } from '../../components/TopBar';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { nameInUiLang } from '../../lib/localName';
import type { CardBrief } from '../../lib/types';

const STRINGS: Strings<'title' | 'text' | 'yourPhoto' | 'foundCard' | 'yes' | 'no' | 'notHere' | 'retake'> = {
  ko: {
    title: '이 카드 맞아요?',
    text: '내 카드와 같은 카드를 눌러요',
    yourPhoto: '내 사진',
    foundCard: '찾은 카드',
    yes: '네, 맞아요!',
    no: '아니에요',
    notHere: '여기 없어요',
    retake: '다시 찍기',
  },
  en: {
    title: 'Is this your card?',
    text: 'Tap the one that matches yours',
    yourPhoto: 'Your photo',
    foundCard: 'We found',
    yes: "Yes, that's it!",
    no: "No, it's not",
    notHere: 'Not here',
    retake: 'Scan again',
  },
};

function useSubtitle(card: CardBrief): string | undefined {
  const uiLang = useUiLang();
  return useMemo(() => (card.lang === 'en' ? undefined : nameInUiLang(card.name, uiLang)), [card, uiLang]);
}

/** Card picture; newer JA sets have no pictures yet, so CardImage prints the code on the card back instead. */
function CandidateArt({ card }: { card: CardBrief }) {
  return (
    <span className="scan-cand-art">
      <CardImage image={card.image} alt={card.name} size="thumb" code={{ set: card.setId, number: card.localId }} />
    </span>
  );
}

function Candidate({ card, onPick }: { card: CardBrief; onPick: (card: CardBrief) => void }) {
  const subtitle = useSubtitle(card);
  return (
    <li>
      <button type="button" className="scan-cand" onClick={() => onPick(card)}>
        <CandidateArt card={card} />
        <span className="scan-cand-name truncate">{card.name}</span>
        {subtitle && <span className="scan-cand-sub truncate">{subtitle}</span>}
        <span className="scan-cand-set">
          {card.setName && <span className="truncate">{card.setName}</span>}
          <span className="scan-cand-num">#{card.localId}</span>
        </span>
      </button>
    </li>
  );
}

/** One candidate: the kid's photo and the card side by side, with a big yes / no. */
function CompareOne({
  photo,
  card,
  onPick,
  onNo,
}: {
  photo: string;
  card: CardBrief;
  onPick: () => void;
  onNo: () => void;
}) {
  const t = useStrings(STRINGS);
  const subtitle = useSubtitle(card);
  return (
    <>
      <div className="scan-compare pop-in">
        <figure>
          <img src={photo} alt={t('yourPhoto')} className="scan-compare-photo" />
          <figcaption>{t('yourPhoto')}</figcaption>
        </figure>
        <figure>
          <CandidateArt card={card} />
          <figcaption>{t('foundCard')}</figcaption>
        </figure>
      </div>
      <div className="center stack-4">
        <h2 className="h2">{card.name}</h2>
        {subtitle && <p className="small text-primary">{subtitle}</p>}
        <p className="caption muted">
          {card.setName && `${card.setName} · `}
          <span className="tabular">#{card.localId}</span>
        </p>
      </div>
      <div className="stack-8">
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onPick}>
          <Icon name="check" />
          {t('yes')}
        </button>
        <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={onNo}>
          {t('no')}
        </button>
      </div>
    </>
  );
}

export interface CandidatePickerProps {
  photo: string;
  candidates: CardBrief[];
  onPick: (card: CardBrief) => void;
  onNotHere: () => void;
  onRetake: () => void;
}

/** "Is this your card?": the kid's photo next to the matching card(s). */
export function CandidatePicker({ photo, candidates, onPick, onNotHere, onRetake }: CandidatePickerProps) {
  const t = useStrings(STRINGS);
  const [only] = candidates;
  return (
    <main className="screen scan-page">
      <TopBar title={t('title')} onBack={onRetake} />
      <div className="screen-pad stack-24">
        {candidates.length === 1 ? (
          <CompareOne photo={photo} card={only} onPick={() => onPick(only)} onNo={onNotHere} />
        ) : (
          <>
            <section className="surface scan-pick-head fade-in">
              <figure className="scan-pick-photo">
                <img src={photo} alt={t('yourPhoto')} />
                <figcaption>{t('yourPhoto')}</figcaption>
              </figure>
              <p className="scan-pick-text">{t('text')}</p>
            </section>
            <ul className="grid-2 scan-cands slide-up">
              {candidates.map((card) => (
                <Candidate key={`${card.lang}:${card.id}`} card={card} onPick={onPick} />
              ))}
            </ul>
            <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={onNotHere}>
              <Icon name="keyboard" />
              {t('notHere')}
            </button>
          </>
        )}
        <button type="button" className="btn btn-ghost btn-block scan-retake" onClick={onRetake}>
          <Icon name="camera" size={20} />
          {t('retake')}
        </button>
      </div>
    </main>
  );
}
