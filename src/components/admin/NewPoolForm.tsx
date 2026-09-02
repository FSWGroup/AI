"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Input, Label, Select } from "@/components/ui";

export function NewPoolForm({
  jobProfiles,
}: {
  jobProfiles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jobProfileId, setJobProfileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New pool
      </Button>
    );
  }

  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-navy-900">New pool</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="poolName">Name</Label>
          <Input
            id="poolName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="2026 sales finalists"
          />
        </div>
        <div>
          <Label htmlFor="poolProfile">Role type</Label>
          <Select
            id="poolProfile"
            value={jobProfileId}
            onChange={(e) => setJobProfileId(e.target.value)}
          >
            <option value="">Any</option>
            {jobProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="mt-4">
        <Label htmlFor="poolDesc">What this pool is for</Label>
        <Input
          id="poolDesc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-5 flex gap-3">
        <Button
          disabled={busy || name.trim() === ""}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api("/api/admin/talent/pools", {
                method: "POST",
                body: {
                  name,
                  description: description || null,
                  jobProfileId: jobProfileId || null,
                },
              });
              setOpen(false);
              router.refresh();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Could not create it.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Create pool"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
