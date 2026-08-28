import { test, expect } from "@playwright/test";
import { expectForbidden, signIn } from "./helpers";

/**
 * Insight surfaces.
 *
 * Both exist to turn data the platform already holds into something a person
 * acts on, so the things worth asserting are that they carry named people and
 * real evidence rather than a score, and that they never reach outside the
 * viewer's scope.
 */

test.describe("This week with your team", () => {
  test("names people, the reason, and the evidence behind it", async ({ page }) => {
    await signIn(page, "manager");
    await page.goto("/team/brief");

    await expect(page.getByRole("heading", { level: 1, name: /this week with your team/i })).toBeVisible();

    // The seeded manager's reports carry overdue work, so there is a real item.
    await expect(page.getByText(/could use a conversation/i)).toBeVisible();

    // A suggested conversation has to be usable as written, addressed to a person.
    // Scoped to the labelled list: the sidebar navigation is also a list.
    const firstItem = page
      .getByRole("list", { name: /people who could use a conversation/i })
      .getByRole("listitem")
      .first();
    await expect(firstItem.getByRole("link").first()).toBeVisible();
    await expect(firstItem.getByText(/why this is here/i)).toBeVisible();

    // Evidence, not just a verdict: the item names what is actually late.
    await expect(firstItem.getByText(/past due|no progress since|awaiting your sign-off|nothing outstanding/i).first()).toBeVisible();
  });

  test("only covers the manager's own reporting line", async ({ page }) => {
    await signIn(page, "manager");
    await page.goto("/team/brief");

    /*
     * The seeded sales manager has three direct reports. Holding the instructor
     * role as well used to promote them to seeing all thirteen people in the
     * organization, because platform scope was inferred from a combination of
     * capabilities rather than granted.
     */
    await expect(page.getByText(/of 3 people in your reporting line/i)).toBeVisible();

    // Someone else's report is never named.
    await expect(page.getByRole("link", { name: /rosa delgado/i })).toHaveCount(0);
  });

  test("is refused to someone without team.view", async ({ page }) => {
    await signIn(page, "learner");
    await expectForbidden(page, "/team/brief");
  });

  test("does not appear in a learner's navigation", async ({ page }) => {
    await signIn(page, "learner");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "This Week" })).toHaveCount(0);
  });
});

test.describe("Knowledge risk", () => {
  test("surfaces a skill only one person holds, and how to spread it", async ({ page }) => {
    await signIn(page, "superAdmin");
    await page.goto("/team/knowledge-risk");

    await expect(page.getByRole("heading", { level: 1, name: /knowledge risk/i })).toBeVisible();

    // The seed clears exactly one person on control valves at the level the
    // Application Engineer role demands — the case this page exists for.
    const single = page
      .getByRole("list", { name: /skills at risk/i })
      .getByRole("listitem")
      .filter({ hasText: /control valves/i })
      .first();
    await expect(single).toBeVisible();
    await expect(single.getByText(/one person only/i)).toBeVisible();
    await expect(single.getByRole("link", { name: /kim harlow/i })).toBeVisible();

    // It reports the level the work needs and how many people depend on it.
    await expect(single.getByText(/level the work needs/i)).toBeVisible();
    await expect(single.getByText(/people who depend on it/i)).toBeVisible();
  });

  test("distinguishes uncovered skills from thinly covered ones", async ({ page }) => {
    await signIn(page, "superAdmin");
    await page.goto("/team/knowledge-risk");

    // Worst first: an uncovered skill outranks a thinly covered one.
    const levels = await page
      .getByRole("list", { name: /skills at risk/i })
      .getByRole("listitem")
      .getByText(/nobody covers this|one person only|two people only/i)
      .allTextContents();

    expect(levels.length).toBeGreaterThan(1);
    expect(levels[0]).toMatch(/nobody covers this/i);
    // Both ends of the range are represented, so the page is not one flat state.
    expect(levels.join(" ")).toMatch(/one person only/i);
  });

  test("names only people inside the viewer's scope", async ({ page }) => {
    // A contractor holds skills.view but no team scope, so the page must render
    // without naming a colleague as a holder.
    await signIn(page, "contractor");
    await page.goto("/team/knowledge-risk");

    await expect(page.getByRole("heading", { level: 1, name: /knowledge risk/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /kim harlow/i })).toHaveCount(0);
  });
});
