import type { ReactNode } from "react";

export type Tone = "green" | "amber" | "grey" | "red" | "blue" | "neutral";

const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 border-emerald-300",
  amber: "bg-amber-50 text-amber-800 border-amber-300",
  grey: "bg-slate-100 text-slate-700 border-slate-300",
  red: "bg-red-50 text-red-800 border-red-300",
  blue: "bg-blue-50 text-blue-800 border-blue-300",
  neutral: "bg-white text-slate-700 border-slate-300",
};

export function Badge({ tone = "neutral", children, title, mono }: { tone?: Tone; children: ReactNode; title?: string; mono?: boolean }) {
  return (
    <span title={title} className={`inline-block whitespace-nowrap rounded border px-1.5 py-[1px] text-[11px] font-medium leading-4 ${mono ? "mono" : ""} ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function confidenceTone(c: string | null | undefined): Tone {
  if (c === "VERIFIED") return "green";
  if (c === "NEEDS_REVIEW") return "amber";
  return "grey";
}

export function statusTone(s: string | null | undefined): Tone {
  switch (s) {
    case "verified": case "human_approved": case "approved": case "resolved": case "succeeded": case "mapped": case "answered": case "corrected": return "green";
    case "pending": case "review": case "partial": case "open": case "queued": case "running": case "ambiguous": case "extracted": return "amber";
    case "conflicting": case "rejected": case "failed": case "error": case "conflict": case "deprecated": case "removed_unsupported": case "removed_conflict": case "removed_stale": case "removed_channel": case "removed_unapproved": return "red";
    case "abstained": case "assumption": case "unmapped": case "escalated": return "grey";
    default: return "neutral";
  }
}

export function verdictTone(v: string | null | undefined): Tone {
  if (v === "MATCH" || v === "EXPLICIT" || v === "pass") return "green";
  if (v === "MISMATCH" || v === "fail") return "red";
  if (v === "INFERRED") return "amber";
  return "grey";
}

export function ConfidenceBadge({ confidence, outcome }: { confidence: string; outcome?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={confidenceTone(confidence)}>{confidence}</Badge>
      {outcome ? <Badge tone={statusTone(outcome)}>{outcome}</Badge> : null}
    </span>
  );
}
