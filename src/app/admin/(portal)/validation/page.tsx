import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { MIN_N_COEFFICIENT, MIN_N_SUPPORTED } from "@/lib/validation/gates";
import { NORMABLE_DIMENSION_COUNT } from "@/lib/validation/service";
import { NewStudyForm } from "@/components/admin/ValidationForms";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  OVERALL_RATING: "Overall effectiveness rating",
  COMPETENCY_RATING: "Single performance criterion",
  COMPOSITE_RATING: "Composite of several criteria",
  METRIC: "Objective metric",
  RETENTION: "Retention",
};

export default async function ValidationPage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "VIEW_VALIDATION")) redirect("/admin");

  const [studies, hireCount, hiresWithAttempt, reviewedHires, cycles, activeNorms, jobProfiles] =
    await Promise.all([
      prisma.validationStudy.findMany({
        include: { jobProfile: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.hire.count(),
      prisma.hire.count({ where: { attemptId: { not: null } } }),
      prisma.hire.count({
        where: { attemptId: { not: null }, reviews: { some: { status: "SUBMITTED" } } },
      }),
      prisma.performanceCycle.findMany({
        include: { _count: { select: { reviews: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.normTable.count({ where: { status: "ACTIVE" } }),
      prisma.jobProfile.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

  const canManage = can(user.role, "MANAGE_VALIDATION");

  return (
    <div className="mx-auto max-w-5xl">
      <SectionHeading
        eyebrow="Validation"
        title="Does the assessment predict anything?"
        description="Post-hire performance is the only evidence that can answer that. This is where it is collected, correlated, and turned into local norms."
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <Stat label="Employment records" value={hireCount} />
        <Stat
          label="With an assessment linked"
          value={hiresWithAttempt}
          hint={hireCount > 0 ? `${Math.round((hiresWithAttempt / hireCount) * 100)}% of hires` : undefined}
        />
        <Stat
          label="With a submitted review"
          value={reviewedHires}
          hint="The usable sample"
        />
        <Stat
          label="Dimensions on real norms"
          value={`${activeNorms} of ${NORMABLE_DIMENSION_COUNT}`}
          hint="The rest report provisional bands"
        />
      </div>

      {reviewedHires < MIN_N_COEFFICIENT && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {reviewedHires} hires have both an assessment and a performance
          rating. Below {MIN_N_COEFFICIENT} no coefficient is reported at all,
          and below {MIN_N_SUPPORTED} everything stays preliminary. This is not
          a limitation to work around — it is what an honest study looks like
          early on. The number only grows if reviews keep getting filed, so the
          cycles below matter more right now than the studies do.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/admin/validation/hires"
          className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-semibold text-navy-800 hover:bg-navy-50"
        >
          Employment records
        </Link>
        <Link
          href="/admin/validation/reviews"
          className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-semibold text-navy-800 hover:bg-navy-50"
        >
          My review queue
        </Link>
        <Link
          href="/admin/validation/norms"
          className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-semibold text-navy-800 hover:bg-navy-50"
        >
          Norm tables
        </Link>
      </div>

      {/* ---- Cycles ---- */}
      <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
        Review cycles
      </h3>
      <Card className="mt-3 overflow-x-auto">
        {cycles.length === 0 ? (
          <p className="p-4 text-sm text-navy-500">
            No review cycles yet. A cycle is a round of ratings — a 90-day
            review, an annual review. Without one, no performance data is ever
            collected and no study can run.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="px-4 py-3">Cycle</th>
                <th className="px-4 py-3">Falls due</th>
                <th className="px-4 py-3">Criteria</th>
                <th className="px-4 py-3">Reviews</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id} className="border-b border-navy-50 last:border-0">
                  <td className="px-4 py-3 font-semibold text-navy-900">{c.name}</td>
                  <td className="px-4 py-3 text-navy-600">
                    {c.dueAfterDays === null
                      ? "On a calendar date"
                      : `${c.dueAfterDays} days after hire`}
                  </td>
                  <td className="px-4 py-3 text-navy-600">{c.criterionKeys.length}</td>
                  <td className="px-4 py-3 text-navy-600">{c._count.reviews}</td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        c.status === "OPEN" ? "green" : c.status === "CLOSED" ? "neutral" : "amber"
                      }
                    >
                      {c.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ---- Studies ---- */}
      <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
        Studies
      </h3>
      <Card className="mt-3 overflow-x-auto">
        {studies.length === 0 ? (
          <p className="p-4 text-sm text-navy-500">
            No studies yet. A study pairs one criterion with the dimension
            scores of everyone hired, and reports what moved with what.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="px-4 py-3">Study</th>
                <th className="px-4 py-3">Criterion</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Last computed</th>
                <th className="px-4 py-3">n</th>
              </tr>
            </thead>
            <tbody>
              {studies.map((s) => {
                const summary = (s.summary ?? {}) as { n?: number };
                return (
                  <tr key={s.id} className="border-b border-navy-50 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/validation/studies/${s.id}`}
                        className="font-semibold text-fsw-700 hover:underline"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-navy-600">
                      {KIND_LABEL[s.criterionKind] ?? s.criterionKind}
                    </td>
                    <td className="px-4 py-3 text-navy-600">
                      {s.jobProfile?.name ?? "All roles"}
                    </td>
                    <td className="px-4 py-3 text-navy-600">
                      {s.computedAt ? s.computedAt.toISOString().slice(0, 10) : "Never"}
                    </td>
                    <td className="px-4 py-3 text-navy-600">{summary.n ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {canManage && (
        <div className="mt-6">
          <NewStudyForm jobProfiles={jobProfiles} hasCycles={cycles.length > 0} />
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-navy-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-navy-500">{hint}</p>}
    </Card>
  );
}
