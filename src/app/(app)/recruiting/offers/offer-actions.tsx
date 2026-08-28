'use client';

import Link from 'next/link';
import { buttonClass } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { sendOfferAction, recordOfferResponseAction } from '../actions';

export function OfferActions({
  offerId,
  status,
  hiredWorkerId,
}: {
  offerId: string;
  status: string;
  hiredWorkerId: string | null;
}) {
  if (status === 'ACCEPTED' && hiredWorkerId) {
    return (
      <Link href={`/people/${hiredWorkerId}?tab=onboarding`} className={buttonClass('secondary', 'sm')}>
        View onboarding
      </Link>
    );
  }
  if (status === 'DRAFT') {
    return (
      <ActionForm action={sendOfferAction}>
        <input type="hidden" name="offerId" value={offerId} />
        <SubmitButton size="sm">Send to candidate</SubmitButton>
      </ActionForm>
    );
  }
  if (status === 'SENT') {
    return (
      <ActionForm action={recordOfferResponseAction} className="flex gap-1.5">
        <input type="hidden" name="offerId" value={offerId} />
        <SubmitButton name="response" value="ACCEPTED" size="sm">
          Accepted → hire
        </SubmitButton>
        <SubmitButton name="response" value="DECLINED" variant="dangerGhost" size="sm">
          Declined
        </SubmitButton>
      </ActionForm>
    );
  }
  if (status === 'PENDING_APPROVAL') {
    return <span className="text-[12px] text-ink-400">Awaiting approval</span>;
  }
  return null;
}
