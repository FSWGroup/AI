import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Card, SectionHeading } from "@/components/ui";
import { pendingReviewsFor } from "@/lib/validation/service";
import { PerformanceReviewForm } from "@/components/admin/PerformanceReviewForm";
import { CRITERION_BY_KEY } from "@/content/performance-criteria";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "SUBMIT_PERFORMANCE_REVIEW")) redirect("/admin");

  // The cycles come back from pendingReviewsFor, which already loaded them —
  // fetching them again by id was a round trip for rows we were handed.
  const [{ pending, cycles }, drafts] = await Promise.all([
    pendingReviewsFor(user.id),
    prisma.performanceReview.findMany({
      where: { raterId: user.id, status: "DRAFT" },
      include: { ratings: true },
    }),
  ]);
  const cycleById = new Map(cycles.map((c) => [c.id, c]));
  const draftByKey = new Map(drafts.map((d) => [`${d.hireId}::${d.cycleId}`, d]));

  const outstanding = pending.filter((p) => p.status !== "SUBMITTED");
  const done = pending.filter((p) => p.status === "SUBMITTED");
  // A manager who has been here a while has hundreds of these. The list is a
  // reassurance that the work landed, not a record to browse.
  const RECENT_DONE = 10;
  const recentlyDone = done.slice(-RECENT_DONE).reverse();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/validation" className="text-sm text-fsw-700 hover:underline">
        ← Validation
      </Link>
      <div className="mt-3">
        <SectionHeading
          eyebrow="Performance reviews"
          title="Your review queue"
          description="Rate the work, not the person and not their test result. These ratings are the outcome measure every validity study rests on — a rating filled in carelessly does not just misjudge one person, it corrupts the evidence for everyone."
        />
      </div>

      {outstanding.length === 0 && (
        <Card className="mt-6 p-6">
          <p className="text-sm text-navy-600">
            Nothing is due from you right now. Reviews appear here as the people
            you manage reach each cycle&apos;s tenure mark.
          </p>
        </Card>
      )}

      <div className="mt-6 space-y-5">
        {outstanding.map((p) => {
          const cycle = cycleById.get(p.cycleId);
          if (!cycle) return null;
          const draft = draftByKey.get(`${p.hireId}::${p.cycleId}`);
          return (
            <PerformanceReviewForm
              key={`${p.hireId}-${p.cycleId}`}
              hireId={p.hireId}
              cycleId={p.cycleId}
              candidateName={p.candidateName}
              jobTitle={p.jobTitle}
              hiredAt={p.hiredAt.toISOString().slice(0, 10)}
              cycleName={p.cycleName}
              instructions={cycle.instructions}
              criteria={cycle.criterionKeys
                .map((k: string) => CRITERION_BY_KEY.get(k))
                .filter((c): c is NonNullable<typeof c> => c !== undefined)}
              initial={
                draft
                  ? {
                      overallRating: draft.overallRating,
                      wouldRehire: draft.wouldRehire,
                      comment: draft.comment,
                      ratings: Object.fromEntries(
                        draft.ratings.map((r) => [r.criterionKey, r.value]),
                      ),
                    }
                  : null
              }
            />
          );
        })}
      </div>

      {done.length > 0 && (
        <>
          <h3 className="mt-8 text-sm font-bold uppercase tracking-wide text-navy-500">
            Already submitted ({done.length})
          </h3>
          <Card className="mt-3 p-4">
            <ul className="space-y-1 text-sm text-navy-600">
              {recentlyDone.map((p) => (
                <li key={`${p.hireId}-${p.cycleId}`}>
                  {p.candidateName} — {p.cycleName}
                </li>
              ))}
            </ul>
            {done.length > RECENT_DONE && (
              <p className="mt-2 text-sm text-navy-500">
                and {done.length - RECENT_DONE} more.
              </p>
            )}
            <p className="mt-3 text-xs text-navy-500">
              Submitted ratings cannot be edited. A criterion you can revise
              after seeing the study is not a criterion.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
