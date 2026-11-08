import { forwardRef, type ReactNode } from 'react';
import { cx } from '../../components/cx';
import { useStrings, type Strings } from '../../lib/i18n';

const STRINGS: Strings<'codeHint'> = {
  ko: { codeHint: '여기 번호가 보이게' },
  en: { codeHint: 'Show this number' },
};

export interface GuideFrameProps {
  /** Shows the scanning sweep instead of the breathing corners (while the card is being read). */
  scanning?: boolean;
  children?: ReactNode;
}

/**
 * Card-shaped (63:88) window in a dimmed mask, with a highlight where the collector number sits
 * (bottom left: "sv8a 084/187"). The parent measures the frame through the ref to crop the photo.
 */
export const GuideFrame = forwardRef<HTMLDivElement, GuideFrameProps>(function GuideFrame({ scanning, children }, ref) {
  const t = useStrings(STRINGS);
  return (
    <div className="scan-frame-area">
      <div ref={ref} className={cx('scan-frame', scanning && 'scan-frame-scanning')}>
        <span className="scan-frame-inner">
          {children}
          {scanning && <span className="scan-sweep" aria-hidden="true" />}
        </span>
        <span className="scan-corner scan-corner-tl" aria-hidden="true" />
        <span className="scan-corner scan-corner-tr" aria-hidden="true" />
        <span className="scan-corner scan-corner-bl" aria-hidden="true" />
        <span className="scan-corner scan-corner-br" aria-hidden="true" />
        <span className="scan-code-zone">{!scanning && <span className="scan-code-label">{t('codeHint')}</span>}</span>
      </div>
    </div>
  );
});
