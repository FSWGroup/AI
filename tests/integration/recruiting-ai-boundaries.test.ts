import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, ctxFor, type Fixture } from '../helpers/db';
import { can, type Ctx } from '@/lib/authz';
import { canAccessDocument } from '@/app/(app)/recruiting/../documents/actions';

/**
 * Authorization boundaries for the Indeed integration and the AI interview
 * question generator (§16, §35, §49). These assert the SERVER-SIDE rules —
 * hiding a button in the UI proves nothing.
 */

let fixture: Fixture;
let recruiter: Ctx, hr: Ctx, manager: Ctx, employee: Ctx, itAdmin: Ctx;
let resumeDocId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();

  const recruiterRow = await makeWorker({ fixture, email: 'recruiter@ai.test', roleKeys: ['RECRUITER'] });
  const hrRow = await makeWorker({ fixture, email: 'hr@ai.test', roleKeys: ['HR_ADMIN'] });
  const mgrRow = await makeWorker({ fixture, email: 'mgr@ai.test', roleKeys: ['MANAGER', 'EMPLOYEE'] });
  const empRow = await makeWorker({ fixture, email: 'emp@ai.test', roleKeys: ['EMPLOYEE'], managerId: mgrRow.workerId });
  const itRow = await makeWorker({ fixture, email: 'it@ai.test', roleKeys: ['IT_ADMIN'] });

  recruiter = await ctxFor(recruiterRow.userId);
  hr = await ctxFor(hrRow.userId);
  manager = await ctxFor(mgrRow.userId);
  employee = await ctxFor(empRow.userId);
  itAdmin = await ctxFor(itRow.userId);

  const doc = await testDb.document.create({
    data: {
      title: 'Résumé — cv.pdf',
      category: 'OTHER',
      classification: 'CONFIDENTIAL',
      tags: ['candidate-resume', 'indeed'],
      versions: {
        create: { version: 1, fileKey: 'documents/x.pdf', fileName: 'cv.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
      },
    },
  });
  resumeDocId = doc.id;
  await testDb.candidate.create({
    data: { firstName: 'Dana', lastName: 'Okafor', resumeDocId: doc.id, resumeText: 'Distribution experience.' },
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe('who may publish jobs and generate AI questions', () => {
  it('only recruiting.write holders may publish or generate', () => {
    expect(can(recruiter, 'recruiting.write')).toBe(true);
    expect(can(hr, 'recruiting.write')).toBe(true);
    expect(can(manager, 'recruiting.write')).toBe(false);
    expect(can(employee, 'recruiting.write')).toBe(false);
    expect(can(itAdmin, 'recruiting.write')).toBe(false);
  });

  it('an ordinary employee cannot read the recruiting pipeline at all', () => {
    expect(can(employee, 'recruiting.read')).toBe(false);
    expect(can(itAdmin, 'recruiting.read')).toBe(false);
    // Managers do hold recruiting.read — they are the hiring managers.
    expect(can(manager, 'recruiting.read')).toBe(true);
  });

  it('revealing the Indeed feed URL takes settings.admin, not recruiting.write', () => {
    expect(can(recruiter, 'settings.admin')).toBe(false);
  });
});

describe('candidate résumé documents', () => {
  it('are readable by a recruiter', async () => {
    const doc = await testDb.document.findUniqueOrThrow({ where: { id: resumeDocId } });
    expect(await canAccessDocument(recruiter, doc)).toBe(true);
  });

  it('are readable by a hiring manager, who already sees the candidate page', async () => {
    const doc = await testDb.document.findUniqueOrThrow({ where: { id: resumeDocId } });
    expect(await canAccessDocument(manager, doc)).toBe(true);
  });

  it('are not readable by anyone outside recruiting', async () => {
    const doc = await testDb.document.findUniqueOrThrow({ where: { id: resumeDocId } });
    expect(await canAccessDocument(employee, doc)).toBe(false);
    expect(await canAccessDocument(itAdmin, doc)).toBe(false);
  });

  it('do not open up every other unowned confidential document to recruiters', async () => {
    const other = await testDb.document.create({
      data: { title: 'Board comp review', category: 'COMPENSATION', classification: 'HIGHLY_RESTRICTED' },
    });
    expect(await canAccessDocument(recruiter, other)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source-level guarantees. These read the shipped code rather than exercising
// it, because the rules they protect are easy to regress in a later edit and
// hard to notice: an action that forgets its permission check still "works".
// ---------------------------------------------------------------------------

const readSource = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('server-side enforcement is present in the code that ships', () => {
  const actions = readSource('src/app/(app)/recruiting/actions.ts');

  it.each([
    'publishToBoardAction',
    'unpublishFromBoardAction',
    'generateInterviewQuestionsAction',
    'saveCandidateResumeAction',
  ])('%s checks a permission before doing anything', (name) => {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    const end = body.indexOf('\nexport async function', 1);
    const fn = end === -1 ? body : body.slice(0, end);
    expect(fn).toContain("requirePermission('recruiting.write')");
  });

  it('the Indeed feed route verifies its token', () => {
    const route = readSource('src/app/api/indeed/feed/route.ts');
    expect(route).toContain('verifyFeedToken');
  });

  it('the Indeed Apply route verifies the delivery signature', () => {
    const route = readSource('src/app/api/indeed/apply/route.ts');
    expect(route).toContain('verifyApplySignature');
  });

  it('the feed URL reveal is gated on settings.admin and audited', () => {
    const source = readSource('src/app/(app)/admin/integrations/indeed/actions.ts');
    expect(source).toContain("requirePermission('settings.admin')");
    expect(source).toContain('integration.secret_revealed');
  });
});

describe('the AI never gets more than it needs, and never decides', () => {
  const generator = readSource('src/lib/ai/interview-questions.ts');

  it('sends only the first name, redacted résumé and job text', () => {
    expect(generator).toContain('redactPersonalData');
    expect(generator).toContain('candidateFirstName');
    // Nothing about the candidate beyond those fields is in the prompt inputs.
    expect(generator).not.toContain('lastName');
    expect(generator).not.toContain('email');
    expect(generator).not.toContain('phone');
  });

  it('forbids protected characteristics in the instructions', () => {
    for (const term of ['age', 'disability', 'religion', 'pregnancy', 'marital', 'criminal']) {
      expect(generator.toLowerCase()).toContain(term);
    }
  });

  it('forbids the model from scoring or recommending', () => {
    expect(generator).toContain('Do not rate, score, rank or recommend');
  });

  it('has no path that changes an application status', () => {
    const actions = readSource('src/app/(app)/recruiting/actions.ts');
    const fn = actions.slice(actions.indexOf('export async function generateInterviewQuestionsAction'));
    expect(fn).not.toContain('application.update');
    expect(fn).not.toContain("status: 'REJECTED'");
  });

  it('still requires a written human reason to reject a candidate', () => {
    const actions = readSource('src/app/(app)/recruiting/actions.ts');
    const fn = actions.slice(
      actions.indexOf('export async function rejectApplicationAction'),
      actions.indexOf('export async function scheduleInterviewAction'),
    );
    expect(fn).toContain('A rejection reason is required.');
    expect(fn).toContain("requirePermission('recruiting.write')");
  });
});
