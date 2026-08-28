"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { cn, slugify } from "@/lib/utils";
import {
  createBusinessUnitAction,
  createDepartmentAction,
  createLocationAction,
  createPositionAction,
  createTeamAction,
  updateBusinessUnitAction,
  updateDepartmentAction,
  updateLocationAction,
  updateTeamAction,
} from "@/app/(app)/admin/organization/actions";

export interface BusinessUnitRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  _count: { departments: number; users: number };
}
export interface DepartmentRow {
  id: string;
  name: string;
  isActive: boolean;
  businessUnit: { id: string; name: string };
  _count: { teams: number; users: number; positions: number };
}
export interface TeamRow {
  id: string;
  name: string;
  isActive: boolean;
  department: { id: string; name: string };
  _count: { users: number };
}
export interface LocationRow {
  id: string;
  name: string;
  country: string;
  state: string | null;
  city: string | null;
  timezone: string;
  isActive: boolean;
  _count: { users: number };
}
export interface PositionRow {
  id: string;
  title: string;
  isActive: boolean;
  department: { id: string; name: string } | null;
  _count: { users: number; skillRequirements: number; trainingRequirements: number };
}

const TAB_TRIGGER_CLASS = cn(
  "rounded-t-md px-3 py-2 text-[0.8125rem] font-medium text-[var(--text-muted)] transition-colors",
  "hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
  "data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand-primary)] data-[state=active]:text-[var(--text-primary)]",
);

function ActiveToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
    >
      <Badge tone={active ? "success" : "neutral"} dot>
        {active ? "Active" : "Inactive"}
      </Badge>
    </button>
  );
}

function BusinessUnitsTab({ items }: { items: BusinessUnitRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");

  function create() {
    startTransition(async () => {
      const result = await createBusinessUnitAction({ name, slug: slug || slugify(name), description: description || null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Business unit created.");
      setName("");
      setSlug("");
      setDescription("");
      router.refresh();
    });
  }

  function toggle(row: BusinessUnitRow) {
    startTransition(async () => {
      const result = await updateBusinessUnitAction(row.id, { isActive: !row.isActive });
      if (!result.ok) return toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem_1fr_auto] sm:items-end">
        <Field label="Name" htmlFor="bu-name">
          <Input id="bu-name" value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(slugify(e.target.value)); }} />
        </Field>
        <Field label="Slug" htmlFor="bu-slug">
          <Input id="bu-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="bu-desc">
          <Input id="bu-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Button onClick={create} loading={pending} disabled={!name || !slug}>
          Add
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Name</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Departments</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">People</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-[var(--border-subtle)] p-2.5 font-medium text-[var(--text-primary)]">
                  {row.name} <span className="font-normal text-[var(--text-muted)]">({row.slug})</span>
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.departments}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.users}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <ActiveToggle active={row.isActive} onToggle={() => toggle(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DepartmentsTab({ items, businessUnits }: { items: DepartmentRow[]; businessUnits: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState(businessUnits[0]?.id ?? "");

  function create() {
    startTransition(async () => {
      const result = await createDepartmentAction({ name, businessUnitId });
      if (!result.ok) return toast.error(result.error);
      toast.success("Department created.");
      setName("");
      router.refresh();
    });
  }
  function toggle(row: DepartmentRow) {
    startTransition(async () => {
      const result = await updateDepartmentAction(row.id, { isActive: !row.isActive });
      if (!result.ok) return toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Name" htmlFor="dept-name">
          <Input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Business unit" htmlFor="dept-bu">
          <Select id="dept-bu" value={businessUnitId} onChange={(e) => setBusinessUnitId(e.target.value)}>
            {businessUnits.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={create} loading={pending} disabled={!name || !businessUnitId}>
          Add
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Name</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Business unit</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Teams</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Positions</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">People</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-[var(--border-subtle)] p-2.5 font-medium text-[var(--text-primary)]">{row.name}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.businessUnit.name}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.teams}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.positions}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.users}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <ActiveToggle active={row.isActive} onToggle={() => toggle(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamsTab({ items, departments }: { items: TeamRow[]; departments: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");

  function create() {
    startTransition(async () => {
      const result = await createTeamAction({ name, departmentId });
      if (!result.ok) return toast.error(result.error);
      toast.success("Team created.");
      setName("");
      router.refresh();
    });
  }
  function toggle(row: TeamRow) {
    startTransition(async () => {
      const result = await updateTeamAction(row.id, { isActive: !row.isActive });
      if (!result.ok) return toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Name" htmlFor="team-name">
          <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Department" htmlFor="team-dept">
          <Select id="team-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={create} loading={pending} disabled={!name || !departmentId}>
          Add
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Name</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Department</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">People</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-[var(--border-subtle)] p-2.5 font-medium text-[var(--text-primary)]">{row.name}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.department.name}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.users}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <ActiveToggle active={row.isActive} onToggle={() => toggle(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LocationsTab({ items }: { items: LocationRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("US");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");

  function create() {
    startTransition(async () => {
      const result = await createLocationAction({ name, country, state: state || null, city: city || null, timezone });
      if (!result.ok) return toast.error(result.error);
      toast.success("Location created.");
      setName("");
      router.refresh();
    });
  }
  function toggle(row: LocationRow) {
    startTransition(async () => {
      const result = await updateLocationAction(row.id, { isActive: !row.isActive });
      if (!result.ok) return toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_5rem_6rem_1fr_1fr_auto] lg:items-end">
        <Field label="Name" htmlFor="loc-name">
          <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Country" htmlFor="loc-country">
          <Input id="loc-country" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} />
        </Field>
        <Field label="State" htmlFor="loc-state">
          <Input id="loc-state" value={state} onChange={(e) => setState(e.target.value)} />
        </Field>
        <Field label="City" htmlFor="loc-city">
          <Input id="loc-city" value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="Timezone (IANA)" htmlFor="loc-tz">
          <Input id="loc-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
        <Button onClick={create} loading={pending} disabled={!name || !country}>
          Add
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Name</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Country</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Timezone</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">People</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-[var(--border-subtle)] p-2.5 font-medium text-[var(--text-primary)]">
                  {row.name}
                  {row.city ? ` · ${row.city}` : ""}
                  {row.state ? `, ${row.state}` : ""}
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.country}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.timezone}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.users}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <ActiveToggle active={row.isActive} onToggle={() => toggle(row)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PositionsTab({ items, departments }: { items: PositionRow[]; departments: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");

  function create() {
    startTransition(async () => {
      const result = await createPositionAction({ title, departmentId: departmentId || null });
      if (!result.ok) return toast.error(result.error);
      toast.success("Position created.");
      setTitle("");
      router.push(`/admin/organization/positions/${result.data.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Title" htmlFor="pos-title">
          <Input id="pos-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Department" htmlFor="pos-dept">
          <Select id="pos-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Unassigned</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={create} loading={pending} disabled={!title}>
          Add
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Title</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Department</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Skills req.</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Training req.</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Headcount</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-[var(--border-subtle)] p-2.5 font-medium text-[var(--text-primary)]">{row.title}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.department?.name ?? "—"}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.skillRequirements}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.trainingRequirements}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row._count.users}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5 text-right">
                  <Link href={`/admin/organization/positions/${row.id}`} className="text-[var(--brand-secondary)] hover:underline">
                    Edit requirements
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OrgTabs({
  businessUnits,
  departments,
  teams,
  locations,
  positions,
}: {
  businessUnits: BusinessUnitRow[];
  departments: DepartmentRow[];
  teams: TeamRow[];
  locations: LocationRow[];
  positions: PositionRow[];
}) {
  return (
    <Tabs.Root defaultValue="business-units" className="flex flex-col gap-4">
      <Tabs.List className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]" aria-label="Organization sections">
        <Tabs.Trigger value="business-units" className={TAB_TRIGGER_CLASS}>
          Business units ({businessUnits.length})
        </Tabs.Trigger>
        <Tabs.Trigger value="departments" className={TAB_TRIGGER_CLASS}>
          Departments ({departments.length})
        </Tabs.Trigger>
        <Tabs.Trigger value="teams" className={TAB_TRIGGER_CLASS}>
          Teams ({teams.length})
        </Tabs.Trigger>
        <Tabs.Trigger value="locations" className={TAB_TRIGGER_CLASS}>
          Locations ({locations.length})
        </Tabs.Trigger>
        <Tabs.Trigger value="positions" className={TAB_TRIGGER_CLASS}>
          Positions ({positions.length})
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="business-units">
        <BusinessUnitsTab items={businessUnits} />
      </Tabs.Content>
      <Tabs.Content value="departments">
        <DepartmentsTab items={departments} businessUnits={businessUnits} />
      </Tabs.Content>
      <Tabs.Content value="teams">
        <TeamsTab items={teams} departments={departments} />
      </Tabs.Content>
      <Tabs.Content value="locations">
        <LocationsTab items={locations} />
      </Tabs.Content>
      <Tabs.Content value="positions">
        <PositionsTab items={positions} departments={departments} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
