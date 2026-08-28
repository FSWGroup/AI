'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requirePermission, AuthzError } from '@/lib/authz';
import { audit } from '@/lib/audit';
import { sendActivationEmail } from '@/app/(auth)/actions';
import { ALL_PERMISSIONS } from '@/lib/authz/catalog';
import type { ActionResult } from '@/app/(auth)/actions';

// ---------------------------------------------------------------------------
// Organization structure
// ---------------------------------------------------------------------------

export async function saveOrganizationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('org.admin');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Organization name is required.' };
    const org = await db.organization.findFirst();
    if (!org) return { error: 'No organization found.' };
    await db.organization.update({
      where: { id: org.id },
      data: {
        name,
        branding: {
          ...(org.branding as object),
          accentColor: String(formData.get('accentColor') ?? '') || undefined,
          logoUrl: String(formData.get('logoUrl') ?? '') || undefined,
          tagline: String(formData.get('tagline') ?? '') || undefined,
        },
      },
    });
    await audit(ctx, 'settings.organization_updated', { targetType: 'Organization', targetId: org.id });
    revalidatePath('/admin/settings');
    return { success: 'Organization saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the organization.' };
  }
}

export async function saveEntityAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('org.admin');
    const name = String(formData.get('name') ?? '').trim();
    const code = String(formData.get('code') ?? '').trim().toUpperCase();
    if (!name || !code) return { error: 'Name and code are required.' };
    const org = await db.organization.findFirstOrThrow();
    const entity = await db.legalEntity.upsert({
      where: { code },
      create: { organizationId: org.id, name, code, country: String(formData.get('country') ?? 'US') },
      update: { name, country: String(formData.get('country') ?? 'US') },
    });
    await audit(ctx, 'settings.entity_saved', { targetType: 'LegalEntity', targetId: entity.id });
    revalidatePath('/admin/settings');
    return { success: 'Legal entity saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the legal entity.' };
  }
}

export async function saveDepartmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('org.admin');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Department name is required.' };
    const dept = await db.department.upsert({ where: { name }, create: { name }, update: { active: true } });
    await audit(ctx, 'settings.department_saved', { targetType: 'Department', targetId: dept.id });
    revalidatePath('/admin/settings');
    return { success: 'Department saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the department.' };
  }
}

export async function saveLocationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('org.admin');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Location name is required.' };
    const location = await db.location.upsert({
      where: { name },
      create: {
        name,
        street: String(formData.get('street') ?? '') || null,
        city: String(formData.get('city') ?? '') || null,
        state: String(formData.get('state') ?? '') || null,
        postal: String(formData.get('postal') ?? '') || null,
        country: String(formData.get('country') ?? 'US'),
        timezone: String(formData.get('timezone') ?? 'America/New_York'),
      },
      update: {
        street: String(formData.get('street') ?? '') || null,
        city: String(formData.get('city') ?? '') || null,
        state: String(formData.get('state') ?? '') || null,
        postal: String(formData.get('postal') ?? '') || null,
        country: String(formData.get('country') ?? 'US'),
        timezone: String(formData.get('timezone') ?? 'America/New_York'),
      },
    });
    await audit(ctx, 'settings.location_saved', { targetType: 'Location', targetId: location.id });
    revalidatePath('/admin/settings');
    return { success: 'Location saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the location.' };
  }
}

export async function saveHolidayAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('org.admin');
    const calendarId = String(formData.get('calendarId') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const date = new Date(String(formData.get('date') ?? ''));
    if (!calendarId || !name || Number.isNaN(date.getTime())) return { error: 'Calendar, name and date are required.' };
    await db.holiday.upsert({
      where: { calendarId_date_name: { calendarId, date, name } },
      create: { calendarId, date, name, kind: String(formData.get('kind') ?? 'PAID') },
      update: { kind: String(formData.get('kind') ?? 'PAID') },
    });
    await audit(ctx, 'settings.holiday_saved', { targetType: 'HolidayCalendar', targetId: calendarId, metadata: { name } });
    revalidatePath('/admin/settings');
    return { success: 'Holiday saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the holiday.' };
  }
}

export async function savePtoPolicyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('pto.admin');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Policy name is required.' };
    const policy = await db.ptoPolicy.create({
      data: {
        name,
        leaveType: String(formData.get('leaveType') ?? 'VACATION'),
        country: String(formData.get('country') ?? '') || null,
        accrualMethod: String(formData.get('accrualMethod') ?? 'ANNUAL_GRANT'),
        hoursPerYear: Number(formData.get('hoursPerYear') ?? 0) || 0,
        carryoverCapHours: formData.get('carryoverCapHours') ? Number(formData.get('carryoverCapHours')) : null,
        maxBalanceHours: formData.get('maxBalanceHours') ? Number(formData.get('maxBalanceHours')) : null,
        waitingPeriodDays: Number(formData.get('waitingPeriodDays') ?? 0) || 0,
        allowNegative: formData.get('allowNegative') === 'on',
        requiresApproval: formData.get('requiresApproval') !== 'off',
      },
    });
    await audit(ctx, 'settings.pto_policy_created', { targetType: 'PtoPolicy', targetId: policy.id });
    revalidatePath('/admin/settings');
    return { success: 'PTO policy created.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not create the policy.' };
  }
}

export async function assignPtoPolicyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('pto.admin');
    const policyId = String(formData.get('policyId') ?? '');
    const target = String(formData.get('target') ?? '');
    const policy = await db.ptoPolicy.findUniqueOrThrow({ where: { id: policyId } });

    const workers = await db.worker.findMany({
      where:
        target === 'ALL_COUNTRY'
          ? { country: policy.country ?? 'US', status: { notIn: ['TERMINATED'] }, deletedAt: null }
          : { id: target },
      select: { id: true },
    });
    let count = 0;
    for (const w of workers) {
      const existing = await db.ptoPolicyAssignment.findFirst({ where: { workerId: w.id, policyId, endDate: null } });
      if (existing) continue;
      await db.ptoPolicyAssignment.create({ data: { workerId: w.id, policyId } });
      count++;
    }
    await audit(ctx, 'settings.pto_policy_assigned', { targetType: 'PtoPolicy', targetId: policyId, metadata: { count } });
    revalidatePath('/admin/settings');
    return { success: `Assigned to ${count} worker${count === 1 ? '' : 's'}.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not assign the policy.' };
  }
}

// ---------------------------------------------------------------------------
// Users, roles & permissions
// ---------------------------------------------------------------------------

export async function setUserRolesAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('users.admin');
    const userId = String(formData.get('userId') ?? '');
    const roleIds = formData.getAll('roleIds').map(String).filter(Boolean);
    const before = await db.userRole.findMany({ where: { userId }, include: { role: true } });

    // Never let the last Super Admin drop their own super-admin role.
    const superAdmin = await db.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    if (before.some((r) => r.roleId === superAdmin.id) && !roleIds.includes(superAdmin.id)) {
      const remaining = await db.userRole.count({ where: { roleId: superAdmin.id, userId: { not: userId } } });
      if (remaining === 0) return { error: 'At least one Super Admin must remain.' };
    }

    await db.$transaction([
      db.userRole.deleteMany({ where: { userId } }),
      db.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId })) }),
    ]);
    const after = await db.userRole.findMany({ where: { userId }, include: { role: true } });
    await audit(ctx, 'users.roles_changed', {
      targetType: 'User',
      targetId: userId,
      before: { roles: before.map((r) => r.role.key) },
      after: { roles: after.map((r) => r.role.key) },
    });
    revalidatePath('/admin/settings');
    return { success: 'Roles updated.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not update roles.' };
  }
}

export async function setUserStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('users.admin');
    const userId = String(formData.get('userId') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].includes(status)) return { error: 'Invalid status.' };
    if (userId === ctx.userId) return { error: 'You cannot change your own account status.' };
    await db.user.update({ where: { id: userId }, data: { status: status as never } });
    if (status !== 'ACTIVE') {
      await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(ctx, 'users.status_changed', { targetType: 'User', targetId: userId, after: { status } });
    revalidatePath('/admin/settings');
    return { success: `Account ${status.toLowerCase()}.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not change the account status.' };
  }
}

export async function resendInviteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('users.admin');
    const userId = String(formData.get('userId') ?? '');
    await sendActivationEmail(userId);
    await audit(ctx, 'users.invite_resent', { targetType: 'User', targetId: userId });
    return { success: 'Invitation sent.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not send the invitation.' };
  }
}

export async function inviteUserForWorkerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('users.admin');
    const workerId = String(formData.get('workerId') ?? '');
    const worker = await db.worker.findUniqueOrThrow({ where: { id: workerId } });
    if (worker.userId) return { error: 'This worker already has an account.' };
    if (!worker.workEmail) return { error: 'Set a work email on the profile first.' };
    const roleKey = worker.workerType === 'EMPLOYEE' ? 'EMPLOYEE' : 'CONTRACTOR';
    const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
    const user = await db.user.create({
      data: { email: worker.workEmail.toLowerCase(), status: 'INVITED', roles: { create: { roleId: role.id } } },
    });
    await db.worker.update({ where: { id: workerId }, data: { userId: user.id } });
    await sendActivationEmail(user.id);
    await audit(ctx, 'users.invited', { targetType: 'Worker', targetId: workerId, metadata: { email: worker.workEmail } });
    revalidatePath('/admin/settings');
    return { success: 'Account created and invitation sent.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not create the account.' };
  }
}

export async function setRolePermissionsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('settings.admin');
    const roleId = String(formData.get('roleId') ?? '');
    const role = await db.role.findUniqueOrThrow({ where: { id: roleId } });
    if (role.key === 'SUPER_ADMIN') return { error: 'Super Admin permissions cannot be narrowed.' };
    const permissions = formData.getAll('permissions').map(String).filter((p) => ALL_PERMISSIONS.includes(p as never));
    const before = await db.rolePermission.findMany({ where: { roleId } });
    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId } }),
      db.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId, permission })) }),
    ]);
    await audit(ctx, 'settings.role_permissions_changed', {
      targetType: 'Role',
      targetId: roleId,
      before: { permissions: before.map((p) => p.permission) },
      after: { permissions },
    });
    revalidatePath('/admin/settings');
    return { success: `${role.name} permissions updated.` };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not update permissions.' };
  }
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export async function saveCustomFieldAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('settings.admin');
    const label = String(formData.get('label') ?? '').trim();
    if (!label) return { error: 'Field label is required.' };
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const options = String(formData.get('options') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const field = await db.customFieldDef.upsert({
      where: { key },
      create: {
        label,
        key,
        fieldType: String(formData.get('fieldType') ?? 'TEXT'),
        options,
        required: formData.get('required') === 'on',
        section: String(formData.get('section') ?? 'Custom'),
        visibility: String(formData.get('visibility') ?? 'HR'),
      },
      update: {
        label,
        fieldType: String(formData.get('fieldType') ?? 'TEXT'),
        options,
        required: formData.get('required') === 'on',
        section: String(formData.get('section') ?? 'Custom'),
        visibility: String(formData.get('visibility') ?? 'HR'),
        active: true,
      },
    });
    await audit(ctx, 'settings.custom_field_saved', { targetType: 'CustomFieldDef', targetId: field.id });
    revalidatePath('/admin/settings');
    return { success: 'Custom field saved — it appears on worker profiles immediately.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the custom field.' };
  }
}

export async function deleteCustomFieldAction(formData: FormData): Promise<void> {
  const ctx = await requirePermission('settings.admin');
  const id = String(formData.get('fieldId') ?? '');
  await db.customFieldDef.update({ where: { id }, data: { active: false } });
  await audit(ctx, 'settings.custom_field_disabled', { targetType: 'CustomFieldDef', targetId: id });
  revalidatePath('/admin/settings');
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export async function saveIntegrationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requirePermission('settings.admin');
    const kind = String(formData.get('kind') ?? '');
    const id = String(formData.get('integrationId') ?? '');
    const enabled = formData.get('enabled') === 'on';
    // Only non-secret configuration is stored; credentials live in env vars.
    const config = { note: String(formData.get('note') ?? '') };
    if (id) {
      await db.integration.update({ where: { id }, data: { enabled, config, status: enabled ? 'CONFIGURED' : 'DISABLED' } });
    } else {
      await db.integration.create({
        data: { kind, name: String(formData.get('name') ?? kind), enabled, config, status: enabled ? 'CONFIGURED' : 'NOT_CONFIGURED' },
      });
    }
    await audit(ctx, 'settings.integration_saved', { metadata: { kind, enabled } });
    revalidatePath('/admin/integrations');
    return { success: 'Integration saved.' };
  } catch (error) {
    if (error instanceof AuthzError) return { error: error.message };
    return { error: 'Could not save the integration.' };
  }
}
