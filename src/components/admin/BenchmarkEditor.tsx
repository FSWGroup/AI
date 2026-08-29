"use client";

/**
 * Visual benchmark editor: for each dimension, select the desired 1-9 range
 * by clicking band numbers (first click sets min, second sets max), plus
 * required/optional/disabled, weight, and an explanatory note.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { dimensionMeta } from "@/content/narratives/dimension-meta";
import { Button, Card, Input } from "@/components/ui";
import {
  JobDescriptionPanel,
  type ProposedDimension,
} from "@/components/admin/JobDescriptionPanel";
import { ImpactPreview } from "@/components/admin/ImpactPreview";

interface BenchmarkRow {
  construct: string;
  minScore: number;
  maxScore: number;
  required: boolean;
  enabled: boolean;
  weight: number;
  note: string | null;
}

interface ConcernRow {
  construct: string;
  maxBand: number;
  enabled: boolean;
}

const SCOREABLE = dimensionMeta.filter((d) => d.category !== "VALIDITY");
const BEHAVIORAL = dimensionMeta
  .filter((d) => d.category === "BEHAVIORAL")
  .map((d) => d.construct as string);

export function BenchmarkEditor({
  jobProfileId,
  readOnly,
  initialBenchmarks,
  initialConcernRules,
  jobDescription,
  aiConfigured,
  tailoredFormName,
}: {
  jobProfileId: string;
  readOnly: boolean;
  initialBenchmarks: BenchmarkRow[];
  initialConcernRules: ConcernRow[];
  jobDescription: string;
  aiConfigured: boolean;
  tailoredFormName: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<BenchmarkRow[]>(() =>
    SCOREABLE.map((d) => {
      const existing = initialBenchmarks.find((b) => b.construct === d.construct);
      return (
        existing ?? {
          construct: d.construct as string,
          minScore: 4,
          maxScore: 6,
          required: false,
          enabled: false,
          weight: 1,
          note: null,
        }
      );
    }),
  );
  const [concerns, setConcerns] = useState<ConcernRow[]>(() =>
    BEHAVIORAL.map((c) => {
      const existing = initialConcernRules.find((r) => r.construct === c);
      return existing ?? { construct: c, maxBand: 2, enabled: false };
    }),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function update(construct: string, patch: Partial<BenchmarkRow>): void {
    setRows((prev) =>
      prev.map((r) => (r.construct === construct ? { ...r, ...patch } : r)),
    );
  }

  function clickBand(row: BenchmarkRow, band: number): void {
    if (readOnly) return;
    if (band < row.minScore) update(row.construct, { minScore: band });
    else if (band > row.maxScore) update(row.construct, { maxScore: band });
    else {
      // Inside the range: move the nearer edge to the clicked band.
      const distMin = band - row.minScore;
      const distMax = row.maxScore - band;
      if (distMin <= distMax) update(row.construct, { minScore: band });
      else update(row.construct, { maxScore: band });
    }
  }

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/admin/jobs/${jobProfileId}/benchmarks`, {
        method: "PUT",
        body: { benchmarks: rows, concernRules: concerns },
      });
      setMessage("Saved. Changes are recorded in the audit log.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  /** Load an AI proposal into the editor. Nothing is saved until the admin
   *  reviews the ranges and presses Save benchmark. */
  function applyProposal(proposed: ProposedDimension[]): void {
    setRows((prev) =>
      prev.map((r) => {
        const p = proposed.find((d) => d.construct === r.construct);
        if (!p) return r;
        return {
          ...r,
          enabled: p.enabled,
          required: p.enabled && p.required,
          minScore: Math.min(p.minScore, p.maxScore),
          maxScore: Math.max(p.minScore, p.maxScore),
          weight: p.weight,
          note: p.rationale.slice(0, 500),
        };
      }),
    );
    if (typeof window !== "undefined") {
      window.scrollTo({ top: window.scrollY + 200, behavior: "smooth" });
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <JobDescriptionPanel
        jobProfileId={jobProfileId}
        initialJobDescription={jobDescription}
        aiConfigured={aiConfigured}
        readOnly={readOnly}
        tailoredFormName={tailoredFormName}
        onApplyProposal={applyProposal}
      />

      <ImpactPreview
        jobProfileId={jobProfileId}
        rules={rows.map((r) => ({
          construct: r.construct,
          minScore: r.minScore,
          maxScore: r.maxScore,
          enabled: r.enabled,
          required: r.required,
        }))}
      />

      {message && (
        <p role="status" className="rounded-lg bg-fsw-50 p-3 text-sm text-fsw-900">
          {message}
        </p>
      )}
      {(["APTITUDE", "BEHAVIORAL"] as const).map((cat) => (
        <Card key={cat} className="p-6">
          <h3 className="text-xs font-bold uppercase tracking-wide text-navy-500">
            {cat === "APTITUDE" ? "Mental Aptitudes" : "Performance Scales"}
          </h3>
          <div className="mt-2 divide-y divide-navy-50">
            {SCOREABLE.filter((d) => d.category === cat).map((d) => {
              const row = rows.find((r) => r.construct === d.construct)!;
              return (
                <div key={d.construct} className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-navy-900">{d.name}</p>
                      <p className="text-xs text-navy-400">
                        {d.lowDescriptor} ↔ {d.highDescriptor}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-fsw-600"
                          disabled={readOnly}
                          checked={row.enabled}
                          onChange={(e) =>
                            update(row.construct, { enabled: e.target.checked })
                          }
                        />
                        Enabled
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-fsw-600"
                          disabled={readOnly || !row.enabled}
                          checked={row.required}
                          onChange={(e) =>
                            update(row.construct, { required: e.target.checked })
                          }
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-1.5">
                        Weight
                        <input
                          type="number"
                          step={0.5}
                          min={0}
                          max={5}
                          className="w-16 rounded border border-navy-200 px-1.5 py-0.5"
                          disabled={readOnly || !row.enabled}
                          value={row.weight}
                          onChange={(e) =>
                            update(row.construct, { weight: Number(e.target.value) })
                          }
                          aria-label={`${d.name} weight`}
                        />
                      </label>
                    </div>
                  </div>
                  <div
                    className={`mt-3 flex max-w-md items-center gap-1 ${
                      row.enabled ? "" : "opacity-30"
                    }`}
                    role="group"
                    aria-label={`${d.name} desired range ${row.minScore} to ${row.maxScore}`}
                  >
                    {Array.from({ length: 9 }, (_, i) => i + 1).map((band) => {
                      const inRange = band >= row.minScore && band <= row.maxScore;
                      return (
                        <button
                          key={band}
                          type="button"
                          disabled={readOnly || !row.enabled}
                          onClick={() => clickBand(row, band)}
                          className={`h-9 w-9 rounded-lg text-sm font-bold transition-colors ${
                            inRange
                              ? "bg-fsw-600 text-white"
                              : "bg-navy-100 text-navy-500 hover:bg-navy-200"
                          }`}
                          aria-pressed={inRange}
                          aria-label={`Band ${band}${inRange ? " (in desired range)" : ""}`}
                        >
                          {band}
                        </button>
                      );
                    })}
                    <span className="ml-3 text-sm font-semibold text-navy-700">
                      {row.minScore}–{row.maxScore}
                    </span>
                  </div>
                  {row.enabled && (
                    <Input
                      className="mt-3 max-w-md text-xs"
                      placeholder="Explanatory note for this dimension (optional)"
                      disabled={readOnly}
                      value={row.note ?? ""}
                      onChange={(e) =>
                        update(row.construct, { note: e.target.value || null })
                      }
                      aria-label={`${d.name} note`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      <Card className="p-6">
        <h3 className="text-xs font-bold uppercase tracking-wide text-navy-500">
          Areas of Concern (configurable rules)
        </h3>
        <p className="mt-1 text-xs text-navy-400">
          When enabled, a score at or below the threshold flags &ldquo;Additional
          Interview Attention Recommended&rdquo; on the report. Never an automatic
          failure.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {concerns.map((c) => {
            const meta = dimensionMeta.find((d) => d.construct === c.construct);
            return (
              <label
                key={c.construct}
                className="flex items-center justify-between gap-2 rounded-lg border border-navy-100 p-3 text-sm"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-fsw-600"
                    disabled={readOnly}
                    checked={c.enabled}
                    onChange={(e) =>
                      setConcerns((prev) =>
                        prev.map((x) =>
                          x.construct === c.construct
                            ? { ...x, enabled: e.target.checked }
                            : x,
                        ),
                      )
                    }
                  />
                  {meta?.name ?? c.construct}
                </span>
                <span className="flex items-center gap-1 text-xs text-navy-500">
                  flag at ≤
                  <input
                    type="number"
                    min={1}
                    max={9}
                    className="w-14 rounded border border-navy-200 px-1.5 py-0.5"
                    disabled={readOnly || !c.enabled}
                    value={c.maxBand}
                    onChange={(e) =>
                      setConcerns((prev) =>
                        prev.map((x) =>
                          x.construct === c.construct
                            ? { ...x, maxBand: Number(e.target.value) }
                            : x,
                        ),
                      )
                    }
                    aria-label={`${meta?.name} concern threshold`}
                  />
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      {!readOnly && (
        <Button disabled={busy} onClick={() => void save()}>
          Save benchmark
        </Button>
      )}
    </div>
  );
}
