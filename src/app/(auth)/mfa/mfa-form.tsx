'use client';

import { useActionState } from 'react';
import { verifyMfa, signOut, type ActionResult } from '../actions';
import { Field, FormError, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function MfaForm() {
  const [state, action] = useActionState<ActionResult, FormData>(verifyMfa, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="text-lg font-semibold text-ink-900">Two-factor authentication</h1>
      <p className="text-[13px] text-ink-500">Enter the 6-digit code from your authenticator app.</p>
      <FormError message={state && 'error' in state ? state.error : undefined} />
      <Field label="Authentication code" htmlFor="code" required>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          className="text-center text-lg tracking-[0.4em]"
        />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Verifying…">
        Verify
      </SubmitButton>
      <button formAction={signOut} formNoValidate className="w-full text-center text-[13px] text-ink-500 hover:text-brand-600">
        Use a different account
      </button>
    </form>
  );
}
