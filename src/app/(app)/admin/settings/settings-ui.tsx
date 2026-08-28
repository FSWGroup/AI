'use client';

import { Field, Input, Select } from '@/components/ui';
import { ActionForm, SubmitButton, ConfirmSubmit } from '@/components/ui/client';
import {
  saveOrganizationAction, saveEntityAction, saveDepartmentAction, saveLocationAction, saveHolidayAction,
  savePtoPolicyAction, assignPtoPolicyAction, setUserRolesAction, setUserStatusAction, resendInviteAction,
  inviteUserForWorkerAction, setRolePermissionsAction, saveCustomFieldAction, deleteCustomFieldAction,
} from './actions';

interface Option {
  value: string;
  label: string;
}

export function OrgForm({ name, accentColor, logoUrl, tagline }: { name: string; accentColor: string; logoUrl: string; tagline: string }) {
  return (
    <ActionForm action={saveOrganizationAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Organization name" htmlFor="og-name" required>
        <Input id="og-name" name="name" defaultValue={name} required />
      </Field>
      <Field label="Tagline" htmlFor="og-tagline">
        <Input id="og-tagline" name="tagline" defaultValue={tagline} />
      </Field>
      <Field label="Accent colour" htmlFor="og-accent" hint="Hex value used for highlights.">
        <Input id="og-accent" name="accentColor" defaultValue={accentColor} placeholder="#1f4e79" />
      </Field>
      <Field label="Logo URL" htmlFor="og-logo">
        <Input id="og-logo" name="logoUrl" defaultValue={logoUrl} type="url" />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>Save organization</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EntityForm() {
  return (
    <ActionForm action={saveEntityAction} className="grid grid-cols-2 gap-3 sm:grid-cols-4" resetOnSuccess>
      <Field label="Entity name" htmlFor="en-name" required>
        <Input id="en-name" name="name" required />
      </Field>
      <Field label="Code" htmlFor="en-code" required hint="Short unique code.">
        <Input id="en-code" name="code" required maxLength={8} />
      </Field>
      <Field label="Country" htmlFor="en-country">
        <Select id="en-country" name="country">
          <option value="US">United States</option>
          <option value="PH">Philippines</option>
        </Select>
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="secondary">Add entity</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DepartmentForm() {
  return (
    <ActionForm action={saveDepartmentAction} className="flex items-end gap-3" resetOnSuccess>
      <Field label="Department name" htmlFor="dp-name" required className="flex-1">
        <Input id="dp-name" name="name" required />
      </Field>
      <SubmitButton variant="secondary">Add department</SubmitButton>
    </ActionForm>
  );
}

export function LocationForm() {
  return (
    <ActionForm action={saveLocationAction} className="grid grid-cols-2 gap-3 sm:grid-cols-4" resetOnSuccess>
      <Field label="Location name" htmlFor="lo-name" required>
        <Input id="lo-name" name="name" required />
      </Field>
      <Field label="Street" htmlFor="lo-street">
        <Input id="lo-street" name="street" />
      </Field>
      <Field label="City" htmlFor="lo-city">
        <Input id="lo-city" name="city" />
      </Field>
      <Field label="State / region" htmlFor="lo-state">
        <Input id="lo-state" name="state" />
      </Field>
      <Field label="Postal code" htmlFor="lo-postal">
        <Input id="lo-postal" name="postal" />
      </Field>
      <Field label="Country" htmlFor="lo-country">
        <Select id="lo-country" name="country">
          <option value="US">United States</option>
          <option value="PH">Philippines</option>
        </Select>
      </Field>
      <Field label="Timezone" htmlFor="lo-tz">
        <Select id="lo-tz" name="timezone">
          {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Manila'].map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="secondary">Add location</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function HolidayForm({ calendars }: { calendars: Option[] }) {
  return (
    <ActionForm action={saveHolidayAction} className="grid grid-cols-2 gap-3 sm:grid-cols-5" resetOnSuccess>
      <Field label="Calendar" htmlFor="ho-cal" required>
        <Select id="ho-cal" name="calendarId" required>
          {calendars.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Holiday name" htmlFor="ho-name" required>
        <Input id="ho-name" name="name" required />
      </Field>
      <Field label="Date" htmlFor="ho-date" required>
        <Input id="ho-date" name="date" type="date" required />
      </Field>
      <Field label="Kind" htmlFor="ho-kind">
        <Select id="ho-kind" name="kind">
          <option value="PAID">Paid</option>
          <option value="UNPAID">Unpaid</option>
          <option value="FLOATING">Floating</option>
        </Select>
      </Field>
      <div className="flex items-end">
        <SubmitButton variant="secondary">Add holiday</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PtoPolicyForm() {
  return (
    <ActionForm action={savePtoPolicyAction} className="grid grid-cols-2 gap-3 sm:grid-cols-4" resetOnSuccess>
      <Field label="Policy name" htmlFor="pp-name" required>
        <Input id="pp-name" name="name" required />
      </Field>
      <Field label="Leave type" htmlFor="pp-type">
        <Select id="pp-type" name="leaveType">
          {['VACATION', 'SICK', 'PERSONAL', 'FLOATING', 'BEREAVEMENT', 'PARENTAL', 'JURY', 'UNPAID', 'CUSTOM'].map((t) => (
            <option key={t} value={t}>
              {t.toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Country" htmlFor="pp-country">
        <Select id="pp-country" name="country">
          <option value="">Any</option>
          <option value="US">United States</option>
          <option value="PH">Philippines</option>
        </Select>
      </Field>
      <Field label="Accrual method" htmlFor="pp-accrual">
        <Select id="pp-accrual" name="accrualMethod">
          <option value="ANNUAL_GRANT">Annual grant</option>
          <option value="FRONTLOAD">Front-load</option>
          <option value="MONTHLY">Monthly</option>
          <option value="PER_PAY_PERIOD">Per pay period</option>
          <option value="NONE">No accrual</option>
        </Select>
      </Field>
      <Field label="Hours per year" htmlFor="pp-hours" required>
        <Input id="pp-hours" name="hoursPerYear" type="number" step="0.5" required />
      </Field>
      <Field label="Carryover cap (hours)" htmlFor="pp-carry">
        <Input id="pp-carry" name="carryoverCapHours" type="number" step="0.5" />
      </Field>
      <Field label="Max balance (hours)" htmlFor="pp-max">
        <Input id="pp-max" name="maxBalanceHours" type="number" step="0.5" />
      </Field>
      <Field label="Waiting period (days)" htmlFor="pp-wait">
        <Input id="pp-wait" name="waitingPeriodDays" type="number" defaultValue={0} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="allowNegative" className="h-4 w-4 rounded border-ink-300" />
        Allow negative balances
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="requiresApproval" defaultChecked className="h-4 w-4 rounded border-ink-300" />
        Requires manager approval
      </label>
      <div className="col-span-2 flex items-end sm:col-span-4">
        <SubmitButton variant="secondary">Create policy</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AssignPtoForm({ policyId, workers }: { policyId: string; workers: Option[] }) {
  return (
    <ActionForm action={assignPtoPolicyAction} className="flex items-center gap-1.5">
      <input type="hidden" name="policyId" value={policyId} />
      <Select name="target" aria-label="Assign policy to" className="h-7 w-36 py-0 text-[12px]">
        <option value="ALL_COUNTRY">Everyone in country</option>
        {workers.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </Select>
      <SubmitButton variant="secondary" size="sm" className="h-7 px-2 text-[12px]">
        Assign
      </SubmitButton>
    </ActionForm>
  );
}

export function UserRolesForm({ userId, allRoles, current }: { userId: string; allRoles: Option[]; current: string[] }) {
  return (
    <ActionForm action={setUserRolesAction} className="flex items-center gap-1.5">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="roleIds"
        multiple
        defaultValue={current}
        aria-label="Roles"
        size={2}
        className="w-40 rounded border border-ink-200 bg-white px-2 py-1 text-[12px]"
      >
        {allRoles.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <SubmitButton variant="ghost" size="sm" className="h-7 px-2 text-[12px]">
        Save
      </SubmitButton>
    </ActionForm>
  );
}

export function UserStatusForm({ userId, status }: { userId: string; status: string }) {
  const next = status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  return (
    <ConfirmSubmit
      action={async (fd) => {
        await setUserStatusAction(undefined, fd);
      }}
      title={next === 'SUSPENDED' ? 'Suspend this account?' : 'Reactivate this account?'}
      description={next === 'SUSPENDED' ? 'All their sessions are signed out immediately.' : 'They will be able to sign in again.'}
      confirmLabel={next === 'SUSPENDED' ? 'Suspend' : 'Reactivate'}
      variant={next === 'SUSPENDED' ? 'dangerGhost' : 'secondary'}
      hiddenFields={{ userId, status: next }}
    >
      {next === 'SUSPENDED' ? 'Suspend' : 'Reactivate'}
    </ConfirmSubmit>
  );
}

export function ResendInviteButton({ userId }: { userId: string }) {
  return (
    <ActionForm action={resendInviteAction}>
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton variant="ghost" size="sm" className="h-7 px-2 text-[12px]">
        Resend invite
      </SubmitButton>
    </ActionForm>
  );
}

export function InviteWorkerForm({ workerId }: { workerId: string }) {
  return (
    <ActionForm action={inviteUserForWorkerAction}>
      <input type="hidden" name="workerId" value={workerId} />
      <SubmitButton variant="secondary" size="sm">
        Create account & invite
      </SubmitButton>
    </ActionForm>
  );
}

export function RolePermissionsForm({
  roleId,
  current,
  catalog,
}: {
  roleId: string;
  current: string[];
  catalog: { key: string; label: string }[];
}) {
  return (
    <ActionForm action={setRolePermissionsAction} className="space-y-3">
      <input type="hidden" name="roleId" value={roleId} />
      <ul className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto pr-2 sm:grid-cols-2">
        {catalog.map((p) => (
          <li key={p.key}>
            <label className="flex items-start gap-2 text-[12.5px]">
              <input
                type="checkbox"
                name="permissions"
                value={p.key}
                defaultChecked={current.includes(p.key)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-ink-300"
              />
              <span>
                <code className="text-[11.5px] text-ink-500">{p.key}</code>
                <span className="block text-ink-600">{p.label}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <SubmitButton variant="secondary" size="sm">
        Save permissions
      </SubmitButton>
    </ActionForm>
  );
}

export function CustomFieldForm() {
  return (
    <ActionForm action={saveCustomFieldAction} className="grid grid-cols-2 gap-3 sm:grid-cols-6" resetOnSuccess>
      <Field label="Label" htmlFor="cf-label" required>
        <Input id="cf-label" name="label" required />
      </Field>
      <Field label="Type" htmlFor="cf-type">
        <Select id="cf-type" name="fieldType">
          {['TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN', 'DROPDOWN', 'MULTI_SELECT', 'USER', 'URL'].map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Options" htmlFor="cf-options" hint="Comma separated (dropdowns).">
        <Input id="cf-options" name="options" />
      </Field>
      <Field label="Section" htmlFor="cf-section">
        <Input id="cf-section" name="section" defaultValue="Custom" />
      </Field>
      <Field label="Visibility" htmlFor="cf-vis">
        <Select id="cf-vis" name="visibility">
          <option value="HR">HR only</option>
          <option value="MANAGER">Manager & HR</option>
          <option value="SELF">Everyone with profile access</option>
        </Select>
      </Field>
      <label className="flex items-center gap-2 pt-6 text-sm text-ink-700">
        <input type="checkbox" name="required" className="h-4 w-4 rounded border-ink-300" />
        Required
      </label>
      <div className="col-span-2 sm:col-span-6">
        <SubmitButton variant="secondary">Save custom field</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DisableFieldButton({ fieldId }: { fieldId: string }) {
  return (
    <ConfirmSubmit
      action={deleteCustomFieldAction}
      title="Disable this custom field?"
      description="Existing values are kept but the field stops appearing on profiles."
      confirmLabel="Disable"
      variant="dangerGhost"
      hiddenFields={{ fieldId }}
    >
      Disable
    </ConfirmSubmit>
  );
}
