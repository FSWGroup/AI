/**
 * Full candidate journey end-to-end, with a fake camera:
 * invite → entry flow (rules, consent, camera preflight) → recording →
 * untimed + timed sections → refresh without gaining time → completion →
 * admin sees the completed candidate and report.
 */

import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { adminApi, createInvitation, db, welsfordOpeningId } from "./helpers";

test.describe.configure({ mode: "serial" });

const CANDIDATE = {
  firstName: "Erin",
  lastName: "Endtoend",
  email: "erin.e2e@example.invalid",
};

async function answerVisibleLikertPage(page: Page): Promise<void> {
  const fieldsets = page.locator("fieldset");
  await fieldsets.first().waitFor({ timeout: 20_000 });
  const count = await fieldsets.count();
  for (let i = 0; i < count; i++) {
    // Vary answers so the pattern is differentiated.
    const optionIdx = (i % 4) + (i % 2 === 0 ? 0 : 1);
    await fieldsets.nth(i).locator("label").nth(optionIdx).click();
  }
}

async function completeLikertSection(page: Page): Promise<void> {
  for (;;) {
    await answerVisibleLikertPage(page);
    const finish = page.getByRole("button", { name: "Finish section" });
    if (await finish.isVisible()) {
      await finish.click();
      return;
    }
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
}

async function completeSequentialSection(page: Page): Promise<void> {
  await page
    .locator("label, button:has-text(\"I'm ready — continue\")")
    .first()
    .waitFor({ timeout: 20_000 });
  for (let guard = 0; guard < 100; guard++) {
    const studyButton = page.getByRole("button", { name: /I'm ready — continue/ });
    if (await studyButton.isVisible().catch(() => false)) {
      await studyButton.click();
      continue;
    }
    // Answer the current question (first choice) then advance.
    await page.locator("label").first().click();
    const finish = page.getByRole("button", { name: "Finish section" });
    if (await finish.isVisible().catch(() => false)) {
      await finish.click();
      return;
    }
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  throw new Error("Section did not finish within the guard limit.");
}

async function startCurrentSection(page: Page): Promise<void> {
  const start = page.getByRole("button", {
    name: /I'm ready — start the timer|Start section/,
  });
  await expect(start).toBeVisible({ timeout: 20_000 });
  await start.click();
}

test("candidate completes the full assessment and HR sees the report", async ({
  page,
  baseURL,
}) => {
  const hr = await adminApi(baseURL!, "hr@fsw.local");
  const opening = await welsfordOpeningId();
  const { launchUrl } = await createInvitation(hr, opening, CANDIDATE);

  // ---- Entry flow -----------------------------------------------------------
  await page.goto(launchUrl);
  await expect(page.getByText("FSW WorkFit Assessment").first()).toBeVisible();
  await expect(page.getByText(/1 hour and 10 minutes/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Confirm your identity" })).toBeVisible();
  await page.getByRole("button", { name: /This is me/ }).click();

  await expect(page.getByRole("heading", { name: "Assessment rules" })).toBeVisible();
  const checkboxes = page.locator('input[type="checkbox"]');
  const ruleCount = await checkboxes.count();
  for (let i = 0; i < ruleCount; i++) await checkboxes.nth(i).check();
  await page.getByRole("button", { name: /I acknowledge the rules/ }).click();

  await expect(page.getByRole("heading", { name: "Accommodations" })).toBeVisible();
  await expect(page.getByText(/reasonable accommodations/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Recording notice" })).toBeVisible();
  const consentBox = page.locator('input[type="checkbox"]');
  await expect(consentBox).not.toBeChecked(); // never pre-checked
  // Consent button disabled until the box is checked.
  await expect(page.getByRole("button", { name: /I consent/ })).toBeDisabled();
  await consentBox.check();
  await page.getByRole("button", { name: /I consent/ }).click();

  await expect(page.getByRole("heading", { name: "Camera check" })).toBeVisible();
  await page.getByRole("button", { name: "Test my camera" }).click();
  await page.getByRole("button", { name: /Camera looks good/ }).click();

  await expect(page.getByRole("heading", { name: "Your Record ID" })).toBeVisible();
  const recordId = await page.locator("p.font-mono").first().textContent();
  expect(recordId).toMatch(/^FW-\d{4}-[A-Z]{2}$/);
  await page.getByRole("button", { name: /saved my Record ID/ }).click();

  await expect(page.getByRole("heading", { name: "How the assessment works" })).toBeVisible();
  await page.getByRole("button", { name: "Begin Assessment" }).click();

  // ---- Recording indicator ----------------------------------------------------
  await expect(page.getByText("Recording", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // ---- Section 1: behavioral (untimed, Likert pages) ---------------------------
  await startCurrentSection(page);
  await completeLikertSection(page);

  // ---- Section 2: mechanical interest ------------------------------------------
  await startCurrentSection(page);
  await completeLikertSection(page);

  // ---- Section 3: Mental Acuity (timed) — includes a refresh mid-section -------
  await startCurrentSection(page);
  const timer = page.locator("div.font-mono").first();
  await expect(timer).toBeVisible();
  const before = await timer.textContent();
  const [bm, bs] = before!.split(":").map(Number);
  const beforeSeconds = bm * 60 + bs;

  await page.reload(); // refresh must NOT reset the server-authoritative timer
  await expect(page.locator("div.font-mono").first()).toBeVisible({
    timeout: 20_000,
  });
  const after = await page.locator("div.font-mono").first().textContent();
  const [am, as] = after!.split(":").map(Number);
  const afterSeconds = am * 60 + as;
  expect(afterSeconds).toBeLessThanOrEqual(beforeSeconds);

  await completeSequentialSection(page);

  // ---- Remaining timed sections --------------------------------------------------
  for (let s = 0; s < 4; s++) {
    await startCurrentSection(page);
    await completeSequentialSection(page);
  }

  // ---- Completion -----------------------------------------------------------------
  await expect(page.getByRole("heading", { name: "Assessment Complete" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByText(/submitted successfully/),
  ).toBeVisible();

  // ---- Server state: scored, reported, recording finalized --------------------------
  const attempt = await db().attempt.findFirstOrThrow({
    where: { candidate: { email: CANDIDATE.email } },
    orderBy: { createdAt: "desc" },
    include: { scores: true, reports: true, recordings: { include: { chunks: true } } },
  });
  expect(attempt.status).toBe("COMPLETED");
  expect(attempt.scores.length).toBeGreaterThanOrEqual(18);
  expect(attempt.reports.some((r) => r.status === "READY")).toBe(true);
  expect(attempt.recordings.length).toBeGreaterThan(0);
  const uploaded = attempt.recordings.flatMap((r) =>
    r.chunks.filter((c) => c.status === "UPLOADED"),
  );
  expect(uploaded.length).toBeGreaterThan(0);

  // ---- Admin sees the completed candidate and the report --------------------------
  const reportRes = await hr.get(`/admin/candidates/${attempt.id}/report`);
  expect(reportRes.ok()).toBe(true);
  const html = await reportRes.text();
  expect(html).toContain("FSW WorkFit Assessment Report");
  expect(html).toContain("Targeted Interview Guide");
  expect(html).toContain("Sales Traits Analysis");

  // ---- One-page manager brief renders from the same report ------------------------
  const briefRes = await hr.get(`/admin/candidates/${attempt.id}/report/brief`);
  expect(briefRes.ok()).toBe(true);
  const briefHtml = await briefRes.text();
  expect(briefHtml).toContain("Hiring manager brief");
  expect(briefHtml).toContain("required dimensions fall inside this role");
  // The brief must never turn the count into a decision.
  expect(briefHtml).not.toMatch(/\brecommend hiring\b|\bdo not hire\b|\bpass\/fail\b/i);
});

test("the candidate summary carries no scores, benchmarks, or validity data", async ({
  page,
  baseURL,
}) => {
  await db().orgSettings.update({
    where: { id: "org" },
    data: { candidateFeedbackEnabled: true },
  });
  const attempt = await db().attempt.findFirstOrThrow({
    where: { status: "COMPLETED", reports: { some: { status: "READY" } } },
    orderBy: { createdAt: "desc" },
  });

  // Mint the candidate's own resume token and open their session with it —
  // the same credential their browser holds after submitting. Admins cannot
  // issue a resume link for a completed attempt, so the test does it directly.
  const token = `e2e-summary-${randomUUID()}`;
  await db().attempt.update({
    where: { id: attempt.id },
    data: { resumeTokenHash: createHash("sha256").update(token).digest("hex") },
  });

  await page.goto(`${baseURL}/assessment/resume/${token}`);
  await page.getByRole("button", { name: /View my summary/i }).click();
  await expect(page.getByText(/Thanks for completing this/)).toBeVisible({
    timeout: 20_000,
  });

  const text = await page.locator("body").innerText();
  expect(text).toContain("There are no pass or fail results.");
  // None of the employer-only material may appear. Phrases, not bare words:
  // the development advice legitimately says things like "benchmark peer",
  // and flagging that would be a false positive, not a leak.
  for (const forbidden of [
    "Distortion",
    "Equivocation",
    "Areas of Concern",
    "target range",
    "desired range",
    "within range",
    "below the range",
    "above the range",
    "stanine",
    "response quality",
    "integrity log",
    "decision-support",
  ]) {
    expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
  // No 1-9 band presented as a score.
  expect(text).not.toMatch(/\bBand [1-9]\b/);
});

test("an invalid assessment link shows a plain-English error", async ({ page }) => {
  await page.goto("/assessment/not-a-real-token-aaaaaaaaaaaaaaaa");
  await expect(
    page.getByText(/not valid|hit a problem/i).first(),
  ).toBeVisible();
});
