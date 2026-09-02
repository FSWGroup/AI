import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { LEVEL_LABEL, summarizeGrades, validateRubric } from "@/lib/worksample/rubric";
import { loadGrades, toCriterionLike } from "@/lib/worksample/service";
import { WorkSampleActions } from "@/components/admin/WorkSampleActions";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  ASSIGNED: "neutral",
  STARTED: "blue",
  SUBMITTED: "amber",
  GRADED: "green",
  EXPIRED: "neutral",
  WITHDRAWN: "neutral",
} as const;

export default async function WorkSampleDetailPage({
  params,
}: {
  params: Promise<{ workSampleId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  const canManage = can(user.role, "MANAGE_WORK_SAMPLES");
  const canGrade = can(user.role, "GRADE_WORK_SAMPLES");
  if (!canManage && !canGrade) redirect("/admin");
  const { workSampleId } = await params;

  const sample = await prisma.workSample.findUnique({
    where: { id: workSampleId },
    include: {
      jobProfile: { select: { name: true } },
      criteria: { orderBy: { orderIndex: "asc" } },
      assignments: {
        include: {
          application: {
            include: { candidate: { select: { firstName: true, lastName: true } } },
          },
          grades: { select: { id: true, status: true } },
        },
        orderBy: { assignedAt: "desc" },
      },
    },
  });
  if (!sample) notFound();

  const criteria = toCriterionLike(sample.criteria);
  const problems = validateRubric(criteria);

  // Per-submission grading state, for the table.
  const summaries = new Map<string, Awaited<ReturnType<typeof summarizeGrades>>>();
  for (const a of sample.assignments) {
    if (a.status === "SUBMITTED" || a.status === "GRADED") {
      const grades = await loadGrades(a.id);
      summaries.set(a.id, summarizeGrades(grades, criteria, sample.requiredGraders));
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/work-samples" className="text-sm text-fsw-700 hover:underline">
        ← Work samples
      </Link>
      <div className="mt-3">
        <SectionHeading
          eyebrow={sample.jobProfile?.name ?? "Any role"}
          title={sample.title}
          description={sample.summary ?? undefined}
        />
      </div>

      {canManage && (
        <WorkSampleActions
          workSampleId={sample.id}
          status={sample.status}
          blocked={problems.map((p) =>
            p.criterionName ? `${p.criterionName}: ${p.message}` : p.message,
          )}
        />
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Fact label="Time limit" value={sample.timeLimitMinutes ? `${sample.timeLimitMinutes} min` : "Untimed"} />
        <Fact label="Days to start" value={String(sample.dueInDays)} />
        <Fact label="Graders required" value={String(sample.requiredGraders)} />
        <Fact
          label="Submission"
          value={
            sample.submissionKind === "TEXT"
              ? "Written"
              : sample.submissionKind === "FILE"
                ? "File"
                : "Written + file"
          }
        />
      </div>

      {/* ---- The rubric ---- */}
      <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
        The rubric
      </h3>
      <p className="mt-1 text-sm text-navy-500">
        Written before anyone did the task. Graders see exactly this.
      </p>
      <div className="mt-3 space-y-3">
        {criteria.map((c) => (
          <Card key={c.id} className="p-5">
            <p className="font-semibold text-navy-900">
              {c.name}
              {c.weight !== 1 && (
                <span className="ml-2 text-xs font-normal text-navy-400">
                  weight {c.weight}
                </span>
              )}
            </p>
            {c.description && (
              <p className="text-sm text-navy-500">{c.description}</p>
            )}
            <dl className="mt-3 space-y-1 text-sm">
              {c.anchors
                .slice()
                .sort((a, b) => a.level - b.level)
                .map((a) => (
                  <div key={a.level} className="flex gap-3">
                    <dt className="w-40 shrink-0 font-semibold text-navy-700">
                      {a.level} — {LEVEL_LABEL[a.level]}
                    </dt>
                    <dd className="text-navy-600">{a.text}</dd>
                  </div>
                ))}
            </dl>
          </Card>
        ))}
      </div>

      {/* ---- Submissions ---- */}
      <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
        Sent to
      </h3>
      <Card className="mt-3 overflow-x-auto">
        {sample.assignments.length === 0 ? (
          <p className="p-4 text-sm text-navy-500">
            Not sent to anyone yet. Send it from a candidate&apos;s application.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
              <tr>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Grades</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sample.assignments.map((a) => {
                const summary = summaries.get(a.id);
                return (
                  <tr key={a.id} className="border-b border-navy-50 last:border-0">
                    <td className="px-4 py-3 font-mono text-navy-900">
                      {canGrade && (a.status === "SUBMITTED" || a.status === "GRADED") ? (
                        <Link
                          href={`/admin/work-samples/grade/${a.id}`}
                          className="font-semibold text-fsw-700 hover:underline"
                        >
                          {a.reference}
                        </Link>
                      ) : (
                        a.reference
                      )}
                    </td>
                    <td className="px-4 py-3 text-navy-600">
                      {/* Names appear here, in the pipeline view — never on the
                          grading screen, where the blind is what matters. */}
                      {a.application.candidate.firstName}{" "}
                      {a.application.candidate.lastName}
                    </td>
                    <td className="px-4 py-3 text-navy-600">
                      {a.assignedAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-navy-600">
                      {summary
                        ? `${summary.submittedCount} of ${sample.requiredGraders}`
                        : "—"}
                      {summary?.needsReconciliation && (
                        <Badge tone="amber" className="ml-2">
                          reconcile
                        </Badge>
                      )}
                      {summary?.complete && summary.meanScore !== null && !summary.needsReconciliation && (
                        <span className="ml-2 font-mono text-xs text-navy-500">
                          {summary.meanScore.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[a.status]}>
                        {a.status.toLowerCase()}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <p className="mt-6 rounded-lg bg-navy-50 p-4 text-sm text-navy-700">
        <span className="font-semibold text-navy-900">
          A work-sample score does not decide anything.
        </span>{" "}
        Nothing here moves an application, and no score crosses a threshold
        anywhere in this platform. The grades are evidence for a person to
        weigh against everything else they know.
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
        {label}
      </p>
      <p className="mt-1 font-semibold text-navy-900">{value}</p>
    </Card>
  );
}
