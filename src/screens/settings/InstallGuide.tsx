import { useId } from 'react';
import { Icon } from '../../components/Icon';
import { useStrings, type Strings } from '../../lib/i18n';

const STRINGS: Strings<'title' | 'installed' | 'step1' | 'step2' | 'step3'> = {
  ko: {
    title: '아이폰에 설치하기',
    installed: '이미 홈 화면에 설치됐어요 ✅',
    step1: 'Safari(사파리)로 이 앱을 열어요',
    step2: '아래쪽 공유 버튼 {share} 을 눌러요',
    step3: "'홈 화면에 추가'를 누르면 끝!",
  },
  en: {
    title: 'Install on iPhone',
    installed: 'Already on your Home Screen ✅',
    step1: 'Open this app in Safari',
    step2: 'Tap the Share button {share}',
    step3: 'Tap “Add to Home Screen”. Done!',
  },
};

/** The iOS share glyph (square with an up arrow); not part of the shared icon set. */
function ShareGlyph() {
  return (
    <svg className="settings-share" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m8 7 4-4 4 4" />
      <path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

function isInstalled(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
}

/** Safari → Share → Add to Home Screen, or a check mark when already running from the Home Screen. */
export function InstallGuide() {
  const t = useStrings(STRINGS);
  const titleId = useId();
  const [shareBefore, shareAfter = ''] = t('step2').split('{share}');

  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-heading">
        <Icon name="home" size={20} />
        {t('title')}
      </h2>
      <div className="surface">
        {isInstalled() ? (
          <p className="body">{t('installed')}</p>
        ) : (
          <ol className="settings-steps">
            <li>{t('step1')}</li>
            <li>
              {shareBefore}
              <ShareGlyph />
              {shareAfter}
            </li>
            <li>{t('step3')}</li>
          </ol>
        )}
      </div>
    </section>
  );
}
