// Optional 4-digit PIN per profile. Not real security against someone on your Wi-Fi with
// tools, but it keeps a profile's weights and photos out of casual view.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Token bound to the profile and its current PIN hash, so changing the PIN revokes old tokens. */
export function makeUnlockToken(secret: string, profileId: string, pinHash: string, now = Date.now()): string {
  const exp = now + TOKEN_TTL_MS;
  const payload = `${profileId}.${exp}`;
  return `${exp}.${sign(secret + pinHash, payload)}`;
}

export function verifyUnlockToken(secret: string, profileId: string, pinHash: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < now) return false;
  const expected = sign(secret + pinHash, `${profileId}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
