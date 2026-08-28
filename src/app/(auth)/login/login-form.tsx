'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { signIn, requestMagicLink, type ActionResult } from '../actions';
import { Field, FormError, FormSuccess, Input } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

export function LoginForm({ passwordWasReset }: { passwordWasReset: boolean }) {
  const [state, action] = useActionState<ActionResult, FormData>(signIn, undefined);
  const [magicMode, setMagicMode] = useState(false);

  // Frontline workers often have no password worth remembering — a link to
  // their own inbox is the practical control, not a sticky note on a monitor.
  if (magicMode) return <MagicLinkForm onBack={() => setMagicMode(false)} />;

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
      <p className="border-t border-ink-100 pt-3 text-center text-[13px]">
        <button type="button" onClick={() => setMagicMode(true)} className="text-brand-600 hover:underline">
          Email me a sign-in link instead
        </button>
      </p>
    </form>
  );
}

function MagicLinkForm({ onBack }: { onBack: () => void }) {
  const [state, action] = useActionState<ActionResult, FormData>(requestMagicLink, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="text-lg font-semibold text-ink-900">Email me a link</h1>
      <p className="text-[13px] text-ink-600">
        We will send a link that signs you in without a password. It works once and expires in 15 minutes.
      </p>
      <FormError message={state && 'error' in state ? state.error : undefined} />
      <FormSuccess message={state && 'success' in state ? state.success : undefined} />
      <Field label="Work email" htmlFor="magic-email" required>
        <Input id="magic-email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Sending…">
        Send the link
      </SubmitButton>
      <p className="text-center text-[13px]">
        <button type="button" onClick={onBack} className="text-brand-600 hover:underline">
          Back to password sign-in
        </button>
      </p>
    </form>
  );
}
