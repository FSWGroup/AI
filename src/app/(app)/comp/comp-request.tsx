'use client';

import { useState } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { ActionForm, Modal, SubmitButton } from '@/components/ui/client';
import { requestCompChangeAction } from './actions';

/**
 * Compensation change via the approval engine: the request routes to an
 * Executive approver and only executes once approved (§22, §37).
 */
export function CompChangeRequestButton({
  workerId,
  workerName,
  currency,
  rateType,
}: {
  workerId: string;
  workerName: string;
  currency: string;
  rateType: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Request change
      </Button>
      <Modal title={`Compensation change — ${workerName}`} open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-500">Routes to executive approval; applies automatically once approved.</p>
        <ActionForm action={requestCompChangeAction} className="space-y-3">
          <input type="hidden" name="workerId" value={workerId} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="New amount" htmlFor={`cr-amount-${workerId}`} required>
              <Input id={`cr-amount-${workerId}`} name="amount" type="number" step="0.01" min="0" required />
            </Field>
            <Field label="Currency" htmlFor={`cr-cur-${workerId}`}>
              <Select id={`cr-cur-${workerId}`} name="currency" defaultValue={currency}>
                {['USD', 'PHP'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Rate" htmlFor={`cr-rate-${workerId}`}>
              <Select id={`cr-rate-${workerId}`} name="rateType" defaultValue={rateType}>
                {['ANNUAL', 'MONTHLY', 'HOURLY', 'DAILY'].map((r) => (
                  <option key={r} value={r}>
                    {r.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reason" htmlFor={`cr-reason-${workerId}`}>
              <Select id={`cr-reason-${workerId}`} name="reason">
                {['MERIT', 'PROMOTION', 'MARKET', 'COST_OF_LIVING', 'ADJUSTMENT'].map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Effective date" htmlFor={`cr-eff-${workerId}`} required>
              <Input id={`cr-eff-${workerId}`} name="effectiveFrom" type="date" required />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="sm">Submit for approval</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
