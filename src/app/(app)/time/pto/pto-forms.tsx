'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton, ConfirmSubmit } from '@/components/ui/client';
import { requestPtoAction, decidePtoAction, cancelPtoAction, adjustBalanceAction } from '../actions';

export function PtoRequestForm({ policies }: { policies: { value: string; label: string }[] }) {
  return (
    <ActionForm action={requestPtoAction} className="grid grid-cols-2 gap-3 sm:grid-cols-6" resetOnSuccess>
      <Field label="Policy" htmlFor="pto-policy" required>
        <Select id="pto-policy" name="policyId" required>
          {policies.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="First day" htmlFor="pto-start" required>
        <Input id="pto-start" name="startDate" type="date" required />
      </Field>
      <Field label="Last day" htmlFor="pto-end" required>
        <Input id="pto-end" name="endDate" type="date" required />
      </Field>
      <Field label="Hours (optional)" htmlFor="pto-hours" hint="Blank = auto from working days.">
        <Input id="pto-hours" name="hours" type="number" step="0.5" min="0.5" />
      </Field>
      <Field label="Note" htmlFor="pto-note">
        <Input id="pto-note" name="note" />
      </Field>
      <div className="flex items-end">
        <SubmitButton>Request</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PtoDecideForm({ requestId }: { requestId: string }) {
  return (
    <ActionForm action={decidePtoAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <Input name="note" placeholder="Note (optional)" aria-label="Decision note" className="h-8 w-40 text-[13px]" />
      <SubmitButton name="decision" value="APPROVED" size="sm">
        Approve
      </SubmitButton>
      <SubmitButton name="decision" value="DENIED" variant="dangerGhost" size="sm">
        Deny
      </SubmitButton>
    </ActionForm>
  );
}

export function CancelPtoButton({ requestId }: { requestId: string }) {
  return (
    <ConfirmSubmit
      action={cancelPtoAction}
      title="Cancel this time off request?"
      description="If it was already approved, the hours are returned to your balance."
      confirmLabel="Cancel request"
      variant="dangerGhost"
      hiddenFields={{ requestId }}
    >
      Cancel
    </ConfirmSubmit>
  );
}

export function AdjustBalanceForm({
  workers,
  policies,
}: {
  workers: { value: string; label: string }[];
  policies: { value: string; label: string }[];
}) {
  return (
    <ActionForm action={adjustBalanceAction} className="grid grid-cols-2 gap-3 sm:grid-cols-5" resetOnSuccess>
      <Field label="Worker" htmlFor="adj-worker" required>
        <Select id="adj-worker" name="workerId" required>
          {workers.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Policy" htmlFor="adj-policy" required>
        <Select id="adj-policy" name="policyId" required>
          {policies.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Hours (±)" htmlFor="adj-hours" required>
        <Input id="adj-hours" name="hours" type="number" step="0.5" required />
      </Field>
      <Field label="Reason" htmlFor="adj-note" required>
        <Textarea id="adj-note" name="note" required className="min-h-9" />
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="secondary">Adjust</SubmitButton>
      </div>
    </ActionForm>
  );
}
