"use client";

/**
 * The interviewer's scorecard.
 *
 * Four points, no midpoint, and a written rationale required before it can be
 * submitted. Both constraints exist for the same reason: an evaluation that
 * lets you avoid committing, or commit without saying why, tells the hiring
 * manager nothing they could not have guessed.
 *
 * Once submitted it is sealed. Editing after hearing the panel is not an
 * independent evaluation, and independence is the entire reason these are
 * collected separately.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card, Textarea } from "@/components/ui";
import { RATING_LABEL, RECOMMENDATION_LABEL } from "@/lib/ats/scorecards";

type Recommendation = "STRONG_NO" | "NO" | "YES" | "STRONG_YES";

const RECOMMENDATIONS: Recommendation[] = ["STRONG_NO", "NO", "YES", "STRONG_YES"];

export interface ScorecardCompetency {
  competencyName: string;
  definition: string | null;
  rating: number | null;
  note: string | null;
}

export function ScorecardForm({
  scorecardId,
  candidateName,
  interviewTitle,
  questions,
  initialCompetencies,
  initialRecommendation,
  initialSummary,
  submitted,
}: {
  scorecardId: string;
  candidateName: string;
  interviewTitle: string | null;
  questions: { question: string; listenFor: string | null }[];
  initialCompetencies: ScorecardCompetency[];
  initialRecommendation: Recommendation | null;
  initialSummary: string | null;
  submitted: boolean;
}) {
  const router = useRouter();
  const [competencies, setCompetencies] = useState(initialCompetencies);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(
    initialRecommendation,
  );
  const [summary, setSummary] = useState(initialSummary ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function update(name: string, patch: Partial<ScorecardCompetency>): void {
    setCompetencies((prev) =>
      prev.map((c) => (c.competencyName === name ? { ...c, ...patch } : c)),
    );
  }

  async function send(action: "save" | "submit"): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/admin/scorecards/${scorecardId}`, {
        body: {
          action,
          recommendation,
          summary,
          ratings: competencies.map((c) => ({
            competencyName: c.competencyName,
            rating: c.rating,
            note: c.note,
          })),
        },
      });
      setMessage(action === "submit" ? "Submitted." : "Saved as a draft.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <Card className="p-6">
        <h2 className="text-sm font-bold text-navy-900">
          Your scorecard for {candidateName}
        </h2>
        <p className="mt-2 text-sm text-navy-600">
          Submitted{recommendation ? ` — ${RECOMMENDATION_LABEL[recommendation]}` : ""}.
          Submitted scorecards are sealed so that the panel&rsquo;s evaluations
          stay independent of one another.
        </p>
        {summary && (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-navy-700">
            {summary}
          </p>
        )}
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

      {questions.length > 0 && (
        <Card className="p-6">
          <h2 className="text-sm font-bold text-navy-900">
            Questions for this interview
          </h2>
          <p className="mt-1 text-xs text-navy-500">
            Ask every candidate the same questions in the same order — that is
            what makes the answers comparable.
          </p>
          <ol className="mt-4 space-y-3">
            {questions.map((q, i) => (
              <li key={q.question} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fsw-100 text-[11px] font-bold text-fsw-800">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium leading-snug text-navy-900">
                    {q.question}
                  </p>
                  {q.listenFor && (
                    <p className="mt-0.5 text-xs leading-snug text-navy-500">
                      <span className="font-semibold">Listen for:</span> {q.listenFor}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="text-sm font-bold text-navy-900">
          Rate {candidateName}
          {interviewTitle ? ` — ${interviewTitle}` : ""}
        </h2>
        <div className="mt-4 space-y-5">
          {competencies.map((c) => (
            <div key={c.competencyName}>
              <p className="text-sm font-semibold text-navy-900">
                {c.competencyName}
              </p>
              {c.definition && (
                <p className="mt-0.5 text-xs leading-relaxed text-navy-500">
                  {c.definition}
                </p>
              )}
              <div
                className="mt-2 flex flex-wrap gap-1.5"
                role="group"
                aria-label={`${c.competencyName} rating`}
              >
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => update(c.competencyName, { rating: n })}
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
                  onClick={() => update(c.competencyName, { rating: null })}
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
                placeholder="What did you actually see or hear?"
                value={c.note ?? ""}
                onChange={(e) => update(c.competencyName, { note: e.target.value })}
                aria-label={`${c.competencyName} evidence`}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-bold text-navy-900">Overall</h2>
        <p className="mt-1 text-xs leading-relaxed text-navy-500">
          There is no middle option on purpose. If you are torn, pick the side
          you would defend and say why below.
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
          placeholder="Your reasoning, with specifics from the interview. This is the part the hiring manager reads."
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-label="Overall rationale"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void send("submit")}>
            Submit scorecard
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void send("save")}>
            Save draft
          </Button>
        </div>
        <p className="mt-2 text-xs text-navy-400">
          Submitting seals it. Save a draft if you want to finish later.
        </p>
      </Card>
    </div>
  );
}
