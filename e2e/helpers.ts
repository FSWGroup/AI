import { expect, type Page } from "@playwright/test";

/**
 * End-to-end helpers.
 *
 * These drive the real application against the seeded database, so they use the
 * seeded demonstration accounts documented in the README.
 */

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "FswAcademy!2026";

export const ACCOUNTS = {
  superAdmin: "admin@fswelsford.com",
  trainingAdmin: "training.admin@fswelsford.com",
  hrAdmin: "hr.admin@fswelsford.com",
  compliance: "compliance@fswelsford.com",
  manager: "sales.manager@fswelsford.com",
  learner: "jordan.pace@fswelsford.com",
  warehouse: "dev.singh@fswelsford.com",
  contractor: "ph.contractor@fswelsford.com",
  author: "author@fswelsford.com",
  auditor: "auditor@fswelsford.com",
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

/** Sign in through the real form and wait for the application shell. */
export async function signIn(page: Page, account: AccountKey | string): Promise<void> {
  const email = account in ACCOUNTS ? ACCOUNTS[account as AccountKey] : account;

  await page.goto("/sign-in");

  // The password form is the default when password auth is enabled.
  const emailField = page.getByRole("textbox", { name: /work email/i });
  await expect(emailField).toBeVisible();
  await emailField.fill(email);
  await page.getByRole("textbox", { name: /^password$/i }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // Landing on /home means the session was established and the shell rendered.
  await page.waitForURL(/\/home/, { timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: /your account/i }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await page.waitForURL(/sign-in/, { timeout: 15_000 });
}

/** Assert a navigation item is present or absent — the permission-filtered nav. */
export async function expectNavItem(
  page: Page,
  label: string,
  present: boolean,
  section?: "Manager" | "Administration",
): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Main navigation" });

  // Some labels appear in more than one section — an administrator sees both a
  // learner "People" link and an admin one — so an optional section scopes the
  // match to the labelled group.
  const scope = section ? nav.getByRole("group", { name: section }) : nav;
  const link = scope.getByRole("link", { name: label, exact: true });

  if (present) {
    await expect(link.first()).toBeVisible();
  } else {
    await expect(link).toHaveCount(0);
  }
}

/**
 * Navigate directly to a URL and assert the server refused it.
 * A forbidden route redirects to /forbidden; it must never render the content.
 */
export async function expectForbidden(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page).toHaveURL(/\/forbidden/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /access not permitted/i })).toBeVisible();
}

/** Open the command palette with the keyboard shortcut. */
export async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await expect(page.getByRole("dialog", { name: /search and commands/i })).toBeVisible();
}

/** Wait for a toast notification containing the given text. */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 });
}
