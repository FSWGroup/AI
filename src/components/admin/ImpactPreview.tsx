"use client";

/**
 * Live impact preview for the benchmark editor.
 *
 * Shows, as the ranges are edited, how the proposed benchmark would screen
 * the candidates already assessed for this role — and, where voluntary
 * self-identification data exists, whether selection rates clear the
 * four-fifths screen from the Uniform Guidelines.
 *
 * The point is to make an over-restrictive benchmark visible at the moment
 * someone sets it, rather than in an audit a year later.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { Badge, Card } from "@/components/ui";
import { dimensionMeta } from "@/content/narratives/dimension-meta";

interface Rule {
  construct: string;
  minScore: number;
  maxScore: number;
  enabled: boolean;
  required: boolean;
}

interface PoolPreview {
  total: number;
  passing: number;
  passRate: number | null;
  limitingFactors: { construct: string; excluded: number }[];
}

interface GroupImpact {
  group: string;
  applicants: number;
  selected: number;
  selectionRate: number | null;
  impactRatio: number | null;
  status: "OK" | "BELOW_FOUR_FIFTHS" | "INSUFFICIENT_DATA" | "REFERENCE";
}

interface ImpactAnalysis {
  category: string;
  totalApplicants: number;
  groups: GroupImpact[];
  flagged: boolean;
  preliminary: boolean;
  notes: string[];
}

const GROUP_LABELS: Record<string, string> = {
  MALE: "Male",
  FEMALE: "Female",
  NON_BINARY: "Non-binary",
  HISPANIC_LATINO: "Hispanic or Latino",
  WHITE: "White",
  BLACK_AFRICAN_AMERICAN: "Black or African American",
  ASIAN: "Asian",
  NATIVE_HAWAIIAN_PACIFIC_ISLANDER: "Native Hawaiian or Pacific Islander",
  AMERICAN_INDIAN_ALASKA_NATIVE: "American Indian or Alaska Native",
  TWO_OR_MORE: "Two or more races",
};

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

export function ImpactPreview({
  jobProfileId,
  rules,
}: {
  jobProfileId: string;
  rules: Rule[];
}) {
  const [pool, setPool] = useState<PoolPreview | null>(null);
  const [impact, setImpact] = useState<ImpactAnalysis[] | null>(null);
  const [eeoEnabled, setEeoEnabled] = useState(false);
  const [coverage, setCoverage] = useState<{ withSelfId: number; total: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = JSON.stringify(
    rules.map((r) => [r.construct, r.minScore, r.maxScore, r.enabled, r.required]),
  );

  const run = useCallback(async () => {
    try {
      const res = await api<{
        pool: PoolPreview;
        impact: ImpactAnalysis[] | null;
        eeoCoverage: { withSelfId: number; total: number } | null;
        eeoEnabled: boolean;
      }>(`/api/admin/jobs/${jobProfileId}/impact-preview`, {
        body: {
          benchmarks: rules.map((r) => ({
            construct: r.construct,
            minScore: r.minScore,
            maxScore: r.maxScore,
            enabled: r.enabled,
            required: r.required,
          })),
        },
      });
      setPool(res.pool);
      setImpact(res.impact);
      setCoverage(res.eeoCoverage);
      setEeoEnabled(res.eeoEnabled);
      setError(null);
    } catch {
      setError("Could not calculate the preview.");
    } finally {
      setLoading(false);
    }
  }, [jobProfileId, rules]);

  // Debounce: the editor fires on every band click.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const requiredCount = rules.filter((r) => r.enabled && r.required).length;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-navy-900">Impact preview</h3>
          <p className="mt-1 text-xs text-navy-500">
            How these ranges would screen the {pool?.total ?? 0} candidate
            {pool?.total === 1 ? "" : "s"} already assessed for this role.
            Updates as you edit; nothing is saved until you press Save
            benchmark.
          </p>
        </div>
        {pool && pool.total > 0 && (
          <Badge
            tone={
              pool.passRate === null
                ? "neutral"
                : pool.passRate === 0
                  ? "red"
                  : pool.passRate < 0.15
                    ? "amber"
                    : "green"
            }
          >
            {pool.passing} of {pool.total} qualify ({pct(pool.passRate)})
          </Badge>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading && !pool && (
        <p className="mt-4 text-sm text-navy-400">Calculating…</p>
      )}

      {pool && pool.total === 0 && (
        <p className="mt-4 rounded-lg bg-navy-50 p-3 text-sm text-navy-600">
          No completed assessments for this role yet. Once candidates finish,
          this panel shows how the benchmark screens them — and flags ranges
          that nobody can meet.
        </p>
      )}

      {pool && pool.total > 0 && (
        <>
          {requiredCount === 0 && (
            <p className="mt-4 rounded-lg bg-navy-50 p-3 text-sm text-navy-600">
              No dimension is marked <strong>required</strong>, so the
              benchmark does not screen anyone. It still shapes the report&apos;s
              in-range/below/above indicators.
            </p>
          )}

          {requiredCount > 0 && pool.passing === 0 && (
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <strong>No assessed candidate meets these ranges.</strong> That
              usually means a required range is too narrow or set too high for
              what the job actually needs, rather than that the candidates are
              unsuitable.
            </p>
          )}

          {requiredCount > 0 && pool.limitingFactors.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                What is doing the screening
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {pool.limitingFactors.map((f) => {
                  const meta = dimensionMeta.find((d) => d.construct === f.construct);
                  return (
                    <li
                      key={f.construct}
                      className="flex items-center justify-between gap-3 rounded border border-navy-100 px-3 py-1.5"
                    >
                      <span className="text-navy-800">{meta?.name ?? f.construct}</span>
                      <span className="text-navy-500">
                        excludes {f.excluded} of {pool.total}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ---- Four-fifths analysis ---- */}
      <div className="mt-6 border-t border-navy-100 pt-5">
        <h4 className="text-sm font-bold text-navy-900">
          Adverse-impact screen (four-fifths rule)
        </h4>
        {!eeoEnabled ? (
          <p className="mt-2 rounded-lg bg-navy-50 p-3 text-xs text-navy-600">
            The compliance module is off, so no demographic data is collected
            and no impact ratios can be calculated. Enable it in Settings if
            FSW wants to monitor selection rates. It collects voluntary
            self-identification after the assessment is submitted, stores it
            apart from candidate records, and never shows it on any candidate
            page.
          </p>
        ) : impact === null ? (
          <p className="mt-2 rounded-lg bg-navy-50 p-3 text-xs text-navy-600">
            No candidate for this role has provided voluntary
            self-identification yet
            {coverage ? ` (0 of ${coverage.total} completed)` : ""}. Impact
            ratios appear once responses accumulate.
          </p>
        ) : (
          <div className="mt-3 space-y-5">
            {coverage && (
              <p className="text-xs text-navy-500">
                Based on {coverage.withSelfId} of {coverage.total} completed
                candidates who chose to self-identify.
              </p>
            )}
            {impact.map((a) => (
              <div key={a.category}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-navy-900">{a.category}</p>
                  <Badge
                    tone={a.preliminary ? "neutral" : a.flagged ? "red" : "green"}
                  >
                    {a.preliminary
                      ? "Preliminary"
                      : a.flagged
                        ? "Below four-fifths"
                        : "Clears four-fifths"}
                  </Badge>
                </div>
                <table className="mt-2 w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-navy-400">
                    <tr>
                      <th className="py-1">Group</th>
                      <th className="py-1">Assessed</th>
                      <th className="py-1">Qualify</th>
                      <th className="py-1">Rate</th>
                      <th className="py-1">Ratio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-50">
                    {a.groups.map((g) => (
                      <tr key={g.group}>
                        <td className="py-1.5 text-navy-800">
                          {GROUP_LABELS[g.group] ?? g.group}
                        </td>
                        <td className="py-1.5 text-navy-600">{g.applicants}</td>
                        <td className="py-1.5 text-navy-600">{g.selected}</td>
                        <td className="py-1.5 text-navy-600">{pct(g.selectionRate)}</td>
                        <td className="py-1.5">
                          {g.status === "INSUFFICIENT_DATA" ? (
                            <span className="text-xs text-navy-400">too few</span>
                          ) : g.status === "REFERENCE" ? (
                            <span className="text-xs text-navy-500">reference</span>
                          ) : (
                            <span
                              className={
                                g.status === "BELOW_FOUR_FIFTHS"
                                  ? "font-semibold text-red-700"
                                  : "text-navy-700"
                              }
                            >
                              {g.impactRatio?.toFixed(2)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {a.notes.map((n, i) => (
                  <p key={i} className="mt-2 text-xs text-navy-500">
                    {n}
                  </p>
                ))}
              </div>
            ))}
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              The four-fifths rule is a screen, not a verdict. A ratio below
              0.80 is a prompt to re-examine whether each required range is
              genuinely job-related — and a ratio above it is not a clean bill
              of health, particularly on small samples. Discuss results with
              counsel before acting on them.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
