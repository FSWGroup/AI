/**
 * One-page hiring-manager brief. Server-safe; prints to a single sheet.
 *
 * Everything shown here is drawn from the stored report payload via
 * buildManagerBrief(). No score is recomputed and no recommendation is made.
 */

import type { ManagerBrief as Brief } from "@/lib/report/manager-brief";
import { Badge, Card } from "@/components/ui";

function BandChip({ band }: { band: number }) {
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-navy-900 text-sm font-bold text-white print:h-6 print:w-6 print:text-xs"
      aria-label={`Band ${band} of 9`}
    >
      {band}
    </span>
  );
}

function Point({
  point,
  tone,
}: {
  point: Brief["alignsWith"][number];
  tone: "green" | "amber";
}) {
  return (
    <li className="flex gap-3 py-2 print:gap-2 print:py-1">
      <BandChip band={point.band} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 print:gap-y-0">
          <span className="text-[13px] font-semibold text-navy-900">
            {point.name}
          </span>
          {point.range && (
            <span className="text-[12px] text-navy-400">
              target {point.range}
            </span>
          )}
          <Badge tone={tone}>{point.bandLabel}</Badge>
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-navy-600 print:text-[10px]">
          {point.note}
        </p>
      </div>
    </li>
  );
}

export function ManagerBrief({ brief }: { brief: Brief }) {
  const m = brief.meta;
  const a = brief.alignment;
  const qualityTone =
    brief.responseQualityLevel === "HIGH"
      ? "red"
      : brief.responseQualityLevel === "ELEVATED"
        ? "amber"
        : "green";

  return (
    <div className="report-print space-y-4 text-navy-800 print:space-y-1.5">
      <div className="rounded-2xl bg-navy-900 p-6 text-white print:rounded-none print:p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-fsw-300">
              {m.company} · Hiring manager brief
            </p>
            <h1 className="mt-1 text-2xl font-bold print:text-lg">{m.candidateName}</h1>
            <p className="mt-0.5 text-sm text-navy-200 print:text-xs">{m.position}</p>
          </div>
          <div className="text-right text-xs text-navy-200">
            <p>
              {m.completedAt
                ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
                    new Date(m.completedAt),
                  )
                : "—"}
            </p>
            <p className="mt-0.5">Record {m.recordId}</p>
          </div>
        </div>
        <div className="mt-4 border-t border-white/15 pt-3 print:mt-2 print:pt-1.5">
          <p className="text-sm">
            <strong>
              {a.inRange} of {a.requiredTotal}
            </strong>{" "}
            required dimensions fall inside this role&rsquo;s target ranges
            {a.optionalTotal > 0 && (
              <>
                {" "}
                · {a.optionalInRange} of {a.optionalTotal} optional
              </>
            )}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-navy-300 print:mt-0.5 print:text-[9.5px]">
            A count, not a verdict. Ranges describe the pattern the role tends
            to call for — they are not a cut score, and nothing here recommends
            an outcome.
          </p>
        </div>
      </div>

      <div className="print-cols-2 grid grid-cols-1 gap-4 md:grid-cols-2 print:gap-3">
        <Card className="p-5 print:p-2.5">
          <h2 className="text-sm font-bold text-navy-900 print:text-[12px]">
            Lines up with the role
          </h2>
          {brief.alignsWith.length > 0 ? (
            <ul className="mt-2 divide-y divide-navy-50 print:mt-1">
              {brief.alignsWith.map((p) => (
                <Point key={p.name} point={p} tone="green" />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] text-navy-500">
              No benchmarked dimension landed inside its target range. Read the
              full report before drawing anything from that.
            </p>
          )}
        </Card>

        <Card className="p-5 print:p-2.5">
          <h2 className="text-sm font-bold text-navy-900 print:text-[12px]">Worth exploring</h2>
          {brief.probe.length > 0 ? (
            <ul className="mt-2 divide-y divide-navy-50 print:mt-1">
              {brief.probe.map((p) => (
                <Point key={p.name} point={p} tone="amber" />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] text-navy-500">
              Every benchmarked dimension fell inside its target range.
            </p>
          )}
        </Card>
      </div>

      {brief.questions.length > 0 && (
        <Card className="p-5 print:p-2.5">
          <h2 className="text-sm font-bold text-navy-900 print:text-[12px]">Ask these three</h2>
          <p className="mt-0.5 text-[12px] text-navy-500 print:text-[9.5px]">
            Same questions, same order, every candidate — that is what makes
            the answers comparable.
          </p>
          <ol className="mt-3 space-y-3 print:mt-1.5 print:space-y-1.5">
            {brief.questions.map((q, i) => (
              <li key={q.question} className="flex gap-3 print:gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fsw-100 text-[11px] font-bold text-fsw-800">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[13px] font-medium leading-snug text-navy-900 print:text-[10.5px]">
                    {q.question}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-navy-500 print:text-[9.5px]">
                    <span className="font-semibold">Listen for:</span>{" "}
                    {q.listenFor}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card className="p-5 print:p-2.5">
        <h2 className="text-sm font-bold text-navy-900 print:text-[12px]">
          How much weight to give this
        </h2>
        {/* Compact by default so the brief stays on one sheet. The full
            response-quality sentence appears only when there is actually a
            caution to give — that is the case where the words earn the room. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-navy-700 print:mt-1.5 print:gap-x-3 print:text-[10px]">
          <span>
            <Badge tone={qualityTone}>Response quality</Badge>{" "}
            {brief.responseQualityLevel === "NORMAL"
              ? "typical range"
              : brief.responseQualityLevel === "ELEVATED"
                ? "somewhat elevated"
                : "clearly elevated"}
          </span>
          <span>
            <Badge
              tone={
                brief.integrity.level === "NO_NOTABLE_EVENTS" ? "green" : "amber"
              }
            >
              Session integrity
            </Badge>{" "}
            {brief.integrity.label.toLowerCase()}
            {brief.integrity.loggedEventCount > 0 &&
              ` (${brief.integrity.loggedEventCount} logged)`}
          </span>
          {brief.salesOverall && (
            <span>
              <Badge tone="blue">Sales pattern</Badge>{" "}
              {brief.salesOverall.label.toLowerCase()}
            </span>
          )}
        </div>
        {brief.concerns.length > 0 && (
          <p className="mt-2 text-[12.5px] leading-snug text-navy-700 print:mt-1.5 print:text-[10px]">
            <Badge tone="amber">Interview attention</Badge>{" "}
            {brief.concerns.map((c) => c.name).join(", ")} — flagged for
            additional interview attention, never as a disqualifier.
          </p>
        )}
        {brief.responseQualityLevel !== "NORMAL" && (
          <p className="mt-2 text-[12.5px] leading-snug text-navy-700 print:mt-1.5 print:text-[10px]">
            {brief.responseQuality}
          </p>
        )}
        <p className="mt-2 text-[11.5px] leading-snug text-navy-500 print:mt-1.5 print:text-[9.5px]">
          {brief.bandTypeNote}
        </p>
      </Card>

      <p className="rounded-xl border border-navy-200 bg-navy-50 p-4 text-[11.5px] leading-relaxed text-navy-600 print:p-2 print:text-[9px] print:leading-snug">
        {brief.disclaimer} Read the full report before deciding — it carries
        the dimension-by-dimension detail, the response-validity analysis, and
        the complete interview guide.
      </p>
    </div>
  );
}
