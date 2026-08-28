"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";

/**
 * Generic confirmation dialog for destructive/high-impact bulk actions.
 * `description` should always state exactly what will happen and to how many
 * people — never a vague "are you sure?".
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger = true,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-lg focus:outline-none">
          <Dialog.Title className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">{title}</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
            {description}
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Dialog.Close>
            <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={pending}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
