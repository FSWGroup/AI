"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createSkillAction,
  deleteSkillLevelAction,
  updateSkillAction,
  upsertSkillLevelAction,
} from "@/app/(app)/admin/skills/actions";

export interface SkillRow {
  id: string;
  name: string;
  category: string | null;
  isActive: boolean;
  _count?: { userSkills: number; requirements: number };
}
export interface SkillLevelRow {
  value: number;
  name: string;
}

const TAB_TRIGGER_CLASS = cn(
  "rounded-t-md px-3 py-2 text-[0.8125rem] font-medium text-[var(--text-muted)] transition-colors",
  "hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
  "data-[state=active]:border-b-2 data-[state=active]:border-[var(--brand-primary)] data-[state=active]:text-[var(--text-primary)]",
);

function SkillsLibraryTab({ items }: { items: SkillRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");

  function create() {
    startTransition(async () => {
      const result = await createSkillAction({ name, category: category || null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Skill created.");
      setName("");
      setCategory("");
      router.refresh();
    });
  }
  function toggle(row: SkillRow) {
    startTransition(async () => {
      const result = await updateSkillAction(row.id, { isActive: !row.isActive });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Skill name" htmlFor="skill-name">
          <Input id="skill-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Category" htmlFor="skill-category">
          <Input id="skill-category" value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Button onClick={create} loading={pending} disabled={!name}>
          Add
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                Skill
              </th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                Category
              </th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                Status
              </th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-[var(--border-subtle)] p-2.5 font-medium text-[var(--text-primary)]">
                  <Link href={`/skills/${row.id}`} className="hover:underline">
                    {row.name}
                  </Link>
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.category ?? "—"}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <Badge tone={row.isActive ? "success" : "neutral"} dot>
                    {row.isActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => toggle(row)}>
                    {row.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProficiencyScaleTab({ levels }: { levels: SkillLevelRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(levels.length > 0 ? Math.max(...levels.map((l) => l.value)) + 1 : 0);
  const [name, setName] = useState("");

  function add() {
    startTransition(async () => {
      const result = await upsertSkillLevelAction(value, name);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Level saved.");
      setName("");
      setValue((v) => v + 1);
      router.refresh();
    });
  }
  function remove(v: number) {
    startTransition(async () => {
      const result = await deleteSkillLevelAction(v);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.8125rem] text-[var(--text-muted)]">
        The proficiency scale used across skill assessments and the team skills matrix. Levels are ordered by value.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[6rem_1fr_auto] sm:items-end">
        <Field label="Value" htmlFor="level-value">
          <Input id="level-value" type="number" min={0} value={value} onChange={(e) => setValue(Number(e.target.value))} />
        </Field>
        <Field label="Name" htmlFor="level-name">
          <Input id="level-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button onClick={add} loading={pending} disabled={!name}>
          Add / update
        </Button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {levels.map((level) => (
          <li
            key={level.value}
            className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] p-2.5"
          >
            <span className="text-[0.8125rem] text-[var(--text-primary)]">
              <Badge tone="navy">{level.value}</Badge> <span className="ml-2">{level.name}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => remove(level.value)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SkillsAdminTabs({ skills, levels }: { skills: SkillRow[]; levels: SkillLevelRow[] }) {
  return (
    <Tabs.Root defaultValue="library" className="flex flex-col gap-4">
      <Tabs.List className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]" aria-label="Skills administration">
        <Tabs.Trigger value="library" className={TAB_TRIGGER_CLASS}>
          Skills library ({skills.length})
        </Tabs.Trigger>
        <Tabs.Trigger value="scale" className={TAB_TRIGGER_CLASS}>
          Proficiency scale ({levels.length})
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="library">
        <SkillsLibraryTab items={skills} />
      </Tabs.Content>
      <Tabs.Content value="scale">
        <ProficiencyScaleTab levels={levels} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
