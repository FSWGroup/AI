// End-to-end verification of the Indeed integration against a running dev
// server with the demo seed. Exercises the real UI (no dead buttons), the
// token-protected feed, the public careers page, and a signed Indeed Apply
// delivery. Usage: node scripts/verify-indeed-flow.mjs
import { chromium } from 'playwright-core';
import { createHmac } from 'crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const BASE = 'http://localhost:3000';
const EMAIL = 'admin@fswelsford.com';
const PASSWORD = 'FswPeople!Demo2026';
const FEED_TOKEN = process.env.INDEED_FEED_TOKEN!;
const APPLY_SECRET = process.env.INDEED_APPLY_SECRET!;

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

let failures = 0;
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

async function main() {
  const job = await db.jobRequisition.findFirstOrThrow({ where: { status: 'OPEN' } });

  const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();

  // --- Sign in and publish through the real UI --------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });

  await page.goto(`${BASE}/recruiting/jobs/${job.id}`, { waitUntil: 'networkidle' });
  check('the job page offers a Publish to Indeed control', await page.getByRole('button', { name: 'Publish to Indeed' }).isVisible());

  await page.getByRole('button', { name: 'Publish to Indeed' }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.waitForTimeout(2500);

  const posting = await db.jobBoardPosting.findFirst({ where: { requisitionId: job.id, board: 'INDEED' } });
  check('publishing actually wrote a posting row', posting?.status === 'PUBLISHED', posting?.status ?? 'none');
  if (!posting) {
    console.log('No posting was created — cannot continue.');
    process.exit(1);
  }

  // --- Feed -------------------------------------------------------------------
  const noToken = await fetch(`${BASE}/api/indeed/feed`);
  check('the feed is 404 without the crawl token', noToken.status === 404, String(noToken.status));

  const feed = await fetch(`${BASE}/api/indeed/feed?token=${encodeURIComponent(FEED_TOKEN)}`);
  const xml = await feed.text();
  check('the feed serves the published job', feed.status === 200 && xml.includes(job.title));
  check('the feed carries the reference number Indeed sends back', xml.includes(job.id));
  check('the feed hides internal fields', !xml.includes('headcount') && !xml.includes('isReplacement'));

  // --- Public careers page ----------------------------------------------------
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${BASE}/careers`, { waitUntil: 'networkidle' });
  check('the public careers page lists the role without a session', (await anonPage.content()).includes(job.title));
  await anonPage.goto(`${BASE}/careers/${posting.id}`, { waitUntil: 'networkidle' });
  check('the public posting page renders', (await anonPage.content()).includes(job.title));
  await anonPage.goto(`${BASE}/people`, { waitUntil: 'networkidle' });
  check('the careers pages did not open up the rest of the app', anonPage.url().includes('/login'), anonPage.url());

  // --- Indeed Apply webhook ---------------------------------------------------
  const externalId = `verify_${Date.now()}`;
  const payload = JSON.stringify({
    id: externalId,
    job: { jobId: job.id, jobTitle: job.title },
    applicant: {
      firstName: 'Verification',
      lastName: 'Candidate',
      email: `verify.${Date.now()}@example.com`,
      phoneNumber: '610-555-0199',
      resume: { text: 'Fifteen years running distribution branches and a 20-person warehouse team.' },
    },
  });
  const post = (body: string, signature: string | null) =>
    fetch(`${BASE}/api/indeed/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature ? { 'indeed-signature': signature } : {}) },
      body,
    });

  const unsigned = await post(payload, null);
  check('an unsigned delivery is refused', unsigned.status === 401, String(unsigned.status));

  const forged = createHmac('sha256', 'wrong-secret').update(payload).digest('base64');
  check('a forged signature is refused', (await post(payload, forged)).status === 401);

  const signature = createHmac('sha256', APPLY_SECRET).update(payload).digest('base64');
  const accepted = await post(payload, signature);
  check('a correctly signed delivery is accepted', accepted.status === 201, String(accepted.status));

  const application = await db.application.findUnique({ where: { sourceRef: `INDEED:${externalId}` } });
  check('the application landed in the pipeline', Boolean(application));

  const replay = await post(payload, signature);
  check('a redelivery does not duplicate the candidate', replay.status === 200, String(replay.status));
  check('still exactly one application for that delivery', (await db.application.count({ where: { sourceRef: `INDEED:${externalId}` } })) === 1);

  const rejectedLog = await db.jobBoardDelivery.findFirst({
    where: { status: 'REJECTED' },
    orderBy: { receivedAt: 'desc' },
  });
  check('the refused delivery was logged', Boolean(rejectedLog));
  check(
    'the log holds no applicant contact details',
    !JSON.stringify(rejectedLog?.payloadDigest ?? {}).includes('610-555-0199'),
  );

  // --- Candidate page shows the AI panel --------------------------------------
  if (application) {
    await page.goto(`${BASE}/recruiting/candidates/${application.candidateId}`, { waitUntil: 'networkidle' });
    const body = await page.content();
    check('the candidate page offers the AI question generator', body.includes('Suggest 5 questions') || body.includes('AI interview questions are not set up'));
    check('the résumé text arrived with the application', body.includes('characters on file'));
  }

  // --- Clean up the verification data -----------------------------------------
  if (application) {
    await db.application.delete({ where: { id: application.id } });
    await db.candidate.deleteMany({ where: { lastName: 'Candidate', firstName: 'Verification' } });
  }
  await db.jobBoardPosting.deleteMany({ where: { requisitionId: job.id } });

  await browser.close();
  await db.$disconnect();
  console.log(failures === 0 ? '\nINDEED FLOW VERIFIED' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);

}

main();
