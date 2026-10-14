import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/server/src/config.ts and apps/server/dist/index.js sit at the same depth.
const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..');

function int(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  photosDir: string;
  jobsDir: string;
  credentialsDir: string;
  claudeConfigRoot: string;
  aiMode: 'claude' | 'fake';
  claudeBin: string;
  /** Extra leading args for claudeBin (tests run a stub script through node). */
  claudeBinArgs: string[];
  promptFile: string;
  schemaFile: string;
  webDist: string;
  migrationsDir: string;
  jobTimeoutMs: number;
  retryBaseMs: number;
  maxAttempts: number;
  fakeDelayMs: number;
  backupStatusFile: string;
  backupDir: string;
  /** Dev only: this profile id may use this machine's existing Claude Code login. */
  ambientAuthProfile: string | null;
  testMode: boolean;
  logLevel: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = path.resolve(process.env.KATORI_DATA_DIR ?? path.join(REPO_ROOT, 'data'));
  const dbEnv = process.env.KATORI_DB ?? 'katori.db';
  const aiMode = process.env.KATORI_AI === 'fake' ? 'fake' : 'claude';
  // On the home server credentials live in /etc/katori/profiles (mode 600, outside the repo and DB).
  const credentialsDefault = existsSync('/etc/katori') ? '/etc/katori/profiles' : path.join(dataDir, 'credentials');
  const ref = (p: string) => path.join(REPO_ROOT, p);

  const cfg: Config = {
    host: process.env.KATORI_HOST ?? '0.0.0.0',
    port: int('PORT', 3000),
    dataDir,
    dbPath: path.isAbsolute(dbEnv) ? dbEnv : path.join(dataDir, dbEnv),
    photosDir: process.env.KATORI_PHOTOS_DIR ?? path.join(dataDir, 'photos'),
    jobsDir: process.env.KATORI_JOBS_DIR ?? path.join(dataDir, 'jobs'),
    credentialsDir: process.env.KATORI_CREDENTIALS_DIR ?? credentialsDefault,
    claudeConfigRoot: process.env.KATORI_CLAUDE_CONFIG_ROOT ?? path.join(dataDir, 'claude'),
    aiMode,
    claudeBin: process.env.KATORI_CLAUDE_BIN ?? 'claude',
    claudeBinArgs: process.env.KATORI_CLAUDE_BIN_ARGS ? (JSON.parse(process.env.KATORI_CLAUDE_BIN_ARGS) as string[]) : [],
    promptFile: process.env.KATORI_PROMPT_FILE ?? ref('prompts/food-estimator.md'),
    schemaFile: process.env.KATORI_SCHEMA_FILE ?? ref('schemas/meal-estimate.json'),
    webDist: process.env.KATORI_WEB_DIST ?? ref('apps/web/dist'),
    migrationsDir: path.join(SERVER_ROOT, 'drizzle'),
    jobTimeoutMs: int('KATORI_JOB_TIMEOUT_MS', 120_000),
    retryBaseMs: int('KATORI_RETRY_BASE_MS', aiMode === 'fake' ? 300 : 30_000),
    maxAttempts: int('KATORI_MAX_ATTEMPTS', 3),
    fakeDelayMs: int('KATORI_FAKE_DELAY_MS', 1200),
    backupStatusFile: process.env.KATORI_BACKUP_STATUS ?? path.join(dataDir, 'backup-status.json'),
    backupDir: process.env.KATORI_BACKUP_DIR ?? path.join(dataDir, 'backups'),
    ambientAuthProfile: process.env.KATORI_AMBIENT_AUTH_PROFILE || null,
    testMode: aiMode === 'fake',
    logLevel: process.env.KATORI_LOG_LEVEL ?? 'info',
  };
  return { ...cfg, ...overrides };
}
