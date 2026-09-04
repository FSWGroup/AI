"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { Button, Input, Label, Select } from "@/components/ui";

export function HireRowActions({
  hireId,
  status,
  managerId,
  managers,
}: {
  hireId: string;
  status: string;
  managerId: string | null;
  managers: { id: string; name: string }[];
}) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState(status);
  const [nextManager, setNextManager] = useState(managerId ?? "");
  const [endedAt, setEndedAt] = useState("");
  const [endReason, setEndReason] = useState("");

  const departing = nextStatus.startsWith("DEPARTED");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-fsw-700 hover:underline"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="absolute right-4 z-10 mt-2 w-72 rounded-xl border border-navy-200 bg-white p-4 shadow-lg">
      <Label htmlFor={`mgr-${hireId}`}>Manager (rates their work)</Label>
      <Select
        id={`mgr-${hireId}`}
        value={nextManager}
        onChange={(e) => setNextManager(e.target.value)}
      >
        <option value="">Unassigned</option>
        {managers.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>

      <Label htmlFor={`st-${hireId}`} className="mt-3 block">
        Status
      </Label>
      <Select
        id={`st-${hireId}`}
        value={nextStatus}
        onChange={(e) => setNextStatus(e.target.value)}
      >
        <option value="ACTIVE">Active</option>
        <option value="ON_LEAVE">On leave</option>
        <option value="DEPARTED_VOLUNTARY">Left voluntarily</option>
        <option value="DEPARTED_INVOLUNTARY">Employment ended</option>
      </Select>

      {departing && (
        <>
          <Label htmlFor={`end-${hireId}`} className="mt-3 block">
            Last day
          </Label>
          <Input
            id={`end-${hireId}`}
            type="date"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
          />
          <Label htmlFor={`why-${hireId}`} className="mt-3 block">
            Reason (optional, free text)
          </Label>
          <Input
            id={`why-${hireId}`}
            value={endReason}
            onChange={(e) => setEndReason(e.target.value)}
          />
          <p className="mt-2 text-xs text-navy-500">
            Retention is measured in days, so a departure needs a date.
          </p>
        </>
      )}

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button
          className="px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={async () => {
            await run(async () => {
              await api(`/api/admin/hires/${hireId}`, {
                method: "PATCH",
                body: {
                  managerId: nextManager || null,
                  status: nextStatus,
                  endedAt: departing && endedAt ? endedAt : undefined,
                  endReason: departing ? endReason || null : undefined,
                },
              });
              setOpen(false);
            }, { fallback: "Could not save." });
          }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="ghost"
          className="px-3 py-1.5 text-xs"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
