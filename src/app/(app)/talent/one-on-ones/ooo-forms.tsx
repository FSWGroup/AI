'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveOneOnOneAction } from '../actions';

export function NewOneOnOneForm({ reports }: { reports: { value: string; label: string }[] }) {
  return (
    <ActionForm action={saveOneOnOneAction} className="space-y-3" resetOnSuccess>
      <Field label="With" htmlFor="ooo-report" required>
        <Select id="ooo-report" name="reportId" required>
          {reports.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="When" htmlFor="ooo-when" required>
        <Input id="ooo-when" name="scheduledAt" type="datetime-local" required />
      </Field>
      <Field label="Agenda" htmlFor="ooo-agenda">
        <Textarea id="ooo-agenda" name="agenda" className="min-h-14" />
      </Field>
      <SubmitButton className="w-full">Schedule</SubmitButton>
    </ActionForm>
  );
}

export function OneOnOneEditor({
  oooId,
  isManagerSide,
  agenda,
  sharedNotes,
  privateNotes,
  completed,
}: {
  oooId: string;
  isManagerSide: boolean;
  agenda: string | null;
  sharedNotes: string | null;
  privateNotes: string | null;
  completed: boolean;
}) {
  return (
    <ActionForm action={saveOneOnOneAction} className="space-y-3">
      <input type="hidden" name="oooId" value={oooId} />
      <Field label="Agenda & talking points (shared)" htmlFor={`ooo-a-${oooId}`}>
        <Textarea id={`ooo-a-${oooId}`} name="agenda" defaultValue={agenda ?? ''} className="min-h-16" />
      </Field>
      <Field label="Shared notes & action items" htmlFor={`ooo-s-${oooId}`}>
        <Textarea id={`ooo-s-${oooId}`} name="sharedNotes" defaultValue={sharedNotes ?? ''} className="min-h-16" />
      </Field>
      <Field
        label={`My private notes (visible only to ${isManagerSide ? 'the manager' : 'you'})`}
        htmlFor={`ooo-p-${oooId}`}
      >
        <Textarea
          id={`ooo-p-${oooId}`}
          name={isManagerSide ? 'managerNotes' : 'reportNotes'}
          defaultValue={privateNotes ?? ''}
          className="min-h-14"
        />
      </Field>
      <div className="flex gap-2">
        <SubmitButton variant="secondary" size="sm">
          Save notes
        </SubmitButton>
        {!completed ? (
          <SubmitButton name="complete" value="true" size="sm">
            Save & mark complete
          </SubmitButton>
        ) : null}
      </div>
    </ActionForm>
  );
}
