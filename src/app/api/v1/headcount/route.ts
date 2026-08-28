import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api-keys';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/headcount — aggregate counts only.
 *
 * A separate scope from workers.read, so a dashboard that only needs totals
 * (Power BI) never has to hold a key that could enumerate the directory.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request.headers.get('authorization'), 'headcount.read');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [byStatus, byType, byDepartment, departments] = await Promise.all([
    db.worker.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
    db.worker.groupBy({ by: ['workerType'], where: { deletedAt: null, status: 'ACTIVE' }, _count: { _all: true } }),
    db.employmentRecord.groupBy({
      by: ['departmentId'],
      where: { effectiveTo: null, worker: { status: 'ACTIVE', deletedAt: null } },
      _count: { _all: true },
    }),
    db.department.findMany({ select: { id: true, name: true } }),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));

  return NextResponse.json(
    {
      data: {
        asOf: new Date().toISOString(),
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
        activeByWorkerType: Object.fromEntries(byType.map((r) => [r.workerType, r._count._all])),
        activeByDepartment: Object.fromEntries(
          byDepartment.map((r) => [r.departmentId ? (deptName.get(r.departmentId) ?? 'Unassigned') : 'Unassigned', r._count._all]),
        ),
      },
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}
