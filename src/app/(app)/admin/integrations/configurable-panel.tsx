"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { saveIntegrationConfigAction, disconnectIntegrationAction } from "@/app/(app)/admin/integrations/actions";
import type { ConfigurableIntegrationDescriptor, IntegrationView } from "@/lib/services/integrations";

export function ConfigurableIntegrationsPanel({
  descriptors,
  initialStatuses,
}: {
  descriptors: ConfigurableIntegrationDescriptor[];
  initialStatuses: IntegrationView[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {descriptors.map((descriptor) => (
        <IntegrationCard key={descriptor.key} descriptor={descriptor} initial={initialStatuses.find((s) => s.key === descriptor.key) ?? null} />
      ))}
    </div>
  );
}

function IntegrationCard({ descriptor, initial }: { descriptor: ConfigurableIntegrationDescriptor; initial: IntegrationView | null }) {
  // Secrets are never sent back from the server, so every field starts blank;
  // the hint below tells the admin whether a value is already on file.
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(descriptor.fields.map((f) => [f.key, ""])));
  const [status, setStatus] = React.useState(initial?.status ?? "NOT_CONNECTED");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const nonEmpty = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
      const result = await saveIntegrationConfigAction(descriptor.key, nonEmpty);
      if (result.ok) {
        toast.success(result.data.detail);
        setStatus(nonEmpty && Object.keys(nonEmpty).length > 0 ? "CONNECTED" : status);
      } else {
        toast.error(result.error);
      }
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      const result = await disconnectIntegrationAction(descriptor.key);
      if (result.ok) {
        setStatus("NOT_CONNECTED");
        setValues(Object.fromEntries(descriptor.fields.map((f) => [f.key, ""])));
        toast.success("Disconnected.");
      } else {
        toast.error(result.error);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{descriptor.name}</CardTitle>
          <Badge tone={status === "CONNECTED" ? "success" : status === "NEEDS_ATTENTION" ? "warning" : "neutral"} dot>
            {status === "CONNECTED" ? "Connected" : status === "NEEDS_ATTENTION" ? "Needs attention" : "Not connected"}
          </Badge>
        </div>
        <CardDescription>{descriptor.description}</CardDescription>

        {descriptor.fields.map((field) => (
          <Field key={field.key} label={field.label} htmlFor={`${descriptor.key}-${field.key}`} hint={initial?.configuredFields.includes(field.key) ? "Currently set — leave blank to keep it." : undefined}>
            <Input
              id={`${descriptor.key}-${field.key}`}
              type={field.secret ? "password" : "text"}
              placeholder={field.placeholder}
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
          </Field>
        ))}

        <div className="flex gap-2">
          <Button size="sm" loading={saving} onClick={save}>
            Save & test connection
          </Button>
          {status !== "NOT_CONNECTED" && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={disconnect}>
              Disconnect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
