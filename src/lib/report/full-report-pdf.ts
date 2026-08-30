/**
 * The complete, shareable assessment PDF.
 *
 * One file containing everything the admin portal shows about an assessment,
 * ordered for a reader who was not in the room: an executive summary and the
 * score sheet first, then the detail behind them, then the session and
 * integrity record, then a plain-English guide to reading any of it.
 *
 * Generated with pdf-lib rather than by printing the web report through
 * headless Chromium. That is a deployment decision, not a stylistic one: the
 * platform runs on serverless functions with no Chromium binary, and a
 * download button that only works on some hosts is not a download button.
 *
 * What it does NOT contain, deliberately:
 *  - any hire/reject recommendation, ranking, or overall fit score
 *  - the webcam recording or any still from it (access to recordings is
 *    separately gated and audited; a PDF cannot carry that gate with it)
 *  - the candidate's résumé text, which belongs to the candidate and is not
 *    ours to redistribute — the AI brief's findings are included instead
 */

import { PdfBuilder, COLORS, encodable } from "./pdf-layout";
import type { ReportPayload } from "./generate";
import type { CandidateFitAnalysis } from "@/lib/ai/candidate-analysis";

export interface SessionSection {
  sectionKey: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  timed: boolean;
  durationSeconds: number | null;
}

export interface FullReportInput {
  payload: ReportPayload;
  candidate: { email: string; phone: string | null };
  invitedAt: string | null;
  startedAt: string | null;
  sections: SessionSection[];
  accommodations: { type: string; timeMultiplier: number | null; note: string | null }[];
  consents: { consentType: string; noticeVersion: string; consentedAt: string }[];
  integrityEvents: { type: string; occurredAt: string; meta: unknown }[];
  integrityLevel: string;
  integrityLabel: string;
  aiBrief: {
    analysis: CandidateFitAnalysis;
    model: string;
    generatedAt: string | null;
    hadResume: boolean;
  } | null;
  /** Who exported it, stamped on the cover so a forwarded copy is traceable. */
  exportedBy: string;
  exportedAt: Date;
}

const RELEVANCE_LABEL: Record<string, string> = {
  strength_for_role: "Strength for role",
  watch_area: "Watch area",
  context_only: "Context",
};

const RELATIONSHIP_LABEL: Record<string, string> = {
  corroborates: "Corroborates",
  tension: "Tension",
  resume_silent: "Resume silent",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(iso),
  );
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * Event metadata is stored as JSON. Raw `{"sectionKey":"MENTAL_ACUITY"}` is
 * fine in the admin portal, but this document goes to colleagues who never
 * see the schema — so render it as readable key/value text, and show nothing
 * at all rather than an empty object.
 */
function formatMeta(meta: unknown): string {
  if (meta == null || typeof meta !== "object") return "";
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      const label = k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      const value =
        typeof v === "string"
          ? v.replace(/_/g, " ")
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v);
      return `${label}: ${value}`;
    })
    .join("; ")
    .slice(0, 200);
}

function positionLabel(position: string | null): string {
  switch (position) {
    case "WITHIN":
      return "In range";
    case "BELOW":
      return "Below range";
    case "ABOVE":
      return "Above range";
    default:
      return "-";
  }
}

export async function buildFullReportPdf(
  input: FullReportInput,
): Promise<Uint8Array> {
  const { payload: p } = input;
  const m = p.meta;

  const b = await PdfBuilder.create({
    header: `${m.candidateName} \u2014 ${m.position}`,
    headerRight: fmtDate(m.completedAt),
    footer: "FSW WorkFit Assessment  \u00b7  Confidential \u2014 do not distribute externally",
  });

  drawCover(b, input);
  const contentsPage = b.reservePage();

  let n = 0;
  const at = (title: string): number => {
    n += 1;
    b.sectionHeading(n, title);
    return n;
  };

  // ---- 1. Executive summary ---------------------------------------------------
  at("Executive summary");
  b.text(
    "This section is the whole report in brief. Everything asserted here is supported by the detail in the sections that follow.",
    { size: 9, color: COLORS.navy500 },
  );
  b.moveDown(6);

  b.subHeading("Strongest alignment with this role");
  if (p.executiveSummary.strongestAlignment.length > 0) {
    b.bullets(
      p.executiveSummary.strongestAlignment.map(
        (s) => `${s.name} \u2014 band ${s.band}, inside the range set for this role.`,
      ),
    );
  } else {
    b.text(
      "No required dimension landed inside its target range. Read section 2 before drawing anything from that \u2014 it often means the ranges need revisiting rather than the candidate does.",
    );
  }

  b.subHeading("Worth investigating at interview");
  if (p.executiveSummary.investigate.length > 0) {
    b.bullets(
      p.executiveSummary.investigate.map((s) => `${s.name} \u2014 ${s.reason}`),
    );
  } else {
    b.text("Nothing was flagged for additional interview attention.");
  }

  b.subHeading("How much confidence the results deserve");
  b.text(p.executiveSummary.responseQuality);
  b.moveDown(4);
  b.text(`Session integrity: ${input.integrityLabel}.`, { size: 9 });
  b.text(m.bandTypeNote, { size: 9, color: COLORS.navy500 });

  b.moveDown(8);
  b.panel(
    [
      {
        text: "This is decision-support information, not a decision.",
        style: { bold: true, size: 9, color: COLORS.navy900 },
      },
      { text: p.executiveSummary.disclaimer, style: { size: 8.5 } },
    ],
    { bg: COLORS.navy50 },
  );

  // ---- 2. Results at a glance -------------------------------------------------
  at("Results at a glance");
  b.text(
    "Every dimension on the 1\u20139 scale. The tinted cells are the range set for this role; the filled cell is this candidate. A band outside the range is a prompt to ask about it, in either direction \u2014 higher is not automatically better.",
    { size: 9, color: COLORS.navy500 },
  );
  b.moveDown(10);

  drawScoreSheet(b, p, "APTITUDE", "Mental aptitudes");
  drawScoreSheet(b, p, "BEHAVIORAL", "Performance scales");

  // ---- 3. Dimension detail ----------------------------------------------------
  at("Mental aptitudes in detail");
  drawDimensionNarratives(b, p, "APTITUDE");

  at("Performance scales in detail");
  drawDimensionNarratives(b, p, "BEHAVIORAL");

  // ---- Response validity ------------------------------------------------------
  at("Response quality");
  b.text(
    "These indicators describe how the questionnaire was answered, not what kind of person the candidate is. They are interpretation aids: an elevated indicator means read the behavioral scales with more caution, nothing more.",
    { size: 9, color: COLORS.navy500 },
  );
  b.moveDown(8);
  for (const v of p.validity) {
    b.subHeading(`${v.name} \u2014 ${v.level.toLowerCase().replace(/_/g, " ")}`);
    b.text(v.narrative);
  }
  if (p.validity.length === 0) {
    b.text("No response-quality indicators were computed for this attempt.");
  }

  // ---- Areas of concern -------------------------------------------------------
  if (p.concerns.length > 0) {
    at("Areas for additional interview attention");
    b.text(
      "These are configured thresholds for this role, not disqualifiers. Each one is a topic to explore in the interview.",
      { size: 9, color: COLORS.navy500 },
    );
    b.moveDown(8);
    b.table(
      [
        { label: "Dimension", width: 190 },
        { label: "Band", width: 60 },
        { label: "Flag", width: 254 },
      ],
      p.concerns.map((c) => [c.name, String(c.band), c.label]),
    );
  }

  // ---- Sales traits -----------------------------------------------------------
  if (p.salesTraits) {
    at("Sales traits analysis");
    b.text(
      `Overall pattern: ${p.salesTraits.overallLabel}. Composites are weighted combinations of the dimensions already reported \u2014 they add interpretation, not new measurement.`,
      { size: 9, color: COLORS.navy500 },
    );
    b.moveDown(10);
    b.table(
      [
        { label: "Composite", width: 190 },
        { label: "Band", width: 55 },
        { label: "Reading", width: 259 },
      ],
      p.salesTraits.composites.map((c) => [
        c.name,
        String(c.band),
        c.classificationLabel,
      ]),
    );
    if (p.salesTraits.strengths.length > 0) {
      b.subHeading("Where the pattern is strongest");
      b.bullets(p.salesTraits.strengths);
    }
    if (p.salesTraits.exploration.length > 0) {
      b.subHeading("Worth exploring");
      b.bullets(p.salesTraits.exploration);
    }
  }

  if (p.leadership && p.leadership.composites.length > 0) {
    at("Leadership composites");
    b.table(
      [
        { label: "Composite", width: 240 },
        { label: "Band", width: 60 },
        { label: "Built from", width: 204 },
      ],
      p.leadership.composites.map((c) => [
        c.name,
        String(c.band),
        c.components.map((x) => x.construct.replace(/_/g, " ").toLowerCase()).join(", "),
      ]),
    );
  }

  // ---- Interview guide --------------------------------------------------------
  if (p.interviewGuide.length > 0) {
    at("Targeted interview guide");
    b.text(
      "Ask every candidate for this role the same questions in the same order \u2014 that is what makes answers comparable. The alternate wording is for when the first phrasing does not land.",
      { size: 9, color: COLORS.navy500 },
    );
    b.moveDown(8);
    for (const g of p.interviewGuide) {
      b.subHeading(g.name);
      b.text(`Why this dimension: ${g.reason}`, {
        size: 8.5,
        color: COLORS.navy500,
      });
      b.moveDown(4);
      for (const q of g.questions) {
        b.ensure(60);
        b.text(q.question, { bold: true, size: 9.5, color: COLORS.navy900 });
        if (q.altWording) {
          b.text(`Alternate wording: ${q.altWording}`, {
            size: 8.5,
            indent: 10,
            color: COLORS.navy500,
          });
        }
        b.text(`Listen for: ${q.listenFor}`, { size: 8.5, indent: 10 });
        b.moveDown(5);
      }
    }
  }

  // ---- Development ------------------------------------------------------------
  if (p.development.length > 0) {
    at("Development suggestions");
    b.text(
      "Useful whether or not this person is hired. If they are, these are a starting point for the first ninety days.",
      { size: 9, color: COLORS.navy500 },
    );
    b.moveDown(8);
    for (const d of p.development) {
      b.subHeading(d.name);
      b.bullets(d.recommendations);
    }
  }

  // ---- AI interview brief -----------------------------------------------------
  if (input.aiBrief) {
    at("AI interview brief");
    drawAiBrief(b, input.aiBrief);
  }

  // ---- Session detail ---------------------------------------------------------
  at("Session record");
  b.subHeading("Administration");
  b.table(
    [
      { label: "Field", width: 150 },
      { label: "Value", width: 354 },
    ],
    [
      ["Candidate", m.candidateName],
      ["Email", input.candidate.email],
      ["Phone", input.candidate.phone ?? "-"],
      ["Position", m.position],
      ["Record ID", m.recordId],
      ["Attempt", String(m.attemptNumber)],
      ["Assessment form", m.assessmentVersionName],
      ["Invited", fmtDateTime(input.invitedAt)],
      ["Started", fmtDateTime(input.startedAt)],
      ["Completed", fmtDateTime(m.completedAt)],
      ["Scoring version", m.scoringVersion],
      ["Narrative version", m.narrativeVersion],
      ["Report version", String(m.reportVersion)],
    ],
  );

  b.subHeading("Sections");
  b.table(
    [
      { label: "Section", width: 150 },
      { label: "Status", width: 78 },
      { label: "Timed", width: 60 },
      { label: "Started", width: 108 },
      { label: "Finished", width: 108 },
    ],
    input.sections.map((s) => [
      s.sectionKey.replace(/_/g, " "),
      s.status,
      s.timed && s.durationSeconds
        ? `${Math.round(s.durationSeconds / 60)} min`
        : "Untimed",
      fmtDateTime(s.startedAt),
      fmtDateTime(s.completedAt),
    ]),
  );

  if (input.accommodations.length > 0) {
    b.subHeading("Accommodations applied");
    b.bullets(
      input.accommodations.map(
        (a) =>
          `${a.type.replace(/_/g, " ")}${
            a.timeMultiplier ? ` (time x${a.timeMultiplier})` : ""
          }${a.note ? ` - ${a.note}` : ""}`,
      ),
    );
  }

  b.subHeading("Consent records");
  if (input.consents.length > 0) {
    b.table(
      [
        { label: "Consent", width: 180 },
        { label: "Notice version", width: 120 },
        { label: "Given", width: 204 },
      ],
      input.consents.map((c) => [
        c.consentType,
        `v${c.noticeVersion}`,
        fmtDateTime(c.consentedAt),
      ]),
    );
  } else {
    b.text("No consent records on file for this attempt.");
  }

  // ---- Integrity --------------------------------------------------------------
  at("Session integrity log");
  b.panel(
    [
      {
        text: `Overall: ${input.integrityLabel}`,
        style: { bold: true, size: 9.5, color: COLORS.navy900 },
      },
      {
        text: p.integrity.reviewReminder,
        style: { size: 8.5 },
      },
    ],
    {
      bg:
        input.integrityLevel === "NO_NOTABLE_EVENTS"
          ? COLORS.greenBg
          : COLORS.amberBg,
    },
  );
  b.text(
    "Every entry below is an objective event the browser reported. None of it changes a score, and nothing here is an accusation \u2014 a human decides whether any of it warrants a follow-up question.",
    { size: 9, color: COLORS.navy500 },
  );
  b.moveDown(8);
  if (input.integrityEvents.length > 0) {
    b.table(
      [
        { label: "Time", width: 130 },
        { label: "Event", width: 170 },
        { label: "Detail", width: 204 },
      ],
      input.integrityEvents.map((e) => [
        fmtDateTime(e.occurredAt),
        e.type.replace(/_/g, " "),
        formatMeta(e.meta),
      ]),
      { size: 7.5 },
    );
  } else {
    b.text("No events were recorded during this session.");
  }

  // ---- How to read it ---------------------------------------------------------
  at("How to read this report");
  b.subHeading("The 1\u20139 scale");
  b.text(
    "Every dimension is reported on a nine-point scale. A band is a position on a distribution, not a mark out of nine and not a percentage. Bands near the middle are the most common result and are not a weak result.",
  );
  b.moveDown(4);
  b.text(m.bandTypeNote, { bold: true });

  b.subHeading("Ranges");
  b.text(
    "A range is the pattern this role tends to call for, set by whoever configured the job profile. It is not a cut score and not a pass mark. A band below a range and a band above it are both worth a question; neither is a finding.",
  );

  b.subHeading("Aptitudes and performance scales differ");
  b.text(
    "Aptitude sections were timed and have correct answers. Performance scales are self-report: they describe preferred ways of working, where neither end is better in itself. Read them differently.",
  );

  b.subHeading("What this report cannot tell you");
  b.bullets([
    "Whether to hire this person. No part of this document recommends an outcome, and it should never be the sole basis for an employment decision.",
    "How the person will perform. These are correlational instruments used alongside an interview, work history, and references.",
    "Anything about a protected characteristic. Nothing here is scored on, or intended to proxy for, any protected characteristic.",
  ]);

  b.subHeading("Handling this file");
  b.text(
    `This PDF contains personal information about a named individual and was exported by ${input.exportedBy} on ${fmtDateTime(input.exportedAt.toISOString())}. Share it only with colleagues involved in this hiring decision, and dispose of it according to your retention policy.`,
  );

  // ---- Contents (filled in now that page numbers are known) --------------------
  drawContents(b, contentsPage, m.candidateName);

  return b.finish(`FSW WorkFit Assessment - ${m.candidateName}`);
}

// ---------------------------------------------------------------------------

function drawCover(b: PdfBuilder, input: FullReportInput): void {
  const { payload: p } = input;
  const m = p.meta;
  const { page } = b.raw;
  b.markChromeless();

  page.drawRectangle({
    x: 0,
    y: b.pageHeight - 218,
    width: b.pageWidth,
    height: 218,
    color: COLORS.navy900,
  });

  b.setCursor(b.pageHeight - 76);
  b.lineAt(encodable(m.company.toUpperCase()), b.marginX, b.cursorY, {
    size: 9,
    bold: true,
    color: COLORS.fsw100,
  });
  b.setCursor(b.cursorY - 34);
  b.lineAt("Complete Assessment Report", b.marginX, b.cursorY, {
    size: 25,
    bold: true,
    color: COLORS.white,
  });
  b.setCursor(b.cursorY - 22);
  b.lineAt(m.candidateName, b.marginX, b.cursorY, {
    size: 17,
    color: COLORS.white,
  });
  b.setCursor(b.cursorY - 18);
  b.lineAt(m.position, b.marginX, b.cursorY, {
    size: 11,
    color: COLORS.fsw100,
  });

  b.setCursor(b.pageHeight - 268);
  const facts: [string, string][] = [
    ["Assessment date", fmtDate(m.completedAt)],
    ["Record ID", m.recordId],
    ["Assessment form", m.assessmentVersionName],
    ["Attempt", String(m.attemptNumber)],
    ["Report version", `v${m.reportVersion}`],
    ["Exported", fmtDateTime(input.exportedAt.toISOString())],
    ["Exported by", input.exportedBy],
  ];
  for (const [label, value] of facts) {
    b.lineAt(label.toUpperCase(), b.marginX, b.cursorY, {
      size: 7,
      bold: true,
      color: COLORS.navy400,
    });
    b.lineAt(value, b.marginX + 130, b.cursorY, {
      size: 9.5,
      color: COLORS.navy900,
    });
    b.setCursor(b.cursorY - 19);
  }

  b.setCursor(b.cursorY - 26);
  b.panel(
    [
      {
        text: "Confidential",
        style: { bold: true, size: 10, color: COLORS.navy900 },
      },
      {
        text: "This document contains personal information about a named individual, collected for a specific hiring process. Share it only with colleagues involved in that decision.",
        style: { size: 8.5 },
      },
      {
        text: "It is decision-support information. Nothing in it recommends an employment outcome, and it should never be the sole basis for one.",
        style: { size: 8.5 },
      },
    ],
    { bg: COLORS.navy50, pad: 12 },
  );
}

function drawContents(
  b: PdfBuilder,
  page: import("pdf-lib").PDFPage,
  candidateName: string,
): void {
  let y = b.pageHeight - 76;
  b.drawOn(page, "Contents", b.marginX, y, {
    size: 17,
    bold: true,
    color: COLORS.navy900,
  });
  y -= 14;
  page.drawRectangle({
    x: b.marginX,
    y,
    width: b.contentWidth,
    height: 1,
    color: COLORS.navy900,
  });
  y -= 26;
  for (const s of b.sections) {
    b.drawOn(page, s.title, b.marginX, y, { size: 10, color: COLORS.navy900 });
    const label = String(s.page);
    const w = b.widthOf(label, 10);
    b.drawOn(page, label, b.pageWidth - b.marginX - w, y, {
      size: 10,
      color: COLORS.navy500,
    });
    y -= 8;
    page.drawRectangle({
      x: b.marginX,
      y: y + 3,
      width: b.contentWidth,
      height: 0.4,
      color: COLORS.navy100,
    });
    y -= 13;
  }
  y -= 14;
  b.drawOn(
    page,
    `Prepared for internal hiring use \u2014 ${candidateName}`,
    b.marginX,
    y,
    { size: 8, color: COLORS.navy400 },
  );
}

function drawScoreSheet(
  b: PdfBuilder,
  p: ReportPayload,
  category: "APTITUDE" | "BEHAVIORAL",
  title: string,
): void {
  const rows = p.dimensions.filter((d) => d.category === category);
  if (rows.length === 0) return;
  b.subHeading(title);
  b.moveDown(4);
  for (const d of rows) {
    b.ensure(46);
    b.moveDown(15);
    const top = b.cursorY;
    b.lineAt(d.name, b.marginX, top, { size: 9.5, bold: true, color: COLORS.navy900 });

    const scaleX = b.marginX + 250;
    b.bandScale(scaleX, top - 3, d.band, d.benchmark);

    const chipX = scaleX + 140;
    if (d.benchmark) {
      const tone =
        d.position === "WITHIN"
          ? { fg: COLORS.green, bg: COLORS.greenBg }
          : { fg: COLORS.amber, bg: COLORS.amberBg };
      b.chip(positionLabel(d.position), chipX, top, tone.fg, tone.bg);
    } else {
      b.chip("Not benchmarked", chipX, top, COLORS.navy500, COLORS.navy50);
    }

    b.lineAt(
      `${d.lowDescriptor}   \u2194   ${d.highDescriptor}`,
      b.marginX,
      top - 11,
      { size: 7.5, color: COLORS.navy400 },
    );
    b.lineAt(
      d.benchmark
        ? `Band ${d.band} (${d.bandLabel})  \u00b7  target ${d.benchmark.min}\u2013${d.benchmark.max}${d.benchmark.required ? ", required" : ""}`
        : `Band ${d.band} (${d.bandLabel})`,
      b.marginX,
      top - 21,
      { size: 8, color: COLORS.navy500 },
    );
    b.setCursor(top - 26);
  }
  b.moveDown(6);
}

function drawDimensionNarratives(
  b: PdfBuilder,
  p: ReportPayload,
  category: "APTITUDE" | "BEHAVIORAL",
): void {
  const rows = p.dimensions.filter((d) => d.category === category);
  for (const d of rows) {
    b.ensure(90);
    b.subHeading(`${d.name} \u2014 band ${d.band} (${d.bandLabel})`);
    b.text(d.shortDefinition, { size: 8.5, color: COLORS.navy500 });
    b.moveDown(4);
    b.text(d.narrative);
    if (d.rangeNarrative) {
      b.moveDown(4);
      b.text(d.rangeNarrative, { size: 9, color: COLORS.navy900 });
    }
    if (d.benchmark?.note) {
      b.moveDown(3);
      b.text(`Note on this role's range: ${d.benchmark.note}`, {
        size: 8.5,
        color: COLORS.navy500,
      });
    }
    b.moveDown(6);
  }
}

function drawAiBrief(
  b: PdfBuilder,
  brief: NonNullable<FullReportInput["aiBrief"]>,
): void {
  const a = brief.analysis;
  b.panel(
    [
      {
        text: "Generated by a language model, reviewed by nobody until now.",
        style: { bold: true, size: 9, color: COLORS.navy900 },
      },
      {
        text: `Model ${brief.model}, ${fmtDateTime(brief.generatedAt)}. ${
          brief.hadResume
            ? "A resume was provided and the candidate's identifying details were removed before analysis."
            : "No resume was provided, so this is based on assessment results and the job description alone."
        } It suggests questions to ask; it does not score, rank, or recommend, and its suggestions carry no more weight than your own reading of the results.`,
        style: { size: 8.5 },
      },
    ],
    { bg: COLORS.amberBg },
  );

  b.subHeading("Role context");
  b.text(a.roleContext);

  if (a.assessmentHighlights.length > 0) {
    b.subHeading("Assessment highlights for this role");
    b.table(
      [
        { label: "Dimension", width: 120 },
        { label: "Reading", width: 274 },
        { label: "Relevance", width: 110 },
      ],
      a.assessmentHighlights.map((h) => [
        h.dimension,
        h.observation,
        RELEVANCE_LABEL[h.relevance] ?? h.relevance,
      ]),
    );
  }

  if (a.resumeCorroboration.length > 0) {
    b.subHeading("Where the resume and the assessment meet");
    for (const c of a.resumeCorroboration) {
      b.ensure(70);
      b.text(`${c.topic} \u2014 ${RELATIONSHIP_LABEL[c.relationship] ?? c.relationship}`, {
        bold: true,
        size: 9.5,
        color: COLORS.navy900,
      });
      b.text(`Assessment: ${c.assessmentSignal}`, { size: 8.5, indent: 10 });
      b.text(`Resume: ${c.resumeSignal}`, { size: 8.5, indent: 10 });
      b.text(`Verify: ${c.whatToVerify}`, { size: 8.5, indent: 10 });
      b.moveDown(5);
    }
  }

  if (a.experienceGaps.length > 0) {
    b.subHeading("Not evidenced by the resume");
    b.bullets(a.experienceGaps);
  }

  if (a.interviewQuestions.length > 0) {
    b.subHeading("Suggested questions");
    for (const q of a.interviewQuestions) {
      b.ensure(78);
      b.text(`${q.theme}`, { size: 8, bold: true, color: COLORS.fsw600 });
      b.text(q.question, { bold: true, size: 9.5, color: COLORS.navy900 });
      b.text(`Why: ${q.whyThisQuestion}`, { size: 8.5, indent: 10 });
      b.text(`Listen for: ${q.listenFor}`, { size: 8.5, indent: 10 });
      b.text(`Follow up: ${q.followUp}`, { size: 8.5, indent: 10 });
      b.moveDown(6);
    }
  }

  if (a.referenceCheckPrompts.length > 0) {
    b.subHeading("For a reference call");
    b.bullets(a.referenceCheckPrompts);
  }

  if (a.onboardingConsiderations.length > 0) {
    b.subHeading("If this person is hired");
    b.bullets(a.onboardingConsiderations);
  }

  if (a.cautions.length > 0) {
    b.subHeading("Interpretation cautions");
    b.bullets(a.cautions);
  }
}
