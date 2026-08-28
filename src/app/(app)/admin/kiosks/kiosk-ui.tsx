'use client';

import { useState } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { ActionForm, Drawer, SubmitButton } from '@/components/ui/client';
import { registerKioskAction, revokeKioskAction, setKioskPinAction } from './actions';

export function RegisterKioskButton({ locations }: { locations: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Register a tablet</Button>
      <Drawer title="Register a kiosk" open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          You will get a one-time setup link. Open it once on the tablet itself — it exchanges the token for a device
          cookie, so the link never has to be typed again. The link is shown only once and is not stored.
        </p>
        <ActionForm action={registerKioskAction} className="space-y-3">
          <Field label="Name" htmlFor="kd-name" required hint="Where it is mounted, so it can be recognised later.">
            <Input id="kd-name" name="name" required placeholder="Exton warehouse — receiving door" />
          </Field>
          <Field label="Location" htmlFor="kd-loc">
            <Select id="kd-loc" name="locationId" defaultValue="">
              <option value="">Unassigned</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Close</Button>
            <SubmitButton>Register</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function RevokeKioskButton({ deviceId }: { deviceId: string }) {
  return (
    <form action={revokeKioskAction}>
      <input type="hidden" name="deviceId" value={deviceId} />
      <Button type="submit" variant="dangerGhost" size="sm">Revoke</Button>
    </form>
  );
}

/** Set a clock-in PIN. Rendered on the worker profile. */
export function KioskPinForm({ workerId, hasPin }: { workerId: string; hasPin: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-ink-100 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink-700">Clock-in PIN</span>
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
          {hasPin ? 'Change' : 'Set'}
        </Button>
      </div>
      <p className="mt-1 text-[12px] text-ink-500">
        {hasPin
          ? 'A PIN is set. It works on any registered kiosk and nowhere else.'
          : 'No PIN set. A PIN lets this person clock in at a warehouse tablet without an account.'}
      </p>
      {open ? (
        <ActionForm action={setKioskPinAction} className="mt-3 space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="workerId" value={workerId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="New PIN" htmlFor="kp-pin" required>
              <Input id="kp-pin" name="pin" inputMode="numeric" maxLength={4} pattern="\d{4}" required autoComplete="off" />
            </Field>
            <Field label="Confirm" htmlFor="kp-confirm" required>
              <Input id="kp-confirm" name="confirmPin" inputMode="numeric" maxLength={4} pattern="\d{4}" required autoComplete="off" />
            </Field>
          </div>
          <p className="text-[12px] text-ink-500">
            Four digits, and not a run or a repeat. A PIN only opens the time clock — it is never the account password.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton size="sm">Save PIN</SubmitButton>
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}
