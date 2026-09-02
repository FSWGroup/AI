/**
 * Technical report for a validation study.
 *
 * This is the document you hand to a psychologist reviewing the instrument,
 * or produce if anyone ever asks how a selection procedure was justified. It
 * follows the shape the Uniform Guidelines on Employee Selection Procedures
 * expect of criterion-related validity evidence (29 CFR 1607.15B): who was
 * studied, what the criterion was and why, how it was measured, what the
 * relationships were, and what the study does NOT establish.
 *
 * The last of those is the section most reports leave out. It is written
 * first here, and it is not optional.
 */

import { PdfBuilder, COLORS } from "@/lib/report/pdf-layout";
import { VERDICT_LABEL, VERDICT_MEANING } from "./gates";
import type { StudyResult } from "./study";

export interface TechnicalReportInput {
  study: {
    name: string;
    description: string | null;
    criterionKind: string;
    criterionKeys: string[];
    retentionDays: number | null;
    cycleKinds: string[];
    jobProfileName: string | null;
    hiredFrom: Date | null;
    hiredTo: Date | null;
    correctRangeRestriction: boolean;
    correctAttenuation: boolean;
  };
  result: StudyResult;
  organizationName: string;
  preparedBy: string;
}

const fmt = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);

const fmtP = (v: number): string => {
  if (!Number.isFinite(v)) return "—";
  if (v < 0.001) return "<.001";
  return v.toFixed(3).replace(/^0/, "");
};

const fmtR = (v: number | null): string => {
  if (v === null || !Number.isFinite(v)) return "—";
  const s = v.toFixed(2);
  return s.startsWith("0.") ? s.slice(1) : s.startsWith("-0.") ? `-${s.slice(2)}` : s;
};

const CRITERION_KIND_TEXT: Record<string, string> = {
  OVERALL_RATING: "Supervisor rating of overall effectiveness",
  COMPETENCY_RATING: "Supervisor rating on a single performance criterion",
  COMPOSITE_RATING: "Mean supervisor rating across several performance criteria",
  METRIC: "Objective performance metric",
  RETENTION: "Retention to a fixed tenure",
};

export async function buildTechnicalReport(
  input: TechnicalReportInput,
): Promise<Uint8Array> {
  const { study, result } = input;
  const date = result.computedAt.toISOString().slice(0, 10);

  const pdf = await PdfBuilder.create({
    header: `${study.name} — technical report`,
    headerRight: date,
    footer: `${input.organizationName} — criterion-related validity study. Not for distribution to candidates.`,
  });

  // ---- Cover -----------------------------------------------------------------
  pdf.markChromeless();
  pdf.moveDown(60);
  pdf.text("CRITERION-RELATED VALIDITY STUDY", {
    size: 8,
    bold: true,
    color: COLORS.fsw600,
  });
  pdf.moveDown(6);
  pdf.text(study.name, { size: 22, bold: true, color: COLORS.navy900 });
  pdf.moveDown(10);
  if (study.description) {
    pdf.text(study.description, { size: 10.5, color: COLORS.navy700 });
    pdf.moveDown(8);
  }
  pdf.rule(COLORS.navy900, 1.2);
  pdf.moveDown(10);
  pdf.table(
    [
      { label: "Item", width: 150 },
      { label: "Value", width: 330 },
    ],
    [
      ["Organization", input.organizationName],
      ["Job profile", study.jobProfileName ?? "All roles"],
      ["Criterion", CRITERION_KIND_TEXT[study.criterionKind] ?? study.criterionKind],
      ["Sample size", `${result.n} hires with both a score and a criterion value`],
      ["Computed", date],
      ["Prepared by", input.preparedBy],
    ],
    { size: 9.5 },
  );

  pdf.moveDown(14);
  pdf.panel(
    [
      {
        text: "What this study does not establish",
        style: { size: 10, bold: true, color: COLORS.navy900 },
      },
      {
        text: "A validity coefficient describes how strongly scores in this sample moved with this criterion. It does not establish that the assessment causes performance, that it works the same way for every group, or that any particular cut score is justified. It says nothing about applicants outside the population studied here, and nothing about a criterion other than the one named above.",
        style: { size: 9, color: COLORS.navy700 },
      },
      {
        text: "Differential validity and adverse impact are not analyzed in this report. Both require demographic data and sample sizes well beyond this study, and estimating them from too few cases would produce a number that reads as reassurance without being evidence.",
        style: { size: 9, color: COLORS.navy700 },
      },
      {
        text: "No score in this platform is used to reject an applicant automatically, and nothing in this study changes that.",
        style: { size: 9, bold: true, color: COLORS.navy900 },
      },
    ],
    { bg: COLORS.navy50 },
  );

  // ---- 1. Sample ---------------------------------------------------------------
  pdf.sectionHeading(1, "The sample");
  pdf.text(
    `This study covers employees hired ${describeWindow(study)} who completed the assessment before being hired and for whom a criterion value could be computed. ${result.n} of them met both conditions.`,
    { size: 10 },
  );
  pdf.moveDown(6);

  if (result.excluded.length > 0) {
    pdf.subHeading("Who is not in it");
    pdf.text(
      `${result.excluded.length} hires in scope were excluded because no criterion value could be computed for them. Exclusions are listed rather than summarized away, because a study's exclusions are where its bias usually lives.`,
      { size: 9.5, color: COLORS.navy700 },
    );
    pdf.moveDown(4);
    const reasons = new Map<string, number>();
    for (const e of result.excluded) {
      const generic = e.reason.replace(/\d+/g, "N");
      reasons.set(generic, (reasons.get(generic) ?? 0) + 1);
    }
    pdf.bullets(
      [...reasons.entries()].map(([reason, count]) => `${count} — ${reason}`),
      { size: 9.5 },
    );
  }

  // ---- 2. Criterion -------------------------------------------------------------
  pdf.sectionHeading(2, "The criterion");
  pdf.text(result.criterionDescription, { size: 10, bold: true });
  pdf.moveDown(6);
  pdf.text(
    "Performance criteria are rated on a five-point scale with written behavioral anchors at points 1, 3 and 5. The rating form deliberately does not use the assessment's own dimension names: asking a manager to rate 'Mental Acuity' would invite them to recall the test result rather than the work, and the study would then be correlating the test with itself.",
    { size: 9.5, color: COLORS.navy700 },
  );
  pdf.moveDown(8);

  pdf.subHeading("How reliable is the criterion?");
  if (result.criterionReliability) {
    const icc = result.criterionReliability;
    pdf.text(
      `Estimated by a one-way random-effects intraclass correlation over the ${icc.targets} hires rated by two or more people, with ${icc.meanRaters.toFixed(1)} raters each on average. A single rater's reliability is ${fmt(icc.icc1)}; the mean of the raters actually used is ${fmt(icc.iccK)}.`,
      { size: 9.5 },
    );
    pdf.moveDown(4);
    pdf.text(
      icc.iccK >= 0.7
        ? "That is a criterion solid enough to correlate against."
        : "That is a noisy criterion. Any coefficient computed against it is dragged toward zero, and the ceiling on what the assessment could possibly correlate with is well below 1.",
      { size: 9.5, color: COLORS.navy700 },
    );
  } else {
    pdf.text(
      "Not estimable: too few hires were rated by more than one person. Without a second rater there is no way to tell how much of the variation in these ratings is performance and how much is the rater. Getting a second rater on each review is the single highest-value change available to this study.",
      { size: 9.5, color: COLORS.navy700 },
    );
  }

  // ---- 3. Method ------------------------------------------------------------------
  pdf.sectionHeading(3, "Method");
  pdf.bullets(
    [
      "Predictor: the raw score on each dimension, from the attempt that was in front of the decision-makers at the time of hire. Later reassessments are not substituted.",
      "Relationship: Pearson product-moment correlation between predictor and criterion, with the Spearman rank correlation computed alongside as a check on linearity.",
      "Interval: 95% confidence interval via Fisher's z transformation. Two-tailed p from the t test on r with n-2 degrees of freedom.",
      "Multiple comparisons: Benjamini-Hochberg false discovery rate adjustment across every dimension tested in this study. Testing eighteen dimensions against one criterion produces roughly one result at p < .05 by chance, so the unadjusted p value is the wrong yardstick.",
      study.correctRangeRestriction
        ? "Range restriction: Thorndike Case II correction, using the standard deviation of the applicant pool measured from this platform's own records rather than an assumed value. The comparison group is every applicant assessed on the same form versions the hires sat, and on the same job profile where the study is scoped to one — pooling across roles and forms would make the ratio an artefact of the mixture."
        : "Range restriction: no correction requested. Observed coefficients understate the relationship in the applicant population by an unknown amount.",
      study.correctAttenuation
        ? "Criterion unreliability: correction applied only where interrater reliability could actually be estimated from this sample. The predictor is never corrected — the test being studied is the real one, with its real reliability."
        : "Criterion unreliability: no correction requested.",
    ],
    { size: 9.5 },
  );

  // ---- 4. Results ------------------------------------------------------------------
  pdf.sectionHeading(4, "Results");
  pdf.text(
    "Observed r is the coefficient in this sample. The corrected columns estimate what it would be in the full applicant pool and against a perfectly measured criterion; they are estimates built on assumptions, and the observed value is the one that was measured.",
    { size: 9, color: COLORS.navy700 },
  );
  pdf.moveDown(8);

  const rows = result.coefficients
    .filter((c) => Number.isFinite(c.r))
    .map((c) => [
      c.label,
      String(c.n),
      fmtR(c.r),
      `${fmtR(c.ciLow)} to ${fmtR(c.ciHigh)}`,
      fmtP(c.pValue),
      fmtP(c.qValue),
      fmtR(c.rRangeCorrected),
      fmtR(c.rFullyCorrected),
      VERDICT_LABEL[c.verdict],
    ]);

  pdf.table(
    [
      { label: "Dimension", width: 118 },
      { label: "n", width: 26 },
      { label: "r", width: 34 },
      { label: "95% CI", width: 82 },
      { label: "p", width: 40 },
      { label: "q", width: 40 },
      { label: "r (RR)", width: 40 },
      { label: "r (RR+rel)", width: 46 },
      { label: "Verdict", width: 74 },
    ],
    rows,
    { size: 7.6 },
  );

  const uncomputable = result.coefficients.filter((c) => !Number.isFinite(c.r));
  if (uncomputable.length > 0) {
    pdf.moveDown(10);
    pdf.subHeading("Dimensions no coefficient could be computed for");
    pdf.bullets(
      uncomputable.map((c) => `${c.label} — ${c.notes[0] ?? "Insufficient data."}`),
      { size: 9 },
    );
  }

  // ---- 5. Interpretation ------------------------------------------------------------
  pdf.sectionHeading(5, "How to read these verdicts");
  for (const verdict of ["SUPPORTED", "PRELIMINARY", "NOT_SUPPORTED", "INSUFFICIENT"] as const) {
    const count = result.coefficients.filter((c) => c.verdict === verdict).length;
    pdf.subHeading(`${VERDICT_LABEL[verdict]} — ${count} dimension${count === 1 ? "" : "s"}`);
    pdf.text(VERDICT_MEANING[verdict], { size: 9.5, color: COLORS.navy700 });
  }

  pdf.moveDown(10);
  pdf.panel(
    [
      {
        text: "A supported coefficient is not a licence to weight a dimension more heavily.",
        style: { size: 9.5, bold: true, color: COLORS.navy900 },
      },
      {
        text: "This study reports relationships. Changing a benchmark, a required range, or the way a dimension is used in hiring is a judgement made by a person who has read the whole study, considered the job, and accepted responsibility for the change. The platform does not make that change automatically and does not recommend one.",
        style: { size: 9, color: COLORS.navy700 },
      },
    ],
    { bg: COLORS.navy50 },
  );

  // ---- 6. Caveats -----------------------------------------------------------------
  if (result.warnings.length > 0 || result.coefficients.some((c) => c.notes.length > 0)) {
    pdf.sectionHeading(6, "Caveats recorded during this analysis");
    if (result.warnings.length > 0) {
      pdf.bullets(result.warnings, { size: 9.5 });
    }
    const noted = result.coefficients.filter((c) => c.notes.length > 0 && Number.isFinite(c.r));
    if (noted.length > 0) {
      pdf.moveDown(8);
      pdf.subHeading("Per-dimension notes");
      for (const c of noted) {
        pdf.text(c.label, { size: 9.5, bold: true });
        pdf.bullets(c.notes, { size: 9 });
      }
    }
  }

  return pdf.finish(`${study.name} — technical report`);
}

function describeWindow(study: TechnicalReportInput["study"]): string {
  const from = study.hiredFrom?.toISOString().slice(0, 10);
  const to = study.hiredTo?.toISOString().slice(0, 10);
  if (from && to) return `between ${from} and ${to}`;
  if (from) return `on or after ${from}`;
  if (to) return `on or before ${to}`;
  return "at any date";
}
