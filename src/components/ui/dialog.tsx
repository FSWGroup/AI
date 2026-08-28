"use client";

import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

/**
 * Modal primitives.
 *
 * These exist so nothing in the application reaches for `window.prompt`,
 * `window.confirm` or `window.alert`. Native dialogs cannot be styled or
 * labelled, are announced inconsistently by screen readers, are suppressed
 * outright in some embedded contexts, and return `null` under automation — so a
 * control that depends on one can silently do nothing, which is indistinguishable
 * to the user from a broken button.
 *
 * `Modal` carries the shell; `ConfirmDialog` and `PromptDialog` are the two
 * shapes that replaced the native calls.
 */

const CONTENT_CLASS =
  "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-lg focus:outline-none";

const SIZE_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
} as const;

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "sm",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: keyof typeof SIZE_CLASS;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RadixDialog.Content className={`${CONTENT_CLASS} ${SIZE_CLASS[size]}`}>
          <RadixDialog.Title className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">
            {title}
          </RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mt-1.5 text-[0.8125rem] text-[var(--text-muted)]">
              {description}
            </RadixDialog.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  danger = false,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  /** Destructive actions get the danger treatment, never colour alone. */
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  label,
  description,
  initialValue = "",
  placeholder,
  confirmLabel = "Save",
  onConfirm,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  description?: React.ReactNode;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  loading?: boolean;
}) {
  const [value, setValue] = React.useState(initialValue);

  // Reset whenever the dialog reopens, so a previous entry never leaks into the
  // next one and a rename always starts from the current title.
  React.useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const trimmed = value.trim();

  function submit() {
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={submit} loading={loading} disabled={!trimmed}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label} htmlFor="prompt-dialog-value">
        <Input
          id="prompt-dialog-value"
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter submits, matching every other single-field form here.
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </Field>
    </Modal>
  );
}
