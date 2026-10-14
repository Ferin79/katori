// Per-profile AI credentials live in <credentialsDir>/<profile>.env (mode 600), never in SQLite
// and never in the UI. Each job gets a clean environment with exactly one credential, because an
// API key outranks a token when both are set (PLAN.md, Signing in on the device).
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';

export type Credential = { type: 'oauth'; token: string } | { type: 'api_key'; key: string };

const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function credentialPath(cfg: Config, profileId: string): string {
  if (!PROFILE_ID.test(profileId)) throw new Error(`Invalid profile id: ${profileId}`);
  return path.join(cfg.credentialsDir, `${profileId}.env`);
}

export function readCredential(cfg: Config, profileId: string): Credential | null {
  const file = credentialPath(cfg, profileId);
  if (!existsSync(file)) return null;
  const vars: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  // Exactly one credential per profile: if both somehow exist, the file is ambiguous.
  if (vars.CLAUDE_CODE_OAUTH_TOKEN && vars.ANTHROPIC_API_KEY) return null;
  if (vars.CLAUDE_CODE_OAUTH_TOKEN) return { type: 'oauth', token: vars.CLAUDE_CODE_OAUTH_TOKEN };
  if (vars.ANTHROPIC_API_KEY) return { type: 'api_key', key: vars.ANTHROPIC_API_KEY };
  return null;
}

export function writeCredential(cfg: Config, profileId: string, cred: Credential): string {
  const file = credentialPath(cfg, profileId);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const line = cred.type === 'oauth' ? `CLAUDE_CODE_OAUTH_TOKEN=${cred.token}` : `ANTHROPIC_API_KEY=${cred.key}`;
  writeFileSync(file, `# Katori credential for profile "${profileId}". Do not share.\n${line}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // chmod is a no-op on Windows dev machines.
  }
  return file;
}

export function removeCredential(cfg: Config, profileId: string): boolean {
  const file = credentialPath(cfg, profileId);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

/** Variables a CLI process needs to start at all, per platform. Nothing secret. */
const PASSTHROUGH = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'];
const HOME_VARS = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH'];

export interface JobEnvOptions {
  profileId: string;
  credential: Credential | null;
  /** Use this machine's existing Claude Code login (dev convenience for the owner's profile only). */
  ambient: boolean;
}

/**
 * A clean environment for one `claude` run: the platform basics, a per-profile CLAUDE_CONFIG_DIR
 * so each person's Claude Code state stays separate, and exactly one credential.
 */
export function buildJobEnv(cfg: Config, opts: JobEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of [...PASSTHROUGH, ...HOME_VARS]) if (process.env[k]) env[k] = process.env[k];
  if (opts.ambient) return env; // the default config dir holds the owner's login

  const configDir = path.join(cfg.claudeConfigRoot, opts.profileId);
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  // Stable channel: about a week behind latest, skipping releases with major regressions.
  const settingsFile = path.join(configDir, 'settings.json');
  if (!existsSync(settingsFile)) writeFileSync(settingsFile, JSON.stringify({ autoUpdatesChannel: 'stable' }, null, 2) + '\n', { mode: 0o600 });
  env.CLAUDE_CONFIG_DIR = configDir;
  if (opts.credential?.type === 'oauth') env.CLAUDE_CODE_OAUTH_TOKEN = opts.credential.token;
  if (opts.credential?.type === 'api_key') env.ANTHROPIC_API_KEY = opts.credential.key;
  return env;
}
