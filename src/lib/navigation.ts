import type { Permission } from "@/lib/permissions";

/**
 * Navigation model.
 *
 * Items declare the permission that reveals them. The shell filters against the
 * actor's effective permissions, and each destination page independently
 * enforces the same permission server-side — hiding a link is never the control.
 */

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Any one of these permissions reveals the item. Empty = always visible. */
  permissions?: Permission[];
  /** Exact match only (used for section roots like /home). */
  exact?: boolean;
}

export interface NavSection {
  id: string;
  label: string | null;
  items: NavItem[];
}

export type IconName =
  | "home"
  | "training"
  | "path"
  | "knowledge"
  | "sop"
  | "certificate"
  | "skill"
  | "people"
  | "ai"
  | "team"
  | "status"
  | "assignment"
  | "matrix"
  | "approval"
  | "report"
  | "dashboard"
  | "compliance"
  | "content"
  | "studio"
  | "video"
  | "org"
  | "integration"
  | "settings"
  | "audit"
  | "calendar"
  | "media"
  | "announcement";

export const LEARNER_NAV: NavSection = {
  id: "learner",
  label: null,
  items: [
    { label: "Home", href: "/home", icon: "home", exact: true },
    { label: "My Training", href: "/my-training", icon: "training" },
    { label: "Learning Paths", href: "/paths", icon: "path" },
    { label: "Catalog", href: "/catalog", icon: "knowledge" },
    { label: "SOP Library", href: "/sops", icon: "sop", permissions: ["sop.view"] },
    { label: "Certificates", href: "/certificates", icon: "certificate" },
    { label: "Skills", href: "/skills", icon: "skill", permissions: ["skills.view"] },
    { label: "People", href: "/people", icon: "people", permissions: ["people.view"] },
    { label: "Calendar", href: "/calendar", icon: "calendar" },
    { label: "Ask FSW AI", href: "/ask", icon: "ai", permissions: ["ai.ask"] },
  ],
};

export const MANAGER_NAV: NavSection = {
  id: "manager",
  label: "Manager",
  items: [
    { label: "Team", href: "/team", icon: "team", permissions: ["team.view"] },
    {
      // First in the section on purpose: it is the page a manager should open.
      label: "This Week",
      href: "/team/brief",
      icon: "status",
      permissions: ["team.view"],
    },
    {
      label: "Training Status",
      href: "/team/status",
      icon: "status",
      permissions: ["team.view"],
    },
    {
      label: "Assignments",
      href: "/team/assignments",
      icon: "assignment",
      permissions: ["team.assign", "training.assign"],
    },
    {
      label: "Skills Matrix",
      href: "/team/skills",
      icon: "matrix",
      permissions: ["team.view", "skills.view"],
    },
    {
      label: "Knowledge Risk",
      href: "/team/knowledge-risk",
      icon: "matrix",
      permissions: ["team.view", "skills.view"],
    },
    {
      label: "Approvals",
      href: "/team/approvals",
      icon: "approval",
      permissions: ["team.approve", "content.review"],
    },
    { label: "Reports", href: "/reports", icon: "report", permissions: ["reports.view"] },
  ],
};

export const ADMIN_NAV: NavSection = {
  id: "admin",
  label: "Administration",
  items: [
    {
      label: "Dashboard",
      href: "/admin",
      icon: "dashboard",
      exact: true,
      permissions: ["reports.view", "settings.view"],
    },
    { label: "People", href: "/admin/people", icon: "people", permissions: ["people.edit"] },
    {
      label: "Training",
      href: "/admin/training",
      icon: "training",
      permissions: ["training.create"],
    },
    { label: "SOPs", href: "/admin/sops", icon: "sop", permissions: ["sop.create"] },
    {
      label: "Learning Paths",
      href: "/admin/paths",
      icon: "path",
      permissions: ["path.create"],
    },
    {
      label: "Compliance",
      href: "/admin/compliance",
      icon: "compliance",
      permissions: ["compliance.view"],
    },
    { label: "Skills", href: "/admin/skills", icon: "skill", permissions: ["skills.manage"] },
    {
      label: "Content Health",
      href: "/admin/content",
      icon: "content",
      permissions: ["training.create", "sop.create"],
    },
    { label: "Media", href: "/admin/media", icon: "media", permissions: ["media.view"] },
    { label: "AI Studio", href: "/admin/ai-studio", icon: "studio", permissions: ["ai.generate"] },
    { label: "Video Studio", href: "/admin/video-studio", icon: "video", permissions: ["ai.video"] },
    {
      label: "Announcements",
      href: "/admin/announcements",
      icon: "announcement",
      permissions: ["announcements.manage"],
    },
    { label: "Reports", href: "/admin/reports", icon: "report", permissions: ["reports.view"] },
    { label: "Organization", href: "/admin/organization", icon: "org", permissions: ["org.manage"] },
    {
      label: "Integrations",
      href: "/admin/integrations",
      icon: "integration",
      permissions: ["integrations.manage"],
    },
    { label: "Settings", href: "/admin/settings", icon: "settings", permissions: ["settings.view"] },
    { label: "Audit Log", href: "/admin/audit", icon: "audit", permissions: ["audit.view"] },
  ],
};

export const NAV_SECTIONS: NavSection[] = [LEARNER_NAV, MANAGER_NAV, ADMIN_NAV];

/** Filter a section's items to those the actor may see. */
export function visibleItems(section: NavSection, permissions: Set<string>): NavItem[] {
  return section.items.filter(
    (item) => !item.permissions || item.permissions.some((p) => permissions.has(p)),
  );
}

/** Filter the whole navigation, dropping sections that end up empty. */
export function buildNavigation(permissions: Set<string>): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: visibleItems(section, permissions),
  })).filter((section) => section.items.length > 0);
}

/** Quick-create menu entries, gated by the permission needed to create each type. */
export const QUICK_CREATE: { label: string; href: string; permission: Permission }[] = [
  { label: "Course", href: "/admin/training/new", permission: "training.create" },
  { label: "SOP", href: "/admin/sops/new", permission: "sop.create" },
  { label: "Learning Path", href: "/admin/paths/new", permission: "path.create" },
  { label: "AI Video", href: "/admin/video-studio/new", permission: "ai.video" },
  { label: "Announcement", href: "/admin/announcements/new", permission: "announcements.manage" },
  { label: "Person", href: "/admin/people/new", permission: "people.edit" },
  { label: "Skill", href: "/admin/skills/new", permission: "skills.manage" },
];
