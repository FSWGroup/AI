"use client";

/**
 * Writing an independent review.
 *
 * Structurally the same as an interview scorecard, because the discipline is
 * the same: a rating with no evidence behind it is a preference, and a
 * preference is where bias hides.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Textarea } from "@/components/ui";
import { RATING_LABEL, RECOMMENDATION_LABEL } from "@/lib/ats/scorecards";

type Recommendation = "STRONG_NO" | "NO" | "YES" | "STRONG_YES";
const RECOMMENDATIONS: Recommendation[] = ["STRONG_NO", "NO", "YES", "STRONG_YES"];

interface Criterion {
  criterionName: string;
  definition: string | null;
  rating: number | null;
  note: string | null;
}

export function ReviewForm({
  reviewId,
  candidateName,
  applicationId,
  blind,
  initialCriteria,
  initialRecommendation,
  initialSummary,
  submitted,
}: {
  reviewId: string;
  candidateName: string;
  applicationId: string;
  blind: boolean;
  initialCriteria: Criterion[];
  initialRecommendation: Recommendation | null;
  initialSummary: string | null;
  submitted: boolean;
}) {
  const router = useRouter();
  const [criteria, setCriteria] = useState(initialCriteria);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    initialRecommendation,
  );
  const [summary, setSummary] = useState(initialSummary ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function update(name: string, patch: Partial<Criterion>): void {
    setCriteria((prev) =>
      prev.map((c) => (c.criterionName === name ? { ...c, ...patch } : c)),
    );
  }

  async function send(action: "save" | "submit"): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/admin/reviews/${reviewId}`, {
        body: {
          action,
          recommendation,
          summary,
          ratings: criteria.map((c) => ({
            criterionName: c.criterionName,
            rating: c.rating,
            note: c.note,
          })),
        },
      });
      if (action === "submit") {
        router.push(`/admin/recruiting/applications/${applicationId}`);
      } else {
        setMessage("Saved as a draft.");
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <Card className="p-6">
        <h2 className="text-sm font-bold text-navy-900">Your review is filed</h2>
        <p className="mt-2 text-sm text-navy-600">
          {recommendation ? RECOMMENDATION_LABEL[recommendation] : "Filed"}. Filed
          reviews are sealed so the panel&rsquo;s judgements stay independent.
        </p>
        {summary && (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-navy-700">
            {summary}
          </p>
        )}
        <Link
          href={`/admin/recruiting/applications/${applicationId}`}
          className="mt-4 inline-block text-sm font-semibold text-fsw-700 hover:underline"
        >
          See the rest of the panel →
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <p role="status" className="rounded-lg bg-fsw-50 p-3 text-sm text-fsw-900">
          {message}
        </p>
      )}

      {blind && (
        <Card className="border-fsw-200 bg-fsw-50 p-4">
          <p className="text-sm leading-relaxed text-navy-800">
            This round is blind. You will see everyone else&rsquo;s review once
            you file yours — form your own view first.
          </p>
        </Card>
      )}

      {criteria.length > 0 && (
        <Card className="p-6">
          <h2 className="text-sm font-bold text-navy-900">
            Rate {candidateName}
          </h2>
          <div className="mt-4 space-y-5">
            {criteria.map((c) => (
              <div key={c.criterionName}>
                <p className="text-sm font-semibold text-navy-900">
                  {c.criterionName}
                </p>
                {c.definition && (
                  <p className="mt-0.5 text-xs leading-relaxed text-navy-500">
                    {c.definition}
                  </p>
                )}
                <div
                  className="mt-2 flex flex-wrap gap-1.5"
                  role="group"
                  aria-label={`${c.criterionName} rating`}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => update(c.criterionName, { rating: n })}
                      aria-pressed={c.rating === n}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                        c.rating === n
                          ? "bg-navy-900 text-white"
                          : "bg-navy-100 text-navy-600 hover:bg-navy-200"
                      }`}
                    >
                      {n} — {RATING_LABEL[n]}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => update(c.criterionName, { rating: null })}
                    aria-pressed={c.rating == null}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      c.rating == null
                        ? "bg-navy-200 text-navy-800"
                        : "bg-navy-50 text-navy-500 hover:bg-navy-100"
                    }`}
                  >
                    Not assessed
                  </button>
                </div>
                <Textarea
                  className="mt-2 text-sm"
                  rows={2}
                  placeholder="What in the record supports that?"
                  value={c.note ?? ""}
                  onChange={(e) => update(c.criterionName, { note: e.target.value })}
                  aria-label={`${c.criterionName} evidence`}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="text-sm font-bold text-navy-900">Your recommendation</h2>
        <p className="mt-1 text-xs leading-relaxed text-navy-500">
          No middle option, deliberately. If you are torn, pick the side you
          would defend and explain why below.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {RECOMMENDATIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRecommendation(r)}
              aria-pressed={recommendation === r}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                recommendation === r
                  ? r.includes("YES")
                    ? "bg-emerald-600 text-white"
                    : "bg-amber-600 text-white"
                  : "bg-navy-100 text-navy-700 hover:bg-navy-200"
              }`}
            >
              {RECOMMENDATION_LABEL[r]}
            </button>
          ))}
        </div>
        <Textarea
          className="mt-4 text-sm"
          rows={5}
          placeholder="Your reasoning, with specifics from the application, assessment or interviews."
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-label="Rationale"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void send("submit")}>
            File my review
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void send("save")}>
            Save draft
          </Button>
        </div>
        <p className="mt-2 text-xs text-navy-400">
          Filing seals it, and unlocks everyone else&rsquo;s.
        </p>
      </Card>
    </div>
  );
}
