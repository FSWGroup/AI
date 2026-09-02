"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";

export function InterviewConsentForm({
  token,
  company,
}: {
  token: string;
  company: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"GRANTED" | "DECLINED" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (decision: "GRANTED" | "DECLINED") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview-consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const out = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(out.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(decision);
    } finally {
      setBusy(false);
    }
  };

  if (done === "GRANTED") {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-lg font-semibold text-navy-900">Thank you</h2>
        <p className="mt-2 leading-relaxed text-navy-600">
          The interview will be recorded, provided everyone else in it agrees
          too — if any of them declines, it will not be.
        </p>
        <p className="mt-2 leading-relaxed text-navy-600">
          You can change your mind at any point, including during the interview
          and afterwards. Tell your interviewer and the recording stops and is
          deleted.
        </p>
      </Card>
    );
  }

  if (done === "DECLINED") {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-lg font-semibold text-navy-900">
          Understood — nothing will be recorded
        </h2>
        <p className="mt-2 leading-relaxed text-navy-600">
          Your interview goes ahead exactly as planned. The interviewer takes
          notes the way they otherwise would, and nobody involved in the
          decision is told which answer you gave.
        </p>
      </Card>
    );
  }

  return (
    <div className="mt-8">
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => answer("GRANTED")}>
          {busy ? "Saving…" : "Yes, you may record it"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => answer("DECLINED")}>
          No, please do not record it
        </Button>
      </div>
      <p className="mt-4 text-sm text-navy-500">
        Either answer is fine with {company}, and your interview is the same
        either way.
      </p>
    </div>
  );
}
