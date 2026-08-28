"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Glyph, Icon } from "@/components/icons";
import { MarkCompleteButton } from "@/components/lesson/mark-complete-button";
import type { LessonPlayerProps } from "@/components/lesson/types";

interface FlashcardItem {
  id: string;
  front: string;
  back: string;
}

/** Flip-card deck. Left/Right arrows navigate, Space/Enter flips — all fully keyboard-reachable. */
export function FlashcardsPlayer({ lesson, progress, onComplete }: LessonPlayerProps) {
  const cards = ((lesson.content as { cards?: FlashcardItem[] }).cards ?? []) as FlashcardItem[];
  const [index, setIndex] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [seen, setSeen] = React.useState<Set<string>>(new Set());
  const containerRef = React.useRef<HTMLDivElement>(null);
  const alreadyComplete = progress?.status === "COMPLETED";

  const card = cards[index];

  React.useEffect(() => {
    if (card) setSeen((prev) => new Set(prev).add(card.id));
  }, [card]);

  if (cards.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="knowledge" className="h-5 w-5" />}
        title="No flashcards yet"
        description="This deck doesn't have any cards configured yet."
      />
    );
  }

  const goTo = (next: number) => {
    setIndex(Math.max(0, Math.min(cards.length - 1, next)));
    setFlipped(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(index - 1);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setFlipped((f) => !f);
    }
  };

  const allSeen = seen.size >= cards.length;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full items-center justify-between text-[0.8125rem] text-[var(--text-muted)]">
        <span>
          Card {index + 1} of {cards.length}
        </span>
        <span>Space or Enter to flip · Arrow keys to move</span>
      </div>

      <div
        ref={containerRef}
        role="button"
        tabIndex={0}
        aria-label={flipped ? `Answer: ${card?.back ?? ""}. Press space to see the question again.` : `Question: ${card?.front ?? ""}. Press space to reveal the answer.`}
        onClick={() => setFlipped((f) => !f)}
        onKeyDown={onKeyDown}
        className="flex h-64 w-full max-w-xl cursor-pointer items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center shadow-sm transition-colors hover:border-[var(--brand-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <div>
          <Badge tone={flipped ? "success" : "navy"} className="mb-3">
            {flipped ? "Answer" : "Question"}
          </Badge>
          <p className="text-[1.125rem] font-medium text-[var(--text-primary)]">
            {flipped ? card?.back : card?.front}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => goTo(index - 1)} disabled={index === 0}>
          <Glyph name="arrow-left" className="h-4 w-4" />
          Previous
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setFlipped((f) => !f)}>
          Flip
        </Button>
        <Button variant="outline" size="sm" onClick={() => goTo(index + 1)} disabled={index === cards.length - 1}>
          Next
          <Glyph name="arrow-right" className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex w-full items-center justify-between border-t border-[var(--border-subtle)] pt-4">
        <span className="text-[0.75rem] text-[var(--text-muted)]">
          {seen.size} of {cards.length} cards viewed
        </span>
        {allSeen ? (
          <MarkCompleteButton lessonId={lesson.id} alreadyComplete={alreadyComplete} onComplete={onComplete} />
        ) : (
          <span className="text-[0.75rem] text-[var(--text-muted)]">View every card to finish this deck.</span>
        )}
      </div>
    </div>
  );
}
