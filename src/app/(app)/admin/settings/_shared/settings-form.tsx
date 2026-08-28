"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { saveSettingsSection } from "@/app/(app)/admin/settings/_shared/actions";

export type FieldType = "text" | "number" | "checkbox" | "textarea" | "number-list" | "url";

export interface SettingsFieldSpec {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
}

type SectionKey = "brand" | "training" | "privacy" | "features" | "languages";

function toFormValue(type: FieldType, value: unknown): string | boolean {
  if (type === "checkbox") return Boolean(value);
  if (type === "number-list") return Array.isArray(value) ? value.join(", ") : "";
  return value === null || value === undefined ? "" : String(value);
}

function fromFormValue(type: FieldType, value: string | boolean): unknown {
  if (type === "checkbox") return Boolean(value);
  if (type === "number") return value === "" ? null : Number(value);
  if (type === "number-list") {
    return String(value)
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v));
  }
  return value;
}

/**
 * A generic, declarative settings-section form. Every "simple" admin
 * settings page (training defaults, content review, notifications, privacy,
 * feature flags, languages, video) supplies a field spec and initial values;
 * this component owns the loading/success/error states so those pages stay
 * a few lines each.
 */
export function SettingsForm({
  section,
  fields,
  initialValues,
  canManage,
  submitLabel = "Save changes",
}: {
  section: SectionKey;
  fields: SettingsFieldSpec[];
  initialValues: Record<string, unknown>;
  canManage: boolean;
  submitLabel?: string;
}) {
  const [values, setValues] = React.useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, toFormValue(f.type, initialValues[f.key])])),
  );
  const [saving, setSaving] = React.useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const patch = Object.fromEntries(fields.map((f) => [f.key, fromFormValue(f.type, values[f.key] ?? "")]));
      const result = await saveSettingsSection(section, patch);
      if (result.ok) {
        toast.success("Settings saved.");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {fields.map((field) => {
        const id = `setting-${section}-${field.key}`;
        if (field.type === "checkbox") {
          return (
            <label key={field.key} htmlFor={id} className="flex items-start gap-2.5">
              <input
                id={id}
                type="checkbox"
                checked={Boolean(values[field.key])}
                disabled={!canManage}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-[var(--border-default)]"
              />
              <span>
                <span className="block text-[0.875rem] font-medium text-[var(--text-primary)]">{field.label}</span>
                {field.hint && <span className="block text-[0.75rem] text-[var(--text-muted)]">{field.hint}</span>}
              </span>
            </label>
          );
        }

        if (field.type === "textarea") {
          return (
            <Field key={field.key} label={field.label} htmlFor={id} hint={field.hint}>
              <Textarea
                id={id}
                value={String(values[field.key] ?? "")}
                disabled={!canManage}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            </Field>
          );
        }

        return (
          <Field key={field.key} label={field.label} htmlFor={id} hint={field.hint}>
            <Input
              id={id}
              type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"}
              value={String(values[field.key] ?? "")}
              disabled={!canManage}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
          </Field>
        );
      })}

      {canManage ? (
        <div>
          <Button type="submit" loading={saving}>
            {submitLabel}
          </Button>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-[var(--text-muted)]">
          You have view-only access to settings. Ask an administrator with the &quot;Change application settings&quot; permission to make changes here.
        </p>
      )}
    </form>
  );
}
