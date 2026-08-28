import { NextRequest, NextResponse } from 'next/server';
import { getCtx, can } from '@/lib/authz';
import { runMaintenance } from '@/lib/jobs';
import { audit } from '@/lib/audit';
import { safeEqual } from '@/lib/crypto';

/**
 * Daily maintenance sweep endpoint. Point a scheduler at this
 * (Vercel Cron, GitHub Actions, systemd timer) with either:
 *   Authorization: Bearer $CRON_SECRET
 * or an authenticated Super Admin session.
 *
 * The sweep is idempotent: workflow dedupe keys and status guards mean a
 * double-run for the same day is a no-op.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  const viaSecret = Boolean(secret && presented && safeEqual(presented, secret));

  let ctx = null;
  if (!viaSecret) {
    ctx = await getCtx();
    if (!ctx || !can(ctx, 'settings.admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const started = Date.now();
  try {
    const counters = await runMaintenance();
    await audit(ctx, 'system.maintenance_run', {
      metadata: { ...counters, via: viaSecret ? 'cron' : 'admin', ms: Date.now() - started },
    });
    return NextResponse.json({ ok: true, counters, ms: Date.now() - started });
  } catch (error) {
    console.error('maintenance sweep failed', error);
    return NextResponse.json({ ok: false, error: 'Maintenance sweep failed' }, { status: 500 });
  }
}
