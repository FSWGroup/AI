/**
 * Candidate-facing attempt state and sanitized question payloads.
 *
 * SECURITY: nothing returned from this module may include correct answers,
 * constructs, weights, scoring direction, or internal question identifiers.
 * The client only ever sees the current section's questions.
 */

import type { Attempt } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sweepExpiredSections, sectionRemainingSeconds } from "./engine";

export interface CandidateSectionState {
  key: string;
  title: string;
  orderIndex: number;
  timed: boolean;
  durationSeconds: number | null;
  status: string;
  remainingSeconds: number | null;
  questionCount: number;
  answeredCount: number;
  instructions: string;
}

export interface CandidateAttemptState {
  status: string;
  entryStep: string;
  recordId: string;
  cameraExempt: boolean;
  untimed: boolean;
  candidate: { firstName: string; lastName: string; email: string; phone: string | null };
  job: { title: string; company: string };
  assessment: { name: string; versionLabel: string };
  sections: CandidateSectionState[];
  currentSectionKey: string | null;
  rulesConsented: boolean;
  recordingConsented: boolean;
  recordingNoticeVersion: string;
  accommodationContactEmail: string | null;
  privacyContactEmail: string | null;
}

export async function getCandidateState(
  attempt: Attempt,
): Promise<CandidateAttemptState> {
  await sweepExpiredSections(attempt.id);

  const [fresh, sections, defs, candidate, opening, version, consents, settings] =
    await Promise.all([
      prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } }),
      prisma.attemptSection.findMany({
        where: { attemptId: attempt.id },
        orderBy: { orderIndex: "asc" },
      }),
      prisma.sectionDefinition.findMany({
        where: { assessmentVersionId: attempt.assessmentVersionId },
      }),
      prisma.candidate.findUniqueOrThrow({ where: { id: attempt.candidateId } }),
      prisma.jobOpening.findUniqueOrThrow({ where: { id: attempt.jobOpeningId } }),
      prisma.assessmentVersion.findUniqueOrThrow({
        where: { id: attempt.assessmentVersionId },
      }),
      prisma.consentRecord.findMany({ where: { attemptId: attempt.id } }),
      prisma.orgSettings.findUnique({ where: { id: "org" } }),
    ]);

  const answeredBySection = await prisma.attemptQuestion.groupBy({
    by: ["sectionKey"],
    where: {
      attemptId: attempt.id,
      response: { is: { unanswered: false } },
    },
    _count: true,
  });
  const questionsBySection = await prisma.attemptQuestion.groupBy({
    by: ["sectionKey"],
    where: { attemptId: attempt.id },
    _count: true,
  });

  const sectionStates: CandidateSectionState[] = sections.map((s) => {
    const def = defs.find((d) => d.key === s.sectionKey);
    return {
      key: s.sectionKey,
      title: def?.title ?? s.sectionKey,
      orderIndex: s.orderIndex,
      timed: s.timed && !fresh.untimed,
      durationSeconds: fresh.untimed ? null : s.durationSeconds,
      status: s.status,
      remainingSeconds:
        s.status === "IN_PROGRESS" ? sectionRemainingSeconds(s) : null,
      questionCount:
        questionsBySection.find((q) => q.sectionKey === s.sectionKey)?._count ?? 0,
      answeredCount:
        answeredBySection.find((q) => q.sectionKey === s.sectionKey)?._count ?? 0,
      instructions: def?.instructions ?? "",
    };
  });

  const current = sectionStates.find(
    (s) => s.status === "PENDING" || s.status === "IN_PROGRESS",
  );

  return {
    status: fresh.status,
    entryStep: fresh.entryStep,
    recordId: fresh.recordId,
    cameraExempt: fresh.cameraExempt,
    untimed: fresh.untimed,
    candidate: {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      email: candidate.email,
      phone: candidate.phone,
    },
    job: {
      title: opening.title,
      company: settings?.companyName ?? "FSW Group",
    },
    assessment: {
      name: version.name,
      versionLabel: `v${version.versionNumber}`,
    },
    sections: sectionStates,
    currentSectionKey: current?.key ?? null,
    rulesConsented: consents.some((c) => c.consentType === "rules"),
    recordingConsented: consents.some((c) => c.consentType === "recording"),
    recordingNoticeVersion: settings?.privacyNoticeVersion ?? "1.0",
    accommodationContactEmail: settings?.accommodationContactEmail ?? null,
    privacyContactEmail: settings?.privacyContactEmail ?? null,
  };
}

export interface CandidateQuestionPayload {
  id: string; // AttemptQuestion id (opaque)
  orderIndex: number;
  kind: string;
  prompt: string;
  choices: string[] | null;
  /** For MEMORY_STUDY cards only. */
  studySeconds: number | null;
  answeredValue: number | null;
}

/** Questions for ONE section, only when that section is open. */
export async function getSectionQuestions(
  attempt: Attempt,
  sectionKey: string,
): Promise<CandidateQuestionPayload[]> {
  const questions = await prisma.attemptQuestion.findMany({
    where: { attemptId: attempt.id, sectionKey },
    orderBy: { orderIndex: "asc" },
    include: {
      questionVersion: {
        select: { kind: true, prompt: true, choices: true, promptData: true },
      },
      response: { select: { value: true, unanswered: true } },
    },
  });
  return questions.map((q) => {
    const promptData = q.questionVersion.promptData as {
      studySeconds?: number;
    } | null;
    return {
      id: q.id,
      orderIndex: q.orderIndex,
      kind: q.questionVersion.kind,
      prompt: q.questionVersion.prompt,
      choices:
        q.questionVersion.kind === "LIKERT_STATEMENT"
          ? null // fixed 5-point scale rendered client-side
          : ((q.questionVersion.choices as string[] | null) ?? null),
      studySeconds:
        q.questionVersion.kind === "MEMORY_STUDY"
          ? (promptData?.studySeconds ?? 60)
          : null,
      answeredValue: q.response && !q.response.unanswered ? q.response.value : null,
    };
  });
}
