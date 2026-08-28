'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, Drawer, SubmitButton } from '@/components/ui/client';
import {
  createReferralAction, decideReferralBonusAction, addToTalentPoolAction,
  removeFromTalentPoolAction, emailCandidateAction,
} from './actions';

export function ReferSomeoneButton({ jobs }: { jobs: { id: string; title: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Refer someone</Button>
      <Drawer title="Refer someone you know" open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          Referrals are the best hiring channel we have. Give us their email so we can match the referral to their
          application — without it a bonus can never be attributed.
        </p>
        <ActionForm action={createReferralAction} className="space-y-3" resetOnSuccess>
          <Field label="Their name" htmlFor="rf-name" required>
            <Input id="rf-name" name="candidateName" required />
          </Field>
          <Field label="Their email" htmlFor="rf-email" required>
            <Input id="rf-email" name="candidateEmail" type="email" required />
          </Field>
          <Field label="Their phone" htmlFor="rf-phone">
            <Input id="rf-phone" name="candidatePhone" />
          </Field>
          <Field label="Role" htmlFor="rf-job" hint="Optional — leave blank for a general referral.">
            <Select id="rf-job" name="requisitionId" defaultValue="">
              <option value="">No particular role</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="How do you know them?" htmlFor="rf-rel">
            <Select id="rf-rel" name="relationship" defaultValue="FORMER_COLLEAGUE">
              <option value="FORMER_COLLEAGUE">Former colleague</option>
              <option value="FRIEND">Friend</option>
              <option value="FAMILY">Family</option>
              <option value="INDUSTRY">Industry contact</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Why they would be good here" htmlFor="rf-note">
            <Textarea id="rf-note" name="note" rows={3} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Submit referral</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function BonusDecision({ referralId, eligible }: { referralId: string; eligible: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Bonus</Button>
      <Drawer title="Referral bonus" open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          FSW People records the decision; payroll makes the payment. Nothing here moves money.
          {eligible ? '' : ' This referral has not reached its eligibility date yet.'}
        </p>
        <ActionForm action={decideReferralBonusAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="referralId" value={referralId} />
          <Field label="Amount" htmlFor="bn-amt">
            <Input id="bn-amt" name="bonusAmount" type="number" step="1" min="0" placeholder="500" />
          </Field>
          <Field label="Decision" htmlFor="bn-status">
            <Select id="bn-status" name="bonusStatus" defaultValue="APPROVED">
              <option value="APPROVED">Approve for payment</option>
              <option value="PAID">Mark as paid</option>
              <option value="FORFEITED">Forfeited</option>
            </Select>
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

export function AddToPoolButton({ candidateId, jobFamily }: { candidateId: string; jobFamily?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Keep in talent pool</Button>
      <Drawer title="Keep for a future role" open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          For candidates who interviewed well and lost to someone stronger. Every entry gets a review date so we do not
          keep people on file indefinitely without deciding to.
        </p>
        <ActionForm action={addToTalentPoolAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="candidateId" value={candidateId} />
          <Field label="Job family" htmlFor="tp-family" hint="Used to surface them when a similar role opens.">
            <Input id="tp-family" name="jobFamily" defaultValue={jobFamily ?? ''} placeholder="Sales" />
          </Field>
          <Field label="Why keep them" htmlFor="tp-reason">
            <Input id="tp-reason" name="reason" placeholder="Strong second choice for Inside Sales" />
          </Field>
          <Field label="Strengths" htmlFor="tp-strength">
            <Textarea id="tp-strength" name="strengthNote" rows={3} />
          </Field>
          <Field label="Review in" htmlFor="tp-review">
            <Select id="tp-review" name="reviewMonths" defaultValue={12}>
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
              <option value={24}>24 months</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Add</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function RemoveFromPoolButton({ entryId }: { entryId: string }) {
  return (
    <form action={removeFromTalentPoolAction}>
      <input type="hidden" name="entryId" value={entryId} />
      <Button type="submit" variant="ghost" size="sm">Remove</Button>
    </form>
  );
}

/** Tell a candidate where they stand. Always an explicit act, never automatic. */
export function EmailCandidateButton({ applicationId, hasEmail }: { applicationId: string; hasEmail: boolean }) {
  const [open, setOpen] = useState(false);
  if (!hasEmail) {
    return <span className="text-[12px] text-ink-400">No email on file</span>;
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Email candidate</Button>
      <Drawer title="Send a status update" open={open} onClose={() => setOpen(false)}>
        <ActionForm action={emailCandidateAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <Field label="Message" htmlFor="ce-kind">
            <Select id="ce-kind" name="kind" defaultValue="RECEIVED">
              <option value="RECEIVED">We received your application</option>
              <option value="ADVANCED">Moving to next steps</option>
              <option value="REJECTED">Not moving forward</option>
              <option value="POOL_INVITE">A new role you might want</option>
            </Select>
          </Field>
          <Field label="Anything to add" htmlFor="ce-note" hint="Appended to the message. Optional.">
            <Textarea id="ce-note" name="note" rows={3} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Send</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}
