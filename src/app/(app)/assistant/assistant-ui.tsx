'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Callout, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/client';
import { askAssistantAction, askHumanAction, type AssistantState } from './actions';

const EXAMPLES = [
  'How much vacation do I have left?',
  'What is the bereavement leave policy?',
  'When is the next company holiday?',
  'How do I report a safety incident?',
  'Who is my manager?',
];

export function AssistantPanel({ configured }: { configured: boolean }) {
  const [state, action] = useActionState<AssistantState | void, FormData>(askAssistantAction, undefined);
  const [question, setQuestion] = useState('');

  if (!configured) {
    return (
      <Callout tone="info">
        The assistant is not set up yet. An administrator connects a model provider under Admin › Integrations. In the
        meantime, Policies and Time Off answer most of these questions directly.
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <label className="block text-[13px] font-medium text-ink-700" htmlFor="assistant-question">
          What do you want to know?
        </label>
        <Textarea
          id="assistant-question"
          name="question"
          rows={3}
          maxLength={500}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="How much vacation do I have left?"
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setQuestion(example)}
              className="rounded-full border border-ink-200 px-2.5 py-1 text-[12px] text-ink-600 hover:border-brand-400 hover:text-brand-700"
            >
              {example}
            </button>
          ))}
        </div>
        <SubmitButton pendingLabel="Looking it up…">Ask</SubmitButton>
      </form>

      {state && 'error' in state && state.error ? (
        <div role="alert" className="rounded-md border border-danger-100 bg-danger-100/60 px-3 py-2 text-[13px] text-danger-500">
          {state.error}
        </div>
      ) : null}

      {state && 'answer' in state && state.answer ? (
        <div className="rounded-card border border-ink-200 bg-white p-4 shadow-card">
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="gray">AI-assisted</Badge>
            {state.answered === false ? <Badge tone="amber">not covered by your policies</Badge> : null}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-900">{state.answer}</p>

          {state.citations && state.citations.length > 0 ? (
            <div className="mt-3 border-t border-ink-100 pt-3">
              <div className="text-[12px] font-medium text-ink-700">Based on</div>
              <ul className="mt-1 space-y-0.5">
                {state.citations.map((c) => (
                  <li key={c.policyId} className="text-[12px]">
                    <Link href={`/policies/${c.policyId}`} className="text-brand-600 hover:underline">
                      {c.title}
                    </Link>
                    <span className="text-ink-400"> · version {c.version}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-3 border-t border-ink-100 pt-3 text-[12px] text-ink-500">
            Answered only from policies you are entitled to read and your own record — never from general knowledge
            about employment law. Check the policy itself before relying on this, and ask HR for anything that needs a
            decision.
          </p>
        </div>
      ) : null}

      {state && 'suggestHrCase' in state && state.suggestHrCase ? (
        <AskHuman defaultSubject={state.question ?? ''} />
      ) : null}
    </div>
  );
}

function AskHuman({ defaultSubject }: { defaultSubject: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Callout tone="info">
        This one is better answered by a person.{' '}
        <button type="button" onClick={() => setOpen(true)} className="font-medium text-brand-700 hover:underline">
          Send it to HR
        </button>
      </Callout>
    );
  }
  return (
    <div className="rounded-card border border-ink-200 bg-white p-4">
      <h3 className="text-[13px] font-semibold text-ink-900">Send this to HR</h3>
      <ActionForm action={askHumanAction} className="mt-2 space-y-3" onSuccess={() => setOpen(false)}>
        <Textarea name="subject" rows={3} defaultValue={defaultSubject} maxLength={2000} />
        <p className="text-[12px] text-ink-500">
          This creates a task for the HR team — not a case file. You will see it under My Tasks.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <SubmitButton size="sm">Send</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
