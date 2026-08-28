'use client';

import { useState } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton, ConfirmSubmit } from '@/components/ui/client';
import { getDownloadUrlAction, signDocumentAction, deleteDocumentAction } from '../actions';

export function DownloadButton({ versionId }: { versionId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-[12px] text-danger-500">{error}</span> : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await getDownloadUrlAction(versionId);
          setBusy(false);
          if (result.error) setError(result.error);
          else if (result.url) window.open(result.url, '_blank');
        }}
      >
        {busy ? 'Preparing…' : 'Download'}
      </Button>
    </span>
  );
}

export function SignForm({ versionId }: { versionId: string }) {
  return (
    <ActionForm action={signDocumentAction} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <input type="hidden" name="versionId" value={versionId} />
      <Field label="Type your full legal name" htmlFor="sign-name" required>
        <Input id="sign-name" name="signedName" required autoComplete="name" />
      </Field>
      <Field label="Action" htmlFor="sign-kind">
        <Select id="sign-kind" name="kind">
          <option value="SIGNATURE">Sign</option>
          <option value="ACKNOWLEDGMENT">Acknowledge</option>
        </Select>
      </Field>
      <div className="flex items-end">
        <SubmitButton>Sign document</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DeleteDocButton({ documentId }: { documentId: string }) {
  return (
    <ConfirmSubmit
      action={deleteDocumentAction}
      title="Delete this document?"
      description="This is a soft delete — the record is preserved for retention review, and permanent destruction requires retention-admin approval."
      confirmLabel="Delete"
      variant="dangerGhost"
      hiddenFields={{ documentId }}
    >
      Delete
    </ConfirmSubmit>
  );
}
