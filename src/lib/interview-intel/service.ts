/**
 * Interview intelligence service.
 *
 * The consent gate is checked on every path that touches a recording or a
 * transcript, not once at the start. A candidate can withdraw at any moment,
 * and "we already had consent when we started" is not a defence for holding
 * the file afterwards.
 */

import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/crypto";
import { getStorage } from "@/lib/storage";
import {
  CANDIDATE_CONSENT_VERSION,
  canRecord,
  type ConsentRow,
} from "./consent";
import {
  parseTranscript,
  transcriptDurationSeconds,
  transcriptForPrompt,
  type Segment,
} from "./transcript";
import { extractInterviewEvidence } from "@/lib/ai/interview-evidence";
import { filterEvidence } from "./filter";

/**
 * The non-null key a consent row is unique on.
 *
 * "CANDIDATE" rather than null, because a unique index over a nullable column
 * constrains nothing in Postgres: NULL is never equal to NULL, so two
 * candidate rows for one interview would both be accepted and "did the
 * candidate agree?" would have two answers.
 */
export function partyKeyFor(userId: string | null): string {
  return userId ?? "CANDIDATE";
}

/** Everyone whose agreement is needed: the candidate and every participant. */
export async function expectedParties(interviewId: string) {
  const interview = await prisma.interview.findUniqueOrThrow({
    where: { id: interviewId },
    include: { participants: { select: { userId: true } } },
  });
  return [
    { party: "CANDIDATE" as const, userId: null },
    ...interview.participants.map((p) => ({
      party: "INTERVIEWER" as const,
      userId: p.userId,
    })),
  ];
}

export async function consentState(interviewId: string) {
  const [expected, consents] = await Promise.all([
    expectedParties(interviewId),
    prisma.interviewRecordingConsent.findMany({ where: { interviewId } }),
  ]);
  const rows: ConsentRow[] = consents.map((c) => ({
    party: c.party,
    userId: c.userId,
    status: c.status,
  }));
  return { expected, consents, gate: canRecord(expected, rows) };
}

/**
 * Open the asking. Creates a PENDING row for every party and a link for the
 * candidate.
 */
export async function requestConsent(args: {
  interviewId: string;
  actorId: string;
  baseUrl: string;
}): Promise<{ candidateUrl: string }> {
  const expected = await expectedParties(args.interviewId);
  const token = generateToken();

  await prisma.$transaction(async (tx) => {
    for (const party of expected) {
      await tx.interviewRecordingConsent.upsert({
        where: {
          interviewId_partyKey: {
            interviewId: args.interviewId,
            partyKey: partyKeyFor(party.userId),
          },
        },
        create: {
          interviewId: args.interviewId,
          party: party.party,
          userId: party.userId,
          partyKey: partyKeyFor(party.userId),
          statementVersion: CANDIDATE_CONSENT_VERSION,
          ...(party.party === "CANDIDATE" ? { tokenHash: hashToken(token) } : {}),
        },
        update: {},
      });
    }
    await tx.interviewRecording.upsert({
      where: { interviewId: args.interviewId },
      create: { interviewId: args.interviewId, status: "AWAITING_CONSENT" },
      update: {},
    });
  });

  await audit({
    userId: args.actorId,
    action: "interview_recording.consent_requested",
    entityType: "Interview",
    entityId: args.interviewId,
    newValue: { parties: expected.length },
  });

  return {
    candidateUrl: `${args.baseUrl.replace(/\/$/, "")}/interview-consent/${token}`,
  };
}

export async function recordDecision(args: {
  interviewId: string;
  party: "CANDIDATE" | "INTERVIEWER";
  userId: string | null;
  status: "GRANTED" | "DECLINED" | "WITHDRAWN";
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await prisma.interviewRecordingConsent.update({
    where: {
      interviewId_partyKey: {
        interviewId: args.interviewId,
        partyKey: partyKeyFor(args.userId),
      },
    },
    data: {
      status: args.status,
      decidedAt: new Date(),
      ip: args.ip ?? null,
      userAgent: args.userAgent?.slice(0, 400) ?? null,
      // The link is spent on the first answer. Changing your mind afterwards
      // goes through the withdrawal path, which also destroys the recording.
      ...(args.status !== "WITHDRAWN" ? { tokenHash: null } : {}),
    },
  });

  await audit({
    actorLabel: args.party === "CANDIDATE" ? "candidate" : undefined,
    userId: args.party === "INTERVIEWER" ? args.userId : null,
    action: `interview_recording.${args.status.toLowerCase()}`,
    entityType: "Interview",
    entityId: args.interviewId,
  });

  if (args.status === "WITHDRAWN") {
    await destroyRecording(args.interviewId, "consent withdrawn");
    return;
  }

  // Once everyone has agreed, the recording is allowed to exist.
  const { gate } = await consentState(args.interviewId);
  if (gate.ok) {
    await prisma.interviewRecording.updateMany({
      where: { interviewId: args.interviewId, status: "AWAITING_CONSENT" },
      data: { status: "READY" },
    });
  }
}

/**
 * Destroy the media and everything derived from it.
 *
 * A withdrawal is not a flag to be respected next time — it means what has
 * been captured goes, including the transcript and the extracted quotes,
 * because those are the recording in another form.
 */
export async function destroyRecording(
  interviewId: string,
  reason: string,
): Promise<void> {
  const recording = await prisma.interviewRecording.findUnique({
    where: { interviewId },
  });
  if (!recording) return;

  if (recording.objectKey) {
    await getStorage().deleteObject(recording.objectKey).catch(() => {});
  }
  await prisma.$transaction([
    prisma.interviewEvidence.deleteMany({ where: { recordingId: recording.id } }),
    prisma.transcriptSegment.deleteMany({ where: { recordingId: recording.id } }),
    prisma.interviewRecording.update({
      where: { id: recording.id },
      data: {
        status: "DELETED",
        objectKey: null,
        fileName: null,
        mimeType: null,
        sizeBytes: null,
        mediaDeletedAt: new Date(),
      },
    }),
  ]);

  await audit({
    action: "interview_recording.destroyed",
    entityType: "Interview",
    entityId: interviewId,
    newValue: { reason },
  });
}

// ---------------------------------------------------------------------------
// Media and transcript
// ---------------------------------------------------------------------------

export async function storeAudio(args: {
  interviewId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { gate } = await consentState(args.interviewId);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const safe = args.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100);
  const key = `interview-recordings/${args.interviewId}/${Date.now()}-${safe}`;
  await getStorage().putObject(key, args.bytes, args.mimeType);

  await prisma.interviewRecording.update({
    where: { interviewId: args.interviewId },
    data: {
      status: "UPLOADED",
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: args.bytes.length,
      objectKey: key,
      uploadedById: args.actorId,
      uploadedAt: new Date(),
    },
  });

  await audit({
    userId: args.actorId,
    action: "interview_recording.uploaded",
    entityType: "Interview",
    entityId: args.interviewId,
    newValue: { fileName: args.fileName, bytes: args.bytes.length },
  });
  return { ok: true };
}

export async function storeTranscript(args: {
  interviewId: string;
  raw: string;
  actorId: string;
}): Promise<
  | { ok: true; segments: number; hasTimestamps: boolean; format: string }
  | { ok: false; reason: string }
> {
  const { gate } = await consentState(args.interviewId);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const parsed = parseTranscript(args.raw);
  if (parsed.segments.length === 0) {
    return {
      ok: false,
      reason:
        "Nothing could be read from that. WebVTT, SRT, or plain text with a speaker name before a colon on each line.",
    };
  }

  const recording = await prisma.interviewRecording.findUniqueOrThrow({
    where: { interviewId: args.interviewId },
  });

  await prisma.$transaction([
    prisma.interviewEvidence.deleteMany({ where: { recordingId: recording.id } }),
    prisma.transcriptSegment.deleteMany({ where: { recordingId: recording.id } }),
    prisma.transcriptSegment.createMany({
      data: parsed.segments.map((s) => ({
        recordingId: recording.id,
        orderIndex: s.orderIndex,
        speakerLabel: s.speakerLabel,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
      })),
    }),
    prisma.interviewRecording.update({
      where: { id: recording.id },
      data: {
        status: "TRANSCRIBED",
        transcribedAt: new Date(),
        transcriptSource: `uploaded_${parsed.format}`,
        durationSeconds:
          transcriptDurationSeconds(parsed.segments) ?? recording.durationSeconds,
      },
    }),
  ]);

  await audit({
    userId: args.actorId,
    action: "interview_recording.transcript_stored",
    entityType: "Interview",
    entityId: args.interviewId,
    newValue: { segments: parsed.segments.length, format: parsed.format },
  });

  return {
    ok: true,
    segments: parsed.segments.length,
    hasTimestamps: parsed.hasTimestamps,
    format: parsed.format,
  };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface EvidenceRunResult {
  stored: number;
  droppedUnlocatable: number;
  droppedEvaluative: number;
  competenciesWithNoEvidence: string[];
  notes: string[];
}

/**
 * Run the extraction and store what survives the checks.
 *
 * Two filters, both applied to what the model returns:
 *
 *   A quote that cannot be located in the transcript is DROPPED, not stored
 *   with a caveat. An unlocatable quote attributed to a candidate is a
 *   fabrication, and a caveat under it does not stop an interviewer reading
 *   the quote.
 *
 *   A relevance sentence containing evaluative wording has that sentence
 *   replaced, because the sentence is what an interviewer will read fastest
 *   and "a strong answer" is the model rating the candidate by the back door.
 */
export async function runEvidenceExtraction(args: {
  interviewId: string;
  actorId: string;
}): Promise<EvidenceRunResult | { error: string }> {
  const { gate } = await consentState(args.interviewId);
  if (!gate.ok) return { error: gate.reason };

  const recording = await prisma.interviewRecording.findUnique({
    where: { interviewId: args.interviewId },
    include: {
      segments: { orderBy: { orderIndex: "asc" } },
      interview: {
        include: {
          kit: { include: { competencies: { orderBy: { orderIndex: "asc" } } } },
          application: { include: { requisition: { select: { title: true } } } },
        },
      },
    },
  });
  if (!recording) return { error: "There is no recording for this interview." };
  if (recording.segments.length === 0) {
    return { error: "Add a transcript before running the analysis." };
  }
  const competencies = recording.interview.kit?.competencies ?? [];
  if (competencies.length === 0) {
    return {
      error:
        "This interview has no kit, so there are no competencies to find evidence against. Attach a kit first — evidence with nothing to be evidence FOR is just a highlight reel.",
    };
  }

  const segments: Segment[] = recording.segments.map((s) => ({
    orderIndex: s.orderIndex,
    speakerLabel: s.speakerLabel,
    startMs: s.startMs,
    endMs: s.endMs,
    text: s.text,
  }));
  const hasTimestamps = segments.some((s) => s.startMs >= 0);

  const { output } = await extractInterviewEvidence({
    competencies: competencies.map((c) => ({
      name: c.name,
      definition: c.definition,
    })),
    transcript: transcriptForPrompt(segments),
    roleTitle: recording.interview.application.requisition.title,
    hasTimestamps,
  });

  const filtered = filterEvidence(
    output.evidence,
    segments,
    new Map(competencies.map((c) => [c.name, c.id])),
  );
  const { droppedUnlocatable, droppedEvaluative } = filtered;
  const rows: Prisma.InterviewEvidenceCreateManyInput[] = filtered.kept.map((k) => ({
    recordingId: recording.id,
    ...k,
  }));

  await prisma.$transaction([
    prisma.interviewEvidence.deleteMany({ where: { recordingId: recording.id } }),
    ...(rows.length > 0
      ? [prisma.interviewEvidence.createMany({ data: rows })]
      : []),
    prisma.interviewRecording.update({
      where: { id: recording.id },
      data: { status: "ANALYZED", analyzedAt: new Date() },
    }),
  ]);

  await audit({
    userId: args.actorId,
    action: "interview_recording.evidence_extracted",
    entityType: "Interview",
    entityId: args.interviewId,
    newValue: {
      stored: rows.length,
      droppedUnlocatable,
      droppedEvaluative,
      droppedUnknownCompetency: filtered.droppedUnknownCompetency,
    },
  });

  return {
    stored: rows.length,
    droppedUnlocatable,
    droppedEvaluative,
    competenciesWithNoEvidence: output.competenciesWithNoEvidence,
    notes: output.notes,
  };
}

export async function loadConsentByToken(token: string) {
  return prisma.interviewRecordingConsent.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      interview: {
        include: {
          application: {
            include: {
              candidate: { select: { firstName: true } },
              requisition: { select: { title: true } },
            },
          },
        },
      },
    },
  });
}
