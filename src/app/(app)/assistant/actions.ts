'use server';

import { createTask } from '@/lib/tasks';
import { requireCtxAction, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { aiEnabled, describeAiError, AiUnavailableError } from '@/lib/ai/client';
import { buildCopilotContext } from '@/lib/ai/copilot-context';
import { askCopilot } from '@/lib/ai/copilot';

export interface AssistantState {
  error?: string;
  question?: string;
  answer?: string;
  answered?: boolean;
  suggestHrCase?: boolean;
  citations?: { policyId: string; title: string; version: number }[];
  model?: string;
}

/**
 * Ask the HR assistant.
 *
 * No permission gate beyond being signed in — and that is the point. The
 * assistant answers from what *this* user can already read, so a wider
 * audience does not mean wider access. What it can see is decided entirely by
 * buildCopilotContext, using the caller's own Ctx.
 */
export async function askAssistantAction(
  _prev: AssistantState | void,
  formData: FormData,
): Promise<AssistantState> {
  try {
    const ctx = await requireCtxAction();
    const question = String(formData.get('question') ?? '').trim();
    if (!question) return { error: 'Ask a question.' };
    if (question.length > 500) return { error: 'Keep the question under 500 characters.' };
    if (!aiEnabled()) {
      return {
        error: 'The assistant is not configured. An administrator sets ANTHROPIC_API_KEY — see Admin › Integrations.',
      };
    }

    const context = await buildCopilotContext(ctx, question);
    const result = await askCopilot(context, question);

    await audit(ctx, 'assistant.question_asked', {
      metadata: {
        model: result.model,
        answered: result.answer.answered,
        suggestedHrCase: result.answer.suggestHrCase,
        ...context.basis,
      },
    });

    return {
      question,
      answer: result.answer.answer,
      answered: result.answer.answered,
      suggestHrCase: result.answer.suggestHrCase,
      citations: result.citations.map((c) => ({ policyId: c.policyId, title: c.title, version: c.version })),
      model: result.model,
    };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    if (error instanceof AiUnavailableError) return { error: error.message };
    console.error(error);
    return { error: describeAiError(error) };
  }
}

/**
 * Hand a question to a human. The escape hatch the assistant always offers.
 *
 * Deliberately a Task owned by HR, not an HrCase. HrCase is the disciplinary
 * and investigation record — coaching, warnings, complaints, PIPs. Filing
 * "how does bereavement leave work?" there would put a disciplinary-shaped
 * record against someone for asking a question, which is exactly the kind of
 * quiet harm a well-meant feature causes.
 */
export async function askHumanAction(
  _prev: { error?: string; success?: string } | void,
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  try {
    const ctx = await requireCtxAction();
    const subject = String(formData.get('subject') ?? '').trim();
    if (!subject) return { error: 'Describe what you need help with.' };
    if (subject.length > 2000) return { error: 'Keep it under 2,000 characters.' };

    const task = await createTask({
      title: `HR question: ${subject.slice(0, 80)}${subject.length > 80 ? '…' : ''}`,
      description: subject,
      category: 'GENERAL',
      workerId: ctx.workerId ?? null,
      ownerRoleKey: 'HR_ADMIN',
      dueDate: new Date(Date.now() + 3 * 86_400_000),
      sourceType: 'ASSISTANT',
      createdById: ctx.userId,
      notify: true,
    });
    await audit(ctx, 'assistant.escalated_to_human', { targetType: 'Task', targetId: task.id });
    return { success: 'Sent to HR. They will come back to you, and you can follow it under My Tasks.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not send that to HR.' };
  }
}
