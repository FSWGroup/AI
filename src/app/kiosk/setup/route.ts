import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashKioskToken, KIOSK_COOKIE } from '@/lib/kiosk';
import { auditAnonymous } from '@/lib/audit';
import { isProduction } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * One-time device claim.
 *
 * An administrator registers a kiosk, gets a setup URL, and opens it once on
 * the tablet. That exchanges the token in the URL for an httpOnly cookie on
 * that device, so the token never has to be typed again and never sits in
 * browser history as a working credential.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const device = token
    ? await db.kioskDevice.findUnique({ where: { tokenHash: hashKioskToken(token) } })
    : null;

  if (!device || !device.active || device.revokedAt) {
    await auditAnonymous('kiosk.setup_rejected', { metadata: { hadToken: Boolean(token) } });
    return new NextResponse('Not found', { status: 404 });
  }

  await db.kioskDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  await auditAnonymous('kiosk.device_claimed', { metadata: { deviceId: device.id, name: device.name } });

  const response = NextResponse.redirect(new URL('/kiosk', request.nextUrl.origin));
  response.cookies.set(KIOSK_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/kiosk',
    // A wall tablet is not re-enrolled often; revoking the device is the way
    // to cut it off, not cookie expiry.
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
