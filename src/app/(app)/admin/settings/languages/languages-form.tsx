"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { saveLanguages } from "@/app/(app)/admin/settings/_shared/actions";

export function LanguagesForm({ initialLanguages, canManage }: { initialLanguages: string[]; canManage: boolean }) {
  const [value, setValue] = React.useState(initialLanguages.join(", "));
  const [saving, setSaving] = React.useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await saveLanguages(value);
      if (result.ok) toast.success("Languages saved.");
      else toast.error(result.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 flex max-w-md flex-col gap-4">
      <Field label="Supported languages" htmlFor="languages" hint="Comma-separated BCP-47 codes, e.g. en, fil, es." required>
        <Input id="languages" value={value} disabled={!canManage} onChange={(e) => setValue(e.target.value)} />
      </Field>
      {canManage && (
        <div>
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}
