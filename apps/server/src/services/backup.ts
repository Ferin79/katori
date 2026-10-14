// Nightly backups: a consistent SQLite snapshot (safe while the app runs, like sqlite3 ".backup")
// plus the photos folder, 30 days kept. The status file feeds the backup alert in the app.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { toDateStr } from '@katori/shared';
import type { Config } from '../config.js';
import type { DB } from '../db/client.js';

export interface BackupStatusFile {
  at: string;
  ok: boolean;
  dest: string;
  file: string | null;
  photos: number;
  error: string | null;
}

const KEEP_DAYS = 30;
const STALE_HOURS = 36;

function syncDir(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copied += syncDir(s, d);
    else if (!existsSync(d) || statSync(d).size !== statSync(s).size) {
      copyFileSync(s, d);
      copied++;
    }
  }
  return copied;
}

export async function runBackup(db: DB, cfg: Config, destDir = cfg.backupDir): Promise<BackupStatusFile> {
  const at = new Date().toISOString();
  const file = path.join(destDir, `katori-${toDateStr(new Date())}.db`);
  try {
    mkdirSync(destDir, { recursive: true });
    await db.$client.backup(file);
    // Make the snapshot one self-contained file (no -wal/-shm beside it), then verify it.
    const check = new Database(file);
    check.pragma('journal_mode = DELETE');
    const integrity = check.pragma('integrity_check', { simple: true });
    check.close();
    if (integrity !== 'ok') throw new Error(`Backup integrity check failed: ${String(integrity)}`);
    const photos = syncDir(cfg.photosDir, path.join(destDir, 'photos'));
    // Keep 30 days of database snapshots.
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    for (const f of readdirSync(destDir)) {
      const m = f.match(/^katori-(\d{4}-\d{2}-\d{2})\.db$/);
      if (m && new Date(m[1]!).getTime() < cutoff) rmSync(path.join(destDir, f), { force: true });
    }
    const status: BackupStatusFile = { at, ok: true, dest: destDir, file, photos, error: null };
    writeStatus(cfg, status);
    return status;
  } catch (e) {
    const status: BackupStatusFile = { at, ok: false, dest: destDir, file: null, photos: 0, error: (e as Error).message };
    writeStatus(cfg, status);
    return status;
  }
}

function writeStatus(cfg: Config, s: BackupStatusFile) {
  mkdirSync(path.dirname(cfg.backupStatusFile), { recursive: true });
  writeFileSync(cfg.backupStatusFile, JSON.stringify(s, null, 2));
}

export function readBackupStatus(cfg: Config) {
  const configured = existsSync(cfg.backupStatusFile) || process.env.KATORI_BACKUPS_EXPECTED === '1';
  if (!existsSync(cfg.backupStatusFile)) {
    return { configured, lastAt: null, ok: null, stale: configured, message: configured ? 'No backup has run yet.' : null, dest: null };
  }
  try {
    const s = JSON.parse(readFileSync(cfg.backupStatusFile, 'utf8')) as BackupStatusFile;
    const ageH = (Date.now() - new Date(s.at).getTime()) / 3_600_000;
    const stale = ageH > STALE_HOURS;
    const message = !s.ok ? `Last backup failed: ${s.error}` : stale ? `Last backup was ${Math.round(ageH)} hours ago.` : null;
    return { configured: true, lastAt: s.at, ok: s.ok, stale, message, dest: s.dest };
  } catch {
    return { configured: true, lastAt: null, ok: false, stale: true, message: 'Backup status file is unreadable.', dest: null };
  }
}

/**
 * Restore a snapshot over the live database. Run with the service stopped
 * (systemctl stop katori); the current file is kept alongside as .before-restore.
 */
export function restoreBackup(cfg: Config, file: string): { restoredFrom: string; previous: string | null } {
  if (!existsSync(file)) throw new Error(`No such backup: ${file}`);
  mkdirSync(path.dirname(cfg.dbPath), { recursive: true }); // a fresh machine has no data folder yet
  const check = new Database(file, { readonly: true, fileMustExist: true });
  const integrity = check.pragma('integrity_check', { simple: true });
  const hasProfiles = check.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profiles'`).get();
  check.close();
  if (integrity !== 'ok' || !hasProfiles) throw new Error('That file is not a healthy Katori database');
  let previous: string | null = null;
  if (existsSync(cfg.dbPath)) {
    previous = `${cfg.dbPath}.before-restore`;
    copyFileSync(cfg.dbPath, previous);
  }
  for (const suffix of ['-wal', '-shm']) rmSync(cfg.dbPath + suffix, { force: true });
  copyFileSync(file, cfg.dbPath);
  return { restoredFrom: file, previous };
}
