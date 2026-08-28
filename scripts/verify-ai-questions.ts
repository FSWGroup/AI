/**
 * Verifies that the AI interview-question control is really wired up: with no
 * key configured the panel says so, and with a key configured the button
 * exists and a click reaches the provider and reports the outcome. It never
 * silently does nothing.
 *
 * This does NOT prove a successful generation — that needs a real
 * ANTHROPIC_API_KEY. Pass one in the environment to exercise the full path.
 * Usage: npx tsx scripts/verify-ai-questions.ts
 */
import { chromium } from 'playwright-core';
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

async function main() {
  const application = await db.application.findFirst({
    include: { candidate: true, requisition: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!application) {
    console.log('No applications in the database — run the seed first.');
    process.exit(1);
  }
  // The generator needs résumé text; give the demo candidate some if missing.
  if (!application.candidate.resumeText) {
    await db.candidate.update({
      where: { id: application.candidateId },
      data: {
        resumeText:
          'Twelve years in industrial distribution. Ran a 20-person warehouse, cut pick errors 30% with Prophet 21 cycle counts, managed a $4M valve inventory.',
      },
    });
  }

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

  await page.goto(`${BASE}/recruiting/candidates/${application.candidateId}`, { waitUntil: 'networkidle' });
  const body = await page.content();

  if (!process.env.ANTHROPIC_API_KEY) {
    check('with no API key the panel says the feature is not set up', body.includes('AI interview questions are not set up'));
    check('and no button is offered that would fail', !body.includes('Suggest 5 questions'));
  } else {
    check('with a key configured the generate control is offered', body.includes('Suggest 5 questions') || body.includes('Generate a new set'));
    await page.getByRole('button', { name: /Suggest 5 questions|Generate a new set/ }).click();
    // Either a stored set appears, or an explicit message — never nothing.
    // Scope to the generator's own form so an unrelated banner cannot pass.
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: /Suggest 5 questions|Generate a new set/ }) }).first();
    const banner = form.locator('[role=alert], [role=status]').first();
    await banner.waitFor({ timeout: 180_000 }).catch(() => {});
    const message = (await banner.textContent().catch(() => ''))?.trim() ?? '';
    const stored = await db.interviewQuestionSet.count({ where: { applicationId: application.id } });
    check('the click produced either questions or a stated outcome', message.length > 0 || stored > 0, message);
    if (stored > 0) {
      const set = await db.interviewQuestionSet.findFirstOrThrow({
        where: { applicationId: application.id },
        orderBy: { createdAt: 'desc' },
      });
      const questions = set.questions as unknown as { question: string }[];
      check('exactly five questions were stored', questions.length === 5, String(questions.length));
      check('the model used is recorded for the audit trail', Boolean(set.model), set.model);
      check('the basis records what the model was shown', JSON.stringify(set.basis).includes('usedResume'));
      const audits = await db.auditEvent.count({ where: { action: 'recruiting.ai_questions_generated' } });
      check('the generation was audited', audits > 0);
      console.log('\nQuestions produced:');
      for (const q of questions) console.log(`  • ${q.question}`);
    }
  }

  await browser.close();
  await db.$disconnect();
  console.log(failures === 0 ? '\nAI QUESTION PANEL VERIFIED' : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
