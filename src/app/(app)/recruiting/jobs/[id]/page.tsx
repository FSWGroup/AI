import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtDate, fmtMoney, fullName, humanize } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, PageHeader, StatusBadge } from '@/components/ui';
import { JobStatusForm } from '../job-forms';
import { AddCandidateButton, ApplicationCardActions } from './pipeline-ui';

export const metadata: Metadata = { title: 'Job pipeline' };

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'recruiting.read');
  const { id } = await params;

  const job = await db.jobRequisition.findUnique({
    where: { id },
    include: {
      applications: {
        include: {
          candidate: true,
          stage: true,
          interviews: { include: { scorecards: true }, orderBy: { scheduledAt: 'asc' } },
          offers: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  });
  if (!job) notFound();

  const stages = await db.pipelineStage.findMany({ orderBy: { order: 'asc' } });
  const [hiringManager, recruiter] = await Promise.all([
    job.hiringManagerId ? db.worker.findUnique({ where: { id: job.hiringManagerId } }) : null,
    job.recruiterId ? db.worker.findUnique({ where: { id: job.recruiterId } }) : null,
  ]);
  const canWrite = can(ctx, 'recruiting.write');
  const active = job.applications.filter((a) => a.status === 'ACTIVE' || a.status === 'HIRED');
  const rejected = job.applications.filter((a) => a.status === 'REJECTED' || a.status === 'WITHDRAWN');

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Recruiting', href: '/recruiting/jobs' }, { label: job.title }]}
        title={job.title}
        description={
          <>
            {job.locationText ?? 'Location TBD'} · {humanize(job.workerType)} ·{' '}
            {job.salaryMin || job.salaryMax
              ? `${fmtMoney(Number(job.salaryMin ?? 0))} – ${fmtMoney(Number(job.salaryMax ?? 0))}`
              : 'no range set'}{' '}
            · HM: {hiringManager ? fullName(hiringManager) : '—'} · Recruiter: {recruiter ? fullName(recruiter) : '—'}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={job.status} />
            {canWrite ? <AddCandidateButton requisitionId={job.id} /> : null}
          </div>
        }
      />

      {canWrite ? (
        <div className="mb-4">
          <JobStatusForm jobId={job.id} status={job.status} />
        </div>
      ) : null}

      <div className="fsw-scroll -mx-1 flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const apps = active.filter((a) => a.stageId === stage.id);
          return (
            <section key={stage.id} className="w-64 shrink-0" aria-label={`${stage.name} stage`}>
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-[13px] font-semibold text-ink-700">{stage.name}</h2>
                <span className="rounded-full bg-ink-100 px-2 text-[12px] text-ink-500 tabular-nums">{apps.length}</span>
              </div>
              <div className="space-y-2">
                {apps.map((app) => (
                  <div key={app.id} className="rounded-card border border-ink-200/80 bg-white p-3 shadow-card">
                    <Link href={`/recruiting/candidates/${app.candidateId}`} className="text-sm font-semibold text-ink-900 hover:text-brand-600">
                      {app.candidate.firstName} {app.candidate.lastName}
                    </Link>
                    <div className="mt-0.5 text-[12px] text-ink-400">
                      {app.candidate.source ? humanize(app.candidate.source) : 'Direct'} · added {fmtDate(app.createdAt)}
                    </div>
                    {app.interviews.length > 0 ? (
                      <div className="mt-1 text-[12px] text-ink-500">
                        {app.interviews.length} interview{app.interviews.length > 1 ? 's' : ''} ·{' '}
                        {app.interviews.flatMap((i) => i.scorecards).filter((s) => s.submittedAt).length} scorecards in
                      </div>
                    ) : null}
                    {app.status === 'HIRED' ? <Badge tone="green">Hired</Badge> : null}
                    {app.offers[0] ? (
                      <div className="mt-1">
                        <StatusBadge status={app.offers[0].status} />
                      </div>
                    ) : null}
                    {canWrite && app.status === 'ACTIVE' ? (
                      <ApplicationCardActions
                        applicationId={app.id}
                        currentStageId={app.stageId}
                        stages={stages.map((s) => ({ value: s.id, label: s.name }))}
                        hasOffer={app.offers.length > 0}
                        jobTitle={job.title}
                      />
                    ) : null}
                  </div>
                ))}
                {apps.length === 0 ? (
                  <div className="rounded-card border border-dashed border-ink-200 px-3 py-5 text-center text-[12px] text-ink-300">
                    No candidates
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {rejected.length > 0 ? (
        <Card className="mt-2">
          <CardHeader title={`Not moving forward (${rejected.length})`} />
          <CardBody>
            <ul className="space-y-1 text-sm text-ink-500">
              {rejected.map((app) => (
                <li key={app.id}>
                  <Link href={`/recruiting/candidates/${app.candidateId}`} className="text-ink-700 hover:text-brand-600">
                    {app.candidate.firstName} {app.candidate.lastName}
                  </Link>{' '}
                  — {app.rejectionReason ?? humanize(app.status)}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
