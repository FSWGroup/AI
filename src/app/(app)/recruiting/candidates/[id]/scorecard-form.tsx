'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { submitScorecardAction } from '../../actions';

export function ScorecardForm({ interviewId }: { interviewId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(true)}>
        Write my scorecard
      </Button>
    );
  }
  return (
    <ActionForm action={submitScorecardAction} className="mt-3 space-y-3 border-t border-ink-100 pt-3">
      <input type="hidden" name="interviewId" value={interviewId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rating (1–5)" htmlFor={`sc-rating-${interviewId}`}>
          <Input id={`sc-rating-${interviewId}`} name="rating" type="number" min={1} max={5} />
        </Field>
        <Field label="Recommendation" htmlFor={`sc-rec-${interviewId}`}>
          <Select id={`sc-rec-${interviewId}`} name="recommendation">
            <option value="">—</option>
            <option value="STRONG_YES">Strong yes</option>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
            <option value="STRONG_NO">Strong no</option>
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor={`sc-notes-${interviewId}`}>
        <Textarea id={`sc-notes-${interviewId}`} name="notes" />
      </Field>
      <div className="flex gap-2">
        <SubmitButton size="sm">Submit scorecard</SubmitButton>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}
