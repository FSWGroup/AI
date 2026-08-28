'use client';

import { useActionState, useState } from 'react';
import { beginMfaEnrollment, confirmMfaEnrollment, disableMfa, type ActionResult } from '@/app/(auth)/actions';
import { Badge, Button, Field, FormError, FormSuccess, Input } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';

export function MfaSection({ enabled }: { enabled: boolean }) {
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, confirmAction] = useActionState<ActionResult, FormData>(confirmMfaEnrollment, undefined);

  if (confirmState && 'success' in confirmState) {
    return <FormSuccess message={confirmState.success} />;
  }

  if (enabled) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Badge tone="green">Enabled</Badge>
        </div>
        <ActionForm action={disableMfa} className="flex flex-wrap items-end gap-2">
          <Field
            label="Confirm your password to turn it off"
            htmlFor="mfa-off-password"
            required
            className="flex-1"
          >
            <Input id="mfa-off-password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <SubmitButton variant="dangerGhost">Turn off</SubmitButton>
        </ActionForm>
      </div>
    );
  }

  if (!enrollment) {
    return (
      <div className="space-y-3">
        <FormError message={error} />
        <Button
          variant="secondary"
          onClick={async () => {
            const result = await beginMfaEnrollment();
            if (result.error) setError(result.error);
            else if (result.secret && result.uri) setEnrollment({ secret: result.secret, uri: result.uri });
          }}
        >
          Set up authenticator app
        </Button>
      </div>
    );
  }

  return (
    <form action={confirmAction} className="space-y-3">
      <p className="text-[13px] text-ink-600">
        1. Add this key to your authenticator app (Google Authenticator, 1Password, Authy…):
      </p>
      <code className="block rounded bg-ink-100 px-3 py-2 text-center font-mono text-sm tracking-wider break-all">
        {enrollment.secret}
      </code>
      <p className="text-[12px] text-ink-400">
        Or paste this URI: <span className="break-all">{enrollment.uri}</span>
      </p>
      <FormError message={confirmState && 'error' in confirmState ? confirmState.error : undefined} />
      <Field label="2. Enter the 6-digit code to confirm" htmlFor="code" required>
        <Input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
      </Field>
      <SubmitButton size="sm">Confirm & enable</SubmitButton>
    </form>
  );
}
