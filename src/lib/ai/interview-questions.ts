import 'server-only';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { aiClient, aiModel, AiUnavailableError } from '@/lib/ai/client';
import { redactPersonalData, truncateForPrompt } from '@/lib/ai/redact';

/**
 * Five interview questions drawn from a candidate's experience and the job
 * they applied for (§16).
 *
 * Guardrails, in the model's instructions *and* in code:
 *
 *  - Advisory only. The output is a list of questions for a human to ask. It
 *    carries no score, no ranking, and no hire/reject recommendation, so
 *    nothing here can reject a candidate — that stays a human action with a
 *    written reason (rejectApplicationAction).
 *  - Protected characteristics are off limits. The model is told not to ask
 *    about or infer age, ethnicity, national origin, disability, religion,
 *    political belief, sexual orientation, gender identity, pregnancy,
 *    family or marital status, or criminal history, and every returned
 *    question is screened for those terms before it is stored.
 *  - Minimal input. Only the candidate's first name, their résumé text with
 *    contact details and identifiers redacted, and the job description go
 *    out. Never a personnel record, never the ATS pipeline, never notes.
 */

const QuestionSchema = z.object({
  question: z.string().describe('The question to ask the candidate, in plain conversational English.'),
  rationale: z
    .string()
    .describe('One sentence on why this question is worth asking, referencing their experience or the role.'),
  listenFor: z.string().describe('What a strong answer contains — what the interviewer should listen for.'),
  basis: z
    .enum(['RESUME', 'JOB_DESCRIPTION', 'BOTH'])
    .describe('Whether the question comes from the résumé, the job description, or both.'),
});

const QuestionSetSchema = z.object({
  // Length is asked for in the prompt and enforced below rather than in the
  // schema: array length keywords are not part of the structured-output
  // schema subset, and a rejected schema would fail the whole request.
  questions: z.array(QuestionSchema).describe('Exactly five interview questions.'),
});

export type InterviewQuestion = z.infer<typeof QuestionSchema>;

const SYSTEM_PROMPT = `You help interviewers at a US/Philippines industrial distribution company prepare for a job interview.

Given a job description and a candidate's résumé, write exactly five interview questions the interviewer should ask.

What makes a good question here:
- It is specific to THIS candidate and THIS job. Reference actual work they describe — a system they ran, a team they led, a problem they solved — not generic competencies.
- It probes depth. Prefer "walk me through how you..." over "are you familiar with...".
- It covers the gap between what the résumé shows and what the job needs, including areas where their experience does not obviously match.
- Vary the ground the five questions cover. Do not ask the same thing five ways.

Hard limits — these are not stylistic preferences:
- Never ask about, or draw an inference about, any protected characteristic: age, date of birth, graduation years used to imply age, race, ethnicity, national origin, citizenship beyond a plain work-authorization question, disability, health, medical or genetic history, religion, political belief, union membership, sexual orientation, gender identity, pregnancy, children, marital or family status, or arrest and criminal history.
- Do not rate, score, rank or recommend the candidate. Do not say whether they should be hired, advanced or rejected. You are writing questions, nothing else.
- Do not invent experience the résumé does not contain. If the résumé is thin, ask questions that open the ground up rather than assuming details.
- Do not ask for salary history.`;

/** Terms that must never appear in a question we store. */
const PROHIBITED = [
  'age', 'how old', 'birth', 'born', 'graduat', 'race', 'ethnic', 'nationality', 'national origin',
  'citizen', 'immigration', 'visa status', 'disab', 'handicap', 'medical', 'health condition', 'illness',
  'religio', 'church', 'political', 'union', 'sexual orientation', 'gender identity', 'pregnan',
  // 'child' rather than 'children' so childcare, childbirth and child support
  // are caught as well.
  'child', 'kids', 'marital', 'married', 'spouse', 'family status', 'criminal', 'arrest', 'convict',
  'felony', 'salary history', 'current salary',
];

/**
 * Screen generated questions. A model instruction is a request; this is the
 * enforcement. Anything touching a protected characteristic is dropped, and
 * if that leaves fewer than five usable questions the whole set is refused
 * rather than quietly returning a short list.
 */
export function screenQuestions(questions: InterviewQuestion[]): {
  kept: InterviewQuestion[];
  dropped: { question: string; term: string }[];
} {
  const kept: InterviewQuestion[] = [];
  const dropped: { question: string; term: string }[] = [];
  for (const q of questions) {
    const haystack = `${q.question} ${q.rationale} ${q.listenFor}`.toLowerCase();
    // "graduat"/"age" also appear innocently ("manage", "leverage"), so match
    // on word starts rather than raw substrings.
    const hit = PROHIBITED.find((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(haystack));
    if (hit) dropped.push({ question: q.question, term: hit });
    else kept.push(q);
  }
  return { kept, dropped };
}

export interface QuestionInputs {
  candidateFirstName: string;
  resumeText: string | null;
  jobTitle: string;
  jobDescription: string | null;
  jobRequirements: string | null;
}

export interface QuestionResult {
  questions: InterviewQuestion[];
  model: string;
  basis: {
    usedResume: boolean;
    resumeTruncated: boolean;
    redacted: string[];
    usedJobDescription: boolean;
    usedJobRequirements: boolean;
    screenedOut: number;
  };
}

export class AiGuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiGuardrailError';
  }
}

export async function generateInterviewQuestions(inputs: QuestionInputs): Promise<QuestionResult> {
  if (!inputs.resumeText?.trim() && !inputs.jobDescription?.trim()) {
    throw new AiUnavailableError(
      'There is nothing to work from yet — add the job description, or paste the candidate’s résumé on their profile.',
    );
  }

  const redaction = inputs.resumeText ? redactPersonalData(inputs.resumeText) : { text: '', removed: [] };
  const resume = redaction.text ? truncateForPrompt(redaction.text) : { text: '', truncated: false };

  // Only the first name goes out: a surname adds nothing to a question and
  // invites exactly the inferences we prohibit.
  const parts = [
    `Candidate first name: ${inputs.candidateFirstName}`,
    '',
    `Role: ${inputs.jobTitle}`,
    inputs.jobDescription?.trim() ? `\nJob description:\n${inputs.jobDescription.trim()}` : '',
    inputs.jobRequirements?.trim() ? `\nRequirements:\n${inputs.jobRequirements.trim()}` : '',
    resume.text
      ? `\nCandidate résumé (contact details and identifiers removed):\n${resume.text}`
      : '\nNo résumé text is on file for this candidate. Base the questions on the role, and include questions that surface relevant experience.',
  ].filter(Boolean);

  const response = await aiClient().messages.parse({
    model: aiModel(),
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    output_config: { format: zodOutputFormat(QuestionSetSchema) },
    messages: [{ role: 'user', content: parts.join('\n') }],
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new AiGuardrailError('The AI response could not be read as five questions. Nothing was saved.');
  }

  if (parsed.questions.length < 5) {
    throw new AiGuardrailError('The AI returned fewer than five questions. Nothing was saved.');
  }

  const { kept, dropped } = screenQuestions(parsed.questions);
  if (kept.length < 5) {
    throw new AiGuardrailError(
      'Some suggested questions touched on protected characteristics and were blocked, so no set was saved. Try again.',
    );
  }

  return {
    questions: kept.slice(0, 5),
    model: response.model,
    basis: {
      usedResume: Boolean(resume.text),
      resumeTruncated: resume.truncated,
      redacted: redaction.removed,
      usedJobDescription: Boolean(inputs.jobDescription?.trim()),
      usedJobRequirements: Boolean(inputs.jobRequirements?.trim()),
      screenedOut: dropped.length,
    },
  };
}
