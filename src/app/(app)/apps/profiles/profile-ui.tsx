'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, Drawer, SubmitButton } from '@/components/ui/client';
import {
  saveAccessProfileAction, addProfileItemAction, removeProfileItemAction,
  reprovisionWorkerAction, noteAccessExceptionAction,
} from './actions';

export interface ProfileShape {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  departmentIds: string[];
  workerTypes: string[];
  jobFamilies: string[];
}

export function SaveProfileButton({
  profile,
  departments,
}: {
  profile?: ProfileShape;
  departments: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={profile ? 'ghost' : 'primary'} size={profile ? 'sm' : 'md'} onClick={() => setOpen(true)}>
        {profile ? 'Edit' : 'New profile'}
      </Button>
      <Drawer title={profile ? `Edit ${profile.name}` : 'New access profile'} open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          A profile says what a kind of role gets. Onboarding raises the grant tasks from it, and the exception report
          compares it against what people actually hold.
        </p>
        <ActionForm action={saveAccessProfileAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          {profile ? <input type="hidden" name="profileId" value={profile.id} /> : null}
          <Field label="Name" htmlFor="ap-name" required>
            <Input id="ap-name" name="name" defaultValue={profile?.name} required placeholder="Warehouse Associate" />
          </Field>
          <Field label="Description" htmlFor="ap-desc">
            <Textarea id="ap-desc" name="description" rows={2} defaultValue={profile?.description ?? ''} />
          </Field>
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium text-ink-700">Applies to departments</legend>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-ink-200 p-2">
              {departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-[13px] text-ink-700">
                  <input
                    type="checkbox" name="departmentIds" value={d.id}
                    defaultChecked={profile?.departmentIds.includes(d.id)}
                    className="h-4 w-4 rounded border-ink-300"
                  />
                  {d.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium text-ink-700">Worker types</legend>
            <div className="flex gap-4">
              {['EMPLOYEE', 'CONTRACTOR'].map((t) => (
                <label key={t} className="flex items-center gap-2 text-[13px] text-ink-700">
                  <input
                    type="checkbox" name="workerTypes" value={t}
                    defaultChecked={profile?.workerTypes.includes(t)}
                    className="h-4 w-4 rounded border-ink-300"
                  />
                  {t.toLowerCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Job families" htmlFor="ap-fam" hint="Comma separated. Leave blank for any.">
            <Input id="ap-fam" name="jobFamilies" defaultValue={profile?.jobFamilies.join(', ')} placeholder="Warehouse, Sales" />
          </Field>
          {profile ? (
            <label className="flex items-center gap-2 text-[13px] text-ink-700">
              <input type="checkbox" name="active" defaultChecked={profile.active} className="h-4 w-4 rounded border-ink-300" />
              Active
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function AddEntitlementButton({ profileId, apps }: { profileId: string; apps: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>+ Application</Button>
      <Drawer title="Add an entitlement" open={open} onClose={() => setOpen(false)}>
        <ActionForm action={addProfileItemAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="profileId" value={profileId} />
          <Field label="Application" htmlFor="ai-app" required>
            <Select id="ai-app" name="appId" required>
              {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Access level" htmlFor="ai-level">
            <Select id="ai-level" name="accessLevel" defaultValue="USER">
              <option value="READONLY">Read only</option>
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-[13px] text-ink-700">
            <input type="checkbox" name="required" defaultChecked className="mt-0.5 h-4 w-4 rounded border-ink-300" />
            <span>
              Required
              <span className="block text-[12px] text-ink-500">
                A missing required entitlement shows on the exception report; an optional one does not.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Add</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function RemoveEntitlementButton({ itemId }: { itemId: string }) {
  return (
    <form action={removeProfileItemAction} className="inline">
      <input type="hidden" name="itemId" value={itemId} />
      <Button type="submit" variant="ghost" size="sm">Remove</Button>
    </form>
  );
}

export function ReprovisionButton({ workerId }: { workerId: string }) {
  return (
    <ActionForm action={reprovisionWorkerAction} className="inline">
      <input type="hidden" name="workerId" value={workerId} />
      <SubmitButton variant="secondary" size="sm">Raise tasks</SubmitButton>
    </ActionForm>
  );
}

export function NoteExceptionButton({
  workerId,
  appId,
  appName,
}: {
  workerId: string;
  appId: string | null;
  appName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Note</Button>
      <Drawer title="Record why this is acceptable" open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          This records a reason in the evidence log. It does <strong>not</strong> clear the exception — an accepted risk
          should stay visible, and the decision to accept it is itself worth recording.
        </p>
        <ActionForm action={noteAccessExceptionAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="workerId" value={workerId} />
          <input type="hidden" name="appId" value={appId ?? ''} />
          <input type="hidden" name="appName" value={appName} />
          <Field label="Reason" htmlFor="ne-detail" required>
            <Textarea id="ne-detail" name="detail" rows={3} required placeholder="Retained for a 30-day handover; owner agreed with IT on 12 Sep." />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Record</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}
