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
  // Recruiting
  "VIEW_REQUISITIONS",
  "MANAGE_REQUISITIONS",
  "APPROVE_REQUISITIONS",
  "MANAGE_PIPELINE",
  "MANAGE_INTERVIEWS",
  "SUBMIT_SCORECARD",
  "MANAGE_OFFERS",
  "APPROVE_OFFERS",
  "VIEW_RECRUITING_ANALYTICS",
  /// Read every filed review on a candidate without filing one first.
  "VIEW_ALL_REVIEWS",
  "MANAGE_SOCIAL_CHECKS",
  /// Conduct a social review. Deliberately separate from deciding.
  "CONDUCT_SOCIAL_REVIEW",
  "MANAGE_BACKGROUND_CHECKS",
  // Validation
  /// Create and maintain employment records for people we hired.
  "MANAGE_HIRES",
  /// Rate a hire's on-the-job performance. Held by managers, not analysts.
  "SUBMIT_PERFORMANCE_REVIEW",
  /// Read validity studies and norm tables.
  "VIEW_VALIDATION",
  /// Run studies, generate norm tables, and activate them. Activating a norm
  /// table changes what every future band means, so it sits with the people
  /// who own the instrument rather than with the people using its output.
  "MANAGE_VALIDATION",
  /// See how every interviewer rates relative to their colleagues. This is
  /// data about employees' judgement, so it is not granted by default to the
  /// people whose judgement it describes — everyone sees their own card
  /// without needing this.
  "VIEW_INTERVIEWER_CALIBRATION",
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
    "VIEW_REQUISITIONS",
    "MANAGE_REQUISITIONS",
    "MANAGE_PIPELINE",
    "MANAGE_INTERVIEWS",
    "SUBMIT_SCORECARD",
    "MANAGE_OFFERS",
    "VIEW_RECRUITING_ANALYTICS",
    "VIEW_ALL_REVIEWS",
    "MANAGE_SOCIAL_CHECKS",
    "CONDUCT_SOCIAL_REVIEW",
    "MANAGE_BACKGROUND_CHECKS",
    "MANAGE_HIRES",
    "SUBMIT_PERFORMANCE_REVIEW",
    "VIEW_VALIDATION",
    "VIEW_INTERVIEWER_CALIBRATION",
  ],
  // A hiring manager runs their own roles: they move candidates, schedule
  // and score interviews, and approve what they are named on. They do not
  // create requisitions or send offers — those stay with the recruiter.
  HIRING_MANAGER: [
    "VIEW_CANDIDATES",
    "VIEW_REPORTS",
    "VIEW_REQUISITIONS",
    "APPROVE_REQUISITIONS",
    "MANAGE_PIPELINE",
    "MANAGE_INTERVIEWS",
    "SUBMIT_SCORECARD",
    "APPROVE_OFFERS",
    "VIEW_RECRUITING_ANALYTICS",
    // The boss sees every rating and all the written feedback. They do not
    // conduct social reviews — separating that from deciding is the control.
    "VIEW_ALL_REVIEWS",
    // Managers rate the people they hired. That rating is the criterion every
    // validity study rests on, so it comes from the person who sees the work.
    "SUBMIT_PERFORMANCE_REVIEW",
  ],
  ASSESSMENT_ADMIN: [
    "MANAGE_QUESTIONS",
    "MANAGE_BENCHMARKS",
    "MANAGE_NORMS",
    "VIEW_QUALITY",
    "VIEW_VALIDATION",
    "MANAGE_VALIDATION",
  ],
  VIEWER: ["VIEW_CANDIDATES", "VIEW_REPORTS", "VIEW_REQUISITIONS"],
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
