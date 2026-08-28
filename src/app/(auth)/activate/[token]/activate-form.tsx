'use client';

import { useActionState } from 'react';
import { activateAccount, type ActionResult } from '../../actions';
import { Field, FormError, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function ActivateForm({ token }: { token: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(activateAccount, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="text-lg font-semibold text-ink-900">Welcome — set your password</h1>
      <p className="text-[13px] text-ink-500">
        Choose a password to activate your FSW People account. Use at least 10 characters with a mix of cases and a
        number or symbol.
      </p>
      <FormError message={state && 'error' in state ? state.error : undefined} />
      <input type="hidden" name="token" value={token} />
      <Field label="New password" htmlFor="password" required>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" required>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Activating…">
        Activate account
      </SubmitButton>
    </form>
  );
}
