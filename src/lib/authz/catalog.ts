/**
 * Permission catalog + default role grants.
 * Shared by the seed script, the authorization layer, and the Settings UI.
 *
 * Enforcement is ALWAYS server-side (server actions / route handlers /
 * server components). Frontend hiding is a convenience, never the control.
 */

export const PERMISSIONS = {
  // People
  'people.read': 'View the employee directory (basic card: name, title, department, work contact)',
  'people.read_all': 'View full worker profiles across the organization',
  'people.write': 'Create and edit worker records',
  'people.terminate': 'Start offboarding / terminate workers',
  // Restricted PII
  'pii.view': 'View restricted personal fields (date of birth, home address, personal email)',
  'pii.reveal': 'Reveal encrypted identifiers (SSN, bank, tax IDs) — every reveal is audited',
  'pii.write': 'Add or update encrypted identifiers and bank details',
  // Compensation
  'comp.read': 'View compensation for other workers',
  'comp.write': 'Create compensation changes',
  'comp.bands': 'Manage salary bands',
  'comp.cycle': 'Run compensation planning cycles and see budget roll-up',
  'comp.equity': 'View pay equity analysis',
  // Documents & policies
  'docs.read_all': 'View HR documents for any worker',
  'docs.write': 'Upload and manage HR documents',
  'policies.admin': 'Create and publish policies',
  // Time
  'pto.approve': 'Approve PTO for direct/indirect reports',
  'pto.admin': 'Manage PTO policies and adjust balances',
  'time.approve': 'Approve timesheets for reports',
  'time.admin': 'Administer time tracking',
  'schedule.read': 'View published shift schedules beyond your own',
  'schedule.write': 'Create, assign and publish shifts',
  // Recruiting
  'recruiting.read': 'View jobs and candidates',
  'recruiting.write': 'Manage jobs, candidates, interviews and offers',
  // Talent
  'talent.read_team': 'View goals/reviews for reports',
  'talent.admin': 'Administer review cycles and calibration',
  'cases.read': 'View confidential HR cases',
  'cases.write': 'Manage confidential HR cases',
  // Benefits / payroll
  'benefits.read': 'View benefit plans and own enrollment',
  'benefits.admin': 'Administer benefit plans and enrollments',
  'payroll.read': 'View payroll hub data',
  'payroll.admin': 'Manage payroll periods and exports',
  // Ops
  'onboarding.admin': 'Manage onboarding/offboarding templates and instances',
  'training.admin': 'Manage training courses and assignments',
  'skills.read': 'View the skills and certification inventory across the org',
  'skills.admin': 'Manage the skill catalog and verify skills on other workers',
  'equipment.admin': 'Manage equipment assets and assignments',
  'apps.admin': 'Manage software access grants',
  'announce.admin': 'Publish announcements',
  'surveys.admin': 'Create and manage surveys',
  // Automation
  'workflows.admin': 'Manage workflow automations',
  'approvals.act': 'Act on approval requests assigned to you',
  // Insights
  'reports.run': 'Run reports',
  'reports.export': 'Export report data (audited)',
  'exec.dashboard': 'View the executive dashboard',
  'insights.workforce': 'View workforce analytics — attrition risk, cohorts, hiring velocity',
  // Governance
  'compliance.admin': 'Manage compliance rules and items',
  'audit.read': 'View the audit log',
  'retention.admin': 'Manage retention policies and approve destruction',
  // System
  'org.admin': 'Manage org structure (entities, departments, teams, locations, holidays)',
  'users.admin': 'Manage user accounts and role assignments',
  'settings.admin': 'System settings, integrations, security configuration',
  'api.admin': 'Issue and revoke API keys and outbound webhooks',
  'imports.admin': 'Run data imports',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_DEFS: {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full system configuration including infrastructure-level settings.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'HR_ADMIN',
    name: 'HR Admin',
    description: 'Full people-management access except infrastructure-level settings.',
    // api.admin issues machine credentials — infrastructure, not people work.
    permissions: ALL_PERMISSIONS.filter((p) => !['settings.admin', 'users.admin', 'api.admin'].includes(p)),
  },
  {
    key: 'EXECUTIVE',
    name: 'Executive',
    description: 'High-level workforce visibility and reports.',
    permissions: [
      'people.read', 'people.read_all', 'comp.read', 'reports.run', 'reports.export', 'exec.dashboard',
      'approvals.act', 'recruiting.read', 'talent.read_team', 'skills.read', 'insights.workforce',
      'comp.cycle', 'comp.equity', 'schedule.read',
    ],
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Access to authorized direct/indirect reports and manager workflows.',
    permissions: [
      'people.read', 'pto.approve', 'time.approve', 'talent.read_team', 'approvals.act', 'recruiting.read',
      'skills.read', 'schedule.read', 'schedule.write', 'comp.cycle',
    ],
  },
  {
    key: 'EMPLOYEE',
    name: 'Employee',
    description: 'Self-service access.',
    permissions: ['people.read'],
  },
  {
    key: 'CONTRACTOR',
    name: 'Contractor',
    description: 'Restricted self-service access appropriate to contractors.',
    permissions: ['people.read'],
  },
  {
    key: 'FINANCE',
    name: 'Payroll / Finance',
    description: 'Compensation, payroll-related data and approved financial information.',
    permissions: [
      'people.read', 'people.read_all', 'comp.read', 'comp.write', 'comp.bands', 'comp.cycle', 'comp.equity',
      'benefits.read', 'benefits.admin', 'payroll.read', 'payroll.admin', 'reports.run', 'reports.export',
      'approvals.act', 'insights.workforce',
    ],
  },
  {
    key: 'RECRUITER',
    name: 'Recruiter',
    description: 'Applicant tracking and authorized hiring data.',
    permissions: ['people.read', 'recruiting.read', 'recruiting.write', 'reports.run', 'approvals.act'],
  },
  {
    key: 'IT_ADMIN',
    name: 'IT Administrator',
    description: 'Equipment and application-access workflows. No private HR, medical or compensation access.',
    permissions: ['people.read', 'equipment.admin', 'apps.admin', 'approvals.act', 'skills.read'],
  },
  {
    key: 'AUDITOR',
    name: 'Auditor / Read Only',
    description: 'Explicitly scoped read-only access for audits.',
    permissions: ['people.read', 'people.read_all', 'audit.read', 'reports.run'],
  },
];
