"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import {
  updatePathMetaAction,
  addPathItemAction,
  deletePathItemAction,
  reorderPathItemsAction,
  publishPathAction,
  assignPathAction,
  searchUsersAction,
  listCoursesForPicker,
  listSopsForPathPicker,
} from "@/app/(app)/admin/paths/actions";

interface BuilderItem {
  id: string;
  order: number;
  label: string | null;
  targetType: string;
  courseId: string | null;
  sopId: string | null;
  required: boolean;
  isMilestone: boolean;
  dueDaysAfterStart: number | null;
  targetTitle: string;
}
interface BuilderPath {
  id: string;
  title: string;
  description: string | null;
  status: string;
  items: BuilderItem[];
}

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "navy"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

export function PathBuilder({ path }: { path: BuilderPath }) {
  const router = useRouter();
  const [savingMeta, setSavingMeta] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[path.status] ?? "neutral"}>{path.status}</Badge>
            <span className="text-[0.8125rem] text-[var(--text-muted)]">{path.items.length} items</span>
          </div>
          <Button
            loading={publishing}
            disabled={path.status === "PUBLISHED"}
            onClick={async () => {
              setPublishing(true);
              const result = await publishPathAction(path.id);
              setPublishing(false);
              if (!result.ok) return toast.error(result.error);
              toast.success("Path published.");
              router.refresh();
            }}
          >
            <Icon name="approval" className="h-4 w-4" />
            {path.status === "PUBLISHED" ? "Published" : "Publish"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={async (formData: FormData) => {
              setSavingMeta(true);
              const result = await updatePathMetaAction(path.id, formData);
              setSavingMeta(false);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              toast.success("Saved.");
              router.refresh();
            }}
            className="flex flex-col gap-4"
          >
            <Field label="Title" htmlFor="title" required>
              <Input id="title" name="title" defaultValue={path.title} required maxLength={200} />
            </Field>
            <Field label="Description" htmlFor="description">
              <Textarea id="description" name="description" defaultValue={path.description ?? ""} rows={3} />
            </Field>
            <div>
              <Button type="submit" size="sm" loading={savingMeta}>
                Save details
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ItemsCard path={path} />
      <AssignCard pathId={path.id} disabled={path.status !== "PUBLISHED"} />
    </div>
  );
}

function ItemsCard({ path }: { path: BuilderPath }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);

  async function handleMove(itemId: string, direction: -1 | 1) {
    const ids = path.items.map((i) => i.id);
    const index = ids.indexOf(itemId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= ids.length) return;
    [ids[index], ids[swapWith]] = [ids[swapWith] as string, ids[index] as string];
    const result = await reorderPathItemsAction(path.id, ids);
    if (!result.ok) return toast.error(result.error);
    router.refresh();
  }

  // The application's own dialog, never window.confirm — see components/ui/dialog.
  const [pendingRemove, setPendingRemove] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);

  async function handleDelete(itemId: string) {
    setRemoving(true);
    const result = await deletePathItemAction(path.id, itemId);
    setRemoving(false);
    if (!result.ok) return toast.error(result.error);
    setPendingRemove(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Items</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
          <Glyph name="plus" className="h-4 w-4" />
          Add item
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {path.items.length === 0 && !adding ? (
          <EmptyState icon={<Icon name="path" className="h-5 w-5" />} title="No items yet" description="Add courses or SOPs to sequence this path." />
        ) : (
          path.items.map((item, i) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--border-subtle)] p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {item.label && <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{item.label}</span>}
                  {item.isMilestone && <Badge tone="accent">Milestone</Badge>}
                  {!item.required && <Badge tone="neutral">Optional</Badge>}
                </div>
                <p className="truncate text-[0.875rem] font-medium text-[var(--text-primary)]">{item.targetTitle}</p>
                {item.dueDaysAfterStart !== null && (
                  <p className="text-[0.75rem] text-[var(--text-muted)]">Due {item.dueDaysAfterStart} days after start</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <IconBtn label="Move up" onClick={() => handleMove(item.id, -1)} disabled={i === 0}>
                  <Glyph name="chevron-down" className="h-3.5 w-3.5 rotate-180" />
                </IconBtn>
                <IconBtn label="Move down" onClick={() => handleMove(item.id, 1)} disabled={i === path.items.length - 1}>
                  <Glyph name="chevron-down" className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn label="Remove item" onClick={() => setPendingRemove(item.id)}>
                  <Glyph name="trash" className="h-3.5 w-3.5" />
                </IconBtn>
              </div>
            </div>
          ))
        )}

        {adding && (
          <AddItemForm
            pathId={path.id}
            onDone={() => {
              setAdding(false);
              router.refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        )}
      </CardContent>

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title="Remove this item from the path?"
        description="The course or procedure itself is not deleted — only its place in this path."
        confirmLabel="Remove item"
        danger
        loading={removing}
        onConfirm={() => pendingRemove && handleDelete(pendingRemove)}
      />
    </Card>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function AddItemForm({ pathId, onDone, onCancel }: { pathId: string; onDone: () => void; onCancel: () => void }) {
  const [targetType, setTargetType] = React.useState<"COURSE" | "SOP">("COURSE");
  const [courses, setCourses] = React.useState<{ id: string; title: string }[]>([]);
  const [sops, setSops] = React.useState<{ id: string; code: string; title: string }[]>([]);
  const [targetId, setTargetId] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [required, setRequired] = React.useState(true);
  const [isMilestone, setIsMilestone] = React.useState(false);
  const [dueDays, setDueDays] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void listCoursesForPicker().then(setCourses);
    void listSopsForPathPicker().then(setSops);
  }, []);

  async function submit() {
    if (!targetId) {
      toast.error("Choose a course or SOP.");
      return;
    }
    setSaving(true);
    const result = await addPathItemAction(pathId, {
      targetType,
      courseId: targetType === "COURSE" ? targetId : undefined,
      sopId: targetType === "SOP" ? targetId : undefined,
      label: label || undefined,
      required,
      isMilestone,
      dueDaysAfterStart: dueDays ? Number(dueDays) : undefined,
    });
    setSaving(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Item added.");
    onDone();
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--brand-secondary)] bg-[var(--surface-sunken)] p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="item-type">
          <Select
            id="item-type"
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value as "COURSE" | "SOP");
              setTargetId("");
            }}
          >
            <option value="COURSE">Course</option>
            <option value="SOP">SOP</option>
          </Select>
        </Field>
        <Field label={targetType === "COURSE" ? "Course" : "SOP"} htmlFor="item-target">
          <Select id="item-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Select…</option>
            {targetType === "COURSE"
              ? courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))
              : sops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.title}
                  </option>
                ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Milestone label" htmlFor="item-label" hint="e.g. 'Week 1'">
          <Input id="item-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Due days after start" htmlFor="item-due">
          <Input id="item-due" type="number" min={0} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-2">
          <label className="flex items-center gap-2 text-[0.8125rem] text-[var(--text-primary)]">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
            Required
          </label>
          <label className="flex items-center gap-2 text-[0.8125rem] text-[var(--text-primary)]">
            <input type="checkbox" checked={isMilestone} onChange={(e) => setIsMilestone(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
            Milestone
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" loading={saving} onClick={submit}>
          Add item
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AssignCard({ pathId, disabled }: { pathId: string; disabled: boolean }) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<{ id: string; name: string; email: string }[]>([]);
  const [selected, setSelected] = React.useState<{ id: string; name: string }[]>([]);
  const [assigning, setAssigning] = React.useState(false);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      if (query.trim().length >= 2) void searchUsersAction(query).then(setResults);
      else setResults([]);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  function toggle(user: { id: string; name: string; email: string }) {
    setSelected((prev) => (prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign this path</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {disabled && <p className="text-[0.8125rem] text-[var(--text-muted)]">Publish this path before assigning it.</p>}
        <Field label="Find people" htmlFor="assign-search">
          <Input id="assign-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" disabled={disabled} />
        </Field>
        {results.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] p-1">
            {results.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => toggle(user)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
                >
                  <span>
                    {user.name} <span className="text-[var(--text-muted)]">{user.email}</span>
                  </span>
                  {selected.some((u) => u.id === user.id) && <Glyph name="check" className="h-4 w-4 text-success-600" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((u) => (
              <Badge key={u.id} tone="navy">
                {u.name}
              </Badge>
            ))}
          </div>
        )}
        <div>
          <Button
            size="sm"
            disabled={disabled || selected.length === 0}
            loading={assigning}
            onClick={async () => {
              setAssigning(true);
              const result = await assignPathAction(pathId, selected.map((u) => u.id));
              setAssigning(false);
              if (!result.ok) return toast.error(result.error);
              toast.success(`Assigned to ${result.data.assigned} ${result.data.assigned === 1 ? "person" : "people"}.`);
              setSelected([]);
              setQuery("");
              setResults([]);
            }}
          >
            Assign
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
