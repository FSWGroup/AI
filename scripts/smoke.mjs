// Browser smoke test: signs in as the demo Super Admin and walks core pages,
// failing on console errors or non-200 page loads. Run: node scripts/smoke.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@fswelsford.com';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'FswPeople!Demo2026';

const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '/', '/people', '/people/org-chart', '/people/contractors', '/tasks', '/approvals',
      '/time/pto', '/time/calendar', '/time/tracking',
      '/recruiting/jobs', '/recruiting/candidates', '/recruiting/offers',
      '/talent/goals', '/talent/reviews', '/talent/one-on-ones', '/talent/feedback', '/training',
      '/comp', '/comp/bands', '/benefits', '/payroll',
      '/ops/onboarding', '/ops/offboarding', '/documents', '/policies', '/announcements',
      '/equipment', '/apps', '/surveys', '/people/cases',
      '/reports', '/insights/executive',
      '/admin/compliance', '/admin/workflows', '/admin/imports', '/admin/audit',
      '/admin/email-outbox', '/admin/integrations', '/admin/settings', '/notifications', '/account/security',
    ];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height
: 900 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console @ ${page.url()}: ${msg.text().slice(0, 300)}`);
});
page.on('pageerror', (err) => errors.push(`pageerror @ ${page.url()}: ${String(err).slice(0, 300)}`));

// Sign in
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL(`${BASE}/`, { timeout: 20000 });
console.log('✓ signed in');

let failures = 0;
for (const path of PAGES) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => ({ err: e }));
  if (!res || res.err) {
    console.log(`✗ ${path} — navigation failed: ${res?.err ?? 'unknown'}`);
    failures++;
    continue;
  }
  const status = res.status();
  const body = await page.textContent('body').catch(() => '');
  const hasError = /Something went wrong|Application error|Internal Server Error/i.test(body ?? '');
  if (status !== 200 || hasError) {
    console.log(`✗ ${path} — status ${status}${hasError ? ' (error text on page)' : ''}`);
    failures++;
  } else {
    console.log(`✓ ${path}`);
  }
}

if (process.env.SMOKE_SCREENSHOT) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: process.env.SMOKE_SCREENSHOT, fullPage: false });
  console.log(`saved screenshot to ${process.env.SMOKE_SCREENSHOT}`);
}

await browser.close();
if (errors.length) {
  console.log('\nConsole/page errors:');
  errors.slice(0, 20).forEach((e) => console.log('  ' + e));
}
console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED: ${failures} pages`);
process.exit(failures === 0 ? 0 : 1);
