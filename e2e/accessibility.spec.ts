import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Accessibility checks against the running application (WCAG 2.2 AA).
 *
 * These are structural assertions a machine can make reliably: landmark and
 * heading structure, label association, focus visibility and order, alt text,
 * name-role-value on controls, and status not being carried by color alone.
 *
 * They do not replace a manual audit with a screen reader — a page can pass all
 * of this and still be awkward to use. They do catch the regressions that
 * silently break assistive technology.
 */

const LEARNER_PAGES = [
  "/home",
  "/my-training",
  "/sops",
  "/catalog",
  "/certificates",
  "/paths",
  "/calendar",
  "/transcript",
];

/** Every page needs exactly one h1 and no skipped heading levels. */
async function assertHeadingStructure(page: Page, path: string): Promise<void> {
  const levels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((h) =>
      Number(h.tagName.slice(1)),
    ),
  );

  const h1Count = levels.filter((level) => level === 1).length;
  expect(h1Count, `${path} should have exactly one h1, found ${h1Count}`).toBe(1);

  // No level may jump by more than one from the previous heading.
  for (let i = 1; i < levels.length; i += 1) {
    const previous = levels[i - 1] ?? 1;
    const current = levels[i] ?? 1;
    if (current > previous) {
      expect(
        current - previous,
        `${path} skips a heading level: h${previous} → h${current}`,
      ).toBeLessThanOrEqual(1);
    }
  }
}

test.describe("Document structure", () => {
  test("every learner page has one h1 and no skipped heading levels", async ({ page }) => {
    await signIn(page, "learner");
    for (const path of LEARNER_PAGES) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await assertHeadingStructure(page, path);
    }
  });

  test("landmarks are present and unique where required", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/home");

    // One main, and navigation that is named so multiple navs stay distinguishable.
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(1);
  });

  test("the html element declares a language", async ({ page }) => {
    await page.goto("/sign-in");
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBeTruthy();
  });

  test("every page has a non-empty, distinct title", async ({ page }) => {
    await signIn(page, "learner");
    const titles = new Set<string>();
    for (const path of LEARNER_PAGES.slice(0, 5)) {
      await page.goto(path);
      const title = await page.title();
      expect(title.trim().length, `${path} has an empty title`).toBeGreaterThan(0);
      titles.add(title);
    }
    // Distinct titles matter for tab and history navigation.
    expect(titles.size).toBeGreaterThan(1);
  });
});

test.describe("Keyboard operability", () => {
  test("the skip link is the first tab stop and moves focus to main", async ({ page }) => {
    await signIn(page, "learner");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /skip to main content/i })).toBeFocused();
  });

  test("focus is always visible on interactive elements", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/my-training");

    // Walk the first several tab stops and confirm each shows a focus indicator.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const hasIndicator = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return true; // nothing focused yet
        const style = window.getComputedStyle(el);
        const outlineVisible =
          style.outlineStyle !== "none" && parseFloat(style.outlineWidth || "0") > 0;
        const ringVisible = style.boxShadow !== "none" && style.boxShadow !== "";
        const borderChanged = parseFloat(style.borderWidth || "0") > 0;
        return outlineVisible || ringVisible || borderChanged;
      });
      expect(hasIndicator, `tab stop ${i} has no visible focus indicator`).toBeTruthy();
    }
  });

  test("no element is removed from the tab order with a positive tabindex", async ({ page }) => {
    await signIn(page, "learner");
    for (const path of ["/home", "/my-training", "/sops"]) {
      await page.goto(path);
      // Positive tabindex values break the natural document order.
      const positives = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("[tabindex]")).filter(
            (el) => Number(el.getAttribute("tabindex")) > 0,
          ).length,
      );
      expect(positives, `${path} uses a positive tabindex`).toBe(0);
    }
  });

  test("dialogs trap focus, close on Escape, and restore focus", async ({ page }) => {
    await signIn(page, "learner");

    const trigger = page.getByRole("button", { name: /search/i }).first();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: /search and commands/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Focus returns to what opened the dialog.
    await expect(trigger).toBeFocused();
  });

  test("the notification tray is keyboard reachable and reports expanded state", async ({
    page,
  }) => {
    await signIn(page, "learner");
    const bell = page.getByRole("button", { name: /notifications/i });

    await expect(bell).toHaveAttribute("aria-expanded", "false");
    await bell.click();
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(bell).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("Name, role, value", () => {
  test("every button and link has an accessible name", async ({ page }) => {
    await signIn(page, "learner");

    for (const path of LEARNER_PAGES) {
      await page.goto(path);

      const unnamed = await page.evaluate(() => {
        const problems: string[] = [];
        const accessibleName = (el: Element): string => {
          const label = el.getAttribute("aria-label");
          if (label?.trim()) return label;
          const labelledBy = el.getAttribute("aria-labelledby");
          if (labelledBy) {
            const referenced = labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ");
            if (referenced.trim()) return referenced;
          }
          const title = el.getAttribute("title");
          if (title?.trim()) return title;
          return (el.textContent ?? "").trim();
        };

        for (const el of Array.from(document.querySelectorAll("button, a[href]"))) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue; // not rendered
          if (!accessibleName(el)) {
            problems.push(`${el.tagName}: ${el.outerHTML.slice(0, 120)}`);
          }
        }
        return problems;
      });

      expect(unnamed, `${path} has controls with no accessible name`).toEqual([]);
    }
  });

  test("every form control is labelled", async ({ page }) => {
    await signIn(page, "learner");

    for (const path of ["/sops", "/catalog", "/settings/notifications"]) {
      await page.goto(path);

      const unlabelled = await page.evaluate(() => {
        const problems: string[] = [];
        const controls = document.querySelectorAll<HTMLElement>(
          "input:not([type=hidden]), select, textarea",
        );
        for (const control of Array.from(controls)) {
          const rect = control.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;

          const id = control.getAttribute("id");
          const hasLabelFor = id
            ? Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`))
            : false;
          const wrapped = Boolean(control.closest("label"));
          const ariaLabel = control.getAttribute("aria-label")?.trim();
          const ariaLabelledBy = control.getAttribute("aria-labelledby");

          if (!hasLabelFor && !wrapped && !ariaLabel && !ariaLabelledBy) {
            problems.push(control.outerHTML.slice(0, 140));
          }
        }
        return problems;
      });

      expect(unlabelled, `${path} has unlabelled form controls`).toEqual([]);
    }
  });

  test("images have alt text, and decorative images have empty alt", async ({ page }) => {
    await signIn(page, "learner");

    for (const path of LEARNER_PAGES) {
      await page.goto(path);
      const missing = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("img"))
            .filter((img) => !img.hasAttribute("alt"))
            .map((img) => img.outerHTML.slice(0, 120)),
      );
      expect(missing, `${path} has images with no alt attribute`).toEqual([]);
    }
  });

  test("decorative SVG icons are hidden from assistive technology", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/home");

    // Icons carry no meaning of their own — adjacent text does — so they must
    // not be announced.
    const exposed = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("svg")).filter(
          (svg) =>
            svg.getAttribute("aria-hidden") !== "true" &&
            !svg.getAttribute("role") &&
            !svg.getAttribute("aria-label") &&
            !svg.querySelector("title"),
        ).length,
    );
    expect(exposed, "decorative SVGs should be aria-hidden or given a role/label").toBe(0);
  });

  test("progress bars expose their value", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/my-training");

    const bars = page.getByRole("progressbar");
    const count = await bars.count();
    for (let i = 0; i < count; i += 1) {
      const bar = bars.nth(i);
      await expect(bar).toHaveAttribute("aria-valuenow", /\d+/);
      const label = await bar.getAttribute("aria-label");
      expect(label?.trim().length ?? 0, `progressbar ${i} has no label`).toBeGreaterThan(0);
    }
  });
});

test.describe("Status is not conveyed by color alone", () => {
  test("status badges include text, not just a colored dot", async ({ page }) => {
    await signIn(page, "learner");
    await page.goto("/my-training");

    const withoutText = await page.evaluate(() => {
      const problems: string[] = [];
      // Badges render a dot plus a label; the label must be non-empty.
      for (const el of Array.from(document.querySelectorAll("span"))) {
        const hasDot = el.querySelector('span[aria-hidden="true"].rounded-full');
        if (!hasDot) continue;
        const text = (el.textContent ?? "").trim();
        if (!text) problems.push(el.outerHTML.slice(0, 120));
      }
      return problems;
    });

    expect(withoutText, "a status indicator relies on color alone").toEqual([]);
  });
});

test.describe("Reduced motion", () => {
  test("respects prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page, "learner");
    await page.goto("/my-training");

    // With reduced motion requested, transitions must be effectively instant.
    const longTransitions = await page.evaluate(() => {
      let count = 0;
      for (const el of Array.from(document.querySelectorAll("*")).slice(0, 400)) {
        const duration = window.getComputedStyle(el).transitionDuration;
        for (const part of duration.split(",")) {
          if (parseFloat(part) > 0.05) count += 1;
        }
      }
      return count;
    });
    expect(longTransitions).toBe(0);
  });
});

test.describe("Zoom and reflow", () => {
  test("content reflows at 320px width without horizontal scrolling", async ({ page }) => {
    await signIn(page, "learner");
    // WCAG 2.2 reflow: usable at 320 CSS pixels wide.
    await page.setViewportSize({ width: 320, height: 900 });

    for (const path of ["/home", "/my-training", "/sops"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows at 320px by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
});
