"use client";

import * as React from "react";
import type { SearchResult } from "@/lib/search";

/**
 * A "person" filter is rendered as a live search combobox (backed by
 * /api/search) rather than a giant <select> of every person in the org.
 * Submits the chosen person's id in a hidden input with the given name.
 */
export function PersonFilter({ name, label, defaultId, defaultLabel }: { name: string; label: string; defaultId?: string; defaultLabel?: string }) {
  const [query, setQuery] = React.useState(defaultLabel ?? "");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [selectedId, setSelectedId] = React.useState(defaultId ?? "");
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (query.trim().length < 2 || query === defaultLabel) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&types=PERSON&limit=8`, { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as { results: SearchResult[] };
        setResults(data.results);
        setOpen(true);
      } catch {
        // ignore
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={`${name}-query`} className="text-[0.8125rem] font-medium text-[var(--text-primary)]">
        {label}
      </label>
      <input
        id={`${name}-query`}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedId("");
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search by name or email…"
        autoComplete="off"
        className="h-9.5 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)] shadow-xs focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)]"
      />
      <input type="hidden" name={name} value={selectedId} />
      {open && results.length > 0 && (
        <ul className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] shadow-lg">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(r.id);
                  setQuery(r.title);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-[0.8125rem] hover:bg-[var(--surface-sunken)]"
              >
                <span className="font-medium text-[var(--text-primary)]">{r.title}</span>
                {r.subtitle && <span className="ml-1.5 text-[var(--text-muted)]">{r.subtitle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
