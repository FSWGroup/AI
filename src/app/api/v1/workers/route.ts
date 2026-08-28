import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api-keys';
import { serializeWorker } from '@/lib/api-serializers';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;

/**
 * GET /api/v1/workers — the directory, read-only.
 *
 * Scoped to `workers.read`. Returns only the allowlisted fields in
 * api-serializers.ts; there is no `include`, `select` or `fields` parameter,
 * deliberately, because a caller-controlled projection is how an API grows a
 * field nobody reviewed.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request.headers.get('authorization'), 'workers.read');
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const limit = Math.min(Number(params.get('limit')) || 50, MAX_LIMIT);
  const cursor = params.get('cursor');
  const status = params.get('status');
  const updatedSince = params.get('updatedSince');

  const since = updatedSince ? new Date(updatedSince) : null;
  if (updatedSince && Number.isNaN(since!.getTime())) {
    return NextResponse.json({ error: 'updatedSince must be an ISO date.' }, { status: 400 });
  }

  const workers = await db.worker.findMany({
    where: {
      deletedAt: null,
      ...(status ? { status: status as never } : { status: { not: 'TERMINATED' } }),
      ...(since ? { updatedAt: { gte: since } } : {}),
    },
    select: {
      id: true, employeeNumber: true, legalFirstName: true, preferredName: true, lastName: true,
      workEmail: true, status: true, workerType: true, country: true, hireDate: true,
      employments: {
        where: { effectiveTo: null },
        take: 1,
        select: {
          title: true,
          managerId: true,
          department: { select: { name: true } },
          location: { select: { name: true } },
          legalEntity: { select: { name: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = workers.length > limit;
  const page = hasMore ? workers.slice(0, limit) : workers;

  return NextResponse.json(
    {
      data: page.map(serializeWorker),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}
