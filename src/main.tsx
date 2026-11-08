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

try {
  // autoUpdate: a new deploy activates on the next launch without asking.
  registerSW({ immediate: true });
} catch {
  // No service worker (e.g. private browsing): the app still works online.
}
