/**
 * Validation service: the database side of the study engine.
 *
 * The pure modules next to this one do the statistics. This one loads the
 * rows, writes the results, and enforces the one rule that matters
 * operationally: a norm table only starts banding people when a human
 * activates it, having seen how many existing candidates would change band.
 */

import "server-only";
import type { Construct, PerformanceCycle, Prisma, ValidationStudy } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dimensionMeta } from "@/content/narratives/dimension-meta";
import {
  buildCriterion,
  type CriterionSpec,
  type HireRow,
  type MetricRow,
  type ReviewRow,
} from "./criterion";
import { computeStudy, type PredictorSeries, type StudyResult } from "./study";
import { buildNormTable, bandShiftPreview, type BuiltNormTable } from "./norms";
import { MIN_N_NORM_ACTIVE, normGate } from "./gates";

const CONSTRUCT_NAME = new Map(dimensionMeta.map((d) => [d.construct, d.name]));

export function constructLabel(construct: string): string {
  return CONSTRUCT_NAME.get(construct as Construct) ?? construct.replaceAll("_", " ");
}

/**
 * Response-quality indicators are not job-fit dimensions. They never enter a
 * validity study as predictors, and they are never normed.
 *
 * Norming them would be worse than useless. A stanine says "this person is
 * higher than 77% of the reference group"; applied to Distortion that reads as
 * a trait comparison — "distorts more than most applicants" — when the band is
 * only ever a flag on how to read the rest of the profile. The provisional
 * conversion is the honest one for these two, permanently.
 */
const RESPONSE_QUALITY: Construct[] = ["DISTORTION", "EQUIVOCATION"];

/** Dimensions a study or a norm table may cover. */
const NORMABLE_CONSTRUCTS = dimensionMeta
  .map((d) => d.construct)
  .filter((c) => !RESPONSE_QUALITY.includes(c));

export const NORMABLE_DIMENSION_COUNT = NORMABLE_CONSTRUCTS.length;

// ---------------------------------------------------------------------------
// Hires
// ---------------------------------------------------------------------------

/**
 * Record a hire from an accepted offer.
 *
 * Called when an offer is accepted, and safe to call twice — the offer's
 * one-to-one link makes a second call a no-op rather than a duplicate
 * employment record.
 *
 * The attempt is resolved once, here, and frozen. If the person is later
 * reassessed, the study still reports on the scores that were in front of
 * the people who decided to hire them, which is the only version of the
 * question that means anything.
 */
export async function recordHireFromOffer(
  offerId: string,
  actorId?: string | null,
): Promise<string | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      hire: true,
      application: {
        include: {
          candidate: {
            include: {
              attempts: {
                where: { status: "COMPLETED", scores: { some: {} } },
                orderBy: { completedAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
      requisition: {
        include: {
          team: { where: { role: "HIRING_MANAGER" }, take: 1 },
        },
      },
    },
  });
  if (!offer || offer.status !== "ACCEPTED") return null;
  if (offer.hire) return offer.hire.id;

  const attempt = offer.application.candidate.attempts[0] ?? null;
  // An attempt already tied to another hire would break the one-to-one link;
  // a rehire keeps their employment record separate and unscored rather than
  // stealing the attempt from the first one.
  const attemptTaken = attempt
    ? await prisma.hire.findUnique({ where: { attemptId: attempt.id } })
    : null;

  const hire = await prisma.hire.create({
    data: {
      candidateId: offer.application.candidateId,
      applicationId: offer.applicationId,
      offerId: offer.id,
      attemptId: attemptTaken ? null : (attempt?.id ?? null),
      jobProfileId: offer.requisition.jobProfileId,
      requisitionId: offer.requisitionId,
      jobTitle: offer.jobTitle,
      departmentId: offer.requisition.departmentId,
      locationId: offer.requisition.locationId,
      managerId: offer.requisition.team[0]?.userId ?? null,
      hiredAt: offer.startDate ?? offer.respondedAt ?? new Date(),
      createdById: actorId ?? null,
    },
  });

  await audit({
    userId: actorId ?? null,
    action: "hire.recorded",
    entityType: "Hire",
    entityId: hire.id,
    newValue: {
      offerId: offer.id,
      attemptId: hire.attemptId,
      jobTitle: hire.jobTitle,
    },
  });
  return hire.id;
}

// ---------------------------------------------------------------------------
// Study execution
// ---------------------------------------------------------------------------

function specFor(study: ValidationStudy): CriterionSpec {
  return {
    kind: study.criterionKind,
    keys: study.criterionKeys,
    cycleKinds: study.cycleKinds,
    retentionDays: study.retentionDays ?? undefined,
  };
}

/**
 * Compute one study without writing anything.
 *
 * Split out from `runStudy` so a reader can have fresh numbers without also
 * having a write. The technical report needs the first — a document quoting
 * figures older than its own date is the kind that gets a study thrown out —
 * and must not perform the second: it is served from a GET, held by a
 * read-only permission, and was rewriting every stored coefficient and
 * restamping the study's author as whoever last downloaded a PDF.
 */
export async function computeStudyResult(studyId: string): Promise<StudyResult> {
  const study = await prisma.validationStudy.findUniqueOrThrow({
    where: { id: studyId },
  });

  const hires = await prisma.hire.findMany({
    where: {
      ...(study.jobProfileId ? { jobProfileId: study.jobProfileId } : {}),
      ...(study.hiredFrom || study.hiredTo
        ? {
            hiredAt: {
              ...(study.hiredFrom ? { gte: study.hiredFrom } : {}),
              ...(study.hiredTo ? { lte: study.hiredTo } : {}),
            },
          }
        : {}),
      attemptId: { not: null },
      // An invalidated attempt is one an administrator has already said is not
      // to be relied on — a technical failure, an integrity concern, an
      // accommodation that went wrong. Those are precisely the scores that
      // must not enter a validity study.
      attempt: { status: { not: "INVALIDATED" } },
    },
    include: {
      attempt: {
        include: {
          scores: true,
          compositeScores: true,
        },
      },
      reviews: {
        where: { status: "SUBMITTED" },
        include: { ratings: true, cycle: true },
      },
      metrics: true,
    },
  });

  // No sample, no study.
  //
  // The applicant-pool query below is scoped by the form versions and job
  // profile the SAMPLE used — and with no hires those scopes collapse to
  // nothing, leaving a bare "every non-invalidated score ever" that loads the
  // entire Score table to produce n = 0. Measured at 19,594 rows and 233 ms
  // warm on a small fixture, against a result that is empty by definition.
  if (hires.length === 0) {
    return computeStudy(
      buildCriterion(specFor(study), { hires: [], reviews: [], metrics: [] }),
      [],
      {
        correctRangeRestriction: study.correctRangeRestriction,
        correctAttenuation: study.correctAttenuation,
        confidence: 0.95,
      },
      [
        "No hire matches this study's job profile and date window, so there is nothing to correlate. Widen the window, or check that hires are being linked to their assessment attempts.",
      ],
    );
  }

  const hireRows: HireRow[] = hires.map((h) => ({
    hireId: h.id,
    hiredAt: h.hiredAt,
    status: h.status,
    endedAt: h.endedAt,
  }));

  const reviewRows: ReviewRow[] = hires.flatMap((h) =>
    h.reviews
      .filter((r) => r.submittedAt !== null)
      .map((r) => ({
        hireId: h.id,
        cycleId: r.cycleId,
        cycleKind: r.cycle.kind,
        raterId: r.raterId,
        overallRating: r.overallRating,
        wouldRehire: r.wouldRehire,
        submittedAt: r.submittedAt as Date,
        ratings: r.ratings.map((x) => ({ criterionKey: x.criterionKey, value: x.value })),
      })),
  );

  const metricRows: MetricRow[] = hires.flatMap((h) =>
    h.metrics.map((m) => ({
      hireId: h.id,
      key: m.key,
      value: m.value,
      higherIsBetter: m.higherIsBetter,
      periodEnd: m.periodEnd,
    })),
  );

  const criterion = buildCriterion(specFor(study), {
    hires: hireRows,
    reviews: reviewRows,
    metrics: metricRows,
  });

  // ---- Predictors ----------------------------------------------------------
  // Raw scores throughout: they are the actual measurement, and they are what
  // norm tables are keyed on. The 0-100 scaled score is a within-construct
  // transform of the same information.
  const constructs = NORMABLE_CONSTRUCTS;

  // The unrestricted comparison group is every applicant assessed on the same
  // footing as this sample: same job profile when the study is scoped to one,
  // and the same form versions the hires actually sat. Pooling scores across
  // roles and form versions would produce a spread that reflects the mixture
  // rather than the applicant population, and the range-restriction ratio
  // computed from it would be an artefact.
  const sampleVersionIds = [
    ...new Set(hires.map((h) => h.attempt?.assessmentVersionId).filter((v): v is string => !!v)),
  ];
  const applicantWhere: Prisma.ScoreWhereInput = {
    attempt: {
      // Excluded here too: an invalidated attempt would otherwise widen the
      // applicant-pool spread and inflate every range-restriction correction.
      status: { not: "INVALIDATED" },
      ...(sampleVersionIds.length > 0
        ? { assessmentVersionId: { in: sampleVersionIds } }
        : {}),
      ...(study.jobProfileId
        ? { jobOpening: { jobProfileId: study.jobProfileId } }
        : {}),
    },
  };
  const allScores = await prisma.score.findMany({
    where: applicantWhere,
    select: { construct: true, rawScore: true },
  });
  const applicantRaw = new Map<Construct, number[]>();
  for (const row of allScores) {
    const list = applicantRaw.get(row.construct);
    if (list) list.push(row.rawScore);
    else applicantRaw.set(row.construct, [row.rawScore]);
  }

  const predictors: PredictorSeries[] = constructs.map((construct) => {
    const hireValues = new Map<string, number>();
    for (const h of hires) {
      const score = h.attempt?.scores.find((s) => s.construct === construct);
      if (score) hireValues.set(h.id, score.rawScore);
    }
    return {
      key: construct,
      label: constructLabel(construct),
      construct,
      hireValues,
      applicantValues: applicantRaw.get(construct) ?? [],
    };
  });

  // Composites, where the sample has them. A composite is a weighted band
  // combination, so it gets studied on exactly the same footing.
  const compositeKeys = new Set<string>();
  for (const h of hires) {
    for (const c of h.attempt?.compositeScores ?? []) compositeKeys.add(c.key);
  }
  if (compositeKeys.size > 0) {
    const allComposites = await prisma.compositeScore.findMany({
      where: {
        key: { in: [...compositeKeys] },
        attempt: applicantWhere.attempt as Prisma.AttemptWhereInput,
      },
      select: { key: true, value: true },
    });
    const applicantComposite = new Map<string, number[]>();
    for (const row of allComposites) {
      const list = applicantComposite.get(row.key);
      if (list) list.push(row.value);
      else applicantComposite.set(row.key, [row.value]);
    }
    for (const key of [...compositeKeys].sort()) {
      const hireValues = new Map<string, number>();
      let label = key;
      for (const h of hires) {
        const c = h.attempt?.compositeScores.find((x) => x.key === key);
        if (c) {
          hireValues.set(h.id, c.value);
          label = c.name;
        }
      }
      predictors.push({
        key,
        label,
        compositeKey: key,
        hireValues,
        applicantValues: applicantComposite.get(key) ?? [],
      });
    }
  }

  // ---- Warnings the pure layer cannot see ------------------------------------
  const warnings: string[] = [];
  if (sampleVersionIds.length > 1) {
    warnings.push(
      `This sample spans ${sampleVersionIds.length} assessment form versions. Raw scores from different forms are not automatically on the same scale, so a coefficient computed across them assumes the forms are equivalent. Confirm that before quoting these numbers, or split the study by version.`,
    );
  }
  const invalidated = await prisma.hire.count({
    where: {
      ...(study.jobProfileId ? { jobProfileId: study.jobProfileId } : {}),
      attempt: { status: "INVALIDATED" },
    },
  });
  if (invalidated > 0) {
    warnings.push(
      `${invalidated} hires in scope are excluded because their assessment attempt was invalidated. That is deliberate — an attempt somebody marked unreliable should not become evidence — but it is worth checking why that many were invalidated before relying on what is left.`,
    );
  }

  const withoutAttempt = await prisma.hire.count({
    where: {
      ...(study.jobProfileId ? { jobProfileId: study.jobProfileId } : {}),
      attemptId: null,
    },
  });
  if (withoutAttempt > 0) {
    warnings.push(
      `${withoutAttempt} hires in scope have no assessment attempt linked and are not in this study. If those were hired without taking the assessment, the study describes only the people who took it — which is the right sample, but worth stating in the report.`,
    );
  }

  const result = computeStudy(
    criterion,
    predictors,
    {
      correctRangeRestriction: study.correctRangeRestriction,
      correctAttenuation: study.correctAttenuation,
      confidence: 0.95,
    },
    warnings,
  );

  return result;
}

/**
 * Load, compute and persist one study.
 *
 * Recomputing is normal and expected: the same study run three months later
 * has more hires and more reviews behind it. The row is overwritten and the
 * date stamped, so a technical report always says when its numbers were
 * produced.
 */
export async function runStudy(
  studyId: string,
  actorId?: string | null,
): Promise<StudyResult> {
  const result = await computeStudyResult(studyId);
  const hiresInScope = result.n;

  await prisma.$transaction(async (tx) => {
    await tx.validityCoefficient.deleteMany({ where: { studyId } });
    const rows: Prisma.ValidityCoefficientCreateManyInput[] = result.coefficients
      .filter((c) => Number.isFinite(c.r))
      .map((c) => ({
        studyId,
        construct: c.construct ?? null,
        compositeKey: c.compositeKey ?? null,
        label: c.label,
        n: c.n,
        r: c.r,
        ciLow: c.ciLow,
        ciHigh: c.ciHigh,
        pValue: c.pValue,
        qValue: c.qValue,
        rRangeCorrected: c.rRangeCorrected,
        rFullyCorrected: c.rFullyCorrected,
        sdRestricted: c.sdRestricted,
        sdUnrestricted: c.sdUnrestricted,
        predictorMean: c.predictorMean,
        verdict: c.verdict,
      }));
    if (rows.length > 0) await tx.validityCoefficient.createMany({ data: rows });

    await tx.validationStudy.update({
      where: { id: studyId },
      data: {
        status: "COMPUTED",
        computedAt: new Date(),
        computedById: actorId ?? null,
        summary: {
          n: result.n,
          criterionDescription: result.criterionDescription,
          criterionDichotomous: result.criterionDichotomous,
          reliabilityUsed: result.reliabilityUsed,
          criterionReliability: result.criterionReliability
            ? {
                icc1: result.criterionReliability.icc1,
                iccK: result.criterionReliability.iccK,
                targets: result.criterionReliability.targets,
                meanRaters: result.criterionReliability.meanRaters,
                clampedToZero: result.criterionReliability.clampedToZero,
              }
            : null,
          warnings: result.warnings,
          excludedCount: result.excluded.length,
          uncomputable: result.coefficients
            .filter((c) => !Number.isFinite(c.r))
            .map((c) => ({ label: c.label, notes: c.notes })),
          notesByPredictor: Object.fromEntries(
            result.coefficients
              .filter((c) => c.notes.length > 0)
              .map((c) => [c.key, c.notes]),
          ),
          hiresInScope,
        } as Prisma.InputJsonValue,
      },
    });
  });

  await audit({
    userId: actorId ?? null,
    action: "validation_study.computed",
    entityType: "ValidationStudy",
    entityId: studyId,
    newValue: { n: result.n, supported: result.anySupported },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Norm tables
// ---------------------------------------------------------------------------

export type NormPopulation = "APPLICANTS" | "HIRES";

export interface NormPreview {
  construct: Construct;
  label: string;
  table: BuiltNormTable | null;
  sampleSize: number;
  /** How many of those cases were fabricated by a demo fixture. */
  syntheticSampleSize: number;
  /** How the current population would redistribute across the new bands. */
  shift: ReturnType<typeof bandShiftPreview> | null;
  reason?: string;
}

/**
 * What a norm table for each construct would look like, and what activating
 * it would do to the people already scored.
 */
export async function previewNormTables(args: {
  population: NormPopulation;
  jobProfileId?: string | null;
}): Promise<NormPreview[]> {
  const constructs = NORMABLE_CONSTRUCTS;
  const where: Prisma.ScoreWhereInput = {
    attempt: {
      // An invalidated attempt must never sit in a norming sample. A norm
      // table IS the reference group, so a score somebody already marked
      // unreliable would shift the band boundaries for everyone measured
      // against it afterwards.
      status: { not: "INVALIDATED" },
      ...(args.population === "HIRES" ? { hire: { isNot: null } } : {}),
      ...(args.population !== "HIRES" && args.jobProfileId
        ? { jobOpening: { jobProfileId: args.jobProfileId } }
        : {}),
    },
  };

  // One query for every construct rather than one per construct: sixteen
  // round trips to build a page that shows sixteen rows of the same table.
  const allRows = await prisma.score.findMany({
    where,
    select: {
      construct: true,
      rawScore: true,
      band: true,
      // Counted, not filtered. A demo fixture is loaded precisely so the
      // norming screens have something to show, so the sample is allowed to
      // contain it — but the resulting table has to carry the fact, because
      // activation is what turns a reference group into the thing real
      // candidates are measured against.
      attempt: { select: { candidate: { select: { synthetic: true } } } },
    },
  });
  const byConstruct = new Map<
    Construct,
    { rawScore: number; band: number; synthetic: boolean }[]
  >();
  for (const row of allRows) {
    const entry = {
      rawScore: row.rawScore,
      band: row.band,
      synthetic: row.attempt.candidate.synthetic,
    };
    const list = byConstruct.get(row.construct);
    if (list) list.push(entry);
    else byConstruct.set(row.construct, [entry]);
  }

  const previews: NormPreview[] = [];
  for (const construct of constructs) {
    const rows = byConstruct.get(construct) ?? [];
    const table = buildNormTable(rows.map((r) => r.rawScore));
    previews.push({
      construct,
      label: constructLabel(construct),
      table,
      sampleSize: rows.length,
      syntheticSampleSize: rows.filter((r) => r.synthetic).length,
      shift: table ? bandShiftPreview(table, rows) : null,
      reason: table
        ? undefined
        : `${rows.length} scored attempts — not enough to build a table.`,
    });
  }
  return previews;
}

/**
 * Create norm tables from a population.
 *
 * Tables are created as DRAFT without exception, whatever the sample size.
 * Activation is a separate, deliberate act, because the moment a table goes
 * active every subsequent report changes what its numbers mean.
 */
export async function generateNormTables(args: {
  population: NormPopulation;
  jobProfileId?: string | null;
  studyId?: string | null;
  constructs?: Construct[];
  actorId?: string | null;
}): Promise<{ created: number; skipped: { construct: string; reason: string }[] }> {
  const previews = await previewNormTables({
    population: args.population,
    jobProfileId: args.jobProfileId,
  });
  const wanted = args.constructs ? new Set(args.constructs) : null;

  let created = 0;
  const skipped: { construct: string; reason: string }[] = [];
  const populationLabel =
    args.population === "HIRES"
      ? "Employees hired through this platform"
      : args.jobProfileId
        ? "Applicants assessed for this job profile"
        : "All assessed applicants";

  for (const preview of previews) {
    if (wanted && !wanted.has(preview.construct)) continue;
    if (!preview.table) {
      skipped.push({
        construct: preview.construct,
        reason: preview.reason ?? "Not enough data.",
      });
      continue;
    }
    await prisma.normTable.create({
      data: {
        construct: preview.construct,
        population: populationLabel,
        effectiveDate: new Date(),
        sampleSize: preview.table.sampleSize,
        syntheticSampleSize: preview.syntheticSampleSize,
        methodology: [
          "Stanine cut points placed at the observed percentiles of the sample",
          "(4, 11, 23, 40, 60, 77, 89, 96), not at z-score points from an assumed",
          "normal curve. Percentiles are read from the sample's own raw-to-percentile",
          `curve. Generated ${new Date().toISOString().slice(0, 10)}.`,
        ].join(" "),
        thresholds: preview.table.thresholds as unknown as Prisma.InputJsonValue,
        percentileCurve: preview.table.percentileCurve as unknown as Prisma.InputJsonValue,
        status: "DRAFT",
        sourceStudyId: args.studyId ?? null,
      },
    });
    created++;
  }

  await audit({
    userId: args.actorId ?? null,
    action: "norm_table.generated",
    entityType: "NormTable",
    newValue: { population: populationLabel, created, skipped },
  });

  return { created, skipped };
}

/**
 * Activate a draft norm table, retiring whichever table was banding that
 * construct before it. Refuses below the activation sample size — the gate is
 * not advisory.
 */
export async function activateNormTable(
  normTableId: string,
  actorId?: string | null,
): Promise<{ ok: true; retiredId: string | null } | { ok: false; reason: string }> {
  const table = await prisma.normTable.findUniqueOrThrow({ where: { id: normTableId } });
  if (table.status === "ACTIVE") {
    return { ok: false, reason: "This table is already active." };
  }
  // Refused outright, whatever the sample size.
  //
  // The demo fixture's purge deletes candidates by email domain; it cannot
  // find a norm table computed over them, so before this a table built while
  // the fixture was loaded stayed ACTIVE after the purge and went on banding
  // real people against a reference group that had been deleted as
  // fabricated — reported as a stanine, not a provisional band. Measured: a
  // real candidate moved from band 9 to band 2.
  if (table.syntheticSampleSize > 0) {
    return {
      ok: false,
      reason: `${table.syntheticSampleSize} of the ${table.sampleSize} cases behind this table are demo data. A norm table is the reference group every future candidate is compared against, so it cannot be built from people who do not exist. Purge the demo fixture and generate it again.`,
    };
  }
  if (normGate(table.sampleSize) !== "ACTIVATABLE") {
    return {
      ok: false,
      reason: `This table was built from ${table.sampleSize} cases. A table needs ${MIN_N_NORM_ACTIVE} before it can band anyone — until then the outer bands are defined by a handful of people.`,
    };
  }

  const previous = await prisma.normTable.findFirst({
    where: { construct: table.construct, status: "ACTIVE" },
  });

  await prisma.$transaction(async (tx) => {
    if (previous) {
      await tx.normTable.update({
        where: { id: previous.id },
        data: { status: "RETIRED" },
      });
    }
    await tx.normTable.update({
      where: { id: normTableId },
      data: { status: "ACTIVE" },
    });
  });

  await audit({
    userId: actorId ?? null,
    action: "norm_table.activated",
    entityType: "NormTable",
    entityId: normTableId,
    previousValue: previous ? { retiredId: previous.id } : undefined,
    newValue: {
      construct: table.construct,
      sampleSize: table.sampleSize,
      population: table.population,
    },
  });

  return { ok: true, retiredId: previous?.id ?? null };
}

export async function retireNormTable(
  normTableId: string,
  actorId?: string | null,
): Promise<void> {
  await prisma.normTable.update({
    where: { id: normTableId },
    data: { status: "RETIRED" },
  });
  await audit({
    userId: actorId ?? null,
    action: "norm_table.retired",
    entityType: "NormTable",
    entityId: normTableId,
  });
}

// ---------------------------------------------------------------------------
// The review queue
// ---------------------------------------------------------------------------

export interface PendingReview {
  hireId: string;
  cycleId: string;
  candidateName: string;
  jobTitle: string;
  hiredAt: Date;
  cycleName: string;
  dueAfterDays: number | null;
  existingReviewId: string | null;
  status: "NOT_STARTED" | "DRAFT" | "SUBMITTED";
}

/**
 * Reviews this user is on the hook for, with anything already saved.
 *
 * Returns the open cycles alongside, because the caller needs them and
 * re-fetching them by id was a third round trip for rows already in hand.
 */
export async function pendingReviewsFor(
  userId: string,
): Promise<{ pending: PendingReview[]; cycles: PerformanceCycle[] }> {
  const cycles = await prisma.performanceCycle.findMany({ where: { status: "OPEN" } });
  if (cycles.length === 0) return { pending: [], cycles: [] };

  const hires = await prisma.hire.findMany({
    where: { managerId: userId, status: { in: ["ACTIVE", "ON_LEAVE"] } },
    select: {
      id: true,
      jobTitle: true,
      hiredAt: true,
      candidate: { select: { firstName: true, lastName: true } },
      reviews: {
        where: { raterId: userId },
        select: { id: true, cycleId: true, status: true },
      },
    },
    orderBy: { hiredAt: "asc" },
    take: 500,
  });

  const now = Date.now();
  const out: PendingReview[] = [];
  for (const hire of hires) {
    const tenureDays = (now - hire.hiredAt.getTime()) / (24 * 60 * 60 * 1000);
    for (const cycle of cycles) {
      if (cycle.opensAt && cycle.opensAt.getTime() > now) continue;
      if (cycle.closesAt && cycle.closesAt.getTime() < now) continue;
      if (cycle.dueAfterDays !== null && tenureDays < cycle.dueAfterDays) continue;
      const existing = hire.reviews.find((r) => r.cycleId === cycle.id);
      out.push({
        hireId: hire.id,
        cycleId: cycle.id,
        candidateName: `${hire.candidate.firstName} ${hire.candidate.lastName}`,
        jobTitle: hire.jobTitle,
        hiredAt: hire.hiredAt,
        cycleName: cycle.name,
        dueAfterDays: cycle.dueAfterDays,
        existingReviewId: existing?.id ?? null,
        status: existing ? existing.status : "NOT_STARTED",
      });
    }
  }
  return { pending: out, cycles };
}
