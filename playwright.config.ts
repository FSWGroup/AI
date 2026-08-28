import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/*
 * Use "localhost" rather than "127.0.0.1". Auth.js resolves its redirect target
 * from the request host, and the browser treats localhost and 127.0.0.1 as
 * different hosts for cookie scoping — so mixing them means the session cookie
 * set during sign-in is never sent on the redirect, and every authenticated
 * test bounces back to the sign-in page.
 */
const HOST = process.env.E2E_HOST ?? "localhost";
const BASE_URL = process.env.E2E_BASE_URL ?? `http://${HOST}:${PORT}`;

/**
 * Use a pre-installed Chromium when the environment provides one whose revision
 * does not match this @playwright/test version. Set CHROMIUM_EXECUTABLE_PATH to
 * override. In CI, `npx playwright install chromium` supplies the matching build
 * and this resolves to undefined, which is the desired default.
 */
function chromiumExecutable(): string | undefined {
  const explicit = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return undefined;

  for (const entry of fs.readdirSync(root)) {
    if (!entry.startsWith("chromium")) continue;
    for (const candidate of [
      `${root}/${entry}/chrome-linux/chrome`,
      `${root}/${entry}/chrome-linux/headless_shell`,
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const executablePath = chromiumExecutable();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],

  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      AUTH_URL: BASE_URL,
      APP_URL: BASE_URL,
    },
  },
});
