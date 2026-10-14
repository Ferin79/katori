import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, setUnlockToken } from '../api';
import { initials } from '../lib/format';
import { useUpdateAvailable } from '../lib/pwa';
import { useProfiles } from '../profile';
import { BodyIcon, ChartIcon, GearIcon, HomeIcon, LockIcon, PlusIcon } from './Icons';
import { Banner } from './ui';

function ProfileChips() {
  const { profiles, current, select } = useProfiles();
  const navigate = useNavigate();
  return (
    <nav className="chips-row" aria-label="Profiles" data-testid="profile-chips">
      {profiles.map((p) => (
        <button
          key={p.id}
          className="pchip"
          style={{ ['--chip-colour' as string]: p.colour }}
          aria-pressed={current?.id === p.id}
          onClick={() => select(p.id)}
          data-testid={`profile-chip-${p.id}`}
          aria-label={`Show ${p.name}'s data`}
        >
          <span className="avatar" aria-hidden>
            {initials(p.name)}
          </span>
          {p.name}
          {p.hasPin && <LockIcon width={14} height={14} />}
        </button>
      ))}
      <button className="pchip add" onClick={() => navigate('/onboarding')} data-testid="add-profile" aria-label="Add a profile">
        + Add
      </button>
    </nav>
  );
}

function PinPrompt() {
  const { current, markUnlocked } = useProfiles();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!current) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.unlock(current.id, pin);
      setUnlockToken(current.id, r.token);
      setPin('');
      markUnlocked();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? 'Wrong PIN' : 'Could not unlock');
    }
  };
  return (
    <main>
      <form className="card form" onSubmit={submit} data-testid="pin-prompt">
        <div className="row">
          <LockIcon />
          <h1>{current.name}'s profile is locked</h1>
        </div>
        <p className="muted">Enter the 4-digit PIN to see this profile on this phone.</p>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          autoComplete="off"
          aria-label="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          data-testid="pin-input"
          autoFocus
        />
        {error && <p className="delta-bad" data-testid="pin-error">{error}</p>}
        <button className="btn btn-primary" disabled={pin.length !== 4} data-testid="pin-submit">
          Unlock
        </button>
      </form>
    </main>
  );
}

function SystemBanners() {
  const { current } = useProfiles();
  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system, refetchInterval: 5 * 60_000 });
  const updated = useUpdateAvailable();
  const auth = current?.auth;
  return (
    <>
      {updated && (
        <Banner
          tone="info"
          title="Katori was updated"
          testId="update-banner"
          action={
            <button className="btn btn-sm btn-primary" onClick={() => window.location.reload()} data-testid="update-reload">
              Reload
            </button>
          }
        >
          <p>Reload to get the new version.</p>
        </Banner>
      )}
      {auth && (auth.status === 'signed_out' || auth.status === 'missing_credential') && (
        <Banner tone="error" title={auth.status === 'signed_out' ? `${current.name} is signed out of Claude` : `${current.name} has no AI sign-in yet`} testId="signin-banner">
          <p>{auth.message}</p>
          <p className="small muted">Meals still save, but new estimates fail until this is fixed; then use Retry. Settings → AI access has the steps.</p>
        </Banner>
      )}
      {system?.backup.configured && (system.backup.stale || system.backup.ok === false) && (
        <Banner tone="warn" title="Backups need attention" testId="backup-banner">
          <p>{system.backup.message}</p>
        </Banner>
      )}
    </>
  );
}

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true, testId: 'nav-home' },
  { to: '/body', label: 'Body', icon: BodyIcon, end: false, testId: 'nav-body' },
  { to: '/add', label: 'Add meal', icon: PlusIcon, end: false, testId: 'nav-add', add: true },
  { to: '/progress', label: 'Progress', icon: ChartIcon, end: false, testId: 'nav-progress' },
  { to: '/settings', label: 'Settings', icon: GearIcon, end: false, testId: 'nav-settings' },
];

export function Layout() {
  const { locked } = useProfiles();
  return (
    <div className="app">
      <header className="topbar">
        <ProfileChips />
      </header>
      {locked ? (
        <PinPrompt />
      ) : (
        <main>
          <SystemBanners />
          <Outlet />
        </main>
      )}
      <nav className="bottomnav" aria-label="Main">
        <ul>
          {NAV.map(({ to, label, icon: Icon, end, testId, add }) => (
            <li key={to}>
              <NavLink to={to} end={end} className={({ isActive }) => `${isActive ? 'active' : ''} ${add ? 'add-btn' : ''}`} data-testid={testId}>
                <span className="icon-wrap">
                  <Icon />
                </span>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
