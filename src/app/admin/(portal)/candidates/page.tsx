import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { attemptScopeWhere } from "@/lib/auth/scope";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { summarizeIntegrity, INTEGRITY_LABELS } from "@/lib/scoring/integrity";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_CANDIDATES")) redirect("/admin");
  const { q, status } = await searchParams;
  const scope = await attemptScopeWhere(user);

  const attempts = await prisma.attempt.findMany({
    where: {
      ...scope,
      ...(status ? { status: status as never } : {}),
      ...(q
        ? {
            candidate: {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      candidate: true,
      jobOpening: true,
      invitation: true,
      assessmentVersion: true,
      reports: { where: { status: "READY" }, select: { id: true }, take: 1 },
      integrityEvents: { select: { type: true } },
    },
  });

  const fmt = (d: Date | null | undefined) =>
    d
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(d)
      : "—";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading
          title="Candidates"
          description="Every assessment attempt, searchable and filterable."
        />
        <Link
          href="/admin/candidates/invite"
          className="rounded-lg bg-fsw-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fsw-700"
        >
          Invite candidate
        </Link>
      </div>

      <form method="GET" className="mt-5 flex flex-wrap gap-3">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name or email…"
          className="w-64 rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm"
          aria-label="Search candidates"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="NOT_STARTED">Not started</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="INVALIDATED">Invalidated</option>
        </select>
        <button className="rounded-lg border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50">
          Filter
        </button>
      </form>

      <Card className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
            <tr>
              <th className="px-4 py-3">Candidate</th>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3">Invited</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Completed</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Integrity</th>
              <th className="px-4 py-3">Report</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {attempts.map((a) => {
              const counts = new Map<string, number>();
              for (const e of a.integrityEvents) {
                counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
              }
              const integrity = summarizeIntegrity(
                [...counts.entries()].map(([type, count]) => ({ type, count })),
              );
              return (
                <tr key={a.id} className="hover:bg-navy-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/candidates/${a.id}`}
                      className="font-semibold text-fsw-700 hover:underline"
                    >
                      {a.candidate.firstName} {a.candidate.lastName}
                    </Link>
                    <p className="text-xs text-navy-400">{a.candidate.email}</p>
                  </td>
                  <td className="px-4 py-3 text-navy-600">{a.jobOpening.title}</td>
                  <td className="px-4 py-3 text-navy-500">{fmt(a.invitation.createdAt)}</td>
                  <td className="px-4 py-3 text-navy-500">{fmt(a.startedAt)}</td>
                  <td className="px-4 py-3 text-navy-500">{fmt(a.completedAt)}</td>
                  <td className="px-4 py-3 text-navy-500">
                    v{a.assessmentVersion.versionNumber}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        integrity.level === "NO_NOTABLE_EVENTS"
                          ? "green"
                          : integrity.level === "MINOR_REVIEW_RECOMMENDED"
                            ? "amber"
                            : "red"
                      }
                    >
                      {INTEGRITY_LABELS[integrity.level]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {a.reports.length > 0 ? (
                      <Link
                        href={`/admin/candidates/${a.id}/report`}
                        className="font-semibold text-fsw-700 hover:underline"
                      >
                        View
                      </Link>
                    ) : (
                      <span className="text-navy-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {attempts.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-navy-400">
                  No candidates match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
