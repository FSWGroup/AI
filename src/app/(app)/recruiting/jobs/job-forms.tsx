'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, Drawer, SubmitButton } from '@/components/ui/client';
import { saveJobAction, setJobStatusAction } from '../actions';

interface Option {
  value: string;
  label: string;
}

export function JobForm({
  departments,
  entities,
  managers,
  job,
  onDone,
}: {
  departments: Option[];
  entities: Option[];
  managers: Option[];
  job?: Record<string, string>;
  onDone?: () => void;
}) {
  return (
    <ActionForm action={saveJobAction} className="space-y-3">
      {job?.id ? <input type="hidden" name="jobId" value={job.id} /> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title" htmlFor="jf-title" required>
          <Input id="jf-title" name="title" required defaultValue={job?.title} />
        </Field>
        <Field label="Location" htmlFor="jf-loc">
          <Input id="jf-loc" name="locationText" defaultValue={job?.locationText} placeholder="e.g. Exton, PA (onsite)" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Department" htmlFor="jf-dept">
          <Select id="jf-dept" name="departmentId" defaultValue={job?.departmentId ?? ''}>
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Company" htmlFor="jf-entity">
          <Select id="jf-entity" name="legalEntityId" defaultValue={job?.legalEntityId ?? ''}>
            <option value="">—</option>
            {entities.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Hiring manager" htmlFor="jf-hm">
          <Select id="jf-hm" name="hiringManagerId" defaultValue={job?.hiringManagerId ?? ''}>
            <option value="">—</option>
            {managers.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Worker type" htmlFor="jf-wtype">
          <Select id="jf-wtype" name="workerType" defaultValue={job?.workerType ?? 'EMPLOYEE'}>
            <option value="EMPLOYEE">Employee</option>
            <option value="CONTRACTOR">Contractor</option>
          </Select>
        </Field>
        <Field label="Openings" htmlFor="jf-count">
          <Input id="jf-count" name="headcount" type="number" min={1} defaultValue={job?.headcount ?? 1} />
        </Field>
        <Field label="Salary min" htmlFor="jf-min">
          <Input id="jf-min" name="salaryMin" type="number" step="0.01" defaultValue={job?.salaryMin} />
        </Field>
        <Field label="Salary max" htmlFor="jf-max">
          <Input id="jf-max" name="salaryMax" type="number" step="0.01" defaultValue={job?.salaryMax} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target start date" htmlFor="jf-target">
          <Input id="jf-target" name="targetDate" type="date" defaultValue={job?.targetDate} />
        </Field>
        <label className="flex items-center gap-2 pt-6 text-sm text-ink-700">
          <input type="checkbox" name="isReplacement" defaultChecked={job?.isReplacement === 'true'} className="h-4 w-4 rounded border-ink-300" />
          Replacement (backfill)
        </label>
      </div>
      <Field label="Description" htmlFor="jf-desc">
        <Textarea id="jf-desc" name="description" defaultValue={job?.description} />
      </Field>
      <Field label="Requirements" htmlFor="jf-req">
        <Textarea id="jf-req" name="requirements" defaultValue={job?.requirements} />
      </Field>
      <div className="flex justify-end gap-2">
        {onDone ? (
          <Button type="button" variant="secondary" onClick={onDone}>
            Close
          </Button>
        ) : null}
        <SubmitButton>{job?.id ? 'Save job' : 'Create job'}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function NewJobButton(props: { departments: Option[]; entities: Option[]; managers: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New job</Button>
      <Drawer title="New job requisition" open={open} onClose={() => setOpen(false)} wide>
        <JobForm {...props} onDone={() => setOpen(false)} />
      </Drawer>
    </>
  );
}

export function JobStatusForm({ jobId, status }: { jobId: string; status: string }) {
  return (
    <ActionForm action={setJobStatusAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      {status === 'DRAFT' ? (
        <>
          <SubmitButton name="status" value="PENDING_APPROVAL" size="sm" variant="secondary">
            Send for approval
          </SubmitButton>
          <SubmitButton name="status" value="OPEN" size="sm">
            Open now
          </SubmitButton>
        </>
      ) : null}
      {status === 'PENDING_APPROVAL' ? (
        <SubmitButton name="status" value="OPEN" size="sm">
          Mark approved & open
        </SubmitButton>
      ) : null}
      {status === 'OPEN' ? (
        <>
          <SubmitButton name="status" value="ON_HOLD" size="sm" variant="secondary">
            Put on hold
          </SubmitButton>
          <SubmitButton name="status" value="FILLED" size="sm" variant="secondary">
            Mark filled
          </SubmitButton>
          <SubmitButton name="status" value="CLOSED" size="sm" variant="dangerGhost">
            Close
          </SubmitButton>
        </>
      ) : null}
      {status === 'ON_HOLD' ? (
        <SubmitButton name="status" value="OPEN" size="sm">
          Reopen
        </SubmitButton>
      ) : null}
    </ActionForm>
  );
}
