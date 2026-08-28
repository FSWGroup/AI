"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import type { RetrainingDecisionResult } from "@/lib/services/sop";
import { applyRetrainingDecisionAction } from "@/app/(app)/admin/sops/[id]/impact/actions";

type Decision = "NONE" | "ACKNOWLEDGE" | "LESSON" | "FULL_COURSE" | "NOTIFY_ONLY";

const OPTIONS: { value: Decision; label: string; description: string }[] = [
  { value: "NONE", label: "No retraining", description: "The change is cosmetic or doesn't affect how people do the work." },
  { value: "NOTIFY_ONLY", label: "Notify only", description: "Let affected people know the SOP changed, with no formal requirement." },
  { value: "ACKNOWLEDGE", label: "Require acknowledgement", description: "Affected people must re-acknowledge the updated SOP." },
  { value: "LESSON", label: "Require a refresher lesson", description: "Assign a short lesson covering what changed." },
  { value: "FULL_COURSE", label: "Require the complete course", description: "Assign the full course again — for major procedural changes." },
];

export function RetrainingDecisionForm({
  sopId,
  affectedUserCount,
  courses,
}: {
  sopId: string;
  affectedUserCount: number;
  courses: { id: string; title: string }[];
}) {
  const [decision, setDecision] = useState<Decision>("NOTIFY_ONLY");
  const [courseId, setCourseId] = useState("");
  const [dueDays, setDueDays] = useState("14");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RetrainingDecisionResult | null>(null);

  function apply() {
    startTransition(async () => {
      const response = await applyRetrainingDecisionAction(sopId, {
        decision,
        courseId: courseId || undefined,
        dueDays: Number(dueDays) || 14,
      });
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setResult(response.data);
      toast.success("Retraining decision applied.");
    });
  }

  const needsCourse = decision === "LESSON" || decision === "FULL_COURSE";

  return (
    <div className="flex flex-col gap-4">
      {affectedUserCount === 0 && (
        <p className="text-[0.8125rem] text-[var(--text-muted)]">
          No one has acknowledged an earlier version of this SOP yet, so a decision here won&rsquo;t reach anyone until they do.
        </p>
      )}
      <div role="radiogroup" aria-label="Retraining decision" className="flex flex-col gap-2">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--border-subtle)] p-3 has-[:checked]:border-[var(--brand-secondary)] has-[:checked]:bg-[var(--surface-sunken)]"
          >
            <input
              type="radio"
              name="retraining-decision"
              value={option.value}
              checked={decision === option.value}
              onChange={() => setDecision(option.value)}
              className="mt-0.5 h-4 w-4 accent-[var(--brand-primary)]"
            />
            <span>
              <span className="block text-[0.875rem] font-medium text-[var(--text-primary)]">{option.label}</span>
              <span className="block text-[0.75rem] text-[var(--text-muted)]">{option.description}</span>
            </span>
          </label>
        ))}
      </div>

      {needsCourse && (
        <Field label="Course to assign" htmlFor="retrain-course" hint="Leave unset to notify people that training is coming.">
          <Select id="retrain-course" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">Not selected yet</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {decision !== "NONE" && (
        <Field label="Due in (days)" htmlFor="retrain-due-days">
          <Input id="retrain-due-days" type="number" min={1} max={365} value={dueDays} onChange={(e) => setDueDays(e.target.value)} className="w-32" />
        </Field>
      )}

      <Button onClick={apply} loading={pending} className="self-start">
        Apply decision
      </Button>

      {result && (
        <div role="status" className="rounded-md border border-success-100 bg-success-50 px-4 py-3 text-[0.8125rem] text-success-700">
          Applied &ldquo;{OPTIONS.find((o) => o.value === result.decision)?.label ?? result.decision}&rdquo; — {result.affectedUserCount} affected,{" "}
          {result.assignmentsCreated} assignment(s) created, {result.notificationsSent} notification(s) sent.
        </div>
      )}
    </div>
  );
}
