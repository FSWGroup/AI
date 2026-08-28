"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import {
  createWebhookAction,
  setWebhookActiveAction,
  deleteWebhookAction,
  testWebhookAction,
  loadWebhookDeliveriesAction,
} from "@/app/(app)/admin/integrations/actions";
import type { WebhookDeliveryView } from "@/lib/services/integrations";

const EVENTS = [
  "training.assigned",
  "training.completed",
  "training.overdue",
  "sop.published",
  "certificate.issued",
  "certificate.revoked",
  "person.created",
  "person.deactivated",
];

export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

export function WebhooksPanel({ initialWebhooks }: { initialWebhooks: WebhookRow[] }) {
  const [webhooks, setWebhooks] = React.useState(initialWebhooks);
  const [showForm, setShowForm] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [events, setEvents] = React.useState<Set<string>>(new Set());
  const [creating, setCreating] = React.useState(false);
  const [revealedSecret, setRevealedSecret] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [deliveries, setDeliveries] = React.useState<Record<string, WebhookDeliveryView[]>>({});

  const toggleEvent = (event: string) => {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  };

  const create = async () => {
    setCreating(true);
    try {
      const result = await createWebhookAction({ url, events: [...events] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRevealedSecret(result.data.secret);
      setWebhooks((prev) => [{ id: result.data.id, url, events: [...events], isActive: true, createdAt: new Date().toISOString() }, ...prev]);
      setUrl("");
      setEvents(new Set());
      setShowForm(false);
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    setBusyId(id);
    try {
      const result = await setWebhookActiveAction(id, !current);
      if (result.ok) setWebhooks((prev) => prev.map((w) => (w.id === id ? { ...w, isActive: !current } : w)));
      else toast.error(result.error);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const result = await deleteWebhookAction(id);
      if (result.ok) setWebhooks((prev) => prev.filter((w) => w.id !== id));
      else toast.error(result.error);
    } finally {
      setBusyId(null);
    }
  };

  const test = async (id: string) => {
    setBusyId(id);
    try {
      const result = await testWebhookAction(id);
      if (result.ok) toast[result.data.ok ? "success" : "error"](`Test delivery ${result.data.ok ? "succeeded" : "failed"} (HTTP ${result.data.responseCode ?? "—"}).`);
      else toast.error(result.error);
      await loadDeliveries(id);
    } finally {
      setBusyId(null);
    }
  };

  const loadDeliveries = async (id: string) => {
    const result = await loadWebhookDeliveriesAction(id);
    if (result.ok) setDeliveries((prev) => ({ ...prev, [id]: result.data.deliveries }));
  };

  const toggleExpanded = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!deliveries[id]) await loadDeliveries(id);
  };

  return (
    <div className="flex flex-col gap-3">
      {revealedSecret && (
        <div className="rounded-lg border border-warning-100 bg-warning-50 p-4">
          <p className="text-[0.8125rem] font-semibold text-warning-700">Copy this signing secret now — it won&apos;t be shown again</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md bg-white px-3 py-2 text-[0.8125rem]">{revealedSecret}</code>
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(revealedSecret); toast.success("Copied."); }}>
              <Glyph name="copy" className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <button type="button" onClick={() => setRevealedSecret(null)} className="mt-2 text-[0.75rem] font-medium text-warning-700 underline">
            I&apos;ve saved it — dismiss
          </button>
        </div>
      )}

      {!showForm ? (
        <div>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Glyph name="plus" className="h-3.5 w-3.5" />
            Add webhook
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
          <Field label="Endpoint URL" htmlFor="webhook-url" hint="Must accept a signed POST.">
            <Input id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/fsw" />
          </Field>
          <fieldset className="mt-3">
            <legend className="text-[0.8125rem] font-medium text-[var(--text-primary)]">Events</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 py-1 text-[0.75rem]">
                  <input type="checkbox" checked={events.has(event)} onChange={() => toggleEvent(event)} className="h-3.5 w-3.5" />
                  {event}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={creating} onClick={create}>
              Create
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {webhooks.length === 0 ? (
        <EmptyState icon={<Icon name="integration" className="h-5 w-5" />} title="No webhooks configured" description="Add one to receive training and compliance events in real time." />
      ) : (
        <ul className="flex flex-col gap-2">
          {webhooks.map((webhook) => (
            <li key={webhook.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[0.8125rem] text-[var(--text-primary)]">{webhook.url}</p>
                  <p className="mt-0.5 text-[0.75rem] text-[var(--text-muted)]">{webhook.events.join(", ")}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge tone={webhook.isActive ? "success" : "neutral"} dot>
                    {webhook.isActive ? "Active" : "Disabled"}
                  </Badge>
                  <Button size="sm" variant="outline" loading={busyId === webhook.id} onClick={() => test(webhook.id)}>
                    Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggleExpanded(webhook.id)}>
                    {expandedId === webhook.id ? "Hide log" : "Delivery log"}
                  </Button>
                  <Button size="sm" variant="ghost" loading={busyId === webhook.id} onClick={() => toggleActive(webhook.id, webhook.isActive)}>
                    {webhook.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="ghost" loading={busyId === webhook.id} onClick={() => remove(webhook.id)}>
                    <Glyph name="trash" className="h-3.5 w-3.5" />
                    <span className="sr-only">Delete webhook</span>
                  </Button>
                </div>
              </div>
              {expandedId === webhook.id && (
                <div className="border-t border-[var(--border-subtle)] px-3.5 py-2.5">
                  {!deliveries[webhook.id] || deliveries[webhook.id]?.length === 0 ? (
                    <p className="text-[0.75rem] text-[var(--text-muted)]">No deliveries yet.</p>
                  ) : (
                    <table className="w-full text-[0.75rem]">
                      <thead>
                        <tr className="text-left text-[var(--text-muted)]">
                          <th scope="col" className="pb-1 font-medium">Event</th>
                          <th scope="col" className="pb-1 font-medium">Status</th>
                          <th scope="col" className="pb-1 font-medium">HTTP</th>
                          <th scope="col" className="pb-1 font-medium">Attempts</th>
                          <th scope="col" className="pb-1 font-medium">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveries[webhook.id]?.map((d) => (
                          <tr key={d.id} className="border-t border-[var(--border-subtle)]">
                            <td className="py-1">{d.event}</td>
                            <td className="py-1">
                              <Badge tone={d.status === "DELIVERED" ? "success" : d.status === "FAILED" ? "danger" : "neutral"}>{d.status}</Badge>
                            </td>
                            <td className="py-1">{d.responseCode ?? "—"}</td>
                            <td className="py-1">{d.attempts}</td>
                            <td className="py-1">{new Date(d.createdAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
