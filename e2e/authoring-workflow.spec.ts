import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * The authoring workflow — the product's central claim.
 *
 * "Write a procedure once, then turn it into training" only holds if an author
 * can actually get from a blank form to a published, readable, versioned SOP
 * through the real UI. The rest of the suite exercises the seeded content;
 * these tests create it, which is what catches a broken editor, a publish path
 * that silently fails, or a draft that never reaches readers.
 *
 * Each test archives what it created, so the reader-facing library and catalog
 * stay clean. Archiving is part of the real lifecycle, so cleaning up is itself
 * coverage. Nothing here hard-deletes: evidence has to stay referenceable, so
 * archived test content accumulates in the admin lists across runs, and a run
 * that fails midway can leave a draft behind. Everything is prefixed E2E so it
 * is obvious, and this suite is why E2E should eventually run against a
 * disposable database rather than the seeded development one.
 */

/** Unique per run, so a failed run's leftovers can never be mistaken for this one's. */
function uniqueSuffix(): string {
  return Date.now().toString(36).slice(-5).toUpperCase();
}

test.describe("Authoring an SOP end to end", () => {
  test("an author can create, fill, publish and archive a procedure", async ({ page }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Safe Handling of Test Valves ${suffix}`;

    await signIn(page, "trainingAdmin");
    await page.goto("/admin/sops/new");

    // --- Identity -------------------------------------------------------
    await page.locator("#sop-code-prefix").fill("E2E");
    await page.locator("#sop-title").fill(title);
    await page
      .locator("#sop-summary")
      .fill("Created by the end-to-end suite to prove the authoring path works.");
    await page.locator("#sop-category").fill("Testing");

    // --- Content --------------------------------------------------------
    // An empty SOP must not be publishable, so the editor has to accept a block.
    await page.getByRole("button", { name: /add your first block|add block/i }).first().click();
    await page.getByRole("menuitem", { name: /^paragraph$/i }).click();

    const paragraph = page.getByRole("textbox").filter({ hasNot: page.locator("#sop-title") }).last();
    await paragraph.fill(
      "Close the upstream isolation valve, confirm zero pressure at the gauge, then tag the line before any work begins.",
    );

    // --- Create ---------------------------------------------------------
    await page.getByRole("button", { name: /^create sop$/i }).click();

    // Landing on the edit route is what proves the draft was really written.
    await expect(page).toHaveURL(/\/admin\/sops\/[a-z0-9]+\/edit/, { timeout: 20_000 });
    const editUrl = page.url();
    const sopId = editUrl.match(/\/admin\/sops\/([a-z0-9]+)\/edit/)?.[1];
    expect(sopId, "the new SOP should have an id in the URL").toBeTruthy();

    // --- Publish --------------------------------------------------------
    await page.getByRole("button", { name: /^publish$/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const summaryField = dialog.getByRole("textbox").first();
    if (await summaryField.count()) {
      await summaryField.fill("First published version.");
    }
    await dialog.getByRole("button", { name: /^publish/i }).click();

    /*
     * Wait for a signal that only appears once the server action has finished:
     * the confirmation names the version it created. A looser check like
     * /published/i matches static labels already on the page, which let this
     * test run ahead of the publish and then look for the SOP in the library
     * before it was there.
     */
    await expect(page.getByText(/published as v1\.0/i)).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toHaveCount(0);

    // --- A reader can find and read it ----------------------------------
    await page.goto("/sops");
    const libraryLink = page.getByRole("link", { name: new RegExp(title, "i") });
    await expect(libraryLink, "a published SOP must appear in the library").toBeVisible();
    await libraryLink.click();

    await expect(page.getByRole("heading", { level: 1, name: new RegExp(title, "i") })).toBeVisible();
    // The body the author typed must actually render for the reader.
    await expect(page.getByText(/tag the line before any work begins/i)).toBeVisible();

    // --- Versioning -----------------------------------------------------
    await page.goto(`/sops/${sopId}/versions`);
    await expect(page.getByText(/1\.0/).first()).toBeVisible();

    // --- Archive, which also cleans up ----------------------------------
    await page.goto("/admin/sops");
    await page.getByRole("checkbox", { name: `Select ${title}` }).check();
    await page.getByRole("button", { name: /archive selected/i }).click();

    const archiveDialog = page.getByRole("dialog");
    await expect(archiveDialog).toBeVisible();
    await archiveDialog.getByRole("button", { name: /archive/i }).last().click();

    // An archived SOP must leave the reader-facing library.
    await page.goto("/sops");
    await expect(page.getByRole("link", { name: new RegExp(title, "i") })).toHaveCount(0);
  });

  test("an empty SOP cannot be published", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/sops/new");

    // With no title and no content, creation must stay disabled — the guard
    // that stops an empty procedure reaching readers.
    await expect(page.getByRole("button", { name: /^create sop$/i })).toBeDisabled();
  });

  test("an author without publish rights is offered review, not publish", async ({ page }) => {
    // The content author can write but not approve their own work.
    await signIn(page, "author");
    await page.goto("/admin/sops/new");

    await expect(page.locator("#sop-title")).toBeVisible();
    // Publishing is a separate capability; the create screen must not offer it.
    await expect(page.getByRole("button", { name: /^publish$/i })).toHaveCount(0);
  });
});

test.describe("Building a course", () => {
  test("an author can create a course, add a section and a lesson, and publish it", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const title = `E2E Valve Isolation Basics ${suffix}`;

    await signIn(page, "trainingAdmin");
    await page.goto("/admin/training/new");

    await page.locator("#title").fill(title);
    await page.locator("#description").fill("Created by the end-to-end suite.");
    await page.locator("#category").fill("Testing");
    await page.getByRole("button", { name: /^create course$/i }).click();

    // The builder is where authoring happens, so landing there is the real signal.
    await expect(page).toHaveURL(/\/admin\/training\/[a-z0-9]+\/edit/, { timeout: 20_000 });

    /*
     * Sections and lessons are named through the application's own dialog. This
     * used to be `window.prompt`, which Playwright dismisses by default — so the
     * whole flow was untestable, and in any embedded context it silently did
     * nothing at all.
     */
    await page.getByRole("button", { name: /^add section$/i }).click();
    const sectionDialog = page.getByRole("dialog");
    await expect(sectionDialog).toBeVisible();
    await sectionDialog.getByLabel(/section title/i).fill("Before you start");
    await sectionDialog.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByText("Before you start")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /^add lesson$/i }).first().click();
    const lessonDialog = page.getByRole("dialog");
    await expect(lessonDialog).toBeVisible();
    await lessonDialog.getByLabel(/lesson title/i).fill("Confirming zero pressure");
    await lessonDialog.getByRole("button", { name: /^add$/i }).click();
    await expect(page.getByText("Confirming zero pressure")).toBeVisible({ timeout: 15_000 });

    // --- Publish --------------------------------------------------------
    await page.getByRole("button", { name: /^publish$/i }).click();
    await page.getByPlaceholder(/what changed/i).fill("First version.");
    await page.getByRole("button", { name: /^confirm publish$/i }).click();
    await expect(page.getByText(/course published/i)).toBeVisible({ timeout: 20_000 });

    /*
     * A published course must reach the catalog, where a learner can find it.
     * Exact match: each card carries both a title link and a "View details for
     * <title>" action, so a substring pattern matches two elements.
     */
    await page.goto("/catalog");
    await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();

    // Archive it so the catalog does not accumulate test courses.
    await page.goto("/admin/training");
    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /archive course/i }).click();
    await expect(page.getByText(/course archived/i)).toBeVisible({ timeout: 20_000 });

    await page.goto("/catalog");
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  });

  test("deleting a section asks first, in the application's own dialog", async ({ page }) => {
    await signIn(page, "trainingAdmin");
    await page.goto("/admin/training");

    // Any seeded course will do; this is about the confirmation, not the course.
    await page.getByRole("link", { name: /welcome to fsw/i }).first().click();
    await expect(page).toHaveURL(/\/admin\/training\/[a-z0-9]+/, { timeout: 20_000 });

    const trigger = page.getByRole("button", { name: /delete section/i }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    // A destructive action must confirm, and cancelling must change nothing.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/every lesson inside it is deleted too/i)).toBeVisible();
    await dialog.getByRole("button", { name: /^cancel$/i }).click();
    await expect(dialog).toHaveCount(0);
  });
});
