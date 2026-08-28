import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, directReportIds } from '@/lib/authz';
import { fmtDateTime, fullName } from '@/lib/format';
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { NewOneOnOneForm, OneOnOneEditor } from './ooo-forms';

export const metadata: Metadata = { title: '1:1s' };

export default async function OneOnOnesPage() {
  const ctx = await requireCtx();
  if (!ctx.workerId) {
    return (
      <div>
        <PageHeader title="1:1s" />
        <Card><EmptyState title="Your account is not linked to a worker profile" /></Card>
      </div>
    );
  }

  const [meetings, reportIds] = await Promise.all([
    db.oneOnOne.findMany({
      where: { OR: [{ managerId: ctx.workerId }, { reportId: ctx.workerId }] },
      orderBy: { scheduledAt: 'desc' },
      take: 30,
      include: {
        manager: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
        report: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      },
    }),
    directReportIds(ctx.workerId),
  ]);
  const reports = reportIds.length
    ? await db.worker.findMany({
        where: { id: { in: reportIds } },
        select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
        orderBy: { lastName: 'asc' },
      })
    : [];

  return (
    <div>
      <PageHeader title="1:1s" description="Recurring conversations with shared agendas — plus private notes each side keeps." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {meetings.length === 0 ? (
            <Card><EmptyState title="No 1:1s yet" description={reports.length ? 'Schedule one with a report.' : 'Your manager can schedule a 1:1 with you.'} /></Card>
          ) : (
            meetings.map((m) => {
              const isManagerSide = m.managerId === ctx.workerId;
              const other = isManagerSide ? m.report : m.manager;
              return (
                <Card key={m.id}>
                  <CardHeader
                    title={`1:1 with ${fullName(other)}`}
                    description={fmtDateTime(m.scheduledAt)}
                    actions={<StatusBadge status={m.status} />}
                  />
                  <CardBody>
                    <OneOnOneEditor
                      oooId={m.id}
                      isManagerSide={isManagerSide}
                      agenda={m.agenda}
                      sharedNotes={m.sharedNotes}
                      privateNotes={isManagerSide ? m.managerNotes : m.reportNotes}
                      completed={m.status === 'COMPLETED'}
                    />
                  </CardBody>
                </Card>
              );
            })
          )}
        </div>
        {reports.length > 0 ? (
          <Card className="h-fit">
            <CardHeader title="Schedule a 1:1" />
            <CardBody>
              <NewOneOnOneForm reports={reports.map((r) => ({ value: r.id, label: fullName(r) }))} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
