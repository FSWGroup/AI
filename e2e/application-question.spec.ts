import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Application judgment questions.
 *
 * A technical distributor's real skill is choosing the right thing for the
 * application, not recalling a definition. This question type gives a learner
 * the facts a real enquiry carries and asks for several linked decisions, each
 * scored separately with the expert's reasoning revealed afterwards.
 *
 * The properties worth proving through the UI: the correct answers never reach
 * the browser before the learner answers, and partial credit is real — two of
 * three decisions right is not marked simply wrong.
 */

test.setTimeout(120_000);

/** Open the seeded Valve Fundamentals assessment. */
async function openValveAssessment(page: Page) {
  await page.goto("/catalog");
  await page.getByRole("link", { name: /^valve fundamentals$/i }).click();
  await expect(page).toHaveURL(/\/courses\//);
  await page.getByRole("link", { name: /valve fundamentals assessment/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: /valve fundamentals assessment/i })).toBeVisible();
}

/*
 * Everything is scoped to the page body. The sidebar navigation also exposes
 * labelled groups, and the top bar has its own controls.
 */
const body = (page: Page) => page.getByRole("main");
const valveTypeGroup = (page: Page) => body(page).getByRole("group", { name: /valve type/i });

/** Answer whatever question is on screen. "Next" stays disabled until you do. */
async function answerCurrentQuestion(page: Page): Promise<void> {
  const radios = body(page).getByRole("radio");
  const checkboxes = body(page).getByRole("checkbox");
  const textboxes = body(page).getByRole("textbox");

  if ((await radios.count()) > 0) {
    await radios.first().check();
    return;
  }
  if ((await checkboxes.count()) > 0) {
    await checkboxes.first().check();
    return;
  }
  if ((await textboxes.count()) > 0) {
    await textboxes.first().fill("check");
    return;
  }
  // Matching questions pair items with selects.
  const selects = body(page).locator("select");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i += 1) {
    const options = selects.nth(i).locator("option");
    if ((await options.count()) > 1) {
      await selects.nth(i).selectOption({ index: 1 });
    }
  }
}

/**
 * The quiz presents one question at a time in a shuffled order, so answer and
 * advance until the application question appears. It is left unanswered, so a
 * caller can inspect the page before any selection is made.
 */
async function advanceToApplicationQuestion(page: Page): Promise<void> {
  for (let step = 0; step < 8; step += 1) {
    if (await valveTypeGroup(page).isVisible().catch(() => false)) return;
    await answerCurrentQuestion(page);
    // The lesson shell has its own Next (to the next lesson) as well as the
    // quiz's; the quiz one is last in the document.
    const next = page.getByRole("button", { name: /^next$/i }).last();
    if (!(await next.isEnabled().catch(() => false))) break;
    await next.click();
  }
  await expect(valveTypeGroup(page), "the application question should be reachable").toBeVisible();
}

test.describe("Answering an application question", () => {
  test("shows the application facts and one group of choices per decision", async ({ page }) => {
    await signIn(page, "learner");
    await openValveAssessment(page);
    await advanceToApplicationQuestion(page);

    // The parameters a real enquiry would carry.
    await expect(page.getByText(/saturated steam, isolation only/i)).toBeVisible();
    await expect(page.getByText(/366 °F/)).toBeVisible();

    // Each decision is its own labelled group, so the choices are never an
    // undifferentiated list of radio buttons.
    await expect(valveTypeGroup(page)).toBeVisible();
    await expect(page.getByRole("group", { name: /body material/i })).toBeVisible();
    await expect(page.getByRole("group", { name: /end connection/i })).toBeVisible();
  });

  test("never sends the correct answers or the reasoning to the browser", async ({ page }) => {
    await signIn(page, "learner");
    await openValveAssessment(page);
    await advanceToApplicationQuestion(page);

    /*
     * The whole page source, including the serialized server payload. A learner
     * who can read the answer out of the HTML is not being assessed.
     */
    const html = await page.content();
    expect(html).not.toContain("correctOptionId");
    // The reasoning names the expert's choice, so it must not be present either.
    expect(html).not.toMatch(/conventional choice: full bore when open/i);
    expect(html).not.toMatch(/carbon steel is the standard body/i);

    // The options themselves are of course present — that is the question.
    expect(html).toMatch(/Resilient-seated butterfly valve/i);
  });

  /*
   * Submitting and reviewing is covered by the integration tests
   * (tests/integration/application-question.test.ts) rather than here.
   * A failed attempt starts a 24-hour cooldown by design, so a browser test
   * that submits is not repeatable against the shared seeded database — and the
   * behaviour worth pinning down (partial credit, and reasoning withheld until
   * the review policy allows it) is service behaviour, not browser behaviour.
   */
});
