"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setUserRolesAction } from "@/app/(app)/admin/people/actions";

export function RolesEditor({
  userId,
  allRoles,
  currentRoleKeys,
}: {
  userId: string;
  allRoles: { key: string; name: string; description: string | null }[];
  currentRoleKeys: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(currentRoleKeys));
  const [pending, startTransition] = useTransition();

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setUserRolesAction(userId, [...selected]);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Roles updated.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {allRoles.map((role) => (
          <label
            key={role.key}
            className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--border-subtle)] p-2.5 hover:bg-[var(--surface-sunken)]"
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--brand-primary)]"
              checked={selected.has(role.key)}
              onChange={() => toggle(role.key)}
            />
            <span>
              <span className="block text-[0.8125rem] font-medium text-[var(--text-primary)]">{role.name}</span>
              {role.description && <span className="block text-[0.75rem] text-[var(--text-muted)]">{role.description}</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} loading={pending}>
          Save roles
        </Button>
      </div>
    </div>
  );
}
