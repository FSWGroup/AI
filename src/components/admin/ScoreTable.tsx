/**
 * The one-page 1-9 score sheet: low/high descriptors, desired-range band,
 * candidate marker, and within/below/above indicator. Server-safe component
 * (also used by the print report).
 */

import { dimensionMeta } from "@/content/narratives/dimension-meta";
import {
  APTITUDE_CONSTRUCTS,
  BEHAVIORAL_CONSTRUCTS,
  VALIDITY_CONSTRUCTS,
} from "@/content/types";
import { Badge, Card } from "@/components/ui";
import {
  POSITION_LABEL,
  POSITION_TONE,
  classifyAgainstRange,
} from "@/lib/scoring/benchmark";

export interface ScoreRow {
  construct: string;
  band: number;
  bandType: string;
  rawScore?: number;
  scaledScore?: number;
}

export interface BenchmarkRow {
  construct: string;
  minScore: number;
  maxScore: number;
  enabled: boolean;
}

export function ScoreScaleRow({
  construct,
  band,
  benchmark,
}: {
  construct: string;
  band: number;
  benchmark: BenchmarkRow | null;
}) {
  const meta = dimensionMeta.find((d) => d.construct === construct);
  const position =
    benchmark && benchmark.enabled
      ? classifyAgainstRange(band, benchmark)
      : null;

  return (
    <div className="grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[10rem_7rem_1fr_7rem_6rem]">
      <p className="text-sm font-semibold text-navy-900">{meta?.name ?? construct}</p>
      <p className="text-right text-xs text-navy-400 sm:pr-3">{meta?.lowDescriptor}</p>
      <div className="relative flex items-center justify-between rounded-full bg-navy-50 px-2 py-1.5">
        {benchmark && benchmark.enabled && (
          <div
            aria-hidden
            className="absolute top-0 bottom-0 rounded-full bg-fsw-100 ring-1 ring-inset ring-fsw-200"
            style={{
              left: `${((benchmark.minScore - 1) / 9) * 100}%`,
              width: `${((benchmark.maxScore - benchmark.minScore + 1) / 9) * 100}%`,
            }}
          />
        )}
        {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              n === band
                ? "bg-navy-900 text-white shadow"
                : "text-navy-400"
            }`}
            aria-label={n === band ? `Candidate score ${n}` : undefined}
          >
            {n}
          </span>
        ))}
      </div>
      <p className="text-xs text-navy-400 sm:pl-3">{meta?.highDescriptor}</p>
      <div className="sm:text-right">
        {position && (
          <Badge tone={POSITION_TONE[position]}>{POSITION_LABEL[position]}</Badge>
        )}
      </div>
    </div>
  );
}

export function ScoreTable({
  scores,
  benchmarks,
}: {
  scores: ScoreRow[];
  benchmarks: BenchmarkRow[];
}) {
  const bmFor = (c: string) => benchmarks.find((b) => b.construct === c) ?? null;
  const scoreFor = (c: string) => scores.find((s) => s.construct === c);
  const provisional = scores.some((s) => s.bandType === "PROVISIONAL");

  if (scores.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-navy-400">
        Scores appear when the assessment is completed.
      </Card>
    );
  }

  const group = (title: string, keys: readonly string[]) => {
    const rows = keys
      .map((k) => ({ key: k, score: scoreFor(k) }))
      .filter((r) => r.score);
    if (rows.length === 0) return null;
    return (
      <Card className="p-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-navy-500">
          {title}
        </h3>
        <div className="mt-2 divide-y divide-navy-50">
          {rows.map((r) => (
            <ScoreScaleRow
              key={r.key}
              construct={r.key}
              band={r.score!.band}
              benchmark={title === "Response Validity" ? null : bmFor(r.key)}
            />
          ))}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {group("Mental Aptitudes", APTITUDE_CONSTRUCTS)}
      {group("Performance Scales", BEHAVIORAL_CONSTRUCTS)}
      {group("Response Validity", VALIDITY_CONSTRUCTS)}
      <Card className="p-4 text-xs text-navy-500">
        <p className="font-semibold text-navy-700">Legend</p>
        <p className="mt-1">
          The shaded band shows the desired range for this role. The dark
          marker is the candidate&apos;s 1-9 score. Scores above the desired
          range are not automatically better — see the narrative report.
          Response-validity scales are response-quality indicators, not
          job-fit dimensions.
          {provisional &&
            " Scores are provisional internal 1-9 bands; validated stanines apply once norm tables are installed."}
        </p>
      </Card>
    </div>
  );
}
