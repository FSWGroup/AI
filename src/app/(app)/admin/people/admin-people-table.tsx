"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/people/avatar";
import { StatusBadge, WorkerTypeBadge } from "@/components/people/badges";
import { ConfirmDialog } from "@/components/people/confirm-dialog";
import {
  bulkAssignTrainingAction,
  bulkChangeManagerAction,
  bulkDeactivateAction,
  bulkExportAction,
  bulkMoveDepartmentAction,
  bulkRemindAction,
} from "@/app/(app)/admin/people/actions";

export interface AdminPersonRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  title: string | null;
  status: string;
  workerType: string;
  departmentName: string | null;
  businessUnitName: string | null;
  locationName: string | null;
  managerName: string | null;
}

type BulkAction = "" | "assign" | "path" | "remind" | "department" | "manager" | "deactivate" | "export";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AdminPeopleTable({
  items,
  departments,
  managers,
  courses,
  sops: _sops,
  paths,
}: {
  items: AdminPersonRow[];
  departments: { id: string; name: string }[];
  managers: { id: string; name: string }[];
  courses: { id: string; title: string }[];
  sops: { id: string; title: string }[];
  paths: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<BulkAction>("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [courseTarget, setCourseTarget] = useState("");
  const [pathTarget, setPathTarget] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [reason, setReason] = useState("");
  const [departmentTarget, setDepartmentTarget] = useState("");
  const [managerTarget, setManagerTarget] = useState("");

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetBulkForm() {
    setAction("");
    setCourseTarget("");
    setPathTarget("");
    setDueAt("");
    setReason("");
    setDepartmentTarget("");
    setManagerTarget("");
  }

  function confirmCopy(): { title: string; description: string; danger: boolean; confirmLabel: string } {
    const count = selectedIds.length;
    const people = `${count} ${count === 1 ? "person" : "people"}`;
    switch (action) {
      case "assign": {
        const course = courses.find((c) => c.id === courseTarget);
        return {
          title: "Assign training",
          description: `Assign "${course?.title ?? "this course"}" to ${people}${dueAt ? `, due ${dueAt}` : ""}.`,
          danger: false,
          confirmLabel: "Assign",
        };
      }
      case "path": {
        const path = paths.find((p) => p.id === pathTarget);
        return {
          title: "Apply learning path",
          description: `Apply "${path?.title ?? "this path"}" to ${people}.`,
          danger: false,
          confirmLabel: "Apply path",
        };
      }
      case "remind":
        return {
          title: "Send reminder",
          description: `Send an immediate reminder about outstanding training to ${people}.`,
          danger: false,
          confirmLabel: "Send reminder",
        };
      case "department": {
        const dept = departments.find((d) => d.id === departmentTarget);
        return {
          title: "Move department",
          description: `Move ${people} to the ${dept?.name ?? "selected"} department. This may change their required training.`,
          danger: false,
          confirmLabel: "Move",
        };
      }
      case "manager": {
        const manager = managers.find((m) => m.id === managerTarget);
        return {
          title: "Change manager",
          description: `Set ${manager?.name ?? "the selected person"} as manager for ${people}.`,
          danger: false,
          confirmLabel: "Change manager",
        };
      }
      case "deactivate":
        return {
          title: `Deactivate ${people}?`,
          description: `${people} will be marked inactive, lose access, and have active training assignments waived. Their training transcript and compliance history are preserved. This does not delete any records.`,
          danger: true,
          confirmLabel: "Deactivate",
        };
      default:
        return { title: "", description: "", danger: false, confirmLabel: "Confirm" };
    }
  }

  function runBulkAction() {
    startTransition(async () => {
      if (action === "assign") {
        const result = await bulkAssignTrainingAction({
          userIds: selectedIds,
          targetType: "COURSE",
          courseId: courseTarget,
          dueAt: dueAt || null,
          reason: reason || null,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Assigned to ${result.data.assigned.length} people (${result.data.alreadyAssigned.length} already had it).`);
      } else if (action === "path") {
        const result = await bulkAssignTrainingAction({ userIds: selectedIds, targetType: "LEARNING_PATH", pathId: pathTarget });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Applied to ${result.data.assigned.length} people.`);
      } else if (action === "remind") {
        const result = await bulkRemindAction(selectedIds);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Reminded ${result.data.notified} people.`);
      } else if (action === "department") {
        const result = await bulkMoveDepartmentAction({ userIds: selectedIds, departmentId: departmentTarget });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Moved ${result.data.updated} people.`);
      } else if (action === "manager") {
        const result = await bulkChangeManagerAction({ userIds: selectedIds, managerId: managerTarget });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Updated manager for ${result.data.updated} people.`);
      } else if (action === "deactivate") {
        const result = await bulkDeactivateAction(selectedIds);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Deactivated ${result.data.updated} people.`);
      }
      setConfirmOpen(false);
      setSelected(new Set());
      resetBulkForm();
      router.refresh();
    });
  }

  function runExport() {
    startTransition(async () => {
      const result = await bulkExportAction(selectedIds);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      downloadJson(`people-export-${new Date().toISOString().slice(0, 10)}.json`, result.data);
      toast.success(`Exported ${result.data.length} people.`);
    });
  }

  const canSubmit =
    (action === "assign" && courseTarget) ||
    (action === "path" && pathTarget) ||
    action === "remind" ||
    (action === "department" && departmentTarget) ||
    (action === "manager" && managerTarget) ||
    action === "deactivate";

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex flex-col gap-2.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-sunken)] p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[0.8125rem] font-medium text-[var(--text-primary)]">{selected.size} selected</span>
            <Select
              className="h-8 w-52"
              aria-label="Bulk action"
              value={action}
              onChange={(e) => {
                resetBulkForm();
                setAction(e.target.value as BulkAction);
              }}
            >
              <option value="">Choose bulk action…</option>
              <option value="assign">Assign training</option>
              <option value="path">Apply learning path</option>
              <option value="remind">Send reminder</option>
              <option value="department">Move department</option>
              <option value="manager">Change manager</option>
              <option value="deactivate">Deactivate</option>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
            <Button size="sm" variant="outline" onClick={runExport} disabled={pending}>
              <Glyph name="download" className="h-3.5 w-3.5" /> Export selected
            </Button>
          </div>

          {action === "assign" && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Course" htmlFor="bulk-course">
                <Select id="bulk-course" className="h-8 w-56" value={courseTarget} onChange={(e) => setCourseTarget(e.target.value)}>
                  <option value="">Choose a course…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Due date" htmlFor="bulk-due">
                <Input id="bulk-due" type="date" className="h-8 w-40" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </Field>
              <Field label="Reason (optional)" htmlFor="bulk-reason">
                <Input id="bulk-reason" className="h-8 w-56" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Button size="sm" disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
                Continue
              </Button>
            </div>
          )}
          {action === "path" && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Learning path" htmlFor="bulk-path">
                <Select id="bulk-path" className="h-8 w-64" value={pathTarget} onChange={(e) => setPathTarget(e.target.value)}>
                  <option value="">Choose a path…</option>
                  {paths.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button size="sm" disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
                Continue
              </Button>
            </div>
          )}
          {action === "remind" && (
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={() => setConfirmOpen(true)}>
                Continue
              </Button>
            </div>
          )}
          {action === "department" && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New department" htmlFor="bulk-dept">
                <Select id="bulk-dept" className="h-8 w-56" value={departmentTarget} onChange={(e) => setDepartmentTarget(e.target.value)}>
                  <option value="">Choose a department…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button size="sm" disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
                Continue
              </Button>
            </div>
          )}
          {action === "manager" && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New manager" htmlFor="bulk-manager">
                <Select id="bulk-manager" className="h-8 w-56" value={managerTarget} onChange={(e) => setManagerTarget(e.target.value)}>
                  <option value="">Choose a manager…</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button size="sm" disabled={!canSubmit} onClick={() => setConfirmOpen(true)}>
                Continue
              </Button>
            </div>
          )}
          {action === "deactivate" && (
            <div className="flex items-end gap-2">
              <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
                Continue
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              <th scope="col" className="w-10 border-b border-[var(--border-subtle)] p-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all people on this page"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 accent-[var(--brand-primary)]"
                />
              </th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                Person
              </th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                Department
              </th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                Manager
              </th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">
                Worker type
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
              <tr key={row.id} className={cn(selected.has(row.id) && "bg-[var(--surface-sunken)]")}>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    className="h-4 w-4 accent-[var(--brand-primary)]"
                  />
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <div className="flex items-center gap-2.5">
                    <PersonAvatar name={row.name} image={row.image} size={30} />
                    <div className="min-w-0">
                      <Link href={`/people/${row.id}`} className="font-medium text-[var(--text-primary)] hover:underline">
                        {row.name}
                      </Link>
                      <div className="truncate text-[0.75rem] text-[var(--text-muted)]">{row.title ?? row.email}</div>
                    </div>
                  </div>
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.departmentName ?? "—"}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.managerName ?? "—"}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <WorkerTypeBadge workerType={row.workerType} />
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <StatusBadge status={row.status} />
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <div className="flex justify-end gap-2">
                    <Link href={`/admin/people/${row.id}/edit`} className="text-[var(--brand-secondary)] hover:underline">
                      Edit
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pending={pending}
        onConfirm={runBulkAction}
        {...confirmCopy()}
      />
    </div>
  );
}
