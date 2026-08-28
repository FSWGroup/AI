"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { PersonAvatar } from "@/components/people/avatar";
import { AssignmentStatusBadge } from "@/components/people/badges";
import { ConfirmDialog } from "@/components/people/confirm-dialog";
import { formatDueDate } from "@/lib/dates";
import { assignToTeamAction, unassignFromTeamAction, waiveTeamAssignmentAction } from "@/app/(app)/team/assignments/actions";
import type { TrainingTargetType } from "@prisma/client";

export interface TeamMember {
  id: string;
  name: string;
  image: string | null;
}
export interface OutstandingAssignment {
  id: string;
  userId: string;
  userName: string;
  title: string;
  status: string;
  dueAt: Date | null;
  reason: string | null;
}

export function TeamAssignPanel({
  members,
  courses,
  sops,
  paths,
  outstanding,
  timezone,
}: {
  members: TeamMember[];
  courses: { id: string; title: string }[];
  sops: { id: string; title: string }[];
  paths: { id: string; title: string }[];
  outstanding: OutstandingAssignment[];
  timezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetType, setTargetType] = useState<TrainingTargetType>("COURSE");
  const [targetId, setTargetId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [reason, setReason] = useState("");

  const [waiveTarget, setWaiveTarget] = useState<OutstandingAssignment | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [removeTarget, setRemoveTarget] = useState<OutstandingAssignment | null>(null);

  const options = targetType === "COURSE" ? courses : targetType === "SOP" ? sops : paths;
  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(selected.size === members.length ? new Set() : new Set(members.map((m) => m.id)));
  }

  function submit() {
    startTransition(async () => {
      const result = await assignToTeamAction({
        userIds: selectedIds,
        targetType,
        courseId: targetType === "COURSE" ? targetId : null,
        sopId: targetType === "SOP" ? targetId : null,
        pathId: targetType === "LEARNING_PATH" ? targetId : null,
        dueAt: dueAt || null,
        reason: reason || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Assigned to ${result.data.assigned.length} people (${result.data.alreadyAssigned.length} already had it).`);
      setSelected(new Set());
      setTargetId("");
      setDueAt("");
      setReason("");
      router.refresh();
    });
  }

  function runRemove() {
    if (!removeTarget) return;
    startTransition(async () => {
      const result = await unassignFromTeamAction(removeTarget.id, "Removed by manager");
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Assignment removed.");
      setRemoveTarget(null);
      router.refresh();
    });
  }

  function runWaive() {
    if (!waiveTarget) return;
    startTransition(async () => {
      const result = await waiveTeamAssignmentAction(waiveTarget.id, waiveReason);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Assignment waived.");
      setWaiveTarget(null);
      setWaiveReason("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Assign training</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[0.8125rem] font-medium text-[var(--text-primary)]">Select people</p>
              <Button size="sm" variant="ghost" onClick={toggleAll}>
                {selected.size === members.length ? "Clear all" : "Select all"}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-subtle)] p-2 hover:bg-[var(--surface-sunken)]"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--brand-primary)]"
                    checked={selected.has(m.id)}
                    onChange={() => toggle(m.id)}
                  />
                  <PersonAvatar name={m.name} image={m.image} size={24} />
                  <span className="truncate text-[0.8125rem] text-[var(--text-primary)]">{m.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field label="Type" htmlFor="assign-type">
              <Select
                id="assign-type"
                value={targetType}
                onChange={(e) => {
                  setTargetType(e.target.value as TrainingTargetType);
                  setTargetId("");
                }}
              >
                <option value="COURSE">Course</option>
                <option value="SOP">SOP</option>
                <option value="LEARNING_PATH">Learning path</option>
              </Select>
            </Field>
            <Field label="Item" htmlFor="assign-item">
              <Select id="assign-item" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due date" htmlFor="assign-due">
              <Input id="assign-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </Field>
            <Field label="Reason (optional)" htmlFor="assign-reason">
              <Input id="assign-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>

          <div className="flex justify-end">
            <Button onClick={submit} loading={pending} disabled={selectedIds.length === 0 || !targetId}>
              Assign to {selectedIds.length || 0} {selectedIds.length === 1 ? "person" : "people"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Outstanding assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {outstanding.length === 0 ? (
            <p className="text-[0.8125rem] text-[var(--text-muted)]">No outstanding assignments on your team.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
              <table className="w-full border-collapse text-[0.8125rem]">
                <thead>
                  <tr className="bg-[var(--surface-sunken)]">
                    <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Person</th>
                    <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Training</th>
                    <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Status</th>
                    <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Due</th>
                    <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((a) => (
                    <tr key={a.id}>
                      <td className="border-b border-[var(--border-subtle)] p-2.5">{a.userName}</td>
                      <td className="border-b border-[var(--border-subtle)] p-2.5">{a.title}</td>
                      <td className="border-b border-[var(--border-subtle)] p-2.5">
                        <AssignmentStatusBadge status={a.status} />
                      </td>
                      <td className="border-b border-[var(--border-subtle)] p-2.5">{formatDueDate(a.dueAt, timezone)}</td>
                      <td className="border-b border-[var(--border-subtle)] p-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setWaiveTarget(a)}>
                            Waive
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(a)}>
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove this assignment?"
        description={`This removes "${removeTarget?.title}" from ${removeTarget?.userName}'s training entirely.`}
        confirmLabel="Remove"
        pending={pending}
        onConfirm={runRemove}
      />

      <ConfirmDialog
        open={Boolean(waiveTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setWaiveTarget(null);
            setWaiveReason("");
          }
        }}
        title="Waive this assignment?"
        description={
          <div className="flex flex-col gap-2">
            <p>
              {waiveTarget?.userName} will be exempted from &quot;{waiveTarget?.title}&quot;. This is recorded, not deleted.
            </p>
            <Field label="Reason" htmlFor="waive-reason" required>
              <Input id="waive-reason" value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} />
            </Field>
          </div>
        }
        confirmLabel="Waive"
        danger={false}
        pending={pending}
        onConfirm={runWaive}
      />
    </div>
  );
}
