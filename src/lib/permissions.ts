/**
 * FSW Academy permission catalog.
 *
 * Permissions are granular capabilities, not role names. Roles are bundles of
 * permissions; authorization checks always ask "does this actor hold this
 * capability", never "is this actor an admin".
 *
 * Server-side enforcement is mandatory (see src/lib/auth/guard.ts). UI hiding
 * is a convenience, never a control.
 */

export const PERMISSIONS = {
  // People
  "people.view": "View the people directory and basic profiles",
  "people.view_all":
    "See every person in the organization, not only your own reporting line",
  "people.edit": "Create and edit people records",
  "people.sensitive_view": "View encrypted sensitive profile fields",
  "people.sensitive_edit": "Edit encrypted sensitive profile fields",
  "people.import": "Bulk import and bulk edit people",
  "people.deactivate": "Deactivate and offboard people",

  // Organization
  "org.view": "View organization structure and org chart",
  "org.manage": "Manage business units, departments, teams, positions, locations",

  // Training / courses
  "training.view": "View the training catalog",
  "training.create": "Create and edit courses",
  "training.publish": "Publish course versions",
  "training.assign": "Assign training to others",
  "training.complete_override": "Override or manually mark training complete",
  "training.archive": "Archive courses and learning paths",

  // SOPs
  "sop.view": "View published SOPs",
  "sop.create": "Create and edit SOP drafts",
  "sop.approve": "Approve SOPs for publication",
  "sop.publish": "Publish SOP versions",
  "sop.archive": "Archive SOPs",

  // Learning paths
  "path.create": "Create and edit learning paths",
  "path.publish": "Publish learning paths",

  // Skills
  "skills.view": "View skills and proficiency data",
  "skills.manage": "Manage the skills library and position requirements",
  "skills.assess": "Assess skills and record practical sign-offs",

  // Compliance
  "compliance.view": "View compliance status and rules",
  "compliance.manage": "Manage compliance rules and exemptions",

  // Reports
  "reports.view": "View reports and dashboards beyond your own record",
  "reports.export": "Export report data to CSV/XLSX/PDF",

  // Team (manager scope)
  "team.view": "View your direct and indirect reports' training status",
  "team.assign": "Assign training to your reports",
  "team.approve": "Approve manager sign-offs for your reports",

  // Content collaboration
  "content.comment": "Comment on content in authoring views",
  "content.review": "Act as reviewer in approval workflows",

  // Media
  "media.view": "View the media library",
  "media.upload": "Upload media assets",
  "media.delete": "Delete media assets",

  // AI
  "ai.ask": "Use Ask FSW AI and the Training Coach",
  "ai.generate": "Generate draft content with AI",
  "ai.video": "Use the AI Video Studio",

  // Announcements
  "announcements.manage": "Create and manage announcements",

  // Platform administration
  "settings.view": "View application settings",
  "settings.manage": "Change application settings and branding",
  "integrations.manage": "Configure integrations, API keys, and webhooks",
  "audit.view": "View the audit log",
  "privacy.manage": "Run privacy exports, anonymization, and retention",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Canonical role keys. Stored in the Role table; seeded at install. */
export const ROLE_KEYS = {
  SUPER_ADMIN: "super_admin",
  ORG_ADMIN: "org_admin",
  HR_ADMIN: "hr_admin",
  TRAINING_ADMIN: "training_admin",
  COMPLIANCE_ADMIN: "compliance_admin",
  MANAGER: "manager",
  CONTENT_AUTHOR: "content_author",
  SME: "sme",
  REVIEWER: "reviewer",
  INSTRUCTOR: "instructor",
  LEARNER: "learner",
  CONTRACTOR: "contractor",
  AUDITOR: "auditor",
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

/** Baseline capabilities every authenticated person holds. */
const LEARNER_BASE: Permission[] = [
  "training.view",
  "sop.view",
  "skills.view",
  "people.view",
  "org.view",
  "media.view",
  "ai.ask",
];

/**
 * Default role → permission mapping used to seed the database. Administrators
 * can edit role permissions afterward; this is a starting point, not a
 * hard-coded runtime rule.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  [ROLE_KEYS.SUPER_ADMIN]: [...ALL_PERMISSIONS],

  [ROLE_KEYS.ORG_ADMIN]: ALL_PERMISSIONS.filter(
    (p) => p !== "people.sensitive_view" && p !== "people.sensitive_edit",
  ),

  [ROLE_KEYS.HR_ADMIN]: [
    ...LEARNER_BASE,
    "people.edit",
    "people.view_all",
    "people.import",
    "people.deactivate",
    "people.sensitive_view",
    "people.sensitive_edit",
    "org.manage",
    "training.assign",
    "reports.view",
    "reports.export",
    "compliance.view",
    "privacy.manage",
    "announcements.manage",
    "team.view",
  ],

  [ROLE_KEYS.TRAINING_ADMIN]: [
    ...LEARNER_BASE,
    "people.view_all",
    "training.create",
    "training.publish",
    "training.assign",
    "training.archive",
    "training.complete_override",
    "sop.create",
    "sop.approve",
    "sop.publish",
    "sop.archive",
    "path.create",
    "path.publish",
    "skills.manage",
    "skills.assess",
    "content.comment",
    "content.review",
    "media.upload",
    "media.delete",
    "reports.view",
    "reports.export",
    "ai.generate",
    "ai.video",
    "announcements.manage",
    "team.view",
    "compliance.view",
  ],

  [ROLE_KEYS.COMPLIANCE_ADMIN]: [
    ...LEARNER_BASE,
    "people.view_all",
    "compliance.view",
    "compliance.manage",
    "training.assign",
    "reports.view",
    "reports.export",
    "audit.view",
    "content.review",
    "sop.approve",
    "team.view",
  ],

  [ROLE_KEYS.MANAGER]: [
    ...LEARNER_BASE,
    "team.view",
    "team.assign",
    "team.approve",
    "skills.assess",
    "reports.view",
    "content.comment",
  ],

  [ROLE_KEYS.CONTENT_AUTHOR]: [
    ...LEARNER_BASE,
    "training.create",
    "sop.create",
    "path.create",
    "content.comment",
    "media.upload",
    "ai.generate",
    "ai.video",
  ],

  [ROLE_KEYS.SME]: [...LEARNER_BASE, "content.comment", "content.review", "sop.create"],

  [ROLE_KEYS.REVIEWER]: [...LEARNER_BASE, "content.comment", "content.review"],

  [ROLE_KEYS.INSTRUCTOR]: [
    ...LEARNER_BASE,
    "team.view",
    "training.assign",
    "skills.assess",
    "content.comment",
  ],

  [ROLE_KEYS.LEARNER]: [...LEARNER_BASE],

  // Contractors get a deliberately narrower directory/knowledge surface.
  [ROLE_KEYS.CONTRACTOR]: ["training.view", "sop.view", "skills.view", "ai.ask"],

  [ROLE_KEYS.AUDITOR]: [
    "training.view",
    "sop.view",
    "people.view",
    "people.view_all",
    "org.view",
    "skills.view",
    "reports.view",
    "reports.export",
    "compliance.view",
    "audit.view",
  ],
};

export const ROLE_LABELS: Record<RoleKey, string> = {
  [ROLE_KEYS.SUPER_ADMIN]: "Super Administrator",
  [ROLE_KEYS.ORG_ADMIN]: "Organization Administrator",
  [ROLE_KEYS.HR_ADMIN]: "HR Administrator",
  [ROLE_KEYS.TRAINING_ADMIN]: "Training Administrator",
  [ROLE_KEYS.COMPLIANCE_ADMIN]: "Compliance Administrator",
  [ROLE_KEYS.MANAGER]: "Manager",
  [ROLE_KEYS.CONTENT_AUTHOR]: "Content Author",
  [ROLE_KEYS.SME]: "Subject Matter Expert",
  [ROLE_KEYS.REVIEWER]: "Reviewer",
  [ROLE_KEYS.INSTRUCTOR]: "Instructor",
  [ROLE_KEYS.LEARNER]: "Learner",
  [ROLE_KEYS.CONTRACTOR]: "Contractor",
  [ROLE_KEYS.AUDITOR]: "Auditor / Read Only",
};

export const ROLE_DESCRIPTIONS: Record<RoleKey, string> = {
  [ROLE_KEYS.SUPER_ADMIN]: "Full platform control, including sensitive fields and audit.",
  [ROLE_KEYS.ORG_ADMIN]: "Administers the platform without access to sensitive personal fields.",
  [ROLE_KEYS.HR_ADMIN]: "Owns people records, org structure, privacy operations, and onboarding.",
  [ROLE_KEYS.TRAINING_ADMIN]: "Owns training content, SOPs, assignments, and AI authoring tools.",
  [ROLE_KEYS.COMPLIANCE_ADMIN]: "Owns compliance rules, evidence, exemptions, and audit review.",
  [ROLE_KEYS.MANAGER]: "Sees and supports their own reporting line.",
  [ROLE_KEYS.CONTENT_AUTHOR]: "Creates courses, SOPs, and learning paths for review.",
  [ROLE_KEYS.SME]: "Provides expertise and reviews content accuracy.",
  [ROLE_KEYS.REVIEWER]: "Reviews content in approval workflows.",
  [ROLE_KEYS.INSTRUCTOR]: "Runs live sessions and records attendance.",
  [ROLE_KEYS.LEARNER]: "Completes assigned training and reads published knowledge.",
  [ROLE_KEYS.CONTRACTOR]: "Narrowed access for contractors: assigned training and SOPs only.",
  [ROLE_KEYS.AUDITOR]: "Read-only access to records, reports, and audit history.",
};

/** Permission groups for the settings > roles editor UI. */
export const PERMISSION_GROUPS: { label: string; prefix: string }[] = [
  { label: "People", prefix: "people." },
  { label: "Organization", prefix: "org." },
  { label: "Training", prefix: "training." },
  { label: "SOPs", prefix: "sop." },
  { label: "Learning Paths", prefix: "path." },
  { label: "Skills", prefix: "skills." },
  { label: "Compliance", prefix: "compliance." },
  { label: "Reports", prefix: "reports." },
  { label: "Team", prefix: "team." },
  { label: "Content", prefix: "content." },
  { label: "Media", prefix: "media." },
  { label: "AI", prefix: "ai." },
  { label: "Announcements", prefix: "announcements." },
  { label: "Settings", prefix: "settings." },
  { label: "Integrations", prefix: "integrations." },
  { label: "Audit", prefix: "audit." },
  { label: "Privacy", prefix: "privacy." },
];
