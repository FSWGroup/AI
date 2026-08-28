import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission } from '@/lib/authz';
import { fullName, fmtDate, startOfUTCDay } from '@/lib/format';
import { Callout, PageHeader } from '@/components/ui';
import { LifecycleList } from '../lifecycle-list';

export const metadata: Metadata = { title: 'Offboarding' };

export default async function OffboardingPage() {
  const ctx = await requireCtx();
  assertPermission(ctx, 'onboarding.admin');
  const today = startOfUTCDay();

  // High-priority: workers at/past their last day with open access-removal tasks (§31)
  const urgent = await db.task.findMany({
    where: {
      category: 'IT_ACCESS',
      status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] },
      lifecycle: { kind: 'OFFBOARDING', status: 'IN_PROGRESS', startDate: { lte: today } },
    },
    include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true, terminationDate: true } } },
  });

  return (
    <div>
      <PageHeader
        title="Offboarding"
        description="Departures in progress. Start offboarding from a worker's profile (Job tab)."
      />
      {urgent.length > 0 ? (
        <div className="mb-4">
          <Callout tone="danger">
            <strong>Access removal overdue:</strong>{' '}
            {urgent.map((t, i) => (
              <span key={t.id}>
                {i > 0 ? ', ' : ''}
                {t.worker ? (
                  <Link href={`/tasks?task=${t.id}`} className="font-medium underline">
                    {fullName(t.worker)} (last day {fmtDate(t.worker.terminationDate)})
                  </Link>
                ) : (
                  t.title
                )}
              </span>
            ))}
            {' '}— complete these IT tasks now.
          </Callout>
        </div>
      ) : null}
      <LifecycleList kind="OFFBOARDING" />
    </div>
  );
}
