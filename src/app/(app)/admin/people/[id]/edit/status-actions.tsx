"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/people/confirm-dialog";
import { deactivatePersonAction } from "@/app/(app)/admin/people/[id]/edit/actions";
import { reactivatePersonAction } from "@/app/(app)/admin/people/actions";
import type { DeactivateResult } from "@/lib/services/people";

export function StatusActions({ userId, status, name }: { userId: string; status: string; name: string }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DeactivateResult | null>(null);

  function deactivate() {
    startTransition(async () => {
      const res = await deactivatePersonAction(userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setConfirmOpen(false);
      setResult(res.data);
      toast.success(`${name} has been deactivated.`);
      router.refresh();
    });
  }

  function reactivate() {
    startTransition(async () => {
      const res = await reactivatePersonAction(userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${name} has been reactivated.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {status === "INACTIVE" ? (
        <Button variant="secondary" size="sm" onClick={reactivate} loading={pending}>
          Reactivate
        </Button>
      ) : (
        <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
          Deactivate
        </Button>
      )}

      {result && (result.ownedContent.length > 0 || result.pendingApprovals.length > 0) && (
        <div className="rounded-md border border-warning-100 bg-warning-50 p-3 text-[0.75rem] text-warning-800">
          <p className="mb-1.5 font-medium">This person still owns content or approvals — reassign these:</p>
          {result.ownedContent.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {result.ownedContent.map((c) => (
                <Badge key={`${c.type}-${c.id}`} tone="warning">
                  {c.type}: {c.title}
                </Badge>
              ))}
            </div>
          )}
          {result.pendingApprovals.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.pendingApprovals.map((a) => (
                <Badge key={a.id} tone="warning">
                  {a.stage} approval
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Deactivate ${name}?`}
        description="This sets their status to Inactive, revokes access, and waives their outstanding (not yet completed) training assignments. Their training transcript and compliance history are preserved — nothing is deleted."
        confirmLabel="Deactivate"
        pending={pending}
        onConfirm={deactivate}
      />
    </div>
  );
}
