"use client";

/**
 * The candidate's own summary of their results.
 *
 * Shown after submission when the organization enables candidate feedback.
 * Everything here comes from /api/candidate/feedback, which already removed
 * benchmark comparisons, validity indicators, and numeric bands — this
 * component renders what it is given and asks for nothing else.
 */

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { Button, Card } from "@/components/ui";

interface FeedbackSection {
  name: string;
  about: string;
  statement: string;
}

interface CandidateFeedback {
  candidateFirstName: string;
  position: string;
  company: string;
  completedAt: string | null;
  strengths: FeedbackSection[];
  workStyle: FeedbackSection[];
  development: { name: string; suggestions: string[] }[];
  aboutTheAssessment: string[];
  closing: string;
}

function Dimension({ item }: { item: FeedbackSection }) {
  return (
    <div className="border-l-2 border-fsw-200 py-3 pl-4">
      <p className="text-sm font-semibold text-navy-900">{item.name}</p>
      {item.about && <p className="mt-0.5 text-xs text-navy-400">{item.about}</p>}
      <p className="mt-1.5 text-sm leading-relaxed text-navy-700">
        {item.statement}
      </p>
    </div>
  );
}

export function FeedbackReport({ onBack }: { onBack: () => void }) {
  const [feedback, setFeedback] = useState<CandidateFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<{ feedback: CandidateFeedback }>(
          "/api/candidate/feedback",
          { method: "GET" },
        );
        if (!cancelled) setFeedback(res.feedback);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "We could not load your summary right now.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Card className="p-8">
        <h2 className="text-lg font-bold text-navy-900">Summary unavailable</h2>
        <p className="mt-2 text-sm text-navy-600">{error}</p>
        <Button className="mt-5" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </Card>
    );
  }

  if (!feedback) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-navy-500">Preparing your summary…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-8">
        <p className="text-xs font-bold uppercase tracking-wide text-fsw-600">
          Your assessment summary
        </p>
        <h1 className="mt-2 text-2xl font-bold text-navy-900">
          Thanks for completing this, {feedback.candidateFirstName}.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-navy-600">
          This is a summary written for you, not the version your hiring
          contact sees. It describes patterns in how you answered — it is not a
          score, a ranking, or a decision.
        </p>
        <p className="mt-3 text-xs text-navy-400">
          {feedback.position} · {feedback.company}
          {feedback.completedAt
            ? ` · Completed ${new Date(feedback.completedAt).toLocaleDateString()}`
            : ""}
        </p>
      </Card>

      {feedback.strengths.length > 0 && (
        <Card className="p-8">
          <h2 className="text-base font-bold text-navy-900">
            Where you showed strength
          </h2>
          <p className="mt-1 text-sm text-navy-500">
            These stood out relative to the other areas measured.
          </p>
          <div className="mt-4 space-y-1">
            {feedback.strengths.map((s) => (
              <Dimension key={s.name} item={s} />
            ))}
          </div>
        </Card>
      )}

      {feedback.workStyle.length > 0 && (
        <Card className="p-8">
          <h2 className="text-base font-bold text-navy-900">How you work</h2>
          <p className="mt-1 text-sm text-navy-500">
            Working styles are preferences, not abilities. There is no better or
            worse end of any of these.
          </p>
          <div className="mt-4 space-y-1">
            {feedback.workStyle.map((s) => (
              <Dimension key={s.name} item={s} />
            ))}
          </div>
        </Card>
      )}

      {feedback.development.length > 0 && (
        <Card className="p-8">
          <h2 className="text-base font-bold text-navy-900">
            Ideas if you want to build further
          </h2>
          <p className="mt-1 text-sm text-navy-500">
            Suggestions, not corrections — take what is useful and leave the rest.
          </p>
          <div className="mt-4 space-y-4">
            {feedback.development.map((d) => (
              <div key={d.name}>
                <p className="text-sm font-semibold text-navy-900">{d.name}</p>
                <ul className="mt-1.5 space-y-1">
                  {d.suggestions.map((s) => (
                    <li key={s} className="text-sm leading-relaxed text-navy-700">
                      • {s}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-8">
        <h2 className="text-base font-bold text-navy-900">
          About this assessment
        </h2>
        <ul className="mt-3 space-y-2">
          {feedback.aboutTheAssessment.map((p) => (
            <li key={p} className="text-sm leading-relaxed text-navy-700">
              • {p}
            </li>
          ))}
        </ul>
        <p className="mt-5 text-sm leading-relaxed text-navy-600">
          {feedback.closing}
        </p>
      </Card>

      <div className="print:hidden">
        <p className="mb-3 text-sm text-navy-500">
          This summary is tied to this browser session — save a copy now if you
          would like to keep it.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => window.print()}>Print or save as PDF</Button>
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}
