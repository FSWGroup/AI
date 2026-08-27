/**
 * Role-based access control. Least privilege by default.
 *
 * SUPER_ADMIN       — system configuration and full privileges.
 * HR_ADMIN          — candidates, results, reports, assessment administration,
 *                     recordings (default; configurable in OrgSettings).
 * HIRING_MANAGER    — candidates and approved reports for assigned job
 *                     profiles only. No recording access by default.
 * ASSESSMENT_ADMIN  — forms, questions, scoring, benchmarks, quality.
 * VIEWER            — read-only limited reporting.
 */

import type { UserRole } from "@prisma/client";

export const PERMISSIONS = [
  "MANAGE_SYSTEM",
  "MANAGE_USERS",
  "MANAGE_CANDIDATES",
  "VIEW_CANDIDATES",
  "INVITE_CANDIDATES",
  "MANAGE_ATTEMPTS",
  "VIEW_REPORTS",
  "VIEW_INTEGRITY",
  "MANAGE_QUESTIONS",
  "MANAGE_BENCHMARKS",
  "MANAGE_NORMS",
  "VIEW_QUALITY",
  "MANAGE_RETENTION",
  "VIEW_AUDIT",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  HR_ADMIN: [
    "MANAGE_CANDIDATES",
    "VIEW_CANDIDATES",
    "INVITE_CANDIDATES",
    "MANAGE_ATTEMPTS",
    "VIEW_REPORTS",
    "VIEW_INTEGRITY",
    "MANAGE_BENCHMARKS",
    "VIEW_AUDIT",
  ],
  HIRING_MANAGER: ["VIEW_CANDIDATES", "VIEW_REPORTS"],
  ASSESSMENT_ADMIN: [
    "MANAGE_QUESTIONS",
    "MANAGE_BENCHMARKS",
    "MANAGE_NORMS",
    "VIEW_QUALITY",
  ],
  VIEWER: ["VIEW_CANDIDATES", "VIEW_REPORTS"],
};

export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Recording access is intentionally NOT a static permission: it is read from
 * OrgSettings.recordingAccessRoles (default SUPER_ADMIN + HR_ADMIN) so an
 * organization can widen or narrow it deliberately.
 */
export function canAccessRecordings(
  role: UserRole,
  recordingAccessRoles: string[],
): boolean {
  return recordingAccessRoles.includes(role);
}

/**
 * Roles whose candidate visibility is scoped to assigned job profiles.
 * Prevents insecure-direct-object-reference access across jobs.
 */
export function isJobScoped(role: UserRole): boolean {
  return role === "HIRING_MANAGER";
}
