"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Glyph } from "@/components/icons";
import {
  setPositionSkillRequirementsAction,
  setPositionTrainingRequirementsAction,
  updatePositionAction,
} from "@/app/(app)/admin/organization/actions";
import type { PositionProfile } from "@/lib/services/org";

type TargetType = "COURSE" | "SOP" | "LEARNING_PATH";

interface SkillReqDraft {
  skillId: string;
  name: string;
  requiredLevel: number;
  required: boolean;
}
interface TrainingReqDraft {
  key: string;
  targetType: TargetType;
  courseId: string | null;
  sopId: string | null;
  pathId: string | null;
  title: string;
  required: boolean;
}

function targetKeyOf(t: { targetType: string; courseId: string | null; sopId: string | null; pathId: string | null }): string {
  return `${t.targetType}:${t.courseId ?? ""}:${t.sopId ?? ""}:${t.pathId ?? ""}`;
}

export function PositionEditor({
  position,
  skills,
  skillLevels,
  courses,
  sops,
  paths,
}: {
  position: PositionProfile;
  skills: { id: string; name: string }[];
  skillLevels: { value: number; name: string }[];
  courses: { id: string; title: string }[];
  sops: { id: string; title: string }[];
  paths: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(position.title);
  const [description, setDescription] = useState(position.description ?? "");
  const [responsibilities, setResponsibilities] = useState(position.responsibilities.join("\n"));
  const [toolsUsed, setToolsUsed] = useState(position.toolsUsed.join("\n"));

  const [skillReqs, setSkillReqs] = useState<SkillReqDraft[]>(
    position.skillRequirements.map((r) => ({ skillId: r.skillId, name: r.name, requiredLevel: r.requiredLevel, required: r.required })),
  );
  const [newSkillId, setNewSkillId] = useState("");
  const [newSkillLevel, setNewSkillLevel] = useState(skillLevels[0]?.value ?? 1);

  const [trainingReqs, setTrainingReqs] = useState<TrainingReqDraft[]>(
    position.trainingRequirements.map((r) => ({
      key: targetKeyOf(r),
      targetType: r.targetType,
      courseId: r.courseId,
      sopId: r.sopId,
      pathId: r.pathId,
      title: r.title,
      required: r.required,
    })),
  );
  const [newTargetType, setNewTargetType] = useState<TargetType>("COURSE");
  const [newTargetId, setNewTargetId] = useState("");

  function saveBasics() {
    startTransition(async () => {
      const result = await updatePositionAction(position.id, {
        title,
        description: description || null,
        responsibilities: responsibilities.split("\n").map((s) => s.trim()).filter(Boolean),
        toolsUsed: toolsUsed.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Position updated.");
      router.refresh();
    });
  }

  function addSkillReq() {
    if (!newSkillId) return;
    const skill = skills.find((s) => s.id === newSkillId);
    if (!skill || skillReqs.some((r) => r.skillId === newSkillId)) return;
    setSkillReqs((prev) => [...prev, { skillId: skill.id, name: skill.name, requiredLevel: newSkillLevel, required: true }]);
    setNewSkillId("");
  }
  function removeSkillReq(skillId: string) {
    setSkillReqs((prev) => prev.filter((r) => r.skillId !== skillId));
  }
  function saveSkillReqs() {
    startTransition(async () => {
      const result = await setPositionSkillRequirementsAction(
        position.id,
        skillReqs.map((r) => ({ skillId: r.skillId, requiredLevel: r.requiredLevel, required: r.required })),
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Skill requirements saved.");
      router.refresh();
    });
  }

  function targetOptions(): { id: string; title: string }[] {
    if (newTargetType === "COURSE") return courses;
    if (newTargetType === "SOP") return sops;
    return paths;
  }
  function addTrainingReq() {
    if (!newTargetId) return;
    const option = targetOptions().find((o) => o.id === newTargetId);
    if (!option) return;
    const draft: TrainingReqDraft = {
      key: targetKeyOf({
        targetType: newTargetType,
        courseId: newTargetType === "COURSE" ? newTargetId : null,
        sopId: newTargetType === "SOP" ? newTargetId : null,
        pathId: newTargetType === "LEARNING_PATH" ? newTargetId : null,
      }),
      targetType: newTargetType,
      courseId: newTargetType === "COURSE" ? newTargetId : null,
      sopId: newTargetType === "SOP" ? newTargetId : null,
      pathId: newTargetType === "LEARNING_PATH" ? newTargetId : null,
      title: option.title,
      required: true,
    };
    if (trainingReqs.some((r) => r.key === draft.key)) return;
    setTrainingReqs((prev) => [...prev, draft]);
    setNewTargetId("");
  }
  function removeTrainingReq(key: string) {
    setTrainingReqs((prev) => prev.filter((r) => r.key !== key));
  }
  function saveTrainingReqs() {
    startTransition(async () => {
      const result = await setPositionTrainingRequirementsAction(
        position.id,
        trainingReqs.map((r) => ({ targetType: r.targetType, courseId: r.courseId, sopId: r.sopId, pathId: r.pathId, required: r.required })),
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Training requirements saved — existing position holders were re-evaluated.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
        <h2 className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Basics</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title" htmlFor="pos-title">
            <Input id="pos-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="pos-description">
            <Input id="pos-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Responsibilities (one per line)" htmlFor="pos-resp">
            <Textarea id="pos-resp" rows={5} value={responsibilities} onChange={(e) => setResponsibilities(e.target.value)} />
          </Field>
          <Field label="Tools used (one per line)" htmlFor="pos-tools">
            <Textarea id="pos-tools" rows={5} value={toolsUsed} onChange={(e) => setToolsUsed(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={saveBasics} loading={pending}>
            Save basics
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
        <h2 className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Required skills</h2>
        {skillReqs.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {skillReqs.map((r) => (
              <li key={r.skillId} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] p-2">
                <span className="text-[0.8125rem] text-[var(--text-primary)]">{r.name}</span>
                <div className="flex items-center gap-2">
                  <Select
                    className="h-8 w-40"
                    aria-label={`Required level for ${r.name}`}
                    value={r.requiredLevel}
                    onChange={(e) =>
                      setSkillReqs((prev) =>
                        prev.map((x) => (x.skillId === r.skillId ? { ...x, requiredLevel: Number(e.target.value) } : x)),
                      )
                    }
                  >
                    {skillLevels.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="ghost" onClick={() => removeSkillReq(r.skillId)} aria-label={`Remove ${r.name} requirement`}>
                    <Glyph name="trash" className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Add a skill" htmlFor="new-skill">
            <Select id="new-skill" className="h-8 w-56" value={newSkillId} onChange={(e) => setNewSkillId(e.target.value)}>
              <option value="">Choose a skill…</option>
              {skills
                .filter((s) => !skillReqs.some((r) => r.skillId === s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Level" htmlFor="new-skill-level">
            <Select id="new-skill-level" className="h-8 w-40" value={newSkillLevel} onChange={(e) => setNewSkillLevel(Number(e.target.value))}>
              {skillLevels.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" variant="secondary" onClick={addSkillReq} disabled={!newSkillId}>
            Add
          </Button>
          <Button size="sm" onClick={saveSkillReqs} loading={pending} className="ml-auto">
            Save skill requirements
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
        <h2 className="text-[0.9375rem] font-semibold text-[var(--text-primary)]">Required training</h2>
        {trainingReqs.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {trainingReqs.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] p-2">
                <span className="flex items-center gap-2 text-[0.8125rem] text-[var(--text-primary)]">
                  <Badge tone="neutral">{r.targetType === "LEARNING_PATH" ? "PATH" : r.targetType}</Badge>
                  {r.title}
                </span>
                <Button size="sm" variant="ghost" onClick={() => removeTrainingReq(r.key)} aria-label={`Remove ${r.title} requirement`}>
                  <Glyph name="trash" className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Type" htmlFor="new-target-type">
            <Select
              id="new-target-type"
              className="h-8 w-40"
              value={newTargetType}
              onChange={(e) => {
                setNewTargetType(e.target.value as TargetType);
                setNewTargetId("");
              }}
            >
              <option value="COURSE">Course</option>
              <option value="SOP">SOP</option>
              <option value="LEARNING_PATH">Learning path</option>
            </Select>
          </Field>
          <Field label="Item" htmlFor="new-target-id">
            <Select id="new-target-id" className="h-8 w-64" value={newTargetId} onChange={(e) => setNewTargetId(e.target.value)}>
              <option value="">Choose…</option>
              {targetOptions().map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" variant="secondary" onClick={addTrainingReq} disabled={!newTargetId}>
            Add
          </Button>
          <Button size="sm" onClick={saveTrainingReqs} loading={pending} className="ml-auto">
            Save training requirements
          </Button>
        </div>
        <p className="text-[0.75rem] text-[var(--text-muted)]">
          Saving re-evaluates every active person currently in this position and assigns anything newly required.
        </p>
      </section>
    </div>
  );
}
