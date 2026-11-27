import { useState, useEffect, useCallback } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

declare global {
  interface Window {
    __deferredPwaPrompt?: BeforeInstallPromptEvent | null;
  }
}

// Module-level shared store so beforeinstallprompt is captured once and shared across TopBar & HomePortalView
let sharedPrompt: BeforeInstallPromptEvent | null = null;
let sharedInstalled = false;
let initialized = false;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(fn => fn());
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function initGlobalListeners() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  sharedInstalled = detectStandalone();
  if (window.__deferredPwaPrompt) {
    sharedPrompt = window.__deferredPwaPrompt;
  }

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    sharedPrompt = e as BeforeInstallPromptEvent;
    window.__deferredPwaPrompt = sharedPrompt;
    notifyListeners();
  });

  window.addEventListener('pwa-prompt-captured', () => {
    if (window.__deferredPwaPrompt) {
      sharedPrompt = window.__deferredPwaPrompt;
      notifyListeners();
    }
  });

  window.addEventListener('appinstalled', () => {
    sharedInstalled = true;
    sharedPrompt = null;
    window.__deferredPwaPrompt = null;
    notifyListeners();
  });

  const mediaQuery = window.matchMedia('(display-mode: standalone)');
  mediaQuery.addEventListener?.('change', (e: MediaQueryListEvent) => {
    if (e.matches) {
      sharedInstalled = true;
      sharedPrompt = null;
      notifyListeners();
    }
  });
}

export function usePWAInstall() {
  initGlobalListeners();

  const [, forceTick] = useState(0);

  useEffect(() => {
    const sync = () => forceTick(t => t + 1);
    listeners.add(sync);
    // Sync immediately in case index.html captured the prompt before hydration
    if (window.__deferredPwaPrompt && !sharedPrompt) {
      sharedPrompt = window.__deferredPwaPrompt;
      sync();
    }
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;

  const isInIframe = detectIframe();

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const promptEvent = sharedPrompt || window.__deferredPwaPrompt || null;
    if (!promptEvent) return 'unavailable';
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      // Chromium allows each BeforeInstallPromptEvent to be prompted only once
      sharedPrompt = null;
      window.__deferredPwaPrompt = null;
      if (choice.outcome === 'accepted') {
        sharedInstalled = true;
      }
      notifyListeners();
      return choice.outcome;
    } catch {
      sharedPrompt = null;
      window.__deferredPwaPrompt = null;
      notifyListeners();
      return 'unavailable';
    }
  }, []);

  return {
    canNativeInstall: Boolean(sharedPrompt || (typeof window !== 'undefined' && window.__deferredPwaPrompt)) && !sharedInstalled,
    isInstalled: sharedInstalled,
    isIOS,
    isInIframe,
    install,
  };
}
