'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { recordTimeline } from '@/lib/timeline';
import type { ActionResult } from '@/app/(auth)/actions';

export async function saveAssetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('equipment.admin');
    const assetTag = String(formData.get('assetTag') ?? '').trim();
    if (!assetTag) return { error: 'Asset tag is required.' };
    const asset = await db.equipmentAsset.create({
      data: {
        kind: String(formData.get('kind') ?? 'OTHER'),
        assetTag,
        serialNumber: String(formData.get('serialNumber') ?? '') || null,
        make: String(formData.get('make') ?? '') || null,
        model: String(formData.get('model') ?? '') || null,
        valueUsd: formData.get('valueUsd') ? Number(formData.get('valueUsd')) : null,
        condition: String(formData.get('condition') ?? 'NEW'),
        notes: String(formData.get('notes') ?? '') || null,
      },
    });
    await audit(ctx, 'equipment.asset_created', { targetType: 'EquipmentAsset', targetId: asset.id });
    revalidatePath('/equipment');
    return { success: 'Asset added.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the asset (duplicate tag?).' };
  }
}

export async function assignAssetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('equipment.admin');
    const assetId = String(formData.get('assetId') ?? '');
    const workerId = String(formData.get('workerId') ?? '');
    if (!workerId) return { error: 'Pick a worker.' };
    const asset = await db.equipmentAsset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.status === 'ASSIGNED') return { error: 'This asset is already assigned — return it first.' };

    await db.$transaction([
      db.equipmentAssignment.create({
        data: {
          assetId,
          workerId,
          assignedById: ctx.userId,
          returnRequired: formData.get('returnRequired') !== 'off',
          notes: String(formData.get('notes') ?? '') || null,
        },
      }),
      db.equipmentAsset.update({ where: { id: assetId }, data: { status: 'ASSIGNED' } }),
    ]);
    await recordTimeline({
      workerId,
      kind: 'EQUIPMENT',
      title: `Assigned ${asset.kind.toLowerCase()} ${asset.assetTag}`,
      visibility: 'MANAGER',
      actorUserId: ctx.userId,
    });
    await audit(ctx, 'equipment.assigned', { targetType: 'EquipmentAsset', targetId: assetId, metadata: { workerId } });
    revalidatePath('/equipment');
    return { success: 'Assigned.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not assign the asset.' };
  }
}

export async function returnAssetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('equipment.admin');
    const assignmentId = String(formData.get('assignmentId') ?? '');
    const condition = String(formData.get('condition') ?? 'GOOD');
    const assignment = await db.equipmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    if (assignment.returnedAt) return { error: 'Already returned.' };
    await db.$transaction([
      db.equipmentAssignment.update({
        where: { id: assignmentId },
        data: { returnedAt: new Date(), returnedCondition: condition },
      }),
      db.equipmentAsset.update({
        where: { id: assignment.assetId },
        data: { status: condition === 'LOST' ? 'LOST' : 'IN_STOCK', condition: condition === 'LOST' ? undefined : condition },
      }),
    ]);
    await audit(ctx, 'equipment.returned', { targetType: 'EquipmentAssignment', targetId: assignmentId, metadata: { condition } });
    revalidatePath('/equipment');
    return { success: 'Return recorded.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not record the return.' };
  }
}
