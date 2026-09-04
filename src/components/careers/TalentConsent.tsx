"use client";

import { useState } from "react";
import { Button, Card, ErrorText, Textarea } from "@/components/ui";

export function TalentConsent({
  token,
  company,
}: {
  token: string;
  company: string;
}) {
  const [interests, setInterests] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (decision: "in" | "out") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/talent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          interests: decision === "in" && interests ? interests : null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setDone(decision);
    } finally {
      setBusy(false);
    }
  };

  if (done === "in") {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-lg font-semibold text-navy-900">Thank you</h2>
        <p className="mt-2 leading-relaxed text-navy-600">
          We will get in touch if something comes up that looks like a good fit.
          You can change your mind at any time — just reply to any message from
          us and say so, and we will remove your details.
        </p>
      </Card>
    );
  }

  if (done === "out") {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-lg font-semibold text-navy-900">
          Understood — we will not contact you
        </h2>
        <p className="mt-2 leading-relaxed text-navy-600">
          You have been removed from our talent pool and we will not ask you
          again. You are welcome to apply to {company} whenever you like.
        </p>
      </Card>
    );
  }

  return (
    <div className="mt-8">
      <Card className="p-6">
        <label htmlFor="interests" className="text-sm font-semibold text-navy-900">
          Anything you would like us to know? (optional)
        </label>
        <p className="text-sm text-navy-500">
          The kind of work you are after, when you might be available, where you
          can work. It helps us not to waste your time with the wrong roles.
        </p>
        <Textarea
          id="interests"
          rows={4}
          className="mt-2"
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
        />
      </Card>

      {error && <ErrorText className="mt-4">{error}</ErrorText>}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button disabled={busy} onClick={() => answer("in")}>
          {busy ? "Saving…" : "Yes, keep me in mind"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => answer("out")}>
          No, please do not contact me
        </Button>
      </div>
      <p className="mt-4 text-sm text-navy-500">
        Neither answer affects any application you have already made.
      </p>
    </div>
  );
}
