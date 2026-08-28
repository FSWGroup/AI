'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { publishPolicyAction } from './actions';

export function PolicyForm({ existing }: { existing: { value: string; label: string }[] }) {
  return (
    <ActionForm action={publishPolicyAction} className="space-y-3" resetOnSuccess>
      {existing.length > 0 ? (
        <Field label="Policy" htmlFor="po-policy" hint="Pick one to publish a new version, or leave blank for a new policy.">
          <Select id="po-policy" name="policyId" defaultValue="">
            <option value="">— New policy —</option>
            {existing.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Title (new policies)" htmlFor="po-title">
        <Input id="po-title" name="title" />
      </Field>
      <Field label="Category" htmlFor="po-cat">
        <Input id="po-cat" name="category" placeholder="Handbook, Safety, IT…" />
      </Field>
      <Field label="Policy text" htmlFor="po-body" required>
        <Textarea id="po-body" name="body" required className="min-h-32" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Effective date" htmlFor="po-eff">
          <Input id="po-eff" name="effectiveAt" type="date" />
        </Field>
        <Field label="Ack deadline (days)" htmlFor="po-deadline">
          <Input id="po-deadline" name="ackDeadlineDays" type="number" defaultValue={14} />
        </Field>
      </div>
      <Field label="Audience — worker types" htmlFor="po-types" hint="None selected = everyone.">
        <select id="po-types" name="workerTypes" multiple size={2} className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm">
          <option value="EMPLOYEE">Employees</option>
          <option value="CONTRACTOR">Contractors</option>
        </select>
      </Field>
      <Field label="Audience — countries" htmlFor="po-countries" hint="None selected = all countries.">
        <select id="po-countries" name="countries" multiple size={2} className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm">
          <option value="US">United States</option>
          <option value="PH">Philippines</option>
        </select>
      </Field>
      <SubmitButton className="w-full">Publish version</SubmitButton>
    </ActionForm>
  );
}
