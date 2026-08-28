import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireCtx, can } from '@/lib/authz';
import { fmtDate, fullName, humanize } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, PageHeader, StatusBadge } from '@/components/ui';
import { ReviewForm, ShareButton } from './review-form';

export const metadata: Metadata = { title: 'Review' };

interface Question {
  id: string;
  text: string;
  type: string;
  forms: string[];
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;

  const review = await db.performanceReview.findUnique({
    where: { id },
    include: {
      cycle: true,
      subject: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
      author: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
    },
  });
  if (!review) notFound();

  const isAuthor = review.authorId === ctx.workerId;
  const isSubject = review.subjectId === ctx.workerId;
  const isAdmin = can(ctx, 'talent.admin');
  // The subject may only read once shared; authors and HR always can.
  if (!isAuthor && !isAdmin && !(isSubject && review.status === 'SHARED')) notFound();

  const questions = ((review.cycle?.questions ?? []) as unknown as Question[]).filter((q) =>
    q.forms.includes(review.form),
  );
  const answers = (review.answers ?? {}) as Record<string, string>;
  const editable = isAuthor && (review.status === 'NOT_STARTED' || review.status === 'IN_PROGRESS');

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        breadcrumbs={[{ label: 'Reviews', href: '/talent/reviews' }, { label: review.cycle?.name ?? 'Review' }]}
        title={review.form === 'SELF' ? `Self review — ${fullName(review.subject)}` : `${humanize(review.form)} review of ${fullName(review.subject)}`}
        description={`${review.cycle?.name ?? 'Ad hoc'} · by ${fullName(review.author)} · due ${fmtDate(review.cycle?.dueDate)}`}
        actions={
          <span className="flex items-center gap-2">
            {review.overallRating && !editable ? <Badge tone="blue">{review.overallRating}/5</Badge> : null}
            <StatusBadge status={review.status} />
          </span>
        }
      />
      <Card>
        <CardHeader title={editable ? 'Complete the review' : 'Responses'} />
        <CardBody>
          {editable ? (
            <ReviewForm
              reviewId={review.id}
              questions={questions}
              answers={answers}
              summary={review.summary}
            />
          ) : (
            <div className="space-y-5">
              {questions.map((q) => (
                <div key={q.id}>
                  <h3 className="text-[13px] font-semibold text-ink-700">{q.text}</h3>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-ink-800">
                    {q.type === 'RATING' && answers[q.id] ? `${answers[q.id]} / 5` : (answers[q.id] ?? '—')}
                  </p>
                </div>
              ))}
              {review.summary ? (
                <div>
                  <h3 className="text-[13px] font-semibold text-ink-700">Summary</h3>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-ink-800">{review.summary}</p>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>
      {isAuthor && review.status === 'SUBMITTED' && review.form !== 'SELF' ? (
        <div className="mt-4">
          <ShareButton reviewId={review.id} />
        </div>
      ) : null}
    </div>
  );
}
