import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { db } from '@/lib/db';
import { generateToken, hashToken } from '@/lib/crypto';
import { isProduction } from '@/lib/env';

export const SESSION_COOKIE = 'fsw_session';
const SESSION_TTL_HOURS = 12;

export async function requestMeta() {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  return {
    ip: (fwd ? fwd.split(',')[0].trim() : h.get('x-real-ip')) ?? null,
    userAgent: h.get('user-agent')?.slice(0, 250) ?? null,
  };
}

export async function createSession(userId: string, opts: { mfaPassed: boolean }) {
  const token = generateToken();
  const meta = await requestMeta();
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ip: meta.ip,
      userAgent: meta.userAgent,
      mfaPassed: opts.mfaPassed,
      expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600,
  });
  return session;
}

export async function markSessionMfaPassed(sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { mfaPassed: true } });
}

/**
 * Resolve the current session + user (with roles and worker linkage).
 * Cached per request via React cache().
 */
export const getSession = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: true } } } },
          worker: true,
        },
      },
    },
  });
  if (!session) return null;
  if (session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status !== 'ACTIVE') return null;
  return session;
});

/**
 * A session that has cleared MFA (or belongs to a user without MFA enabled).
 *
 * getSession() deliberately returns pre-MFA sessions, because the /mfa page
 * itself needs one. Everything else — including the account security screen
 * that can turn MFA off — must use this, or an attacker holding only a
 * password could disable the second factor before completing it.
 */
export async function getFullSession() {
  const session = await getSession();
  if (!session) return null;
  if (session.user.mfaEnabled && !session.mfaPassed) return null;
  return session;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
