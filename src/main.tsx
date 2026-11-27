import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register Service Worker cleanly in both production and dev (including when HMR WebSocket is disabled)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    registerSW({
      immediate: true,
      onRegisterError(error) {
        console.warn('[PWA] Service worker registration notice:', error);
      },
    });
  } catch {
    // fallback handled below
  }

  // In AI Studio dev middleware mode (HMR WS disabled), vite-plugin-pwa's HMR hook cannot fire,
  // so explicitly register the classic dev service worker at root scope to enable Chrome installability.
  if (import.meta.env.DEV) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .getRegistration('/')
        .then(existing => {
          if (!existing || existing.active?.scriptURL.includes('type=module')) {
            return navigator.serviceWorker.register('/dev-sw.js?dev-sw', {
              scope: '/',
              type: 'classic',
            });
          }
        })
        .catch(err => {
          console.warn('[PWA] Dev service worker registration skipped:', err);
        });
    });
  }
}

createRoot(document.getElementById('root')!).render(<App />);
