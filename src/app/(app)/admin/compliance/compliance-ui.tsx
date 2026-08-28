'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, Modal, SubmitButton } from '@/components/ui/client';
import {
  saveComplianceRuleAction,
  syncComplianceAction,
  setComplianceItemStatusAction,
  saveRetentionPolicyAction,
  approveDestructionAction,
} from './actions';

export function SyncButton() {
  return (
    <ActionForm action={syncComplianceAction}>
      <SubmitButton variant="secondary" pendingLabel="Syncing…">
        Sync compliance items
      </SubmitButton>
    </ActionForm>
  );
}

export function RuleForm() {
  return (
    <ActionForm action={saveComplianceRuleAction} className="space-y-3" resetOnSuccess>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Rule name" htmlFor="cr-name" required>
          <Input id="cr-name" name="name" required />
        </Field>
        <Field label="Category" htmlFor="cr-cat">
          <Select id="cr-cat" name="category">
            {['ONBOARDING_FORMS', 'WORK_AUTHORIZATION', 'RECORDS', 'WAGE_HOUR', 'POLICY', 'TRAINING', 'BENEFITS', 'CONTRACTOR', 'RETENTION'].map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Jurisdiction" htmlFor="cr-juris" hint="e.g. US-FED, US-PA, PH">
          <Input id="cr-juris" name="jurisdiction" defaultValue="US-FED" />
        </Field>
      </div>
      <Field label="Description / requirement" htmlFor="cr-desc" required>
        <Textarea id="cr-desc" name="description" required className="min-h-16" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Authoritative source" htmlFor="cr-source" hint="USCIS, IRS, DOL, EEOC, NPC…">
          <Input id="cr-source" name="source" />
        </Field>
        <Field label="Source URL" htmlFor="cr-url">
          <Input id="cr-url" name="sourceUrl" type="url" placeholder="https://www.uscis.gov/i-9" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Applies to countries" htmlFor="cr-countries">
          <select id="cr-countries" name="countries" multiple size={2} className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm">
            <option value="US">United States</option>
            <option value="PH">Philippines</option>
          </select>
        </Field>
        <Field label="Worker types" htmlFor="cr-types">
          <select id="cr-types" name="workerTypes" multiple size={2} className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm">
            <option value="EMPLOYEE">Employee</option>
            <option value="CONTRACTOR">Contractor</option>
          </select>
        </Field>
        <Field label="Work states" htmlFor="cr-states" hint="Comma separated, e.g. PA,NJ">
          <Input id="cr-states" name="workStates" />
        </Field>
        <Field label="Severity" htmlFor="cr-sev">
          <Select id="cr-sev" name="severity" defaultValue="MEDIUM">
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Deadline anchor" htmlFor="cr-anchor">
          <Select id="cr-anchor" name="anchor">
            <option value="HIRE_DATE">Hire date</option>
            <option value="TERMINATION_DATE">Termination date</option>
            <option value="FIXED_DATE">Fixed date</option>
          </Select>
        </Field>
        <Field label="Offset (days)" htmlFor="cr-offset">
          <Input id="cr-offset" name="offsetDays" type="number" defaultValue={0} />
        </Field>
        <Field label="Responsible role" htmlFor="cr-owner">
          <Select id="cr-owner" name="ownerRoleKey" defaultValue="HR_ADMIN">
            {['HR_ADMIN', 'IT_ADMIN', 'FINANCE', 'SUPER_ADMIN'].map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next review date" htmlFor="cr-review" hint="Laws change — schedule a re-check.">
          <Input id="cr-review" name="nextReviewAt" type="date" />
        </Field>
      </div>
      <SubmitButton>Save rule</SubmitButton>
    </ActionForm>
  );
}

export function ItemStatusForm({ itemId }: { itemId: string }) {
  return (
    <ActionForm action={setComplianceItemStatusAction} className="flex gap-1.5">
      <input type="hidden" name="itemId" value={itemId} />
      <SubmitButton name="status" value="COMPLETED" variant="secondary" size="sm" className="h-7 px-2 text-[12px]">
        Complete
      </SubmitButton>
      <SubmitButton name="status" value="WAIVED" variant="ghost" size="sm" className="h-7 px-2 text-[12px]">
        Waive
      </SubmitButton>
    </ActionForm>
  );
}

export function RetentionForm() {
  return (
    <ActionForm action={saveRetentionPolicyAction} className="grid grid-cols-2 gap-3 sm:grid-cols-6" resetOnSuccess>
      <Field label="Record type" htmlFor="rp-type" required>
        <Select id="rp-type" name="recordType" required>
          {['PERSONNEL', 'PAYROLL', 'TIMEKEEPING', 'RECRUITING', 'TAX_FORM', 'I9', 'PERFORMANCE', 'DISCIPLINARY', 'CONTRACTOR'].map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Jurisdiction" htmlFor="rp-juris">
        <Input id="rp-juris" name="jurisdiction" defaultValue="US-FED" />
      </Field>
      <Field label="Anchor" htmlFor="rp-anchor">
        <Select id="rp-anchor" name="anchor">
          <option value="TERMINATION">Termination</option>
          <option value="CREATION">Record creation</option>
          <option value="HIRE">Hire</option>
        </Select>
      </Field>
      <Field label="Retain (years)" htmlFor="rp-years" required>
        <Input id="rp-years" name="retainYears" type="number" step="0.5" min="0.5" required />
      </Field>
      <Field label="Source URL" htmlFor="rp-url">
        <Input id="rp-url" name="sourceUrl" type="url" />
      </Field>
      <Field label="Note" htmlFor="rp-note">
        <Input id="rp-note" name="note" />
      </Field>
      <div className="col-span-2 sm:col-span-6">
        <SubmitButton variant="secondary">Save retention policy</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DestructionForm({ workerId, name }: { workerId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="dangerGhost" size="sm" onClick={() => setOpen(true)}>
        Approve destruction
      </Button>
      <Modal title={`Destroy restricted data — ${name}`} open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] leading-relaxed text-ink-600">
          This permanently deletes encrypted identifiers, bank details, emergency contacts and restricted personal
          fields. Employment history, compensation history and audit records are preserved. This cannot be undone.
        </p>
        <ActionForm action={approveDestructionAction} className="space-y-3">
          <input type="hidden" name="workerId" value={workerId} />
          <Field label="Documented reason" htmlFor={`dr-${workerId}`} required>
            <Textarea id={`dr-${workerId}`} name="reason" required placeholder="Retention period elapsed; approved by…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton variant="danger" size="sm">
              Approve & destroy
            </SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
