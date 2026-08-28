'use client';

import { Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton, ConfirmSubmit } from '@/components/ui/client';
import { saveAppAction, grantAccessAction, revokeAccessAction } from './actions';

export function AppForm() {
  return (
    <ActionForm action={saveAppAction} className="grid grid-cols-2 gap-3 sm:grid-cols-6" resetOnSuccess>
      <Field label="Name" htmlFor="ap-name" required>
        <Input id="ap-name" name="name" required placeholder="e.g. Prophet 21" />
      </Field>
      <Field label="Category" htmlFor="ap-cat">
        <Input id="ap-cat" name="category" placeholder="ERP, CRM…" />
      </Field>
      <Field label="Cost / seat / mo" htmlFor="ap-cost">
        <Input id="ap-cost" name="monthlyCostPerSeat" type="number" step="0.01" />
      </Field>
      <Field label="Renewal date" htmlFor="ap-renew">
        <Input id="ap-renew" name="renewalDate" type="date" />
      </Field>
      <Field label="Provisioning note" htmlFor="ap-note">
        <Input id="ap-note" name="provisioningNote" placeholder="Who sets accounts up" />
      </Field>
      <label className="flex items-center gap-2 pt-6 text-sm text-ink-700">
        <input type="checkbox" name="autoProvision" className="h-4 w-4 rounded border-ink-300" />
        Provision at onboarding
      </label>
      <div className="col-span-2 sm:col-span-6">
        <SubmitButton variant="secondary">Save application</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function GrantForm({
  appId,
  workers,
  preselect,
}: {
  appId: string;
  workers: { value: string; label: string }[];
  preselect?: string;
}) {
  return (
    <ActionForm action={grantAccessAction} className="flex items-center gap-1.5">
      <input type="hidden" name="appId" value={appId} />
      <Select name="workerId" aria-label="Grant access to" defaultValue={preselect ?? ''} className="h-8 w-44 py-0 text-[13px]">
        <option value="" disabled>
          Grant to…
        </option>
        {workers.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </Select>
      <Select name="accessLevel" aria-label="Access level" className="h-8 w-24 py-0 text-[13px]">
        <option value="USER">user</option>
        <option value="ADMIN">admin</option>
        <option value="READONLY">read-only</option>
      </Select>
      <SubmitButton variant="secondary" size="sm">
        Grant
      </SubmitButton>
    </ActionForm>
  );
}

export function RevokeButton({ grantId }: { grantId: string }) {
  return (
    <ConfirmSubmit
      action={revokeAccessAction}
      title="Revoke this access?"
      description="Marks the grant revoked in the system of record. Remember to disable the account in the application itself."
      confirmLabel="Revoke"
      variant="dangerGhost"
      hiddenFields={{ grantId }}
    >
      Revoke
    </ConfirmSubmit>
  );
}
