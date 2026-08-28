'use client';

import { useState } from 'react';
import { Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { createCycleAction } from '../actions';

export function NewCycleForm() {
  // Lazy initializers keep render pure — dates are read once on mount.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [inSixWeeks] = useState(() => new Date(Date.now() + 42 * 86_400_000).toISOString().slice(0, 10));
  const [year] = useState(() => new Date().getFullYear());
  return (
    <ActionForm action={createCycleAction} className="space-y-3" resetOnSuccess>
      <Field label="Cycle name" htmlFor="cy-name" required>
        <Input id="cy-name" name="name" required placeholder={`${year} Annual Review`} />
      </Field>
      <Field label="Kind" htmlFor="cy-kind">
        <Select id="cy-kind" name="kind">
          {['ANNUAL', 'SEMIANNUAL', 'QUARTERLY', 'DAY_30', 'DAY_60', 'DAY_90', 'PROBATION', 'PROMOTION', 'AD_HOC'].map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opens" htmlFor="cy-start">
          <Input id="cy-start" name="startDate" type="date" defaultValue={today} />
        </Field>
        <Field label="Due" htmlFor="cy-due">
          <Input id="cy-due" name="dueDate" type="date" defaultValue={inSixWeeks} />
        </Field>
      </div>
      <SubmitButton className="w-full">Launch cycle</SubmitButton>
    </ActionForm>
  );
}
