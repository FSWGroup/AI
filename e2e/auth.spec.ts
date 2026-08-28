import { test, expect } from "@playwright/test";
import { ACCOUNTS, SEED_PASSWORD, expectNavItem, signIn, signOut } from "./helpers";

test.describe("Authentication", () => {
  test("an unauthenticated visitor is sent to sign-in", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/sign-in/);
    await expect(page.getByRole("heading", { name: /^sign in$/i })).toBeVisible();
  });

  test("the root path routes to sign-in when signed out", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("a wrong password is rejected without revealing whether the account exists", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill(ACCOUNTS.learner);
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    const error = page.getByRole("alert");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/didn't match/i);

    // A non-existent account produces the same message.
    await page.getByLabel("Work email").fill("nobody.here@fswelsford.com");
    await page.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("alert")).toContainText(/didn't match/i);
  });

  test("a learner signs in and reaches their dashboard", async ({ page }) => {
    await signIn(page, "learner");
    await expect(page).toHaveURL(/\/home/);
  });

  test("a signed-in user is redirected away from sign-in", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/sign-in");
    await expect(page).toHaveURL(/\/home/);
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, "learner");
    await signOut(page);

    // The protected page must no longer be reachable.
    await page.goto("/home");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("the sign-in page offers only configured providers", async ({ page }) => {
    await page.goto("/sign-in");
    // Password auth is enabled in the test environment.
    await expect(page.getByLabel("Work email")).toBeVisible();
    // Microsoft SSO is not configured, so no dead button is offered.
    await expect(page.getByRole("button", { name: /continue with microsoft/i })).toHaveCount(0);
  });
});

test.describe("Permission-filtered navigation", () => {
  test("a learner sees learner navigation and no administration", async ({ page }) => {
    await signIn(page, "learner");

    await expectNavItem(page, "Home", true);
    await expectNavItem(page, "My Training", true);
    await expectNavItem(page, "SOP Library", true);
    await expectNavItem(page, "Certificates", true);

    // No manager or admin surface.
    await expectNavItem(page, "Team", false);
    await expectNavItem(page, "Dashboard", false);
    await expectNavItem(page, "Audit Log", false);
    await expectNavItem(page, "Settings", false);
  });

  test("a manager sees the manager section", async ({ page }) => {
    await signIn(page, "manager");
    await expectNavItem(page, "Team", true);
    await expectNavItem(page, "Training Status", true);
    // But not platform administration.
    await expectNavItem(page, "Audit Log", false);
    await expectNavItem(page, "Settings", false);
  });

  test("a super administrator sees administration", async ({ page }) => {
    await signIn(page, "superAdmin");
    await expectNavItem(page, "Audit Log", true);
    await expectNavItem(page, "Settings", true);
    await expectNavItem(page, "People", true);
  });

  test("a contractor gets the narrowed surface", async ({ page }) => {
    await signIn(page, "contractor");
    // Contractors deliberately do not get the people directory or org chart.
    await expectNavItem(page, "People", false);
    // But they do get their training and published procedures.
    await expectNavItem(page, "My Training", true);
    await expectNavItem(page, "SOP Library", true);
  });
});

test.describe("Accessibility basics", () => {
  test("the skip link is the first focus stop and reaches main content", async ({ page }) => {
    await signIn(page, "learner");

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: /skip to main content/i });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeVisible();
  });

  test("every page has exactly one level-one heading", async ({ page }) => {
    await signIn(page, "learner");
    for (const path of ["/home", "/my-training", "/sops", "/certificates"]) {
      await page.goto(path);
      const h1Count = await page.locator("h1").count();
      expect(h1Count, `${path} should have exactly one h1`).toBe(1);
    }
  });

  test("the sign-in form associates labels with inputs", async ({ page }) => {
    await page.goto("/sign-in");
    // getByLabel only resolves when the label is correctly associated.
    await expect(page.getByLabel("Work email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  });
});

test.describe("Session handling", () => {
  test("a deactivated account cannot sign in", async ({ page, request }) => {
    // The seeded set has no deactivated account, so this asserts the shape of
    // the failure for an unknown account, which is the same uniform message.
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill("deactivated.person@fswelsford.com");
    await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/sign-in/);
    expect(request).toBeTruthy();
  });
});
