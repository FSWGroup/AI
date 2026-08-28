'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, Button, Field, Input, cx } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { completeSetupAction } from './actions';

const STEPS = [
  { key: 'org', title: 'Organization', detail: 'Name and branding for FSW People.' },
  { key: 'entities', title: 'Legal entities', detail: 'FS Welsford and ValveMan, plus any future subsidiaries.' },
  { key: 'locations', title: 'Locations & countries', detail: 'Exton HQ and remote Philippines, with timezones.' },
  { key: 'departments', title: 'Departments', detail: 'Sales, Operations, Warehouse, Accounting, CX, Engineering, HR, IT.' },
  { key: 'pto', title: 'PTO & holidays', detail: 'US vacation/sick policies plus US and Philippine holiday calendars.' },
  { key: 'workflows', title: 'Onboarding templates', detail: 'US employee and Philippines contractor checklists.' },
  { key: 'permissions', title: 'Roles & permissions', detail: 'Ten seeded roles from Super Admin to Auditor.' },
  { key: 'invite', title: 'Add your people', detail: 'Import a CSV or add workers one at a time.' },
];

export function SetupWizard({
  existing,
}: {
  existing: {
    orgName: string;
    entities: number;
    departments: number;
    locations: number;
    calendars: number;
    policies: number;
    templates: number;
  };
}) {
  const [step, setStep] = useState(0);

  const status: Record<string, boolean> = {
    org: true,
    entities: existing.entities > 0,
    locations: existing.locations > 0,
    departments: existing.departments > 0,
    pto: existing.policies > 0 && existing.calendars > 0,
    workflows: existing.templates > 0,
    permissions: true,
    invite: false,
  };

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
      <ol className="space-y-1 sm:col-span-1">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={cx(
                'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px]',
                step === i ? 'bg-brand-600 font-medium text-white' : 'text-ink-600 hover:bg-ink-100',
              )}
            >
              <span
                className={cx(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]',
                  status[s.key] ? 'bg-ok-500 text-white' : step === i ? 'bg-white/25 text-white' : 'bg-ink-200 text-ink-500',
                )}
              >
                {status[s.key] ? <Check size={10} /> : i + 1}
              </span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      <div className="sm:col-span-2">
        <h3 className="text-[15px] font-semibold text-ink-900">{STEPS[step].title}</h3>
        <p className="mt-1 mb-4 text-[13px] text-ink-500">{STEPS[step].detail}</p>

        {STEPS[step].key === 'org' ? (
          <ActionForm action={completeSetupAction} className="space-y-3">
            <input type="hidden" name="mode" value="save-org" />
            <Field label="Organization name" htmlFor="sw-name" required>
              <Input id="sw-name" name="orgName" defaultValue={existing.orgName} required />
            </Field>
            <SubmitButton variant="secondary">Save name</SubmitButton>
          </ActionForm>
        ) : STEPS[step].key === 'invite' ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-600">
              You can bulk-import workers from a CSV in the Import Center, or add them one at a time from the Directory.
              Either way, each person gets an activation email and their onboarding checklist starts automatically.
            </p>
            <ActionForm action={completeSetupAction} className="space-y-3">
              <input type="hidden" name="mode" value="finish" />
              <SubmitButton>Finish setup and open FSW People</SubmitButton>
            </ActionForm>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-ink-100 bg-ink-50 px-3.5 py-3 text-[13px]">
              {status[STEPS[step].key] ? (
                <span className="flex items-center gap-2 text-ok-500">
                  <Check size={14} /> Configured with sensible defaults — adjust any time in Settings.
                </span>
              ) : (
                <span className="text-warn-500">Not configured yet. You can set this up in Settings after finishing.</span>
              )}
            </div>
            {STEPS[step].key === 'entities' ? (
              <p className="text-[13px] text-ink-600">
                {existing.entities} legal entit{existing.entities === 1 ? 'y' : 'ies'} configured. Every worker belongs
                to one, and people can move between them without losing history.
              </p>
            ) : null}
            {STEPS[step].key === 'pto' ? (
              <p className="text-[13px] text-ink-600">
                {existing.policies} PTO polic{existing.policies === 1 ? 'y' : 'ies'} and {existing.calendars} holiday
                calendar{existing.calendars === 1 ? '' : 's'}. Balances are always derived from the transaction ledger,
                so they can never drift.
              </p>
            ) : null}
            {STEPS[step].key === 'permissions' ? (
              <div className="flex flex-wrap gap-1.5">
                {['Super Admin', 'HR Admin', 'Executive', 'Manager', 'Employee', 'Contractor', 'Payroll / Finance', 'Recruiter', 'IT Administrator', 'Auditor'].map((r) => (
                  <Badge key={r} tone="gray">{r}</Badge>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-5 flex justify-between border-t border-ink-100 pt-4">
          <Button type="button" variant="secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              Next
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
