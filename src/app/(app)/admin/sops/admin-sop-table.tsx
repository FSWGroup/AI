"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { cn } from "@/lib/utils";
import { bulkArchiveSopsAction, bulkAssignOwnerAction } from "@/app/(app)/admin/sops/actions";
import type { HealthFactor } from "@/lib/services/sop";

export interface AdminSopRow {
  id: string;
  sopCode: string;
  title: string;
  status: string;
  category: string | null;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: Date;
  nextReviewAt: Date | null;
  health: { score: number; factors: HealthFactor[] };
}

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "blue",
  PUBLISHED: "success",
  ARCHIVED: "neutral",
};

function healthTone(score: number): string {
  if (score >= 80) return "text-success-700";
  if (score >= 50) return "text-warning-700";
  return "text-danger-700";
}

export function AdminSopTable({ items, ownerOptions }: { items: AdminSopRow[]; ownerOptions: { id: string; name: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [assignOwnerId, setAssignOwnerId] = useState("");
  const [pending, startTransition] = useTransition();

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

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

  const selectedIds = useMemo(() => [...selected], [selected]);

  function runArchive() {
    startTransition(async () => {
      const result = await bulkArchiveSopsAction(selectedIds);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Archived ${result.data.count} SOP${result.data.count === 1 ? "" : "s"}.`);
      setSelected(new Set());
      setArchiveOpen(false);
      router.refresh();
    });
  }

  function runAssignOwner() {
    if (!assignOwnerId) {
      toast.error("Choose an owner first.");
      return;
    }
    startTransition(async () => {
      const result = await bulkAssignOwnerAction({ sopIds: selectedIds, ownerId: assignOwnerId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Updated owner on ${result.data.count} SOP${result.data.count === 1 ? "" : "s"}.`);
      setSelected(new Set());
      setAssignOwnerId("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-sunken)] px-4 py-2.5">
          <span className="text-[0.8125rem] font-medium text-[var(--text-primary)]">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Select className="h-8 w-48" value={assignOwnerId} onChange={(e) => setAssignOwnerId(e.target.value)} aria-label="Assign owner to selected SOPs">
              <option value="">Assign owner…</option>
              {ownerOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={runAssignOwner} disabled={pending || !assignOwnerId}>
              Apply
            </Button>
          </div>
          <Button size="sm" variant="danger" onClick={() => setArchiveOpen(true)} disabled={pending}>
            <Glyph name="trash" className="h-3.5 w-3.5" /> Archive selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              <th scope="col" className="w-10 border-b border-[var(--border-subtle)] p-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all SOPs on this page"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 accent-[var(--brand-primary)]"
                />
              </th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">SOP</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Status</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Owner</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Health</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Updated</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Next review</th>
              <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className={cn(selected.has(row.id) && "bg-[var(--surface-sunken)]")}>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.title}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    className="h-4 w-4 accent-[var(--brand-primary)]"
                  />
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <Link href={`/admin/sops/${row.id}/edit`} className="font-medium text-[var(--text-primary)] hover:underline">
                    {row.title}
                  </Link>
                  <div className="text-[0.75rem] text-[var(--text-muted)]">
                    {row.sopCode}
                    {row.category ? ` · ${row.category}` : ""}
                  </div>
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status.replace(/_/g, " ")}</Badge>
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.ownerName ?? <span className="text-[var(--text-muted)]">Unassigned</span>}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <details className="group">
                    <summary className={cn("cursor-pointer list-none font-semibold", healthTone(row.health.score))}>{row.health.score}</summary>
                    <ul className="mt-1.5 flex flex-col gap-0.5 text-[0.75rem] text-[var(--text-muted)]">
                      {row.health.factors.map((factor) => (
                        <li key={factor.label} className="flex items-center gap-1.5">
                          <Glyph name={factor.met ? "check" : "x"} className={cn("h-3 w-3 shrink-0", factor.met ? "text-success-600" : "text-danger-600")} />
                          {factor.label} ({factor.weight}pt)
                        </li>
                      ))}
                    </ul>
                  </details>
                </td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{new Date(row.updatedAt).toLocaleDateString()}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">{row.nextReviewAt ? new Date(row.nextReviewAt).toLocaleDateString() : "—"}</td>
                <td className="border-b border-[var(--border-subtle)] p-2.5">
                  <div className="flex justify-end gap-2">
                    <Link href={`/sops/${row.id}`} className="text-[var(--brand-secondary)] hover:underline">
                      View
                    </Link>
                    <Link href={`/admin/sops/${row.id}/impact`} className="text-[var(--brand-secondary)] hover:underline">
                      Impact
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog.Root open={archiveOpen} onOpenChange={setArchiveOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-lg focus:outline-none">
            <Dialog.Title className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Archive {selected.size} SOP{selected.size === 1 ? "" : "s"}?</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[0.8125rem] text-[var(--text-muted)]">
              Archived SOPs stop appearing in the learner library. You can change status back later from each SOP's editor.
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button variant="danger" onClick={runArchive} loading={pending}>
                Archive
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
