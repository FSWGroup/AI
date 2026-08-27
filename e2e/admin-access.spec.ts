/**
 * RBAC end-to-end: recording access is restricted to the configured roles
 * (default SUPER_ADMIN + HR_ADMIN); hiring managers and viewers are denied.
 */

import { expect, test } from "@playwright/test";
import { adminApi, db } from "./helpers";

test("recording access is allowed for HR and denied for hiring managers", async ({
  baseURL,
}) => {
  const attempt = await db().attempt.findFirstOrThrow({
    where: { candidate: { firstName: "Alex", lastName: "Sample" } },
  });

  const hr = await adminApi(baseURL!, "hr@fsw.local");
  const hrRes = await hr.get(`/api/admin/attempts/${attempt.id}/recording`);
  expect(hrRes.status()).toBe(200);
  const body = (await hrRes.json()) as { reminder: string };
  expect(body.reminder).toContain("assessment-integrity");

  const manager = await adminApi(baseURL!, "manager@fsw.local");
  const mgrRes = await manager.get(`/api/admin/attempts/${attempt.id}/recording`);
  expect(mgrRes.status()).toBe(403);

  const viewer = await adminApi(baseURL!, "viewer@fsw.local");
  const viewerRes = await viewer.get(`/api/admin/attempts/${attempt.id}/recording`);
  expect(viewerRes.status()).toBe(403);
});

test("expired invitations are rejected with a friendly message", async ({
  baseURL,
}) => {
  // Fabricate an expired invitation directly (same token scheme as the app:
  // 256-bit base64url token stored as a SHA-256 hex hash).
  const { createHash, randomBytes } = await import("crypto");
  const token = randomBytes(32).toString("base64url");
  const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
  const generateAssessmentCode = () =>
    `FSW-E2E${randomBytes(3).toString("hex").toUpperCase()}`;
  const opening = await db().jobOpening.findFirstOrThrow({});
  const version = await db().assessmentVersion.findFirstOrThrow({
    where: { status: "ACTIVE" },
  });
  const candidate = await db().candidate.create({
    data: {
      firstName: "Expired",
      lastName: "Invite",
      email: "expired@example.invalid",
    },
  });
  await db().invitation.create({
    data: {
      candidateId: candidate.id,
      jobOpeningId: opening.id,
      assessmentVersionId: version.id,
      tokenHash: hashToken(token),
      code: generateAssessmentCode(),
      expiresAt: new Date(Date.now() - 24 * 3600 * 1000),
    },
  });

  const ctx = await (await import("@playwright/test")).request.newContext({ baseURL });
  const res = await ctx.post("/api/candidate/open", { data: { token } });
  expect(res.status()).toBe(410);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("expired");
});
