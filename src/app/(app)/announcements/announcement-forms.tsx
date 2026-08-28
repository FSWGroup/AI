'use client';

import { Field, Input, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { publishAnnouncementAction, ackAnnouncementAction } from './actions';

export function AnnouncementForm() {
  return (
    <ActionForm action={publishAnnouncementAction} className="space-y-3" resetOnSuccess>
      <Field label="Title" htmlFor="an-title" required>
        <Input id="an-title" name="title" required />
      </Field>
      <Field label="Message" htmlFor="an-body" required>
        <Textarea id="an-body" name="body" required className="min-h-24" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Publish" htmlFor="an-publish">
          <Input id="an-publish" name="publishAt" type="date" />
        </Field>
        <Field label="Expires" htmlFor="an-expires">
          <Input id="an-expires" name="expiresAt" type="date" />
        </Field>
      </div>
      <Field label="Audience — countries" htmlFor="an-countries" hint="None = everyone.">
        <select id="an-countries" name="countries" multiple size={2} className="block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm">
          <option value="US">United States</option>
          <option value="PH">Philippines</option>
        </select>
      </Field>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="pinned" className="h-4 w-4 rounded border-ink-300" />
          Pin to top
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="requiresAck" className="h-4 w-4 rounded border-ink-300" />
          Require acknowledgment
        </label>
      </div>
      <SubmitButton className="w-full">Publish</SubmitButton>
    </ActionForm>
  );
}

export function AckButton({ announcementId }: { announcementId: string }) {
  return (
    <ActionForm action={ackAnnouncementAction}>
      <input type="hidden" name="announcementId" value={announcementId} />
      <SubmitButton variant="secondary" size="sm">
        Acknowledge
      </SubmitButton>
    </ActionForm>
  );
}
