'use client';

import { useActionState, useState } from 'react';
import { beginMfaEnrollment, confirmMfaEnrollment, disableMfa, type ActionResult } from '@/app/(auth)/actions';
import { Badge, Button, Field, FormError, FormSuccess, Input } from '@/components/ui';
import { SubmitButton, ConfirmSubmit } from '@/components/ui/client';

export function MfaSection({ enabled }: { enabled: boolean }) {
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, confirmAction] = useActionState<ActionResult, FormData>(confirmMfaEnrollment, undefined);

  if (confirmState && 'success' in confirmState) {
    return <FormSuccess message={confirmState.success} />;
  }

  if (enabled) {
    return (
      <div className="flex items-center justify-between">
        <Badge tone="green">Enabled</Badge>
        <ConfirmSubmit
          action={async () => {
            await disableMfa();
            location.reload();
          }}
          title="Turn off two-factor authentication?"
          description="Your account will only be protected by your password."
          confirmLabel="Turn off"
          variant="dangerGhost"
        >
          Turn off
        </ConfirmSubmit>
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
