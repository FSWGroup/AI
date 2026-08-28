"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { MediaPickerField } from "@/app/(app)/admin/settings/_shared/media-picker";
import { saveSettingsSection } from "@/app/(app)/admin/settings/_shared/actions";
import type { BrandSettings } from "@/lib/settings";

/** The Brand settings form — the single place that makes "FSW Academy" renameable. */
export function BrandForm({ initial, canManage }: { initial: BrandSettings; canManage: boolean }) {
  const [values, setValues] = React.useState<BrandSettings>(initial);
  const [saving, setSaving] = React.useState(false);

  const set = <K extends keyof BrandSettings>(key: K, value: BrandSettings[K]) => setValues((v) => ({ ...v, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const result = await saveSettingsSection("brand", values as unknown as Record<string, unknown>);
      if (result.ok) toast.success("Brand settings saved. The new name and colors apply everywhere immediately.");
      else toast.error(result.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex max-w-md flex-1 flex-col gap-4">
        <Field label="Company name" htmlFor="brand-company" hint="Used in footers and legal text.">
          <Input id="brand-company" value={values.companyName} disabled={!canManage} onChange={(e) => set("companyName", e.target.value)} />
        </Field>
        <Field label="App name" htmlFor="brand-app" hint='This is what makes "FSW Academy" renameable — it appears in the sidebar, page titles, and emails.' required>
          <Input id="brand-app" value={values.appName} disabled={!canManage} onChange={(e) => set("appName", e.target.value)} />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <ColorField label="Primary" value={values.primaryColor} disabled={!canManage} onChange={(v) => set("primaryColor", v)} />
          <ColorField label="Secondary" value={values.secondaryColor} disabled={!canManage} onChange={(v) => set("secondaryColor", v)} />
          <ColorField label="Accent" value={values.accentColor} disabled={!canManage} onChange={(v) => set("accentColor", v)} />
        </div>

        <MediaPickerField label="Logo" value={values.logoMediaId} onChange={(id) => set("logoMediaId", id)} accept="image/png,image/svg+xml,image/webp" disabled={!canManage} />
        <MediaPickerField label="Icon (favicon)" value={values.iconMediaId} onChange={(id) => set("iconMediaId", id)} accept="image/png,image/x-icon" disabled={!canManage} />
        <MediaPickerField label="Email logo" value={values.emailLogoMediaId} onChange={(id) => set("emailLogoMediaId", id)} accept="image/png,image/jpeg" disabled={!canManage} />
        <MediaPickerField label="Certificate logo" value={values.certificateLogoMediaId} onChange={(id) => set("certificateLogoMediaId", id)} accept="image/png,image/jpeg" disabled={!canManage} />

        {canManage && (
          <div>
            <Button onClick={save} loading={saving}>
              Save changes
            </Button>
          </div>
        )}
      </div>

      <div className="w-full max-w-xs shrink-0">
        <p className="mb-2 text-[0.75rem] font-medium text-[var(--text-muted)]">Live preview</p>
        <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: values.primaryColor }}>
            {values.logoMediaId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/media/${values.logoMediaId}`} alt="" className="h-5 w-auto" />
            ) : (
              <span className="h-5 w-5 rounded-sm bg-white/20" aria-hidden="true" />
            )}
            <span className="text-[0.9375rem] font-semibold text-white">{values.appName || "App name"}</span>
          </div>
          <div className="bg-[var(--surface-card)] p-4">
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-[0.8125rem] font-medium text-white"
              style={{ backgroundColor: values.primaryColor }}
            >
              Primary button
            </button>
            <button
              type="button"
              className="ml-2 rounded-md px-3 py-1.5 text-[0.8125rem] font-medium underline"
              style={{ color: values.secondaryColor }}
            >
              Link
            </button>
            <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: values.accentColor }} aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = `brand-color-${label.toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-[var(--text-primary)]">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-[var(--border-default)] bg-transparent p-0.5"
        />
        <Input id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="font-mono text-[0.75rem]" />
      </div>
    </div>
  );
}
