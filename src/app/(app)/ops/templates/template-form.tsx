'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveTemplateAction } from '../actions';

export function TemplateForm({
  template,
}: {
  template?: {
    id: string;
    kind: string;
    name: string;
    description: string | null;
    isDefault: boolean;
    countries: string[];
    workerTypes: string[];
  };
}) {
  return (
    <ActionForm action={saveTemplateAction} className="grid grid-cols-1 gap-3 sm:grid-cols-3" resetOnSuccess={!template}>
      {template ? <input type="hidden" name="templateId" value={template.id} /> : null}
      <Field label="Name" htmlFor="tf-name" required>
        <Input id="tf-name" name="name" required defaultValue={template?.name} />
      </Field>
      <Field label="Kind" htmlFor="tf-kind">
        <Select id="tf-kind" name="kind" defaultValue={template?.kind ?? 'ONBOARDING'}>
          <option value="ONBOARDING">Onboarding</option>
          <option value="OFFBOARDING">Offboarding</option>
        </Select>
      </Field>
      <label className="flex items-center gap-2 pt-6 text-sm text-ink-700">
        <input type="checkbox" name="isDefault" defaultChecked={template?.isDefault} className="h-4 w-4 rounded border-ink-300" />
        Default fallback template
      </label>
      <Field label="Countries (applies to)" htmlFor="tf-countries" hint="None selected = all countries.">
        <select
          id="tf-countries"
          name="countries"
          multiple
          defaultValue={template?.countries ?? []}
          className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm"
          size={2}
        >
          <option value="US">United States</option>
          <option value="PH">Philippines</option>
        </select>
      </Field>
      <Field label="Worker types (applies to)" htmlFor="tf-types" hint="None selected = all worker types.">
        <select
          id="tf-types"
          name="workerTypes"
          multiple
          defaultValue={template?.workerTypes ?? []}
          className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm"
          size={2}
        >
          <option value="EMPLOYEE">Employee</option>
          <option value="CONTRACTOR">Contractor</option>
          <option value="EOR">EOR</option>
          <option value="AGENCY">Agency</option>
        </select>
      </Field>
      <Field label="Description" htmlFor="tf-desc">
        <Textarea id="tf-desc" name="description" defaultValue={template?.description ?? ''} className="min-h-9" />
      </Field>
      <div className="sm:col-span-3">
        <SubmitButton variant="secondary">{template ? 'Save template' : 'Create template'}</SubmitButton>
      </div>
    </ActionForm>
  );
}
