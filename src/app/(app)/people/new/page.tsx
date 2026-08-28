import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fullName } from '@/lib/format';
import { PageHeader } from '@/components/ui';
import { NewWorkerForm } from './new-worker-form';

export const metadata: Metadata = { title: 'Add worker' };

export default async function NewWorkerPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'people.write');

  const [entities, departments, locations, managers] = await Promise.all([
    db.legalEntity.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.location.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.worker.findMany({
      where: { status: { in: ['ACTIVE', 'ONBOARDING'] }, deletedAt: null },
      select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
      orderBy: { lastName: 'asc' },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: 'People', href: '/people' }, { label: 'Add worker' }]}
        title="Add a worker"
        description="Creating a worker starts the matching onboarding workflow automatically. Worker classification (employee vs contractor) is an explicit choice and is never changed automatically."
      />
      <NewWorkerForm
        entities={entities.map((e) => ({ value: e.id, label: e.name }))}
        departments={departments.map((d) => ({ value: d.id, label: d.name }))}
        locations={locations.map((l) => ({ value: l.id, label: l.name }))}
        managers={managers.map((m) => ({ value: m.id, label: fullName(m) }))}
      />
    </div>
  );
}
