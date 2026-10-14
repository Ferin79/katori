import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DEFAULT_SETTINGS, HouseholdSettings } from '@katori/shared';
import type { DB } from '../db/client.js';
import { settings } from '../db/schema.js';

const HOUSEHOLD_KEY = 'household';

export function getSettings(db: DB): HouseholdSettings {
  const row = db.select().from(settings).where(eq(settings.key, HOUSEHOLD_KEY)).get();
  const merged = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<HouseholdSettings>) ?? {}) };
  const r = HouseholdSettings.safeParse(merged);
  return r.success ? r.data : DEFAULT_SETTINGS;
}

export function saveSettings(db: DB, value: HouseholdSettings): HouseholdSettings {
  setInternal(db, HOUSEHOLD_KEY, value);
  return value;
}

export function getInternal<T>(db: DB, key: string): T | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value as T | undefined;
}

export function setInternal(db: DB, key: string, value: unknown): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

/** Server secret for signing PIN unlock tokens; created on first use, never sent to clients. */
export function serverSecret(db: DB): string {
  let s = getInternal<string>(db, 'secret');
  if (!s) {
    s = randomBytes(32).toString('hex');
    setInternal(db, 'secret', s);
  }
  return s;
}
