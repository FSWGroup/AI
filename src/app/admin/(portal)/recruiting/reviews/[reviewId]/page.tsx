import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, SectionHeading } from "@/components/ui";
import { ReviewForm } from "@/components/admin/ReviewForm";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  const { reviewId } = await params;

  const review = await prisma.candidateReview.findUnique({
    where: { id: reviewId },
    include: {
      ratings: true,
      round: {
        include: {
          kit: { include: { competencies: { orderBy: { orderIndex: "asc" } } } },
          application: {
            include: {
              candidate: true,
              requisition: { select: { id: true, title: true } },
              stage: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!review) notFound();

  if (review.reviewerId !== user.id) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="p-8">
          <h1 className="text-lg font-bold text-navy-900">Not your review</h1>
          <p className="mt-2 text-sm leading-relaxed text-navy-600">
            Reviews belong to the person asked for them. Filed reviews appear
            together on the application.
          </p>
          <Link
            href={`/admin/recruiting/applications/${review.round.applicationId}`}
            className="mt-4 inline-block text-sm font-semibold text-fsw-700 hover:underline"
          >
            Open the application →
          </Link>
        </Card>
      </div>
    );
  }

  const criteria = (review.round.kit?.competencies ?? []).map((c) => {
    const existing = review.ratings.find((r) => r.criterionName === c.name);
    return {
      criterionName: c.name,
      definition: c.definition,
      rating: existing?.rating ?? null,
      note: existing?.note ?? null,
    };
  });

  const candidateName = `${review.round.application.candidate.firstName} ${review.round.application.candidate.lastName}`;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/admin/recruiting/applications/${review.round.applicationId}`}
        className="text-sm font-semibold text-fsw-700 hover:underline"
      >
        ← {candidateName}
      </Link>
      <div className="mt-3">
        <SectionHeading
          eyebrow={review.round.application.requisition.title}
          title={review.round.name}
          description={`Your independent review of ${candidateName}${review.round.application.stage ? ` · currently at ${review.round.application.stage.name}` : ""}`}
        />
      </div>
      <div className="mt-6">
        <ReviewForm
          reviewId={review.id}
          candidateName={candidateName}
          applicationId={review.round.applicationId}
          blind={review.round.blind}
          initialCriteria={criteria}
          initialRecommendation={review.recommendation}
          initialSummary={review.summary}
          submitted={review.status === "SUBMITTED"}
        />
      </div>
    </div>
  );
}
