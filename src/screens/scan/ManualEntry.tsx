import { useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { TopBar } from '../../components/TopBar';
import { useStrings, type Strings } from '../../lib/i18n';
import { findByCode } from '../../lib/tcgdex';
import type { CardBrief, PrintedCode } from '../../lib/types';
import { useOnline } from '../../lib/useOnline';

type Key =
  | 'title'
  | 'unread'
  | 'unreadTip'
  | 'ocrUnavailable'
  | 'ocrUnavailableText'
  | 'ocrSlow'
  | 'ocrSlowText'
  | 'notFound'
  | 'notHere'
  | 'offline'
  | 'text'
  | 'offlineText'
  | 'read'
  | 'stripLabel'
  | 'codeLabel'
  | 'set'
  | 'number'
  | 'total'
  | 'optional'
  | 'setExample'
  | 'needNumber'
  | 'needMore'
  | 'find'
  | 'finding'
  | 'noMatch'
  | 'failed'
  | 'retake'
  | 'byName';

const STRINGS: Strings<Key> = {
  ko: {
    title: '번호로 찾기',
    unread: '음… 번호를 못 읽었어요 🤔',
    unreadTip: '카드를 똑바로 세워서 네모에 꽉 차게 찍으면 더 잘 읽어요.',
    ocrUnavailable: '앗, 번호 읽기 도구를 못 불러왔어요',
    ocrUnavailableText: '인터넷이 잘 될 때 다시 찍어 봐요. 지금은 아래에 번호를 직접 써 주세요.',
    ocrSlow: '번호 읽기 도구를 아직 받고 있어요',
    ocrSlowText: '인터넷이 느려요. 조금 뒤에 다시 찍어 봐요. 지금은 아래에 번호를 직접 써 주세요.',
    notFound: '음… 카드를 못 찾았어요 🤔',
    notHere: '번호를 직접 써 볼까요?',
    offline: '인터넷이 없어요',
    text: '카드 왼쪽 아래의 작은 번호를 써 주세요.',
    offlineText: '인터넷이 연결되면 다시 찾아봐요.',
    read: '읽은 번호: {code}',
    stripLabel: '내 사진의 번호 부분',
    codeLabel: '카드 아래 번호',
    set: '세트',
    number: '번호',
    total: '전체',
    optional: '세트(sv8a 같은 글자)는 없어도 돼요',
    setExample: '예: sv8a',
    needNumber: '번호를 먼저 써 주세요',
    needMore: '세트나 / 뒤의 숫자도 써 주세요',
    find: '이 번호로 찾기',
    finding: '찾는 중…',
    noMatch: '그 번호의 카드가 없어요. 한 번 더 확인해 볼까요?',
    failed: '앗, 찾지 못했어요. 다시 해 볼까요?',
    retake: '다시 찍기',
    byName: '이름으로 찾기',
  },
  en: {
    title: 'Find by number',
    unread: "Hmm, couldn't read the number 🤔",
    unreadTip: 'Tip: hold the card upright and make it fill the box.',
    ocrUnavailable: "Oops, the number reader didn't load",
    ocrUnavailableText: 'Try scanning again when the internet works. For now, type the number below.',
    ocrSlow: 'The number reader is still loading',
    ocrSlowText: 'The internet is slow. Try scanning again in a minute. For now, type the number below.',
    notFound: "Hmm, can't find that card 🤔",
    notHere: "Let's type the number",
    offline: 'No internet',
    text: 'Type the small number at the bottom left of the card.',
    offlineText: "We'll look again when you're back online.",
    read: 'We read: {code}',
    stripLabel: 'The number on your photo',
    codeLabel: 'Number on the card',
    set: 'Set',
    number: 'Number',
    total: 'Total',
    optional: 'The set (letters like sv8a) is optional',
    setExample: 'e.g. sv8a',
    needNumber: 'Type the number first',
    needMore: 'Add the set or the number after the /',
    find: 'Find this number',
    finding: 'Searching…',
    noMatch: 'No card with that number. Check it once more?',
    failed: "Oops, that didn't work. Try again?",
    retake: 'Scan again',
    byName: 'Search by name',
  },
};

/**
 * 'ocrUnavailable': the OCR engine could not load (offline first scan, CDN down). 'ocrSlow': it is still downloading
 * (slow internet) and the scan stopped waiting; it keeps loading for the next scan.
 */
export type ManualReason = 'unread' | 'notFound' | 'notHere' | 'ocrUnavailable' | 'ocrSlow';

/** "sv8a 084/187" from whatever was read; '' when nothing was. */
function codeText({ setCode, number, total }: PrintedCode): string {
  const num = number ? (total ? `${number}/${total}` : number) : total ? `?/${total}` : '';
  return [setCode, num].filter(Boolean).join(' ');
}

export interface ManualEntryProps {
  reason: ManualReason;
  /** What OCR read; pre-fills the fields so the kid only fixes the wrong part. */
  code: PrintedCode;
  photo?: string;
  /** The collector-line strip of the photo, enlarged so the kid can read the number off it. */
  strip?: string;
  onFound: (cards: CardBrief[]) => void;
  onRetake: () => void;
  onByName: () => void;
}

type Status = 'idle' | 'finding' | 'noMatch' | 'failed' | 'needNumber' | 'needMore';

/** Not read / not found / not in the picker: type the printed number instead. */
export function ManualEntry({ reason, code, photo, strip, onFound, onRetake, onByName }: ManualEntryProps) {
  const t = useStrings(STRINGS);
  const online = useOnline();
  const [setCode, setSetCode] = useState(code.setCode ?? '');
  const [number, setNumber] = useState(code.number ?? '');
  const [total, setTotal] = useState(code.total ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const numberInput = useRef<HTMLInputElement>(null);
  const totalInput = useRef<HTMLInputElement>(null);
  const read = codeText(code);
  const clean = (s: string) => s.trim().replace(/\s+/g, '');
  // A bare number matches hundreds of cards: it needs the set or the total to be found.
  const ready = !!clean(number) && (!!clean(setCode) || !!clean(total));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'finding') return;
    if (!ready) {
      // Say what is missing and put the cursor there (the button stays tappable so a tap always answers).
      const missingNumber = !clean(number);
      setStatus(missingNumber ? 'needNumber' : 'needMore');
      (missingNumber ? numberInput : totalInput).current?.focus();
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur(); // close the iOS keyboard
    setStatus('finding');
    try {
      const cards = await findByCode({
        setCode: clean(setCode) || undefined,
        number: clean(number),
        total: clean(total) || undefined,
      });
      if (cards.length) onFound(cards);
      else setStatus('noMatch');
    } catch {
      setStatus('failed');
    }
  };

  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    if (status !== 'finding') setStatus('idle');
  };

  const title = online ? t(reason) : t('offline');
  const text = !online
    ? t('offlineText')
    : reason === 'ocrUnavailable'
      ? t('ocrUnavailableText')
      : reason === 'ocrSlow'
        ? t('ocrSlowText')
        : t('text');
  const message =
    status === 'noMatch' ? t('noMatch') : status === 'failed' ? (online ? t('failed') : t('offlineText')) : null;
  const tip = status === 'needNumber' ? t('needNumber') : status === 'needMore' ? t('needMore') : null;

  return (
    <main className="screen scan-page">
      <TopBar title={t('title')} onBack={onRetake} />
      <div className="screen-pad stack-16">
        <section className="scan-manual-head fade-in">
          {photo && <img src={photo} alt="" className="scan-manual-photo" />}
          <div className="stack-4 grow">
            <h2 className="h2">{title}</h2>
            <p className="small muted">{text}</p>
            {read && <p className="caption scan-read">{t('read', { code: read })}</p>}
            {online && reason === 'unread' && <p className="caption muted">{t('unreadTip')}</p>}
          </div>
        </section>

        {strip && (
          <figure className="scan-strip slide-up">
            <img src={strip} alt={t('stripLabel')} />
            <figcaption className="caption muted">{t('stripLabel')}</figcaption>
          </figure>
        )}

        <form className="surface stack-12 scan-code-form" onSubmit={submit}>
          <span className="body" id="scan-code-label">
            {t('codeLabel')}
          </span>
          <div className="scan-code-inputs" role="group" aria-labelledby="scan-code-label">
            <label className="scan-field scan-field-set">
              <span className="caption muted">{t('set')}</span>
              <input
                className="input"
                value={setCode}
                onChange={(e) => edit(setSetCode)(e.target.value)}
                placeholder={t('setExample')}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="next"
              />
            </label>
            <label className="scan-field">
              <span className="caption muted">{t('number')}</span>
              <input
                ref={numberInput}
                className="input tabular"
                value={number}
                onChange={(e) => edit(setNumber)(e.target.value)}
                placeholder="000"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="next"
              />
            </label>
            <span className="scan-code-slash" aria-hidden="true">
              /
            </span>
            <label className="scan-field">
              <span className="caption muted">{t('total')}</span>
              <input
                ref={totalInput}
                className="input tabular"
                value={total}
                onChange={(e) => edit(setTotal)(e.target.value)}
                placeholder="000"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="search"
              />
            </label>
          </div>
          <p className="caption muted">{clean(number) && !ready && !tip ? t('needMore') : t('optional')}</p>
          {(message || tip) && (
            <p className={tip ? 'small scan-form-msg scan-form-tip' : 'small scan-form-msg'} role="alert">
              {message ?? tip}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={status === 'finding'}>
            {status === 'finding' ? (
              <span className="spinner scan-btn-spinner" aria-hidden="true" />
            ) : (
              <Icon name="search" />
            )}
            {status === 'finding' ? t('finding') : t('find')}
          </button>
        </form>

        <div className="scan-manual-actions">
          <button type="button" className="btn btn-secondary btn-lg" onClick={onRetake}>
            <Icon name="camera" />
            {t('retake')}
          </button>
          <button type="button" className="btn btn-secondary btn-lg" onClick={onByName}>
            <Icon name="search" />
            {t('byName')}
          </button>
        </div>
      </div>
    </main>
  );
}
