import type { NearMissSeverity } from "@prisma/client";
import type { BadgeTone } from "@/components/ui/badge";

/**
 * Severity → badge tone, in one place so the library, the detail page and the
 * review queue cannot drift apart. "Caught in time" is deliberately the
 * positive tone: a control worked, and the library should read that way.
 */
export const SEVERITY_TONE: Record<NearMissSeverity, BadgeTone> = {
  NEAR_MISS: "success",
  MINOR: "info",
  SIGNIFICANT: "warning",
  SERIOUS: "danger",
};
