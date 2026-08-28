'use client';

import { Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { electBenefitAction, savePlanAction } from './actions';

export function EnrollForm({ planId }: { planId: string }) {
  return (
    <ActionForm action={electBenefitAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="planId" value={planId} />
      <Field label="Coverage" htmlFor={`en-cov-${planId}`}>
        <Select id={`en-cov-${planId}`} name="coverageLevel" className="h-8 text-[13px]">
          <option value="EMPLOYEE">Employee only</option>
          <option value="EMPLOYEE_SPOUSE">Employee + spouse</option>
          <option value="EMPLOYEE_CHILDREN">Employee + children</option>
          <option value="FAMILY">Family</option>
        </Select>
      </Field>
      <SubmitButton name="election" value="ENROLLED" size="sm">
        Enroll
      </SubmitButton>
      <SubmitButton name="election" value="WAIVED" variant="secondary" size="sm">
        Waive
      </SubmitButton>
    </ActionForm>
  );
}

export function PlanForm() {
  return (
    <ActionForm action={savePlanAction} className="grid grid-cols-2 gap-3 sm:grid-cols-6" resetOnSuccess>
      <Field label="Type" htmlFor="pl-kind">
        <Select id="pl-kind" name="kind">
          {['MEDICAL', 'DENTAL', 'VISION', 'LIFE', 'DISABILITY', 'RETIREMENT_401K', 'HSA', 'FSA', 'OTHER'].map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Plan name" htmlFor="pl-name" required>
        <Input id="pl-name" name="name" required />
      </Field>
      <Field label="Provider" htmlFor="pl-provider">
        <Input id="pl-provider" name="provider" />
      </Field>
      <Field label="Employee cost / mo" htmlFor="pl-ec">
        <Input id="pl-ec" name="employeeCostMonthly" type="number" step="0.01" />
      </Field>
      <Field label="Employer cost / mo" htmlFor="pl-erc">
        <Input id="pl-erc" name="employerCostMonthly" type="number" step="0.01" />
      </Field>
      <Field label="Waiting period (days)" htmlFor="pl-wait">
        <Input id="pl-wait" name="waitingPeriodDays" type="number" defaultValue={30} />
      </Field>
      <div className="col-span-2 sm:col-span-6">
        <SubmitButton variant="secondary">Add plan</SubmitButton>
      </div>
    </ActionForm>
  );
}
