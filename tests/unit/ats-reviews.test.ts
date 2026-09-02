import { describe, it, expect } from "vitest";
import {
  visibleReviews,
  reviewProgress,
  buildConsensus,
  type ReviewLike,
} from "@/lib/ats/reviews";

function review(over: Partial<ReviewLike>): ReviewLike {
  return {
    id: "r1",
    reviewerId: "u1",
    reviewerName: "Ana",
    status: "SUBMITTED",
    recommendation: "YES",
    summary: "Solid examples.",
    submittedAt: new Date(),
    ratings: [],
    ...over,
  };
}

describe("visibleReviews — blind rounds", () => {
  const others = [
    review({ id: "a", reviewerId: "u1", reviewerName: "Ana" }),
    review({ id: "b", reviewerId: "u2", reviewerName: "Ben" }),
  ];

  it("hides other reviews from a reviewer who has not filed", () => {
    const mine = review({ id: "c", reviewerId: "me", status: "DRAFT" });
    const result = visibleReviews({
      reviews: [...others, mine],
      viewerId: "me",
      blind: true,
      canSeeAll: false,
      roundClosed: false,
    });
    expect(result.visible).toHaveLength(0);
    expect(result.hiddenCount).toBe(2);
    expect(result.reason).toContain("anchor");
  });

  it("unlocks every submitted review once the viewer files theirs", () => {
    const mine = review({ id: "c", reviewerId: "me", status: "SUBMITTED" });
    const result = visibleReviews({
      reviews: [...others, mine],
      viewerId: "me",
      blind: true,
      canSeeAll: false,
      roundClosed: false,
    });
    expect(result.visible.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    expect(result.hiddenCount).toBe(0);
  });

  it("lets an oversight reader who is not reviewing see everything", () => {
    const result = visibleReviews({
      reviews: others,
      viewerId: "boss",
      blind: true,
      canSeeAll: true,
      roundClosed: false,
    });
    expect(result.visible).toHaveLength(2);
  });

  it("holds an oversight reader to the blind when they are also a reviewer", () => {
    // Seniority does not exempt anyone. A hiring manager who reads the panel
    // before writing their own is the anchoring the round exists to prevent,
    // and their weight makes it worse rather than better.
    const boss = review({ id: "boss", reviewerId: "boss", status: "DRAFT" });
    const result = visibleReviews({
      reviews: [...others, boss],
      viewerId: "boss",
      blind: true,
      canSeeAll: true,
      roundClosed: false,
    });
    expect(result.visible).toHaveLength(0);
    expect(result.hiddenCount).toBe(2);
    expect(result.reason).toContain("file your own");
  });

  it("opens everything to that same reader once they file", () => {
    const boss = review({ id: "boss", reviewerId: "boss", status: "SUBMITTED" });
    const result = visibleReviews({
      reviews: [...others, boss],
      viewerId: "boss",
      blind: true,
      canSeeAll: true,
      roundClosed: false,
    });
    expect(result.visible).toHaveLength(3);
  });

  it("never shows an unsubmitted draft to anyone, including the boss", () => {
    const result = visibleReviews({
      reviews: [...others, review({ id: "d", reviewerId: "u3", status: "DRAFT" })],
      viewerId: "boss",
      blind: true,
      canSeeAll: true,
      roundClosed: false,
    });
    expect(result.visible.map((r) => r.id)).not.toContain("d");
  });

  it("opens everything once the round is closed", () => {
    const result = visibleReviews({
      reviews: others,
      viewerId: "me",
      blind: true,
      canSeeAll: false,
      roundClosed: true,
    });
    expect(result.visible).toHaveLength(2);
  });

  it("shows everything immediately in a non-blind round", () => {
    const result = visibleReviews({
      reviews: others,
      viewerId: "me",
      blind: false,
      canSeeAll: false,
      roundClosed: false,
    });
    expect(result.visible).toHaveLength(2);
  });

  it("shows a reviewer their own submitted review while others stay hidden", () => {
    const mine = review({ id: "c", reviewerId: "me", status: "SUBMITTED" });
    // Contrived, but proves own-review visibility is not accidental.
    const result = visibleReviews({
      reviews: [mine],
      viewerId: "me",
      blind: true,
      canSeeAll: false,
      roundClosed: false,
    });
    expect(result.visible.map((r) => r.id)).toEqual(["c"]);
  });
});

describe("reviewProgress", () => {
  it("names who is still outstanding", () => {
    const progress = reviewProgress([
      review({ reviewerId: "u1", reviewerName: "Ana" }),
      review({ reviewerId: "u2", reviewerName: "Ben", status: "DRAFT" }),
    ]);
    expect(progress.invited).toBe(2);
    expect(progress.submitted).toBe(1);
    expect(progress.outstanding).toEqual([{ reviewerId: "u2", reviewerName: "Ben" }]);
    expect(progress.complete).toBe(false);
  });

  it("is not complete when nobody was invited", () => {
    expect(reviewProgress([]).complete).toBe(false);
  });
});

describe("buildConsensus", () => {
  it("surfaces a split panel rather than hiding it in an average", () => {
    const consensus = buildConsensus([
      review({
        id: "a",
        reviewerId: "u1",
        reviewerName: "Ana",
        recommendation: "STRONG_YES",
        ratings: [{ criterionName: "Ownership", rating: 4, note: "Ran the migration." }],
      }),
      review({
        id: "b",
        reviewerId: "u2",
        reviewerName: "Ben",
        recommendation: "STRONG_NO",
        ratings: [{ criterionName: "Ownership", rating: 1, note: "Deferred everything." }],
      }),
    ]);
    expect(consensus.split).toBe(true);
    expect(consensus.averageScore).toBe(2.5);
    expect(consensus.spread).toBe(3);
    expect(consensus.criteria[0].split).toBe(true);
    // Both notes survive, attributed — the average alone would lose them.
    expect(consensus.criteria[0].ratings.map((r) => r.reviewerName).sort()).toEqual([
      "Ana",
      "Ben",
    ]);
  });

  it("does not call a unanimous lukewarm panel split", () => {
    const consensus = buildConsensus([
      review({ id: "a", reviewerId: "u1", recommendation: "YES" }),
      review({ id: "b", reviewerId: "u2", recommendation: "YES" }),
    ]);
    expect(consensus.split).toBe(false);
    expect(consensus.spread).toBe(0);
  });

  it("excludes drafts from the consensus entirely", () => {
    const consensus = buildConsensus([
      review({ id: "a", status: "DRAFT", recommendation: "STRONG_YES" }),
    ]);
    expect(consensus.submittedCount).toBe(0);
    expect(consensus.averageScore).toBeNull();
  });

  it("keeps a criterion nobody rated out of the averages", () => {
    const consensus = buildConsensus([
      review({
        id: "a",
        ratings: [{ criterionName: "Judgement", rating: null, note: "Did not assess." }],
      }),
    ]);
    expect(consensus.criteria[0].average).toBeNull();
    expect(consensus.criteria[0].split).toBe(false);
  });
});
