'use client';

import { Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveAssetAction, assignAssetAction, returnAssetAction } from './actions';

export function AssetForm() {
  return (
    <ActionForm action={saveAssetAction} className="grid grid-cols-2 gap-3 sm:grid-cols-7" resetOnSuccess>
      <Field label="Type" htmlFor="ea-kind">
        <Select id="ea-kind" name="kind">
          {['LAPTOP', 'MONITOR', 'PHONE', 'HEADSET', 'KEYS', 'ACCESS_CARD', 'TOOL', 'VEHICLE', 'OTHER'].map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Asset tag" htmlFor="ea-tag" required>
        <Input id="ea-tag" name="assetTag" required placeholder="FSW-LT-0001" />
      </Field>
      <Field label="Serial #" htmlFor="ea-serial">
        <Input id="ea-serial" name="serialNumber" />
      </Field>
      <Field label="Make" htmlFor="ea-make">
        <Input id="ea-make" name="make" />
      </Field>
      <Field label="Model" htmlFor="ea-model">
        <Input id="ea-model" name="model" />
      </Field>
      <Field label="Value (USD)" htmlFor="ea-value">
        <Input id="ea-value" name="valueUsd" type="number" step="0.01" />
      </Field>
      <Field label="Condition" htmlFor="ea-cond">
        <Select id="ea-cond" name="condition">
          {['NEW', 'GOOD', 'FAIR', 'POOR'].map((c) => (
            <option key={c} value={c}>
              {c.toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <div className="col-span-2 sm:col-span-7">
        <SubmitButton variant="secondary">Add asset</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AssignAssetForm({
  assetId,
  workers,
  preselect,
}: {
  assetId: string;
  workers: { value: string; label: string }[];
  preselect?: string;
}) {
  return (
    <ActionForm action={assignAssetAction} className="flex items-center gap-1.5">
      <input type="hidden" name="assetId" value={assetId} />
      <Select name="workerId" aria-label="Assign to worker" defaultValue={preselect ?? ''} className="h-7 w-40 py-0 text-[12px]">
        <option value="" disabled>
          Assign to…
        </option>
        {workers.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary" size="sm" className="h-7 px-2 text-[12px]">
        Assign
      </SubmitButton>
    </ActionForm>
  );
}

export function ReturnForm({ assignmentId }: { assignmentId: string }) {
  return (
    <ActionForm action={returnAssetAction} className="flex items-center gap-1.5">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Select name="condition" aria-label="Returned condition" className="h-7 w-24 py-0 text-[12px]">
        {['GOOD', 'FAIR', 'POOR', 'LOST'].map((c) => (
          <option key={c} value={c}>
            {c.toLowerCase()}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary" size="sm" className="h-7 px-2 text-[12px]">
        Return
      </SubmitButton>
    </ActionForm>
  );
}
