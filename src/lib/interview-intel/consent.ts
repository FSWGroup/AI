/**
 * Consent to record an interview.
 *
 * ALL-PARTY consent, always. Not "two-party" — every person in the room, the
 * candidate and every interviewer alike.
 *
 * This is not a configurable setting because there is no lawful configuration
 * of it for this organization. The Philippines' Anti-Wiretapping Act (RA 4200)
 * makes recording a private communication without the consent of all parties a
 * criminal offence, punishable by imprisonment, and it applies to a recruiter
 * recording an interview. Several US states (California, Pennsylvania,
 * Illinois, Florida among them) require all-party consent for the same act.
 * A one-party toggle would exist only to be switched on by someone who did not
 * know that, so there is not one.
 *
 * Consequences that follow, and are enforced here rather than in a policy
 * document: recording cannot start until every party has said yes; a single
 * withdrawal ends it for everyone; and declining costs a candidate nothing,
 * which is stated in the wording they are shown.
 */

export type ConsentStatus = "PENDING" | "GRANTED" | "DECLINED" | "WITHDRAWN";
export type ConsentParty = "CANDIDATE" | "INTERVIEWER";

/**
 * The wording shown to a candidate.
 *
 * Versioned, and the version is stored on every consent row, so what somebody
 * actually agreed to can be reconstructed years later rather than inferred
 * from whatever the file says today.
 */
export const CANDIDATE_CONSENT_VERSION = "interview-recording-1.0";

export const CANDIDATE_CONSENT_STATEMENT = [
  "We would like to record the audio of this interview.",
  "Why: so the interviewer can listen back to what you actually said instead of relying on their notes, and so a second person can check their reading of it. It makes the assessment of you more accurate and more reviewable.",
  "What is recorded: audio only. No video. Nothing about your voice, your tone, your accent or your manner is analyzed — only the words, and only against the specific topics this interview is about.",
  "Who can hear it: the people interviewing you and the hiring team for this role. Nobody else.",
  "How long we keep it: under the retention schedule set for interview recordings, after which it is deleted automatically.",
  "Your rights: you can say no, and you can change your mind during or after the interview. If you withdraw, the recording stops and what has been captured is deleted.",
  "Saying no has no effect on your application. The interview goes ahead exactly the same way, and the interviewer takes notes as they otherwise would. Nobody involved in the decision is told which you chose.",
].join("\n\n");

export const INTERVIEWER_CONSENT_STATEMENT = [
  "This interview will be recorded (audio only) if every person present agrees.",
  "You are one of those people. Your consent is required in law, not as a formality — recording a private conversation without the agreement of everyone in it is a criminal offence in the Philippines and in several other jurisdictions this company hires in.",
  "You can decline, and you can withdraw at any point. Either ends the recording for everyone.",
].join("\n\n");

export interface ConsentRow {
  party: ConsentParty;
  userId: string | null;
  status: ConsentStatus;
}

export type RecordingGate =
  | { ok: true }
  | { ok: false; reason: string; missing: ConsentRow[] };

/**
 * Whether recording may proceed.
 *
 * Every expected party must have GRANTED. A missing row is treated exactly
 * like a refusal: "we never asked them" is not consent, and is the specific
 * failure this function exists to prevent.
 */
export function canRecord(
  expected: { party: ConsentParty; userId: string | null }[],
  consents: ConsentRow[],
): RecordingGate {
  const missing: ConsentRow[] = [];
  for (const party of expected) {
    const row = consents.find(
      (c) => c.party === party.party && c.userId === party.userId,
    );
    if (!row || row.status !== "GRANTED") {
      missing.push({
        party: party.party,
        userId: party.userId,
        status: row?.status ?? "PENDING",
      });
    }
  }
  if (missing.length === 0) return { ok: true };

  const withdrawn = missing.some((m) => m.status === "WITHDRAWN");
  const declined = missing.some((m) => m.status === "DECLINED");
  return {
    ok: false,
    missing,
    reason: withdrawn
      ? "Someone has withdrawn their consent. Recording has to stop, and anything already captured is deleted."
      : declined
        ? "Someone has declined to be recorded. The interview goes ahead unrecorded — that is the whole point of asking."
        : `Still waiting on ${missing.length} ${missing.length === 1 ? "person" : "people"}. Recording cannot start until everyone present has agreed.`,
  };
}

/** True when anything already captured must be destroyed. */
export function mustDestroyRecording(consents: ConsentRow[]): boolean {
  return consents.some((c) => c.status === "WITHDRAWN");
}

export const CONSENT_LABEL: Record<ConsentStatus, string> = {
  PENDING: "Not answered yet",
  GRANTED: "Agreed",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
};

/**
 * What an interviewer is allowed to be told about a candidate's answer.
 *
 * Deliberately not the answer itself before the interview. An interviewer who
 * knows the candidate declined may — consciously or not — treat them
 * differently, and the candidate was promised that saying no costs nothing.
 * They learn only whether the recording is on, which they need to know because
 * they must not describe it as recorded if it is not.
 */
export function interviewerVisibleState(gate: RecordingGate): string {
  return gate.ok ? "Recording is on." : "This interview is not being recorded.";
}
