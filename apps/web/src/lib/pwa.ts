// Home-screen app support. iPhone installs through Share → Add to Home Screen (there is no install
// prompt); Chromium browsers fire beforeinstallprompt when they consider the site installable.
import { useEffect, useState, useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Running from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ----- Chromium install prompt -----

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // show our own button instead of the mini-infobar
  deferred = e as BeforeInstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export function useInstallPrompt(): (() => Promise<void>) | null {
  const available = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => deferred !== null,
  );
  if (!available) return null;
  return async () => {
    const e = deferred;
    if (!e) return;
    await e.prompt();
    await e.userChoice;
    deferred = null;
    notify();
  };
}

// ----- New version available -----
// A home-screen app has no reload button and iOS keeps it alive in the background, so on returning
// to the app we compare the bundle the server now lists with the one that is running.

function runningBundle(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src');
  return src ?? null; // null in development (Vite serves /src/main.tsx)
}

export async function checkForUpdate(): Promise<boolean> {
  const current = runningBundle();
  if (!current) return false;
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    const latest = html.match(/<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1] ?? html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
    return Boolean(latest && latest !== current);
  } catch {
    return false; // offline or server restarting: try again next time
  }
}

export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (document.visibilityState === 'visible') void checkForUpdate().then((u) => !cancelled && u && setAvailable(true));
    };
    check();
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 10 * 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, []);
  return available;
}

// ----- "Install" hint, dismissible per phone -----

const HINT_KEY = 'katori.installHint';

export function hintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

export function dismissHint(): void {
  try {
    localStorage.setItem(HINT_KEY, 'dismissed');
  } catch {
    // private mode: the hint comes back next visit
  }
}
