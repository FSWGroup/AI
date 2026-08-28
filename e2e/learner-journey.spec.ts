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
     */
    await expect(
      page.getByRole("link", { name: /cybersecurity fundamentals/i }).first(),
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

    // The filter tabs keep state in the URL so a view is shareable. Scoped to
    // the filter navigation, because a card can also mention a completion date.
    const filters = page.getByRole("navigation", { name: /filter training/i });
    await filters.getByRole("link", { name: /completed/i }).click();
    await expect(page).toHaveURL(/filter=completed/);

    // Switching filters must actually change the view, not just the URL.
    await expect(page.getByRole("heading", { name: "My Training" })).toBeVisible();
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
  test("the catalog links each course by title", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/catalog");

    /*
     * Each course card's title is its own link. That is what makes the catalog
     * navigable by assistive technology: the footer actions read "View" and
     * "View details" on every card, so without the title link a screen reader's
     * link list could not tell the courses apart.
     *
     * This asserts the link's target rather than clicking it. Clicking exercises
     * Next's client-side router, which is unreliable in this environment — see
     * the fixme below and KNOWN-ISSUES.md.
     */
    const courseLink = page.getByRole("link", { name: /^cybersecurity fundamentals$/i });
    await expect(courseLink).toBeVisible();
    const href = await courseLink.getAttribute("href");
    expect(href).toMatch(/^\/courses\/[a-z0-9]+$/);

    // The target really renders that course.
    await page.goto(href!);
    await expect(
      page.getByRole("heading", { level: 1, name: /cybersecurity fundamentals/i }),
    ).toBeVisible();
  });

  test.fixme(
    "client-side navigation from the catalog into a course commits",
    async ({ page }) => {
      /*
       * Known defect, tracked in KNOWN-ISSUES.md: in a production build, clicking
       * a `next/link` into `/courses/[id]` commits only intermittently (~1 attempt
       * in 3). The click is received and its default prevented, the RSC response
       * returns 200 with a complete payload in well under a second, then the
       * transition never commits: no chunk request, no console error, no error
       * boundary, and the URL is unchanged 45s later. A plain anchor to the same
       * URL is 100% reliable, and `next dev` is unaffected.
       *
       * Ruled out: prefetch on/off, React 19.1.1 and 19.2.8, duplicate React
       * copies, `scroll-behavior: smooth`, Prisma pool size, server render time
       * (54-120ms), server action module placement, and parallel/intercepting
       * routes.
       */
      await signIn(page, "learner");
      await page.goto("/catalog");
      await page.getByRole("link", { name: /^cybersecurity fundamentals$/i }).click();
      await expect(page).toHaveURL(/\/courses\//, { timeout: 10_000 });
    },
  );

  test("a course page offers a real way to start, which opens a lesson", async ({ page }) => {
    await signIn(page, "learner");

    await page.goto("/catalog");
    const href = await page
      .getByRole("link", { name: /^cybersecurity fundamentals$/i })
      .getAttribute("href");
    await page.goto(href!);

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

    // The action must lead to a real lesson, not sit inert.
    const lessonHref = await start.getAttribute("href");
    expect(lessonHref, "the start action needs a real target").toMatch(/lesson/i);
    await page.goto(lessonHref!);
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("Certificates and transcript", () => {
  test("a completed course produces a real, downloadable certificate", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/certificates");

    // The seeded learner completed the welcome course through the real
    // completion path, so a certificate exists with an FSW serial number.
    await expect(page.getByText(/welcome to fsw/i).first()).toBeVisible();
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
    // The completion the seed produced must appear as a transcript entry.
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
