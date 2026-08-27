/**
 * Server-authoritative timing helpers.
 *
 * The database stores startedAt / durationSeconds / expiresAt for each timed
 * attempt section. Remaining time is ALWAYS derived from the server clock and
 * the stored expiresAt — never from a client countdown, so refreshes, client
 * clock changes, and disconnects cannot add time.
 */

export function computeExpiry(
  startedAt: Date,
  durationSeconds: number,
  timeMultiplier = 1,
): Date {
  const effective = Math.round(durationSeconds * timeMultiplier);
  return new Date(startedAt.getTime() + effective * 1000);
}

export function remainingSeconds(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/** Warning points (seconds remaining) appropriate for a section's length. */
export function warningPoints(durationSeconds: number): number[] {
  const points = [300, 120, 60, 30].filter((p) => p < durationSeconds);
  return points.length > 0 ? points : [Math.floor(durationSeconds / 2)];
}
