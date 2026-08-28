'use client';

import { Field, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveFeedbackAction } from '../actions';

export function FeedbackForm({
  people,
  canHrNote,
}: {
  people: { value: string; label: string }[];
  canHrNote: boolean;
}) {
  return (
    <ActionForm action={saveFeedbackAction} className="space-y-3" resetOnSuccess>
      <Field label="About" htmlFor="fb-about" required>
        <Select id="fb-about" name="aboutId" required>
          {people.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Type" htmlFor="fb-kind">
        <Select id="fb-kind" name="kind">
          <option value="PRAISE">Recognition (visible to everyone)</option>
          <option value="FEEDBACK">Feedback (visible to their manager)</option>
          {canHrNote ? <option value="PRIVATE_HR">Private HR documentation</option> : null}
        </Select>
      </Field>
      <Field label="What happened?" htmlFor="fb-body" required>
        <Textarea id="fb-body" name="body" required className="min-h-24" />
      </Field>
      <SubmitButton className="w-full">Share</SubmitButton>
    </ActionForm>
  );
}
