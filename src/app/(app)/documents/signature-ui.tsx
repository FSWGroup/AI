'use client';

import { useState } from 'react';
import { Badge, Button, Callout, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, Drawer, Modal, SubmitButton } from '@/components/ui/client';
import {
  requestSignatureAction, getSigningLinkAction, remindSignatureAction,
  cancelSignatureAction, retryStoreSignedAction, getCertificateUrlAction,
} from './actions';

export const SIGNATURE_TONE = {
  DRAFT: 'gray', SENT: 'blue', VIEWED: 'amber', SIGNED: 'blue',
  STORED: 'green', DECLINED: 'red', EXPIRED: 'red', CANCELED: 'gray', FAILED: 'red',
} as const;

export const SIGNATURE_LABEL: Record<string, string> = {
  DRAFT: 'not sent',
  SENT: 'awaiting signature',
  VIEWED: 'opened',
  SIGNED: 'signed — storing',
  STORED: 'signed & filed',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  CANCELED: 'cancelled',
  FAILED: 'needs attention',
};

export function RequestSignatureButton({
  versionId,
  workers,
  configured,
}: {
  versionId: string;
  workers: { id: string; name: string; hasEmail: boolean }[];
  configured: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!configured) {
    return (
      <Callout tone="info">
        Certified e-signature is not configured. An administrator connects the signing provider under Admin ›
        Integrations. Internal acknowledgment still works below.
      </Callout>
    );
  }
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Request signature</Button>
      <Drawer title="Request a certified signature" open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          This sends the document to the signing provider, which produces a tamper-evident audit certificate. Use it for
          offer letters and agreements. For a handbook read, the internal acknowledgment is enough and does not need a
          provider.
        </p>
        <ActionForm action={requestSignatureAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="versionId" value={versionId} />
          <Field label="Signer" htmlFor="sr-worker" required>
            <Select id="sr-worker" name="workerId" required>
              {workers.map((w) => (
                <option key={w.id} value={w.id} disabled={!w.hasEmail}>
                  {w.name}{w.hasEmail ? '' : ' — no email on file'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due in (days)" htmlFor="sr-due">
            <Input id="sr-due" name="dueDays" type="number" min={1} max={90} defaultValue={7} />
          </Field>
          <Field label="Message to the signer" htmlFor="sr-msg">
            <Textarea id="sr-msg" name="message" rows={3} placeholder="Please review and sign by Friday." />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Send for signature</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

/** The signer's own button. Only they can mint a signing link. */
export function SignNowButton({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await getSigningLinkAction(requestId);
          setBusy(false);
          if (result.error) setError(result.error);
          else if (result.url) window.location.href = result.url;
        }}
      >
        {busy ? 'Opening…' : 'Review & sign'}
      </Button>
      {error ? <span className="text-[12px] text-danger-500">{error}</span> : null}
    </span>
  );
}

export function CertificateButton({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await getCertificateUrlAction(requestId);
          setBusy(false);
          if (result.error) setError(result.error);
          else if (result.url) window.open(result.url, '_blank');
        }}
      >
        {busy ? 'Preparing…' : 'Certificate'}
      </Button>
      {error ? <span className="text-[12px] text-danger-500">{error}</span> : null}
    </span>
  );
}

export function RemindButton({ requestId }: { requestId: string }) {
  return (
    <ActionForm action={remindSignatureAction} className="inline">
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton variant="ghost" size="sm">Remind</SubmitButton>
    </ActionForm>
  );
}

export function RetryStoreButton({ requestId }: { requestId: string }) {
  return (
    <ActionForm action={retryStoreSignedAction} className="inline">
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton variant="secondary" size="sm">Retry download</SubmitButton>
    </ActionForm>
  );
}

export function CancelSignatureButton({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Cancel</Button>
      <Modal title="Cancel this signature request?" open={open} onClose={() => setOpen(false)}>
        <p className="mb-4 text-[13px] leading-relaxed text-ink-600">
          The signer will no longer be able to sign. The request and everything the provider told us about it stay on
          the record — cancelling is an event, not an erasure.
        </p>
        <ActionForm action={cancelSignatureAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="requestId" value={requestId} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>Keep it</Button>
            <SubmitButton variant="danger" size="sm">Cancel request</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}

export function StatusBadgeForSignature({ status }: { status: string }) {
  return (
    <Badge tone={SIGNATURE_TONE[status as keyof typeof SIGNATURE_TONE] ?? 'gray'}>
      {SIGNATURE_LABEL[status] ?? status.toLowerCase()}
    </Badge>
  );
}
