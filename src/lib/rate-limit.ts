import "server-only";
import { prisma } from "@/lib/db";

/**
 * Database-backed fixed-window rate limiting.
 *
 * Postgres-backed rather than in-memory so limits hold across multiple
 * instances behind a load balancer, which an in-memory counter cannot do.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

export const RATE_LIMITS = {
  /** Sign-in attempts per IP. */
  login: { limit: 10, windowSeconds: 300 },
  /** AI questions per user — protects spend and the provider quota. */
  ai: { limit: 40, windowSeconds: 3600 },
  /** AI generation jobs per user. */
  aiGenerate: { limit: 20, windowSeconds: 3600 },
  /** Video render jobs per user. */
  videoRender: { limit: 10, windowSeconds: 3600 },
  /** Public REST API calls per key. */
  api: { limit: 600, windowSeconds: 3600 },
  /** Search requests per user. */
  search: { limit: 300, windowSeconds: 300 },
  /** Uploads per user. */
  upload: { limit: 60, windowSeconds: 3600 },
  /** Public certificate verification per IP. */
  verify: { limit: 30, windowSeconds: 300 },
} as const;

export type RateLimitKind = keyof typeof RATE_LIMITS;

/**
 * Consume one unit from a bucket. Uses a single upsert-then-check so concurrent
 * requests cannot both pass the limit.
 */
export async function checkRateLimit(
  kind: RateLimitKind,
  identifier: string,
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[kind];
  const key = `${kind}:${identifier}`;
  const now = new Date();
  const resetAt = new Date(now.getTime() + config.windowSeconds * 1000);

  // Atomic: insert a fresh bucket, or increment an existing one — resetting the
  // window when it has already elapsed.
  const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE
    SET "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt}
          ELSE "RateLimitBucket"."resetAt"
        END
    RETURNING "count", "resetAt"
  `;

  const row = rows[0];
  if (!row) {
    // Bucket write failed; fail open rather than locking everyone out, but log it.
    console.error("[rate-limit] bucket write returned no row", { kind, key });
    return { allowed: true, remaining: config.limit, resetAt, limit: config.limit };
  }

  const count = Number(row.count);
  return {
    allowed: count <= config.limit,
    remaining: Math.max(0, config.limit - count),
    resetAt: row.resetAt,
    limit: config.limit,
  };
}

/** Throwable variant for API routes. */
export class RateLimitError extends Error {
  readonly resetAt: Date;
  readonly limit: number;
  constructor(resetAt: Date, limit: number) {
    const seconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
    super(`Rate limit of ${limit} exceeded. Try again in ${seconds} seconds.`);
    this.name = "RateLimitError";
    this.resetAt = resetAt;
    this.limit = limit;
  }
}

export async function assertRateLimit(kind: RateLimitKind, identifier: string): Promise<void> {
  const result = await checkRateLimit(kind, identifier);
  if (!result.allowed) throw new RateLimitError(result.resetAt, result.limit);
}

/** Remove expired buckets. Called by the retention sweep job. */
export async function pruneRateLimitBuckets(): Promise<number> {
  const result = await prisma.rateLimitBucket.deleteMany({
    where: { resetAt: { lt: new Date() } },
  });
  return result.count;
}
