import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import { badRequest } from '../lib/http.js';

/** Photos are stored as <photosDir>/<YYYY-MM>/<uuid>.jpg; the DB keeps the relative path. */
export function savePhoto(cfg: Config, data: Buffer, month: string): string {
  // The browser resizes to ~1600 px JPEG before upload; accept JPEG, PNG and WebP by magic bytes.
  const isJpeg = data[0] === 0xff && data[1] === 0xd8;
  const isPng = data[0] === 0x89 && data[1] === 0x50;
  const isWebp = data.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) throw badRequest('Photo must be a JPEG, PNG or WebP image');
  const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
  const rel = `${month}/${randomUUID()}.${ext}`;
  const abs = photoAbsPath(cfg, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return rel;
}

export function photoAbsPath(cfg: Config, rel: string): string {
  const abs = path.resolve(cfg.photosDir, rel);
  if (!abs.startsWith(path.resolve(cfg.photosDir) + path.sep)) throw badRequest('Bad photo path');
  return abs;
}
