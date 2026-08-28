"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { acknowledgeAnnouncementAction } from "@/app/(app)/home/actions";
import type { ActiveAnnouncement } from "@/lib/services/announcements";

export function AnnouncementFeed({ announcements }: { announcements: ActiveAnnouncement[] }) {
  const [items, setItems] = React.useState(announcements);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const acknowledge = async (id: string) => {
    setBusyId(id);
    try {
      const result = await acknowledgeAnnouncementAction(id);
      if (result.ok) {
        setItems((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
      } else {
        toast.error(result.error);
      }
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) {
    return <EmptyState icon={<Glyph name="bell" className="h-5 w-5" />} title="No announcements right now" />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((a) => (
        <li key={a.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
              {a.pinned && <Glyph name="star-filled" className="h-3.5 w-3.5 shrink-0 text-signal-500" />}
              {a.title}
            </p>
          </div>
          <p className="mt-1 text-[0.8125rem] text-[var(--text-secondary)]">{a.body}</p>
          {a.requiresAck && (
            <div className="mt-2">
              {a.acknowledged ? (
                <span className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-success-700">
                  <Glyph name="check" className="h-3.5 w-3.5" />
                  Acknowledged
                </span>
              ) : (
                <Button size="sm" variant="outline" loading={busyId === a.id} onClick={() => acknowledge(a.id)}>
                  Acknowledge
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
