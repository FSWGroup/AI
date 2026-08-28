'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import type { ActionResult } from '@/app/(auth)/actions';
import { respondentKeyFor } from '@/lib/surveys';

export async function createSurveyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('surveys.admin');
    const title = String(formData.get('title') ?? '').trim();
    if (!title) return { error: 'Title is required.' };
    const lines = String(formData.get('questions') ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return { error: 'Add at least one question.' };
    const questions = lines.map((line, i) => {
      const type = /\[enps\]\s*$/i.test(line) ? 'ENPS' : /\[text\]\s*$/i.test(line) ? 'TEXT' : 'SCALE';
      return { id: `q${i + 1}`, text: line.replace(/\[(scale|text|enps)\]\s*$/i, '').trim(), type };
    });
    const survey = await db.survey.create({
      data: {
        title,
        kind: String(formData.get('kind') ?? 'PULSE'),
        anonymous: formData.get('anonymous') === 'on',
        questions,
        status: 'OPEN',
        opensAt: new Date(),
        closesAt: formData.get('closesAt') ? new Date(String(formData.get('closesAt'))) : null,
      },
    });
    await audit(ctx, 'survey.created', { targetType: 'Survey', targetId: survey.id });
    revalidatePath('/surveys');
    return { success: 'Survey is open.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not create the survey.' };
  }
}

export async function respondSurveyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const surveyId = String(formData.get('surveyId') ?? '');
    const survey = await db.survey.findUniqueOrThrow({ where: { id: surveyId } });
    if (survey.status !== 'OPEN') return { error: 'This survey is closed.' };

    const answers: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('q_') && String(value) !== '') answers[key.slice(2)] = String(value).slice(0, 2000);
    }
    if (Object.keys(answers).length === 0) return { error: 'Answer at least one question.' };

    await db.surveyResponse.create({
      data: {
        surveyId,
        respondentKey: respondentKeyFor(surveyId, ctx.workerId, survey.anonymous),
        answers,
      },
    });
    revalidatePath('/surveys');
    return { success: 'Response recorded. Thank you!' };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return { error: 'You have already responded to this survey.' };
    }
    return { error: 'Could not record your response.' };
  }
}
