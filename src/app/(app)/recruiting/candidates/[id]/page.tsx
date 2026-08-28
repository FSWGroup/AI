import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireCtx, assertPermission, can } from '@/lib/authz';
import { fmtDate, fmtDateTime, fmtMoney, humanize } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader, StatusBadge } from '@/components/ui';
import { ScorecardForm } from './scorecard-form';
import { AiQuestionsPanel, ResumeTextEditor, type StoredQuestion } from './ai-questions';
import { aiEnabled } from '@/lib/ai/client';

export const metadata: Metadata = { title: 'Candidate' };

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  assertPermission(ctx, 'recruiting.read');
  const { id } = await params;

  const candidate = await db.candidate.findUnique({
    where: { id },
    include: {
      applications: {
        include: {
          requisition: true,
          stage: true,
          interviews: { include: { scorecards: true }, orderBy: { scheduledAt: 'asc' } },
          offers: { orderBy: { createdAt: 'desc' } },
          questionSets: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  });
  if (!candidate) notFound();

  const scorecardUsers = await db.user.findMany({
    where: {
      id: {
        in: candidate.applications.flatMap((a) => a.interviews.flatMap((i) => i.scorecards.map((s) => s.interviewerUserId))),
      },
    },
    select: { id: true, email: true, worker: { select: { legalFirstName: true, preferredName: true, lastName: true } } },
  });
  const nameFor = (uid: string) => {
    const u = scorecardUsers.find((x) => x.id === uid);
    return u?.worker ? `${u.worker.preferredName || u.worker.legalFirstName} ${u.worker.lastName}` : (u?.email ?? 'Interviewer');
  };

  // Who generated each question set — an AI-assisted recommendation has to
  // say whose account produced it (§16 audit trail).
  const generatorIds = [...new Set(candidate.applications.flatMap((a) => a.questionSets.map((q) => q.generatedById)))];
  const generators = generatorIds.length
    ? await db.user.findMany({
        where: { id: { in: generatorIds } },
        select: { id: true, email: true, worker: { select: { legalFirstName: true, preferredName: true, lastName: true } } },
      })
    : [];
  const generatorName = (uid: string) => {
    const u = generators.find((x) => x.id === uid);
    return u?.worker ? `${u.worker.preferredName || u.worker.legalFirstName} ${u.worker.lastName}` : (u?.email ?? 'a recruiter');
  };
  const canWrite = can(ctx, 'recruiting.write');

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Recruiting', href: '/recruiting/candidates' }, { label: `${candidate.firstName} ${candidate.lastName}` }]}
        title={`${candidate.firstName} ${candidate.lastName}`}
        description={candidate.email ?? undefined}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {candidate.applications.map((app) => (
            <Card key={app.id}>
              <CardHeader
                title={
                  <Link href={`/recruiting/jobs/${app.requisitionId}`} className="hover:text-brand-600">
                    {app.requisition.title}
                  </Link>
                }
                description={`Stage: ${app.stage.name} · applied ${fmtDate(app.createdAt)}`}
                actions={<StatusBadge status={app.status} />}
              />
              <CardBody className="space-y-4">
                {app.rejectionReason ? (
                  <p className="text-[13px] text-danger-500">Rejection reason: {app.rejectionReason}</p>
                ) : null}

                {app.interviews.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-[13px] font-semibold text-ink-700">Interviews & scorecards</h3>
                    {app.interviews.map((interview) => (
                      <div key={interview.id} className="rounded-md border border-ink-100 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-ink-900">{humanize(interview.kind)}</span>
                          <span className="text-[12px] text-ink-400">
                            {interview.scheduledAt ? fmtDateTime(interview.scheduledAt) : 'unscheduled'} · <StatusBadge status={interview.status} />
                          </span>
                        </div>
                        <ul className="mt-2 space-y-2">
                          {interview.scorecards.map((sc) => (
                            <li key={sc.id} className="rounded bg-ink-50 px-3 py-2 text-[13px]">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-ink-800">{nameFor(sc.interviewerUserId)}</span>
                                {sc.submittedAt ? (
                                  <span className="flex items-center gap-2">
                                    {sc.rating ? <Badge tone="blue">{sc.rating}/5</Badge> : null}
                                    {sc.recommendation ? (
                                      <Badge tone={sc.recommendation.includes('YES') ? 'green' : 'red'}>
                                        {humanize(sc.recommendation)}
                                      </Badge>
                                    ) : null}
                                  </span>
                                ) : (
                                  <Badge tone="amber">awaiting feedback</Badge>
                                )}
                              </div>
                              {sc.notes ? <p className="mt-1 whitespace-pre-wrap text-ink-600">{sc.notes}</p> : null}
                            </li>
                          ))}
                        </ul>
                        <ScorecardForm interviewId={interview.id} />
                      </div>
                    ))}
                  </div>
                ) : null}

                {canWrite ? (
                  <div>
                    <h3 className="mb-2 text-[13px] font-semibold text-ink-700">Suggested interview questions</h3>
                    <AiQuestionsPanel
                      applicationId={app.id}
                      jobTitle={app.requisition.title}
                      aiConfigured={aiEnabled()}
                      hasResume={Boolean(candidate.resumeText?.trim())}
                      latest={
                        app.questionSets[0]
                          ? {
                              id: app.questionSets[0].id,
                              createdAt: fmtDateTime(app.questionSets[0].createdAt),
                              model: app.questionSets[0].model,
                              generatedBy: generatorName(app.questionSets[0].generatedById),
                              redacted: readRedacted(app.questionSets[0].basis),
                              usedResume: readUsedResume(app.questionSets[0].basis),
                              questions: (app.questionSets[0].questions as unknown as StoredQuestion[]) ?? [],
                            }
                          : null
                      }
                    />
                  </div>
                ) : null}

                {app.offers.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-[13px] font-semibold text-ink-700">Offers</h3>
                    <ul className="space-y-1 text-sm">
                      {app.offers.map((o) => (
                        <li key={o.id} className="flex items-center justify-between">
                          <span>
                            {o.title} — {fmtMoney(Number(o.amount), o.currency)} / {o.rateType.toLowerCase()}
                            {o.startDate ? ` · starts ${fmtDate(o.startDate)}` : ''}
                          </span>
                          <StatusBadge status={o.status} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>

        <Card className="h-fit">
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Email', value: candidate.email ?? '—' },
                { label: 'Phone', value: candidate.phone ?? '—' },
                { label: 'Source', value: humanize(candidate.source) },
                { label: 'Referred by', value: candidate.referredBy ?? '—' },
                {
                  label: 'LinkedIn',
                  value: candidate.linkedinUrl ? (
                    <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                      Profile ↗
                    </a>
                  ) : ('—'),
                },
                { label: 'Added', value: fmtDate(candidate.createdAt) },
              ]}
            />
            {candidate.notes ? (
              <p className="mt-4 border-t border-ink-100 pt-3 text-[13px] whitespace-pre-wrap text-ink-600">{candidate.notes}</p>
            ) : null}
            {canWrite ? <ResumeTextEditor candidateId={candidate.id} resumeText={candidate.resumeText} /> : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/** The stored basis records what the model was actually shown. */
function readRedacted(basis: unknown): string[] {
  const value = basis && typeof basis === 'object' ? (basis as Record<string, unknown>).redacted : null;
  return Array.isArray(value) ? value.map(String) : [];
}

function readUsedResume(basis: unknown): boolean {
  return Boolean(basis && typeof basis === 'object' && (basis as Record<string, unknown>).usedResume);
}
