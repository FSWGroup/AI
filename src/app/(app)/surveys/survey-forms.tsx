'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { createSurveyAction, respondSurveyAction } from './actions';

export function SurveyForm() {
  return (
    <ActionForm action={createSurveyAction} className="space-y-3" resetOnSuccess>
      <Field label="Title" htmlFor="sv-title" required>
        <Input id="sv-title" name="title" required />
      </Field>
      <Field label="Kind" htmlFor="sv-kind">
        <Select id="sv-kind" name="kind">
          <option value="PULSE">Pulse</option>
          <option value="ENGAGEMENT">Engagement</option>
          <option value="ENPS">eNPS</option>
          <option value="CUSTOM">Custom</option>
        </Select>
      </Field>
      <Field label="Closes" htmlFor="sv-closes">
        <Input id="sv-closes" name="closesAt" type="date" />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="anonymous" defaultChecked className="h-4 w-4 rounded border-ink-300" />
        Anonymous responses
      </label>
      <Field label="Questions (one per line; end with [scale], [enps] or [text])" htmlFor="sv-questions" required>
        <Textarea
          id="sv-questions"
          name="questions"
          required
          className="min-h-24"
          placeholder={'How are you feeling about work this week? [scale]\nWhat should we improve? [text]'}
        />
      </Field>
      <SubmitButton className="w-full">Open survey</SubmitButton>
    </ActionForm>
  );
}

export function RespondForm({
  surveyId,
  questions,
}: {
  surveyId: string;
  questions: { id: string; text: string; type: string }[];
}) {
  return (
    <ActionForm action={respondSurveyAction} className="space-y-4">
      <input type="hidden" name="surveyId" value={surveyId} />
      {questions.map((q) => (
        <Field key={q.id} label={q.text} htmlFor={`sq-${q.id}`}>
          {q.type === 'TEXT' ? (
            <Textarea id={`sq-${q.id}`} name={`q_${q.id}`} className="min-h-16" />
          ) : (
            <Select id={`sq-${q.id}`} name={`q_${q.id}`} defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {(q.type === 'ENPS' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5]).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ))}
      <SubmitButton>Submit response</SubmitButton>
    </ActionForm>
  );
}
