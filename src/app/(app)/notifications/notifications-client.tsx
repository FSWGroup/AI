"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph } from "@/components/icons";
import { cn } from "@/lib/utils";
import { markReadAction, markAllReadAction } from "@/app/(app)/notifications/actions";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  createdAt: string;
  readAt: string | null;
}

export function NotificationsClient({ initial }: { initial: NotificationRow[] }) {
  const [items, setItems] = React.useState(initial);
  const [filter, setFilter] = React.useState<"all" | "unread">("all");
  const [markingAll, setMarkingAll] = React.useState(false);

  const unreadCount = items.filter((i) => !i.readAt).length;
  const visible = filter === "unread" ? items.filter((i) => !i.readAt) : items;

  const markOne = async (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)));
    const result = await markReadAction(id);
    if (!result.ok) toast.error(result.error);
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      const result = await markAllReadAction();
      if (result.ok) {
        setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
        toast.success(`Marked ${result.data.count} notification${result.data.count === 1 ? "" : "s"} read.`);
      } else {
        toast.error(result.error);
      }
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-[var(--border-default)] p-0.5">
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded px-3 py-1 text-[0.8125rem] font-medium",
                filter === f ? "bg-[var(--surface-sunken)] text-[var(--text-primary)]" : "text-[var(--text-muted)]",
              )}
            >
              {f === "all" ? "All" : `Unread (${unreadCount})`}
            </button>
          ))}
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" loading={markingAll} onClick={markAll}>
            Mark all read
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Glyph name="bell" className="h-5 w-5" />}
          title={filter === "unread" ? "You're all caught up" : "No notifications yet"}
          description={filter === "unread" ? undefined : "Training assignments, reminders, and announcements will show up here."}
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((item) => {
            const content = (
              <div className={cn("flex items-start gap-3 rounded-lg border p-3.5", item.readAt ? "border-[var(--border-subtle)] bg-[var(--surface-card)]" : "border-fswblue-200 bg-fswblue-50")}>
                {!item.readAt && <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--brand-secondary)]" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-[var(--text-primary)]">{item.title}</p>
                    {!item.readAt && <Badge tone="info">Unread</Badge>}
                  </div>
                  {item.body && <p className="mt-0.5 text-[0.8125rem] text-[var(--text-secondary)]">{item.body}</p>}
                  <p className="mt-1 text-[0.75rem] text-[var(--text-muted)]">{new Date(item.createdAt).toLocaleString()}</p>
                </div>
              </div>
            );

            return (
              <li key={item.id}>
                {item.linkUrl ? (
                  <Link href={item.linkUrl} onClick={() => !item.readAt && void markOne(item.id)} className="block">
                    {content}
                  </Link>
                ) : (
                  <button type="button" onClick={() => !item.readAt && void markOne(item.id)} className="block w-full text-left">
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
