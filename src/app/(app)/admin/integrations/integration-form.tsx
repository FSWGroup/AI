'use client';

import { ActionForm, SubmitButton } from '@/components/ui/client';
import { saveIntegrationAction } from '../settings/actions';

export function IntegrationForm({
  kind,
  name,
  integrationId,
  enabled,
}: {
  kind: string;
  name: string;
  integrationId?: string;
  enabled: boolean;
}) {
  return (
    <ActionForm action={saveIntegrationAction} className="flex shrink-0 items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="name" value={name} />
      {integrationId ? <input type="hidden" name="integrationId" value={integrationId} /> : null}
      <label className="flex items-center gap-1.5 text-[12.5px] text-ink-600">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="h-4 w-4 rounded border-ink-300" />
        Enabled
      </label>
      <SubmitButton variant="secondary" size="sm">
        Save
      </SubmitButton>
    </ActionForm>
  );
}
