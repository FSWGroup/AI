'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, Drawer, Modal, SubmitButton } from '@/components/ui/client';
import {
  createCandidateAction,
  moveApplicationAction,
  rejectApplicationAction,
  scheduleInterviewAction,
  createOfferAction,
} from '../../actions';

export function AddCandidateButton({ requisitionId }: { requisitionId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add candidate</Button>
      <Drawer title="Add candidate" open={open} onClose={() => setOpen(false)}>
        <ActionForm action={createCandidateAction} className="space-y-3" resetOnSuccess>
          <input type="hidden" name="requisitionId" value={requisitionId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor="cf-first" required>
              <Input id="cf-first" name="firstName" required />
            </Field>
            <Field label="Last name" htmlFor="cf-last" required>
              <Input id="cf-last" name="lastName" required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" htmlFor="cf-email">
              <Input id="cf-email" name="email" type="email" />
            </Field>
            <Field label="Phone" htmlFor="cf-phone">
              <Input id="cf-phone" name="phone" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source" htmlFor="cf-source">
              <Select id="cf-source" name="source">
                {['REFERRAL', 'LINKEDIN', 'INDEED', 'WEBSITE', 'AGENCY', 'OTHER'].map((s) => (
                  <option key={s} value={s}>
                    {s.toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Referred by" htmlFor="cf-ref">
              <Input id="cf-ref" name="referredBy" />
            </Field>
          </div>
          <Field label="LinkedIn URL" htmlFor="cf-li">
            <Input id="cf-li" name="linkedinUrl" type="url" />
          </Field>
          <Field label="Notes" htmlFor="cf-notes">
            <Textarea id="cf-notes" name="notes" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <SubmitButton>Add candidate</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function ApplicationCardActions({
  applicationId,
  currentStageId,
  stages,
  hasOffer,
  jobTitle,
}: {
  applicationId: string;
  currentStageId: string;
  stages: { value: string; label: string }[];
  hasOffer: boolean;
  jobTitle: string;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);

  return (
    <div className="mt-2 space-y-1.5 border-t border-ink-100 pt-2">
      <ActionForm action={moveApplicationAction} className="flex items-center gap-1.5">
        <input type="hidden" name="applicationId" value={applicationId} />
        <Select name="stageId" defaultValue={currentStageId} aria-label="Move to stage" className="h-7 flex-1 py-0 text-[12px]">
          {stages.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <SubmitButton variant="secondary" size="sm" className="h-7 px-2 text-[12px]">
          Move
        </SubmitButton>
      </ActionForm>
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => setInterviewOpen(true)}>
          Interview
        </Button>
        {!hasOffer ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => setOfferOpen(true)}>
            Offer
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px] text-danger-500" onClick={() => setRejectOpen(true)}>
          Reject
        </Button>
      </div>

      <Modal title="Reject candidate" open={rejectOpen} onClose={() => setRejectOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-500">
          Rejection is always a human decision — a reason is required and recorded.
        </p>
        <ActionForm action={rejectApplicationAction} className="space-y-3">
          <input type="hidden" name="applicationId" value={applicationId} />
          <Field label="Reason" htmlFor={`rej-${applicationId}`} required>
            <Textarea id={`rej-${applicationId}`} name="reason" required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <SubmitButton variant="danger" size="sm">
              Reject
            </SubmitButton>
          </div>
        </ActionForm>
      </Modal>

      <Modal title="Schedule interview" open={interviewOpen} onClose={() => setInterviewOpen(false)}>
        <ActionForm action={scheduleInterviewAction} className="space-y-3">
          <input type="hidden" name="applicationId" value={applicationId} />
          <Field label="Type" htmlFor={`ik-${applicationId}`}>
            <Select id={`ik-${applicationId}`} name="kind">
              {['PHONE_SCREEN', 'HIRING_MANAGER', 'PANEL', 'TECHNICAL', 'FINAL', 'REFERENCE'].map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="When" htmlFor={`iw-${applicationId}`} required>
              <Input id={`iw-${applicationId}`} name="scheduledAt" type="datetime-local" required />
            </Field>
            <Field label="Duration (min)" htmlFor={`id-${applicationId}`}>
              <Input id={`id-${applicationId}`} name="durationMin" type="number" defaultValue={45} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setInterviewOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="sm">Schedule</SubmitButton>
          </div>
        </ActionForm>
      </Modal>

      <Modal title="Create offer" open={offerOpen} onClose={() => setOfferOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-500">Offers route through HR approval before they can be sent.</p>
        <ActionForm action={createOfferAction} className="space-y-3">
          <input type="hidden" name="applicationId" value={applicationId} />
          <Field label="Title" htmlFor={`ot-${applicationId}`}>
            <Input id={`ot-${applicationId}`} name="title" defaultValue={jobTitle} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Amount" htmlFor={`oa-${applicationId}`} required>
              <Input id={`oa-${applicationId}`} name="amount" type="number" step="0.01" required />
            </Field>
            <Field label="Rate" htmlFor={`or-${applicationId}`}>
              <Select id={`or-${applicationId}`} name="rateType">
                <option value="ANNUAL">Annual</option>
                <option value="HOURLY">Hourly</option>
                <option value="MONTHLY">Monthly</option>
              </Select>
            </Field>
            <Field label="Bonus %" htmlFor={`ob-${applicationId}`}>
              <Input id={`ob-${applicationId}`} name="bonusTargetPct" type="number" step="0.5" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" htmlFor={`os-${applicationId}`}>
              <Input id={`os-${applicationId}`} name="startDate" type="date" />
            </Field>
            <Field label="Offer expires" htmlFor={`oe-${applicationId}`}>
              <Input id={`oe-${applicationId}`} name="expiresAt" type="date" />
            </Field>
          </div>
          <Field label="Contingencies" htmlFor={`oc-${applicationId}`}>
            <Input id={`oc-${applicationId}`} name="contingencies" placeholder="e.g. background check" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOfferOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="sm">Draft offer</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </div>
  );
}
