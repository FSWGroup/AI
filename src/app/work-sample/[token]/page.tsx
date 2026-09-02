import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { canStart, remainingSeconds } from "@/lib/worksample/rubric";
import { WorkSampleRunner } from "@/components/careers/WorkSampleRunner";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Work sample",
  robots: { index: false, follow: false },
};

export default async function WorkSamplePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [assignment, settings] = await Promise.all([
    prisma.workSampleAssignment.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        workSample: true,
        application: {
          include: {
            candidate: { select: { firstName: true } },
            requisition: { select: { title: true } },
          },
        },
      },
    }),
    prisma.orgSettings.findUnique({ where: { id: "org" } }),
  ]);
  const company = settings?.companyName ?? "FSW Group";

  if (!assignment) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">
            This link is no longer active
          </h1>
          <p className="mt-3 leading-relaxed text-navy-600">
            The link may have already been used, or the task may have been
            withdrawn. Please contact your recruiting contact at {company} and
            they will sort it out.
          </p>
        </div>
      </main>
    );
  }

  const gate = canStart(assignment);
  const submitted =
    assignment.status === "SUBMITTED" || assignment.status === "GRADED";

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-fsw-600">
        {company}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-navy-900">
        {assignment.workSample.title}
      </h1>
      <p className="mt-1 text-sm text-navy-500">
        For {assignment.application.requisition.title}
      </p>

      {submitted ? (
        <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
          <h2 className="text-lg font-semibold text-navy-900">
            Thank you — this is submitted
          </h2>
          <p className="mt-2 leading-relaxed text-navy-600">
            Your work was received on{" "}
            {assignment.submittedAt?.toLocaleString("en-US", {
              dateStyle: "long",
              timeStyle: "short",
            })}
            . It will be reviewed against a written rubric by more than one
            person, and the reviewers will not see your name while they do it.
          </p>
          <p className="mt-3 text-sm text-navy-500">
            Your recruiting contact will be in touch about next steps. There is
            nothing further for you to do here.
          </p>
        </div>
      ) : !gate.ok ? (
        <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
          <h2 className="text-lg font-semibold text-navy-900">
            This task is closed
          </h2>
          <p className="mt-2 leading-relaxed text-navy-600">{gate.reason}</p>
        </div>
      ) : (
        <WorkSampleRunner
          token={token}
          firstName={assignment.application.candidate.firstName}
          summary={assignment.workSample.summary}
          successCriteria={assignment.workSample.successCriteria}
          instructions={assignment.startedAt ? assignment.workSample.instructions : null}
          submissionKind={assignment.workSample.submissionKind}
          allowedFileTypes={assignment.workSample.allowedFileTypes}
          timeLimitMinutes={assignment.workSample.timeLimitMinutes}
          dueAt={assignment.dueAt.toISOString()}
          started={assignment.startedAt !== null}
          initialRemaining={remainingSeconds(assignment)}
          draftText={assignment.draftText ?? ""}
        />
      )}
    </main>
  );
}
