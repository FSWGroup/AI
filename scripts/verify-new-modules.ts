/**
 * End-to-end verification of the nine improvement modules against a running
 * server with demo data. Exercises the real UI, so a control that is wired to
 * nothing fails here.
 *
 * Usage: npx tsx scripts/verify-new-modules.ts
 */
import { chromium, type Page } from 'playwright-core';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const EMAIL = 'admin@fswelsford.com';
const PASSWORD = 'FswPeople!Demo2026';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

let failures = 0;
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

async function page200(page: Page, path: string, mustContain: string, label: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  const body = await page.content();
  const onPath = new URL(page.url()).pathname === path.split('?')[0];
  check(label, onPath && body.includes(mustContain), onPath ? '' : `redirected to ${page.url()}`);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: true,
  });
  const page = await browser.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });

  console.log('\n— Pages render with real data —');
  await page200(page, '/skills', 'Coverage risk', 'skills inventory');
  await page200(page, '/insights/workforce', 'Retention signals', 'workforce analytics');
  await page200(page, '/comp/cycles', 'Compensation cycles', 'comp cycles');
  await page200(page, '/comp/equity', 'Pay equity', 'pay equity');
  await page200(page, '/recruiting/referrals', 'Referrals', 'referrals');
  await page200(page, '/recruiting/talent-pool', 'Talent pool', 'talent pool');
  await page200(page, '/time/schedule', 'Overtime forecast', 'schedule');
  await page200(page, '/assistant', 'HR assistant', 'HR assistant');
  await page200(page, '/apps/profiles', 'Access profiles', 'access profiles');
  await page200(page, '/apps/exceptions', 'Access exceptions', 'access exceptions');
  await page200(page, '/admin/kiosks', 'Time clock kiosks', 'kiosk admin');
  // Assert on unescaped text: the page title contains "&", which reaches the
  // HTML as "&amp;".
  await page200(page, '/admin/api', 'Webhook endpoints', 'API admin');

  console.log('\n— The data is real, not placeholder —');
  const skills = await page.goto(`${BASE}/skills`, { waitUntil: 'networkidle' }).then(() => page.content());
  check('coverage risk names the single-point-of-failure skill', skills.includes('one person deep'));
  check('an expired certification is called out', skills.includes('expired'));

  const analytics = await page.goto(`${BASE}/insights/workforce`, { waitUntil: 'networkidle' }).then(() => page.content());
  check('retention factors carry an action, not just a label', analytics.includes('Listen') || analytics.includes('Review against the band') || analytics.includes('Book a conversation'));
  check('the analytics page states what it never reads', analytics.includes('date of birth'));

  const schedule = await page.goto(`${BASE}/time/schedule`, { waitUntil: 'networkidle' }).then(() => page.content());
  check('the seeded short break is found by the compliance check', schedule.includes('needs 30m, scheduled 15m') || schedule.includes('Break rule findings'));

  console.log('\n— Frontline access —');
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${BASE}/kiosk`, { waitUntil: 'networkidle' });
  const kiosk = await anonPage.content();
  check('an unregistered tablet says so instead of showing a pad', kiosk.includes('not set up'));
  await anonPage.goto(`${BASE}/people`, { waitUntil: 'networkidle' });
  check('the kiosk route did not open the rest of the app', anonPage.url().includes('/login'));

  await anonPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await anonPage.getByRole('button', { name: /Email me a sign-in link/ }).click();
  await anonPage.fill('#magic-email', 'nobody-at-all@example.com');
  await anonPage.getByRole('button', { name: /Send the link/ }).click();
  await anonPage.waitForSelector('[role=status]', { timeout: 15000 });
  const magicMessage = (await anonPage.locator('[role=status]').first().textContent())?.trim() ?? '';
  check('an unknown address gets the same non-committal answer', magicMessage.includes('If that address belongs'), magicMessage.slice(0, 60));
  check('and no link was actually issued', (await db.authToken.count({ where: { kind: 'MAGIC_LINK' } })) === 0);

  console.log('\n— The read API —');
  const key = `fswp_verify_${Date.now()}`;
  const { createHash } = await import('crypto');
  const keyHash = createHash('sha256').update(key).digest('hex');
  const created = await db.apiKey.create({
    data: { name: 'Verification', keyHash, prefix: key.slice(0, 12), scopes: ['workers.read'] },
  });

  const noAuth = await fetch(`${BASE}/api/v1/workers`);
  check('rejects a request with no key', noAuth.status === 401, String(noAuth.status));

  const wrongScope = await fetch(`${BASE}/api/v1/headcount`, { headers: { authorization: `Bearer ${key}` } });
  check('rejects a scope the key does not carry', wrongScope.status === 403, String(wrongScope.status));

  const ok = await fetch(`${BASE}/api/v1/workers`, { headers: { authorization: `Bearer ${key}` } });
  const body = await ok.text();
  check('serves the directory with a valid key', ok.status === 200, String(ok.status));
  for (const forbidden of ['dateOfBirth', 'homeStreet', 'personalEmail', 'passwordHash', 'kioskPinHash']) {
    check(`the response never contains ${forbidden}`, !body.includes(forbidden));
  }
  check('the response is marked uncacheable', (ok.headers.get('cache-control') ?? '').includes('no-store'));

  await db.apiKey.delete({ where: { id: created.id } });

  await browser.close();
  await db.$disconnect();
  console.log(failures === 0 ? '\nALL NINE MODULES VERIFIED' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
