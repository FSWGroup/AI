"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { createPersonAction } from "@/app/(app)/admin/people/actions";

interface OptionList {
  businessUnits: { id: string; name: string }[];
  departments: { id: string; name: string; businessUnitId: string }[];
  teams: { id: string; name: string; departmentId: string }[];
  positions: { id: string; title: string; departmentId: string | null }[];
  locations: { id: string; name: string }[];
  managers: { id: string; name: string }[];
}

const WORKER_TYPES = [
  ["US_EMPLOYEE", "US Employee"],
  ["US_CONTRACTOR", "US Contractor"],
  ["PH_EMPLOYEE", "PH Employee"],
  ["PH_CONTRACTOR", "PH Contractor"],
  ["INTL_EMPLOYEE", "International Employee"],
  ["INTL_CONTRACTOR", "International Contractor"],
] as const;

export function NewPersonForm({ options }: { options: OptionList }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [departmentId, setDepartmentId] = useState("");

  const departments = options.departments.filter((d) => !businessUnitId || d.businessUnitId === businessUnitId);
  const teams = options.teams.filter((t) => !departmentId || t.departmentId === departmentId);
  const positions = options.positions.filter((p) => !departmentId || p.departmentId === departmentId);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createPersonAction({
        email: String(formData.get("email") ?? "").trim(),
        name: String(formData.get("name") ?? "").trim(),
        title: String(formData.get("title") ?? "").trim() || null,
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
      toast.success("Person created.");
      router.push(`/admin/people/${result.data.id}/edit`);
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="np-name" required>
          <Input id="np-name" name="name" required />
        </Field>
        <Field label="Work email" htmlFor="np-email" required>
          <Input id="np-email" name="email" type="email" required />
        </Field>
        <Field label="Title" htmlFor="np-title">
          <Input id="np-title" name="title" />
        </Field>
        <Field label="Employee ID" htmlFor="np-empid">
          <Input id="np-empid" name="employeeId" />
        </Field>
        <Field label="Worker type" htmlFor="np-wt" required>
          <Select id="np-wt" name="workerType" defaultValue="US_EMPLOYEE" required>
            {WORKER_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start date" htmlFor="np-start">
          <Input id="np-start" name="startDate" type="date" />
        </Field>
        <Field label="Country (ISO 3166-1 alpha-2)" htmlFor="np-country">
          <Input id="np-country" name="country" defaultValue="US" maxLength={2} />
        </Field>
        <Field label="State / province" htmlFor="np-state">
          <Input id="np-state" name="state" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business unit" htmlFor="np-bu">
          <Select id="np-bu" name="businessUnitId" value={businessUnitId} onChange={(e) => setBusinessUnitId(e.target.value)}>
            <option value="">Unassigned</option>
            {options.businessUnits.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Department" htmlFor="np-dept">
          <Select id="np-dept" name="departmentId" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Unassigned</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Team" htmlFor="np-team">
          <Select id="np-team" name="teamId" defaultValue="">
            <option value="">Unassigned</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Position" htmlFor="np-position">
          <Select id="np-position" name="positionId" defaultValue="">
            <option value="">Unassigned</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location" htmlFor="np-location">
          <Select id="np-location" name="locationId" defaultValue="">
            <option value="">Unassigned</option>
            {options.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Manager" htmlFor="np-manager">
          <Select id="np-manager" name="managerId" defaultValue="">
            <option value="">No manager</option>
            {options.managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="text-[0.75rem] text-[var(--text-muted)]">
        The learner role is assigned automatically (plus the contractor role for contractor worker types), and applicable
        assignment rules and position requirements run immediately after creation.
      </p>

      <div className="flex justify-end gap-2">
        <Button type="submit" loading={pending}>
          Create person
        </Button>
      </div>
    </form>
  );
}
