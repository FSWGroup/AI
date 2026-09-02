import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Card, SectionHeading } from "@/components/ui";
import { summarizeGrades, visibleGrades } from "@/lib/worksample/rubric";
import { loadGrades, toCriterionLike } from "@/lib/worksample/service";
import { WorkSampleGradeForm } from "@/components/admin/WorkSampleGradeForm";
import { GradePanel } from "@/components/admin/GradePanel";

export const dynamic = "force-dynamic";

export default async function GradePage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "GRADE_WORK_SAMPLES")) redirect("/admin");
  const { assignmentId } = await params;

  const assignment = await prisma.workSampleAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      workSample: { include: { criteria: { orderBy: { orderIndex: "asc" } } } },
    },
  });
  if (!assignment) notFound();
  if (assignment.status === "ASSIGNED" || assignment.status === "STARTED") {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-6">
          <p className="text-sm text-navy-600">
            This work sample has not been submitted yet.
          </p>
        </Card>
      </div>
    );
  }

  const criteria = toCriterionLike(assignment.workSample.criteria);
  const grades = await loadGrades(assignmentId);
  const own = grades.find((g) => g.graderId === user.id) ?? null;
  const { visible, hiddenCount } = visibleGrades(grades, user.id, {
    // On this screen the viewer is here to grade, so the blind always
    // applies to them — oversight does not open it early.
    canGrade: true,
    hasOversight: can(user.role, "VIEW_ALL_GRADES"),
  });
  const summary = summarizeGrades(grades, criteria, assignment.workSample.requiredGraders);
  const alreadyFiled = own?.status === "SUBMITTED";

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/work-samples" className="text-sm text-fsw-700 hover:underline">
        ← Work samples
      </Link>
      <div className="mt-3">
        <SectionHeading
          eyebrow={assignment.workSample.title}
          title={assignment.reference}
          description="Graded blind. You are not shown whose work this is, and you will not see another grader's view until you have filed your own."
        />
      </div>

      {/* ---- The submission ---- */}
      <Card className="mt-6 p-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-navy-500">
          The submission
        </h3>
        {assignment.submittedText ? (
          <pre className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-lg bg-navy-50 p-4 font-mono text-sm leading-relaxed text-navy-800">
            {assignment.submittedText}
          </pre>
        ) : (
          <p className="mt-3 text-sm text-navy-500">No written response.</p>
        )}
        {assignment.objectKey && (
          <p className="mt-4 text-sm">
            <a
              href={`/api/admin/work-samples/${assignment.workSampleId}/file?assignmentId=${assignment.id}`}
              className="font-semibold text-fsw-700 hover:underline"
            >
              Download {assignment.fileName}
            </a>
            <span className="ml-2 text-navy-500">
              ({Math.round((assignment.fileSizeBytes ?? 0) / 1024)} KB)
            </span>
          </p>
        )}
        {assignment.startedAt && assignment.submittedAt && (
          <p className="mt-4 text-xs text-navy-500">
            Worked for{" "}
            {Math.round(
              (assignment.submittedAt.getTime() - assignment.startedAt.getTime()) / 60000,
            )}{" "}
            minutes
            {assignment.workSample.timeLimitMinutes
              ? ` of ${assignment.workSample.timeLimitMinutes} allowed`
              : ""}
            .
          </p>
        )}
      </Card>

      {/* ---- Your grade ---- */}
      <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
        {alreadyFiled ? "Your grade" : "Your grade — nobody else can see this yet"}
      </h3>
      <WorkSampleGradeForm
        assignmentId={assignment.id}
        criteria={criteria}
        initial={
          own
            ? {
                comment: own.comment ?? "",
                levels: Object.fromEntries(
                  own.ratings.map((r) => [r.criterionId, r.level]),
                ),
              }
            : null
        }
        alreadyFiled={alreadyFiled}
      />

      {/* ---- The others ---- */}
      {hiddenCount > 0 && (
        <p className="mt-8 rounded-lg bg-navy-50 p-4 text-sm text-navy-700">
          {hiddenCount} other grade{hiddenCount === 1 ? " has" : "s have"} been
          filed on this submission. {hiddenCount === 1 ? "It is" : "They are"}{" "}
          hidden until you file yours — a grade written after reading someone
          else&apos;s is not a second opinion.
        </p>
      )}

      {visible.length > 0 && (
        <div className="mt-8">
          <GradePanel
            grades={visible}
            criteria={criteria}
            summary={summary}
            viewerId={user.id}
          />
        </div>
      )}
    </div>
  );
}
