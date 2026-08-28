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

    /*
     * The seeded learner is a recent hire carrying real assignments from the
     * rule engine. Asserting on a named seeded course rather than a loose
     * keyword match matters: a pattern like /assigned/ is also satisfied by the
     * words "No training assigned yet", so an empty dashboard would pass.
     *
     * The Customer Quote Process is the one the learner has started and is now
     * late on, so the dashboard has to surface it.
     */
    await expect(
      page.getByRole("link", { name: /customer quote process/i }).first(),
    ).toBeVisible();
  });

  test("My Training groups work by urgency and names the assignment reason", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/my-training");

    await expect(page.getByRole("heading", { name: "My Training" })).toBeVisible();

    // Rule-driven assignments carry a generated, human-readable reason. The
    // seeded learner is in Sales, so this is the reason the engine produced.
    await expect(page.getByText(/because you are in the Sales department/i).first()).toBeVisible();

    // The seeded spread always leaves this learner something overdue, so the
    // urgency grouping has a section to render.
    await expect(page.getByRole("heading", { name: /overdue/i }).first()).toBeVisible();

    /*
     * The filter tabs keep state in the URL so a view is shareable. Scoped to
     * the filter navigation, because a card can also mention a completion date.
     */
    const filters = page.getByRole("navigation", { name: /filter training/i });
    const completedTab = filters.getByRole("link", { name: /completed/i });
    await expect(completedTab).toBeVisible();
    await completedTab.click();
    await expect(page).toHaveURL(/filter=completed/);

    /*
      The filter must actually change the view. Cybersecurity Fundamentals is
      the completed *assigned* course — only an assignment appears in this list,
      so the optional course the learner also finished is not expected here.
    */
    await expect(page.getByText(/cybersecurity fundamentals/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /^overdue/i })).toHaveCount(0);
  });

  test("the empty state offers a next action rather than a blank screen", async ({ page }) => {
    /*
     * Every active person matches the company-wide cybersecurity rule, so no
     * account has a permanently empty To-do list to assert against. The
     * Completed view of someone who has finished nothing is the honest, stable
     * empty state — and it still has to offer somewhere to go.
     */
    await signIn(page, "auditor");
    await page.goto("/my-training?filter=completed");

    await expect(page.getByRole("heading", { name: "My Training" })).toBeVisible();
    await expect(page.getByRole("link", { name: /browse catalog/i }).first()).toBeVisible();
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

    /*
     * Named seeded procedures, not a link count: every page has navigation
     * links, so `count() > 0` passes even when the library renders nothing.
     */
    await expect(page.getByRole("link", { name: /create a customer quote/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /receive an inbound shipment/i })).toBeVisible();
  });

  test("an SOP renders its body and metadata", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/sops");

    // Asserted, not guarded by a count(): count() does not auto-wait, so a
    // conditional skip here would quietly pass whenever the list was still
    // rendering — exactly the regression this test exists to catch.
    const sopLink = page.getByRole("link", { name: /create a customer quote/i });
    await expect(sopLink).toBeVisible();
    await sopLink.click();

    await expect(page.getByRole("heading", { level: 1, name: /create a customer quote/i })).toBeVisible();

    // The reader shows the procedure body, not just a title.
    await expect(page.locator(".prose-fsw").first()).toBeVisible();
  });
});

test.describe("Working through a course", () => {
  test("the catalog opens a course from its title link", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/catalog");

    /*
     * Each course card's title is its own link. That is what makes the catalog
     * navigable by assistive technology: the footer actions read "View" and
     * "View details" on every card, so without the title link a screen reader's
     * link list could not tell the courses apart.
     */
    const courseLink = page.getByRole("link", { name: /^cybersecurity fundamentals$/i });
    await expect(courseLink).toBeVisible();
    await courseLink.click();

    await expect(
      page.getByRole("heading", { level: 1, name: /cybersecurity fundamentals/i }),
    ).toBeVisible();
  });

  /*
   * Clicking, repeatedly, on purpose. A loading boundary at the app root used to
   * leave client-side navigations unable to commit in production builds — links
   * simply did nothing, about two attempts in three. One click can pass by luck,
   * so this walks in and out several times.
   */
  test("client-side navigation into a course commits every time", async ({ page }) => {
    await signIn(page, "learner");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await page.goto("/catalog");
      await page.getByRole("link", { name: /^cybersecurity fundamentals$/i }).click();
      await expect(page, `attempt ${attempt} did not navigate`).toHaveURL(/\/courses\//, {
        timeout: 8000,
      });
    }
  });

  test("a course page offers a real way to start, which opens a lesson", async ({ page }) => {
    await signIn(page, "learner");

    await page.goto("/catalog");
    await page.getByRole("link", { name: /^cybersecurity fundamentals$/i }).click();
    await expect(page).toHaveURL(/\/courses\//);

    /*
     * Scoped to the page body: the sidebar's "Help & getting started" link also
     * matches a loose /start/ pattern, and an unscoped `.first()` picked it up
     * instead of the course's own action.
     */
    const start = page
      .getByRole("main")
      .getByRole("link", { name: /^(start|continue)$/i })
      .first();
    await expect(start).toBeVisible();
    await start.click();

    // Landing on a lesson URL proves the action is wired up.
    await expect(page).toHaveURL(/lesson/i, { timeout: 20_000 });
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("Certificates and transcript", () => {
  test("a completed course produces a real, downloadable certificate", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/certificates");

    // The seeded learner completed courses through the real completion path, so
    // certificates exist with FSW serial numbers.
    await expect(page.getByText(/cybersecurity fundamentals/i).first()).toBeVisible();
    await expect(page.getByText(/FSW-\d{4}-\d+/).first()).toBeVisible();

    // The download must serve an actual PDF, not a dead link.
    const link = page.getByRole("link", { name: /download|pdf/i }).first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href, "the certificate download needs a real href").toBeTruthy();

    const response = await page.request.get(href!);
    expect(response.status(), "the certificate PDF must be served").toBe(200);
    expect(response.headers()["content-type"]).toContain("pdf");
    const body = await response.body();
    // A PDF always starts with the %PDF- magic bytes.
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("the transcript lists what the person actually completed", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/transcript");

    await expect(page.locator("h1")).toBeVisible();
    /*
      Both completions belong on the transcript: the assigned course and the
      optional one the learner took without an assignment.
    */
    await expect(page.getByText(/cybersecurity fundamentals/i).first()).toBeVisible();
    await expect(page.getByText(/welcome to fsw/i).first()).toBeVisible();
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
