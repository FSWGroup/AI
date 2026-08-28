'use client';

import { ActionForm, SubmitButton } from '@/components/ui/client';
import { acknowledgePolicyAction } from '../actions';

export function AcknowledgeForm({ versionId }: { versionId: string }) {
  return (
    <ActionForm action={acknowledgePolicyAction}>
      <input type="hidden" name="versionId" value={versionId} />
      <SubmitButton>I have read and acknowledge this policy</SubmitButton>
    </ActionForm>
  );
}
