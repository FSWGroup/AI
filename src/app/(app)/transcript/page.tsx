import { requireActor } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import { formatDateTime, formatShortDate } from "@/lib/dates";
import { PrintTranscriptButton } from "@/app/(app)/transcript/print-transcript-button";

export const metadata = { title: "My Transcript" };

interface TranscriptEntry {
  id: string;
  date: Date;
  kind: "Completion" | "Acknowledgement" | "Certificate";
  title: string;
  detail: string;
}

export default async function TranscriptPage() {
  const actor = await requireActor();

  const [user, completions, acknowledgements, certificates] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        name: true,
        title: true,
        employeeId: true,
        department: { select: { name: true } },
        businessUnit: { select: { name: true } },
      },
    }),
    prisma.completionRecord.findMany({ where: { userId: actor.id }, orderBy: { completedAt: "desc" } }),
    prisma.acknowledgement.findMany({ where: { userId: actor.id }, orderBy: { acknowledgedAt: "desc" } }),
    prisma.certificate.findMany({ where: { userId: actor.id, revokedAt: null }, orderBy: { issuedAt: "desc" } }),
  ]);

  const entries: TranscriptEntry[] = [
    ...completions.map((c) => ({
      id: `completion-${c.id}`,
      date: c.completedAt,
      kind: "Completion" as const,
      title: c.titleSnapshot,
      detail: [
        c.scorePercent != null ? `Score ${Math.round(c.scorePercent)}%` : null,
        c.versionLabel ? `Version ${c.versionLabel}` : null,
        c.expiresAt ? `Valid until ${formatShortDate(c.expiresAt, actor.timezone)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...acknowledgements.map((a) => ({
      id: `ack-${a.id}`,
      date: a.acknowledgedAt,
      kind: "Acknowledgement" as const,
      title: a.statement,
      detail: a.signatureMethod === "typed_signature" ? `Signed: ${a.typedSignature ?? ""}` : "Acknowledged by checkbox",
    })),
    ...certificates.map((c) => ({
      id: `cert-${c.id}`,
      date: c.issuedAt,
      kind: "Certificate" as const,
      title: c.courseTitleSnapshot,
      detail: [`Certificate ${c.certificateNumber}`, c.expiresAt ? `Expires ${formatShortDate(c.expiresAt, actor.timezone)}` : null]
        .filter(Boolean)
        .join(" · "),
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const kindTone: Record<TranscriptEntry["kind"], "success" | "info" | "navy"> = {
    Completion: "success",
    Acknowledgement: "info",
    Certificate: "navy",
  };

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #transcript-printable, #transcript-printable * { visibility: visible; }
          #transcript-printable { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
        }
      `}</style>
      <PageHeader
        title="My transcript"
        description="Your complete, chronological training record."
        crumbs={[{ label: "Home", href: "/home" }, { label: "My Transcript" }]}
        actions={<PrintTranscriptButton />}
      />
      <PageBody>
        <div id="transcript-printable" className="flex flex-col gap-5">
          <Card>
            <CardContent className="flex flex-col gap-1">
              <p className="text-[1.0625rem] font-semibold text-[var(--text-primary)]">{user?.name ?? actor.name}</p>
              <p className="text-[0.8125rem] text-[var(--text-muted)]">
                {[user?.title, user?.department?.name, user?.businessUnit?.name].filter(Boolean).join(" · ")}
                {user?.employeeId ? ` · ${user.employeeId}` : ""}
              </p>
              <p className="text-[0.75rem] text-[var(--text-muted)]">
                Generated {formatDateTime(new Date(), actor.timezone)} · {entries.length} record{entries.length === 1 ? "" : "s"}
              </p>
            </CardContent>
          </Card>

          {entries.length === 0 ? (
            <EmptyState
              icon={<Icon name="certificate" className="h-5 w-5" />}
              title="No training history yet"
              description="Completed courses, SOP acknowledgements, and certificates will appear here."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)]">
              <table className="w-full border-collapse text-[0.8125rem]">
                <thead>
                  <tr className="bg-[var(--surface-sunken)]">
                    <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Date</th>
                    <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Type</th>
                    <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Item</th>
                    <th scope="col" className="border-b border-[var(--border-subtle)] p-2.5 text-left">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap border-b border-[var(--border-subtle)] p-2.5 text-[var(--text-muted)]">
                        {formatShortDate(entry.date, actor.timezone)}
                      </td>
                      <td className="border-b border-[var(--border-subtle)] p-2.5">
                        <Badge tone={kindTone[entry.kind]}>{entry.kind}</Badge>
                      </td>
                      <td className="border-b border-[var(--border-subtle)] p-2.5 font-medium text-[var(--text-primary)]">{entry.title}</td>
                      <td className="border-b border-[var(--border-subtle)] p-2.5 text-[var(--text-muted)]">{entry.detail || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}
