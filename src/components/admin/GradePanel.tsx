import { Badge, Card } from "@/components/ui";
import {
  LEVEL_LABEL,
  scoreGrade,
  type CriterionLike,
  type GradeLike,
  type GradingSummary,
} from "@/lib/worksample/rubric";

/**
 * Every filed grade, side by side.
 *
 * The mean is shown alongside the individual grades, never instead of them.
 * An average of 1 and 4 is 2.5, which describes neither grader and is the
 * number most likely to be quietly wrong.
 */
export function GradePanel({
  grades,
  criteria,
  summary,
  viewerId,
}: {
  grades: GradeLike[];
  criteria: CriterionLike[];
  summary: GradingSummary;
  viewerId?: string;
}) {
  return (
    <>
      <h3 className="text-sm font-bold uppercase tracking-wide text-navy-500">
        Grades
      </h3>

      {summary.needsReconciliation && (
        <p className="mt-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          <span className="font-semibold">These grades need reconciling. </span>
          {summary.reconciliationReason} Talk it through, then either grader can
          revise — the revision is recorded as reconciled, so an independent
          grade is never confused with one written after a conversation.
        </p>
      )}

      <Card className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-400">
            <tr>
              <th className="px-4 py-3">Criterion</th>
              {summary.scores.map((s) => (
                <th key={s.graderId} className="px-4 py-3">
                  {s.graderName}
                  {s.graderId === viewerId && (
                    <span className="ml-1 font-normal normal-case text-navy-400">(you)</span>
                  )}
                  {s.reconciled && (
                    <span className="ml-1 font-normal normal-case text-amber-700">
                      reconciled
                    </span>
                  )}
                </th>
              ))}
              <th className="px-4 py-3">Spread</th>
            </tr>
          </thead>
          <tbody>
            {summary.criteria.map((c) => (
              <tr key={c.criterionId} className="border-b border-navy-50">
                <td className="px-4 py-3 font-medium text-navy-900">
                  {c.criterionName}
                </td>
                {summary.scores.map((s) => {
                  const grade = grades.find((g) => g.graderId === s.graderId);
                  const level =
                    grade?.ratings.find((r) => r.criterionId === c.criterionId)?.level ??
                    null;
                  return (
                    <td key={s.graderId} className="px-4 py-3">
                      {level === null ? (
                        <span className="text-xs text-navy-400">not assessed</span>
                      ) : (
                        <span className="font-mono font-semibold text-navy-900">
                          {level}
                          <span className="ml-2 font-sans text-xs font-normal text-navy-500">
                            {LEVEL_LABEL[level]}
                          </span>
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3">
                  {c.divergent ? (
                    <Badge tone="amber">{c.range} levels apart</Badge>
                  ) : (
                    <span className="text-xs text-navy-400">
                      {c.range === 0 ? "agreed" : `${c.range} apart`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            <tr className="bg-navy-50">
              <td className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-navy-500">
                Weighted score
              </td>
              {summary.scores.map((s) => (
                <td key={s.graderId} className="px-4 py-3 font-mono font-bold text-navy-900">
                  {s.score !== null ? s.score.toFixed(2) : "—"}
                </td>
              ))}
              <td className="px-4 py-3 text-xs text-navy-500">
                {summary.meanScore !== null && (
                  <>mean {summary.meanScore.toFixed(2)}</>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="mt-4 space-y-4">
        {grades.map((g) => {
          const scored = scoreGrade(g, criteria);
          return (
            <Card key={g.id} className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-navy-900">
                  {g.graderName}
                  {g.graderId === viewerId && (
                    <span className="ml-2 text-sm font-normal text-navy-400">(you)</span>
                  )}
                </p>
                <p className="text-sm text-navy-500">
                  {scored.score !== null ? scored.score.toFixed(2) : "—"} ·{" "}
                  {g.submittedAt?.toISOString().slice(0, 10)}
                </p>
              </div>
              {g.comment && (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-navy-700">
                  {g.comment}
                </p>
              )}
              {scored.unassessed.length > 0 && (
                <p className="mt-2 text-xs text-navy-500">
                  Could not assess: {scored.unassessed.join(", ")}.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {!summary.complete && (
        <p className="mt-4 text-sm text-navy-500">
          {summary.submittedCount} of {summary.requiredGraders} grades filed.
        </p>
      )}
    </>
  );
}
