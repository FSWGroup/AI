import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { AuthError } from "@/lib/auth/session";

/** Plain-English error body; never a stack trace. */
export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function apiOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as unknown as Record<string, unknown>, init);
}

export async function parseBody<T>(
  req: Request,
  schema: ZodSchema<T>,
): Promise<T> {
  const body = await req.json().catch(() => null);
  return schema.parse(body);
}

/** Wrap a route handler with consistent error handling. */
export function withErrorHandling(
  handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>,
) {
  return async (
    req: Request,
    ctx: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ZodError) {
        return apiError("The request was not valid. Please try again.", 422);
      }
      if (err instanceof AuthError) {
        return apiError(err.message, err.status);
      }
      console.error("[api]", err instanceof Error ? err.message : err);
      return apiError(
        "Something went wrong on our side. Please try again in a moment.",
        500,
      );
    }
  };
}

/**
 * Simple fixed-window, per-key in-memory rate limiter for sensitive routes.
 *
 * Per-process and per-instance: the counters reset on deploy and are not
 * shared between serverless instances, so the effective limit is the
 * configured one multiplied by however many instances are warm. It raises the
 * cost of abuse rather than capping it. Moving the buckets to the database or
 * to a shared cache is the fix when that stops being enough — the call sites
 * do not change.
 */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}
