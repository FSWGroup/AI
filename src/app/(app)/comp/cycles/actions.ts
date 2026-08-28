'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, can, isManagerOf, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { applyCycle, populateCycle, increasePct, annualise } from '@/lib/comp-cycle';
import type { ActionResult } from '@/app/(auth)/actions';

export async function saveCompCycleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.write');
    const id = String(formData.get('cycleId') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Name the cycle.' };
    const effective = new Date(String(formData.get('effectiveDate') ?? ''));
    if (Number.isNaN(effective.getTime())) return { error: 'Pick an effective date.' };

    const budgetPct = formData.get('budgetPct') ? Number(formData.get('budgetPct')) : null;
    const budgetAmount = formData.get('budgetAmount') ? Number(formData.get('budgetAmount')) : null;
    const minTenure = Number(formData.get('minTenureMonths'));

    const data = {
      name,
      effectiveDate: effective,
      budgetPct: budgetPct !== null && Number.isFinite(budgetPct) ? budgetPct : null,
      budgetAmount: budgetAmount !== null && Number.isFinite(budgetAmount) ? budgetAmount : null,
      guidance: String(formData.get('guidance') ?? '') || null,
      eligibility: {
        minTenureMonths: Number.isFinite(minTenure) && minTenure > 0 ? minTenure : 0,
        workerTypes: ['EMPLOYEE'],
      },
    };
    const cycle = id
      ? await db.compCycle.update({ where: { id }, data })
      : await db.compCycle.create({ data: { ...data, createdById: ctx.userId } });
    await audit(ctx, id ? 'comp.cycle_updated' : 'comp.cycle_created', {
      targetType: 'CompCycle',
      targetId: cycle.id,
    });
    revalidatePath('/comp/cycles');
    if (!id) redirect(`/comp/cycles/${cycle.id}`);
    return { success: 'Cycle saved.' };
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not save the cycle.' };
  }
}

/** Build the eligible population. Safe to re-run; never overwrites a proposal. */
export async function populateCycleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.write');
    const cycleId = String(formData.get('cycleId') ?? '');
    const cycle = await db.compCycle.findUniqueOrThrow({ where: { id: cycleId } });
    if (cycle.status === 'APPLIED') return { error: 'This cycle has already been applied.' };
    const created = await populateCycle(cycleId);
    if (cycle.status === 'DRAFT') {
      await db.compCycle.update({ where: { id: cycleId }, data: { status: 'PLANNING' } });
    }
    await audit(ctx, 'comp.cycle_populated', { targetType: 'CompCycle', targetId: cycleId, metadata: { created } });
    revalidatePath(`/comp/cycles/${cycleId}`);
    return { success: created === 0 ? 'Everyone eligible is already in the cycle.' : `Added ${created} people.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not populate the cycle.' };
  }
}

export async function setBudgetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.write');
    const cycleId = String(formData.get('cycleId') ?? '');
    const managerId = String(formData.get('managerId') ?? '');
    const amount = Number(formData.get('amount'));
    if (!managerId || !Number.isFinite(amount) || amount < 0) return { error: 'Enter a budget amount.' };
    await db.compCycleBudget.upsert({
      where: { cycleId_managerId: { cycleId, managerId } },
      create: { cycleId, managerId, amount },
      update: { amount },
    });
    await audit(ctx, 'comp.budget_set', {
      targetType: 'CompCycle',
      targetId: cycleId,
      metadata: { managerId, amount },
    });
    revalidatePath(`/comp/cycles/${cycleId}`);
    return { success: 'Budget set.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not set the budget.' };
  }
}

/**
 * A manager proposes an increase for one of their own reports.
 *
 * The authorization here is the point of the whole feature: comp.write is not
 * required to *propose*, but a manager may only propose for someone who
 * actually reports to them. Anyone else needs comp.write.
 */
export async function saveProposalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.cycle');
    const proposalId = String(formData.get('proposalId') ?? '');
    const proposal = await db.compProposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: { cycle: true },
    });
    if (proposal.cycle.status === 'APPLIED' || proposal.status === 'APPLIED') {
      return { error: 'This cycle has been applied and can no longer be edited.' };
    }
    if (proposal.status === 'APPROVED' && !can(ctx, 'comp.write')) {
      return { error: 'This proposal has been approved. Ask HR to reopen it.' };
    }

    if (!can(ctx, 'comp.write')) {
      if (!(await isManagerOf(ctx, proposal.workerId))) {
        throw new AuthzError('You can only propose increases for people who report to you.');
      }
    }

    const raw = String(formData.get('proposedAmount') ?? '').trim();
    const proposedAmount = raw ? Number(raw) : null;
    if (raw && (!Number.isFinite(proposedAmount) || proposedAmount! < 0)) {
      return { error: 'Enter a valid amount.' };
    }
    const current = Number(proposal.currentAmount);
    if (proposedAmount !== null && proposedAmount < current) {
      // A cut is a different conversation with different approvals; a merit
      // cycle is not the place to make one by typo.
      return { error: 'A planning cycle cannot reduce pay. Record a decrease as a separate compensation change.' };
    }
    // Guard against a fat-fingered extra zero reaching an approver.
    if (proposedAmount !== null && proposedAmount > current * 2) {
      return { error: 'That is more than double current pay — record it as a promotion outside the cycle.' };
    }

    await db.compProposal.update({
      where: { id: proposalId },
      data: {
        proposedAmount,
        increasePct: increasePct(current, proposedAmount),
        reason: String(formData.get('reason') ?? 'MERIT'),
        justification: String(formData.get('justification') ?? '') || null,
        proposedTitle: String(formData.get('proposedTitle') ?? '') || null,
        proposedById: ctx.userId,
        status: 'DRAFT',
      },
    });
    revalidatePath(`/comp/cycles/${proposal.cycleId}`);
    return { success: 'Proposal saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the proposal.' };
  }
}

/** Send a manager's whole set up for review. */
export async function submitProposalsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.cycle');
    const cycleId = String(formData.get('cycleId') ?? '');
    if (!ctx.workerId && !can(ctx, 'comp.write')) throw new AuthzError();

    const reports = ctx.workerId
      ? await db.employmentRecord.findMany({
          where: { managerId: ctx.workerId, effectiveTo: null },
          select: { workerId: true },
        })
      : [];
    const ids = reports.map((r) => r.workerId);
    const result = await db.compProposal.updateMany({
      where: {
        cycleId,
        status: 'DRAFT',
        proposedAmount: { not: null },
        ...(can(ctx, 'comp.write') ? {} : { workerId: { in: ids } }),
      },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    await audit(ctx, 'comp.proposals_submitted', {
      targetType: 'CompCycle',
      targetId: cycleId,
      metadata: { count: result.count },
    });
    revalidatePath(`/comp/cycles/${cycleId}`);
    return result.count === 0
      ? { error: 'Nothing to submit — enter proposed amounts first.' }
      : { success: `Submitted ${result.count} proposal(s) for review.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not submit.' };
  }
}

export async function decideProposalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.write');
    const proposalId = String(formData.get('proposalId') ?? '');
    const decision = String(formData.get('decision') ?? '');
    if (!['APPROVED', 'REJECTED'].includes(decision)) return { error: 'Invalid decision.' };
    const proposal = await db.compProposal.findUniqueOrThrow({ where: { id: proposalId } });
    if (proposal.status === 'APPLIED') return { error: 'Already applied.' };

    await db.compProposal.update({
      where: { id: proposalId },
      data: {
        status: decision,
        decidedById: ctx.userId,
        decidedAt: new Date(),
        decisionNote: String(formData.get('decisionNote') ?? '') || null,
      },
    });
    await audit(ctx, 'comp.proposal_decided', {
      targetType: 'CompProposal',
      targetId: proposalId,
      metadata: { decision, workerId: proposal.workerId },
    });
    revalidatePath(`/comp/cycles/${proposal.cycleId}`);
    return { success: decision === 'APPROVED' ? 'Approved.' : 'Rejected.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not record the decision.' };
  }
}

export async function setCycleStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.write');
    const cycleId = String(formData.get('cycleId') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!['PLANNING', 'IN_REVIEW', 'APPROVED', 'CANCELED'].includes(status)) return { error: 'Invalid status.' };
    const cycle = await db.compCycle.findUniqueOrThrow({ where: { id: cycleId } });
    if (cycle.status === 'APPLIED') return { error: 'An applied cycle cannot change status.' };

    if (status === 'APPROVED') {
      const pending = await db.compProposal.count({
        where: { cycleId, status: { in: ['SUBMITTED'] } },
      });
      if (pending > 0) {
        return { error: `${pending} proposal(s) are still awaiting a decision.` };
      }
    }
    await db.compCycle.update({ where: { id: cycleId }, data: { status } });
    await audit(ctx, 'comp.cycle_status', { targetType: 'CompCycle', targetId: cycleId, metadata: { status } });
    revalidatePath(`/comp/cycles/${cycleId}`);
    return { success: `Cycle moved to ${status.toLowerCase().replace('_', ' ')}.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not change the status.' };
  }
}

/** Write approved proposals into compensation history. Irreversible. */
export async function applyCycleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.write');
    const cycleId = String(formData.get('cycleId') ?? '');
    const result = await applyCycle(cycleId, ctx.userId);
    await audit(ctx, 'comp.cycle_applied', {
      targetType: 'CompCycle',
      targetId: cycleId,
      metadata: { applied: result.applied, skipped: result.skipped },
    });
    revalidatePath(`/comp/cycles/${cycleId}`);
    revalidatePath('/comp');
    return {
      success: `Applied ${result.applied} increase(s).${result.skipped ? ` ${result.skipped} skipped.` : ''}`,
    };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    if (error instanceof Error && error.message.includes('approved cycle')) return { error: error.message };
    console.error(error);
    return { error: 'Could not apply the cycle.' };
  }
}

export { annualise };
