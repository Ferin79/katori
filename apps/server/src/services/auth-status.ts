// At startup and nightly the app runs `claude auth status` for each profile; a failure shows a
// banner on that profile (PLAN.md, Signing in on the device). Results live in memory.
import type { AuthState } from '@katori/shared';
import type { ProfileRow, Runner } from '../ai/runner.js';
import type { Config } from '../config.js';
import type { DB } from '../db/client.js';
import { profiles } from '../db/schema.js';
import type { Logger } from '../context.js';
import { readCredential } from './credentials.js';

export class AuthMonitor {
  private states = new Map<string, AuthState>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: DB,
    private cfg: Config,
    private runner: Runner,
    private log: Logger,
  ) {}

  get(profile: ProfileRow): AuthState {
    if (profile.aiAccess === 'manual') return { status: 'manual', checkedAt: null, message: 'Manual logging: no AI.' };
    // Credential files change outside the app (katori set-credential), so presence is re-read.
    const missing = this.runner.mode === 'claude' && this.cfg.ambientAuthProfile !== profile.id && !readCredential(this.cfg, profile.id);
    if (missing) return { status: 'missing_credential', checkedAt: null, message: `No credential yet. On the server run: katori set-credential ${profile.id}` };
    const s = this.states.get(profile.id);
    if (s && s.status !== 'missing_credential') return s;
    if (s) void this.check(profile); // a credential appeared since the last check
    return { status: 'unknown', checkedAt: null, message: 'Checking sign-in…' };
  }

  async check(profile: ProfileRow): Promise<AuthState> {
    if (profile.aiAccess === 'manual') {
      this.states.delete(profile.id);
      return this.get(profile);
    }
    const checkedAt = new Date().toISOString();
    let state: AuthState;
    if (this.runner.mode === 'claude' && this.cfg.ambientAuthProfile !== profile.id && !readCredential(this.cfg, profile.id)) {
      state = { status: 'missing_credential', checkedAt, message: `No credential yet. On the server run: katori set-credential ${profile.id}` };
    } else {
      try {
        const r = await this.runner.authStatus(profile);
        state = { status: r.ok ? 'ok' : 'signed_out', checkedAt, message: r.message };
      } catch (e) {
        state = { status: 'unknown', checkedAt, message: (e as Error).message };
      }
    }
    this.states.set(profile.id, state);
    if (state.status !== 'ok') this.log.warn({ profile: profile.id, status: state.status }, 'AI sign-in check failed');
    return state;
  }

  /** A job's credential was rejected: show the banner without waiting for the nightly check. */
  markSignedOut(profileId: string, message: string) {
    this.states.set(profileId, { status: 'signed_out', checkedAt: new Date().toISOString(), message });
  }

  /** A job just succeeded, so the credential works. */
  markOk(profileId: string) {
    const s = this.states.get(profileId);
    if (s?.status !== 'ok') this.states.set(profileId, { status: 'ok', checkedAt: new Date().toISOString(), message: 'Signed in' });
  }

  forget(profileId: string) {
    this.states.delete(profileId);
  }

  async checkAll(): Promise<void> {
    for (const p of this.db.select().from(profiles).all()) await this.check(p);
  }

  /** Check now, then every night at about 03:00 local time. */
  start(): void {
    void this.checkAll();
    const schedule = () => {
      const next = new Date();
      next.setHours(3, 0, 0, 0);
      if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
      this.timer = setTimeout(() => {
        void this.checkAll().finally(schedule);
      }, next.getTime() - Date.now());
      this.timer.unref();
    };
    schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
