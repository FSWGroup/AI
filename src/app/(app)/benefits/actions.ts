'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireCtxAction, requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { notifyRole } from '@/lib/notify';
import { addDays } from '@/lib/format';
import type { ActionResult } from '@/app/(auth)/actions';

export async function electBenefitAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    if (!ctx.workerId) return { error: 'Your account is not linked to a worker profile.' };
    const planId = String(formData.get('planId') ?? '');
    const election = String(formData.get('election') ?? 'ENROLLED');
    const plan = await db.benefitPlan.findUniqueOrThrow({ where: { id: planId } });
    const worker = await db.worker.findUniqueOrThrow({ where: { id: ctx.workerId } });

    const effectiveFrom = worker.hireDate ? addDays(worker.hireDate, plan.waitingPeriodDays) : new Date();
    await db.benefitEnrollment.create({
      data: {
        workerId: ctx.workerId,
        planId,
        status: election === 'WAIVED' ? 'WAIVED' : 'ENROLLED',
        coverageLevel: election === 'WAIVED' ? null : String(formData.get('coverageLevel') ?? 'EMPLOYEE'),
        employeeContributionMonthly: election === 'WAIVED' ? null : plan.employeeCostMonthly,
        employerContributionMonthly: election === 'WAIVED' ? null : plan.employerCostMonthly,
        electedAt: new Date(),
        effectiveFrom: election === 'WAIVED' ? null : (effectiveFrom < new Date() ? new Date() : effectiveFrom),
      },
    });
    await audit(ctx, election === 'WAIVED' ? 'benefits.waived' : 'benefits.enrolled', {
      targetType: 'BenefitPlan',
      targetId: planId,
    });
    await notifyRole('HR_ADMIN', {
      kind: 'INFO',
      title: `Benefits election: ${election.toLowerCase()} — ${plan.name}`,
      href: '/benefits',
    });
    revalidatePath('/benefits');
    return { success: election === 'WAIVED' ? 'Coverage waived.' : 'Election recorded — HR will confirm your effective date.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not record your election.' };
  }
}

export async function savePlanAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('benefits.admin');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Plan name is required.' };
    const plan = await db.benefitPlan.create({
      data: {
        kind: String(formData.get('kind') ?? 'OTHER'),
        name,
        provider: String(formData.get('provider') ?? '') || null,
        employeeCostMonthly: formData.get('employeeCostMonthly') ? Number(formData.get('employeeCostMonthly')) : null,
        employerCostMonthly: formData.get('employerCostMonthly') ? Number(formData.get('employerCostMonthly')) : null,
        waitingPeriodDays: Number(formData.get('waitingPeriodDays') ?? 0) || 0,
      },
    });
    await audit(ctx, 'benefits.plan_created', { targetType: 'BenefitPlan', targetId: plan.id });
    revalidatePath('/benefits');
    return { success: 'Plan added.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the plan.' };
  }
}
