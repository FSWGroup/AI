"use client";

/**
 * What the candidate sees after submitting.
 *
 * Order matters here. The confirmation comes first so nobody is left
 * wondering whether their work was received; the optional self-identification
 * and the optional personal summary are offered afterwards, and either can be
 * ignored entirely without consequence.
 */

import { useState } from "react";
import { CompletionScreen } from "./EntryScreens";
import { SelfIdentification } from "./SelfIdentification";
import { FeedbackReport } from "./FeedbackReport";
import { Button, Card } from "@/components/ui";
import type { AttemptState } from "./types";

type Step = "confirm" | "self_id" | "feedback";

export function CompletionFlow({ state }: { state: AttemptState | null }) {
  const offerSelfId = Boolean(state?.eeoModuleEnabled && !state?.eeoSubmitted);
  const offerFeedback = Boolean(state?.candidateFeedbackEnabled);
  const [step, setStep] = useState<Step>("confirm");
  const [selfIdDone, setSelfIdDone] = useState(!offerSelfId);

  if (step === "feedback") {
    return <FeedbackReport onBack={() => setStep("confirm")} />;
  }

  if (step === "self_id") {
    return (
      <SelfIdentification
        onDone={() => {
          setSelfIdDone(true);
          setStep("confirm");
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-8">
        <CompletionScreen />
      </Card>

      {(offerFeedback || (offerSelfId && !selfIdDone)) && (
        <Card className="p-6">
          <h2 className="text-sm font-bold text-navy-900">
            Two optional things, if you&rsquo;d like
          </h2>
          <div className="mt-4 space-y-4">
            {offerFeedback && (
              <div>
                <p className="text-sm leading-relaxed text-navy-600">
                  We can show you a summary of your own results — written for
                  you, not the version your hiring contact sees.
                </p>
                <Button className="mt-2.5" onClick={() => setStep("feedback")}>
                  View my summary
                </Button>
              </div>
            )}
            {offerSelfId && !selfIdDone && (
              <div className={offerFeedback ? "border-t border-navy-100 pt-4" : ""}>
                <p className="text-sm leading-relaxed text-navy-600">
                  You can voluntarily provide demographic information. It is
                  kept apart from your results, is never seen by the people
                  evaluating you, and is used only to check the fairness of the
                  process in aggregate.
                </p>
                <Button
                  className="mt-2.5"
                  variant="ghost"
                  onClick={() => setStep("self_id")}
                >
                  Answer the voluntary questions
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
