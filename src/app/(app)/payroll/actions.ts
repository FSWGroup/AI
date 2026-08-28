'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import type { ActionResult } from '@/app/(auth)/actions';

export async function createPeriodAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('payroll.admin');
    const periodStart = new Date(String(formData.get('periodStart') ?? ''));
    const periodEnd = new Date(String(formData.get('periodEnd') ?? ''));
    const payDate = new Date(String(formData.get('payDate') ?? ''));
    if ([periodStart, periodEnd, payDate].some((d) => Number.isNaN(d.getTime()))) {
      return { error: 'All three dates are required.' };
    }
    if (periodEnd < periodStart) return { error: 'Period end must be after start.' };
    const period = await db.payrollPeriod.create({
      data: { legalEntityCode: 'ALL', periodStart, periodEnd, payDate },
    });
    await audit(ctx, 'payroll.period_created', { targetType: 'PayrollPeriod', targetId: period.id });
    revalidatePath('/payroll');
    return { success: 'Period created.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not create the period (overlapping start date?).' };
  }
}

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['REVIEW'],
  REVIEW: ['APPROVED', 'OPEN'],
  APPROVED: ['EXPORTED', 'REVIEW'],
  EXPORTED: ['CLOSED'],
};

export async function setPeriodStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('payroll.admin');
    const periodId = String(formData.get('periodId') ?? '');
    const status = String(formData.get('status') ?? '');
    const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    if (!TRANSITIONS[period.status]?.includes(status)) {
      return { error: `Cannot move from ${period.status} to ${status}.` };
    }
    await db.payrollPeriod.update({
      where: { id: periodId },
      data: {
        status,
        ...(status === 'APPROVED' ? { approvedById: ctx.userId, approvedAt: new Date() } : {}),
        ...(status === 'EXPORTED' ? { exportedAt: new Date() } : {}),
      },
    });
    await audit(ctx, 'payroll.period_status', { targetType: 'PayrollPeriod', targetId: periodId, after: { status } });
    revalidatePath('/payroll');
    return { success: `Period moved to ${status.toLowerCase()}.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not update the period.' };
  }
}
