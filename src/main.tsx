// Global CSS first so component stylesheets (imported through App) can override utilities.
import './styles/tokens.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * App updates never reload the page while a kid is using it (registerType 'prompt' in vite.config.ts):
 * - a new deploy is downloaded in the background and waits;
 * - it is applied when the app goes to the background (Home button, app switcher), so the next time the kid opens
 *   it they get the new version on the same screen (the router keeps the screen in history.state/sessionStorage);
 *   if the app is closed instead, the browser activates it on the next cold launch by itself;
 * - not while the photo picker / camera app is open (that also hides the page), or the photo would be lost;
 * - an installed app resumed from the background asks for updates at most once an hour.
 */
const CHECK_EVERY_MS = 60 * 60 * 1000;
const PICKER_GRACE_MS = 5 * 60 * 1000;

try {
  let updatePending = false;
  let registration: ServiceWorkerRegistration | undefined;
  let lastCheck = Date.now();
  let pickerOpenedAt = 0;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updatePending = true;
      applyIfHidden();
    },
    onRegisteredSW(_url, reg) {
      registration = reg;
    },
  });

  function applyIfHidden() {
    if (!updatePending || document.visibilityState !== 'hidden') return;
    if (Date.now() - pickerOpenedAt < PICKER_GRACE_MS) return;
    updatePending = false;
    void updateSW(true); // activates the waiting service worker, which reloads this (hidden) page
  }

  // Clicking a file input (photo library / camera app) sends the page to the background on some phones.
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.type === 'file') pickerOpenedAt = Date.now();
    },
    true,
  );
  document.addEventListener('change', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'file') pickerOpenedAt = 0;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      applyIfHidden();
    } else if (registration && Date.now() - lastCheck > CHECK_EVERY_MS) {
      lastCheck = Date.now();
      registration.update().catch(() => {
        // Offline: try again on a later resume.
      });
    }
  });
} catch {
  // No service worker (e.g. private browsing): the app still works online.
}
