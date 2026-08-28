import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { Glyph } from "@/components/icons";
import { cn, formatMinutes } from "@/lib/utils";
import type { TrainingItem } from "@/lib/services/my-training";
import { formatDueDate, formatShortDate } from "@/lib/dates";

const STATUS_TONE: Record<string, BadgeTone> = {
  ASSIGNED: "neutral",
  IN_PROGRESS: "blue",
  COMPLETED: "success",
  OVERDUE: "danger",
  WAIVED: "neutral",
  EXPIRED: "warning",
};

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Complete",
  OVERDUE: "Overdue",
  WAIVED: "Waived",
  EXPIRED: "Expired",
};

const TYPE_LABEL: Record<string, string> = {
  COURSE: "Course",
  SOP: "Procedure",
  LEARNING_PATH: "Learning path",
};

/**
 * A single training item. Used on the learner dashboard and My Training.
 *
 * Status is always carried by text, never by color alone. The assignment reason
 * is shown because mandatory training should always explain itself.
 */
export function TrainingCard({
  item,
  timezone,
  showReason = true,
  compact = false,
}: {
  item: TrainingItem;
  timezone: string;
  showReason?: boolean;
  compact?: boolean;
}) {
  const status = item.isOverdue ? "OVERDUE" : item.status;
  const tone = STATUS_TONE[status] ?? "neutral";
  const label = STATUS_LABEL[status] ?? status;
  const started = item.percentComplete > 0 && item.percentComplete < 100;

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 rounded-lg border bg-[var(--surface-card)] p-4 transition-colors",
        item.isOverdue
          ? "border-danger-100 hover:border-danger-500"
          : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={tone} dot>
              {label}
            </Badge>
            <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {TYPE_LABEL[item.targetType] ?? item.targetType}
            </span>
            {item.category && !compact && (
              <>
                <span aria-hidden="true" className="text-[var(--text-muted)]">
                  ·
                </span>
                <span className="truncate text-[0.6875rem] text-[var(--text-muted)]">
                  {item.category}
                </span>
              </>
            )}
          </div>

          <h3 className="text-[0.9375rem] font-semibold leading-snug text-[var(--text-primary)]">
            <Link
              href={item.href}
              className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {item.title}
              {/* Full-card click target without nesting interactive elements. */}
              <span className="absolute inset-0" aria-hidden="true" />
            </Link>
          </h3>

          {item.description && !compact && (
            <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-[var(--text-muted)]">
              {item.description}
            </p>
          )}
        </div>
      </div>

      {started && (
        <div className="flex items-center gap-2.5">
          <ProgressBar
            value={item.percentComplete}
            label={`${item.title} progress`}
            size="sm"
            tone={item.isOverdue ? "danger" : "brand"}
            className="flex-1"
          />
          <span className="shrink-0 text-[0.75rem] font-medium text-[var(--text-secondary)]">
            {item.percentComplete}%
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-[var(--text-muted)]">
        {item.dueAt && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              item.isOverdue && "font-semibold text-danger-700",
            )}
          >
            <Glyph name="clock" className="h-3.5 w-3.5" />
            {formatDueDate(item.dueAt, timezone)}
          </span>
        )}
        {item.estimatedMinutes && (
          <span className="inline-flex items-center gap-1">
            <Glyph name="play" className="h-3 w-3" />
            {formatMinutes(item.estimatedMinutes)}
          </span>
        )}
        {item.completedAt && (
          <span className="inline-flex items-center gap-1 text-success-700">
            <Glyph name="check" className="h-3.5 w-3.5" />
            Completed {formatShortDate(item.completedAt, timezone)}
          </span>
        )}
        {item.expiresAt && item.status === "COMPLETED" && (
          <span className="inline-flex items-center gap-1">
            Valid until {formatShortDate(item.expiresAt, timezone)}
          </span>
        )}
      </div>

      {showReason && item.reason && (
        <p className="border-t border-[var(--border-subtle)] pt-2.5 text-[0.75rem] leading-relaxed text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text-secondary)]">Why you have this: </span>
          {item.reason}
        </p>
      )}
    </div>
  );
}
