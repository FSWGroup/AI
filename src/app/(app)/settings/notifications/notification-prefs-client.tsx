"use client";

import * as React from "react";
import { toast } from "sonner";
import type { NotificationType } from "@prisma/client";
import { setNotificationPreferenceAction } from "@/app/(app)/settings/notifications/actions";

export interface PrefRow {
  type: NotificationType;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
}

export function NotificationPrefsClient({ initial }: { initial: PrefRow[] }) {
  const [rows, setRows] = React.useState(initial);

  const toggle = async (type: NotificationType, channel: "inApp" | "email") => {
    const current = rows.find((r) => r.type === type)?.[channel] ?? true;
    const next = !current;
    setRows((prev) => prev.map((r) => (r.type === type ? { ...r, [channel]: next } : r)));
    const result = await setNotificationPreferenceAction(type, channel, next);
    if (!result.ok) {
      setRows((prev) => prev.map((r) => (r.type === type ? { ...r, [channel]: current } : r)));
      toast.error(result.error);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
      <table className="min-w-full text-[0.8125rem]">
        <thead className="bg-[var(--surface-sunken)]">
          <tr>
            <th scope="col" className="px-3.5 py-2.5 text-left font-semibold">Notification</th>
            <th scope="col" className="px-3.5 py-2.5 text-center font-semibold">In-app</th>
            <th scope="col" className="px-3.5 py-2.5 text-center font-semibold">Email</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.type} className="border-t border-[var(--border-subtle)]">
              <td className="px-3.5 py-2.5">
                <p className="font-medium text-[var(--text-primary)]">{row.label}</p>
                <p className="text-[0.75rem] text-[var(--text-muted)]">{row.description}</p>
              </td>
              <td className="px-3.5 py-2.5 text-center">
                <input
                  type="checkbox"
                  aria-label={`${row.label}, in-app`}
                  checked={row.inApp}
                  onChange={() => void toggle(row.type, "inApp")}
                  className="h-4 w-4 rounded border-[var(--border-default)]"
                />
              </td>
              <td className="px-3.5 py-2.5 text-center">
                <input
                  type="checkbox"
                  aria-label={`${row.label}, email`}
                  checked={row.email}
                  onChange={() => void toggle(row.type, "email")}
                  className="h-4 w-4 rounded border-[var(--border-default)]"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
