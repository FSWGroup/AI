/**
 * The candidate's booking endpoint.
 *
 * Authenticated by the token in the link. Offers times, books one, moves it,
 * or cancels — all from the same link, because a candidate who needs to move
 * an interview at 9pm should not have to find a recruiter's email address.
 */

import { z } from "zod";
import { apiError, apiOk, rateLimit, withErrorHandling } from "@/lib/api";
import { requestMeta } from "@/lib/auth/session";
import { isValidTimeZone } from "@/lib/scheduling/timezone";
import {
  bookSlot,
  cancelBooking,
  loadRequestByToken,
  slotsForRequest,
} from "@/lib/scheduling/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("book"),
    start: z.string().min(1),
    timeZone: z.string().max(64).nullish(),
  }),
  z.object({ action: z.literal("cancel"), reason: z.string().max(500).nullish() }),
]);

export const GET = withErrorHandling(async (req, ctx) => {
  const { token } = await ctx.params;
  const meta = await requestMeta();
  // Slot generation walks every panelist's calendar, so this GET is the more
  // expensive half of the route. Bounding only the POST left the costly one open.
  if (!rateLimit(`schedule-get:${meta.ip}`, 60, 60_000)) {
    return apiError("Too many requests. Please wait a moment.", 429);
  }
  const request = await loadRequestByToken(token);
  if (!request) return apiError("That link is not valid.", 404);

  const slots =
    request.status === "CANCELLED" ? [] : await slotsForRequest(request.id);

  return apiOk({
    reference: request.reference,
    status: request.status,
    title: request.title,
    notes: request.notes,
    durationMinutes: request.durationMinutes,
    roleTitle: request.application.requisition.title,
    firstName: request.application.candidate.firstName,
    panelists: request.panelists.map((p) => ({
      name: p.user.name,
      required: p.required,
    })),
    booked: request.interview
      ? {
          start: request.interview.scheduledAt,
          meetingDetail: request.interview.meetingDetail,
        }
      : null,
    canReschedule: request.rescheduleCount < request.maxReschedules,
    reschedulesLeft: request.maxReschedules - request.rescheduleCount,
    slots: slots.map((s) => ({ start: s.start, end: s.end })),
  });
});

export const POST = withErrorHandling(async (req, ctx) => {
  const { token } = await ctx.params;
  const meta = await requestMeta();
  if (!rateLimit(`schedule:${meta.ip}`, 60, 60_000)) {
    return apiError("Too many requests. Please wait a moment.", 429);
  }

  const request = await loadRequestByToken(token);
  if (!request) return apiError("That link is not valid.", 404);

  const body = await req.json().catch(() => null);
  const parsed = schema.parse(body);

  if (parsed.action === "cancel") {
    await cancelBooking({
      requestId: request.id,
      reason: parsed.reason ?? null,
      byCandidate: true,
    });
    return apiOk({ status: "CANCELLED" });
  }

  const start = new Date(parsed.start);
  if (Number.isNaN(start.getTime())) return apiError("That time is not valid.", 422);

  const timeZone =
    parsed.timeZone && isValidTimeZone(parsed.timeZone) ? parsed.timeZone : null;

  const result = await bookSlot({
    requestId: request.id,
    start,
    candidateTimeZone: timeZone,
  });
  if (!result.ok) return apiError(result.reason, 409);
  return apiOk({ status: "BOOKED", rescheduled: result.rescheduled });
});
