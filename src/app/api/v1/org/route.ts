import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticateApiRequest } from '@/lib/api-keys';

export const dynamic = 'force-dynamic';

/** GET /api/v1/org — departments, teams, locations and legal entities. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request.headers.get('authorization'), 'org.read');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [departments, teams, locations, entities] = await Promise.all([
    db.department.findMany({ where: { active: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    db.team.findMany({ where: { active: true }, select: { id: true, name: true, departmentId: true }, orderBy: { name: 'asc' } }),
    db.location.findMany({
      where: { active: true },
      select: { id: true, name: true, city: true, state: true, country: true, timezone: true },
      orderBy: { name: 'asc' },
    }),
    db.legalEntity.findMany({ where: { active: true }, select: { id: true, name: true, code: true, country: true } }),
  ]);

  return NextResponse.json(
    { data: { departments, teams, locations, legalEntities: entities } },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}
