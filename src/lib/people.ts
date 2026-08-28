import 'server-only';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { recordTimeline } from '@/lib/timeline';
import { emitEvent } from '@/lib/workflows';
import { startLifecycle } from '@/lib/lifecycle';
import { sendActivationEmail } from '@/app/(auth)/actions';
import type { Ctx } from '@/lib/authz';
import type { Prisma } from '@/generated/prisma/client';
import type { WorkerType } from '@/generated/prisma/enums';

/**
 * Next employee number (FSW-0001…).
 *
 * Derived from the highest NUMERIC suffix across all workers rather than a
 * lexical max, so imported records with other prefixes (legacy IDs, migrated
 * data) can never cause a collision, and numbering keeps working past 9999.
 * Callers retry on the unique constraint — see createWorker.
 */
export async function nextEmployeeNumber(): Promise<string> {
  const rows = await db.worker.findMany({ select: { employeeNumber: true } });
  const highest = rows.reduce((max, r) => {
    const digits = r.employeeNumber.match(/(\d+)\s*$/)?.[1];
    const n = digits ? Number(digits) : 0;
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `FSW-${String(highest + 1).padStart(4, '0')}`;
}

export interface NewWorkerInput {
  legalFirstName: string;
  preferredName?: string;
  lastName: string;
  workEmail?: string;
  personalEmail?: string;
  phone?: string;
  workerType: WorkerType;
  country: string;
  timezone?: string;
  localCurrency?: string;
  engagementModel?: string;
  hireDate: Date;
  // employment
  legalEntityId: string;
  departmentId?: string;
  teamId?: string;
  locationId?: string;
  managerId?: string;
  title: string;
  jobFamily?: string;
  jobLevel?: string;
  employmentBasis?: string;
  flsaStatus?: string;
  payBasis?: string;
  workMode?: string;
  workState?: string;
  // compensation
  amount?: number;
  currency?: string;
  rateType?: string;
  payFrequency?: string;
  // account
  inviteUser: boolean;
  roleKeys: string[];
}

/**
 * Create a worker with employment + compensation in one transaction, invite
 * the user account, start onboarding, record the timeline, and fire
 * WORKER_ADDED workflows for any additional automation. Used both by HR
 * "Add worker" and by offer-accepted conversion (§15).
 *
 * Onboarding starts here rather than only from a workflow, so a new hire can
 * never silently end up without a checklist if an admin disables or deletes
 * the automation. startLifecycle is idempotent, so a workflow that also runs
 * START_ONBOARDING will not create a second instance.
 */
export async function createWorker(ctx: Ctx, input: NewWorkerInput) {
  const worker = await createWorkerRecord(ctx, input);

  await recordTimeline({
    workerId: worker.id,
    kind: 'HIRE',
    title: `Hired as ${input.title}`,
    visibility: 'MANAGER',
    actorUserId: ctx.userId,
    occurredAt: input.hireDate,
  });
  await audit(ctx, 'worker.create', {
    targetType: 'Worker',
    targetId: worker.id,
    after: {
      employeeNumber: worker.employeeNumber,
      name: `${input.legalFirstName} ${input.lastName}`,
      workerType: input.workerType,
    },
  });
  if (worker.userId) await sendActivationEmail(worker.userId);

  await startLifecycle({
    workerId: worker.id,
    kind: 'ONBOARDING',
    startDate: input.hireDate,
    createdById: ctx.userId,
  }).catch((error) => {
    // A template problem must not lose the worker record that was just created.
    console.error('Failed to start onboarding for', worker.id, error);
  });

  await emitEvent({ type: 'WORKER_ADDED', workerId: worker.id });
  return worker;
}

/**
 * Insert the worker row, retrying once per collision on the generated
 * employee number (two admins can create a worker at the same instant).
 */
async function createWorkerRecord(ctx: Ctx, input: NewWorkerInput, attempt = 0) {
  const employeeNumber = await nextEmployeeNumber();
  try {
    return await db.$transaction(async (tx) => {
      let userId: string | null = null;
      if (input.inviteUser && input.workEmail) {
        const roleRows = await tx.role.findMany({ where: { key: { in: input.roleKeys } } });
        const user = await tx.user.create({
          data: {
            email: input.workEmail.toLowerCase(),
            status: 'INVITED',
            roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
          },
        });
        userId = user.id;
      }
      return tx.worker.create({
        data: {
          employeeNumber,
          userId,
          legalFirstName: input.legalFirstName,
          preferredName: input.preferredName || null,
          lastName: input.lastName,
          workEmail: input.workEmail?.toLowerCase() || null,
          personalEmail: input.personalEmail || null,
          phone: input.phone || null,
          workerType: input.workerType,
          status: input.hireDate > new Date() ? 'PRE_START' : 'ONBOARDING',
          country: input.country,
          timezone: input.timezone || (input.country === 'PH' ? 'Asia/Manila' : 'America/New_York'),
          localCurrency: input.localCurrency || (input.country === 'PH' ? 'PHP' : 'USD'),
          engagementModel: input.engagementModel || null,
          hireDate: input.hireDate,
          originalHireDate: input.hireDate,
          seniorityDate: input.hireDate,
          employments: {
            create: {
              legalEntityId: input.legalEntityId,
              departmentId: input.departmentId || null,
              teamId: input.teamId || null,
              locationId: input.locationId || null,
              managerId: input.managerId || null,
              title: input.title,
              jobFamily: input.jobFamily || null,
              jobLevel: input.jobLevel || null,
              employmentBasis: input.employmentBasis || null,
              flsaStatus: input.flsaStatus || null,
              payBasis: input.payBasis || null,
              workMode: input.workMode || null,
              workState: input.workState || null,
              effectiveFrom: input.hireDate,
              changeReason: 'HIRE',
            },
          },
          ...(input.amount && input.amount > 0
            ? {
                compensations: {
                  create: {
                    amount: input.amount,
                    currency: input.currency || 'USD',
                    rateType: input.rateType || 'ANNUAL',
                    payFrequency: input.payFrequency || null,
                    reason: 'HIRE',
                    effectiveFrom: input.hireDate,
                    approvedById: ctx.userId,
                  },
                },
              }
            : {}),
          ...(input.workerType !== 'EMPLOYEE' ? { contractorProfile: { create: {} } } : {}),
        },
      });
    });
  } catch (error) {
    const isNumberCollision =
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002' &&
      JSON.stringify((error as { meta?: unknown }).meta ?? '').includes('employeeNumber');
    if (isNumberCollision && attempt < 5) return createWorkerRecord(ctx, input, attempt + 1);
    throw error;
  }
}

/**
 * Effective-dated job change: closes the current employment record and opens
 * a new one. Historical rows are never modified (§5).
 */
export async function changeEmployment(
  ctx: Ctx,
  workerId: string,
  changes: Partial<{
    legalEntityId: string;
    departmentId: string | null;
    teamId: string | null;
    locationId: string | null;
    managerId: string | null;
    secondaryManagerId: string | null;
    title: string;
    jobFamily: string | null;
    jobLevel: string | null;
    employmentBasis: string | null;
    flsaStatus: string | null;
    payBasis: string | null;
    workMode: string | null;
    workState: string | null;
  }>,
  opts: { effectiveFrom: Date; reason: string },
) {
  const current = await db.employmentRecord.findFirst({
    where: { workerId, effectiveTo: null },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!current) throw new Error('Worker has no active employment record.');

  const next = await db.$transaction(async (tx) => {
    await tx.employmentRecord.update({
      where: { id: current.id },
      data: { effectiveTo: opts.effectiveFrom },
    });
    return tx.employmentRecord.create({
      data: {
        workerId,
        legalEntityId: changes.legalEntityId ?? current.legalEntityId,
        departmentId: changes.departmentId !== undefined ? changes.departmentId : current.departmentId,
        teamId: changes.teamId !== undefined ? changes.teamId : current.teamId,
        locationId: changes.locationId !== undefined ? changes.locationId : current.locationId,
        managerId: changes.managerId !== undefined ? changes.managerId : current.managerId,
        secondaryManagerId:
          changes.secondaryManagerId !== undefined ? changes.secondaryManagerId : current.secondaryManagerId,
        title: changes.title ?? current.title,
        jobFamily: changes.jobFamily !== undefined ? changes.jobFamily : current.jobFamily,
        jobLevel: changes.jobLevel !== undefined ? changes.jobLevel : current.jobLevel,
        employmentBasis: changes.employmentBasis !== undefined ? changes.employmentBasis : current.employmentBasis,
        flsaStatus: changes.flsaStatus !== undefined ? changes.flsaStatus : current.flsaStatus,
        payBasis: changes.payBasis !== undefined ? changes.payBasis : current.payBasis,
        workMode: changes.workMode !== undefined ? changes.workMode : current.workMode,
        workState: changes.workState !== undefined ? changes.workState : current.workState,
        effectiveFrom: opts.effectiveFrom,
        changeReason: opts.reason,
      },
    });
  });

  const changedTitles = changes.title && changes.title !== current.title;
  const changedManager = changes.managerId !== undefined && changes.managerId !== current.managerId;
  const changedDept = changes.departmentId !== undefined && changes.departmentId !== current.departmentId;

  await recordTimeline({
    workerId,
    kind: changedTitles ? 'TITLE_CHANGE' : changedManager ? 'MANAGER_CHANGE' : changedDept ? 'DEPARTMENT_CHANGE' : 'JOB_CHANGE',
    title:
      changedTitles
        ? `Title changed to ${changes.title}`
        : changedManager
          ? 'Manager changed'
          : changedDept
            ? 'Department changed'
            : `Job details updated (${opts.reason.toLowerCase().replace(/_/g, ' ')})`,
    visibility: 'MANAGER',
    actorUserId: ctx.userId,
    occurredAt: opts.effectiveFrom,
  });
  await audit(ctx, 'worker.employment_change', {
    targetType: 'Worker',
    targetId: workerId,
    before: { title: current.title, managerId: current.managerId, departmentId: current.departmentId },
    after: { title: next.title, managerId: next.managerId, departmentId: next.departmentId, reason: opts.reason },
  });

  if (changedTitles) await emitEvent({ type: 'TITLE_CHANGED', workerId });
  if (changedManager) await emitEvent({ type: 'MANAGER_CHANGED', workerId });
  if (changedDept) await emitEvent({ type: 'DEPARTMENT_CHANGED', workerId });
  return next;
}

/** Effective-dated compensation change (never overwrites history, §22). */
export async function changeCompensation(
  ctx: Ctx,
  workerId: string,
  input: {
    amount: number;
    currency: string;
    rateType: string;
    payFrequency?: string | null;
    bonusTargetPct?: number | null;
    reason: string;
    note?: string | null;
    effectiveFrom: Date;
  },
) {
  const current = await db.compensation.findFirst({
    where: { workerId, effectiveTo: null },
    orderBy: { effectiveFrom: 'desc' },
  });
  const created = await db.$transaction(async (tx) => {
    if (current) {
      await tx.compensation.update({ where: { id: current.id }, data: { effectiveTo: input.effectiveFrom } });
    }
    return tx.compensation.create({
      data: {
        workerId,
        amount: input.amount,
        currency: input.currency,
        rateType: input.rateType,
        payFrequency: input.payFrequency ?? current?.payFrequency ?? null,
        bonusTargetPct: input.bonusTargetPct ?? null,
        reason: input.reason,
        note: input.note ?? null,
        effectiveFrom: input.effectiveFrom,
        approvedById: ctx.userId,
      },
    });
  });
  await recordTimeline({
    workerId,
    kind: 'COMP_CHANGE',
    title: `Compensation change (${input.reason.toLowerCase().replace(/_/g, ' ')})`,
    visibility: 'COMP',
    actorUserId: ctx.userId,
    occurredAt: input.effectiveFrom,
  });
  await audit(ctx, 'compensation.change', {
    targetType: 'Worker',
    targetId: workerId,
    before: current ? { amount: String(current.amount), rateType: current.rateType } : null,
    after: { amount: String(input.amount), rateType: input.rateType, reason: input.reason },
  });
  return created;
}

/** Shared directory query with server-side search/filter/pagination. */
export async function directoryQuery(params: {
  q?: string;
  country?: string;
  status?: string;
  workerType?: string;
  departmentId?: string;
  legalEntityId?: string;
  managerId?: string;
  includeTerminated?: boolean;
  page: number;
  pageSize?: number;
  extraWhere?: Prisma.WorkerWhereInput;
}) {
  const pageSize = params.pageSize ?? 25;
  const where: Prisma.WorkerWhereInput = {
    deletedAt: null,
    ...(params.q
      ? {
          OR: [
            { legalFirstName: { contains: params.q, mode: 'insensitive' } },
            { preferredName: { contains: params.q, mode: 'insensitive' } },
            { lastName: { contains: params.q, mode: 'insensitive' } },
            { workEmail: { contains: params.q, mode: 'insensitive' } },
            { employeeNumber: { contains: params.q, mode: 'insensitive' } },
            { employments: { some: { effectiveTo: null, title: { contains: params.q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
    ...(params.country ? { country: params.country } : {}),
    ...(params.workerType ? { workerType: params.workerType as WorkerType } : {}),
    ...(params.status
      ? { status: params.status as never }
      : params.includeTerminated
        ? {}
        : { status: { notIn: ['TERMINATED'] } }),
    ...(params.departmentId
      ? { employments: { some: { effectiveTo: null, departmentId: params.departmentId } } }
      : {}),
    ...(params.legalEntityId
      ? { employments: { some: { effectiveTo: null, legalEntityId: params.legalEntityId } } }
      : {}),
    ...(params.managerId ? { employments: { some: { effectiveTo: null, managerId: params.managerId } } } : {}),
  };
  const fullWhere = params.extraWhere ? { AND: [where, params.extraWhere] } : where;

  const [total, workers] = await Promise.all([
    db.worker.count({ where: fullWhere }),
    db.worker.findMany({
      where: fullWhere,
      orderBy: [{ lastName: 'asc' }, { legalFirstName: 'asc' }],
      skip: (params.page - 1) * pageSize,
      take: pageSize,
      include: {
        employments: {
          where: { effectiveTo: null },
          take: 1,
          include: {
            department: true,
            legalEntity: true,
            location: true,
            manager: { select: { id: true, legalFirstName: true, preferredName: true, lastName: true } },
          },
        },
      },
    }),
  ]);
  return { total, workers, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
