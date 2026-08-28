'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signIn, type ActionResult } from '../actions';
import { Field, FormError, FormSuccess, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function LoginForm({ passwordWasReset }: { passwordWasReset: boolean }) {
  const [state, action] = useActionState<ActionResult, FormData>(signIn, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="text-lg font-semibold text-ink-900">Sign in</h1>
      {passwordWasReset ? <FormSuccess message="Password updated. Sign in with your new password." /> : null}
      <FormError message={state && 'error' in state ? state.error : undefined} />
      <Field label="Work email" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
      <p className="text-center text-[13px]">
        <Link href="/reset" className="text-brand-600 hover:underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
