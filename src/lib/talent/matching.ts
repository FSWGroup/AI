/**
 * Matching past applicants to a new opening.
 *
 * This is a SEARCH AID, not a ranking engine. It surfaces people a recruiter
 * would want to look at again and says, in words, why each one appeared. It
 * deliberately does not compute a fit score or order people by one.
 *
 * The reason is not squeamishness. A "match score" over past applicants is an
 * automated assessment of people for employment purposes, and once it exists
 * everyone downstream treats it as a measurement rather than as the crude
 * keyword-and-history heuristic it actually is. Reasons can be read and
 * argued with. A number can only be trusted or ignored.
 *
 * Ordering is by how far the person got in a real process, which is a fact
 * about what humans already decided, not a judgement this module is making.
 */

export interface PastApplication {
  requisitionId: string;
  requisitionTitle: string;
  jobProfileId: string | null;
  departmentId: string | null;
  /** Stage kind reached at its furthest point. */
  furthestStageKind: string;
  status: string;
  rejectionCategory: string | null;
  appliedAt: Date;
}

export interface MatchCandidate {
  profileId: string;
  candidateId: string;
  name: string;
  tags: string[];
  applications: PastApplication[];
  /** Highest band on the assessment's cognitive composite, if assessed. */
  assessed: boolean;
  /**
   * Working here right now. Set from the employment record rather than from
   * an application status: somebody hired in 2024 who has since left is a
   * legitimate person to call, and one who started last month is not.
   */
  currentlyEmployed: boolean;
  /** Hired here before and no longer employed. A useful thing to know. */
  formerEmployee: boolean;
}

export interface OpeningLike {
  requisitionId: string;
  title: string;
  jobProfileId: string | null;
  departmentId: string | null;
  /** Tags the recruiter attached to the search. */
  tags: string[];
}

export interface MatchReason {
  kind:
    | "SAME_ROLE_TYPE"
    | "SAME_DEPARTMENT"
    | "REACHED_LATE_STAGE"
    | "SHARED_TAGS"
    | "ALREADY_ASSESSED"
    | "PASSED_OVER_FOR_ANOTHER"
    | "FORMER_EMPLOYEE";
  text: string;
}

export interface Match {
  profileId: string;
  candidateId: string;
  name: string;
  reasons: MatchReason[];
  /** How far they got, for ordering. Not shown as a score. */
  furthestStageRank: number;
  lastAppliedAt: Date;
  matchedTags: string[];
}

/**
 * How far through a process someone got. Used only for ordering — the person
 * who reached a final interview is the one to look at first, because a panel
 * of humans already decided they were worth that much time.
 */
const STAGE_RANK: Record<string, number> = {
  APPLIED: 0,
  SCREEN: 1,
  ASSESSMENT: 2,
  WORK_SAMPLE: 3,
  INTERVIEW: 4,
  REFERENCE: 5,
  OFFER: 6,
  HIRED: 7,
};

/** The stage from which someone counts as a near miss rather than a rejection. */
export const LATE_STAGE_RANK = STAGE_RANK.INTERVIEW;

export function stageRank(kind: string): number {
  return STAGE_RANK[kind] ?? 0;
}

export function findMatches(
  opening: OpeningLike,
  candidates: MatchCandidate[],
): Match[] {
  const wantedTags = new Set(opening.tags.map((t) => t.toLowerCase()));
  const matches: Match[] = [];

  for (const c of candidates) {
    // Never surface somebody who already works here.
    //
    // Worth stating why this is not a nicety: HIRED is the HIGHEST stage rank,
    // so without this check a current employee sorts to the very top of the
    // list and is the first person a recruiter is told to call back about a
    // job they already have.
    if (c.currentlyEmployed) continue;

    // Never resurface someone for the requisition they are currently in.
    const relevant = c.applications.filter(
      (a) => a.requisitionId !== opening.requisitionId,
    );
    if (relevant.length === 0) continue;

    const reasons: MatchReason[] = [];

    if (c.formerEmployee) {
      reasons.push({
        kind: "FORMER_EMPLOYEE",
        text: "Has worked here before and left. Check with their old manager before approaching them.",
      });
    }

    const sameProfile = relevant.filter(
      (a) => opening.jobProfileId && a.jobProfileId === opening.jobProfileId,
    );
    if (sameProfile.length > 0) {
      reasons.push({
        kind: "SAME_ROLE_TYPE",
        text: `Applied for the same kind of role before (${sameProfile[0].requisitionTitle}).`,
      });
    }

    const sameDept = relevant.filter(
      (a) => opening.departmentId && a.departmentId === opening.departmentId,
    );
    if (sameDept.length > 0 && sameProfile.length === 0) {
      reasons.push({
        kind: "SAME_DEPARTMENT",
        text: `Has been through a process in the same department (${sameDept[0].requisitionTitle}).`,
      });
    }

    const furthest = relevant.reduce(
      (best, a) => (stageRank(a.furthestStageKind) > stageRank(best.furthestStageKind) ? a : best),
      relevant[0],
    );
    const rank = stageRank(furthest.furthestStageKind);
    if (rank >= LATE_STAGE_RANK) {
      reasons.push({
        kind: "REACHED_LATE_STAGE",
        text: `Reached ${furthest.furthestStageKind.replace("_", " ").toLowerCase()} on ${furthest.requisitionTitle} — a panel already spent real time on them.`,
      });
    }

    // "We liked them, someone else was slightly better" is the single most
    // useful signal in a talent pool, and it is a fact recorded at the time.
    const passedOver = relevant.some(
      (a) => a.status === "REJECTED" && a.rejectionCategory === "PROCESS",
    );
    if (passedOver && rank >= LATE_STAGE_RANK) {
      reasons.push({
        kind: "PASSED_OVER_FOR_ANOTHER",
        text: "Turned down for process reasons rather than for qualifications — usually means someone else got there first.",
      });
    }

    const matchedTags = c.tags.filter((t) => wantedTags.has(t.toLowerCase()));
    if (matchedTags.length > 0) {
      reasons.push({
        kind: "SHARED_TAGS",
        text: `Tagged ${matchedTags.join(", ")}.`,
      });
    }

    if (c.assessed) {
      reasons.push({
        kind: "ALREADY_ASSESSED",
        text: "Already completed the assessment, so their results are on file.",
      });
    }

    // A shared tag or a shared role type is the minimum to surface at all.
    // "Applied here once" is not a reason to contact anybody.
    const substantive = reasons.some(
      (r) =>
        r.kind === "SAME_ROLE_TYPE" ||
        r.kind === "SHARED_TAGS" ||
        r.kind === "REACHED_LATE_STAGE",
    );
    if (!substantive) continue;

    matches.push({
      profileId: c.profileId,
      candidateId: c.candidateId,
      name: c.name,
      reasons,
      furthestStageRank: rank,
      lastAppliedAt: relevant.reduce(
        (latest, a) => (a.appliedAt > latest ? a.appliedAt : latest),
        relevant[0].appliedAt,
      ),
      matchedTags,
    });
  }

  // Furthest stage reached first, then most recent. Both are facts about what
  // already happened rather than predictions about what will.
  matches.sort((a, b) => {
    if (b.furthestStageRank !== a.furthestStageRank) {
      return b.furthestStageRank - a.furthestStageRank;
    }
    return b.lastAppliedAt.getTime() - a.lastAppliedAt.getTime();
  });
  return matches;
}
