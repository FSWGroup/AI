'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, Drawer, Modal, SubmitButton } from '@/components/ui/client';
import {
  saveCompCycleAction, populateCycleAction, setBudgetAction, saveProposalAction,
  submitProposalsAction, decideProposalAction, setCycleStatusAction, applyCycleAction,
} from './actions';

export function NewCycleButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>New cycle</Button>
      <Drawer title="New compensation cycle" open={open} onClose={() => setOpen(false)}>
        <ActionForm action={saveCompCycleAction} className="space-y-3">
          <Field label="Name" htmlFor="cc-name" required>
            <Input id="cc-name" name="name" required placeholder="FY27 merit review" />
          </Field>
          <Field label="Effective date" htmlFor="cc-eff" required hint="Approved increases start on this date.">
            <Input id="cc-eff" name="effectiveDate" type="date" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget %" htmlFor="cc-pct" hint="Of eligible base pay.">
              <Input id="cc-pct" name="budgetPct" type="number" step="0.1" min="0" max="100" placeholder="3.5" />
            </Field>
            <Field label="Budget amount" htmlFor="cc-amt" hint="Optional absolute pool.">
              <Input id="cc-amt" name="budgetAmount" type="number" step="1" min="0" />
            </Field>
          </div>
          <Field label="Minimum tenure (months)" htmlFor="cc-ten" hint="Excludes very recent hires. 0 includes everyone.">
            <Input id="cc-ten" name="minTenureMonths" type="number" min="0" defaultValue={6} />
          </Field>
          <Field label="Guidance for managers" htmlFor="cc-guide">
            <Textarea id="cc-guide" name="guidance" rows={3} placeholder="Focus on people below band midpoint and at risk of leaving." />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Create</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function PopulateButton({ cycleId }: { cycleId: string }) {
  return (
    <ActionForm action={populateCycleAction} className="inline">
      <input type="hidden" name="cycleId" value={cycleId} />
      <SubmitButton variant="secondary" size="sm">Add eligible people</SubmitButton>
    </ActionForm>
  );
}

export function SubmitAllButton({ cycleId }: { cycleId: string }) {
  return (
    <ActionForm action={submitProposalsAction} className="inline">
      <input type="hidden" name="cycleId" value={cycleId} />
      <SubmitButton variant="secondary" size="sm">Submit my proposals</SubmitButton>
    </ActionForm>
  );
}

export function CycleStatusButtons({ cycleId, status }: { cycleId: string; status: string }) {
  const next =
    status === 'PLANNING' ? { value: 'IN_REVIEW', label: 'Close planning → review' }
    : status === 'IN_REVIEW' ? { value: 'APPROVED', label: 'Approve cycle' }
    : null;
  if (!next) return null;
  return (
    <ActionForm action={setCycleStatusAction} className="inline">
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="status" value={next.value} />
      <SubmitButton variant="secondary" size="sm">{next.label}</SubmitButton>
    </ActionForm>
  );
}

/** Applying writes real pay history, so it asks first and says what it will do. */
export function ApplyCycleButton({ cycleId, approvedCount }: { cycleId: string; approvedCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={approvedCount === 0}>
        Apply {approvedCount} increase{approvedCount === 1 ? '' : 's'}
      </Button>
      <Modal title="Apply this cycle?" open={open} onClose={() => setOpen(false)}>
        <p className="mb-4 text-[13px] leading-relaxed text-ink-600">
          This writes {approvedCount} approved increase{approvedCount === 1 ? '' : 's'} into compensation history,
          effective on the cycle date. The current pay record for each person is closed the day before and a new one
          opened — nothing is overwritten, so the history stays intact. Applying cannot be undone from here; a mistake
          is corrected with a further compensation change.
        </p>
        <ActionForm action={applyCycleAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="cycleId" value={cycleId} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton size="sm">Apply</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}

export function BudgetForm({ cycleId, managerId, amount }: { cycleId: string; managerId: string; amount: number }) {
  return (
    <ActionForm action={setBudgetAction} className="flex items-center gap-2">
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="managerId" value={managerId} />
      <Input name="amount" type="number" step="100" min="0" defaultValue={amount} className="h-8 w-32" />
      <SubmitButton variant="ghost" size="sm">Set</SubmitButton>
    </ActionForm>
  );
}

export interface ProposalRow {
  id: string;
  workerName: string;
  title: string | null;
  currentAmount: number;
  proposedAmount: number | null;
  increasePct: number | null;
  rateType: string;
  currency: string;
  reason: string;
  justification: string | null;
  status: string;
  compaRatio: number | null;
  bandMin: number | null;
}

export function ProposalEditor({ proposal, editable }: { proposal: ProposalRow; editable: boolean }) {
  const [open, setOpen] = useState(false);
  if (!editable) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {proposal.proposedAmount === null ? 'Propose' : 'Edit'}
      </Button>
      <Drawer title={proposal.workerName} open={open} onClose={() => setOpen(false)}>
        <p className="mb-3 text-[13px] text-ink-600">
          Current: <strong>{proposal.currentAmount.toLocaleString()}</strong> {proposal.currency}{' '}
          {proposal.rateType.toLowerCase()}
          {proposal.compaRatio !== null ? ` · compa-ratio ${proposal.compaRatio.toFixed(2)}` : ''}
          {proposal.bandMin !== null && proposal.currentAmount < proposal.bandMin
            ? ' · below band minimum'
            : ''}
        </p>
        <ActionForm action={saveProposalAction} className="space-y-3" onSuccess={() => setOpen(false)}>
          <input type="hidden" name="proposalId" value={proposal.id} />
          <Field label="Proposed amount" htmlFor="pr-amt" hint="Leave blank for no increase this cycle.">
            <Input
              id="pr-amt" name="proposedAmount" type="number" step="0.01" min="0"
              defaultValue={proposal.proposedAmount ?? ''}
            />
          </Field>
          <Field label="Reason" htmlFor="pr-reason">
            <Select id="pr-reason" name="reason" defaultValue={proposal.reason}>
              <option value="MERIT">Merit</option>
              <option value="PROMOTION">Promotion</option>
              <option value="MARKET">Market adjustment</option>
              <option value="EQUITY">Equity correction</option>
            </Select>
          </Field>
          <Field label="Justification" htmlFor="pr-just" hint="The approver reads this. Be specific about impact.">
            <Textarea id="pr-just" name="justification" rows={3} defaultValue={proposal.justification ?? ''} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function DecideButtons({ proposalId }: { proposalId: string }) {
  return (
    <div className="flex gap-1">
      {(['APPROVED', 'REJECTED'] as const).map((decision) => (
        <ActionForm key={decision} action={decideProposalAction} className="inline">
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="decision" value={decision} />
          <SubmitButton variant={decision === 'APPROVED' ? 'secondary' : 'dangerGhost'} size="sm">
            {decision === 'APPROVED' ? 'Approve' : 'Reject'}
          </SubmitButton>
        </ActionForm>
      ))}
    </div>
  );
}
