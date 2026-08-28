"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from "@/lib/permissions";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/(app)/admin/integrations/actions";

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: Permission[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function ApiKeysPanel({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const [keys, setKeys] = React.useState(initialKeys);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<Set<Permission>>(new Set());
  const [revealedSecret, setRevealedSecret] = React.useState<{ prefix: string; secret: string } | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  const toggleScope = (perm: Permission) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  };

  const create = async () => {
    setCreating(true);
    try {
      const result = await createApiKeyAction({ name, scopes: [...scopes] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRevealedSecret({ prefix: result.data.prefix, secret: result.data.secret });
      setKeys((prev) => [
        { id: result.data.id, name, prefix: result.data.prefix, scopes: [...scopes], lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      setName("");
      setScopes(new Set());
      setShowForm(false);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      const result = await revokeApiKeyAction(id);
      if (result.ok) {
        setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)));
        toast.success("API key revoked.");
      } else {
        toast.error(result.error);
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {revealedSecret && (
        <div className="rounded-lg border border-warning-100 bg-warning-50 p-4">
          <p className="text-[0.8125rem] font-semibold text-warning-700">Copy this key now — it won&apos;t be shown again</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md bg-white px-3 py-2 text-[0.8125rem]">{revealedSecret.secret}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(revealedSecret.secret);
                toast.success("Copied.");
              }}
            >
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
            Create API key
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4">
          <Field label="Key name" htmlFor="apikey-name" hint="e.g. “HRIS sync”">
            <Input id="apikey-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <fieldset className="mt-3">
            <legend className="text-[0.8125rem] font-medium text-[var(--text-primary)]">Scopes</legend>
            <div className="mt-1.5 grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-2 sm:grid-cols-2">
              {ALL_PERMISSIONS.map((perm) => (
                <label key={perm} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[0.75rem] hover:bg-[var(--surface-sunken)]">
                  <input type="checkbox" checked={scopes.has(perm)} onChange={() => toggleScope(perm)} className="h-3.5 w-3.5" />
                  <span title={PERMISSIONS[perm]}>{perm}</span>
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

      {keys.length === 0 ? (
        <EmptyState icon={<Icon name="integration" className="h-5 w-5" />} title="No API keys yet" description="Create one to let an external system call the public REST API." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="min-w-full text-[0.8125rem]">
            <thead className="bg-[var(--surface-sunken)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Name</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Prefix</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Scopes</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Last used</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-t border-[var(--border-subtle)]">
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{key.name}</td>
                  <td className="px-3 py-2 font-mono">{key.prefix}…</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{key.scopes.length} scope{key.scopes.length === 1 ? "" : "s"}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)]">{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={key.revokedAt ? "neutral" : "success"} dot>
                      {key.revokedAt ? "Revoked" : "Active"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!key.revokedAt && (
                      <Button size="sm" variant="ghost" loading={busyId === key.id} onClick={() => revoke(key.id)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
