'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requirePermission, requireCtxAction, workerAccess, AuthzError } from '@/lib/authz';
import { createWorker, changeEmployment, changeCompensation } from '@/lib/people';
import { encryptField, decryptField, last4 } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { recordTimeline } from '@/lib/timeline';
import { startLifecycle } from '@/lib/lifecycle';
import { emitEvent } from '@/lib/workflows';
import type { ActionResult } from '@/app/(auth)/actions';

function fail(error: unknown): { error: string } {
  if (error instanceof AuthzError) return { error: error.message };
  if (error instanceof z.ZodError) {
    return { error: error.issues.map((i) => i.message).join(' ') };
  }
  console.error('people action error:', error);
  return { error: 'Something went wrong saving this. Please try again.' };
}

// ---------------------------------------------------------------------------
// Create worker
// ---------------------------------------------------------------------------

const newWorkerSchema = z.object({
  legalFirstName: z.string().min(1, 'First name is required.'),
  preferredName: z.string().optional(),
  lastName: z.string().min(1, 'Last name is required.'),
  workEmail: z.string().email('Enter a valid work email.').optional().or(z.literal('')),
  personalEmail: z.string().email('Enter a valid personal email.').optional().or(z.literal('')),
  phone: z.string().optional(),
  workerType: z.enum(['EMPLOYEE', 'CONTRACTOR', 'EOR', 'AGENCY']),
  country: z.string().min(2),
  engagementModel: z.string().optional(),
  hireDate: z.string().min(1, 'Start date is required.'),
  legalEntityId: z.string().min(1, 'Legal entity is required.'),
  departmentId: z.string().optional(),
  locationId: z.string().optional(),
  managerId: z.string().optional(),
  title: z.string().min(1, 'Title is required.'),
  jobFamily: z.string().optional(),
  jobLevel: z.string().optional(),
  employmentBasis: z.string().optional(),
  flsaStatus: z.string().optional(),
  payBasis: z.string().optional(),
  workMode: z.string().optional(),
  workState: z.string().optional(),
  amount: z.string().optional(),
  currency: z.string().optional(),
  rateType: z.string().optional(),
  inviteUser: z.string().optional(),
});

export async function createWorkerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('people.write');
    const raw = Object.fromEntries(formData.entries());
    const data = newWorkerSchema.parse(raw);

    if (data.workEmail) {
      const existing = await db.worker.findFirst({ where: { workEmail: data.workEmail.toLowerCase() } });
      if (existing) return { error: 'A worker with that work email already exists.' };
    }

    const worker = await createWorker(ctx, {
      ...data,
      workEmail: data.workEmail || undefined,
      personalEmail: data.personalEmail || undefined,
      hireDate: new Date(data.hireDate),
      amount: data.amount ? Number(data.amount) : undefined,
      inviteUser: data.inviteUser === 'on' && !!data.workEmail,
      roleKeys: [data.workerType === 'EMPLOYEE' ? 'EMPLOYEE' : 'CONTRACTOR'],
    });
    redirect(`/people/${worker.id}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error; // redirect
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Self-service + HR profile edits
// ---------------------------------------------------------------------------

const SELF_EDITABLE = ['preferredName', 'phone', 'personalEmail', 'pronouns', 'homeStreet', 'homeCity', 'homeState', 'homePostal', 'homeCountry', 'timezone'] as const;
const HR_EDITABLE = [...SELF_EDITABLE, 'legalFirstName', 'middleName', 'lastName', 'suffix', 'workEmail', 'dateOfBirth', 'citizenship', 'localCurrency', 'engagementModel'] as const;

export async function updateProfileAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const workerId = String(formData.get('workerId') ?? '');
    const access = await workerAccess(ctx, workerId);
    const canHrEdit = ctx.permissions.has('people.write');
    if (!access.self && !canHrEdit) throw new AuthzError();

    const allowed = canHrEdit ? HR_EDITABLE : SELF_EDITABLE;
    const data: Record<string, string | Date | null> = {};
    const before: Record<string, string | null> = {};
    const worker = await db.worker.findUniqueOrThrow({ where: { id: workerId } });

    for (const key of allowed) {
      if (!formData.has(key)) continue;
      const value = String(formData.get(key) ?? '').trim();
      if (key === 'dateOfBirth') {
        data[key] = value ? new Date(value) : null;
      } else if (key === 'workEmail' || key === 'personalEmail') {
        if (value && !z.string().email().safeParse(value).success) {
          return { error: `“${value}” is not a valid email.` };
        }
        data[key] = value ? value.toLowerCase() : null;
      } else {
        data[key] = value || null;
      }
      const prior = worker[key as keyof typeof worker];
      before[key] = prior instanceof Date ? prior.toISOString().slice(0, 10) : ((prior as string | null) ?? null);
    }
    if (Object.keys(data).length === 0) return { error: 'Nothing to save.' };

    await db.worker.update({ where: { id: workerId }, data });
    await audit(ctx, access.self && !canHrEdit ? 'worker.self_update' : 'worker.update', {
      targetType: 'Worker',
      targetId: workerId,
      before,
      after: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]),
      ),
    });
    revalidatePath(`/people/${workerId}`);
    return { success: 'Profile updated.' };
  } catch (error) {
    return fail(error);
  }
}

export async function saveEmergencyContactAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const workerId = String(formData.get('workerId') ?? '');
    const access = await workerAccess(ctx, workerId);
    if (!access.self && !ctx.permissions.has('people.write')) throw new AuthzError();
    const name = String(formData.get('name') ?? '').trim();
    const phone = String(formData.get('phone') ?? '').trim();
    if (!name || !phone) return { error: 'Name and phone are required.' };
    const id = String(formData.get('contactId') ?? '');
    if (id) {
      await db.emergencyContact.update({
        where: { id },
        data: { name, phone, relationship: String(formData.get('relationship') ?? '') || null },
      });
    } else {
      await db.emergencyContact.create({
        data: { workerId, name, phone, relationship: String(formData.get('relationship') ?? '') || null },
      });
    }
    await audit(ctx, 'worker.emergency_contact_saved', { targetType: 'Worker', targetId: workerId });
    revalidatePath(`/people/${workerId}`);
    return { success: 'Emergency contact saved.' };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Encrypted identifiers (SSN, tax IDs, PH government IDs, passports, bank)
// ---------------------------------------------------------------------------

export async function addIdentifierAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const workerId = String(formData.get('workerId') ?? '');
    const access = await workerAccess(ctx, workerId);
    if (!access.self && !ctx.permissions.has('pii.write')) throw new AuthzError();

    const kind = String(formData.get('kind') ?? 'OTHER');
    const value = String(formData.get('value') ?? '').trim();
    if (value.length < 4) return { error: 'Enter the full identifier value.' };
    const expiresAt = String(formData.get('expiresAt') ?? '');

    await db.workerIdentifier.upsert({
      where: { workerId_kind_label: { workerId, kind, label: '' } },
      create: {
        workerId,
        kind,
        label: '',
        valueEnc: encryptField(value),
        last4: last4(value),
        country: String(formData.get('country') ?? '') || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdById: ctx.userId,
      },
      update: {
        valueEnc: encryptField(value),
        last4: last4(value),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdById: ctx.userId,
      },
    });
    await audit(ctx, 'pii.identifier_saved', {
      targetType: 'Worker',
      targetId: workerId,
      metadata: { kind, last4: last4(value) },
    });
    revalidatePath(`/people/${workerId}`);
    return { success: `${kind.replace(/_/g, ' ')} stored encrypted (…${last4(value)}).` };
  } catch (error) {
    return fail(error);
  }
}

/** Explicit, audited reveal of one encrypted identifier. */
export async function revealIdentifierAction(identifierId: string): Promise<{ error?: string; value?: string }> {
  try {
    const ctx = await requireCtxAction();
    const row = await db.workerIdentifier.findUnique({ where: { id: identifierId } });
    if (!row) return { error: 'Not found.' };
    const access = await workerAccess(ctx, row.workerId);
    if (!access.self && !ctx.permissions.has('pii.reveal')) throw new AuthzError();
    await audit(ctx, 'pii.reveal', {
      targetType: 'Worker',
      targetId: row.workerId,
      metadata: { kind: row.kind, identifierId },
    });
    return { value: decryptField(row.valueEnc) };
  } catch (error) {
    return fail(error);
  }
}

export async function saveBankAccountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const workerId = String(formData.get('workerId') ?? '');
    const access = await workerAccess(ctx, workerId);
    if (!access.self && !ctx.permissions.has('pii.write')) throw new AuthzError();

    const account = String(formData.get('account') ?? '').trim();
    const routing = String(formData.get('routing') ?? '').trim();
    if (account.length < 4) return { error: 'Enter the full account number.' };

    await db.bankAccount.updateMany({ where: { workerId, active: true }, data: { active: false } });
    await db.bankAccount.create({
      data: {
        workerId,
        bankName: String(formData.get('bankName') ?? '') || null,
        accountType: String(formData.get('accountType') ?? '') || null,
        accountEnc: encryptField(account),
        accountLast4: last4(account),
        routingEnc: routing ? encryptField(routing) : null,
        currency: String(formData.get('currency') ?? 'USD'),
        country: String(formData.get('country') ?? 'US'),
      },
    });
    await audit(ctx, 'pii.bank_account_saved', { targetType: 'Worker', targetId: workerId });
    revalidatePath(`/people/${workerId}`);
    return { success: `Bank account stored encrypted (…${last4(account)}).` };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Job & compensation changes
// ---------------------------------------------------------------------------

export async function changeEmploymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('people.write');
    const workerId = String(formData.get('workerId') ?? '');
    const effectiveFrom = new Date(String(formData.get('effectiveFrom') ?? ''));
    if (Number.isNaN(effectiveFrom.getTime())) return { error: 'Effective date is required.' };
    const reason = String(formData.get('reason') ?? 'JOB_CHANGE');

    const pick = (key: string) => {
      const v = formData.get(key);
      return v === null || v === '' ? undefined : String(v);
    };
    const pickNullable = (key: string) => {
      if (!formData.has(key)) return undefined;
      const v = String(formData.get(key) ?? '');
      return v === '' ? null : v;
    };

    await changeEmployment(
      ctx,
      workerId,
      {
        title: pick('title'),
        legalEntityId: pick('legalEntityId'),
        departmentId: pickNullable('departmentId'),
        locationId: pickNullable('locationId'),
        managerId: pickNullable('managerId'),
        jobFamily: pickNullable('jobFamily'),
        jobLevel: pickNullable('jobLevel'),
        flsaStatus: pickNullable('flsaStatus'),
        payBasis: pickNullable('payBasis'),
        workMode: pickNullable('workMode'),
        workState: pickNullable('workState'),
        employmentBasis: pickNullable('employmentBasis'),
      },
      { effectiveFrom, reason },
    );
    revalidatePath(`/people/${workerId}`);
    return { success: 'Job change recorded.' };
  } catch (error) {
    return fail(error);
  }
}

export async function changeCompensationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('comp.write');
    const workerId = String(formData.get('workerId') ?? '');
    const amount = Number(formData.get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a valid amount.' };
    const effectiveFrom = new Date(String(formData.get('effectiveFrom') ?? ''));
    if (Number.isNaN(effectiveFrom.getTime())) return { error: 'Effective date is required.' };

    await changeCompensation(ctx, workerId, {
      amount,
      currency: String(formData.get('currency') ?? 'USD'),
      rateType: String(formData.get('rateType') ?? 'ANNUAL'),
      bonusTargetPct: formData.get('bonusTargetPct') ? Number(formData.get('bonusTargetPct')) : null,
      reason: String(formData.get('reason') ?? 'ADJUSTMENT'),
      note: String(formData.get('note') ?? '') || null,
      effectiveFrom,
    });
    revalidatePath(`/people/${workerId}`);
    return { success: 'Compensation change recorded.' };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Contractor profile
// ---------------------------------------------------------------------------

export async function saveContractorProfileAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('people.write');
    const workerId = String(formData.get('workerId') ?? '');
    const get = (k: string) => String(formData.get(k) ?? '').trim() || null;
    const getDate = (k: string) => {
      const v = get(k);
      return v ? new Date(v) : null;
    };
    await db.contractorProfile.upsert({
      where: { workerId },
      create: { workerId },
      update: {},
    });
    await db.contractorProfile.update({
      where: { workerId },
      data: {
        isBusiness: formData.get('isBusiness') === 'on',
        businessName: get('businessName'),
        dba: get('dba'),
        contractStart: getDate('contractStart'),
        contractEnd: getDate('contractEnd'),
        paymentTerms: get('paymentTerms'),
        paymentMethod: get('paymentMethod'),
        w9Status: get('w9Status'),
        w8Status: get('w8Status'),
        is1099Eligible: formData.get('is1099Eligible') === 'on',
        notes: get('notes'),
      },
    });
    await audit(ctx, 'contractor.profile_saved', { targetType: 'Worker', targetId: workerId });
    revalidatePath(`/people/${workerId}`);
    return { success: 'Contractor details saved.' };
  } catch (error) {
    return fail(error);
  }
}

export async function recordContractorPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('payroll.admin');
    const workerId = String(formData.get('workerId') ?? '');
    const amount = Number(formData.get('amount'));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a valid amount.' };
    await db.contractorPayment.create({
      data: {
        workerId,
        amount,
        currency: String(formData.get('currency') ?? 'USD'),
        invoiceRef: String(formData.get('invoiceRef') ?? '') || null,
        paidAt: formData.get('paidAt') ? new Date(String(formData.get('paidAt'))) : null,
        status: formData.get('paidAt') ? 'PAID' : 'RECORDED',
        note: String(formData.get('note') ?? '') || null,
      },
    });
    await audit(ctx, 'contractor.payment_recorded', { targetType: 'Worker', targetId: workerId, metadata: { amount } });
    revalidatePath(`/people/${workerId}`);
    return { success: 'Payment recorded.' };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Termination → offboarding
// ---------------------------------------------------------------------------

export async function startOffboardingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('people.terminate');
    const workerId = String(formData.get('workerId') ?? '');
    const lastDay = new Date(String(formData.get('lastDay') ?? ''));
    if (Number.isNaN(lastDay.getTime())) return { error: 'Last day is required.' };
    const reason = String(formData.get('reason') ?? 'OTHER');
    const voluntary = formData.get('voluntary') === 'on';

    const worker = await db.worker.findUniqueOrThrow({ where: { id: workerId } });
    if (worker.status === 'TERMINATED') return { error: 'This worker is already terminated.' };

    await db.worker.update({
      where: { id: workerId },
      data: { status: 'OFFBOARDING', terminationDate: lastDay, terminationReason: reason, voluntaryTermination: voluntary },
    });
    await startLifecycle({
      workerId,
      kind: 'OFFBOARDING',
      startDate: lastDay,
      reason,
      voluntary,
      createdById: ctx.userId,
    });
    await audit(ctx, 'worker.offboarding_started', {
      targetType: 'Worker',
      targetId: workerId,
      metadata: { lastDay: lastDay.toISOString().slice(0, 10), reason, voluntary },
    });
    await emitEvent({ type: 'TERMINATION_SCHEDULED', workerId });
    revalidatePath(`/people/${workerId}`);
    return { success: 'Offboarding started — tasks generated for the manager, IT, finance and HR.' };
  } catch (error) {
    return fail(error);
  }
}

/** Final termination on/after the last day: closes records, deactivates access. */
export async function finalizeTerminationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('people.terminate');
    const workerId = String(formData.get('workerId') ?? '');
    const rehireEligible = formData.get('rehireEligible') === 'on';
    const worker = await db.worker.findUniqueOrThrow({ where: { id: workerId } });
    const when = worker.terminationDate ?? new Date();

    await db.$transaction(async (tx) => {
      await tx.worker.update({
        where: { id: workerId },
        data: { status: 'TERMINATED', rehireEligible },
      });
      // Close the current employment record — history is preserved (§53).
      await tx.employmentRecord.updateMany({
        where: { workerId, effectiveTo: null },
        data: { effectiveTo: when },
      });
      if (worker.userId) {
        await tx.user.update({ where: { id: worker.userId }, data: { status: 'DEACTIVATED' } });
        await tx.session.updateMany({ where: { userId: worker.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.appAccessGrant.updateMany({
        where: { workerId, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: ctx.userId },
      });
    });
    await recordTimeline({
      workerId,
      kind: 'TERMINATION',
      title: 'Employment ended',
      detail: worker.terminationReason ?? undefined,
      visibility: 'HR',
      actorUserId: ctx.userId,
      occurredAt: when,
    });
    await audit(ctx, 'worker.terminated', {
      targetType: 'Worker',
      targetId: workerId,
      metadata: { rehireEligible },
    });
    revalidatePath(`/people/${workerId}`);
    return { success: 'Termination finalized. Account access revoked; records preserved.' };
  } catch (error) {
    return fail(error);
  }
}
