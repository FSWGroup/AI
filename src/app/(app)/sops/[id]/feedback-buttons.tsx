"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Glyph } from "@/components/icons";
import { submitFeedbackAction } from "@/app/(app)/sops/[id]/actions";

const OPTIONS: { type: "HELPFUL" | "NOT_CLEAR" | "OUTDATED" | "QUESTION"; label: string; confirm: string }[] = [
  { type: "HELPFUL", label: "Helpful", confirm: "Thanks for the feedback." },
  { type: "NOT_CLEAR", label: "Not clear", confirm: "Thanks — we'll take a look at the wording." },
  { type: "OUTDATED", label: "Outdated", confirm: "Thanks — flagged for the content owner." },
  { type: "QUESTION", label: "I have a question", confirm: "Noted. Try Ask FSW AI for an instant answer with citations." },
];

export function FeedbackButtons({ sopId }: { sopId: string }) {
  const [sent, setSent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(type: (typeof OPTIONS)[number]["type"], confirm: string) {
    startTransition(async () => {
      const result = await submitFeedbackAction({ sopId, type });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSent(type);
      toast.success(confirm);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[0.8125rem] font-medium text-[var(--text-secondary)]">Was this helpful?</span>
      {OPTIONS.map((option) => (
        <Button
          key={option.type}
          type="button"
          variant={sent === option.type ? "secondary" : "outline"}
          size="sm"
          disabled={pending}
          onClick={() => send(option.type, option.confirm)}
        >
          {sent === option.type && <Glyph name="check" className="h-3.5 w-3.5" />}
          {option.label}
        </Button>
      ))}
    </div>
  );
}
