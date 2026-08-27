import { describe, expect, it } from "vitest";
import { can, canAccessRecordings, isJobScoped } from "@/lib/auth/rbac";

describe("role permissions (least privilege)", () => {
  it("SUPER_ADMIN holds every permission", () => {
    expect(can("SUPER_ADMIN", "MANAGE_SYSTEM")).toBe(true);
    expect(can("SUPER_ADMIN", "MANAGE_RETENTION")).toBe(true);
  });

  it("HR_ADMIN manages candidates and reports but not system config", () => {
    expect(can("HR_ADMIN", "INVITE_CANDIDATES")).toBe(true);
    expect(can("HR_ADMIN", "VIEW_REPORTS")).toBe(true);
    expect(can("HR_ADMIN", "MANAGE_SYSTEM")).toBe(false);
    expect(can("HR_ADMIN", "MANAGE_RETENTION")).toBe(false);
  });

  it("HIRING_MANAGER is read-only on candidates/reports and job-scoped", () => {
    expect(can("HIRING_MANAGER", "VIEW_REPORTS")).toBe(true);
    expect(can("HIRING_MANAGER", "INVITE_CANDIDATES")).toBe(false);
    expect(can("HIRING_MANAGER", "MANAGE_ATTEMPTS")).toBe(false);
    expect(isJobScoped("HIRING_MANAGER")).toBe(true);
    expect(isJobScoped("HR_ADMIN")).toBe(false);
  });

  it("ASSESSMENT_ADMIN manages content, not candidates", () => {
    expect(can("ASSESSMENT_ADMIN", "MANAGE_QUESTIONS")).toBe(true);
    expect(can("ASSESSMENT_ADMIN", "MANAGE_NORMS")).toBe(true);
    expect(can("ASSESSMENT_ADMIN", "VIEW_CANDIDATES")).toBe(false);
  });

  it("VIEWER is read-only", () => {
    expect(can("VIEWER", "VIEW_REPORTS")).toBe(true);
    expect(can("VIEWER", "MANAGE_ATTEMPTS")).toBe(false);
    expect(can("VIEWER", "MANAGE_QUESTIONS")).toBe(false);
  });
});

describe("recording access (configurable, least privilege by default)", () => {
  const defaults = ["SUPER_ADMIN", "HR_ADMIN"];
  it("defaults exclude hiring managers and viewers", () => {
    expect(canAccessRecordings("HR_ADMIN", defaults)).toBe(true);
    expect(canAccessRecordings("SUPER_ADMIN", defaults)).toBe(true);
    expect(canAccessRecordings("HIRING_MANAGER", defaults)).toBe(false);
    expect(canAccessRecordings("VIEWER", defaults)).toBe(false);
  });
  it("respects organization overrides", () => {
    expect(
      canAccessRecordings("HIRING_MANAGER", ["SUPER_ADMIN", "HIRING_MANAGER"]),
    ).toBe(true);
    expect(canAccessRecordings("HR_ADMIN", ["SUPER_ADMIN"])).toBe(false);
  });
});
