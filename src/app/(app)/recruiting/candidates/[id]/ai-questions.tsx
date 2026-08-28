'use client';

import { useState } from 'react';
import { Badge, Button, Callout, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { generateInterviewQuestionsAction, saveCandidateResumeAction } from '../../actions';

export interface StoredQuestion {
  question: string;
  rationale: string;
  listenFor: string;
  basis: string;
}

export interface QuestionSetView {
  id: string;
  createdAt: string;
  model: string;
  generatedBy: string;
  redacted: string[];
  usedResume: boolean;
  questions: StoredQuestion[];
}

const BASIS_LABEL: Record<string, string> = {
  RESUME: 'from their résumé',
  JOB_DESCRIPTION: 'from the job description',
  BOTH: 'from both',
};

/**
 * Suggested interview questions. The wording throughout is deliberate: these
 * are suggestions for a human interviewer, they carry no score, and nothing
 * on this panel advances or rejects anyone.
 */
export function AiQuestionsPanel({
  applicationId,
  jobTitle,
  aiConfigured,
  hasResume,
  latest,
}: {
  applicationId: string;
  jobTitle: string;
  aiConfigured: boolean;
  hasResume: boolean;
  latest: QuestionSetView | null;
}) {
  if (!aiConfigured) {
    return (
      <Callout tone="info">
        AI interview questions are not set up. An administrator connects a model provider under Admin › Integrations.
      </Callout>
    );
  }

  return (
    <div className="space-y-3">
      {latest ? (
        <ol className="space-y-3">
          {latest.questions.map((q, i) => (
            <li key={i} className="rounded-md border border-ink-100 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{q.question}</p>
                  <p className="mt-1 text-[12px] text-ink-500">{q.rationale}</p>
                  <p className="mt-1 text-[12px] text-ink-600">
                    <span className="font-medium text-ink-700">Listen for:</span> {q.listenFor}
                  </p>
                  <span className="mt-1.5 inline-block text-[11px] text-ink-400">
                    {BASIS_LABEL[q.basis] ?? q.basis.toLowerCase()}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-ink-600">
          Generate five questions to ask about this candidate&rsquo;s experience against the {jobTitle} role.
          {hasResume ? '' : ' No résumé text is on file yet, so the questions will be based on the job description alone.'}
        </p>
      )}

      {latest ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3 text-[12px] text-ink-500">
          <Badge tone="gray">AI-assisted</Badge>
          <span>
            Generated {latest.createdAt} by {latest.generatedBy} using {latest.model}.
          </span>
          {latest.redacted.length > 0 ? <span>Redacted before sending: {latest.redacted.join(', ')}.</span> : null}
          {!latest.usedResume ? <span>No résumé was available — based on the job description.</span> : null}
        </div>
      ) : null}

      <p className="text-[12px] text-ink-500">
        Suggestions for a human interviewer. They contain no rating and no hire recommendation — read them, change what
        does not fit, and drop anything that is not relevant to the job.
      </p>

      <ActionForm action={generateInterviewQuestionsAction}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <SubmitButton variant="secondary" size="sm">
          {latest ? 'Generate a new set' : 'Suggest 5 questions'}
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

/** Paste a résumé so the question generator has something to work from. */
export function ResumeTextEditor({ candidateId, resumeText }: { candidateId: string; resumeText: string | null }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="mt-4 border-t border-ink-100 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-ink-700">Résumé text</span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            {resumeText ? 'Edit' : 'Add'}
          </Button>
        </div>
        <p className="mt-1 text-[12px] text-ink-500">
          {resumeText
            ? `${resumeText.length.toLocaleString()} characters on file.`
            : 'None on file. Paste the résumé text to use AI interview questions.'}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-ink-100 pt-3">
      <ActionForm action={saveCandidateResumeAction} className="space-y-2" onSuccess={() => setOpen(false)}>
        <input type="hidden" name="candidateId" value={candidateId} />
        <label className="block text-[13px] font-medium text-ink-700" htmlFor="resume-text">
          Résumé text
        </label>
        <Textarea id="resume-text" name="resumeText" rows={10} defaultValue={resumeText ?? ''} />
        <p className="text-[12px] text-ink-500">
          Contact details, identifiers and links are stripped out before any of this is sent to the AI provider.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton size="sm">Save</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
