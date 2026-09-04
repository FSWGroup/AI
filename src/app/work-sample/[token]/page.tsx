import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { getCompanyName } from "@/lib/org-settings";
import {
  LinkExpired,
  TokenPageShell,
  noIndexMetadata,
} from "@/components/careers/TokenPage";
import { canStart, remainingSeconds } from "@/lib/worksample/rubric";
import { WorkSampleRunner } from "@/components/careers/WorkSampleRunner";

export const dynamic = "force-dynamic";

export const metadata = noIndexMetadata("Work sample");

export default async function WorkSamplePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [assignment, company] = await Promise.all([
    prisma.workSampleAssignment.findUnique({
      where: { tokenHash: hashToken(token) },
      // The page was found BY the hash; it never needs to hold it. Leaving it
      // on the row puts it in the server component's payload.
      omit: { tokenHash: true },
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
    getCompanyName(),
  ]);

  if (!assignment) {
    return (
      <LinkExpired>
        The link may have already been used, or the task may have been
        withdrawn. Please contact your recruiting contact at {company} and they
        will sort it out.
      </LinkExpired>
    );
  }

  const gate = canStart(assignment);
  const submitted =
    assignment.status === "SUBMITTED" || assignment.status === "GRADED";

  return (
    <TokenPageShell
      company={company}
      title={assignment.workSample.title}
      subtitle={`For ${assignment.application.requisition.title}`}
      wide
    >
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
    </TokenPageShell>
  );
}
