import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate, fullName, humanize } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';
import { NewCycleForm } from './cycle-form';

export const metadata: Metadata = { title: 'Reviews' };

export default async function ReviewsPage() {
  const ctx = await requireCtx();
  const isAdmin = can(ctx, 'talent.admin');

  const [toWrite, aboutMe, cycles] = await Promise.all([
    ctx.workerId
      ? db.performanceReview.findMany({
          where: { authorId: ctx.workerId, status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED'] } },
          include: {
            subject: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
            cycle: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [],
    ctx.workerId
      ? db.performanceReview.findMany({
          where: { subjectId: ctx.workerId, OR: [{ status: 'SHARED' }, { authorId: ctx.workerId }] },
          include: { cycle: true, author: { select: { legalFirstName: true, preferredName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        })
      : [],
    db.reviewCycle.findMany({
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { reviews: true } } },
    }),
  ]);

  // Calibration snapshot (admin): rating distribution across submitted manager reviews
  const distribution = isAdmin
    ? await db.performanceReview.groupBy({
        by: ['overallRating'],
        where: { form: 'MANAGER', overallRating: { not: null }, status: { in: ['SUBMITTED', 'SHARED'] } },
        _count: true,
      })
    : [];

  return (
    <div>
      <PageHeader title="Performance reviews" description="Write your reviews, read what's been shared with you." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={`Reviews to write (${toWrite.filter((r) => r.status !== 'SUBMITTED').length})`} />
            {toWrite.length === 0 ? (
              <EmptyState title="Nothing to write" description="Review forms assigned to you appear here when a cycle launches." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {toWrite.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <Link href={`/talent/reviews/${r.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-600">
                        {r.form === 'SELF' ? 'Self review' : `Review of ${fullName(r.subject)}`}
                      </Link>
                      <div className="text-[12px] text-ink-400">
                        {r.cycle?.name ?? 'Ad hoc'} · due {fmtDate(r.cycle?.dueDate)}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="My reviews" description="Self reviews and manager reviews shared with you." />
            {aboutMe.length === 0 ? (
              <EmptyState title="No reviews yet" />
            ) : (
              <ul className="divide-y divide-ink-100">
                {aboutMe.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <Link href={`/talent/reviews/${r.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-600">
                        {humanize(r.form)} review — {r.cycle?.name ?? 'Ad hoc'}
                      </Link>
                      <div className="text-[12px] text-ink-400">
                        by {fullName(r.author)} {r.sharedAt ? `· shared ${fmtDate(r.sharedAt)}` : ''}
                      </div>
                    </div>
                    <span className="flex items-center gap-2">
                      {r.overallRating && r.status === 'SHARED' ? <Badge tone="blue">{r.overallRating}/5</Badge> : null}
                      <StatusBadge status={r.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {isAdmin ? (
            <Card>
              <CardHeader title="Cycles" />
              <Table>
                <THead><TH>Cycle</TH><TH>Kind</TH><TH>Window</TH><TH>Forms</TH><TH>Status</TH></THead>
                <tbody>
                  {cycles.map((c) => (
                    <TRow key={c.id}>
                      <TD className="font-medium">{c.name}</TD>
                      <TD>{humanize(c.kind)}</TD>
                      <TD>{fmtDate(c.startDate)} – {fmtDate(c.dueDate)}</TD>
                      <TD>{c._count.reviews}</TD>
                      <TD><StatusBadge status={c.status} /></TD>
                    </TRow>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {isAdmin ? (
            <Card>
              <CardHeader title="Launch a review cycle" description="Creates self + manager forms for every active employee." />
              <CardBody>
                <NewCycleForm />
              </CardBody>
            </Card>
          ) : null}
          {isAdmin && distribution.length > 0 ? (
            <Card>
              <CardHeader title="Calibration — rating distribution" />
              <CardBody>
                <ul className="space-y-2">
                  {[5, 4, 3, 2, 1].map((rating) => {
                    const row = distribution.find((d) => d.overallRating === rating);
                    const count = row?._count ?? 0;
                    const max = Math.max(1, ...distribution.map((d) => d._count));
                    return (
                      <li key={rating} className="flex items-center gap-2 text-[13px]">
                        <span className="w-6 text-ink-500">{rating}★</span>
                        <div className="h-3 flex-1 overflow-hidden rounded bg-ink-100">
                          <div className="h-full bg-brand-600" style={{ width: `${(count / max) * 100}%` }} />
                        </div>
                        <span className="w-6 text-right text-ink-500 tabular-nums">{count}</span>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
