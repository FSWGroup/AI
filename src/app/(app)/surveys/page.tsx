import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate, humanize } from '@/lib/format';
import { Badge, Callout, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { respondentKeyFor } from '@/lib/surveys';
import { SurveyForm, RespondForm } from './survey-forms';

export const metadata: Metadata = { title: 'Surveys' };

interface Question {
  id: string;
  text: string;
  type: 'SCALE' | 'TEXT' | 'ENPS';
}

export default async function SurveysPage() {
  const ctx = await requireCtx();
  const isAdmin = can(ctx, 'surveys.admin');

  const surveys = await db.survey.findMany({
    orderBy: { createdAt: 'desc' },
    include: { responses: true },
  });

  const openSurveys = surveys.filter((s) => s.status === 'OPEN');

  return (
    <div>
      <PageHeader title="Surveys" description="Pulse checks, engagement surveys and eNPS." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {openSurveys.length === 0 ? (
            <Card><EmptyState title="No open surveys" /></Card>
          ) : (
            openSurveys.map((s) => {
              const questions = (s.questions as unknown as Question[]) ?? [];
              const myKey = ctx.workerId ? respondentKeyFor(s.id, ctx.workerId, s.anonymous) : null;
              const responded = myKey ? s.responses.some((r) => r.respondentKey === myKey) : false;
              return (
                <Card key={s.id}>
                  <CardHeader
                    title={s.title}
                    description={`${humanize(s.kind)} · ${s.anonymous ? 'anonymous' : 'named'} · closes ${fmtDate(s.closesAt)}`}
                    actions={responded ? <Badge tone="green">Responded</Badge> : <StatusBadge status={s.status} />}
                  />
                  <CardBody>
                    {s.anonymous ? (
                      <p className="mb-3 text-[12px] text-ink-400">
                        Responses are anonymous — only a one-way hash prevents duplicates, and results stay hidden until
                        at least {s.minResponsesToShow} people respond.
                      </p>
                    ) : null}
                    {!responded && ctx.workerId ? (
                      <RespondForm surveyId={s.id} questions={questions} />
                    ) : (
                      <p className="text-[13px] text-ink-500">Thanks — your response is in.</p>
                    )}
                  </CardBody>
                </Card>
              );
            })
          )}

          {isAdmin
            ? surveys
                .filter((s) => s.responses.length > 0)
                .map((s) => {
                  const questions = (s.questions as unknown as Question[]) ?? [];
                  const enough = s.responses.length >= s.minResponsesToShow || !s.anonymous;
                  return (
                    <Card key={`results-${s.id}`}>
                      <CardHeader title={`Results: ${s.title}`} description={`${s.responses.length} responses`} />
                      <CardBody>
                        {!enough ? (
                          <Callout tone="warn">
                            Results are hidden until at least {s.minResponsesToShow} responses arrive, protecting
                            anonymity in small groups.
                          </Callout>
                        ) : (
                          <ul className="space-y-4">
                            {questions.map((q) => {
                              const answers = s.responses
                                .map((r) => (r.answers as Record<string, string | number>)[q.id])
                                .filter((a) => a !== undefined && a !== '');
                              if (q.type === 'TEXT') {
                                return (
                                  <li key={q.id}>
                                    <h4 className="text-[13px] font-semibold text-ink-700">{q.text}</h4>
                                    <ul className="mt-1 space-y-1">
                                      {answers.slice(0, 10).map((a, i) => (
                                        <li key={i} className="rounded bg-ink-50 px-3 py-1.5 text-[13px] text-ink-700">
                                          {String(a)}
                                        </li>
                                      ))}
                                    </ul>
                                  </li>
                                );
                              }
                              const nums = answers.map(Number).filter(Number.isFinite);
                              const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
                              return (
                                <li key={q.id} className="flex items-center justify-between">
                                  <span className="text-[13px] text-ink-700">{q.text}</span>
                                  <Badge tone="blue">
                                    avg {avg.toFixed(1)}{q.type === 'ENPS' ? ' / 10' : ' / 5'}
                                  </Badge>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </CardBody>
                    </Card>
                  );
                })
            : null}
        </div>

        {isAdmin ? (
          <Card className="h-fit">
            <CardHeader title="New survey" />
            <CardBody>
              <SurveyForm />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
