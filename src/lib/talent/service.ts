/**
 * Talent CRM service.
 *
 * Every write path here passes through the consent gate. The gate is not
 * advisory and there is no "force" parameter anywhere: the point of building
 * it this way is that a recruiter in a hurry cannot route around it.
 */

import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/crypto";
import { createHash } from "crypto";
import { normalizeEmail } from "@/lib/ats/dedupe";
import {
  askState,
  canAppearInSearch,
  canContact,
  CONSENT_REMINDER_DAYS,
  poolExpiryFrom,
  type ConsentStatus,
  type ProfileLike,
} from "./consent";
import { findMatches, type MatchCandidate, type OpeningLike } from "./matching";

/**
 * The suppression key.
 *
 * Normalized first so "A.Cruz+jobs@Gmail.com" and "acruz@gmail.com" are the
 * same person to the do-not-contact list — an opt-out that a plus-address
 * defeats is not an opt-out.
 */
export function suppressionKey(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export async function isSuppressed(email: string): Promise<boolean> {
  const row = await prisma.talentSuppression.findUnique({
    where: { emailHash: suppressionKey(email) },
  });
  return row !== null;
}

async function poolRetentionDays(): Promise<number | null> {
  const policy = await prisma.retentionPolicy.findUnique({
    where: { recordType: "TALENT_POOL_RECORDS" },
  });
  return policy?.retentionDays ?? null;
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

export interface AskResult {
  profileId: string;
  /** The raw token. Exists only in the returned link. */
  token: string;
  url: string;
}

/**
 * Invite a candidate to join the talent pool.
 *
 * Creates the profile if it does not exist — which is why a profile means
 * "we asked", never "they applied". Refuses outright for anyone who has
 * already opted out or is on the suppression list; asking again after
 * somebody has said no is the thing they said no to.
 */
export async function inviteToPool(args: {
  candidateId: string;
  actorId: string;
  baseUrl: string;
}): Promise<AskResult | { error: string }> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: args.candidateId },
    include: { talentProfile: true },
  });
  if (!candidate) return { error: "That candidate does not exist." };

  if (await isSuppressed(candidate.email)) {
    return {
      error:
        "This email address is on the do-not-contact list. Asking again is the thing they asked us not to do.",
    };
  }
  if (candidate.talentProfile?.consentStatus === "OPTED_OUT") {
    return {
      error:
        "This person has already said no. We do not ask twice — they can come back by applying again whenever they like.",
    };
  }
  if (candidate.talentProfile?.consentStatus === "OPTED_IN") {
    return { error: "This person has already agreed to be kept in mind." };
  }

  // An outstanding ask is left alone until it has had time to lapse.
  //
  // Each invite writes a new token hash over the old one, so re-asking
  // silently killed the link already sitting in the candidate's inbox: they
  // clicked what we actually sent them and got a bare "that link is not
  // valid". It also reset `consentAskedAt`, which is what askState() measures
  // from, so a repeatedly re-asked profile could be held at FRESH forever and
  // never lapse.
  const outstanding = candidate.talentProfile;
  if (outstanding && askState(outstanding) === "FRESH") {
    const days = Math.ceil(
      (Date.now() - (outstanding.consentAskedAt?.getTime() ?? 0)) / 86_400_000,
    );
    return {
      error: `We already asked ${days <= 1 ? "today" : `${days} days ago`} and have not heard back. Asking again now would invalidate the link they were sent. The ask can be repeated once it has gone unanswered for ${CONSENT_REMINDER_DAYS} days.`,
    };
  }

  const token = generateToken();
  const profile = await prisma.talentProfile.upsert({
    where: { candidateId: candidate.id },
    create: {
      candidateId: candidate.id,
      consentStatus: "INVITED",
      consentAskedAt: new Date(),
      consentTokenHash: hashToken(token),
      createdById: args.actorId,
    },
    update: {
      consentStatus: "INVITED",
      consentAskedAt: new Date(),
      consentTokenHash: hashToken(token),
    },
  });

  await audit({
    userId: args.actorId,
    action: "talent.consent_requested",
    entityType: "TalentProfile",
    entityId: profile.id,
    newValue: { candidateId: candidate.id },
  });

  return {
    profileId: profile.id,
    token,
    url: `${args.baseUrl.replace(/\/$/, "")}/talent/${token}`,
  };
}

/** Record the candidate's own answer. The only path to OPTED_IN. */
export async function recordConsentDecision(args: {
  token: string;
  decision: "in" | "out";
  interests?: string | null;
}): Promise<{ ok: true; decision: "in" | "out" } | { ok: false; reason: string }> {
  const profile = await prisma.talentProfile.findUnique({
    where: { consentTokenHash: hashToken(args.token) },
    include: { candidate: true },
  });
  if (!profile) return { ok: false, reason: "That link is not valid." };

  const now = new Date();
  if (args.decision === "out") {
    await prisma.$transaction(async (tx) => {
      await tx.talentProfile.update({
        where: { id: profile.id },
        data: {
          consentStatus: "OPTED_OUT",
          consentAt: now,
          consentSource: "email_link",
          consentTokenHash: null,
          expiresAt: null,
        },
      });
      // Membership ends immediately, and the address goes on the permanent
      // list so a later import cannot quietly undo the decision.
      await tx.talentPoolMember.deleteMany({ where: { profileId: profile.id } });
      await tx.talentSuppression.upsert({
        where: { emailHash: suppressionKey(profile.candidate.email) },
        create: { emailHash: suppressionKey(profile.candidate.email) },
        update: {},
      });
    });
    await audit({
      actorLabel: "candidate",
      action: "talent.opted_out",
      entityType: "TalentProfile",
      entityId: profile.id,
    });
    return { ok: true, decision: "out" };
  }

  await prisma.talentProfile.update({
    where: { id: profile.id },
    data: {
      consentStatus: "OPTED_IN",
      consentAt: now,
      consentSource: "email_link",
      consentTokenHash: null,
      expiresAt: poolExpiryFrom(now, await poolRetentionDays()),
      ...(args.interests ? { interests: args.interests.slice(0, 2000) } : {}),
    },
  });
  await audit({
    actorLabel: "candidate",
    action: "talent.opted_in",
    entityType: "TalentProfile",
    entityId: profile.id,
  });
  return { ok: true, decision: "in" };
}

/**
 * Opt someone out on their behalf — they emailed, or phoned, or asked in
 * person. Always available, never gated, and it does the same thing the
 * candidate's own link does.
 */
export async function suppressCandidate(args: {
  candidateId: string;
  actorId: string;
  reason?: string;
}): Promise<void> {
  const candidate = await prisma.candidate.findUniqueOrThrow({
    where: { id: args.candidateId },
  });
  await prisma.$transaction(async (tx) => {
    await tx.talentSuppression.upsert({
      where: { emailHash: suppressionKey(candidate.email) },
      create: {
        emailHash: suppressionKey(candidate.email),
        reason: args.reason ?? "manual",
      },
      update: {},
    });
    const profile = await tx.talentProfile.findUnique({
      where: { candidateId: candidate.id },
    });
    if (profile) {
      await tx.talentProfile.update({
        where: { id: profile.id },
        data: {
          consentStatus: "OPTED_OUT",
          consentAt: new Date(),
          consentSource: args.reason ?? "manual",
          consentTokenHash: null,
          expiresAt: null,
        },
      });
      await tx.talentPoolMember.deleteMany({ where: { profileId: profile.id } });
    }
  });
  await audit({
    userId: args.actorId,
    action: "talent.suppressed",
    entityType: "Candidate",
    entityId: args.candidateId,
    newValue: { reason: args.reason ?? "manual" },
  });
}

// ---------------------------------------------------------------------------
// Pools and outreach
// ---------------------------------------------------------------------------

export async function addToPool(args: {
  poolId: string;
  profileId: string;
  note?: string | null;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const profile = await prisma.talentProfile.findUnique({
    where: { id: args.profileId },
    include: { candidate: true },
  });
  if (!profile) return { ok: false, reason: "That profile does not exist." };
  if (profile.consentStatus !== "OPTED_IN") {
    return {
      ok: false,
      reason:
        "Only people who have agreed to be kept in mind can go into a pool. Ask them first.",
    };
  }
  if (await isSuppressed(profile.candidate.email)) {
    return { ok: false, reason: "That address is on the do-not-contact list." };
  }

  // Checked rather than left to the foreign key: a bad pool id should say so,
  // not surface as a 500 that reads like the server is broken.
  const pool = await prisma.talentPool.findUnique({ where: { id: args.poolId } });
  if (!pool) return { ok: false, reason: "That pool does not exist." };
  if (!pool.active) {
    return { ok: false, reason: `The pool "${pool.name}" is no longer active.` };
  }

  await prisma.talentPoolMember.upsert({
    where: { poolId_profileId: { poolId: args.poolId, profileId: args.profileId } },
    create: {
      poolId: args.poolId,
      profileId: args.profileId,
      note: args.note ?? null,
      addedById: args.actorId,
    },
    update: { note: args.note ?? null },
  });
  return { ok: true };
}

/** Record an approach, after checking that it was allowed to happen. */
export async function recordOutreach(args: {
  profileId: string;
  requisitionId?: string | null;
  channel: string;
  note?: string | null;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const profile = await prisma.talentProfile.findUnique({
    where: { id: args.profileId },
    include: { candidate: true },
  });
  if (!profile) return { ok: false, reason: "That profile does not exist." };

  const gate = canContact(
    profile as unknown as ProfileLike,
    await isSuppressed(profile.candidate.email),
  );
  if (!gate.ok) return { ok: false, reason: gate.reason };

  await prisma.$transaction(async (tx) => {
    await tx.talentOutreach.create({
      data: {
        profileId: args.profileId,
        requisitionId: args.requisitionId ?? null,
        channel: args.channel,
        note: args.note ?? null,
        sentById: args.actorId,
      },
    });
    await tx.talentProfile.update({
      where: { id: args.profileId },
      data: { lastContactedAt: new Date(), contactCount: { increment: 1 } },
    });
  });

  await audit({
    userId: args.actorId,
    action: "talent.outreach_recorded",
    entityType: "TalentProfile",
    entityId: args.profileId,
    newValue: { requisitionId: args.requisitionId ?? null, channel: args.channel },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Search and matching
// ---------------------------------------------------------------------------

export interface TalentSearchFilters {
  query?: string | null;
  tagIds?: string[];
  poolId?: string | null;
  consentStatus?: ConsentStatus | null;
  jobProfileId?: string | null;
}

export async function searchTalent(filters: TalentSearchFilters, take = 100) {
  // People who said no are not in the CRM's search at all. A recruiter should
  // not be able to browse the list of people who declined.
  //
  // Written as an AND rather than as a default, because a default is only a
  // default: the request schema accepted `consentStatus: "OPTED_OUT"` and the
  // filter then replaced the exclusion with a request for exactly the people
  // it exists to hide. The UI never offered the option, but the API is where
  // this is enforced.
  const requestedStatus =
    filters.consentStatus && filters.consentStatus !== "OPTED_OUT"
      ? filters.consentStatus
      : undefined;
  const where: Prisma.TalentProfileWhereInput = {
    consentStatus: requestedStatus ?? { not: "OPTED_OUT" },
    ...(filters.tagIds && filters.tagIds.length > 0
      ? { tags: { some: { tagId: { in: filters.tagIds } } } }
      : {}),
    ...(filters.poolId ? { memberships: { some: { poolId: filters.poolId } } } : {}),
    ...(filters.query
      ? {
          candidate: {
            OR: [
              { firstName: { contains: filters.query, mode: "insensitive" } },
              { lastName: { contains: filters.query, mode: "insensitive" } },
              { email: { contains: filters.query, mode: "insensitive" } },
            ],
          },
        }
      : {}),
    ...(filters.jobProfileId
      ? {
          candidate: {
            applications: {
              some: { requisition: { jobProfileId: filters.jobProfileId } },
            },
          },
        }
      : {}),
  };

  // An explicit select rather than a bare include, because `include` carries
  // every scalar on the row — `consentTokenHash` among them, which went out
  // over the API to anyone who could run a search. It is a SHA-256 of a
  // 256-bit token and so cannot be replayed, but a secret-shaped field with
  // no reason to leave the server should not leave the server.
  const rows = await prisma.talentProfile.findMany({
    where,
    select: {
      id: true,
      candidateId: true,
      consentStatus: true,
      consentAskedAt: true,
      consentAt: true,
      expiresAt: true,
      consentSource: true,
      interests: true,
      summary: true,
      lastContactedAt: true,
      contactCount: true,
      createdAt: true,
      updatedAt: true,
      candidate: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      tags: { include: { tag: true } },
      memberships: { include: { pool: { select: { id: true, name: true } } } },
      _count: { select: { outreach: true } },
    },
    orderBy: { updatedAt: "desc" },
    take,
  });

  // The suppression list, applied to search as well.
  //
  // It is keyed on a hash of the email address precisely so it survives
  // deletion of the profile row — which means a profile recreated for a
  // suppressed address has a clean consentStatus and passes the query. The
  // match path already checked this; search did not.
  const suppressedKeys = new Set(
    (
      await prisma.talentSuppression.findMany({
        where: { emailHash: { in: rows.map((r) => suppressionKey(r.candidate.email)) } },
        select: { emailHash: true },
      })
    ).map((r) => r.emailHash),
  );
  return rows.filter((r) =>
    canAppearInSearch(r, suppressedKeys.has(suppressionKey(r.candidate.email))),
  );
}

/** Past applicants worth another look for a new opening. */
export async function matchesForRequisition(
  requisitionId: string,
  extraTags: string[] = [],
) {
  const requisition = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    select: {
      id: true,
      title: true,
      jobProfileId: true,
      departmentId: true,
    },
  });
  if (!requisition) return [];

  // Narrowed in SQL to the people findMatches could actually surface.
  //
  // This runs on every requisition pipeline page load. Loading every
  // opted-in profile with seven nested relations and then discarding
  // everyone without a shared role type, a shared tag or a late stage —
  // which is what findMatches does first — means materializing hundreds of
  // thousands of rows to keep a few dozen. All four of its entry conditions
  // are expressible as a `where`, so they are expressed as one.
  const LATE_STAGES = ["INTERVIEW", "REFERENCE", "OFFER", "HIRED"];
  const surfaceable: Prisma.TalentProfileWhereInput[] = [
    ...(requisition.jobProfileId
      ? [
          {
            candidate: {
              applications: {
                some: {
                  requisitionId: { not: requisitionId },
                  requisition: { jobProfileId: requisition.jobProfileId },
                },
              },
            },
          },
        ]
      : []),
    ...(extraTags.length > 0
      ? [{ tags: { some: { tag: { label: { in: extraTags } } } } }]
      : []),
    {
      candidate: {
        applications: {
          some: {
            requisitionId: { not: requisitionId },
            stageEvents: { some: { stageKind: { in: LATE_STAGES as never } } },
          },
        },
      },
    },
  ];

  const profiles = await prisma.talentProfile.findMany({
    where: {
      consentStatus: "OPTED_IN",
      expiresAt: { gt: new Date() },
      // findMatches drops current employees outright, so do not load them.
      candidate: { hires: { none: { status: { in: ["ACTIVE", "ON_LEAVE"] } } } },
      OR: surfaceable,
    },
    take: 200,
    include: {
      candidate: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          attempts: { select: { id: true }, take: 1 },
          // The employment record, not the application status: somebody hired
          // in 2024 who has since left is a legitimate person to call.
          hires: { select: { status: true } },
          applications: {
            select: {
              requisitionId: true,
              status: true,
              appliedAt: true,
              requisition: {
                select: { title: true, jobProfileId: true, departmentId: true },
              },
              rejectionReason: { select: { category: true } },
              // The snapshot kind, not the live stage: a renamed or deleted
              // pipeline stage must not rewrite where somebody got to.
              stageEvents: { select: { stageKind: true } },
            },
          },
        },
      },
      tags: { include: { tag: true } },
    },
  });

  // The suppression list is the backstop, checked here as well as at the ask.
  // Scoped to the addresses actually in hand: the table is designed never to
  // shrink, and loading all of it to check a couple of hundred people gets
  // steadily worse forever.
  const suppressed = new Set(
    (
      await prisma.talentSuppression.findMany({
        where: {
          emailHash: { in: profiles.map((p) => suppressionKey(p.candidate.email)) },
        },
        select: { emailHash: true },
      })
    ).map((r) => r.emailHash),
  );

  const candidates: MatchCandidate[] = profiles
    .filter((p) => !suppressed.has(suppressionKey(p.candidate.email)))
    .map((p) => ({
      profileId: p.id,
      candidateId: p.candidate.id,
      name: `${p.candidate.firstName} ${p.candidate.lastName}`,
      tags: p.tags.map((t) => t.tag.label),
      assessed: p.candidate.attempts.length > 0,
      currentlyEmployed: p.candidate.hires.some(
        (h) => h.status === "ACTIVE" || h.status === "ON_LEAVE",
      ),
      formerEmployee: p.candidate.hires.some(
        (h) =>
          h.status === "DEPARTED_VOLUNTARY" || h.status === "DEPARTED_INVOLUNTARY",
      ),
      applications: p.candidate.applications.map((a) => ({
        requisitionId: a.requisitionId,
        requisitionTitle: a.requisition.title,
        jobProfileId: a.requisition.jobProfileId,
        departmentId: a.requisition.departmentId,
        furthestStageKind: furthestStage(a.stageEvents),
        status: a.status,
        rejectionCategory: a.rejectionReason?.category ?? null,
        appliedAt: a.appliedAt,
      })),
    }));

  const opening: OpeningLike = {
    requisitionId: requisition.id,
    title: requisition.title,
    jobProfileId: requisition.jobProfileId,
    departmentId: requisition.departmentId,
    tags: extraTags,
  };
  return findMatches(opening, candidates);
}

const STAGE_ORDER = [
  "APPLIED",
  "SCREEN",
  "ASSESSMENT",
  "WORK_SAMPLE",
  "INTERVIEW",
  "REFERENCE",
  "OFFER",
  "HIRED",
];

function furthestStage(events: { stageKind: string }[]): string {
  let best = "APPLIED";
  for (const e of events) {
    if (STAGE_ORDER.indexOf(e.stageKind) > STAGE_ORDER.indexOf(best)) {
      best = e.stageKind;
    }
  }
  return best;
}
