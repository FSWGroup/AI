'use client';

import { useState } from 'react';
import { Button, Callout, Field, Input, Select } from '@/components/ui';
import { ActionForm, Drawer, Modal, SubmitButton } from '@/components/ui/client';
import { publishToBoardAction, unpublishFromBoardAction } from '../../actions';

export interface IndeedPanelProps {
  requisitionId: string;
  configured: boolean;
  jobOpen: boolean;
  hasDescription: boolean;
  defaultTitle: string;
  defaultLocation: string;
  posting: {
    status: string;
    publicTitle: string | null;
    publicLocation: string | null;
    remoteType: string | null;
    showSalary: boolean;
    publishedAt: string;
    lastFeedAt: string | null;
  } | null;
}

/**
 * Publishing controls for Indeed. Everything here is deliberately literal
 * about what Indeed does and does not do: we add the job to a feed, Indeed
 * crawls it on its own schedule, and "last fetched" is the only honest
 * evidence we have that the listing is live.
 */
export function IndeedPanel(props: IndeedPanelProps) {
  const [open, setOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const published = props.posting?.status === 'PUBLISHED';

  if (!props.configured) {
    return (
      <Callout tone="info">
        Indeed posting is not set up yet. An administrator connects it under Admin › Integrations.
      </Callout>
    );
  }

  const blockers: string[] = [];
  if (!props.jobOpen) blockers.push('the requisition must be Open');
  if (!props.hasDescription) blockers.push('the job needs a description');

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="text-[13px] text-ink-600">
        {published ? (
          <>
            <span className="font-medium text-ink-800">In the Indeed feed.</span>{' '}
            {props.posting?.lastFeedAt
              ? `Indeed last fetched the feed on ${props.posting.lastFeedAt}.`
              : 'Indeed has not fetched the feed yet — it crawls on its own schedule.'}
          </>
        ) : (
          <>Not on Indeed.</>
        )}
      </div>

      {published ? (
        <Button variant="secondary" onClick={() => setRemoveOpen(true)}>
          Remove from Indeed
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)} disabled={blockers.length > 0}>
          Publish to Indeed
        </Button>
      )}

      {blockers.length > 0 && !published ? (
        <span className="text-[12px] text-ink-500">Before publishing, {blockers.join(' and ')}.</span>
      ) : null}

      <Modal title="Remove from Indeed?" open={removeOpen} onClose={() => setRemoveOpen(false)}>
        <p className="mb-4 text-[13px] leading-relaxed text-ink-600">
          The job leaves the feed straight away. Indeed clears the public listing on its next crawl, so it can remain
          visible on Indeed for a short while afterwards. Applications already received are kept.
        </p>
        <ActionForm action={unpublishFromBoardAction} className="space-y-3" onSuccess={() => setRemoveOpen(false)}>
          <input type="hidden" name="requisitionId" value={props.requisitionId} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="sm">Remove</SubmitButton>
          </div>
        </ActionForm>
      </Modal>

      <Drawer title="Publish to Indeed" open={open} onClose={() => setOpen(false)}>
        <p className="mb-4 text-[13px] text-ink-600">
          Publishing adds this role to the job feed Indeed crawls. Indeed decides when it indexes and how the listing
          ranks, so it usually appears within a few hours rather than instantly. Only the fields below reach the public
          listing — hiring manager, headcount and approval history never leave FSW People.
        </p>
        <ActionForm action={publishToBoardAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="requisitionId" value={props.requisitionId} />
          <Field label="Public job title" htmlFor="ind-title" hint="Leave blank to use the requisition title.">
            <Input id="ind-title" name="publicTitle" defaultValue={props.posting?.publicTitle ?? ''} placeholder={props.defaultTitle} />
          </Field>
          <Field label="Public location" htmlFor="ind-loc" hint="City, State — for example “Exton, PA”.">
            <Input
              id="ind-loc"
              name="publicLocation"
              defaultValue={props.posting?.publicLocation ?? ''}
              placeholder={props.defaultLocation}
            />
          </Field>
          <Field label="Work arrangement" htmlFor="ind-remote">
            <Select id="ind-remote" name="remoteType" defaultValue={props.posting?.remoteType ?? 'ONSITE'}>
              <option value="ONSITE">On-site</option>
              <option value="HYBRID">Hybrid</option>
              <option value="REMOTE">Fully remote</option>
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-[13px] text-ink-700">
            <input
              type="checkbox"
              name="showSalary"
              defaultChecked={props.posting?.showSalary ?? false}
              className="mt-0.5 h-4 w-4 rounded border-ink-300"
            />
            <span>
              Show the salary range on the public listing.
              <span className="block text-[12px] text-ink-500">
                Off by default. Some states require a range in the posting — check with HR before leaving this off.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton>Publish</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </div>
  );
}
