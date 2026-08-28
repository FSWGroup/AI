import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, can, allReportIds } from '@/lib/authz';
import { fullName } from '@/lib/format';
import { ButtonLink, DeniedState, PageHeader } from '@/components/ui';
import { LifecycleList } from '../lifecycle-list';
import { StartLifecycleForm } from '../start-lifecycle-form';

export const metadata: Metadata = { title: 'Onboarding' };

export default async function OnboardingPage() {
  const ctx = await requireCtx();
  const isAdmin = can(ctx, 'onboarding.admin');
  const isManager = ctx.workerId ? (await allReportIds(ctx.workerId)).length > 0 : false;
  if (!isAdmin && !isManager) return <DeniedState />;

  const candidates = isAdmin
    ? await db.worker.findMany({
        where: {
          status: { in: ['PRE_START', 'ONBOARDING', 'ACTIVE'] },
          deletedAt: null,
          lifecycleInstances: { none: { kind: 'ONBOARDING', status: 'IN_PROGRESS' } },
        },
        select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    : [];
  const templates = isAdmin
    ? await db.lifecycleTemplate.findMany({ where: { kind: 'ONBOARDING', active: true }, orderBy: { name: 'asc' } })
    : [];

  return (
    <div>
      <PageHeader
        title="Onboarding"
        description="Checklist progress for everyone joining FSW Group."
        actions={isAdmin ? <ButtonLink variant="secondary" href="/ops/templates">Manage templates</ButtonLink> : undefined}
      />
      {isAdmin ? (
        <div className="mb-4">
          <StartLifecycleForm
            kind="ONBOARDING"
            workers={candidates.map((w) => ({ value: w.id, label: fullName(w) }))}
            templates={templates.map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>
      ) : null}
      <LifecycleList kind="ONBOARDING" />
    </div>
  );
}
