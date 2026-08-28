import { Badge, type BadgeTone } from "@/components/ui/badge";

export const USER_STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  INVITED: "info",
  INACTIVE: "neutral",
};

export const ASSIGNMENT_STATUS_TONE: Record<string, BadgeTone> = {
  ASSIGNED: "neutral",
  IN_PROGRESS: "blue",
  COMPLETED: "success",
  OVERDUE: "danger",
  WAIVED: "neutral",
  EXPIRED: "warning",
};

export const ASSIGNMENT_STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Complete",
  OVERDUE: "Overdue",
  WAIVED: "Waived",
  EXPIRED: "Expired",
};

export const MATRIX_CELL_TONE: Record<string, BadgeTone> = {
  NOT_REQUIRED: "neutral",
  NOT_STARTED: "neutral",
  IN_PROGRESS: "blue",
  COMPLETE: "success",
  OVERDUE: "danger",
  EXPIRED: "warning",
  EXEMPT: "info",
  WAIVED: "neutral",
};

export const MATRIX_CELL_LABEL: Record<string, string> = {
  NOT_REQUIRED: "—",
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
  OVERDUE: "Overdue",
  EXPIRED: "Expired",
  EXEMPT: "Exempt",
  WAIVED: "Waived",
};

function titleCase(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export function WorkerTypeBadge({ workerType }: { workerType: string }) {
  return <Badge tone={workerType.endsWith("CONTRACTOR") ? "warning" : "neutral"}>{titleCase(workerType)}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={USER_STATUS_TONE[status] ?? "neutral"} dot>
      {titleCase(status)}
    </Badge>
  );
}

export function AssignmentStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={ASSIGNMENT_STATUS_TONE[status] ?? "neutral"} dot>
      {ASSIGNMENT_STATUS_LABEL[status] ?? titleCase(status)}
    </Badge>
  );
}

export function MatrixCellBadge({ state }: { state: string }) {
  return <Badge tone={MATRIX_CELL_TONE[state] ?? "neutral"}>{MATRIX_CELL_LABEL[state] ?? titleCase(state)}</Badge>;
}
