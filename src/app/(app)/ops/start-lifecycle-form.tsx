'use client';

import { Field, Input, Select, Card, CardBody } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { startLifecycleAction } from './actions';

export function StartLifecycleForm({
  kind,
  workers,
  templates,
}: {
  kind: 'ONBOARDING' | 'OFFBOARDING';
  workers: { value: string; label: string }[];
  templates: { value: string; label: string }[];
}) {
  return (
    <Card>
      <CardBody>
        <ActionForm action={startLifecycleAction} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4" resetOnSuccess>
          <input type="hidden" name="kind" value={kind} />
          <Field label="Worker" htmlFor={`sl-worker-${kind}`} required>
            <Select id={`sl-worker-${kind}`} name="workerId" required defaultValue="">
              <option value="" disabled>
                Choose a worker…
              </option>
              {workers.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Template" htmlFor={`sl-tpl-${kind}`} hint="Blank = best match for the worker's population.">
            <Select id={`sl-tpl-${kind}`} name="templateId" defaultValue="">
              <option value="">Auto-select</option>
              {templates.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={kind === 'ONBOARDING' ? 'Start date' : 'Last day'} htmlFor={`sl-date-${kind}`} hint="Blank = worker's hire date.">
            <Input id={`sl-date-${kind}`} name="startDate" type="date" />
          </Field>
          <SubmitButton variant="secondary">Start {kind.toLowerCase()}</SubmitButton>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
