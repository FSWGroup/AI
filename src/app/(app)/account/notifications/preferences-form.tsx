'use client';

import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveNotificationPrefsAction } from './actions';

function Toggle({ name, label, description, defaultChecked }: { name: string; label: string; description: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 rounded border-ink-300" />
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        <span className="block text-[12px] text-ink-500">{description}</span>
      </span>
    </label>
  );
}

export function PreferencesForm({
  emailTasks,
  emailApprovals,
  emailGeneral,
}: {
  emailTasks: boolean;
  emailApprovals: boolean;
  emailGeneral: boolean;
}) {
  return (
    <ActionForm action={saveNotificationPrefsAction} className="space-y-4">
      <Toggle name="emailTasks" label="Tasks assigned to me" description="Onboarding, IT and HR tasks that land in my queue." defaultChecked={emailTasks} />
      <Toggle name="emailApprovals" label="Approvals waiting on me" description="PTO, offers, compensation changes and headcount requests." defaultChecked={emailApprovals} />
      <Toggle name="emailGeneral" label="General updates" description="Reviews shared with me, recognition and company news." defaultChecked={emailGeneral} />
      <SubmitButton>Save preferences</SubmitButton>
    </ActionForm>
  );
}
