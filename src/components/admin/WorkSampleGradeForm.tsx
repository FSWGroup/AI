"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { Button, Card, ErrorText, Textarea } from "@/components/ui";
import { LEVEL_LABEL, type CriterionLike } from "@/lib/worksample/rubric";

export function WorkSampleGradeForm({
  assignmentId,
  criteria,
  initial,
  alreadyFiled,
}: {
  assignmentId: string;
  criteria: CriterionLike[];
  initial: { comment: string; levels: Record<string, number | null> } | null;
  alreadyFiled: boolean;
}) {
  const { busy, error, run } = useAction();
  const [levels, setLevels] = useState<Record<string, number | null>>(
    initial?.levels ?? {},
  );
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [reconciling, setReconciling] = useState(false);

  const locked = alreadyFiled && !reconciling;

  const save = async (submit: boolean) => {
    await run(async () => {
      await api("/api/admin/work-sample-grades", {
        method: "POST",
        body: {
          assignmentId,
          comment: comment || null,
          ratings: criteria.map((c) => ({
            criterionId: c.id,
            level: levels[c.id] ?? null,
            note: null,
          })),
          submit,
          reconciled: reconciling,
        },
      });
      setReconciling(false);
    }, { fallback: "Could not save the grade." });
  };

  return (
    <Card className="mt-3 p-6">
      {criteria.map((c) => (
        <div key={c.id} className="mb-6 border-b border-navy-50 pb-5 last:mb-0 last:border-0 last:pb-0">
          <p className="text-sm font-semibold text-navy-900">
            {c.name}
            {c.weight !== 1 && (
              <span className="ml-2 text-xs font-normal text-navy-400">
                weight {c.weight}
              </span>
            )}
          </p>
          {c.description && (
            <p className="text-xs text-navy-500">{c.description}</p>
          )}

          <div className="mt-3 space-y-2">
            {c.anchors
              .slice()
              .sort((a, b) => a.level - b.level)
              .map((a) => (
                <label
                  key={a.level}
                  className={
                    levels[c.id] === a.level
                      ? "flex cursor-pointer gap-3 rounded-lg border-2 border-fsw-500 bg-fsw-50 p-3"
                      : "flex cursor-pointer gap-3 rounded-lg border border-navy-100 p-3 hover:bg-navy-50"
                  }
                >
                  <input
                    type="radio"
                    name={`crit-${c.id}`}
                    className="mt-1 h-4 w-4 accent-fsw-600"
                    disabled={locked}
                    checked={levels[c.id] === a.level}
                    onChange={() => setLevels((p) => ({ ...p, [c.id]: a.level }))}
                  />
                  <span>
                    <span className="text-sm font-semibold text-navy-900">
                      {a.level} — {LEVEL_LABEL[a.level]}
                    </span>
                    <span className="block text-sm text-navy-600">{a.text}</span>
                  </span>
                </label>
              ))}
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-navy-200 p-3 text-sm text-navy-600">
              <input
                type="radio"
                name={`crit-${c.id}`}
                className="h-4 w-4 accent-navy-400"
                disabled={locked}
                checked={c.id in levels && levels[c.id] === null}
                onChange={() => setLevels((p) => ({ ...p, [c.id]: null }))}
              />
              The submission did not show this — I could not assess it
            </label>
          </div>
        </div>
      ))}

      <div className="mt-6">
        <label htmlFor="gradeComment" className="text-sm font-semibold text-navy-900">
          What did you see in the work?
        </label>
        <p className="text-xs text-navy-500">
          Specific evidence, not a verdict. This is what you and the other
          grader compare if you disagree, and what the candidate would be told
          if they asked.
        </p>
        <Textarea
          id="gradeComment"
          rows={5}
          className="mt-2"
          disabled={locked}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      {error && <ErrorText className="mt-4">{error}</ErrorText>}

      <div className="mt-5 flex flex-wrap gap-3">
        {locked ? (
          <>
            <span className="self-center text-sm text-navy-600">
              Filed. It cannot be edited except as a reconciliation.
            </span>
            <Button variant="secondary" onClick={() => setReconciling(true)}>
              Revise after discussing
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => save(false)}>
              Save draft
            </Button>
            <Button disabled={busy} onClick={() => save(true)}>
              {busy
                ? "Saving…"
                : reconciling
                  ? "File the revised grade"
                  : "File my grade"}
            </Button>
            {reconciling && (
              <span className="self-center text-xs text-navy-500">
                This will be recorded as revised after discussion, not as an
                independent grade.
              </span>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
