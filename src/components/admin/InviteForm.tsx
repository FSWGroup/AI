"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Input, Label, Select } from "@/components/ui";

export function InviteForm({
  openings,
}: {
  openings: { id: string; title: string; profileName: string }[];
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobOpeningId, setJobOpeningId] = useState(openings[0]?.id ?? "");
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; launchUrl?: string } | null>(
    null,
  );

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ code: string; launchUrl?: string }>(
        "/api/admin/invitations",
        { body: { firstName, lastName, email, jobOpeningId, expiresInDays } },
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invitation failed.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Card className="mt-6 p-8">
        <h2 className="text-lg font-bold text-navy-900">Invitation sent</h2>
        <p className="mt-2 text-sm text-navy-600">
          {firstName} {lastName} has been emailed a secure assessment link.
        </p>
        <p className="mt-3 text-sm text-navy-600">
          Assessment code: <span className="font-mono font-bold">{result.code}</span>
        </p>
        {result.launchUrl && (
          <div className="mt-4 rounded-lg bg-navy-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
              Development only — launch link
            </p>
            <p className="mt-1 break-all font-mono text-xs text-navy-700">
              {result.launchUrl}
            </p>
          </div>
        )}
        <Button className="mt-6" variant="secondary" onClick={() => setResult(null)}>
          Invite another candidate
        </Button>
      </Card>
    );
  }

  return (
    <Card className="mt-6 p-8">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="job">Job opening</Label>
          <Select id="job" value={jobOpeningId} onChange={(e) => setJobOpeningId(e.target.value)}>
            {openings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} — {o.profileName}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="expires">Expires in (days)</Label>
          <Input
            id="expires"
            type="number"
            min={1}
            max={60}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number(e.target.value))}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || openings.length === 0}>
          Send invitation
        </Button>
        {openings.length === 0 && (
          <p className="text-sm text-navy-400">
            Create a job opening first under Job Profiles.
          </p>
        )}
      </form>
    </Card>
  );
}
