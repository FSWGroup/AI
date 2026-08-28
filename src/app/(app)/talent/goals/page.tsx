import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, can, directReportIds } from '@/lib/authz';
import { fmtDate, fullName, humanize } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { GoalForm, GoalProgressForm } from './goal-forms';

export const metadata: Metadata = { title: 'Goals' };

function GoalRow({
  goal,
  editable,
  ownerName,
}: {
  goal: { id: string; title: string; description: string | null; progress: number; weight: number | null; dueDate: Date | null; status: string; level: string };
  editable: boolean;
  ownerName?: string;
}) {
  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-900">{goal.title}</span>
            {goal.level !== 'INDIVIDUAL' ? <Badge tone="navy">{humanize(goal.level)}</Badge> : null}
            {goal.status === 'COMPLETED' ? <Badge tone="green">Done</Badge> : null}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-400">
            {ownerName ? `${ownerName} · ` : ''}
            {goal.weight ? `weight ${goal.weight}% · ` : ''}
            {goal.dueDate ? `due ${fmtDate(goal.dueDate)}` : 'no due date'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 w-32 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={goal.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${goal.progress}%` }} />
          </div>
          <span className="w-9 text-right text-[13px] text-ink-500 tabular-nums">{goal.progress}%</span>
          {editable ? <GoalProgressForm goalId={goal.id} progress={goal.progress} /> : null}
        </div>
      </div>
      {goal.description ? <p className="mt-1 text-[13px] text-ink-500">{goal.description}</p> : null}
    </li>
  );
}

export default async function GoalsPage() {
  const ctx = await requireCtx();
  const isAdmin = can(ctx, 'talent.admin');

  const [myGoals, companyGoals] = await Promise.all([
    ctx.workerId
      ? db.goal.findMany({ where: { workerId: ctx.workerId, status: { not: 'CANCELED' } }, orderBy: { createdAt: 'desc' } })
      : [],
    db.goal.findMany({ where: { level: { in: ['COMPANY', 'DEPARTMENT'] }, status: { not: 'CANCELED' } }, orderBy: { createdAt: 'desc' } }),
  ]);

  const reportIds = ctx.workerId ? await directReportIds(ctx.workerId) : [];
  const teamGoals = reportIds.length
    ? await db.goal.findMany({
        where: { workerId: { in: reportIds }, status: { not: 'CANCELED' } },
        include: { worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  return (
    <div>
      <PageHeader title="Goals" description="Individual goals aligned to company objectives." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="My goals" />
            {myGoals.length === 0 ? (
              <EmptyState title="No goals yet" description="Create a goal to track progress toward it." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {myGoals.map((g) => (
                  <GoalRow key={g.id} goal={g} editable />
                ))}
              </ul>
            )}
          </Card>

          {teamGoals.length > 0 ? (
            <Card>
              <CardHeader title="Team goals" />
              <ul className="divide-y divide-ink-100">
                {teamGoals.map((g) => (
                  <GoalRow key={g.id} goal={g} editable ownerName={g.worker ? fullName(g.worker) : undefined} />
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Company goals" />
            {companyGoals.length === 0 ? (
              <EmptyState title="No company goals published" />
            ) : (
              <ul className="divide-y divide-ink-100">
                {companyGoals.map((g) => (
                  <GoalRow key={g.id} goal={g} editable={isAdmin} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="New goal" />
          <CardBody>
            <GoalForm
              isAdmin={isAdmin}
              parents={companyGoals.map((g) => ({ value: g.id, label: g.title }))}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
