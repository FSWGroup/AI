'use client';

import { Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton, ConfirmSubmit } from '@/components/ui/client';
import { saveBandAction, deleteBandAction } from '../actions';

export function BandForm() {
  return (
    <ActionForm action={saveBandAction} className="grid grid-cols-2 gap-3 sm:grid-cols-7" resetOnSuccess>
      <Field label="Job family" htmlFor="bd-family" required>
        <Input id="bd-family" name="jobFamily" required />
      </Field>
      <Field label="Level" htmlFor="bd-level" required>
        <Input id="bd-level" name="jobLevel" required placeholder="IC2" />
      </Field>
      <Field label="Geography" htmlFor="bd-geo">
        <Select id="bd-geo" name="geography">
          <option value="US">US</option>
          <option value="PH">PH</option>
        </Select>
      </Field>
      <Field label="Currency" htmlFor="bd-cur">
        <Select id="bd-cur" name="currency">
          <option value="USD">USD</option>
          <option value="PHP">PHP</option>
        </Select>
      </Field>
      <Field label="Min" htmlFor="bd-min" required>
        <Input id="bd-min" name="minAmount" type="number" step="0.01" required />
      </Field>
      <Field label="Mid" htmlFor="bd-mid" required>
        <Input id="bd-mid" name="midAmount" type="number" step="0.01" required />
      </Field>
      <Field label="Max" htmlFor="bd-max" required>
        <Input id="bd-max" name="maxAmount" type="number" step="0.01" required />
      </Field>
      <div className="col-span-2 sm:col-span-7">
        <SubmitButton variant="secondary">Save band</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DeleteBandButton({ bandId }: { bandId: string }) {
  return (
    <ConfirmSubmit
      action={deleteBandAction}
      title="Delete this band?"
      description="Compa-ratios that reference it will show as undefined."
      confirmLabel="Delete"
      variant="dangerGhost"
      hiddenFields={{ bandId }}
    >
      Delete
    </ConfirmSubmit>
  );
}
