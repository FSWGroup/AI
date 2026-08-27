"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Input, Label } from "@/components/ui";

export function NewJobForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [openingTitle, setOpeningTitle] = useState("");
  const [isSalesRole, setIsSalesRole] = useState(false);
  const [leadership, setLeadership] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button className="mt-5" variant="secondary" onClick={() => setOpen(true)}>
        New job profile
      </Button>
    );
  }

  return (
    <Card className="mt-5 p-6">
      <h3 className="text-sm font-bold text-navy-900">New job profile</h3>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="jpName">Profile name</Label>
          <Input id="jpName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="jpOpening">Opening title</Label>
          <Input
            id="jpOpening"
            value={openingTitle}
            onChange={(e) => setOpeningTitle(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-fsw-600"
            checked={isSalesRole}
            onChange={(e) => setIsSalesRole(e.target.checked)}
          />
          Sales role (enables 11-trait sales analysis)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-fsw-600"
            checked={leadership}
            onChange={(e) => setLeadership(e.target.checked)}
          />
          Leadership module
        </label>
      </div>
      {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button
          disabled={busy || name.length < 2 || openingTitle.length < 2}
          onClick={() => {
            setBusy(true);
            void api<{ id: string }>("/api/admin/jobs", {
              body: {
                name,
                openingTitle,
                isSalesRole,
                leadershipModuleEnabled: leadership,
              },
            })
              .then((res) => {
                router.push(`/admin/jobs/${res.id}`);
                router.refresh();
              })
              .catch((err) =>
                setError(err instanceof ApiError ? err.message : "Failed."),
              )
              .finally(() => setBusy(false));
          }}
        >
          Create
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
