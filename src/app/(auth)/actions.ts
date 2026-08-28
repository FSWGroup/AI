'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword, checkPasswordStrength } from '@/lib/auth/passwords';
import {
  createSession,
  destroySession,
  getSession,
  markSessionMfaPassed,
  revokeAllSessions,
} from '@/lib/auth/session';
import { auditAnonymous, audit } from '@/lib/audit';
import { getCtx } from '@/lib/authz';
import {
  decryptField,
  encryptField,
  generateToken,
  generateTotpSecret,
  hashToken,
  totpUri,
  verifyTotp,
} from '@/lib/crypto';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import { addDays } from '@/lib/format';

export type ActionResult = { error?: string; success?: string } | void;

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

// ---------------------------------------------------------------------------
// Sign in (with login throttling + MFA hand-off)
// ---------------------------------------------------------------------------

export async function signIn(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) return { error: 'Enter your work email and password.' };
  const email = parsed.data.email.toLowerCase().trim();

  const user = await db.user.findUnique({ where: { email } });
  const genericError = { error: 'Incorrect email or password.' };

  if (!user || !user.passwordHash || user.status === 'DEACTIVATED' || user.status === 'SUSPENDED') {
    await auditAnonymous('auth.login_failed', { email });
    return genericError;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { error: 'Too many failed attempts. Try again in a few minutes.' };
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await auditAnonymous('auth.login_failed', { email });
    return genericError;
  }
  if (user.status !== 'ACTIVE') {
    return { error: 'Your account is not active yet. Check your email for an activation link.' };
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id, { mfaPassed: !user.mfaEnabled });
  await db.auditEvent.create({
    data: { actorUserId: user.id, actorEmail: user.email, action: 'auth.login' },
  });

  redirect(user.mfaEnabled ? '/mfa' : '/');
}

export async function verifyMfa(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.user.mfaEnabled || session.mfaPassed) redirect('/');
  const code = String(formData.get('code') ?? '');
  if (!session.user.mfaSecretEnc || !verifyTotp(decryptField(session.user.mfaSecretEnc), code)) {
    await auditAnonymous('auth.mfa_failed', { email: session.user.email });
    return { error: 'That code is not valid. Codes rotate every 30 seconds.' };
  }
  await markSessionMfaPassed(session.id);
  redirect('/');
}

export async function signOut(): Promise<void> {
  const ctx = await getCtx();
  await destroySession();
  if (ctx) await audit(ctx, 'auth.logout');
  redirect('/login');
}

// ---------------------------------------------------------------------------
// Account activation
// ---------------------------------------------------------------------------

export async function sendActivationEmail(userId: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const token = generateToken();
  await db.authToken.create({
    data: { userId, kind: 'ACTIVATION', tokenHash: hashToken(token), expiresAt: addDays(new Date(), 7) },
  });
  await sendEmail({
    to: user.email,
    subject: 'Welcome to FSW People — activate your account',
    heading: 'Welcome to FSW People',
    bodyHtml:
      '<p>FSW People is where everything about our people lives — your profile, time off, documents, goals and tasks.</p><p>Activate your account to get started. This link is valid for 7 days.</p>',
    ctaLabel: 'Activate my account',
    ctaUrl: `${env.APP_BASE_URL}/activate/${token}`,
    templateKey: 'activation',
    relatedType: 'User',
    relatedId: userId,
  });
}

export async function activateAccount(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password !== confirm) return { error: 'Passwords do not match.' };
  const strength = checkPasswordStrength(password);
  if (!strength.ok) return { error: strength.errors.join(' ') };

  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.kind !== 'ACTIVATION' || row.usedAt || row.expiresAt < new Date()) {
    return { error: 'This activation link is invalid or has expired. Ask HR to send a new one.' };
  }
  await db.$transaction([
    db.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(password), status: 'ACTIVE', passwordChangedAt: new Date() },
    }),
  ]);
  await db.auditEvent.create({ data: { actorUserId: row.userId, action: 'auth.account_activated' } });
  await createSession(row.userId, { mfaPassed: true });
  redirect('/');
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function requestPasswordReset(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '')
    .toLowerCase()
    .trim();
  const generic = { success: 'If that email belongs to an account, a reset link is on its way.' };
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status === 'DEACTIVATED') return generic;
  const token = generateToken();
  await db.authToken.create({
    data: {
      userId: user.id,
      kind: 'PASSWORD_RESET',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 2 * 3600_000),
    },
  });
  await sendEmail({
    to: user.email,
    subject: 'Reset your FSW People password',
    heading: 'Reset your password',
    bodyHtml: '<p>Someone requested a password reset for your FSW People account. If this was you, use the button below within 2 hours. Otherwise you can ignore this email.</p>',
    ctaLabel: 'Choose a new password',
    ctaUrl: `${env.APP_BASE_URL}/reset/${token}`,
    templateKey: 'password_reset',
  });
  await auditAnonymous('auth.password_reset_requested', { email });
  return generic;
}

export async function resetPassword(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password !== confirm) return { error: 'Passwords do not match.' };
  const strength = checkPasswordStrength(password);
  if (!strength.ok) return { error: strength.errors.join(' ') };

  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.kind !== 'PASSWORD_RESET' || row.usedAt || row.expiresAt < new Date()) {
    return { error: 'This reset link is invalid or has expired. Request a new one.' };
  }
  await db.$transaction([
    db.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
    }),
  ]);
  await revokeAllSessions(row.userId);
  await db.auditEvent.create({ data: { actorUserId: row.userId, action: 'auth.password_reset' } });
  redirect('/login?reset=1');
}

// ---------------------------------------------------------------------------
// MFA enrollment (from Account → Security)
// ---------------------------------------------------------------------------

export async function beginMfaEnrollment(): Promise<{ error?: string; secret?: string; uri?: string }> {
  const session = await getSession();
  if (!session) return { error: 'Not signed in.' };
  const secret = generateTotpSecret();
  const jar = await cookies();
  jar.set('fsw_mfa_pending', encryptField(secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  });
  return { secret, uri: totpUri(secret, session.user.email) };
}

export async function confirmMfaEnrollment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { error: 'Not signed in.' };
  const jar = await cookies();
  const pending = jar.get('fsw_mfa_pending')?.value;
  if (!pending) return { error: 'Enrollment expired — start again.' };
  const secret = decryptField(pending);
  const code = String(formData.get('code') ?? '');
  if (!verifyTotp(secret, code)) return { error: 'That code is not valid. Try the current code from your app.' };
  await db.user.update({
    where: { id: session.user.id },
    data: { mfaSecretEnc: encryptField(secret), mfaEnabled: true },
  });
  await db.session.update({ where: { id: session.id }, data: { mfaPassed: true } });
  jar.delete('fsw_mfa_pending');
  await db.auditEvent.create({
    data: { actorUserId: session.user.id, actorEmail: session.user.email, action: 'auth.mfa_enabled' },
  });
  return { success: 'Two-factor authentication is now on for your account.' };
}

export async function disableMfa(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { error: 'Not signed in.' };
  await db.user.update({
    where: { id: session.user.id },
    data: { mfaSecretEnc: null, mfaEnabled: false },
  });
  await db.auditEvent.create({
    data: { actorUserId: session.user.id, actorEmail: session.user.email, action: 'auth.mfa_disabled' },
  });
  return { success: 'Two-factor authentication is off.' };
}

export async function revokeOtherSessions(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { error: 'Not signed in.' };
  await revokeAllSessions(session.user.id, session.id);
  await db.auditEvent.create({
    data: { actorUserId: session.user.id, actorEmail: session.user.email, action: 'auth.sessions_revoked' },
  });
  return { success: 'All other sessions were signed out.' };
}
