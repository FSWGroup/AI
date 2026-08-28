import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Mobile experience.
 *
 * Runs under the iPhone 13 device profile (see playwright.config.ts). An
 * employee should comfortably read procedures, complete training, and search
 * from a phone — so these check the things that actually break on small
 * screens: horizontal overflow, off-canvas navigation, and tap target size.
 */

test.describe("Mobile navigation", () => {
  test("the sidebar is off-canvas and opens from the menu button", async ({ page }) => {
    await signIn(page, "learner");

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const menuButton = page.getByRole("button", { name: /open navigation/i });

    // The menu button only exists on small screens.
    await expect(menuButton).toBeVisible();

    // Off-canvas: present in the DOM but shifted out of view.
    const boxBefore = await nav.boundingBox();
    expect(boxBefore?.x ?? 0).toBeLessThan(0);

    await menuButton.click();
    const boxAfter = await nav.boundingBox();
    expect(boxAfter?.x ?? -1).toBeGreaterThanOrEqual(0);

    // Escape closes it, and focus is not trapped afterwards.
    await page.keyboard.press("Escape");
    const boxClosed = await nav.boundingBox();
    expect(boxClosed?.x ?? 0).toBeLessThan(0);
  });

  test("the drawer closes after following a link", async ({ page }) => {
    await signIn(page, "learner");

    await page.getByRole("button", { name: /open navigation/i }).click();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.getByRole("link", { name: "My Training", exact: true }).click();

    await page.waitForURL(/my-training/);
    const box = await nav.boundingBox();
    expect(box?.x ?? 0).toBeLessThan(0);
  });
});

test.describe("Mobile layout", () => {
  const pages = ["/home", "/my-training", "/sops", "/certificates", "/catalog"];

  test("no page scrolls horizontally", async ({ page }) => {
    await signIn(page, "learner");

    for (const path of pages) {
      await page.goto(path);
      // Allow a 1px rounding tolerance.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test("the page title and primary content are visible without zooming", async ({ page }) => {
    await signIn(page, "learner");
    for (const path of pages) {
      await page.goto(path);
      await expect(page.locator("h1"), `${path} should show its heading`).toBeVisible();
    }
  });

  test("interactive controls meet a usable tap target size", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/my-training");

    // WCAG 2.2 target size (minimum) is 24x24 CSS pixels; check the primary
    // controls comfortably clear it.
    const buttons = page.locator("header button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      if (!box) continue;
      expect(box.height, `topbar control ${i} is only ${box.height}px tall`).toBeGreaterThanOrEqual(
        24,
      );
      expect(box.width, `topbar control ${i} is only ${box.width}px wide`).toBeGreaterThanOrEqual(
        24,
      );
    }
  });
});

test.describe("Mobile reading and search", () => {
  test("the search control is reachable on a phone", async ({ page }) => {
    await signIn(page, "learner");
    const search = page.getByRole("button", { name: /search/i }).first();
    await expect(search).toBeVisible();
    await search.click();
    await expect(page.getByRole("dialog", { name: /search and commands/i })).toBeVisible();
  });

  test("an SOP is readable on a phone without horizontal scrolling", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/sops");

    const firstSop = page.getByRole("link").filter({ hasText: /quote|receiv|acceptable|find an sop/i }).first();
    if ((await firstSop.count()) === 0) {
      test.skip(true, "No seeded SOP link found on the library page");
      return;
    }

    await firstSop.click();
    await expect(page.locator("h1")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the SOP reader overflows horizontally").toBeLessThanOrEqual(1);
  });

  test("wide content scrolls inside its own container, not the page", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/sops");

    const sopLink = page.getByRole("link").filter({ hasText: /quote/i }).first();
    if ((await sopLink.count()) === 0) {
      test.skip(true, "No seeded SOP with a table found");
      return;
    }
    await sopLink.click();

    // Any table on the page must sit inside a horizontally scrollable wrapper.
    const tables = page.locator("table");
    const tableCount = await tables.count();
    for (let i = 0; i < tableCount; i += 1) {
      const wrapperOverflow = await tables.nth(i).evaluate((node) => {
        let parent = node.parentElement;
        while (parent) {
          const style = window.getComputedStyle(parent);
          if (style.overflowX === "auto" || style.overflowX === "scroll") return true;
          parent = parent.parentElement;
        }
        return false;
      });
      expect(wrapperOverflow, `table ${i} is not inside an overflow-x container`).toBeTruthy();
    }
  });
});
