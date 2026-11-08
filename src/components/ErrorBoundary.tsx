import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useStrings, type Strings } from '../lib/i18n';
import { navigate } from '../lib/router';
import { EmptyState } from './EmptyState';

const STRINGS: Strings<'title' | 'text' | 'reload' | 'home'> = {
  ko: { title: '앗, 문제가 생겼어요', text: '다시 열면 대부분 괜찮아져요. 내 카드는 안전해요.', reload: '다시 열기', home: '홈으로' },
  en: { title: 'Oops, something broke', text: 'Reopening usually fixes it. Your cards are safe.', reload: 'Reopen', home: 'Go home' },
};

function CrashScreen() {
  const t = useStrings(STRINGS);
  return (
    <main className="screen screen-pad safe-top">
      <EmptyState
        emoji="😵"
        title={t('title')}
        text={t('text')}
        action={
          <>
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => location.reload()}>
              {t('reload')}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate('/', { replace: true })}>
              {t('home')}
            </button>
          </>
        }
      />
    </main>
  );
}

interface Props {
  children: ReactNode;
  /** Changing it (e.g. the route href) clears a caught error. */
  resetKey: string;
}

/** Catches render errors (including a lazy screen that failed to download) and shows a friendly screen. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}
