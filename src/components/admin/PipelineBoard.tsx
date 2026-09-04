"use client";

/**
 * The pipeline board: one column per stage, candidates as cards.
 *
 * Drag-and-drop is implemented with the HTML5 drag API and a keyboard path
 * alongside it. A board that can only be operated with a mouse locks out
 * anyone using a keyboard or a screen reader — in a hiring tool that is both
 * an accessibility failure and, for an employer, a liability.
 */

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { Badge, Card } from "@/components/ui";

export interface BoardStage {
  id: string;
  name: string;
  kind: string;
  orderIndex: number;
}

export interface BoardCard {
  id: string;
  reference: string;
  candidateName: string;
  stageId: string | null;
  knockedOut: boolean;
  knockoutReason: string | null;
  channelName: string | null;
  appliedAt: string;
  daysInStage: number;
  scorecardSummary: string | null;
}

const KIND_TONE: Record<string, "neutral" | "blue" | "green" | "amber"> = {
  APPLIED: "neutral",
  SCREEN: "blue",
  ASSESSMENT: "blue",
  INTERVIEW: "blue",
  REFERENCE: "blue",
  OFFER: "amber",
  HIRED: "green",
};

export function PipelineBoard({
  stages,
  cards,
  canMove,
}: {
  stages: BoardStage[];
  cards: BoardCard[];
  canMove: boolean;
}) {
  const { busy, error, run } = useAction();
  const [dragging, setDragging] = useState<string | null>(null);
  /** Card selected for a keyboard move, if any. */
  const [picked, setPicked] = useState<BoardCard | null>(null);

  async function move(applicationId: string, stageId: string): Promise<void> {
    await run(async () => {
      await api(`/api/admin/applications/${applicationId}`, {
        body: { action: "move_stage", stageId },
      });
      setPicked(null);
    }, { fallback: "The move failed." });
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {error}
        </p>
      )}
      {picked && (
        <p role="status" className="mb-3 rounded-lg bg-fsw-50 p-3 text-sm text-fsw-900">
          {picked.candidateName} is selected. Choose a stage below to move them, or
          press Escape to cancel.
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const stageCards = cards.filter((c) => c.stageId === stage.id);
          return (
            <section
              key={stage.id}
              className="w-64 shrink-0"
              onDragOver={(e) => {
                if (canMove && dragging) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging && canMove) void move(dragging, stage.id);
                setDragging(null);
              }}
            >
              <div className="flex items-center justify-between rounded-t-xl border border-navy-100 bg-navy-50 px-3 py-2">
                <h3 className="truncate text-xs font-bold uppercase tracking-wide text-navy-700">
                  {stage.name}
                </h3>
                <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-navy-700">
                  {stageCards.length}
                </span>
              </div>

              {picked && picked.stageId !== stage.id && canMove && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void move(picked.id, stage.id)}
                  className="w-full border-x border-navy-100 bg-fsw-600 px-3 py-2 text-xs font-semibold text-white hover:bg-fsw-700"
                >
                  Move {picked.candidateName.split(" ")[0]} here
                </button>
              )}

              <div className="min-h-[6rem] space-y-2 rounded-b-xl border border-t-0 border-navy-100 bg-white p-2">
                {stageCards.length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-navy-300">
                    No candidates
                  </p>
                )}
                {stageCards.map((card) => (
                  <article
                    key={card.id}
                    draggable={canMove}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => setDragging(null)}
                    className={`rounded-lg border border-navy-100 p-2.5 text-sm ${
                      picked?.id === card.id ? "ring-2 ring-fsw-500" : ""
                    } ${canMove ? "cursor-grab active:cursor-grabbing" : ""}`}
                  >
                    <Link
                      href={`/admin/recruiting/applications/${card.id}`}
                      className="font-semibold text-navy-900 hover:text-fsw-700 hover:underline"
                    >
                      {card.candidateName}
                    </Link>
                    <p className="mt-0.5 text-[11px] text-navy-400">
                      {card.channelName ?? "Unknown source"} · {card.daysInStage}d in
                      stage
                    </p>
                    {card.knockedOut && (
                      <p className="mt-1.5 rounded bg-amber-50 px-1.5 py-1 text-[11px] leading-snug text-amber-900">
                        Screening flag: {card.knockoutReason ?? "review the answers"}
                      </p>
                    )}
                    {card.scorecardSummary && (
                      <p className="mt-1.5 text-[11px] text-navy-600">
                        {card.scorecardSummary}
                      </p>
                    )}
                    {canMove && (
                      <button
                        type="button"
                        onClick={() =>
                          setPicked(picked?.id === card.id ? null : card)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setPicked(null);
                        }}
                        className="mt-2 text-[11px] font-semibold text-fsw-700 hover:underline"
                        aria-pressed={picked?.id === card.id}
                      >
                        {picked?.id === card.id ? "Cancel move" : "Move…"}
                      </button>
                    )}
                  </article>
                ))}
              </div>
              <p className="mt-1 px-1 text-[10px] uppercase tracking-wide text-navy-300">
                <Badge tone={KIND_TONE[stage.kind] ?? "neutral"}>
                  {stage.kind.toLowerCase()}
                </Badge>
              </p>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function EmptyBoard() {
  return (
    <Card className="p-8 text-center text-sm text-navy-400">
      No applications yet. Publish the role or add a candidate manually to get
      started.
    </Card>
  );
}
