'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, requireCtxAction, can, workerAccess, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { nextExpiry } from '@/lib/skills';
import type { ActionResult } from '@/app/(auth)/actions';

/** Manage the skill catalog itself. */
export async function saveSkillAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('skills.admin');
    const id = String(formData.get('skillId') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'A skill name is required.' };
    const isCertification = formData.get('isCertification') === 'on';
    const validityRaw = Number(formData.get('validityMonths'));
    const data = {
      name,
      category: String(formData.get('category') ?? 'OTHER'),
      description: String(formData.get('description') ?? '') || null,
      isCertification,
      isCritical: formData.get('isCritical') === 'on',
      // Validity only means something for a certification.
      validityMonths: isCertification && Number.isFinite(validityRaw) && validityRaw > 0 ? validityRaw : null,
      active: formData.get('active') !== 'off',
    };
    const skill = id
      ? await db.skill.update({ where: { id }, data })
      : await db.skill.create({ data });
    await audit(ctx, id ? 'skills.updated' : 'skills.created', { targetType: 'Skill', targetId: skill.id });
    revalidatePath('/skills');
    return { success: 'Skill saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    if ((error as { code?: string }).code === 'P2002') return { error: 'A skill with that name already exists.' };
    return { error: 'Could not save the skill.' };
  }
}

/**
 * Record a skill on a worker.
 *
 * Anyone may record their own skills — that is how an inventory gets built.
 * Recording one on somebody else, or marking any skill verified, needs
 * skills.admin: a self-declared "verified" would make verification meaningless.
 */
export async function saveWorkerSkillAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCtxAction();
    const workerId = String(formData.get('workerId') ?? '');
    const skillId = String(formData.get('skillId') ?? '');
    if (!workerId || !skillId) return { error: 'Pick a skill.' };

    const isAdmin = can(ctx, 'skills.admin');
    if (!isAdmin) {
      const access = await workerAccess(ctx, workerId);
      if (!access.self) throw new AuthzError('You can only record skills on your own profile.');
    }

    const level = Number(formData.get('level'));
    if (!Number.isFinite(level) || level < 1 || level > 5) return { error: 'Pick a level between 1 and 5.' };

    const skill = await db.skill.findUniqueOrThrow({ where: { id: skillId } });
    const acquiredRaw = String(formData.get('acquiredAt') ?? '');
    const acquiredAt = acquiredRaw ? new Date(acquiredRaw) : null;
    const expiresRaw = String(formData.get('expiresAt') ?? '');
    const expiresAt = expiresRaw
      ? new Date(expiresRaw)
      : skill.isCertification && acquiredAt
        ? nextExpiry(skill.validityMonths, acquiredAt)
        : null;

    // Verification is an act by a named person, never a checkbox on your own row.
    const verify = isAdmin && formData.get('verified') === 'on';

    await db.workerSkill.upsert({
      where: { workerId_skillId: { workerId, skillId } },
      create: {
        workerId,
        skillId,
        level,
        acquiredAt,
        expiresAt,
        note: String(formData.get('note') ?? '') || null,
        sourceType: 'MANUAL',
        verifiedById: verify ? ctx.userId : null,
        verifiedAt: verify ? new Date() : null,
      },
      update: {
        level,
        acquiredAt,
        expiresAt,
        note: String(formData.get('note') ?? '') || null,
        // Re-recording a skill drops any previous verification unless this
        // caller is re-verifying it now. A changed claim is a new claim.
        verifiedById: verify ? ctx.userId : null,
        verifiedAt: verify ? new Date() : null,
      },
    });
    await audit(ctx, 'skills.worker_skill_recorded', {
      targetType: 'Worker',
      targetId: workerId,
      metadata: { skill: skill.name, level, verified: verify },
    });
    revalidatePath(`/people/${workerId}`);
    revalidatePath('/skills');
    return { success: verify ? 'Skill recorded and verified.' : 'Skill recorded.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not record the skill.' };
  }
}

export async function removeWorkerSkillAction(formData: FormData): Promise<void> {
  const ctx = await requireCtxAction();
  const id = String(formData.get('workerSkillId') ?? '');
  const row = await db.workerSkill.findUnique({ where: { id }, include: { skill: true } });
  if (!row) return;
  if (!can(ctx, 'skills.admin')) {
    const access = await workerAccess(ctx, row.workerId);
    if (!access.self) throw new AuthzError();
  }
  await db.workerSkill.delete({ where: { id } });
  await audit(ctx, 'skills.worker_skill_removed', {
    targetType: 'Worker',
    targetId: row.workerId,
    metadata: { skill: row.skill.name },
  });
  revalidatePath(`/people/${row.workerId}`);
  revalidatePath('/skills');
}

/** Attach a skill requirement to a requisition. */
export async function saveJobSkillRequirementAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('recruiting.write');
    const requisitionId = String(formData.get('requisitionId') ?? '');
    const skillId = String(formData.get('skillId') ?? '');
    if (!requisitionId || !skillId) return { error: 'Pick a skill.' };
    const minLevel = Number(formData.get('minLevel'));
    await db.jobSkillRequirement.create({
      data: {
        requisitionId,
        skillId,
        minLevel: Number.isFinite(minLevel) && minLevel >= 1 && minLevel <= 5 ? minLevel : 3,
        required: formData.get('required') !== 'off',
      },
    });
    await audit(ctx, 'skills.requirement_added', { targetType: 'JobRequisition', targetId: requisitionId });
    revalidatePath(`/recruiting/jobs/${requisitionId}`);
    return { success: 'Requirement added.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not add the requirement.' };
  }
}

export async function removeJobSkillRequirementAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('recruiting.write');
  const id = String(formData.get('requirementId') ?? '');
  const row = await db.jobSkillRequirement.findUnique({ where: { id } });
  if (!row) return;
  await db.jobSkillRequirement.delete({ where: { id } });
  await audit(ctx, 'skills.requirement_removed', { targetType: 'JobRequisition', targetId: row.requisitionId ?? '' });
  if (row.requisitionId) revalidatePath(`/recruiting/jobs/${row.requisitionId}`);
}
