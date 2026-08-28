import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fullName } from '@/lib/format';
import { PageHeader, Card, CardBody } from '@/components/ui';
import { OrgChartClient, type OrgNode } from './org-chart-client';

export const metadata: Metadata = { title: 'Org chart' };

export default async function OrgChartPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; dept?: string }>;
}) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'people.read');
  const params = await searchParams;

  const workers = await db.worker.findMany({
    where: { status: { in: ['ACTIVE', 'ONBOARDING', 'ON_LEAVE', 'PRE_START'] }, deletedAt: null },
    select: {
      id: true, legalFirstName: true, preferredName: true, lastName: true, photoUrl: true,
      employments: {
        where: { effectiveTo: null },
        take: 1,
        select: {
          title: true, managerId: true, secondaryManagerId: true,
          department: { select: { id: true, name: true } },
          legalEntity: { select: { id: true, name: true } },
        },
      },
    },
  });

  const nodes: OrgNode[] = workers
    .filter((w) => w.employments.length > 0)
    .filter((w) => !params.entity || w.employments[0].legalEntity?.id === params.entity)
    .filter((w) => !params.dept || w.employments[0].department?.id === params.dept)
    .map((w) => ({
      id: w.id,
      name: fullName(w),
      title: w.employments[0].title,
      department: w.employments[0].department?.name ?? null,
      entity: w.employments[0].legalEntity?.name ?? null,
      managerId: w.employments[0].managerId,
      dottedManagerId: w.employments[0].secondaryManagerId,
    }));

  const [entities, departments] = await Promise.all([
    db.legalEntity.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'People', href: '/people' }, { label: 'Org chart' }]}
        title="Org chart"
        description={`${nodes.length} people · expand and collapse teams, search, or print`}
      />
      <Card>
        <CardBody>
          <OrgChartClient
            nodes={nodes}
            entities={entities.map((e) => ({ value: e.id, label: e.name }))}
            departments={departments.map((d) => ({ value: d.id, label: d.name }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}
