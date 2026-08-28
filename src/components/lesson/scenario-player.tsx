"use client";

import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { postProgress } from "@/components/lesson/progress-client";
import type { LessonPlayerProps } from "@/components/lesson/types";

interface ScenarioChoice {
  id: string;
  label: string;
  correct?: boolean;
  feedback?: string;
  next?: string | null;
}
interface ScenarioNode {
  id?: string;
  scenario: string;
  choices: ScenarioChoice[];
}

/**
 * Choice-based scenario. `content.next` on a choice can point to another
 * node id within `content.nodes` for simple branching; when there is no
 * `nodes` array, the lesson is a single scenario and any choice ends it.
 */
export function ScenarioPlayer({ lesson, progress, onComplete }: LessonPlayerProps) {
  const content = lesson.content as { scenario?: string; choices?: ScenarioChoice[]; nodes?: ScenarioNode[] };
  const nodes: ScenarioNode[] = content.nodes?.length
    ? content.nodes
    : content.scenario
      ? [{ id: "start", scenario: content.scenario, choices: content.choices ?? [] }]
      : [];

  const [nodeId, setNodeId] = React.useState<string | undefined>(nodes[0]?.id);
  const [chosenId, setChosenId] = React.useState<string | null>(null);
  const [finished, setFinished] = React.useState(progress?.status === "COMPLETED");
  const alreadyComplete = progress?.status === "COMPLETED";

  const node = nodes.find((n) => n.id === nodeId) ?? nodes[0];

  if (!node || node.choices.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="ai" className="h-5 w-5" />}
        title="No scenario content yet"
        description="This scenario doesn't have any choices configured yet."
      />
    );
  }

  const choice = node.choices.find((c) => c.id === chosenId) ?? null;

  async function finish() {
    setFinished(true);
    try {
      await postProgress(lesson.id, { markComplete: true });
      onComplete();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save your progress.");
    }
  }

  function selectChoice(next: ScenarioChoice) {
    setChosenId(next.id);
  }

  function continueScenario() {
    if (!choice) return;
    if (choice.next) {
      setNodeId(choice.next);
      setChosenId(null);
    } else {
      void finish();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6">
        <p className="text-[0.9375rem] leading-relaxed text-[var(--text-primary)]">{node.scenario}</p>
      </div>

      {!choice ? (
        <div className="flex flex-col gap-2">
          {node.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectChoice(c)}
              className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-3 text-left text-[0.875rem] text-[var(--text-primary)] transition-colors hover:border-[var(--brand-secondary)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : (
        <div
          className={`flex flex-col gap-3 rounded-lg border p-5 ${
            choice.correct
              ? "border-success-100 bg-success-50"
              : "border-warning-100 bg-warning-50"
          }`}
        >
          <div className="flex items-center gap-2">
            <Badge tone={choice.correct ? "success" : "warning"} dot>
              {choice.correct ? "Good choice" : "Consider this"}
            </Badge>
          </div>
          <p className="text-[0.875rem] text-[var(--text-primary)]">
            <span className="font-medium">You chose:</span> {choice.label}
          </p>
          {choice.feedback && <p className="text-[0.875rem] text-[var(--text-secondary)]">{choice.feedback}</p>}
          <div>
            <Button size="sm" onClick={continueScenario} disabled={finished}>
              {choice.next ? "Continue" : "Finish scenario"}
              <Glyph name="arrow-right" className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {alreadyComplete && (
        <p className="text-[0.8125rem] font-medium text-success-700">You&apos;ve already completed this scenario.</p>
      )}
    </div>
  );
}
