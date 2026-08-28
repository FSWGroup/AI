"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveRolePermissions } from "@/app/(app)/admin/settings/roles/actions";
import type { Permission } from "@/lib/permissions";

export interface RoleColumn {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: Permission[];
}

export interface PermissionGroup {
  label: string;
  permissions: { key: Permission; description: string }[];
}

/** Grid of roles × permission groups. Local state tracks edits per role; Save
 * writes only the roles that actually changed. */
export function RolesGrid({ roles, groups, canManage }: { roles: RoleColumn[]; groups: PermissionGroup[]; canManage: boolean }) {
  const [state, setState] = React.useState<Record<string, Set<Permission>>>(() =>
    Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions)])),
  );
  const [savingRoleId, setSavingRoleId] = React.useState<string | null>(null);

  const toggle = (roleId: string, permission: Permission) => {
    setState((prev) => {
      const next = new Set(prev[roleId]);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return { ...prev, [roleId]: next };
    });
  };

  const isDirty = (roleId: string) => {
    const original = roles.find((r) => r.id === roleId)?.permissions ?? [];
    const current = state[roleId] ?? new Set<Permission>();
    return original.length !== current.size || original.some((p) => !current.has(p));
  };

  const save = async (roleId: string) => {
    setSavingRoleId(roleId);
    try {
      const result = await saveRolePermissions(roleId, [...(state[roleId] ?? [])]);
      if (result.ok) toast.success("Role permissions saved.");
      else toast.error(result.error);
    } finally {
      setSavingRoleId(null);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
      <table className="min-w-full border-collapse text-[0.8125rem]">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
            <th scope="col" className="sticky left-0 z-10 min-w-[16rem] bg-[var(--surface-sunken)] px-3.5 py-2.5 text-left font-semibold text-[var(--text-primary)]">
              Permission
            </th>
            {roles.map((role) => (
              <th key={role.id} scope="col" className="min-w-[8rem] px-2 py-2.5 text-center font-semibold text-[var(--text-primary)]">
                <div className="flex flex-col items-center gap-1">
                  <span>{role.name}</span>
                  {canManage && (
                    <Button size="sm" variant={isDirty(role.id) ? "primary" : "outline"} loading={savingRoleId === role.id} onClick={() => save(role.id)}>
                      Save
                    </Button>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <React.Fragment key={group.label}>
              <tr>
                <th
                  colSpan={roles.length + 1}
                  scope="colgroup"
                  className="bg-[var(--surface-page)] px-3.5 py-1.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                >
                  {group.label}
                </th>
              </tr>
              {group.permissions.map((perm) => (
                <tr key={perm.key} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="sticky left-0 z-10 bg-[var(--surface-card)] px-3.5 py-2">
                    <p className="font-medium text-[var(--text-primary)]">{perm.key}</p>
                    <p className="text-[0.75rem] text-[var(--text-muted)]">{perm.description}</p>
                  </td>
                  {roles.map((role) => {
                    const checked = state[role.id]?.has(perm.key) ?? false;
                    const id = `perm-${role.id}-${perm.key}`;
                    return (
                      <td key={role.id} className="px-2 py-2 text-center">
                        <label htmlFor={id} className="sr-only">
                          {perm.key} for {role.name}
                        </label>
                        <input
                          id={id}
                          type="checkbox"
                          checked={checked}
                          disabled={!canManage}
                          onChange={() => toggle(role.id, perm.key)}
                          className="h-4 w-4 rounded border-[var(--border-default)]"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
