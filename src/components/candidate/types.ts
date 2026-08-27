/** Client mirrors of the sanitized candidate payloads. */

export interface SectionState {
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

export interface AttemptState {
  status: string;
  entryStep: string;
  recordId: string;
  cameraExempt: boolean;
  untimed: boolean;
  candidate: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  };
  job: { title: string; company: string };
  assessment: { name: string; versionLabel: string };
  sections: SectionState[];
  currentSectionKey: string | null;
  rulesConsented: boolean;
  recordingConsented: boolean;
  recordingNoticeVersion: string;
  accommodationContactEmail: string | null;
  privacyContactEmail: string | null;
}

export interface QuestionPayload {
  id: string;
  orderIndex: number;
  kind: string;
  prompt: string;
  choices: string[] | null;
  studySeconds: number | null;
  answeredValue: number | null;
}

export const LIKERT_LABELS = [
  "Strongly Disagree",
  "Disagree",
  "Neither Agree nor Disagree",
  "Agree",
  "Strongly Agree",
];
