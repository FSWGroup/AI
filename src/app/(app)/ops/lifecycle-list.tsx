import Link from 'next/link';
import { db } from '@/lib/db';
import { fmtDate, fullName, humanize } from '@/lib/format';
import { Card, EmptyState, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';
import { ConfirmSubmit } from '@/components/ui/client';
import { cancelLifecycleAction } from './actions';
import type { LifecycleKind } from '@/generated/prisma/enums';

/** Shared onboarding/offboarding instance table (admin view). */
export async function LifecycleList({ kind, status }: { kind: LifecycleKind; status?: string }) {
  const instances = await db.lifecycleInstance.findMany({
    where: { kind, ...(status ? { status } : {}) },
    orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    take: 60,
    include: {
      worker: {
        select: {
          id: true, legalFirstName: true, preferredName: true, lastName: true, status: true,
          employments: { where: { effectiveTo: null }, take: 1, select: { title: true, department: { select: { name: true } } } },
        },
      },
      template: { select: { name: true } },
      tasks: { select: { status: true, category: true, dueDate: true } },
    },
  });

  if (instances.length === 0) {
    return (
      <Card>
        <EmptyState
          title={`No ${kind.toLowerCase()} in progress`}
          description={kind === 'ONBOARDING' ? 'New hires appear here automatically when created.' : 'Start offboarding from a worker profile.'}
        />
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <THead>
          <TH>Worker</TH><TH>Template</TH><TH>{kind === 'ONBOARDING' ? 'Start date' : 'Last day'}</TH><TH>Progress</TH><TH>Status</TH><TH></TH>
        </THead>
        <tbody>
          {instances.map((inst) => {
            const total = inst.tasks.length;
            const done = inst.tasks.filter((t) => t.status === 'COMPLETED').length;
            const pct = total ? Math.round((done / total) * 100) : 0;
            return (
              <TRow key={inst.id}>
                <TD>
                  <Link href={`/people/${inst.worker.id}?tab=onboarding`} className="font-medium text-ink-900 hover:text-brand-600">
                    {fullName(inst.worker)}
                  </Link>
                  <span className="block text-[12px] text-ink-400">
                    {inst.worker.employments[0]?.title ?? ''} · {inst.worker.employments[0]?.department?.name ?? ''}
                  </span>
                </TD>
                <TD>{inst.template?.name ?? 'Custom'}</TD>
                <TD>{fmtDate(inst.startDate)}{inst.reason ? <span className="block text-[12px] text-ink-400">{humanize(inst.reason)}</span> : null}</TD>
                <TD className="min-w-40">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[12px] text-ink-500 tabular-nums">
                      {done}/{total}
                    </span>
                  </div>
                </TD>
                <TD><StatusBadge status={inst.status} /></TD>
                <TD>
                  {inst.status === 'IN_PROGRESS' ? (
                    <ConfirmSubmit
                      action={cancelLifecycleAction}
                      title={`Cancel this ${kind.toLowerCase()}?`}
                      description="Open checklist tasks will be canceled. Completed work is kept."
                      confirmLabel="Cancel checklist"
                      variant="dangerGhost"
                      hiddenFields={{ instanceId: inst.id }}
                    >
                      Cancel
                    </ConfirmSubmit>
                  ) : null}
                </TD>
              </TRow>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
