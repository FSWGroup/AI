'use client';

import { Field, Input, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveReviewAction, shareReviewAction } from '../../actions';

export function ReviewForm({
  reviewId,
  questions,
  answers,
  summary,
}: {
  reviewId: string;
  questions: { id: string; text: string; type: string }[];
  answers: Record<string, string>;
  summary: string | null;
}) {
  return (
    <ActionForm action={saveReviewAction} className="space-y-5" id={`review-${reviewId}`}>
      <input type="hidden" name="reviewId" value={reviewId} />
      {questions.map((q) => (
        <Field key={q.id} label={q.text} htmlFor={`ans-${q.id}`}>
          {q.type === 'RATING' ? (
            <Input
              id={`ans-${q.id}`}
              name={`answer_${q.id}`}
              type="number"
              min={1}
              max={5}
              defaultValue={answers[q.id]}
              className="w-24"
            />
          ) : (
            <Textarea id={`ans-${q.id}`} name={`answer_${q.id}`} defaultValue={answers[q.id]} className="min-h-24" />
          )}
        </Field>
      ))}
      <Field label="Summary (optional)" htmlFor="rv-summary">
        <Textarea id="rv-summary" name="summary" defaultValue={summary ?? ''} />
      </Field>
      <div className="flex gap-2">
        <SubmitButton name="submit" value="false" variant="secondary">
          Save draft
        </SubmitButton>
        <SubmitButton name="submit" value="true">
          Submit review
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ShareButton({ reviewId }: { reviewId: string }) {
  return (
    <form action={shareReviewAction}>
      <input type="hidden" name="reviewId" value={reviewId} />
      <SubmitButton variant="secondary">Share with employee</SubmitButton>
    </form>
  );
}
