import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, type Fixture } from '../helpers/db';
import { GET as feedRoute } from '@/app/api/indeed/feed/route';
import { POST as applyRoute } from '@/app/api/indeed/apply/route';

/**
 * End-to-end behaviour of the Indeed integration against a real database:
 * the feed's access control and contents, and the webhook's signature check,
 * idempotency and delivery logging.
 */

const FEED_TOKEN = process.env.INDEED_FEED_TOKEN!;
const APPLY_SECRET = process.env.INDEED_APPLY_SECRET!;

let fixture: Fixture;
let recruiterWorkerId: string;
let openJobId: string;
let draftJobId: string;
let postingId: string;

const feedRequest = (query: string) =>
  feedRoute(new NextRequest(`http://localhost:3000/api/indeed/feed${query}`));

function applyRequest(payload: unknown, opts: { signature?: string | null; tamper?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const signature =
    opts.signature !== undefined
      ? opts.signature
      : createHmac('sha256', APPLY_SECRET).update(opts.tamper ? `${body} ` : body, 'utf8').digest('base64');
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature) headers.set('indeed-signature', signature);
  return applyRoute(
    new NextRequest('http://localhost:3000/api/indeed/apply', { method: 'POST', body, headers }),
  );
}

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();
  const recruiter = await makeWorker({ fixture, email: 'recruiter@test.com', roleKeys: ['RECRUITER'] });
  recruiterWorkerId = recruiter.workerId;
  await testDb.pipelineStage.createMany({
    data: [
      { name: 'Applied', order: 1 },
      { name: 'Screen', order: 2 },
      { name: 'Hired', order: 9, isTerminal: true },
    ],
  });
});

afterAll(async () => {
  await testDb.$disconnect();
});

beforeEach(async () => {
  // TRUNCATE rather than deleteMany: the delivery log carries an append-only
  // trigger that (correctly) refuses row deletes.
  await testDb.$executeRawUnsafe(
    'TRUNCATE TABLE "JobBoardDelivery", "InterviewQuestionSet", "Application", "Candidate", "JobBoardPosting", "JobRequisition", "AuditEvent", "Notification" RESTART IDENTITY CASCADE',
  );

  const open = await testDb.jobRequisition.create({
    data: {
      title: 'Inside Sales Representative',
      status: 'OPEN',
      locationText: 'Exton, PA',
      employmentType: 'FULL_TIME',
      departmentId: fixture.departmentId,
      legalEntityId: fixture.entityId,
      recruiterId: recruiterWorkerId,
      description: 'Sell valves and fittings to industrial customers.',
      requirements: 'Two years of distribution experience.',
      salaryMin: 60000,
      salaryMax: 75000,
      headcount: 2,
      isReplacement: true,
    },
  });
  openJobId = open.id;
  const draft = await testDb.jobRequisition.create({
    data: { title: 'Warehouse Lead', status: 'DRAFT', description: 'Run the pick line.' },
  });
  draftJobId = draft.id;

  const posting = await testDb.jobBoardPosting.create({
    data: { requisitionId: openJobId, board: 'INDEED', publicLocation: 'Exton, PA', showSalary: false },
  });
  postingId = posting.id;
});

describe('job feed access control', () => {
  it('serves the feed with the right token', async () => {
    const response = await feedRequest(`?token=${encodeURIComponent(FEED_TOKEN)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/xml');
    const xml = await response.text();
    expect(xml).toContain('Inside Sales Representative');
  });

  it('returns 404 without a token, revealing nothing', async () => {
    const response = await feedRequest('');
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Inside Sales');
  });

  it('returns 404 for a wrong token', async () => {
    const response = await feedRequest('?token=not-the-token');
    expect(response.status).toBe(404);
  });

  it('records a denied crawl attempt in the audit log', async () => {
    await feedRequest('?token=not-the-token');
    const events = await testDb.auditEvent.findMany({ where: { action: 'indeed.feed_denied' } });
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('job feed contents', () => {
  it('excludes a job that is not published', async () => {
    await testDb.jobBoardPosting.update({ where: { id: postingId }, data: { status: 'REMOVED' } });
    const xml = await (await feedRequest(`?token=${FEED_TOKEN}`)).text();
    expect(xml).not.toContain('Inside Sales Representative');
  });

  it('excludes a published job whose requisition was closed', async () => {
    await testDb.jobRequisition.update({ where: { id: openJobId }, data: { status: 'CLOSED' } });
    const xml = await (await feedRequest(`?token=${FEED_TOKEN}`)).text();
    expect(xml).not.toContain('Inside Sales Representative');
  });

  it('never includes a draft requisition', async () => {
    const xml = await (await feedRequest(`?token=${FEED_TOKEN}`)).text();
    expect(xml).not.toContain('Warehouse Lead');
    expect(xml).not.toContain(draftJobId);
  });

  it('withholds the salary range unless the recruiter published it', async () => {
    let xml = await (await feedRequest(`?token=${FEED_TOKEN}`)).text();
    expect(xml).not.toContain('60,000');

    await testDb.jobBoardPosting.update({ where: { id: postingId }, data: { showSalary: true } });
    xml = await (await feedRequest(`?token=${FEED_TOKEN}`)).text();
    expect(xml).toContain('60,000');
  });

  it('never exposes internal requisition fields', async () => {
    const xml = await (await feedRequest(`?token=${FEED_TOKEN}`)).text();
    expect(xml).not.toContain('isReplacement');
    expect(xml).not.toContain(recruiterWorkerId);
    expect(xml).not.toContain('headcount');
  });

  it('records when Indeed last fetched the feed', async () => {
    await feedRequest(`?token=${FEED_TOKEN}`);
    const posting = await testDb.jobBoardPosting.findUniqueOrThrow({ where: { id: postingId } });
    expect(posting.lastFeedAt).not.toBeNull();
  });
});

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  id: 'indeed_apply_1',
  job: { jobId: openJobId, jobTitle: 'Inside Sales Representative' },
  applicant: {
    firstName: 'Dana',
    lastName: 'Okafor',
    email: 'dana.okafor@example.com',
    phoneNumber: '610-555-0100',
    resume: { text: 'Ten years running industrial distribution branches.' },
  },
  ...overrides,
});

describe('Indeed Apply webhook', () => {
  it('creates a candidate and an application from a signed delivery', async () => {
    const response = await applyRequest(validPayload());
    expect(response.status).toBe(201);

    const candidate = await testDb.candidate.findFirstOrThrow();
    expect(candidate.firstName).toBe('Dana');
    expect(candidate.source).toBe('INDEED');
    expect(candidate.resumeText).toContain('industrial distribution');

    const application = await testDb.application.findFirstOrThrow();
    expect(application.requisitionId).toBe(openJobId);
    expect(application.sourceBoard).toBe('INDEED');
    expect(application.sourceRef).toBe('INDEED:indeed_apply_1');
  });

  it('rejects an unsigned delivery and stores nothing', async () => {
    const response = await applyRequest(validPayload(), { signature: null });
    expect(response.status).toBe(401);
    expect(await testDb.candidate.count()).toBe(0);
    expect(await testDb.application.count()).toBe(0);
  });

  it('rejects a delivery whose body was modified after signing', async () => {
    const response = await applyRequest(validPayload(), { tamper: true });
    expect(response.status).toBe(401);
    expect(await testDb.application.count()).toBe(0);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const body = validPayload();
    const forged = createHmac('sha256', 'attacker-secret').update(JSON.stringify(body), 'utf8').digest('base64');
    const response = await applyRequest(body, { signature: forged });
    expect(response.status).toBe(401);
  });

  it('logs a rejected delivery without storing the applicant contact details', async () => {
    await applyRequest(validPayload(), { signature: null });
    const delivery = await testDb.jobBoardDelivery.findFirstOrThrow();
    expect(delivery.status).toBe('REJECTED');
    expect(JSON.stringify(delivery.payloadDigest)).not.toContain('dana.okafor@example.com');
    expect(JSON.stringify(delivery.payloadDigest)).not.toContain('610-555-0100');
  });

  it('is idempotent — a redelivery does not create a second application', async () => {
    expect((await applyRequest(validPayload())).status).toBe(201);
    const second = await applyRequest(validPayload());
    expect(second.status).toBe(200);
    expect(await testDb.application.count()).toBe(1);
    const duplicates = await testDb.jobBoardDelivery.findMany({ where: { status: 'DUPLICATE' } });
    expect(duplicates).toHaveLength(1);
  });

  it('refuses an application for a job that is not published', async () => {
    await testDb.jobBoardPosting.update({ where: { id: postingId }, data: { status: 'REMOVED' } });
    const response = await applyRequest(validPayload());
    expect(response.status).toBe(422);
    expect(await testDb.application.count()).toBe(0);
  });

  it('refuses an application for a closed requisition', async () => {
    await testDb.jobRequisition.update({ where: { id: openJobId }, data: { status: 'CLOSED' } });
    const response = await applyRequest(validPayload());
    expect(response.status).toBe(422);
  });

  it('refuses an application naming an unknown job', async () => {
    const response = await applyRequest(validPayload({ job: { jobId: 'no-such-requisition' } }));
    expect(response.status).toBe(422);
    expect(await testDb.application.count()).toBe(0);
  });

  it('reuses an existing candidate matched on email', async () => {
    await applyRequest(validPayload());
    const other = await testDb.jobRequisition.create({
      data: { title: 'Outside Sales', status: 'OPEN', description: 'Field sales.', locationText: 'Exton, PA' },
    });
    await testDb.jobBoardPosting.create({ data: { requisitionId: other.id, board: 'INDEED' } });
    await applyRequest(validPayload({ id: 'indeed_apply_2', job: { jobId: other.id } }));

    expect(await testDb.candidate.count()).toBe(1);
    expect(await testDb.application.count()).toBe(2);
  });

  it('notifies the recruiter on the requisition', async () => {
    await applyRequest(validPayload());
    const worker = await testDb.worker.findUniqueOrThrow({ where: { id: recruiterWorkerId } });
    const notifications = await testDb.notification.findMany({ where: { userId: worker.userId! } });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].title).toContain('Inside Sales Representative');
  });

  it('writes an audit event naming the application', async () => {
    await applyRequest(validPayload());
    const event = await testDb.auditEvent.findFirstOrThrow({
      where: { action: 'recruiting.application_received' },
    });
    expect(JSON.stringify(event.metadata)).toContain('INDEED');
  });

  it('rejects a body that is not JSON', async () => {
    const body = 'not json at all';
    const signature = createHmac('sha256', APPLY_SECRET).update(body, 'utf8').digest('base64');
    const response = await applyRoute(
      new NextRequest('http://localhost:3000/api/indeed/apply', {
        method: 'POST',
        body,
        headers: new Headers({ 'indeed-signature': signature }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('delivery log immutability', () => {
  it('cannot be edited or deleted once written', async () => {
    await applyRequest(validPayload());
    const delivery = await testDb.jobBoardDelivery.findFirstOrThrow({ where: { status: 'ACCEPTED' } });
    await expect(
      testDb.jobBoardDelivery.update({ where: { id: delivery.id }, data: { status: 'REJECTED' } }),
    ).rejects.toThrow();
    await expect(testDb.jobBoardDelivery.delete({ where: { id: delivery.id } })).rejects.toThrow();
  });
});
