import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { useStrings, type Strings } from '../lib/i18n';
import { cx } from './cx';
import { Icon } from './Icon';
import './Sheet.css';

const STRINGS: Strings<'close'> = {
  ko: { close: '닫기' },
  en: { close: 'Close' },
};

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Bottom sheet built on the native modal <dialog>: focus is trapped, the page behind is inert,
 * Escape / backdrop tap / the close button all call onClose.
 */
export function Sheet({ open, onClose, title, children, className }: SheetProps) {
  const t = useStrings(STRINGS);
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', ''); // iOS < 15.4: no modal support, still visible
      // Focus the sheet itself rather than its first button: screen readers start at the title
      // and the close button doesn't open with a focus ring.
      panel.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Clicks on the dialog element itself (not its content) are backdrop taps.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <dialog
      ref={ref}
      className={cx('sheet', className)}
      aria-labelledby={title !== undefined ? titleId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={onBackdrop}
    >
      {open && (
        <div ref={panel} className="sheet-panel" tabIndex={-1}>
          <div className="sheet-grabber" aria-hidden="true" />
          <div className="sheet-head">
            {title !== undefined && (
              <h2 id={titleId} className="h2 sheet-title">
                {title}
              </h2>
            )}
            <button type="button" className="btn btn-icon sheet-close" onClick={onClose} aria-label={t('close')}>
              <Icon name="x" size={22} />
            </button>
          </div>
          <div className="sheet-body">{children}</div>
        </div>
      )}
    </dialog>
  );
}
