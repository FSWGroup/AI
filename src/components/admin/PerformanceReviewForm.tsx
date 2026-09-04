"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, ErrorText, Textarea } from "@/components/ui";
import type { PerformanceCriterion } from "@/content/performance-criteria";

interface Initial {
  overallRating: number | null;
  wouldRehire: boolean | null;
  comment: string | null;
  ratings: Record<string, number>;
}

export function PerformanceReviewForm({
  hireId,
  cycleId,
  candidateName,
  jobTitle,
  hiredAt,
  cycleName,
  instructions,
  criteria,
  initial,
}: {
  hireId: string;
  cycleId: string;
  candidateName: string;
  jobTitle: string;
  hiredAt: string;
  cycleName: string;
  instructions: string | null;
  criteria: PerformanceCriterion[];
  initial: Initial | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>(initial?.ratings ?? {});
  const [overall, setOverall] = useState<number | null>(initial?.overallRating ?? null);
  const [rehire, setRehire] = useState<boolean | null>(initial?.wouldRehire ?? null);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = overall !== null && criteria.every((c) => ratings[c.key] !== undefined);

  const save = async (submit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/performance/reviews", {
        method: "POST",
        body: {
          hireId,
          cycleId,
          overallRating: overall,
          wouldRehire: rehire,
          comment: comment || null,
          ratings: Object.entries(ratings).map(([criterionKey, value]) => ({
            criterionKey,
            value,
          })),
          submit,
        },
      });
      router.refresh();
      if (submit) setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the review.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold text-navy-900">{candidateName}</p>
          <p className="text-sm text-navy-500">
            {jobTitle} · hired {hiredAt} · {cycleName}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "Collapse" : initial ? "Continue draft" : "Start review"}
        </Button>
      </div>

      {open && (
        <div className="mt-5 border-t border-navy-100 pt-5">
          {instructions && (
            <p className="mb-4 rounded-lg bg-navy-50 p-3 text-sm text-navy-700">
              {instructions}
            </p>
          )}

          {criteria.map((c) => (
            <div key={c.key} className="mb-5">
              <p className="text-sm font-semibold text-navy-900">{c.label}</p>
              <p className="text-xs text-navy-500">{c.definition}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setRatings((prev) => ({ ...prev, [c.key]: v }))}
                    className={
                      ratings[c.key] === v
                        ? "rounded-lg bg-fsw-600 px-3 py-1.5 text-sm font-semibold text-white"
                        : "rounded-lg border border-navy-200 px-3 py-1.5 text-sm font-semibold text-navy-700 hover:bg-navy-50"
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
              <dl className="mt-2 space-y-0.5 text-xs text-navy-500">
                {c.anchors.map((a) => (
                  <div key={a.value} className="flex gap-2">
                    <dt className="w-3 shrink-0 font-semibold text-navy-600">{a.value}</dt>
                    <dd>{a.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}

          <div className="mb-5 border-t border-navy-100 pt-4">
            <p className="text-sm font-semibold text-navy-900">Overall effectiveness</p>
            <p className="text-xs text-navy-500">
              Your own judgement of how well this person is doing the job. Rate
              it directly rather than averaging the rows above — an independent
              judgement carries information a mechanical average does not.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setOverall(v)}
                  className={
                    overall === v
                      ? "rounded-lg bg-fsw-600 px-3 py-1.5 text-sm font-semibold text-white"
                      : "rounded-lg border border-navy-200 px-3 py-1.5 text-sm font-semibold text-navy-700 hover:bg-navy-50"
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-5">
            <p className="text-sm font-semibold text-navy-900">
              Knowing what you know now, would you hire this person again?
            </p>
            <div className="mt-2 flex gap-2">
              {[
                { label: "Yes", value: true },
                { label: "No", value: false },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setRehire(o.value)}
                  className={
                    rehire === o.value
                      ? "rounded-lg bg-fsw-600 px-4 py-1.5 text-sm font-semibold text-white"
                      : "rounded-lg border border-navy-200 px-4 py-1.5 text-sm font-semibold text-navy-700 hover:bg-navy-50"
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <p className="text-sm font-semibold text-navy-900">Comments (optional)</p>
            <Textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mt-1"
            />
          </div>

          {error && <ErrorText className="mb-3">{error}</ErrorText>}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" disabled={busy} onClick={() => save(false)}>
              Save draft
            </Button>
            <Button disabled={busy || !complete} onClick={() => save(true)}>
              {busy ? "Saving…" : "Submit review"}
            </Button>
            {!complete && (
              <span className="self-center text-xs text-navy-500">
                Every criterion and the overall rating are needed before submitting.
              </span>
            )}
          </div>
          <p className="mt-3 text-xs text-navy-500">
            Once submitted this cannot be edited.
          </p>
        </div>
      )}
    </Card>
  );
}
