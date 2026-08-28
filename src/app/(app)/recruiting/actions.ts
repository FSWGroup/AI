'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, requireCtxAction, can, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { createApprovalRequest } from '@/lib/approvals';
import { createWorker } from '@/lib/people';
import { sendEmail } from '@/lib/email';
import { emitEvent } from '@/lib/workflows';
import type { ActionResult } from '@/app/(auth)/actions';

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function saveJobAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const id = String(formData.get('jobId') ?? '');
    const title = String(formData.get('title') ?? '').trim();
    if (!title) return { error: 'Job title is required.' };
    const data = {
      title,
      departmentId: String(formData.get('departmentId') ?? '') || null,
      legalEntityId: String(formData.get('legalEntityId') ?? '') || null,
      hiringManagerId: String(formData.get('hiringManagerId') ?? '') || null,
      recruiterId: String(formData.get('recruiterId') ?? '') || null,
      locationText: String(formData.get('locationText') ?? '') || null,
      employmentType: String(formData.get('employmentType') ?? '') || null,
      workerType: (String(formData.get('workerType') ?? 'EMPLOYEE') as never) ?? 'EMPLOYEE',
      headcount: Number(formData.get('headcount') ?? 1) || 1,
      isReplacement: formData.get('isReplacement') === 'on',
      salaryMin: formData.get('salaryMin') ? Number(formData.get('salaryMin')) : null,
      salaryMax: formData.get('salaryMax') ? Number(formData.get('salaryMax')) : null,
      description: String(formData.get('description') ?? '') || null,
      requirements: String(formData.get('requirements') ?? '') || null,
      targetDate: formData.get('targetDate') ? new Date(String(formData.get('targetDate'))) : null,
    };
    const job = id
      ? await db.jobRequisition.update({ where: { id }, data })
      : await db.jobRequisition.create({ data: { ...data, createdById: ctx.userId } });
    await audit(ctx, id ? 'recruiting.job_updated' : 'recruiting.job_created', { targetType: 'JobRequisition', targetId: job.id });
    revalidatePath('/recruiting/jobs');
    if (!id) redirect(`/recruiting/jobs/${job.id}`);
    return { success: 'Job saved.' };
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not save the job.' };
  }
}

export async function setJobStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const jobId = String(formData.get('jobId') ?? '');
    const status = String(formData.get('status') ?? '');
    const job = await db.jobRequisition.findUniqueOrThrow({ where: { id: jobId } });

    if (status === 'PENDING_APPROVAL' && job.status === 'DRAFT') {
      await db.jobRequisition.update({ where: { id: jobId }, data: { status: 'PENDING_APPROVAL' } });
      await createApprovalRequest({
        kind: 'HEADCOUNT',
        title: `Open requisition: ${job.title}`,
        subjectType: 'JobRequisition',
        subjectId: jobId,
        requestedById: ctx.userId,
        steps: [{ approverRole: 'EXECUTIVE' }],
      });
      revalidatePath(`/recruiting/jobs/${jobId}`);
      return { success: 'Sent for executive approval.' };
    }

    const allowed = ['DRAFT', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED'];
    if (!allowed.includes(status)) return { error: 'Invalid status.' };
    await db.jobRequisition.update({
      where: { id: jobId },
      data: {
        status: status as never,
        ...(status === 'OPEN' ? { openedAt: new Date() } : {}),
        ...(status === 'CLOSED' || status === 'FILLED' ? { closedAt: new Date() } : {}),
      },
    });
    await audit(ctx, 'recruiting.job_status', { targetType: 'JobRequisition', targetId: jobId, after: { status } });
    revalidatePath(`/recruiting/jobs/${jobId}`);
    revalidatePath('/recruiting/jobs');
    return { success: `Job ${status.toLowerCase().replace('_', ' ')}.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not update the job.' };
  }
}

// ---------------------------------------------------------------------------
// Candidates & applications
// ---------------------------------------------------------------------------

export async function createCandidateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const firstName = String(formData.get('firstName') ?? '').trim();
    const lastName = String(formData.get('lastName') ?? '').trim();
    if (!firstName || !lastName) return { error: 'First and last name are required.' };
    const requisitionId = String(formData.get('requisitionId') ?? '');

    const candidate = await db.candidate.create({
      data: {
        firstName,
        lastName,
        email: String(formData.get('email') ?? '') || null,
        phone: String(formData.get('phone') ?? '') || null,
        source: String(formData.get('source') ?? '') || null,
        referredBy: String(formData.get('referredBy') ?? '') || null,
        linkedinUrl: String(formData.get('linkedinUrl') ?? '') || null,
        notes: String(formData.get('notes') ?? '') || null,
      },
    });
    if (requisitionId) {
      const firstStage = await db.pipelineStage.findFirst({ orderBy: { order: 'asc' } });
      if (firstStage) {
        await db.application.create({
          data: { candidateId: candidate.id, requisitionId, stageId: firstStage.id },
        });
      }
    }
    await audit(ctx, 'recruiting.candidate_created', { targetType: 'Candidate', targetId: candidate.id });
    revalidatePath('/recruiting/candidates');
    if (requisitionId) revalidatePath(`/recruiting/jobs/${requisitionId}`);
    return { success: 'Candidate added.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not add the candidate.' };
  }
}

export async function moveApplicationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const applicationId = String(formData.get('applicationId') ?? '');
    const stageId = String(formData.get('stageId') ?? '');
    await db.application.update({ where: { id: applicationId }, data: { stageId, status: 'ACTIVE', rejectionReason: null } });
    await audit(ctx, 'recruiting.stage_moved', { targetType: 'Application', targetId: applicationId, metadata: { stageId } });
    revalidatePath('/recruiting');
    revalidatePath('/recruiting/candidates');
    return { success: 'Moved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not move the candidate.' };
  }
}

/** Rejection is always an explicit human decision (§16 — AI never auto-rejects). */
export async function rejectApplicationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const applicationId = String(formData.get('applicationId') ?? '');
    const reason = String(formData.get('reason') ?? '').trim();
    if (!reason) return { error: 'A rejection reason is required.' };
    await db.application.update({
      where: { id: applicationId },
      data: { status: 'REJECTED', rejectionReason: reason },
    });
    await audit(ctx, 'recruiting.rejected', { targetType: 'Application', targetId: applicationId, metadata: { reason } });
    revalidatePath('/recruiting');
    return { success: 'Candidate rejected.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not record the rejection.' };
  }
}

export async function scheduleInterviewAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const applicationId = String(formData.get('applicationId') ?? '');
    const scheduledAt = new Date(String(formData.get('scheduledAt') ?? ''));
    if (Number.isNaN(scheduledAt.getTime())) return { error: 'Pick a date and time.' };
    const interviewerIds = formData.getAll('interviewerIds').map(String).filter(Boolean);
    const interview = await db.interview.create({
      data: {
        applicationId,
        kind: String(formData.get('kind') ?? 'PHONE_SCREEN'),
        scheduledAt,
        durationMin: Number(formData.get('durationMin') ?? 45) || 45,
        interviewerIds,
      },
    });
    for (const uid of interviewerIds) {
      await db.interviewScorecard.create({ data: { interviewId: interview.id, interviewerUserId: uid } });
    }
    await audit(ctx, 'recruiting.interview_scheduled', { targetType: 'Interview', targetId: interview.id });
    revalidatePath('/recruiting');
    return { success: 'Interview scheduled. Outlook/Calendar sync is available once the Microsoft integration is configured.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not schedule the interview.' };
  }
}

export async function submitScorecardAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const interviewId = String(formData.get('interviewId') ?? '');
    const scorecard = await db.interviewScorecard.findUnique({
      where: { interviewId_interviewerUserId: { interviewId, interviewerUserId: ctx.userId } },
    });
    if (!scorecard && !can(ctx, 'recruiting.write')) {
      throw new AuthzError('You are not an interviewer on this interview.');
    }
    const rating = Number(formData.get('rating'));
    await db.interviewScorecard.upsert({
      where: { interviewId_interviewerUserId: { interviewId, interviewerUserId: ctx.userId } },
      create: {
        interviewId,
        interviewerUserId: ctx.userId,
        rating: Number.isFinite(rating) ? rating : null,
        recommendation: String(formData.get('recommendation') ?? '') || null,
        notes: String(formData.get('notes') ?? '') || null,
        submittedAt: new Date(),
      },
      update: {
        rating: Number.isFinite(rating) ? rating : null,
        recommendation: String(formData.get('recommendation') ?? '') || null,
        notes: String(formData.get('notes') ?? '') || null,
        submittedAt: new Date(),
      },
    });
    await db.interview.update({ where: { id: interviewId }, data: { status: 'COMPLETED' } });
    revalidatePath('/recruiting');
    return { success: 'Scorecard submitted.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not submit the scorecard.' };
  }
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export async function createOfferAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const applicationId = String(formData.get('applicationId') ?? '');
    const application = await db.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { requisition: true, candidate: true },
    });
    const amount = Number(formData.get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a valid offer amount.' };

    const offer = await db.offer.create({
      data: {
        applicationId,
        requisitionId: application.requisitionId,
        title: String(formData.get('title') ?? application.requisition.title),
        legalEntityId: application.requisition.legalEntityId,
        startDate: formData.get('startDate') ? new Date(String(formData.get('startDate'))) : null,
        amount,
        currency: String(formData.get('currency') ?? 'USD'),
        rateType: String(formData.get('rateType') ?? 'ANNUAL'),
        bonusTargetPct: formData.get('bonusTargetPct') ? Number(formData.get('bonusTargetPct')) : null,
        contingencies: String(formData.get('contingencies') ?? '') || null,
        expiresAt: formData.get('expiresAt') ? new Date(String(formData.get('expiresAt'))) : null,
        status: 'PENDING_APPROVAL',
        createdById: ctx.userId,
      },
    });
    await createApprovalRequest({
      kind: 'OFFER',
      title: `Offer: ${application.candidate.firstName} ${application.candidate.lastName} — ${offer.title}`,
      subjectType: 'Offer',
      subjectId: offer.id,
      payload: { amount, currency: offer.currency },
      requestedById: ctx.userId,
      steps: [{ approverRole: 'HR_ADMIN' }],
    });
    await audit(ctx, 'recruiting.offer_created', { targetType: 'Offer', targetId: offer.id });
    revalidatePath('/recruiting/offers');
    return { success: 'Offer drafted and sent for approval.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not create the offer.' };
  }
}

export async function sendOfferAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const offerId = String(formData.get('offerId') ?? '');
    const offer = await db.offer.findUniqueOrThrow({
      where: { id: offerId },
      include: { application: { include: { candidate: true } } },
    });
    if (offer.status === 'PENDING_APPROVAL') return { error: 'This offer is still awaiting approval.' };
    if (offer.status !== 'DRAFT') return { error: 'Only draft offers can be sent.' };
    const email = offer.application.candidate.email;
    if (!email) return { error: 'The candidate has no email on file.' };

    await sendEmail({
      to: email,
      subject: `Your offer from FSW Group — ${offer.title}`,
      heading: `We'd love you to join FSW Group`,
      bodyHtml: `<p>Hi ${offer.application.candidate.firstName},</p><p>We're excited to extend an offer for the <strong>${offer.title}</strong> role. Your recruiter will share the full offer letter with compensation details${offer.expiresAt ? ` — this offer is open until ${offer.expiresAt.toDateString()}` : ''}.</p><p>Reply to this email with any questions.</p>`,
      templateKey: 'offer',
      relatedType: 'Offer',
      relatedId: offer.id,
    });
    await db.offer.update({ where: { id: offerId }, data: { status: 'SENT', sentAt: new Date() } });
    await audit(ctx, 'recruiting.offer_sent', { targetType: 'Offer', targetId: offerId });
    revalidatePath('/recruiting/offers');
    return { success: 'Offer sent to the candidate.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not send the offer.' };
  }
}

/** Accepted offer → worker + onboarding, with no duplicate data entry (§15). */
export async function recordOfferResponseAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const offerId = String(formData.get('offerId') ?? '');
    const response = String(formData.get('response') ?? '');
    const offer = await db.offer.findUniqueOrThrow({
      where: { id: offerId },
      include: {
        application: { include: { candidate: true } },
        requisition: { include: { applications: false } },
      },
    });
    if (offer.status !== 'SENT') return { error: 'Only sent offers can be answered.' };

    if (response === 'DECLINED') {
      await db.offer.update({ where: { id: offerId }, data: { status: 'DECLINED', respondedAt: new Date() } });
      await audit(ctx, 'recruiting.offer_declined', { targetType: 'Offer', targetId: offerId });
      revalidatePath('/recruiting/offers');
      return { success: 'Recorded as declined.' };
    }
    if (response !== 'ACCEPTED') return { error: 'Invalid response.' };

    const requisition = await db.jobRequisition.findUniqueOrThrow({ where: { id: offer.requisitionId } });
    const candidate = offer.application.candidate;

    const worker = await createWorker(ctx, {
      legalFirstName: candidate.firstName,
      lastName: candidate.lastName,
      personalEmail: candidate.email ?? undefined,
      phone: candidate.phone ?? undefined,
      workerType: requisition.workerType,
      country: 'US',
      hireDate: offer.startDate ?? new Date(),
      legalEntityId:
        offer.legalEntityId ?? requisition.legalEntityId ?? (await db.legalEntity.findFirstOrThrow()).id,
      departmentId: requisition.departmentId ?? undefined,
      managerId: requisition.hiringManagerId ?? undefined,
      title: offer.title,
      amount: Number(offer.amount),
      currency: offer.currency,
      rateType: offer.rateType,
      inviteUser: false, // invited once a work email is assigned
      roleKeys: [requisition.workerType === 'EMPLOYEE' ? 'EMPLOYEE' : 'CONTRACTOR'],
    });

    const hiredStage = await db.pipelineStage.findFirst({ where: { isTerminal: true }, orderBy: { order: 'desc' } });
    await db.$transaction([
      db.offer.update({
        where: { id: offerId },
        data: { status: 'ACCEPTED', respondedAt: new Date(), hiredWorkerId: worker.id },
      }),
      db.application.update({
        where: { id: offer.applicationId },
        data: { status: 'HIRED', ...(hiredStage ? { stageId: hiredStage.id } : {}) },
      }),
    ]);
    await audit(ctx, 'recruiting.offer_accepted', {
      targetType: 'Offer',
      targetId: offerId,
      metadata: { workerId: worker.id },
    });
    await emitEvent({ type: 'OFFER_ACCEPTED', workerId: worker.id });
    revalidatePath('/recruiting/offers');
    return { success: `Offer accepted — ${candidate.firstName} is now a worker with onboarding started. Set their work email on the profile to send the account invite.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    console.error(error);
    return { error: 'Could not record the response.' };
  }
}
