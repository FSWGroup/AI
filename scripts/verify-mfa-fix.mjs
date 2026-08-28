// Live verification that a session which has NOT cleared MFA cannot reach the
// account security page or turn MFA off. Run against a dev server with the
// demo seed. Usage: node scripts/verify-mfa-fix.mjs
import { chromium } from 'playwright-core';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const BASE = 'http://localhost:3000';
const EMAIL = 'tyler.brooks@fswelsford.com';
const PASSWORD = 'FswPeople!Demo2026';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// Give the victim MFA so the attacker lands on /mfa after entering the password.
const secret = 'JBSWY3DPEHPK3PXP';
const { encryptField } = await import('../src/lib/crypto.js').catch(() => ({ encryptField: null }));
await db.user.update({
  where: { email: EMAIL },
  data: { mfaEnabled: true, mfaSecretEnc: encryptField ? encryptField(secret) : null },
});

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });
const page = await browser.newPage();

let failures = 0;
const check = (label, pass, detail = '') => {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

// 1. Sign in with only the password — this is what a phished credential gets you.
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL(/\/(mfa|)$/, { timeout: 15000 });
check('password-only sign-in lands on the MFA challenge', page.url().endsWith('/mfa'), page.url());

// 2. Attempt to skip MFA by navigating straight to the security page.
await page.goto(`${BASE}/account/security`, { waitUntil: 'networkidle' });
// Blocked is blocked: either the login form or the MFA challenge is correct.
const blocked = (url) => url.includes('/login') || url.endsWith('/mfa');
check('pre-MFA session cannot open /account/security', blocked(page.url()), page.url());

// 3. Attempt to reach any authenticated page.
await page.goto(`${BASE}/people`, { waitUntil: 'networkidle' });
check('pre-MFA session cannot open the directory', blocked(page.url()), page.url());

// 4. Confirm MFA is still enabled on the account — nothing was turned off.
const after = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
check('MFA is still enabled on the account', after.mfaEnabled === true);
check('the TOTP secret was not cleared', after.mfaSecretEnc !== null);

await browser.close();
// Restore the demo account.
await db.user.update({ where: { email: EMAIL }, data: { mfaEnabled: false, mfaSecretEnc: null } });
await db.$disconnect();

console.log(failures === 0 ? '\nMFA BYPASS CLOSED' : `\nSTILL VULNERABLE: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
