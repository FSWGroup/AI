'use client';

import { useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton, Drawer } from '@/components/ui/client';
import {
  updateProfileAction,
  saveEmergencyContactAction,
  addIdentifierAction,
  saveBankAccountAction,
  changeEmploymentAction,
  changeCompensationAction,
  saveContractorProfileAction,
  recordContractorPaymentAction,
  startOffboardingAction,
  finalizeTerminationAction,
  revealIdentifierAction,
} from '../actions';

export interface Option {
  value: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Profile edit (self-service subset or HR full)
// ---------------------------------------------------------------------------

export function ProfileEditDrawer({
  workerId,
  hrMode,
  piiMode,
  initial,
}: {
  workerId: string;
  hrMode: boolean;
  piiMode: boolean;
  initial: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Drawer title="Edit profile" open={open} onClose={() => setOpen(false)}>
        <ActionForm action={updateProfileAction} className="space-y-3">
          <input type="hidden" name="workerId" value={workerId} />
          {hrMode ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Legal first name" htmlFor="legalFirstName">
                <Input id="legalFirstName" name="legalFirstName" defaultValue={initial.legalFirstName} />
              </Field>
              <Field label="Last name" htmlFor="lastName">
                <Input id="lastName" name="lastName" defaultValue={initial.lastName} />
              </Field>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preferred name" htmlFor="preferredName">
              <Input id="preferredName" name="preferredName" defaultValue={initial.preferredName} />
            </Field>
            <Field label="Pronouns (optional)" htmlFor="pronouns">
              <Input id="pronouns" name="pronouns" defaultValue={initial.pronouns} placeholder="e.g. they/them" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone" htmlFor="phone">
              <Input id="phone" name="phone" defaultValue={initial.phone} />
            </Field>
            <Field label="Personal email" htmlFor="personalEmail">
              <Input id="personalEmail" name="personalEmail" type="email" defaultValue={initial.personalEmail} />
            </Field>
          </div>
          {hrMode ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Work email" htmlFor="workEmail">
                <Input id="workEmail" name="workEmail" type="email" defaultValue={initial.workEmail} />
              </Field>
              {piiMode ? (
                <Field label="Date of birth" htmlFor="dateOfBirth">
                  <Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={initial.dateOfBirth} />
                </Field>
              ) : null}
            </div>
          ) : null}
          <fieldset className="space-y-3">
            <legend className="text-[13px] font-medium text-ink-700">Home address</legend>
            <Field label="Street" htmlFor="homeStreet">
              <Input id="homeStreet" name="homeStreet" defaultValue={initial.homeStreet} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="City" htmlFor="homeCity">
                <Input id="homeCity" name="homeCity" defaultValue={initial.homeCity} />
              </Field>
              <Field label="State / Region" htmlFor="homeState">
                <Input id="homeState" name="homeState" defaultValue={initial.homeState} />
              </Field>
              <Field label="Postal code" htmlFor="homePostal">
                <Input id="homePostal" name="homePostal" defaultValue={initial.homePostal} />
              </Field>
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="hidden" name="showBirthday__present" value="1" />
            <input
              type="checkbox"
              name="showBirthday"
              defaultChecked={initial.showBirthday !== 'false'}
              className="h-4 w-4 rounded border-ink-300"
            />
            Show my birthday on the team calendar (month and day only)
          </label>
          <Field label="Timezone" htmlFor="timezone">
            <Select id="timezone" name="timezone" defaultValue={initial.timezone}>
              {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Manila'].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <SubmitButton>Save changes</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

export function EmergencyContactForm({
  workerId,
  contact,
}: {
  workerId: string;
  contact?: { id: string; name: string; relationship: string | null; phone: string };
}) {
  return (
    <ActionForm action={saveEmergencyContactAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4" resetOnSuccess={!contact}>
      <input type="hidden" name="workerId" value={workerId} />
      {contact ? <input type="hidden" name="contactId" value={contact.id} /> : null}
      <Field label="Name" htmlFor={`ec-name-${contact?.id ?? 'new'}`} required>
        <Input id={`ec-name-${contact?.id ?? 'new'}`} name="name" defaultValue={contact?.name} required />
      </Field>
      <Field label="Relationship" htmlFor={`ec-rel-${contact?.id ?? 'new'}`}>
        <Input id={`ec-rel-${contact?.id ?? 'new'}`} name="relationship" defaultValue={contact?.relationship ?? ''} />
      </Field>
      <Field label="Phone" htmlFor={`ec-phone-${contact?.id ?? 'new'}`} required>
        <Input id={`ec-phone-${contact?.id ?? 'new'}`} name="phone" defaultValue={contact?.phone} required />
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="secondary" size="md">
          {contact ? 'Update' : 'Add contact'}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
// Encrypted identifiers / bank
// ---------------------------------------------------------------------------

const IDENTIFIER_KINDS: Option[] = [
  { value: 'SSN', label: 'SSN (US)' },
  { value: 'ITIN', label: 'ITIN (US)' },
  { value: 'EIN', label: 'EIN (business)' },
  { value: 'PH_TIN', label: 'TIN (Philippines)' },
  { value: 'PH_SSS', label: 'SSS number (Philippines)' },
  { value: 'PH_PHILHEALTH', label: 'PhilHealth (Philippines)' },
  { value: 'PH_PAGIBIG', label: 'Pag-IBIG MID (Philippines)' },
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'OTHER', label: 'Other identifier' },
];

export function IdentifierForm({ workerId }: { workerId: string }) {
  return (
    <ActionForm action={addIdentifierAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4" resetOnSuccess>
      <input type="hidden" name="workerId" value={workerId} />
      <Field label="Type" htmlFor="id-kind">
        <Select id="id-kind" name="kind">
          {IDENTIFIER_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Value (stored encrypted)" htmlFor="id-value" required>
        <Input id="id-value" name="value" required autoComplete="off" />
      </Field>
      <Field label="Expires (if applicable)" htmlFor="id-expires">
        <Input id="id-expires" name="expiresAt" type="date" />
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="secondary">Save encrypted</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RevealButton({ identifierId }: { identifierId: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (value) return <code className="font-mono text-[13px] text-ink-900">{value}</code>;
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await revealIdentifierAction(identifierId);
          setBusy(false);
          if (result.error) setError(result.error);
          else setValue(result.value ?? null);
        }}
      >
        {busy ? 'Revealing…' : 'Reveal'}
      </Button>
      {error ? <span className="text-[12px] text-danger-500">{error}</span> : null}
    </span>
  );
}

export function BankForm({ workerId, country }: { workerId: string; country: string }) {
  return (
    <ActionForm action={saveBankAccountAction} className="grid grid-cols-1 gap-3 sm:grid-cols-5" resetOnSuccess>
      <input type="hidden" name="workerId" value={workerId} />
      <input type="hidden" name="country" value={country} />
      <Field label="Bank name" htmlFor="bank-name">
        <Input id="bank-name" name="bankName" />
      </Field>
      <Field label="Account type" htmlFor="bank-type">
        <Select id="bank-type" name="accountType">
          <option value="CHECKING">Checking</option>
          <option value="SAVINGS">Savings</option>
        </Select>
      </Field>
      <Field label={country === 'US' ? 'Routing number' : 'Bank / SWIFT code'} htmlFor="bank-routing">
        <Input id="bank-routing" name="routing" autoComplete="off" />
      </Field>
      <Field label="Account number" htmlFor="bank-account" required>
        <Input id="bank-account" name="account" required autoComplete="off" />
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="secondary">Save encrypted</SubmitButton>
      </div>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
// Job change (HR)
// ---------------------------------------------------------------------------

export function JobChangeDrawer({
  workerId,
  current,
  entities,
  departments,
  locations,
  managers,
}: {
  workerId: string;
  current: Record<string, string>;
  entities: Option[];
  departments: Option[];
  locations: Option[];
  managers: Option[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Record job change
      </Button>
      <Drawer title="Record job change" open={open} onClose={() => setOpen(false)} wide>
        <p className="mb-4 text-[13px] text-ink-500">
          This closes the current employment record and opens a new effective-dated one. History is preserved.
        </p>
        <ActionForm action={changeEmploymentAction} className="space-y-3">
          <input type="hidden" name="workerId" value={workerId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Effective date" htmlFor="jc-eff" required>
              <Input id="jc-eff" name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="Reason" htmlFor="jc-reason" required>
              <Select id="jc-reason" name="reason">
                {['PROMOTION', 'TRANSFER', 'MANAGER_CHANGE', 'TITLE_CHANGE', 'LOCATION_CHANGE', 'ENTITY_CHANGE', 'OTHER'].map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title" htmlFor="jc-title">
              <Input id="jc-title" name="title" defaultValue={current.title} />
            </Field>
            <Field label="Manager" htmlFor="jc-manager">
              <Select id="jc-manager" name="managerId" defaultValue={current.managerId}>
                <option value="">No manager</option>
                {managers.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Legal entity" htmlFor="jc-entity">
              <Select id="jc-entity" name="legalEntityId" defaultValue={current.legalEntityId}>
                {entities.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Department" htmlFor="jc-dept">
              <Select id="jc-dept" name="departmentId" defaultValue={current.departmentId}>
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location" htmlFor="jc-loc">
              <Select id="jc-loc" name="locationId" defaultValue={current.locationId}>
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Job family" htmlFor="jc-family">
              <Input id="jc-family" name="jobFamily" defaultValue={current.jobFamily} />
            </Field>
            <Field label="Level" htmlFor="jc-level">
              <Input id="jc-level" name="jobLevel" defaultValue={current.jobLevel} />
            </Field>
            <Field label="Work state (US)" htmlFor="jc-state">
              <Input id="jc-state" name="workState" defaultValue={current.workState} maxLength={2} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Work mode" htmlFor="jc-mode">
              <Select id="jc-mode" name="workMode" defaultValue={current.workMode}>
                <option value="">—</option>
                <option value="ONSITE">Onsite</option>
                <option value="HYBRID">Hybrid</option>
                <option value="REMOTE">Remote</option>
              </Select>
            </Field>
            <Field label="FLSA (US employees)" htmlFor="jc-flsa">
              <Select id="jc-flsa" name="flsaStatus" defaultValue={current.flsaStatus}>
                <option value="">—</option>
                <option value="EXEMPT">Exempt</option>
                <option value="NON_EXEMPT">Non-exempt</option>
              </Select>
            </Field>
            <Field label="Pay basis" htmlFor="jc-basis">
              <Select id="jc-basis" name="payBasis" defaultValue={current.payBasis}>
                <option value="">—</option>
                <option value="SALARY">Salary</option>
                <option value="HOURLY">Hourly</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <SubmitButton>Record change</SubmitButton>
          </div>
        </ActionForm>
      </Drawer>
    </>
  );
}

// ---------------------------------------------------------------------------
// Compensation change
// ---------------------------------------------------------------------------

export function CompChangeForm({ workerId, currency }: { workerId: string; currency: string }) {
  return (
    <ActionForm action={changeCompensationAction} className="grid grid-cols-1 gap-3 sm:grid-cols-6" resetOnSuccess>
      <input type="hidden" name="workerId" value={workerId} />
      <Field label="Amount" htmlFor="cc-amount" required>
        <Input id="cc-amount" name="amount" type="number" step="0.01" min="0" required />
      </Field>
      <Field label="Currency" htmlFor="cc-currency">
        <Select id="cc-currency" name="currency" defaultValue={currency}>
          {['USD', 'PHP', 'CAD', 'EUR'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Rate" htmlFor="cc-rate">
        <Select id="cc-rate" name="rateType">
          <option value="ANNUAL">Annual</option>
          <option value="HOURLY">Hourly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="DAILY">Daily</option>
        </Select>
      </Field>
      <Field label="Reason" htmlFor="cc-reason">
        <Select id="cc-reason" name="reason">
          {['MERIT', 'PROMOTION', 'MARKET', 'COST_OF_LIVING', 'CONTRACT_RATE', 'ADJUSTMENT'].map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Effective" htmlFor="cc-eff" required>
        <Input id="cc-eff" name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
      </Field>
      <div className="flex items-end">
        <SubmitButton>Record change</SubmitButton>
      </div>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
// Contractor profile + payments
// ---------------------------------------------------------------------------

export function ContractorForm({
  workerId,
  initial,
}: {
  workerId: string;
  initial: Record<string, string | boolean>;
}) {
  return (
    <ActionForm action={saveContractorProfileAction} className="space-y-3">
      <input type="hidden" name="workerId" value={workerId} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex items-center gap-2 pt-5 text-sm text-ink-700">
          <input type="checkbox" name="isBusiness" defaultChecked={initial.isBusiness === true} className="h-4 w-4 rounded border-ink-300" />
          Business entity
        </label>
        <Field label="Business name" htmlFor="ct-bn">
          <Input id="ct-bn" name="businessName" defaultValue={(initial.businessName as string) ?? ''} />
        </Field>
        <Field label="DBA" htmlFor="ct-dba">
          <Input id="ct-dba" name="dba" defaultValue={(initial.dba as string) ?? ''} />
        </Field>
        <label className="flex items-center gap-2 pt-5 text-sm text-ink-700">
          <input type="checkbox" name="is1099Eligible" defaultChecked={initial.is1099Eligible === true} className="h-4 w-4 rounded border-ink-300" />
          1099-eligible (US)
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Contract start" htmlFor="ct-start">
          <Input id="ct-start" name="contractStart" type="date" defaultValue={(initial.contractStart as string) ?? ''} />
        </Field>
        <Field label="Contract end" htmlFor="ct-end">
          <Input id="ct-end" name="contractEnd" type="date" defaultValue={(initial.contractEnd as string) ?? ''} />
        </Field>
        <Field label="Payment terms" htmlFor="ct-terms">
          <Select id="ct-terms" name="paymentTerms" defaultValue={(initial.paymentTerms as string) ?? ''}>
            <option value="">—</option>
            {['NET_15', 'NET_30', 'NET_45', 'ON_RECEIPT'].map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Payment method" htmlFor="ct-method">
          <Select id="ct-method" name="paymentMethod" defaultValue={(initial.paymentMethod as string) ?? ''}>
            <option value="">—</option>
            {['ACH', 'WIRE', 'WISE', 'PAYONEER', 'CHECK', 'OTHER'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="W-9 status (US persons)" htmlFor="ct-w9">
          <Select id="ct-w9" name="w9Status" defaultValue={(initial.w9Status as string) ?? ''}>
            <option value="">—</option>
            <option value="NOT_REQUIRED">Not required</option>
            <option value="REQUESTED">Requested</option>
            <option value="RECEIVED">Received</option>
          </Select>
        </Field>
        <Field label="W-8 status (foreign persons)" htmlFor="ct-w8" hint="Confirm the correct form with the tax advisor.">
          <Select id="ct-w8" name="w8Status" defaultValue={(initial.w8Status as string) ?? ''}>
            <option value="">—</option>
            <option value="NOT_REQUIRED">Not required</option>
            <option value="REQUESTED">Requested</option>
            <option value="RECEIVED">Received</option>
          </Select>
        </Field>
        <Field label="Notes" htmlFor="ct-notes" className="col-span-2">
          <Textarea id="ct-notes" name="notes" defaultValue={(initial.notes as string) ?? ''} className="min-h-9" />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Save contractor details</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PaymentForm({ workerId, currency }: { workerId: string; currency: string }) {
  return (
    <ActionForm action={recordContractorPaymentAction} className="grid grid-cols-2 gap-3 sm:grid-cols-5" resetOnSuccess>
      <input type="hidden" name="workerId" value={workerId} />
      <Field label="Invoice #" htmlFor="pay-ref">
        <Input id="pay-ref" name="invoiceRef" />
      </Field>
      <Field label="Amount" htmlFor="pay-amount" required>
        <Input id="pay-amount" name="amount" type="number" step="0.01" min="0" required />
      </Field>
      <Field label="Currency" htmlFor="pay-currency">
        <Select id="pay-currency" name="currency" defaultValue={currency}>
          {['USD', 'PHP'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <Field label="Paid on" htmlFor="pay-date">
        <Input id="pay-date" name="paidAt" type="date" />
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="secondary">Record payment</SubmitButton>
      </div>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
// Offboarding / termination
// ---------------------------------------------------------------------------

export function OffboardingForm({ workerId, status }: { workerId: string; status: string }) {
  if (status === 'TERMINATED') return null;
  if (status === 'OFFBOARDING') {
    return (
      <ActionForm action={finalizeTerminationAction} className="space-y-3">
        <input type="hidden" name="workerId" value={workerId} />
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" name="rehireEligible" defaultChecked className="h-4 w-4 rounded border-ink-300" />
          Eligible for rehire
        </label>
        <SubmitButton variant="danger" size="sm">
          Finalize termination & revoke access
        </SubmitButton>
        <p className="text-[12px] text-ink-400">
          Closes the employment record, deactivates the account, revokes app access. History is preserved.
        </p>
      </ActionForm>
    );
  }
  return (
    <ActionForm action={startOffboardingAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <input type="hidden" name="workerId" value={workerId} />
      <Field label="Last day" htmlFor="ob-last" required>
        <Input id="ob-last" name="lastDay" type="date" required />
      </Field>
      <Field label="Reason" htmlFor="ob-reason">
        <Select id="ob-reason" name="reason">
          {['RESIGNATION', 'TERMINATION', 'RETIREMENT', 'CONTRACT_END', 'LAYOFF', 'OTHER'].map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 pt-6 text-sm text-ink-700">
        <input type="checkbox" name="voluntary" defaultChecked className="h-4 w-4 rounded border-ink-300" />
        Voluntary
      </label>
      <div className="flex items-end">
        <SubmitButton variant="dangerGhost" size="md">
          Start offboarding
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
