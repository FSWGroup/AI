"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { saveOrganizationName } from "@/app/(app)/admin/settings/_shared/actions";

export function OrganizationForm({ initialName, canManage }: { initialName: string; canManage: boolean }) {
  const [name, setName] = React.useState(initialName);
  const [saving, setSaving] = React.useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await saveOrganizationName(name);
      if (result.ok) toast.success("Organization name saved.");
      else toast.error(result.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 flex max-w-md flex-col gap-4">
      <Field label="Organization name" htmlFor="org-name" required>
        <Input id="org-name" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
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
