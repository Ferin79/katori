// Whose data the screens show. Each phone remembers its usual person, so opening the app lands
// on the right profile and switching is one tap.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProfileSummary } from '@katori/shared';
import { api, unlockToken } from './api';

const KEY = 'katori.profile';

function remembered(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

interface ProfileState {
  profiles: ProfileSummary[];
  loading: boolean;
  current: ProfileSummary | null;
  /** True when the current profile has a PIN and this phone has no valid unlock. */
  locked: boolean;
  select: (id: string) => void;
  markUnlocked: () => void;
}

const Ctx = createContext<ProfileState | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: profiles = [], isLoading } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles, refetchInterval: 20_000 });
  const [selected, setSelected] = useState<string | null>(remembered);
  const [unlockTick, setUnlockTick] = useState(0);

  const current = useMemo(() => profiles.find((p) => p.id === selected) ?? profiles[0] ?? null, [profiles, selected]);

  useEffect(() => {
    if (current && current.id !== selected) setSelected(current.id);
  }, [current, selected]);

  const select = useCallback(
    (id: string) => {
      setSelected(id);
      try {
        localStorage.setItem(KEY, id);
      } catch {
        // fine: the choice lasts this visit
      }
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'profiles' && q.queryKey[0] !== 'settings' });
    },
    [qc],
  );

  // A token that expired or was revoked (PIN changed) comes back as HTTP 423.
  useEffect(() => {
    const onLocked = () => setUnlockTick((n) => n + 1);
    window.addEventListener('katori:locked', onLocked);
    return () => window.removeEventListener('katori:locked', onLocked);
  }, []);

  const locked = useMemo(() => Boolean(current?.hasPin && !unlockToken(current.id)), [current, unlockTick]);

  const value: ProfileState = {
    profiles,
    loading: isLoading,
    current,
    locked,
    select,
    markUnlocked: () => {
      setUnlockTick((n) => n + 1);
      void qc.invalidateQueries();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfiles(): ProfileState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProfiles outside ProfileProvider');
  return v;
}

/** The current profile id; screens render only when there is one. */
export function usePid(): string {
  const { current } = useProfiles();
  if (!current) throw new Error('No current profile');
  return current.id;
}
