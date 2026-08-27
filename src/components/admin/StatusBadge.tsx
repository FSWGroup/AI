import { Badge } from "@/components/ui";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { tone: "neutral" | "blue" | "green" | "amber" | "red"; label: string }
  > = {
    NOT_STARTED: { tone: "neutral", label: "Not started" },
    IN_PROGRESS: { tone: "blue", label: "In progress" },
    INTERRUPTED: { tone: "amber", label: "Interrupted" },
    COMPLETED: { tone: "green", label: "Completed" },
    EXPIRED: { tone: "neutral", label: "Expired" },
    INVALIDATED: { tone: "red", label: "Invalidated" },
    PENDING: { tone: "neutral", label: "Pending" },
    OPENED: { tone: "blue", label: "Opened" },
    STARTED: { tone: "blue", label: "Started" },
    REVOKED: { tone: "red", label: "Revoked" },
  };
  const cfg = map[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}
