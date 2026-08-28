'use client';

import { useActionState } from 'react';
import { resetPassword, type ActionResult } from '../../actions';
import { Field, FormError, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function ResetConfirmForm({ token }: { token: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(resetPassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="text-lg font-semibold text-ink-900">Choose a new password</h1>
      <FormError message={state && 'error' in state ? state.error : undefined} />
      <input type="hidden" name="token" value={token} />
      <Field label="New password" htmlFor="password" required>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" required>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
}
