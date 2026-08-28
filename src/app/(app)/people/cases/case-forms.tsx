'use client';

import { Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveHrCaseAction, addCaseNoteAction } from '@/app/(app)/talent/actions';

const CASE_TYPES = ['COACHING', 'VERBAL_WARNING', 'WRITTEN_WARNING', 'FINAL_WARNING', 'PIP', 'INVESTIGATION', 'COMPLAINT', 'INCIDENT', 'CORRECTIVE_ACTION'];

export function NewCaseForm({ workers }: { workers: { value: string; label: string }[] }) {
  return (
    <ActionForm action={saveHrCaseAction} className="space-y-3" resetOnSuccess>
      <Field label="Worker" htmlFor="hc-worker" required>
        <Select id="hc-worker" name="workerId" required>
          {workers.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Case type" htmlFor="hc-type">
        <Select id="hc-type" name="caseType">
          {CASE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title" htmlFor="hc-title" required>
        <Input id="hc-title" name="title" required />
      </Field>
      <Field label="Description" htmlFor="hc-desc">
        <Textarea id="hc-desc" name="description" className="min-h-20" />
      </Field>
      <Field label="Follow-up date" htmlFor="hc-follow">
        <Input id="hc-follow" name="followUpDate" type="date" />
      </Field>
      <SubmitButton className="w-full">Open case</SubmitButton>
    </ActionForm>
  );
}

export function CaseUpdateForm({
  caseId,
  status,
  resolution,
  followUpDate,
}: {
  caseId: string;
  status: string;
  resolution: string | null;
  followUpDate: string;
}) {
  return (
    <ActionForm action={saveHrCaseAction} className="grid grid-cols-2 gap-3">
      <input type="hidden" name="caseId" value={caseId} />
      <Field label="Status" htmlFor="hc-status">
        <Select id="hc-status" name="status" defaultValue={status}>
          {['OPEN', 'MONITORING', 'RESOLVED', 'CLOSED'].map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Follow-up date" htmlFor="hc-follow2">
        <Input id="hc-follow2" name="followUpDate" type="date" defaultValue={followUpDate} />
      </Field>
      <Field label="Resolution" htmlFor="hc-res" className="col-span-2">
        <Textarea id="hc-res" name="resolution" defaultValue={resolution ?? ''} className="min-h-14" />
      </Field>
      <div className="col-span-2">
        <SubmitButton variant="secondary" size="sm">
          Save case
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CaseNoteForm({ caseId }: { caseId: string }) {
  return (
    <ActionForm action={addCaseNoteAction} className="mt-3 space-y-2" resetOnSuccess>
      <input type="hidden" name="caseId" value={caseId} />
      <Textarea name="body" aria-label="Add case note" placeholder="Add a confidential case note…" className="min-h-14" />
      <SubmitButton variant="secondary" size="sm">
        Add note
      </SubmitButton>
    </ActionForm>
  );
}
