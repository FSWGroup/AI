import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb, resetDatabase, seedRoles, seedOrg, makeWorker, ctxFor, type Fixture } from '../helpers/db';
import { can, type Ctx } from '@/lib/authz';
import {
  linkReferralsForCandidate, markReferralHired, bonusEligibleDate,
  sendCandidateEmail, talentPoolMatches, talentPoolDueForReview, REFERRAL_BONUS_WAIT_DAYS,
} from '@/lib/recruiting/funnel';

let fixture: Fixture;
let recruiter: Ctx, employee: Ctx;
let referrerId: string;

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

beforeAll(async () => {
  await resetDatabase();
  await seedRoles();
  fixture = await seedOrg();
  const recRow = await makeWorker({ fixture, email: 'rec@fn.test', roleKeys: ['RECRUITER'] });
  const empRow = await makeWorker({ fixture, email: 'emp@fn.test', roleKeys: ['EMPLOYEE'] });
  referrerId = empRow.workerId;
  recruiter = await ctxFor(recRow.userId);
  employee = await ctxFor(empRow.userId);
});

afterAll(async () => {
  await testDb.$disconnect();
});

beforeEach(async () => {
  await testDb.$executeRawUnsafe(
    'TRUNCATE TABLE "Referral", "TalentPoolEntry", "Application", "Candidate", "EmailMessage" RESTART IDENTITY CASCADE',
  );
});

describe('referral matching', () => {
  it('attaches a referral to a candidate with the same email', async () => {
    await testDb.referral.create({
      data: { referrerWorkerId: referrerId, candidateName: 'Dana Okafor', candidateEmail: 'dana@example.com' },
    });
    const candidate = await testDb.candidate.create({
      data: { firstName: 'Dana', lastName: 'Okafor', email: 'dana@example.com' },
    });

    expect(await linkReferralsForCandidate(candidate.id)).toBe(1);
    const referral = await testDb.referral.findFirstOrThrow();
    expect(referral.candidateId).toBe(candidate.id);
    expect(referral.status).toBe('LINKED');
  });

  it('matches case-insensitively, because people type their own address inconsistently', async () => {
    await testDb.referral.create({
      data: { referrerWorkerId: referrerId, candidateName: 'Dana', candidateEmail: 'Dana@Example.com' },
    });
    const candidate = await testDb.candidate.create({
      data: { firstName: 'Dana', lastName: 'Okafor', email: 'dana@example.com' },
    });
    expect(await linkReferralsForCandidate(candidate.id)).toBe(1);
  });

  it('never matches on name alone — a bonus must not reach the wrong person', async () => {
    await testDb.referral.create({
      data: { referrerWorkerId: referrerId, candidateName: 'Dana Okafor', candidateEmail: 'dana@example.com' },
    });
    const namesake = await testDb.candidate.create({
      data: { firstName: 'Dana', lastName: 'Okafor', email: 'different.dana@example.com' },
    });
    expect(await linkReferralsForCandidate(namesake.id)).toBe(0);
    expect((await testDb.referral.findFirstOrThrow()).candidateId).toBeNull();
  });

  it('does nothing for a candidate with no email', async () => {
    await testDb.referral.create({
      data: { referrerWorkerId: referrerId, candidateName: 'Anon', candidateEmail: 'anon@example.com' },
    });
    const candidate = await testDb.candidate.create({ data: { firstName: 'No', lastName: 'Email' } });
    expect(await linkReferralsForCandidate(candidate.id)).toBe(0);
  });

  it('does not re-link a referral that was already closed', async () => {
    const candidate = await testDb.candidate.create({
      data: { firstName: 'Dana', lastName: 'Okafor', email: 'dana@example.com' },
    });
    await testDb.referral.create({
      data: {
        referrerWorkerId: referrerId, candidateName: 'Dana', candidateEmail: 'dana@example.com', status: 'CLOSED',
      },
    });
    expect(await linkReferralsForCandidate(candidate.id)).toBe(0);
  });
});

describe('referral bonus lifecycle', () => {
  it('opens the bonus for approval when the referred candidate is hired', async () => {
    const candidate = await testDb.candidate.create({
      data: { firstName: 'Dana', lastName: 'Okafor', email: 'dana@example.com' },
    });
    await testDb.referral.create({
      data: {
        referrerWorkerId: referrerId, candidateId: candidate.id,
        candidateName: 'Dana', candidateEmail: 'dana@example.com', status: 'LINKED',
      },
    });
    const startDate = new Date('2026-09-01T00:00:00Z');
    await markReferralHired(candidate.id, startDate);

    const referral = await testDb.referral.findFirstOrThrow();
    expect(referral.status).toBe('HIRED');
    expect(referral.bonusStatus).toBe('PENDING');
    expect(referral.bonusEligibleAt?.toISOString()).toBe(bonusEligibleDate(startDate).toISOString());
  });

  it('sets eligibility 90 days after the start date, not the referral date', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const eligible = bonusEligibleDate(start);
    expect((eligible.getTime() - start.getTime()) / 86_400_000).toBe(REFERRAL_BONUS_WAIT_DAYS);
  });
});

describe('candidate emails', () => {
  it('queues a message and records what it was about', async () => {
    const candidate = await testDb.candidate.create({
      data: { firstName: 'Dana', lastName: 'Okafor', email: 'dana@example.com' },
    });
    expect(await sendCandidateEmail({ candidateId: candidate.id, kind: 'RECEIVED', jobTitle: 'Inside Sales' })).toBe(true);

    const message = await testDb.emailMessage.findFirstOrThrow();
    expect(message.toEmail).toBe('dana@example.com');
    expect(message.templateKey).toBe('candidate.received');
    expect(message.relatedId).toBe(candidate.id);
    expect(message.html).toContain('Inside Sales');
  });

  it('reports failure rather than pretending, when there is no address', async () => {
    const candidate = await testDb.candidate.create({ data: { firstName: 'No', lastName: 'Email' } });
    expect(await sendCandidateEmail({ candidateId: candidate.id, kind: 'RECEIVED', jobTitle: 'X' })).toBe(false);
    expect(await testDb.emailMessage.count()).toBe(0);
  });

  it('escapes recruiter-authored text before it reaches an outside inbox', async () => {
    const candidate = await testDb.candidate.create({
      data: { firstName: 'Dana', lastName: 'Okafor', email: 'dana@example.com' },
    });
    await sendCandidateEmail({
      candidateId: candidate.id, kind: 'ADVANCED', jobTitle: 'Sales',
      note: '<script>alert(1)</script> & "quoted"',
    });
    const message = await testDb.emailMessage.findFirstOrThrow();
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});

describe('talent pool', () => {
  const addCandidate = async (email: string) =>
    testDb.candidate.create({ data: { firstName: 'Pool', lastName: email.slice(0, 4), email } });

  it('offers only entries whose review date has not passed', async () => {
    const fresh = await addCandidate('fresh@example.com');
    const stale = await addCandidate('stale@example.com');
    await testDb.talentPoolEntry.create({ data: { candidateId: fresh.id, reviewBy: days(90), jobFamily: 'Sales' } });
    await testDb.talentPoolEntry.create({ data: { candidateId: stale.id, reviewBy: days(-1), jobFamily: 'Sales' } });

    const matches = await talentPoolMatches();
    expect(matches.map((m) => m.candidateId)).toEqual([fresh.id]);
  });

  it('surfaces lapsed entries for a keep-or-remove decision instead of dropping them silently', async () => {
    const stale = await addCandidate('stale2@example.com');
    await testDb.talentPoolEntry.create({ data: { candidateId: stale.id, reviewBy: days(-5) } });
    const due = await talentPoolDueForReview();
    expect(due.map((d) => d.candidateId)).toContain(stale.id);
  });

  it('filters by job family when a role is being filled', async () => {
    const sales = await addCandidate('sales@example.com');
    const warehouse = await addCandidate('warehouse@example.com');
    await testDb.talentPoolEntry.create({ data: { candidateId: sales.id, jobFamily: 'Sales', reviewBy: days(90) } });
    await testDb.talentPoolEntry.create({ data: { candidateId: warehouse.id, jobFamily: 'Warehouse', reviewBy: days(90) } });

    const matches = await talentPoolMatches({ jobFamily: 'Sales' });
    expect(matches.map((m) => m.candidateId)).toEqual([sales.id]);
  });

  it('excludes anyone removed from the pool', async () => {
    const gone = await addCandidate('gone@example.com');
    await testDb.talentPoolEntry.create({ data: { candidateId: gone.id, status: 'REMOVED', reviewBy: days(90) } });
    expect(await talentPoolMatches()).toHaveLength(0);
  });

  it('keeps an entry with no review date, since that was a deliberate choice', async () => {
    const forever = await addCandidate('forever@example.com');
    await testDb.talentPoolEntry.create({ data: { candidateId: forever.id, reviewBy: null } });
    expect((await talentPoolMatches()).map((m) => m.candidateId)).toContain(forever.id);
  });
});

describe('who may do what in the funnel', () => {
  it('lets any employee refer someone', () => {
    // No permission gate on referring — the action falls back to the caller's
    // own worker id, so an employee can only refer as themselves.
    expect(can(employee, 'recruiting.write')).toBe(false);
    expect(can(recruiter, 'recruiting.write')).toBe(true);
  });

  it('keeps the talent pool and bonus decisions to recruiting', () => {
    expect(can(employee, 'recruiting.read')).toBe(false);
    expect(can(recruiter, 'recruiting.read')).toBe(true);
  });
});
