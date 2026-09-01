/**
 * The recruiting spine, end to end: a role is published to the feed and the
 * careers page, a stranger applies, and the application lands attributed in
 * the pipeline.
 */

import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { adminApi, db } from "./helpers";

test("an open role reaches the job feed and the careers page", async ({ request }) => {
  const requisition = await db().requisition.findFirstOrThrow({
    where: { status: "OPEN" },
  });

  const feed = await request.get("/api/feeds/jobs.xml");
  expect(feed.ok()).toBe(true);
  expect(feed.headers()["content-type"]).toContain("xml");
  const xml = await feed.text();
  expect(xml).toContain("<source>");
  expect(xml).toContain(requisition.reference);
  expect(xml).toContain("<jobtype>");
  // The apply URL must carry a source so the board's traffic is attributable.
  expect(xml).toMatch(/careers\/[A-Z0-9-]+\?src=indeed/);

  const page = await request.get(`/careers/${requisition.reference}`);
  expect(page.ok()).toBe(true);
  const html = await page.text();
  expect(html).toContain("application/ld+json");
  expect(html).toContain("JobPosting");
});

test("a closed role disappears from the feed and the careers page", async ({
  request,
}) => {
  const requisition = await db().requisition.create({
    data: {
      reference: `REQ-E2E${randomUUID().slice(0, 4).toUpperCase()}`,
      title: "Temporary E2E Role",
      status: "OPEN",
      openedAt: new Date(),
    },
  });
  try {
    let xml = await (await request.get("/api/feeds/jobs.xml")).text();
    expect(xml).toContain(requisition.reference);

    await db().requisition.update({
      where: { id: requisition.id },
      data: { status: "CLOSED" },
    });

    xml = await (await request.get("/api/feeds/jobs.xml")).text();
    expect(xml).not.toContain(requisition.reference);
    // A closed role must not stay reachable from a search-engine cache either.
    const page = await request.get(`/careers/${requisition.reference}`);
    expect(page.status()).toBe(404);
  } finally {
    await db().requisition.delete({ where: { id: requisition.id } });
  }
});

test("a candidate applies and the application lands attributed in the pipeline", async ({
  page,
  baseURL,
}) => {
  const requisition = await db().requisition.findFirstOrThrow({
    where: { status: "OPEN", screeningQuestions: { some: {} } },
    include: { screeningQuestions: { orderBy: { orderIndex: "asc" } } },
  });
  const email = `e2e-${randomUUID()}@example.invalid`;

  await page.goto(`${baseURL}/careers/${requisition.reference}?src=jobstreet_ph`);
  await page.fill("#firstName", "Elena");
  await page.fill("#lastName", "Bautista");
  await page.fill("#email", email);
  await page.fill("#phone", "0917 555 0100");

  for (const q of requisition.screeningQuestions) {
    const field = page.locator(`#q-${q.id}`);
    if (q.kind === "NUMBER") await field.fill("5");
    else if (q.kind === "YES_NO") await field.selectOption("Yes");
    else if (q.kind === "LONG_TEXT" || q.kind === "SHORT_TEXT")
      await field.fill("Because the work is interesting.");
  }

  await page.getByRole("button", { name: /Submit application/ }).click();
  await expect(page.getByText(/Application received/)).toBeVisible({ timeout: 20_000 });

  const application = await db().application.findFirstOrThrow({
    where: { candidate: { email } },
    include: {
      candidate: true,
      channel: true,
      stage: true,
      screeningAnswers: true,
      stageEvents: true,
    },
  });
  expect(application.channel?.key).toBe("jobstreet_ph");
  expect(application.stage?.kind).toBe("APPLIED");
  expect(application.knockedOut).toBe(false);
  expect(application.screeningAnswers.length).toBe(requisition.screeningQuestions.length);
  // The first stage event is what every funnel number is later computed from.
  expect(application.stageEvents.length).toBeGreaterThan(0);

  const hr = await adminApi(baseURL!, "hr@fsw.local");
  const board = await hr.get(
    `/admin/recruiting/requisitions/${requisition.id}?tab=pipeline`,
  );
  expect(board.ok()).toBe(true);
  expect(await board.text()).toContain("Elena Bautista");
});

test("a knockout answer flags for review without rejecting anyone", async ({
  request,
}) => {
  const requisition = await db().requisition.findFirstOrThrow({
    where: {
      status: "OPEN",
      screeningQuestions: { some: { knockout: true, knockoutOperator: "MIN" } },
    },
    include: { screeningQuestions: true },
  });
  const channel = await db().sourceChannel.findFirstOrThrow({ where: { key: "indeed" } });
  const token = `e2e-${randomUUID()}`;
  await db().sourceChannel.update({
    where: { id: channel.id },
    data: { tokenHash: createHash("sha256").update(token).digest("hex") },
  });

  const minQuestion = requisition.screeningQuestions.find(
    (q) => q.knockout && q.knockoutOperator === "MIN",
  )!;
  const email = `e2e-ko-${randomUUID()}@example.invalid`;

  const res = await request.post("/api/inbound/applications", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      jobReference: requisition.reference,
      applicant: {
        firstName: "Paolo",
        lastName: "Reyes",
        email,
        phone: "0918 555 0100",
      },
      answers: [{ prompt: minQuestion.prompt, answer: "0" }],
    },
  });
  expect(res.ok()).toBe(true);
  expect((await res.json()).flaggedForReview).toBe(true);

  const application = await db().application.findFirstOrThrow({
    where: { candidate: { email } },
  });
  // Flagged, but still active and still in the pipeline. Nobody is
  // auto-rejected by a questionnaire answer.
  expect(application.knockedOut).toBe(true);
  expect(application.status).toBe("ACTIVE");
  expect(application.rejectedAt).toBeNull();
});

test("the inbound API refuses an unknown token", async ({ request }) => {
  const res = await request.post("/api/inbound/applications", {
    headers: { Authorization: "Bearer definitely-not-a-real-token" },
    data: { jobReference: "REQ-ANY" },
  });
  expect(res.status()).toBe(401);
});
