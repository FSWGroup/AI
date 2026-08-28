"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/input";
import type { PracticalRating } from "@prisma/client";
import { assessSkillAction } from "@/app/(app)/team/approvals/actions";

const RATING_LABEL: Record<PracticalRating, string> = {
  NOT_DEMONSTRATED: "Not demonstrated",
  NEEDS_COACHING: "Needs coaching",
  COMPETENT: "Competent",
  HIGHLY_COMPETENT: "Highly competent",
};

export function AssessSkillForm({
  members,
  skills,
}: {
  members: { id: string; name: string }[];
  skills: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState(members[0]?.id ?? "");
  const [skillId, setSkillId] = useState(skills[0]?.id ?? "");
  const [rating, setRating] = useState<PracticalRating>("COMPETENT");
  const [comments, setComments] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await assessSkillAction({ userId, skillId, rating, comments: comments || null });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Assessment recorded.");
      setComments("");
      router.refresh();
    });
  }

  if (members.length === 0) {
    return <p className="text-[0.8125rem] text-[var(--text-muted)]">No one reports to you yet.</p>;
  }
  if (skills.length === 0) {
    return <p className="text-[0.8125rem] text-[var(--text-muted)]">No skills are configured in the library yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Team member" htmlFor="as-user">
          <Select id="as-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Skill" htmlFor="as-skill">
          <Select id="as-skill" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rating" htmlFor="as-rating">
          <Select id="as-rating" value={rating} onChange={(e) => setRating(e.target.value as PracticalRating)}>
            {Object.entries(RATING_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Comments (optional)" htmlFor="as-comments" hint="Visible to the person you're assessing.">
        <Textarea id="as-comments" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
      </Field>
      <div>
        <Button onClick={submit} loading={pending}>
          Record assessment
        </Button>
      </div>
    </div>
  );
}
