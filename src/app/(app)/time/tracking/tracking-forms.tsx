'use client';

import { Field, Input } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { clockAction, saveManualEntryAction, submitTimesheetAction, decideTimesheetAction } from '../actions';

export function ClockWidget({ clockedInSince }: { clockedInSince: string | null }) {
  return (
    <ActionForm action={clockAction} className="space-y-3">
      {clockedInSince ? (
        <>
          <p className="text-sm text-ink-700">
            Clocked in since{' '}
            <strong>{new Date(clockedInSince).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</strong>
          </p>
          <SubmitButton name="mode" value="out" variant="danger" className="w-full">
            Clock out
          </SubmitButton>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-500">You are not clocked in.</p>
          <SubmitButton name="mode" value="in" className="w-full">
            Clock in
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ManualEntryForm() {
  return (
    <ActionForm action={saveManualEntryAction} className="grid grid-cols-2 gap-3 sm:grid-cols-5" resetOnSuccess>
      <Field label="Date" htmlFor="me-date" required>
        <Input id="me-date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
      </Field>
      <Field label="Hours" htmlFor="me-hours" required>
        <Input id="me-hours" name="hours" type="number" step="0.25" min="0.25" max="24" required />
      </Field>
      <Field label="Project / job code" htmlFor="me-project">
        <Input id="me-project" name="projectCode" />
      </Field>
      <Field label="Note" htmlFor="me-note">
        <Input id="me-note" name="note" />
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="secondary">Add entry</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function SubmitTimesheetButton({ timesheetId }: { timesheetId: string }) {
  return (
    <form action={submitTimesheetAction}>
      <input type="hidden" name="timesheetId" value={timesheetId} />
      <SubmitButton variant="secondary" size="sm">
        Submit week for approval
      </SubmitButton>
    </form>
  );
}

export function TimesheetDecideForm({ timesheetId }: { timesheetId: string }) {
  return (
    <ActionForm action={decideTimesheetAction} className="flex gap-2">
      <input type="hidden" name="timesheetId" value={timesheetId} />
      <SubmitButton name="decision" value="APPROVED" size="sm">
        Approve
      </SubmitButton>
      <SubmitButton name="decision" value="REJECTED" variant="dangerGhost" size="sm">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}
