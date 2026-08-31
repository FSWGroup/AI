"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Glyph } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/lib/search";

/**
 * Global command palette (Cmd/Ctrl+K).
 *
 * Combines quick actions with permission-filtered search. Search runs
 * server-side through /api/search, so a user can never see results for content
 * they lack access to, regardless of what they type.
 */

export interface QuickAction {
  label: string;
  href: string;
  keywords: string;
}

const ENTITY_LABELS: Record<string, string> = {
  SOP: "SOP",
  COURSE: "Course",
  LESSON: "Lesson",
  LEARNING_PATH: "Path",
  PERSON: "Person",
  SKILL: "Skill",
  VIDEO: "Video",
  NEAR_MISS: "Near miss",
};

export function CommandPalette({ quickActions }: { quickActions: QuickAction[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const filteredActions = query.trim()
    ? quickActions.filter(
        (action) =>
          action.label.toLowerCase().includes(query.toLowerCase()) ||
          action.keywords.toLowerCase().includes(query.toLowerCase()),
      )
    : quickActions;

  const items: { kind: "action" | "result"; label: string; sublabel?: string; href: string }[] = [
    ...filteredActions.map((a) => ({ kind: "action" as const, label: a.label, href: a.href })),
    ...results.map((r) => ({
      kind: "result" as const,
      label: r.title,
      sublabel: [ENTITY_LABELS[r.entityType], r.subtitle].filter(Boolean).join(" · "),
      href: r.href,
    })),
  ];

  // Open with Cmd/Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Manage focus: remember the trigger, focus the input, restore on close.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => inputRef.current?.focus());
      document.body.style.overflow = "hidden";
    } else {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      document.body.style.overflow = "";
      previouslyFocused.current?.focus?.();
    }
  }, [open]);

  // Debounced server search.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}&limit=12`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search failed");
        const data = (await response.json()) as { results: SearchResult[] };
        setResults(data.results);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = items[activeIndex];
      if (target) navigate(target.href);
    }
  };

  // Keep the active option scrolled into view for keyboard users.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border border-[var(--border-default)]",
          "bg-[var(--surface-card)] px-2.5 text-[0.8125rem] text-[var(--text-muted)]",
          "hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          "w-full max-w-xs sm:w-64",
        )}
      >
        <Glyph name="search" className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-navy-950/45 p-4 pt-[10vh]"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search and commands"
            className="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] shadow-lg"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5">
              <Glyph name="search" className="h-4.5 w-4.5 shrink-0 text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search SOPs, courses, people, or run a command…"
                aria-label="Search"
                aria-autocomplete="list"
                aria-controls="command-palette-list"
                aria-activedescendant={items[activeIndex] ? `cp-option-${activeIndex}` : undefined}
                className="h-12 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              {loading && (
                <span className="text-[0.6875rem] text-[var(--text-muted)]" role="status">
                  Searching…
                </span>
              )}
            </div>

            <ul
              id="command-palette-list"
              ref={listRef}
              role="listbox"
              aria-label="Results"
              className="max-h-[min(60vh,26rem)] overflow-y-auto py-1.5"
            >
              {items.length === 0 && (
                <li className="px-4 py-8 text-center text-[0.8125rem] text-[var(--text-muted)]">
                  {query.trim().length < 2
                    ? "Type at least two characters to search."
                    : `No results for "${query.trim()}".`}
                </li>
              )}

              {items.map((item, index) => (
                <li key={`${item.kind}-${item.href}-${index}`} role="none">
                  <button
                    type="button"
                    id={`cp-option-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === activeIndex}
                    onClick={() => navigate(item.href)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3.5 py-2 text-left text-[0.8125rem]",
                      index === activeIndex
                        ? "bg-[var(--surface-sunken)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)]",
                    )}
                  >
                    <Glyph
                      name={item.kind === "action" ? "plus" : "arrow-right"}
                      className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
                    />
                    <span className="flex-1 truncate font-medium">{item.label}</span>
                    {item.sublabel && (
                      <span className="shrink-0 truncate text-[0.75rem] text-[var(--text-muted)]">
                        {item.sublabel}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3.5 py-2 text-[0.6875rem] text-[var(--text-muted)]">
              <span>↑↓ to navigate</span>
              <span>↵ to open</span>
              <span>esc to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
