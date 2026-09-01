import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { SectionHeading, Card } from "@/components/ui";
import { ScorecardForm } from "@/components/admin/ScorecardForm";

export const dynamic = "force-dynamic";

export default async function ScorecardPage({
  params,
}: {
  params: Promise<{ scorecardId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  const { scorecardId } = await params;

  const scorecard = await prisma.scorecard.findUnique({
    where: { id: scorecardId },
    include: {
      ratings: { orderBy: { competencyName: "asc" } },
      application: {
        include: {
          candidate: true,
          requisition: { select: { id: true, title: true } },
        },
      },
      interview: {
        include: {
          kit: {
            include: {
              competencies: { orderBy: { orderIndex: "asc" } },
              questions: { orderBy: { orderIndex: "asc" } },
            },
          },
        },
      },
    },
  });
  if (!scorecard) notFound();

  // A scorecard is personal to its author. Reading someone else's before
  // writing your own is exactly the contamination this process avoids.
  if (scorecard.authorId !== user.id) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="p-8">
          <h1 className="text-lg font-bold text-navy-900">Not your scorecard</h1>
          <p className="mt-2 text-sm leading-relaxed text-navy-600">
            Scorecards belong to the interviewer who wrote them. Submitted ones
            appear together on the application once everyone has filed theirs.
          </p>
          <Link
            href={`/admin/recruiting/applications/${scorecard.applicationId}`}
            className="mt-4 inline-block text-sm font-semibold text-fsw-700 hover:underline"
          >
            Open the application →
          </Link>
        </Card>
      </div>
    );
  }

  const kitCompetencies = scorecard.interview?.kit?.competencies ?? [];
  const competencies = (
    kitCompetencies.length > 0
      ? kitCompetencies.map((c) => ({
          competencyName: c.name,
          definition: c.definition,
        }))
      : scorecard.ratings.map((r) => ({
          competencyName: r.competencyName,
          definition: null,
        }))
  ).map((c) => {
    const existing = scorecard.ratings.find(
      (r) => r.competencyName === c.competencyName,
    );
    return {
      competencyName: c.competencyName,
      definition: c.definition,
      rating: existing?.rating ?? null,
      note: existing?.note ?? null,
    };
  });

  const candidateName = `${scorecard.application.candidate.firstName} ${scorecard.application.candidate.lastName}`;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/admin/recruiting/applications/${scorecard.applicationId}`}
        className="text-sm font-semibold text-fsw-700 hover:underline"
      >
        ← {candidateName}
      </Link>
      <div className="mt-3">
        <SectionHeading
          eyebrow={scorecard.application.requisition.title}
          title="Interview scorecard"
          description={
            scorecard.interview
              ? `${scorecard.interview.title} · ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(scorecard.interview.scheduledAt)}`
              : "Standalone scorecard"
          }
        />
      </div>
      <div className="mt-6">
        <ScorecardForm
          scorecardId={scorecard.id}
          candidateName={candidateName}
          interviewTitle={scorecard.interview?.title ?? null}
          questions={(scorecard.interview?.kit?.questions ?? []).map((q) => ({
            question: q.question,
            listenFor: q.listenFor,
          }))}
          initialCompetencies={competencies}
          initialRecommendation={scorecard.recommendation}
          initialSummary={scorecard.summary}
          submitted={scorecard.status === "SUBMITTED"}
        />
      </div>
    </div>
  );
}
