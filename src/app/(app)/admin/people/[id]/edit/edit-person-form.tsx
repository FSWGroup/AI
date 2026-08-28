"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { Icon } from "@/components/icons";
import { updatePersonAction } from "@/app/(app)/admin/people/[id]/edit/actions";
import type { ProfileChangeResult } from "@/lib/services/assignment";

interface OptionList {
  businessUnits: { id: string; name: string }[];
  departments: { id: string; name: string; businessUnitId: string }[];
  teams: { id: string; name: string; departmentId: string }[];
  positions: { id: string; title: string; departmentId: string | null }[];
  locations: { id: string; name: string }[];
  managers: { id: string; name: string }[];
}

export interface EditablePerson {
  id: string;
  name: string;
  title: string | null;
  legalName: string | null;
  personalEmail: string | null;
  workPhone: string | null;
  mobilePhone: string | null;
  employeeId: string | null;
  workerType: string;
  country: string;
  state: string | null;
  startDateIso: string | null;
  businessUnitId: string | null;
  departmentId: string | null;
  teamId: string | null;
  positionId: string | null;
  locationId: string | null;
  managerId: string | null;
}

const WORKER_TYPES = [
  ["US_EMPLOYEE", "US Employee"],
  ["US_CONTRACTOR", "US Contractor"],
  ["PH_EMPLOYEE", "PH Employee"],
  ["PH_CONTRACTOR", "PH Contractor"],
  ["INTL_EMPLOYEE", "International Employee"],
  ["INTL_CONTRACTOR", "International Contractor"],
] as const;

export function EditPersonForm({ person, options }: { person: EditablePerson; options: OptionList }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [businessUnitId, setBusinessUnitId] = useState(person.businessUnitId ?? "");
  const [departmentId, setDepartmentId] = useState(person.departmentId ?? "");
  const [diff, setDiff] = useState<ProfileChangeResult | null>(null);

  const departments = options.departments.filter((d) => !businessUnitId || d.businessUnitId === businessUnitId);
  const teams = options.teams.filter((t) => !departmentId || t.departmentId === departmentId);
  const positions = options.positions.filter((p) => !departmentId || p.departmentId === departmentId);
  const managerOptions = options.managers.filter((m) => m.id !== person.id);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await updatePersonAction(person.id, {
        name: String(formData.get("name") ?? "").trim(),
        title: String(formData.get("title") ?? "").trim() || null,
        legalName: String(formData.get("legalName") ?? "").trim() || null,
        personalEmail: String(formData.get("personalEmail") ?? "").trim() || null,
        workPhone: String(formData.get("workPhone") ?? "").trim() || null,
        mobilePhone: String(formData.get("mobilePhone") ?? "").trim() || null,
        employeeId: String(formData.get("employeeId") ?? "").trim() || null,
        workerType: formData.get("workerType") as never,
        country: String(formData.get("country") ?? "US").trim() || "US",
        state: String(formData.get("state") ?? "").trim() || null,
        businessUnitId: (formData.get("businessUnitId") as string) || null,
        departmentId: (formData.get("departmentId") as string) || null,
        teamId: (formData.get("teamId") as string) || null,
        positionId: (formData.get("positionId") as string) || null,
        locationId: (formData.get("locationId") as string) || null,
        managerId: (formData.get("managerId") as string) || null,
        startDate: formData.get("startDate") ? new Date(String(formData.get("startDate"))) : null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Profile updated.");
      setDiff(result.data);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="ep-name" required>
          <Input id="ep-name" name="name" defaultValue={person.name} required />
        </Field>
        <Field label="Legal name" htmlFor="ep-legal">
          <Input id="ep-legal" name="legalName" defaultValue={person.legalName ?? ""} />
        </Field>
        <Field label="Title" htmlFor="ep-title">
          <Input id="ep-title" name="title" defaultValue={person.title ?? ""} />
        </Field>
        <Field label="Employee ID" htmlFor="ep-empid">
          <Input id="ep-empid" name="employeeId" defaultValue={person.employeeId ?? ""} />
        </Field>
        <Field label="Personal email" htmlFor="ep-personal-email">
          <Input id="ep-personal-email" name="personalEmail" type="email" defaultValue={person.personalEmail ?? ""} />
        </Field>
        <Field label="Work phone" htmlFor="ep-work-phone">
          <Input id="ep-work-phone" name="workPhone" defaultValue={person.workPhone ?? ""} />
        </Field>
        <Field label="Mobile phone" htmlFor="ep-mobile-phone">
          <Input id="ep-mobile-phone" name="mobilePhone" defaultValue={person.mobilePhone ?? ""} />
        </Field>
        <Field label="Start date" htmlFor="ep-start">
          <Input id="ep-start" name="startDate" type="date" defaultValue={person.startDateIso ?? ""} />
        </Field>
        <Field label="Worker type" htmlFor="ep-wt" required>
          <Select id="ep-wt" name="workerType" defaultValue={person.workerType} required>
            {WORKER_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Country (ISO 3166-1 alpha-2)" htmlFor="ep-country">
          <Input id="ep-country" name="country" defaultValue={person.country} maxLength={2} />
        </Field>
        <Field label="State / province" htmlFor="ep-state">
          <Input id="ep-state" name="state" defaultValue={person.state ?? ""} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business unit" htmlFor="ep-bu">
          <Select id="ep-bu" name="businessUnitId" value={businessUnitId} onChange={(e) => setBusinessUnitId(e.target.value)}>
            <option value="">Unassigned</option>
            {options.businessUnits.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Department" htmlFor="ep-dept">
          <Select id="ep-dept" name="departmentId" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Unassigned</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team" htmlFor="ep-team">
          <Select id="ep-team" name="teamId" defaultValue={person.teamId ?? ""}>
            <option value="">Unassigned</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Position" htmlFor="ep-position">
          <Select id="ep-position" name="positionId" defaultValue={person.positionId ?? ""}>
            <option value="">Unassigned</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location" htmlFor="ep-location">
          <Select id="ep-location" name="locationId" defaultValue={person.locationId ?? ""}>
            <option value="">Unassigned</option>
            {options.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Manager" htmlFor="ep-manager">
          <Select id="ep-manager" name="managerId" defaultValue={person.managerId ?? ""}>
            <option value="">No manager</option>
            {managerOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" loading={pending}>
          Save changes
        </Button>
      </div>

      {diff?.positionDiff && (diff.positionDiff.newlyRequired.length > 0 || diff.positionDiff.noLongerRequired.length > 0) && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-sunken)] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="assignment" className="h-4 w-4 text-[var(--text-muted)]" />
            <h3 className="text-[0.8125rem] font-semibold text-[var(--text-primary)]">Training requirement changes</h3>
          </div>
          {diff.positionDiff.newlyRequired.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[0.75rem] font-medium text-[var(--text-secondary)]">
                Newly required ({diff.positionAssignmentsCreated} assigned automatically):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {diff.positionDiff.newlyRequired.map((r) => (
                  <Badge key={`${r.targetType}-${r.courseId ?? r.sopId ?? r.pathId}`} tone="success">
                    {r.title}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {diff.positionDiff.noLongerRequired.length > 0 && (
            <div>
              <p className="mb-1 text-[0.75rem] font-medium text-[var(--text-secondary)]">
                No longer required by the new position (review and waive/unassign manually if appropriate):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {diff.positionDiff.noLongerRequired.map((r) => (
                  <Badge key={`${r.targetType}-${r.courseId ?? r.sopId ?? r.pathId}`} tone="warning">
                    {r.title}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
