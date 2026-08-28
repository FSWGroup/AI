'use client';

import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton, ConfirmSubmit } from '@/components/ui/client';
import {
  saveWorkflowAction,
  toggleWorkflowAction,
  deleteWorkflowAction,
  runMaintenanceAction,
  installTemplateAction,
} from './actions';

interface Option {
  value: string;
  label: string;
}

const ACTION_TYPES = [
  { value: 'CREATE_TASK', label: 'Create a task' },
  { value: 'SEND_EMAIL', label: 'Send an email' },
  { value: 'NOTIFY_USER', label: 'Notify a person' },
  { value: 'NOTIFY_ROLE', label: 'Notify a role queue' },
  { value: 'ASSIGN_TRAINING', label: 'Assign training' },
  { value: 'ASSIGN_POLICY', label: 'Assign a policy to acknowledge' },
  { value: 'REQUEST_DOCUMENT', label: 'Request a document' },
  { value: 'START_ONBOARDING', label: 'Start onboarding' },
  { value: 'START_OFFBOARDING', label: 'Start offboarding' },
  { value: 'WEBHOOK', label: 'Call configured webhooks' },
];

function ActionRow({
  index,
  courses,
  policies,
  onRemove,
}: {
  index: number;
  courses: Option[];
  policies: Option[];
  onRemove: () => void;
}) {
  const [type, setType] = useState('CREATE_TASK');
  const needsText = ['CREATE_TASK', 'SEND_EMAIL', 'NOTIFY_USER', 'NOTIFY_ROLE', 'REQUEST_DOCUMENT'].includes(type);
  const needsOwner = ['CREATE_TASK', 'SEND_EMAIL', 'NOTIFY_USER', 'NOTIFY_ROLE'].includes(type);
  const needsRef = type === 'ASSIGN_TRAINING' || type === 'ASSIGN_POLICY';

  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold tracking-wide text-ink-500 uppercase">Action {index + 1}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove action ${index + 1}`}>
          <Trash2 size={14} />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Then…" htmlFor={`wa-type-${index}`}>
          <Select id={`wa-type-${index}`} name="actionType" value={type} onChange={(e) => setType(e.target.value)}>
            {ACTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        {needsText ? (
          <Field label="Title / subject" htmlFor={`wa-title-${index}`} hint="{{worker}} and {{detail}} are substituted.">
            <Input id={`wa-title-${index}`} name="actionTitle" defaultValue="" />
          </Field>
        ) : (
          <input type="hidden" name="actionTitle" value="" />
        )}
        {needsOwner ? (
          <Field label="Who" htmlFor={`wa-owner-${index}`}>
            <Select id={`wa-owner-${index}`} name="actionOwner">
              {type === 'SEND_EMAIL' ? (
                <>
                  <option value="WORKER">The worker</option>
                  <option value="MANAGER">Their manager</option>
                </>
              ) : type === 'NOTIFY_USER' ? (
                <>
                  <option value="MANAGER">Their manager</option>
                  <option value="EMPLOYEE">The worker</option>
                </>
              ) : (
                <>
                  <option value="role:HR_ADMIN">HR queue</option>
                  <option value="role:IT_ADMIN">IT queue</option>
                  <option value="role:FINANCE">Finance queue</option>
                  <option value="MANAGER">Their manager</option>
                  <option value="EMPLOYEE">The worker</option>
                </>
              )}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="actionOwner" value="" />
        )}
        {needsRef ? (
          <Field label={type === 'ASSIGN_TRAINING' ? 'Course' : 'Policy'} htmlFor={`wa-ref-${index}`}>
            <Select id={`wa-ref-${index}`} name="actionRefId">
              {(type === 'ASSIGN_TRAINING' ? courses : policies).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="actionRefId" value="" />
        )}
        {type === 'CREATE_TASK' || type === 'REQUEST_DOCUMENT' ? (
          <Field label="Due in (days)" htmlFor={`wa-due-${index}`}>
            <Input id={`wa-due-${index}`} name="actionDue" type="number" defaultValue={type === 'CREATE_TASK' ? 3 : 7} />
          </Field>
        ) : (
          <input type="hidden" name="actionDue" value="" />
        )}
        {type === 'CREATE_TASK' ? (
          <>
            <Field label="Category" htmlFor={`wa-cat-${index}`}>
              <Select id={`wa-cat-${index}`} name="actionCategory">
                {['GENERAL', 'ONBOARDING', 'OFFBOARDING', 'COMPLIANCE', 'IT_ACCESS', 'EQUIPMENT', 'TRAINING', 'DOCUMENT', 'HR'].map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor={`wa-pri-${index}`}>
              <Select id={`wa-pri-${index}`} name="actionPriority" defaultValue="NORMAL">
                {['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map((p) => (
                  <option key={p} value={p}>
                    {p.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <>
            <input type="hidden" name="actionCategory" value="GENERAL" />
            <input type="hidden" name="actionPriority" value="NORMAL" />
          </>
        )}
        {needsText ? (
          <Field label="Body / description" htmlFor={`wa-body-${index}`} className="col-span-2 sm:col-span-4">
            <Textarea id={`wa-body-${index}`} name="actionBody" className="min-h-12" />
          </Field>
        ) : (
          <input type="hidden" name="actionBody" value="" />
        )}
      </div>
    </div>
  );
}

export function WorkflowBuilder({
  triggers,
  departments,
  courses,
  policies,
}: {
  triggers: string[];
  departments: Option[];
  courses: Option[];
  policies: Option[];
}) {
  const [rows, setRows] = useState<number[]>([0]);
  const [nextId, setNextId] = useState(1);

  return (
    <ActionForm action={saveWorkflowAction} className="space-y-4" resetOnSuccess>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Workflow name" htmlFor="wf-name" required>
          <Input id="wf-name" name="name" required />
        </Field>
        <Field label="When this happens…" htmlFor="wf-trigger" required>
          <Select id="wf-trigger" name="trigger" required>
            {triggers.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" htmlFor="wf-desc">
          <Input id="wf-desc" name="description" />
        </Field>
      </div>

      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-[13px] font-medium text-ink-700">Only for… (leave blank for everyone)</legend>
        <Field label="Countries" htmlFor="wf-countries">
          <select id="wf-countries" name="countries" multiple size={2} className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm">
            <option value="US">United States</option>
            <option value="PH">Philippines</option>
          </select>
        </Field>
        <Field label="Worker types" htmlFor="wf-types">
          <select id="wf-types" name="workerTypes" multiple size={2} className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm">
            <option value="EMPLOYEE">Employee</option>
            <option value="CONTRACTOR">Contractor</option>
            <option value="EOR">EOR</option>
            <option value="AGENCY">Agency</option>
          </select>
        </Field>
        <Field label="Departments" htmlFor="wf-depts">
          <select id="wf-depts" name="departmentIds" multiple size={2} className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm">
            {departments.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <div className="space-y-3">
        {rows.map((id, i) => (
          <ActionRow
            key={id}
            index={i}
            courses={courses}
            policies={policies}
            onRemove={() => setRows((r) => (r.length > 1 ? r.filter((x) => x !== id) : r))}
          />
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setRows((r) => [...r, nextId]);
            setNextId((n) => n + 1);
          }}
        >
          <Plus size={14} /> Add another action
        </Button>
      </div>

      <SubmitButton>Save workflow</SubmitButton>
    </ActionForm>
  );
}

export function ToggleWorkflow({ workflowId, enabled }: { workflowId: string; enabled: boolean }) {
  return (
    <form action={toggleWorkflowAction}>
      <input type="hidden" name="workflowId" value={workflowId} />
      <SubmitButton variant="ghost" size="sm">
        {enabled ? 'Disable' : 'Enable'}
      </SubmitButton>
    </form>
  );
}

export function DeleteWorkflow({ workflowId }: { workflowId: string }) {
  return (
    <ConfirmSubmit
      action={deleteWorkflowAction}
      title="Delete this workflow?"
      description="Its run history is deleted with it. Disabling instead keeps the record."
      confirmLabel="Delete"
      variant="dangerGhost"
      hiddenFields={{ workflowId }}
    >
      Delete
    </ConfirmSubmit>
  );
}

export function RunMaintenanceButton() {
  return (
    <ActionForm action={runMaintenanceAction}>
      <SubmitButton variant="secondary" pendingLabel="Running sweep…">
        Run daily sweep now
      </SubmitButton>
    </ActionForm>
  );
}

export function InstallTemplateButton({ templateKey }: { templateKey: string }) {
  return (
    <ActionForm action={installTemplateAction}>
      <input type="hidden" name="templateKey" value={templateKey} />
      <SubmitButton variant="secondary" size="sm">
        Install
      </SubmitButton>
    </ActionForm>
  );
}
