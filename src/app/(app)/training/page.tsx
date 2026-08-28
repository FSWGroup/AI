import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate, fullName, humanize } from '@/lib/format';
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, THead, TH, TRow, TD } from '@/components/ui';
import { CourseForm, AssignForm, CompleteButtons } from './training-forms';

export const metadata: Metadata = { title: 'Training' };

export default async function TrainingPage() {
  const ctx = await requireCtx();
  const isAdmin = can(ctx, 'training.admin');

  const myAssignments = ctx.workerId
    ? await db.trainingAssignment.findMany({
        where: { workerId: ctx.workerId },
        include: { course: true },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      })
    : [];

  const [courses, allAssignments, workers] = isAdmin
    ? await Promise.all([
        db.trainingCourse.findMany({ where: { active: true }, orderBy: { title: 'asc' }, include: { _count: { select: { assignments: true } } } }),
        db.trainingAssignment.findMany({
          where: { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'] } },
          include: { course: true, worker: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } } },
          orderBy: { dueDate: 'asc' },
          take: 50,
        }),
        db.worker.findMany({
          where: { status: { in: ['ACTIVE', 'ONBOARDING'] }, deletedAt: null },
          select: { id: true, legalFirstName: true, preferredName: true, lastName: true },
          orderBy: { lastName: 'asc' },
        }),
      ])
    : [[], [], []];

  return (
    <div>
      <PageHeader title="Training" description="Assigned courses, due dates and completion records." />
      <div className="space-y-4">
        <Card>
          <CardHeader title="My training" />
          {myAssignments.length === 0 ? (
            <EmptyState title="No training assigned" description="Courses assigned to you will appear here." />
          ) : (
            <Table>
              <THead><TH>Course</TH><TH>Category</TH><TH>Due</TH><TH>Status</TH><TH></TH></THead>
              <tbody>
                {myAssignments.map((a) => (
                  <TRow key={a.id}>
                    <TD>
                      <span className="font-medium">{a.course.title}</span>
                      {a.course.contentUrl ? (
                        <a href={a.course.contentUrl} target="_blank" rel="noreferrer" className="ml-2 text-[12px] text-brand-600 hover:underline">
                          Open course ↗
                        </a>
                      ) : null}
                      {a.course.description ? <span className="block text-[12px] text-ink-400">{a.course.description}</span> : null}
                    </TD>
                    <TD>{humanize(a.course.category)}</TD>
                    <TD>{fmtDate(a.dueDate)}</TD>
                    <TD><StatusBadge status={a.status} /></TD>
                    <TD>
                      {a.status !== 'COMPLETED' && a.status !== 'WAIVED' ? <CompleteButtons assignmentId={a.id} status={a.status} /> : a.completedAt ? fmtDate(a.completedAt) : null}
                    </TD>
                  </TRow>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {isAdmin ? (
          <>
            <Card>
              <CardHeader title="Outstanding assignments (all workers)" />
              {allAssignments.length === 0 ? (
                <EmptyState title="Nothing outstanding" />
              ) : (
                <Table>
                  <THead><TH>Worker</TH><TH>Course</TH><TH>Due</TH><TH>Status</TH></THead>
                  <tbody>
                    {allAssignments.map((a) => (
                      <TRow key={a.id}>
                        <TD className="font-medium">{fullName(a.worker)}</TD>
                        <TD>{a.course.title}</TD>
                        <TD>{fmtDate(a.dueDate)}</TD>
                        <TD><StatusBadge status={a.status} /></TD>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Courses" />
                <Table>
                  <THead><TH>Course</TH><TH>Category</TH><TH>Recurs</TH><TH>Assigned</TH><TH>Assign</TH></THead>
                  <tbody>
                    {courses.map((c) => (
                      <TRow key={c.id}>
                        <TD className="font-medium">{c.title}</TD>
                        <TD>{humanize(c.category)}</TD>
                        <TD>{c.recurrenceMonths ? `${c.recurrenceMonths} mo` : 'one-time'}</TD>
                        <TD>{c._count.assignments}</TD>
                        <TD>
                          <AssignForm courseId={c.id} workers={workers.map((w) => ({ value: w.id, label: fullName(w) }))} />
                        </TD>
                      </TRow>
                    ))}
                  </tbody>
                </Table>
              </Card>
              <Card className="h-fit">
                <CardHeader title="New course" />
                <CardBody>
                  <CourseForm />
                </CardBody>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
