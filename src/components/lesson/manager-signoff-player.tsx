"use client";

import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/icons";
import type { LessonPlayerProps } from "@/components/lesson/types";

interface SignoffContent {
  instruction: string;
  criteria?: string[];
}

const RATING_LABEL: Record<string, string> = {
  NOT_DEMONSTRATED: "Not demonstrated",
  NEEDS_COACHING: "Needs coaching",
  COMPETENT: "Competent",
  HIGHLY_COMPETENT: "Highly competent",
};
const RATING_TONE: Record<string, "danger" | "warning" | "success" | "info"> = {
  NOT_DEMONSTRATED: "danger",
  NEEDS_COACHING: "warning",
  COMPETENT: "success",
  HIGHLY_COMPETENT: "success",
};

/** Handles both MANAGER_SIGNOFF and PRACTICAL_DEMO — same rating workflow, different framing text. */
export function ManagerSignoffPlayer({ lesson, progress, viewer, extra, assessPractical }: LessonPlayerProps) {
  const content = lesson.content as SignoffContent;
  const criteria = content.criteria ?? [];
  const isDemo = lesson.type === "PRACTICAL_DEMO";
  const assessments = extra?.practicalAssessments ?? [];
  const myLatest = assessments.find((a) => a.userId === viewer.id);
  const completed = progress?.status === "COMPLETED";

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
        <p className="text-[0.9375rem] leading-relaxed text-[var(--text-primary)]">{content.instruction}</p>
        {criteria.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5 text-[0.8125rem] text-[var(--text-secondary)]">
            {criteria.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <Icon name="approval" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-5">
        {completed || myLatest ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Badge tone={myLatest ? RATING_TONE[myLatest.rating] : "success"}>
                {myLatest ? RATING_LABEL[myLatest.rating] : "Completed"}
              </Badge>
            </div>
            {myLatest?.comments && <p className="text-[0.8125rem] text-[var(--text-secondary)]">{myLatest.comments}</p>}
          </div>
        ) : (
          <p className="text-[0.875rem] font-medium text-[var(--text-secondary)]">
            {isDemo ? "Awaiting your manager's assessment of this demonstration." : "Awaiting your manager's sign-off."}
          </p>
        )}
      </div>

      {viewer.canApprove && <AssessmentForm viewer={viewer} extra={extra} assessPractical={assessPractical} />}
    </div>
  );
}

function AssessmentForm({
  viewer,
  extra,
  assessPractical,
}: Pick<LessonPlayerProps, "viewer" | "extra" | "assessPractical">) {
  const [userId, setUserId] = React.useState(viewer.reviewableUsers[0]?.id ?? "");
  const [rating, setRating] = React.useState<"NOT_DEMONSTRATED" | "NEEDS_COACHING" | "COMPETENT" | "HIGHLY_COMPETENT">(
    "COMPETENT",
  );
  const [comments, setComments] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  if (viewer.reviewableUsers.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="team" className="h-5 w-5" />}
        title="No one to assess yet"
        description="You don't have any reports assigned to this course who need a sign-off yet."
      />
    );
  }

  async function submit() {
    if (!assessPractical || !userId) return;
    setSubmitting(true);
    try {
      const result = await assessPractical({ userId, rating, comments: comments.trim() || undefined });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't save this assessment.");
        return;
      }
      toast.success("Assessment recorded.");
      setComments("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-5">
      <h3 className="text-[0.875rem] font-semibold text-[var(--text-primary)]">Assess a team member</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Team member" htmlFor="assess-user">
          <Select id="assess-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {viewer.reviewableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rating" htmlFor="assess-rating">
          <Select id="assess-rating" value={rating} onChange={(e) => setRating(e.target.value as typeof rating)}>
            {Object.entries(RATING_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Comments" htmlFor="assess-comments" hint="Optional — visible to the person you're assessing.">
        <Textarea id="assess-comments" value={comments} onChange={(e) => setComments(e.target.value)} rows={3} />
      </Field>
      <div>
        <Button onClick={submit} loading={submitting}>
          Record assessment
        </Button>
      </div>
    </div>
  );
}
