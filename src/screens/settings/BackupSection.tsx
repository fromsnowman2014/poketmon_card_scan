import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/Toast';
import {
  backupCardCount,
  backupFile,
  decodeBackup,
  encodeBackupCode,
  MAX_BACKUP_CHARS,
  needsNewerPhone,
  type DecodedBackup,
} from '../../lib/backup';
import { fmtRelativeTime, useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { useStorageContext } from '../../lib/storageContext';
import { exportCollection, importCollection, useCollection } from '../../lib/store';
import type { CollectionItem } from '../../lib/types';
import './BackupSection.css';

type Key =
  | 'title'
  | 'intro'
  | 'introOther'
  | 'copy'
  | 'paste'
  | 'save'
  | 'load'
  | 'noCards'
  | 'copied'
  | 'holdToCopy'
  | 'pasteLabel'
  | 'pasteHint'
  | 'pasteNow'
  | 'check'
  | 'confirm'
  | 'confirm1'
  | 'keep'
  | 'madeNow'
  | 'made'
  | 'yes'
  | 'yes1'
  | 'no'
  | 'added'
  | 'added1'
  | 'merged'
  | 'mergedOnly'
  | 'mergedOnly1'
  | 'nothingNew'
  | 'addedNotSaved'
  | 'addedBlocked'
  | 'badCode'
  | 'oldPhone'
  | 'badFile';

const STRINGS: Strings<Key> = {
  ko: {
    title: '내 카드 옮기기·백업',
    intro:
      "홈 화면 앱, 사파리, 다른 앱 안에서 연 화면은 내 카드를 따로 저장해요. 옮기려면 한쪽에서 '백업 코드 복사'를 누르고, 다른 쪽에서 '백업 코드 붙여넣기'를 눌러요. 앱 아이콘을 지우기 전에도 꼭 백업해요.",
    introOther:
      "카카오톡 같은 다른 앱 안에서 연 화면은 내 카드를 따로 저장해요. 옮기려면 한쪽에서 '백업 코드 복사'를 누르고, 다른 쪽에서 '백업 코드 붙여넣기'를 눌러요. 다른 폰이나 컴퓨터로 옮길 때도 똑같이 해요.",
    copy: '백업 코드 복사',
    paste: '백업 코드 붙여넣기',
    save: '파일로 저장',
    load: '파일에서 불러오기',
    noCards: '아직 카드가 없어요',
    copied: '백업 코드를 복사했어요. 다른 쪽에서 붙여넣어요.',
    holdToCopy: '길게 눌러 복사해요',
    pasteLabel: '다른 쪽에서 복사한 백업 코드를 여기에 넣어요.',
    pasteHint: '여기를 길게 눌러 붙여넣어요',
    pasteNow: '붙여넣기',
    check: '가져오기',
    confirm: '카드 {n}장을 내 카드에 합칠까요?',
    confirm1: '카드 1장을 내 카드에 합칠까요?',
    keep: '이미 있는 카드는 그대로 둬요.',
    madeNow: '방금 만든 백업이에요.',
    made: '{when}에 만든 백업이에요.',
    yes: '네, 합칠게요',
    yes1: '네, 합칠게요',
    no: '아니요',
    added: '카드 {n}장을 가져왔어요!',
    added1: '카드 1장을 가져왔어요!',
    merged: '{m}장은 합쳤어요',
    mergedOnly: '이미 있던 카드 {m}장을 합쳤어요',
    mergedOnly1: '이미 있던 카드 1장을 합쳤어요',
    nothingNew: '새로 가져올 카드가 없어요',
    addedNotSaved: '카드를 넣었지만 아직 저장하지 못했어요. 어른에게 보여 주세요.',
    addedBlocked: '카드를 넣었지만 저장하지 못했어요. 이 폰은 저장이 막혀 있어요. 어른에게 보여 주세요.',
    badCode: '백업 코드가 아니에요. 다시 복사해 주세요.',
    oldPhone: "이 기기에서는 이런 백업 코드를 열 수 없어요. 다른 폰에서 '파일로 저장'을 누르고, 여기서 '파일에서 불러오기'를 눌러요.",
    badFile: '백업 파일이 아니에요. 다른 파일을 골라 주세요.',
  },
  en: {
    title: 'Move or back up My Cards',
    intro:
      'The Home Screen app, Safari and pages opened inside other apps keep separate My Cards. To move them, tap Copy backup code in one, then Paste backup code in the other. Always back up before removing the app icon.',
    introOther:
      'Pages opened inside other apps (like Instagram or KakaoTalk) keep their own My Cards. To move them, tap Copy backup code in one, then Paste backup code in the other. The same works for moving to another phone or computer.',
    copy: 'Copy backup code',
    paste: 'Paste backup code',
    save: 'Save as file',
    load: 'Load from file',
    noCards: 'No cards yet',
    copied: 'Backup code copied. Paste it on the other side.',
    holdToCopy: 'Press and hold to copy',
    pasteLabel: 'Put the backup code you copied on the other side here.',
    pasteHint: 'Press and hold here to paste',
    pasteNow: 'Paste',
    check: 'Import',
    confirm: 'Add {n} cards to My Cards?',
    confirm1: 'Add 1 card to My Cards?',
    keep: 'Cards you already have stay as they are.',
    madeNow: 'This backup was made just now.',
    made: 'This backup was made {when}.',
    yes: 'Yes, add them',
    yes1: 'Yes, add it',
    no: 'Not now',
    added: 'Added {n} cards!',
    added1: 'Added 1 card!',
    merged: 'Combined {m} you already had.',
    mergedOnly: 'Combined {m} cards you already had.',
    mergedOnly1: 'Combined 1 card you already had.',
    nothingNew: 'No new cards to add.',
    addedNotSaved: 'Added, but not saved yet. Show a grown‑up.',
    addedBlocked: 'Added, but not saved: saving is blocked on this phone. Show a grown‑up.',
    badCode: 'That’s not a backup code. Copy it again.',
    oldPhone: 'This phone can’t open this kind of code. On the other phone, tap Save as file, then tap Load from file here.',
    badFile: 'That’s not a backup file. Pick another one.',
  },
};

/** Glyphs for the four buttons, in the Icon style; not in the shared set. Paths adapted from Lucide (ISC). */
const GLYPHS = {
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
    </>
  ),
  paste: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 10v7" />
      <path d="m9 14 3 3 3-3" />
    </>
  ),
  save: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  load: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
} satisfies Record<string, ReactElement>;

function Glyph({ name }: { name: keyof typeof GLYPHS }) {
  return (
    <svg
      className="settings-backup-glyph"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}

const cardCount = (items: readonly CollectionItem[]) => items.reduce((n, i) => n + i.qty, 0);

/**
 * The backup code of `items`, made as soon as My Cards changes: Safari lets a page write to the clipboard only right
 * inside the tap, so a tap must not wait for the code to be compressed.
 */
function usePreparedCode(items: CollectionItem[]): string | undefined {
  const [prepared, setPrepared] = useState<{ items: CollectionItem[]; code: string }>();
  useEffect(() => {
    if (!items.length) return;
    let live = true;
    encodeBackupCode(items).then(
      (code) => {
        if (live) setPrepared({ items, code });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [items]);
  return prepared?.items === items ? prepared.code : undefined;
}

/** Puts `text` on the clipboard; false when there is no clipboard or the browser said no. Call it inside the tap. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard?.writeText !== 'function') return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const canReadClipboard = () => typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

/**
 * Phones and tablets save through the share sheet (iPhone: "Save to Files"; downloads don't work in a Home Screen
 * app). A computer downloads the file: its share sheet has no "save".
 */
async function saveFile(name: string, text: string): Promise<void> {
  const file = new File([text], name, { type: 'application/json' });
  const touch = window.matchMedia?.('(pointer: coarse)')?.matches === true;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // the share sheet was closed
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function readFile(file: File): Promise<string | null> {
  if (file.size > MAX_BACKUP_CHARS * 3) return null; // bytes (UTF-8); decodeBackup checks the length again
  try {
    return typeof file.text === 'function' ? await file.text() : await new Response(file).text();
  } catch {
    return null;
  }
}

/** The code to copy by hand when the clipboard said no: selected, so a long press offers "Copy". */
function ManualCopy({ code, label }: { code: string; label: string }) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const selectAll = () => ref.current?.setSelectionRange(0, ref.current.value.length);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.focus({ preventScroll: true });
    // Centered: focus alone can leave it behind the tab bar on a short screen.
    box.scrollIntoView({ block: 'center' });
    selectAll();
  }, [code]);
  return (
    <div className="stack-8">
      <label htmlFor={id} className="small settings-backup-hold">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        className="input settings-backup-code"
        readOnly
        rows={4}
        value={code}
        spellCheck={false}
        onFocus={selectAll}
        onClick={selectAll}
      />
    </div>
  );
}

/** "Add 12 cards to My Cards?" before anything is merged. */
function ConfirmStep({ cards, exportedAt, onYes, onNo }: { cards: number; exportedAt?: string; onYes: () => void; onNo: () => void }) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const question = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // After the sheet has focused itself (or the paste step's button went away): screen readers start at the question.
    const frame = requestAnimationFrame(() => question.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const age = exportedAt === undefined ? NaN : Date.now() - Date.parse(exportedAt);
  const made = Number.isNaN(age) ? null : age < 60_000 ? t('madeNow') : t('made', { when: fmtRelativeTime(exportedAt!, lang) });

  return (
    <div className="stack-16">
      <div className="stack-8">
        <p ref={question} tabIndex={-1} className="body settings-backup-question">
          {t(cards === 1 ? 'confirm1' : 'confirm', { n: cards })}
        </p>
        <p className="small muted settings-text">{t('keep')}</p>
        {made && <p className="caption muted">{made}</p>}
      </div>
      <div className="stack-8">
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onYes}>
          {t(cards === 1 ? 'yes1' : 'yes')}
        </button>
        <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={onNo}>
          {t('no')}
        </button>
      </div>
    </div>
  );
}

type Step =
  | { kind: 'paste' }
  | { kind: 'confirm'; from: 'code' | 'file'; backup: DecodedBackup; cards: number };

/**
 * Settings › Move or back up My Cards. iOS keeps a separate My Cards for the Home Screen app, Safari and pages opened
 * inside other apps; a backup code (or file) carries the cards from one to another. Importing only adds and merges.
 */
export function BackupSection() {
  const t = useStrings(STRINGS);
  const { ios } = useStorageContext();
  const items = useCollection();
  const prepared = usePreparedCode(items);
  const has = items.length > 0;
  const titleId = useId();
  const noneId = useId();
  const draftId = useId();
  const problemId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const draftBox = useRef<HTMLTextAreaElement>(null);

  /** The code shown for copying by hand, after the clipboard said no. */
  const [manual, setManual] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<'bad' | 'oldPhone' | 'nothing' | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = () => {
    const write = async (code: string) => {
      if (await copyText(code)) {
        setManual(null);
        showToast(t('copied'), { icon: '📋', durationMs: 4000 });
      } else {
        setManual(code);
      }
    };
    if (prepared) void write(prepared);
    else void encodeBackupCode(exportCollection()).then(write);
  };

  const save = () => {
    const { name, text } = backupFile(exportCollection());
    void saveFile(name, text);
  };

  const openPaste = () => {
    setDraft('');
    setProblem(null);
    setBusy(false);
    setStep({ kind: 'paste' });
  };

  const pasteFromClipboard = async () => {
    try {
      setDraft(await navigator.clipboard.readText());
      setProblem(null);
    } catch {
      draftBox.current?.focus(); // not allowed: pressing and holding the box still pastes
    }
  };

  const check = async () => {
    setBusy(true);
    const backup = await decodeBackup(draft);
    setBusy(false);
    const cards = backup ? backupCardCount(backup.items) : 0;
    if (!backup || !cards) {
      setProblem(backup ? 'nothing' : needsNewerPhone(draft) ? 'oldPhone' : 'bad');
      return;
    }
    // Only if the sheet is still open on this step.
    setStep((s) => (s?.kind === 'paste' ? { kind: 'confirm', from: 'code', backup, cards } : s));
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // so picking the same file again still counts
    if (!file) return;
    const text = await readFile(file);
    const backup = text === null ? null : await decodeBackup(text);
    const cards = backup ? backupCardCount(backup.items) : 0;
    if (!backup) showToast(t('badFile'), { icon: '⚠️', durationMs: 4000 });
    else if (!cards) showToast(t('nothingNew'), { icon: '✅' });
    else setStep({ kind: 'confirm', from: 'file', backup, cards });
  };

  const bringIn = () => {
    if (step?.kind !== 'confirm') return;
    const before = cardCount(exportCollection());
    const result = importCollection(step.backup.items);
    setStep(null);
    if (!result.saved) {
      // The cards show until the app is closed (and the screens say they aren't saved). App's own "couldn't save"
      // toast stays quiet for this one (importCollection), so this one, which also says the cards went in, stays up.
      showToast(t(result.problem === 'blocked' ? 'addedBlocked' : 'addedNotSaved'), { icon: '⚠️', durationMs: 5000 });
      return;
    }
    // Counted like My Cards counts (copies), so "12 cards" matches the number on the other side.
    const gained = Math.max(0, cardCount(exportCollection()) - before);
    const merged = result.updated;
    let text: string;
    if (gained > 0) text = [t(gained === 1 ? 'added1' : 'added', { n: gained }), merged > 0 ? t('merged', { m: merged }) : ''].filter(Boolean).join(' ');
    else if (merged > 0) text = t(merged === 1 ? 'mergedOnly1' : 'mergedOnly', { m: merged });
    else text = t('nothingNew');
    showToast(text, { icon: gained > 0 ? '✨' : '✅', durationMs: 4000 });
  };

  return (
    <section id="settings-backup" className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-heading">
        <Icon name="cards" size={20} />
        {t('title')}
      </h2>
      <div className="surface stack-16">
        <p className="small muted settings-text">{t(ios ? 'intro' : 'introOther')}</p>
        <div className="settings-backup-grid">
          <button
            type="button"
            className="btn btn-secondary settings-backup-btn"
            disabled={!has}
            aria-describedby={has ? undefined : noneId}
            onClick={copy}
          >
            <Glyph name="copy" />
            {t('copy')}
          </button>
          <button type="button" className="btn btn-secondary settings-backup-btn" aria-haspopup="dialog" onClick={openPaste}>
            <Glyph name="paste" />
            {t('paste')}
          </button>
          <button
            type="button"
            className="btn btn-secondary settings-backup-btn"
            disabled={!has}
            aria-describedby={has ? undefined : noneId}
            onClick={save}
          >
            <Glyph name="save" />
            {t('save')}
          </button>
          <button type="button" className="btn btn-secondary settings-backup-btn" onClick={() => fileInput.current?.click()}>
            <Glyph name="load" />
            {t('load')}
          </button>
        </div>
        {!has && (
          <p id={noneId} className="caption muted settings-backup-none">
            {t('noCards')}
          </p>
        )}
        {manual !== null && has && <ManualCopy code={manual} label={t('holdToCopy')} />}
      </div>
      <input ref={fileInput} type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => void onFile(e)} />

      <Sheet
        open={step !== null}
        onClose={() => setStep(null)}
        title={step?.kind === 'confirm' && step.from === 'file' ? t('load') : t('paste')}
      >
        {step?.kind === 'paste' && (
          <div className="stack-12">
            <label htmlFor={draftId} className="small muted settings-text">
              {t('pasteLabel')}
            </label>
            <div>
              <textarea
                id={draftId}
                ref={draftBox}
                className="input settings-backup-code"
                rows={4}
                value={draft}
                placeholder={t('pasteHint')}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={problemId}
                aria-invalid={problem === 'bad' || problem === 'oldPhone' || undefined}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setProblem(null);
                }}
              />
              {/* Always there (empty until needed) so screen readers hear what appears in it. */}
              <p id={problemId} className="small settings-backup-problem" role="status">
                {(problem === 'bad' || problem === 'oldPhone') && (
                  <>
                    <span aria-hidden="true">⚠️ </span>
                    {t(problem === 'bad' ? 'badCode' : 'oldPhone')}
                  </>
                )}
                {problem === 'nothing' && t('nothingNew')}
              </p>
            </div>
            {canReadClipboard() && (
              <button type="button" className="btn btn-secondary btn-block" onClick={() => void pasteFromClipboard()}>
                <Glyph name="paste" />
                {t('pasteNow')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              disabled={!draft.trim() || busy}
              onClick={() => void check()}
            >
              {t('check')}
            </button>
          </div>
        )}
        {step?.kind === 'confirm' && (
          <ConfirmStep cards={step.cards} exportedAt={step.backup.exportedAt} onYes={bringIn} onNo={() => setStep(null)} />
        )}
      </Sheet>
    </section>
  );
}
