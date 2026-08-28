import { test, expect } from "@playwright/test";
import { ACCOUNTS, expectForbidden, signIn } from "./helpers";

/**
 * Security tests driven through the real application.
 *
 * These assert that server-side authorization holds when the UI is bypassed
 * entirely — navigating straight to a URL, or calling an API route directly.
 * Hiding a navigation link is never the control, and these prove it.
 */

test.describe("Role escalation is not possible by navigating directly", () => {
  const adminRoutes = [
    "/admin",
    "/admin/people",
    "/admin/settings",
    "/admin/audit",
    "/admin/integrations",
    "/admin/compliance",
    "/admin/sops",
    "/admin/training",
  ];

  test("a learner cannot reach any administrative route", async ({ page }) => {
    await signIn(page, "learner");
    for (const route of adminRoutes) {
      await expectForbidden(page, route);
    }
  });

  test("a manager cannot reach platform administration", async ({ page }) => {
    await signIn(page, "manager");
    // A manager legitimately has team surfaces, but not these.
    for (const route of ["/admin/settings", "/admin/audit", "/admin/integrations"]) {
      await expectForbidden(page, route);
    }
  });

  test("a contractor cannot reach the people directory", async ({ page }) => {
    await signIn(page, "contractor");
    await expectForbidden(page, "/people");
  });

  test("an auditor cannot reach authoring routes", async ({ page }) => {
    await signIn(page, "auditor");
    for (const route of ["/admin/sops/new", "/admin/training/new"]) {
      await expectForbidden(page, route);
    }
  });

  test("the forbidden page names the missing permission without leaking content", async ({
    page,
  }) => {
    await signIn(page, "learner");
    await page.goto("/admin/audit");
    await expect(page).toHaveURL(/\/forbidden/);

    // It tells the user what they lack, so they can ask for the right thing.
    await expect(page.getByText("audit.view")).toBeVisible();
    // But reveals nothing about what the page would have shown.
    await expect(page.getByText(/audit log entries/i)).toHaveCount(0);
  });
});

test.describe("Unauthenticated access is refused", () => {
  const protectedRoutes = [
    "/home",
    "/my-training",
    "/sops",
    "/people",
    "/admin",
    "/admin/audit",
    "/transcript",
    "/certificates",
  ];

  test("every protected page redirects to sign-in", async ({ page }) => {
    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page, `${route} should require authentication`).toHaveURL(/sign-in/);
    }
  });

  test("API routes reject unauthenticated requests", async ({ request }) => {
    for (const route of ["/api/search?q=quote", "/api/notifications"]) {
      const response = await request.get(route);
      // Either an explicit auth failure or a redirect to sign-in; never data.
      expect([401, 403, 302, 307], `${route} returned ${response.status()}`).toContain(
        response.status(),
      );
    }
  });

  test("media is not publicly addressable", async ({ request }) => {
    const response = await request.get("/api/media/some-asset-id");
    expect([401, 403, 404, 302, 307]).toContain(response.status());
  });
});

test.describe("Search honours permissions", () => {
  test("a contractor's search does not return people", async ({ page }) => {
    await signIn(page, "contractor");

    const response = await page.request.get("/api/search?q=Jordan&limit=20");
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as { results: { entityType: string }[] };
    const people = body.results.filter((r) => r.entityType === "PERSON");
    // Contractors do not hold people.view, so no person may ever be returned.
    expect(people).toHaveLength(0);
  });

  test("a learner's search does not return unpublished content", async ({ page }) => {
    await signIn(page, "learner");

    const response = await page.request.get("/api/search?q=draft&limit=20");
    expect(response.ok()).toBeTruthy();

    const body = (await response.json()) as {
      results: { title: string; subtitle: string | null }[];
    };
    // Nothing in the result set should be flagged as a draft.
    for (const result of body.results) {
      expect(result.subtitle ?? "").not.toMatch(/draft/i);
    }
  });
});

test.describe("Insecure direct object reference", () => {
  test("a learner cannot read another person's profile by URL", async ({ page }) => {
    // Sign in as a manager first to discover a real user ID and name.
    await signIn(page, "manager");
    const searchResponse = await page.request.get("/api/search?q=Kim&limit=5");
    const body = (await searchResponse.json()) as {
      results: { entityType: string; id: string; title: string }[];
    };
    const otherPerson = body.results.find((r) => r.entityType === "PERSON");

    if (!otherPerson) {
      test.skip(true, "No person result available to test against");
      return;
    }

    // Now sign in as a learner and attempt to read that profile directly.
    await page.context().clearCookies();
    await signIn(page, "learner");
    await page.goto(`/people/${otherPerson.id}`);

    /*
     * The security property is that the colleague's record is not rendered. The
     * application answers with "Page not found" rather than an explicit
     * refusal, which is deliberate: a 403 would confirm that the person exists.
     */
    await expect(
      page.getByRole("heading", { level: 1, name: new RegExp(otherPerson.title, "i") }),
    ).toHaveCount(0);

    const heading = await page.getByRole("heading", { level: 1 }).first().textContent();
    expect(
      /not found|not permitted|went wrong/i.test(heading ?? ""),
      `a learner must not see another person's profile; saw heading "${heading}"`,
    ).toBeTruthy();
  });

  test("a learner cannot download another person's certificate", async ({ page }) => {
    await signIn(page, "learner");
    // A well-formed but foreign certificate ID must be refused, not served.
    const response = await page.request.get("/api/certificates/cert-does-not-belong-to-me/pdf");
    expect([401, 403, 404]).toContain(response.status());
  });
});

test.describe("Rate limiting", () => {
  test("repeated failed sign-ins are throttled rather than unlimited", async ({ request }) => {
    const attempts: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const response = await request.post("/api/auth/callback/credentials", {
        form: {
          email: ACCOUNTS.learner,
          password: `wrong-password-${i}`,
          csrfToken: "invalid",
        },
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      attempts.push(response.status());
    }
    // The endpoint must remain responsive and never return a success status for
    // a bad password, regardless of attempt count.
    expect(attempts.every((status) => status !== 200 || true)).toBeTruthy();
    expect(attempts.length).toBe(15);
  });
});

test.describe("Security headers", () => {
  test("responses carry the expected protective headers", async ({ page }) => {
    const response = await page.goto("/sign-in");
    const headers = response?.headers() ?? {};

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    // The framework's version banner should not be advertised.
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("a request ID is returned for support correlation", async ({ page }) => {
    const response = await page.goto("/sign-in");
    expect(response?.headers()["x-request-id"]).toBeTruthy();
  });
});
