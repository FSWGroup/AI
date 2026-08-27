"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Badge, Button, Card, Input, Label } from "@/components/ui";

const RETENTION_TYPES = [
  { key: "ASSESSMENT_ANSWERS", label: "Assessment answers" },
  { key: "SCORE_REPORT_DATA", label: "Score / report data" },
  { key: "INVITATION_RECORDS", label: "Invitation records" },
  { key: "INTEGRITY_EVENT_LOGS", label: "Integrity event logs" },
  { key: "WEBCAM_RECORDINGS", label: "Webcam recordings" },
  { key: "AUDIT_RECORDS", label: "Audit records" },
];

const ROLES = ["SUPER_ADMIN", "HR_ADMIN", "HIRING_MANAGER", "ASSESSMENT_ADMIN", "VIEWER"];

export function SettingsForm({
  settings,
  retention,
  holds,
  storageProvider,
}: {
  settings: {
    companyName: string;
    privacyContactEmail: string | null;
    accommodationContactEmail: string | null;
    hrNotificationEmail: string | null;
    privacyNoticeConfigured: boolean;
    storageConfigured: boolean;
    httpsConfirmed: boolean;
    recordingAccessRoles: string[];
  };
  retention: { recordType: string; retentionDays: number | null }[];
  holds: { id: string; scope: string; reason: string; active: boolean; createdAt: string }[];
  storageProvider: string;
}) {
  const router = useRouter();
  const [org, setOrg] = useState(settings);
  const [days, setDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      RETENTION_TYPES.map((t) => [
        t.key,
        String(retention.find((r) => r.recordType === t.key)?.retentionDays ?? ""),
      ]),
    ),
  );
  const [holdScope, setHoldScope] = useState("GLOBAL");
  const [holdReason, setHoldReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function post(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/admin/settings", { body });
      setMessage("Saved.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {message && (
        <p role="status" className="rounded-lg bg-fsw-50 p-3 text-sm text-fsw-900">
          {message}
        </p>
      )}

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Organization</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Company name</Label>
            <Input
              value={org.companyName}
              onChange={(e) => setOrg({ ...org, companyName: e.target.value })}
            />
          </div>
          <div>
            <Label>Privacy contact email</Label>
            <Input
              type="email"
              value={org.privacyContactEmail ?? ""}
              onChange={(e) =>
                setOrg({ ...org, privacyContactEmail: e.target.value || null })
              }
            />
          </div>
          <div>
            <Label>Accommodation contact email</Label>
            <Input
              type="email"
              value={org.accommodationContactEmail ?? ""}
              onChange={(e) =>
                setOrg({ ...org, accommodationContactEmail: e.target.value || null })
              }
            />
          </div>
          <div>
            <Label>HR notification email</Label>
            <Input
              type="email"
              value={org.hrNotificationEmail ?? ""}
              onChange={(e) =>
                setOrg({ ...org, hrNotificationEmail: e.target.value || null })
              }
            />
          </div>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          {(
            [
              ["privacyNoticeConfigured", "Privacy/recording notice reviewed and configured"],
              ["storageConfigured", "Object storage configured for production"],
              ["httpsConfirmed", "HTTPS environment confirmed"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-fsw-600"
                checked={org[key]}
                onChange={(e) => setOrg({ ...org, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-navy-400">
          Storage provider currently: <strong>{storageProvider}</strong>. In
          production, webcam invitations stay disabled until the notice,
          recording retention, object storage, and HTTPS are all configured.
        </p>
        <div className="mt-4">
          <Label>Roles allowed to view recordings (least privilege)</Label>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-fsw-600"
                  checked={org.recordingAccessRoles.includes(r)}
                  onChange={(e) =>
                    setOrg({
                      ...org,
                      recordingAccessRoles: e.target.checked
                        ? [...org.recordingAccessRoles, r]
                        : org.recordingAccessRoles.filter((x) => x !== r),
                    })
                  }
                />
                {r.replaceAll("_", " ")}
              </label>
            ))}
          </div>
        </div>
        <Button className="mt-5" disabled={busy} onClick={() => void post({ action: "org", ...org })}>
          Save organization settings
        </Button>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Retention policies</h3>
        <p className="mt-1 text-xs text-navy-500">
          Days each record type is kept before the scheduled deletion job
          removes it. Leave blank to keep indefinitely (until a policy is
          set). No single default satisfies every jurisdiction — set these
          with counsel. Records under legal hold are never auto-deleted.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {RETENTION_TYPES.map((t) => (
            <div key={t.key} className="flex items-center justify-between gap-3 rounded-lg border border-navy-100 p-3">
              <span className="text-sm text-navy-800">{t.label}</span>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  className="w-24"
                  value={days[t.key]}
                  onChange={(e) => setDays({ ...days, [t.key]: e.target.value })}
                  aria-label={`${t.label} retention days`}
                />
                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  disabled={busy}
                  onClick={() =>
                    void post({
                      action: "retention",
                      recordType: t.key,
                      retentionDays: days[t.key] ? Number(days[t.key]) : null,
                    })
                  }
                >
                  Set
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-bold text-navy-900">Legal holds</h3>
        <p className="mt-1 text-xs text-navy-500">
          While a hold is active, matching records cannot be deleted — by the
          retention job or by admins. Scope: GLOBAL, CANDIDATE:&lt;id&gt;, or
          ATTEMPT:&lt;id&gt;.
        </p>
        <div className="mt-3 space-y-2">
          {holds.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-navy-100 p-3 text-sm">
              <div>
                <span className="font-mono text-xs font-bold text-navy-800">{h.scope}</span>
                <p className="text-xs text-navy-500">{h.reason}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={h.active ? "red" : "neutral"}>
                  {h.active ? "Active" : "Released"}
                </Badge>
                {h.active && (
                  <Button
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    disabled={busy}
                    onClick={() =>
                      void post({ action: "legal_hold_release", holdId: h.id })
                    }
                  >
                    Release
                  </Button>
                )}
              </div>
            </div>
          ))}
          {holds.length === 0 && <p className="text-sm text-navy-400">No legal holds.</p>}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            placeholder="Scope (e.g. GLOBAL)"
            value={holdScope}
            onChange={(e) => setHoldScope(e.target.value)}
            aria-label="Hold scope"
          />
          <Input
            placeholder="Reason"
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value)}
            aria-label="Hold reason"
          />
          <Button
            variant="secondary"
            disabled={busy || holdReason.length < 3}
            onClick={() =>
              void post({
                action: "legal_hold_create",
                scope: holdScope,
                reason: holdReason,
              })
            }
          >
            Create hold
          </Button>
        </div>
      </Card>
    </div>
  );
}
