"use client";

/**
 * The posting quality check, shown on the requisition's Role details tab.
 *
 * Every finding is advisory and dismissible by ignoring it. The score exists
 * to make the panel glanceable, not to be optimized — a posting can score 70
 * for good reasons, and a recruiter who understands their role knows more than
 * a regex does.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Badge, Button, Card } from "@/components/ui";
import { FINDING_LABEL, type LintFinding, type LintResult } from "@/lib/ats/jd-linter";

const SEVERITY_TONE = { HIGH: "red", MEDIUM: "amber", LOW: "neutral" } as const;

const FIELD_LABEL: Record<string, string> = {
  title: "Job title",
  summary: "Summary",
  description: "About the role",
  responsibilities: "Responsibilities",
  requirements: "Requirements",
  benefits: "Benefits",
  salary: "Compensation",
};

export function JobDescriptionLinter({ requisitionId }: { requisitionId: string }) {
  const [result, setResult] = useState<LintResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  async function run(): Promise<void> {
    setError(null);
    try {
      const res = await api<{ result: LintResult }>(
        `/api/admin/requisitions/${requisitionId}/lint`,
        { method: "GET" },
      );
      setResult(res.result);
    } catch {
      setError("Could not check the posting.");
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requisitionId]);

  if (error) {
    return (
      <Card className="p-6 text-sm text-navy-500">
        {error}{" "}
        <button onClick={() => void run()} className="font-semibold text-fsw-700 hover:underline">
          Retry
        </button>
      </Card>
    );
  }
  if (!result) {
    return <Card className="p-6 text-sm text-navy-400">Checking the posting…</Card>;
  }

  const grouped = new Map<string, LintFinding[]>();
  for (const f of result.findings) {
    grouped.set(f.field, [...(grouped.get(f.field) ?? []), f]);
  }

  const tone =
    result.counts.HIGH > 0 ? "red" : result.counts.MEDIUM > 0 ? "amber" : "green";

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-navy-900">Posting check</h3>
          <p className="mt-0.5 text-xs text-navy-500">
            {result.wordCount} words
            {result.readingGrade != null && ` · reads at about grade ${result.readingGrade}`}
            {result.findings.length === 0
              ? " · nothing flagged"
              : ` · ${result.findings.length} thing${result.findings.length === 1 ? "" : "s"} to look at`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{result.score}/100</Badge>
          {result.findings.length > 0 && (
            <Button variant="ghost" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide" : "Show"}
            </Button>
          )}
        </div>
      </div>

      {result.findings.length === 0 && (
        <p className="mt-3 text-sm text-navy-600">
          Nothing flagged. Worth re-checking after any edit — this runs on the
          copy as it stands right now.
        </p>
      )}

      {open && result.findings.length > 0 && (
        <div className="mt-4 space-y-4">
          {[...grouped.entries()].map(([field, findings]) => (
            <div key={field}>
              <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                {FIELD_LABEL[field] ?? field}
              </p>
              <ul className="mt-1.5 space-y-2">
                {findings.map((f, i) => (
                  <li
                    key={`${f.kind}-${i}`}
                    className={`rounded-lg p-3 text-sm ${
                      f.severity === "HIGH"
                        ? "bg-red-50"
                        : f.severity === "MEDIUM"
                          ? "bg-amber-50"
                          : "bg-navy-50"
                    }`}
                  >
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONE[f.severity]}>
                        {FINDING_LABEL[f.kind]}
                      </Badge>
                      {f.match && (
                        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-navy-700">
                          {f.match}
                        </span>
                      )}
                    </p>
                    <p className="mt-1.5 leading-relaxed text-navy-800">{f.message}</p>
                    {f.suggestion && (
                      <p className="mt-1 text-xs leading-relaxed text-navy-600">
                        <strong>Instead:</strong> {f.suggestion}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs leading-relaxed text-navy-400">
            All of this is advice. Ignore anything that does not apply to your
            role — a pattern match knows less about the job than you do.
          </p>
        </div>
      )}
    </Card>
  );
}
