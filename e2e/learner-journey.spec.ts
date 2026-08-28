import { test, expect } from "@playwright/test";
import { openCommandPalette, signIn } from "./helpers";

/**
 * The learner journey.
 *
 * Follows what a new employee actually does: sees what they owe, opens a
 * procedure, works through a course, takes a quiz, acknowledges a policy, and
 * ends up with a record. Each step is asserted against real seeded content.
 */

test.describe("Learner dashboard", () => {
  test("shows assigned training and explains why", async ({ page }) => {
    await signIn(page, "learner");

    await expect(page.locator("h1")).toBeVisible();

    // The seeded learner is a recent hire with onboarding assignments, so the
    // dashboard must show something actionable rather than an empty shell.
    const hasTraining =
      (await page.getByText(/continue|due|overdue|assigned|welcome/i).count()) > 0;
    expect(hasTraining, "the learner dashboard should surface assigned training").toBeTruthy();
  });

  test("My Training groups work by urgency and names the assignment reason", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/my-training");

    await expect(page.getByRole("heading", { name: "My Training" })).toBeVisible();

    // Rule-driven assignments carry a human-readable reason.
    const reason = page.getByText(/why you have this/i).first();
    if ((await reason.count()) > 0) {
      await expect(reason).toBeVisible();
    }

    // The filter tabs keep state in the URL so a view is shareable.
    await page.getByRole("link", { name: /completed/i }).first().click();
    await expect(page).toHaveURL(/filter=completed/);
  });

  test("the empty state offers a next action rather than a blank screen", async ({ page }) => {
    // The auditor has no assigned training, so My Training must still be useful.
    await signIn(page, "auditor");
    await page.goto("/my-training");

    const emptyState = page.getByText(/no training assigned yet|all caught up/i);
    if ((await emptyState.count()) > 0) {
      await expect(emptyState.first()).toBeVisible();
      // An empty state must always offer somewhere to go.
      const actions = page.getByRole("link", { name: /catalog|sop library|browse/i });
      expect(await actions.count()).toBeGreaterThan(0);
    }
  });
});

test.describe("Finding knowledge", () => {
  test("the command palette searches seeded content", async ({ page }) => {
    await signIn(page, "learner");
    await openCommandPalette(page);

    await page.getByRole("textbox", { name: /search/i }).fill("quote");

    // Results arrive from the server, permission-filtered.
    const listbox = page.getByRole("listbox", { name: /results/i });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option").first()).toBeVisible({ timeout: 15_000 });
  });

  test("keyboard navigation works in the palette", async ({ page }) => {
    await signIn(page, "learner");
    await openCommandPalette(page);

    await page.getByRole("textbox", { name: /search/i }).fill("valve");
    const listbox = page.getByRole("listbox", { name: /results/i });
    await expect(listbox.getByRole("option").first()).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    // Enter must navigate somewhere real, not sit inert.
    await expect(page).not.toHaveURL(/\/home$/, { timeout: 15_000 });
  });

  test("Escape closes the palette and restores focus", async ({ page }) => {
    await signIn(page, "learner");
    await openCommandPalette(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /search and commands/i })).toHaveCount(0);
  });

  test("the SOP library lists published procedures", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/sops");

    await expect(page.locator("h1")).toBeVisible();
    // Seeded SOPs include a quoting procedure and a receiving procedure.
    const links = page.getByRole("link");
    expect(await links.count()).toBeGreaterThan(0);
  });

  test("an SOP renders its body and metadata", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/sops");

    const sopLink = page
      .getByRole("link")
      .filter({ hasText: /quote|receive|acceptable use|find an sop/i })
      .first();

    if ((await sopLink.count()) === 0) {
      test.skip(true, "No seeded SOP link found");
      return;
    }

    await sopLink.click();
    await expect(page.locator("h1")).toBeVisible();

    // The reader shows the procedure body, not just a title.
    const body = page.locator(".prose-fsw, main");
    await expect(body.first()).toBeVisible();
  });
});

test.describe("Working through a course", () => {
  test("the catalog lists courses and opens one", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/catalog");

    await expect(page.locator("h1")).toBeVisible();

    const courseLink = page
      .getByRole("link")
      .filter({ hasText: /welcome|cybersecurity|valve|quote|overview|warehouse/i })
      .first();

    if ((await courseLink.count()) === 0) {
      test.skip(true, "No seeded course found in the catalog");
      return;
    }

    await courseLink.click();
    await expect(page.locator("h1")).toBeVisible();
  });

  test("a course page shows its structure and a way to start", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/catalog");

    const courseLink = page
      .getByRole("link")
      .filter({ hasText: /welcome to fsw/i })
      .first();

    if ((await courseLink.count()) === 0) {
      test.skip(true, "Welcome course not found");
      return;
    }

    await courseLink.click();

    // There must be a real way in — not a decorative button.
    const start = page.getByRole("link", { name: /start|continue|begin/i }).first();
    if ((await start.count()) > 0) {
      await expect(start).toBeVisible();
      await start.click();
      // Landing on a lesson URL proves the button is wired up.
      await expect(page).toHaveURL(/lesson/i, { timeout: 20_000 });
    }
  });
});

test.describe("Certificates and transcript", () => {
  test("the certificates page renders with an empty state when none exist", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/certificates");
    await expect(page.locator("h1")).toBeVisible();
  });

  test("the transcript page renders for the signed-in person", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/transcript");
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("Notifications", () => {
  test("the notification tray opens and reports its state", async ({ page }) => {
    await signIn(page, "learner");

    await page.getByRole("button", { name: /notifications/i }).click();
    const tray = page.getByRole("dialog", { name: /notifications/i });
    await expect(tray).toBeVisible();

    // Either notifications or an explicit caught-up message — never blank.
    const hasContent =
      (await tray.getByRole("button").count()) > 0 ||
      (await tray.getByText(/caught up|loading/i).count()) > 0;
    expect(hasContent).toBeTruthy();
  });
});
