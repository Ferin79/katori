import { useState } from 'react';
import { dismissHint, hintDismissed, isIos, isStandalone, useInstallPrompt } from '../lib/pwa';
import { Card } from './ui';

/** iOS Share icon (square with an up arrow), as it appears in Safari's toolbar. */
export function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ verticalAlign: '-3px' }}>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" />
    </svg>
  );
}

export function IosSteps() {
  return (
    <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 4 }} data-testid="install-steps">
      <li>
        Tap the Share button <ShareIcon /> in Safari's toolbar.
      </li>
      <li>
        Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
      </li>
      <li>Open Katori from its icon. It runs full screen, with no Safari tab to keep open.</li>
    </ol>
  );
}

/** Shown on Home in a browser tab until installed or dismissed. */
export function InstallHint() {
  const install = useInstallPrompt();
  const [hidden, setHidden] = useState(() => isStandalone() || hintDismissed());
  if (hidden || (!isIos() && !install)) return null;
  const close = () => {
    dismissHint();
    setHidden(true);
  };
  return (
    <Card
      title="Add Katori to your Home Screen"
      testId="install-hint"
      actions={
        <button className="btn btn-ghost btn-sm" onClick={close} data-testid="install-hint-dismiss" aria-label="Dismiss">
          Not now
        </button>
      }
    >
      {install ? (
        <button className="btn btn-primary" onClick={() => void install()} data-testid="install-button">
          Install app
        </button>
      ) : (
        <IosSteps />
      )}
    </Card>
  );
}

/** Settings: install status and steps, plus a manual reload (a home-screen app has no reload button). */
export function AppCard() {
  const install = useInstallPrompt();
  const installed = isStandalone();
  return (
    <Card title="App" subtitle={installed ? 'Installed: running from the Home Screen' : 'Running in a browser tab'} testId="settings-app">
      {!installed && (isIos() ? <IosSteps /> : install ? (
        <button className="btn btn-primary" onClick={() => void install()} data-testid="install-button">
          Install app
        </button>
      ) : (
        <p className="small muted">On iPhone: Safari → Share → Add to Home Screen. In Chrome: the menu → Add to Home screen.</p>
      ))}
      <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => window.location.reload()} data-testid="app-reload">
        Reload app
      </button>
    </Card>
  );
}
