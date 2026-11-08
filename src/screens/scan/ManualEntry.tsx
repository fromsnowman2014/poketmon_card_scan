import { useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { TopBar } from '../../components/TopBar';
import { useStrings, type Strings } from '../../lib/i18n';
import { findByCode } from '../../lib/tcgdex';
import type { CardBrief, PrintedCode } from '../../lib/types';
import { useOnline } from '../../lib/useOnline';

type Key =
  | 'title'
  | 'unread'
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
    needMore: 'Add the set or the number after the /',
    find: 'Find this number',
    finding: 'Searching…',
    noMatch: 'No card with that number. Check it once more?',
    failed: "Oops, that didn't work. Try again?",
    retake: 'Scan again',
    byName: 'Search by name',
  },
};

export type ManualReason = 'unread' | 'notFound' | 'notHere';

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

type Status = 'idle' | 'finding' | 'noMatch' | 'failed';

/** Not read / not found / not in the picker: type the printed number instead. */
export function ManualEntry({ reason, code, photo, strip, onFound, onRetake, onByName }: ManualEntryProps) {
  const t = useStrings(STRINGS);
  const online = useOnline();
  const [setCode, setSetCode] = useState(code.setCode ?? '');
  const [number, setNumber] = useState(code.number ?? '');
  const [total, setTotal] = useState(code.total ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const read = codeText(code);
  const clean = (s: string) => s.trim().replace(/\s+/g, '');
  // A bare number matches hundreds of cards: it needs the set or the total to be found.
  const ready = !!clean(number) && (!!clean(setCode) || !!clean(total));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || status === 'finding') return;
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
  const message =
    status === 'noMatch' ? t('noMatch') : status === 'failed' ? (online ? t('failed') : t('offlineText')) : null;

  return (
    <main className="screen scan-page">
      <TopBar title={t('title')} onBack={onRetake} />
      <div className="screen-pad stack-16">
        <section className="scan-manual-head fade-in">
          {photo && <img src={photo} alt="" className="scan-manual-photo" />}
          <div className="stack-4 grow">
            <h2 className="h2">{title}</h2>
            <p className="small muted">{online ? t('text') : t('offlineText')}</p>
            {read && <p className="caption scan-read">{t('read', { code: read })}</p>}
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
                placeholder="sv8a"
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
                className="input tabular"
                value={number}
                onChange={(e) => edit(setNumber)(e.target.value)}
                placeholder="084"
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
                className="input tabular"
                value={total}
                onChange={(e) => edit(setTotal)(e.target.value)}
                placeholder="187"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="search"
              />
            </label>
          </div>
          <p className="caption muted">{clean(number) && !ready ? t('needMore') : t('optional')}</p>
          {message && (
            <p className="small scan-form-msg" role="alert">
              {message}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!ready || status === 'finding'}>
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
