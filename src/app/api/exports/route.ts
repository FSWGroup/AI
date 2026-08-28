import { NextRequest, NextResponse } from 'next/server';
import { getCtx, can } from '@/lib/authz';
import { findReport } from '@/lib/reports';
import { audit } from '@/lib/audit';
import { toCsv } from '@/lib/format';

/**
 * Audited CSV export endpoint (§50).
 *  - Server-side permission check per report (the export permission AND the
 *    report's own permission — a manager can never export hidden HR fields
 *    just because the endpoint exists).
 *  - Every export writes an audit event with the report key and row count.
 */
export async function GET(request: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!can(ctx, 'reports.export')) {
    return NextResponse.json({ error: 'You do not have export permission.' }, { status: 403 });
  }
  const key = request.nextUrl.searchParams.get('report') ?? '';
  const report = findReport(key);
  if (!report) return NextResponse.json({ error: 'Unknown report' }, { status: 404 });
  if (!can(ctx, report.permission)) {
    return NextResponse.json({ error: 'You do not have access to this report.' }, { status: 403 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = await report.run(ctx, params);

  await audit(ctx, 'export.run', {
    targetType: 'Report',
    targetId: report.key,
    metadata: { rows: result.rows.length, params },
  });

  const csv = toCsv(result.headers, result.rows as (string | number | null)[][]);
  return new NextResponse('﻿' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="fsw-people-${report.key}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
