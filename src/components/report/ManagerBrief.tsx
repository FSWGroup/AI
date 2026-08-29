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
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-navy-900 text-sm font-bold text-white"
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
    <li className="flex gap-3 py-2">
      <BandChip band={point.band} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
        <p className="mt-0.5 text-[12.5px] leading-snug text-navy-600">
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
    <div className="report-print space-y-4 text-navy-800">
      <div className="rounded-2xl bg-navy-900 p-6 text-white print:rounded-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-fsw-300">
              {m.company} · Hiring manager brief
            </p>
            <h1 className="mt-1.5 text-2xl font-bold">{m.candidateName}</h1>
            <p className="mt-0.5 text-sm text-navy-200">{m.position}</p>
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
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-bold text-navy-900">
            Against this role&rsquo;s target ranges
          </h2>
          <span className="text-sm text-navy-600">
            <strong className="text-navy-900">
              {a.inRange} of {a.requiredTotal}
            </strong>{" "}
            required dimensions fall inside range
            {a.optionalTotal > 0 && (
              <>
                {" "}
                · {a.optionalInRange} of {a.optionalTotal} optional
              </>
            )}
          </span>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-navy-500">
          A count, not a verdict. Ranges describe the pattern the role tends to
          call for — they are not a cut score, and nothing here recommends an
          outcome.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-bold text-navy-900">
            Lines up with the role
          </h2>
          {brief.alignsWith.length > 0 ? (
            <ul className="mt-2 divide-y divide-navy-50">
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

        <Card className="p-5">
          <h2 className="text-sm font-bold text-navy-900">Worth exploring</h2>
          {brief.probe.length > 0 ? (
            <ul className="mt-2 divide-y divide-navy-50">
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
        <Card className="p-5">
          <h2 className="text-sm font-bold text-navy-900">Ask these four</h2>
          <p className="mt-0.5 text-[12px] text-navy-500">
            Ask every candidate for this role the same questions, in the same
            order — that is what makes the answers comparable.
          </p>
          <ol className="mt-3 space-y-3">
            {brief.questions.map((q, i) => (
              <li key={q.question} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fsw-100 text-[11px] font-bold text-fsw-800">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[13px] font-medium leading-snug text-navy-900">
                    {q.question}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-navy-500">
                    <span className="font-semibold">Listen for:</span>{" "}
                    {q.listenFor}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-bold text-navy-900">
          How much weight to give this
        </h2>
        <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-navy-700">
          <p>
            <Badge tone={qualityTone}>Response quality</Badge>{" "}
            {brief.responseQuality}
          </p>
          <p>
            <Badge
              tone={
                brief.integrity.level === "NO_NOTABLE_EVENTS" ? "green" : "amber"
              }
            >
              Session integrity
            </Badge>{" "}
            {brief.integrity.label}.{" "}
            {brief.integrity.loggedEventCount > 0
              ? brief.integrity.loggedEventCount === 1
                ? "One session event was logged; the full report's integrity log names it."
                : `${brief.integrity.loggedEventCount} session events were logged; the full report's integrity log names them.`
              : "No session events were logged."}
          </p>
          {brief.concerns.length > 0 && (
            <p>
              <Badge tone="amber">Interview attention</Badge>{" "}
              {brief.concerns.map((c) => c.name).join(", ")} — flagged for
              additional interview attention, never as a disqualifier.
            </p>
          )}
          {brief.salesOverall && (
            <p>
              <Badge tone="blue">Sales pattern</Badge>{" "}
              {brief.salesOverall.label}
            </p>
          )}
          <p className="text-navy-500">{brief.bandTypeNote}</p>
        </div>
      </Card>

      <p className="rounded-xl border border-navy-200 bg-navy-50 p-4 text-[11.5px] leading-relaxed text-navy-600">
        {brief.disclaimer} This brief is a summary — the full report carries the
        dimension-by-dimension detail, the response-validity analysis, and the
        complete interview guide. Read it before making a decision.
      </p>
    </div>
  );
}
