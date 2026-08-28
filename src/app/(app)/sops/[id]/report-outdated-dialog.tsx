"use client";

import { useState, useTransition } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { reportOutdatedAction } from "@/app/(app)/sops/[id]/actions";

export function ReportOutdatedDialog({ sopId }: { sopId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await reportOutdatedAction({ sopId, reason });
      if (!result.ok) {
        setError(result.fieldErrors?.reason ?? result.error);
        return;
      }
      toast.success("Thanks — the SOP owner has been notified.");
      setReason("");
      setError(undefined);
      setOpen(false);
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(undefined);
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm">
          <Glyph name="alert" className="h-3.5 w-3.5" />
          Report outdated information
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-lg focus:outline-none">
          <Dialog.Title className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Report outdated information</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-[0.8125rem] text-[var(--text-muted)]">
            Tell the SOP owner what looks wrong or out of date. They'll be notified right away.
          </Dialog.Description>
          <Field label="What needs to change?" htmlFor="report-outdated-reason" required error={error} className="mt-4">
            <Textarea
              id="report-outdated-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Step 4 references a tool we no longer use."
            />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Dialog.Close>
            <Button onClick={submit} loading={pending} disabled={reason.trim().length === 0}>
              Submit report
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
