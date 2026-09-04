/** The .ics file for a booked interview. Works with no calendar integration. */

import { NextResponse } from "next/server";
import { apiError, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { assertInterviewAccess } from "@/lib/auth/scope";
import { icsFileName } from "@/lib/calendar";
import { interviewCalendarEvent } from "@/lib/scheduling/service";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (req, ctx) => {
  const user = await requirePermission("MANAGE_INTERVIEWS");
  const { interviewId } = await ctx.params;
  // The file carries the candidate's name and email address and every
  // panelist's. MANAGE_INTERVIEWS says you run interviews; it does not say
  // whose, and without this a job-scoped manager can walk interview ids and
  // harvest an address book of every candidate in the company.
  await assertInterviewAccess(user, interviewId);
  const cancelled = new URL(req.url).searchParams.get("cancelled") === "1";

  const out = await interviewCalendarEvent(interviewId, { cancelled });
  if (!out) return apiError("That interview does not exist.", 404);

  return new NextResponse(out.ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${icsFileName(out.event.title)}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
