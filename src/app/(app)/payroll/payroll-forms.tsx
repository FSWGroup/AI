'use client';

import { Field, Input } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { createPeriodAction, setPeriodStatusAction } from './actions';

export function NewPeriodForm() {
  return (
    <ActionForm action={createPeriodAction} className="space-y-3" resetOnSuccess>
      <Field label="Period start" htmlFor="pp-start" required>
        <Input id="pp-start" name="periodStart" type="date" required />
      </Field>
      <Field label="Period end" htmlFor="pp-end" required>
        <Input id="pp-end" name="periodEnd" type="date" required />
      </Field>
      <Field label="Pay date" htmlFor="pp-pay" required>
        <Input id="pp-pay" name="payDate" type="date" required />
      </Field>
      <SubmitButton variant="secondary" className="w-full">
        Create period
      </SubmitButton>
    </ActionForm>
  );
}

export function PeriodStatusForm({ periodId, status }: { periodId: string; status: string }) {
  const next: Record<string, { value: string; label: string } | undefined> = {
    OPEN: { value: 'REVIEW', label: 'Move to review' },
    REVIEW: { value: 'APPROVED', label: 'Approve period' },
    APPROVED: { value: 'EXPORTED', label: 'Mark exported to provider' },
    EXPORTED: { value: 'CLOSED', label: 'Close period' },
  };
  const step = next[status];
  if (!step) return null;
  return (
    <ActionForm action={setPeriodStatusAction} className="flex items-center gap-2">
      <input type="hidden" name="periodId" value={periodId} />
      <SubmitButton name="status" value={step.value} variant="secondary" size="sm">
        {step.label}
      </SubmitButton>
    </ActionForm>
  );
}
