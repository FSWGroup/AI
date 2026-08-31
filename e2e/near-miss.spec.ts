import { test, expect } from "@playwright/test";
import { expectForbidden, expectNavItem, expectToast, signIn, signOut } from "./helpers";

/**
 * The near-miss library.
 *
 * The properties worth clicking through are the ones people are trusting when
 * they file a report: an unpublished report is not readable, a published one
 * names nobody, and the reviewer cannot publish something that still does.
 */

test.describe("Reading the library", () => {
  test("lists seeded case studies and opens one in full", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/near-misses");

    await expect(page.getByRole("heading", { level: 1, name: /near-miss library/i })).toBeVisible();

    const list = page.getByRole("list", { name: /near-miss case studies/i });
    const items = list.getByRole("listitem");
    expect(await items.count()).toBeGreaterThan(1);

    // The title is a link, not decoration (WCAG 2.4.4: the name says where it goes).
    const first = page.getByRole("link", { name: /150# flange picked for a 300# service/i });
    await expect(first).toBeVisible();
    await first.click();

    await expect(page.getByRole("heading", { level: 1, name: /150# flange/i })).toBeVisible();
    // The four narrative sections are what make it a case study rather than a log entry.
    await expect(page.getByText(/what happened/i).first()).toBeVisible();
    await expect(page.getByText(/how it was caught/i).first()).toBeVisible();
    await expect(page.getByText(/why it happened/i).first()).toBeVisible();
    await expect(page.getByText(/what changed/i).first()).toBeVisible();
  });

  test("names nobody, and says so", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/near-misses/NM-001");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    /*
     * The property the whole feature rests on, asserted against the delivered
     * markup rather than a rendered region — so a reporter's name reaching the
     * page through any route (a stray select, a serialized prop) fails here.
     *
     * Scoped to the content landmark, because the application shell prints the
     * signed-in person's own name and email in the top bar, which is not a
     * leak. NM-001 was filed by Kim Harlow: that is the name that must be gone.
     */
    const content = (await page.locator("#main-content").innerHTML()).toLowerCase();
    for (const seededName of ["kim harlow", "jordan pace", "dev singh", "fswelsford.com"]) {
      expect(content, `a published case study must not carry "${seededName}"`).not.toContain(
        seededName,
      );
    }

    await expect(page.getByText(/nobody is named in this record/i)).toBeVisible();
    await expect(page.getByText(/not recorded in the published case study/i)).toBeVisible();
  });

  test("filters by kind and clears back to everything", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/near-misses");

    const all = await page
      .getByRole("list", { name: /near-miss case studies/i })
      .getByRole("listitem")
      .count();

    await page.getByLabel(/^kind$/i).selectOption("WAREHOUSE_SAFETY");
    await page.getByRole("button", { name: /^search$/i }).click();

    const filtered = page.getByRole("list", { name: /near-miss case studies/i }).getByRole("listitem");
    await expect(filtered).toHaveCount(1);
    expect(all).toBeGreaterThan(1);
    await expect(page.getByRole("link", { name: /pallet stacked above the rack rail/i })).toBeVisible();
  });

  test("shows which recurring kinds no procedure covers", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/near-misses");

    // The seed leaves the warehouse-safety case study with no linked procedure.
    await expect(page.getByText(/where no procedure covers what keeps happening/i)).toBeVisible();
    const gaps = page.getByRole("list", { name: /categories with no linked procedure/i });
    await expect(gaps.getByRole("listitem").first()).toBeVisible();
  });

  test("never shows a report that is still in the review queue", async ({ page }) => {
    await signIn(page, "learner");

    // NM-006 is seeded UNDER_REVIEW and NM-007 REPORTED. Neither is readable.
    await page.goto("/near-misses");
    const html = await page.content();
    expect(html).not.toContain("NM-006");
    expect(html).not.toContain("NM-007");

    await page.goto("/near-misses/NM-006");
    await expect(page.getByText(/404|not found|couldn't find|page not found/i).first()).toBeVisible();
  });
});

test.describe("Filing a report", () => {
  test("files one and confirms with its reference", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/near-misses/report");

    await expect(page.getByRole("heading", { level: 1, name: /report a near miss/i })).toBeVisible();

    await page.getByLabel(/one-line summary/i).fill("E2E wrong gasket material selected");
    await page
      .getByLabel(/^what happened/i)
      .fill(
        "An E2E test narrative describing a gasket material chosen for the wrong service temperature, noticed at the bench before it shipped.",
      );
    await page.getByLabel(/how it was caught/i).fill("Caught at the packing bench during a check.");

    await page.getByRole("button", { name: /file the report/i }).click();

    // The confirmation carries the reference, so the person has something to quote.
    await expect(page.getByRole("heading", { name: /filed as NM-\d+/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/a reviewer will turn it into a case study/i)).toBeVisible();
  });

  test("explains the anonymity trade-off before it is chosen", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/near-misses/report");

    const anonymous = page.getByRole("checkbox", { name: /file this anonymously/i });
    await expect(anonymous).toBeVisible();
    await expect(page.getByText(/no link to you is stored/i)).toBeVisible();
    await expect(page.getByText(/nobody can\s+ask you a follow-up question/i)).toBeVisible();
  });

  test("warns that the form is not an emergency channel for a serious event", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/near-misses/report");

    await page.getByLabel(/how far it got/i).selectOption("SERIOUS");
    await expect(page.getByText(/not an emergency channel/i)).toBeVisible();
    await expect(page.getByText(/tell your manager or the\s+safety contact now/i)).toBeVisible();
  });

  test("will not submit without a real narrative", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/near-misses/report");

    const submit = page.getByRole("button", { name: /file the report/i });
    await expect(submit).toBeDisabled();

    await page.getByLabel(/one-line summary/i).fill("Long enough summary");
    // Still disabled: a one-line narrative teaches nothing.
    await page.getByLabel(/^what happened/i).fill("It broke.");
    await expect(submit).toBeDisabled();
  });
});

test.describe("Reviewing a report", () => {
  test("shows the queue with what is waiting and for how long", async ({ page }) => {
    await signIn(page, "compliance");
    await page.goto("/admin/near-misses");

    await expect(page.getByRole("heading", { level: 1, name: /near-miss review/i })).toBeVisible();
    await expect(page.getByText(/awaiting review/i).first()).toBeVisible();

    const queue = page.getByRole("list", { name: /near-miss reports: needs review/i });
    const items = queue.getByRole("listitem");
    expect(await items.count()).toBeGreaterThan(0);
    // Waiting time is shown, because reviewers respond to a number.
    await expect(items.first().getByText(/filed today|waiting \d+ day/i)).toBeVisible();
  });

  test("marks an anonymous report as anonymous rather than showing a name", async ({ page }) => {
    await signIn(page, "compliance");
    await page.goto("/admin/near-misses");

    // NM-007 is seeded anonymous.
    const anonymousRow = page
      .getByRole("list", { name: /near-miss reports: needs review/i })
      .getByRole("listitem")
      .filter({ hasText: "NM-007" });
    await expect(anonymousRow.getByText(/anonymous/i)).toBeVisible();

    await anonymousRow.getByRole("link").first().click();
    await expect(page.getByRole("heading", { level: 1, name: /review NM-007/i })).toBeVisible();
    await expect(page.getByText(/filed anonymously/i)).toBeVisible();
    await expect(page.getByText(/no link to the reporter exists/i)).toBeVisible();
  });

  test("refuses to publish while the narrative names a colleague, and allows it once rewritten", async ({
    page,
  }) => {
    await signIn(page, "compliance");

    /*
     * Files its own report rather than consuming a seeded one, so the suite is
     * repeatable: publishing a seeded record would make this test — and the
     * "still in the review queue" test above — pass only on a fresh database.
     * It is archived at the end for the same reason.
     */
    // A short alpha marker, not a timestamp: a long digit run is exactly the
    // kind of thing the blameless check is meant to notice.
    const marker = `E2E review ${Math.random().toString(36).slice(2, 8)}`;
    await page.goto("/near-misses/report");
    await page.getByLabel(/one-line summary/i).fill(marker);
    await page
      .getByLabel(/^what happened/i)
      .fill(
        "A seat material was recommended from a printed datasheet held in a desk file. The manufacturer had revised the compatibility table and the printed copy carried no revision date.",
      );
    await page.getByRole("button", { name: /file the report/i }).click();
    await expect(page.getByRole("heading", { name: /filed as NM-\d+/i })).toBeVisible({
      timeout: 20_000,
    });

    await page.goto("/admin/near-misses");
    const row = page
      .getByRole("list", { name: /near-miss reports: needs review/i })
      .getByRole("listitem")
      .filter({ hasText: marker });
    await expect(row).toHaveCount(1);
    await row.getByRole("link").first().click();
    await expect(page.getByRole("heading", { level: 1, name: /^review NM-\d+$/i })).toBeVisible();

    const publish = page.getByRole("button", { name: /publish to library/i });
    // Nothing to publish yet: no cause, no change recorded.
    await expect(publish).toBeDisabled();
    await expect(page.getByText(/fill in why it happened to publish/i)).toBeVisible();

    await page
      .getByLabel(/^why it happened/i)
      .fill("The printed datasheet carried no revision date, so its age was invisible at the desk.");
    await page
      .getByLabel(/^what changed/i)
      .fill("Printed datasheets are stamped with a revision date and a review date on printing.");

    // Now name a colleague: the blameless check must block publication.
    await page
      .getByLabel(/^what happened/i)
      .fill("Dev Singh recommended a seat material from a superseded printed datasheet.");

    await expect(
      page.getByRole("alert").getByText(/must be removed before this can be published/i),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("alert").getByText(/Dev Singh/)).toBeVisible();
    await expect(publish).toBeDisabled();

    // Rewrite it in terms of the role, and the block clears.
    await page
      .getByLabel(/^what happened/i)
      .fill(
        "An application engineer recommended a seat material from a superseded printed datasheet held in a desk file.",
      );
    await expect(page.getByText(/nothing identifying, nothing that reads as blame/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(publish).toBeEnabled();

    await publish.click();
    await page.getByRole("dialog").getByRole("button", { name: /^publish$/i }).click();
    await expectToast(page, /published to the library/i);

    // It is readable in the library now, and still names nobody.
    await expect(page.getByRole("link", { name: /view in library/i })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("link", { name: /view in library/i }).click();
    await expect(page.getByRole("heading", { level: 1, name: marker })).toBeVisible();
    expect(await page.locator("#main-content").innerHTML()).not.toContain("Dev Singh");

    // Tidy up, so the library does not grow by one case study per run.
    await page.goBack();
    await page.getByRole("button", { name: /^reopen$/i }).click();
    await expect(page.getByRole("button", { name: /^archive$/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /^archive$/i }).click();
    const dialog = page.getByRole("dialog");
    // A reason is required: an unexplained withdrawal is not something to allow.
    await expect(dialog.getByRole("button", { name: /^archive$/i })).toBeDisabled();
    await dialog.getByLabel(/why it is being archived/i).fill("E2E cleanup");
    await dialog.getByRole("button", { name: /^archive$/i }).click();
    await expectToast(page, /archived/i);
  });

  test("flags blame language as a warning without blocking", async ({ page }) => {
    await signIn(page, "compliance");
    await page.goto("/admin/near-misses");

    const row = page
      .getByRole("list", { name: /near-miss reports: needs review/i })
      .getByRole("listitem")
      .filter({ hasText: "NM-007" });
    await row.getByRole("link").first().click();

    await page
      .getByLabel(/^what happened/i)
      .fill("The receiving check was careless about the manufacturer on the carton.");

    await expect(page.getByRole("status").getByText(/worth a second look/i).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/careless/).first()).toBeVisible();
    // A warning is not a block: there is no blocking alert.
    await expect(
      page.getByRole("alert").getByText(/must be removed before this can be published/i),
    ).toHaveCount(0);
  });
});

test.describe("Where case studies show up", () => {
  test("appear on the procedure they would have prevented", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/sops");

    await page.getByRole("link", { name: /receive an inbound shipment/i }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await expect(page.getByText(/why this procedure exists/i)).toBeVisible();
    const linked = page.getByRole("list", { name: /near misses this procedure prevents/i });
    await expect(linked.getByRole("listitem").first()).toBeVisible();
    await expect(linked.getByText(/nobody is named/i)).toHaveCount(0);
  });

  test("are searchable by wording, and unpublished ones are not", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/near-misses?q=gasket");

    const results = page.getByRole("list", { name: /near-miss case studies/i });
    await expect(results.getByRole("listitem").first()).toBeVisible();

    // A term that only appears in an unreviewed report returns nothing.
    await page.goto("/near-misses?q=substituted%20a%20fitting");
    await expect(page.getByText(/nothing matches those filters/i)).toBeVisible();
  });
});

test.describe("Permissions", () => {
  test("a contractor can report but never read the library", async ({ page }) => {
    await signIn(page, "contractor");

    // The reporting channel is deliberately wider than the library.
    await page.goto("/near-misses/report");
    await expect(page.getByRole("heading", { level: 1, name: /report a near miss/i })).toBeVisible();

    // The library route sends them to what they can actually do.
    await page.goto("/near-misses");
    await expect(page).toHaveURL(/\/near-misses\/report/);

    await page.goto("/near-misses/NM-001");
    await expect(page).toHaveURL(/\/near-misses\/report/);
  });

  test("the review queue is refused to someone without nearmiss.review", async ({ page }) => {
    await signIn(page, "learner");
    await expectForbidden(page, "/admin/near-misses");
  });

  test("the review queue appears in a reviewer's navigation and not a learner's", async ({ page }) => {
    await signIn(page, "compliance");
    await expectNavItem(page, "Near Misses", true, "Administration");

    await signOut(page);
    await signIn(page, "learner");
    await expectNavItem(page, "Near Misses", false, "Administration");
    // The library itself is in the learner section.
    await expectNavItem(page, "Near Misses", true);
  });
});
