import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, keyLength)) as Buffer;
  return `scrypt-v1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = encoded.split('$');
  if (algorithm !== 'scrypt-v1' || !saltValue || !hashValue) return false;
  try {
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = (await scrypt(
      password,
      Buffer.from(saltValue, 'base64url'),
      expected.byteLength,
    )) as Buffer;
    return (
      expected.byteLength === actual.byteLength &&
      timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

export function temporaryPassword(): string {
  return `Skka-${randomBytes(9).toString('base64url')}9aA`;
}
