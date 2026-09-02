/** The .ics file for a booked interview. Works with no calendar integration. */

import { NextResponse } from "next/server";
import { apiError, withErrorHandling } from "@/lib/api";
import { requirePermission } from "@/lib/auth/session";
import { icsFileName } from "@/lib/calendar";
import { interviewCalendarEvent } from "@/lib/scheduling/service";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (req, ctx) => {
  await requirePermission("MANAGE_INTERVIEWS");
  const { interviewId } = await ctx.params;
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
