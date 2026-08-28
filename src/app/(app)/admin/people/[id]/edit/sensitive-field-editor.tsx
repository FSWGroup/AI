"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import { revealSensitiveFieldsAction } from "@/app/(app)/people/[id]/actions";
import { setSensitiveFieldAction } from "@/app/(app)/admin/people/[id]/edit/actions";

export function SensitiveFieldEditor({
  userId,
  definitions,
}: {
  userId: string;
  definitions: { fieldKey: string; label: string; description: string | null }[];
}) {
  const [revealed, setRevealed] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  function reveal() {
    startTransition(async () => {
      const result = await revealSensitiveFieldsAction(userId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const next: Record<string, string> = {};
      for (const f of result.data) next[f.fieldKey] = f.value;
      setValues(next);
      setRevealed(true);
    });
  }

  function save(fieldKey: string) {
    setSavingKey(fieldKey);
    startTransition(async () => {
      const result = await setSensitiveFieldAction(userId, fieldKey, values[fieldKey] ?? "");
      setSavingKey(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved.");
    });
  }

  if (definitions.length === 0) {
    return (
      <p className="text-[0.8125rem] text-[var(--text-muted)]">
        No sensitive field definitions are configured for this organization yet.
      </p>
    );
  }

  if (!revealed) {
    return (
      <Button variant="outline" size="sm" onClick={reveal} loading={pending}>
        <Glyph name="lock" className="h-3.5 w-3.5" /> Reveal to edit
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {definitions.map((def) => (
        <div key={def.fieldKey} className="flex items-end gap-2">
          <Field label={def.label} htmlFor={`sf-${def.fieldKey}`} hint={def.description ?? undefined} className="flex-1">
            <Input
              id={`sf-${def.fieldKey}`}
              value={values[def.fieldKey] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [def.fieldKey]: e.target.value }))}
            />
          </Field>
          <Button size="sm" variant="secondary" onClick={() => save(def.fieldKey)} loading={pending && savingKey === def.fieldKey}>
            Save
          </Button>
        </div>
      ))}
    </div>
  );
}
