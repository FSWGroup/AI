"use client";

import * as React from "react";
import { toast } from "sonner";
import { searchSopsAction, searchCoursesAction, runQualityCheckAction, type ContentOption } from "@/app/(app)/admin/ai-studio/actions";
import type { QualityFinding } from "@/lib/ai/generate";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";

const SEVERITY_TONE: Record<QualityFinding["severity"], BadgeTone> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
};

export function QualityCheckFlow({ available }: { available: boolean }) {
  const [entityType, setEntityType] = React.useState<"SOP" | "COURSE">("SOP");
  const [query, setQuery] = React.useState("");
  const [options, setOptions] = React.useState<ContentOption[]>([]);
  const [selected, setSelected] = React.useState<ContentOption | null>(null);
  const [running, setRunning] = React.useState(false);
  const [findings, setFindings] = React.useState<QualityFinding[] | null>(null);

  React.useEffect(() => {
    setSelected(null);
    setOptions([]);
    setQuery("");
    setFindings(null);
  }, [entityType]);

  React.useEffect(() => {
    const handle = setTimeout(async () => {
      const action = entityType === "SOP" ? searchSopsAction : searchCoursesAction;
      const res = await action(query);
      if (res.ok) setOptions(res.data);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, entityType]);

  async function handleRun() {
    if (!selected) {
      toast.error("Pick a published SOP or course first.");
      return;
    }
    setRunning(true);
    setFindings(null);
    try {
      const res = await runQualityCheckAction({ entityType, entityId: selected.id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setFindings(res.data);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Pick content to check</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!available && (
            <p className="rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-800">
              AI text generation isn&apos;t configured — the model-judged checks will fail until an administrator sets an
              API key. Reading level, ownership, links, and duplicates still run without it.
            </p>
          )}
          <Field label="Content type" htmlFor="qc-entity-type">
            <Select id="qc-entity-type" value={entityType} onChange={(e) => setEntityType(e.target.value as "SOP" | "COURSE")}>
              <option value="SOP">SOP</option>
              <option value="COURSE">Course</option>
            </Select>
          </Field>
          <Field label={`Search published ${entityType === "SOP" ? "SOPs" : "courses"}`} htmlFor="qc-search">
            <Input id="qc-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing a title…" />
            {options.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] p-1">
                {options.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(o);
                        setQuery(o.title);
                        setOptions([]);
                      }}
                      className="w-full rounded px-2 py-1.5 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
                    >
                      {o.title} {o.subtitle && <span className="text-[var(--text-muted)]">· {o.subtitle}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected && <p className="mt-1 text-[0.75rem] text-success-700">Selected: {selected.title}</p>}
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={handleRun} loading={running} disabled={!selected}>
            <Glyph name="sparkle" className="h-4 w-4" />
            Run quality check
          </Button>
        </CardFooter>
      </Card>

      {findings && findings.length === 0 && (
        <EmptyState
          icon={<Icon name="compliance" className="h-5 w-5" />}
          title="No issues found"
          description="This content looks clear, with no missing steps, broken links, duplicates, or ownership gaps detected."
        />
      )}

      {findings && findings.length > 0 && (
        <div className="flex flex-col gap-2">
          {findings.map((f, i) => (
            <Card key={i}>
              <CardContent className="flex flex-col gap-1.5 py-3.5">
                <div className="flex items-center gap-2">
                  <Badge tone={SEVERITY_TONE[f.severity]} dot>
                    {f.severity}
                  </Badge>
                  <span className="text-[0.75rem] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {f.category}
                  </span>
                  {f.location && <span className="text-[0.75rem] text-[var(--text-muted)]">· {f.location}</span>}
                </div>
                <p className="text-[0.8125rem] text-[var(--text-primary)]">{f.finding}</p>
                <p className="text-[0.8125rem] text-[var(--text-secondary)]">
                  <span className="font-medium">Suggestion:</span> {f.suggestion}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
