"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { revealSensitiveFieldsAction } from "@/app/(app)/people/[id]/actions";
import type { SensitiveFieldValue } from "@/lib/services/people";

/**
 * Sensitive fields are never auto-loaded — the audited read only happens when
 * a person explicitly clicks this button.
 */
export function SensitiveFieldsPanel({ userId }: { userId: string }) {
  const [fields, setFields] = useState<SensitiveFieldValue[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [pending, startTransition] = useTransition();

  function reveal() {
    startTransition(async () => {
      const result = await revealSensitiveFieldsAction(userId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFields(result.data);
      setRevealed(true);
    });
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[0.875rem] font-semibold text-[var(--text-primary)]">Sensitive fields</p>
          <p className="text-[0.75rem] text-[var(--text-muted)]">
            Encrypted, restricted fields. Every view is written to the audit log.
          </p>
        </div>
        {!revealed && (
          <Button variant="outline" size="sm" onClick={reveal} loading={pending}>
            <Glyph name="lock" className="h-3.5 w-3.5" />
            Reveal sensitive fields
          </Button>
        )}
      </div>
      {revealed &&
        (fields && fields.length > 0 ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.fieldKey}>
                <dt className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--text-muted)]">{f.label}</dt>
                <dd className="text-[0.875rem] text-[var(--text-primary)]">{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-[0.8125rem] text-[var(--text-muted)]">No sensitive fields are set for this person.</p>
        ))}
    </div>
  );
}
