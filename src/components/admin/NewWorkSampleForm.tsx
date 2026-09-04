"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import {
  Button,
  Card,
  ErrorText,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import { LEVEL_LABEL, MAX_LEVEL, MIN_LEVEL } from "@/lib/worksample/rubric";

interface DraftCriterion {
  name: string;
  description: string;
  weight: number;
  anchors: Record<number, string>;
}

const emptyCriterion = (): DraftCriterion => ({
  name: "",
  description: "",
  weight: 1,
  anchors: { 1: "", 2: "", 3: "", 4: "" },
});

export function NewWorkSampleForm({
  jobProfiles,
}: {
  jobProfiles: { id: string; name: string }[];
}) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [instructions, setInstructions] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [submissionKind, setSubmissionKind] = useState("TEXT");
  const [timeLimit, setTimeLimit] = useState("60");
  const [dueInDays, setDueInDays] = useState(5);
  const [fileTypes, setFileTypes] = useState("pdf, docx");
  const [requiredGraders, setRequiredGraders] = useState(2);
  const [jobProfileId, setJobProfileId] = useState("");
  const [criteria, setCriteria] = useState<DraftCriterion[]>([emptyCriterion()]);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New work sample
      </Button>
    );
  }

  const update = (i: number, patch: Partial<DraftCriterion>) =>
    setCriteria((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-navy-900">New work sample</h3>
      <p className="mt-1 text-sm text-navy-500">
        Keep it to a slice of the real job that is small enough to be fair to
        ask for unpaid — an hour or two, not a weekend.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="wsTitle">Title</Label>
          <Input id="wsTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="wsProfile">Job profile</Label>
          <Select
            id="wsProfile"
            value={jobProfileId}
            onChange={(e) => setJobProfileId(e.target.value)}
          >
            <option value="">Any role</option>
            {jobProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="wsSummary">What the candidate sees before starting</Label>
        <Textarea
          id="wsSummary"
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="A short description of the task, so they can decide when to sit down with it."
        />
      </div>

      <div className="mt-4">
        <Label htmlFor="wsInstructions">The task</Label>
        <Textarea
          id="wsInstructions"
          rows={6}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <p className="mt-1 text-xs text-navy-500">
          Shown only once the clock starts.
        </p>
      </div>

      <div className="mt-4">
        <Label htmlFor="wsSuccess">What good looks like</Label>
        <Textarea
          id="wsSuccess"
          rows={3}
          value={successCriteria}
          onChange={(e) => setSuccessCriteria(e.target.value)}
        />
        <p className="mt-1 text-xs text-navy-500">
          Shown to the candidate alongside the task. Hiding the standard does
          not measure skill, it measures guessing.
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="wsKind">Submission</Label>
          <Select
            id="wsKind"
            value={submissionKind}
            onChange={(e) => setSubmissionKind(e.target.value)}
          >
            <option value="TEXT">Written response</option>
            <option value="FILE">A file</option>
            <option value="TEXT_AND_FILE">Both</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="wsTime">Time limit (minutes)</Label>
          <Input
            id="wsTime"
            value={timeLimit}
            onChange={(e) => setTimeLimit(e.target.value)}
            placeholder="Blank for untimed"
          />
        </div>
        <div>
          <Label htmlFor="wsDue">Days to start</Label>
          <Input
            id="wsDue"
            type="number"
            value={dueInDays}
            onChange={(e) => setDueInDays(Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="wsGraders">Graders required</Label>
          <Input
            id="wsGraders"
            type="number"
            value={requiredGraders}
            onChange={(e) => setRequiredGraders(Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-navy-500">
            One grader cannot be calibrated against anything.
          </p>
        </div>
      </div>

      {submissionKind !== "TEXT" && (
        <div className="mt-4">
          <Label htmlFor="wsTypes">Accepted file types</Label>
          <Input
            id="wsTypes"
            value={fileTypes}
            onChange={(e) => setFileTypes(e.target.value)}
            placeholder="pdf, docx, xlsx"
          />
        </div>
      )}

      {/* ---- Rubric ---- */}
      <div className="mt-8 border-t border-navy-100 pt-6">
        <h4 className="text-sm font-bold text-navy-900">The rubric</h4>
        <p className="mt-1 text-sm text-navy-500">
          Write this now, before anyone does the task. Every level needs words:
          two graders reading &ldquo;level 3&rdquo; supply their own definitions
          and never find out they differed.
        </p>

        {criteria.map((c, i) => (
          <div key={i} className="mt-5 rounded-xl border border-navy-100 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
              <div>
                <Label htmlFor={`crit-${i}`}>Criterion</Label>
                <Input
                  id={`crit-${i}`}
                  value={c.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Handles the edge cases"
                />
              </div>
              <div>
                <Label htmlFor={`w-${i}`}>Weight</Label>
                <Input
                  id={`w-${i}`}
                  type="number"
                  step="0.5"
                  value={c.weight}
                  onChange={(e) => update(i, { weight: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor={`d-${i}`}>What this criterion is about (optional)</Label>
              <Input
                id={`d-${i}`}
                value={c.description}
                onChange={(e) => update(i, { description: e.target.value })}
              />
            </div>
            <div className="mt-3 space-y-2">
              {Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, k) => MIN_LEVEL + k).map(
                (level) => (
                  <div key={level}>
                    <Label htmlFor={`a-${i}-${level}`}>
                      {level} — {LEVEL_LABEL[level]}
                    </Label>
                    <Input
                      id={`a-${i}-${level}`}
                      value={c.anchors[level] ?? ""}
                      onChange={(e) =>
                        update(i, { anchors: { ...c.anchors, [level]: e.target.value } })
                      }
                      placeholder="What the work looks like at this level"
                    />
                  </div>
                ),
              )}
            </div>
            {criteria.length > 1 && (
              <button
                type="button"
                className="mt-3 text-xs font-semibold text-red-700 hover:underline"
                onClick={() => setCriteria((prev) => prev.filter((_, j) => j !== i))}
              >
                Remove this criterion
              </button>
            )}
          </div>
        ))}

        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => setCriteria((prev) => [...prev, emptyCriterion()])}
        >
          Add a criterion
        </Button>
      </div>

      {error && <ErrorText className="mt-4">{error}</ErrorText>}
      <div className="mt-6 flex gap-3">
        <Button
          disabled={busy || title.trim() === "" || instructions.trim() === ""}
          onClick={async () => {
            await run(async () => {
              await api("/api/admin/work-samples", {
                method: "POST",
                body: {
                  title,
                  summary: summary || null,
                  instructions,
                  successCriteria: successCriteria || null,
                  submissionKind,
                  timeLimitMinutes: timeLimit.trim() === "" ? null : Number(timeLimit),
                  dueInDays,
                  allowedFileTypes:
                    submissionKind === "TEXT"
                      ? []
                      : fileTypes
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                  requiredGraders,
                  jobProfileId: jobProfileId || null,
                  criteria: criteria.map((c) => ({
                    name: c.name,
                    description: c.description || null,
                    weight: c.weight,
                    anchors: Object.entries(c.anchors).map(([level, textValue]) => ({
                      level: Number(level),
                      text: textValue,
                    })),
                  })),
                },
              });
              setOpen(false);
            }, { fallback: "Could not create the work sample." });
          }}
        >
          {busy ? "Creating…" : "Create as draft"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
