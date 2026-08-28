'use client';

import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { ActionForm, Drawer, SubmitButton } from '@/components/ui/client';
import { createApiKeyAction, revokeApiKeyAction, createWebhookAction, toggleWebhookAction } from './actions';

export function CreateKeyButton({ scopes }: { scopes: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Issue a key</Button>
      <Drawer title="Issue an API key" open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          Grant only the scopes that system actually needs. The key is shown once and stored as a hash — there is no way
          to recover it later, only to revoke it and issue a new one.
        </p>
        <ActionForm action={createApiKeyAction} className="space-y-3">
          <Field label="Name" htmlFor="ak-name" required hint="The system that will use it.">
            <Input id="ak-name" name="name" required placeholder="Prophet 21 nightly sync" />
          </Field>
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium text-ink-700">Scopes</legend>
            <div className="space-y-2">
              {scopes.map((s) => (
                <label key={s.key} className="flex items-start gap-2 text-[13px] text-ink-700">
                  <input type="checkbox" name="scopes" value={s.key} className="mt-0.5 h-4 w-4 rounded border-ink-300" />
                  <span>
                    <code className="text-[12px]">{s.key}</code>
                    <span className="block text-[12px] text-ink-500">{s.label}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Expires in (days)" htmlFor="ak-exp" hint="Leave blank for no expiry. A dated key is easier to rotate.">
            <Input id="ak-exp" name="expiresDays" type="number" min={1} max={3650} defaultValue={365} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Close</Button>
            <SubmitButton>Issue</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function RevokeKeyButton({ keyId }: { keyId: string }) {
  return (
    <form action={revokeApiKeyAction} className="inline">
      <input type="hidden" name="keyId" value={keyId} />
      <Button type="submit" variant="dangerGhost" size="sm">Revoke</Button>
    </form>
  );
}

export function CreateWebhookButton({ events }: { events: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Add an endpoint</Button>
      <Drawer title="Add a webhook endpoint" open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          Events are queued and delivered by the maintenance sweep, signed with HMAC-SHA256 over the exact bytes sent.
          Payloads carry ids and the event only — a receiver that needs detail calls the read API with its own key.
        </p>
        <ActionForm action={createWebhookAction} className="space-y-3">
          <Field label="Name" htmlFor="wh-name" required>
            <Input id="wh-name" name="name" required placeholder="Prophet 21 listener" />
          </Field>
          <Field label="URL" htmlFor="wh-url" required hint="Must be https — an http endpoint would send HR events in the clear.">
            <Input id="wh-url" name="url" type="url" required placeholder="https://erp.internal.example.com/hooks/fsw" />
          </Field>
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium text-ink-700">Events</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-ink-200 p-2">
              {events.map((e) => (
                <label key={e} className="flex items-center gap-2 text-[13px] text-ink-700">
                  <input type="checkbox" name="events" value={e} className="h-4 w-4 rounded border-ink-300" />
                  <code className="text-[12px]">{e}</code>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-ink-500">Select none to receive every event.</p>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Close</Button>
            <SubmitButton>Create</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function ToggleWebhookButton({ endpointId, active }: { endpointId: string; active: boolean }) {
  return (
    <form action={toggleWebhookAction} className="inline">
      <input type="hidden" name="endpointId" value={endpointId} />
      <Button type="submit" variant="ghost" size="sm">{active ? 'Disable' : 'Enable'}</Button>
    </form>
  );
}
