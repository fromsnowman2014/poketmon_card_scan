import { Fragment, useRef, useState, type ReactNode } from 'react';
import { useStrings, useUiLang, type Strings } from '../lib/i18n';
import { Link } from '../lib/router';
import { inAppLabel, storageNotice, useStorageContext, type StorageCheck, type StorageNoticeKind } from '../lib/storageContext';
import { retryCollectionSave, useCollectionSaveState } from '../lib/store';
import { cx } from './cx';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { showToast } from './Toast';
import './StorageNotice.css';

type Key =
  | 'unsavedTitle'
  | 'unsavedText'
  | 'saveAgain'
  | 'savedNow'
  | 'stillUnsaved'
  | 'cantSaveTitle'
  | 'cantSaveText'
  | 'cantSaveTitleOther'
  | 'cantSaveTextOther'
  | 'inAppTitle'
  | 'inAppText'
  | 'inAppTextOther'
  | 'someApp'
  | 'testTitle'
  | 'testText'
  | 'browserTitle'
  | 'browserText'
  | 'browserLine'
  | 'install'
  | 'move'
  | 'bringText'
  | 'bringLink';

const STRINGS: Strings<Key> = {
  ko: {
    unsavedTitle: '아직 저장 안 된 카드가 있어요',
    unsavedText: "앱을 닫으면 사라져요. '다시 저장하기'를 누르거나 어른에게 보여 주세요.",
    saveAgain: '다시 저장하기',
    savedNow: '저장했어요!',
    stillUnsaved: '아직 저장하지 못했어요. 어른에게 보여 주세요.',
    cantSaveTitle: '이 폰은 지금 카드를 저장할 수 없어요',
    cantSaveText: "어른에게 보여 주세요: 설정 > 앱 > Safari > 고급에서 '모든 쿠키 차단'을 끄고, 아이폰 저장 공간이 남아 있는지 확인해 주세요.",
    cantSaveTitleOther: '지금은 카드를 저장할 수 없어요',
    cantSaveTextOther: '어른에게 보여 주세요: 브라우저 설정에서 이 사이트가 데이터를 저장하도록 허용하고, 저장 공간이 남아 있는지 확인해 주세요.',
    inAppTitle: '다른 앱 안에서 열렸어요',
    inAppText:
      "{app} 같은 앱 안에서는 카드가 저장되지 않거나 다음에 안 보일 수 있어요. 메뉴(••• 또는 공유)에서 'Safari로 열기'를 누른 뒤 홈 화면에 추가해 주세요.",
    inAppTextOther: "{app} 같은 앱 안에서는 카드가 저장되지 않거나 다음에 안 보일 수 있어요. 메뉴(⋮ 또는 •••)에서 '다른 브라우저로 열기'를 눌러 주세요.",
    someApp: '카카오톡',
    testTitle: '테스트용 주소예요',
    testText: '주소({host})가 바뀌면 내 카드가 비어 있어요. 카드는 진짜 앱에서 모아요.',
    browserTitle: '여기는 홈 화면 앱이 아니에요',
    browserText:
      '여기서 넣은 카드는 지금 연 이 브라우저에만 저장돼요. 홈 화면의 CardCheck 앱에서는 안 보여요. 비공개 탭이면 탭을 닫을 때 지워져요.',
    browserLine: '이 브라우저에만 저장돼요 · 홈 화면 앱과 따로예요',
    install: '홈 화면에 추가하는 법',
    move: '카드 옮기기',
    bringText: '사파리나 다른 앱(카카오톡 등)에서 모은 카드가 있나요? 그 카드는 거기에 그대로 있어요.',
    bringLink: '여기로 옮겨 오기',
  },
  en: {
    unsavedTitle: 'Some cards aren’t saved yet',
    unsavedText: 'They’ll be gone when the app closes. Tap “Try saving again”, or show a grown‑up.',
    saveAgain: 'Try saving again',
    savedNow: 'Saved!',
    stillUnsaved: 'Still not saved. Show a grown‑up.',
    cantSaveTitle: 'This phone can’t save cards right now',
    cantSaveText:
      'Show a grown‑up: in Settings > Apps > Safari > Advanced, turn off Block All Cookies, and make sure the iPhone has free space.',
    cantSaveTitleOther: 'Cards can’t be saved right now',
    cantSaveTextOther: 'Show a grown‑up: in the browser’s settings, let this site save data, and make sure there is free space.',
    inAppTitle: 'Opened inside another app',
    inAppText:
      'Inside apps like {app}, cards may not be kept or may not show next time. Use the menu (••• or Share) → Open in Safari, then add CardCheck to your Home Screen.',
    inAppTextOther: 'Inside apps like {app}, cards may not be kept or may not show next time. Use the menu (⋮ or •••) → Open in browser.',
    someApp: 'KakaoTalk',
    testTitle: 'This is a test address',
    testText: 'When the address ({host}) changes, My Cards starts empty. Collect cards in the real app.',
    browserTitle: 'This isn’t the Home Screen app',
    browserText:
      'Cards you add here are saved in this browser only. They won’t show in the CardCheck app on your Home Screen. In a Private tab, they’re erased when the tab closes.',
    browserLine: 'Saved in this browser only · separate from the Home Screen app',
    install: 'How to add to Home Screen',
    move: 'Move my cards',
    bringText: 'Collected cards in Safari or inside another app? They’re still there.',
    bringLink: 'Bring them here',
  },
};

/** Amber (--warn) notes: cards that aren't saved or can't be. The others are calm information. */
const WARN: ReadonlySet<StorageNoticeKind> = new Set(['unsaved', 'cant-save']);

interface Copy {
  title: string;
  text: string;
  /** What a grown-up can change, under the text. */
  fix?: string;
  /** The compact line. */
  line: string;
}

function useCopy(): (kind: StorageNoticeKind, check: StorageCheck) => Copy {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  return (kind, { ios, host, inAppName }) => {
    const cantSave = { title: t(ios ? 'cantSaveTitle' : 'cantSaveTitleOther'), text: t(ios ? 'cantSaveText' : 'cantSaveTextOther') };
    switch (kind) {
      case 'unsaved':
        // Not saved because storage is blocked or full (or Safari dropped the write): the grown-up's fix helps here too.
        return { title: t('unsavedTitle'), text: t('unsavedText'), fix: cantSave.text, line: t('unsavedTitle') };
      case 'cant-save':
        return { ...cantSave, line: cantSave.title };
      case 'in-app': {
        const app = inAppLabel({ inAppName }, lang) ?? t('someApp');
        return { title: t('inAppTitle'), text: t(ios ? 'inAppText' : 'inAppTextOther', { app }), line: t('inAppTitle') };
      }
      case 'test-address':
        return { title: t('testTitle'), text: t('testText', { host }), line: t('testTitle') };
      case 'browser':
        return { title: t('browserTitle'), text: t('browserText'), line: t('browserLine') };
    }
  };
}

/** "A · B" with each part wrapping as a whole, so a two-line compact line breaks at the dot. */
function Clauses({ text }: { text: string }) {
  const parts = text.split(' · ');
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      <span className="storage-notice-clause">{i < parts.length - 1 ? `${part} ·` : part}</span>
    </Fragment>
  ));
}

/** ⚠️ or ⓘ in front of the words: never by color alone. The emoji takes its size from the surrounding text. */
function KindIcon({ kind, size }: { kind: StorageNoticeKind; size: number }) {
  return WARN.has(kind) ? (
    <span className="storage-notice-emoji" aria-hidden="true">
      ⚠️
    </span>
  ) : (
    <Icon name="info" size={size} className="storage-notice-icon" />
  );
}

/**
 * "Try saving again" worked, so the notice changes or goes away, and the focused button with it: focus `target` if it
 * is still there, else the screen's heading. Never the page body (a screen reader would start over).
 */
export function refocusAfterSave(target?: HTMLElement | null): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const next = target?.isConnected ? target : document.querySelector<HTMLElement>('main h1, main h2');
    if (!next) return;
    if (!next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1');
    next.focus({ preventScroll: true });
  });
}

/** The buttons under a notice: try saving again, or the way to the Home Screen app and to moving cards. */
function Actions({
  kind,
  check,
  inSheet,
  onDone,
  focusAfter,
}: {
  kind: StorageNoticeKind;
  check: StorageCheck;
  inSheet: boolean;
  onDone?: () => void;
  /** Where focus goes when a save worked (the notice itself, when it stays). */
  focusAfter?: () => HTMLElement | null;
}) {
  const t = useStrings(STRINGS);
  // In the sheet a toast would sit behind it (a modal dialog is drawn above the page): say it in the sheet instead.
  const [stillFailing, setStillFailing] = useState(false);
  const button = cx('btn', inSheet ? 'btn-block' : 'storage-notice-action');

  if (kind === 'unsaved') {
    const retry = () => {
      if (retryCollectionSave()) {
        setStillFailing(false);
        showToast(t('savedNow'), { icon: '✅' });
        onDone?.();
        refocusAfterSave(focusAfter?.());
      } else if (inSheet) {
        setStillFailing(true);
      } else {
        showToast(t('stillUnsaved'), { icon: '⚠️', durationMs: 5000 });
      }
    };
    return (
      <div className={inSheet ? 'storage-notice-sheet-actions' : 'storage-notice-actions'}>
        <button type="button" className={cx(button, inSheet ? 'btn-primary' : 'btn-secondary')} onClick={retry}>
          <Icon name="refresh" size={18} />
          {t('saveAgain')}
        </button>
        {/* Under the button, so nothing moves under the finger; always there, so screen readers hear it appear. */}
        {inSheet && (
          <p className="small storage-notice-still" role="status">
            {stillFailing && (
              <>
                <span aria-hidden="true">⚠️ </span>
                {t('stillUnsaved')}
              </>
            )}
          </p>
        )}
      </div>
    );
  }
  if (kind === 'cant-save') return null;

  // Adding to the Home Screen is an iPhone/iPad thing, and only news outside the Home Screen app.
  const install = check.ios && check.kind !== 'app';
  return (
    <div className={inSheet ? 'storage-notice-sheet-actions' : 'storage-notice-actions'}>
      {install && (
        <Link to="/settings?section=install" className={cx(button, 'btn-secondary')} onClick={onDone}>
          <Icon name="home" size={18} />
          {t('install')}
        </Link>
      )}
      <Link to="/settings?section=backup" className={cx(button, 'btn-secondary')} onClick={onDone}>
        <Icon name="cards" size={18} />
        {t('move')}
      </Link>
    </div>
  );
}

function FullNotice({ kind, check, className }: { kind: StorageNoticeKind; check: StorageCheck; className?: string }) {
  const copy = useCopy()(kind, check);
  const box = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={box}
      tabIndex={-1}
      className={cx('storage-notice', WARN.has(kind) && 'storage-notice-warn', className)}
      // Only "not saved yet" turns up while the screen is open; the others are there from the start.
      role={kind === 'unsaved' ? 'status' : undefined}
    >
      <div className="storage-notice-head">
        <KindIcon kind={kind} size={22} />
        <h2 className="storage-notice-title">{copy.title}</h2>
      </div>
      <p className="storage-notice-text">{copy.text}</p>
      {copy.fix && <p className="storage-notice-fix">{copy.fix}</p>}
      <Actions kind={kind} check={check} inSheet={false} focusAfter={() => box.current} />
    </div>
  );
}

function CompactNotice({ kind, check, className }: { kind: StorageNoticeKind | null; check: StorageCheck; className?: string }) {
  const copy = useCopy();
  // The notice the sheet shows stays put while it is open, even when the line changes (saved again) or goes away.
  const [open, setOpen] = useState<StorageNoticeKind | null>(null);
  const shown = open && copy(open, check);
  const close = () => setOpen(null);

  let line: ReactNode = null;
  if (kind) {
    const button = (
      <button
        type="button"
        className={cx('storage-notice-line', WARN.has(kind) && 'storage-notice-warn', className)}
        aria-haspopup="dialog"
        onClick={() => setOpen(kind)}
      >
        <KindIcon kind={kind} size={18} />
        <span className="storage-notice-line-text">
          <Clauses text={copy(kind, check).line} />
        </span>
        <Icon name="chevron-right" size={18} className="storage-notice-chevron" />
      </button>
    );
    // Only "not saved yet" turns up while the screen is open. Always in the same wrapper, so the button stays the same
    // element when the line changes (saved again) and the closing sheet can give focus back to it.
    line = <div role={kind === 'unsaved' ? 'status' : undefined}>{button}</div>;
  }

  return (
    <>
      {line}
      {(kind || open) && (
        <Sheet
          open={!!open}
          onClose={close}
          title={
            open && shown ? (
              <span className="storage-notice-sheet-title">
                <KindIcon kind={open} size={22} />
                {shown.title}
              </span>
            ) : undefined
          }
        >
          {open && shown && (
            <div className="storage-notice-sheet">
              <p className="storage-notice-text">{shown.text}</p>
              {shown.fix && <p className="storage-notice-fix">{shown.fix}</p>}
              <Actions kind={open} check={check} inSheet onDone={close} />
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}

export interface StorageNoticeProps {
  /** `full`: the whole note with its buttons (top of My Cards). `compact`: one line that opens it in a sheet. */
  variant: 'full' | 'compact';
  /** The card page: its Add button already says "not saved yet", so that one is skipped there. */
  onCardPage?: boolean;
  className?: string;
}

/**
 * Says where My Cards is saved when that matters: cards not saved yet, storage that refuses to save, an app's
 * built-in browser, a test address, or an iPhone browser tab (not the Home Screen app). Shows the first that applies;
 * nothing in the Home Screen app when all is well.
 */
export function StorageNotice({ variant, onCardPage = false, className }: StorageNoticeProps) {
  const check = useStorageContext();
  const { saved, lastSavedAt } = useCollectionSaveState();
  const kind = storageNotice(check, saved, onCardPage, !!lastSavedAt);
  if (variant === 'compact') return <CompactNotice kind={kind} check={check} className={className} />;
  return kind ? <FullNotice kind={kind} check={check} className={className} /> : null;
}

/**
 * An empty My Cards in the iPhone/iPad Home Screen app. Cards collected in Safari or inside another app are still
 * there, in that storage area: say so, with the way to bring them over (Settings › Move or back up). Nothing anywhere
 * else: on Android and computers the installed app shares the browser's My Cards.
 */
export function BringCardsHint() {
  const t = useStrings(STRINGS);
  const { ios, kind } = useStorageContext();
  if (!ios || kind !== 'app') return null;
  return (
    <div className="storage-bring">
      <p className="small muted storage-bring-text">{t('bringText')}</p>
      <Link to="/settings?section=backup" className="btn btn-ghost storage-bring-link">
        <Icon name="cards" size={18} />
        {t('bringLink')}
      </Link>
    </div>
  );
}
