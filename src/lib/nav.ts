/**
 * Primary navigation config (§75). Items are filtered server-side by
 * permission before rendering, so employees automatically get the
 * simplified navigation experience.
 */

export interface NavItem {
  label: string;
  href: string;
  /** Permission required to see the item; null = any signed-in user */
  permission: string | null;
  /** Show when the user manages people, even without the permission */
  managerOr?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { label: 'Home', href: '/', permission: null },
      { label: 'My Tasks', href: '/tasks', permission: null },
      { label: 'Approvals', href: '/approvals', permission: null },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Directory', href: '/people', permission: 'people.read' },
      { label: 'Org Chart', href: '/people/org-chart', permission: 'people.read' },
      { label: 'Contractors', href: '/people/contractors', permission: 'people.read_all' },
      { label: 'HR Cases', href: '/people/cases', permission: 'cases.read' },
    ],
  },
  {
    label: 'Recruiting',
    items: [
      { label: 'Jobs', href: '/recruiting/jobs', permission: 'recruiting.read' },
      { label: 'Candidates', href: '/recruiting/candidates', permission: 'recruiting.read' },
      { label: 'Offers', href: '/recruiting/offers', permission: 'recruiting.write' },
    ],
  },
  {
    label: 'Time',
    items: [
      { label: 'Time Off', href: '/time/pto', permission: null },
      { label: 'Calendar', href: '/time/calendar', permission: null },
      { label: 'Timesheets', href: '/time/tracking', permission: null },
    ],
  },
  {
    label: 'Talent',
    items: [
      { label: 'Goals', href: '/talent/goals', permission: null },
      { label: 'Reviews', href: '/talent/reviews', permission: null },
      { label: '1:1s', href: '/talent/one-on-ones', permission: null },
      { label: 'Feedback', href: '/talent/feedback', permission: null },
      { label: 'Training', href: '/training', permission: null },
      { label: 'Skills', href: '/skills', permission: 'skills.read' },
    ],
  },
  {
    label: 'Compensation',
    items: [
      { label: 'Compensation', href: '/comp', permission: 'comp.read' },
      { label: 'Salary Bands', href: '/comp/bands', permission: 'comp.bands' },
      { label: 'Comp Cycles', href: '/comp/cycles', permission: 'comp.cycle' },
      { label: 'Pay Equity', href: '/comp/equity', permission: 'comp.equity' },
      { label: 'Benefits', href: '/benefits', permission: null },
      { label: 'Payroll Hub', href: '/payroll', permission: 'payroll.read' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Onboarding', href: '/ops/onboarding', permission: 'onboarding.admin', managerOr: true },
      { label: 'Offboarding', href: '/ops/offboarding', permission: 'onboarding.admin' },
      { label: 'Documents', href: '/documents', permission: null },
      { label: 'Policies', href: '/policies', permission: null },
      { label: 'Announcements', href: '/announcements', permission: null },
      { label: 'Equipment', href: '/equipment', permission: 'equipment.admin' },
      { label: 'App Access', href: '/apps', permission: 'apps.admin' },
      { label: 'Surveys', href: '/surveys', permission: null },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Reports', href: '/reports', permission: 'reports.run' },
      { label: 'Executive Dashboard', href: '/insights/executive', permission: 'exec.dashboard' },
      { label: 'Workforce Analytics', href: '/insights/workforce', permission: 'insights.workforce' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Compliance', href: '/admin/compliance', permission: 'compliance.admin' },
      { label: 'Workflows', href: '/admin/workflows', permission: 'workflows.admin' },
      { label: 'Imports', href: '/admin/imports', permission: 'imports.admin' },
      { label: 'Audit Log', href: '/admin/audit', permission: 'audit.read' },
      { label: 'Email Outbox', href: '/admin/email-outbox', permission: 'settings.admin' },
      { label: 'Integrations', href: '/admin/integrations', permission: 'settings.admin' },
      { label: 'Settings', href: '/admin/settings', permission: 'org.admin' },
    ],
  },
];

export function filterNav(permissions: Set<string>, isManager: boolean): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter(
      (item) =>
        item.permission === null || permissions.has(item.permission) || (item.managerOr && isManager),
    ),
  })).filter((g) => g.items.length > 0);
}
