import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface PasswordCheck {
  ok: boolean;
  errors: string[];
}

/** Minimum bar: 10+ chars with reasonable variety. */
export function checkPasswordStrength(password: string): PasswordCheck {
  const errors: string[] = [];
  if (password.length < 10) errors.push('Use at least 10 characters.');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    errors.push('Mix upper and lower case letters.');
  }
  if (!/[0-9]/.test(password) && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Include a number or symbol.');
  }
  if (/^(password|fswpeople|welcome|letmein)/i.test(password)) {
    errors.push('That password is too guessable.');
  }
  return { ok: errors.length === 0, errors };
}
