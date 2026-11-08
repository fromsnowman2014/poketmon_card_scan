import { lazy, Suspense, useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabBar } from './components/TabBar';
import { ToastHost } from './components/Toast';
import { useRoute, type Route } from './lib/router';
import { useSettings } from './lib/store';
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

export default function App() {
  const route = useRoute();
  useDocumentSettings(useSettings());

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
