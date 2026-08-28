import { Badge } from "@/components/ui/badge";
import { Glyph } from "@/components/icons";

/** Shown on every piece of AI-drafted content, everywhere it can appear. */
export function AiGeneratedBadge({ className }: { className?: string }) {
  return (
    <Badge tone="accent" className={className}>
      <Glyph name="sparkle" className="h-3 w-3" />
      AI-generated — needs review
    </Badge>
  );
}
