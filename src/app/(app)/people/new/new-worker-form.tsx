'use client';

import { useState } from 'react';
import { Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton, UnsavedChangesGuard } from '@/components/ui/client';
import { createWorkerAction } from '../actions';
import type { Option } from '../[id]/edit-forms';

export function NewWorkerForm({
  entities,
  departments,
  locations,
  managers,
}: {
  entities: Option[];
  departments: Option[];
  locations: Option[];
  managers: Option[];
}) {
  const [country, setCountry] = useState('US');
  const [workerType, setWorkerType] = useState('EMPLOYEE');

  return (
    <ActionForm action={createWorkerAction} id="new-worker-form">
      <UnsavedChangesGuard formId="new-worker-form" />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Identity" />
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Legal first name" htmlFor="nw-first" required>
              <Input id="nw-first" name="legalFirstName" required />
            </Field>
            <Field label="Last name" htmlFor="nw-last" required>
              <Input id="nw-last" name="lastName" required />
            </Field>
            <Field label="Preferred name" htmlFor="nw-pref">
              <Input id="nw-pref" name="preferredName" />
            </Field>
            <Field label="Phone" htmlFor="nw-phone">
              <Input id="nw-phone" name="phone" />
            </Field>
            <Field label="Work email" htmlFor="nw-wemail" hint="Used for the FSW People account invitation.">
              <Input id="nw-wemail" name="workEmail" type="email" />
            </Field>
            <Field label="Personal email" htmlFor="nw-pemail">
              <Input id="nw-pemail" name="personalEmail" type="email" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Classification & location" />
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Worker type" htmlFor="nw-type" required hint="HR-controlled; never auto-derived.">
              <Select id="nw-type" name="workerType" value={workerType} onChange={(e) => setWorkerType(e.target.value)}>
                <option value="EMPLOYEE">Employee</option>
                <option value="CONTRACTOR">Independent contractor</option>
                <option value="EOR">EOR / third-party employed</option>
                <option value="AGENCY">Agency</option>
              </Select>
            </Field>
            <Field label="Country" htmlFor="nw-country" required>
              <Select id="nw-country" name="country" value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="US">United States</option>
                <option value="PH">Philippines</option>
              </Select>
            </Field>
            <Field label="Start date" htmlFor="nw-hire" required>
              <Input id="nw-hire" name="hireDate" type="date" required />
            </Field>
            {workerType !== 'EMPLOYEE' ? (
              <Field label="Engagement model" htmlFor="nw-engage">
                <Select id="nw-engage" name="engagementModel">
                  <option value="DIRECT">Direct contractor</option>
                  <option value="EOR">Via employer-of-record</option>
                  <option value="STAFF_AUGMENTATION">Staff augmentation</option>
                </Select>
              </Field>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Job" />
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Title" htmlFor="nw-title" required>
              <Input id="nw-title" name="title" required />
            </Field>
            <Field label="Legal entity" htmlFor="nw-entity" required>
              <Select id="nw-entity" name="legalEntityId" required>
                {entities.map((e) => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Department" htmlFor="nw-dept">
              <Select id="nw-dept" name="departmentId">
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Manager" htmlFor="nw-mgr">
              <Select id="nw-mgr" name="managerId">
                <option value="">—</option>
                {managers.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Location" htmlFor="nw-loc">
              <Select id="nw-loc" name="locationId">
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Work mode" htmlFor="nw-mode">
              <Select id="nw-mode" name="workMode">
                <option value="ONSITE">Onsite</option>
                <option value="HYBRID">Hybrid</option>
                <option value="REMOTE">Remote</option>
              </Select>
            </Field>
            <Field label="Job family" htmlFor="nw-family">
              <Input id="nw-family" name="jobFamily" placeholder="e.g. Sales" />
            </Field>
            <Field label="Job level" htmlFor="nw-level">
              <Input id="nw-level" name="jobLevel" placeholder="e.g. IC2" />
            </Field>
            {country === 'US' ? (
              <Field label="Work state" htmlFor="nw-state" hint="Drives state onboarding & compliance rules.">
                <Input id="nw-state" name="workState" maxLength={2} defaultValue="PA" />
              </Field>
            ) : null}
            {country === 'US' && workerType === 'EMPLOYEE' ? (
              <>
                <Field label="FLSA classification" htmlFor="nw-flsa">
                  <Select id="nw-flsa" name="flsaStatus">
                    <option value="EXEMPT">Exempt</option>
                    <option value="NON_EXEMPT">Non-exempt</option>
                  </Select>
                </Field>
                <Field label="Pay basis" htmlFor="nw-basis">
                  <Select id="nw-basis" name="payBasis">
                    <option value="SALARY">Salary</option>
                    <option value="HOURLY">Hourly</option>
                  </Select>
                </Field>
                <Field label="Full/part time" htmlFor="nw-fpt">
                  <Select id="nw-fpt" name="employmentBasis">
                    <option value="FULL_TIME">Full-time</option>
                    <option value="PART_TIME">Part-time</option>
                  </Select>
                </Field>
              </>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Compensation (optional now, effective-dated)" />
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Amount" htmlFor="nw-amount">
              <Input id="nw-amount" name="amount" type="number" step="0.01" min="0" />
            </Field>
            <Field label="Currency" htmlFor="nw-currency">
              <Select id="nw-currency" name="currency" defaultValue={country === 'PH' ? 'PHP' : 'USD'}>
                <option value="USD">USD</option>
                <option value="PHP">PHP</option>
              </Select>
            </Field>
            <Field label="Rate type" htmlFor="nw-rate">
              <Select id="nw-rate" name="rateType">
                <option value="ANNUAL">Annual</option>
                <option value="MONTHLY">Monthly</option>
                <option value="HOURLY">Hourly</option>
                <option value="DAILY">Daily</option>
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" name="inviteUser" defaultChecked className="h-4 w-4 rounded border-ink-300" />
              Send account invitation to the work email
            </label>
            <SubmitButton pendingLabel="Creating…">Create worker & start onboarding</SubmitButton>
          </CardBody>
        </Card>
      </div>
    </ActionForm>
  );
}
