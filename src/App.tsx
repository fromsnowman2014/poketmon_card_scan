import { lazy, Suspense, useEffect, useRef } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabBar } from './components/TabBar';
import { showToast, ToastHost } from './components/Toast';
import { useStrings, type Strings } from './lib/i18n';
import { useRoute, type Route } from './lib/router';
import { onCollectionSaveFailed, useSettings } from './lib/store';
import type { CardLang, Settings } from './lib/types';
import CardScreen from './screens/CardScreen';
import CollectionScreen from './screens/CollectionScreen';
import HomeScreen from './screens/HomeScreen';
import SearchScreen from './screens/SearchScreen';
import SettingsScreen from './screens/SettingsScreen';

// The scan screen pulls in the OCR code; keep it out of the first download.
const loadScanScreen = () => import('./screens/ScanScreen');
const ScanScreen = lazy(loadScanScreen);

const THEME_COLORS = { dark: '#0A1020', light: '#F4F7FE' } as const;
/** Storage that stays full or blocked fails on every change: say so at most once a minute. */
const SAVE_FAILED_EVERY_MS = 60_000;

const STRINGS: Strings<'saveFailed'> = {
  ko: { saveFailed: '앗, 내 카드를 저장하지 못했어요. 어른에게 폰 저장 공간을 봐 달라고 해요.' },
  en: { saveFailed: "Oops, My Cards couldn't be saved. Ask a grown\u2011up to check the phone's storage." },
};
const CARD_LANGS: readonly string[] = ['en', 'ja', 'ko'] satisfies CardLang[];

function ScreenLoading() {
  return (
    <main className="screen center" style={{ justifyContent: 'center' }}>
      <div className="spinner" role="progressbar" aria-busy="true" />
    </main>
  );
}

function Screen({ route }: { route: Route }) {
  const [top, lang, id] = route.segments;
  switch (top) {
    case 'scan':
      return (
        <Suspense fallback={<ScreenLoading />}>
          <ScanScreen />
        </Suspense>
      );
    case 'search':
      return <SearchScreen />;
    case 'card':
      return lang && CARD_LANGS.includes(lang) && id ? (
        <CardScreen key={`${lang}/${id}`} lang={lang as CardLang} id={id} />
      ) : (
        <HomeScreen />
      );
    case 'collection':
      return <CollectionScreen />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <HomeScreen />;
  }
}

/** Mirrors settings onto <html>: data-theme (resolving 'system'), lang, and the browser theme color. */
function useDocumentSettings({ theme, uiLang }: Settings): void {
  useEffect(() => {
    document.documentElement.lang = uiLang;
  }, [uiLang]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const resolved = theme === 'system' ? (query.matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
    };
    apply();
    if (theme !== 'system') return;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);
}

/** Sets <html data-scrolled> while the page is scrolled down; the dark status-bar scrim fades in (global.css). */
function useScrolledFlag(): void {
  useEffect(() => {
    const root = document.documentElement;
    const onScroll = () => root.toggleAttribute('data-scrolled', window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
}

/** A toast when a change to My Cards could not be written (storage full or blocked); it still shows until closed. */
function useSaveFailedToast(): void {
  const t = useStrings(STRINGS);
  const last = useRef(0);
  useEffect(
    () =>
      onCollectionSaveFailed(() => {
        const now = Date.now();
        if (now - last.current < SAVE_FAILED_EVERY_MS) return;
        last.current = now;
        // After the current handler: its own toast ("내 카드에 넣었어요!") must not replace this one.
        setTimeout(() => showToast(t('saveFailed'), { icon: '⚠️', durationMs: 5000 }), 0);
      }),
    [t],
  );
}

export default function App() {
  const route = useRoute();
  useDocumentSettings(useSettings());
  useScrolledFlag();
  useSaveFailedToast();

  useEffect(() => {
    // Fetch the scan screen in the background so the camera opens instantly on first tap.
    const timer = window.setTimeout(() => void loadScanScreen().catch(() => undefined), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="app">
      <ErrorBoundary resetKey={route.href}>
        <Screen route={route} />
      </ErrorBoundary>
      <TabBar />
      <ToastHost />
    </div>
  );
}
