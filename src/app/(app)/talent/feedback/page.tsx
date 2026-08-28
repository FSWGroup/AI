import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, can, allReportIds } from '@/lib/authz';
import { fmtDate, fullName, humanize } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { FeedbackForm } from './feedback-form';
import type { Prisma } from '@/generated/prisma/client';

export const metadata: Metadata = { title: 'Feedback' };

export default async function FeedbackPage() {
  const ctx = await requireCtx();

  // Visibility: PUBLIC praise for everyone; feedback about me (visibility SUBJECT);
  // feedback about my reports (MANAGER); HR sees HR-visibility items.
  const reportIds = ctx.workerId ? await allReportIds(ctx.workerId) : [];
  const or: Prisma.FeedbackWhereInput[] = [{ kind: 'PRAISE', visibility: 'PUBLIC' }];
  if (ctx.workerId) {
    or.push({ aboutId: ctx.workerId, visibility: 'SUBJECT' });
    or.push({ authorId: ctx.workerId });
  }
  if (reportIds.length) or.push({ aboutId: { in: reportIds }, visibility: 'MANAGER' });
  if (can(ctx, 'cases.read')) or.push({ visibility: 'HR' });

  const feedback = await db.feedback.findMany({
    where: { OR: or },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      about: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      author: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
    },
  });

  const people = await db.worker.findMany({
    where: { status: { in: ['ACTIVE', 'ONBOARDING'] }, deletedAt: null, id: { not: ctx.workerId ?? undefined } },
    select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
    orderBy: { lastName: 'asc' },
  });

  return (
    <div>
      <PageHeader title="Feedback & recognition" description="Public praise, private feedback to managers, and HR documentation." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Feed" description="You only see feedback your role allows." />
          {feedback.length === 0 ? (
            <EmptyState title="No feedback yet" description="Recognize a teammate to get things started." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {feedback.map((f) => (
                <li key={f.id} className="px-5 py-3.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge tone={f.kind === 'PRAISE' ? 'green' : f.kind === 'PRIVATE_HR' ? 'red' : 'blue'}>
                      {f.kind === 'PRAISE' ? '🎉 praise' : humanize(f.kind).toLowerCase()}
                    </Badge>
                    <span className="font-medium text-ink-900">{fullName(f.about)}</span>
                    <span className="text-ink-400">from {fullName(f.author)}</span>
                    <span className="ml-auto text-[12px] text-ink-400">{fmtDate(f.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-sm whitespace-pre-wrap text-ink-700">{f.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Give feedback" />
          <CardBody>
            <FeedbackForm
              people={people.map((p) => ({ value: p.id, label: fullName(p) }))}
              canHrNote={can(ctx, 'cases.write')}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
