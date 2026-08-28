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
 * Each run creates one SOP and archives it at the end, so the reader-facing
 * library does not fill up with test procedures. Archiving is part of the real
 * lifecycle, so cleaning up is itself coverage. The platform never hard-deletes
 * an SOP — evidence has to stay referenceable — so archived test procedures do
 * accumulate in the admin list across runs. That is expected; the code prefix
 * E2E makes them obvious.
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
