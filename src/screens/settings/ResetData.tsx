import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/Toast';
import { useStrings, type Strings } from '../../lib/i18n';
import { resetAllData } from '../../lib/store';

const STRINGS: Strings<'reset' | 'confirmTitle' | 'confirmText' | 'confirm' | 'cancel' | 'done'> = {
  ko: {
    reset: '모든 데이터 지우기',
    confirmTitle: '정말 모두 지울까요?',
    confirmText: '내 카드, 최근 본 카드, 설정이 모두 지워져요. 되돌릴 수 없어요.',
    confirm: '네, 모두 지울게요',
    cancel: '아니요',
    done: '모두 지웠어요',
  },
  en: {
    reset: 'Reset all data',
    confirmTitle: 'Erase everything?',
    confirmText: 'My Cards, recently viewed and settings will all be erased. This can’t be undone.',
    confirm: 'Yes, erase everything',
    cancel: 'No, keep it',
    done: 'All data erased',
  },
};

/** "Reset all data" with a confirmation sheet. `onReset` lets the screen clear its own local state. */
export function ResetData({ onReset }: { onReset: () => void }) {
  const t = useStrings(STRINGS);
  const [open, setOpen] = useState(false);

  const reset = () => {
    const done = t('done'); // read before the reset: it can switch the UI language back to the default
    resetAllData();
    setOpen(false);
    onReset();
    showToast(done, { icon: '🧹' });
  };

  return (
    <>
      <button type="button" className="btn btn-secondary btn-lg btn-block settings-danger" onClick={() => setOpen(true)}>
        <Icon name="trash" size={20} />
        {t('reset')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('confirmTitle')}>
        <div className="stack-16">
          <p className="small muted settings-text">{t('confirmText')}</p>
          <div className="stack-8">
            <button type="button" className="btn btn-lg btn-block settings-danger-solid" onClick={reset}>
              {t('confirm')}
            </button>
            <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={() => setOpen(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
