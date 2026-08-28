'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestPasswordReset, type ActionResult } from '../actions';
import { Field, FormError, FormSuccess, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function ResetRequestForm() {
  const [state, action] = useActionState<ActionResult, FormData>(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="text-lg font-semibold text-ink-900">Reset your password</h1>
      <p className="text-[13px] text-ink-500">We&apos;ll email you a link to choose a new password.</p>
      <FormSuccess message={state && 'success' in state ? state.success : undefined} />
      <FormError message={state && 'error' in state ? state.error : undefined} />
      <Field label="Work email" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
      <p className="text-center text-[13px]">
        <Link href="/login" className="text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
