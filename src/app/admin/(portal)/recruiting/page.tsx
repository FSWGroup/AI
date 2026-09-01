import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { pipelineHealth, formatRate, sourcePerformance } from "@/lib/ats/analytics";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "green" | "amber" | "neutral" | "blue" | "red"> = {
  OPEN: "green",
  DRAFT: "neutral",
  PENDING_APPROVAL: "amber",
  APPROVED: "blue",
  ON_HOLD: "amber",
  FILLED: "blue",
  CLOSED: "neutral",
  REJECTED: "red",
};

export default async function RecruitingHomePage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_REQUISITIONS")) redirect("/admin");

  const [requisitions, applications, myApprovals, myScorecards] = await Promise.all([
    prisma.requisition.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        department: true,
        location: true,
        _count: { select: { applications: true } },
      },
      take: 50,
    }),
    prisma.application.findMany({
      select: {
        id: true,
        status: true,
        appliedAt: true,
        hiredAt: true,
        rejectedAt: true,
        lastActivityAt: true,
        channel: { select: { key: true, name: true } },
      },
    }),
    prisma.requisitionApproval.count({
      where: { approverId: user.id, decision: "PENDING", requisition: { status: "PENDING_APPROVAL" } },
    }),
    prisma.interviewParticipant.count({
      where: {
        userId: user.id,
        scorecardRequired: true,
        interview: { status: "COMPLETED" },
      },
    }),
  ]);

  const rows = applications.map((a) => ({
    id: a.id,
    status: a.status,
    channelKey: a.channel?.key ?? null,
    channelName: a.channel?.name ?? null,
    appliedAt: a.appliedAt,
    hiredAt: a.hiredAt,
    rejectedAt: a.rejectedAt,
  }));
  const activity = new Map(applications.map((a) => [a.id, a.lastActivityAt]));
  const health = pipelineHealth(rows, activity);
  const sources = sourcePerformance(rows).slice(0, 5);

  const open = requisitions.filter((r) => r.status === "OPEN");

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading
          eyebrow="Recruiting"
          title="Hiring overview"
          description="Every open role, where candidates are, and where they came from."
        />
        {can(user.role, "MANAGE_REQUISITIONS") && (
          <Link
            href="/admin/recruiting/requisitions/new"
            className="rounded-lg bg-fsw-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fsw-700"
          >
            New requisition
          </Link>
        )}
      </div>

      {(myApprovals > 0 || myScorecards > 0) && (
        <Card className="mt-6 border-fsw-200 bg-fsw-50 p-5">
          <h2 className="text-sm font-bold text-navy-900">Waiting on you</h2>
          <ul className="mt-2 space-y-1 text-sm text-navy-700">
            {myApprovals > 0 && (
              <li>
                {myApprovals} requisition{myApprovals === 1 ? "" : "s"} awaiting your
                approval.
              </li>
            )}
            {myScorecards > 0 && (
              <li>
                {myScorecards} interview{myScorecards === 1 ? "" : "s"} you attended
                may still need a scorecard.
              </li>
            )}
          </ul>
        </Card>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Open roles" value={open.length} />
        <Stat label="Active candidates" value={health.active} />
        <Stat label="Hired" value={health.hired} />
        <Stat
          label="Median days to hire"
          value={health.medianDaysToHire == null ? "—" : Math.round(health.medianDaysToHire)}
        />
        <Stat
          label="Stalled 14+ days"
          value={health.stalled}
          tone={health.stalled > 0 ? "amber" : undefined}
        />
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-sm font-bold text-navy-900">Requisitions</h2>
        {requisitions.length === 0 ? (
          <p className="mt-3 text-sm text-navy-400">
            No requisitions yet. Create one to start taking applications.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="py-2">Role</th>
                <th className="py-2">Department</th>
                <th className="py-2">Location</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Candidates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {requisitions.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5">
                    <Link
                      href={`/admin/recruiting/requisitions/${r.id}`}
                      className="font-semibold text-fsw-700 hover:underline"
                    >
                      {r.title}
                    </Link>
                    <span className="ml-2 text-xs text-navy-400">{r.reference}</span>
                  </td>
                  <td className="py-2.5 text-navy-600">{r.department?.name ?? "—"}</td>
                  <td className="py-2.5 text-navy-600">{r.location?.name ?? "—"}</td>
                  <td className="py-2.5">
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>
                      {r.status.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </td>
                  <td className="py-2.5 text-right font-semibold text-navy-800">
                    {r._count.applications}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {sources.length > 0 && (
        <Card className="mt-6 p-6">
          <h2 className="text-sm font-bold text-navy-900">Where candidates come from</h2>
          <p className="mt-1 text-xs text-navy-500">
            Hire rate is withheld below ten applications — a percentage from a
            handful of people is noise wearing a number.
          </p>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="py-2">Source</th>
                <th className="py-2 text-right">Applications</th>
                <th className="py-2 text-right">Hires</th>
                <th className="py-2 text-right">Hire rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {sources.map((s) => (
                <tr key={s.channelKey}>
                  <td className="py-2 font-medium text-navy-800">{s.channelName}</td>
                  <td className="py-2 text-right text-navy-600">{s.applications}</td>
                  <td className="py-2 text-right text-navy-600">{s.hires}</td>
                  <td className="py-2 text-right text-navy-600">{formatRate(s.hireRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "amber";
}) {
  return (
    <Card className="p-4">
      <p
        className={`text-2xl font-bold ${tone === "amber" ? "text-amber-700" : "text-navy-900"}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs leading-tight text-navy-500">{label}</p>
    </Card>
  );
}
