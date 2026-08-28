export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="h-7 w-56 animate-pulse rounded bg-ink-100" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-card bg-ink-100" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-card bg-ink-100" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
