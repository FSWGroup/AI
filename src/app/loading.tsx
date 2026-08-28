import { Spinner } from "@/components/ui/button";

export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <span className="flex items-center gap-2.5 text-[0.875rem] text-[var(--text-muted)]">
        <Spinner />
        Loading…
      </span>
    </div>
  );
}
