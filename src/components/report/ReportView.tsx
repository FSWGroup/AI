/**
 * Full narrative report renderer. Server-safe; used by the admin web report
 * page and the print route that feeds PDF generation.
 *
 * The `print` flag switches to paginated, print-friendly styling.
 */

import type { ReportPayload } from "@/lib/report/generate";
import { ScoreScaleRow } from "@/components/admin/ScoreTable";
import { Badge, Card } from "@/components/ui";

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[13.5px] leading-relaxed text-navy-700">{children}</p>;
}

function SectionTitle({
  index,
  title,
}: {
  index: number;
  title: string;
}) {
  return (
    <div className="mt-10 border-b-2 border-navy-900 pb-2 first:mt-0 print:break-before-page print:first:break-before-auto">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-fsw-600">
        Section {index}
      </p>
      <h2 className="text-xl font-bold text-navy-900">{title}</h2>
    </div>
  );
}

export function ReportView({
  payload,
  print = false,
  includeIntegrity = true,
}: {
  payload: ReportPayload;
  print?: boolean;
  includeIntegrity?: boolean;
}) {
  const m = payload.meta;
  const aptitudes = payload.dimensions.filter((d) => d.category === "APTITUDE");
  const behavioral = payload.dimensions.filter((d) => d.category === "BEHAVIORAL");
  let sectionNo = 0;
  const next = () => ++sectionNo;

  return (
    <div className={print ? "report-print" : ""}>
      {/* ---- Cover / header ---- */}
      <div className="rounded-2xl bg-navy-900 p-8 text-white print:rounded-none">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-fsw-300">
          {m.company}
        </p>
        <h1 className="mt-2 text-3xl font-bold">FSW WorkFit Assessment Report</h1>
        <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <CoverItem label="Candidate" value={m.candidateName} />
          <CoverItem label="Position" value={m.position} />
          <CoverItem
            label="Assessment date"
            value={
              m.completedAt
                ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
                    new Date(m.completedAt),
                  )
                : "—"
            }
          />
          <CoverItem
            label="Version"
            value={`${m.assessmentVersionName} · report v${m.reportVersion}`}
          />
        </div>
        <p className="mt-6 text-xs text-navy-300">
          CONFIDENTIAL — for authorized hiring personnel only. {m.bandTypeNote}
        </p>
      </div>

      {/* ---- 1. Executive summary ---- */}
      <SectionTitle index={next()} title="Executive Summary" />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-sm font-bold text-navy-900">Strongest alignment</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-navy-700">
            {payload.executiveSummary.strongestAlignment.map((s) => (
              <li key={s.construct} className="flex items-center justify-between">
                <span>{s.name}</span>
                <Badge tone="green">{s.band}</Badge>
              </li>
            ))}
            {payload.executiveSummary.strongestAlignment.length === 0 && (
              <li className="text-navy-400">
                No required dimensions fell inside the desired range.
              </li>
            )}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-bold text-navy-900">Investigate in the interview</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-navy-700">
            {payload.executiveSummary.investigate.map((s) => (
              <li key={`${s.construct}`}>
                <span className="font-semibold">{s.name}:</span> {s.reason}
              </li>
            ))}
            {payload.executiveSummary.investigate.length === 0 && (
              <li className="text-navy-400">No specific follow-ups were flagged.</li>
            )}
          </ul>
        </Card>
      </div>
      <Card className="mt-4 p-5">
        <h3 className="text-sm font-bold text-navy-900">Response quality</h3>
        <P>{payload.executiveSummary.responseQuality}</P>
      </Card>
      {payload.concerns.length > 0 && (
        <Card className="mt-4 border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-bold text-amber-900">
            Additional Interview Attention Recommended
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {payload.concerns.map((c) => (
              <li key={c.construct}>
                {c.name} scored {c.band}. This does not disqualify the candidate;
                explore it directly in the interview.
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-4 rounded-lg bg-navy-50 p-4 text-xs leading-relaxed text-navy-500">
        {payload.executiveSummary.disclaimer}
      </p>

      {/* ---- 2. Mental aptitudes ---- */}
      <SectionTitle index={next()} title="Mental Aptitude Results" />
      {aptitudes.map((d) => (
        <DimensionBlock key={d.construct} d={d} />
      ))}

      {/* ---- 3. Behavioral ---- */}
      <SectionTitle index={next()} title="Performance & Behavioral Results" />
      {behavioral.map((d) => (
        <DimensionBlock key={d.construct} d={d} />
      ))}

      {/* ---- 4. Response validity ---- */}
      <SectionTitle index={next()} title="Response Validity" />
      <p className="mt-3 text-xs text-navy-500">
        These are response-quality indicators, shown separately from job-fit
        dimensions. They are never proof of dishonesty and never change trait
        scores; they calibrate how much confidence to place in the results.
      </p>
      {payload.validity.map((v) => (
        <Card key={v.construct} className="mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-navy-900">{v.name}</h3>
            <Badge tone={v.level === "NORMAL" ? "green" : v.level === "ELEVATED" ? "amber" : "red"}>
              {v.level === "NORMAL" ? "Typical" : v.level === "ELEVATED" ? "Elevated" : "Clearly elevated"}
            </Badge>
          </div>
          <P>{v.narrative}</P>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-navy-500">
              Why this indicator was set (raw measurements)
            </summary>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-navy-600 sm:grid-cols-3">
              {Object.entries(v.detail)
                .filter(([k, val]) => typeof val !== "object" && k !== "level")
                .map(([k, val]) => (
                  <div key={k} className="rounded bg-navy-50 p-2">
                    <dt className="font-mono text-[10px] text-navy-400">{k}</dt>
                    <dd className="font-semibold">{String(val)}</dd>
                  </div>
                ))}
            </dl>
          </details>
        </Card>
      ))}

      {/* ---- 5. Score sheet ---- */}
      <SectionTitle index={next()} title="Score Sheet" />
      <ScoreSheet payload={payload} />

      {/* ---- 6. Sales / leadership analysis ---- */}
      {payload.salesTraits && (
        <>
          <SectionTitle index={next()} title="Sales Traits Analysis" />
          <div className="mt-4 space-y-3">
            {payload.salesTraits.composites.map((c) => (
              <Card key={c.key} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-navy-900">{c.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-navy-900">{c.band}</span>
                    <Badge
                      tone={
                        c.classification === "STRONG_ALIGNMENT"
                          ? "green"
                          : c.classification === "GENERALLY_ALIGNED"
                            ? "blue"
                            : c.classification === "MIXED_ALIGNMENT"
                              ? "amber"
                              : "red"
                      }
                    >
                      {c.classificationLabel}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-navy-400">
                  Formula:{" "}
                  {c.components
                    .map((comp) => `${comp.construct} (×${comp.weight})`)
                    .join(" + ")}
                </p>
              </Card>
            ))}
          </div>
          <Card className="mt-4 p-5">
            <h3 className="text-sm font-bold text-navy-900">Sales potential summary</h3>
            <p className="mt-2 text-sm">
              Overall pattern:{" "}
              <span className="font-bold">{payload.salesTraits.overallLabel}</span>
            </p>
            {payload.salesTraits.strengths.length > 0 && (
              <P>
                Apparent strengths: {payload.salesTraits.strengths.join(", ")}.
              </P>
            )}
            {payload.salesTraits.exploration.length > 0 && (
              <P>
                Worth further exploration or development:{" "}
                {payload.salesTraits.exploration.join(", ")}.
              </P>
            )}
            <p className="mt-3 text-xs text-navy-400">
              This is a qualitative composite view of assessment results — not a
              prediction of sales success, and never a basis for automatic
              rejection.
            </p>
          </Card>
        </>
      )}
      {payload.leadership && (
        <>
          <SectionTitle index={next()} title="Leadership Analysis" />
          <div className="mt-4 space-y-3">
            {payload.leadership.composites.map((c) => (
              <Card key={c.key} className="p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-navy-900">{c.name}</h3>
                  <span className="text-lg font-bold text-navy-900">{c.band}</span>
                </div>
                <p className="mt-1 text-xs text-navy-400">
                  Formula:{" "}
                  {c.components
                    .map((comp) => `${comp.construct} (×${comp.weight})`)
                    .join(" + ")}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ---- 7. Interview guide ---- */}
      <SectionTitle index={next()} title="Targeted Interview Guide" />
      {payload.interviewGuide.map((g) => (
        <Card key={`${g.construct}-${g.focus}`} className="mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-navy-900">{g.name}</h3>
            <Badge tone={g.focus === "VALIDITY" ? "amber" : "blue"}>
              {g.focus === "BELOW_RANGE"
                ? "Below desired range"
                : g.focus === "ABOVE_RANGE"
                  ? "Above desired range"
                  : "Response quality"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-navy-500">{g.reason}</p>
          <p className="mt-2 text-xs font-medium text-navy-600">{g.measures}</p>
          <ol className="mt-3 space-y-4">
            {g.questions.map((q, i) => (
              <li key={i} className="rounded-lg bg-navy-50 p-4">
                <p className="text-sm font-semibold text-navy-900">
                  {i + 1}. {q.question}
                </p>
                <p className="mt-2 text-xs text-navy-500">
                  <span className="font-semibold">Limited work history:</span>{" "}
                  {q.altWording}
                </p>
                <p className="mt-2 text-xs text-fsw-800">
                  <span className="font-semibold">Interviewer guide — listen for:</span>{" "}
                  {q.listenFor}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      ))}
      {payload.interviewGuide.length === 0 && (
        <P>No targeted follow-ups were selected for this candidate.</P>
      )}

      {/* ---- 8. Development ---- */}
      <SectionTitle index={next()} title="Development Suggestions" />
      {payload.development.map((d) => (
        <Card key={d.construct} className="mt-4 p-5">
          <h3 className="text-sm font-bold text-navy-900">{d.name}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-navy-700">
            {d.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Card>
      ))}
      {payload.development.length === 0 && (
        <P>
          No development sections were generated — no measured dimension fell
          meaningfully below the desired range.
        </P>
      )}

      {/* ---- 9. Integrity appendix (employer only) ---- */}
      {includeIntegrity && (
        <>
          <SectionTitle index={next()} title="Assessment Integrity (Employer Appendix)" />
          <Card className="mt-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-navy-900">Summary</h3>
              <Badge
                tone={
                  payload.integrity.level === "NO_NOTABLE_EVENTS"
                    ? "green"
                    : payload.integrity.level === "MINOR_REVIEW_RECOMMENDED"
                      ? "amber"
                      : "red"
                }
              >
                {payload.integrity.label}
              </Badge>
            </div>
            {payload.integrity.notableCounts.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm text-navy-700">
                {payload.integrity.notableCounts.map((c) => (
                  <li key={c.type}>
                    <span className="font-mono text-xs font-semibold">{c.type}</span> ×{" "}
                    {c.count}
                  </li>
                ))}
              </ul>
            ) : (
              <P>No notable objective events were recorded.</P>
            )}
            <p className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-900">
              {payload.integrity.reviewReminder} Integrity information never
              affects assessment scores; a human decides whether follow-up is
              needed.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function CoverItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-navy-400">
        {label}
      </p>
      <p className="mt-0.5 font-semibold">{value}</p>
    </div>
  );
}

function DimensionBlock({
  d,
}: {
  d: ReportPayload["dimensions"][number];
}) {
  return (
    <Card className="mt-4 p-5 print:break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-navy-900">{d.name}</h3>
        <div className="flex items-center gap-2">
          {d.benchmark && (
            <span className="text-xs text-navy-400">
              Desired {d.benchmark.min}–{d.benchmark.max}
            </span>
          )}
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-white">
            {d.band}
          </span>
          {d.position && (
            <Badge tone={d.position === "WITHIN" ? "green" : d.position === "BELOW" ? "amber" : "blue"}>
              {d.position === "WITHIN" ? "In range" : d.position === "BELOW" ? "Below range" : "Above range"}
            </Badge>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs italic text-navy-400">{d.shortDefinition}</p>
      <P>{d.narrative}</P>
      {d.rangeNarrative && <P>{d.rangeNarrative}</P>}
      {d.benchmark?.note && (
        <p className="mt-2 text-xs text-navy-400">Role note: {d.benchmark.note}</p>
      )}
    </Card>
  );
}

function ScoreSheet({ payload }: { payload: ReportPayload }) {
  const groups: { title: string; dims: ReportPayload["dimensions"] }[] = [
    {
      title: "Mental Aptitudes",
      dims: payload.dimensions.filter((d) => d.category === "APTITUDE"),
    },
    {
      title: "Performance Scales",
      dims: payload.dimensions.filter((d) => d.category === "BEHAVIORAL"),
    },
  ];
  return (
    <div className="mt-4 space-y-5">
      {groups.map((g) => (
        <Card key={g.title} className="p-5 print:break-inside-avoid">
          <h3 className="text-xs font-bold uppercase tracking-wide text-navy-500">
            {g.title}
          </h3>
          <div className="mt-1 divide-y divide-navy-50">
            {g.dims.map((d) => (
              <ScoreScaleRow
                key={d.construct}
                construct={d.construct}
                band={d.band}
                benchmark={
                  d.benchmark
                    ? {
                        construct: d.construct,
                        minScore: d.benchmark.min,
                        maxScore: d.benchmark.max,
                        enabled: true,
                      }
                    : null
                }
              />
            ))}
          </div>
        </Card>
      ))}
      <Card className="p-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-navy-500">
          Response Validity
        </h3>
        <div className="mt-1 divide-y divide-navy-50">
          {payload.validity.map((v) => (
            <ScoreScaleRow key={v.construct} construct={v.construct} band={v.band} benchmark={null} />
          ))}
        </div>
      </Card>
      <p className="text-xs text-navy-500">
        Legend: shaded band = desired range for this role · dark marker =
        candidate score · validity scales are response-quality indicators, not
        job-fit dimensions. Scores above the desired range are not
        automatically better.
      </p>
    </div>
  );
}
