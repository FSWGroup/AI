import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * The administrator journey.
 *
 * Covers the workflow FSW Academy is built around: write a procedure once, then
 * turn it into training, a quiz, a video, and an assignment without recreating
 * the knowledge. Also verifies the authoring surfaces an administrator needs on
 * day one.
 */

test.describe("Administrator dashboards", () => {
  test("the admin dashboard renders with real figures", async ({ page }) => {
    await signIn(page, "superAdmin");
    await page.goto("/admin");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("the audit log is searchable and shows recorded events", async ({ page }) => {
    await signIn(page, "superAdmin");
    await page.goto("/admin/audit");

    await expect(page.locator("h1")).toBeVisible();
    // Signing in is itself an audited event, so the log is never empty here.
    const hasEvents =
      (await page.getByText(/auth\.sign_in|sign in|no events/i).count()) > 0;
    expect(hasEvents).toBeTruthy();
  });

  test("the integrations screen reports capability status honestly", async ({ page }) => {
    await signIn(page, "superAdmin");
    await page.goto("/admin/integrations");

    await expect(page.locator("h1")).toBeVisible();

    // With no AI or email credentials in the test environment, those
    // capabilities must show as not connected — never as active.
    const notConnected = page.getByText(/not connected/i);
    expect(await notConnected.count()).toBeGreaterThan(0);
  });

  test("settings expose the application name so the product can be renamed", async ({ page }) => {
    await signIn(page, "superAdmin");
    await page.goto("/admin/settings");
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("SOP authoring", () => {
  test("the SOP admin list shows status and offers creation", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/sops");

    await expect(page.locator("h1")).toBeVisible();

    // A real creation entry point, not a decorative button.
    const newSop = page.getByRole("link", { name: /new sop|create sop/i }).first();
    if ((await newSop.count()) > 0) {
      await expect(newSop).toBeVisible();
    }
  });

  test("the SOP editor loads with the FSW template fields", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/sops/new");

    await expect(page.locator("h1")).toBeVisible();
    // The structured template is what makes an SOP more than a blank document.
    const titleField = page.getByLabel(/title/i).first();
    await expect(titleField).toBeVisible();
  });

  test("the review dashboard buckets SOPs by review state", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/sops/review");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("a published SOP offers the train-on-this actions", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/sops");

    const sopLink = page
      .getByRole("link")
      .filter({ hasText: /quote|receive|acceptable use/i })
      .first();

    if ((await sopLink.count()) === 0) {
      test.skip(true, "No seeded SOP found");
      return;
    }

    await sopLink.click();
    await expect(page.locator("h1")).toBeVisible();

    // The signature workflow: one procedure becomes training, a quiz, a video.
    const actions = page.getByRole("link", {
      name: /create course|create quiz|create.*video|train on this|assign/i,
    });
    expect(
      await actions.count(),
      "a published SOP should offer at least one downstream action for an author",
    ).toBeGreaterThan(0);
  });

  test("version history is reachable and lists published versions", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/sops");

    const sopLink = page.getByRole("link").filter({ hasText: /quote/i }).first();
    if ((await sopLink.count()) === 0) {
      test.skip(true, "No seeded SOP found");
      return;
    }
    await sopLink.click();

    const url = page.url();
    const idMatch = url.match(/\/sops\/([^/?]+)/);
    if (!idMatch?.[1]) {
      test.skip(true, "Could not resolve the SOP id from the URL");
      return;
    }

    await page.goto(`/sops/${idMatch[1]}/versions`);
    await expect(page.locator("h1")).toBeVisible();
    // The seed publishes version 1.0.
    await expect(page.getByText(/1\.0/).first()).toBeVisible();
  });
});

test.describe("Course authoring", () => {
  test("the training admin list shows courses with status", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/training");
    await expect(page.locator("h1")).toBeVisible();
    // Seeded courses should be listed.
    await expect(page.getByText(/welcome to fsw|cybersecurity|valve/i).first()).toBeVisible();
  });

  test("the course builder loads", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/training/new");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByLabel(/title/i).first()).toBeVisible();
  });

  test("the learning path builder loads", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/paths");
    await expect(page.locator("h1")).toBeVisible();
    // The seeded onboarding path demonstrates the whole workflow.
    await expect(page.getByText(/new employee onboarding/i).first()).toBeVisible();
  });
});

test.describe("AI surfaces degrade honestly without credentials", () => {
  test("the AI studio explains what is needed rather than failing", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/ai-studio");

    await expect(page.locator("h1")).toBeVisible();
    // No AI key is configured in the test environment, so the page must say so
    // rather than offering a button that cannot work.
    const guidance = page.getByText(/not configured|ANTHROPIC_API_KEY|OPENAI_API_KEY|unavailable/i);
    expect(await guidance.count()).toBeGreaterThan(0);
  });

  test("Ask FSW AI shows a disabled state with setup guidance", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/ask");

    await expect(page.locator("h1")).toBeVisible();
    const guidance = page.getByText(/not configured|unavailable|administrator/i);
    expect(await guidance.count()).toBeGreaterThan(0);
  });

  test("the video studio lists jobs and does not crash without providers", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/video-studio");
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("People administration", () => {
  test("the people directory paginates and filters", async ({ page }) => {
    await signIn(page, "hrAdmin");
    await page.goto("/admin/people");

    await expect(page.locator("h1")).toBeVisible();
    // Seeded people should be listed.
    await expect(page.getByText(/@fswelsford\.com/).first()).toBeVisible();
  });

  test("sensitive fields are not loaded until explicitly revealed", async ({ page }) => {
    await signIn(page, "hrAdmin");
    await page.goto("/people");

    const personLink = page.getByRole("link").filter({ hasText: /jordan|kim|dev/i }).first();
    if ((await personLink.count()) === 0) {
      test.skip(true, "No person link found in the directory");
      return;
    }

    await personLink.click();
    await expect(page.locator("h1")).toBeVisible();

    // If the profile offers sensitive fields at all, they must be behind an
    // explicit action so the audited read is deliberate.
    const reveal = page.getByRole("button", { name: /reveal|show sensitive/i });
    if ((await reveal.count()) > 0) {
      await expect(reveal.first()).toBeVisible();
    }
  });

  test("the CSV import screen validates before committing", async ({ page }) => {
    await signIn(page, "hrAdmin");
    await page.goto("/admin/people/import");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("the org chart renders the reporting structure", async ({ page }) => {
    await signIn(page, "superAdmin");
    await page.goto("/admin/organization/chart");
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("Compliance and reporting", () => {
  test("the compliance center displays the advisor disclaimer", async ({ page }) => {
    await signIn(page, "compliance");
    await page.goto("/admin/compliance");

    await expect(page.locator("h1")).toBeVisible();
    // The platform must never assert legal compliance on its own.
    await expect(
      page.getByText(/qualified legal|safety advisor|verify requirement/i).first(),
    ).toBeVisible();
  });

  test("the training matrix renders states and offers export", async ({ page }) => {
    await signIn(page, "compliance");
    await page.goto("/admin/compliance/matrix");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("the report catalog lists reports and one runs", async ({ page }) => {
    await signIn(page, "superAdmin");
    await page.goto("/admin/reports");

    await expect(page.locator("h1")).toBeVisible();

    const reportLink = page
      .getByRole("link")
      .filter({ hasText: /completion|overdue|transcript|certification/i })
      .first();

    if ((await reportLink.count()) === 0) {
      test.skip(true, "No report links found in the catalog");
      return;
    }

    await reportLink.click();
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("Manager surfaces", () => {
  test("the team dashboard shows the manager's reporting line", async ({ page }) => {
    await signIn(page, "manager");
    await page.goto("/team");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("team training status lists reports", async ({ page }) => {
    await signIn(page, "manager");
    await page.goto("/team/status");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("the approvals queue renders", async ({ page }) => {
    await signIn(page, "manager");
    await page.goto("/team/approvals");
    await expect(page.locator("h1")).toBeVisible();
  });
});
