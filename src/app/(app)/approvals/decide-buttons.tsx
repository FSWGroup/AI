'use client';

import { ActionForm, SubmitButton } from '@/components/ui/client';
import { Input } from '@/components/ui';
import { decideApprovalAction } from './actions';

export function DecideButtons({ requestId }: { requestId: string }) {
  return (
    <ActionForm action={decideApprovalAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <Input name="note" placeholder="Note (optional)" aria-label="Decision note" className="h-8 w-44 text-[13px]" />
      <SubmitButton name="decision" value="APPROVED" size="sm">
        Approve
      </SubmitButton>
      <SubmitButton name="decision" value="REJECTED" variant="dangerGhost" size="sm">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}
