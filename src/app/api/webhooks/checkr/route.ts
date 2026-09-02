/**
 * Checkr webhook receiver.
 *
 * Reads the RAW body before parsing, because the signature covers the exact
 * bytes Checkr sent and re-serialized JSON is different bytes.
 *
 * Unrecognized events are recorded and acknowledged rather than rejected: a
 * 4xx makes Checkr retry, and retrying will not make an event we do not
 * handle become one we do.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  HANDLED_EVENTS,
  isWebhookConfigured,
  readSignature,
  verifySignature,
  type CheckrWebhookEvent,
} from "@/lib/checkr/webhook";
import type { BackgroundCheckStatus, Prisma } from "@prisma/client";

export const runtime = "nodejs";

function statusFor(eventType: string, report: Record<string, unknown> | undefined): {
  status?: BackgroundCheckStatus;
  result?: "CLEAR" | "CONSIDER";
} {
  const assessment = typeof report?.assessment === "string" ? report.assessment : null;
  const result =
    assessment === "clear" ? "CLEAR" : assessment === "consider" ? "CONSIDER" : undefined;

  switch (eventType) {
    case "invitation.completed":
    case "report.created":
      return { status: "PENDING" };
    case "invitation.expired":
      return { status: "INVITATION_EXPIRED" };
    case "report.completed":
      return { status: "COMPLETE", result };
    case "report.updated":
      return { result };
    case "report.suspended":
      return { status: "SUSPENDED" };
    case "report.resumed":
      return { status: "PENDING" };
    default:
      return {};
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isWebhookConfigured()) {
    // Without a secret nothing can be verified, and an unverified webhook is
    // an open endpoint that mutates hiring records.
    return NextResponse.json({ error: "Webhooks are not configured." }, { status: 503 });
  }

  const raw = await req.text();
  if (!verifySignature(raw, readSignature(req.headers))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: CheckrWebhookEvent;
  try {
    event = JSON.parse(raw) as CheckrWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const object = event.data?.object ?? {};
  const objectId = typeof object.id === "string" ? object.id : null;
  const candidateId =
    typeof object.candidate_id === "string" ? object.candidate_id : null;
  const reportId =
    typeof object.report_id === "string"
      ? object.report_id
      : event.type.startsWith("report.")
        ? objectId
        : null;

  // Match on whichever identifier the event carries. Checkr scopes an event
  // to whatever object it is about, so the object's own id may be a report, an
  // invitation, or a candidate depending on the event type — try all three
  // rather than assuming the shape of any one payload.
  const check = await prisma.backgroundCheck.findFirst({
    where: {
      OR: [
        ...(reportId ? [{ checkrReportId: reportId }] : []),
        ...(objectId
          ? [
              { checkrInvitationId: objectId },
              { checkrCandidateId: objectId },
              { checkrReportId: objectId },
            ]
          : []),
        ...(candidateId ? [{ checkrCandidateId: candidateId }] : []),
      ],
    },
  });

  if (!check) {
    // Acknowledge: retrying will not conjure a matching record, and Checkr
    // sends events for objects created outside this integration.
    return NextResponse.json({ received: true, matched: false });
  }

  await prisma.backgroundCheckEvent.create({
    data: {
      checkId: check.id,
      type: event.type,
      summary: HANDLED_EVENTS.has(event.type)
        ? null
        : "Event recorded but not acted on.",
      payload: event as unknown as Prisma.InputJsonValue,
    },
  });

  if (HANDLED_EVENTS.has(event.type)) {
    const { status, result } = statusFor(event.type, object);
    const completedAt =
      typeof object.completed_at === "string" ? new Date(object.completed_at) : null;

    await prisma.backgroundCheck.update({
      where: { id: check.id },
      data: {
        ...(status ? { status } : {}),
        ...(result ? { result } : {}),
        ...(reportId && !check.checkrReportId ? { checkrReportId: reportId } : {}),
        ...(completedAt ? { completedAt } : {}),
        ...(event.type === "report.completed" || event.type === "report.updated"
          ? { reportSummary: object as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });

    await audit({
      actorLabel: "checkr",
      action: AUDIT_ACTIONS.BACKGROUND_CHECK_UPDATED,
      entityType: "BackgroundCheck",
      entityId: check.id,
      newValue: { event: event.type, status, result },
    });
  }

  return NextResponse.json({ received: true });
}
