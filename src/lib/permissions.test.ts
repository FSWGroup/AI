import { describe, it, expect } from "vitest";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  type Permission,
} from "@/lib/permissions";

describe("permission catalog", () => {
  it("has a description for every permission", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(PERMISSIONS[permission], `missing description for ${permission}`).toBeTruthy();
    }
  });

  it("uses namespaced dot-separated keys", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(permission, `${permission} is not namespaced`).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("grants every role only permissions that exist", () => {
    const valid = new Set<string>(ALL_PERMISSIONS);
    for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(valid.has(permission), `${role} grants unknown permission ${permission}`).toBe(true);
      }
    }
  });

  it("has a label and description for every role", () => {
    for (const key of Object.values(ROLE_KEYS)) {
      expect(ROLE_LABELS[key]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[key]).toBeTruthy();
      expect(DEFAULT_ROLE_PERMISSIONS[key]).toBeDefined();
    }
  });
});

describe("least privilege in default roles", () => {
  const has = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS, permission: Permission) =>
    DEFAULT_ROLE_PERMISSIONS[role].includes(permission);

  it("gives super admin everything", () => {
    expect(DEFAULT_ROLE_PERMISSIONS[ROLE_KEYS.SUPER_ADMIN]).toHaveLength(ALL_PERMISSIONS.length);
  });

  it("withholds sensitive personal fields from the organization admin", () => {
    expect(has(ROLE_KEYS.ORG_ADMIN, "people.sensitive_view")).toBe(false);
    expect(has(ROLE_KEYS.ORG_ADMIN, "people.sensitive_edit")).toBe(false);
  });

  it("gives only HR and super admin access to sensitive fields", () => {
    const holders = Object.entries(DEFAULT_ROLE_PERMISSIONS)
      .filter(([, permissions]) => permissions.includes("people.sensitive_view"))
      .map(([role]) => role);
    expect(holders.sort()).toEqual([ROLE_KEYS.HR_ADMIN, ROLE_KEYS.SUPER_ADMIN].sort());
  });

  it("keeps learners out of every administrative capability", () => {
    const forbidden: Permission[] = [
      "people.edit",
      "people.sensitive_view",
      "training.create",
      "training.publish",
      "training.assign",
      "training.complete_override",
      "sop.create",
      "sop.publish",
      "compliance.manage",
      "reports.view",
      "reports.export",
      "audit.view",
      "settings.manage",
      "integrations.manage",
      "privacy.manage",
      "team.view",
    ];
    for (const permission of forbidden) {
      expect(has(ROLE_KEYS.LEARNER, permission), `learner should not hold ${permission}`).toBe(false);
    }
  });

  it("gives contractors a narrower surface than learners", () => {
    const contractor = DEFAULT_ROLE_PERMISSIONS[ROLE_KEYS.CONTRACTOR];
    const learner = DEFAULT_ROLE_PERMISSIONS[ROLE_KEYS.LEARNER];
    expect(contractor.length).toBeLessThan(learner.length);
    // Contractors must not browse the people directory or the org chart.
    expect(contractor).not.toContain("people.view");
    expect(contractor).not.toContain("org.view");
  });

  it("keeps the auditor read-only", () => {
    const writeLike = [
      "people.edit",
      "training.create",
      "training.publish",
      "training.assign",
      "training.complete_override",
      "sop.create",
      "sop.publish",
      "compliance.manage",
      "settings.manage",
      "integrations.manage",
      "media.upload",
      "media.delete",
      "ai.generate",
      "ai.video",
      "privacy.manage",
    ] as Permission[];
    for (const permission of writeLike) {
      expect(has(ROLE_KEYS.AUDITOR, permission), `auditor should not hold ${permission}`).toBe(false);
    }
    expect(has(ROLE_KEYS.AUDITOR, "audit.view")).toBe(true);
    expect(has(ROLE_KEYS.AUDITOR, "reports.view")).toBe(true);
  });

  it("does not let a manager override completions or publish content", () => {
    expect(has(ROLE_KEYS.MANAGER, "training.complete_override")).toBe(false);
    expect(has(ROLE_KEYS.MANAGER, "training.publish")).toBe(false);
    expect(has(ROLE_KEYS.MANAGER, "sop.publish")).toBe(false);
    // But a manager can see and support their own team.
    expect(has(ROLE_KEYS.MANAGER, "team.view")).toBe(true);
    expect(has(ROLE_KEYS.MANAGER, "team.assign")).toBe(true);
    expect(has(ROLE_KEYS.MANAGER, "team.approve")).toBe(true);
  });

  it("does not let a content author publish without review", () => {
    expect(has(ROLE_KEYS.CONTENT_AUTHOR, "training.publish")).toBe(false);
    expect(has(ROLE_KEYS.CONTENT_AUTHOR, "sop.publish")).toBe(false);
    expect(has(ROLE_KEYS.CONTENT_AUTHOR, "sop.approve")).toBe(false);
    expect(has(ROLE_KEYS.CONTENT_AUTHOR, "training.create")).toBe(true);
    expect(has(ROLE_KEYS.CONTENT_AUTHOR, "sop.create")).toBe(true);
  });

  it("does not let a reviewer or SME assign training", () => {
    expect(has(ROLE_KEYS.REVIEWER, "training.assign")).toBe(false);
    expect(has(ROLE_KEYS.SME, "training.assign")).toBe(false);
  });
});
